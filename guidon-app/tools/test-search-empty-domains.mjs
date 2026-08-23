/**
 * Roadmap Tier 3 batch 2: Search's zero-result empty state ("what Search
 * doesn't cover yet"). A no-hit query at #/search used to read as "this
 * doesn't exist in GUIDON" when the honest answer for a real, live route
 * like Forms or Money is "Search hasn't indexed that domain yet" - the
 * empty state now grows a fixed row of quick-link chips
 * (UNINDEXED_DOMAIN_HASHES in views.js's views.search) pointing straight at
 * those routes.
 *
 * This exercises the real thing, not just "nothing throws":
 *   - a genuine zero-hit query renders the chip row with the correct
 *     number of chips, in the documented order, with real G.routes labels
 *     (not hand-typed copies that could drift from a future route rename)
 *   - each chip's href-equivalent (location.hash on click) actually lands
 *     on its real route and that route actually renders (Search's own
 *     markup is gone, replaced by the target view's)
 *   - the "type at least 2 characters" pre-search empty state (a
 *     DIFFERENT, non-zero-hit empty state one branch up in runSearch)
 *     does NOT grow the same chip row - it isn't a completed search yet
 *   - a query that DOES hit does not show the chip row either
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

const searchInput = page.locator('input[type="search"]');

// Expected, in UNINDEXED_DOMAIN_HASHES order - hashes are the source of
// truth in the app; labels are cross-checked against G.routes here so this
// test also catches a future route-label rename going stale, same as the
// live code resolving them at render time instead of hand-copying them.
const EXPECTED_HASHES = ["#/forms", "#/counsel", "#/develop", "#/write", "#/money", "#/health", "#/transition"];

const liveRouteLabels = await page.evaluate((hashes) => {
  return hashes.map((h) => {
    const r = (window.G && G.routes || []).find((x) => x.hash === h);
    return r ? r.label : null;
  });
}, EXPECTED_HASHES);
liveRouteLabels.every((l) => !!l)
  ? ok("all " + EXPECTED_HASHES.length + " expected hashes still resolve to a real G.routes entry (" + liveRouteLabels.join(", ") + ")")
  : bad("some expected hashes no longer resolve in G.routes: " + JSON.stringify(liveRouteLabels));

/* ---- pre-search state (< 2 chars): reuses .search-empty for "keep typing",
   but that's NOT a completed zero-hit search - must not grow the chip row */
await searchInput.fill("a");
await page.waitForTimeout(250);
const preSearchState = await page.evaluate(() => ({
  emptyText: document.querySelector(".search-empty")?.textContent || "",
  hasDomains: !!document.querySelector(".search-empty-domains"),
}));
(/Keep typing/.test(preSearchState.emptyText) && preSearchState.hasDomains === false)
  ? ok('typing 1 char shows the "Keep typing…" hint, not the domain-chip row (' + preSearchState.emptyText + ")")
  : bad("1-char state: emptyText=" + JSON.stringify(preSearchState.emptyText) + " hasDomains=" + preSearchState.hasDomains);

/* ---- a real hit: chip row must NOT appear when Search actually found something ---- */
await searchInput.fill("leader");
await page.waitForTimeout(300);
const hitState = await page.evaluate(() => ({
  hits: document.querySelectorAll(".search-hit").length,
  hasDomains: !!document.querySelector(".search-empty-domains"),
}));
(hitState.hits > 0 && hitState.hasDomains === false)
  ? ok(`query "leader" returned ${hitState.hits} real hit(s) and did NOT show the unindexed-domain chip row`)
  : bad(`hit state: hits=${hitState.hits} hasDomains=${hitState.hasDomains}`);

/* ---- genuine zero-hit query: the actual feature under test ---- */
await searchInput.fill("zzzzznonexistentqueryxyz");
await page.waitForTimeout(300);

const emptyText = await page.evaluate(() => document.querySelector(".search-empty")?.textContent || "");
(/No results for/.test(emptyText) && emptyText.includes("zzzzznonexistentqueryxyz"))
  ? ok("zero-hit query still renders the original 'No results for ...' message")
  : bad("empty-state text: " + emptyText);

const chips = await page.evaluate(() => {
  const wrap = document.querySelector(".search-empty-domains");
  if (!wrap) return null;
  return {
    hintText: wrap.querySelector(".hint")?.textContent || "",
    chips: [...wrap.querySelectorAll("button.chip.search-chip")].map((b) => ({
      text: (b.textContent || "").trim(),
      ariaLabel: b.getAttribute("aria-label") || "",
      title: b.getAttribute("title") || "",
      hasIcon: !!b.querySelector("svg"),
    })),
  };
});

chips ? ok("zero-hit query renders the .search-empty-domains chip-map block") : bad(".search-empty-domains did not render for a genuine zero-hit query");

if (chips) {
  /^Also in GUIDON/.test(chips.hintText)
    ? ok('chip row is introduced by a "Also in GUIDON..." hint (' + chips.hintText + ")")
    : bad("unexpected hint text: " + chips.hintText);

  chips.chips.length === EXPECTED_HASHES.length
    ? ok(`exactly ${EXPECTED_HASHES.length} domain chips rendered (matches the current, re-verified UNINDEXED_DOMAIN_HASHES list)`)
    : bad(`expected ${EXPECTED_HASHES.length} chips, got ${chips.chips.length}: ${JSON.stringify(chips.chips.map((c) => c.text))}`);

  // Order + label correctness, matched 1:1 against the live G.routes labels
  // fetched above - NOT a hardcoded copy, so a future route rename can't
  // make this test lie about matching the real app.
  let labelsOk = true;
  chips.chips.forEach((c, i) => {
    const expectedLabel = liveRouteLabels[i];
    if (expectedLabel && c.text !== expectedLabel) labelsOk = false;
  });
  labelsOk
    ? ok("chip labels match live G.routes labels 1:1 in the documented order (" + chips.chips.map((c) => c.text).join(", ") + ")")
    : bad("chip label mismatch: " + JSON.stringify(chips.chips.map((c) => c.text)) + " vs " + JSON.stringify(liveRouteLabels));

  chips.chips.every((c) => c.hasIcon)
    ? ok("every chip renders a leading route icon (the `gi` shorthand resolved for all " + chips.chips.length + ")")
    : bad("at least one chip is missing its icon: " + JSON.stringify(chips.chips));

  chips.chips.every((c) => /not indexed by Search/i.test(c.ariaLabel))
    ? ok("every chip's aria-label explains WHY it's here (not indexed by Search)")
    : bad("a chip's aria-label doesn't explain the un-indexed reason: " + JSON.stringify(chips.chips.map((c) => c.ariaLabel)));

  // "Mock Board" must NOT appear - it isn't a route of its own, and #/board
  // (which it lives inside) is already indexed by Search's own "board" hit
  // type. A stale carry-forward of the roadmap's literal 8-item list would
  // fail this.
  chips.chips.some((c) => /mock board/i.test(c.text))
    ? bad('a "Mock Board" chip rendered - #/board is already indexed by Search, this would point at a covered route')
    : ok('no stale "Mock Board" chip - correctly dropped since #/board is already indexed');
}

/* ---- clicking a chip actually navigates to its real, live route ---- */
const moneyChip = page.locator(".search-empty-domains button.chip.search-chip", { hasText: "Money" }).first();
const moneyChipCount = await moneyChip.count();
if (moneyChipCount) {
  await moneyChip.click();
  await page.waitForTimeout(500);
  const afterClick = await page.evaluate(() => ({
    hash: location.hash,
    stillOnSearch: !!document.querySelector('input[aria-label="Global search"]'),
  }));
  afterClick.hash === "#/money"
    ? ok('clicking the "Money" chip navigated location.hash to "#/money"')
    : bad('clicking the "Money" chip left location.hash as "' + afterClick.hash + '", expected "#/money"');
  afterClick.stillOnSearch === false
    ? ok("Money's own view actually rendered (Search's markup - the global-search input - is gone)")
    : bad("still looks like the Search view rendered after clicking the Money chip");
} else {
  bad('no "Money" chip found to click - cannot verify real navigation');
}

/* ---- a second chip, to make sure this isn't a one-route fluke ---- */
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(400);
await searchInput.fill("zzzzznonexistentqueryxyz");
await page.waitForTimeout(300);
const formsChip = page.locator(".search-empty-domains button.chip.search-chip", { hasText: "Forms" }).first();
if (await formsChip.count()) {
  await formsChip.click();
  await page.waitForTimeout(500);
  const hash2 = await page.evaluate(() => location.hash);
  hash2 === "#/forms"
    ? ok('clicking the "Forms" chip navigated location.hash to "#/forms"')
    : bad('clicking the "Forms" chip left location.hash as "' + hash2 + '", expected "#/forms"');
} else {
  bad('no "Forms" chip found to click');
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSEARCH EMPTY-STATE DOMAIN CHIPS: all passed");
process.exit(fails ? 1 : 0);
