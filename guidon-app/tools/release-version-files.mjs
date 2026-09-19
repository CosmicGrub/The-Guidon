/**
 * Every place GUIDON writes its own version number, in ONE list.
 *
 * WHY THIS EXISTS. A GUIDON version lives in eleven spots across eight files
 * (npm, the lockfile twice, the Windows/macOS shell three times, Android
 * twice, the iOS project four times). Nothing listed them, so every release
 * was bumped by a one-off script that knew about some of them: v1.9.0 and
 * v1.10.0 were tagged with the lockfile still saying 1.7.0, and the iOS
 * project was not mentioned by any tool at all. This module is the list.
 * tools/lint-release-state.mjs reads through it (do they all agree?) and
 * tools/bump-version.mjs writes through it (change them all at once), so the
 * two can never disagree about where the version lives.
 *
 * Every anchor is a regular expression with one named group `v` - the exact
 * characters of the value. Reading returns the value and its line; writing
 * splices new characters into that exact span and touches nothing else, so
 * formatting, comments and line endings survive byte for byte.
 *
 * kind: "version" -> must equal package.json's x.y.z
 *       "code"    -> Android versionCode, derived: major*10000+minor*100+patch
 *       "build"   -> iOS build number: a plain counter that only ever goes up
 * optional: true  -> zero matches is fine (the firmware README names no
 *                    version today; if it ever does, it has to be the right one)
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const ANCHORS = [
  { id: "package.json", file: "guidon-app/package.json", kind: "version", count: 1, re: /^\s*"version":\s*"(?<v>[^"]*)"/dm },
  { id: "package-lock.json (root)", file: "guidon-app/package-lock.json", kind: "version", count: 1, re: /^\s*"version":\s*"(?<v>[^"]*)"/dm },
  { id: 'package-lock.json (packages[""])', file: "guidon-app/package-lock.json", kind: "version", count: 1, re: /"packages":\s*\{\s*"":\s*\{[^{}]*?"version":\s*"(?<v>[^"]*)"/d },
  { id: "tauri.conf.json", file: "guidon-app/src-tauri/tauri.conf.json", kind: "version", count: 1, re: /^\s*"version":\s*"(?<v>[^"]*)"/dm },
  { id: "Cargo.toml [package]", file: "guidon-app/src-tauri/Cargo.toml", kind: "version", count: 1, re: /^\[package\][^[]*?^version\s*=\s*"(?<v>[^"]*)"/dms },
  { id: 'Cargo.lock (name = "guidon")', file: "guidon-app/src-tauri/Cargo.lock", kind: "version", count: 1, re: /^name = "guidon"\r?\nversion = "(?<v>[^"]*)"/dm },
  { id: "Android versionName", file: "guidon-app/android/app/build.gradle", kind: "version", count: 1, re: /^\s*versionName\s+"(?<v>[^"]*)"/dm },
  { id: "Android versionCode", file: "guidon-app/android/app/build.gradle", kind: "code", count: 1, re: /^\s*versionCode\s+(?<v>\d+)/dm },
  { id: "iOS MARKETING_VERSION", file: "guidon-app/ios/App/App.xcodeproj/project.pbxproj", kind: "version", count: 2, re: /MARKETING_VERSION = (?<v>[^;]*);/dg },
  { id: "iOS CURRENT_PROJECT_VERSION", file: "guidon-app/ios/App/App.xcodeproj/project.pbxproj", kind: "build", count: 2, re: /CURRENT_PROJECT_VERSION = (?<v>[^;]*);/dg },
  { id: "ESP32 firmware README", file: "firmware/esp32-flashcard-os/README.md", kind: "version", optional: true, re: /GUIDON[- ]v?(?<v>\d+\.\d+\.\d+)/dg },
];

export const SEMVER = /^\d+\.\d+\.\d+$/;
export const parseVersion = (v) => (SEMVER.test(String(v)) ? String(v).split(".").map(Number) : null);
/** <0, 0, >0 like a sort comparator; throws on anything that is not x.y.z. */
export function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`cannot compare "${a}" with "${b}" - both must be x.y.z`);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}
/** Android's versionCode for a version: 1.12.1 -> 11201. Minor and patch must stay under 100. */
export function androidVersionCode(v) {
  const p = parseVersion(v);
  if (!p) throw new Error(`"${v}" is not an x.y.z version`);
  if (p[1] > 99 || p[2] > 99) throw new Error(`"${v}" does not fit the versionCode formula (minor and patch must be 0-99)`);
  return p[0] * 10000 + p[1] * 100 + p[2];
}

function matchesOf(anchor, text) {
  const flags = anchor.re.flags.includes("g") ? anchor.re.flags : anchor.re.flags + "g";
  const re = new RegExp(anchor.re.source, flags);
  const out = [];
  for (const m of text.matchAll(re)) {
    const [start, end] = m.indices.groups.v;
    out.push({ value: m.groups.v, start, end, line: text.slice(0, start).split("\n").length });
    if (!anchor.re.flags.includes("g")) break;
  }
  return out;
}

/**
 * -> [{ id, file, kind, optional, expectedCount, found: [{ value, line }], missingFile }]
 * One entry per anchor; nothing is judged here.
 */
export function readAnchors(root, readText = (p) => readFileSync(p, "utf-8")) {
  return ANCHORS.map((a) => {
    let text = null;
    try { text = readText(path.join(root, a.file)); } catch (e) { text = null; }
    return { id: a.id, file: a.file, kind: a.kind, optional: !!a.optional, expectedCount: a.count || 0,
      missingFile: text == null, found: text == null ? [] : matchesOf(a, text).map(({ value, line }) => ({ value, line })) };
  });
}

/**
 * Work out every edit a bump to `version` needs. Pure: reads, never writes.
 * -> { files: [{ file, before, after }], changes: [{ id, file, line, from, to }], problems: [string] }
 * iosBuild: the build number to write; default is "one more than now", and
 * "unchanged" when the version itself is not changing (so running the same
 * bump twice is a no-op, not a second increment).
 */
export function planBump(root, version, { iosBuild, readText = (p) => readFileSync(p, "utf-8") } = {}) {
  if (!parseVersion(version)) throw new Error(`"${version}" is not an x.y.z version`);
  const code = String(androidVersionCode(version));
  const texts = new Map(), problems = [], changes = [];
  const current = (() => { try { return JSON.parse(readText(path.join(root, "guidon-app/package.json"))).version; } catch (e) { return null; } })();
  for (const a of ANCHORS) {
    if (!texts.has(a.file)) { try { const t = readText(path.join(root, a.file)); texts.set(a.file, { before: t, edits: [] }); } catch (e) { texts.set(a.file, null); } }
    const entry = texts.get(a.file);
    if (!entry) { if (!a.optional) problems.push(`${a.file} is missing`); continue; }
    const hits = matchesOf(a, entry.before);
    if (!a.optional && hits.length !== a.count) { problems.push(`${a.file}: expected ${a.count} "${a.id}" value(s), found ${hits.length}`); continue; }
    for (const h of hits) {
      let to = version;
      if (a.kind === "code") to = code;
      if (a.kind === "build") {
        const now = Number(h.value);
        if (!Number.isInteger(now)) { problems.push(`${a.file}:${h.line}: iOS build number "${h.value}" is not a whole number`); continue; }
        to = String(iosBuild != null ? iosBuild : (current === version ? now : now + 1));
      }
      if (to !== h.value) { entry.edits.push({ ...h, to }); changes.push({ id: a.id, file: a.file, line: h.line, from: h.value, to }); }
    }
  }
  const files = [];
  for (const [file, entry] of texts) {
    if (!entry || !entry.edits.length) continue;
    let after = entry.before;
    // Right to left, so earlier offsets stay valid.
    for (const e of entry.edits.slice().sort((x, y) => y.start - x.start)) after = after.slice(0, e.start) + e.to + after.slice(e.end);
    files.push({ file, before: entry.before, after });
  }
  return { files, changes, problems, current };
}
