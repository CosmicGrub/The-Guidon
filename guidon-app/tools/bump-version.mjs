/**
 * One command that moves GUIDON to a new version number everywhere at once.
 *
 *   node tools/bump-version.mjs 1.12.1            show what WOULD change (default)
 *   node tools/bump-version.mjs 1.12.1 --write    change the files
 *   node tools/bump-version.mjs --check           only report whether the files agree
 *   ... --root <repo root>                        work on another checkout (tests)
 *   ... --ios-build <n>                           set the iOS build number instead of +1
 *
 * WHY THIS EXISTS. The version lives in eleven places across eight files
 * (the list is tools/release-version-files.mjs). The last three bumps were
 * each done by a one-off helper that knew about some of them, and none knew
 * about the iOS project. This writes every one, from that same list, so it
 * cannot drift from what tools/lint-release-state.mjs checks.
 *
 * What it changes: package.json, package-lock.json (both spots),
 * src-tauri/tauri.conf.json, src-tauri/Cargo.toml, the guidon entry in
 * src-tauri/Cargo.lock, Android versionName + versionCode
 * (major*10000 + minor*100 + patch), and in the iOS project both
 * MARKETING_VERSION lines and both CURRENT_PROJECT_VERSION lines (the iOS
 * build number goes up by one per version change; re-running the same bump
 * does not raise it again). A version named in the ESP32 firmware README is
 * updated too, if there is one.
 *
 * What it deliberately does NOT write, because a person has to: the What's
 * New entry Soldiers see, the CHANGELOG entry, and ROADMAP's "Current
 * version" line. It prints that list, and `npm run lint:patterns` fails
 * until they exist. It never commits, tags or pushes.
 *
 * Refuses: anything that is not x.y.z, a version lower than the current one,
 * and a version that is not higher than the newest version tag (a tagged
 * number is spent - the same number can never name a second build).
 * Dry-run is the default on purpose: a version bump is a one-way door.
 */
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { planBump, readAnchors, parseVersion, compareVersions, androidVersionCode } from "./release-version-files.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function newestTag(root) {
  const r = spawnSync("git", ["-C", root, "tag", "--list", "v*"], { encoding: "utf-8" });
  if (r.status !== 0) return null;
  const tags = r.stdout.split(/\r?\n/).map((t) => t.trim()).filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).map((t) => t.slice(1)).sort(compareVersions);
  return tags.length ? tags[tags.length - 1] : null;
}

/** -> { ok, lines[], changes[], wrote } ; never throws for a refusal. */
export function bump({ root, version, write = false, iosBuild }) {
  const lines = [];
  if (!parseVersion(version)) return { ok: false, lines: [`REFUSED: "${version}" is not an x.y.z version`], changes: [], wrote: false };
  try { androidVersionCode(version); } catch (e) { return { ok: false, lines: ["REFUSED: " + e.message], changes: [], wrote: false }; }
  const plan = planBump(root, version, { iosBuild });
  if (plan.problems.length) return { ok: false, lines: plan.problems.map((p) => "REFUSED: " + p), changes: [], wrote: false };
  if (plan.current && parseVersion(plan.current) && compareVersions(version, plan.current) < 0) {
    return { ok: false, lines: [`REFUSED: ${version} is lower than the current version ${plan.current} - a version never goes backwards`], changes: [], wrote: false };
  }
  const tag = newestTag(root);
  if (tag && compareVersions(version, tag) <= 0) {
    return { ok: false, lines: [`REFUSED: v${tag} is already tagged, so the next version must be higher than ${tag} (a tagged number is never reused)`], changes: [], wrote: false };
  }
  if (!tag) lines.push("note: no version tags are visible here, so \"higher than the last release\" was not checked");
  if (!plan.changes.length) lines.push(`every version value already says ${version} - nothing to change`);
  for (const c of plan.changes) lines.push(`${write ? "changed" : "would change"}  ${c.file}:${c.line}  ${c.id}: ${c.from} -> ${c.to}`);
  if (write) for (const f of plan.files) writeFileSync(path.join(root, f.file), f.after, "utf-8");
  else if (plan.changes.length) lines.push("", "Dry run - nothing was written. Add --write to apply.");
  if (plan.changes.length || write) {
    lines.push("", `Still to write by hand for ${version} (lint:patterns fails until they exist):`,
      `  - a What's New entry (src/app-modules/99-release-*.js) - plain language, what a Soldier will notice`,
      `  - a CHANGELOG entry headed "## <date> - v${version}: ..."; mark any skipped number "(prepared, not released)"`,
      `  - ROADMAP's "Current version" line`,
      "Then: npm run lint:patterns. This tool never commits, tags or pushes.");
  }
  return { ok: true, lines, changes: plan.changes, wrote: write && plan.files.length > 0 };
}

/* --------------------------------------------------------------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const argOf = (flag) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
  const root = path.resolve(argOf("--root") || path.join(HERE, "..", ".."));
  if (args.includes("--check")) {
    const anchors = readAnchors(root);
    const v = (anchors.find((a) => a.id === "package.json").found[0] || {}).value;
    let off = 0;
    for (const a of anchors) for (const f of a.found) {
      const want = a.kind === "code" ? String(androidVersionCode(v)) : a.kind === "build" ? f.value : v;
      const good = f.value === want;
      if (!good) off++;
      console.log(`  ${good ? "ok " : "OFF"}  ${a.file}:${f.line}  ${a.id} = ${f.value}${good ? "" : `   (expected ${want})`}`);
    }
    console.log(off ? `\nbump-version --check: ${off} value(s) disagree with package.json ${v}` : `\nbump-version --check: every value agrees on ${v}`);
    process.exit(off ? 1 : 0);
  }
  const skip = new Set(["--root", "--ios-build"]);
  const version = args.find((a, i) => !a.startsWith("--") && !skip.has(args[i - 1]));
  if (!version) { console.error("usage: node tools/bump-version.mjs <x.y.z> [--write] [--ios-build <n>] [--root <dir>]   |   --check"); process.exit(1); }
  const iosArg = argOf("--ios-build");
  if (iosArg != null && !/^\d+$/.test(iosArg)) { console.error("bump-version: --ios-build must be a whole number"); process.exit(1); }
  const res = bump({ root, version, write: args.includes("--write"), iosBuild: iosArg != null ? Number(iosArg) : undefined });
  for (const l of res.lines) console.log(l ? "bump-version: " + l : "");
  process.exit(res.ok ? 0 : 1);
}
