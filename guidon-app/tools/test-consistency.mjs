/**
 * Corpus consistency: does the app contradict itself, or teach a superseded
 * standard as current?
 *
 * This exists because it did. A structured walk of the parsed seed - rather
 * than a regex over the raw file - found board cards that:
 *   - answered "a 465 exempts you from taping" while another card correctly
 *     explained that AD 2026-13 rescinded exactly that, on 7 July 2026
 *   - taught six AFT events including the Standing Power Throw and Leg Tuck,
 *     both of which are gone
 *   - gave 360 as the minimum passing score, which was the six-event maths
 *   - built a scenario on "302, two points below the 360 minimum", where 302
 *     is now a passing score
 *
 * Two sessions had declined to touch these on the grounds that a bulk find and
 * replace would do more harm than good. That was right about the method and
 * wrong about the conclusion: walking the parsed object and classifying by
 * claim shape found the real errors in one pass. This locks that in.
 *
 * The rule these assertions encode: a statement of the CURRENT standard must be
 * current. Historical framing ("the ACFT had six events", "the SPT was
 * dropped") is fine and deliberately still allowed.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(900);

const findings = await page.evaluate(() => {
  const hits = [];
  (function walk(node, path) {
    if (typeof node === "string") { hits.push({ path, text: node }); return; }
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, path + "[" + i + "]"));
    if (node && typeof node === "object") for (const k of Object.keys(node)) walk(node[k], path + "." + k);
  })(window.GUIDON_SEED, "seed");

  /* Present tense, no historical marker nearby = a claim about today. */
  const HISTORICAL = /was dropped|were dropped|was removed|were removed|was replaced|were replaced|replaced the ACFT|replaced the Leg Tuck|succeeded the ACFT|had replaced|former|had six|old ACFT|superseded|formerly|no longer|rescinded|is gone|are both gone|used to|previously|until 2025|teaching the old/i;
  const isHistorical = (t) => HISTORICAL.test(t);

  const checks = {
    // A currently-valid taping exemption for a high AFT score. Rescinded 7 Jul 2026.
    liveExemptionClaim: hits.filter(h =>
      /465\s*\+?\s*(?:with|grants|exempt)|grants an exemption from height\/weight|exempt(?:s|ion) from .*tape/i.test(h.text)
      && !isHistorical(h.text)),
    // Six events taught as the current test.
    sixEventsAsCurrent: hits.filter(h =>
      /(?:six|6)\s+(?:AFT|ACFT)?\s*events|all six events|pass all 6 events/i.test(h.text)
      && !isHistorical(h.text)),
    // 360 as the current minimum (that is 6 x 60; the AFT is 5 x 60 = 300).
    threeSixtyAsCurrent: hits.filter(h =>
      /(?:minimum|passing).{0,40}\b360\b|\b360\b.{0,30}(?:minimum|passing|total)/i.test(h.text)
      && !isHistorical(h.text)),
    // Standing Power Throw or Leg Tuck presented as a current TEST EVENT.
    //
    // This one took three passes to state correctly, and the corrections were
    // all to the check rather than the content:
    //   "Single-Leg Tuck" is an FM 7-22 hip stability drill exercise, and
    //   "Leg Tuck" is a current exercise in the FM 7-22 Climbing Drill. Both
    //   are correct and current; neither is the removed ACFT event.
    // So the phrase alone proves nothing - it only matters alongside the other
    // test events. "Standing Power Throw" needs no such qualifier: it existed
    // only as an ACFT event.
    removedEventsAsCurrent: hits.filter(h => {
      if (isHistorical(h.text)) return false;
      if (/Standing Power Throw/i.test(h.text)) return true;
      const legTuck = /(?<!-)\bLeg Tuck\b|\bLTK\b/i.test(h.text);
      const testContext = /\bMDL\b|\bSDC\b|\b2MR\b|Sprint-Drag|Deadlift|Two-Mile|\bACFT\b|\bAFT\b|events? (?:in|administered)/i.test(h.text);
      return legTuck && testContext;
    }),
  };
  return Object.fromEntries(Object.entries(checks).map(([k, v]) =>
    [k, v.slice(0, 4).map(x => ({ p: x.path.slice(0, 58), t: x.text.replace(/\s+/g, " ").slice(0, 130) }))]
      .concat()));
});

const LABELS = {
  liveExemptionClaim: "no card claims a live 465 taping exemption (rescinded 7 Jul 2026)",
  sixEventsAsCurrent: "no card teaches six events as the current test",
  threeSixtyAsCurrent: "no card gives 360 as the current minimum (it is 300 / 350)",
  removedEventsAsCurrent: "no card lists the Standing Power Throw or Leg Tuck as current",
};

for (const [key, label] of Object.entries(LABELS)) {
  const f = findings[key] || [];
  if (f.length === 0) ok(label);
  else {
    bad(`${label} — ${f.length} offending value(s)`);
    f.forEach(x => console.log(`         [${x.p}] ${x.t}`));
  }
}

/* Seed integrity.
   The build rewrites the seed from a JS object literal into JSON.parse("...")
   for a measured ~94ms faster boot at 6x CPU. That transform is only safe if it
   is lossless, so the shape and the content counts are asserted here rather
   than trusted. A silently truncated seed would still boot. */
const seed = await page.evaluate(() => {
  const S = window.GUIDON_SEED;
  return {
    isObject: !!S && typeof S === "object",
    topKeys: Object.keys(S || {}).length,
    board: (S.board && S.board.questions || []).length,
    acronyms: (S.acronyms && S.acronyms.terms || []).length,
    doctrine: (S.doctrine && S.doctrine.entries || []).length,
    career: (S.career && S.career.mos || []).length,
    scenarios: (S.scenarios && S.scenarios.scenarios || []).length,
    creeds: (S.creeds || []).length,
    prt: (S.prt && S.prt.drills || []).reduce((n, d) => n + (d.exercises || []).length, 0),
  };
});
seed.isObject ? ok("GUIDON_SEED parsed to an object") : bad("GUIDON_SEED is not an object");
// 19 as of Milestone 1 of docs/design/content-education-roadmap.md: added
// `creeds` ([]) and `prt` ({drills:[]}) as new empty top-level keys - no
// content yet, that's Milestone 2/3, but the keys themselves are real from
// this commit forward.
seed.topKeys === 19 ? ok("seed has all 19 top-level sections") : bad(`expected 19 top-level keys, got ${seed.topKeys}`);
// 984 as of the quick-win internal-redundancy pass: General Orders (bq21,
// bq22 - strict subsets of go-1/go-3), Weapons TC 3-22.9 (m4-1 duplicate
// of wpn-8; m4-2 duplicate of wpn-9), and TCCC/First Aid (bq-tccc-01,
// tccc-7, tccc-9, tccc-8 - each a duplicate of a fuller card) each had
// genuinely redundant cards deleted, 9 total. Every fact unique to a
// deleted card was folded into the card it duplicated first - see that
// pass's PR for the per-card reasoning. Was 993 before this pass (itself
// down from 1009 via the AFT/ACFT/Fitness consolidation - see git history
// for that baseline's own provenance comment).
seed.board === 984 ? ok("984 board cards intact") : bad(`board cards: ${seed.board}, expected 984`);
// 3623 as of the same quick-win pass: deleted "RAC-OT" (an OCR/scrape
// duplicate artifact of "RAS-OT", not a real distinct acronym) and 7
// redundant unhyphenated staff-designator overlay entries (S2, S3, G1,
// G2, G3, G4, G6) that duplicated the doctrinally-correct hyphenated
// forms (S-2, S-3, G-1..G-4, G-6) already present. G1's one unique fact
// (the S1-equivalent-at-higher-echelons framing) was folded into G-1
// first. Was 3631 as of the intuitivism pass before this: added "SLC"
// (Senior Leader Course) and "DA 7906" (the IDP form itself), both real,
// genuinely missing entries the terminology audit found - not padding.
seed.acronyms === 3623 ? ok("3,623 acronym terms intact") : bad(`acronyms: ${seed.acronyms}, expected 3623`);
// 353 as of round 6's two content-gap passes, both landing the same round:
// +15 doctrine.entries cards closing 5 topics that had a correctly-cited
// board.questions self-check category but zero doctrine cards citing the
// matching publication (336 -> 351, see the dedicated block near the end
// of this file for the per-topic detail), then +2 more for doc-levels-4
// (Direct Leadership) and doc-levels-5 (Organizational Leadership) under
// "Levels of Leadership", which previously only had a dedicated card for
// the Strategic level (doc-levels-2) - real board MOIs assign a 5-7 page
// essay on exactly this direct/organizational/strategic framework per
// ADP 6-22 (351 -> 353). Then +1 for doc-boardconduct-1 (Milestone 3 of
// docs/design/content-education-roadmap.md - "Board room posture: Position
// of Attention and Parade Rest", sourced verbatim from TC 3-21.5 paras
// 4-4 through 4-6) (353 -> 354). Then +1 for doc-cc-adv-3 (round 10,
// doctrine-content-accuracy bucket): doc-cc-adv-2's old body cited TC 3-21.5
// for a "reporting as ordered" script that TC 3-21.5 does not contain -
// TC 3-21.5 Appendix A-2's real verbatim line is "Sir/Ma'am, [Rank] [Name]
// reports". "Reporting as ordered" is a real, separately-taught board/summons
// convention (see board.questions "boardprocedu-4"), so it was split into
// its own community-tier entry rather than left mis-attributed to the TC
// 3-21.5 office-reporting procedure (354 -> 355).
seed.doctrine === 355 ? ok("355 doctrine entries intact") : bad(`doctrine: ${seed.doctrine}, expected 355`);
// 164 as of v1.4.20: task #104 added a real 46T (Visual Information
// Equipment Operator-Maintainer) entry, previously mentioned only in a
// note/array with no MOS-list entry of its own.
seed.career === 164 ? ok("164 MOS entries intact") : bad(`MOS: ${seed.career}, expected 164`);
seed.scenarios === 182 ? ok("182 scenarios intact") : bad(`scenarios: ${seed.scenarios}, expected 182`);
// creeds/prt existed as empty skeleton keys from Milestone 1 (see the
// topKeys===19 comment above) with no content until Milestone 2 (PRT Hub -
// the Preparation Drill, 1 drill / 10 exercises) and Milestone 3 (Creeds
// reading pillar, 18 creeds/identities: the Soldier's/NCO/Ranger/Cadet
// creeds, the Combat Medic Prayer, the Night Stalker Creed, the seven Army
// Values, and 11 branch mottoes/nicknames) of
// docs/design/content-education-roadmap.md. These two counts were never
// added to this file's seed-integrity check when that content landed - the
// same silent-truncation gap the 984/3623/354/164/182 checks above already
// guard every other section against.
seed.creeds === 18 ? ok("18 creeds/identities intact") : bad(`creeds: ${seed.creeds}, expected 18`);
seed.prt === 10 ? ok("10 PRT exercises intact") : bad(`prt exercises: ${seed.prt}, expected 10`);

/* The positive half: the corrected facts must actually be present. */
const present = await page.evaluate(() => {
  const s = JSON.stringify(window.GUIDON_SEED);
  return {
    aftGeneral: /300 overall|300 total|minimum total \(general\)/i.test(s),
    aftCombat: /350 overall|350 \(combat/i.test(s),
    rescission: /2026-13/.test(s),
    fiveEvents: /five events|5 events/i.test(s),
  };
});
present.aftGeneral ? ok("the 300 general standard appears in the corpus") : bad("300 general standard missing");
present.aftCombat ? ok("the 350 combat standard appears in the corpus") : bad("350 combat standard missing");
present.rescission ? ok("AD 2026-13 rescission is documented") : bad("AD 2026-13 not referenced");
present.fiveEvents ? ok("the five-event AFT is described") : bad("five-event AFT not described");

/* Content-gap pass: 5 board.questions self-check categories were correctly
 * cited to a real publication (Multidomain Operations (FM 3-0), FM 3-90,
 * TC 7-22.7, ADP 1, Defense Support of Civil Authorities / ADP 3-28) while
 * doctrine.entries had ZERO cards citing that same publication for the
 * matching topic - a Soldier drilling the self-check would see FM 3-0 but
 * the Doctrine library's "Operations" topic would only ever show ADP 5-0,
 * for example. Fixed by adding 2-4 new doctrine.entries cards per topic.
 * This asserts the fix structurally (real topic + real source.ref
 * substring on real entries), not just a raw string search over the seed -
 * the same "walk the parsed object" standard the rest of this file uses. */
const citationFix = await page.evaluate(() => {
  const entries = (window.GUIDON_SEED.doctrine && window.GUIDON_SEED.doctrine.entries) || [];
  const citing = (topic, pubSubstring) => entries.filter((e) =>
    e.topic === topic && e.source && typeof e.source.ref === "string" && e.source.ref.includes(pubSubstring));
  return {
    operationsFm30: citing("Operations", "FM 3-0").map((e) => e.id),
    tacticalFm390: citing("Tactical Operations", "FM 3-90").map((e) => e.id),
    theNcoTc7227: citing("The NCO", "TC 7-22.7").map((e) => e.id),
    armyProfessionAdp1: citing("The Army Profession", "ADP 1").map((e) => e.id),
    dscaAdp328: citing("Defense Support of Civil Authorities", "ADP 3-28").map((e) => e.id),
  };
});
const CITATION_CHECKS = [
  ["operationsFm30", 'topic "Operations" has a real doctrine.entries card citing FM 3-0 (self-check: "Multidomain Operations (FM 3-0)")'],
  ["tacticalFm390", 'topic "Tactical Operations" has a real doctrine.entries card citing FM 3-90 (self-check: "FM 3-90")'],
  ["theNcoTc7227", 'topic "The NCO" has a real doctrine.entries card citing TC 7-22.7 (self-check: "TC 7-22.7")'],
  ["armyProfessionAdp1", 'topic "The Army Profession" has a real doctrine.entries card citing ADP 1 (self-check: "ADP 1")'],
  ["dscaAdp328", 'topic "Defense Support of Civil Authorities" has a real doctrine.entries card citing ADP 3-28 (self-check: "Defense Support of Civil Authorities" / "ADP 3-28")'],
];
for (const [key, label] of CITATION_CHECKS) {
  const ids = citationFix[key] || [];
  ids.length > 0 ? ok(`${label} - ${ids.length} card(s): ${ids.join(", ")}`) : bad(`${label} - none found`);
}

/* PRT rep-rule drift guard (round 10, doctrine-content-accuracy bucket):
 * prt.drills[0].repRule.standalone/combinedSameSession and the two board
 * cards that restate those same numbers in prose (board.questions
 * "prt-drills-1" and "prt-drills-12") are three independent copies of the
 * same two facts, hand-authored in three different places. Nothing before
 * this enforced that they agree - a future edit to one copy (e.g. fixing
 * the citation further, or a real doctrine correction) could silently drift
 * from the other two. This extracts the "up to N reps" (standalone) and
 * "reduc[ed/tion] ... N rep(s)" (combinedSameSession) figures out of each
 * card's own text and asserts they equal the live repRule values - a
 * structural check on real field values, not a hardcoded expectation, so it
 * stays correct if the numbers themselves are ever revised together. */
const prtRepRuleCheck = await page.evaluate(() => {
  const seed = window.GUIDON_SEED;
  const repRule = seed.prt && seed.prt.drills && seed.prt.drills[0] && seed.prt.drills[0].repRule;
  const questions = (seed.board && seed.board.questions) || [];
  const q1 = questions.find((q) => q.id === "prt-drills-1");
  const q12 = questions.find((q) => q.id === "prt-drills-12");

  const textOf = (q) => [q && q.a, q && q.acceptableAnswer, q && q.boardAnswer, ...((q && q.keyPoints) || [])]
    .filter((s) => typeof s === "string").join(" \n ");

  const firstMatch = (re, text) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  const standaloneOf = (text) => firstMatch(/up to (\d+)\s*rep/i, text);
  const combinedOf = (text) => firstMatch(/reduc\w*\s*(?:to\s*)?(\d+)[\s-]*rep/i, text);

  const q1Text = textOf(q1);
  const q12Text = textOf(q12);

  return {
    repRuleStandalone: repRule ? repRule.standalone : null,
    repRuleCombined: repRule ? repRule.combinedSameSession : null,
    q1Standalone: standaloneOf(q1Text),
    q1Combined: combinedOf(q1Text),
    q12Standalone: standaloneOf(q12Text),
    q12Combined: combinedOf(q12Text),
  };
});
const PRT_REPRULE_CHECKS = [
  ["q1Standalone", "repRuleStandalone", 'board.questions "prt-drills-1" states the same standalone rep count as prt.drills[0].repRule.standalone'],
  ["q1Combined", "repRuleCombined", 'board.questions "prt-drills-1" states the same combined-session rep count as prt.drills[0].repRule.combinedSameSession'],
  ["q12Standalone", "repRuleStandalone", 'board.questions "prt-drills-12" states the same standalone rep count as prt.drills[0].repRule.standalone'],
  ["q12Combined", "repRuleCombined", 'board.questions "prt-drills-12" states the same combined-session rep count as prt.drills[0].repRule.combinedSameSession'],
];
for (const [gotKey, wantKey, label] of PRT_REPRULE_CHECKS) {
  const got = prtRepRuleCheck[gotKey];
  const want = prtRepRuleCheck[wantKey];
  (got !== null && got === want)
    ? ok(`${label} (${got})`)
    : bad(`${label} - card says ${JSON.stringify(got)}, repRule says ${JSON.stringify(want)}`);
}

await browser.close();
server.close();
console.log("\n" + (fails ? `CONSISTENCY: ${fails} FAILURE(S)` : "CONSISTENCY: all passed"));
process.exit(fails ? 1 : 0);
