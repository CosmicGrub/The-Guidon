/**
 * Release-state lint: one gate for "every file agrees on the version" and
 * "nothing claims a release that never happened".
 *
 * WHY THIS EXISTS. Between v1.9.0 and today:
 *   - v1.9.0 and v1.10.0 were tagged with package-lock.json still at 1.7.0;
 *   - 1.10.1, 1.11.0 and 1.12.0 were version-bumped one after another while
 *     the CHANGELOG and the in-app notes described each as a finished,
 *     tagged, every-platform release - two of them were never cut at all;
 *   - v1.10.0 WAS cut, and has no CHANGELOG entry;
 *   - both download buttons on the in-app #/share page pointed at file names
 *     no release job uploaded.
 * Each of those is a plain-text fact a script can check in well under a
 * second, so now one does.
 *
 * WHAT IT CHECKS
 *   (a) every version anchor in tools/release-version-files.mjs agrees with
 *       package.json; Android's versionCode follows the formula; the iOS
 *       project has exactly two of each value and they match.
 *   (b) against the newest version TAG: the version never goes backwards,
 *       and once it moves past the tag, Android's versionCode and the iOS
 *       build number are strictly higher than they were at that tag (an
 *       equal or lower number cannot be installed over the released app).
 *   (c) ROADMAP's "Current version" line names the current version.
 *       CHANGELOG: the newest versioned heading is the current version; every
 *       other versioned heading has a tag, or says in the heading (or the
 *       first line under it) that it was "prepared, not released"; every tag
 *       has a heading.
 *   (d) What's New (guidon-app/src/data/whats-new.json - one object per
 *       release, read as JSON by tools/whats-new-rules.mjs, the same reader
 *       the build and lint-patterns check (h) use): the file exists and is
 *       well formed; the CURRENT version has an entry with at least one
 *       highlight (a missing one fails naming the file to add it to - it used
 *       to be enforced only by lint-patterns, and never here); every other
 *       entry has a tag or carries `released: false`; a `released: false`
 *       entry whose tag DOES exist is stale and fails too.
 *   (e) .release-prep / .release-trigger, when present, name a real version
 *       no newer than package.json.
 *   (f) every file name the app's #/share page links to is declared in
 *       tools/release-manifest.mjs and uploaded by a release workflow. The
 *       Mac fixed-name file is an OPTIONAL alias: the app may link to it only
 *       behind the literal MAC_DIRECT_LINK switch (default false: the button
 *       stays on the releases list, which can never be a dead link), and the
 *       Mac lane must provably be unable to decide Latest - release-apple.yml
 *       never touches the Latest flag and no other release job waits on an
 *       Apple job (see release-manifest.mjs's header for the decision).
 *   --cut (release-cut.yml, just before tagging): tags MUST be visible,
 *       .release-prep must name exactly this version, the version must be
 *       newer than every tag, its notes must not be marked unreleased, and
 *       the tag must not already exist on a different commit.
 *   --published <tag> --repo <owner/name>: everything above only checks
 *       facts already sitting in the checkout - it never noticed that
 *       v1.15.0/.3/.4 were published with ZERO assets attached (the
 *       fan-out that was supposed to build them never ran; see
 *       release-cut.yml's own fan-out note). This asks GitHub directly
 *       what a tag's real Release carries, via `gh`, and fails if any
 *       required asset (tools/release-manifest.mjs's own expectedAssets())
 *       is missing. Exported as lintPublishedAssets(); lintReleaseState()
 *       never calls it, so every other caller (--cut, ci.yml,
 *       test-release-state.mjs) is unaffected.
 *
 * Tags come from `git tag`. A shallow CI checkout has none; then (b)-(d)'s
 * tag comparisons are reported as not checked instead of guessed (ci.yml
 * fetches the version tags before lint so they ARE checked there). --cut
 * never accepts "not checked".
 *
 * Usage: node tools/lint-release-state.mjs [--cut] [--root <repo root>]
 * (from guidon-app/, or anywhere - paths resolve from this file). No
 * network, EXCEPT --published <tag> --repo <owner/name>, which is the one
 * deliberate exception (see above) and requires an authenticated `gh`.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readAnchors, parseVersion, compareVersions, androidVersionCode } from "./release-version-files.mjs";
import { ALIASES, OPTIONAL_ALIASES, expectedAssets, verdict } from "./release-manifest.mjs";
import { readWhatsNewFile, checkCurrent, WHATS_NEW_REPO_PATH } from "./whats-new-rules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOT_RELEASED = /\b(prepared,?\s+(?:but\s+)?not\s+released|not\s+released|never\s+released|unreleased)\b/i;

/**
 * TRANSITION, self-expiring. When this lint landed, the CHANGELOG (a shared
 * file this change was not allowed to edit) still had the two problems
 * below. They are tolerated ONLY while package.json is still exactly
 * 1.12.0: the next version bump - which has to edit the CHANGELOG anyway -
 * must fix both, and from then on this table does nothing. Do not add rows.
 */
const KNOWN_DEBT_WHILE_AT = "1.12.0";
const KNOWN_DEBT = new Set(["changelog-unmarked:1.11.0", "changelog-missing-tag-entry:1.10.0"]);

export function lintReleaseState({ root, cut = false }) {
  const passes = [], failures = [], notes = [];
  const ok = (m) => passes.push(m), bad = (m) => failures.push(m), note = (m) => notes.push(m);
  const read = (rel) => { try { return readFileSync(path.join(root, rel), "utf-8"); } catch (e) { return null; } };
  const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf-8" });

  /* ---- (a) version agreement ---------------------------------------- */
  let V = null;
  try { V = JSON.parse(read("guidon-app/package.json")).version; } catch (e) { V = null; }
  if (!parseVersion(V)) { bad(`(a) guidon-app/package.json has no x.y.z version (found ${JSON.stringify(V)})`); return { passes, failures, notes, version: V }; }
  const anchors = readAnchors(root);
  let agree = 0, iosBuild = null;
  for (const a of anchors) {
    if (a.missingFile) { if (!a.optional) bad(`(a) ${a.file} is missing - it carries "${a.id}"`); continue; }
    if (!a.optional && a.found.length !== a.expectedCount) { bad(`(a) ${a.file}: expected ${a.expectedCount} "${a.id}" value(s), found ${a.found.length}`); continue; }
    for (const f of a.found) {
      if (a.kind === "version") { if (f.value === V) agree++; else bad(`(a) ${a.file}:${f.line}: ${a.id} is "${f.value}" but package.json is "${V}" - run: node tools/bump-version.mjs ${V} --write`); }
      if (a.kind === "code") { const want = String(androidVersionCode(V)); if (f.value === want) agree++; else bad(`(a) ${a.file}:${f.line}: Android versionCode is ${f.value}, but ${V} must be ${want} (major*10000 + minor*100 + patch)`); }
    }
    if (a.kind === "build") {
      const values = [...new Set(a.found.map((f) => f.value))];
      if (values.length !== 1 || !/^\d+$/.test(values[0])) bad(`(a) ${a.file}: the iOS build numbers must be one whole number used in both places (found ${a.found.map((f) => `${f.value} @ line ${f.line}`).join(", ")})`);
      else { iosBuild = Number(values[0]); agree += a.found.length; }
    }
  }
  if (!failures.length) ok(`(a) all ${agree} version values across ${new Set(anchors.filter((a) => !a.missingFile).map((a) => a.file)).size} files agree on ${V} (Android versionCode ${androidVersionCode(V)}, iOS build ${iosBuild})`);

  /* ---- tags ----------------------------------------------------------- */
  const tagRes = git("tag", "--list", "v*");
  const tags = tagRes.status === 0 ? tagRes.stdout.split(/\r?\n/).map((t) => t.trim()).filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).map((t) => t.slice(1)).sort(compareVersions) : [];
  const tagged = new Set(tags);
  const newest = tags.length ? tags[tags.length - 1] : null;
  const debtOn = V === KNOWN_DEBT_WHILE_AT;
  const tolerated = (key, msg) => { if (debtOn && KNOWN_DEBT.has(key)) { note(`KNOWN, must be fixed by the next version bump: ${msg}`); return true; } return false; };
  if (!tags.length) {
    if (cut) bad("--cut: no version tags are visible in this checkout (it needs fetch-depth: 0) - refusing to judge a release without them");
    else note("no version tags are visible in this checkout (a shallow clone?) - the tag comparisons in (b), (c) and (d) were NOT checked here");
  }

  /* ---- (b) never backwards, installable over the last release --------- */
  if (newest) {
    const cmp = compareVersions(V, newest);
    if (cmp < 0) bad(`(b) package.json is ${V} but v${newest} is already tagged - a version never goes backwards`);
    else if (cmp === 0) ok(`(b) ${V} is the newest tagged release`);
    else {
      const at = (rel) => { const r = git("show", `v${newest}:${rel}`); return r.status === 0 ? r.stdout : null; };
      const gradleAt = at("guidon-app/android/app/build.gradle"), pbxAt = at("guidon-app/ios/App/App.xcodeproj/project.pbxproj");
      const codeAt = gradleAt && (gradleAt.match(/^\s*versionCode\s+(\d+)/m) || [])[1];
      const buildsAt = pbxAt ? [...pbxAt.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1])) : [];
      let fine = true;
      if (codeAt && !(androidVersionCode(V) > Number(codeAt))) { fine = false; bad(`(b) Android versionCode ${androidVersionCode(V)} is not higher than v${newest}'s ${codeAt} - this build could not be installed over the released app`); }
      if (buildsAt.length && iosBuild != null && !(iosBuild > Math.max(...buildsAt))) { fine = false; bad(`(b) the iOS build number ${iosBuild} is not higher than v${newest}'s ${Math.max(...buildsAt)} - raise CURRENT_PROJECT_VERSION in both places`); }
      if (fine) ok(`(b) ${V} is ahead of the newest tag v${newest}; Android versionCode${buildsAt.length ? " and the iOS build number are" : " is"} strictly higher than at that tag`);
    }
  }

  /* ---- (c) CHANGELOG -------------------------------------------------- */
  const changelog = read("GUIDON files/CHANGELOG.md");
  if (changelog == null) bad('(c) "GUIDON files/CHANGELOG.md" is missing');
  else {
    const lines = changelog.split(/\r?\n/);
    const heads = [];
    lines.forEach((l, i) => { const m = /^##\s.*?\bv(\d+\.\d+\.\d+)\b/.exec(l); if (m) heads.push({ version: m[1], line: i + 1, marked: NOT_RELEASED.test(l) || NOT_RELEASED.test(lines.slice(i + 1).find((x) => x.trim()) || "") }); });
    if (!heads.length) bad("(c) CHANGELOG has no versioned '## ... vX.Y.Z' heading at all");
    else {
      const before = failures.length;
      const top = heads.slice().sort((x, y) => compareVersions(y.version, x.version))[0];
      if (top.version !== V) bad(`(c) CHANGELOG's newest versioned heading is v${top.version} (line ${top.line}) but package.json is ${V} - add the ${V} entry`);
      const own = heads.find((h) => h.version === V);
      if (cut && own && own.marked) bad(`(c) --cut: CHANGELOG line ${own.line} marks v${V} as not released - a version being cut cannot be marked unreleased`);
      if (tags.length) {
        for (const h of heads) {
          if (h.version === V) continue;
          // Version tags only began at the oldest tag; headings from before
          // that practice existed are history, not claims this can judge.
          if (compareVersions(h.version, tags[0]) < 0) continue;
          if (tagged.has(h.version) && h.marked) bad(`(c) CHANGELOG line ${h.line}: v${h.version} is marked not released, but the tag v${h.version} exists - remove the mark`);
          if (!tagged.has(h.version) && !h.marked && !tolerated(`changelog-unmarked:${h.version}`, `CHANGELOG line ${h.line} presents v${h.version} as a release, but no v${h.version} tag exists`))
            bad(`(c) CHANGELOG line ${h.line} presents v${h.version} as a release, but no v${h.version} tag exists - if it was never cut, say so in the heading: "v${h.version} (prepared, not released)"`);
        }
        const headed = new Set(heads.map((h) => h.version));
        for (const t of tags) {
          if (!headed.has(t) && !tolerated(`changelog-missing-tag-entry:${t}`, `v${t} is tagged but has no CHANGELOG entry`)) bad(`(c) v${t} is a real, tagged release with no CHANGELOG entry - add a truthful one`);
        }
      }
      if (failures.length === before) ok(`(c) CHANGELOG: newest heading is v${V}; ${heads.length} versioned headings${tags.length ? ` checked against ${tags.length} tags` : " (tags not visible - release claims NOT checked)"}`);
    }
  }

  /* ---- (c2) ROADMAP's "Current version" line --------------------------- */
  {
    const roadmap = read("GUIDON files/ROADMAP.md");
    const m = roadmap == null ? null : /\*\*Current version:\*\*\s*v(\d+\.\d+\.\d+)/.exec(roadmap);
    if (!m) bad('(c) "GUIDON files/ROADMAP.md" has no "**Current version:** vX.Y.Z" line');
    else if (m[1] !== V) bad(`(c) ROADMAP says the current version is v${m[1]} but package.json is ${V}`);
    else ok(`(c) ROADMAP's "Current version" line says v${V}`);
  }

  /* ---- (d) What's New ------------------------------------------------- */
  {
    // The same reader the build and lint-patterns check (h) use: the file is
    // parsed as JSON, never scraped out of source text, so a word in a note
    // that MENTIONS `released: false` can never be mistaken for the mark.
    const wn = readWhatsNewFile(path.join(root, WHATS_NEW_REPO_PATH), WHATS_NEW_REPO_PATH);
    if (wn.problems.length) for (const p of wn.problems) bad(`(d) ${p}`);
    else {
      const entries = wn.entries;
      const before = failures.length;
      // The current version has to have its own entry, with something to say.
      for (const p of checkCurrent(entries, V, WHATS_NEW_REPO_PATH)) bad(`(d) ${p}`);
      const mine = entries.find((e) => e.version === V);
      if (cut && mine && mine.unreleased) bad(`(d) --cut: the What's New entry for ${V} is marked released: false - a version being cut cannot be marked unreleased`);
      if (tags.length) {
        for (const e of entries) {
          if (tagged.has(e.version) && e.unreleased) bad(`(d) What's New entry ${e.version} is marked released: false, but the tag v${e.version} exists - remove the mark`);
          if (!tagged.has(e.version) && !e.unreleased && e.version !== V) bad(`(d) What's New has an entry for ${e.version}, which was never tagged - mark it \`released: false\` (it still shows its highlights to anyone who skipped past it)`);
        }
      }
      if (failures.length === before) ok(`(d) What's New: ${entries.length} entries, and one for the current version ${V}; ${entries.filter((e) => e.unreleased).length} marked released: false${tags.length ? ", every other one has a tag or is the current version" : " (tags not visible - NOT checked against tags)"}`);
    }
  }
  const html = read("guidon-app/src/index.html");
  if (html == null) bad("(f) guidon-app/src/index.html is missing - it carries the #/share download links");
  else {
    /* ---- (f) in-app download names ------------------------------------ */
    const linked = [...new Set([...html.matchAll(/\bdl\("([^"]+)"\)/g)].map((m) => m[1]))];
    const declared = new Set(Object.values(ALIASES));
    const optional = new Set(Object.values(OPTIONAL_ALIASES));
    const wfDir = path.join(root, ".github/workflows");
    const wfNames = existsSync(wfDir) ? readdirSync(wfDir).filter((n) => /^release-.*\.ya?ml$/.test(n)).sort() : [];
    // Only lines that are not comments count as "uploads it" (or "waits on it").
    const codeOf = (n) => readFileSync(path.join(wfDir, n), "utf-8").split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
    const wfCode = wfNames.map(codeOf).join("\n");
    const before = failures.length;
    if (!linked.length) bad('(f) could not find the dl("...") download links in the #/share view');
    for (const name of linked) {
      if (!declared.has(name) && !optional.has(name)) bad(`(f) the app links to "${name}" but tools/release-manifest.mjs does not declare it - a release could be marked Latest without it`);
      if (!wfCode.includes("release-out/" + name)) bad(`(f) the app links to releases/latest/download/${name}, but no release workflow uploads a file with that name - that button would be a dead link`);
    }
    for (const name of declared) if (!linked.includes(name)) bad(`(f) tools/release-manifest.mjs requires "${name}" but the app no longer links to it - remove it from ALIASES or restore the link`);
    if (failures.length === before) ok(`(f) every download name the app links to (${linked.join(", ")}) is declared by release-manifest.mjs and uploaded by a release workflow`);

    // The optional (Mac) fixed-name file. A direct link to it is only honest
    // behind the MAC_DIRECT_LINK switch, and the lane that builds it must not
    // be able to decide whether a release becomes Latest.
    const macLinked = linked.filter((n) => optional.has(n));
    const beforeMac = failures.length;
    for (const a of expectedAssets("0.0.1").filter((x) => optional.has(x.name))) {
      if (a.required) bad(`(f) ${a.name} is declared optional (OPTIONAL_ALIASES) but expectedAssets() requires it - the Apple lane could hold a release out of Latest`);
    }
    const appleFile = wfNames.find((n) => /^release-apple\.ya?ml$/.test(n));
    if (appleFile) {
      if (/--latest\b/.test(codeOf(appleFile))) bad("(f) release-apple.yml touches the Latest flag - the Mac lane must never decide whether a release is Latest");
      for (const n of wfNames.filter((x) => x !== appleFile)) {
        const waits = [...codeOf(n).matchAll(/^\s*needs:\s*(\[[^\]]*\]|\S+)/gm)].map((m) => m[1]).filter((x) => /\b(macos|ios|apple)\b/i.test(x));
        if (waits.length) bad(`(f) ${n} waits on an Apple job (${waits.join("; ")}) - a slow or failed Mac build could hold a release out of Latest`);
      }
    }
    if (macLinked.length) {
      const sw = /\bconst\s+MAC_DIRECT_LINK\s*=\s*(true|false)\s*;/.exec(html);
      if (!sw) bad("(f) the app links to the Mac fixed-name file but has no literal `const MAC_DIRECT_LINK = true|false;` switch - a Latest release whose Mac build failed would leave a dead direct link with no way to turn it off");
      else if (sw[1] === "true") note(`(f) MAC_DIRECT_LINK is ON: the #/share Mac button downloads ${macLinked.join(", ")} straight from the Latest release, so it is a dead link for any Latest release whose Apple lane did not finish. Check a release with: node tools/lint-release-state.mjs --published <tag> --repo <owner/name>`);
      else note("(f) MAC_DIRECT_LINK is off (the default): the Mac button stays on the releases list, which can never be a dead link, until the owner switches the direct link on - see docs/release-runbook.md");
    }
    if (failures.length === beforeMac) ok("(f) the Mac lane cannot decide Latest: its fixed-name file is optional in the manifest, release-apple.yml never touches the Latest flag, and no other release job waits on an Apple job");
  }

  /* ---- (e) release marker files ---------------------------------------- */
  {
    const before = failures.length;
    const seen = [];
    for (const rel of ["guidon-app/src/.release-prep", "guidon-app/src/.release-trigger"]) {
      const raw = read(rel);
      if (raw == null) continue;
      const val = raw.trim();
      seen.push(`${path.basename(rel)}=${val}`);
      if (!/^v\d+\.\d+\.\d+$/.test(val)) { bad(`(e) ${rel} must contain exactly one vX.Y.Z (found ${JSON.stringify(val.slice(0, 40))})`); continue; }
      if (compareVersions(val.slice(1), V) > 0) bad(`(e) ${rel} names ${val}, which is newer than package.json (${V})`);
      else if (val.slice(1) !== V && tags.length && !tagged.has(val.slice(1))) bad(`(e) ${rel} names ${val}, which is neither the current version nor a tagged release`);
    }
    if (cut) {
      const prep = (read("guidon-app/src/.release-prep") || "").trim();
      if (prep !== "v" + V) bad(`--cut: guidon-app/src/.release-prep must contain v${V} (found ${JSON.stringify(prep)})`);
      if (newest && compareVersions(V, newest) < 0) bad(`--cut: ${V} is older than the newest tag v${newest}`);
      if (tagged.has(V)) {
        const head = git("rev-parse", "HEAD").stdout.trim(), at = git("rev-parse", `v${V}^{commit}`).stdout.trim();
        if (head && at && head !== at) bad(`--cut: v${V} is already tagged on ${at.slice(0, 7)}, not on this commit (${head.slice(0, 7)}) - a tag is never moved; use the next version number`);
      }
    }
    if (failures.length === before) ok(`(e) release marker files are consistent (${seen.join(", ") || "none present"})${cut ? "; ready to cut v" + V : ""}`);
  }

  return { passes, failures, notes, version: V, tags };
}

/**
 * lintPublishedAssets({ tag, repo }) - the one network call this file
 * makes (see the module header's --published entry). Asks GitHub what a
 * tag's real Release carries via `gh release view`, then reuses
 * release-manifest.mjs's own expectedAssets()/verdict() - the exact same
 * completeness logic release-assets.yml's finalize job already runs - so
 * "does this release have everything it needs" has one implementation,
 * not two that can silently drift apart. Requires an authenticated `gh`.
 */
export function lintPublishedAssets({ tag, repo }) {
  const passes = [], failures = [], notes = [];
  const ok = (m) => passes.push(m), bad = (m) => failures.push(m), note = (m) => notes.push(m);
  const m = /^v(\d+\.\d+\.\d+)$/.exec(String(tag || ""));
  if (!m) { bad(`(published) "${tag}" is not a vX.Y.Z tag`); return { passes, failures, notes }; }
  if (!repo) { bad("(published) --repo owner/name is required"); return { passes, failures, notes }; }
  const version = m[1];
  const res = spawnSync("gh", ["release", "view", tag, "--repo", repo, "--json", "assets"], { encoding: "utf-8" });
  if (res.status !== 0) { bad(`(published) gh release view ${tag} --repo ${repo} failed: ${(res.stderr || res.stdout || "").trim().slice(0, 300)}`); return { passes, failures, notes }; }
  let present;
  try { present = JSON.parse(res.stdout).assets.map((a) => a.name); }
  catch (e) { bad(`(published) could not parse gh release view ${tag}'s JSON output: ${e.message}`); return { passes, failures, notes }; }
  return judgePublished({ tag, version, present });
}

/**
 * The pure half of lintPublishedAssets(): given the file names a published
 * release really carries, what is wrong and what is only worth knowing. Split
 * out so tools/test-release-state.mjs can drive every Mac state without gh.
 */
export function judgePublished({ tag, version, present }) {
  const passes = [], failures = [], notes = [];
  const ok = (m) => passes.push(m), bad = (m) => failures.push(m), note = (m) => notes.push(m);
  const v = verdict(version, present);
  if (!v.complete) bad(`(published) ${tag} is published with ${present.length} asset(s) attached but is missing required: ${v.missingRequired.join(", ")}`);
  else ok(`(published) ${tag} carries all ${expectedAssets(version).filter((a) => a.required).length} required assets (${present.length} attached total)`);
  if (v.missingOptional.length) note(`(published) ${tag} is also missing optional assets: ${v.missingOptional.join(", ")}`);
  // Optional, so never a failure - but this is exactly the state in which the
  // in-app Mac button would be a dead link if MAC_DIRECT_LINK were switched on.
  if (present.includes(OPTIONAL_ALIASES.macos)) note(`(published) ${tag} carries ${OPTIONAL_ALIASES.macos}: a direct Mac link resolves while this is the Latest release`);
  else if (v.macAliasGap) note(`(published) ${tag} has its Mac build under the versioned name only - ${OPTIONAL_ALIASES.macos} is missing, so a direct Mac link would be dead until the Apple lane is re-run`);
  else note(`(published) ${tag} has no Mac build at all: ${OPTIONAL_ALIASES.macos} does not exist on it, so a direct Mac link would be dead while it is the Latest release`);
  return { passes, failures, notes };
}

/* --------------------------------------------------------------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
  const publishedTag = argOf("--published");
  if (publishedTag) {
    const repo = argOf("--repo");
    console.log(`lint-release-state --published: does ${publishedTag} really carry the assets it needs? (the one network call this file makes)\n`);
    const res = lintPublishedAssets({ tag: publishedTag, repo });
    for (const m of res.passes) console.log("  PASS  " + m);
    for (const m of res.notes) console.log("  NOTE  " + m);
    for (const m of res.failures) console.log("  FAIL  " + m);
    console.log("\n" + (res.failures.length ? `LINT-RELEASE-STATE --published: ${res.failures.length} FAILURE(S)` : "LINT-RELEASE-STATE --published: all passed"));
    process.exit(res.failures.length ? 1 : 0);
  }
  const root = path.resolve(argOf("--root") || path.join(HERE, "..", ".."));
  const cut = process.argv.includes("--cut");
  console.log(`lint-release-state: version files, tags, CHANGELOG, What's New and download names${cut ? " (--cut: about to tag)" : ""}\n`);
  const res = lintReleaseState({ root, cut });
  for (const m of res.passes) console.log("  PASS  " + m);
  for (const m of res.notes) console.log("  NOTE  " + m);
  for (const m of res.failures) console.log("  FAIL  " + m);
  console.log("\n" + (res.failures.length ? `LINT-RELEASE-STATE: ${res.failures.length} FAILURE(S)` : "LINT-RELEASE-STATE: all passed"));
  process.exit(res.failures.length ? 1 : 0);
}
