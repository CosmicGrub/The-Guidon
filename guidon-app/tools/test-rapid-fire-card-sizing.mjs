/**
 * Rapid Fire's .rf-card (Party/Team mode's flat round card, Board Drill's
 * 7th tab - see src/index.html's renderRapidFire) sizing/overflow
 * engineering - "Reading the Cards" Roadmap Tier 6c, item C, the
 * load-bearing Rapid Fire fix.
 *
 * .rf-card used to have no width cap, no aspect-ratio, and no vh/dvh term -
 * just `flex:1 1 auto; min-height:220px`. Live-confirmed broken on a real
 * Z Fold5 in folded-landscape (882x344): the Correct/Pass judge-row buttons
 * rendered below the viewport's bottom edge, with no visible scroll cue,
 * because the 220px floor didn't shrink to fit the short viewport even
 * though .rf-wrap/.qz-wrap's own overflow-y:auto made the content
 * technically reachable by scrolling.
 *
 * This suite proves two things, modeled on test-board-drill-face-parity.mjs's
 * viewport-sweep pattern (a fresh browser context per interesting viewport,
 * real bounding-box checks via getBoundingClientRect() rather than mere DOM
 * presence):
 *   1. .rf-wrap genuinely inherits html.qz-theater .qz-wrap's overflow-y:auto
 *      (checked via computed style, not just reading the source - the
 *      "at minimum confirm this is functional" bar the item's own scoping
 *      note allows for).
 *   2. The judge-row Correct/Pass buttons stay within the visible viewport
 *      bounds at the real Fold5 folded dimensions in BOTH orientations
 *      (344x900 portrait, 882x344 landscape - the scoping doc's own
 *      required minimum), plus a couple of additional realistic short
 *      shapes, so the fix generalizes past the one exact device.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

/** Boots a fresh context/page at `viewport`, lands on a live Rapid Fire
 *  Party round (Solo mode is skipped deliberately - it reuses Board
 *  Drill's own .qz-card/.qz-scene, which this suite isn't about; Party's
 *  flat .rf-card is the one this item actually changed), and returns
 *  {page, noise}. Solo mode also skips the one-time explainer screen
 *  (see renderRapidFire's own startBtn handler), but Party's explainer only
 *  shows once per session/guest profile - dismissed here the same way for
 *  every context since each is a fresh guest session. */
async function bootToLiveRound(viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(1100);
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".segmented button")].find((x) => x.textContent.trim() === "Rapid Fire");
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Start Round");
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  // First-ever round in a fresh guest session shows a one-time explainer
  // instead of starting immediately (see renderRapidFire's drawExplainer) -
  // dismiss it if present so every context reaches the same live-round state.
  await page.evaluate(() => {
    const go = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Got it — let's go");
    if (go) go.click();
  });
  await page.waitForTimeout(500);
  return { page, noise };
}

/* ---- (1) .rf-wrap genuinely inherits overflow-y:auto - checked via
   computed style, not just source-reading. ---- */
{
  const { page, noise } = await bootToLiveRound({ width: 900, height: 1100 });
  const wrap = await page.evaluate(() => {
    const el = document.querySelector(".qz-wrap.rf-wrap");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { overflowY: cs.overflowY, hasQzWrap: el.classList.contains("qz-wrap"), hasRfWrap: el.classList.contains("rf-wrap") };
  });
  wrap && wrap.hasQzWrap && wrap.hasRfWrap
    ? ok(".rf-wrap carries the .qz-wrap class (confirmed live in a real round, not just read from source)")
    : bad(".rf-wrap element not found or missing one of .qz-wrap/.rf-wrap: " + JSON.stringify(wrap));
  wrap && wrap.overflowY === "auto"
    ? ok(`.rf-wrap's LIVE computed overflow-y is "${wrap.overflowY}" - genuinely functional, not just present in source`)
    : bad(`.rf-wrap's computed overflow-y is "${wrap && wrap.overflowY}", expected "auto"`);
  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("no console errors/warnings (overflow check)") : bad("console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- (2) Judge-row buttons stay within visible viewport bounds -
   getBoundingClientRect(), not just DOM presence - at the real Fold5
   folded dimensions in both orientations (the scoping doc's own required
   minimum), plus two additional realistic short shapes. ---- */
const shapes = [
  { viewport: { width: 344, height: 900 }, label: "Fold5 folded PORTRAIT (344x900)" },
  { viewport: { width: 882, height: 344 }, label: "Fold5 folded LANDSCAPE (882x344) - the exact live-confirmed bug shape" },
  { viewport: { width: 600, height: 500 }, label: "short-landscape dead zone (600x500)" },
  { viewport: { width: 320, height: 480 }, label: "very small phone (320x480)" },
];
for (const shape of shapes) {
  const { page, noise } = await bootToLiveRound(shape.viewport);
  const fit = await page.evaluate(() => {
    const correct = document.querySelector(".rf-judge-correct");
    const pass = document.querySelector(".rf-judge-pass");
    const card = document.querySelector(".rf-card");
    if (!correct || !pass || !card) return null;
    const cr = correct.getBoundingClientRect();
    const pr = pass.getBoundingClientRect();
    const cardR = card.getBoundingClientRect();
    return {
      vh: window.innerHeight, vw: window.innerWidth,
      correctBottom: cr.bottom, correctTop: cr.top, correctH: cr.height,
      passBottom: pr.bottom, passTop: pr.top, passH: pr.height,
      cardH: cardR.height, cardW: cardR.width,
    };
  });
  if (!fit) {
    bad(`${shape.label}: .rf-card/.rf-judge-correct/.rf-judge-pass not found - round did not start correctly`);
  } else {
    (fit.correctBottom <= fit.vh && fit.correctTop >= 0)
      ? ok(`${shape.label}: Correct button (top=${Math.round(fit.correctTop)}, bottom=${Math.round(fit.correctBottom)}) is fully within the ${fit.vh}px viewport`)
      : bad(`${shape.label}: Correct button is OUT of viewport bounds (top=${Math.round(fit.correctTop)}, bottom=${Math.round(fit.correctBottom)}, viewport height=${fit.vh})`);
    (fit.passBottom <= fit.vh && fit.passTop >= 0)
      ? ok(`${shape.label}: Pass button (top=${Math.round(fit.passTop)}, bottom=${Math.round(fit.passBottom)}) is fully within the ${fit.vh}px viewport`)
      : bad(`${shape.label}: Pass button is OUT of viewport bounds (top=${Math.round(fit.passTop)}, bottom=${Math.round(fit.passBottom)}, viewport height=${fit.vh})`);
    (fit.correctH > 20 && fit.passH > 20)
      ? ok(`${shape.label}: judge buttons have real, non-collapsed height (Correct=${Math.round(fit.correctH)}px, Pass=${Math.round(fit.passH)}px)`)
      : bad(`${shape.label}: judge buttons look collapsed (Correct=${Math.round(fit.correctH)}px, Pass=${Math.round(fit.passH)}px)`);
    (fit.cardH > 40 && fit.cardW > 40)
      ? ok(`${shape.label}: .rf-card itself is a real, visible size (${Math.round(fit.cardW)}x${Math.round(fit.cardH)})`)
      : bad(`${shape.label}: .rf-card looks collapsed (${Math.round(fit.cardW)}x${Math.round(fit.cardH)})`);
  }
  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok(`${shape.label}: no console errors/warnings`) : bad(`${shape.label} console noise: ` + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- Sanity: a normal desktop-sized viewport keeps the comfortable
   default look (.rf-card's min-height stays at the 220px default, not
   perpetually shrunk by the new formula) - confirms the fix is a FLOOR
   that only engages on short viewports, not a universal shrink. ---- */
{
  const { page, noise } = await bootToLiveRound({ width: 1280, height: 900 });
  const cardH = await page.evaluate(() => Math.round(document.querySelector(".rf-card").getBoundingClientRect().height));
  cardH >= 220
    ? ok(`normal desktop viewport (1280x900): .rf-card height (${cardH}px) is at or above the 220px comfortable default - the new formula doesn't shrink it here`)
    : bad(`normal desktop viewport: .rf-card height is only ${cardH}px, expected >= 220px`);
  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("desktop sanity: no console errors/warnings") : bad("desktop sanity console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `RAPID FIRE CARD SIZING: ${fails} FAILURE(S)` : "RAPID FIRE CARD SIZING: all passed"));
process.exit(fails ? 1 : 0);
