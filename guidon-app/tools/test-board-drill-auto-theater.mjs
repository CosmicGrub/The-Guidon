/**
 * Auto-fullscreen on a genuinely short landscape viewport, explicitly
 * requested by the user (2026-08-22) after live testing surfaced a real bug
 * behind test-board-drill-face-parity.mjs's short-viewport section: a Z
 * Fold5 folded AND rotated to landscape (882x344 CSS px) correctly stops
 * .qz-card from overflowing the viewport, but shrinking a FIXED-ASPECT-RATIO
 * card down to fit 344px of total height also shrinks everything INSIDE it -
 * at a 104px-tall card, the answer's own scrollable area (.qz-back-scroll)
 * collapsed to 0px of usable height. The chrome above it (category label,
 * mastery badge, difficulty pill) consumed the entire card, so the actual
 * question/answer text became completely invisible, not just cramped -
 * confirmed live with a screenshot showing only grade buttons floating in
 * otherwise-empty space.
 *
 * A fixed-ratio card cannot serve both "fit the viewport" and "stay legible"
 * at this aspect ratio, so instead of shrinking further, selecting a subject
 * now hands the card the whole screen via theater mode (G.board.enterTheater,
 * a pre-existing feature - height:auto;flex:1 1 auto, no fixed ratio) when
 * the viewport is short AND landscape. This suite proves: it engages exactly
 * there and nowhere else (not folded-portrait at the same width, not the Tab
 * in any orientation, not desktop), that it actually fixes the content
 * collapse it exists to fix, and that both existing exit paths (Escape, the
 * qz-fs-btn toggle) still work when theater was entered this way rather than
 * by the manual button click it was originally built for.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootToBoard(viewport) {
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
  await page.waitForTimeout(1100);
  return { page, noise };
}

async function clickFirstTopic(page) {
  await page.evaluate(() => { const row = document.querySelector(".list-detail-row"); if (row) row.click(); });
  await page.waitForTimeout(900); // scrollIntoView + the feature's own 220ms delay
}

/* ---- The trigger case: folded AND landscape ---- */
{
  const { page, noise } = await bootToBoard({ width: 882, height: 344 });
  await clickFirstTopic(page);
  const theaterOn = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
  theaterOn
    ? ok("folded+landscape (882x344): selecting a topic auto-enters theater mode")
    : bad("folded+landscape (882x344): selecting a topic did NOT auto-enter theater mode");

  const card = await page.evaluate(() => { const r = document.querySelector(".qz-card").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  card.h > 200
    ? ok(`the theater-mode card (${card.w}x${card.h}) is well past the 104px-tall broken size - it's actually using the screen`)
    : bad(`the theater-mode card is only ${card.w}x${card.h} - still cramped, auto-theater didn't actually help`);

  // The actual bug this feature exists to fix: flip to the back face and
  // confirm .qz-back-scroll has real, non-zero usable height now.
  await page.evaluate(() => document.querySelector(".qz-card").click());
  await page.waitForTimeout(700);
  const backScroll = await page.evaluate(() => {
    const bs = document.querySelector(".qz-back-scroll");
    return bs ? { clientHeight: bs.clientHeight, scrollHeight: bs.scrollHeight } : null;
  });
  backScroll && backScroll.clientHeight > 40
    ? ok(`.qz-back-scroll has ${backScroll.clientHeight}px of usable height (was 0px before this fix, at the same viewport, in fixed-ratio mode) - the answer text is actually visible`)
    : bad(`.qz-back-scroll is only ${backScroll ? backScroll.clientHeight : "missing"}px - the content-collapse bug this feature exists to fix is still happening`);

  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- Theater mode + reduce-motion combined: a real CSS specificity bug
   found live on the Z Fold5 (2026-08-22) - theater's own .qz-card rule
   resets aspect-ratio to auto (it wants height:auto;flex:1 1 auto instead),
   but reduce-motion's aspect-ratio:5/3 rule (added earlier this session,
   see that rule's own comment) has EQUAL specificity and is declared later
   in the file, so it silently won whenever both were active together -
   nothing had combined auto-theater with reduce-motion before this feature
   made that combination reachable in practice. The visible symptom: the
   card's true (flexed) height and the value .qz-face's height:100% actually
   resolved against came apart internally, so the answer face rendered
   short inside a much taller card. ---- */
{
  const { page } = await bootToBoard({ width: 882, height: 344 });
  await clickFirstTopic(page);
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-motion", "minimal");
    document.documentElement.classList.add("reduce-motion");
  });
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const card = document.querySelector(".qz-card");
    const flipped = card.classList.contains("flipped");
    const face = document.querySelector(flipped ? ".qz-back" : ".qz-front");
    return {
      theaterOn: document.documentElement.classList.contains("qz-theater"),
      cardAspectRatio: getComputedStyle(card).aspectRatio,
      cardH: Math.round(card.getBoundingClientRect().height),
      faceH: Math.round(face.getBoundingClientRect().height),
    };
  });
  fit.theaterOn
    ? ok("theater mode is active for this check (precondition)")
    : bad("theater mode did not engage - can't test the theater+reduce-motion combination");
  fit.cardAspectRatio === "auto"
    ? ok(`in theater mode, reduce-motion's aspect-ratio:5/3 does NOT override theater's own aspect-ratio:auto (got "${fit.cardAspectRatio}")`)
    : bad(`in theater mode, .qz-card's computed aspect-ratio is "${fit.cardAspectRatio}", expected "auto" - reduce-motion's rule is winning when it shouldn't`);
  fit.faceH === fit.cardH
    ? ok(`theater + reduce-motion: the visible face (${fit.faceH}px) fills the card (${fit.cardH}px)`)
    : bad(`theater + reduce-motion: visible face is ${fit.faceH}px but card is ${fit.cardH}px - face does not fill card`);
  await page.close();
}

/* ---- Theater mode PERSISTING across a rotation back to tall portrait -
   found live on the physical Z Fold5 (2026-08-22): theater is sticky by
   design (only exits via Escape/the fs-btn/Back - see G.board.exitTheater's
   own comment), so rotating a folded phone from landscape (where auto-
   theater engaged) back to portrait does NOT exit theater mode - correct,
   since the user didn't ask to leave. But at a real portrait height
   (roughly 780-880px on this device, not the 344px landscape case above),
   theater's flex-fill grows the card to 700-800px tall, well past the
   289px the aspect-ratio and max-height overrides above were sized for -
   this is a THIRD real bug the first two fixes didn't cover, only
   reachable through this specific persisted-across-rotation path (a fresh
   boot at a tall viewport is never IN theater mode to begin with, so nothing
   before this section could have caught it). Simulated here by applying
   .qz-theater directly rather than via the row click's real
   requestFullscreen() call, which Playwright can't resize a viewport
   around - this reproduces the exact CSS state a real device is in without
   needing an actual browser fullscreen transition. ---- */
{
  const { page } = await bootToBoard({ width: 344, height: 882 });
  await page.evaluate(() => { const row = document.querySelector(".list-detail-row"); if (row) row.click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.documentElement.classList.add("qz-theater"); });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-motion", "minimal");
    document.documentElement.classList.add("reduce-motion");
  });
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const card = document.querySelector(".qz-card");
    const flipped = card.classList.contains("flipped");
    const face = document.querySelector(flipped ? ".qz-back" : ".qz-front");
    return {
      cardH: Math.round(card.getBoundingClientRect().height),
      faceH: Math.round(face.getBoundingClientRect().height),
      faceMaxHeight: getComputedStyle(face).maxHeight,
    };
  });
  fit.cardH > 400
    ? ok(`theater mode at a tall portrait viewport grows the card well past the 389px fixed-ratio cap (${fit.cardH}px) - confirms this is genuinely exercising the persisted-theater-tall case, not silently falling back to the fixed ratio`)
    : bad(`theater-mode card is only ${fit.cardH}px tall - not tall enough to be testing the actual bug scenario`);
  fit.faceH === fit.cardH
    ? ok(`theater + reduce-motion at a tall portrait viewport: the visible face (${fit.faceH}px) fills the card (${fit.cardH}px)`)
    : bad(`theater + reduce-motion at a tall portrait viewport: visible face is ${fit.faceH}px but card is ${fit.cardH}px - the 389px max-height safety net is silently re-capping it`);
  fit.faceMaxHeight === "none"
    ? ok(`the reduce-motion 389px max-height safety net is correctly lifted in theater mode (computed max-height: none)`)
    : bad(`the visible face's max-height is "${fit.faceMaxHeight}" in theater mode, expected "none" - the 389px cap is still active and will re-clamp a taller theater card`);
  await page.close();
}

/* ---- Exit paths, tested in the auto-triggered state (not the manual-click
   state the feature was originally built for - a different entry path
   could plausibly leave state inconsistent even if entry itself works) ---- */
{
  const { page } = await bootToBoard({ width: 882, height: 344 });
  await clickFirstTopic(page);
  const before = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterEscape = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
  before && !afterEscape
    ? ok("Escape exits auto-triggered theater mode")
    : bad(`Escape did not exit auto-triggered theater mode (before=${before}, after=${afterEscape})`);

  await clickFirstTopic(page);
  const before2 = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
  await page.evaluate(() => { const b = document.querySelector(".qz-fs-btn"); if (b) b.click(); });
  await page.waitForTimeout(300);
  const afterBtn = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
  before2 && !afterBtn
    ? ok("the qz-fs-btn toggle exits auto-triggered theater mode")
    : bad(`qz-fs-btn did not exit auto-triggered theater mode (before=${before2}, after=${afterBtn})`);
  await page.close();
}

/* ---- Must NOT engage outside the specific folded+landscape case - a
   feature this assertive needs an equally explicit negative-space guard,
   or it risks hijacking normal desktop/tablet use into unwanted fullscreen. ---- */
const shouldNotTrigger = [
  { viewport: { width: 344, height: 882 }, label: "Fold folded PORTRAIT (344x882) - short, but not landscape" },
  { viewport: { width: 823, height: 1317 }, label: "Tab S9 FE portrait (823x1317)" },
  { viewport: { width: 1317, height: 823 }, label: "Tab S9 FE landscape (1317x823) - landscape, but not short (vh 823 > 460)" },
  { viewport: { width: 1440, height: 900 }, label: "Desktop (1440x900)" },
];
for (const c of shouldNotTrigger) {
  const { page, noise } = await bootToBoard(c.viewport);
  await clickFirstTopic(page);
  const theaterOn = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
  !theaterOn
    ? ok(`${c.label}: selecting a topic does NOT auto-enter theater mode`)
    : bad(`${c.label}: selecting a topic incorrectly auto-entered theater mode`);
  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok(`${c.label}: no console errors/warnings`) : bad(`${c.label}: console noise: ` + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- Item 5 regression (2026-08-28): the 220ms auto-theater
   setTimeout(s) - one right after renderDrill's own initial mount, one
   inside catList's category-select click handler - used to store no timer
   handle at all, so navigating away from #/board before the delay elapsed
   left it dangling: it fired anyway, ~160ms into whatever route the user
   had already landed on, force-adding html.qz-theater there. Two
   independent fixes now guard this: (1) the timer handle is tracked in a
   module-level var route() clears on every navigation (mirroring
   scheduleMapGraphRefresh's mapRefreshTimer pattern in the Author Map tab),
   and (2) enterTheater() itself now bails out if no .qz-wrap exists in the
   DOM at all - belt-and-suspenders, since either alone would stop the
   force-applied class. Exercised here against the initial-mount timer
   specifically (unconditional the moment #/board renders in a short-
   landscape viewport - no click needed to trigger it), navigating to
   #/home well before the 220ms elapses. ---- */
{
  const page = await (await browser.newContext({ viewport: { width: 882, height: 344 } })).newPage();
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

  // Land on #/board (arms the initial-mount 220ms timer), then jump straight
  // to #/home well inside that window - the whole point of this test is to
  // beat the timer, not let it settle first.
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(60);
  await page.evaluate(() => { location.hash = "#/home"; });
  // Wait past the 220ms delay - if the timer is still dangling, it fires
  // during this wait, against #/home instead of #/board.
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => ({
    theaterOn: document.documentElement.classList.contains("qz-theater"),
    hasWrap: !!document.querySelector(".qz-wrap"),
    onHome: (location.hash || "").indexOf("#/home") === 0,
  }));
  !after.theaterOn
    ? ok("navigating away from #/board before its 220ms auto-theater timer fires does NOT force theater mode onto the new route")
    : bad("a dangling auto-theater timer force-applied qz-theater onto #/home after navigating away from #/board");
  !after.hasWrap
    ? ok("no stray .qz-wrap overlay left behind on #/home")
    : bad(".qz-wrap is still in the DOM on #/home, a route that isn't Board Drill");
  after.onHome
    ? ok("navigation actually landed on #/home (sanity check the route change itself took effect)")
    : bad("navigation did not land on #/home as expected");
  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0
    ? ok("no error thrown by the dangling timer's late callback")
    : bad("console noise from the dangling-timer scenario: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `BOARD DRILL AUTO-THEATER: ${fails} FAILURE(S)` : "BOARD DRILL AUTO-THEATER: all passed"));
process.exit(fails ? 1 : 0);
