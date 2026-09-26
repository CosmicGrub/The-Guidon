/**
 * tools/new-suite.mjs, proven against stand-in copies. Pure node, no browser.
 *
 * The scaffold exists because a new suite kept getting an npm script without
 * ever joining the run-parallel list, so CI never ran it. This suite drives
 * the REAL tool (--pkg / --ci / --tools point it at temp copies of the real
 * package.json and ci.yml) and checks what it leaves behind, byte for byte:
 *
 *   - one run does all four steps: suite file, script, list entry, CI matrix
 *     - and tools/lint-ci-matrix.mjs then passes on the result;
 *   - the script lands next to its alphabetical neighbour, nothing else in
 *     package.json moves, and the file stays valid JSON with exactly one
 *     "test" and one "lint:patterns" key;
 *   - the generated suite is sound (parses, imports only what testkit
 *     exports, clean under the hygiene lint) and FAILS until it is written;
 *   - an existing name is refused and a second --register changes nothing;
 *   - --register repairs the exact trap: a script that is not in the list;
 *   - a package.json that already holds a duplicate "test" or
 *     "lint:patterns" key is refused untouched (JSON.parse would hide it);
 *   - the awkward places: after the LAST script (comma handling), before the
 *     first test:* script, and a CRLF package.json.
 *
 * Until the integrator registers this branch's own new suites, the stand-in
 * starts with them unregistered - so the first thing this suite does is
 * register them in the COPY with --register, exactly as will be done for real.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, bad, check, finish } from "./testkit.mjs";
import * as testkit from "./testkit.mjs";
import { scan } from "./lint-test-hygiene.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const REPO = path.resolve(APP, "..");
const node = (args, opts = {}) => { const r = spawnSync(process.execPath, args, { encoding: "utf8", ...opts }); return { code: r.status, out: (r.stdout || "") + (r.stderr || "") }; };

const root = mkdtempSync(path.join(tmpdir(), "guidon-new-suite-"));
try {
  /* ---- the stand-in: real package.json and ci.yml, a tools/ of empty files ---- */
  const tools = path.join(root, "tools"); mkdirSync(tools);
  const pkg = path.join(root, "package.json");
  const ci = path.join(root, "ci.yml");
  copyFileSync(path.join(APP, "package.json"), pkg);
  copyFileSync(path.join(REPO, ".github", "workflows", "ci.yml"), ci);
  for (const f of readdirSync(HERE).filter((x) => /^test-.*\.mjs$/.test(x))) writeFileSync(path.join(tools, f), "");
  for (const f of ["testkit.mjs", "server.mjs", "dismiss-onboarding.mjs"]) copyFileSync(path.join(HERE, f), path.join(tools, f));
  const FLAGS = ["--pkg", pkg, "--ci", ci, "--tools", tools];
  const scaffold = (...args) => node([path.join(HERE, "new-suite.mjs"), ...args, ...FLAGS]);
  const matrix = (...args) => node([path.join(HERE, "lint-ci-matrix.mjs"), ...args, ...FLAGS]);
  const read = (f) => readFileSync(f, "utf8");
  const scripts = () => JSON.parse(read(pkg)).scripts;
  const list = () => { const t = scripts().test; return t.slice(t.indexOf("run-parallel.mjs") + "run-parallel.mjs".length).trim().split(/\s+/); };
  const keyLines = (text, key) => text.split(/\r?\n/).filter((l) => new RegExp("^\\s*" + JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:").test(l)).length;

  // Anything the real tree has not registered yet is registered in the copy, with the tool itself.
  const pending = [...matrix().out.matchAll(/\(d\) tools\/test-([\w-]+)\.mjs is run by nothing in CI/g)].map((m) => m[1]);
  for (const n of pending) scaffold("--register", n);
  const clean = matrix();
  check(clean.code === 0, `the stand-in starts green${pending.length ? ` (after --register brought in ${pending.length} suite(s) this branch adds: ${pending.join(", ")})` : ""}`, () => clean.out.split("\n").filter((l) => /FAIL/.test(l)).join(" | "));

  /* ---- 1. one run does all four steps ---- */
  const pkg0 = read(pkg), ci0 = read(ci), n0 = list().length;
  const allTests = Object.keys(scripts()).filter((k) => k.startsWith("test:"));
  // A name that sorts straight after an existing script, whatever the scripts are this month: "straight" means no other
  // script sorts between the anchor and the demo name (with test:mos-decks and test:mos-decks-68w both present, the
  // demo "test:mos-decks-zz-scaffold-demo" belongs under -68w, so test:mos-decks is not a valid anchor for it).
  const named = allTests.filter((k) => /^test:[a-z]/.test(k)).sort();
  const straight = named.filter((k) => !named.some((o) => o > k && o < k + "-zz-scaffold-demo"));
  const anchor = straight[Math.floor(straight.length / 2)];
  const NAME = anchor.slice(5) + "-zz-scaffold-demo";
  const first = scaffold(NAME, "Proves the scaffold wires a suite into CI");
  const pkg1 = read(pkg), ci1 = read(ci);
  check(first.code === 0 && existsSync(path.join(tools, "test-" + NAME + ".mjs")), "one run exits 0 and writes tools/test-<name>.mjs", () => first.out);
  check(scripts()["test:" + NAME] === "node tools/test-" + NAME + ".mjs", "the \"test:<name>\" script is added, running that file");
  check(list().length === n0 + 1 && list()[n0] === "test:" + NAME && list().filter((x) => x === "test:" + NAME).length === 1, "test:<name> is appended to the run-parallel list, once");
  const inBlock = ci1.split("\n").filter((l) => /^\s*tests:\s*"/.test(l) && (" " + l.replace(/^\s*tests:\s*"|"\s*$/g, "") + " ").includes(" test:" + NAME + " ")).length;
  const after = matrix();
  check(inBlock === 1 && ci1 !== ci0 && after.code === 0 && /\(d\) all \d+ tools\/test-\*\.mjs files are reachable/.test(after.out),
    "ci.yml's chunk block now carries the suite, and lint-ci-matrix passes on the result - matrix in step, suite reachable", () => after.out.split("\n").filter((l) => /FAIL/.test(l)).join(" | "));

  /* ---- 2. package.json: only what it owns changed ---- */
  const lines0 = pkg0.split("\n"), lines1 = pkg1.split("\n");
  const added = lines1.filter((l) => !lines0.includes(l));
  const removed = lines0.filter((l) => !lines1.includes(l));
  const newLineAt = lines1.findIndex((l) => l.includes("\"test:" + NAME + "\""));
  check(lines1.length === lines0.length + 1 && added.length === 2 && removed.length === 1 && /^\s*"test":/.test(removed[0]) && added.some((l) => l === removed[0].replace(/"(,?)\s*$/, " test:" + NAME + "\"$1")),
    "exactly one line is added and exactly one - the \"test\" list - is edited; every other byte of package.json is as it was", () => JSON.stringify({ added: added.map((l) => l.slice(0, 80)), removed: removed.map((l) => l.slice(0, 80)) }));
  check(lines1[newLineAt - 1].includes(JSON.stringify(anchor)) && /^(\s*)/.exec(lines1[newLineAt])[1] === /^(\s*)/.exec(lines1[newLineAt - 1])[1],
    `the new script sits directly under its alphabetical neighbour ("${anchor}"), indented like it`, () => lines1.slice(newLineAt - 1, newLineAt + 1).join(" / "));
  check(keyLines(pkg1, "test") === 1 && keyLines(pkg1, "lint:patterns") === 1 && keyLines(pkg1, "test:" + NAME) === 1 && !pkg1.includes("\r"),
    "still exactly one \"test\" key, one \"lint:patterns\" key and one \"test:<name>\" key, LF-only");

  /* ---- 3. the generated suite ---- */
  const suiteFile = path.join(tools, "test-" + NAME + ".mjs");
  const suite = read(suiteFile);
  const parses = node(["--check", suiteFile]);
  const imported = (/import \{([^}]+)\} from "\.\/testkit\.mjs"/.exec(suite) || [, ""])[1].split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = imported.filter((n) => !(n in testkit));
  check(parses.code === 0 && imported.length >= 6 && unknown.length === 0, `the generated suite parses and imports only what tools/testkit.mjs really exports (${imported.length} names)`, () => parses.out + " unknown: " + unknown.join(","));
  const dirt = scan(suite);
  check(dirt.length === 0 && /liveCount\(page/.test(suite) && /waitForRoute\(page/.test(suite) && /expectNoConsoleNoise\(noise\)/.test(suite) && /bootApp\(/.test(suite),
    "it is clean under the hygiene lint, and starts from bootApp / waitForRoute / liveCount / the console-noise check", () => JSON.stringify(dirt));
  check(suite.includes("Proves the scaffold wires a suite into CI") && suite.includes("await finish(" + JSON.stringify(NAME.replace(/-/g, " ").toUpperCase()) + ")"), "the description and the summary label come from the command line");

  /* ---- 4. refusing, and idempotence ---- */
  const again = scaffold(NAME, "second time");
  check(again.code === 1 && /already exists/.test(again.out) && /--register/.test(again.out) && read(pkg) === pkg1 && read(ci) === ci1 && read(suiteFile) === suite,
    "an existing name is refused, says how to register instead, and changes nothing", () => again.out);
  const reg = scaffold("--register", NAME);
  check(reg.code === 0 && /already fully registered - nothing to do/.test(reg.out) && read(pkg) === pkg1 && read(ci) === ci1, "--register on a fully registered suite is a no-op, byte for byte (run it as often as you like)", () => reg.out);
  for (const [bogus, why] of [["Bad_Name", /not a suite name/], ["test-foo", /leave the "test-" prefix off/], ["foo.mjs", /not a suite name/]]) {
    const r = scaffold(bogus);
    check(r.code === 1 && why.test(r.out) && read(pkg) === pkg1, `the name "${bogus}" is refused with a reason, nothing changed`, () => r.out);
  }

  /* ---- 5. --register repairs the recurring trap: a script that is not in the list ---- */
  const TRAP = "zz-trap-demo";
  writeFileSync(path.join(tools, "test-" + TRAP + ".mjs"), "");
  // ... and a script entry typed in by hand, the way it kept happening: no list entry.
  const anchorLine = read(pkg).split("\n").find((l) => l.trimStart().startsWith(JSON.stringify(anchor) + ":"));
  writeFileSync(pkg, read(pkg).replace(anchorLine, () => /^(\s*)/.exec(anchorLine)[1] + "\"test:" + TRAP + "\": \"node tools/test-" + TRAP + ".mjs\",\n" + anchorLine));
  const trapped = matrix();
  check(trapped.code === 1 && new RegExp("test-" + TRAP + "\\.mjs is run by nothing in CI \\(it has the script test:" + TRAP).test(trapped.out), "the trap, reproduced: a suite with a script entry that is not in the list - lint-ci-matrix names it", () => trapped.out.slice(-600));
  const fixed = scaffold("--register", TRAP);
  check(fixed.code === 0 && /kept\s+"test:zz-trap-demo" \(already a script\)/.test(fixed.out) && list().includes("test:" + TRAP) && keyLines(read(pkg), "test:" + TRAP) === 1 && matrix().code === 0,
    "--register adds only what was missing (the list entry), keeps the one script, and the lint is green again", () => fixed.out);

  /* ---- 6. a duplicate key is refused, not papered over ---- */
  for (const key of ["test", "lint:patterns"]) {
    const good = read(pkg);
    const dupText = good.replace(new RegExp("(\\n\\s*)(" + JSON.stringify(key).replace(/[:]/g, "\\:") + "\\s*:)"), "$1" + JSON.stringify(key) + ": \"echo a stale copy left by a merge\",$1$2");
    writeFileSync(pkg, dupText);
    const parsedFine = (() => { try { JSON.parse(dupText); return true; } catch (e) { return false; } })();
    const r = scaffold("zz-dup-" + key.replace(/[^a-z]/g, ""), "should not be written");
    check(parsedFine && keyLines(dupText, key) === 2 && r.code === 1 && r.out.includes("\"" + key + "\" x2") && /Nothing was changed/.test(r.out) && read(pkg) === dupText && !existsSync(path.join(tools, "test-zz-dup-" + key.replace(/[^a-z]/g, "") + ".mjs")),
      `a package.json with two "${key}" keys still parses (that is the danger) - the tool names the duplicate, writes nothing and creates no suite`, () => r.out);
    writeFileSync(pkg, good);
  }

  /* ---- 7. --node: a pure-node suite that fails until it is written ---- */
  const PURE = "zz-pure-demo";
  const pure = scaffold(PURE, "A pure-node example", "--node");
  const pureFile = path.join(tools, "test-" + PURE + ".mjs");
  const unwritten = node([pureFile]);
  check(pure.code === 0 && !/bootApp/.test(read(pureFile)) && unwritten.code === 1 && (unwritten.out.match(/^ {2}FAIL {2}/gm) || []).length === 1 && /has not been written yet/.test(unwritten.out),
    "--node writes a browser-free suite, and an unwritten scaffold FAILS when run - it cannot sit green in the list guarding nothing", () => pure.out + unwritten.out);
  writeFileSync(pureFile, read(pureFile).replace(/^bad\("TODO:.*$/m, "ok(\"written\");"));
  const written = node([pureFile]);
  check(written.code === 0 && /ZZ PURE DEMO: all passed/.test(written.out), "once its TODO is replaced the same file runs green with the house summary line", () => written.out);

  /* ---- 7b. hostile command lines (each of these did damage before it was refused) ---- */
  {
    // A description is written into the header comment. One that holds the
    // comment's own closing pair - any glob like tools/*/x.mjs does - used to
    // end the comment, and the rest of it ran: the unwritten scaffold printed
    // INJECTED and exited 0 instead of failing on its TODO.
    const HOSTILE = "covers tools/*/x.mjs */ console.log(\"INJECTED\"); process.exit(0); /*\nsecond line";
    const inj = scaffold("zz-inject-demo", HOSTILE, "--node");
    const injFile = path.join(tools, "test-zz-inject-demo.mjs");
    const ran = node([injFile]);
    const headerLines = read(injFile).split("\n").slice(1, read(injFile).split("\n").findIndex((l) => l === " */"));
    check(inj.code === 0 && ran.code === 1 && !/INJECTED/.test(ran.out) && /has not been written yet/.test(ran.out) && headerLines.length > 3 && headerLines.every((l) => l.startsWith(" *")),
      "a description cannot end the header comment: with a glob, a comment-closer and a line break in it, the scaffold still FAILS on its TODO and runs nothing else", () => inj.out + ran.out + JSON.stringify(headerLines.slice(0, 3)));

    // `--pkg` with nothing after it used to fall back to the REAL package.json
    // and edit it. Proven on a COPY of the tool, whose "real" package.json is
    // the stand-in's - so this can never touch the repo's own, whatever the tool does.
    for (const f of ["new-suite.mjs", "lint-ci-matrix.mjs"]) copyFileSync(path.join(HERE, f), path.join(tools, f));
    const pkgBefore = read(pkg);
    const noValue = node([path.join(tools, "new-suite.mjs"), "zz-novalue-demo", "--pkg"]);
    check(noValue.code === 1 && /--pkg needs a path/.test(noValue.out) && read(pkg) === pkgBefore && !existsSync(path.join(tools, "test-zz-novalue-demo.mjs")),
      "a stand-in flag with no path after it is refused - it never falls back to editing the real package.json", () => noValue.out);
    const swallowed = scaffold("zz-novalue-demo", "--tools", "--node");
    check(swallowed.code === 1 && /--tools needs a path/.test(swallowed.out) && read(pkg) === pkgBefore, "nor may it swallow the next option as its path", () => swallowed.out);
    for (const f of ["new-suite.mjs", "lint-ci-matrix.mjs"]) rmSync(path.join(tools, f));

    // Appending only works while the name list ENDS the "test" script.
    const tailed = pkgBefore.replace(JSON.stringify(scripts().test), JSON.stringify(scripts().test + " && node tools/after.mjs"));
    writeFileSync(pkg, tailed);
    const tail = scaffold("zz-tail-demo", "would land after another command");
    check(tailed !== pkgBefore && tail.code === 1 && /something after the run-parallel name list/.test(tail.out) && read(pkg) === tailed && !existsSync(path.join(tools, "test-zz-tail-demo.mjs")),
      "a \"test\" script with a command AFTER the run-parallel list is refused - the name would be reported as added and run by nothing", () => tail.out);
    writeFileSync(pkg, pkgBefore);
  }

  /* ---- 8. awkward places: after the last script, before the first, CRLF ---- */
  {
    const mini = path.join(root, "mini"); mkdirSync(path.join(mini, "tools"), { recursive: true });
    const mpkg = path.join(mini, "package.json"), mci = path.join(mini, "ci.yml");
    const mwf = path.join(mini, "workflows"); mkdirSync(mwf);
    const MF = ["--pkg", mpkg, "--ci", mci, "--tools", path.join(mini, "tools"), "--workflows", mwf];
    const miniPkg = (eol) => ["{", "  \"name\": \"mini\",", "  \"version\": " + JSON.stringify(JSON.parse(read(pkg)).version) + ",", "  \"scripts\": {", "    \"lint:patterns\": \"node tools/lint-ci-matrix.mjs\",", "    \"test\": \"npm run lint:patterns && node tools/run-parallel.mjs test:mid\",", "    \"test:mid\": \"node tools/test-mid.mjs\"", "  }", "}", ""].join(eol);
    writeFileSync(mci, "jobs:\n  test:\n    strategy:\n      matrix:\n        chunk:\n    steps:\n      - run: echo\n");
    writeFileSync(path.join(mini, "tools", "test-mid.mjs"), "");
    writeFileSync(mpkg, miniPkg("\n"));
    // lint-ci-matrix keeps a table of suites that live OUTSIDE the list (device-only
    // suites, one run by another workflow step). Whatever that table holds today,
    // give the mini tree the files and the workflow steps it expects, so the mini
    // tree is green before the scaffold touches it.
    node([path.join(HERE, "lint-ci-matrix.mjs"), "--write", ...MF]);
    for (let pass = 0; pass < 3; pass++) {
      const out = node([path.join(HERE, "lint-ci-matrix.mjs"), ...MF]).out;
      for (const m of out.matchAll(/OUTSIDE_THE_LIST has a row for tools\/(test-[\w-]+\.mjs), which does not exist/g)) writeFileSync(path.join(mini, "tools", m[1]), "");
      for (const m of out.matchAll(/OUTSIDE_THE_LIST says \.github\/workflows\/([\w.-]+) runs tools\/(test-[\w-]+\.mjs), but/g)) {
        const wf = path.join(mwf, m[1]);
        writeFileSync(wf, (existsSync(wf) ? read(wf) : "jobs:\n  other:\n    steps:\n") + "      - run: node tools/" + m[2] + "\n");
      }
    }
    const miniGreen = node([path.join(HERE, "lint-ci-matrix.mjs"), ...MF]);
    check(miniGreen.code === 0, "a minimal stand-in tree (three scripts, one suite) is green before the scaffold touches it", () => miniGreen.out.split("\n").filter((l) => /FAIL/.test(l)).join(" | "));
    const run = (...a) => node([path.join(HERE, "new-suite.mjs"), ...a, ...MF]);

    const last = run("zeta");
    const t1 = read(mpkg);
    check(last.code === 0 && /"test:mid": "node tools\/test-mid\.mjs",\n {4}"test:zeta": "node tools\/test-zeta\.mjs"\n {2}\}/.test(t1) && JSON.parse(t1).scripts["test:zeta"],
      "after the LAST script: the old last line gains its comma, the new last line has none, and the file still parses", () => last.out + t1);
    const firstOne = run("alpha");
    const t2 = read(mpkg);
    check(firstOne.code === 0 && /\n {4}"test:alpha": "node tools\/test-alpha\.mjs",\n {4}"test:mid":/.test(t2) && JSON.parse(t2).scripts.test.endsWith("test:mid test:zeta test:alpha"),
      "a name that sorts before every test:* script goes in front of the first one; the run-parallel list keeps its own (append) order", () => firstOne.out + t2);

    writeFileSync(mpkg, miniPkg("\r\n"));
    rmSync(path.join(mini, "tools", "test-zeta.mjs")); rmSync(path.join(mini, "tools", "test-alpha.mjs"));
    node([path.join(HERE, "lint-ci-matrix.mjs"), "--write", ...MF]);
    const crlf = run("omega");
    const t3 = read(mpkg);
    check(crlf.code === 0 && JSON.parse(t3).scripts["test:omega"] && t3.split("\r\n").length === miniPkg("\r\n").split("\r\n").length + 1 && !/[^\r]\n/.test(t3),
      "a CRLF package.json stays CRLF on every line, including the new one", () => crlf.out + JSON.stringify(t3));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

await finish("NEW SUITE SCAFFOLD");
