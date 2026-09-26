/**
 * Regression suite for tools/lint-release-state.mjs (do all version files
 * agree, and does anything claim a release that never happened?) and
 * tools/bump-version.mjs (one command that changes every version location).
 *
 * WHY THIS EXISTS. v1.9.0 and v1.10.0 were tagged with package-lock.json
 * still saying 1.7.0; three later bumps were each done by a one-off helper
 * and none of them knew the iOS project existed; the CHANGELOG and the in-app
 * notes described 1.11.0 and 1.12.0 as finished tagged releases when neither
 * was ever cut. A lint that is supposed to catch those has to be shown
 * catching them, so every rule below is driven with a real mistake.
 *
 * HOW. No browser. The suite builds a throwaway copy of the REAL
 * version-bearing files (same formats, same line numbers) inside a temp git
 * repository with a real tag, breaks one thing at a time, and runs the same
 * lintReleaseState() / bump() the CLI runs. bump-version is only ever run
 * with --write against that temp copy - against the real tree it is run as a
 * dry run and the suite proves not one byte changed.
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { lintReleaseState } from "./lint-release-state.mjs";
import { bump } from "./bump-version.mjs";
import { ANCHORS, planBump, compareVersions, androidVersionCode } from "./release-version-files.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail || pass));

const REAL_ROOT = path.resolve("..");
const FILES = [...new Set(ANCHORS.map((a) => a.file))];
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const scratch = mkdtempSync(path.join(tmpdir(), "guidon-release-state-"));
const root = path.join(scratch, "repo");
const at = (rel) => path.join(root, rel);
const put = (rel, text) => { mkdirSync(path.dirname(at(rel)), { recursive: true }); writeFileSync(at(rel), text); };
const get = (rel) => readFileSync(at(rel), "utf-8");
const git = (...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf-8" });
const applyPlan = (version, iosBuild) => { for (const f of planBump(root, version, { iosBuild }).files) writeFileSync(at(f.file), f.after); };

const changelog = (heads) => "# Changelog\n\n" + heads.map((h) => `## 2026-01-01 - ${h}\n\nText.\n`).join("\n");
// The fixture's src/index.html: the #/share download links lint (f) reads, and
// the ONE placeholder the build fills (its own entries live in the data file).
const INDEX = "guidon-app/src/index.html";
const NOTES = "guidon-app/src/data/whats-new.json";
const indexHtml = (links = ["GUIDON-android.apk", "GUIDON-windows-setup.exe"]) =>
  "<script>\n" + links.map((n) => `  x(dl("${n}"));`).join("\n") + "\n  G.whatsNew = {\n    RELEASE_NOTES: /*@@WHATS_NEW_ENTRIES@@*/ [],\n    async checkOnBoot() {},\n  };\n</script>\n";
// The fixture's What's New data file, exactly the shape the real one has.
const notesJson = (entries) => JSON.stringify({ $doc: { what: "fixture" }, entries: entries.map((e) => Object.assign({ version: e.v }, e.unreleased ? { released: false } : {}, { date: "x", title: "t", highlights: ["h"] })) }, null, 2) + "\n";

try {
  /* ------------------------------------------------------------------
     The fixture: real files, a real history. Commit 1 is "1.10.1" and is
     tagged; commit 2 is "1.12.0" with 1.11.0 prepared but never cut - the
     shape main really has.
     ------------------------------------------------------------------ */
  for (const rel of FILES) { mkdirSync(path.dirname(at(rel)), { recursive: true }); copyFileSync(path.join(REAL_ROOT, rel), at(rel)); }
  mkdirSync(at(".github/workflows"), { recursive: true });
  for (const n of readdirSync(path.join(REAL_ROOT, ".github/workflows")).filter((x) => /^release-/.test(x))) copyFileSync(path.join(REAL_ROOT, ".github/workflows", n), at(".github/workflows/" + n));
  git("init", "-q"); git("config", "user.email", "t@example.invalid"); git("config", "user.name", "t"); git("config", "commit.gpgsign", "false"); git("config", "core.autocrlf", "false");
  applyPlan("1.10.1", 2);
  put("GUIDON files/CHANGELOG.md", changelog(["v1.10.1: first"]));
  put("GUIDON files/ROADMAP.md", "# Roadmap\n\n**Current version:** v1.10.1 (x)\n");
  put(INDEX, indexHtml());
  put(NOTES, notesJson([{ v: "1.10.1" }]));
  git("add", "-A"); git("commit", "-q", "-m", "1.10.1"); git("tag", "v1.10.1");
  applyPlan("1.12.0", 4);
  const GOOD_LOG = changelog(["v1.12.0: now", "v1.11.0 (prepared, not released): skipped", "v1.10.1: first"]);
  const GOOD_NOTES = notesJson([{ v: "1.10.1" }, { v: "1.11.0", unreleased: true }, { v: "1.12.0" }]);
  put("GUIDON files/CHANGELOG.md", GOOD_LOG);
  put("GUIDON files/ROADMAP.md", "# Roadmap\n\n**Current version:** v1.12.0 (x)\n");
  put(NOTES, GOOD_NOTES);
  git("add", "-A"); git("commit", "-q", "-m", "1.12.0");

  const lint = (opts = {}) => lintReleaseState({ root, ...opts });
  /** Break one file, lint, put it back. */
  const broken = (rel, edit, opts) => { const before = get(rel); const after = edit(before); if (after === before) throw new Error("the edit to " + rel + " changed nothing - the test would prove nothing"); put(rel, after); try { return lint(opts); } finally { put(rel, before); } };
  const failsWith = (res, re) => res.failures.some((f) => re.test(f));

  console.log("\n1. The real tree, and a faithful copy of it");
  const realCli = spawnSync(process.execPath, ["tools/lint-release-state.mjs"], { encoding: "utf-8" });
  check(realCli.status === 0 && /LINT-RELEASE-STATE: all passed/.test(realCli.stdout), "the real repository passes lint-release-state", "the real repository FAILS lint-release-state:\n" + realCli.stdout);
  const base = lint();
  check(base.failures.length === 0 && base.tags.join() === "1.10.1", "the fixture (tag v1.10.1, version 1.12.0, 1.11.0 marked as never released) passes", "fixture baseline fails: " + base.failures.join(" | "));

  console.log("\n2. Every version location is really checked (one stale value at a time)");
  const pbx = "guidon-app/ios/App/App.xcodeproj/project.pbxproj";
  const secondMarketingLine = get(pbx).split("\n").map((l, i) => (/MARKETING_VERSION/.test(l) ? i + 1 : 0)).filter(Boolean)[1];
  let r = broken(pbx, (t) => { let n = 0; return t.replace(/MARKETING_VERSION = [^;]*;/g, (m) => (++n === 2 ? "MARKETING_VERSION = 1.10.1;" : m)); });
  check(failsWith(r, new RegExp(`project\\.pbxproj:${secondMarketingLine}: iOS MARKETING_VERSION is "1\\.10\\.1"`)), `one stale iOS MARKETING_VERSION fails, naming the file and line (${secondMarketingLine})`, "a stale MARKETING_VERSION was not caught: " + r.failures.join(" | "));
  r = broken("guidon-app/package-lock.json", (t) => t.replace(/("packages":\s*\{\s*"":\s*\{[^{}]*?"version":\s*")[^"]*"/, '$11.7.0"'));
  check(failsWith(r, /package-lock\.json:\d+: package-lock\.json \(packages\[""\]\) is "1\.7\.0"/), 'a lockfile left behind at 1.7.0 (how v1.9.0 and v1.10.0 were tagged) fails');
  r = broken("guidon-app/package-lock.json", (t) => t.replace(/"version":\s*"[^"]*"/, '"version": "1.7.0"'));
  check(failsWith(r, /package-lock\.json \(root\) is "1\.7\.0"/), "the lockfile's root version is checked separately from packages[\"\"]");
  for (const [rel, re, label] of [
    ["guidon-app/src-tauri/tauri.conf.json", /"version":\s*"[^"]*"/, "tauri.conf.json"], ["guidon-app/src-tauri/Cargo.toml", /^version\s*=\s*"[^"]*"/m, "Cargo.toml"],
    ["guidon-app/src-tauri/Cargo.lock", /(name = "guidon"\r?\nversion = ")[^"]*"/, "Cargo.lock"], ["guidon-app/android/app/build.gradle", /versionName\s+"[^"]*"/, "Android versionName"]]) {
    r = broken(rel, (t) => t.replace(re, (m, p1) => (typeof p1 === "string" ? p1 + '9.9.9"' : m.replace(/"[^"]*"$/, '"9.9.9"'))));
    check(failsWith(r, new RegExp(label.replace(/[.[\]]/g, "\\$&") + '.* is "9\\.9\\.9"')), `a stale ${label} fails`, `a stale ${label} was not caught: ` + r.failures.join(" | "));
  }
  r = broken("guidon-app/android/app/build.gradle", (t) => t.replace(/versionCode\s+\d+/, "versionCode 11199"));
  check(failsWith(r, /Android versionCode is 11199, but 1\.12\.0 must be 11200/), "an Android versionCode that does not follow the formula fails");
  r = broken(pbx, (t) => { let n = 0; return t.replace(/CURRENT_PROJECT_VERSION = \d+;/g, (m) => (++n === 2 ? "CURRENT_PROJECT_VERSION = 9;" : m)); });
  check(failsWith(r, /iOS build numbers must be one whole number used in both places/), "two different iOS build numbers fail");
  r = broken(pbx, (t) => t.replace(/CURRENT_PROJECT_VERSION = \d+;/g, "CURRENT_PROJECT_VERSION = 2;"));
  check(failsWith(r, /iOS build number 2 is not higher than v1\.10\.1's 2/), "an iOS build number no higher than the last release's fails (it could not be installed over it)");
  put("firmware/esp32-flashcard-os/README.md", get("firmware/esp32-flashcard-os/README.md") + "\nBuilt for GUIDON v1.9.0.\n");
  r = lint(); git("checkout", "--", "firmware/esp32-flashcard-os/README.md");
  check(failsWith(r, /ESP32 firmware README is "1\.9\.0"/), "a version named in the ESP32 firmware README has to be the current one");

  console.log("\n3. Nothing claims a release that has no tag");
  r = broken("GUIDON files/CHANGELOG.md", () => changelog(["v1.12.0: now", "v1.11.0: skipped", "v1.10.1: first"]));
  check(r.failures.length === 0 && r.notes.some((n) => /v1\.11\.0/.test(n)), "TRANSITION: while the version is still exactly 1.12.0, the CHANGELOG's unmarked 1.11.0 is reported but tolerated");
  git("tag", "v1.10.0");
  r = lint();
  check(r.failures.length === 0 && r.notes.some((n) => /v1\.10\.0 is tagged but has no CHANGELOG entry/.test(n)), "TRANSITION: the same for v1.10.0, which is tagged but has no CHANGELOG entry");
  git("tag", "-d", "v1.10.0");
  // ...and the moment the version moves on, both become hard failures.
  applyPlan("1.12.1");
  const LOG_1121 = (extra) => changelog(["v1.12.1: fix", ...extra, "v1.10.1: first"]);
  put("GUIDON files/ROADMAP.md", "# Roadmap\n\n**Current version:** v1.12.1 (x)\n");
  put(NOTES, notesJson([{ v: "1.10.1" }, { v: "1.11.0", unreleased: true }, { v: "1.12.0", unreleased: true }, { v: "1.12.1" }]));
  put("GUIDON files/CHANGELOG.md", LOG_1121(["v1.12.0 (prepared, not released): a", "v1.11.0 (prepared, not released): b"]));
  r = lint();
  check(r.failures.length === 0, "at 1.12.1 with 1.11.0 and 1.12.0 marked \"prepared, not released\" everything passes", "1.12.1 fixture fails: " + r.failures.join(" | "));
  r = broken("GUIDON files/CHANGELOG.md", () => LOG_1121(["v1.12.0: a", "v1.11.0 (prepared, not released): b"]));
  check(failsWith(r, /CHANGELOG line \d+ presents v1\.12\.0 as a release, but no v1\.12\.0 tag exists/), "after the bump, an unmarked CHANGELOG entry for a version that was never tagged FAILS (the tolerance has expired)");
  r = broken("GUIDON files/CHANGELOG.md", () => changelog(["v1.12.1: fix", "v1.12.0: a", "", "v1.10.1: first"]).replace("## 2026-01-01 - v1.12.0: a\n\nText.", "## 2026-01-01 - v1.12.0: a\n\nNever released - superseded by 1.12.1."));
  check(!failsWith(r, /v1\.12\.0/), "the mark may sit on the first line under the heading instead of in it");
  git("tag", "v1.10.0"); r = lint(); git("tag", "-d", "v1.10.0");
  check(failsWith(r, /v1\.10\.0 is a real, tagged release with no CHANGELOG entry/), "after the bump, a tagged release with no CHANGELOG entry FAILS");
  r = broken("GUIDON files/CHANGELOG.md", () => LOG_1121(["v1.12.0 (prepared, not released): a", "v1.11.0 (prepared, not released): b"]).replace("v1.10.1: first", "v1.10.1 (not released): first"));
  check(failsWith(r, /v1\.10\.1 is marked not released, but the tag v1\.10\.1 exists/), "marking a version that WAS tagged as not released fails too");
  r = broken("GUIDON files/CHANGELOG.md", () => changelog(["v1.12.0 (prepared, not released): a", "v1.11.0 (prepared, not released): b", "v1.10.1: first"]));
  check(failsWith(r, /newest versioned heading is v1\.12\.0 .* but package\.json is 1\.12\.1/), "a version bump with no CHANGELOG entry of its own fails");
  r = broken("GUIDON files/ROADMAP.md", (t) => t.replace("v1.12.1", "v1.12.0"));
  check(failsWith(r, /ROADMAP says the current version is v1\.12\.0/), "ROADMAP's \"Current version\" line has to move with the version");
  r = broken(NOTES, () => notesJson([{ v: "1.10.1" }, { v: "1.11.0" }, { v: "1.12.0", unreleased: true }, { v: "1.12.1" }]));
  check(failsWith(r, /What's New has an entry for 1\.11\.0, which was never tagged/), "a What's New entry for a never-tagged version must carry released: false");
  r = broken(NOTES, () => notesJson([{ v: "1.10.1", unreleased: true }, { v: "1.11.0", unreleased: true }, { v: "1.12.0", unreleased: true }, { v: "1.12.1" }]));
  check(failsWith(r, /What's New entry 1\.10\.1 is marked released: false, but the tag v1\.10\.1 exists/), "released: false on a version that was tagged is stale, and fails");
  r = broken(NOTES, () => notesJson([{ v: "1.10.1" }, { v: "1.11.0", unreleased: true }, { v: "1.12.0", unreleased: true }, { v: "1.12.1" }, { v: "1.13.0" }]));
  check(failsWith(r, /entry for 1\.13\.0, which was never tagged/), "an entry for a later, never-tagged number is read out of the data file too");
  // The current version has to have its own entry - the check lint-patterns (h) alone used to make.
  r = broken(NOTES, () => notesJson([{ v: "1.10.1" }, { v: "1.11.0", unreleased: true }, { v: "1.12.0", unreleased: true }]));
  check(failsWith(r, /^\(d\) What's New has no entry for the current version 1\.12\.1 \(package\.json\) - add one to guidon-app\/src\/data\/whats-new\.json/), "a version with no What's New entry of its own fails, and the message names the file to add it to");
  r = broken(NOTES, (t) => t.replace(/"highlights": \[[^\]]*\]/g, '"highlights": []'));
  check(failsWith(r, /^\(d\) guidon-app\/src\/data\/whats-new\.json entry \d+ \(1\.12\.1\): "highlights" must be a list with at least one line/), "an entry whose highlights are empty fails (a stub written to satisfy the check)");
  r = broken(NOTES, (t) => t.slice(0, -25));
  check(failsWith(r, /^\(d\) guidon-app\/src\/data\/whats-new\.json is not valid JSON/), "a data file that does not parse fails, naming it");
  { const keep = get(NOTES); unlinkSync(at(NOTES)); r = lint(); put(NOTES, keep); }
  check(failsWith(r, /^\(d\) guidon-app\/src\/data\/whats-new\.json is missing/), "a missing data file fails, naming it");

  console.log("\n4. The app never links to a download no release job uploads");
  r = broken("guidon-app/src/index.html", (t) => t.replace('x(dl("GUIDON-android.apk"));', 'x(dl("GUIDON-android.apk"));\n  x(dl("GUIDON-macos.dmg"));'));
  check(failsWith(r, /links to "GUIDON-macos\.dmg" but tools\/release-manifest\.mjs does not declare it/) && failsWith(r, /GUIDON-macos\.dmg, but no release workflow uploads/), "a new in-app download link with nothing behind it fails twice over (not required for Latest, and not uploaded)");
  r = broken(".github/workflows/release-assets.yml", (t) => t.split("release-out/GUIDON-android.apk").join("release-out/GUIDON-phone.apk"));
  check(failsWith(r, /GUIDON-android\.apk, but no release workflow uploads/), "removing the upload of a name the app links to fails (the v1.10.0 dead-link defect)");
  r = broken(".github/workflows/release-assets.yml", (t) => t.split("\n").map((l) => (/release-out\/GUIDON-windows-setup\.exe/.test(l) ? "          # " + l.trim() : l)).join("\n"));
  check(failsWith(r, /GUIDON-windows-setup\.exe, but no release workflow uploads/), "a name that only appears in a comment does not count as uploaded");

  console.log("\n5. --cut: the last check before a permanent tag");
  check(failsWith(lint({ cut: true }), /\.release-prep must contain v1\.12\.1/), "--cut without a .release-prep naming this version refuses");
  put("guidon-app/src/.release-prep", "v1.12.1\n");
  r = lint({ cut: true });
  check(r.failures.length === 0, "--cut passes when everything agrees and .release-prep names this version", "--cut fails on a clean fixture: " + r.failures.join(" | "));
  r = broken(NOTES, () => notesJson([{ v: "1.10.1" }, { v: "1.11.0", unreleased: true }, { v: "1.12.0", unreleased: true }, { v: "1.12.1", unreleased: true }]), { cut: true });
  check(failsWith(r, /entry for 1\.12\.1 is marked released: false/), "--cut refuses a version whose own notes say it is not released");
  r = broken("GUIDON files/CHANGELOG.md", (t) => t.replace("v1.12.1: fix", "v1.12.1 (prepared, not released): fix"), { cut: true });
  check(failsWith(r, /marks v1\.12\.1 as not released - a version being cut/), "--cut refuses a version whose own CHANGELOG entry says it is not released");
  git("add", "-A"); git("commit", "-q", "-m", "1.12.1"); git("tag", "v1.12.1", "HEAD~1");
  check(failsWith(lint({ cut: true }), /v1\.12\.1 is already tagged on [0-9a-f]{7}, not on this commit/), "--cut refuses when the tag already exists on a different commit (a tag is never moved)");
  git("tag", "-d", "v1.12.1"); git("tag", "v1.13.0");
  check(failsWith(lint(), /package\.json is 1\.12\.1 but v1\.13\.0 is already tagged/), "a version lower than the newest tag fails");
  git("tag", "-d", "v1.13.0");
  put("guidon-app/src/.release-trigger", "v1.11.0\n");
  check(failsWith(lint(), /\.release-trigger names v1\.11\.0, which is neither the current version nor a tagged release/), ".release-trigger may only name the current version or a real tag");
  unlinkSync(at("guidon-app/src/.release-trigger"));
  git("tag", "-d", "v1.10.1");
  r = lint();
  check(r.failures.length === 0 && r.notes.some((n) => /no version tags are visible/.test(n)), "a checkout with no tags (shallow CI clone) says plainly that the tag checks were NOT run, without failing");
  check(failsWith(lint({ cut: true }), /no version tags are visible/), "--cut never accepts \"could not check\": no visible tags is a refusal");
  git("tag", "v1.10.1", "HEAD~2");

  console.log("\n6. bump-version: every location, dry run by default");
  const hashes = () => FILES.map((f) => sha(at(f))).join();
  let before = hashes();
  let b = bump({ root, version: "1.13.0" });
  check(b.ok && !b.wrote && b.changes.length === 12 && hashes() === before, "a dry run lists all 12 changes and writes nothing", `dry run: ok=${b.ok} changes=${b.changes.length} unchanged=${hashes() === before}`);
  b = bump({ root, version: "1.13.0", write: true });
  const after = lint();
  check(b.wrote && !failsWith(after, /^\(a\)|^\(b\)/), "--write leaves every version value agreeing (lint (a) and (b) pass)", "after --write: " + after.failures.join(" | "));
  check(failsWith(after, /CHANGELOG's newest versioned heading/) && failsWith(after, /ROADMAP says/) && failsWith(after, /What's New has no entry for the current version 1\.13\.0/), "...and the lint then insists on the hand-written CHANGELOG, ROADMAP and What's New entries");
  check(b.lines.some((l) => /src\/data\/whats-new\.json/.test(l)) && !b.lines.some((l) => /99-release|release-note/.test(l)), "bump-version's \"still to write by hand\" list points at src/data/whats-new.json, not at a per-release script", "bump-version's hand-written list: " + JSON.stringify(b.lines.filter((l) => /What's New|whats-new|99-release/.test(l))));
  check(/versionCode 11300\b/.test(get("guidon-app/android/app/build.gradle")) && (get(pbx).match(/CURRENT_PROJECT_VERSION = 6;/g) || []).length === 2 && (get(pbx).match(/MARKETING_VERSION = 1\.13\.0;/g) || []).length === 2,
    "Android versionCode follows the formula (11300) and the iOS project's four values moved together (build 5 -> 6: one step per version change)");
  const lockDiff = spawnSync("git", ["-C", root, "diff", "--numstat", "--", "guidon-app/package-lock.json"], { encoding: "utf-8" }).stdout.trim().split(/\s+/);
  check(lockDiff[0] === "2" && lockDiff[1] === "2", "only the two version lines of package-lock.json changed - nothing else was reformatted");
  before = hashes();
  b = bump({ root, version: "1.13.0", write: true });
  check(b.ok && b.changes.length === 0 && hashes() === before, "running the same bump again changes nothing (the iOS build number is not raised twice)");
  check(!bump({ root, version: "1.12.9", write: true }).ok && hashes() === before, "a lower version is refused and nothing is written");
  git("tag", "v1.13.0");
  check(!bump({ root, version: "1.13.0", write: true }).ok, "a version that is already tagged is refused (a tagged number is never reused)");
  git("tag", "-d", "v1.13.0");
  check(!bump({ root, version: "1.100.0" }).ok && !bump({ root, version: "v1.14.0" }).ok && !bump({ root, version: "1.14" }).ok, "versions that do not fit x.y.z or the versionCode formula are refused");
  check(androidVersionCode("1.12.1") === 11201 && compareVersions("1.12.10", "1.12.2") > 0, "1.12.10 sorts after 1.12.2 (numbers, not text)");

  const realBefore = FILES.map((f) => sha(path.join(REAL_ROOT, f))).join();
  const dry = spawnSync(process.execPath, ["tools/bump-version.mjs", "9.9.9"], { encoding: "utf-8" });
  check(dry.status === 0 && /Dry run - nothing was written/.test(dry.stdout) && FILES.map((f) => sha(path.join(REAL_ROOT, f))).join() === realBefore, "against the REAL tree the CLI defaults to a dry run, and not one byte of any version file changed");
  const chk = spawnSync(process.execPath, ["tools/bump-version.mjs", "--check"], { encoding: "utf-8" });
  check(chk.status === 0 && /every value agrees/.test(chk.stdout), "bump-version --check agrees with the lint on the real tree");

  console.log("\n7. The What's New data file: shape, copy rules, the current-version rule and the build's inlining (tools/whats-new-rules.mjs - the one reader for the build, lint-patterns (h) and lint-release-state (d))");
  {
    const { parseWhatsNewText, toEntries, checkCopy, checkCurrent, newestVersion, lintWhatsNew, whatsNewLiteral, readWhatsNewFile, BANNED, MAX_HIGHLIGHT_CHARS, WHATS_NEW_ANCHOR } = await import("./whats-new-rules.mjs");
    const entry = (v, over = {}) => Object.assign({ version: v, date: "September 2026", title: "A plain title", highlights: ["Something a Soldier will notice."] }, over);
    // A data file as text. Its own $doc may say anything - it is never read as copy.
    const fileOf = (entries, extra = {}) => JSON.stringify(Object.assign({ $doc: { what: "a note may say engine, module and CI as often as it likes - and packaged from one tagged source" } }, extra, { entries }));
    const shape = (entries, extra) => parseWhatsNewText(fileOf(entries, extra), "F").problems;
    const copyOf = (entries) => checkCopy(toEntries(parseWhatsNewText(fileOf(entries)).raw));
    const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e && e.message)); } };

    // 7a. The entries exactly as they shipped to Soldiers before the rewrite, as planted data.
    const SHIPPED = [
      entry("1.10.1", { title: "Apple parity and release reliability", highlights: [
        "GUIDON now maintains a first-class iOS project that stays synced to the same app bundle and study experience as the web, Android, Windows, and macOS versions.",
        "macOS releases now include a universal Apple Silicon + Intel package built from the same tagged source as the other platforms.",
        "Apple-device verification now covers compact iPhone, standard iPhone, large iPhone, and iPad layouts with preserved render evidence and safer handling of transient Simulator failures.",
      ] }),
      entry("1.11.0", { released: false, title: "Board depth, OPSEC safeguards, and adaptive memorization", highlights: [
        "This release is packaged from one tagged source across web/PWA and standalone, Android, Windows, macOS, iOS parity verification, and the ESP32 flashcard fork.",
      ] }),
      entry("1.12.0", { title: "Leader readiness, team training, and PT planning", highlights: [
        "Team Training now includes a complete 10-exercise catalog and a shared Collective Decision mode that turns existing scenarios into discuss-then-commit group lanes without creating a second scenario engine.",
      ] }),
    ];
    const parsed = parseWhatsNewText(fileOf(SHIPPED));
    const shipped = toEntries(parsed.raw);
    check(parsed.problems.length === 0 && shipped.length === 3 && shipped[0].highlights.length === 3 && shipped[1].unreleased === true && shipped[2].unreleased === false && shipped[2].title === "Leader readiness, team training, and PT planning", "entries, titles, highlights and the released: false mark are read out of the data file", "shipped entries were not read back: " + JSON.stringify(parsed.problems));
    const problems = checkCopy(shipped);
    const hit = (v, word) => problems.some((p) => p.includes(`What's New ${v} `) && p.includes(`"${word}"`));
    check(hit("1.10.1", "parity") && hit("1.10.1", "first-class") && hit("1.10.1", "bundle") && hit("1.10.1", "tagged") && hit("1.10.1", "render evidence"), "the 1.10.1 entry as shipped fails: parity, first-class, bundle, tagged, render evidence", "1.10.1 as shipped was not rejected: " + problems.join(" | "));
    check(hit("1.11.0", "packaged") && hit("1.11.0", "PWA") && hit("1.11.0", "fork") && hit("1.11.0", "ESP32"), "the 1.11.0 \"packaged from one tagged source ... fork\" bullet fails");
    check(hit("1.12.0", "engine"), "the 1.12.0 \"second scenario engine\" bullet fails");
    check(!problems.some((p) => /a note may/.test(p)) && problems.every((p) => !/"module"|"CI"/.test(p)), "the file's own $doc is never read as copy (it may explain itself)");
    check(copyOf([entry("2.0.0", { title: "New: Board Simulator", highlights: ["New: Board Simulator. Practice reporting in, then answer board questions."] })]).length === 0, "\"Board Simulator\" is a feature name and passes; plain wording passes");

    // 7b. Every banned word has a planted defect, in a title AND in a highlight. A new rule without a sample here fails the suite.
    const SAMPLES = ["engine", "taxonomy", "canonical", "persistent", "deterministic", "unauthored", "parity", "fork", "regression", "module", "shim", "SRS", "re-render", "PR 123", "#123", "codebase", "refactor", "API", "CI", "workflow", "pipeline", "schema", "bundle", "binary", "render evidence", "first-class", "iOS Simulator", "Simulator failures", "MOI-aware", "offline progression", "Capacitor", "Tauri", "WebView", "IndexedDB", "PWA", "standalone", "ESP32", "packaged", "tagged", "across all", "release lane", "verification"];
    check(SAMPLES.length === BANNED.length, `every one of the ${BANNED.length} banned patterns has a planted-defect sample`, `BANNED has ${BANNED.length} patterns but the suite plants ${SAMPLES.length} - add a sample for each new rule (in the same order)`);
    const escaped = [];
    BANNED.forEach(([re], i) => {
      const s = SAMPLES[i];
      const m = s && re.exec(s);
      if (!m) { escaped.push(`#${i} ${re} does not even match its own sample ${JSON.stringify(s)}`); return; }
      const inHighlight = copyOf([entry("2.0.0", { highlights: [`You can now use the ${s} here.`] })]);
      const inTitle = copyOf([entry("2.0.0", { title: `The ${s} update` })]);
      if (!inHighlight.some((p) => /highlight 1/.test(p) && p.includes(`says "${m[0]}"`))) escaped.push(`${re} planted in a highlight`);
      if (!inTitle.some((p) => /title/.test(p) && p.includes(`says "${m[0]}"`))) escaped.push(`${re} planted in a title`);
    });
    check(escaped.length === 0, "every banned word or phrase planted in a title and in a highlight is caught", "not caught: " + escaped.join("; "));

    // 7c. Length cap, duplicates, version numbers.
    check(copyOf([entry("2.0.0", { highlights: ["word ".repeat(60).trim()] })]).some((p) => p.includes(`max ${MAX_HIGHLIGHT_CHARS}`)), "a highlight that runs on past the length cap fails");
    check(copyOf([entry("2.0.0", { highlights: ["x".repeat(MAX_HIGHLIGHT_CHARS)] })]).length === 0, "a highlight exactly at the cap passes");
    check(copyOf([entry("1.9.0", { highlights: ["word ".repeat(60).trim()] })]).length === 0, "entries older than the cap's start were already shown and are left as written");
    check(copyOf([entry("2.0.0", { title: "a" }), entry("2.0.0", { title: "b" })]).some((p) => /two entries for 2\.0\.0/.test(p)), "two entries for one version fail");
    const vn = copyOf([entry("2.0.0", { title: "Version 1.2.3 is here", highlights: ["Fixed in v1.16.0: the timer.", "See ATP 4-02.11, DA Form 2166-9-2 and AR 600-8-22 for the rules."] })]);
    check(vn.length === 2 && vn.some((p) => /title names a version number \("1\.2\.3"\)/.test(p)) && vn.some((p) => /highlight 1 names a version number \("v1\.16\.0"\)/.test(p)), "a version number in a title or highlight fails (the panel says what changed, never which release); document numbers do not", "version-number rule: " + JSON.stringify(vn));

    // 7d. Shape: every way the file can be malformed is refused, naming the entry.
    check(shape([entry("1.0.0")]).length === 0, "a well-formed file has no shape problems");
    const SHAPE = [
      ["not JSON", () => parseWhatsNewText("{ entries: [", "F").problems, /F is not valid JSON/],
      ["a bare list", () => parseWhatsNewText("[]", "F").problems, /F must be an object/],
      ["no entries list", () => parseWhatsNewText('{"$doc":{}}', "F").problems, /F needs an "entries" list/],
      ["an empty entries list", () => shape([]), /F has no entries/],
      ["an unknown top-level key", () => shape([entry("1.0.0")], { notes: 1 }), /unknown top-level key "notes"/],
      ["an unknown entry field", () => shape([entry("1.0.0", { note: "x" })]), /entry 1 \(1\.0\.0\) has an unknown field "note"/],
      ["a version without a patch", () => shape([entry("1.16")]), /"version" must be x\.y\.z/],
      ["a v-prefixed version", () => shape([entry("v1.16.0")]), /"version" must be x\.y\.z/],
      ["a numeric version", () => shape([entry(1.16)]), /"version" must be x\.y\.z/],
      ["a missing date", () => shape([entry("1.0.0", { date: undefined })]), /"date" must be text/],
      ["a blank title", () => shape([entry("1.0.0", { title: "  " })]), /"title" must be text/],
      ["released: true", () => shape([entry("1.0.0", { released: true })]), /"released" may only be false/],
      ["released: \"false\" (text)", () => shape([entry("1.0.0", { released: "false" })]), /"released" may only be false/],
      ["no highlights", () => shape([entry("1.0.0", { highlights: [] })]), /"highlights" must be a list with at least one line/],
      ["highlights that are not a list", () => shape([entry("1.0.0", { highlights: "one line" })]), /"highlights" must be a list/],
      ["a blank highlight", () => shape([entry("1.0.0", { highlights: ["ok", " "] })]), /highlight 2 must be non-empty text/],
      ["a highlight that is not text", () => shape([entry("1.0.0", { highlights: [5] })]), /highlight 1 must be non-empty text/],
      ["an entry that is not an object", () => shape(["1.0.0"]), /entry 1 must be an object/],
    ];
    for (const [label, run, re] of SHAPE) { const got = run(); check(got.some((p) => re.test(p)), `planted defect "${label}" is refused`, `planted defect "${label}" was not reported as ${re}: ${JSON.stringify(got)}`); }
    check(shape([entry("1.0.0", { released: false })]).length === 0, "released: false is the one allowed mark");

    // 7e. "The current version must have an entry" - by VERSION, wherever the entry sits.
    const es = toEntries([entry("1.16.0"), entry("1.15.0")]);
    check(checkCurrent(es, "1.16.0").length === 0 && checkCurrent(es, "1.15.0").length === 0, "the current version's entry is found by version, not by position");
    const miss = checkCurrent(es, "1.17.0");
    check(miss.length === 1 && /no entry for the current version 1\.17\.0 \(package\.json\) - add one to guidon-app\/src\/data\/whats-new\.json/.test(miss[0]) && /newest entry there is 1\.16\.0/.test(miss[0]), "a missing current-version entry fails clearly: names the version, the file to add it to and the newest entry there", "missing-entry message: " + JSON.stringify(miss));
    check(checkCurrent(toEntries([{ version: "1.17.0", highlights: [] }]), "1.17.0").some((p) => /has no highlights/.test(p)), "a current-version entry with no highlights fails");
    check(newestVersion(toEntries([entry("1.12.2"), entry("1.12.10"), entry("1.9.0")])) === "1.12.10", "\"newest\" compares numbers, not text (1.12.10 beats 1.12.2)");

    // 7f. lint-patterns check (h) itself (the same function it calls), with one defect planted in each input.
    const HTML = indexHtml();
    const DATA = fileOf([entry("1.16.0")]);
    const lw = (over) => lintWhatsNew(Object.assign({ html: HTML, dataText: DATA, version: "1.16.0" }, over));
    check(lw().problems.length === 0 && lw().passes.length === 2, "(h) passes a well-formed setup: placeholder in index.html, a data file, an entry for the current version", "(h) on a clean setup: " + JSON.stringify(lw()));
    check(lw({ html: HTML.replace(WHATS_NEW_ANCHOR, 'RELEASE_NOTES: [ { version: "1.16.0", date: "x", title: "t", highlights: ["h"] } ],') }).problems.some((p) => /is not the placeholder/.test(p)), "(h) fails when an entry is typed into src/index.html instead of the data file");
    check(lw({ html: HTML + HTML }).problems.some((p) => /is not the placeholder/.test(p)), "(h) fails when the placeholder appears twice");
    check(lw({ html: "<script>G.other = {};</script>" }).problems.some((p) => /could not locate G\.whatsNew\.RELEASE_NOTES/.test(p)), "(h) fails when G.whatsNew.RELEASE_NOTES cannot be found");
    check(lw({ dataText: null }).problems.some((p) => /whats-new\.json is missing/.test(p)), "(h) fails when the data file is missing");
    check(lw({ dataText: "{" }).problems.some((p) => /is not valid JSON/.test(p)), "(h) fails when the data file is not valid JSON");
    check(lw({ dataText: fileOf([entry("1.16.0", { note: "x" })]) }).problems.some((p) => /unknown field "note"/.test(p)), "(h) fails on a malformed entry");
    check(lw({ dataText: fileOf([entry("1.16.0", { highlights: ["The new engine is here."] })]) }).problems.some((p) => /1\.16\.0 highlight 1 says "engine"/.test(p)), "(h) fails on builder's wording in the data file");
    check(lw({ dataText: fileOf([entry("1.16.0", { highlights: ["word ".repeat(60).trim()] })]) }).problems.some((p) => p.includes(`max ${MAX_HIGHLIGHT_CHARS}`)), "(h) fails on a highlight over the length cap");
    check(lw({ dataText: fileOf([entry("1.16.0", { title: "Version 1.16.0" })]) }).problems.some((p) => /names a version number/.test(p)), "(h) fails on a version number in the copy");
    check(lw({ version: "1.17.0" }).problems.some((p) => /no entry for the current version 1\.17\.0/.test(p)), "(h) fails when package.json's version has no entry");
    check(lw({ dataText: fileOf([entry("1.16.0"), entry("1.16.0")]) }).problems.some((p) => /two entries for 1\.16\.0/.test(p)), "(h) fails on two entries for one version");

    // 7g. What the build pastes into the page.
    const nasty = [entry("1.0.0", { highlights: ["</script><!-- x --> and a line separator: " + String.fromCharCode(0x2028) + " and " + String.fromCharCode(0x2029) + " end", "a \" quote, a \\ backslash, an 'apostrophe' and an em dash " + String.fromCharCode(0x2014)] })];
    const lit = whatsNewLiteral(nasty);
    check(!lit.includes("</") && !lit.includes("<!--") && !lit.includes(String.fromCharCode(0x2028)) && !lit.includes(String.fromCharCode(0x2029)), "the literal the build pastes into the page can never close the page's own <script> or break a script line");
    check(JSON.stringify(new Function("return " + lit)()) === JSON.stringify(nasty), "...and read back as script it gives exactly the entries (same fields, same order, same text)");
    const { injectWhatsNew } = await import("./build.mjs");
    const goodFile = path.join(scratch, "wn-good.json"), badFile = path.join(scratch, "wn-bad.json");
    writeFileSync(goodFile, fileOf([entry("1.16.0"), entry("1.11.0", { released: false })]));
    writeFileSync(badFile, fileOf([entry("1.16.0", { bogus: 1 })]));
    const inj = injectWhatsNew(HTML, goodFile);
    check(inj.count === 2 && !inj.html.includes(WHATS_NEW_ANCHOR) && inj.html.includes("RELEASE_NOTES: " + whatsNewLiteral([entry("1.16.0"), entry("1.11.0", { released: false })]) + ","), "the build's injectWhatsNew() replaces the placeholder with exactly the file's entries");
    check(throwsWith(() => injectWhatsNew(HTML.replace(WHATS_NEW_ANCHOR, "RELEASE_NOTES: [],"), goodFile), /matched 0 times/), "the build refuses when the placeholder is missing from src/index.html (never a silent empty list)");
    check(throwsWith(() => injectWhatsNew(HTML + HTML, goodFile), /matched 2 times/), "the build refuses when the placeholder appears twice");
    check(throwsWith(() => injectWhatsNew(HTML, badFile), /wn-bad\.json has 1 problem\(s\)[\s\S]*unknown field "bogus"/), "the build refuses a malformed data file, naming the file and the problem");
    check(throwsWith(() => injectWhatsNew(HTML, path.join(scratch, "nope.json")), /nope\.json is missing/), "the build refuses a missing data file");
    const outStamp = (p) => (existsSync(p) ? readFileSync(p, "utf8").length : -1);
    const outsBefore = [outStamp("web/index.html"), outStamp("dist/guidon-standalone.html")];
    const badBuild = spawnSync(process.execPath, ["tools/build.mjs"], { encoding: "utf8", env: { ...process.env, GUIDON_WHATS_NEW_FILE: badFile } });
    check(badBuild.status === 1 && /unknown field "bogus"/.test(badBuild.stderr + badBuild.stdout) && !/build ok/.test(badBuild.stdout), "the REAL build fails, naming the problem, on a malformed What's New file", `real build with a malformed What's New file: exit ${badBuild.status}, output ${JSON.stringify((badBuild.stderr + badBuild.stdout).slice(0, 300))}`);
    const goodBuild = spawnSync(process.execPath, ["tools/build.mjs"], { encoding: "utf8", env: { ...process.env, GUIDON_WHATS_NEW_FILE: goodFile } });
    check(goodBuild.status === 0 && /NOTHING WAS BUILT/.test(goodBuild.stdout) && !/build ok/.test(goodBuild.stdout) && JSON.stringify(outsBefore) === JSON.stringify([outStamp("web/index.html"), outStamp("dist/guidon-standalone.html")]), "pointed at a valid stand-in file the real build only checks it, says nothing was built and touches neither web/ nor dist/ - GUIDON_WHATS_NEW_FILE cannot change what ships", `real build with a valid stand-in: exit ${goodBuild.status}, output ${JSON.stringify((goodBuild.stderr + goodBuild.stdout).slice(0, 300))}`);

    // 7h. The real file, and the real lint.
    const real = readWhatsNewFile();
    check(real.problems.length === 0 && real.entries.length >= 22, `the real data file is well formed (${real.entries.length} entries)`, "the real data file: " + JSON.stringify(real.problems));
    check(["1.11.0", "1.12.0"].every((v) => real.entries.some((e) => e.version === v && e.unreleased)), "the real file keeps released: false on 1.11.0 and 1.12.0 (prepared, never cut)");
    check(checkCopy(real.entries).length === 0, "every real entry passes the copy rules", "real entries fail: " + checkCopy(real.entries).join(" | "));
    const lintH = spawnSync(process.execPath, ["tools/lint-patterns.mjs"], { encoding: "utf-8" });
    check(/PASS {2}\(h\) all \d+ What's New entries are in plain language/.test(lintH.stdout), "the real What's New entries pass the same rules through lint-patterns check (h)", "lint-patterns (h) does not report the plain-language scan:\n" + (lintH.stdout.match(/.*\(h\).*/g) || []).join("\n"));
  }

  {
    // lintPublishedAssets() (release fan-out fix, 2026-09-23): the one
    // function in this file that makes a real network call (`gh release
    // view`). Its own input-validation paths are fully offline/
    // deterministic and covered here; the real network path (does a real
    // tag's real Release actually carry every required asset) is a
    // deliberate manual-verification tool, not a CI-time check - its own
    // module header says so - so it is exercised by hand against a real
    // tag, not mocked here.
    const { lintPublishedAssets } = await import("./lint-release-state.mjs");
    const bad1 = lintPublishedAssets({ tag: "not-a-tag", repo: "o/r" });
    check(bad1.failures.length === 1 && /not a vX\.Y\.Z tag/.test(bad1.failures[0]), "lintPublishedAssets rejects a non-vX.Y.Z tag without ever calling gh");
    const bad2 = lintPublishedAssets({ tag: "v1.2.3", repo: null });
    check(bad2.failures.length === 1 && /--repo owner\/name is required/.test(bad2.failures[0]), "lintPublishedAssets refuses a missing --repo without ever calling gh");
    const cliBad = spawnSync(process.execPath, ["tools/lint-release-state.mjs", "--published", "not-a-tag"], { encoding: "utf-8" });
    check(cliBad.status === 1 && /not a vX\.Y\.Z tag/.test(cliBad.stdout), "the --published CLI flag itself exits 1 and names the same problem, not just the exported function");
  }
} catch (e) {
  bad("suite crashed: " + (e && e.stack ? e.stack : e));
} finally {
  try { rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
}

console.log("\n" + (fails ? `RELEASE-STATE TEST: ${fails} FAILURE(S)` : "RELEASE-STATE TEST: all passed"));
process.exit(fails ? 1 : 0);
