/**
 * Board Drill's full drag gesture surface (added post-Tier-1, user-requested
 * follow-up to the fixed-card-size pass): the axis of a drag decides its
 * meaning, independent of input device —
 *   - vertical (up OR down) always flips the card, whatever state it's in
 *   - horizontal BEFORE flip browses the deck without grading (prev/next)
 *   - horizontal AFTER flip keeps the original swipe-to-grade behavior
 *   - a drag that STARTS inside the answer's own scroll region
 *     (.qz-back-scroll — long answers, key points, cross-links) is not a
 *     card gesture at all; it's that region's native scroll
 * — across BOTH input paths wireSwipe() now drives: raw Touch events
 * (already covered for the horizontal/post-flip case by test-flip.mjs and
 * test-board-drill-grading.mjs) and the new Pointer Events path for
 * mouse/pen. This suite exercises the genuinely new surface those two don't:
 * vertical flip (either input), pre-flip horizontal browse (either input),
 * mouse drag specifically (via Playwright's trusted page.mouse, not
 * scripted dispatchEvent — real click synthesis only follows trusted
 * input), the drag-vs-click disambiguation that a trusted mouse
 * down/move/up sequence uniquely puts at risk (a scripted PointerEvent
 * dispatch never exercises the browser's own click synthesis at all), and
 * the scroll-region carve-out (via CDP's Input.dispatchTouchEvent, which —
 * unlike this file's own touchSwipe() below — does real coordinate-based
 * hit-testing, so it's the only way here to prove a touch that visually
 * lands inside .qz-back-scroll resolves to that element, the same gap that
 * let the original regression through: touchSwipe() dispatches events
 * directly on .qz-card regardless of (x,y), so target-based logic like
 * closest(".qz-back-scroll") can never see anything but .qz-card there).
 *
 * NOTE on the mouse post-flip grade test below: because .qz-back-scroll is
 * a flex:1 child that fills nearly the whole back face, the card's
 * geometric CENTER sits inside it once flipped — so that test deliberately
 * grabs from the card's top padding strip (just below the top edge, above
 * where the scroll region begins), not dead-center, to stay in the
 * still-swipeable chrome around it.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, hasTouch: true })).newPage();
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

// Real root cause (found via diagnostic instrumentation on GitHub's actual
// ubuntu-latest CI runner, not a local approximation - see PR #57, closed):
// on real CI this test's fixed 900px-tall viewport left almost no margin
// below the card's own vertical center - locally the card sits ~17px above
// the viewport's bottom edge at its center point, but CI's Chromium (same
// browser build/version, confirmed identical via browser.version()) renders
// whatever sits above the card on this route a few pixels taller, pushing
// the WHOLE card down just far enough that its center point lands *below*
// the viewport, off-screen. document.elementFromPoint() at that exact
// coordinate returned null there, and the trusted page.mouse click/drag
// events Playwright dispatched at it resolved to <html> as their target (a
// real mouse literally cannot click a point that isn't rendered on screen) -
// never reaching .qz-card at all, so its click/pointerdown/pointermove
// handlers never ran. This is NOT the drag/text-selection race the earlier
// user-select:none fix addressed (that was real too, for the OTHER 3
// failures now fixed) - a plain, no-drag click failing is the tell: there
// was no drag to race, the coordinate itself was simply never on-screen.
// scrollIntoViewIfNeeded() scrolls .qz-card fully into the viewport before
// any coordinate is read off it, which - since the card's own height
// (~389px) is far smaller than this viewport - guarantees every point
// inside its box, center included, is on-screen afterward, regardless of
// exactly how many pixels taller CI's font/layout rendering makes whatever
// sits above the card on any given run. Fixes the actual mechanism instead
// of guessing a taller magic-number viewport that could still be too short
// under some future layout.
async function ensureCardVisible() {
  await page.locator(".qz-card").scrollIntoViewIfNeeded();
}
const cardCenter = async () => {
  await ensureCardVisible();
  return page.evaluate(() => {
    const r = document.querySelector(".qz-card").getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
};
// Inside the 22px card padding, above where .qz-back-scroll begins — see
// this file's header note on why the post-flip grade test needs this
// instead of cardCenter().
const cardTopEdge = async () => {
  await ensureCardVisible();
  return page.evaluate(() => {
    const r = document.querySelector(".qz-card").getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + 10 };
  });
};
const isFlipped = () => page.evaluate(() => !!document.querySelector(".qz-card.flipped"));
const tallyText = () => page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
const promptText = () => page.evaluate(() => (document.querySelector(".qz-prompt") || {}).textContent || "");

async function touchSwipe(dx, dy) {
  const { cx, cy } = await cardCenter();
  await page.evaluate(({ cx, cy, dx, dy }) => {
    const card = document.querySelector(".qz-card");
    const touch = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: card, clientX: x, clientY: y });
      card.dispatchEvent(new TouchEvent(type, {
        touches: type === "touchend" ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
    };
    touch("touchstart", cx, cy);
    touch("touchmove", cx + dx * 0.6, cy + dy * 0.6);
    touch("touchmove", cx + dx, cy + dy);
    touch("touchend", cx + dx, cy + dy);
  }, { cx, cy, dx, dy });
}

async function mouseDrag(dx, dy, origin) {
  const { cx, cy } = await (origin || cardCenter)();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx * 0.5, cy + dy * 0.5, { steps: 5 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.mouse.up();
}

/* ---- 1. Touch: vertical swipe flips an unflipped card ---- */
(await isFlipped()) === false ? ok("card starts unflipped") : bad("card unexpectedly starts flipped");
await touchSwipe(0, -140); // swipe up
await page.waitForTimeout(300);
(await isFlipped()) ? ok("touch: vertical swipe UP flips an unflipped card") : bad("touch: swipe up did not flip");

/* ---- 2. Touch: vertical swipe (opposite direction) flips a flipped card back ---- */
await touchSwipe(0, 140); // swipe down
await page.waitForTimeout(300);
(await isFlipped()) === false ? ok("touch: vertical swipe DOWN flips a flipped card back (either direction works)") : bad("touch: swipe down did not flip back");

/* ---- 3. Touch: pre-flip horizontal swipe browses without grading ---- */
const promptBefore = await promptText();
const tallyBefore = await tallyText();
await touchSwipe(-150, 0); // swipe left -> next
await page.waitForTimeout(300);
const promptAfterLeft = await promptText();
const tallyAfterLeft = await tallyText();
promptAfterLeft !== promptBefore
  ? ok("touch: pre-flip swipe LEFT advances to a different card (browse, not grade)")
  : bad("touch: pre-flip swipe left did not change the card");
const recalledBefore = (tallyBefore.match(/recalled (\d+)\/(\d+)/) || [])[0];
const recalledAfterLeft = (tallyAfterLeft.match(/recalled (\d+)\/(\d+)/) || [])[0];
recalledAfterLeft === recalledBefore
  ? ok("touch: pre-flip browse left the recalled/seen tally unchanged (no grade side effect)")
  : bad(`touch: browse changed the tally - before "${recalledBefore}" after "${recalledAfterLeft}"`);
(await isFlipped()) === false ? ok("touch: card is still unflipped after browsing") : bad("touch: browse left the card flipped");

/* ---- 4. Touch: pre-flip horizontal swipe the OTHER way goes back ---- */
await touchSwipe(150, 0); // swipe right -> previous
await page.waitForTimeout(300);
const promptAfterRight = await promptText();
promptAfterRight === promptBefore
  ? ok("touch: pre-flip swipe RIGHT returns to the previous card")
  : bad(`touch: swipe right landed on "${promptAfterRight}", expected the original "${promptBefore}"`);

/* ---- 5. Mouse: a plain click (no drag) still flips normally ---- */
const { cx: clickCx, cy: clickCy } = await cardCenter();
await page.mouse.click(clickCx, clickCy);
await page.waitForTimeout(300);
(await isFlipped()) ? ok("mouse: a plain click (no drag) still flips the card") : bad("mouse: plain click did not flip");
await page.mouse.click(clickCx, clickCy); // flip back to front for the next block
await page.waitForTimeout(300);

/* ---- 6. Mouse: below-threshold drag snaps back WITHOUT also flipping via
   the browser's own click synthesis (the real risk trusted mouse events
   uniquely test - a scripted PointerEvent dispatch never fires a native
   click at all, so this can only be caught with page.mouse) ---- */
const beforeSmallDrag = await isFlipped();
await mouseDrag(35, 0); // past the 8px dead zone, well under the 70px threshold
await page.waitForTimeout(350);
(await isFlipped()) === beforeSmallDrag
  ? ok("mouse: a below-threshold drag snaps back without also flipping the card (no double-fire from the native click)")
  : bad("mouse: below-threshold drag left the card in a different flip state than before - the drag and a native click both fired");

/* ---- 7. Mouse: horizontal drag past threshold, pre-flip, browses ---- */
const promptBeforeMouseBrowse = await promptText();
await mouseDrag(-200, 0); // drag left -> next
await page.waitForTimeout(300);
const promptAfterMouseBrowse = await promptText();
promptAfterMouseBrowse !== promptBeforeMouseBrowse
  ? ok("mouse: horizontal drag past threshold (pre-flip) browses to a different card")
  : bad("mouse: horizontal drag did not browse");
(await isFlipped()) === false ? ok("mouse: card still unflipped after mouse-browse") : bad("mouse: mouse-browse left the card flipped");

/* ---- 8. Mouse: vertical drag flips the card ---- */
await mouseDrag(0, -140);
// Unlike a plain click, a vertical drag's own release fling (140ms) is
// stacked BEFORE doFlip() hands off to the stylesheet's rich-motion 650ms
// rotateY transition - isFlipped() (a class check) settles well inside
// 300ms, but getBoundingClientRect() below in test 9 needs the transform
// itself to have finished, or it reads a mid-rotation, geometrically
// skewed rect and computes the wrong coordinates for the next drag.
await page.waitForTimeout(900);
(await isFlipped()) ? ok("mouse: vertical drag flips an unflipped card") : bad("mouse: vertical drag did not flip");

/* ---- 9. Mouse: horizontal drag past threshold, post-flip, grades ---- */
// From the top padding strip, not the center — see this file's header note.
const tallyBeforeMouseGrade = await tallyText();
await mouseDrag(220, 0, cardTopEdge); // drag right -> "Know It"
await page.waitForTimeout(400);
const tallyAfterMouseGrade = await tallyText();
tallyAfterMouseGrade !== tallyBeforeMouseGrade
  ? ok(`mouse: post-flip horizontal drag graded the card (tally advanced: "${tallyBeforeMouseGrade}" -> "${tallyAfterMouseGrade}")`)
  : bad("mouse: post-flip drag did not grade/advance");
(await isFlipped()) === false ? ok("mouse: the next card arrives unflipped after a mouse-graded swipe") : bad("mouse: next card came in already flipped");

/* ---- 10. Touch (real hit-testing via CDP): a drag starting inside the
   answer's own scroll region scrolls it, and does NOT flip/grade the card.
   This is the actual regression a real Soldier hit: dragging up through a
   long answer to keep reading was being read as a vertical swipe and
   flipping the card back to the question, discarding the scroll. Uses CDP's
   Input.dispatchTouchEvent specifically because it hit-tests by real
   coordinate (unlike touchSwipe() above, which always dispatches on
   .qz-card regardless of where the touch visually lands) - the same gap
   that let this regression ship unnoticed. ---- */
async function cdpTouchDrag(x, y, dx, dy) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (px, py) => [{ x: px, y: py, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(x, y) });
  await new Promise((r) => setTimeout(r, 40));
  for (let i = 1; i <= 5; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(x + (dx * i) / 5, y + (dy * i) / 5) });
    await new Promise((r) => setTimeout(r, 40));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

// Find a card whose answer actually overflows .qz-back-scroll — a short
// answer has nothing to scroll and would make this test meaningless.
let overflowingCardFound = false;
for (let i = 0; i < 12 && !overflowingCardFound; i++) {
  if (!(await isFlipped())) { await page.evaluate(() => document.querySelector(".qz-card").click()); await page.waitForTimeout(600); }
  overflowingCardFound = await page.evaluate(() => {
    const s = document.querySelector(".qz-back-scroll");
    return s.scrollHeight > s.clientHeight + 40;
  });
  if (!overflowingCardFound) {
    await page.evaluate(() => document.querySelector(".qz-card").click()); // flip back
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".qz-nav-btn")].find((x) => (x.getAttribute("aria-label") || "") === "Next card");
      if (b) b.click();
    });
    await page.waitForTimeout(250);
  }
}

if (!overflowingCardFound) {
  bad("scroll-region test: could not find a card with an overflowing answer to test against");
} else {
  const before = await page.evaluate(() => {
    const s = document.querySelector(".qz-back-scroll");
    const r = s.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + 30, scrollTop: s.scrollTop, flipped: document.querySelector(".qz-card").classList.contains("flipped") };
  });
  const tallyBeforeScrollTest = await tallyText();
  await cdpTouchDrag(before.cx, before.cy, 0, -140); // drag up through the text, as if reading on
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => ({
    scrollTop: document.querySelector(".qz-back-scroll").scrollTop,
    flipped: document.querySelector(".qz-card").classList.contains("flipped"),
  }));
  const tallyAfterScrollTest = await tallyText();

  after.scrollTop > before.scrollTop
    ? ok(`touch (real hit-test): dragging inside a long answer's text scrolls it (scrollTop ${before.scrollTop} -> ${after.scrollTop})`)
    : bad(`touch (real hit-test): scrollTop did not advance (${before.scrollTop} -> ${after.scrollTop}) - the drag was swallowed instead of scrolling`);
  after.flipped === before.flipped
    ? ok("touch (real hit-test): the card stayed flipped/showing the answer - did NOT get flipped away by the scroll drag")
    : bad("touch (real hit-test): the card's flip state changed - the scroll drag was misread as a vertical swipe-to-flip");
  tallyAfterScrollTest === tallyBeforeScrollTest
    ? ok("touch (real hit-test): no grade was triggered by scrolling the answer")
    : bad(`touch (real hit-test): tally changed from scrolling alone - "${tallyBeforeScrollTest}" -> "${tallyAfterScrollTest}"`);
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
server.close();
console.log("\n" + (fails ? `BOARD DRILL GESTURES: ${fails} FAILURE(S)` : "BOARD DRILL GESTURES: all passed"));
process.exit(fails ? 1 : 0);
