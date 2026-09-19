/**
 * new-suite: start a test suite the way CI will actually run it.
 *
 *   node tools/new-suite.mjs <name> ["one line describing it"] [--node]
 *   node tools/new-suite.mjs --register <name>
 *
 * Why this exists: five times in one week a new tools/test-*.mjs got an npm
 * script but never joined the run-parallel list in package.json's "test"
 * script - so `npm test` and every CI chunk skipped it, and it guarded
 * nothing while looking real. lint-ci-matrix rule (d) now fails on that; this
 * tool is the other half - do all four steps in one go, the same way every
 * time:
 *
 *   1. write tools/test-<name>.mjs from a template built on tools/testkit.mjs
 *      (one browser, onboarding dismissed, no fixed sleeps, no swallowed
 *      waits, deck sizes read from the running app) - or, with --node, a
 *      pure-node one. The template FAILS until you replace its TODO, so an
 *      unwritten scaffold can never sit green in the list;
 *   2. add "test:<name>": "node tools/test-<name>.mjs" to package.json, next
 *      to its alphabetical neighbour among the test:* scripts;
 *   3. append test:<name> to the run-parallel list at the end of "test";
 *   4. run `node tools/lint-ci-matrix.mjs --write` so ci.yml's chunk block
 *      follows.
 *
 * --register does steps 2-4 for a suite file that already exists (written by
 * hand, or arriving from a branch that could not edit package.json). It adds
 * only what is missing, so running it twice changes nothing.
 *
 * It refuses, changing nothing: a name that is not lower-case-and-dashes, a
 * suite or script that already exists, a package.json whose "scripts" are not
 * one per line, a "test" script with anything after the run-parallel name
 * list (an appended name would not reach it), a stand-in flag with no path
 * after it (it must never fall back to the real file), and - the reason it
 * edits TEXT rather than JSON.stringify -
 * a package.json that already holds a DUPLICATE key. Stacked merges have left
 * two "test" keys here before; JSON.parse keeps the last one silently, so the
 * other list is dead weight nobody can see. The result is re-read before it
 * is written: valid JSON, exactly one "test", one "lint:patterns", one
 * "test:<name>", the name in the list exactly once, and nothing else changed.
 *
 * --pkg <file>, --ci <file>, --tools <dir>, --workflows <dir> point it at
 * stand-in copies (tools/test-new-suite-scaffold.mjs proves all of the above
 * against them). No dependencies; run from anywhere.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const REPO = path.resolve(APP, "..");

const VALUE_FLAGS = ["--pkg", "--ci", "--tools", "--workflows"];
const argv = process.argv.slice(2);
const flag = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (VALUE_FLAGS.includes(argv[i])) {
    // A stand-in flag with nothing after it must never fall back to the REAL
    // file: `--pkg` typed last once meant "edit guidon-app/package.json".
    if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) { console.error(`new-suite: ${argv[i]} needs a path after it. Nothing was changed.`); process.exit(1); }
    flag[argv[i]] = argv[++i]; continue;
  }
  if (argv[i].startsWith("--")) { flag[argv[i]] = true; continue; }
  positional.push(argv[i]);
}
const PKG = flag["--pkg"] ? path.resolve(flag["--pkg"]) : path.join(APP, "package.json");
const TOOLS = flag["--tools"] ? path.resolve(flag["--tools"]) : HERE;
const REGISTER = !!flag["--register"];
const PURE_NODE = !!flag["--node"];

const die = (msg) => { console.error("new-suite: " + msg); process.exit(1); };
const known = new Set([...VALUE_FLAGS, "--register", "--node"]);
for (const f of Object.keys(flag)) if (!known.has(f)) die(`unknown option ${f}`);

const name = positional[0];
// The description is written into the suite's header COMMENT, so it must not
// be able to end that comment. A glob such as "tools/*/x.mjs" contains the
// two characters that do, and everything after them became live code: an
// unwritten scaffold that ran whatever followed, and could exit 0 instead of
// failing on its TODO. Kept to one line, with that closing pair broken up.
const describe = (positional[1] || "").replace(/\s+/g, " ").replace(/\*\//g, "* /").trim();
if (!name) die("usage: node tools/new-suite.mjs <name> [\"one line describing it\"] [--node]   |   node tools/new-suite.mjs --register <name>");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) die(`"${name}" is not a suite name - use lower-case words joined by dashes (board-drill-grading), without the "test-" prefix or ".mjs"`);
if (/^test(-|$)/.test(name)) die(`leave the "test-" prefix off - the file becomes tools/test-${name.replace(/^test-?/, "") || "<name>"}.mjs on its own`);
if (positional.length > 2) die("too many arguments - put the description in quotes");

const SCRIPT = "test:" + name;
const FILE = "test-" + name + ".mjs";
const FILE_PATH = path.join(TOOLS, FILE);
const COMMAND = "node tools/" + FILE;

/* ---------------------------------------------------------------------
   A small JSON walker: the direct keys of the object starting at `open`,
   with the text span of each key and value. Reading TEXT is what lets this
   tool see a duplicate key, keep every byte it does not own, and insert a
   line where a person would.
   --------------------------------------------------------------------- */
function stringEnd(text, i) { // i at the opening quote -> index AFTER the closing quote
  for (let j = i + 1; j < text.length; j++) { if (text[j] === "\\") j++; else if (text[j] === "\"") return j + 1; }
  throw new Error("unterminated string in package.json");
}
function valueEnd(text, i) {
  if (text[i] === "\"") return stringEnd(text, i);
  if (text[i] === "{" || text[i] === "[") {
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "\"") { j = stringEnd(text, j) - 1; continue; }
      if (text[j] === "{" || text[j] === "[") depth++;
      else if (text[j] === "}" || text[j] === "]") { depth--; if (depth === 0) return j + 1; }
    }
    throw new Error("unbalanced brackets in package.json");
  }
  let j = i; while (j < text.length && !/[,}\]\s]/.test(text[j])) j++;
  return j;
}
function objectEntries(text, open) {
  const out = [];
  let i = open + 1;
  const ws = () => { while (/\s/.test(text[i])) i++; };
  for (;;) {
    ws();
    if (text[i] === "}") return out;
    if (text[i] !== "\"") throw new Error("expected a key at offset " + i);
    const keyStart = i, keyStop = stringEnd(text, i);
    i = keyStop; ws();
    if (text[i] !== ":") throw new Error("expected ':' at offset " + i);
    i++; ws();
    const valueStart = i, valueStop = valueEnd(text, i);
    out.push({ key: JSON.parse(text.slice(keyStart, keyStop)), keyStart, valueStart, valueStop });
    i = valueStop; ws();
    if (text[i] === ",") { out[out.length - 1].comma = i; i++; }
  }
}
const duplicates = (entries) => { const seen = new Map(); for (const e of entries) seen.set(e.key, (seen.get(e.key) || 0) + 1); return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `"${k}" x${n}`); };

/* ---------------------------------------------------------------------
   Read and judge package.json before touching anything.
   --------------------------------------------------------------------- */
if (!existsSync(PKG)) die(`${PKG} does not exist`);
const before = readFileSync(PKG, "utf8");
const EOL = before.includes("\r\n") ? "\r\n" : "\n";
let parsedBefore;
try { parsedBefore = JSON.parse(before); } catch (e) { die(`${path.basename(PKG)} is not valid JSON (${e.message}) - fix that first`); }

function readScripts(text) {
  const top = objectEntries(text, text.indexOf("{"));
  const topDup = duplicates(top);
  if (topDup.length) die(`${path.basename(PKG)} has duplicate top-level keys (${topDup.join(", ")}) - JSON keeps only the last of each, so one is dead. Merge them by hand first.`);
  const scripts = top.find((e) => e.key === "scripts");
  if (!scripts || text[scripts.valueStart] !== "{") die(`${path.basename(PKG)} has no "scripts" object`);
  const entries = objectEntries(text, scripts.valueStart);
  const dup = duplicates(entries);
  if (dup.length) die(`${path.basename(PKG)} "scripts" holds duplicate keys (${dup.join(", ")}). JSON keeps only the LAST of each, so the earlier one is dead text that still looks live - the usual leftover of two merged branches. Merge them by hand, then run this again. Nothing was changed.`);
  return entries;
}
const entries = readScripts(before);
const testEntry = entries.find((e) => e.key === "test");
if (!testEntry) die(`${path.basename(PKG)} has no "test" script`);
if (!entries.some((e) => e.key === "lint:patterns")) die(`${path.basename(PKG)} has no "lint:patterns" script`);
const testValue = JSON.parse(before.slice(testEntry.valueStart, testEntry.valueStop));
const RUNNER = "run-parallel.mjs";
if (!testValue.includes(RUNNER)) die(`the "test" script does not end in tools/${RUNNER} <names> - this tool only knows how to append to that list`);
const listed = testValue.slice(testValue.indexOf(RUNNER) + RUNNER.length).trim().split(/\s+/).filter(Boolean);
// Appending only reaches run-parallel while its name list is the END of the
// script. With anything after it ("... test:z && node tools/after.mjs") the
// new name would land on that other command: reported as added, run by
// nothing - the very trap this tool exists to close.
const notNames = listed.filter((n) => !/^[\w:.-]+$/.test(n) || n.startsWith("-"));
if (notNames.length) die(`the "test" script has something after the run-parallel name list (${notNames.slice(0, 3).join(" ")} ...) - a name appended there would not reach run-parallel. Move the list to the end of the script first. Nothing was changed.`);

const hasFile = existsSync(FILE_PATH);
const hasScript = entries.some((e) => e.key === SCRIPT);
const inList = listed.includes(SCRIPT);

if (!REGISTER) {
  if (hasFile) die(`tools/${FILE} already exists - pick another name, or register the existing file with: node tools/new-suite.mjs --register ${name}`);
  if (hasScript || inList) die(`package.json already has ${hasScript ? `a "${SCRIPT}" script` : `${SCRIPT} in the run-parallel list`} - pick another name. Nothing was changed.`);
} else {
  if (!hasFile) die(`--register: tools/${FILE} does not exist - create it first (without --register this tool writes it for you)`);
  const current = hasScript ? JSON.parse(before.slice(entries.find((e) => e.key === SCRIPT).valueStart, entries.find((e) => e.key === SCRIPT).valueStop)) : null;
  if (hasScript && !new RegExp("(^|[\\s/])tools/" + FILE.replace(/[.]/g, "\\.") + "(\\s|$)").test(current)) die(`--register: "${SCRIPT}" exists but runs something else (${current}) - fix it by hand`);
}

/* ---------------------------------------------------------------------
   Build the new package.json text (edits applied right-to-left so the
   offsets read above stay true).
   --------------------------------------------------------------------- */
const edits = [];
if (!hasScript) {
  const oneLine = (e) => {
    const lineStart = before.lastIndexOf("\n", e.keyStart) + 1;
    let lineEnd = before.indexOf("\n", e.valueStop); if (lineEnd === -1) lineEnd = before.length;
    if (EOL === "\r\n" && before[lineEnd - 1] === "\r") lineEnd--;
    const lead = before.slice(lineStart, e.keyStart), tail = before.slice(e.valueStop, lineEnd);
    return /^\s*$/.test(lead) && /^\s*,?\s*$/.test(tail) ? { lineStart, lineEnd, indent: lead } : null;
  };
  const tests = entries.filter((e) => e.key.startsWith("test:"));
  if (!tests.length) die(`${path.basename(PKG)} has no test:* scripts to sit next to`);
  // The neighbour: the greatest existing test:* name that sorts before the
  // new one. The list is historical, not sorted, so "alphabetical
  // neighbourhood" means "right after the name you would look for it under".
  const smaller = tests.filter((e) => e.key < SCRIPT).sort((a, b) => (a.key < b.key ? -1 : 1));
  const line = `${JSON.stringify(SCRIPT)}: ${JSON.stringify(COMMAND)}`;
  if (smaller.length) {
    const prev = smaller[smaller.length - 1];
    const at = oneLine(prev);
    if (!at) die(`the "${prev.key}" script does not sit on a line of its own - this tool only edits a one-script-per-line package.json. Nothing was changed.`);
    if (prev.comma === undefined) { // prev is the LAST script: it gains the comma, the new line has none
      edits.push({ at: at.lineEnd, text: EOL + at.indent + line });
      edits.push({ at: prev.valueStop, text: "," });
    } else edits.push({ at: at.lineEnd, text: EOL + at.indent + line + "," });
  } else {
    const next = tests.slice().sort((a, b) => (a.key < b.key ? -1 : 1))[0];
    const at = oneLine(next);
    if (!at) die(`the "${next.key}" script does not sit on a line of its own - this tool only edits a one-script-per-line package.json. Nothing was changed.`);
    edits.push({ at: at.lineStart, text: at.indent + line + "," + EOL });
  }
}
if (!inList) edits.push({ at: testEntry.valueStop - 1, text: " " + SCRIPT });

let after = before;
for (const e of edits.sort((a, b) => b.at - a.at)) after = after.slice(0, e.at) + e.text + after.slice(e.at);

/* Re-read the result exactly the way the next tool will, and refuse to write
   anything that is not precisely "the old file plus this one suite". */
if (edits.length) {
  let parsedAfter;
  try { parsedAfter = JSON.parse(after); } catch (e) { die(`internal error: the edited package.json would not parse (${e.message}). Nothing was changed.`); }
  const again = readScripts(after);
  const count = (k) => again.filter((e) => e.key === k).length;
  const listAfter = parsedAfter.scripts.test.slice(parsedAfter.scripts.test.indexOf(RUNNER) + RUNNER.length).trim().split(/\s+/).filter(Boolean);
  const expected = JSON.parse(JSON.stringify(parsedBefore));
  expected.scripts[SCRIPT] = hasScript ? parsedBefore.scripts[SCRIPT] : COMMAND;
  if (!inList) expected.scripts.test = parsedBefore.scripts.test + " " + SCRIPT;
  const sameValues = (a, b) => JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k]])) === JSON.stringify(Object.keys(b).sort().map((k) => [k, b[k]]));
  const okShape = count("test") === 1 && count("lint:patterns") === 1 && count(SCRIPT) === 1 && listAfter.filter((n) => n === SCRIPT).length === 1
    && sameValues(parsedAfter.scripts, expected.scripts)
    && JSON.stringify({ ...parsedAfter, scripts: 0 }) === JSON.stringify({ ...parsedBefore, scripts: 0 });
  if (!okShape) die("internal error: the edited package.json is not exactly \"the old file plus this suite\". Nothing was changed.");
}

/* ---------------------------------------------------------------------
   Write: the suite file first (an orphan file is what lint-ci-matrix rule
   (d) catches; an orphan script entry is what nothing used to catch).
   --------------------------------------------------------------------- */
const LABEL = name.replace(/-/g, " ").toUpperCase();
if (!REGISTER) writeFileSync(FILE_PATH, (PURE_NODE ? nodeTemplate : browserTemplate)({ name, label: LABEL, describe }), "utf8");
if (edits.length) writeFileSync(PKG, after, "utf8");

const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, "/") || p;
if (!REGISTER) console.log(`  wrote      ${rel(FILE_PATH)}  (${PURE_NODE ? "pure node" : "one browser, on tools/testkit.mjs"})`);
console.log(hasScript ? `  kept       "${SCRIPT}" (already a script)` : `  added      "${SCRIPT}": "${COMMAND}"  -> ${rel(PKG)}`);
console.log(inList ? `  kept       ${SCRIPT} (already in the run-parallel list)` : `  appended   ${SCRIPT} to the "test" run-parallel list (now ${listed.length + 1} suites)`);

const pass = ["--write"];
for (const f of VALUE_FLAGS) if (flag[f]) pass.push(f, path.resolve(flag[f]));
const lint = spawnSync(process.execPath, [path.join(HERE, "lint-ci-matrix.mjs"), ...pass], { encoding: "utf8" });
const lintOut = (lint.stdout || "") + (lint.stderr || "");
const wrote = /--write: rewrote/.test(lintOut);
console.log(`  ci matrix  ${wrote ? "regenerated" : "already up to date"}  (${flag["--ci"] ? rel(path.resolve(flag["--ci"])) : rel(path.join(REPO, ".github", "workflows", "ci.yml"))})`);
if (lint.status !== 0) {
  const fails = lintOut.split("\n").filter((l) => /^\s*FAIL\s/.test(l));
  console.log("\n  lint-ci-matrix still reports:\n" + fails.map((l) => "  " + l).join("\n"));
  console.log(fails.some((l) => l.includes(FILE))
    ? `\nnew-suite: tools/${FILE} is NOT correctly registered yet - see above.`
    : `\nnew-suite: tools/${FILE} is registered; the failure(s) above are about something else and were there before.`);
  process.exit(1);
}
if (!REGISTER) console.log(`\nNext: open ${rel(FILE_PATH)}, replace the TODO (it fails on purpose until you do), then run:  node tools/${FILE}`);
else if (!edits.length && !wrote) console.log(`\n${SCRIPT} was already fully registered - nothing to do.`);
process.exit(0);

/* ---------------------------------------------------------------------
   Templates
   --------------------------------------------------------------------- */
function header({ name, describe }) {
  return `/**
 * ${describe || "TODO: one line saying what this suite proves."}
 *
 * WHY THIS SUITE EXISTS: TODO - say what would ship broken, and go unnoticed,
 * if this file were deleted. Then make every assertion below able to FAIL:
 * run it once against the broken behaviour and watch it go red.
 *
 * Started with tools/new-suite.mjs ${name}. The house rules it starts you
 * with (tools/lint-test-hygiene.mjs holds a new suite to all of them):
 *   - no fixed sleeps: waitForRoute(page, hash, { ready }), until(page, fn),
 *     clickWhenStable(page, target) wait for the STATE instead;
 *   - no swallowed waits: until() returns true/false - assert on what follows;
 *   - no literal deck sizes: liveCount(page, { category | kind }) reads the
 *     running app, so a content change cannot break this suite;
 *   - one browser: bootApp() once; boot.openSession({ viewport, profile }) for
 *     a second viewport, profile or the standalone build (dir: "dist");
 *   - drive the real screen, never stub the thing under test, and end with
 *     the zero-console-noise check.
 */`;
}
function browserTemplate(o) {
  return `${header(o)}
import { bootApp, ok, bad, check, finish, waitForRoute, clickWhenStable, until, liveCount, expectNoConsoleNoise } from "./testkit.mjs";

// Phone width by default: if it fits here it fits everywhere (344px is the
// narrowest screen this app supports - use it when layout is the point).
const boot = await bootApp({ viewport: { width: 390, height: 844 } });
const { page, noise } = boot;

// Deck sizes come from the running app, never from a number typed here.
const cards = await liveCount(page, { kind: "board" });
check(cards > 0, \`the app is serving its question bank (\${cards} cards)\`, "the question bank is empty");

// Go somewhere and wait for the thing you are about to touch - not for time.
await waitForRoute(page, "#/home", { ready: "#route h1, #route h2" });
const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(sideways <= 0, "nothing scrolls sideways at this width", () => "the page is " + sideways + "px too wide");

// TODO(${o.name}): the real assertions. The usual shape of one step:
//   await clickWhenStable(page, page.locator("button", { hasText: /^Start$/ }));
//   await until(page, () => !!document.querySelector("[data-started]"));
//   check(await page.evaluate(() => ...), "what a Soldier would notice", () => "what was there instead");
bad("TODO: tools/test-${o.name}.mjs was scaffolded by tools/new-suite.mjs and has not been written yet");

expectNoConsoleNoise(noise);
await finish(${JSON.stringify(o.label)});
`;
}
function nodeTemplate(o) {
  return `${header(o).replace(" *   - one browser: bootApp() once; boot.openSession({ viewport, profile }) for\n *     a second viewport, profile or the standalone build (dir: \"dist\");\n", " *   - this one is pure node: no browser is launched (cheapest kind of suite);\n")}
import { ok, bad, check, finish } from "./testkit.mjs";

// A verifier (a lint, a build step) must also be shown to FAIL: point it at a
// temp copy with one planted defect, the way tools/test-hygiene-ratchet.mjs does.

// TODO(${o.name}): the real assertions.
//   check(actual === expected, "what is true when this works", () => "what was there instead: " + actual);
bad("TODO: tools/test-${o.name}.mjs was scaffolded by tools/new-suite.mjs and has not been written yet");

await finish(${JSON.stringify(o.label)});
`;
}
