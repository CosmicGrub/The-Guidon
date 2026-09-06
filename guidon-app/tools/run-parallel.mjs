// Runs the given npm scripts concurrently as child processes. Each one
// already spins up its own local server (port: 0) and its own browser
// instance with zero shared state, so there's nothing to coordinate here -
// just spawn, prefix their output by name so a failure stays attributable,
// and aggregate exit codes. No deps.
//
// CONCURRENCY. Local runs (CI unset) default to a cap of 6 workers. CI=true
// keeps the unbounded behaviour because ci.yml shards the list into chunks of
// at most 8, so a shard is only ~8 browsers. Run the UNSHARDED list locally
// with no cap, though, and that is every suite in the list at once - well
// over a hundred Chromium instances, each parsing a 12+ MB document, each
// with its own GPU process. On the dev laptop (RTX 4050, 6 GB VRAM per nvidia-smi) that
// produced a video-memory crash mid-run on 2026-09-03.
// GUIDON_TEST_CONCURRENCY=N overrides either way; 0 means unbounded.
//
//     GUIDON_TEST_CONCURRENCY=6 npm test          (bash)
//     $env:GUIDON_TEST_CONCURRENCY=6; npm test     (PowerShell)
//
import { spawn } from "node:child_process";

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error("usage: node tools/run-parallel.mjs <npm-script> [<npm-script> ...]");
  process.exit(1);
}

function prefixed(name, chunk) {
  const lines = chunk.toString().split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => `[${name}] ${line}`).join("\n") + "\n";
}

function run(name) {
  return new Promise((resolve) => {
    // shell: true so this works on Windows too - npm ships as npm.cmd there,
    // and spawning a .cmd directly (no shell) throws EINVAL. Pass one command
    // string (not an args array) so Node doesn't warn about unescaped args -
    // `name` only ever comes from our own hardcoded script list below.
    let child;
    try {
      child = spawn(`npm run ${name}`, { stdio: ["ignore", "pipe", "pipe"], shell: true });
    } catch (err) {
      process.stderr.write(`[${name}] failed to start: ${err.message}\n`);
      resolve({ name, code: 1 });
      return;
    }
    child.stdout.on("data", (chunk) => process.stdout.write(prefixed(name, chunk)));
    child.stderr.on("data", (chunk) => process.stderr.write(prefixed(name, chunk)));
    child.on("error", (err) => {
      process.stderr.write(`[${name}] failed to start: ${err.message}\n`);
      resolve({ name, code: 1 });
    });
    child.on("close", (code) => resolve({ name, code: code ?? 1 }));
  });
}

// Local runs default to 6 so a bare `npm test` on a laptop can never again
// launch the whole matrix at once. 6 until one 8-wide run has been watched
// with GPU memory sampled: the 8 that ci.yml treats as safe per shard was
// never measured on this laptop, while 4 has been measured green (measured
// 2026-09-03: the then-137-suite list green at cap 4 in 473 s). CI (CI=true)
// keeps the original unbounded behaviour because it shards.
// GUIDON_TEST_CONCURRENCY overrides either way; 0 means unbounded.
const parsed = Number.parseInt(process.env.GUIDON_TEST_CONCURRENCY || "", 10);
const cap = Number.isFinite(parsed) ? parsed : (process.env.CI ? 0 : 6);
const results = Number.isFinite(cap) && cap > 0
  ? await runCapped(names, cap)
  : await Promise.all(names.map(run));

// A minimal worker pool: `cap` runners each pull the next name off a shared
// queue until it is empty. Order of completion is not order of the list, but
// every line is name-prefixed so attribution does not depend on ordering.
async function runCapped(list, limit) {
  const queue = [...list];
  const out = [];
  const worker = async () => {
    for (;;) {
      const name = queue.shift();
      if (name === undefined) return;
      out.push(await run(name));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}
const failures = results.filter((r) => r.code !== 0);
for (const { name, code } of failures) {
  console.error(`[run-parallel] "${name}" exited with code ${code}`);
}
if (failures.length > 0) {
  console.error(`[run-parallel] ${failures.length}/${results.length} suites failed`);
  process.exit(1);
}
console.log(`[run-parallel] all ${results.length} suites passed`);
