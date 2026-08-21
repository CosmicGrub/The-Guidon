/**
 * Board Drill's "dynamic refreshment": the flashcard keeps a consistent
 * size regardless of device orientation, and picking a category from the
 * catList "Jump to category" pane auto-scrolls to the card.
 *
 * Shipped WITH this feature rather than discovered later by mutation
 * testing, unlike the two gaps test-board-drill-grading.mjs and
 * test-search-list-detail.mjs had to retroactively close.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootAt(viewport) {
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
  await page.waitForTimeout(700);
  return { page, noise };
}

/* ---- orientation independence: the actual claim under test ---- */
// Same device, two orientations - width/height literally swap on a real
// rotation. Under the OLD vh-based height, these would compute two
// visibly different card sizes; the new width/aspect-ratio approach
// should compute the IDENTICAL box in both.
const portrait = await bootAt({ width: 800, height: 1200 });
const cardPortrait = await portrait.page.evaluate(() => {
  const c = document.querySelector(".qz-card");
  const r = c.getBoundingClientRect();
  return { width: Math.round(r.width), height: Math.round(r.height) };
});
await portrait.page.close();

const landscape = await bootAt({ width: 1200, height: 800 });
const cardLandscape = await landscape.page.evaluate(() => {
  const c = document.querySelector(".qz-card");
  const r = c.getBoundingClientRect();
  return { width: Math.round(r.width), height: Math.round(r.height) };
});
await landscape.page.close();

(cardPortrait.width === cardLandscape.width && cardPortrait.height === cardLandscape.height)
  ? ok(`card size is identical across orientation (${cardPortrait.width}x${cardPortrait.height} both ways)`)
  : bad(`card size shifted with orientation: portrait ${cardPortrait.width}x${cardPortrait.height} vs landscape ${cardLandscape.width}x${cardLandscape.height}`);

/* ---- auto-scroll on category selection, at a stacked (<1024px) width ---- */
// 800px is deliberately narrower than .drill-layout's 1024px split
// breakpoint, so catList stacks above the card - the exact case this
// feature targets (on a >=1024px split layout the card already sits next
// to the list, so there'd be nothing meaningful to prove here).
const stacked = await bootAt({ width: 800, height: 1200 });

const spy = await stacked.page.evaluate(() => {
  window.__scrollCalls = [];
  const proto = Element.prototype;
  const orig = proto.scrollIntoView;
  proto.scrollIntoView = function (opts) {
    window.__scrollCalls.push({ tag: this.tagName, cls: this.className, opts });
    return orig.call(this, opts);
  };
  const rows = document.querySelectorAll(".list-detail-list .list-detail-row");
  const catListPresent = !!document.querySelector(".list-detail-list[aria-label='Jump to category']");
  return { rowCount: rows.length, catListPresent };
});
spy.catListPresent ? ok("catList ('Jump to category' pane) renders") : bad("catList not found in the DOM");
spy.rowCount > 1 ? ok(`catList has ${spy.rowCount} category rows (need >1 to pick a non-'All' one)`) : bad(`only ${spy.rowCount} category row(s)`);

if (spy.rowCount > 1) {
  await stacked.page.evaluate(() => {
    const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
    rows[1].click(); // rows[0] is "All"; pick a real category
  });
  await stacked.page.waitForTimeout(200);
  const calls = await stacked.page.evaluate(() => window.__scrollCalls);
  const onCardWrap = calls.find((c) => c.cls && c.cls.includes("qz-wrap"));
  onCardWrap
    ? ok(`selecting a category called scrollIntoView on the flashcard (.qz-wrap), block:"${onCardWrap.opts && onCardWrap.opts.block}"`)
    : bad("selecting a category did not call scrollIntoView on the flashcard: " + JSON.stringify(calls));
}

stacked.noise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + stacked.noise.join(" | "));
await stacked.page.close();

console.log(fails === 0 ? "\nBOARD DRILL DYNAMIC: all passed" : `\nBOARD DRILL DYNAMIC: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
