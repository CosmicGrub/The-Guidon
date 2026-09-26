/**
 * "Is this exact commit green?" gate for GUIDON's release and deploy
 * workflows.
 *
 * WHY THIS EXISTS. Nothing used to connect a release or a deploy to the
 * result of CI. release-cut.yml created the permanent vX.Y.Z tag and a public
 * GitHub Release seconds after a push, while CI for that same push was still
 * minutes from a verdict; pages.yml redeployed the live web app (the iPhone
 * install path) from every push whatever CI said. Both happened for real:
 * three of four consecutive PRs were merged red, 1.11.0 and 1.12.0 were
 * version-bumped on red commits, and a build with a script error in it was
 * live for about four hours. This tool is the one place that answers the
 * question, so both workflows ask it the same way.
 *
 * Rules (see decide() - it is pure so tools/test-release-pipeline.mjs can
 * drive it with recorded API shapes):
 *   - the REQUIRED workflow (ci.yml) must have a run for this exact commit,
 *     that run must be finished, and its conclusion must be "success".
 *     The newest run for the commit is the one that counts, so re-running a
 *     red run until it passes is honoured, and a later red re-run is too.
 *   - each ALSO workflow (desktop.yml, ios.yml) is path-filtered, so having
 *     no run for the commit is fine; but a run that exists must be green.
 *   - "still running" and "not started yet" are waited on up to
 *     --wait-minutes (a release-prep push starts CI at the same moment this
 *     gate starts, so waiting is the normal case, not an error path).
 *
 * Usage:
 *   node tools/release-gate.mjs --repo owner/name --sha <40-hex> \
 *        [--workflow ci.yml] [--also desktop.yml,ios.yml,firmware.yml] \
 *        [--wait-minutes 90] [--poll-seconds 30]
 * Needs the GitHub CLI (`gh`) with a token that can read Actions runs
 * (GH_TOKEN in a workflow, plus `permissions: actions: read`).
 * Exit 0 = green. Exit 1 = red, missing, timed out, or could not tell -
 * "could not tell" is deliberately a refusal, never a pass.
 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Newest run first: run_number, then run_attempt, then created_at. */
function newest(runs) {
  return runs.slice().sort((a, b) =>
    (Number(b.run_number) || 0) - (Number(a.run_number) || 0) ||
    (Number(b.run_attempt) || 0) - (Number(a.run_attempt) || 0) ||
    String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
}

/**
 * runs: the `workflow_runs` array GitHub returns for ONE workflow filtered to
 * ONE head_sha. Returns { state: "green" | "red" | "pending" | "none", ... }.
 * Only push/manual runs count: a pull_request run is for a different tree
 * (the PR merge ref), so it can never vouch for a commit on main.
 */
export function decide(runs, sha) {
  const mine = (runs || []).filter((r) => r && r.head_sha === sha && (r.event === "push" || r.event === "workflow_dispatch"));
  if (!mine.length) return { state: "none" };
  const run = newest(mine);
  const where = run.html_url || ("run " + run.id);
  if (run.status !== "completed") return { state: "pending", where, status: run.status };
  if (run.conclusion === "success") return { state: "green", where };
  return { state: "red", where, conclusion: run.conclusion || "unknown" };
}

/**
 * The wait loop, with every outside effect injected.
 *   fetchRuns(workflowFile) -> Promise<workflow_runs[]>
 * Resolves { ok, lines[] } - lines are the human-readable story of the wait.
 */
export async function gate({ sha, required, also = [], waitMs, pollMs, fetchRuns: rawFetch, sleep, now, log = () => {}, maxErrors = 5 }) {
  const deadline = now() + waitMs;
  const lines = [];
  const say = (m) => { lines.push(m); log(m); };
  // One dropped API call must not sink a ninety-minute wait, but an answer
  // that never arrives must never turn into a pass either: a failed read is
  // treated as "keep waiting", and too many in a row is a refusal.
  let errors = 0;
  const UNREADABLE = Symbol("unreadable");
  const fetchRuns = async (wf) => {
    try { const runs = await rawFetch(wf); errors = 0; return runs; }
    catch (e) { errors++; say(`could not read ${wf} (${errors} in a row): ${e && e.message ? e.message : e}`); return UNREADABLE; }
  };
  for (;;) {
    let waiting = null;
    const reqRuns = await fetchRuns(required);
    if (errors > maxErrors) { say("REFUSED: the CI result could not be read, and an unreadable result is never treated as a pass"); return { ok: false, lines }; }
    const req = reqRuns === UNREADABLE ? { state: "unreadable" } : decide(reqRuns, sha);
    if (req.state === "red") { say(`REFUSED: ${required} finished as "${req.conclusion}" on ${sha} (${req.where})`); return { ok: false, lines }; }
    if (req.state === "unreadable") waiting = `${required} could not be read`;
    else if (req.state === "none") waiting = `${required} has not started a run for ${sha} yet`;
    else if (req.state === "pending") waiting = `${required} is still ${req.status} (${req.where})`;
    else {
      for (const wf of also) {
        const alsoRuns = await fetchRuns(wf);
        if (alsoRuns === UNREADABLE) { waiting = `${wf} could not be read`; break; }
        const d = decide(alsoRuns, sha);
        if (d.state === "red") { say(`REFUSED: ${wf} finished as "${d.conclusion}" on ${sha} (${d.where})`); return { ok: false, lines }; }
        if (d.state === "pending") { waiting = `${wf} is still ${d.status} (${d.where})`; break; }
        say(d.state === "none" ? `${wf}: no run for this commit (path-filtered workflow - nothing to wait for)` : `${wf}: green (${d.where})`);
      }
      if (!waiting) { say(`GREEN: ${required} succeeded on ${sha} (${req.where})`); return { ok: true, lines }; }
    }
    if (now() >= deadline) { say(`REFUSED: gave up waiting - ${waiting}`); return { ok: false, lines }; }
    say(`waiting: ${waiting}`);
    await sleep(pollMs);
  }
}

/* --------------------------------------------------------------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
  const repo = argOf("--repo"), sha = argOf("--sha");
  const required = argOf("--workflow") || "ci.yml";
  const also = (argOf("--also") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const waitMin = Number(argOf("--wait-minutes") ?? 90), pollSec = Number(argOf("--poll-seconds") ?? 30);
  if (!repo || !/^[0-9a-f]{40}$/i.test(sha || "") || !(waitMin >= 0) || !(pollSec > 0)) {
    console.error("release-gate: usage: --repo owner/name --sha <40-hex> [--workflow ci.yml] [--also a.yml,b.yml] [--wait-minutes 90] [--poll-seconds 30]");
    process.exit(1);
  }
  const fetchRuns = (wf) => new Promise((resolve, reject) => {
    execFile("gh", ["api", `repos/${repo}/actions/workflows/${wf}/runs?head_sha=${sha}&per_page=30`], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`gh api failed for ${wf}: ${String(stderr || err.message).trim()}`));
      try { resolve(JSON.parse(stdout).workflow_runs || []); } catch (e) { reject(new Error(`gh api returned unparseable JSON for ${wf}`)); }
    });
  });
  try {
    const res = await gate({
      sha, required, also, waitMs: waitMin * 60000, pollMs: pollSec * 1000, fetchRuns,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(),
      log: (m) => console.log("release-gate: " + m),
    });
    if (!res.ok) console.log("::error::This commit is not verified green, so it will not be tagged, released or deployed.");
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    // An API failure is "could not tell", which must never read as a pass.
    console.log("::error::release-gate could not read the CI result: " + (e && e.message ? e.message : e));
    process.exit(1);
  }
}
