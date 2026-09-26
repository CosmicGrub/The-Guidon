/**
 * Regression suite for tools/verify-legal-package.mjs - the tool that keeps
 * GUIDON_COMMAND_LEGAL_PACKAGE.md honest (every sentence maps to a named test,
 * and the document carries a generated stamp of the version and commit it was
 * verified against). A verifier is only worth having if it is shown to FAIL, so
 * every rule is driven with a planted defect, the way tools/test-release-state.mjs
 * and tools/test-module-contract.mjs drive theirs.
 *
 * HOW. No browser. The suite builds a small throwaway repository - a fixture
 * document, a claims map, a package.json and stub test suites - inside a temp
 * directory, and runs the SAME verifyLegalPackage() / runProofs() / CLI that
 * `npm run lint:patterns` and the release step run. One defect at a time is
 * planted and the verifier must name it:
 *
 *   the document: a new sentence, an edited one, a deleted one, two swapped;
 *   the map: a bundled sentence, a missing proof, a non-factual claim with no
 *     reason, an unverifiable claim that names a proof, a partial one with no
 *     gap, a duplicate id, a suite nothing uses;
 *   the proofs: a test that is not in package.json, one that is not on disk,
 *     an anchor that no longer exists in the test, a tagged suite without the
 *     claim's tag;
 *   the stamp: missing, hand-edited, written for another version of the
 *     document or the map, a bad commit, the wrong release version;
 *   --run: a failing suite, a suite that skips itself, a tagged assertion that
 *     never printed a PASS or printed a FAIL, a finding that stopped reproducing;
 *   --write-stamp: only after a passing run, changes nothing but the stamp block
 *     (LF or CRLF), and a second run changes nothing.
 * and against the REAL package and map: the shipped pair passes, and a sentence
 * added to (or a word changed in) a copy of the real document fails.
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, copyFileSync, utimesSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, finish } from "./testkit.mjs";
import { verifyLegalPackage, runProofs, renderStamp, placeStamp, documentStream, interiorBoundaries, tileClaims, summarize, suiteCommand, STAMP_START, STAMP_END, DOC_NAME, MAP_REL } from "./verify-legal-package.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_ROOT = path.resolve(HERE, "..", "..");
const CLI = path.join(HERE, "verify-legal-package.mjs");
const scratch = mkdtempSync(path.join(tmpdir(), "guidon-legal-verifier-"));
let counter = 0;

/* ------------------------------------------------------------------
   The fixture repository
   ------------------------------------------------------------------ */
const DOC = [
  "# Fixture Package", "",
  "> **DRAFT.** This is a fixture.", "",
  "## Section One", "",
  "1. **Purpose.** The app works offline.", "",
  "It never edits text.", "",
  "- [ ] Reviewer option one.", "",
  "| Head A | Head B |", "|---|---|", "| Cell one; cell two | Cell three. |", "",
  "References to the U.S. Army are allowed (for example \"X. Y\").", "",
].join("\n");
const claim = (n, text, rest) => ({ id: "LP-" + String(n).padStart(3, "0"), text, ...rest });
const NF = (reason = "A heading or label; it asserts nothing about the app.") => ({ kind: "non-factual", reason });
const MAP = () => ({
  schema: 1, document: DOC_NAME,
  suites: { "test:alpha": { about: "The stub suite that proves the plain claims." }, "test:beta": { tagged: true, about: "The stub suite whose assertions carry claim tags." } },
  claims: [
    claim(1, "Fixture Package", NF()), claim(2, "DRAFT. This is a fixture.", NF("The document's own status line.")), claim(3, "Section One", NF()), claim(4, "Purpose.", NF()),
    claim(5, "The app works offline.", { kind: "factual", verification: "mechanical", proof: [{ test: "test:alpha", anchor: "the app works offline here" }] }),
    claim(6, "It never edits text.", { kind: "factual", verification: "mechanical", proof: [{ test: "test:beta" }] }),
    claim(7, "Reviewer option one.", NF("A finding option on the reviewer's form.")),
    claim(8, "Head A", NF()), claim(9, "Head B", NF()),
    claim(10, "Cell one", { kind: "factual", verification: "unverifiable", class: "external-citation", reason: "Names an external authority; only a person can compare it with the published one." }),
    claim(11, "cell two", { kind: "factual", verification: "partial", proof: [{ test: "test:alpha", anchor: "the app works offline here" }], gap: "The test proves the cell exists; whether it is right is a human check." }),
    claim(12, "Cell three.", { kind: "factual", verification: "contradicted", proof: [{ test: "test:beta" }], finding: "The app does something else: the fixture pins the disagreement so it cannot be forgotten." }),
    claim(13, "References to the U.S. Army are allowed (for example \"X. Y\").", { kind: "factual", verification: "mechanical", proof: [{ test: "test:alpha", anchor: "the app works offline here" }] }),
  ],
});
const PKG = { name: "fixture", version: "9.9.9", scripts: { "test:alpha": "node tools/test-alpha.mjs", "test:beta": "node tools/test-beta.mjs", "lint:patterns": "node tools/lint-x.mjs" } };
const ALPHA = "console.log(\"  PASS  the app works offline here\");\n";
const BETA = "console.log(\"  PASS  [LP-006] it never edits text\");\nconsole.log(\"  PASS  [LP-012] FINDING CONFIRMED: the app does something else\");\n";
const COMMIT = "a".repeat(40);

function makeRepo({ doc = DOC, map = MAP(), pkg = PKG, alpha = ALPHA, beta = BETA, stamp = true, eol = "\n", init = false } = {}) {
  const root = path.join(scratch, "repo" + ++counter);
  mkdirSync(path.join(root, "guidon-app", "tools"), { recursive: true });
  const put = (rel, text) => writeFileSync(path.join(root, rel), text, "utf8");
  put("guidon-app/package.json", JSON.stringify(pkg, null, 2));
  if (alpha != null) put("guidon-app/tools/test-alpha.mjs", alpha);
  if (beta != null) put("guidon-app/tools/test-beta.mjs", beta);
  const mapText = JSON.stringify(map, null, 1) + "\n";
  put(MAP_REL, mapText);
  let docText = doc.replace(/\n/g, eol);
  put(DOC_NAME, docText);
  if (stamp) restamp(root, { eol });
  if (init) {
    const git = (...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
    git("init", "-q"); git("config", "user.email", "t@example.invalid"); git("config", "user.name", "t"); git("config", "commit.gpgsign", "false"); git("config", "core.autocrlf", "false");
    git("add", "-A"); git("commit", "-q", "-m", "fixture");
  }
  return root;
}
/** Write a fresh, valid stamp for whatever the document and map are NOW (what --write-stamp does after a run). */
function restamp(root, { eol = "\n", version = PKG.version, commit = COMMIT, tree = "clean", overrides = {} } = {}) {
  const res = verifyLegalPackage({ root });
  const block = renderStamp({ version, commit, date: "2026-01-01", tree, docHash: res.docHash, mapHash: res.mapHash, result: "PASS", counts: res.summary, ...overrides });
  const doc = readFileSync(path.join(root, DOC_NAME), "utf8");
  writeFileSync(path.join(root, DOC_NAME), placeStamp(doc, block), "utf8");
  void eol;
}
const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");
const write = (root, rel, text) => writeFileSync(path.join(root, rel), text, "utf8");
const editMap = (root, fn) => { const m = JSON.parse(read(root, MAP_REL)); fn(m); write(root, MAP_REL, JSON.stringify(m, null, 1) + "\n"); };
const has = (res, re) => res.failures.some((f) => re.test(f));
const verify = (root, opts) => verifyLegalPackage({ root, ...opts });
const cli = (root, args) => spawnSync(process.execPath, [CLI, "--root", root, ...args], { encoding: "utf8", cwd: path.join(REAL_ROOT, "guidon-app") });

try {
  console.log("1. The fixture and the real pair");
  {
    const root = makeRepo();
    const r = verify(root);
    check(r.failures.length === 0 && r.summary.total === 13 && r.summary.mechanical === 3 && r.summary.partial === 1 && r.summary.unverifiable === 1 && r.summary.contradicted === 1 && r.summary.nonFactual === 7,
      "the fixture (13 statements: 3 mechanical, 1 partial, 1 unverifiable, 1 contradicted, 7 non-factual) passes the static check with a valid stamp", () => "fixture fails: " + r.failures.join(" | "));
    check(r.notes.some((n) => /OPEN FINDING/.test(n)) && r.notes.some((n) => /partly proved/.test(n)), "an open finding is reported loudly, and partly proved and unverifiable claims are counted, on every run", () => r.notes.join(" | "));
    const real = verifyLegalPackage({ root: REAL_ROOT });
    const nonStamp = real.failures.filter((f) => !/^\(d\)/.test(f));
    check(nonStamp.length === 0 && real.summary.total > 100, "the real package and its real claims map agree (every sentence mapped, every proof present)", () => "real tree: " + nonStamp.join(" | "));
    const pkg = JSON.parse(readFileSync(path.join(REAL_ROOT, "guidon-app", "package.json"), "utf8"));
    check(/node tools\/verify-legal-package\.mjs(?:\s|$|&)/.test(pkg.scripts["lint:patterns"]), "the static check is part of `npm run lint:patterns`", "lint:patterns does not run tools/verify-legal-package.mjs");
    const runbook = readFileSync(path.join(REAL_ROOT, "guidon-app", "docs", "release-runbook.md"), "utf8");
    check(/verify-legal-package\.mjs --run --write-stamp/.test(runbook), "the release runbook names the release-time step (`--run --write-stamp`)", "docs/release-runbook.md does not mention verify-legal-package.mjs --run --write-stamp");
  }

  console.log("\n2. The document cannot drift from the map");
  {
    let root = makeRepo({ stamp: false });
    write(root, DOC_NAME, read(root, DOC_NAME).replace("It never edits text.", "It never edits text. It also never uploads anything."));
    restamp(root);
    check(has(verify(root), /words no claim covers, just before LP-007: "It also never uploads anything\."/), "a sentence added to the document is an unmapped-sentence failure, quoting it", () => verify(root).failures.join(" | "));
    root = makeRepo({ stamp: false });
    write(root, DOC_NAME, read(root, DOC_NAME).replace("The app works offline.", "The app works online."));
    restamp(root);
    let r = verify(root);
    check(has(r, /LP-005: its text is not \(or no longer\) in the document/) && has(r, /words no claim covers/), "an edited sentence fails twice: the old claim is gone from the document, and the new words are uncovered", () => r.failures.join(" | "));
    root = makeRepo({ stamp: false });
    write(root, DOC_NAME, read(root, DOC_NAME).replace("It never edits text.\n\n", ""));
    restamp(root);
    check(has(verify(root), /LP-006: its text is not \(or no longer\) in the document/), "a deleted sentence leaves a claim with nothing to describe, and fails", () => verify(root).failures.join(" | "));
    root = makeRepo({ stamp: false });
    write(root, DOC_NAME, read(root, DOC_NAME).replace("1. **Purpose.** The app works offline.\n\nIt never edits text.", "It never edits text.\n\n1. **Purpose.** The app works offline."));
    restamp(root);
    check(verify(root).failures.length > 0 && has(verify(root), /\(b\)/), "two sentences swapped are out of order and fail", () => verify(root).failures.join(" | "));
    root = makeRepo({ stamp: false });
    write(root, DOC_NAME, read(root, DOC_NAME).replace("It never edits text.", "**It** never `edits`   text."));
    restamp(root);
    check(verify(root).failures.length === 0, "bold, backticks and spacing are not words: reformatting a sentence does not fail", () => verify(root).failures.join(" | "));
    root = makeRepo({ stamp: false });
    write(root, DOC_NAME, read(root, DOC_NAME).replace("## Section One", "<!-- a reviewer's hidden note that renders as nothing -->\n## Section One"));
    restamp(root);
    check(verify(root).failures.length === 0, "an HTML comment (not rendered) is not part of the document", () => verify(root).failures.join(" | "));
    root = makeRepo({ doc: DOC.replace(/\n/g, "\r\n") });
    check(verify(root).failures.length === 0, "a CRLF checkout (core.autocrlf on Windows) verifies exactly like LF", () => verify(root).failures.join(" | "));
    // Text living inside the generated stamp is not the document, and is not left uncovered.
    root = makeRepo();
    check(read(root, DOC_NAME).includes(STAMP_START) && documentStream(read(root, DOC_NAME)) === documentStream(DOC), "the generated stamp block is not part of the document's text", "the stamp leaked into the document stream");
    // Unit level
    check(interiorBoundaries("Whether the U.S. Army, or any agency (see AR 25-30; and \"X. Y\") allows it.").length === 0 && interiorBoundaries("One sentence. Two sentences.").length === 1 && interiorBoundaries("Item one; item two").length === 1,
      "the sentence-boundary rule ignores 'U.S.', parentheses and quotations, and finds a real second sentence or clause", () => JSON.stringify(interiorBoundaries("Whether the U.S. Army, or any agency (see AR 25-30; and \"X. Y\") allows it.")));
    check(tileClaims("alpha, beta; gamma.", [{ id: "LP-001", text: "alpha" }, { id: "LP-002", text: "beta" }, { id: "LP-003", text: "gamma" }]).length === 0 && tileClaims("alpha beta gamma", [{ id: "LP-001", text: "alpha" }, { id: "LP-002", text: "gamma" }]).length === 1,
      "claims tile the text: only punctuation may sit between two claims, any word between them is reported", "tileClaims misjudged");
  }

  console.log("\n3. The map is held to its own rules");
  {
    const cases = [
      ["a factual claim that bundles two sentences", (m) => { m.claims[4].text = "The app works offline. It never edits text."; m.claims.splice(5, 1); }, /LP-005: a factual claim must be ONE sentence or clause/],
      ["a factual claim with no proof", (m) => { m.claims[4].proof = []; }, /LP-005: a mechanical claim must name at least one proof/],
      ["a non-factual claim with no reason", (m) => { m.claims[0].reason = ""; }, /LP-001: a non-factual claim needs a one-line reason/],
      ["an unverifiable claim that names a proof", (m) => { m.claims[9].proof = [{ test: "test:alpha", anchor: "the app works offline here" }]; }, /LP-010: an unverifiable claim names no proof/],
      ["an unverifiable claim with no class", (m) => { delete m.claims[9].class; }, /LP-010: an unverifiable claim needs a class/],
      ["an unverifiable claim with a one-word reason", (m) => { m.claims[9].reason = "external"; }, /LP-010: an unverifiable claim needs a written reason/],
      ["a partial claim with no gap", (m) => { delete m.claims[10].gap; }, /LP-011: a partial claim needs "gap"/],
      ["a contradicted claim with no finding", (m) => { delete m.claims[11].finding; }, /LP-012: a contradicted claim needs "finding"/],
      ["a contradicted claim pinned by an untagged suite", (m) => { m.claims[11].proof = [{ test: "test:alpha", anchor: "the app works offline here" }]; }, /LP-012 proof 1: a contradicted claim is pinned by a tagged suite/],
      ["a mechanical claim that admits a gap", (m) => { m.claims[4].gap = "some part is unproven, which would make it partial"; }, /LP-005: a mechanical claim has no gap or finding/],
      ["a duplicate id", (m) => { m.claims[1].id = "LP-001"; }, /LP-001 is used twice/],
      ["an id that is not LP-nnn", (m) => { m.claims[1].id = "claim-2"; }, /ids look like LP-001/],
      ["a claim whose kind is neither factual nor non-factual", (m) => { m.claims[1].kind = "maybe"; }, /LP-002: kind must be one of/],
      ["a suite the map lists but no claim uses", (m) => { m.suites["test:gamma"] = { about: "A suite nothing points at." }; }, /lists suite "test:gamma" but no claim uses it/],
      ["a proof to a suite with no description", (m) => { delete m.suites["test:alpha"].about; }, /"test:alpha" needs an entry in the map's "suites"/],
      ["a proof that names both a test and a lint", (m) => { m.claims[4].proof[0].lint = "tools/lint-x.mjs"; }, /names exactly one of "test"/],
    ];
    for (const [name, mutate, want] of cases) {
      const root = makeRepo({ stamp: false });
      editMap(root, mutate);
      const r = verify(root);
      check(has(r, want), `${name} fails: ${want.source.slice(0, 70)}`, () => "expected " + want + " but got: " + r.failures.join(" | ").slice(0, 400));
    }
  }

  console.log("\n4. A proof has to be real");
  {
    let root = makeRepo({ stamp: false });
    editMap(root, (m) => { m.claims[4].proof = [{ test: "test:nowhere", anchor: "the app works offline here" }]; m.suites["test:nowhere"] = { about: "A suite that is not in package.json." }; });
    check(has(verify(root), /"test:nowhere" is not a script in guidon-app\/package\.json/), "a proof naming a test that is not in package.json fails", () => verify(root).failures.join(" | "));
    root = makeRepo({ stamp: false, alpha: null });
    check(has(verify(root), /test-alpha\.mjs does not exist/), "a proof naming a test whose file is not on disk fails", () => verify(root).failures.join(" | "));
    root = makeRepo({ stamp: false, alpha: "console.log(\"  PASS  a different assertion\");\n" });
    check(has(verify(root), /LP-005 proof 1: the assertion this claim leans on is gone from guidon-app\/tools\/test-alpha\.mjs/), "an anchor that no longer appears in the test (the assertion was deleted or reworded) fails", () => verify(root).failures.join(" | "));
    root = makeRepo({ stamp: false, beta: "console.log(\"  PASS  [LP-012] FINDING CONFIRMED: only this one\");\n" });
    check(has(verify(root), /LP-006 proof 1: test:beta is a tagged suite but its source has no \[LP-006\] assertion/), "a tagged suite with no assertion carrying the claim's tag fails (the claim is not really tested)", () => verify(root).failures.join(" | "));
    root = makeRepo({ stamp: false, beta: "import { check, tag } from \"./legal-package-kit.mjs\";\ncheck(true, tag(\"LP-006\", \"LP-999\") + \" it never edits text\");\ncheck(true, tag(\"LP-012\") + \" FINDING CONFIRMED\");\n" });
    check(!has(verify(root), /\(c\)/), "a tag written the way the suites write it - tag(\"LP-006\", ...) from legal-package-kit - counts", () => verify(root).failures.join(" | "));
    root = makeRepo({ stamp: false, pkg: { ...PKG, scripts: { ...PKG.scripts, "test:alpha": "node tools/test-alpha.mjs && node tools/other.mjs" } } });
    check(has(verify(root), /is not a single 'node tools\/<file>\.mjs' command/), "a script that chains commands is not a suite this tool can run, and fails", () => verify(root).failures.join(" | "));
    root = makeRepo({ stamp: false });
    editMap(root, (m) => { m.claims[4].proof = [{ lint: "tools/lint-x.mjs", anchor: "irrelevant text here" }]; m.suites["tools/lint-x.mjs"] = { about: "A lint in the lint:patterns chain." }; m.suites["test:alpha"] = { about: "still used below" }; });
    write(root, "guidon-app/tools/lint-x.mjs", "console.log('irrelevant text here');\n");
    const rr = verify(root);
    check(!has(rr, /LP-005 proof 1/), "a lint that is in the lint:patterns chain and on disk is accepted as a proof", () => rr.failures.join(" | "));
    write(root, "guidon-app/package.json", JSON.stringify({ ...PKG, scripts: { ...PKG.scripts, "lint:patterns": "node tools/other.mjs" } }));
    check(has(verify(root), /not in the lint:patterns chain in package\.json/), "...but a lint nothing in lint:patterns runs is not", () => verify(root).failures.join(" | "));
    check(suiteCommand(PKG, "test:alpha").file === "tools/test-alpha.mjs" && suiteCommand(PKG, "test:missing") === null, "suiteCommand() reads the file a script runs", "suiteCommand misread package.json");
  }

  console.log("\n5. The stamp is generated, current and never hand-made");
  {
    let root = makeRepo({ stamp: false });
    check(has(verify(root), /needs exactly one generated verification stamp block/), "a document with no stamp fails", () => verify(root).failures.join(" | "));
    root = makeRepo();
    write(root, DOC_NAME, read(root, DOC_NAME).replace(/Result: PASS/, "Result: PASS, and more").replace(/> - \*\*Only partly proved/, "> - **Only partly proved (edited by hand)"));
    check(has(verify(root), /was edited by hand/), "a stamp edited by hand (any visible line) fails: it is not byte-for-byte what the verifier generates", () => verify(root).failures.join(" | "));
    root = makeRepo();
    write(root, DOC_NAME, read(root, DOC_NAME).replace(/"version":"9\.9\.9"/, "\"version\":\"1.0.0\""));
    check(has(verify(root), /was edited by hand/), "...and so does one whose data line was edited to agree with a made-up version", () => verify(root).failures.join(" | "));
    root = makeRepo();
    write(root, DOC_NAME, read(root, DOC_NAME).replace("It never edits text.", "It never edits text and never sends anything."));
    editMap(root, (m) => { m.claims[5].text = "It never edits text and never sends anything."; });
    check(has(verify(root), /has changed since it was last verified/) && has(verify(root), /claims map has changed since/), "changing the document (even with the map updated to match) makes the stamp stale until the suites are run again", () => verify(root).failures.join(" | "));
    root = makeRepo();
    editMap(root, (m) => { m.claims[0].reason = "A different reason for the same heading."; });
    check(has(verify(root), /claims map has changed since the document was last verified/) && !has(verify(root), /^\(d\) GUIDON_COMMAND_LEGAL_PACKAGE\.md has changed since/), "changing only the map makes the stamp stale too (a proof re-pointed is a different verification), while the document itself is still the one that was verified", () => verify(root).failures.join(" | "));
    root = makeRepo();
    restamp(root, { commit: "abc123" });
    check(has(verify(root), /not a full 40-character git sha/), "a stamp whose commit is not a full sha fails", () => verify(root).failures.join(" | "));
    root = makeRepo();
    const stale = verify(root, { release: false });
    check(stale.failures.length === 0, "a stamp for another version is only a note without --release (the document has not changed)", () => stale.failures.join(" | "));
    root = makeRepo();
    write(root, "guidon-app/package.json", JSON.stringify({ ...PKG, version: "9.10.0" }));
    const rel = verify(root, { release: true });
    check(has(rel, /--release: the stamp was written for v9\.9\.9 but this is v9\.10\.0/) && verify(root).notes.some((n) => /stamp was written for v9\.9\.9; this tree is v9\.10\.0/.test(n)) && verify(root).failures.length === 0,
      "at a release cut (--release) a stamp for the previous version fails; without --release it is a note", () => rel.failures.join(" | "));
    root = makeRepo();
    write(root, DOC_NAME, read(root, DOC_NAME) + "\n" + STAMP_START + "\n" + STAMP_END + "\n");
    check(has(verify(root), /exactly one generated verification stamp block/), "two stamp blocks fail", () => verify(root).failures.join(" | "));
    root = makeRepo();
    restamp(root, { tree: "modified" });
    check(verify(root).failures.length === 0 && verify(root).notes.some((n) => /uncommitted changes/.test(n)), "a stamp written from a modified working tree still passes but says so, in the stamp and as a note", () => verify(root).failures.join(" | "));
    const block = renderStamp({ version: "1.2.3", commit: COMMIT, date: "2026-02-03", tree: "clean", docHash: "d".repeat(64), mapHash: "e".repeat(64), result: "PASS", counts: summarize(MAP()) });
    check(block === renderStamp({ version: "1.2.3", commit: COMMIT, date: "2026-02-03", tree: "clean", docHash: "d".repeat(64), mapHash: "e".repeat(64), result: "PASS", counts: summarize(MAP()) }) && /v1\.2\.3\*\*, commit `a{40}`, on 2026-02-03/.test(block) && /Contradicted by the running app: LP-012\./.test(block) && /Not checkable by any repository test: LP-010\./.test(block),
      "the stamp is a pure function of its fields, and names the version, the commit, the date, and the claims no test could prove", () => block.slice(0, 400));
  }

  console.log("\n6. --run: the named suites really run");
  {
    const ran = async (over, map) => { const root = makeRepo({ stamp: false, ...over, ...(map ? { map } : {}) }); const r = verify(root); return runProofs({ root, map: r.map, pkg: r.pkg, jobs: 2 }); };
    let out = await ran({});
    check(out.failures.length === 0 && out.suites["test:alpha"].status === "pass" && out.suites["test:beta"].status === "pass", "both stub suites run and pass; every tagged assertion printed its PASS, and the finding is confirmed", () => JSON.stringify(out.failures));
    out = await ran({ alpha: "console.log('  PASS  the app works offline here');\nprocess.exit(1);\n" });
    check(out.failures.some((f) => /test:alpha: failed \(exit 1\)/.test(f)), "a suite that exits non-zero fails the run", () => JSON.stringify(out.failures));
    out = await ran({ alpha: "console.log('  PASS  the app works offline here');\nconsole.log('ROOM TAURI: SKIPPED (no debug exe)');\n" });
    check(out.failures.some((f) => /test:alpha: skipped itself/.test(f)), "a suite that skips itself (exit 0 but SKIPPED) proves nothing and fails the run", () => JSON.stringify(out.failures));
    out = await ran({ beta: "console.log('  PASS  [LP-012] FINDING CONFIRMED: x');\nconsole.log('  PASS  [LP-999] unrelated');\n" });
    check(out.failures.some((f) => /LP-006: test:beta passed but never printed a PASS for its \[LP-006\] assertion/.test(f)), "a tagged claim whose assertion never printed a PASS fails even though the suite exited 0", () => JSON.stringify(out.failures));
    out = await ran({ beta: "console.log('  PASS  [LP-006] fine');\nconsole.log('  FAIL  [LP-006][LP-012] but this one failed');\nconsole.log('  PASS  [LP-012] FINDING CONFIRMED: x');\n" });
    check(out.failures.some((f) => /LP-006: test:beta printed a FAIL for its \[LP-006\] assertion/.test(f)), "a FAIL line carrying the claim's tag fails the claim (multi-tag lines included)", () => JSON.stringify(out.failures));
    out = await ran({ beta: "console.log('  PASS  [LP-006] it never edits text');\nconsole.log('  PASS  [LP-012] it now behaves');\n" });
    check(out.failures.some((f) => /LP-012: test:beta no longer confirms the finding/.test(f)), "a pinned finding that stops printing FINDING CONFIRMED fails the run (whoever fixed the app must update the claim)", () => JSON.stringify(out.failures));
    const noBuild = makeRepo({ stamp: false });
    editMap(noBuild, (m) => { m.suites["test:alpha"].needs = ["build"]; });
    const nb = verify(noBuild);
    out = await runProofs({ root: noBuild, map: nb.map, pkg: nb.pkg });
    check(out.failures.some((f) => /need a build/.test(f)), "a suite that needs a build says so up front when web/index.html is missing", () => JSON.stringify(out.failures));
    // A build that exists but is OLDER than the source it is made from would let the suites test yesterday's app and then
    // stamp the document as verified for today's: it must be refused, and a current build must be accepted.
    const put = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); write(root, rel, text); };
    const staleRoot = makeRepo({ stamp: false });
    editMap(staleRoot, (m) => { m.suites["test:alpha"].needs = ["build"]; });
    put(staleRoot, "guidon-app/web/index.html", "<html></html>");
    put(staleRoot, "guidon-app/dist/guidon-standalone.html", "<html></html>");
    put(staleRoot, "guidon-app/src/index.html", "<html>newer source</html>");
    const past = new Date(Date.now() - 3600 * 1000), now = new Date();
    for (const f of ["guidon-app/web/index.html", "guidon-app/dist/guidon-standalone.html"]) utimesSync(path.join(staleRoot, f), past, past);
    utimesSync(path.join(staleRoot, "guidon-app/src/index.html"), now, now);
    const sr = verify(staleRoot);
    out = await runProofs({ root: staleRoot, map: sr.map, pkg: sr.pkg });
    check(out.failures.length === 1 && /older than src\/index\.html/.test(out.failures[0]) && !out.suites["test:alpha"], "a build older than a source file is refused before any suite runs (the stamp must not name a version the suites never saw)", () => JSON.stringify(out.failures));
    for (const f of ["guidon-app/web/index.html", "guidon-app/dist/guidon-standalone.html"]) utimesSync(path.join(staleRoot, f), now, now);
    utimesSync(path.join(staleRoot, "guidon-app/src/index.html"), past, past);
    out = await runProofs({ root: staleRoot, map: sr.map, pkg: sr.pkg });
    check(out.failures.length === 0 && out.suites["test:alpha"] && out.suites["test:alpha"].status === "pass", "...and the same tree with a build newer than every source file runs normally", () => JSON.stringify(out.failures));
    // --only: an unknown or misspelt suite key is an error, never "ran nothing, all passed".
    const onlyRepo = makeRepo({ stamp: false });
    const orr = verify(onlyRepo);
    out = await runProofs({ root: onlyRepo, map: orr.map, pkg: orr.pkg, only: ["test:alhpa"] });
    check(out.failures.some((f) => /--only names a suite the claims map does not use: test:alhpa/.test(f)) && Object.keys(out.suites).length === 0, "--only with a misspelt suite key fails and runs nothing", () => JSON.stringify(out.failures));
    out = await runProofs({ root: onlyRepo, map: orr.map, pkg: orr.pkg, only: ["test:alpha", "test:gone"] });
    check(out.failures.some((f) => /test:gone/.test(f)) && Object.keys(out.suites).length === 0, "--only with one valid and one unknown key fails as a whole (the valid half is not quietly run alone)", () => JSON.stringify(out.failures));
    out = await runProofs({ root: onlyRepo, map: orr.map, pkg: orr.pkg, only: [] });
    check(out.failures.some((f) => /selected no suite/.test(f)), "--only with an empty selection fails", () => JSON.stringify(out.failures));
    out = await runProofs({ root: onlyRepo, map: orr.map, pkg: orr.pkg, only: ["test:alpha"] });
    check(out.failures.length === 0 && out.suites["test:alpha"].status === "pass" && !out.suites["test:beta"], "--only with a real key runs just that suite", () => JSON.stringify(out.failures));
    const cliBad = cli(onlyRepo, ["--run", "--only", "test:nope"]);
    check(cliBad.status === 1 && /VERIFY-LEGAL-PACKAGE: \d+ FAILURE/.test(cliBad.stdout) && !/all passed/.test(cliBad.stdout), "on the command line a bad --only exits 1 and never prints 'all passed'", () => cliBad.stdout.slice(-400));
  }

  console.log("\n7. --write-stamp");
  {
    const root = makeRepo({ stamp: false, init: true });
    const before = read(root, DOC_NAME);
    const noRun = cli(root, ["--write-stamp"]);
    check(noRun.status === 2 && /--write-stamp needs --run/.test(noRun.stderr) && read(root, DOC_NAME) === before, "--write-stamp without --run is refused, and the document is untouched", () => noRun.stderr + noRun.stdout);
    const bad = makeRepo({ stamp: false, init: true, alpha: "console.log('  PASS  the app works offline here');\nprocess.exit(1);\n" });
    const badBefore = read(bad, DOC_NAME);
    const badRun = cli(bad, ["--run", "--write-stamp"]);
    check(badRun.status === 1 && read(bad, DOC_NAME) === badBefore && /FAILURE/.test(badRun.stdout), "with a failing suite nothing is stamped (the document is byte-for-byte unchanged) and the exit code is 1", () => badRun.stdout.slice(-600));
    const ok = cli(root, ["--run", "--write-stamp", "--date", "2026-03-04"]);
    const after = read(root, DOC_NAME);
    const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    check(ok.status === 0 && after.includes(STAMP_START) && after.includes(`commit \`${head}\``) && after.includes("on 2026-03-04") && /v9\.9\.9/.test(after) && /working tree: clean/.test(after) && !/working tree: modified/.test(after),
      "after a passing run --write-stamp inserts the stamp: the version from package.json, the git commit (" + head.slice(0, 7) + "), the date, and the tree state", () => ok.stdout.slice(-800));
    check(documentStream(after) === documentStream(before) && after.replace(/<!-- legal-package-stamp:start[\s\S]*?legal-package-stamp:end -->\n\n/, "") === before, "it changes nothing but the stamp: with the block taken out the document is byte-for-byte what it was", "the document's own text changed");
    check(verify(root).failures.length === 0 && /Contradicted by the running app: LP-012\./.test(after), "the freshly written stamp passes the static check, and lists the open finding inside the document itself", () => verify(root).failures.join(" | "));
    const again = cli(root, ["--run", "--write-stamp", "--date", "2026-03-04"]);
    check(again.status === 0 && read(root, DOC_NAME) === after, "running it again changes nothing (the stamp is a function of the run, not of the clock or the file's history)", () => again.stdout.slice(-400));
    write(root, "guidon-app/tools/test-alpha.mjs", ALPHA + "// edited\n");
    const dirty = cli(root, ["--run", "--write-stamp", "--date", "2026-03-05"]);
    check(dirty.status === 0 && /working tree: modified/.test(read(root, DOC_NAME)) && /uncommitted changes/.test(dirty.stdout), "stamping a tree with uncommitted changes is allowed but the stamp says 'working tree: modified' instead of implying a clean commit", () => dirty.stdout.slice(-500));
    const crlf = makeRepo({ stamp: false, init: true, doc: DOC.replace(/\n/g, "\r\n") });
    const c = cli(crlf, ["--run", "--write-stamp", "--date", "2026-03-04"]);
    const crlfText = read(crlf, DOC_NAME);
    check(c.status === 0 && !/[^\r]\n/.test(crlfText) && verify(crlf).failures.length === 0, "a CRLF document stays CRLF throughout (the stamp is written with the file's own line ends)", () => c.stdout.slice(-400));
    const only = cli(root, ["--run", "--write-stamp", "--only", "test:alpha"]);
    check(only.status === 2, "--write-stamp cannot be combined with --only (a stamp covers every suite)", () => only.stderr);
    const unknown = cli(root, ["--frobnicate"]);
    check(unknown.status === 2 && /unknown option/.test(unknown.stderr), "an unknown option is refused", () => unknown.stderr);
  }

  console.log("\n8. Against a copy of the REAL package and map");
  {
    const real = path.join(scratch, "real");
    mkdirSync(path.join(real, "guidon-app", "tools"), { recursive: true });
    copyFileSync(path.join(REAL_ROOT, DOC_NAME), path.join(real, DOC_NAME));
    copyFileSync(path.join(REAL_ROOT, MAP_REL), path.join(real, MAP_REL));
    copyFileSync(path.join(REAL_ROOT, "guidon-app", "package.json"), path.join(real, "guidon-app", "package.json"));
    const map = JSON.parse(readFileSync(path.join(REAL_ROOT, MAP_REL), "utf8"));
    const pkg = JSON.parse(readFileSync(path.join(REAL_ROOT, "guidon-app", "package.json"), "utf8"));
    const files = new Set();
    for (const c of map.claims) for (const p of c.proof || []) { const cmd = suiteCommand(pkg, p.test); if (cmd && cmd.file) files.add(cmd.file); }
    for (const f of files) copyFileSync(path.join(REAL_ROOT, "guidon-app", f), path.join(real, "guidon-app", f));
    const base = verifyLegalPackage({ root: real });
    check(base.failures.filter((f) => !/^\(d\)/.test(f)).length === 0, "the copy of the real package, map and " + files.size + " named suites passes (nothing but a stale stamp could fail it)", () => base.failures.join(" | "));
    const doc = readFileSync(path.join(real, DOC_NAME), "utf8");
    write(real, DOC_NAME, doc.replace("Additional legal review required.", "Additional legal review required.\n- [ ] A new option somebody added without a claim."));
    check(has(verifyLegalPackage({ root: real }), /words no claim covers, just before LP-083/), "a sentence added to a copy of the real package is caught, before the claim that follows it", () => verifyLegalPackage({ root: real }).failures.slice(0, 3).join(" | "));
    write(real, DOC_NAME, doc.replace("The roster remains excluded from normal GUIDON study-data backups by design.", "The roster remains excluded from normal GUIDON study-data backups."));
    check(has(verifyLegalPackage({ root: real }), /LP-063: its text is not \(or no longer\) in the document/), "a changed word in a copy of the real package is caught, naming the claim (LP-063)", () => verifyLegalPackage({ root: real }).failures.slice(0, 3).join(" | "));
    write(real, DOC_NAME, doc);
    const mapText = readFileSync(path.join(real, MAP_REL), "utf8");
    write(real, MAP_REL, mapText.replace("\"id\": \"LP-063\"", "\"id\": \"LP-062\""));
    check(has(verifyLegalPackage({ root: real }), /LP-062 is used twice/), "a duplicated claim id in the real map is caught", () => verifyLegalPackage({ root: real }).failures.slice(0, 3).join(" | "));
    write(real, MAP_REL, mapText);
    const opsec = readFileSync(path.join(real, "guidon-app", "tools", "test-opsec-guard.mjs"), "utf8");
    write(real, "guidon-app/tools/test-opsec-guard.mjs", opsec.replace("the text-rewriting API (sanitizeInput) is gone", "the rewriting API was removed"));
    check(has(verifyLegalPackage({ root: real }), /LP-027 proof 1: the assertion this claim leans on is gone from guidon-app\/tools\/test-opsec-guard\.mjs/), "the assertion behind a real claim being reworded in the real test (test:opsec-guard) is caught", () => verifyLegalPackage({ root: real }).failures.slice(0, 3).join(" | "));
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
await finish("LEGAL PACKAGE VERIFIER");
