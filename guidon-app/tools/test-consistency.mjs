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
import { assembleBank } from "./assemble-bank.mjs";
import { loadManifest, buildFigures, diffFigures } from "./content-manifest.mjs";

// No content count is typed in this file. Three things must agree:
//   - the BUILT PAGE (what a Soldier gets),
//   - tools/assemble-bank.mjs (the static seed plus every src/app-modules
//     content pack, evaluated headlessly in the app's own load order), and
//   - tools/content-manifest.json (the committed, reviewed figures).
// Page vs assembler catches a build that silently truncates or duplicates
// the bank. Page vs manifest catches the other failure - content quietly
// disappearing from the SOURCE, where the page and the assembler would
// shrink together and agree: the manifest only regenerates downward with
// `--allow-shrink "<reason>"`, which is recorded in the file.
// This replaces FLOORS = { board: 1230, ... } and five more typed counts
// (3632 terms, 164 MOS, 19 creeds, 10 PRT exercises, 19 seed sections) that
// turned main CI red twice in one week (1247 -> 1265 -> 1274) every time a
// content PR forgot to bump them. How each figure got to where it is now
// lives in the manifest's own git history and its "shrinks" list.
const assembled = assembleBank();
const manifest = loadManifest();

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

  /* Present tense, no historical marker nearby = a claim about today.
     Questions that explicitly ask "what happened to" a retired event are
     transition/history prompts, not claims that the event remains current. */
  const HISTORICAL = /what happened to|was dropped|were dropped|was removed|were removed|was replaced|were replaced|replaced the ACFT|replaced the Leg Tuck|succeeded the ACFT|had replaced|former|had six|old ACFT|superseded|formerly|no longer|rescinded|is gone|are both gone|used to|previously|until 2025|teaching the old/i;
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
   is lossless, so the shape and EVERY content figure are asserted here rather
   than trusted. A silently truncated seed would still boot.

   The figures are computed from the page's own seed by the same function that
   generates tools/content-manifest.json (buildFigures), so "the page" and "the
   manifest" cannot mean two different ways of counting. */
const pageSeed = await page.evaluate(() => window.GUIDON_SEED);
(pageSeed && typeof pageSeed === "object") ? ok("GUIDON_SEED parsed to an object") : bad("GUIDON_SEED is not an object");
const pageFigures = buildFigures({ data: pageSeed || {}, modules: [], staticCounts: {} });

// What the page can know: everything except which file a record came from.
const pageSide = (f) => ({ fingerprint: f.fingerprint, totals: f.totals, board: f.board, doctrine: f.doctrine, scenarios: f.scenarios });
const KIND_LINES = [
  ["seedSections", "top-level seed sections"], ["acronyms", "dictionary terms"], ["mos", "MOS entries"],
  ["creeds", "creeds/identities"], ["prtExercises", "PRT exercises"],
];
/** Every verdict about the content figures, as [{ pass, msg }]. A function so
 *  it can be run twice: once for real, once against planted defects. */
function countVerdicts(pageFig, headless, committed) {
  const out = [];
  const say = (pass, msg) => out.push({ pass, msg });
  const n = (v) => Number(v).toLocaleString("en-US");
  for (const [kind, label] of [["board", "board cards"], ["doctrine", "doctrine entries"], ["scenarios", "scenarios"]]) {
    const inPage = pageFig.totals[kind], inSource = headless.finalCounts[kind], reviewed = committed.totals[kind];
    (inPage === inSource && inPage === reviewed)
      ? say(true, `${n(inPage)} ${label} in the built page = ${n(headless.staticCounts[kind])} seed + ${n(inSource - headless.staticCounts[kind])} from content packs (assembled headlessly) = the committed manifest`)
      : say(false, `${label} (totals.${kind}): built page has ${n(inPage)}, assembled source has ${n(inSource)}, tools/content-manifest.json says ${n(reviewed)}${inPage === inSource ? " - the content changed: run node tools/content-manifest.mjs --write" : " - the build lost or duplicated records"}`);
  }
  for (const [kind, label] of KIND_LINES) {
    pageFig.totals[kind] === committed.totals[kind]
      ? say(true, `${n(pageFig.totals[kind])} ${label} intact (matches the committed manifest)`)
      : say(false, `${label} (totals.${kind}): built page has ${n(pageFig.totals[kind])}, tools/content-manifest.json says ${n(committed.totals[kind])}`);
  }
  const named = new Set(["board", "doctrine", "scenarios", ...KIND_LINES.map((k) => k[0])].map((k) => "totals." + k));
  const rest = diffFigures(pageSide(committed), pageSide(pageFig)).filter((x) => !named.has(x.figure));
  rest.length === 0
    ? say(true, `every other figure agrees too: ${Object.keys(committed.board.byCategory).length} board categories and ${Object.keys(committed.doctrine.byTopic).length} doctrine topics card for card, the per-pillar counts, and the bank fingerprint (${committed.fingerprint})`)
    : rest.slice(0, 12).forEach((x) => say(false, `${x.figure}: tools/content-manifest.json says ${JSON.stringify(x.from)}, the built page has ${JSON.stringify(x.to)}`));
  if (rest.length > 12) say(false, `... and ${rest.length - 12} more figure(s) differ between the manifest and the built page`);
  return out;
}
for (const v of countVerdicts(pageFigures, assembled, manifest)) (v.pass ? ok : bad)(v.msg);

// Verify the verifier: the same function must FAIL on planted defects, naming
// the figure. (a) the reviewed manifest holds one more card than the page - the
// exact shape of content vanishing from the source; (b) the page lost a card
// the assembler still has - a truncating build; (c) one card re-filed under
// another category with every total unchanged.
{
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const failing = (vs) => vs.filter((v) => !v.pass).map((v) => v.msg).join(" | ");
  const someCategory = Object.keys(manifest.board.byCategory)[0], otherCategory = Object.keys(manifest.board.byCategory)[1];
  const richer = clone(manifest); richer.totals.board += 1; richer.board.byCategory[someCategory] += 1;
  const a = failing(countVerdicts(pageFigures, assembled, richer));
  (/totals\.board/.test(a) && a.includes(JSON.stringify(someCategory).slice(1, -1))) ? ok("verifier check: a manifest holding one more card than the page fails, naming totals.board and the category") : bad("verifier check (a) did not fail as expected: " + (a || "(no failures)"));
  const truncated = clone(pageFigures); truncated.totals.doctrine -= 1;
  const b = failing(countVerdicts(truncated, assembled, manifest));
  /totals\.doctrine/.test(b) && /lost or duplicated/.test(b) ? ok("verifier check: a page one doctrine entry short of the assembled source fails as a build loss") : bad("verifier check (b) did not fail as expected: " + (b || "(no failures)"));
  const refiled = clone(pageFigures); refiled.board.byCategory[someCategory] -= 1; refiled.board.byCategory[otherCategory] += 1;
  const c = failing(countVerdicts(refiled, assembled, manifest));
  (c.includes("board.byCategory") && !/totals\./.test(c)) ? ok("verifier check: a card re-filed under another category fails even though every total is unchanged") : bad("verifier check (c) did not fail as expected: " + (c || "(no failures)"));
}
const brokenPacks = assembled.modules.filter((m) => m.error);
brokenPacks.length === 0 ? ok(`all ${assembled.modules.length} content-pack modules load headlessly`) : bad("content pack(s) failed to load headlessly: " + brokenPacks.map((m) => m.file + " - " + m.error).join("; "));

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
    e.topic === topic && Array.isArray(e.source) && e.source.some((s) => typeof s.pub === "string" && s.pub.includes(pubSubstring)));
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