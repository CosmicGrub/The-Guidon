/**
 * Roadmap Tier 6c, #/resources: the category-left/detail-right list-detail
 * split. Mirrors Doctrine's entryList / Board Drill's catList pattern (see
 * those views' own comments in src/index.html) - a category-level jump
 * INDEX, not a true hide/show selection split. All 24 categories/78 items
 * still render fully in `results` (.card-results-grid) exactly as before;
 * the new `.list-detail-list` pane just adds a click/keyboard-navigable
 * shortcut that scrolls to and pulses the matching `.search-header`
 * divider. Modeled directly on tools/test-doctrine-card-grid.mjs and
 * tools/test-search-list-detail.mjs's structure.
 *
 * Covers:
 *   - the jump list renders one row per category, all 24, with item-count
 *     badges that match store.resources() exactly (not just "some" count).
 *   - clicking a NON-FIRST jump row (row 2, not row 0) scrolls to and
 *     pulses the matching .search-header, and lands on the CORRECT
 *     category - same non-first-row mutation-catching shape
 *     test-search-list-detail.mjs and test-list-nav-tier2d.mjs both use,
 *     to defeat an unincremented-index/always-lands-on-row-0 bug that a
 *     naive "something got pulsed" check can't distinguish from broken.
 *   - .list-detail is display:grid at >=1024px and display:block (stacked)
 *     below it, at the documented 1023/1024px boundary.
 *   - keyboard nav: ArrowDown/ArrowUp move row-to-row and clamp/return to
 *     the search input exactly like Doctrine's entryList (ArrowUp from row
 *     0 returns to the "Search resources" input; ArrowDown from that input
 *     enters row 0); Enter on a focused row activates it like a click.
 *   - the existing category chip filter and free-text search still narrow
 *     `results` correctly, and the jump list itself stays at all 24 rows
 *     throughout (it's a static index onto existing content, unlike
 *     Doctrine/Search's own dynamically-filtered entryLists - filtering
 *     items or hiding a category's header must never shrink this list).
 *   - no console errors/warnings anywhere in the above.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function boot(viewport) {
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
  await page.evaluate(() => { location.hash = "#/resources"; });
  await page.waitForTimeout(700);
  return { page, noise };
}

/* ---- jump list renders all categories with correct item-count badges ---- */
{
  const { page, noise } = await boot({ width: 1280, height: 900 });

  const expected = await page.evaluate(() => {
    const d = window.G.store.resources();
    return (d.categories || []).map((c) => ({ id: c.id, name: c.name, count: (c.items || []).length }));
  });
  const rendered = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
    return rows.map((r) => ({
      name: r.querySelector(".ldr-name")?.textContent || "",
      badge: r.querySelector(".ldr-badge")?.textContent || "",
    }));
  });

  expected.length === 24
    ? ok(`store.resources() has 24 categories as documented (found ${expected.length})`)
    : bad(`expected 24 categories in store.resources(), found ${expected.length}`);
  rendered.length === expected.length
    ? ok(`jump list rendered ${rendered.length} rows, one per category`)
    : bad(`jump list rendered ${rendered.length} rows, expected ${expected.length}`);

  const totalItems = expected.reduce((s, c) => s + c.count, 0);
  totalItems === 78
    ? ok(`store.resources() totals 78 items across all categories as documented (found ${totalItems})`)
    : bad(`expected 78 total items, found ${totalItems}`);

  const mismatches = expected.filter((c, i) => !rendered[i] || rendered[i].name !== c.name || rendered[i].badge !== String(c.count));
  mismatches.length === 0
    ? ok("every jump row's name + item-count badge matches store.resources() exactly, in order")
    : bad(`${mismatches.length} row(s) mismatched: ${JSON.stringify(mismatches.slice(0, 3))}`);

  noise.length === 0 ? ok("no console errors/warnings on #/resources load") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ---- clicking a non-first jump row scrolls to and pulses the matching .search-header ---- */
{
  const { page } = await boot({ width: 1280, height: 900 });

  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  rowCount > 3
    ? ok(`jump list has ${rowCount} rows (need >3 for a meaningful non-first-row check)`)
    : bad(`jump list only has ${rowCount} rows - not enough to test non-first-row jump mapping`);

  if (rowCount > 3) {
    const jump = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
      const row = rows[2]; // deliberately NOT row 0
      const rowLabel = row.querySelector(".ldr-name")?.textContent || "";
      row.click();
      return { rowLabel };
    });
    await page.waitForTimeout(300);
    const landed = await page.evaluate(() => {
      const pulsed = document.querySelector(".search-header.list-detail-jumped");
      return pulsed ? { catId: pulsed.getAttribute("data-res-cat"), text: pulsed.querySelector(".search-count")?.textContent || "" } : null;
    });
    landed !== null
      ? ok(`clicking jump row 2 ("${jump.rowLabel}") pulsed a .search-header (data-res-cat="${landed.catId}")`)
      : bad(`clicking jump row 2 ("${jump.rowLabel}") did not pulse any .search-header`);
    (landed && landed.text === jump.rowLabel)
      ? ok(`the pulsed .search-header's own category text ("${landed ? landed.text : ""}") matches the clicked row's label - correct mapping, not row-0-always`)
      : bad(`pulsed .search-header text ("${landed ? landed.text : "null"}") does not match clicked row's label ("${jump.rowLabel}") - jump mapping is broken`);

    // The pulse must be transient - fades after the documented 1600ms window.
    await page.waitForTimeout(1500);
    const stillPulsed = await page.evaluate(() => !!document.querySelector(".list-detail-jumped"));
    stillPulsed === false
      ? ok("the .list-detail-jumped pulse class is removed again after its timeout")
      : bad("the .list-detail-jumped pulse class is still present well past its documented 1600ms window");
  }
  await page.close();
}

/* ---- .list-detail breakpoint: exact 1023/1024px boundary ---- */
for (const [width, expect] of [[1023, "block"], [1024, "grid"]]) {
  const { page } = await boot({ width, height: 900 });
  const display = await page.evaluate(() => {
    const ld = document.querySelector(".list-detail");
    return ld ? getComputedStyle(ld).display : null;
  });
  display === expect
    ? ok(`${width}px: .list-detail display is "${expect}" as documented`)
    : bad(`${width}px: expected display "${expect}", got "${display}"`);
  await page.close();
}

/* ---- keyboard nav: ArrowDown/ArrowUp row-to-row, boundary returns to search input, Enter activates ---- */
{
  const { page, noise } = await boot({ width: 1440, height: 900 });

  const labels = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
    rows[0].focus();
    return rows.slice(0, 3).map((r) => r.querySelector(".ldr-name")?.textContent || "");
  });

  await page.keyboard.press("ArrowDown");
  let activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
  activeLabel === labels[1]
    ? ok(`ArrowDown from row 0 moved focus to row 1 ("${activeLabel}")`)
    : bad(`ArrowDown from row 0: expected row 1 ("${labels[1]}"), got "${activeLabel}"`);

  await page.keyboard.press("ArrowDown");
  activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
  activeLabel === labels[2]
    ? ok(`ArrowDown again moved focus to row 2 ("${activeLabel}")`)
    : bad(`ArrowDown from row 1: expected row 2 ("${labels[2]}"), got "${activeLabel}"`);

  await page.keyboard.press("ArrowUp");
  activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
  activeLabel === labels[1]
    ? ok(`ArrowUp from row 2 moved focus back to row 1 ("${activeLabel}")`)
    : bad(`ArrowUp from row 2: expected row 1 ("${labels[1]}"), got "${activeLabel}"`);

  await page.keyboard.press("ArrowUp"); // -> row 0
  await page.keyboard.press("ArrowUp"); // -> should return to search input
  const onSearchInput = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Search resources");
  onSearchInput
    ? ok('ArrowUp from row 0 returned focus to the "Search resources" input above the list')
    : bad("ArrowUp from row 0 did not return focus to the search input");

  await page.keyboard.press("ArrowDown");
  const backOnRow0 = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
  backOnRow0 === labels[0]
    ? ok(`ArrowDown from the search input entered the jump list at row 0 ("${backOnRow0}")`)
    : bad(`ArrowDown from the search input: expected row 0 ("${labels[0]}"), got "${backOnRow0}"`);

  // Enter activates the focused row exactly like a click.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const pulsedByKey = await page.evaluate(() => {
    const pulsed = document.querySelector(".search-header.list-detail-jumped");
    return pulsed ? pulsed.querySelector(".search-count")?.textContent || "" : null;
  });
  pulsedByKey === labels[0]
    ? ok(`Enter on the focused row 0 activated it, pulsing the matching .search-header ("${pulsedByKey}")`)
    : bad(`Enter on the focused row 0 did not pulse the matching .search-header (got "${pulsedByKey}", expected "${labels[0]}")`);

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings during keyboard nav") : bad("console noise: " + relevantNoise.join(" | "));
  await page.close();
}

/* ---- existing chip filter + search still work, jump list stays static (all 24 rows) throughout ---- */
{
  const { page, noise } = await boot({ width: 1280, height: 900 });

  const beforeRowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);

  // Category chip filter: click a real category chip (not "All categories").
  const chipInfo = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll(".search-filters .search-chip"));
    const chip = chips.find((c, i) => i > 0);
    if (!chip) return null;
    const label = chip.textContent;
    const cardsBefore = document.querySelectorAll(".res-card").length;
    chip.click();
    return { label, cardsBefore };
  });
  await page.waitForTimeout(300);
  const afterChip = await page.evaluate(() => ({
    cards: document.querySelectorAll(".res-card").length,
    headers: [...document.querySelectorAll(".search-header")].map((h) => h.querySelector(".search-count")?.textContent),
    rowCount: document.querySelectorAll(".list-detail-list .list-detail-row").length,
  }));
  chipInfo
    ? ok(`clicked category chip "${chipInfo.label}"`)
    : bad("no category chip found to click (expected >=1 real category chip)");
  (chipInfo && afterChip.cards > 0 && afterChip.cards <= chipInfo.cardsBefore)
    ? ok(`chip filter narrowed the results grid (${chipInfo ? chipInfo.cardsBefore : "?"} -> ${afterChip.cards} cards)`)
    : bad(`chip filter did not narrow correctly (${chipInfo ? chipInfo.cardsBefore : "?"} -> ${afterChip.cards} cards)`);
  const catName = chipInfo ? chipInfo.label.replace(/\s*\(\d+\)\s*$/, "") : null;
  const singleHeader = afterChip.headers.length === 1 && afterChip.headers[0] === catName;
  singleHeader
    ? ok(`only the "${catName}" category's .search-header renders while its chip is active`)
    : bad(`expected only "${catName}"'s header to render, got headers: ${JSON.stringify(afterChip.headers)}`);
  afterChip.rowCount === beforeRowCount
    ? ok(`jump list stayed at all ${afterChip.rowCount} category rows while the chip filter is active (static index, not re-filtered)`)
    : bad(`jump list row count changed under a chip filter (${beforeRowCount} -> ${afterChip.rowCount}) - it should stay static`);

  // Reset back to "All categories" before testing free-text search, so the
  // two filters are tested independently rather than compounded.
  await page.evaluate(() => {
    const allChip = [...document.querySelectorAll(".search-filters .search-chip")][0];
    if (allChip) allChip.click();
  });
  await page.waitForTimeout(300);

  // Free-text search.
  const searchTerm = "the";
  await page.evaluate((term) => {
    const inp = document.querySelector('input[aria-label="Search resources"]');
    inp.focus();
    inp.value = term;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }, searchTerm);
  await page.waitForTimeout(300);
  const afterSearch = await page.evaluate(() => ({
    cards: document.querySelectorAll(".res-card").length,
    rowCount: document.querySelectorAll(".list-detail-list .list-detail-row").length,
  }));
  afterSearch.cards > 0
    ? ok(`free-text search "${searchTerm}" rendered ${afterSearch.cards} matching result cards`)
    : bad(`free-text search "${searchTerm}" rendered no result cards`);
  afterSearch.rowCount === beforeRowCount
    ? ok(`jump list stayed at all ${afterSearch.rowCount} category rows while a search term is active`)
    : bad(`jump list row count changed under a search term (${beforeRowCount} -> ${afterSearch.rowCount}) - it should stay static`);

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings during chip filter + search regression check") : bad("console noise: " + relevantNoise.join(" | "));
  await page.close();
}

console.log(fails === 0 ? "\nRESOURCES LIST-DETAIL: all passed" : `\nRESOURCES LIST-DETAIL: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
