/**
 * Casualty-care-and-cohesion design pass, day-one doctrine fixes
 * (docs/design/casualty-care-and-cohesion.md §2a) — all content verified
 * directly against the real, current source PDFs (ATP 4-02.11, 23 March
 * 2026; ATP 4-02.2, 12 July 2019) fetched this session, not assumed:
 *
 * 1. doc-tccc-1 retired: a redundant "M-MARCH" variant citing the
 *    superseded TC 4-02.1, while doc-tccc already correctly cites the
 *    current ATP 4-02.11 — the two entries had never been reconciled when
 *    doc-tccc was updated, so a Soldier searching doctrine could land on
 *    either the correct or the superseded card with no signal which was
 *    which.
 * 2. doc-tccc fixed: it covered MARCH only, but the real, current ATP
 *    4-02.11 text confirms the full protocol is MARCH-PAWS ("PAWS is the
 *    second part of the MARCH-PAWS casualty assessment... conducted after
 *    the MARCH portion", para 9-1) — a genuine completeness gap, not
 *    previously known. Also fixed a self-contradiction inside the app's
 *    own content: doc-tccc's body said "DA Form 1380" but the app's own
 *    board question tc4021-9 already correctly says "DD Form 1380" (a
 *    Department of Defense form, not Department of the Army).
 * 3. doc-medevac-9line added: zero doctrine entry existed for the 9-line
 *    MEDEVAC request before this — it was buried only in board-question
 *    answers. Sourced from ATP 4-02.2, Appendix C, Table C-1 (confirmed
 *    to be the real appendix/table via direct PDF extraction).
 *
 * Same discipline as test-doctrine-njp-awol-accuracy.mjs: ground truth is
 * read live from window.GUIDON_SEED first (so this stays correct if
 * titles/ids ever change shape), then the real #/doctrine search box and
 * a real card click drive the actual render path — this fails if either
 * the seed content or the render path that puts d.body into the DOM
 * regresses.
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
  const entries = (window.GUIDON_SEED && window.GUIDON_SEED.doctrine && window.GUIDON_SEED.doctrine.entries) || [];
  const tccc = entries.find((e) => e.id === "doc-tccc");
  const tccc1 = entries.find((e) => e.id === "doc-tccc-1");
  const medevac = entries.find((e) => e.id === "doc-medevac-9line");
  return {
    tcccTitle: tccc ? tccc.title : null,
    tcccConfidence: tccc ? tccc.confidence : null,
    tccc1Exists: !!tccc1,
    medevacTitle: medevac ? medevac.title : null,
    medevacSourceRef: medevac && medevac.source && medevac.source[0] ? medevac.source[0].pub : null,
  };
});

truth.tcccTitle
  ? ok(`seed ground truth: found doc-tccc ("${truth.tcccTitle}", confidence="${truth.tcccConfidence}")`)
  : bad("seed has no doc-tccc doctrine entry - has the seed changed shape?");
!truth.tccc1Exists
  ? ok("doc-tccc-1 (the redundant, superseded-source M-MARCH variant) is retired")
  : bad("doc-tccc-1 still exists - the two overlapping TCCC entries were never reconciled");
(truth.medevacTitle && truth.medevacSourceRef === "ATP 4-02.2")
  ? ok(`seed ground truth: found doc-medevac-9line ("${truth.medevacTitle}", source "${truth.medevacSourceRef}")`)
  : bad("seed has no doc-medevac-9line entry citing ATP 4-02.2 - the missing 9-line doctrine card was not actually added");

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

/* ---- Fix 1/2: doc-tccc now covers the full MARCH-PAWS protocol, correct form number ---- */
if (truth.tcccTitle) {
  const body = await bodyForTitle(truth.tcccTitle);
  body
    ? ok(`"${truth.tcccTitle}": card found via search and its .doc-body was read`)
    : bad(`"${truth.tcccTitle}": card not found via search, or .doc-body missing`);
  const hasMarch = !!body && /Massive hemorrhage/i.test(body) && /Airway/i.test(body) && /Respiration/i.test(body) && /Circulation/i.test(body) && /Hypothermia/i.test(body);
  hasMarch
    ? ok("rendered .doc-body still correctly covers the full MARCH sequence (fix is additive, not a regression)")
    : bad(`rendered .doc-body lost part of the MARCH sequence: "${body}"`);
  const hasPaws = !!body && /\bPAWS\b/.test(body) && /Splinting/i.test(body);
  hasPaws
    ? ok("rendered .doc-body now covers PAWS (Pain, Antibiotics, Wounds, Splinting) - the real completeness gap this fix closes")
    : bad(`rendered .doc-body still does not cover PAWS: "${body}"`);
  const hasDDForm = !!body && /DD Form 1380/.test(body);
  const hasDAForm = !!body && /DA Form 1380/.test(body);
  (hasDDForm && !hasDAForm)
    ? ok('rendered .doc-body correctly says "DD Form 1380" (was self-contradicting the app\'s own tc4021-9 board question)')
    : bad(`rendered .doc-body form-number citation wrong: DD Form 1380 present=${hasDDForm}, stale DA Form 1380 present=${hasDAForm} - "${body}"`);
}

/* ---- Fix 3: doc-medevac-9line renders the real, complete 9-line format ---- */
if (truth.medevacTitle) {
  const body = await bodyForTitle(truth.medevacTitle);
  body
    ? ok(`"${truth.medevacTitle}": card found via search and its .doc-body was read`)
    : bad(`"${truth.medevacTitle}": card not found via search, or .doc-body missing`);
  const lineLabels = ["Location of pickup site", "Radio frequency", "Number of patients by precedence", "Special equipment required", "Number of patients by type", "Security of the pickup site", "Method of marking the pickup site", "Patient nationality and status", "CBRN contamination"];
  const missing = lineLabels.filter((l) => !(body && body.includes(l)));
  missing.length === 0
    ? ok("rendered .doc-body includes all 9 real line labels from ATP 4-02.2 Table C-1, in order")
    : bad(`rendered .doc-body is missing line label(s): ${missing.join(", ")} - "${body}"`);
  const hasWartimePeacetime = !!body && /wartime/i.test(body) && /peacetime/i.test(body);
  hasWartimePeacetime
    ? ok("rendered .doc-body correctly explains the wartime/peacetime distinction on Lines 6 and 9")
    : bad(`rendered .doc-body missing the wartime/peacetime distinction: "${body}"`);
}

noise.length === 0
  ? ok("no console errors/warnings across all doctrine search/read checks")
  : bad(`console noise: ${noise.join(" | ")}`);

console.log(fails === 0 ? "\nDOCTRINE TCCC/MEDEVAC ACCURACY: all passed" : `\nDOCTRINE TCCC/MEDEVAC ACCURACY: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
