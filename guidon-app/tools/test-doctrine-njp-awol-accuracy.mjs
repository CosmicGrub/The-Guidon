/**
 * Round 11 roadmap-audit, doctrine-content-fixes bucket: two verified/
 * sourcing doctrine.entries fixes inside window.GUIDON_SEED (src/index.html,
 * the single-line seed blob edited via tools/seed-io.mjs's readSeed()/
 * writeSeed()), each a real self-contradiction against another part of the
 * app's OWN content:
 *
 * 1. The "Article 15 / NJP — nonjudicial punishment process" entry
 *    (confidence:"verified") used to describe only two levels of Article 15
 *    authority (Summary and Field Grade), omitting Company Grade Article 15
 *    entirely - contradicting its own cited source (AR 27-10) and two
 *    sibling doctrine entries in the SAME seed ("UCMJ — the difference
 *    between Article 15 and court-martial" and "doc-ucmj-art15") that both
 *    correctly list all three types. Fixed by adding Company Grade NJP to
 *    the body text.
 *
 * 2. The "doc-ucmj-art86" (UCMJ Article 86 — AWOL) entry used to state
 *    flatly that any absence "over 30 days — considered desertion (Art.
 *    85)", conflating the 30-day duration threshold with desertion's actual
 *    specific-intent element - contradicting the app's own "bq-ucmj-awol"
 *    board-question entry, which correctly ties desertion to intent ("with
 *    intent to remain away permanently"), not duration alone. Fixed to
 *    describe the 30-day threshold as triggering Dropped From Rolls (DFR)
 *    processing (matching bq-ucmj-awol's own "AWOL for 30+ days = Dropped
 *    From Rolls (DFR)" keyPoint) and to describe desertion as a distinct,
 *    intent-defined offense rather than an automatic duration-based
 *    reclassification.
 *
 * This test drives the real #/doctrine search box (matching
 * test-doctrine-tier-range-filter.mjs's own convention of searching by
 * title rather than scanning unfiltered card order, since #/doctrine has a
 * DOC_CAP=150 render cap) and reads the real rendered .doc-body text of
 * each card via a real click into the search result - not a direct
 * window.GUIDON_SEED read - so it fails if the fix regresses either the
 * seed content OR the render path that puts d.body into the DOM.
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

// ---- Ground truth straight from the live seed, so this stays correct if
// titles/ids ever change shape (same discipline as the tier-range test) ----
const truth = await page.evaluate(() => {
  const entries = (window.GUIDON_SEED && window.GUIDON_SEED.doctrine && window.GUIDON_SEED.doctrine.entries) || [];
  const njp = entries.find((e) => e.title === "Article 15 / NJP — nonjudicial punishment process");
  const awol = entries.find((e) => e.id === "doc-ucmj-art86");
  const bq = ((window.GUIDON_SEED && window.GUIDON_SEED.board && window.GUIDON_SEED.board.questions) || [])
    .find((q) => q.id === "bq-ucmj-awol");
  return {
    njpTitle: njp ? njp.title : null,
    njpConfidence: njp ? njp.confidence : null,
    awolTitle: awol ? awol.title : null,
    bqBoardAnswer: bq ? bq.boardAnswer : null,
  };
});

truth.njpTitle
  ? ok(`seed ground truth: found the Article 15/NJP doctrine entry (confidence="${truth.njpConfidence}")`)
  : bad("seed has no \"Article 15 / NJP — nonjudicial punishment process\" doctrine entry - has the seed changed shape?");
truth.awolTitle
  ? ok(`seed ground truth: found doc-ucmj-art86 ("${truth.awolTitle}")`)
  : bad("seed has no doc-ucmj-art86 doctrine entry - has the seed changed shape?");
(truth.bqBoardAnswer && /intend/i.test(truth.bqBoardAnswer))
  ? ok("seed ground truth: bq-ucmj-awol's own boardAnswer ties desertion to intent, confirming this is the correct standard to match")
  : bad("bq-ucmj-awol board question missing or no longer intent-based - re-verify this bucket's premise");

// ---- Drive the real search box + a real card render, read the real DOM ----
async function bodyForTitle(title) {
  await page.evaluate(() => { location.hash = "#/doctrine"; });
  await page.waitForTimeout(400);
  const search = page.locator('input[aria-label="Search doctrine"]');
  await search.waitFor({ state: "visible", timeout: 5000 });
  await search.fill("");
  await search.fill(title);
  await page.waitForTimeout(300); // 120ms debounce + margin
  return page.evaluate((t) => {
    const titles = Array.from(document.querySelectorAll(".doc-entry-card"));
    const card = titles.find((c) => c.querySelector(".doc-title")?.textContent === t);
    return card ? card.querySelector(".doc-body")?.textContent ?? null : null;
  }, title);
}

/* ---- Fix 1: Article 15 / NJP now lists all three authority levels ---- */
if (truth.njpTitle) {
  const body = await bodyForTitle(truth.njpTitle);
  body
    ? ok(`"${truth.njpTitle}": card found via search and its .doc-body was read`)
    : bad(`"${truth.njpTitle}": card not found via search, or .doc-body missing`);
  const hasCompanyGrade = !!body && /Company Grade/i.test(body);
  hasCompanyGrade
    ? ok('rendered .doc-body now mentions "Company Grade" NJP authority')
    : bad(`rendered .doc-body still omits Company Grade NJP authority: "${body}"`);
  const hasSummary = !!body && /Summary NJP/i.test(body);
  const hasFieldGrade = !!body && /Field Grade NJP/i.test(body);
  (hasSummary && hasFieldGrade)
    ? ok("rendered .doc-body still correctly mentions Summary NJP and Field Grade NJP (fix is additive, not a regression)")
    : bad(`rendered .doc-body lost Summary/Field Grade wording: "${body}"`);
}

/* ---- Fix 2: doc-ucmj-art86 no longer conflates 30-day AWOL with desertion ---- */
if (truth.awolTitle) {
  const body = await bodyForTitle(truth.awolTitle);
  body
    ? ok(`"${truth.awolTitle}": card found via search and its .doc-body was read`)
    : bad(`"${truth.awolTitle}": card not found via search, or .doc-body missing`);
  const conflatesDurationWithDesertion = !!body && /over 30 days\s*[—-]\s*considered desertion/i.test(body);
  conflatesDurationWithDesertion
    ? bad(`rendered .doc-body still conflates the 30-day threshold with desertion: "${body}"`)
    : ok("rendered .doc-body no longer states that passing 30 days is itself \"considered desertion\"");
  const mentionsIntent = !!body && /intent/i.test(body);
  mentionsIntent
    ? ok("rendered .doc-body now ties desertion (Art. 85) to specific intent, matching bq-ucmj-awol's own framing")
    : bad(`rendered .doc-body still does not mention desertion's intent element: "${body}"`);
  const mentionsArt85 = !!body && /Art\.\s*85/i.test(body);
  mentionsArt85
    ? ok("rendered .doc-body still correctly cites desertion as Art. 85 (fix is a correction, not a deletion)")
    : bad(`rendered .doc-body lost the Art. 85 citation entirely: "${body}"`);
}

noise.length === 0
  ? ok("no console errors/warnings across all doctrine search/read checks")
  : bad(`console noise: ${noise.join(" | ")}`);

console.log(fails === 0 ? "\nDOCTRINE NJP/AWOL ACCURACY: all passed" : `\nDOCTRINE NJP/AWOL ACCURACY: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
