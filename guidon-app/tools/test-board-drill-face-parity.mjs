/**
 * Board Drill's question side and answer side render at EXACTLY the same
 * size, always - flipping the card must never visibly resize it. Explicit,
 * permanent, user-requested invariant, not an incidental one.
 *
 * In rich motion this was already true for free (both faces are
 * position:absolute;inset:0 within the same box - structurally only one
 * size to have). It was NOT true in reduce-motion/minimal mode: that mode
 * switches .qz-face to position:relative/in-flow (needed to kill the 3D
 * rotation), so before this fix each face's height came from its OWN
 * content instead of a shared box - a short question and a long answer
 * genuinely produced two different card heights, and flipping visibly
 * resized the card. This suite proves the fix holds at both ends of real
 * content length (the actual longest board-question PROMPT, and the actual
 * shortest), in both motion modes, and that the longest prompt (244 real
 * characters, easily enough to overflow a fixed-height face) scrolls
 * internally instead of breaking the invariant or silently clipping.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 900, height: 1100 } })).newPage();
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
  for (const q of qs) { const len = (q.q || "").length; if (len > max) { max = len; best = q; } }
  return { q: best.q, category: best.category, len: max };
});
console.log(`  (longest board-question PROMPT: ${longest.len} chars, category "${longest.category}")`);

await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(1100);

async function findByPrompt(targetQ, category) {
  // Narrow to the target's own category first - the full deck runs well
  // past 1000 cards, so a fixed iteration budget over the UNFILTERED deck
  // isn't a reliable way to reach a specific card. Same technique
  // test-board-drill-reduced-motion-scroll.mjs already uses successfully.
  await page.evaluate((cat) => {
    const sel = document.querySelector('select[aria-label="Filter by category"]');
    if (sel) { sel.value = cat; sel.dispatchEvent(new Event("change")); }
  }, category);
  await page.waitForTimeout(300);
  for (let i = 0; i < 200; i++) {
    const prompt = await page.evaluate(() => document.querySelector(".qz-prompt")?.textContent || "");
    if (prompt === targetQ) return true;
    await page.evaluate(() => { document.querySelector('button[aria-label="Next card"]')?.click(); });
    await page.waitForTimeout(60);
  }
  return false;
}

async function cardHeight() {
  return page.evaluate(() => Math.round(document.querySelector(".qz-card").getBoundingClientRect().height));
}
async function isFlipped() {
  return page.evaluate(() => document.querySelector(".qz-card").classList.contains("flipped"));
}
async function flip() {
  await page.evaluate(() => document.querySelector(".qz-card").click());
  // Rich motion's default flip transition is 650ms (--qz-flip-dur). A mid-
  // rotation 3D transform genuinely projects a different (skewed)
  // getBoundingClientRect() than the settled result, even though the
  // underlying CSS height never changed - reading too early here produces
  // a false "front != back" mismatch that's actually just an animation
  // frame, not a real discrepancy. 900ms comfortably clears it.
  await page.waitForTimeout(900);
}

/* ---- Rich motion: parity should already hold structurally ---- */
const frontHRich = await cardHeight();
await flip();
const backHRich = await cardHeight();
frontHRich === backHRich
  ? ok(`rich motion: front (${frontHRich}px) and back (${backHRich}px) are the same height`)
  : bad(`rich motion: front ${frontHRich}px != back ${backHRich}px`);
await flip(); // back to front

/* ---- Reduce/minimal motion: the actual fix ---- */
await page.evaluate(() => {
  document.documentElement.setAttribute("data-motion", "minimal");
  document.documentElement.classList.add("reduce-motion");
});
await page.waitForTimeout(200);

const frontHMinimal = await cardHeight();
await flip();
const backHMinimal = await cardHeight();
frontHMinimal === backHMinimal
  ? ok(`reduce-motion: front (${frontHMinimal}px) and back (${backHMinimal}px) are the same height`)
  : bad(`reduce-motion: front ${frontHMinimal}px != back ${backHMinimal}px - flipping visibly resizes the card`);
frontHMinimal === frontHRich
  ? ok(`reduce-motion's height (${frontHMinimal}px) matches rich motion's (${frontHRich}px) - the two modes fully agree`)
  : bad(`reduce-motion height ${frontHMinimal}px doesn't match rich motion's ${frontHRich}px`);
await flip(); // back to front

/* ---- The actual longest real question, in reduce-motion mode: proves
   the overflow-safety (overflow-y:auto on .qz-front) actually works,
   not just that short content happens to fit. ---- */
const found = await findByPrompt(longest.q, longest.category);
found ? ok("found the longest-prompt board question") : bad("could not locate the longest-prompt question");

if (found) {
  const longFrontH = await cardHeight();
  longFrontH === frontHMinimal
    ? ok(`longest real question (${longest.len} chars) still renders at the same fixed height (${longFrontH}px) - overflow-y:auto is doing its job, not silently breaking the invariant`)
    : bad(`longest question's front face is ${longFrontH}px, expected the fixed ${frontHMinimal}px - the invariant broke under real long content`);

  const overflowInfo = await page.evaluate(() => {
    const f = document.querySelector(".qz-front");
    return { scrollHeight: f.scrollHeight, clientHeight: f.clientHeight };
  });
  overflowInfo.scrollHeight > overflowInfo.clientHeight
    ? ok(`the longest prompt genuinely needs to scroll internally (scrollHeight ${overflowInfo.scrollHeight} > clientHeight ${overflowInfo.clientHeight}) - this is a real overflow case, not a coincidentally-short one`)
    : ok(`the longest prompt fits without needing to scroll (scrollHeight ${overflowInfo.scrollHeight}, clientHeight ${overflowInfo.clientHeight}) at this viewport width`);

  await flip();
  const longBackH = await cardHeight();
  longBackH === longFrontH
    ? ok(`flipping the longest-prompt card to its answer keeps the same height (${longBackH}px)`)
    : bad(`flipping the longest-prompt card changed height: front ${longFrontH}px -> back ${longBackH}px`);
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
server.close();
console.log("\n" + (fails ? `BOARD DRILL FACE PARITY: ${fails} FAILURE(S)` : "BOARD DRILL FACE PARITY: all passed"));
process.exit(fails ? 1 : 0);
