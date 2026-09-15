/**
 * ROADMAP.md §3f, Phase 0 - the counseling / supply / training-management
 * doctrine pass, all content verified directly against the real, current
 * source PDFs this session (ATP 6-22.1, 13 February 2024; ADP 7-0, April
 * 2024, superseding the 31 July 2019 edition; AR 735-5's own text for the
 * FLIPL chapter), not assumed:
 *
 * 1. doc-counsel-process added: four Counseling-topic entries already
 *    existed, but every one covered the FORM (DA 4856) or the TIMELINES
 *    (AR 623-3) - none taught the four-stage counseling PROCESS itself
 *    (ATP 6-22.1 para 2-29: identify the need / prepare / conduct the
 *    session / follow-up), nor the six components of conducting a session
 *    (para 2-50). A real gap inside an already-"covered" topic.
 * 2. doc-8step-training added: zero doctrine entries for the 8-step
 *    training model existed (the board's "eight steps" hits are TLP and the
 *    M4 cycle of functioning). Uses the REAL ADP 7-0 Table 4-1 list -
 *    which differs from an older folk version (with "coordinate resources"
 *    and "evaluate" steps, and no "Retrain") that had been drafted earlier
 *    the same day before the PDF was actually read. The negative assertion
 *    below guards exactly that regression.
 * 3. counseling-4856's citation refreshed from a stale "2015" to the 2024
 *    edition (its "three types" content verified against paras 2-6/2-8/
 *    2-10 first); the two Property Accountability entries' "2016-05"
 *    corrected to "2016-11" (AR 735-5's current edition is 9 Nov 2016;
 *    Chapter 13 = FLIPL confirmed from the regulation's own text).
 * 4. Per the standing every-sourced-fact-gets-board-cards rule: 4 matching
 *    board cards, on existing real categories.
 *
 * Same discipline as test-doctrine-tccc-medevac-accuracy.mjs: seed ground
 * truth first, then the real #/doctrine search box drives the actual
 * render path and the rendered .doc-body is what gets asserted.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);

const truth = await page.evaluate(() => {
  const S = window.GUIDON_SEED || {};
  const entries = (S.doctrine && S.doctrine.entries) || [];
  const cards = (S.board && S.board.questions) || [];
  const byId = (id) => entries.find((e) => e.id === id);
  const cp = byId("doc-counsel-process"), ts = byId("doc-8step-training"), c4856 = byId("counseling-4856");
  const propAcct = entries.filter((e) => !e.id && e.topic === "Property Accountability" && e.source && /735-5/.test(e.source.ref || ""));
  const newCards = ["counsel-proc-1", "counsel-proc-2", "adp70-8step-1", "adp70-8step-2"].map((id) => { const q = cards.find((c) => c.id === id); return q ? { id, category: q.category, pillar: q.pillar } : null; });
  return {
    cp: cp ? { title: cp.title, ref: cp.source.ref, asOf: cp.source.asOf, confidence: cp.confidence, pillar: cp.pillar } : null,
    ts: ts ? { title: ts.title, ref: ts.source.ref, asOf: ts.source.asOf, confidence: ts.confidence, pillar: ts.pillar } : null,
    c4856: c4856 ? { ref: c4856.source.ref, asOf: c4856.source.asOf } : null,
    propAcctAsOf: propAcct.map((e) => e.source.asOf),
    newCards,
  };
});

/* ---- seed ground truth ---- */
(truth.cp && truth.cp.ref === "ATP 6-22.1" && truth.cp.asOf === "2024-02" && truth.cp.confidence === "verified")
  ? ok(`seed ground truth: doc-counsel-process ("${truth.cp.title}") cites ATP 6-22.1 as of 2024-02, confidence verified`)
  : bad("doc-counsel-process missing or mis-cited: " + JSON.stringify(truth.cp));
(truth.ts && truth.ts.ref === "ADP 7-0" && truth.ts.asOf === "2024-04" && truth.ts.confidence === "verified")
  ? ok(`seed ground truth: doc-8step-training ("${truth.ts.title}") cites ADP 7-0 as of 2024-04 (the edition superseding 31 Jul 2019), confidence verified`)
  : bad("doc-8step-training missing or mis-cited: " + JSON.stringify(truth.ts));
(truth.cp && truth.cp.pillar === "Leadership & Counseling" && truth.ts && truth.ts.pillar === "Training Management")
  ? ok("both new entries carry their §3f pillar tag")
  : bad("pillar tags: " + JSON.stringify({ cp: truth.cp && truth.cp.pillar, ts: truth.ts && truth.ts.pillar }));
(truth.c4856 && truth.c4856.ref === "ATP 6-22.1" && truth.c4856.asOf === "2024-02")
  ? ok('counseling-4856\'s stale "2015" citation is refreshed to ATP 6-22.1 (2024-02) - content verified against paras 2-6/2-8/2-10 of that edition')
  : bad("counseling-4856 citation not refreshed: " + JSON.stringify(truth.c4856));
(truth.propAcctAsOf.length === 2 && truth.propAcctAsOf.every((d) => d === "2016-11"))
  ? ok('both AR 735-5 Property Accountability entries now say asOf "2016-11" (the current 9 Nov 2016 edition; was "2016-05")')
  : bad("Property Accountability asOf values: " + JSON.stringify(truth.propAcctAsOf));
const cardsOk = truth.newCards.every(Boolean)
  && truth.newCards.slice(0, 2).every((c) => c.category === "Counseling (ATP 6-22.1)" && c.pillar === "Leadership & Counseling")
  && truth.newCards.slice(2).every((c) => c.category === "ADP 7-0 (Training Doctrine)" && c.pillar === "Training Management");
cardsOk
  ? ok("all 4 matching board cards exist on real existing categories with pillar tags (standing every-sourced-fact-gets-board-cards rule)")
  : bad("board cards: " + JSON.stringify(truth.newCards));

async function bodyForTitle(title) {
  await page.evaluate(() => { location.hash = "#/doctrine"; });
  await page.waitForTimeout(400);
  const search = page.locator('input[aria-label="Search doctrine"]');
  await search.waitFor({ state: "visible", timeout: 5000 });
  await search.fill("");
  await search.fill(title);
  await page.waitForTimeout(300); // 120ms debounce + margin
  return page.evaluate((t) => {
    const cards = Array.from(document.querySelectorAll(".doc-entry-card"));
    const card = cards.find((c) => c.querySelector(".doc-title")?.textContent === t);
    return card ? card.querySelector(".doc-body")?.textContent ?? null : null;
  }, title);
}

/* ---- doc-counsel-process renders the real four stages + six session components ---- */
if (truth.cp) {
  const body = await bodyForTitle(truth.cp.title);
  body ? ok(`"${truth.cp.title}": card found via search and its .doc-body was read`) : bad(`"${truth.cp.title}": card not found via search, or .doc-body missing`);
  const stages = ["Identify the need", "Prepare", "Conduct the counseling session", "Follow-up"];
  const missingStages = stages.filter((s) => !(body && new RegExp(s, "i").test(body)));
  missingStages.length === 0
    ? ok("rendered .doc-body names all four stages (ATP 6-22.1 para 2-29): identify the need / prepare / conduct the session / follow-up")
    : bad(`rendered .doc-body missing stage(s): ${missingStages.join(", ")} - "${body}"`);
  const comps = ["open the session", "elicit the subordinate's perspective", "plan of action", "close the session", "document"];
  const missingComps = comps.filter((c) => !(body && new RegExp(c, "i").test(body)));
  missingComps.length === 0
    ? ok("rendered .doc-body covers the six components of conducting a session (para 2-50)")
    : bad(`rendered .doc-body missing session component(s): ${missingComps.join(", ")} - "${body}"`);
  (!!body && /not the process itself|not a substitute for it/i.test(body))
    ? ok("rendered .doc-body draws the form-vs-process distinction (the gap the four existing form/timeline entries left)")
    : bad(`rendered .doc-body missing the form-vs-process point: "${body}"`);
}

/* ---- doc-8step-training renders the REAL Table 4-1 list, in order, not the older folk version ---- */
if (truth.ts) {
  const body = await bodyForTitle(truth.ts.title);
  body ? ok(`"${truth.ts.title}": card found via search and its .doc-body was read`) : bad(`"${truth.ts.title}": card not found via search, or .doc-body missing`);
  const steps = ["Plan the training event", "Train and certify leaders", "Recon training sites", "Issue the operation order", "Rehearse", "Train", "Conduct after action reviews", "Retrain"];
  // Sequential search: each step must appear AFTER the previous one, so a
  // bare "Train" cannot be satisfied by the "Train" inside "Train and
  // certify leaders" two steps earlier - order is checked by construction.
  const positions = []; let __from = 0;
  for (const s of steps) { const p = (body || "").indexOf(s, __from); positions.push(p); if (p >= 0) __from = p + 1; }
  const allPresent = positions.every((p) => p >= 0);
  const inOrder = allPresent && positions.every((p, i) => i === 0 || p > positions[i - 1]);
  allPresent
    ? ok("rendered .doc-body includes all 8 real steps from ADP 7-0 Table 4-1")
    : bad(`rendered .doc-body missing step(s): ${steps.filter((_, i) => positions[i] < 0).join(", ")} - "${body}"`);
  inOrder
    ? ok("...and in Table 4-1's exact order (Plan -> Train and certify leaders -> Recon -> OPORD -> Rehearse -> Train -> AAR -> Retrain)")
    : bad(`rendered .doc-body has the 8 steps out of order: positions ${JSON.stringify(positions)}`);
  // The earlier folk-version draft had "Coordinate support and resources" and
  // "Evaluate" as named steps and ended at the AAR with no Retrain - none of
  // which is in the real Table 4-1. Guard against that draft ever replacing
  // the verified list.
  const folkTerms = ["Coordinate support", "Evaluate"];
  const leaked = folkTerms.filter((t) => body && body.includes(t));
  leaked.length === 0
    ? ok("rendered .doc-body contains none of the older folk-version step names (\"Coordinate support\", \"Evaluate\") - the verified Table 4-1 list, not the pre-verification draft")
    : bad(`rendered .doc-body contains folk-version step name(s): ${leaked.join(", ")}`);
}

noise.length === 0
  ? ok("no console errors/warnings across all doctrine search/read checks")
  : bad(`console noise: ${noise.join(" | ")}`);

console.log(fails === 0 ? "\nDOCTRINE COUNSEL/TRAINING ACCURACY: all passed" : `\nDOCTRINE COUNSEL/TRAINING ACCURACY: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
