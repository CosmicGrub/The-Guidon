/**
 * Structured-citation schema gate.
 *
 * WHY THIS EXISTS: ROADMAP.md item F replaces free-text citation strings
 * with a mechanical shape - `source: [{pub, edition, para, quoteKind}, ...]`
 * - one array entry per publication cited, so the rights gate, the
 * fabricated-date guard, and any future superseded-publication check can
 * read a real field instead of re-parsing prose. This lint is the
 * mechanical backstop: it fails CI if any migrated collection's `source`
 * (or scenario's `doctrine`) field regresses to the old shape (a bare
 * string, a single un-arrayed object) or ships an item missing `pub`/
 * `quoteKind`, the same "don't let a required tag silently go missing
 * again" discipline tools/lint-doctrine-confidence.mjs and
 * tools/lint-prt-sources.mjs already established.
 *
 * Only collections actually migrated to the new schema are checked here.
 * ROADMAP.md item F ships in waves (Wave 1: doctrine/creeds/prt/scenario
 * doctrine refs; Wave 2: board questions; Wave 3: the remaining free-text
 * sections) - add a collection below only once its own wave has landed, so
 * this lint never fails on content that hasn't been migrated yet.
 *
 * Checks per migrated collection (PASS/FAIL lines, exit 1 on any FAIL,
 * style of lint-patterns.mjs):
 *   (a) the field is a real array (not a string, not a bare object).
 *   (b) every array item has a non-empty string `pub`.
 *   (c) every array item's `quoteKind` is one of the 3 valid values.
 *   (d) `edition`/`para` are strings when present (empty string is valid -
 *       an intentionally blank edition/para is how the doctrine-view
 *       fabricated-date guard knows to omit that footer line, never guess).
 *   (e) `sep`, when present, is one of "; " / " / " / ", " and is never on
 *       the first entry (see BOARD QUESTIONS below).
 *
 * `--seed <path>` points it at a different copy, and `--modules <dir>` at a
 * different content-pack folder, so the verifier can be verified. No
 * dependencies beyond tools/seed-io.mjs, tools/assemble-bank.mjs and
 * tools/citation-parse.mjs.
 *
 * prt.drills and board.questions are checked against the ASSEMBLED bank
 * (tools/assemble-bank.mjs: static seed + every "emit":"build" content
 * pack), not just the static seed - a content pack can add records to both
 * (src/app-modules/12-prt-drills-expansion.js adds PRT drills AND board
 * cards; 350 of the bank's 1,347 board cards come from packs), and this
 * citation-shape gate must hold those the same as a static-seed record.
 * doctrine/creeds/scenarios stay on the static seed only, matching this
 * lint's original scope, so this change does not also start enforcing the
 * schema on other packs' doctrine/scenario citations, which is a separate,
 * pre-existing gap outside this change.
 *
 * BOARD QUESTIONS (Wave 2). `board.questions[].source` is the array; the
 * old free-text string and the card-level `verbatim` boolean are gone, and
 * this lint fails the build if either comes back. What a pack author does:
 * write the readable citation and call ctx.cite(text, quoteKind) - see
 * tools/content-pack-engine.mjs and tools/citation-parse.mjs. Extra checks
 * on top of (a)-(e), each naming the card id and the pack that added it:
 *   (f) no board card carries a `verbatim` field.
 *   (g) the array's rendered text is non-empty - every card cites something.
 *   (h) structure and text agree: the regulation ids derived from the
 *       entries' `pub` (what Board Drill's regulation chips read) equal the
 *       ids the regulation rules find in the RENDERED citation. A
 *       hand-written entry that buries a publication inside `para` or
 *       `edition` would be invisible to the chips; this catches it.
 *   Informational (never a failure): how many entries stayed WHOLE - the
 *   parser keeps a citation in one piece, `pub` = the untouched text, when it
 *   cannot split it and still render the exact same words back.
 *
 * `verbatim` -> `quoteKind` (the fold, Wave 2). The card back used to choose
 * its heading from `q.verbatim === false`. It now asks G.board.quoteKindOf(q):
 *     verbatim absent  -> "verbatim"    (today's heading: "By the Book
 *     verbatim: true   -> "verbatim"     (verbatim doctrine)")
 *     verbatim: false  -> "paraphrase"  (today's heading: "Study-guide
 *                                        answer (not a word-for-word quote)")
 *   A card reads "verbatim" when ANY entry is; an entry for something that is
 *   not a publication ("unit SOP", "VA.gov") beside a real publication is
 *   cited "paraphrase" so a quotation claim is only ever made for a
 *   publication - it does not flip a card whose real citation is verbatim.
 *   "synthesis" prints the study-guide heading, like "paraphrase".
 * `para` on a board entry is the locator exactly as the citation wrote it,
 *   word included ("para 3-9c", "Ch 2", "Table B-1") - Wave 1 stored bare
 *   paragraph numbers; the board's zero-visible-change rule is why this one
 *   cannot (a Soldier already reads "Ch 2" and "paras 4-3 and 6-5").
 * `sep` (board only, presentation): what sat in front of a second-or-later
 *   citation when it was not the default "; " (" / " for "AR 623-3 / DA PAM
 *   623-3", ", " for "ADP 6-22, FM 7-22"), so the line still reads as before.
 */
import path from "node:path";
import { readSeed } from "./seed-io.mjs";
import { assembleBank } from "./assemble-bank.mjs";
import { VALID_QUOTE_KIND, VALID_SEP, renderSource, regulationsOfEntries, legacyRegulationsOf, designatorLength } from "./citation-parse.mjs";

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const SEED_PATH = argOf("--seed") || "src/index.html";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

console.log("lint-citation-schema: every migrated citation is a real {pub,edition,para,quoteKind}[] array\n");

let data;
try {
  ({ data } = readSeed(SEED_PATH));
} catch (e) {
  bad(`could not read/parse the seed at ${SEED_PATH}: ${e.message}`);
  console.log("\nLINT-CITATION-SCHEMA: " + fails + " FAILURE(S)");
  process.exit(1);
}

function checkCitationArray(label, arr, ownerLabel) {
  if (!Array.isArray(arr)) {
    bad(`${ownerLabel}'s ${label} is not an array (found ${typeof arr}) - the old string/object shape must not regress`);
    return false;
  }
  if (arr.length === 0) {
    bad(`${ownerLabel}'s ${label} is an empty array - every citation-bearing record needs at least one publication`);
    return false;
  }
  let itemOk = true;
  arr.forEach((s, j) => {
    if (!s || typeof s !== "object") { bad(`${ownerLabel}'s ${label}[${j}] is not an object`); itemOk = false; return; }
    if (typeof s.pub !== "string" || s.pub.trim() === "") { bad(`${ownerLabel}'s ${label}[${j}] has no non-empty "pub"`); itemOk = false; }
    if (!VALID_QUOTE_KIND.includes(s.quoteKind)) { bad(`${ownerLabel}'s ${label}[${j}].quoteKind is "${s.quoteKind}", must be one of: ${VALID_QUOTE_KIND.join(", ")}`); itemOk = false; }
    if (s.edition !== undefined && typeof s.edition !== "string") { bad(`${ownerLabel}'s ${label}[${j}].edition is not a string`); itemOk = false; }
    if (s.para !== undefined && typeof s.para !== "string") { bad(`${ownerLabel}'s ${label}[${j}].para is not a string`); itemOk = false; }
    if (s.sep !== undefined) {
      if (j === 0) { bad(`${ownerLabel}'s ${label}[0] carries a "sep" - only a second-or-later entry has anything in front of it`); itemOk = false; }
      else if (!VALID_SEP.includes(s.sep)) { bad(`${ownerLabel}'s ${label}[${j}].sep is ${JSON.stringify(s.sep)}, must be one of: ${VALID_SEP.map((x) => JSON.stringify(x)).join(", ")}`); itemOk = false; }
    }
  });
  return itemOk;
}

// --- doctrine.entries[].source ---
const docEntries = (data.doctrine && Array.isArray(data.doctrine.entries)) ? data.doctrine.entries : [];
if (docEntries.length) {
  let bad0 = 0;
  docEntries.forEach((e, i) => {
    const label = `doctrine.entries[${i}]${e && e.id ? ` ("${e.id}")` : ""}`;
    if (!checkCitationArray("source", e.source, label)) bad0++;
  });
  if (!bad0) ok(`doctrine.entries: all ${docEntries.length} entries carry a valid structured source[]`);
} else {
  bad("GUIDON_SEED.doctrine.entries is missing, empty, or not an array");
}

// --- creeds[].source ---
const creeds = Array.isArray(data.creeds) ? data.creeds : [];
if (creeds.length) {
  let bad0 = 0;
  creeds.forEach((c, i) => {
    if (!c.source) return; // creeds' source has always been optional (see store.creeds()'s own comment)
    const label = `creeds[${i}]${c && c.id ? ` ("${c.id}")` : ""}`;
    if (!checkCitationArray("source", c.source, label)) bad0++;
  });
  if (!bad0) ok(`creeds: every present source[] is valid (${creeds.length} entries checked)`);
} else {
  ok("creeds: none present (seed section empty) - nothing to check");
}

// --- prt.drills[].repRule.source and .exercises[].source (ASSEMBLED bank -
// see this file's own header for why prt.drills alone reads the merged
// bank instead of the static seed `data` every other section above uses) ---
let assembledData = data;
let assembleFailed = false;
try {
  const bankOpts = {};
  if (argOf("--seed")) bankOpts.seedPath = path.resolve(argOf("--seed"));
  if (argOf("--modules")) bankOpts.moduleDir = path.resolve(argOf("--modules")) + path.sep;
  assembledData = assembleBank(bankOpts).data;
} catch (e) {
  assembleFailed = true;
  bad(`could not assemble the bank for prt.drills / board.questions: ${e.message}`);
}
const drills = (assembledData.prt && Array.isArray(assembledData.prt.drills)) ? assembledData.prt.drills : [];
if (drills.length) {
  let bad0 = 0;
  drills.forEach((d, i) => {
    const dLabel = `prt.drills[${i}]${d && d.id ? ` ("${d.id}")` : ""}`;
    if (d.repRule && d.repRule.source) {
      if (!checkCitationArray("repRule.source", d.repRule.source, dLabel)) bad0++;
    }
    (d.exercises || []).forEach((ex, j) => {
      if (!ex.source) return;
      if (!checkCitationArray("source", ex.source, `${dLabel}.exercises[${j}]${ex.id ? ` ("${ex.id}")` : ""}`)) bad0++;
    });
  });
  if (!bad0) ok(`prt.drills: every present source[] is valid (${drills.length} drills checked)`);
} else {
  bad("GUIDON_SEED.prt.drills is missing, empty, or not an array");
}

// --- board.questions[].source (ASSEMBLED bank: static seed + every content
// pack - see this file's own header, "BOARD QUESTIONS") ---
const boardQs = (assembledData.board && Array.isArray(assembledData.board.questions)) ? assembledData.board.questions : [];
if (boardQs.length) {
  let bad0 = 0, entryCount = 0, annotatedWhole = 0, namedSources = 0, fromPacks = 0, bareStatic = 0, barePack = 0;
  boardQs.forEach((q, i) => {
    const label = `board.questions[${i}]${q && q.id ? ` ("${q.id}")` : ""}${q && q.__pack ? ` [pack ${q.__pack}]` : ""}`;
    if (q && q.__pack) fromPacks++;
    if (q && typeof q.source === "string") { if (q.__pack) barePack++; else bareStatic++; }
    const before = fails;
    if ("verbatim" in q) bad(`${label} still carries a "verbatim" field - fold it into the citation's quoteKind (ctx.cite(text, "paraphrase") for verbatim:false)`);
    if (!checkCitationArray("source", q.source, label)) { bad0++; return; }
    entryCount += q.source.length;
    for (const e of q.source) {
      const n = designatorLength(e.pub);
      if (n && n < e.pub.length) annotatedWhole++;   // a real publication, kept in one piece with its notes
      else if (!n) namedSources++;                    // a named source that is not a publication
    }
    const text = renderSource(q.source);
    if (!text.trim()) bad(`${label}'s source renders to no text - every card cites something`);
    const fromPubs = regulationsOfEntries(q.source), fromText = legacyRegulationsOf(text);
    if (JSON.stringify(fromPubs) !== JSON.stringify(fromText)) {
      bad(`${label}: the regulation chips read ${JSON.stringify(fromPubs)} from the entries' "pub" but the rendered citation ${JSON.stringify(text)} names ${JSON.stringify(fromText)} - a publication is buried in "edition"/"para"; give it its own entry`);
    }
    if (fails > before) bad0++;
  });
  if (barePack) console.log(`  HINT  ${barePack} pack card(s) ship a plain-string source: write the citation as before and wrap it - source: ctx.cite("AR 600-9, para 3-9c", "paraphrase") (the builder's second argument, ctx, is in G.contentPack.define(id, function (bank, ctx) {...}))`);
  if (bareStatic) console.log(`  HINT  ${bareStatic} static-seed card(s) carry a plain-string source (a card added to src/index.html's seed by hand): run  node tools/migrate-board-citations.mjs  - it structures exactly those and nothing else, and is safe to run twice`);
  if (!bad0) ok(`board.questions: all ${boardQs.length} cards (${boardQs.length - fromPacks} static seed, ${fromPacks} from content packs) carry a valid structured source[] and no verbatim flag; ${entryCount} entries, regulation chips agree with the rendered citation on every card`);
  console.log(`  INFO  board.questions: of ${entryCount} entries, ${annotatedWhole} are a publication kept whole with its own notes (the parser would not risk splitting them) and ${namedSources} name a source that is not a publication ("Creeds", "VA.gov", "unit SOP") - informational, never a failure`);
} else if (!assembleFailed) {
  bad("board.questions is missing, empty, or not an array in the assembled bank");
}

// --- scenarios.scenarios[].doctrine[] ---
const scenarios = (data.scenarios && Array.isArray(data.scenarios.scenarios)) ? data.scenarios.scenarios : [];
if (scenarios.length) {
  let bad0 = 0, withDoctrine = 0;
  scenarios.forEach((sc, i) => {
    if (!Array.isArray(sc.doctrine) || sc.doctrine.length === 0) return; // not every scenario cites doctrine
    // A small, distinct scenario family (the "sc-e3-*" set) uses `doctrine`
    // as a plain array of topic-tag strings (e.g. ["army-values","discipline"]),
    // not citation objects - a real, pre-existing schema split this lint must
    // not misclassify as broken citations. Only object-shaped arrays are the
    // structured-citation schema this lint enforces.
    if (sc.doctrine.every((x) => typeof x === "string")) return;
    withDoctrine++;
    const label = `scenarios.scenarios[${i}]${sc.id ? ` ("${sc.id}")` : ""}`;
    if (!checkCitationArray("doctrine", sc.doctrine, label)) bad0++;
  });
  if (!bad0) ok(`scenarios: every present doctrine[] is valid (${withDoctrine} of ${scenarios.length} scenarios cite doctrine)`);
} else {
  bad("GUIDON_SEED.scenarios.scenarios is missing, empty, or not an array");
}

console.log("\n" + (fails ? `LINT-CITATION-SCHEMA: ${fails} FAILURE(S)` : "LINT-CITATION-SCHEMA: all passed"));
process.exit(fails ? 1 : 0);
