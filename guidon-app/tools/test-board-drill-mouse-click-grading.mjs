/**
 * Real-mouse-click regression: Board Drill's Pointer Events gesture engine
 * (wireSwipe(), src/index.html) captured the pointer on ANY mouse/pen press
 * inside .qz-card that didn't start on .qz-star-btn or .qz-back-scroll -
 * including a press on a .qz-grade-btn. With the pointer captured by the
 * card, the browser dispatches the click that follows to the CAPTURING
 * element (.qz-card), not to the button actually pressed - so the card's own
 * tap-to-flip handler ran instead of the grade button's click -> grade()
 * call. The card just flipped back to the question; nothing was graded, no
 * srs:<id> row was written.
 *
 * Every OTHER test in this suite clicks .qz-grade-btn via
 * page.evaluate(() => btn.click()) - a synthetic click with no pointerdown/
 * pointerup/pointer-capture behind it at all - so none of them ever exercised
 * this path. This test drives the real UI with Playwright's trusted mouse
 * input (page.locator(...).click(), which performs a real mousedown/up at
 * the element's screen coordinates) end to end: flip with a real click on
 * the card, grade with a real click on a .qz-grade-btn, and confirm the star
 * button - whose carve-out already existed but only checked
 * `e.target instanceof HTMLElement`, which is false when the pointer lands
 * on the SVG icon INSIDE the button - still stars with a real click too.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(1100);

const hasCard = await page.evaluate(() => !!document.querySelector(".qz-wrap"));
hasCard ? ok("#/board renders a real flashcard (.qz-wrap present)") : bad("#/board: no flashcard rendered");

if (hasCard) {
  // Resolve the shown card's real question id (for the srs:<id> assertion
  // below) the same way other tests in this suite match a rendered prompt
  // back to its source question - via G.store.boardQuestions(), not a DOM
  // data attribute (the card carries none).
  const before = await page.evaluate(() => {
    const prompt = document.querySelector(".qz-prompt")?.textContent || "";
    const q = window.G.store.boardQuestions().find((x) => x.q === prompt);
    return { prompt, id: q ? q.id : null };
  });
  before.id ? ok("resolved the shown card's real question id") : bad("could not resolve the shown card's question id from G.store.boardQuestions()");

  // ---- 1. Real mouse click on the card face flips it ----
  await page.locator(".qz-card").click();
  await page.waitForTimeout(500);
  const flipped = await page.evaluate(() => !!document.querySelector(".qz-card.flipped"));
  flipped ? ok("a real mouse click on the card face flips it") : bad("a real mouse click on the card face did not flip it");

  if (flipped && before.id) {
    // ---- 2. Real mouse click on a .qz-grade-btn grades the card ----
    // This is the actual regression: Playwright's locator.click() performs a
    // trusted mousedown/mouseup at the button's on-screen coordinates - the
    // same input a real Soldier's mouse produces, and the one path
    // page.evaluate(() => el.click()) elsewhere in this suite never covers.
    await page.locator(".qz-grade-btn.qz-grade-2").click();
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => ({
      prompt: document.querySelector(".qz-prompt")?.textContent || "",
      flipped: !!document.querySelector(".qz-card.flipped"),
    }));
    after.prompt !== before.prompt
      ? ok("a real mouse click on .qz-grade-btn.qz-grade-2 advances to the next card")
      : bad("a real mouse click on .qz-grade-btn.qz-grade-2 did not advance the card (the card's own flip handler ran instead - the regression)");
    after.flipped === false
      ? ok("the next card arrives unflipped after a real-mouse-click grade")
      : bad("the card is still flipped after a real-mouse-click grade attempt");

    const srsRow = await page.evaluate(async (id) => {
      const row = await window.G.db.get("kv", "srs:" + id);
      return row ? row.v : null;
    }, before.id);
    srsRow && srsRow.lastGrade === 2
      ? ok("srs:" + before.id + " was written with lastGrade 2 after the real-mouse-click grade")
      : bad("no srs:<id> row with lastGrade 2 was written - got: " + JSON.stringify(srsRow));
  } else if (!before.id) {
    bad("skipped the grade-click assertion - no question id to check the srs: row against");
  } else {
    bad("skipped the grade-click assertion - the card never flipped");
  }

  // ---- 3. Real mouse click on the star button still stars ----
  // Targets whatever .qz-star-btn's bounding-box center actually is on
  // screen - the icon SVG fills most of the button, so this exercises the
  // exact "press lands on an SVG inside a button" case the carve-out fix
  // covers, not just a click that happens to land on the <button> itself.
  const starredBefore = await page.evaluate(() => document.querySelector(".qz-star-btn")?.classList.contains("starred") || false);
  await page.locator(".qz-star-btn").click();
  await page.waitForTimeout(200);
  const starredAfter = await page.evaluate(() => document.querySelector(".qz-star-btn")?.classList.contains("starred") || false);
  (starredAfter === !starredBefore)
    ? ok("a real mouse click on the star button (icon included) still toggles starred")
    : bad("a real mouse click on the star button did not toggle starred (before=" + starredBefore + " after=" + starredAfter + ")");
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

console.log(fails === 0 ? "\nBOARD DRILL MOUSE-CLICK GRADING: all passed" : `\nBOARD DRILL MOUSE-CLICK GRADING: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
