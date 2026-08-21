/**
 * Board Drill's flashcard back face in reduce-motion/minimal mode
 * (html.reduce-motion or html[data-motion="minimal"]).
 *
 * The user-facing contract: a long answer scrolls INSIDE the card - the
 * grade row (Needs Help / Somewhat / Know It / Down Cold) always stays
 * visibly pinned right below it, the same way the motion-enabled 3D-flip
 * card already gets this right via .qz-face's position:absolute;inset:0.
 *
 * Regression covered: in reduce-motion/minimal mode, .qz-face switches to
 * position:relative (in-flow, for the instant face-swap) instead of its
 * normal position:absolute;inset:0 - which was the ONLY thing bounding
 * .qz-back's height. Without that bound, .qz-back-scroll's
 * flex:1;min-height:0;overflow-y:auto never got a real box to shrink into,
 * so a long answer just grew .qz-back (and with it .qz-card, whose
 * height:auto in this mode simply tracks its content) unbounded instead of
 * scrolling internally - pushing .qz-grade-row far down the page instead of
 * keeping it reliably visible. Neither test-flip.mjs (instant face-swap)
 * nor test-board-drill-grading.mjs (real grade-button clicks) catches this,
 * since it only shows up on a card whose back-face content is long enough
 * to exceed the card's own height - both of those use whatever card happens
 * to be first in the deck. This test seeks out the actual longest-answer
 * board question (by G.store.boardQuestions()' .a field) to force it.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
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

const longest = await page.evaluate(() => {
  const qs = G.store.boardQuestions();
  let best = qs[0], max = 0;
  for (const q of qs) { const len = (q.a || "").length; if (len > max) { max = len; best = q; } }
  return { q: best.q, category: best.category, len: max };
});
console.log(`  (longest board-question answer: ${longest.len} chars, category "${longest.category}")`);

await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(1100);

// Narrow the deck to the target's category so "Next card" finds it quickly.
await page.evaluate((cat) => {
  const sel = document.querySelector('select[aria-label="Filter by category"]');
  sel.value = cat;
  sel.dispatchEvent(new Event("change"));
}, longest.category);
await page.waitForTimeout(300);

await page.evaluate(() => {
  document.documentElement.setAttribute("data-motion", "minimal");
  document.documentElement.classList.add("reduce-motion");
});
await page.waitForTimeout(200);

async function findAndFlip(targetQ) {
  let matched = false;
  for (let i = 0; i < 200; i++) {
    const promptText = await page.evaluate(() => document.querySelector(".qz-prompt")?.textContent || "");
    if (promptText === targetQ) { matched = true; break; }
    await page.evaluate(() => { document.querySelector('button[aria-label="Next card"]')?.click(); });
    await page.waitForTimeout(60);
  }
  if (!matched) return { matched: false };
  await page.evaluate(() => document.querySelector(".qz-wrap")?.focus());
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  return { matched: true };
}

async function readLayout() {
  return page.evaluate(() => {
    const back = document.querySelector(".qz-card.flipped .qz-back");
    if (!back) return null;
    const scroll = back.querySelector(".qz-back-scroll");
    const gradeRow = back.querySelector(".qz-grade-row");
    const rect = (el) => (({ top, bottom, height }) => ({ top, bottom, height }))(el.getBoundingClientRect());
    return {
      scrollRect: rect(scroll), scrollScrollHeight: scroll.scrollHeight, scrollClientHeight: scroll.clientHeight,
      gradeRowRect: rect(gradeRow),
      viewportHeight: window.innerHeight,
    };
  });
}

/* ---- the long-answer card: internal scroll, no overlap, grade row visible ---- */
const { matched } = await findAndFlip(longest.q);
matched ? ok("found and flipped the longest-answer board question") : bad("could not locate the longest-answer question in its own category filter");

if (matched) {
  const layout = await readLayout();
  const overlap = Math.max(0, Math.min(layout.scrollRect.bottom, layout.gradeRowRect.bottom) - Math.max(layout.scrollRect.top, layout.gradeRowRect.top));
  overlap === 0
    ? ok("grade row does not overlap the scrollable answer region")
    : bad(`grade row overlaps the answer region by ${overlap}px`);

  layout.scrollScrollHeight > layout.scrollClientHeight
    ? ok(`long answer scrolls internally (scrollHeight ${layout.scrollScrollHeight} > clientHeight ${layout.scrollClientHeight})`)
    : bad(`long answer never activates internal scroll (scrollHeight ${layout.scrollScrollHeight} === clientHeight ${layout.scrollClientHeight}) - card grew unbounded instead`);

  layout.gradeRowRect.bottom <= layout.viewportHeight
    ? ok("grade row stays within the viewport, no page-scroll needed to reach it")
    : bad(`grade row bottom (${layout.gradeRowRect.bottom}) exceeds the viewport height (${layout.viewportHeight})`);
}

/* ---- a short-answer card: reduce-motion's scroll-or-not state matches
   rich motion's for the SAME card - this is the real invariant the fix
   above is for ("both modes start scrolling internally at the same
   content length"), not "short answers never scroll". The literal
   shortest board-question answer ("Competence.", 11 chars) still renders
   two full labeled blocks (Acceptable Answer + By the Book, identical
   text) plus a source line - real structural chrome independent of how
   short the quoted text is - so whether that scrolls or not is a function
   of the card's own height cap, not answer length; asserting it against
   rich motion's own behavior for the identical card is what actually
   proves the two modes agree, and stays correct even if a future width/
   ratio change (like this session's 420px/5:6 -> 536px/5:3) shifts
   exactly which cards are short enough to fit without scrolling. ---- */
const shortest = await page.evaluate(() => {
  const qs = G.store.boardQuestions();
  let best = qs[0], min = Infinity;
  for (const q of qs) { const len = (q.a || "").length; if (len < min) { min = len; best = q; } }
  return { q: best.q, category: best.category };
});
await page.evaluate((cat) => {
  const sel = document.querySelector('select[aria-label="Filter by category"]');
  sel.value = cat;
  sel.dispatchEvent(new Event("change"));
}, shortest.category);
await page.waitForTimeout(300);

const { matched: shortMatched } = await findAndFlip(shortest.q);
shortMatched ? ok("found and flipped the shortest-answer board question") : bad("could not locate the shortest-answer question in its own category filter");

if (shortMatched) {
  const layout = await readLayout();
  const reduceMotionScrolls = layout.scrollScrollHeight > layout.scrollClientHeight;

  // Same card, rich motion this time (data-motion back to a real level,
  // reduce-motion class off) - what SHOULD this card do, per the card
  // Soldiers actually flip day to day?
  await page.evaluate(() => {
    document.documentElement.removeAttribute("data-motion");
    document.documentElement.classList.remove("reduce-motion");
  });
  await page.waitForTimeout(200);
  const richLayout = await readLayout();
  const richMotionScrolls = richLayout ? richLayout.scrollScrollHeight > richLayout.scrollClientHeight : null;
  // Put reduce-motion back for anything after this block.
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-motion", "minimal");
    document.documentElement.classList.add("reduce-motion");
  });
  await page.waitForTimeout(200);

  richMotionScrolls === null
    ? bad("could not re-read the same card under rich motion for comparison")
    : reduceMotionScrolls === richMotionScrolls
      ? ok(`reduce-motion's scroll state for the shortest answer matches rich motion's (both ${reduceMotionScrolls ? "scroll" : "fit without scrolling"})`)
      : bad(`reduce-motion ${reduceMotionScrolls ? "scrolls" : "fits without scrolling"} but rich motion ${richMotionScrolls ? "scrolls" : "doesn't"} for the identical card - the two modes disagree`);
}

noise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + noise.join(" | "));

console.log(fails === 0 ? "\nBOARD DRILL REDUCED-MOTION SCROLL: all passed" : `\nBOARD DRILL REDUCED-MOTION SCROLL: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
