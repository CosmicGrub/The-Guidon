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
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { ALIASES, expectedAssets, verdict, renderDownloads, mergeBody, DOWNLOADS_START, DOWNLOADS_END } from "./release-manifest.mjs";
import { decide, gate } from "./release-gate.mjs";

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
  check(JSON.stringify(linked) === JSON.stringify(Object.values(ALIASES).sort()),
    "every file name the app links to is declared in release-manifest.mjs, and nothing extra",
    `the app links to [${linked.join(", ")}] but release-manifest.mjs declares [${Object.values(ALIASES).sort().join(", ")}]`);
  for (const a of expectedAssets("9.9.9").filter((x) => x.alias)) {
    check(a.required === true, `${a.name} is REQUIRED for a release to count as complete`);
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
  check(/^    if: github\.ref == 'refs\/heads\/main'$/m.test(cutJob || ""), "release-cut.yml refuses to cut from any branch but main (a manual run can be started anywhere)");
  check(/^\s+actions: read$/m.test(cut), "release-cut.yml may read Actions runs (needed to see the CI result)");
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
} catch (e) {
  bad("suite crashed: " + (e && e.stack ? e.stack : e));
} finally {
  try { rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
}

console.log("\n" + (fails ? `RELEASE-PIPELINE TEST: ${fails} FAILURE(S)` : "RELEASE-PIPELINE TEST: all passed"));
process.exit(fails ? 1 : 0);
