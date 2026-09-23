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
 * sections) - add a collection to MIGRATED below only once its own wave
 * has landed, so this lint never fails on content that hasn't been
 * migrated yet.
 *
 * Checks per migrated collection (PASS/FAIL lines, exit 1 on any FAIL,
 * style of lint-patterns.mjs):
 *   (a) the field is a real array (not a string, not a bare object).
 *   (b) every array item has a non-empty string `pub`.
 *   (c) every array item's `quoteKind` is one of the 3 valid values.
 *   (d) `edition`/`para` are strings when present (empty string is valid -
 *       an intentionally blank edition/para is how the doctrine-view
 *       fabricated-date guard knows to omit that footer line, never guess).
 *
 * `--seed <path>` points it at a different copy so the verifier can be
 * verified. No dependencies beyond tools/seed-io.mjs.
 *
 * prt.drills is checked against the ASSEMBLED bank (tools/assemble-bank.mjs:
 * static seed + every "emit":"build" content pack), not just the static
 * seed - a content pack can add prt.drills records too (see
 * src/app-modules/12-prt-drills-expansion.js, the first one that does), and
 * this citation-shape gate must hold those the same as PD's own static-seed
 * record. doctrine/creeds/scenarios stay on the static seed only, matching
 * this lint's original scope, so this change does not also start enforcing
 * the schema on other packs' doctrine/scenario citations, which is a
 * separate, pre-existing gap outside this change.
 */
import path from "node:path";
import { readSeed } from "./seed-io.mjs";
import { assembleBank } from "./assemble-bank.mjs";

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const SEED_PATH = argOf("--seed") || "src/index.html";
const VALID_QUOTE_KIND = ["verbatim", "paraphrase", "synthesis"];

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
try {
  const bankOpts = {};
  if (argOf("--seed")) bankOpts.seedPath = path.resolve(argOf("--seed"));
  assembledData = assembleBank(bankOpts).data;
} catch (e) {
  bad(`could not assemble the bank for prt.drills: ${e.message}`);
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
