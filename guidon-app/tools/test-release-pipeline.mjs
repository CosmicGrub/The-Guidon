/**
 * Regression suite for GUIDON's release + deploy pipeline
 * (.github/workflows/release-cut.yml, release-assets.yml, release-apple.yml,
 * pages.yml, the hand-written parts of ci.yml) and the three tools those
 * workflows call: tools/release-manifest.mjs, tools/release-gate.mjs,
 * tools/test-ios-webkit-ratchet.mjs (the ratchet's own suite).
 *
 * WHY THIS EXISTS. Every defect below shipped because nothing executable
 * described what the pipeline is supposed to do:
 *   - v1.10.0 became "Latest" carrying two Windows files and nothing else, so
 *     BOTH install buttons on the in-app #/share page (the install QR's
 *     landing page) went to a GitHub 404, and the release page lost its
 *     Downloads table.
 *   - release-cut.yml would tag any commit within seconds of a push, while
 *     CI for that commit was still running - or red.
 *   - pages.yml redeployed the live web app (the iPhone install path) from
 *     every push whatever CI said; a build with a script error was live for
 *     hours.
 *   - the Android job hard-failed the whole release run because this
 *     repository has no signing secrets (the key lives on the owner's
 *     machine, by design).
 *   - a hand-added browser suite sat in the one CI job every other job
 *     `needs:`, so one flake there would hide the whole test matrix.
 *
 * HOW IT TESTS. No browser: nothing here runs in a page. Wherever a rule is
 * a shell step inside a workflow, this suite pulls that step's REAL `run:`
 * script out of the workflow file and executes it with bash against stand-in
 * `gh` / `curl` commands that only record what they were asked - so the
 * thing under test is the script GitHub will run, not a description of it.
 * Pure logic (what counts as green, what counts as a complete release, what
 * the Downloads section says) is driven through the same exported functions
 * the workflows call.
 *
 * Verify-the-verifier: GUIDON_TEST_WORKFLOWS_DIR=<dir> points the workflow
 * assertions at another copy of the .github/workflows folder. Pointed at the
 * files as they were before this suite existed, sections 1-5 fail.
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, chmodSync, readdirSync, copyFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { ALIASES, OPTIONAL_ALIASES, ESP32_LANES_AFTER, isNewerVersion, expectedAssets, verdict, renderDownloads, mergeBody, DOWNLOADS_START, DOWNLOADS_END } from "./release-manifest.mjs";
import { decide, gate } from "./release-gate.mjs";
import { needsOf } from "./lint-release-state.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail || pass));

const WF_DIR = process.env.GUIDON_TEST_WORKFLOWS_DIR || "../.github/workflows";
const wf = (name) => readFileSync(path.join(WF_DIR, name), "utf-8").replace(/\r\n/g, "\n");

/* ---------------------------------------------------------------------
   A tiny reader for the two workflow shapes this suite needs: "the text of
   job X" and "the steps of that job, each with its name, its `if:` and its
   `run:` script". Indentation-based on purpose - there is no YAML parser in
   this project's dependencies, and every workflow here is hand-formatted
   with 2-space job keys and 6-space step dashes.
   --------------------------------------------------------------------- */
function jobBlock(yaml, jobId) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => l === `  ${jobId}:`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}
function stepsOf(jobText) {
  if (!jobText) return [];
  const lines = jobText.split("\n");
  const starts = [];
  lines.forEach((l, i) => { if (/^      - /.test(l)) starts.push(i); });
  return starts.map((s, n) => {
    const body = lines.slice(s, n + 1 < starts.length ? starts[n + 1] : lines.length);
    const get = (key) => {
      const hit = body.find((l) => new RegExp(`^      (- |  )${key}:`).test(l));
      return hit ? hit.replace(new RegExp(`^      (- |  )${key}:\\s*`), "").trim() : null;
    };
    let run = null;
    const runIdx = body.findIndex((l) => /^        run:/.test(l));
    if (runIdx !== -1) {
      const inline = body[runIdx].replace(/^        run:\s*/, "");
      if (/^[|>]/.test(inline)) {
        const block = [];
        for (let i = runIdx + 1; i < body.length; i++) {
          if (body[i].trim() === "" || /^          /.test(body[i])) block.push(body[i].replace(/^          /, ""));
          else break;
        }
        run = block.join("\n");
      } else run = inline;
    }
    // Comment lines between steps belong to nobody.
    const text = body.filter((l) => !/^\s*#/.test(l)).join("\n");
    return { name: get("name"), if: get("if"), uses: get("uses"), id: get("id"), run, text };
  });
}
const stepNamed = (steps, name) => steps.find((s) => s.name === name) || null;

/* ---------------------------------------------------------------------
   Run a workflow step's real script with bash. `gh` and `curl` are
   stand-ins on PATH that record their arguments and answer from small
   state files - nothing here ever talks to GitHub.
   --------------------------------------------------------------------- */
function findBash() {
  const candidates = [process.env.GUIDON_BASH, /bash/i.test(process.env.SHELL || "") ? process.env.SHELL : null,
    "C:/Program Files/Git/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe", "/usr/bin/bash", "/bin/bash", "bash"].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ["-c", "echo guidon-bash-ok"], { encoding: "utf-8" });
    if (r.status === 0 && /guidon-bash-ok/.test(r.stdout || "")) return c;
  }
  return null;
}
const BASH = findBash();
const fwd = (p) => p.replace(/\\/g, "/");
const scratch = mkdtempSync(path.join(tmpdir(), "guidon-release-pipeline-"));
function sandbox(label) {
  const dir = path.join(scratch, label);
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "gh"), [
    "#!/usr/bin/env bash",
    'echo "$*" >> "$STUB_DIR/gh-calls.txt"',
    'case "$*" in',
    '  *"releases/latest"*) cat "$STUB_DIR/latest.txt" 2>/dev/null || true ;;',
    '  *"deployments"*) cat "$STUB_DIR/live.txt" 2>/dev/null || true ;;',
    '  "release view "*) cat "$STUB_DIR/release-view.json" 2>/dev/null || true ;;',
    '  "release edit "*"--latest"*) printf "%s\\n" "$3" > "$STUB_DIR/latest.txt" ;;',
    "esac",
    "exit 0", ""].join("\n"));
  writeFileSync(path.join(bin, "curl"), ["#!/usr/bin/env bash", 'echo "$*" >> "$STUB_DIR/curl-calls.txt"', 'exit "${STUB_CURL_EXIT:-0}"', ""].join("\n"));
  try { chmodSync(path.join(bin, "gh"), 0o755); chmodSync(path.join(bin, "curl"), 0o755); } catch (e) {}
  return { dir, bin };
}
function runStep(script, { box, env = {}, cwd }) {
  const out = path.join(box.dir, "github-output.txt");
  const summary = path.join(box.dir, "step-summary.md");
  writeFileSync(out, ""); writeFileSync(summary, "");
  const scriptPath = path.join(box.dir, "step.sh");
  // Git for Windows' bash launcher puts its own /mingw64/bin (which has a
  // real curl) AHEAD of the PATH it inherits, so the stand-ins are put first
  // again from inside bash. Harness only - the step's script is untouched.
  const preamble = 'if command -v cygpath >/dev/null 2>&1; then STUB_BIN="$(cygpath -u "$STUB_BIN")"; fi\nexport PATH="$STUB_BIN:$PATH"\nhash -r\n';
  writeFileSync(scriptPath, preamble + script + "\n");
  const r = spawnSync(BASH, [fwd(scriptPath)], {
    cwd: cwd || box.dir, encoding: "utf-8",
    env: { ...process.env, PATH: box.bin + path.delimiter + process.env.PATH, STUB_DIR: fwd(box.dir),
      STUB_BIN: fwd(box.bin), GITHUB_OUTPUT: fwd(out), GITHUB_STEP_SUMMARY: fwd(summary), RUNNER_TEMP: fwd(box.dir),
      GITHUB_REPOSITORY: "CosmicGrub/The-Guidon", ...env },
  });
  const read = (p) => (existsSync(p) ? readFileSync(p, "utf-8") : "");
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", output: read(out), summary: read(summary),
    ghCalls: read(path.join(box.dir, "gh-calls.txt")), curlCalls: read(path.join(box.dir, "curl-calls.txt")) };
}

try {
  if (!BASH) bad("no bash found to execute the workflows' own step scripts (set GUIDON_BASH to a bash executable)");

  const cut = wf("release-cut.yml"), assets = wf("release-assets.yml"), apple = wf("release-apple.yml"), pages = wf("pages.yml"), ci = wf("ci.yml");

  /* ===================================================================
     1. The in-app install buttons keep working (version-less file names)
     =================================================================== */
  console.log("\n1. In-app download buttons and the release page's Downloads section");
  const html = readFileSync("src/index.html", "utf-8");
  const linked = [...new Set([...html.matchAll(/\bdl\("([^"]+)"\)/g)].map((m) => m[1]))].sort();
  check(linked.length >= 2, `#/share links to ${linked.length} download name(s): ${linked.join(", ")}`, "could not find the dl(\"...\") download links in the #/share view");
  const declaredNames = [...Object.values(ALIASES), ...Object.values(OPTIONAL_ALIASES)].sort();
  check(JSON.stringify(linked) === JSON.stringify(declaredNames),
    "every file name the app links to is declared in release-manifest.mjs (required or optional), and nothing extra",
    `the app links to [${linked.join(", ")}] but release-manifest.mjs declares [${declaredNames.join(", ")}]`);
  const optionalNames = new Set(Object.values(OPTIONAL_ALIASES));
  for (const a of expectedAssets("9.9.9").filter((x) => x.alias && !optionalNames.has(x.name))) {
    check(a.required === true, `${a.name} is REQUIRED for a release to count as complete`);
  }
  for (const a of expectedAssets("9.9.9").filter((x) => optionalNames.has(x.name))) {
    check(a.required === false && a.alias === true && a.group === "macos", `${a.name} (the Mac fixed name) is an OPTIONAL alias - the Mac lane can never hold a release out of Latest`);
  }

  const androidSteps = stepsOf(jobBlock(assets, "android"));
  const publishAndroid = stepNamed(androidSteps, "Publish Android assets to GitHub Release");
  if (!publishAndroid || !publishAndroid.run || !BASH) bad("release-assets.yml: Android publish step not found");
  else {
    const box = sandbox("publish-android");
    const apkDir = path.join(box.dir, "android/app/build/outputs/apk/release"), aabDir = path.join(box.dir, "android/app/build/outputs/bundle/release");
    mkdirSync(apkDir, { recursive: true }); mkdirSync(aabDir, { recursive: true });
    writeFileSync(path.join(apkDir, "app-release.apk"), "APK-BYTES"); writeFileSync(path.join(aabDir, "app-release.aab"), "AAB-BYTES");
    const r = runStep(publishAndroid.run, { box, env: { VERSION: "9.9.9", TAG: "v9.9.9" } });
    const upload = r.ghCalls.split("\n").find((l) => l.startsWith("release upload v9.9.9")) || "";
    check(r.status === 0 && /release-out\/GUIDON-android\.apk/.test(upload) && /GUIDON-9\.9\.9-android\.apk/.test(upload) && /GUIDON-9\.9\.9-android\.aab/.test(upload),
      "Android publish step uploads the versioned .apk + .aab AND the version-less GUIDON-android.apk",
      "Android publish step did not upload GUIDON-android.apk alongside the versioned files: " + (upload || r.stderr));
    const aliasPath = path.join(box.dir, "release-out/GUIDON-android.apk");
    check(existsSync(aliasPath) && readFileSync(aliasPath, "utf-8") === "APK-BYTES", "GUIDON-android.apk is the same file as the versioned .apk");
  }
  const publishWindows = stepNamed(stepsOf(jobBlock(assets, "windows")), "Publish Windows assets to GitHub Release");
  check(!!publishWindows && /Copy-Item \$nsis\.FullName \$aliasOut/.test(publishWindows.run || "") && /'release-out\/GUIDON-windows-setup\.exe'/.test(publishWindows.run || "") &&
    /gh release upload[^\n]*\$aliasOut/.test(publishWindows.run || ""),
    "Windows publish step copies the installer to GUIDON-windows-setup.exe and uploads it",
    "Windows publish step does not upload the version-less GUIDON-windows-setup.exe");
  check(!!publishWindows && /\$LASTEXITCODE -ne 0/.test(publishWindows.run || ""), "Windows publish step fails the job when the upload fails (pwsh does not stop on a native command's exit code by itself)");

  // The handheld's deck list (GUIDON-X.Y.Z-esp32-lanes.json): the workflow
  // steps that produce and package it, run for real against a stand-in folder.
  // It is expected only from the release after v1.16.0, so an older tag that
  // is built again (from its own older exporter) must not be refused for it.
  const firmwareSteps = stepsOf(jobBlock(assets, "web_firmware"));
  const exportStep = stepNamed(firmwareSteps, "Export ESP32 cards and build Flashcard OS");
  const packageStep = stepNamed(firmwareSteps, "Package full-fork assets");
  if (!exportStep || !exportStep.run || !packageStep || !packageStep.run || !BASH) bad("release-assets.yml: the ESP32 export/package steps were not found");
  else {
    const gateAt = exportStep.run.indexOf("manifest=../../guidon-app/tools/release-manifest.mjs");
    check(gateAt !== -1 && /names --version "\$VERSION"/.test(exportStep.run.slice(gateAt)) && /esp32-lanes\.json/.test(exportStep.run.slice(gateAt)) && /test -s sdcard\/lanes\.json/.test(exportStep.run.slice(gateAt)),
      "the ESP32 export step asks release-manifest.mjs whether this version carries the deck list, and insists on the file when it does", "the ESP32 export step does not gate the deck list on release-manifest.mjs");
    // withTool: true = the tag has release-manifest.mjs (v1.12.1 and later); false = it has none (v1.10.0);
    // a string = a stand-in tool with that source (one that is there but fails).
    const lay = (label, withTool = true) => {
      const box = sandbox(label);
      mkdirSync(path.join(box.dir, "firmware/esp32-flashcard-os/sdcard"), { recursive: true });
      mkdirSync(path.join(box.dir, "guidon-app/tools"), { recursive: true });
      mkdirSync(path.join(box.dir, "release-out"), { recursive: true });
      if (withTool === true) copyFileSync("tools/release-manifest.mjs", path.join(box.dir, "guidon-app/tools/release-manifest.mjs"));
      else if (typeof withTool === "string") writeFileSync(path.join(box.dir, "guidon-app/tools/release-manifest.mjs"), withTool);
      return box;
    };
    const gateScript = "set -euo pipefail\n" + exportStep.run.slice(gateAt);
    const runGate = (box, version) => runStep(gateScript, { box, env: { VERSION: version, TAG: "v" + version }, cwd: path.join(box.dir, "firmware/esp32-flashcard-os") });
    let box = lay("lanes-gate-old");
    check(runGate(box, "1.16.0").status === 0, "an older release (v1.16.0, built from its own older exporter, so no lanes.json) still builds - the deck list is not asked of it");
    // A tag older than v1.12.1 has no release-manifest.mjs at all (v1.10.0 does not): re-running the release
    // for one must not die asking a tool that is not there. It predates the deck list, so it gets the
    // historical five-file ESP32 list and builds exactly as it always did.
    box = lay("lanes-gate-no-tool", false);
    let r = runGate(box, "1.10.0");
    check(r.status === 0 && /historical five-file ESP32 list/.test(r.stdout + r.stderr), "an OLD tag with no release-manifest.mjs (v1.10.0) still builds: the step falls back to the historical five-file list and asks nothing of the missing tool", "the export step died for a tag with no release-manifest.mjs: " + r.stdout + r.stderr);
    box = lay("lanes-gate-no-tool-newer", false);
    r = runGate(box, "9.9.9");
    check(r.status === 0, "...and it never demands a deck list from a tag that cannot have one (no tool = predates it), even under a higher version number", "a tag with no tool was refused for its deck list: " + r.stdout + r.stderr);
    box = lay("lanes-gate-tool-fails", 'process.stderr.write("boom\\n"); process.exit(2);\n');
    r = runGate(box, "9.9.9");
    check(r.status !== 0, "a release-manifest.mjs that IS there but fails is not mistaken for an old tag: the step stops (only a missing tool takes the fallback)", "a failing release-manifest.mjs was swallowed by the fallback: " + r.stdout + r.stderr);
    box = lay("lanes-gate-new-missing");
    r = runGate(box, "9.9.9");
    check(r.status !== 0, "the next release with no lanes.json written by the exporter FAILS the job, so it cannot go out without its decks", "a new release with no deck list did not stop the export step: " + r.stdout + r.stderr);
    writeFileSync(path.join(box.dir, "firmware/esp32-flashcard-os/sdcard/lanes.json"), "");
    check(runGate(box, "9.9.9").status !== 0, "...and an EMPTY lanes.json fails it too (test -s, not test -f)");
    writeFileSync(path.join(box.dir, "firmware/esp32-flashcard-os/sdcard/lanes.json"), '{"schema":1,"lanes":[]}');
    r = runGate(box, "9.9.9");
    check(r.status === 0, "the next release with a lanes.json passes the gate", "a new release with its deck list was refused: " + r.stdout + r.stderr);

    const pkgCut = packageStep.run.indexOf("# Only when the exporter of this tag wrote one");
    check(pkgCut !== -1 && /GUIDON-\$\{VERSION\}-esp32-lanes\.json/.test(packageStep.run.slice(pkgCut)), "the ESP32 package step copies the deck list to GUIDON-X.Y.Z-esp32-lanes.json", "the ESP32 package step does not name the deck list file");
    const pkgScript = "set -euo pipefail\n" + packageStep.run.slice(pkgCut);
    box = lay("lanes-package");
    r = runStep(pkgScript, { box, env: { VERSION: "9.9.9" } });
    check(r.status === 0 && !existsSync(path.join(box.dir, "release-out/GUIDON-9.9.9-esp32-lanes.json")), "no lanes.json (an older tag's export): nothing is packaged and the step still succeeds");
    writeFileSync(path.join(box.dir, "firmware/esp32-flashcard-os/sdcard/lanes.json"), '{"schema":1,"lanes":[{"id":"default"}]}');
    r = runStep(pkgScript, { box, env: { VERSION: "9.9.9" } });
    const packed = path.join(box.dir, "release-out/GUIDON-9.9.9-esp32-lanes.json");
    check(r.status === 0 && existsSync(packed) && readFileSync(packed, "utf-8") === '{"schema":1,"lanes":[{"id":"default"}]}', "with a lanes.json, it is packaged byte for byte as GUIDON-9.9.9-esp32-lanes.json (uploaded by the existing release-out/* step)", "the deck list was not packaged: " + r.stderr);
  }

  // What v1.10.0 really carried when it became Latest.
  const V1100 = ["GUIDON-1.10.0-windows-setup.exe", "GUIDON-1.10.0-windows.msi"];
  const v1100 = verdict("1.10.0", V1100);
  check(!v1100.complete && v1100.missingAliases.length === 2, "a release shaped like v1.10.0 (two Windows files) is judged INCOMPLETE, with both in-app names missing");
  const section1100 = renderDownloads({ version: "1.10.0", tag: "v1.10.0", repo: "CosmicGrub/The-Guidon", present: V1100 });
  const linkedFiles = [...section1100.matchAll(/releases\/download\/v1\.10\.0\/([^)\s]+)/g)].map((m) => m[1]);
  check(linkedFiles.length > 0 && linkedFiles.every((n) => V1100.includes(n)), "the Downloads section only ever links files that are really attached");
  check(/Not attached yet: Android/.test(section1100) && !/\| Android phone or tablet \|/.test(section1100), "a missing Android file is said plainly instead of being listed as a dead link");
  check(/\| iPhone or iPad \|/.test(section1100) && /cosmicgrub\.github\.io\/The-Guidon\//.test(section1100), "iPhone/iPad always gets its row (the hosted page is the iPhone install path)");
  const JARGON = /\b(artifact|asset|alias|workflow|CI|pipeline|tag(ged)?|SHA|binary|binaries|PWA|NSIS|sideload|regression|module)\b/;
  const prose = section1100.replace(/\]\([^)]*\)/g, "]").replace(/\[[^\]]*\]/g, "");
  check(!JARGON.test(prose), "the Downloads section is plain language (no build or pipeline jargon)", "the Downloads section contains jargon: " + (prose.match(JARGON) || [])[0]);

  const FULL = expectedAssets("9.9.9").map((a) => a.name);
  check(verdict("9.9.9", FULL).complete, "a release with every expected file is judged COMPLETE");
  check(!verdict("9.9.9", FULL.filter((n) => n !== ALIASES.android)).complete, "every versioned file but no GUIDON-android.apk is still INCOMPLETE");
  check(verdict("9.9.9", FULL.filter((n) => !/macos|ios-simulator/.test(n))).complete, "a slow or failed Apple lane cannot hold the Android and Windows buttons hostage (Apple files are optional)");

  // The handheld's deck list is required from the release AFTER v1.16.0 only.
  const LANES = (v) => `GUIDON-${v}-esp32-lanes.json`;
  // v1.16.0 exactly as GitHub lists it (gh release view v1.16.0 --json assets): no deck list.
  const PUBLISHED_1160 = ["GUIDON-1.16.0-android.aab", "GUIDON-1.16.0-android.apk", "GUIDON-1.16.0-esp32-bootloader.bin", "GUIDON-1.16.0-esp32-cards.ndjson", "GUIDON-1.16.0-esp32-categories.json",
    "GUIDON-1.16.0-esp32-flashcardos.bin", "GUIDON-1.16.0-esp32-partitions.bin", "GUIDON-1.16.0-ios-simulator.zip", "GUIDON-1.16.0-macos-universal.dmg", "GUIDON-1.16.0-standalone.html",
    "GUIDON-1.16.0-web-pwa.zip", "GUIDON-1.16.0-windows-setup.exe", "GUIDON-1.16.0-windows.msi", "GUIDON-android.apk", "GUIDON-windows-setup.exe"];
  check(ESP32_LANES_AFTER === "1.16.0", "the deck list is required only after v1.16.0, the last release that shipped without it");
  const laneEntry = expectedAssets("9.9.9").find((a) => a.name === LANES("9.9.9"));
  check(!!laneEntry && laneEntry.required === true && laneEntry.group === "esp32" && !laneEntry.alias, "from the next release on, GUIDON-X.Y.Z-esp32-lanes.json is a REQUIRED file in the esp32 group");
  const noLanes = verdict("9.9.9", FULL.filter((n) => n !== LANES("9.9.9")));
  check(!noLanes.complete && JSON.stringify(noLanes.missingRequired) === JSON.stringify([LANES("9.9.9")]) && noLanes.missingAliases.length === 0,
    "a new release with every file but the deck list is INCOMPLETE and the deck list is the only thing named missing", "a new release without its deck list was judged " + JSON.stringify(noLanes));
  const next = expectedAssets("1.16.1").map((a) => a.name).filter((n) => !/macos|ios-simulator/.test(n));
  check(next.includes(LANES("1.16.1")) && !verdict("1.16.1", next.filter((n) => n !== LANES("1.16.1"))).complete && verdict("1.16.1", next).complete, "the very next patch release (1.16.1) is held out of Latest until the deck list is attached");
  for (const v of ["1.16.0", "1.15.7", "1.12.1", "1.10.0", "1.9.0", "0.9.9"]) {
    check(!expectedAssets(v).some((a) => /esp32-lanes/.test(a.name)), `v${v} (already out) is not expected to carry a deck list`);
  }
  const done = verdict("1.16.0", PUBLISHED_1160);
  check(done.complete && done.missingRequired.length === 0 && done.missingAliases.length === 0, "v1.16.0 exactly as published (no deck list) is still judged COMPLETE, so re-running finalize on it can still mark it Latest", "v1.16.0 as published was judged " + JSON.stringify(done));
  check(expectedAssets("1.16.0").filter((a) => a.required).length === 13 && expectedAssets("9.9.9").filter((a) => a.required).length === 14, "the required set is 13 files up to v1.16.0 and 14 after it (the deck list is the one addition)");
  check(isNewerVersion("1.16.1", "1.16.0") && isNewerVersion("1.17.0", "1.16.0") && isNewerVersion("2.0.0", "1.99.99") && isNewerVersion("1.16.10", "1.16.9") && isNewerVersion("1.100.0", "1.16.0"),
    "version comparison is number by number (1.16.10 is newer than 1.16.9, 1.100.0 than 1.16.0)");
  check(!isNewerVersion("1.16.0", "1.16.0") && !isNewerVersion("1.9.0", "1.16.0") && !isNewerVersion("1.15.99", "1.16.0"), "...and an older or equal version is never 'newer' (1.9.0 is not newer than 1.16.0 the way a text comparison would say)");
  const page1160 = renderDownloads({ version: "1.16.0", tag: "v1.16.0", repo: "CosmicGrub/The-Guidon", present: PUBLISHED_1160 });
  check(/GUIDON flashcard handheld/.test(page1160) && !/lanes|deck list/.test(page1160), "v1.16.0's release page still shows its handheld row, and never links a deck list it does not carry");
  const page999 = renderDownloads({ version: "9.9.9", tag: "v9.9.9", repo: "o/r", present: FULL });
  check(page999.includes(`releases/download/v9.9.9/${LANES("9.9.9")}`) && /the card files, including the deck list, go on its memory card/.test(page999), "a new release's page links the deck list in the handheld row and says where it goes");
  const page999NoLanes = renderDownloads({ version: "9.9.9", tag: "v9.9.9", repo: "o/r", present: FULL.filter((n) => n !== LANES("9.9.9")) });
  check(!/GUIDON flashcard handheld/.test(page999NoLanes), "...and with the deck list missing it offers no handheld row (a card set with no decks is not a working download)");
  const proseDecks = page999.replace(/\]\([^)]*\)/g, "]").replace(/\[[^\]]*\]/g, "");
  check(!/\b(artifact|asset|alias|workflow|CI|pipeline|tag(ged)?|SHA|binary|binaries|PWA|NSIS|sideload|regression|module|lane|lanes|NDJSON)\b/.test(proseDecks), "the page's own words about the deck list stay plain (a Soldier reads 'deck', never 'lane')");
  const generated = "## What's Changed\n* a change by @someone in #1\n";
  const once = mergeBody(generated, renderDownloads({ version: "9.9.9", tag: "v9.9.9", repo: "o/r", present: FULL }));
  const twice = mergeBody(once, renderDownloads({ version: "9.9.9", tag: "v9.9.9", repo: "o/r", present: FULL }));
  check(once === twice && once.indexOf(DOWNLOADS_START) === 0 && once.includes("## What's Changed") && once.split(DOWNLOADS_END).length === 2,
    "refreshing the Downloads section twice leaves exactly one section at the top and keeps the rest of the release notes");

  // The CLI the workflows call: exit 3 = incomplete, 0 = complete, 1 = bad input.
  {
    const box = sandbox("manifest-cli");
    const rel = path.join(box.dir, "release.json"), notes = path.join(box.dir, "notes.md");
    const runCli = (assetsList, extra = []) => {
      writeFileSync(rel, JSON.stringify({ body: generated, assets: assetsList.map((name) => ({ name })) }));
      return spawnSync(process.execPath, ["tools/release-manifest.mjs", "finalize", "--version", "9.9.9", "--tag", "v9.9.9", "--repo", "o/r", "--release-json", rel, "--notes-out", notes, ...extra], { encoding: "utf-8" });
    };
    const inc = runCli(["GUIDON-9.9.9-windows-setup.exe"]);
    check(inc.status === 3 && /INCOMPLETE - missing: /.test(inc.stdout) && readFileSync(notes, "utf-8").includes("## Downloads"), "release-manifest finalize: incomplete release exits 3 and still writes the refreshed notes");
    check(runCli(FULL).status === 0, "release-manifest finalize: complete release exits 0");
    const mism = spawnSync(process.execPath, ["tools/release-manifest.mjs", "finalize", "--version", "9.9.9", "--tag", "v1.0.0", "--repo", "o/r", "--release-json", rel, "--notes-out", notes], { encoding: "utf-8" });
    check(mism.status === 1, "release-manifest finalize: a tag that does not match the version is refused (exit 1)");
    // Re-finalising a release that is already out must keep working: v1.16.0 has no deck list.
    writeFileSync(rel, JSON.stringify({ body: generated, assets: PUBLISHED_1160.map((name) => ({ name })) }));
    const old = spawnSync(process.execPath, ["tools/release-manifest.mjs", "finalize", "--version", "1.16.0", "--tag", "v1.16.0", "--repo", "o/r", "--release-json", rel, "--notes-out", notes], { encoding: "utf-8" });
    check(old.status === 0 && /COMPLETE/.test(old.stdout), "release-manifest finalize on v1.16.0 exactly as published still exits 0 (the deck list is not asked of a release that predates it)", "finalize v1.16.0: exit " + old.status + "\n" + old.stdout + old.stderr);
    const namesOld = spawnSync(process.execPath, ["tools/release-manifest.mjs", "names", "--version", "1.16.0"], { encoding: "utf-8" }).stdout;
    const namesNew = spawnSync(process.execPath, ["tools/release-manifest.mjs", "names", "--version", "1.16.1"], { encoding: "utf-8" }).stdout;
    check(!/esp32-lanes/.test(namesOld) && /^GUIDON-1\.16\.1-esp32-lanes\.json$/m.test(namesNew), "release-manifest names: the deck list is listed for 1.16.1 and not for 1.16.0 (the workflow asks this)");
  }

  /* ===================================================================
     2. A release is only marked Latest once it is complete
     =================================================================== */
  console.log("\n2. Only a complete release becomes Latest");
  const createCmd = (cut.match(/gh release create[\s\S]*?--generate-notes/) || [""])[0];
  check(/--latest=false/.test(createCmd), "release-cut.yml creates the release with --latest=false (it has no files yet)", "release-cut.yml lets a brand-new, empty release become Latest");
  check(!/--draft/.test(createCmd), "release-cut.yml does not use --draft (a draft creates no tag, and the asset jobs check out the tag)");
  const finalizeJob = jobBlock(assets, "finalize");
  const finalizeSteps = stepsOf(finalizeJob);
  check(!!finalizeJob && /needs: \[resolve, android, windows, web_firmware\]/.test(finalizeJob) && /always\(\)/.test(finalizeJob),
    "release-assets.yml has a finalize job that runs after all three platform jobs, whatever happened to them", "release-assets.yml has no finalize job after the platform jobs");
  const markLatest = stepNamed(finalizeSteps, "Mark Latest (complete releases only)");
  check(!!markLatest && /steps\.page\.outputs\.complete == 'true'/.test(markLatest.if || ""), "the Mark Latest step only runs when the release was judged complete");
  if (markLatest && markLatest.run && BASH) {
    let box = sandbox("latest-normal"); writeFileSync(path.join(box.dir, "latest.txt"), "v1.9.0\n");
    let r = runStep(markLatest.run, { box, env: { TAG: "v9.9.9", VERSION: "9.9.9" } });
    check(r.status === 0 && /release edit v9\.9\.9 .*--latest/.test(r.ghCalls) && /GUIDON-android\.apk/.test(r.curlCalls) && /GUIDON-windows-setup\.exe/.test(r.curlCalls),
      "complete release: both in-app file names are download-checked, then the release is marked Latest", "Mark Latest step did not mark a complete release Latest: " + r.stderr + r.stdout);
    box = sandbox("latest-404"); writeFileSync(path.join(box.dir, "latest.txt"), "v1.9.0\n");
    r = runStep(markLatest.run, { box, env: { TAG: "v9.9.9", VERSION: "9.9.9", STUB_CURL_EXIT: "22" } });
    check(r.status !== 0 && !/release edit/.test(r.ghCalls), "a listed file that does not actually download blocks Latest (the previous release keeps serving the buttons)");
    box = sandbox("latest-older"); writeFileSync(path.join(box.dir, "latest.txt"), "v10.0.0\n");
    r = runStep(markLatest.run, { box, env: { TAG: "v9.9.9", VERSION: "9.9.9" } });
    check(r.status === 0 && !/release edit/.test(r.ghCalls), "re-finalizing an older release never takes Latest away from a newer one");
  }
  const platformStep = stepNamed(finalizeSteps, "Platform jobs must not have failed");
  if (platformStep && platformStep.run && BASH) {
    const env = (a, w, e) => ({ R_ANDROID: a, R_WINDOWS: w, R_WEB: e, TAG: "v9.9.9" });
    check(runStep(platformStep.run, { box: sandbox("plat-ok"), env: env("success", "success", "success") }).status === 0, "finalize: all platform jobs green passes");
    check(runStep(platformStep.run, { box: sandbox("plat-fail"), env: env("success", "failure", "success") }).status !== 0, "finalize: a failed platform job turns the run red");
  } else bad("release-assets.yml: finalize has no 'Platform jobs must not have failed' step");
  const appleRefresh = jobBlock(apple, "refresh_downloads");
  check(!!appleRefresh && !/--latest/.test(appleRefresh.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")), "release-apple.yml refreshes the Downloads section but never touches the Latest flag");
  check(/group: release-page-/.test(finalizeJob || "") && /group: release-page-/.test(appleRefresh || ""), "both workflows rewrite the release page under one shared lock, never at the same moment");

  /* ===================================================================
     3. Nothing is tagged, built or deployed from a commit CI did not pass
     =================================================================== */
  console.log("\n3. Green CI is required before tagging, building installers or deploying");
  const SHA = "a".repeat(40), OTHER = "b".repeat(40);
  const run = (o) => ({ head_sha: SHA, event: "push", status: "completed", conclusion: "success", run_number: 1, run_attempt: 1, id: 1, ...o });
  check(decide([], SHA).state === "none", "no CI run for the commit -> not green");
  check(decide([run({ conclusion: "failure" })], SHA).state === "red", "a failed CI run -> red");
  check(decide([run({ status: "in_progress", conclusion: null })], SHA).state === "pending", "a CI run still in progress -> pending, not green");
  check(decide([run({ head_sha: OTHER })], SHA).state === "none", "a green run for a DIFFERENT commit never vouches for this one");
  check(decide([run({ event: "pull_request" })], SHA).state === "none", "a pull-request run (a different tree) never vouches for a commit on main");
  check(decide([run({ conclusion: "failure", run_attempt: 1 }), run({ run_attempt: 2 })], SHA).state === "green", "re-running a red run to green is honoured (the newest attempt counts)");
  check(decide([run({ run_number: 1 }), run({ run_number: 2, conclusion: "failure" })], SHA).state === "red", "a later red run overrides an earlier green one");
  check(decide([run({ conclusion: "cancelled" })], SHA).state === "red" && decide([run({ conclusion: "skipped" })], SHA).state === "red", "cancelled and skipped are not green");

  const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };
  const drive = async (answers, opts = {}) => {
    const c = clock(); const calls = {};
    return gate({ sha: SHA, required: "ci.yml", also: opts.also || [], waitMs: opts.waitMs ?? 0, pollMs: 1000, now: c.now, sleep: c.sleep,
      fetchRuns: async (w) => { calls[w] = (calls[w] || 0) + 1; const a = answers[w]; const v = typeof a === "function" ? a(calls[w]) : a; if (v instanceof Error) throw v; return v; } });
  };
  check((await drive({ "ci.yml": [run({ conclusion: "failure" })] })).ok === false, "gate: red CI is refused");
  check((await drive({ "ci.yml": [] })).ok === false, "gate: no CI run at all is refused, never assumed fine");
  check((await drive({ "ci.yml": (n) => (n < 3 ? [run({ status: "queued", conclusion: null })] : [run({})]) }, { waitMs: 60000 })).ok === true, "gate: waits for a CI run that is still going, then accepts green");
  check((await drive({ "ci.yml": [run({ status: "in_progress", conclusion: null })] }, { waitMs: 5000 })).ok === false, "gate: a CI run that never finishes inside the wait is refused");
  check((await drive({ "ci.yml": [run({})], "desktop.yml": [run({ conclusion: "failure" })] }, { also: ["desktop.yml"] })).ok === false, "gate: green CI but a red Desktop run for the same commit is refused");
  check((await drive({ "ci.yml": [run({})], "ios.yml": [] }, { also: ["ios.yml"] })).ok === true, "gate: a path-filtered workflow with no run for this commit does not block");
  check((await drive({ "ci.yml": new Error("HTTP 502") }, { waitMs: 3600000 })).ok === false, "gate: a CI result that cannot be read is a refusal, never a pass");
  {
    // The real CLI with no `gh` reachable at all: must refuse (exit 1).
    const emptyBin = path.join(scratch, "empty-bin"); mkdirSync(emptyBin, { recursive: true });
    const r = spawnSync(process.execPath, ["tools/release-gate.mjs", "--repo", "o/r", "--sha", SHA, "--wait-minutes", "0"], { encoding: "utf-8", env: { ...process.env, PATH: emptyBin, Path: emptyBin } });
    check(r.status === 1, "release-gate CLI: when the CI result cannot be fetched it exits 1 (\"could not tell\" is never a pass)", "release-gate CLI exited " + r.status + " with no gh available");
    const u = spawnSync(process.execPath, ["tools/release-gate.mjs", "--repo", "o/r", "--sha", "main"], { encoding: "utf-8" });
    check(u.status === 1, "release-gate CLI: a branch name instead of an exact commit is refused");
  }

  const cutJob = jobBlock(cut, "cut"), cutSteps = stepsOf(cutJob);
  const iGate = cutSteps.findIndex((s) => /release-gate\.mjs/.test(s.run || "")), iCreate = cutSteps.findIndex((s) => /gh release create/.test(s.run || ""));
  const iState = cutSteps.findIndex((s) => /lint-release-state\.mjs --cut/.test(s.run || ""));
  check(iGate !== -1 && iCreate !== -1 && iGate < iCreate, "release-cut.yml asks the CI gate BEFORE it creates the tag and the release", "release-cut.yml creates the tag without first requiring green CI on that commit");
  check(iGate !== -1 && /--sha "\$GITHUB_SHA"/.test(cutSteps[iGate].run) && /--workflow ci\.yml/.test(cutSteps[iGate].run) && /--wait-minutes (?!0\b)\d+/.test(cutSteps[iGate].run),
    "the gate checks THIS exact commit and waits for CI (the release push starts CI at the same moment)");
  check(iState !== -1 && iState < iCreate, "release-cut.yml checks that every version-bearing file agrees before it tags");
  // The Command/Legal package's generated stamp names the version it was verified for; re-stamping it is a manual step of every
  // release (npm run legal:stamp). Nothing else stops a cut with the previous version's stamp, so the cut must run the check itself.
  const iLegal = cutSteps.findIndex((s) => /verify-legal-package\.mjs --release\b/.test(s.run || ""));
  check(iLegal !== -1 && iLegal < iGate && iLegal < iCreate, "release-cut.yml runs verify-legal-package.mjs --release (the stamp names THIS version) before it waits for CI or creates the tag", "release-cut.yml never checks that the Command/Legal package was re-stamped for the version being cut");
  check(iState !== -1 && /\(g\) --cut/.test(readFileSync("tools/lint-release-state.mjs", "utf-8")) && /legal:stamp/.test(readFileSync("tools/lint-release-state.mjs", "utf-8")), "lint-release-state.mjs --cut also refuses a stale legal stamp itself (check (g), pinned in test-release-state.mjs), so a local --cut run catches it too");
  {
    const runbookText = readFileSync("docs/release-runbook.md", "utf-8");
    const row2a = (runbookText.match(/^\| 2a\. Legal package \|.*$/m) || [""])[0];
    check(/npm run legal:stamp/.test(row2a) && /verify-legal-package\.mjs --run --write-stamp/.test(row2a) && /npm run build/.test(row2a) && /bump.*->.*build.*->.*stamp.*->.*commit.*->.*cut/.test(row2a) && /the cut refuses/.test(row2a),
      "the runbook's step 2a gives the order (bump -> build -> stamp -> commit -> cut), the real command (npm run legal:stamp) and says the cut refuses a stale stamp", "docs/release-runbook.md step 2a: " + row2a.slice(0, 200));
    const row3 = (runbookText.match(/^\| 3\. Cut \|.*$/m) || [""])[0];
    check(/verify-legal-package\.mjs --release/.test(row3), "the runbook's step 3 says release-cut.yml runs verify-legal-package.mjs --release");
    check(!/but keep\s+them oldest first/.test(runbookText) && /does not matter to the app or to any check/.test(runbookText), "the runbook does not present What's New entry order as a rule (nothing enforces it and the app sorts by version)");
  }
  check(/^    if: github\.ref == 'refs\/heads\/main'$/m.test(cutJob || ""), "release-cut.yml refuses to cut from any branch but main (a manual run can be started anywhere)");
  // actions: write, not read (fan-out fix, 2026-09-23) - write is the
  // permission workflow_dispatch itself needs (see the dispatch check
  // right below) and, per GitHub's own permission model, a write grant on
  // a scope also carries read for that same scope - so this still proves
  // "may read Actions runs," just via the broader grant the dispatch step
  // actually requires.
  check(/^\s+actions: write$/m.test(cut), "release-cut.yml may read (and dispatch) Actions runs");
  // The fan-out itself (2026-09-23 fix): a GITHUB_TOKEN-authored tag push
  // never fires another workflow's own push trigger, so relying on
  // .release-trigger's push to fan out release-assets.yml/release-apple.yml
  // silently built nothing - confirmed empirically (v1.15.0/.3/.4 all
  // published with zero assets). workflow_dispatch is one of the two real
  // exceptions to that rule, so the cut job now dispatches both directly,
  // right after it creates the tag/release.
  check(iCreate !== -1 && /gh workflow run release-assets\.yml[^\n]*--ref main[^\n]*-f tag="\$TAG"/.test(cut) && cut.indexOf('gh release create') < cut.indexOf('gh workflow run release-assets.yml'),
    "release-cut.yml dispatches release-assets.yml (with the real tag) after creating the release, not before",
    "release-cut.yml does not dispatch release-assets.yml after tagging - a repeat of the v1.15.0/.3/.4 zero-assets bug");
  check(/gh workflow run release-apple\.yml[^\n]*--ref main/.test(cut), "release-cut.yml also dispatches release-apple.yml");
  for (const [name, text] of [["release-assets.yml", assets], ["release-apple.yml", apple]]) {
    const resolve = stepsOf(jobBlock(text, "resolve")).find((s) => /release-gate\.mjs/.test(s.run || ""));
    check(!!resolve && /--sha "\$\(git rev-parse "\$\{TAG\}\^\{commit\}"\)"/.test(resolve.run), `${name} refuses to build installers from a tag whose commit CI did not pass`);
  }

  const onBlock = (pages.match(/\non:\n([\s\S]*?)\n(?=[a-z]+:\n)/) || ["", ""])[1].split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  check(!/^\s+push:/m.test(onBlock), "pages.yml no longer deploys on every push", "pages.yml still deploys on push, whatever CI says");
  check(/workflow_run:\s*\n\s+workflows: \[CI\]\s*\n\s+types: \[completed\]/.test(onBlock), "pages.yml runs when the CI workflow completes");
  const pagesBuild = jobBlock(pages, "build") || "";
  check(/workflow_run\.conclusion == 'success'/.test(pagesBuild) && /workflow_run\.event == 'push'/.test(pagesBuild), "pages.yml only builds when that CI run SUCCEEDED for a push to main");
  check(/ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/.test(pagesBuild), "pages.yml checks out the exact commit CI tested, not whatever main is by now");
  const manualGate = stepNamed(stepsOf(pagesBuild), "Manual runs need green CI too");
  check(!!manualGate && /workflow_dispatch/.test(manualGate.if || "") && /release-gate\.mjs/.test(manualGate.run || ""), "a manual Pages deploy is held to the same green-CI rule");
  check(/needs\.build\.outputs\.deploy == 'true'/.test(jobBlock(pages, "deploy") || ""), "the deploy job is skipped when the build job decided not to deploy");
  const backwards = stepNamed(stepsOf(pagesBuild), "Never deploy backwards");
  if (backwards && backwards.run && BASH) {
    // A real two-commit history: OLD is an ancestor of NEW.
    const repo = path.join(scratch, "history"); mkdirSync(repo, { recursive: true });
    const git = (...a) => spawnSync("git", a, { cwd: repo, encoding: "utf-8" });
    git("init", "-q"); git("config", "user.email", "t@example.invalid"); git("config", "user.name", "t"); git("config", "commit.gpgsign", "false");
    writeFileSync(path.join(repo, "f"), "1"); git("add", "f"); git("commit", "-q", "-m", "old"); const OLD = git("rev-parse", "HEAD").stdout.trim();
    writeFileSync(path.join(repo, "f"), "2"); git("add", "f"); git("commit", "-q", "-m", "new"); const NEW = git("rev-parse", "HEAD").stdout.trim();
    const attempt = (label, live, deploy) => { const box = sandbox(label); if (live) writeFileSync(path.join(box.dir, "live.txt"), live + "\n"); return runStep(backwards.run, { box, cwd: repo, env: { DEPLOY_SHA: deploy } }); };
    check(/^[0-9a-f]{40}$/.test(OLD) && /deploy=false/.test(attempt("back-old", NEW, OLD).output), "a late-finishing CI run for an OLDER commit never redeploys over a newer live one");
    check(/deploy=true/.test(attempt("back-new", OLD, NEW).output), "a newer green commit deploys over an older live one");
    check(/deploy=true/.test(attempt("back-first", "", NEW).output), "with nothing live yet, a green commit deploys");
  } else bad("pages.yml: no 'Never deploy backwards' step");

  const green = jobBlock(ci, "ci-green");
  const greenStep = stepsOf(green)[0];
  check(!!green && /^    if: always\(\)$/m.test(green) && /needs: \[lint-build-verify, cargo-check, test\]/.test(green), "ci.yml has one always-reporting 'CI green' verdict over the gating jobs");
  if (greenStep && greenStep.run && BASH) {
    const env = (l, c, t) => ({ R_LINT: l, R_CARGO: c, R_TEST: t });
    check(runStep(greenStep.run, { box: sandbox("green-ok"), env: env("success", "success", "success") }).status === 0, "'CI green' passes when every gating job succeeded");
    check(runStep(greenStep.run, { box: sandbox("green-skip"), env: env("failure", "skipped", "skipped") }).status !== 0, "'CI green' FAILS when the test matrix was skipped (a skipped check used to look like nothing was wrong)");
    check(runStep(greenStep.run, { box: sandbox("green-cancel"), env: env("success", "success", "cancelled") }).status !== 0, "'CI green' fails on a cancelled test matrix");
  } else bad("ci.yml: no runnable 'CI green' step");

  /* ===================================================================
     4. Android degrades honestly when there are no signing secrets
     =================================================================== */
  console.log("\n4. Android with no signing secrets: skip with a clear notice, never fail the release run");
  const signStep = stepNamed(androidSteps, "Check for Android signing secrets");
  if (!signStep || !signStep.run || !BASH) bad("release-assets.yml: the Android job has no 'Check for Android signing secrets' step");
  else {
    const none = runStep(signStep.run, { box: sandbox("sign-none"), env: { VERSION: "9.9.9", TAG: "v9.9.9", KEYSTORE_B64: "", KEYSTORE_PASSWORD: "", KEY_ALIAS: "", KEY_PASSWORD: "" } });
    check(none.status === 0 && /signing=absent/.test(none.output), "no signing secrets: the step succeeds and reports signing=absent", "no signing secrets still fails the Android job: " + none.stderr + none.stdout);
    check(/::notice/.test(none.stdout) && /GUIDON-android\.apk/.test(none.stdout) && /finalize_only/.test(none.stdout), "the notice names the files the owner attaches and what to run afterwards");
    check(/GUIDON-9\.9\.9-android\.apk/.test(none.summary) && /GUIDON-9\.9\.9-android\.aab/.test(none.summary) && /release-runbook\.md/.test(none.summary), "the run summary lists all three Android files and points at the runbook");
    const all = runStep(signStep.run, { box: sandbox("sign-all"), env: { VERSION: "9.9.9", TAG: "v9.9.9", KEYSTORE_B64: "x", KEYSTORE_PASSWORD: "x", KEY_ALIAS: "x", KEY_PASSWORD: "x" } });
    check(all.status === 0 && /signing=present/.test(all.output), "all four secrets present: signing=present, so the job builds and signs here");
    const half = runStep(signStep.run, { box: sandbox("sign-half"), env: { VERSION: "9.9.9", TAG: "v9.9.9", KEYSTORE_B64: "x", KEYSTORE_PASSWORD: "", KEY_ALIAS: "x", KEY_PASSWORD: "" } });
    check(half.status !== 0 && /KEYSTORE_PASSWORD/.test(half.stdout) && !/signing=/.test(half.output), "half-configured signing is a hard failure that names what is missing");
    check(!/KEYSTORE_B64"?\s*(>|\|)|echo[^\n]*\$\{?KEYSTORE|echo[^\n]*\$\{?KEY_PASSWORD/.test(signStep.run), "the presence check never prints or writes a secret's value");
    const iSign = androidSteps.indexOf(signStep);
    const ungated = androidSteps.slice(iSign + 1).filter((s) => !/steps\.sign\.outputs\.signing == 'present'/.test(s.if || ""));
    check(iSign !== -1 && ungated.length === 0, `every Android step after the check (${androidSteps.length - iSign - 1}) only runs when signing is present`, "these Android steps still run with no signing secrets: " + ungated.map((s) => s.name || s.uses).join(", "));
    const firstCostly = androidSteps.findIndex((s) => /npm ci|setup-java|playwright install/.test(s.text));
    check(iSign < firstCostly, "the secrets check runs before any install or build, so a skip costs seconds");
  }
  const whyStep = stepNamed(finalizeSteps, "Say plainly why this release is not Latest yet");
  if (whyStep && whyStep.run && BASH) {
    const attempt = (label, missing, signing, finalizeOnly = "false") => { const box = sandbox(label); writeFileSync(path.join(box.dir, "verdict.txt"), `release-manifest: v9.9.9 has 9 attached file(s)\n  INCOMPLETE - missing: ${missing}\n`); return runStep(whyStep.run, { box, env: { TAG: "v9.9.9", SIGNING: signing, FINALIZE_ONLY: finalizeOnly } }); };
    const waiting = attempt("why-android", "GUIDON-android.apk, GUIDON-9.9.9-android.apk, GUIDON-9.9.9-android.aab", "absent");
    check(waiting.status === 0 && /::notice/.test(waiting.stdout) && /previous release stays Latest/.test(waiting.summary), "only the Android files missing + no secrets: the run stays green and says the release is waiting on the owner's files");
    check(attempt("why-windows", "GUIDON-windows-setup.exe", "absent").status !== 0, "anything else missing after the jobs ran is a real failure");
    check(attempt("why-finalize", "GUIDON-android.apk", "", "true").status !== 0, "finalize_only on a release that is still incomplete fails (the owner asked for Latest and did not get it)");
  } else bad("release-assets.yml: finalize has no step explaining an incomplete release");
  check(/finalize_only:/.test(assets) && /if: \$\{\{ github\.event_name != 'workflow_dispatch' \|\| !inputs\.finalize_only \}\}/.test(jobBlock(assets, "android") || ""), "finalize_only re-runs only the finalize job (nothing is rebuilt after the owner attaches files)");
  const runbookPath = "docs/release-runbook.md";
  const runbook = existsSync(runbookPath) ? readFileSync(runbookPath, "utf-8") : "";
  check(/GUIDON-android\.apk/.test(runbook) && /android\.aab/.test(runbook) && /finalize_only/.test(runbook) && /apksigner/.test(runbook),
    "docs/release-runbook.md documents the local-signing hand-off (files to attach, signer check, finalize_only)", "docs/release-runbook.md is missing or does not document the Android hand-off");
  check(!/(storePassword|keyPassword)\s*=\s*\S/.test(runbook), "the runbook never contains a signing password");

  /* ===================================================================
     5. No browser suites in the job that gates the whole matrix
     =================================================================== */
  console.log("\n5. The gating CI job stays suite-free");
  const gating = stepsOf(jobBlock(ci, "lint-build-verify"));
  const suiteSteps = gating.filter((s) => /npm run test:|node tools\/test-|run-parallel\.mjs/.test(s.run || ""));
  check(gating.length > 5 && suiteSteps.length === 0, "lint-build-verify runs no test suites (every other job needs it; one flake there would skip the entire matrix)",
    "lint-build-verify runs test suite step(s): " + suiteSteps.map((s) => s.name).join(", "));
  for (const j of ["cargo-check", "test"]) check(/needs: \[?lint-build-verify\]?/.test(jobBlock(ci, j) || ""), `${j} still waits on lint-build-verify (the reason the rule above matters)`);

  /* ===================================================================
     6. A test file that nothing runs is a lint failure
        (tools/lint-ci-matrix.mjs check (d), driven with stand-in copies)
     =================================================================== */
  console.log("\n6. Every tools/test-*.mjs is reachable by CI");
  {
    const lintMatrix = (...args) => spawnSync(process.execPath, ["tools/lint-ci-matrix.mjs", ...args], { encoding: "utf-8" });
    const real = lintMatrix();
    check(real.status === 0 && /PASS {2}\(d\) all \d+ tools\/test-\*\.mjs files are reachable/.test(real.stdout), "the real tree: every test file is in the list, run by a named workflow step, or excluded with a written reason", "lint-ci-matrix fails on the real tree:\n" + real.stdout);
    const realFiles = readdirSync("tools").filter((f) => /^test-.*\.mjs$/.test(f));
    const toolsCopy = path.join(scratch, "tools-copy"); mkdirSync(toolsCopy, { recursive: true });
    for (const f of realFiles) writeFileSync(path.join(toolsCopy, f), "");
    writeFileSync(path.join(toolsCopy, "test-orphan-example.mjs"), "");
    let r = lintMatrix("--tools", toolsCopy);
    check(r.status === 1 && /FAIL {2}\(d\) tools\/test-orphan-example\.mjs is run by nothing in CI \(no npm script runs it\)/.test(r.stdout), "a new test file that nothing runs fails the lint, by name");
    const pkgReal = JSON.parse(readFileSync("package.json", "utf-8"));
    const pkgWith = (edit) => { const p = JSON.parse(JSON.stringify(pkgReal)); edit(p); const file = path.join(scratch, "pkg-" + Math.random().toString(36).slice(2) + ".json"); writeFileSync(file, JSON.stringify(p)); return file; };
    r = lintMatrix("--tools", toolsCopy, "--pkg", pkgWith((p) => { p.scripts["test:orphan-example"] = "node tools/test-orphan-example.mjs"; }));
    check(/test-orphan-example\.mjs is run by nothing in CI \(it has the script test:orphan-example, but that name is not in package\.json's "test" run-parallel list\)/.test(r.stdout),
      "the exact trap that kept recurring - a script entry that is not in the run-parallel list - is named as such");
    r = lintMatrix("--pkg", pkgWith((p) => { p.scripts.test += " test:contrast"; }));
    check(/FAIL {2}\(d\) tools\/test-contrast\.mjs is in the run-parallel list now, so its OUTSIDE_THE_LIST row is stale/.test(r.stdout), "an exclusion row for a suite that IS in the list is stale, and fails");
    const wfCopy = path.join(scratch, "wf-copy"); mkdirSync(wfCopy, { recursive: true });
    writeFileSync(path.join(wfCopy, "ci.yml"), ci.split("\n").filter((l) => /^\s*#/.test(l) || !/netfloor/.test(l)).join("\n"));
    r = lintMatrix("--workflows", wfCopy);
    check(/FAIL {2}\(d\) OUTSIDE_THE_LIST says \.github\/workflows\/ci\.yml runs tools\/test-network-floor\.mjs, but no step in it does/.test(r.stdout), "a row claiming a workflow runs the suite is checked against that workflow (comments do not count)");
    if (/waiting to be added to the list/.test(real.stdout)) {
      r = lintMatrix("--pkg", pkgWith((p) => { p.version = "99.0.0"; }));
      check(/FAIL {2}\(d\) tools\/test-[\w-]+\.mjs has been waiting to join the run-parallel list since/.test(r.stdout), "a new suite still waiting for registration becomes a failure at the next version bump (it cannot linger)");
    } else ok("no suite is waiting for registration");
  }

  /* ===================================================================
     7. The iOS WebKit pre-flight is a real gate again
     The baseline ratchet itself (tolerate the written-down backlog, fail
     on anything new, the list may only shrink) is owned and proven by
     tools/test-ios-webkit-ratchet.mjs. Two agents built that ratchet at
     once during the 2026-09 fix wave; the duplicate helper this section
     used to import was retired at integration. What stays here is the one
     thing that is about the PIPELINE: the step must be blocking.
     =================================================================== */
  console.log("\n7. iOS WebKit pre-flight: the verification step is blocking");
  {
    const ios = readFileSync("../.github/workflows/ios.yml", "utf-8");
    const webkitJob = jobBlock(ios, "webkit") || jobBlock(ios, "webkit-preflight") || jobBlock(ios, "preflight") || "";
    check(/verify-ios-webkit|ios:verify/.test(webkitJob), "ios.yml still runs the WebKit verifier", "could not find the WebKit verification step in ios.yml (job renamed?)");
    const verifyStep = stepsOf(webkitJob).find((s) => /verify-ios-webkit|ios:verify/.test(s.run || ""));
    check(!!verifyStep && !/continue-on-error/.test(verifyStep.text), "the WebKit verification step is blocking (no continue-on-error: a green job means the check passed)", "the WebKit verification step is missing or still has continue-on-error");
    check(existsSync("tools/test-ios-webkit-ratchet.mjs") && existsSync("tools/ios-webkit-baseline.json"), "the baseline ratchet and its own suite are present", "tools/test-ios-webkit-ratchet.mjs or tools/ios-webkit-baseline.json is missing");
  }

  /* ===================================================================
     8. The Mac lane: a fixed-name file, a launch proof, Apple signing.
     None of it may decide whether a release is Latest, and there is no
     macOS runner and no Apple credential here - so the workflow's own step
     scripts are run against stand-in hdiutil / ditto / open / pgrep / pkill /
     sleep, and the parts that need the real tools are said to be unrun.
     =================================================================== */
  console.log("\n8. Mac: fixed-name file, launch proof and Apple signing (none of it can decide Latest)");
  const macJob = jobBlock(apple, "macos");
  const macSteps = stepsOf(macJob);
  const codeOnly = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const appleCode = codeOnly(apple), assetsCode = codeOnly(assets);
  const MAC_NAME = OPTIONAL_ALIASES.macos;
  const stepIdx = (name) => macSteps.findIndex((s) => s.name === name);

  console.log("  8a. the manifest");
  {
    const withoutMac = FULL.filter((n) => !/macos/.test(n));
    check(MAC_NAME === "GUIDON-macos-universal.dmg" && FULL.includes(MAC_NAME), "the Mac fixed name is GUIDON-macos-universal.dmg and is on the list of expected files");
    const none = verdict("9.9.9", withoutMac);
    check(none.complete && none.missingAliases.length === 0 && none.missingOptional.includes(MAC_NAME) && none.macAliasGap === false, "a release with NO Mac build at all is still COMPLETE - the Mac lane can never hold a release out of Latest");
    const half = verdict("9.9.9", [...withoutMac, "GUIDON-9.9.9-macos-universal.dmg"]);
    check(half.complete && half.macAliasGap === true && half.missingAliases.length === 0, "a Mac build under its versioned name only is still COMPLETE, and the missing fixed name is flagged (macAliasGap)");
    const both = verdict("9.9.9", FULL);
    check(both.complete && both.macAliasGap === false && both.missingOptional.length === 0, "a release carrying both Mac names is complete with nothing left over");
    check(expectedAssets("9.9.9").filter((a) => a.required).every((a) => !/macos|ios-simulator/.test(a.name)), "no Apple file is in the REQUIRED set");
    const section = (present) => renderDownloads({ version: "9.9.9", tag: "v9.9.9", repo: "o/r", present });
    const withMac = section([...withoutMac, "GUIDON-9.9.9-macos-universal.dmg", MAC_NAME]);
    check(/\| Mac \| \[GUIDON-9\.9\.9-macos-universal\.dmg\]\(/.test(withMac) && !withMac.includes(MAC_NAME), "the Downloads section's Mac row links the versioned file and never lists the fixed name (the page is for people)");
    const noDmg = section(withoutMac);
    check(!/\| Mac \|/.test(noDmg) && /\| Mac or Linux \|/.test(noDmg), "with no Mac build attached there is no Mac download row, only the browser one (a row is a promise the link works)");
    const box = sandbox("manifest-cli-mac");
    const rel = path.join(box.dir, "release.json"), notes = path.join(box.dir, "notes.md");
    writeFileSync(rel, JSON.stringify({ body: "", assets: [...withoutMac, "GUIDON-9.9.9-macos-universal.dmg"].map((name) => ({ name })) }));
    const cli = spawnSync(process.execPath, ["tools/release-manifest.mjs", "finalize", "--version", "9.9.9", "--tag", "v9.9.9", "--repo", "o/r", "--release-json", rel, "--notes-out", notes], { encoding: "utf-8" });
    check(cli.status === 0 && /COMPLETE/.test(cli.stdout) && /the Mac build is attached as GUIDON-9\.9\.9-macos-universal\.dmg but not as GUIDON-macos-universal\.dmg/.test(cli.stdout), "release-manifest finalize: a Mac build missing its fixed name still exits 0 (complete) and says so", "finalize exited " + cli.status + ": " + cli.stdout);
  }

  console.log("  8b. the fixed-name file is uploaded with the versioned one, and only the Apple lane's own steps depend on it");
  const publishMac = stepNamed(macSteps, "Publish macOS DMG");
  if (!publishMac || !publishMac.run || !BASH) bad("release-apple.yml: no 'Publish macOS DMG' step");
  else {
    const box = sandbox("publish-mac");
    mkdirSync(path.join(box.dir, "release-out"), { recursive: true });
    writeFileSync(path.join(box.dir, "release-out/GUIDON-9.9.9-macos-universal.dmg"), "DMG-BYTES");
    const r = runStep(publishMac.run, { box, env: { VERSION: "9.9.9", TAG: "v9.9.9" } });
    const uploads = r.ghCalls.split("\n").filter((l) => l.startsWith("release upload"));
    check(r.status === 0 && uploads.length === 1 && /--clobber/.test(uploads[0]) && /release-out\/GUIDON-9\.9\.9-macos-universal\.dmg/.test(uploads[0]) && /release-out\/GUIDON-macos-universal\.dmg(\s|$)/.test(uploads[0]),
      "Mac publish step uploads the versioned .dmg AND the never-changing GUIDON-macos-universal.dmg in ONE command", "Mac publish step: " + (uploads.join(" | ") || r.stderr));
    const aliasPath = path.join(box.dir, "release-out/GUIDON-macos-universal.dmg");
    check(existsSync(aliasPath) && readFileSync(aliasPath, "utf-8") === "DMG-BYTES", "GUIDON-macos-universal.dmg is the same bytes as the versioned .dmg");
    const empty = sandbox("publish-mac-none");
    const r2 = runStep(publishMac.run, { box: empty, env: { VERSION: "9.9.9", TAG: "v9.9.9" } });
    check(r2.status !== 0 && !/release upload/.test(r2.ghCalls), "with no .dmg built the publish step fails and uploads nothing (no alias of nothing)");
  }
  check(!!publishMac && !publishMac.if, "Mac publish is not conditional on the launch proof (the proof is informational)");
  {
    // The verification record is most useful exactly when a step above it failed, so it must upload on failure too.
    const rec = stepNamed(macSteps, "Upload macOS verification record");
    check(!!rec && /^(\$\{\{\s*)?always\(\)(\s*\}\})?$/.test(rec.if || ""), "the macOS verification record is uploaded with if: always() (it survives a failed step above it)", "the 'Upload macOS verification record' step has no if: always(): " + JSON.stringify(rec && rec.if));
    check(!!rec && /actions\/upload-artifact@[0-9a-f]{40}$/.test(rec.uses || ""), "...and it is still the SHA-pinned upload-artifact action");
    const proofStep = stepNamed(macSteps, "Prove the DMG launches");
    const tm = proofStep && /^ +timeout-minutes:\s*(\d+)\s*$/m.exec(proofStep.text);
    check(!!tm && Number(tm[1]) >= 5 && Number(tm[1]) <= 15, "the launch proof has its own short timeout-minutes (a hung mount cannot hold the job for the whole 60 minutes)", "'Prove the DMG launches' has no sensible timeout-minutes: " + (tm ? tm[1] : "none"));
  }
  check(!/--latest\b/.test(appleCode), "release-apple.yml never touches the Latest flag (the whole file, not just the refresh job)");
  {
    const waits = needsOf(assetsCode); // scalar, [flow] and block-list forms - the same reader lint-release-state.mjs (f) uses
    check(waits.length >= 4 && !waits.some((w) => /macos|ios|apple/i.test(w)), `no release-assets.yml job waits on an Apple job (${waits.length} needs: lists checked)`, "a release-assets.yml job waits on an Apple job: " + waits.join(" ; "));
    check(!/release-apple/.test(assetsCode) && !/Mac|macOS|dmg/i.test((platformStep && platformStep.text) || ""), "the finalize job that marks Latest never mentions the Apple lane or a Mac file");
    check(/gh workflow run release-apple\.yml[^\n]*--ref main/.test(cut) && /gh workflow run release-assets\.yml[^\n]*--ref main[^\n]*-f tag="\$TAG"/.test(cut), "the release-cut fan-out to both lanes is untouched");
  }
  {
    const uses = new Set([...apple.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]));
    check([...uses].every((u) => /^actions\/(checkout|setup-node|upload-artifact)@[0-9a-f]{40}$/.test(u)), `release-apple.yml adds no new action - every uses: is one of the three already SHA-pinned (${[...uses].length} distinct)`, "release-apple.yml uses: " + [...uses].join(", "));
  }

  console.log("  8c. the launch proof (non-gating), run against stand-in macOS tools");
  const launch = stepNamed(macSteps, "Prove the DMG launches");
  check(!!launch && launch.id === "launch" && /continue-on-error: true/.test(launch.text), "the launch proof is its own step with continue-on-error: true", "the launch proof is missing or can fail the job");
  check(stepIdx("Verify universal bundle") !== -1 && stepIdx("Verify universal bundle") < stepIdx("Prove the DMG launches") && stepIdx("Prove the DMG launches") < stepIdx("Publish macOS DMG"), "the proof runs after the bundle is verified and packaged, and before the upload");
  check(!!launch && !launch.if && /mount|hdiutil attach/.test(launch.run || "") && /open -n/.test(launch.run || ""), "the proof mounts the built disk image and opens the app copied out of it");
  const stubs = {
    hdiutil: ['#!/usr/bin/env bash', 'echo "hdiutil $*" >> "$STUB_DIR/tool-calls.txt"', 'case "$1" in', '  attach)', '    [ "${STUB_HDIUTIL:-}" = "fail" ] && exit 1',
      '    mp=""; while [ $# -gt 0 ]; do [ "$1" = "-mountpoint" ] && mp="$2"; shift; done', '    mkdir -p "$mp"',
      '    if [ "${STUB_HDIUTIL:-}" != "noapp" ]; then mkdir -p "$mp/GUIDON.app/Contents/MacOS"; echo bin > "$mp/GUIDON.app/Contents/MacOS/guidon"; fi', '    exit 0 ;;', 'esac', 'exit 0', ''],
    ditto: ['#!/usr/bin/env bash', 'echo "ditto $*" >> "$STUB_DIR/tool-calls.txt"', 'cp -R "$1" "$2"', ''],
    open: ['#!/usr/bin/env bash', 'echo "open $*" >> "$STUB_DIR/tool-calls.txt"', '[ "${STUB_OPEN_EXIT:-0}" != "0" ] && exit "$STUB_OPEN_EXIT"', ': > "$STUB_DIR/opened"',
      'if [ -n "${STUB_CRASH:-}" ]; then mkdir -p "$HOME/Library/Logs/DiagnosticReports"; touch -d "now + 30 seconds" "$HOME/Library/Logs/DiagnosticReports/GUIDON-2026-09-25.ips"; fi', 'exit 0', ''],
    pgrep: ['#!/usr/bin/env bash', 'n=0; [ -f "$STUB_DIR/pgrep-n" ] && n="$(cat "$STUB_DIR/pgrep-n")"', 'n=$((n + 1)); echo "$n" > "$STUB_DIR/pgrep-n"', '[ -f "$STUB_DIR/opened" ] || exit 1',
      'case "${STUB_PROC:-stays}" in', '  stays) echo 4242; exit 0 ;;', '  dies) if [ "$n" -le 3 ]; then echo 4242; exit 0; fi; exit 1 ;;', '  *) exit 1 ;;', 'esac', ''],
    pkill: ['#!/usr/bin/env bash', 'echo "pkill $*" >> "$STUB_DIR/tool-calls.txt"', 'exit 0', ''],
    sleep: ['#!/usr/bin/env bash', 'exit 0', ''],
  };
  const proof = (label, opts = {}) => {
    const box = sandbox("proof-" + label);
    for (const [name, lines] of Object.entries(stubs)) { writeFileSync(path.join(box.bin, name), lines.join("\n")); try { chmodSync(path.join(box.bin, name), 0o755); } catch (e) {} }
    if (opts.dmg !== false) { mkdirSync(path.join(box.dir, "release-out"), { recursive: true }); writeFileSync(path.join(box.dir, "release-out/GUIDON-9.9.9-macos-universal.dmg"), "DMG-BYTES"); }
    const r = runStep(launch.run, { box, env: { VERSION: "9.9.9", HOME: fwd(path.join(box.dir, "home")), LAUNCH_HOLD_SECONDS: "5", LAUNCH_START_TIMEOUT: "3",
      STUB_HDIUTIL: opts.hdiutil || "", STUB_PROC: opts.proc || "stays", STUB_OPEN_EXIT: String(opts.open || 0), STUB_CRASH: opts.crash ? "1" : "" } });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf-8") : "");
    return { ...r, log: read(path.join(box.dir, "artifacts/apple-release/macos-launch-proof.txt")), tools: read(path.join(box.dir, "tool-calls.txt")) };
  };
  if (!launch || !launch.run || !BASH) bad("release-apple.yml: no runnable launch-proof step");
  else {
    let p = proof("pass");
    check(p.status === 0 && /result=passed/.test(p.output) && /result=passed/.test(p.log) && /::notice title=macOS launch proof passed/.test(p.stdout), "app stays up and writes no crash report: reported as passed (a notice), exit 0", "pass: " + p.stdout + p.stderr);
    check(/hdiutil attach .*-readonly/.test(p.tools) && /hdiutil detach/.test(p.tools) && /ditto /.test(p.tools) && /open -n --stdout .*GUIDON\.app/.test(p.tools), "it mounts the image read-only, copies the app out, unmounts, and opens the copy", p.tools);
    check(/proof: passed|### macOS launch proof: passed/.test(p.summary) && /never affects whether the release is Latest/.test(p.summary), "the run summary says the result and that it never affects Latest");
    p = proof("dies", { proc: "dies" });
    check(p.status === 0 && /result=failed/.test(p.output) && /::warning title=macOS launch proof did not pass \(failed\)/.test(p.stdout) && /exited on its own/.test(p.log), "app starts and then exits: reported as FAILED (a warning), and the step still exits 0", "dies: " + p.stdout + p.stderr);
    check(/still published/.test(p.stdout) && /do not switch the direct Mac download link on/.test(p.stdout), "a failed proof tells the owner the image is still published and the direct Mac link must stay off");
    p = proof("never", { proc: "never" });
    check(p.status === 0 && /result=never-started/.test(p.output) && /::warning/.test(p.stdout), "no process ever appears: reported as never-started (a warning), exit 0");
    p = proof("crash", { crash: true });
    check(p.status === 0 && /result=failed/.test(p.output) && /crash report/.test(p.log), "a crash report written while the app ran is a FAILED proof even if the process looks alive");
    p = proof("open-error", { open: 1 });
    check(p.status === 0 && /result=failed/.test(p.output) && /would not open the app/.test(p.log), "macOS refusing to open the app is a FAILED proof, exit 0");
    p = proof("noapp", { hdiutil: "noapp" });
    check(p.status === 0 && /result=failed/.test(p.output) && /contains no app/.test(p.log), "a disk image with no app in it is a FAILED proof, exit 0");
    p = proof("mount-fails", { hdiutil: "fail" });
    check(p.status === 0 && /result=inconclusive/.test(p.output) && /::warning title=macOS launch proof could not run/.test(p.stdout) && /says nothing about the app/.test(p.stdout), "an image that will not mount is INCONCLUSIVE, not a verdict on the app, exit 0");
    p = proof("no-dmg", { dmg: false });
    check(p.status === 0 && /result=inconclusive/.test(p.output), "no disk image to open: inconclusive, exit 0");
    check(/pkill /.test(proof("cleanup", { proc: "never" }).tools), "whatever the result, any app copy still running is stopped on the way out");
  }

  console.log("  8d. Apple signing: the same three outcomes as Android, and the secrets go nowhere but the steps that need them");
  const signMac = stepNamed(macSteps, "Check for Apple signing secrets");
  const SIX = { CERT_B64: "APPLE_CERTIFICATE_BASE64", CERT_PASSWORD: "APPLE_CERTIFICATE_PASSWORD", SIGNING_IDENTITY: "APPLE_SIGNING_IDENTITY", NOTARY_APPLE_ID: "APPLE_ID", NOTARY_PASSWORD: "APPLE_APP_SPECIFIC_PASSWORD", NOTARY_TEAM_ID: "APPLE_TEAM_ID" };
  if (!signMac || !signMac.run || !BASH) bad("release-apple.yml: the macOS job has no 'Check for Apple signing secrets' step");
  else {
    const withAll = (v, except = []) => Object.fromEntries(Object.keys(SIX).map((k) => [k, except.includes(k) ? "" : v]));
    const none = runStep(signMac.run, { box: sandbox("apple-none"), env: withAll("", Object.keys(SIX)) });
    check(none.status === 0 && /signing=absent/.test(none.output), "no Apple secrets: the step succeeds and reports signing=absent (the job goes on and builds the ad-hoc .dmg)", "no Apple secrets: " + none.stderr + none.stdout);
    check(/::notice/.test(none.stdout) && /first-open warning/.test(none.stdout) && /mac-first-launch\.md/.test(none.stdout) && Object.values(SIX).every((n) => none.stdout.includes(n)), "the notice says Mac users get the first-open warning, points at the guide, and names all six secrets to add");
    check(Object.values(SIX).every((n) => none.summary.includes(n)) && /not\*\* notarized/.test(none.summary) && /release-runbook\.md/.test(none.summary), "the run summary lists the six secrets, says the app was not notarized, and points at the runbook");
    const SECRET = "s3cr3t-value-that-must-never-appear";
    const all = runStep(signMac.run, { box: sandbox("apple-all"), env: withAll(SECRET) });
    check(all.status === 0 && /signing=present/.test(all.output), "all six present: signing=present, so the job signs and notarizes");
    check(![all.stdout, all.stderr, all.summary, all.output].some((t) => t.includes(SECRET)), "the presence check never prints or writes a secret's value");
    for (const [envName, secretName] of Object.entries(SIX)) {
      const one = runStep(signMac.run, { box: sandbox("apple-missing-" + envName), env: withAll(SECRET, [envName]) });
      check(one.status !== 0 && one.stdout.includes(secretName) && !/signing=/.test(one.output) && !one.stdout.includes(SECRET), `half-configured (only ${secretName} missing) is a hard failure that names it`, `missing ${secretName}: status ${one.status}: ${one.stdout}`);
    }
    const twoMissing = runStep(signMac.run, { box: sandbox("apple-two"), env: withAll(SECRET, ["NOTARY_PASSWORD", "NOTARY_TEAM_ID"]) });
    check(twoMissing.status !== 0 && /APPLE_APP_SPECIFIC_PASSWORD/.test(twoMissing.stdout) && /APPLE_TEAM_ID/.test(twoMissing.stdout), "two missing: both are named in the failure");
  }
  {
    const iSign = stepIdx("Check for Apple signing secrets");
    const costly = macSteps.findIndex((s) => /npm ci|actions\/setup-node|playwright install|tauri build/.test(s.text));
    check(iSign !== -1 && iSign < costly, "the secrets check runs before any install or build, so a half-configured certificate costs seconds");
    const PRESENT = /steps\.apple_sign\.outputs\.signing == 'present'/;
    const signingOnly = ["Import the Developer ID certificate into a temporary keychain", "Build, sign and notarize universal macOS bundle", "Sign, notarize and staple the disk image", "Verify Developer ID signature and notarization", "Remove the temporary keychain"];
    for (const n of signingOnly) { const s = stepNamed(macSteps, n); check(!!s && PRESENT.test(s.if || ""), `"${n}" only runs when all six secrets are present`, `"${n}" is missing or not gated on the secrets`); }
    const plain = stepNamed(macSteps, "Build universal macOS bundle");
    check(!!plain && /steps\.apple_sign\.outputs\.signing != 'present'/.test(plain.if || "") && /tauri build/.test(plain.run || ""), "with no secrets the ordinary ad-hoc build still runs (the Mac .dmg does not depend on Apple credentials)");
    check(!stepNamed(macSteps, "Verify universal bundle").if && !stepNamed(macSteps, "Publish macOS DMG").if, "bundle verification and upload run in both modes");
    const ungated = macSteps.filter((s, i) => i !== iSign && /secrets\./.test(s.text) && !PRESENT.test(s.if || ""));
    check(ungated.length === 0, "no step but the presence check can see a secret unless all six are present", "these steps read secrets ungated: " + ungated.map((s) => s.name || s.uses).join(", "));
    const names = [...new Set([...apple.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
    const base = names.filter((n) => !/^GUIDON_/.test(n));
    check(JSON.stringify(base) === JSON.stringify(Object.values(SIX).sort()) && base.every((n) => names.includes("GUIDON_" + n)), "the workflow reads exactly the six documented secrets, each also accepted with a GUIDON_ prefix like the Android ones", "secrets read: " + names.join(", "));
    check(!/echo[^\n]*\$\{?(CERT_B64|CERT_PASSWORD|SIGNING_IDENTITY|NOTARY_[A-Z_]+|APPLE_[A-Z_]+)\b/.test(appleCode) && !/\bset -[a-z]*x/.test(appleCode), "no script echoes a signing value or turns on command tracing");
    const runbook = readFileSync("docs/release-runbook.md", "utf-8");
    check(Object.values(SIX).every((n) => runbook.includes(n)) && /Turning on the direct Mac download/.test(runbook) && /Prove the DMG launches|launch proof/i.test(runbook), "the runbook documents the six secrets, the direct-download switch and the launch proof");
  }

  console.log("  8e. the Apple lane's release-page refresh says aloud when the fixed name is missing, and never blocks");
  {
    const refresh = stepNamed(stepsOf(appleRefresh), "Refresh the Downloads section");
    if (!refresh || !refresh.run || !BASH) bad("release-apple.yml: refresh_downloads has no 'Refresh the Downloads section' step");
    else {
      const attempt = (label, present) => {
        const box = sandbox("refresh-" + label);
        writeFileSync(path.join(box.dir, "release-view.json"), JSON.stringify({ body: "notes", assets: present.map((name) => ({ name })) }));
        return runStep(refresh.run, { box, cwd: path.resolve(".."), env: { VERSION: "9.9.9", TAG: "v9.9.9" } });
      };
      const withoutMac = FULL.filter((n) => !/macos/.test(n));
      let r = attempt("gap", [...withoutMac, "GUIDON-9.9.9-macos-universal.dmg"]);
      check(r.status === 0 && /::warning title=The fixed-name Mac file is missing/.test(r.stdout) && /release edit v9\.9\.9 .*--notes-file/.test(r.ghCalls) && !/--latest/.test(r.ghCalls), "a Mac build without its fixed name: a warning, the page still refreshed, and the Latest flag untouched", "gap: " + r.status + r.stdout + r.stderr);
      r = attempt("both", FULL);
      check(r.status === 0 && !/::warning/.test(r.stdout) && !/--latest/.test(r.ghCalls), "both Mac names attached: no warning");
      r = attempt("nomac", withoutMac);
      check(r.status === 0 && !/::warning/.test(r.stdout) && !/--latest/.test(r.ghCalls), "no Mac build at all: no warning either (the Mac lane is optional), and the page is still refreshed");
    }
  }

  /* ===================================================================
     9. The firmware is compiled on every change to it (.github/workflows/firmware.yml),
        and the lane-parser host test can no longer be silently skipped on CI
     =================================================================== */
  console.log("\n9. Firmware check: compiled when it changes, host test cannot be skipped on CI");
  {
    const fw = wf("firmware.yml");
    const between = (text, from, to) => { const a = text.indexOf(from); const b = text.indexOf(to, a + from.length); return a === -1 ? "" : text.slice(a, b === -1 ? undefined : b); };
    const onPr = between(fw, "  pull_request:", "  push:"), onPush = between(fw, "  push:", "\nconcurrency:");
    check(/paths:/.test(onPr) && /"firmware\/\*\*"/.test(onPr) && /paths:/.test(onPush) && /"firmware\/\*\*"/.test(onPush) && /branches: \[main\]/.test(onPush),
      "firmware.yml runs on pull requests AND on main, only when firmware/** (or its own suite) changes - it never slows an ordinary pull request", "firmware.yml is not path-filtered to firmware/**");
    check(/"guidon-app\/tools\/test-esp32-lanes\.mjs"/.test(onPr) && /"\.github\/workflows\/firmware\.yml"/.test(onPr), "...and also when its host-test suite or the workflow itself changes");
    check(/^permissions:\n  contents: read$/m.test(fw) && !/contents: write|id-token|actions: write|packages: write/.test(fw), "read-only token: nothing here can publish or write");
    check(!/secrets\./.test(fw) && !/\$\{\{\s*secrets/.test(fw), "no secret is read (the repository has none)");
    const fwUses = [...fw.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]);
    check(fwUses.length >= 4 && fwUses.every((u) => /@[0-9a-f]{40}$/.test(u)), `every one of its ${fwUses.length} \`uses:\` steps (checkout, setup-node, setup-python, cache) is pinned to a full commit SHA`, "an action in firmware.yml is not SHA-pinned: " + fwUses.join(", "));
    check(fwUses.some((u) => /^actions\/setup-python@/.test(u)) && /cache: pip/.test(fw) && fwUses.some((u) => /^actions\/cache@/.test(u)) && /path: ~\/\.platformio/.test(fw), "Python is set up by a pinned action with the pip cache, and PlatformIO's downloads (~/.platformio) are cached, so it is not slow");
    const reqs = existsSync("../firmware/esp32-flashcard-os/requirements-ci.txt") ? readFileSync("../firmware/esp32-flashcard-os/requirements-ci.txt", "utf-8") : "";
    check(/^platformio==\d+\.\d+\.\d+$/m.test(reqs) && /requirements-ci\.txt/.test(fw), "PlatformIO is installed from a requirements file that pins one exact version (a compile failure then means the firmware changed, not the tool)");
    const fwSteps = stepsOf(jobBlock(fw, "compile"));
    const compile = fwSteps.findIndex((s) => /platformio run -e flashcardos/.test(s.run || ""));
    const hostTest = fwSteps.findIndex((s) => /node guidon-app\/tools\/test-esp32-lanes\.mjs/.test(s.run || ""));
    check(compile !== -1 && /test -s \.pio\/build\/flashcardos\/firmware\.bin/.test(fwSteps[compile].run) && !/continue-on-error/.test(jobBlock(fw, "compile") || ""), "the job compiles env:flashcardos (the same `platformio run -e flashcardos` the release runs), insists on a real firmware.bin, and is never continue-on-error", "firmware.yml does not compile env:flashcardos");
    check(hostTest > compile && compile !== -1, "the lane-parser host test runs AFTER the compile - the compile is what fetches the real ArduinoJson it builds against", "firmware.yml does not run test-esp32-lanes after the compile");
    check(!/^\s*CI:/m.test(fw), "nothing overrides the CI environment variable (Actions sets it, and it is what turns a missing ArduinoJson from a SKIP into a failure)");
    const lintPins = (dir) => spawnSync(process.execPath, ["tools/lint-workflow-pins.mjs", "--dir", dir], { encoding: "utf-8" });
    const realPins = lintPins("../.github/workflows");
    check(realPins.status === 0 && readdirSync(WF_DIR).includes("firmware.yml"), "lint-workflow-pins passes on the real workflows, firmware.yml included", "lint-workflow-pins failed: " + realPins.stdout);
    const pinsCopy = path.join(scratch, "wf-copy-pins"); mkdirSync(pinsCopy, { recursive: true });
    for (const f of readdirSync(WF_DIR)) writeFileSync(path.join(pinsCopy, f), f === "firmware.yml" ? wf(f).replace(/(actions\/setup-python)@[0-9a-f]{40}/, "$1@v7") : wf(f));
    const plantedPins = lintPins(pinsCopy);
    check(plantedPins.status === 1 && /firmware\.yml/.test(plantedPins.stdout) && /setup-python@v7/.test(plantedPins.stdout), "verify-the-verifier: an unpinned setup-python in firmware.yml fails lint-workflow-pins, naming the file", "planted @v7 was not caught: " + plantedPins.stdout);
    const lintMatrixNow = spawnSync(process.execPath, ["tools/lint-ci-matrix.mjs"], { encoding: "utf-8" });
    check(lintMatrixNow.status === 0, "lint-ci-matrix still passes with the new workflow and the regenerated chunk block", "lint-ci-matrix failed: " + lintMatrixNow.stdout);

    // ci.yml: the chunk that runs the ESP32 suite gets the pinned ArduinoJson (and only that chunk)
    const testJob = jobBlock(ci, "test") || "";
    const fetchStep = stepNamed(stepsOf(testJob), "Fetch ArduinoJson (pinned) for the ESP32 lane-parser host test");
    const fetchBlock = between(testJob, "      - name: Fetch ArduinoJson", "      - name: Run test chunk");
    check(!!fetchStep && /if: \$\{\{ contains\(matrix\.chunk\.tests, 'test:esp32-lanes'\) \}\}/.test(fetchBlock) && /uses: actions\/checkout@[0-9a-f]{40}/.test(fetchBlock) && /repository: bblanchon\/ArduinoJson/.test(fetchBlock) && /ref: [0-9a-f]{40}\b/.test(fetchBlock) && /path: \.arduinojson/.test(fetchBlock),
      "ci.yml fetches ArduinoJson at a pinned commit SHA, only in the chunk that runs test:esp32-lanes, so that suite's JSON-reading test runs on CI instead of skipping", "ci.yml has no pinned ArduinoJson fetch for the esp32-lanes chunk");
    check(/ARDUINOJSON_DIR: \$\{\{ github\.workspace \}\}\/\.arduinojson\/src/.test(between(testJob, "      - name: Run test chunk", "\n\n") || testJob), "...and the chunk's run step points ARDUINOJSON_DIR at that checkout's src folder", "the run step does not set ARDUINOJSON_DIR");
    const chunkTests = [...testJob.matchAll(/^\s+tests: "([^"]+)"/gm)].map((m) => m[1]);
    check(chunkTests.filter((t) => /(^| )test:esp32-lanes( |$)/.test(t)).length === 1, "exactly one chunk runs test:esp32-lanes, so the fetch's condition matches a real chunk", "chunks running test:esp32-lanes: " + chunkTests.filter((t) => /test:esp32-lanes/.test(t)).length);
    check(/--also desktop\.yml,ios\.yml,firmware\.yml/.test(cut), "release-cut.yml's green-CI gate also looks at the Firmware workflow (a path-filtered one: no run for the commit does not block, a red run does)", "release-cut.yml does not list firmware.yml in its --also gate");

    // The suite itself: with the CI variable set, a missing ArduinoJson FAILS; on a developer machine it only SKIPs.
    const runLanes = (ci) => new Promise((resolve) => {
      const env = { ...process.env, ARDUINOJSON_DIR: "", GUIDON_ESP32_LIBDEPS: path.join(scratch, "no-arduinojson-here") };
      if (ci) env.CI = "true"; else delete env.CI;
      const child = spawn(process.execPath, ["tools/test-esp32-lanes.mjs"], { env });
      let out = ""; child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
      child.on("close", (status) => resolve({ status, out }));
    });
    const [onCi, onDev] = await Promise.all([runLanes(true), runLanes(false)]);
    check(onCi.status === 1 && /FAIL {2}on CI, so this must not be skipped: ArduinoJson is not on this machine/.test(onCi.out) && !/SKIP {2}ArduinoJson/.test(onCi.out), "test-esp32-lanes with CI set and no ArduinoJson FAILS loudly (it used to print SKIP and pass)", "with CI set and no ArduinoJson: exit " + onCi.status + "\n" + onCi.out.split("\n").filter((l) => /ArduinoJson|FAIL|SKIP/.test(l)).join("\n"));
    check(onDev.status === 0 && /SKIP {2}ArduinoJson is not on this machine/.test(onDev.out) && !/FAIL {2}on CI/.test(onDev.out), "...while on a developer machine (no CI variable) the same gap is still only a SKIP, so a plain `node tools/test-esp32-lanes.mjs` keeps working without the library", "with no CI variable and no ArduinoJson: exit " + onDev.status + "\n" + onDev.out.split("\n").filter((l) => /ArduinoJson|FAIL|SKIP/.test(l)).join("\n"));
  }
} catch (e) {
  bad("suite crashed: " + (e && e.stack ? e.stack : e));
} finally {
  try { rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
}

console.log("\n" + (fails ? `RELEASE-PIPELINE TEST: ${fails} FAILURE(S)` : "RELEASE-PIPELINE TEST: all passed"));
process.exit(fails ? 1 : 0);
