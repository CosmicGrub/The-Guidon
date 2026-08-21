/**
 * Board Drill's full drag gesture surface (added post-Tier-1, user-requested
 * follow-up to the fixed-card-size pass): the axis of a drag decides its
 * meaning, independent of input device —
 *   - vertical (up OR down) always flips the card, whatever state it's in
 *   - horizontal BEFORE flip browses the deck without grading (prev/next)
 *   - horizontal AFTER flip keeps the original swipe-to-grade behavior
 * — across BOTH input paths wireSwipe() now drives: raw Touch events
 * (already covered for the horizontal/post-flip case by test-flip.mjs and
 * test-board-drill-grading.mjs) and the new Pointer Events path for
 * mouse/pen. This suite exercises the genuinely new surface those two don't:
 * vertical flip (either input), pre-flip horizontal browse (either input),
 * mouse drag specifically (via Playwright's trusted page.mouse, not
 * scripted dispatchEvent — real click synthesis only follows trusted
 * input), and the drag-vs-click disambiguation that a trusted mouse
 * down/move/up sequence uniquely puts at risk (a scripted PointerEvent
 * dispatch never exercises the browser's own click synthesis at all).
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

const cardCenter = async () => page.evaluate(() => {
  const r = document.querySelector(".qz-card").getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
});
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

async function mouseDrag(dx, dy) {
  const { cx, cy } = await cardCenter();
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
await page.waitForTimeout(300);
(await isFlipped()) ? ok("mouse: vertical drag flips an unflipped card") : bad("mouse: vertical drag did not flip");

/* ---- 9. Mouse: horizontal drag past threshold, post-flip, grades ---- */
const tallyBeforeMouseGrade = await tallyText();
await mouseDrag(220, 0); // drag right -> "Know It"
await page.waitForTimeout(400);
const tallyAfterMouseGrade = await tallyText();
tallyAfterMouseGrade !== tallyBeforeMouseGrade
  ? ok(`mouse: post-flip horizontal drag graded the card (tally advanced: "${tallyBeforeMouseGrade}" -> "${tallyAfterMouseGrade}")`)
  : bad("mouse: post-flip drag did not grade/advance");
(await isFlipped()) === false ? ok("mouse: the next card arrives unflipped after a mouse-graded swipe") : bad("mouse: next card came in already flipped");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
server.close();
console.log("\n" + (fails ? `BOARD DRILL GESTURES: ${fails} FAILURE(S)` : "BOARD DRILL GESTURES: all passed"));
process.exit(fails ? 1 : 0);
