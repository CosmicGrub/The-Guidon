/**
 * CI matrix lint for GUIDON: keeps .github/workflows/ci.yml's `test` job
 * matrix in lock-step with the test:* list that `npm test` actually runs.
 *
 * `npm test` (guidon-app/package.json) ends in
 *   node tools/run-parallel.mjs <test:* names>
 * and ci.yml's `test` job splits that same list into strategy.matrix.chunk
 * entries of at most PER_CHUNK names each (4 as of 2026-09-07, down from an
 * unmeasured 8 - see PER_CHUNK's own comment; the <=N-concurrent-Chromium
 * ceiling the top of ci.yml explains). Nothing enforced that the two lists agreed, so
 * they drifted: suites added to package.json never reached CI. This tool
 * makes the drift a `npm run lint:patterns` failure, and can regenerate the
 * chunk block from package.json so nobody hand-maintains the copy.
 *
 * Checks (PASS/FAIL lines, exit 1 on any FAIL, style of lint-patterns.mjs):
 *   (a) every run-parallel name in package.json is in exactly one chunk,
 *       every chunk name is in package.json, no chunk exceeds PER_CHUNK
 *       names, and the chunk block is byte-for-byte what --write generates.
 *   (b) header-count guard: ci.yml COMMENT lines that hard-code a suite or
 *       chunk/job count must match the live counts (or carry no count).
 *   (c) one-browser guard: no tools/test-*.mjs launches more than one
 *       browser (chromium|webkit|firefox).launch( at most once per file).
 *   (d) reachability: EVERY tools/test-*.mjs file is either run by a name in
 *       the run-parallel list, or has a row in OUTSIDE_THE_LIST below saying
 *       which workflow runs it instead (checked against that workflow's
 *       text) or exactly why CI cannot run it. A test file nothing runs is a
 *       failure. "Has a script entry but is not in the list" happened five
 *       times in one week; each time the suite looked real and guarded
 *       nothing.
 *
 * `node tools/lint-ci-matrix.mjs --write` regenerates ONLY the lines between
 * `        chunk:` and the `    steps:` that follows it, from package.json's
 * list in its own order, PER_CHUNK names per chunk; every other byte of
 * ci.yml is left alone, output is LF-only, and a second --write changes
 * nothing.
 * `--ci <path>` points the checks at another copy of ci.yml so the verifier
 * can be verified (a copy with one suite removed from a chunk fails, naming
 * it); package.json and tools/ still come from the tree. For the same reason
 * `--tools <dir>`, `--pkg <file>` and `--workflows <dir>` point check (d) at
 * stand-in copies (tools/test-release-pipeline.mjs uses them to prove that an
 * orphaned suite, a wrong workflow row and a stale row each fail).
 * No dependencies; run from anywhere (paths resolve from this file).
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const REPO = path.resolve(APP, "..");
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const PKG = argOf("--pkg") ? path.resolve(argOf("--pkg")) : path.join(APP, "package.json");
const CI = argOf("--ci") || path.join(REPO, ".github", "workflows", "ci.yml");
const TOOLS = argOf("--tools") ? path.resolve(argOf("--tools")) : path.join(APP, "tools");
const WORKFLOWS = argOf("--workflows") ? path.resolve(argOf("--workflows")) : path.join(REPO, ".github", "workflows");
const CI_REL = ".github/workflows/ci.yml";
// Root-cause hunt 2026-09-07 ("no-cards" boot-race PR, CI stabilization):
// 8 was flagged as "never measured" the whole time it stood (see
// run-parallel.mjs's own comment) - it was carried over from a LOCAL
// laptop discipline, never validated against a real 2-vCPU GitHub-hosted
// runner. It has now caused a documented, repeat-offender class of CI
// flake: enterRapidFireFresh()'s own poll (tools/test-rapid-fire-solo-team.mjs)
// was bumped 300ms -> 5000ms -> 15000ms -> 30000ms across three separate
// rounds chasing this exact shape, with the THIRD round explicitly
// concluding the real fix is fewer concurrent Chromiums per shard, not a
// fourth timeout bump - flagged then as a cost tradeoff (more CI jobs)
// outside an autonomous fix's scope to decide alone. Lowered to 4, the
// ONE concurrency figure in this codebase that has an actual measurement
// behind it (run-parallel.mjs: "the then-137-suite list green at cap 4 in
// 473s" on the dev laptop) - roughly doubles the chunk/job count but
// removes the per-shard contention class outright rather than gambling on
// a fifth timeout number.
const PER_CHUNK = 4;
const WRITE = process.argv.includes("--write");

const CHUNK_HEAD = /^\s{8}chunk:\s*$/;
const STEPS_HEAD = /^\s{4}steps:/;
const ENTRY_NAME = /^\s*-\s*name:\s*"([^"]*)"\s*$/;
const ENTRY_TESTS = /^\s*tests:\s*"([^"]*)"\s*$/;
const COMMENT = /^\s*#/;
const BLANK = /^\s*$/;

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

console.log("lint-ci-matrix: ci.yml test matrix vs package.json test script" + (WRITE ? " (--write)" : "") + "\n");

/* ---------------------------------------------------------------------
   package.json: the run-parallel.mjs name list, in its own order.
   --------------------------------------------------------------------- */
const pkg = JSON.parse(await readFile(PKG, "utf-8"));
const testScript = (pkg.scripts && pkg.scripts.test) || "";
const RUNNER = "run-parallel.mjs";
const runnerAt = testScript.indexOf(RUNNER);
if (runnerAt === -1) {
  bad(`package.json scripts.test does not invoke ${RUNNER}`);
  finish();
}
const suites = testScript.slice(runnerAt + RUNNER.length).trim().split(/\s+/).filter(Boolean);
{
  const seen = new Set();
  for (const n of suites) {
    if (seen.has(n)) bad(`package.json scripts.test lists ${n} more than once`);
    seen.add(n);
  }
}

/* ---------------------------------------------------------------------
   ci.yml: locate and parse the chunk block.
   --------------------------------------------------------------------- */
let ci = await readFile(CI, "utf-8");
if (ci.includes("\r")) bad(`${CI_REL} contains CR bytes; this file must be LF-only`);

function locateBlock(lines) {
  const start = lines.findIndex((l) => CHUNK_HEAD.test(l));
  if (start === -1) return null;
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (STEPS_HEAD.test(lines[i])) { end = i; break; }
  }
  if (end === -1) return null;
  return { start, end }; // block = lines[start+1 .. end-1]
}

function parseChunks(lines, start, end) {
  const chunks = [];
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (COMMENT.test(line) || BLANK.test(line)) continue;
    let m = line.match(ENTRY_NAME);
    if (m) { chunks.push({ name: m[1], tests: null, line: i + 1 }); continue; }
    m = line.match(ENTRY_TESTS);
    if (m) {
      const last = chunks[chunks.length - 1];
      if (!last || last.tests !== null) bad(`${CI_REL}:${i + 1} tests: line without a preceding "- name:" entry`);
      else last.tests = m[1].trim().split(/\s+/).filter(Boolean);
      continue;
    }
    bad(`${CI_REL}:${i + 1} unrecognised line inside the chunk block: ${line.trim()}`);
  }
  for (const c of chunks) if (c.tests === null) { bad(`${CI_REL}:${c.line} chunk ${c.name} has no tests: line`); c.tests = []; }
  return chunks;
}

function chunkName(idx, names) {
  return String(idx + 1).padStart(2, "0") + "-" + names.map((n) => n.replace(/^test:/, "").replace(/-/g, "")).join("-");
}

function generateBlock(names) {
  const I = "          "; // 10 spaces: entry indent under "        chunk:"
  const out = [
    `${I}# GENERATED BLOCK - do not hand-edit. Produced by`,
    `${I}#   node tools/lint-ci-matrix.mjs --write`,
    `${I}# (run from guidon-app/) from package.json's "test" script: the`,
    `${I}# tools/run-parallel.mjs name list, in its own order, ${PER_CHUNK} names per`,
    `${I}# chunk. Hand edits here fail \`npm run lint:patterns\`. To add or`,
    `${I}# remove a suite, edit the "test" script in guidon-app/package.json`,
    `${I}# and rerun the --write command above.`,
  ];
  for (let i = 0; i < names.length; i += PER_CHUNK) {
    const group = names.slice(i, i + PER_CHUNK);
    out.push(`${I}- name: "${chunkName(i / PER_CHUNK, group)}"`);
    out.push(`${I}  tests: "${group.join(" ")}"`);
  }
  return out;
}

function regenerate(content, names) {
  const lines = content.split("\n");
  const loc = locateBlock(lines);
  if (!loc) return null;
  const next = lines.slice(0, loc.start + 1).concat(generateBlock(names), lines.slice(loc.end));
  return next.join("\n");
}

/* ---------------------------------------------------------------------
   --write: regenerate the chunk block, touching nothing else.
   --------------------------------------------------------------------- */
if (WRITE) {
  const next = regenerate(ci, suites);
  if (next === null) {
    bad(`${CI_REL}: could not locate the chunk block ("        chunk:" ... "    steps:"), nothing written`);
  } else if (next === ci) {
    ok(`--write: ${CI_REL} chunk block already up to date, nothing written`);
  } else {
    const again = regenerate(next, suites);
    if (again !== next) bad("--write: regeneration is not idempotent (second pass would differ), nothing written");
    else if (next.includes("\r")) bad("--write: generated content contains CR bytes, nothing written");
    else {
      await writeFile(CI, next, "utf-8");
      ci = next;
      ok(`--write: rewrote ${CI_REL} chunk block (${Math.ceil(suites.length / PER_CHUNK)} chunks from ${suites.length} suites)`);
    }
  }
}

/* ---------------------------------------------------------------------
   (a) membership, duplicates, chunk size, block == generated.
   --------------------------------------------------------------------- */
const ciLines = ci.split("\n");
const loc = locateBlock(ciLines);
let chunks = [];
if (!loc) {
  bad(`${CI_REL}: could not locate the chunk block ("        chunk:" ... "    steps:")`);
} else {
  chunks = parseChunks(ciLines, loc.start, loc.end);
  const where = new Map(); // name -> [chunk names]
  for (const c of chunks) for (const n of c.tests) where.set(n, (where.get(n) || []).concat(c.name));
  const suiteSet = new Set(suites);

  let aFails = 0;
  for (const n of suites) if (!where.has(n)) { aFails++; bad(`(a) ${n} is in package.json's test script but in no ci.yml chunk`); }
  for (const [n, cs] of where) {
    if (!suiteSet.has(n)) { aFails++; bad(`(a) ${n} is in ci.yml chunk ${cs.join(", ")} but not in package.json's test script`); }
    if (cs.length > 1) { aFails++; bad(`(a) ${n} appears in ${cs.length} ci.yml chunks: ${cs.join(", ")}`); }
  }
  for (const c of chunks) if (c.tests.length > PER_CHUNK) { aFails++; bad(`(a) ${CI_REL}:${c.line} chunk ${c.name} has ${c.tests.length} names (max ${PER_CHUNK})`); }
  if (aFails === 0) ok(`(a) ${suites.length} suites in package.json, ${chunks.length} chunks in ci.yml, every suite in exactly one chunk, no chunk over ${PER_CHUNK}`);

  const expected = generateBlock(suites).join("\n");
  const actual = ciLines.slice(loc.start + 1, loc.end).join("\n");
  if (expected === actual) ok(`(a) ci.yml chunk block is byte-identical to what --write generates`);
  else bad(`(a) ci.yml chunk block differs from what --write would generate (order, names, or comments); run: node tools/lint-ci-matrix.mjs --write`);
}

/* ---------------------------------------------------------------------
   (b) header-count guard over ci.yml comment lines.
   --------------------------------------------------------------------- */
{
  const liveSuites = suites.length;
  const liveChunks = chunks.length;
  const SUITE_PATTERNS = [/\b(\d+)\s+test:\*/g, /\b(\d+)-suite/g, /\b(\d+)\s+suites?\b/g];
  const CHUNK_PATTERNS = [/\b(\d+)\s+chunks?\b/g, /\b(\d+)\s+(?:test-)?matrix jobs?/g, /other\s+(\d+)\s+jobs/g, /\b(\d+)\s+times\b/g];
  let bFails = 0, scanned = 0;
  ciLines.forEach((line, i) => {
    if (!COMMENT.test(line)) return;
    scanned++;
    for (const re of SUITE_PATTERNS) for (const m of line.matchAll(re)) {
      if (Number(m[1]) !== liveSuites) { bFails++; bad(`(b) ${CI_REL}:${i + 1} says "${m[0]}" but the live suite count is ${liveSuites}: ${line.trim()}`); }
    }
    for (const re of CHUNK_PATTERNS) for (const m of line.matchAll(re)) {
      if (Number(m[1]) !== liveChunks) { bFails++; bad(`(b) ${CI_REL}:${i + 1} says "${m[0]}" but the live chunk count is ${liveChunks}: ${line.trim()}`); }
    }
  });
  if (bFails === 0) ok(`(b) ${scanned} ci.yml comment lines scanned; every hard-coded suite/chunk count matches the live ${liveSuites} suites / ${liveChunks} chunks (or none is stated)`);
}

/* ---------------------------------------------------------------------
   (c) one-browser guard over tools/test-*.mjs.
   --------------------------------------------------------------------- */
{
  const LAUNCH = /\b(chromium|webkit|firefox)\.launch\(/g;
  const files = (await readdir(TOOLS)).filter((f) => /^test-.*\.mjs$/.test(f)).sort();
  const hist = { 0: 0, 1: 0 };
  let cFails = 0;
  for (const f of files) {
    const src = await readFile(path.join(TOOLS, f), "utf-8");
    const n = (src.match(LAUNCH) || []).length;
    if (n > 1) { cFails++; bad(`(c) tools/${f} launches ${n} browsers (max 1 per suite)`); }
    else hist[n]++;
  }
  if (cFails === 0) ok(`(c) ${files.length} tools/test-*.mjs files: ${hist[0]} launch no browser, ${hist[1]} launch exactly one, none launch more`);
}

/* ---------------------------------------------------------------------
   (d) reachability: every tools/test-*.mjs is run by something.

   OUTSIDE_THE_LIST is the ONLY way a test file may stay out of the
   run-parallel list. Each row is one of:
     { workflow: "<file>.yml", why }  another workflow step runs it. Checked:
                                      that workflow's non-comment text must
                                      name the file, or an npm script that
                                      runs it.
     { excluded: "<reason>" }         CI cannot run it at all; say why.
     { awaiting: "<version>", why }   a NEW suite waiting to be added to the
                                      list by whoever integrates the branch
                                      (branches may not edit the shared list
                                      themselves). Tolerated only while
                                      package.json is still at that version:
                                      the next version bump turns it into a
                                      failure, so it cannot linger.
   A row for a file that no longer exists, or for a suite that IS in the
   list, is stale and fails - this table may only describe reality.
   --------------------------------------------------------------------- */
const OUTSIDE_THE_LIST = {
  "test-network-floor.mjs": { workflow: "ci.yml", why: "needs the built web/ + dist/ trees, so it runs in the lint-build-verify job as netfloor:web / netfloor:pwa rather than as a matrix suite" },
  "test-android.mjs": { excluded: "drives the installed app on a physical Android device over adb; CI runners have no device (by hand: npm run test:android)" },
  "test-android-back.mjs": { excluded: "drives the installed app on a physical Android device over adb; CI runners have no device (by hand: npm run test:android:back)" },
  "test-android-external-links.mjs": { excluded: "drives the installed app on a physical Android device over adb; CI runners have no device (by hand: npm run test:android:links)" },
  "test-contrast.mjs": { excluded: "curated predecessor of test:contrast-full, which sweeps every route in every theme and IS in the list (see ci.yml's NOTE on test:contrast)" },
};
{
  const files = (await readdir(TOOLS)).filter((f) => /^test-.*\.mjs$/.test(f)).sort();
  const scripts = pkg.scripts || {};
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\:]/g, "\\$&");
  const runsFile = (cmd, f) => new RegExp("(^|[\\s/])tools/" + esc(f) + "(\\s|$)").test(cmd || "");
  const scriptsFor = (f) => Object.keys(scripts).filter((k) => !k.startsWith("_") && runsFile(scripts[k], f));
  const inList = new Set(files.filter((f) => suites.some((n) => runsFile(scripts[n], f))));
  const counts = { list: 0, workflow: 0, excluded: 0, awaiting: 0 };
  let dFails = 0;
  const dBad = (m) => { dFails++; bad(m); };
  const workflowCode = async (name) => {
    try { return (await readFile(path.join(WORKFLOWS, name), "utf-8")).split("\n").filter((l) => !COMMENT.test(l)).join("\n"); } catch (e) { return null; }
  };
  for (const f of files) {
    const row = OUTSIDE_THE_LIST[f];
    if (inList.has(f)) {
      if (row) dBad(`(d) tools/${f} is in the run-parallel list now, so its OUTSIDE_THE_LIST row is stale - delete the row (tools/lint-ci-matrix.mjs)`);
      else counts.list++;
      continue;
    }
    const names = scriptsFor(f);
    if (!row) {
      dBad(`(d) tools/${f} is run by nothing in CI${names.length ? ` (it has the script ${names.join(", ")}, but that name is not in package.json's "test" run-parallel list)` : " (no npm script runs it)"} - add it to the list and run: node tools/lint-ci-matrix.mjs --write  (or give it an OUTSIDE_THE_LIST row saying what runs it instead)`);
    } else if (row.workflow) {
      const code = await workflowCode(row.workflow);
      const mentioned = code != null && (code.includes("tools/" + f) || names.some((n) => new RegExp("npm run " + esc(n) + "(\\s|$|&)", "m").test(code)));
      if (mentioned) counts.workflow++;
      else dBad(`(d) OUTSIDE_THE_LIST says .github/workflows/${row.workflow} runs tools/${f}, but ${code == null ? "that workflow does not exist" : "no step in it does"}`);
    } else if (row.excluded) {
      if (String(row.excluded).trim().length >= 30) counts.excluded++;
      else dBad(`(d) tools/${f}: an exclusion needs a real reason (30+ characters) saying why CI cannot run it`);
    } else if (row.awaiting) {
      if (pkg.version === row.awaiting) counts.awaiting++;
      else dBad(`(d) tools/${f} has been waiting to join the run-parallel list since ${row.awaiting} and the version is now ${pkg.version} - add it to package.json's "test" list, run --write, and delete its OUTSIDE_THE_LIST row`);
    } else dBad(`(d) tools/${f}: its OUTSIDE_THE_LIST row says neither workflow, excluded nor awaiting`);
  }
  for (const f of Object.keys(OUTSIDE_THE_LIST)) if (!files.includes(f)) dBad(`(d) OUTSIDE_THE_LIST has a row for tools/${f}, which does not exist - delete the row`);
  if (dFails === 0) ok(`(d) all ${files.length} tools/test-*.mjs files are reachable: ${counts.list} in the run-parallel list, ${counts.workflow} run by another workflow step, ${counts.excluded} excluded with a written reason${counts.awaiting ? `, ${counts.awaiting} NEW and waiting to be added to the list (must happen before the next version bump)` : ""}`);
}

finish();

function finish() {
  console.log("\n" + (fails ? `LINT-CI-MATRIX: ${fails} FAILURE(S)` : "LINT-CI-MATRIX: all passed"));
  process.exit(fails ? 1 : 0);
}
