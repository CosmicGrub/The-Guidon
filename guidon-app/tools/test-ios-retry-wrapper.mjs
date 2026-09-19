/**
 * tools/ios-simulator-run-with-retry.sh, tested on its own (audit R14).
 *
 * The wrapper decides whether the iOS lane is red or green - it gates both
 * .github/workflows/ios.yml and the release workflow - and it had no test.
 * That is how a "release: normalize" commit (24ff2fa) replaced the merged,
 * per-device-deadline version with PR #175's first unbounded draft without
 * anything noticing, and how the merged version's own 180 s deadline (shorter
 * than a healthy device, which takes 200-380 s) went out the door red.
 *
 * It needs no Mac: the wrapper only ever talks to "the verifier" through a
 * summary file and an exit code, so this suite swaps in a stub verifier
 * (IOS_VERIFIER) that follows a per-device, per-attempt script, points the
 * evidence at a temp directory (IOS_EVIDENCE_DIR), and asserts what the REAL
 * wrapper then does - how many times it ran each device, what it wrote, how
 * long it took, what it exited with. Pure bash + node; no browser.
 *
 * Proven here:
 *   - every device passes first time: green, no retry
 *   - a known runner flake is retried exactly ONCE, one device at a time, and
 *     the first attempt's evidence is kept
 *   - a flake that repeats is red (never a third try)
 *   - a deterministic failure is NOT retried
 *   - a flake clause that arrives WITH a real one ("process died after
 *     launch; WKWebView rendered blank") is NOT retried - the old substring
 *     match retried it
 *   - a verifier that hangs is killed at the per-device deadline and retried
 *     once; hanging twice is red; the whole thing stays bounded
 *   - a verifier that dies without a verdict is NOT retried
 *   - a crash report naming the app blocks the retry; one naming some other
 *     process does not
 *   - when the job's time budget is spent, no retry is started
 *   - the default deadline is longer than the slowest healthy device measured
 *
 * bash: on Windows this looks for Git Bash (or $GUIDON_BASH) first, because a
 * bare `bash` on a Windows PATH is usually the WSL launcher.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER = path.join(HERE, "ios-simulator-run-with-retry.sh");
const fwd = (p) => p.split(path.sep).join("/");

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));

function findBash() {
  if (process.env.GUIDON_BASH) return process.env.GUIDON_BASH;
  if (process.platform !== "win32") return "bash";
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")].filter(Boolean);
  for (const r of roots) { const c = path.join(r, "Git", "bin", "bash.exe"); if (existsSync(c)) return c; }
  return "bash";
}
const BASH = findBash();
{
  const probe = spawnSync(BASH, ["-c", "command -v awk sed tr date >/dev/null && echo ready"], { encoding: "utf8" });
  if (probe.error || !/ready/.test(probe.stdout || "")) {
    bad(`no usable bash (tried ${BASH}): ${probe.error ? probe.error.message : (probe.stderr || "").trim() || "awk/sed/tr/date missing"} - on Windows install Git Bash or set GUIDON_BASH`);
    console.log("\n1 FAILURE(S)");
    process.exit(1);
  }
}

/* The stub verifier. It stands in for ios-simulator-run.sh and honours the
   same contract: DEVICES names ONE device, the verdict is a markdown row in
   $IOS_EVIDENCE_DIR/summary.md, per-device evidence goes in a slug directory.
   What it does on each call comes from $STUB_PLAN ("device|attempt|action"). */
const STUB = `#!/usr/bin/env bash
set -u
OUT="$IOS_EVIDENCE_DIR"
mkdir -p "$OUT"
device="$DEVICES"
slug="$(printf '%s' "$device" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed -e 's/^-//' -e 's/-$//')"
n=$(( $(cat "$OUT/.calls-$slug" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$OUT/.calls-$slug"
echo "$device|$n|step_summary=\${GITHUB_STEP_SUMMARY-unset}" >> "$OUT/.calls.log"
action="$(awk -F'|' -v d="$device" -v a="$n" '$1==d && $2==a { print $3; exit }' "$STUB_PLAN")"
mkdir -p "$OUT/$slug"
echo "evidence from attempt $n" > "$OUT/$slug/console.log"
row() { printf '## iOS Simulator verification\\n\\n| Device | Result | Detail |\\n|---|---|---|\\n| %s | %s | %s |\\n' "$device" "$1" "$2" > "$OUT/summary.md"; }
case "$action" in
  pass) row PASS "launched and rendered"; exit 0 ;;
  fail:*) row FAIL "\${action#fail:}"; exit 1 ;;
  appcrash:*) mkdir -p "$OUT/$slug/crashes"; echo '{"app_name":"App","bundleID":"app.guidon.trainer","bug_type":"309"}' > "$OUT/$slug/crashes/App-2026.ips"; row FAIL "\${action#appcrash:}"; exit 1 ;;
  othercrash:*) mkdir -p "$OUT/$slug/crashes"; echo '{"app_name":"mediaanalysisd","bundleID":"com.apple.mediaanalysisd"}' > "$OUT/$slug/crashes/other.ips"; row FAIL "\${action#othercrash:}"; exit 1 ;;
  hang) sleep 60; row PASS "launched and rendered"; exit 0 ;;
  nosummary) exit 1 ;;
  *) echo "stub: no plan for $device attempt $n" >&2; exit 3 ;;
esac
`;

const scratch = await mkdtemp(path.join(os.tmpdir(), "guidon-ios-retry-"));
const stubPath = path.join(scratch, "stub-verifier.sh");
await writeFile(stubPath, STUB.replace(/\r\n/g, "\n"));

let seq = 0;
async function run(plan, { devices = "Phone A,Pad B", env = {} } = {}) {
  const dir = path.join(scratch, "case-" + (++seq));
  await mkdir(dir, { recursive: true });
  const planFile = path.join(dir, "plan.txt");
  await writeFile(planFile, plan.join("\n") + "\n");
  const out = path.join(dir, "evidence");
  const stepSummary = path.join(dir, "step-summary.md");
  const started = Date.now();
  const child = spawn(BASH, [fwd(WRAPPER)], {
    env: { ...process.env, APP_PATH: "/tmp/App.app", DEVICES: devices, IOS_VERIFIER: fwd(stubPath), IOS_EVIDENCE_DIR: fwd(out),
      STUB_PLAN: fwd(planFile), GITHUB_STEP_SUMMARY: fwd(stepSummary), IOS_DEVICE_TIMEOUT: "3", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  // A wrapper that never returns is exactly one of the defects under test -
  // fail that case in 45 s instead of hanging the suite.
  const code = await new Promise((resolve) => {
    const guard = setTimeout(() => { child.kill("SIGKILL"); resolve("HUNG"); }, 45000);
    child.on("close", (c) => { clearTimeout(guard); resolve(c); });
    child.on("error", (e) => { clearTimeout(guard); log += String(e); resolve("SPAWN-ERROR"); });
  });
  const read = async (p) => { try { return (await readFile(p, "utf8")).replace(/\r\n/g, "\n"); } catch (e) { return ""; } };
  const calls = (await read(path.join(out, ".calls.log"))).split("\n").filter(Boolean);
  return { code, log, seconds: (Date.now() - started) / 1000, calls, callsFor: (d) => calls.filter((c) => c.startsWith(d + "|")).length,
    summary: await read(path.join(out, "summary.md")), stepSummary: await read(stepSummary), out, read };
}
const FLAKE = "process died after launch; never progressed past the launch screen";

/* 1 */ {
  const r = await run(["Phone A|1|pass", "Pad B|1|pass"]);
  check(r.code === 0 && r.calls.length === 2, "all devices pass first time: exit 0, each device run once", `all-pass: exit ${r.code}, calls ${JSON.stringify(r.calls)}\n${r.log}`);
  check(r.calls.every((c) => /^(Phone A|Pad B)\|1\|/.test(c)), "the verifier is given ONE device per call, never the whole list", "calls were " + JSON.stringify(r.calls));
  check(/Transient retries used: 0/.test(r.summary) && /All requested devices launched/.test(r.summary), "summary reports zero retries and a verified matrix", "summary: " + r.summary);
  check(r.calls.every((c) => /step_summary=unset/.test(c)) && /## iOS Simulator verification/.test(r.stepSummary) && (r.stepSummary.match(/## iOS Simulator verification/g) || []).length === 1,
    "the job summary gets ONE aggregate verdict (the per-device verifier runs are kept out of it)", "step summary: " + r.stepSummary + " calls " + JSON.stringify(r.calls));
}

/* 2 */ {
  const r = await run(["Phone A|1|fail:" + FLAKE, "Phone A|2|pass", "Pad B|1|pass"]);
  check(r.code === 0, "a known runner flake followed by a clean retry is green", `flake-then-pass exit ${r.code}\n${r.log}`);
  check(r.callsFor("Phone A") === 2 && r.callsFor("Pad B") === 1, "only the flaky device is retried, exactly once", "calls " + JSON.stringify(r.calls));
  check(/evidence from attempt 1/.test(await r.read(path.join(r.out, "attempt-1", "phone-a", "console.log"))) && /evidence from attempt 2/.test(await r.read(path.join(r.out, "phone-a", "console.log"))),
    "first-attempt evidence is kept under attempt-1/, not overwritten by the retry", "attempt-1 evidence missing");
  check(/Phone A \| PASS \| launched and rendered after one transient retry/.test(r.summary) && /Transient retries used: 1/.test(r.summary), "the green row says it needed a retry", "summary: " + r.summary);
  check(/Retried[\s\S]*`Phone A` - process died after launch; never progressed/.test(r.summary), "the flake is written down (device + signature) so the retry rate stays visible", "summary: " + r.summary);
}

/* 3 */ {
  const r = await run(["Phone A|1|fail:never progressed past the launch screen", "Phone A|2|fail:never progressed past the launch screen", "Pad B|1|pass"]);
  check(r.code === 1 && r.callsFor("Phone A") === 2, "a flake that repeats is red after ONE retry - never a third attempt", `exit ${r.code}, calls ${JSON.stringify(r.calls)}`);
  check(r.callsFor("Pad B") === 1 && /Pad B \| PASS/.test(r.summary) && /parity gate remains red/.test(r.summary), "the other device is still verified and the summary says the gate is red", "summary: " + r.summary);
}

/* 4 */ {
  const r = await run(["Phone A|1|fail:WKWebView rendered blank", "Pad B|1|pass"]);
  check(r.code === 1 && r.callsFor("Phone A") === 1, "a deterministic failure (blank web view) is NOT retried", `exit ${r.code}, calls ${JSON.stringify(r.calls)}`);
  check(/non-transient Simulator failure \(WKWebView rendered blank\)/.test(r.log), "...and the log says why", r.log);
}

/* 5 */ {
  const r = await run(["Phone A|1|fail:process died after launch; WKWebView rendered blank", "Phone A|2|pass", "Pad B|1|pass"]);
  check(r.code === 1 && r.callsFor("Phone A") === 1, "a flake clause mixed with a real one is NOT retried (the old substring match retried it to green)", `exit ${r.code}, calls ${JSON.stringify(r.calls)}`);
}

/* 6 */ {
  const r = await run(["Phone A|1|hang", "Phone A|2|pass", "Pad B|1|pass"]);
  check(r.code === 0 && r.callsFor("Phone A") === 2, "a hung verifier is killed at the per-device deadline and retried once", `exit ${r.code}, calls ${JSON.stringify(r.calls)}\n${r.log}`);
  check(r.seconds < 30, `the deadline is enforced: a 60 s hang cost ${r.seconds.toFixed(1)} s with IOS_DEVICE_TIMEOUT=3`, `wrapper took ${r.seconds.toFixed(1)} s - the hang was not bounded`);
  check(/simulator verifier timed out after 3s/.test(r.summary), "the summary records the timeout as the reason for the retry", "summary: " + r.summary);
}

/* 7 */ {
  const r = await run(["Phone A|1|hang", "Phone A|2|hang"], { devices: "Phone A" });
  check(r.code === 1 && r.callsFor("Phone A") === 2 && r.seconds < 40, `hanging twice is red, and still bounded (${r.seconds.toFixed(1)} s)`, `exit ${r.code}, calls ${JSON.stringify(r.calls)}, ${r.seconds.toFixed(1)} s`);
  check(/Phone A \| FAIL \| simulator verifier timed out again after 3s/.test(r.summary), "the red row names the second timeout", "summary: " + r.summary);
}

/* 8 */ {
  const r = await run(["Phone A|1|nosummary", "Pad B|1|pass"]);
  check(r.code === 1 && r.callsFor("Phone A") === 1, "a verifier that dies without a verdict is NOT retried", `exit ${r.code}, calls ${JSON.stringify(r.calls)}`);
  check(/Phone A \| FAIL \| verifier failed before producing a usable device verdict/.test(r.summary), "...and is reported as such", "summary: " + r.summary);
}

/* 9 */ {
  const a = await run(["Phone A|1|appcrash:process died after launch", "Phone A|2|pass"], { devices: "Phone A" });
  check(a.code === 1 && a.callsFor("Phone A") === 1 && /crash report \(App-2026\.ips\)/.test(a.summary), "a crash report naming the app blocks the retry - a real crash is not a runner flake", `exit ${a.code}, calls ${JSON.stringify(a.calls)}, summary ${a.summary}`);
  const b = await run(["Phone A|1|othercrash:process died after launch", "Phone A|2|pass"], { devices: "Phone A" });
  check(b.code === 0 && b.callsFor("Phone A") === 2, "a crash report from some other process does not block the retry", `exit ${b.code}, calls ${JSON.stringify(b.calls)}`);
}

/* 10 */ {
  const r = await run(["Phone A|1|fail:" + FLAKE, "Phone A|2|pass"], { devices: "Phone A", env: { IOS_TOTAL_BUDGET: "0" } });
  check(r.code === 1 && r.callsFor("Phone A") === 1 && /time budget was spent/.test(r.summary), "with the job's time budget spent, no retry is started and the row says so", `exit ${r.code}, calls ${JSON.stringify(r.calls)}, summary ${r.summary}`);
}

/* 11 */ {
  const r = await run([], { devices: "" });
  check(r.code !== 0 && r.calls.length === 0, "no DEVICES: refuses to run rather than reporting an empty green matrix", `exit ${r.code}, calls ${JSON.stringify(r.calls)}`);
}

/* 12 - the number itself. 379 s is the slowest HEALTHY device measured on a
   shared runner (see the wrapper's header); the merged 180 s default failed
   every device on every run. */
{
  const src = (await readFile(WRAPPER, "utf8"));
  const m = src.match(/DEVICE_TIMEOUT="\$\{IOS_DEVICE_TIMEOUT:-(\d+)\}"/);
  check(m && Number(m[1]) >= 500, `default per-device deadline is ${m && m[1]} s - longer than the slowest healthy device measured (379 s)`, "default deadline: " + (m ? m[1] : "not found"));
  check(!/\r/.test(src), "the wrapper is LF-only (a CRLF shell script dies on the macOS runner)", "wrapper contains CR characters");
}

await rm(scratch, { recursive: true, force: true }).catch(() => {});
console.log(fails ? `\n${fails} FAILURE(S)` : "\nIOS RETRY WRAPPER: all passed");
process.exit(fails ? 1 : 0);
