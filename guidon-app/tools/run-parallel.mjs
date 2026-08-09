// Runs the given npm scripts concurrently as child processes. Each one
// already spins up its own local server (port: 0) and its own browser
// instance with zero shared state, so there's nothing to coordinate here -
// just spawn, prefix their output by name so a failure stays attributable,
// and aggregate exit codes. No deps.
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

const results = await Promise.all(names.map(run));
const failures = results.filter((r) => r.code !== 0);
for (const { name, code } of failures) {
  console.error(`[run-parallel] "${name}" exited with code ${code}`);
}
if (failures.length > 0) {
  console.error(`[run-parallel] ${failures.length}/${results.length} suites failed`);
  process.exit(1);
}
console.log(`[run-parallel] all ${results.length} suites passed`);
