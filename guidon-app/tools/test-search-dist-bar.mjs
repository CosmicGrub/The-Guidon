/**
 * Global Search's per-domain distribution bar (#/search) - Tier 3 batch 2
 * roadmap item. The results header used to summarize a multi-domain hit
 * set as a single plain-text parenthetical - "(12 doctrine, 5 scenarios,
 * ...)" - dead text, no relationship to the six colored TYPE_ICON/
 * TYPE_COLOR filter chips sitting right above it. This replaced that
 * string with a `.search-dist-bar` of `.search-dist-seg` buttons: segment
 * width is real hit count via inline flex-grow (not a hand-rolled
 * percentage), segment color is the SAME TYPE_COLOR map the chips and
 * .search-hit border-left/badge already use, and clicking a segment calls
 * .click() on the matching filterBtns[t] chip rather than reimplementing
 * filtering.
 *
 * This test exercises a query ("counsel") verified ahead of time to span
 * all six search domains at once with distinct counts, so proportionality
 * has real, unequal numbers to check against - not just "some bar
 * rendered". It asserts:
 *   - one segment per domain that actually has hits, in SECTION_ORDER
 *   - each segment's rendered width is proportional to its real hit count
 *     (not just present) - computed independently from each segment's
 *     own inline flexGrow style, cross-checked against the DOM hit count
 *     for that domain
 *   - each segment's background color matches TYPE_COLOR for its domain
 *   - clicking a segment produces the IDENTICAL end state (result count,
 *     chip .active class, chip aria-pressed) as clicking that domain's
 *     own filter chip directly - proving the bar reuses the chip's click
 *     handler instead of a parallel filtering implementation
 *   - a single-domain query (only one domain has hits) renders NO bar at
 *     all, same threshold the old plain-text breakdown used
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

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
await page.waitForTimeout(1100);
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1100);
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(500);

async function search(q) {
  await page.evaluate((q) => {
    const inp = document.querySelector('input[type="search"]');
    inp.focus();
    inp.value = q;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }, q);
  await page.waitForTimeout(400); // past the 120ms debounce
}

/* ---- multi-domain query: proportionality + color + section order ---- */
const SECTION_ORDER = ["scenario", "board", "doctrine", "lesson", "resource", "career"];
await search("counsel");

const barSnapshot = await page.evaluate((SECTION_ORDER) => {
  const segs = [...document.querySelectorAll(".search-dist-seg")];
  const sections = [...document.querySelectorAll(".search-section")];
  // Order only (which domains have a section, and in what order) - NOT
  // counts. Section card counts are capped at MAX_PER=8 while
  // activeFilter is "all" (see runSearch's own MAX_PER), so a rendered
  // card count is not a valid ground truth for the real per-domain hit
  // count the moment any domain exceeds 8 hits - which "counsel" does.
  const domainsInOrder = [];
  sections.forEach((sec, i) => { if (sec.querySelector(".search-section-head")) domainsInOrder.push(SECTION_ORDER[i]); });
  return {
    segTitles: segs.map((s) => s.title),
    segFlexGrow: segs.map((s) => Number(s.style.flexGrow)),
    segBg: segs.map((s) => s.style.background),
    totalHits: (document.querySelector(".search-count") || {}).textContent || "",
    domainsInOrder,
    barGroupLabel: document.querySelector(".search-dist-bar")
      ? document.querySelector(".search-dist-bar").getAttribute("aria-label")
      : null,
  };
}, SECTION_ORDER);

// Ground truth for each domain's REAL hit count: switch the filter to that
// single domain (query text unchanged) and read .search-count - with
// activeFilter set to one type, runSearch only populates that type's
// allHits array, so the header's total IS that domain's true count,
// uncapped by MAX_PER (which only limits how many CARDS render, not the
// count used to build the bar/header). Independent of the bar under test.
const domainCounts = {};
for (const t of SECTION_ORDER) {
  await page.evaluate((label) => {
    const chip = [...document.querySelectorAll(".search-chip")].find((b) => b.textContent.includes(label));
    if (chip) chip.click();
  }, { scenario: "Scenarios", board: "Board Q", doctrine: "Doctrine", lesson: "Lessons", resource: "Resources", career: "MOS/Career" }[t]);
  await page.waitForTimeout(150);
  const text = await page.evaluate(() => (document.querySelector(".search-count") || {}).textContent || "");
  const m = /^(\d+)/.exec(text.trim());
  domainCounts[t] = m ? Number(m[1]) : 0;
}
// Restore "all" so the bar itself is back on screen for the remaining checks.
await page.evaluate(() => {
  const allChip = [...document.querySelectorAll(".search-chip")].find((b) => /^⊞/.test(b.textContent));
  if (allChip) allChip.click();
});
await page.waitForTimeout(200);

const state = { ...barSnapshot, domainCounts };
console.log("  ...query \"counsel\": " + state.totalHits + ", ground-truth domain counts " + JSON.stringify(domainCounts));

const domainsWithHits = Object.entries(state.domainCounts).filter(([, n]) => n > 0);
domainsWithHits.length >= 4
  ? ok(`"counsel" spans ${domainsWithHits.length} domains - enough for a meaningful proportionality check`)
  : bad(`"counsel" only spans ${domainsWithHits.length} domains - test query no longer exercises multiple domains (seed data may have changed)`);

state.segTitles.length === domainsWithHits.length
  ? ok(`rendered exactly one segment per domain with hits (${state.segTitles.length})`)
  : bad(`expected ${domainsWithHits.length} segments (one per domain with hits), got ${state.segTitles.length}`);

state.barGroupLabel && /breakdown/i.test(state.barGroupLabel)
  ? ok("distribution bar exposes a role=group aria-label describing itself")
  : bad("distribution bar aria-label missing or unexpected: " + state.barGroupLabel);

// Segment order: the bar is built by iterating TYPES.slice(1) (== the same
// six-domain order as SECTION_ORDER), so it must match both the canonical
// order AND the order the result sections themselves actually rendered in
// (domainsInOrder, captured from the live DOM before any chip was
// touched) - the bar reading left-to-right in a different order than the
// sections below it would be a real, confusing inconsistency.
const expectedOrder = SECTION_ORDER.filter((t) => state.domainCounts[t] > 0);
JSON.stringify(state.domainsInOrder) === JSON.stringify(expectedOrder)
  ? ok(`rendered section order (${state.domainsInOrder.join(", ")}) matches canonical SECTION_ORDER filtered to domains with hits`)
  : bad(`rendered section order (${state.domainsInOrder.join(", ")}) != canonical order (${expectedOrder.join(", ")})`);

// Proportionality: each segment's flexGrow (its rendered width driver)
// must equal its domain's REAL, uncapped hit count (from the ground-truth
// single-domain-filter pass above) - not just be nonzero, and not the
// MAX_PER=8-capped rendered-card count.
let proportionalityOk = true;
expectedOrder.forEach((domain, idx) => {
  const flexGrow = state.segFlexGrow[idx];
  const realCount = state.domainCounts[domain];
  if (flexGrow !== realCount) {
    proportionalityOk = false;
    bad(`segment ${idx} (${domain}): flex-grow=${flexGrow} does not match real hit count ${realCount}`);
  }
});
proportionalityOk
  ? ok(`every segment's width driver (flex-grow) exactly matches its domain's real, uncapped hit count: ${expectedOrder.map((d) => d + "=" + state.domainCounts[d]).join(", ")}`)
  : null; // individual mismatches already reported above

// Color: each segment's background must be the exact TYPE_COLOR value for
// its domain - the same map driving the filter chips and card accents.
const TYPE_COLOR = { scenario: "var(--ink-amber)", board: "var(--ink-cyan)", doctrine: "var(--ink-violet)",
  lesson: "var(--ink-green)", resource: "var(--ink-red)", career: "var(--ink-blue)" };
let colorOk = true;
expectedOrder.forEach((domain, idx) => {
  if (state.segBg[idx] !== TYPE_COLOR[domain]) {
    colorOk = false;
    bad(`segment ${idx} (${domain}): background="${state.segBg[idx]}" does not match TYPE_COLOR "${TYPE_COLOR[domain]}"`);
  }
});
colorOk
  ? ok("every segment's background color exactly matches TYPE_COLOR for its domain (same map the filter chips use)")
  : null;

/* ---- clicking a segment == clicking its chip (same handler, not a duplicate) ---- */
const resourceIdx = expectedOrder.indexOf("resource");
if (resourceIdx === -1) {
  bad('test query "counsel" no longer has any "resource" hits - cannot verify segment-click == chip-click for that domain');
} else {
  const clickedViaSegment = await page.evaluate((idx) => {
    const seg = document.querySelectorAll(".search-dist-seg")[idx];
    seg.click();
    return true;
  }, resourceIdx);
  await page.waitForTimeout(250);
  const afterSegClick = await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".search-chip")].find((b) => /Resources/i.test(b.textContent));
    return {
      cards: document.querySelectorAll(".search-hit").length,
      chipActive: chip ? chip.classList.contains("active") : null,
      chipAriaPressed: chip ? chip.getAttribute("aria-pressed") : null,
    };
  });

  // Reset to "all", re-run the same query, then click the Resources CHIP
  // directly - the two end states must be identical if the segment is
  // really calling the chip's own handler and not a parallel one.
  await page.evaluate(() => {
    const allChip = [...document.querySelectorAll(".search-chip")].find((b) => /^⊞/.test(b.textContent));
    if (allChip) allChip.click();
  });
  await search("counsel");
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".search-chip")].find((b) => /Resources/i.test(b.textContent));
    chip.click();
  });
  await page.waitForTimeout(250);
  const afterChipClick = await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".search-chip")].find((b) => /Resources/i.test(b.textContent));
    return {
      cards: document.querySelectorAll(".search-hit").length,
      chipActive: chip ? chip.classList.contains("active") : null,
      chipAriaPressed: chip ? chip.getAttribute("aria-pressed") : null,
    };
  });

  const identical = afterSegClick.cards === afterChipClick.cards
    && afterSegClick.cards > 0
    && afterSegClick.chipActive === true && afterChipClick.chipActive === true
    && afterSegClick.chipAriaPressed === "true" && afterChipClick.chipAriaPressed === "true";
  identical
    ? ok(`clicking the Resources segment produced the SAME end state as clicking the Resources chip directly (${afterSegClick.cards} results, chip active+aria-pressed both ways)`)
    : bad(`segment click (${JSON.stringify(afterSegClick)}) != chip click (${JSON.stringify(afterChipClick)})`);
}

// Reset filter back to "all" for the remaining checks below.
await page.evaluate(() => {
  const allChip = [...document.querySelectorAll(".search-chip")].find((b) => /^⊞/.test(b.textContent));
  if (allChip) allChip.click();
});

/* ---- single-domain query: no bar renders (matches old parts.length>1 threshold) ---- */
// "92A" only ever hits the career/MOS domain (a bare MOS code), same as the
// dedicated MOS-code regression in test-search-views/test-nav-seed - one
// domain only, so the old text breakdown never rendered a parenthetical
// and the bar must not render one either.
await search("92A");
const singleDomain = await page.evaluate(() => ({
  cards: document.querySelectorAll(".search-hit").length,
  sections: document.querySelectorAll(".search-section").length,
  bars: document.querySelectorAll(".search-dist-bar").length,
}));
(singleDomain.cards > 0 && singleDomain.sections === 1)
  ? (singleDomain.bars === 0
      ? ok(`single-domain query "92A" (${singleDomain.cards} hits, 1 section) renders no distribution bar - matches the old text breakdown's own threshold`)
      : bad(`single-domain query "92A" rendered ${singleDomain.bars} distribution bar(s) - should render none`))
  : bad(`"92A" no longer resolves to exactly one domain (cards=${singleDomain.cards}, sections=${singleDomain.sections}) - test assumption stale`);

noise.length === 0 ? ok("no console errors/warnings across the whole run") : bad("console noise: " + noise.join(" | "));

console.log(fails === 0 ? "\nSEARCH DIST BAR: all passed" : `\nSEARCH DIST BAR: ${fails} failed`);
await page.close();
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
