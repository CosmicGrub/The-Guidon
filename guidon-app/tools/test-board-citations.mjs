/**
 * Board card citations are structured arrays (ROADMAP item F Wave 2) and read
 * exactly as the free text did.
 *
 * WHY THIS SUITE EXISTS. Wave 2 replaced every board card's free-text `source`
 * ("AR 600-9, para 3-9c; DA PAM 600-25") and its card-level `verbatim` flag
 * with `source: [{ pub, edition, para, quoteKind, editionFirst?, sepAfter? }]`, for 1,350-odd cards
 * spread over the static seed and 13 content packs, and it did that with a
 * promise: ZERO visible change for a Soldier. Three things would ship broken,
 * and go unnoticed, without this file:
 *   - a card whose citation quietly reads differently on the card back, in a
 *     study room, in the MOI Import tallies or in the Definitions tab (the parser
 *     only splits what it can render back EXACTLY - this is the proof, over
 *     every real card, against the strings the cards carried before);
 *   - a card that drops out of, or lands in, a regulation chip in Board Drill's
 *     "Filter by regulation" bar (G.board.regulationsOf now reads the entries'
 *     `pub` instead of re-guessing a sentence - identical, card for card, to
 *     what the old regex found);
 *   - a future content pack that ships a bare string, an entry with no `pub`, a
 *     bad quoteKind, or a `para` that hides a publication: the old design's
 *     objection to a stored field was that it would go stale, so the answer
 *     has to be a gate that FAILS - the planted-defect block below proves
 *     tools/lint-citation-schema.mjs really does.
 *
 * WHAT IT PROVES (every assertion below can FAIL; the planted defects and the
 * parser table are there to prove that):
 *   1. BASELINE. tools/fixtures/board-source-baseline.json holds, for every card
 *      that existed at the migration, the exact source string it carried, the
 *      regulation ids the OLD free-text G.board.regulationsOf produced from it,
 *      and whether its back printed the study-guide (paraphrase) heading. For
 *      each of those cards in today's assembled bank (static seed + every
 *      content pack, tools/assemble-bank.mjs): renderCitation(source) is
 *      byte-identical, the regulation ids derived from the entries' `pub` are
 *      identical, and the heading is unchanged. If you INTENTIONALLY change a
 *      card's citation later, this fails on purpose so a reviewer sees it; then
 *      run:  node tools/test-board-citations.mjs --rebaseline
 *   2. THE PARSER, on a table of every judgement call (compounds, " / " and ", "
 *      joins, editions, locators, a locator that continues the citation before
 *      it, a year after a comma, prose notes, unbalanced parentheses, a `para`
 *      that would hide a regulation), on all of the baseline's distinct strings
 *      (each renders back exactly and yields the same regulation ids), and on
 *      today's text of every card in the bank (a citation added after the
 *      baseline is held to the same exactness).
 *   3. ctx.cite (the pack-authoring helper in tools/content-pack-engine.mjs):
 *      a pack keeps writing a readable string and the bank gets the array;
 *      quoteKind is required; an empty citation is refused.
 *   4. THE GATE. tools/lint-citation-schema.mjs against stand-in banks: a clean
 *      one passes; each of a bare string, a missing pub, a bad quoteKind, an
 *      empty array, a leftover verbatim flag, a bad or misplaced sepAfter, the
 *      retired `sep` key, a stray editionFirst, a `para`
 *      that hides a regulation, a PACK card with a string source, and a card
 *      whose source is PENDING (sourceStatus "pending-source", or the same
 *      words in its own citation) that still claims quoteKind "verbatim" fails,
 *      naming the card (and the pack). A pending source must never promise a
 *      word-for-word quotation; the four such cards (68w-fund-05, 68w-medlog-02,
 *      mlc-course-06, mlc-course-07) are cited "paraphrase" and were
 *      re-baselined for exactly that reason (their card back now says
 *      "Study-guide answer", not "By the Book").
 *      Also here (4b): tools/migrate-board-citations.mjs on a stand-in seed
 *      that has every case the real seed never did - a verbatim flag first,
 *      middle and last, true and false, a card already structured, another
 *      section's string `source` - proving it edits only those byte ranges,
 *      keeps key order, is safe to run twice and refuses a card with no source.
 *   5. NO READER DRIFT. No screen concatenates a card's raw `.source` into a
 *      "Source: " line: the citation is an array now, so a reader that forgot
 *      would print "[object Object]" (Wave 1 found four such readers by hand;
 *      this wave found two more that a first sweep of index.html missed).
 *   6. THE RUNTIME. In the real app: G.board.sourceText / regulationsOf /
 *      quoteKindOf over every card in the seed equal the Node functions and the
 *      baseline (the browser and Node each carry their own two tiny functions;
 *      this is what keeps them one behaviour), the free-text path of
 *      regulationsOf is untouched (all of the baseline's strings), and the
 *      Definitions tab prints the exact "Source:" line and the right heading
 *      for a compound, an edition-and-locator, a mixed and a paraphrase card.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp, waitForRoute, clickWhenStable, until, check, expectNoConsoleNoise, finish } from "./testkit.mjs";
import { assembleBank } from "./assemble-bank.mjs";
import { readSeed, writeSeed as writeSeedFile } from "./seed-io.mjs";
import { mergeContentPacks } from "./content-pack-engine.mjs";
import { loadModules } from "./module-manifest.mjs";
import { VALID_QUOTE_KIND, renderCitation } from "./cite-schema.mjs";
import { parseSource, cite, quoteKindOf, legacyRegulationsOf, regulationsOfEntries } from "./citation-parse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const BASELINE_PATH = path.join(HERE, "fixtures", "board-source-baseline.json");
const LINT = path.join(HERE, "lint-citation-schema.mjs");
const show = (arr, n = 5) => JSON.stringify(arr.slice(0, n)) + (arr.length > n ? ` (+${arr.length - n} more)` : "");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------------------------------------------------------------
   --rebaseline: rewrite the fixture from today's bank, after a deliberate
   citation change. Nothing else runs.
   --------------------------------------------------------------------- */
if (process.argv.includes("--rebaseline")) {
  const bank = assembleBank().data.board.questions;
  const rows = bank.map((q) => {
    const text = renderCitation(q.source);
    return [q.id, text, legacyRegulationsOf(text), quoteKindOf(q.source) === "verbatim" ? 0 : 1];
  });
  const old = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const lines = ["{", `  "what": ${JSON.stringify(old.what)},`, `  "count": ${rows.length},`, '  "rows": [', ...rows.map((r, i) => "    " + JSON.stringify(r) + (i < rows.length - 1 ? "," : "")), "  ]", "}"];
  writeFileSync(BASELINE_PATH, lines.join("\n") + "\n", "utf8");
  console.log(`test-board-citations: rebaselined ${rows.length} cards (was ${old.count}) -> ${path.relative(process.cwd(), BASELINE_PATH)}. Review the diff before committing it.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const baseById = new Map(baseline.rows.map((r) => [r[0], { text: r[1], regs: r[2], paraphrased: r[3] === 1 }]));
const assembled = assembleBank();
const bank = assembled.data.board.questions;

/* =====================================================================
   1. BASELINE: old == new, card for card, over the real assembled bank
   ===================================================================== */
console.log("1. baseline - every card reads exactly as it did before the migration");
{
  const notArray = bank.filter((q) => !Array.isArray(q.source)).map((q) => q.id);
  check(notArray.length === 0, "every card in the assembled bank (static seed + every content pack) carries a structured source array", () => `${notArray.length} card(s) still have a plain source: ${show(notArray)}`);
  const leftover = bank.filter((q) => "verbatim" in q).map((q) => q.id);
  check(leftover.length === 0, "no card still carries the old verbatim flag (it is folded into quoteKind)", () => `${leftover.length} card(s): ${show(leftover)}`);

  const inBaseline = bank.filter((q) => baseById.has(q.id));
  const removed = [...baseById.keys()].filter((id) => !bank.some((q) => q.id === id));
  check(inBaseline.length > 0, `the baseline covers ${inBaseline.length} of today's ${bank.length} cards (${bank.length - inBaseline.length} added since; ${removed.length} of the baseline's removed since)`, "no card in the bank is in the baseline - the fixture is stale or empty");

  const textDiff = [], regDiff = [], kindDiff = [];
  for (const q of inBaseline) {
    const b = baseById.get(q.id);
    const text = renderCitation(q.source);
    if (text !== b.text) textDiff.push(`${q.id}: was ${JSON.stringify(b.text)} now ${JSON.stringify(text)}`);
    const regs = regulationsOfEntries(q.source);
    if (!same(regs, b.regs)) regDiff.push(`${q.id}: was ${JSON.stringify(b.regs)} now ${JSON.stringify(regs)}`);
    const paraphrased = quoteKindOf(q.source) !== "verbatim";
    if (paraphrased !== b.paraphrased) kindDiff.push(`${q.id}: paraphrase heading was ${b.paraphrased} now ${paraphrased}`);
  }
  const hint = " - if this citation change is intentional, run: node tools/test-board-citations.mjs --rebaseline";
  check(textDiff.length === 0, `the citation text a Soldier reads is byte-identical for all ${inBaseline.length} baseline cards`, () => `${textDiff.length} differ: ${show(textDiff, 3)}${hint}`);
  check(regDiff.length === 0, `the regulation chips derived from the entries' pub match the old free-text regex for all ${inBaseline.length} baseline cards (no improvements, no losses)`, () => `${regDiff.length} differ: ${show(regDiff, 3)}${hint}`);
  check(kindDiff.length === 0, `the card-back heading (By the Book vs study-guide answer) is unchanged for all ${inBaseline.length} baseline cards`, () => `${kindDiff.length} differ: ${show(kindDiff, 3)}${hint}`);
  const distinctKinds = new Set(bank.flatMap((q) => q.source.map((e) => e.quoteKind)));
  check([...distinctKinds].every((k) => VALID_QUOTE_KIND.includes(k)), "every quoteKind in the bank is one of verbatim / paraphrase / synthesis", () => show([...distinctKinds]));

  // A pending source never claims to be a quotation. These four cards carried sourceStatus "pending-source"
  // (their own citation says the wording is paraphrased, unverified or from public reporting) yet were cited
  // "verbatim" when the flag was folded into quoteKind. Their heading intentionally moved to the study-guide
  // label; the baseline was re-baselined for exactly these four rows.
  const PENDING_FOUR = ["68w-fund-05", "68w-medlog-02", "mlc-course-06", "mlc-course-07"];
  const byIdBank = new Map(bank.map((q) => [q.id, q]));
  check(PENDING_FOUR.every((id) => byIdBank.has(id) && byIdBank.get(id).sourceStatus === "pending-source"), "the four known pending-source cards (68w-fund-05, 68w-medlog-02, mlc-course-06, mlc-course-07) are in the bank and still marked pending-source", () => PENDING_FOUR.map((id) => id + "=" + (byIdBank.has(id) ? byIdBank.get(id).sourceStatus : "missing")).join(" "));
  const pendingVerbatim = bank.filter((q) => q.sourceStatus === "pending-source" && q.source.some((e) => e.quoteKind === "verbatim")).map((q) => q.id);
  check(pendingVerbatim.length === 0, "no card with sourceStatus pending-source claims quoteKind verbatim (its back reads 'Study-guide answer', not 'By the Book')", () => `${pendingVerbatim.length} card(s): ${show(pendingVerbatim)}`);
  check(PENDING_FOUR.every((id) => baseById.has(id) && baseById.get(id).paraphrased === true && quoteKindOf(byIdBank.get(id).source) === "paraphrase"), "...and the re-baselined fixture records exactly those four as study-guide (paraphrase) cards", () => PENDING_FOUR.map((id) => id + "=" + JSON.stringify(baseById.get(id) && baseById.get(id).paraphrased)).join(" "));
}

/* =====================================================================
   2. THE PARSER: every judgement call, then the whole real corpus
   ===================================================================== */
console.log("\n2. parser - splits only what it can render back exactly");
{
  const E = (pub, extra = {}) => Object.assign({ pub, edition: "", para: "" }, extra);
  const CASES = [
    ["AR 600-20", [E("AR 600-20")], "a bare publication"],
    ["AR 600-9, para 3-9c; DA PAM 600-25", [E("AR 600-9", { para: "para 3-9c" }), E("DA PAM 600-25")], "a locator and a second publication after a semicolon"],
    ["AR 623-3 / DA PAM 623-3", [E("AR 623-3", { sepAfter: " / " }), E("DA PAM 623-3")], "an 'A / B' pair keeps its slash (sepAfter, on the entry before it) so the line reads as before"],
    ["ADP 6-22, FM 7-22", [E("ADP 6-22", { sepAfter: ", " }), E("FM 7-22")], "a comma before a second publication is a new entry, joined by its own sepAfter"],
    ["AR 710-2 (1 Jul 2024), paras 4-3 and 6-5", [E("AR 710-2", { edition: "1 Jul 2024", para: "paras 4-3 and 6-5", editionFirst: true })], "an edition in parentheses, then a locator: editionFirst records that the edition sat right after the publication"],
    ["FM 3-0 (Mar 2025)", [E("FM 3-0", { edition: "Mar 2025" })], "a month-year edition"],
    ["AR 350-1, para 3-38a (1 Jun 2025)", [E("AR 350-1", { para: "para 3-38a (1 Jun 2025)" })], "an edition written AFTER the locator stays inside the locator text (never split apart, never lost)"],
    ["ADP 6-22, Ch 9 (Achieving, para 9-6); Ch 10 (para 1-130)", [E("ADP 6-22", { para: "Ch 9 (Achieving, para 9-6); Ch 10 (para 1-130)" })], "a segment that opens with a locator word continues the citation before it"],
    ["ADP 6-22, 2019", [E("ADP 6-22, 2019")], "a year after a comma is not a shape the renderer can reproduce: kept whole, never guessed into an edition"],
    ["UCMJ, Article 31", [E("UCMJ, Article 31")], "a split that would hide UCMJ Art. 31 from the regulation chips is refused"],
    ["AR 600-9, para 3-9c and AR 25-50", [E("AR 600-9, para 3-9c and AR 25-50")], "a locator that names another publication is refused, so AR 25-50 stays visible to the chips"],
    ["AR 600-20 (EO, Ch 6) / AR 600-52 (SHARP)", [E("AR 600-20 (EO, Ch 6)", { sepAfter: " / " }), E("AR 600-52 (SHARP)")], "a parenthetical that is not an edition stays in the pub"],
    ["Creeds", [E("Creeds")], "a source that is not a publication is its own named entry"],
    ["TCCC / STP 21-1-SMCT", [E("TCCC", { sepAfter: " / " }), E("STP 21-1-SMCT")], "a named non-publication next to a real publication splits at a boundary that has a designator beside it"],
    ["DFAS / myPay", [E("DFAS / myPay")], "two neighbours that are both non-publications stay ONE entry (a compound cannot be told from a name with a slash)"],
    ["ATP 4-42 (2 Nov 2020), paras 2-16 to 2-17; GCSS-Army training site (GTRAC)", [E("ATP 4-42", { edition: "2 Nov 2020", para: "paras 2-16 to 2-17", editionFirst: true }), E("GCSS-Army training site (GTRAC)")], "edition + locator, then a named non-publication"],
    ["DA PAM 611-21, MOS 68W duty descriptions - pending-source: paraphrased from secondary summaries; the exact paragraph was not re-verified", [E("DA PAM 611-21, MOS 68W duty descriptions - pending-source: paraphrased from secondary summaries; the exact paragraph was not re-verified")], "a source that carries its own 'pending-source' note is one statement, never split at its semicolon"],
    ["ADP 6-22 (2019", [E("ADP 6-22 (2019")], "unbalanced parentheses: kept whole"],
    ["AR 600-20;  AR 25-50", [E("AR 600-20;  AR 25-50")], "odd spacing that cannot render back exactly: kept whole"],
  ];
  const wrong = [];
  for (const [text, want, why] of CASES) {
    const got = parseSource(text).entries;
    if (!same(got, want)) wrong.push(`${JSON.stringify(text)} (${why}) -> ${JSON.stringify(got)}`);
    if (renderCitation(got) !== text) wrong.push(`${JSON.stringify(text)} does not render back exactly`);
  }
  check(wrong.length === 0, `all ${CASES.length} judgement cases split (or refuse to split) as designed, and each renders back exactly`, () => wrong.join(" | "));

  const distinct = [...new Set([...baseById.values()].map((b) => b.text))];
  const parseBad = [];
  for (const text of distinct) {
    const r = parseSource(text);
    if (renderCitation(r.entries) !== text) parseBad.push(`render ${JSON.stringify(text)}`);
    if (!same(regulationsOfEntries(r.entries), legacyRegulationsOf(text))) parseBad.push(`chips ${JSON.stringify(text)}`);
  }
  check(parseBad.length === 0, `all ${distinct.length} distinct baseline citations parse to entries that render back exactly and yield the same regulation chips`, () => show(parseBad, 4));

  const drift = [];
  for (const q of bank) {
    const text = renderCitation(q.source);
    const r = parseSource(text);
    if (renderCitation(r.entries) !== text) drift.push(q.id);
  }
  check(drift.length === 0, "every card's CURRENT citation text (including cards added since the baseline) survives the parser exactly - a new citation is held to the same exactness", () => `not exact: ${show(drift)}`);

  // quoteKind folding, on the helper the packs use.
  const kinds = (t, k) => cite(t, k).map((e) => e.quoteKind).join("/");
  check(kinds("AR 600-20", "verbatim") === "verbatim" && kinds("AR 600-20", "paraphrase") === "paraphrase", "cite(): every entry carries the card's quoteKind", () => kinds("AR 600-20", "verbatim") + " " + kinds("AR 600-20", "paraphrase"));
  check(kinds("AR 600-20; unit SOP", "verbatim") === "verbatim/paraphrase", "cite(): a source that is not a publication, beside a real one, is 'paraphrase' - a quotation claim is only made for a publication", () => kinds("AR 600-20; unit SOP", "verbatim"));
  check(kinds("Creeds", "verbatim") === "verbatim", "cite(): a card that cites ONLY such a source keeps the card's own kind, so its heading does not change", () => kinds("Creeds", "verbatim"));
  const kindOf = (kk) => quoteKindOf(kk.map((k) => ({ pub: "x", edition: "", para: "", quoteKind: k })));
  check(kindOf(["paraphrase", "verbatim"]) === "verbatim" && kindOf(["paraphrase", "paraphrase"]) === "paraphrase" && kindOf(["synthesis"]) === "synthesis" && quoteKindOf("plain text") === "verbatim",
    "quoteKindOf(): a card is verbatim when ANY entry is; otherwise it takes its first entry's kind; a plain string is verbatim (as an absent flag always was)");
}

/* =====================================================================
   3. ctx.cite - the pack-authoring helper
   ===================================================================== */
console.log("\n3. ctx.cite - a pack writes a readable string, the bank gets the array");
const scratch = mkdtempSync(path.join(tmpdir(), "guidon-board-citations-"));
try {
  const MODULES = path.join(scratch, "modules");
  mkdirSync(MODULES);
  const manifestFor = (files) => JSON.stringify({ modules: files.map(([file, id]) => ({ file, id, kind: "content-pack", emit: "build", headless: true, requires: [], provides: [], routes: [], storageKeys: [], optionalApis: [] })) }, null, 2);
  const packSrc = (body) => ['(function () {', '  "use strict";', '  G.contentPack.define("stand-in-pack", function (bank, ctx) {', body, '  });', '})();'].join("\n");
  const runPack = (body) => {
    writeFileSync(path.join(MODULES, "manifest.json"), manifestFor([["01-stand-in-pack.js", "stand-in-pack"]]), "utf8");
    writeFileSync(path.join(MODULES, "01-stand-in-pack.js"), packSrc(body), "utf8");
    const seed = { board: { questions: [] }, doctrine: { entries: [] }, scenarios: { scenarios: [] }, acronyms: { terms: [] } };
    return { seed, result: mergeContentPacks(seed, MODULES) };
  };
  const good = runPack('    bank.board.questions.push({ id: "c1", source: ctx.cite("AR 600-9, para 3-9c; DA PAM 600-25", "paraphrase") });');
  const pushed = good.seed.board.questions.find((q) => q.id === "c1");
  check(!good.result.modules[0].error && Array.isArray(pushed && pushed.source), "a pack that calls ctx.cite(text, quoteKind) leaves an ARRAY in the bank", () => JSON.stringify(good.result.modules));
  check(pushed && renderCitation(pushed.source) === "AR 600-9, para 3-9c; DA PAM 600-25" && pushed.source.every((e) => e.quoteKind === "paraphrase"), "...that renders back to the very string the pack wrote, every entry carrying the quoteKind it asked for", () => JSON.stringify(pushed));
  const noKind = runPack('    bank.board.questions.push({ id: "c2", source: ctx.cite("AR 600-9") });');
  check(/01-stand-in-pack\.js: ctx\.cite\("AR 600-9", undefined\) - cite\(\): quoteKind must be one of verbatim, paraphrase, synthesis/.test(noKind.result.modules[0].error || ""), "ctx.cite without a quoteKind is a build error naming the pack file (the author must decide whether the answer is a quotation)", () => JSON.stringify(noKind.result.modules[0]));
  const badKind = runPack('    bank.board.questions.push({ id: "c3", source: ctx.cite("AR 600-9", "guess") });');
  check(/quoteKind must be one of/.test(badKind.result.modules[0].error || ""), "ctx.cite with an unknown quoteKind is a build error", () => JSON.stringify(badKind.result.modules[0]));
  const blank = runPack('    bank.board.questions.push({ id: "c4", source: ctx.cite("  ", "verbatim") });');
  check(/source text is empty/.test(blank.result.modules[0].error || ""), "ctx.cite of a blank citation is a build error (every card cites something)", () => JSON.stringify(blank.result.modules[0]));

  /* =================================================================
     4. THE GATE: lint-citation-schema against stand-in banks
     ================================================================= */
  console.log("\n4. the gate - tools/lint-citation-schema.mjs fails on every planted defect");
  const SEED = path.join(scratch, "index.html");
  const c1 = (pub, kind = "paraphrase") => ({ pub, edition: "", para: "", quoteKind: kind });
  const card = (id, source, extra = {}) => Object.assign({ id, category: "Army Values", q: "Question " + id + "?", a: "Answer " + id, boardAnswer: "Answer " + id, keyPoints: ["Answer " + id], difficulty: "basic", source }, extra);
  // The stand-in seed is a copy of the REAL seed with only the board swapped for the cards under test: the lint
  // gates every Wave 3 collection as well as the board, so a hand-built minimal seed would fail on "no records found".
  const writeSeed = (boardQuestions) => {
    copyFileSync(path.join(APP, "src", "index.html"), SEED);
    const seedData = readSeed(SEED).data;
    seedData.board.questions = boardQuestions;
    writeSeedFile(seedData, SEED);
  };
  const lint = (boardQuestions, packBody = "") => {
    writeSeed(boardQuestions);
    writeFileSync(path.join(MODULES, "manifest.json"), manifestFor([["01-stand-in-pack.js", "stand-in-pack"]]), "utf8");
    writeFileSync(path.join(MODULES, "01-stand-in-pack.js"), packSrc(packBody), "utf8");
    const r = spawnSync(process.execPath, [LINT, "--seed", SEED, "--modules", MODULES], { encoding: "utf8" });
    return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  const failsOn = (name, r, ...needles) => check(r.status === 1 && needles.every((n) => (typeof n === "string" ? r.out.includes(n) : n.test(r.out))), `the lint FAILS on ${name}, naming what is wrong`, () => `exit ${r.status}\n${r.out}`);

  const clean = lint([card("ok-1", [Object.assign(c1("AR 600-9"), { sepAfter: " / " }), c1("DA PAM 600-25")]), card("ok-pending", [c1("DA PAM 611-21 - pending-source: paraphrased, not re-verified", "paraphrase")], { sourceStatus: "pending-source" })], '    bank.board.questions.push({ id: "pack-ok", category: "Army Values", q: "Q?", a: "A", boardAnswer: "A", keyPoints: ["A"], difficulty: "basic", source: ctx.cite("ADP 6-22, Ch 2", "verbatim") });');
  check(clean.status === 0 && /board\.questions: all \d+ cards/.test(clean.out), "control: a clean stand-in bank (a static card with a sepAfter, a pack card through ctx.cite) passes", () => `exit ${clean.status}\n${clean.out}`);

  failsOn("a static card whose source is still a bare string", lint([card("bare-1", "ADP 6-22")]), 'board.questions[0] ("bare-1")', "is not an array (found string)");
  failsOn("an entry with no pub", lint([card("nopub-1", [{ edition: "", para: "", quoteKind: "paraphrase" }])]), '("nopub-1")', 'has no non-empty "pub"');
  failsOn("an entry with an unknown quoteKind", lint([card("kind-1", [c1("ADP 6-22", "guess")])]), '("kind-1")', 'quoteKind is "guess"');
  failsOn("an empty source array", lint([card("empty-1", [])]), '("empty-1")', "empty array");
  failsOn("a card that kept the old verbatim flag", lint([card("verb-1", [c1("ADP 6-22")], { verbatim: false })]), '("verb-1")', 'still carries a "verbatim" field');
  failsOn("a sepAfter on the last entry", lint([card("sep-1", [Object.assign(c1("ADP 6-22"), { sepAfter: " / " })])]), '("sep-1")', 'carries a "sepAfter"');
  failsOn("a sepAfter that is not one of the joiners", lint([card("sep-2", [Object.assign(c1("ADP 6-22"), { sepAfter: " | " }), c1("FM 7-22")])]), '("sep-2")', ".sepAfter is");
  failsOn("the retired Wave 2 draft key `sep`", lint([card("sep-3", [c1("ADP 6-22"), Object.assign(c1("FM 7-22"), { sep: " / " })])]), '("sep-3")', 'retired "sep" key');
  failsOn("an editionFirst that is not true", lint([card("ed-1", [Object.assign(c1("ADP 6-22"), { edition: "2019", para: "Ch 2", editionFirst: "yes" })])]), '("ed-1")', ".editionFirst is");
  failsOn("a para that buries a publication the regulation chips would miss", lint([card("hide-1", [{ pub: "ADP 6-22", edition: "", para: "see also AR 25-50", quoteKind: "paraphrase" }])]), '("hide-1")', /regulation chips read \["ADP 6-22"\]/, "AR 25-50");
  failsOn("a content-pack card that ships a bare string", lint([card("static-ok", [c1("ADP 6-22")])], '    bank.board.questions.push({ id: "pack-bare", category: "Army Values", q: "Q?", a: "A", boardAnswer: "A", keyPoints: ["A"], difficulty: "basic", source: "AR 600-9, para 3-9c" });'), '("pack-bare")', "[pack 01-stand-in-pack.js]", "is not an array (found string)");
  failsOn("a content-pack card that keeps verbatim:false beside ctx.cite", lint([card("static-ok2", [c1("ADP 6-22")])], '    bank.board.questions.push({ id: "pack-verb", category: "Army Values", q: "Q?", a: "A", boardAnswer: "A", keyPoints: ["A"], difficulty: "basic", verbatim: false, source: ctx.cite("ADP 6-22", "paraphrase") });'), '("pack-verb")', 'still carries a "verbatim" field');

  // (j) a pending source never claims to be a quotation - by the field, by the prose note in the citation itself, or from a pack
  failsOn("a card marked sourceStatus pending-source that claims verbatim", lint([card("pend-1", [c1("DA PAM 611-21", "verbatim")], { sourceStatus: "pending-source" })]), '("pend-1")', 'sourceStatus "pending-source"', 'claims quoteKind "verbatim"');
  failsOn("a card whose citation text carries the pending-source note but claims verbatim", lint([card("pend-2", [c1("AR 40-61 - pending-source: current wording was not re-verified against the primary text", "verbatim")])]), '("pend-2")', 'its citation says "pending-source"', 'claims quoteKind "verbatim"');
  failsOn("a content-pack card that is pending-source yet cites verbatim through ctx.cite", lint([card("static-ok3", [c1("ADP 6-22")])], '    bank.board.questions.push({ id: "pack-pend", category: "Army Values", q: "Q?", a: "A", boardAnswer: "A", keyPoints: ["A"], difficulty: "basic", sourceStatus: "pending-source", source: ctx.cite("DA PAM 611-21 - pending-source: not re-verified", "verbatim") });'), '("pack-pend")', "[pack 01-stand-in-pack.js]", 'claims quoteKind "verbatim"');
  {
    // ...and when only ONE entry of a mixed citation says verbatim, that is still a claim
    const mixed = lint([card("pend-3", [c1("AR 600-20", "paraphrase"), c1("DA PAM 611-21", "verbatim")], { sourceStatus: "pending-source" })]);
    failsOn("a pending-source card with a verbatim entry beside a paraphrase one", mixed, '("pend-3")', 'claims quoteKind "verbatim"');
  }

  /* the real bank passes the real gate, end to end */
  const real = spawnSync(process.execPath, [LINT], { cwd: APP, encoding: "utf8" });
  check(real.status === 0 && /board\.questions: all \d+ cards/.test(real.stdout), "the real bank (static seed + every content pack) passes the real gate", () => `exit ${real.status}\n${real.stdout}${real.stderr}`);

  /* =================================================================
     4b. THE MIGRATION SCRIPT: scripted, idempotent, count-checked, never re-serialises
     ================================================================= */
  console.log("\n4b. migrate-board-citations.mjs - on a stand-in seed that exercises every case the real seed never had");
  {
    const MIGRATE = path.join(HERE, "migrate-board-citations.mjs");
    const arrayCard = { id: "c5", category: "x", source: [c1("ADP 6-22", "verbatim")], q: "Q" };
    // A `verbatim` key in EVERY position (first, middle, last), true and false, a card with none, one already structured.
    const literal = '{"doctrine":{"entries":[{"id":"d1","source":"left alone"}]},"board":{"version":"0.1.0","questions":['
      + '{"id":"c1","category":"x","source":"AR 600-9, para 3-9c; DA PAM 600-25","q":"Q"},'
      + '{"id":"c2","verbatim":false,"category":"x","source":"ADP 6-22","q":"Q"},'
      + '{"id":"c3","category":"x","source":"AR 600-20 / AR 27-10","verbatim":false},'
      + '{"id":"c4","verbatim":true,"source":"ADP 1","q":"Q"},'
      + JSON.stringify(arrayCard) + ','
      + '{"id":"c6","category":"x","source":"FM 7-22 (2020); unit SOP","verbatim":false,"q":"Q"}'
      + ']},"curriculum":{"courses":[{"id":"k1","source":"AR 600-20"}]}}';
    const html = "<!doctype html>\n<p>before</p>\nwindow.GUIDON_SEED = " + literal + ";\n<p>after</p>\n";
    const TMP = path.join(scratch, "migrate-index.html");
    writeFileSync(TMP, html, "utf8");
    const run = (...args) => spawnSync(process.execPath, [MIGRATE, "--path", TMP, ...args], { encoding: "utf8" });

    const dry = run("--check");
    check(dry.status === 0 && readFileSync(TMP, "utf8") === html && /--check: nothing written/.test(dry.stdout), "--check reports the work and writes nothing", () => dry.stdout + dry.stderr);
    const r1 = run();
    const migrated = readFileSync(TMP, "utf8");
    check(r1.status === 0 && /5 sources structured/.test(r1.stdout) && /4 verbatim flag\(s\) folded away/.test(r1.stdout), "the run structures every string source it found (5) and folds every verbatim flag away (4), and says so", () => r1.stdout + r1.stderr);
    const seedOf = (text) => JSON.parse(text.split("window.GUIDON_SEED = ")[1].split(";\n<p>after")[0]);
    const after = seedOf(migrated), qs = after.board.questions;
    const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
    const kinds = (id) => byId[id].source.map((e) => e.quoteKind).join("/");
    check(qs.every((q) => Array.isArray(q.source) && !("verbatim" in q)), "afterwards every card has an array source and none has a verbatim key (first, middle and last positions all removed cleanly)", () => JSON.stringify(qs));
    check(kinds("c1") === "verbatim/verbatim" && kinds("c2") === "paraphrase" && kinds("c3") === "paraphrase/paraphrase" && kinds("c4") === "verbatim" && kinds("c6") === "paraphrase/paraphrase",
      "the fold is right: absent or true -> verbatim, false -> paraphrase (and a non-publication beside a publication is paraphrase either way)", () => ["c1", "c2", "c3", "c4", "c6"].map((id) => id + "=" + kinds(id)).join(" "));
    check(["c1", "c2", "c3", "c4", "c6"].every((id) => renderCitation(byId[id].source) === renderCitation(seedOf(html).board.questions.find((q) => q.id === id).source)) && byId.c3.source[0].sepAfter === " / ", "every migrated card renders back to the string it had (c3 keeps its ' / ')");
    check(same(byId.c5.source, arrayCard.source) && after.doctrine.entries[0].source === "left alone" && after.curriculum.courses[0].source === "AR 600-20" && after.board.version === "0.1.0", "an already-structured card, another section's string `source` and the board's own fields are untouched");
    check(migrated.startsWith("<!doctype html>\n<p>before</p>\nwindow.GUIDON_SEED = ") && migrated.endsWith(";\n<p>after</p>\n"), "every byte outside the seed literal is unchanged");
    const before = seedOf(html);
    check(same(Object.keys(before.board.questions[2]).filter((k) => k !== "verbatim" && k !== "source"), Object.keys(byId.c3).filter((k) => k !== "source")) && Object.keys(byId.c2).join() === "id,category,source,q", "key order survives (nothing was re-serialised)", () => Object.keys(byId.c2).join());
    const r2 = run();
    check(r2.status === 0 && readFileSync(TMP, "utf8") === migrated && /nothing to migrate/.test(r2.stdout), "a second run changes nothing (idempotent)", () => r2.stdout + r2.stderr);
    // count-checked: a card with no source at all is refused, not papered over
    writeFileSync(TMP, html.replace('"source":"ADP 6-22",', ""), "utf8");
    const r3 = run();
    check(r3.status !== 0 && /have no source at all/.test(r3.stderr), "a card with no source is refused (the run stops and writes nothing) instead of being skipped", () => r3.stdout + r3.stderr);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

/* =====================================================================
   5. NO READER DRIFT (static, before the browser: it needs no page)
   ===================================================================== */
console.log("\n5. no reader drift - nothing prints a card's raw source into a 'Source:' line");
{
  const files = [path.join(APP, "src", "index.html")];
  for (const f of readdirSync(path.join(APP, "src", "app-modules"))) if (f.endsWith(".js")) files.push(path.join(APP, "src", "app-modules", f));
  // index.html carries the 5 MB seed and two vendored bundles on single lines; none of them is app code.
  const codeOf = (f) => readFileSync(f, "utf8").split("\n").filter((l) => l.length < 20000).join("\n");
  // "Source: " + x.source, and `source: q.source` handed to something that prints it later. The Definitions
  // tab's own `item.source` is already rendered text (built from G.board.sourceText), so it is not a reader of the array.
  const RAW_SOURCE_LINE = /["']Source: ["']\s*\+\s*(?!item\b)[A-Za-z_$][\w$]*\.source\b(?!\s*[.[(])/g;
  const RAW_SOURCE_HANDOFF = /\bsource:\s*(?:q2?|card|bq|question)\.source\b(?!\s*[.[(])/g;
  const offenders = [];
  for (const f of files) {
    const code = codeOf(f);
    for (const re of [RAW_SOURCE_LINE, RAW_SOURCE_HANDOFF]) for (const m of code.matchAll(re)) offenders.push(path.basename(f) + ": " + m[0]);
  }
  check(offenders.length === 0, "no screen builds a 'Source: ' line from a raw `.source` (every reader goes through G.board.sourceText)", () => `${offenders.length} reader(s) would print [object Object]: ${show(offenders)}`);
  // Verify the verifier: the two patterns must catch the exact shapes of the readers this wave had to fix.
  const planted = ['el("p.hint",{style:"margin:0",text:"Source: "+card.source})', 'card.appendChild(el("span.src", { text: "Source: " + q.source }))', "items.push({ source: q.source || \"\" })"];
  check(planted.every((s) => [RAW_SOURCE_LINE, RAW_SOURCE_HANDOFF].some((re) => new RegExp(re.source).test(s))), "verifier check: the guard does catch the reader shapes this wave had to fix (06-opsec/07-cyber self-check feedback, Board Drill back, the Definitions hand-off)");
  check(![RAW_SOURCE_LINE, RAW_SOURCE_HANDOFF].some((re) => new RegExp(re.source).test('text: "Source: " + G.board.sourceText(q)') || new RegExp(re.source).test('"Source: " + drill.repRule.source.map((s) => s.pub)')), "verifier check: ...and lets the renderer's own calls and the Wave 1 doctrine/PRT array readers through");
  const mods = loadModules().modules.filter((m) => m.emit === "build").map((m) => m.file);
  const stillFlagging = mods.filter((f) => /\.verbatim\s*=|verbatim\s*:/.test(codeOf(path.join(APP, "src", "app-modules", f)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")));
  check(stillFlagging.length === 0, "no content pack sets a verbatim flag any more (they cite through ctx.cite with a quoteKind)", () => show(stillFlagging));
}

/* =====================================================================
   6. THE RUNTIME: the browser's own two functions equal the Node ones
   ===================================================================== */
console.log("\n6. runtime - the app's G.board functions, over every card, in a real page");
const boot = await bootApp({ viewport: { width: 1200, height: 900 }, profile: "guest" });
const { page, noise } = boot;
await waitForRoute(page, "#/home");
{
  const live = await page.evaluate(() => {
    const qs = G.store.seed().board.questions;
    return qs.map((q) => ({ id: q.id, text: G.board.sourceText(q), regs: G.board.regulationsOf(q.source), kind: G.board.quoteKindOf(q), isArray: Array.isArray(q.source) }));
  });
  check(live.length === bank.length && live.every((r, i) => r.id === bank[i].id), "the page holds the same cards, in the same order, as the assembled bank", () => `page ${live.length} vs bank ${bank.length}`);
  check(live.every((r) => r.isArray), "every card in the page carries an array source");
  const tDiff = live.filter((r, i) => r.text !== renderCitation(bank[i].source)).map((r) => r.id);
  check(tDiff.length === 0, "G.board.sourceText (browser) returns exactly what renderCitation (Node) does, for every card", () => `${tDiff.length} differ: ${show(tDiff)}`);
  const rDiff = live.filter((r, i) => !same(r.regs, regulationsOfEntries(bank[i].source))).map((r) => r.id);
  check(rDiff.length === 0, "G.board.regulationsOf (browser) derives exactly the Node regulation ids from the entries, for every card", () => `${rDiff.length} differ: ${show(rDiff)}`);
  const kDiff = live.filter((r, i) => r.kind !== quoteKindOf(bank[i].source)).map((r) => r.id);
  check(kDiff.length === 0, "G.board.quoteKindOf (browser) agrees with the Node quoteKindOf, for every card", () => `${kDiff.length} differ: ${show(kDiff)}`);
  const bDiff = live.filter((r) => baseById.has(r.id) && (r.text !== baseById.get(r.id).text || !same(r.regs, baseById.get(r.id).regs) || (r.kind !== "verbatim") !== baseById.get(r.id).paraphrased)).map((r) => r.id);
  check(bDiff.length === 0, "...and the browser's answers equal the baseline (text, chips, heading) - the app itself, not just the Node port, reads the cards as recorded (the four pending-source cards are recorded as study-guide answers)", () => `${bDiff.length} differ: ${show(bDiff)}`);
  const pendingKinds = live.filter((r) => ["68w-fund-05", "68w-medlog-02", "mlc-course-06", "mlc-course-07"].includes(r.id));
  check(pendingKinds.length === 4 && pendingKinds.every((r) => r.kind === "paraphrase"), "in the running app, the four pending-source cards (68w-fund-05, 68w-medlog-02, mlc-course-06, mlc-course-07) answer quoteKindOf = paraphrase, so their card back prints the study-guide heading", () => JSON.stringify(pendingKinds.map((r) => [r.id, r.kind])));

  // The free-text path of regulationsOf (a Soldier's own note, a fixture, the grammar cases) is untouched.
  const strings = [...new Set([...baseById.values()].map((b) => b.text))];
  const strRegs = await page.evaluate((list) => list.map((s) => G.board.regulationsOf(s)), strings);
  const sDiff = strings.filter((s, i) => !same(strRegs[i], legacyRegulationsOf(s)));
  check(sDiff.length === 0, `G.board.regulationsOf(string) still returns exactly what the old free-text regex did, for all ${strings.length} distinct citations`, () => show(sDiff, 3));

  const edge = await page.evaluate(() => ({
    joined: G.board.sourceText({ source: [{ pub: "AR 623-3", edition: "", para: "", sepAfter: " / " }, { pub: "DA PAM 623-3", edition: "", para: "" }, { pub: "ADP 6-22", edition: "1 Jul 2019", para: "Ch 2", editionFirst: true }] }),
    editionLast: G.board.sourceText({ source: [{ pub: "AR 600-20", edition: "15 Apr 2026", para: "Ch 6" }] }),
    sameAsCiteText: G.board.sourceText({ source: [{ pub: "AR 623-3", edition: "2025", para: "para 1-8", editionFirst: true, sepAfter: " / " }, { pub: "DA PAM 623-3", edition: "", para: "", paraSep: " " }] }) === G.util.citeText([{ pub: "AR 623-3", edition: "2025", para: "para 1-8", editionFirst: true, sepAfter: " / " }, { pub: "DA PAM 623-3", edition: "", para: "", paraSep: " " }]),
    plain: G.board.sourceText({ source: "A Soldier's own note" }),
    given: G.board.sourceText([{ pub: "FM 7-22", edition: "2020", para: "Table B-1", editionFirst: true }]),
    none: G.board.sourceText(null),
    legacyFalse: G.board.quoteKindOf({ source: "x", verbatim: false }),
    legacyAbsent: G.board.quoteKindOf({ source: "x" }),
    empty: G.board.regulationsOf([]),
    nothing: G.board.regulationsOf(undefined),
  }));
  check(edge.joined === "AR 623-3 / DA PAM 623-3; ADP 6-22 (1 Jul 2019), Ch 2", "sourceText joins entries with each entry's own sepAfter ('; ' by default), and puts the edition right after the publication when the entry says editionFirst", () => JSON.stringify(edge.joined));
  check(edge.editionLast === "AR 600-20, Ch 6 (15 Apr 2026)" && edge.sameAsCiteText, "...otherwise the edition follows the locator, and G.board.sourceText is G.util.citeText - the one renderer in the page, not a second copy", () => JSON.stringify(edge));
  check(edge.plain === "A Soldier's own note" && edge.given === "FM 7-22 (2020), Table B-1" && edge.none === "", "sourceText passes a plain string through, accepts a bare source array, and answers '' for nothing", () => JSON.stringify(edge));
  check(edge.legacyFalse === "paraphrase" && edge.legacyAbsent === "verbatim", "a card that still carries a plain-string source falls back to the old verbatim flag (false -> paraphrase, absent -> verbatim)", () => JSON.stringify(edge));
  check(same(edge.empty, []) && same(edge.nothing, []), "regulationsOf of an empty array or nothing is []", () => JSON.stringify(edge));
}

/* the real screen: Board Drill's Definitions tab prints the exact Source line + heading */
{
  await waitForRoute(page, "#/board", { ready: ".segmented button" });
  await clickWhenStable(page, page.locator(".segmented button").filter({ hasText: /^Definitions$/ }));
  await page.locator('input[aria-label="Search definitions"]').waitFor({ state: "visible" });
  const probes = await page.evaluate(() => {
    const qs = G.store.boardQuestions();
    const conceptOf = (q) => q.concept || (q.category + " — " + q.q);
    const hayOf = (q) => (conceptOf(q) + " " + (q.acceptableAnswer || q.a) + " " + (q.boardAnswer || "") + " " + q.category).toLowerCase();
    const hays = qs.map(hayOf);
    const bybook = (q) => (q.boardAnswer || q.a) !== (q.acceptableAnswer || q.a);
    const unique = (q) => conceptOf(q).length >= 12 && hays.filter((h) => h.includes(conceptOf(q).toLowerCase())).length === 1;
    const kinds = (q) => q.source.map((e) => e.quoteKind);
    const pick = (label, pred) => { const q = qs.find((x) => pred(x) && unique(x)); return q ? { label, id: q.id, concept: conceptOf(q) } : { label, id: null }; };
    return [
      pick("a compound written 'A / B'", (q) => q.source.some((e) => e.sepAfter === " / ")),
      pick("an edition and a locator", (q) => q.source.some((e) => e.edition && e.para)),
      pick("a real publication beside a non-publication", (q) => kinds(q).includes("verbatim") && kinds(q).includes("paraphrase")),
      pick("a study-guide (paraphrase) answer under its own heading", (q) => bybook(q) && kinds(q).every((k) => k === "paraphrase")),
      pick("a By-the-Book answer under its own heading", (q) => bybook(q) && kinds(q).every((k) => k === "verbatim")),
    ];
  });
  for (const p of probes) {
    if (!p.id) { check(false, "", `no card in the running app fits the probe "${p.label}" - the probe needs a new example`); continue; }
    await page.locator('input[aria-label="Search definitions"]').fill(p.concept);
    const shown = await until(page, (concept) => [...document.querySelectorAll(".def-card")].some((c) => ((c.querySelector(".def-concept") || {}).textContent || "") === concept), p.concept);
    const read = shown ? await page.evaluate((concept) => {
      const c = [...document.querySelectorAll(".def-card")].find((x) => ((x.querySelector(".def-concept") || {}).textContent || "") === concept);
      const book = c.querySelector(".bq-bybook .bq-answer-label");
      return { src: ((c.querySelector("span.src") || {}).textContent || ""), heading: book ? book.textContent.trim() : null };
    }, p.concept) : null;
    const base = baseById.get(p.id);
    const wantHeading = base && base.paraphrased ? await page.evaluate(() => G.board.PARAPHRASE_LABEL) : "By the Book";
    check(!!read && !!base && read.src === "Source: " + base.text && read.heading === wantHeading,
      `Definitions tab, ${p.label} (${p.id}): the card shows "Source: ${base ? base.text : "?"}" and the heading "${wantHeading}"`,
      () => `read ${JSON.stringify(read)}, baseline ${JSON.stringify(base)}, wanted heading ${JSON.stringify(wantHeading)}`);
  }
}

expectNoConsoleNoise(noise);
await finish("BOARD CITATIONS");
