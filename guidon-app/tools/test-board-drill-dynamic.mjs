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
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

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
  await dismissOnboarding(page);
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

/* ---- topic-chip quick filter: a second VIEW onto catSel, not a second
   filter mechanism - same idiom as Doctrine's own topic-chip bar,
   mechanically copied here. Verify it's a real, bidirectional sync with
   the actual <select> and the actual deck, not just cosmetic markup. ---- */
// Reset first: the catList test above already picked a non-"All" category
// on this same page/session, so the chip bar's own active state right now
// correctly reflects THAT filter, not a fresh "All" state - this section
// tests the chip bar on its own terms, starting from a known "All" state.
await stacked.page.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Filter by category"]');
  sel.value = "All"; sel.dispatchEvent(new Event("change"));
});
await stacked.page.waitForTimeout(250);
const chipInfo = await stacked.page.evaluate(() => {
  const bar = document.querySelector('.search-filters[aria-label="Quick-filter by category"]');
  const chips = bar ? [...bar.querySelectorAll(".search-chip")] : [];
  return {
    barPresent: !!bar,
    chipCount: chips.length,
    firstIsAll: chips[0] && chips[0].textContent === "All categories" && chips[0].classList.contains("active"),
    capped: chips.length <= 13, // "All" + at most 12, matching Doctrine's own cap
  };
});
chipInfo.barPresent ? ok("Board Drill's quick-filter chip bar renders") : bad("chip bar not found in the DOM");
chipInfo.firstIsAll ? ok('"All categories" is the first chip and shows active once the select is reset to "All"') : bad('first chip: ' + JSON.stringify(chipInfo));
chipInfo.capped ? ok(`chip bar is capped (${chipInfo.chipCount} chips total) rather than rendering all 79 categories as chips`) : bad(`chip bar rendered ${chipInfo.chipCount} chips - expected a cap around 13`);

// Click a real category chip (not "All") and confirm it's a genuine
// filter, not decoration: the <select> value changes, the deck's own
// category header changes, and only that one chip is marked active.
const targetLabel = await stacked.page.evaluate(() => {
  const bar = document.querySelector('.search-filters[aria-label="Quick-filter by category"]');
  const target = bar.querySelectorAll(".search-chip")[1]; // [0] is "All categories"
  target.click();
  return target.textContent;
});
// build() is async (awaits an IndexedDB SRS scan before it gets to
// refreshCatChips()/draw()) - same reason the catList click test above
// waits before reading its own result.
await stacked.page.waitForTimeout(250);
const afterChipClick = await stacked.page.evaluate((targetLabel) => {
  const bar = document.querySelector('.search-filters[aria-label="Quick-filter by category"]');
  const chips = [...bar.querySelectorAll(".search-chip")];
  const sel = document.querySelector('select[aria-label="Filter by category"]');
  const activeChips = chips.filter((c) => c.classList.contains("active"));
  return {
    targetLabel,
    selectValue: sel.value,
    activeChipTexts: activeChips.map((c) => c.textContent),
    cardHeaderText: (document.querySelector(".qz-wrap")?.textContent || "").slice(0, 80),
  };
}, targetLabel);
const clickedCategory = afterChipClick.targetLabel.replace(/\s*\(\d+\)$/, "");
afterChipClick.selectValue === clickedCategory
  ? ok(`clicking the "${clickedCategory}" chip set the real <select>'s value to match`)
  : bad(`chip click did not sync the select: clicked "${clickedCategory}", select now "${afterChipClick.selectValue}"`);
JSON.stringify(afterChipClick.activeChipTexts) === JSON.stringify([afterChipClick.targetLabel])
  ? ok("exactly the clicked chip is marked active - not the old one, not both")
  : bad("active-chip state after click: " + JSON.stringify(afterChipClick.activeChipTexts));
afterChipClick.cardHeaderText.includes(clickedCategory)
  ? ok(`the flashcard deck itself filtered to "${clickedCategory}" - a real filter, not cosmetic chip state`)
  : bad("card header after chip click: " + JSON.stringify(afterChipClick.cardHeaderText));

// Reverse direction: changing the real <select> (as the dropdown control
// itself would) must update the chip bar's active state too - proving
// this is one shared piece of state with two views, not two independent
// trackers that can drift apart.
const afterSelectChange = await stacked.page.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Filter by category"]');
  sel.value = "All";
  sel.dispatchEvent(new Event("change"));
});
await stacked.page.waitForTimeout(250);
const afterReset = await stacked.page.evaluate(() => {
  const bar = document.querySelector('.search-filters[aria-label="Quick-filter by category"]');
  const chips = [...bar.querySelectorAll(".search-chip")];
  return chips.filter((c) => c.classList.contains("active")).map((c) => c.textContent);
});
JSON.stringify(afterReset) === JSON.stringify(["All categories"])
  ? ok('setting the real <select> back to "All" (as the dropdown itself would) re-activates the "All categories" chip')
  : bad("active-chip state after resetting the select: " + JSON.stringify(afterReset));

stacked.noise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + stacked.noise.join(" | "));
await stacked.page.close();

console.log(fails === 0 ? "\nBOARD DRILL DYNAMIC: all passed" : `\nBOARD DRILL DYNAMIC: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
