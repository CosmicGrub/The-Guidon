/**
 * lint-board-taxonomy: the content-shape gate ROADMAP.md §3f (Phase 0)
 * called for - the mechanical backstop for the standing rule that every
 * new sourced fact ships as a properly-tagged board card (memory:
 * guidon-content-pipeline-board-cards-rule), in the same spirit as
 * lint-doctrine-confidence.mjs (doctrine `confidence`) and
 * lint-prt-sources.mjs (PRT `sourceStatus`).
 *
 * What the 2026-09-15 survey of main's seed actually found, and what each
 * rule below is therefore calibrated to:
 *
 *  - 81 distinct board categories, ZERO near-duplicates once punctuation and
 *    parentheticals are normalized. The category rule is a forward guard:
 *    it fails the moment a 82nd string is added that is really one of the
 *    existing 81 with a stray dash or "(TC 3-21.5)" suffix variant.
 *  - 32 board sources cite something other than a numbered publication -
 *    creeds, NCOLCoE, the Geneva Conventions, DFAS/myPay, TRICARE,
 *    installation SOPs - every one legitimate. So the source rule requires
 *    a non-empty string, NOT a recognizable publication token; a "must
 *    name an AR/FM/ADP" rule would produce 32 false positives on day one.
 *    Compound multi-citation sources ("AR 600-20 / AR 600-52") are common
 *    and correct, not errors.
 *  - `difficulty` uses exactly five values, all normalized at runtime by
 *    G.board.normDifficulty(); a sixth would silently fall through that
 *    normalizer, so the set is closed here.
 *  - `tier` is missing on 502 of 993 cards BY DESIGN (optional), so it is
 *    deliberately NOT required here - that would need a 502-card backfill
 *    first, and store.boardQuestions() already treats "no tier" as
 *    "applies to all tiers".
 *  - 46 of 355 doctrine entries carried no `id` at all (one consistent
 *    older authoring batch). No app code read doctrine ids at the time, so
 *    it was a latent hazard rather than a live bug - but any future
 *    id-based feature (pillar/regulation filters, deep links) would hit it.
 *    The id rules below ship together with the deterministic backfill that
 *    closes that gap.
 *  - `pillar` (the §3f discoverability tag) is validated against the closed
 *    six-value vocabulary WHEN PRESENT, and is optional BY DESIGN, not
 *    merely until a backfill finishes: the six pillars were scoped to the
 *    SGT-board study track, and a large share of the app's content
 *    (weapons, land nav, TCCC/medical, CBRN, SERE, fitness standards, LOAC,
 *    pay/benefits, history) belongs to none of them. Untagged is the
 *    correct state for that content. PILLAR_REQUIRED exists only so the
 *    rule can be flipped deliberately if the pillar model is ever widened
 *    to cover everything.
 *  - theme.js's own `since` convention ("exactly one wave should carry it
 *    at a time") is enforced across seed content too: at most one distinct
 *    `since` value at any moment.
 */
import { fileURLToPath } from "node:url";
import { readSeed } from "./seed-io.mjs";
import { PILLARS, pillarForBoard, pillarForDoctrine, pillarForScenario } from "./pillar-map.mjs";

const SEED_PATH = fileURLToPath(new URL("../src/index.html", import.meta.url));
const { data } = readSeed(SEED_PATH);
const B = (data.board && data.board.questions) || [];
const D = (data.doctrine && data.doctrine.entries) || [];
const S = (data.scenarios && data.scenarios.scenarios) || [];

// PILLARS lives in tools/pillar-map.mjs (one definition, shared with the
// backfill tool). Keep DIFFICULTIES in sync with G.board.normDifficulty().
export const DIFFICULTIES = ["beginner", "intermediate", "expert", "advanced", "basic"];
const PILLAR_REQUIRED = false;

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const show = (arr, n = 6) => JSON.stringify(arr.slice(0, n)) + (arr.length > n ? ` (+${arr.length - n} more)` : "");

console.log("lint-board-taxonomy: board cards, doctrine entries and scenarios keep their ids, categories, sources, difficulty, pillar and since tags well-formed\n");

// (a) ids: present, string, unique - board and doctrine alike.
for (const [label, list] of [["board.questions", B], ["doctrine.entries", D], ["scenarios", S]]) {
  const missing = list.map((x, i) => (typeof x.id === "string" && x.id.trim()) ? null : i).filter((i) => i !== null);
  const seen = new Map(); const dup = [];
  list.forEach((x) => { if (typeof x.id === "string") { if (seen.has(x.id)) dup.push(x.id); seen.set(x.id, true); } });
  missing.length === 0 ? ok(`(a) every ${label} record has a non-empty string id (${list.length} checked)`) : bad(`(a) ${missing.length} ${label} record(s) have no id - indexes ${show(missing)}; titles ${show(missing.map((i) => list[i].title || list[i].q || "?"), 4)}`);
  dup.length === 0 ? ok(`(a) no duplicate ids in ${label}`) : bad(`(a) duplicate ids in ${label}: ${show([...new Set(dup)])}`);
}

// (b) category: non-empty, and no two distinct strings collapse to the same
//     normalized key (a stray dash, an added/removed "(TC 3-21.5)" suffix).
const normCat = (s) => String(s).toLowerCase().replace(/[—–]/g, "-").replace(/\s*\(.*?\)\s*/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const noCat = B.filter((q) => !(typeof q.category === "string" && q.category.trim()));
noCat.length === 0 ? ok(`(b) every board card has a non-empty category (${new Set(B.map((q) => q.category)).size} distinct)`) : bad(`(b) ${noCat.length} board card(s) with no category: ${show(noCat.map((q) => q.id))}`);
const byNorm = {};
new Set(B.map((q) => q.category).filter(Boolean)).forEach((c) => { const k = normCat(c); (byNorm[k] = byNorm[k] || []).push(c); });
const nearDup = Object.values(byNorm).filter((g) => g.length > 1);
nearDup.length === 0 ? ok("(b) no two categories are near-duplicates of each other (normalized punctuation/parentheticals)") : bad(`(b) near-duplicate category groups: ${JSON.stringify(nearDup)}`);

// (c) source: a non-empty string. Deliberately NOT "names a publication" -
//     see the header for the 32 legitimate non-publication citations.
const noSrc = B.filter((q) => !(typeof q.source === "string" && q.source.trim()));
noSrc.length === 0 ? ok("(c) every board card has a non-empty source string") : bad(`(c) ${noSrc.length} board card(s) with no source: ${show(noSrc.map((q) => q.id))}`);

// (d) the answer surface every card must carry.
for (const f of ["q", "a", "boardAnswer"]) {
  const missing = B.filter((q) => !(typeof q[f] === "string" && q[f].trim()));
  missing.length === 0 ? ok(`(d) every board card has a non-empty ${f}`) : bad(`(d) ${missing.length} board card(s) missing ${f}: ${show(missing.map((q) => q.id))}`);
}
const noKp = B.filter((q) => !(Array.isArray(q.keyPoints) && q.keyPoints.length));
noKp.length === 0 ? ok("(d) every board card has a non-empty keyPoints array") : bad(`(d) ${noKp.length} board card(s) with empty/missing keyPoints: ${show(noKp.map((q) => q.id))}`);

// (e) difficulty: the closed set normDifficulty() knows how to fold.
const badDiff = B.filter((q) => !DIFFICULTIES.includes(q.difficulty));
badDiff.length === 0 ? ok(`(e) every board card's difficulty is one of ${JSON.stringify(DIFFICULTIES)}`) : bad(`(e) ${badDiff.length} board card(s) with an unrecognized difficulty: ${show(badDiff.map((q) => q.id + "=" + q.difficulty))}`);

// (f) pillar: closed vocabulary when present (required once the backfill lands).
const withPillar = [...B, ...D, ...S].filter((x) => x.pillar != null);
const badPillar = withPillar.filter((x) => !PILLARS.includes(x.pillar));
badPillar.length === 0 ? ok(`(f) every pillar tag in use (${withPillar.length} records) is one of the 6 canonical pillars`) : bad(`(f) ${badPillar.length} record(s) with a non-canonical pillar: ${show(badPillar.map((x) => x.id + "=" + JSON.stringify(x.pillar)))}`);
if (PILLAR_REQUIRED) {
  const noPillar = [...B, ...D, ...S].filter((x) => x.pillar == null);
  noPillar.length === 0 ? ok("(f) every record carries a pillar tag") : bad(`(f) ${noPillar.length} record(s) missing a pillar tag: ${show(noPillar.map((x) => x.id))}`);
} else {
  ok(`(f) pillar presence is optional by design (${withPillar.length} of ${B.length + D.length + S.length} records tagged; content outside the six SGT-board pillars stays untagged on purpose)`);
}
// (f2) The enforceable half of the standing every-sourced-fact-gets-board-
//      cards rule: a record whose category / topic / lane IS in
//      tools/pillar-map.mjs must carry exactly that pillar. A new counseling
//      card without `pillar` fails here (fix: node tools/backfill-pillars.mjs);
//      a hand-set pillar that disagrees with the map fails too, so the map
//      and the seed can't silently drift apart.
const mismatched = [];
for (const [label, list, fn] of [["board", B, pillarForBoard], ["doctrine", D, pillarForDoctrine], ["scenario", S, pillarForScenario]]) {
  for (const r of list) {
    const want = fn(r);
    if (want && r.pillar !== want) mismatched.push(`${label} ${r.id}: pillar=${JSON.stringify(r.pillar ?? null)} expected ${JSON.stringify(want)}`);
  }
}
mismatched.length === 0
  ? ok("(f2) every record whose category/topic/lane is mapped in tools/pillar-map.mjs carries exactly that pillar")
  : bad(`(f2) ${mismatched.length} record(s) missing or contradicting their mapped pillar (run node tools/backfill-pillars.mjs for missing ones): ${show(mismatched, 5)}`);

// (g) since: one wave at a time, per theme.js's own convention.
const sinceVals = [...new Set([...B, ...D, ...S].map((x) => x.since).filter(Boolean))];
sinceVals.length <= 1 ? ok(`(g) at most one \`since\` wave is live across seed content (${JSON.stringify(sinceVals)})`) : bad(`(g) more than one \`since\` wave is live - rotate the older one off: ${JSON.stringify(sinceVals)}`);

console.log(fails === 0 ? "\nLINT-BOARD-TAXONOMY: all passed" : `\nLINT-BOARD-TAXONOMY: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
