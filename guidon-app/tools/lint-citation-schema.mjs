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
 * ROADMAP.md item F shipped in waves (Wave 1: doctrine/creeds/prt/scenario
 * doctrine refs; Wave 2: board questions; Wave 3: the remaining free-text
 * sections - the WAVE3 list in tools/cite-schema.mjs) - add a collection
 * only once its own wave has landed, so this lint never fails on content
 * that hasn't been migrated yet.
 *
 * Checks per migrated collection (PASS/FAIL lines, exit 1 on any FAIL,
 * style of lint-patterns.mjs):
 *   (a) the field is a real array (not a string, not a bare object) and,
 *       when present, not empty ("no citation" is the ABSENCE of the key).
 *   (b) every array item has a non-empty string `pub`.
 *   (c) every array item's `quoteKind` is one of the 3 valid values.
 *   (d) `edition`/`para` are strings when present (empty string is valid -
 *       an intentionally blank edition/para is how the doctrine-view
 *       fabricated-date guard knows to omit that footer line, never guess).
 *   (e) the three optional PRESENTATION keys (tools/cite-schema.mjs explains
 *       them): `paraSep` is a string; `sepAfter` is one of the joiners in
 *       VALID_SEP_AFTER and never sits on the LAST entry (a joiner only
 *       exists between two); `editionFirst` is exactly `true`. The retired
 *       Wave 2 draft key `sep` is refused, with what to write instead.
 *   (f) Wave 3 only: the OLD free-text key (`cite`, `ref`, `reference`,
 *       `citation`) is gone from every record of a migrated collection - a
 *       content author who types the old key gets told what to write instead.
 *
 * EVERYTHING is checked against the ASSEMBLED bank (tools/assemble-bank.mjs:
 * static seed + every "emit":"build" content pack), never the static seed
 * alone. A content pack authors its own records at build time through
 * G.contentPack.define, so a check of the static seed only cannot see a
 * pack that injects an old-shape record. That is not hypothetical: Wave 1
 * was checked on the static seed, and four scenarios in
 * src/app-modules/06-opsec-cyber-curriculum-content.js (plus PRT's
 * per-exercise cadenceOverride.source) shipped in the old {ref,para,asOf}
 * shape - the AAR printed "undefined (...)" for them - until Wave 3 moved
 * every check onto the assembled bank.
 *
 * BOARD QUESTIONS (Wave 2). `board.questions[].source` is the array; the
 * old free-text string and the card-level `verbatim` boolean are gone, and
 * this lint fails the build if either comes back. What a pack author does:
 * write the readable citation and call ctx.cite(text, quoteKind) - see
 * tools/content-pack-engine.mjs and tools/citation-parse.mjs. Extra checks
 * on top of (a)-(e), each naming the card id and the pack that added it:
 *   (g) no board card carries a `verbatim` field.
 *   (h) the array's rendered text is non-empty - every card cites something.
 *   (i) structure and text agree: the regulation ids derived from the
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
 *
 * DELIBERATELY NOT CHECKED (see the report that came with Wave 3):
 *   - forms.forms[].ref on the 8 forms that name their citation `ref`
 *     instead of `reference`: no screen ever showed it, so migrating it would
 *     CHANGE what a Soldier sees (a new reference tag, new search hits, and
 *     new MOI Import coverage). That is a product decision, not a data
 *     migration; it is listed in FORMS_MISNAMED_REF below so it cannot spread.
 *   - section-level `asOf` banner strings ("2022-11 (DA 7906) / ADP 6-22 ..."):
 *     a freshness caption, not a citation of one record.
 *
 * `--seed <path>` points it at a different copy, and `--modules <dir>` at a
 * different content-pack folder, so the verifier can be verified
 * (tools/test-board-citations.mjs and tools/test-section-citations.mjs plant
 * defects that way). No dependencies beyond tools/assemble-bank.mjs,
 * tools/cite-schema.mjs and tools/citation-parse.mjs.
 */
import path from "node:path";
import { assembleBank } from "./assemble-bank.mjs";
import { WAVE3, VALID_QUOTE_KIND, VALID_SEP_AFTER, renderCitation } from "./cite-schema.mjs";
import { regulationsOfEntries, legacyRegulationsOf, designatorLength } from "./citation-parse.mjs";

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };

// The 8 forms whose citation sits under `ref` (see the header). A NINTH would
// be a new instance of the same mistake, so the list is exact, not a pattern.
export const FORMS_MISNAMED_REF = ["da3161", "da2062", "dd2873", "da5960", "dd2875", "dd200", "da1594", "da2166support"];

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

console.log("lint-citation-schema: every migrated citation is a real {pub,edition,para,quoteKind}[] array\n");

let data;
try {
  const bankOpts = {};
  if (argOf("--seed")) bankOpts.seedPath = path.resolve(argOf("--seed"));
  if (argOf("--modules")) bankOpts.moduleDir = path.resolve(argOf("--modules")) + path.sep;
  data = assembleBank(bankOpts).data;
} catch (e) {
  bad(`could not assemble the bank: ${e.message}`);
  console.log("\nLINT-CITATION-SCHEMA: " + fails + " FAILURE(S)");
  process.exit(1);
}

function checkCitationArray(label, arr, ownerLabel) {
  if (!Array.isArray(arr)) {
    bad(`${ownerLabel}'s ${label} is not an array (found ${typeof arr}) - the old string/object shape must not regress`);
    return false;
  }
  if (arr.length === 0) {
    bad(`${ownerLabel}'s ${label} is an empty array - every citation-bearing record needs at least one publication (or no ${label} key at all)`);
    return false;
  }
  let itemOk = true;
  arr.forEach((s, j) => {
    if (!s || typeof s !== "object") { bad(`${ownerLabel}'s ${label}[${j}] is not an object`); itemOk = false; return; }
    if (typeof s.pub !== "string" || s.pub.trim() === "") {
      bad(`${ownerLabel}'s ${label}[${j}] has no non-empty "pub"${s.ref !== undefined ? ' (it still has the old {ref, para, asOf} shape: rename ref to pub, asOf to edition, and add a quoteKind)' : ""}`);
      itemOk = false;
    }
    if (!VALID_QUOTE_KIND.includes(s.quoteKind)) { bad(`${ownerLabel}'s ${label}[${j}].quoteKind is "${s.quoteKind}", must be one of: ${VALID_QUOTE_KIND.join(", ")}`); itemOk = false; }
    if (s.edition !== undefined && typeof s.edition !== "string") { bad(`${ownerLabel}'s ${label}[${j}].edition is not a string`); itemOk = false; }
    if (s.para !== undefined && typeof s.para !== "string") { bad(`${ownerLabel}'s ${label}[${j}].para is not a string`); itemOk = false; }
    if (s.paraSep !== undefined && typeof s.paraSep !== "string") { bad(`${ownerLabel}'s ${label}[${j}].paraSep is not a string`); itemOk = false; }
    if (s.sepAfter !== undefined) {
      if (typeof s.sepAfter !== "string") { bad(`${ownerLabel}'s ${label}[${j}].sepAfter is not a string`); itemOk = false; }
      else if (!VALID_SEP_AFTER.includes(s.sepAfter)) { bad(`${ownerLabel}'s ${label}[${j}].sepAfter is ${JSON.stringify(s.sepAfter)}, must be one of: ${VALID_SEP_AFTER.map((x) => JSON.stringify(x)).join(", ")}`); itemOk = false; }
      else if (j === arr.length - 1) { bad(`${ownerLabel}'s ${label}[${j}] is the last entry but carries a "sepAfter" - a joiner only sits between two entries`); itemOk = false; }
    }
    if (s.editionFirst !== undefined && s.editionFirst !== true) { bad(`${ownerLabel}'s ${label}[${j}].editionFirst is ${JSON.stringify(s.editionFirst)}, it is either true or absent`); itemOk = false; }
    if (s.sep !== undefined) { bad(`${ownerLabel}'s ${label}[${j}] carries the retired "sep" key - put the joiner on the entry BEFORE it, as "sepAfter" (tools/cite-schema.mjs)`); itemOk = false; }
  });
  return itemOk;
}

// --- doctrine.entries[].source (+ no legacy top-level .ref) ---
const docEntries = (data.doctrine && Array.isArray(data.doctrine.entries)) ? data.doctrine.entries : [];
if (docEntries.length) {
  let bad0 = 0;
  docEntries.forEach((e, i) => {
    const label = `doctrine.entries[${i}]${e && e.id ? ` ("${e.id}")` : ""}${e && e.__pack ? ` [from ${e.__pack}]` : ""}`;
    if (!checkCitationArray("source", e.source, label)) bad0++;
    if (e.ref !== undefined) { bad(`${label} still has a top-level "ref" - a second citation belongs as a second source[] entry`); bad0++; }
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

// --- prt.drills[].repRule.source and .exercises[].source ---
const drills = (data.prt && Array.isArray(data.prt.drills)) ? data.prt.drills : [];
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

// --- board.questions[].source (Wave 2; the assembled bank: static seed + every
// content pack - see this file's own header, "BOARD QUESTIONS") ---
const boardQs = (data.board && Array.isArray(data.board.questions)) ? data.board.questions : [];
let boardChecked = 0;
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
    const text = renderCitation(q.source);
    if (!text.trim()) bad(`${label}'s source renders to no text - every card cites something`);
    const fromPubs = regulationsOfEntries(q.source), fromText = legacyRegulationsOf(text);
    if (JSON.stringify(fromPubs) !== JSON.stringify(fromText)) {
      bad(`${label}: the regulation chips read ${JSON.stringify(fromPubs)} from the entries' "pub" but the rendered citation ${JSON.stringify(text)} names ${JSON.stringify(fromText)} - a publication is buried in "edition"/"para"; give it its own entry`);
    }
    if (fails > before) bad0++;
  });
  boardChecked = boardQs.length;
  if (barePack) console.log(`  HINT  ${barePack} pack card(s) ship a plain-string source: write the citation as before and wrap it - source: ctx.cite("AR 600-9, para 3-9c", "paraphrase") (the builder's second argument, ctx, is in G.contentPack.define(id, function (bank, ctx) {...}))`);
  if (bareStatic) console.log(`  HINT  ${bareStatic} static-seed card(s) carry a plain-string source (a card added to src/index.html's seed by hand): run  node tools/migrate-board-citations.mjs  - it structures exactly those and nothing else, and is safe to run twice`);
  if (!bad0) ok(`board.questions: all ${boardQs.length} cards (${boardQs.length - fromPacks} static seed, ${fromPacks} from content packs) carry a valid structured source[] and no verbatim flag; ${entryCount} entries, regulation chips agree with the rendered citation on every card`);
  console.log(`  INFO  board.questions: of ${entryCount} entries, ${annotatedWhole} are a publication kept whole with its own notes (the parser would not risk splitting them) and ${namedSources} name a source that is not a publication ("Creeds", "VA.gov", "unit SOP") - informational, never a failure`);
} else {
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
    const label = `scenarios.scenarios[${i}]${sc.id ? ` ("${sc.id}")` : ""}${sc.__pack ? ` [from ${sc.__pack}]` : ""}`;
    if (!checkCitationArray("doctrine", sc.doctrine, label)) bad0++;
  });
  if (!bad0) ok(`scenarios: every present doctrine[] is valid (${withDoctrine} of ${scenarios.length} scenarios cite doctrine)`);
} else {
  bad("GUIDON_SEED.scenarios.scenarios is missing, empty, or not an array");
}

// --- Wave 3: every collection in WAVE3 (tools/cite-schema.mjs) ---
let wave3Owners = 0, wave3WithSource = 0;
for (const site of WAVE3) {
  const owners = site.owners(data);
  let bad0 = 0, withSource = 0;
  owners.forEach(({ owner, path: p }) => {
    if (!owner || typeof owner !== "object") return;
    const label = `${site.id} ${p.join(".")}${owner.id ? ` ("${owner.id}")` : ""}`;
    if (site.oldField !== site.field && owner[site.oldField] !== undefined) {
      // (forms.forms[].ref is a DIFFERENT key from that collection's old `reference`, so it never lands here.)
      bad(`${label} still has the free-text "${site.oldField}" - write it as ${site.field}: [{ pub, edition, para, quoteKind }] instead`);
      bad0++;
    }
    if (owner[site.field] === undefined) return; // a record with no citation simply has no key
    withSource++;
    if (!checkCitationArray(site.field, owner[site.field], label)) bad0++;
  });
  wave3Owners += owners.length; wave3WithSource += withSource;
  if (!owners.length) bad(`${site.id}: no records found - the collection is missing from the bank, or the walker in tools/cite-schema.mjs no longer matches its shape`);
  else if (!bad0) ok(`${site.id}: ${withSource} of ${owners.length} record(s) carry a valid structured ${site.field}[]`);
}

// --- the misnamed forms `ref`, held to exactly the known 8 ---
{
  const forms = (data.forms && Array.isArray(data.forms.forms)) ? data.forms.forms : [];
  const stray = forms.filter((f) => f && f.ref !== undefined && !FORMS_MISNAMED_REF.includes(f.id)).map((f) => f.id);
  const missing = FORMS_MISNAMED_REF.filter((id) => !forms.some((f) => f && f.id === id && f.ref !== undefined));
  if (stray.length) bad(`forms.forms: a form other than the 8 known ones now carries a top-level "ref" (${stray.join(", ")}) - the Forms screen shows its citation from "source", so "ref" never displays; use source: [{ pub, edition, para, quoteKind }]`);
  else if (missing.length) bad(`forms.forms: ${missing.join(", ")} no longer carry the misnamed "ref" - remove them from FORMS_MISNAMED_REF in tools/lint-citation-schema.mjs`);
  else ok(`forms.forms: the 8 known forms with a misnamed "ref" (never displayed, deliberately left) are exactly ${FORMS_MISNAMED_REF.length}; no new ones`);
}

console.log("\n" + (fails ? `LINT-CITATION-SCHEMA: ${fails} FAILURE(S)` : `LINT-CITATION-SCHEMA: all passed (${boardChecked} board cards, ${wave3WithSource} Wave 3 citations across ${WAVE3.length} collections, plus Wave 1)`));
process.exit(fails ? 1 : 0);
