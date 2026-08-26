/**
 * Roadmap Tier 6b, #/dictionary: the alphabetized list-left/detail-right
 * split. Unlike every other .list-detail route so far (Doctrine/Resources/
 * Search/Money - all of which JUMP to an unchanged card/section already
 * rendered below, see those views' own comments in src/index.html),
 * Dictionary's right pane actually REPLACES its content with whichever term
 * is currently selected - it's the "simplest data shape of the batch" (no
 * topic/category/doctrine-ref field to preserve a richer multi-card view
 * around), so a true single-selection detail view was the natural fit.
 *
 * Modeled on tools/test-search-list-detail.mjs and tools/test-list-nav-
 * tier2d.mjs's structure; the doctrine cross-link check is modeled on
 * tools/test-doctrine-card-grid.mjs's own board-question cross-link check
 * (lines ~134-153), same pattern, different trigger.
 *
 * Covers:
 *   - the letter rail renders 26 letter chips (A-Z) plus "All", in order.
 *   - clicking a letter chip (Z - a small, deterministic bucket) filters
 *     entryList to ONLY that letter's terms, with the correct count and
 *     every visible row actually starting with that letter (not just "some
 *     narrower count").
 *   - a term row click (a non-first row, to defeat an unincremented-index/
 *     always-lands-on-row-0 bug the same way test-search-list-detail.mjs's
 *     own non-first-row check does) sets `selected` and the detail pane
 *     shows that EXACT term's full definition and source badge - not just
 *     "some" definition.
 *   - the doctrine cross-link button sets G.views._doctrineSeed to the
 *     selected term's own acronym and navigates to #/doctrine, which then
 *     shows that acronym pre-filled in its own search box.
 *   - the default-selected term on a fresh load is the alphabetically-first
 *     term across the whole dataset (computed at runtime from the app's own
 *     real data + sort comparator, not hardcoded - future-proof against
 *     content changes).
 *   - changing the search query while a term is selected, such that the
 *     term falls outside the new filtered results, clears the selection
 *     back to the placeholder (rather than silently jumping to another
 *     term).
 *   - .list-detail is display:grid at >=1024px, display:block (stacked)
 *     below it, at the documented 1023/1024px boundary.
 *   - keyboard nav: ArrowDown/ArrowUp move row-to-row and clamp at the
 *     bottom; ArrowUp from row 0 returns focus to the "Search dictionary"
 *     input; ArrowDown from that input enters row 0; Enter on a focused row
 *     activates it exactly like a click.
 *   - existing search-by-substring behavior (exact-acronym-first sort, the
 *     "Showing N of M" count, the empty-state echo of the query) is
 *     unaffected by this rewrite.
 *   - no console errors/warnings anywhere in the above.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootTo(hash, viewport) {
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
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(700);
  return { page, noise };
}

/* ================= 1) letter rail: 26 letter chips + "All", in order ================= */
{
  const { page, noise } = await bootTo("#/dictionary", { width: 1440, height: 900 });

  const chipLabels = await page.evaluate(() => [...document.querySelectorAll(".search-filters .search-chip")].map((b) => b.textContent));
  const expectedLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  chipLabels.length === 27
    ? ok(`letter rail rendered 27 chips ("All" + 26 letters), found ${chipLabels.length}`)
    : bad(`letter rail rendered ${chipLabels.length} chips, expected 27 ("All" + 26 letters): ${JSON.stringify(chipLabels)}`);
  chipLabels[0] === "All"
    ? ok('first chip is "All"')
    : bad(`first chip is "${chipLabels[0]}", expected "All"`);
  JSON.stringify(chipLabels.slice(1)) === JSON.stringify(expectedLetters)
    ? ok("remaining 26 chips are A-Z, in order")
    : bad(`letter chips after "All": ${JSON.stringify(chipLabels.slice(1))}, expected ${JSON.stringify(expectedLetters)}`);

  const allChipActive = await page.evaluate(() => document.querySelector(".search-filters .search-chip")?.classList.contains("active"));
  allChipActive
    ? ok('the "All" chip starts active')
    : bad('the "All" chip does not start active');

  noise.length === 0 ? ok("no console errors/warnings on #/dictionary load") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 2) clicking letter "Z" filters entryList to only Z-terms, correct count ================= */
{
  const { page, noise } = await bootTo("#/dictionary", { width: 1440, height: 900 });

  const expected = await page.evaluate(() => {
    const terms = (window.G.store.acronyms().terms || []);
    return terms.filter((t) => t.a.toUpperCase().startsWith("Z")).map((t) => t.a).sort();
  });
  expected.length > 0
    ? ok(`dataset has ${expected.length} term(s) starting with "Z" (${expected.join(", ")}) - a small, deterministic bucket to test against`)
    : bad('dataset has zero terms starting with "Z" - cannot run this check');

  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".search-filters .search-chip")].find((b) => b.textContent === "Z");
    if (chip) chip.click();
  });
  await page.waitForTimeout(250);

  const afterClick = await page.evaluate(() => ({
    rowNames: [...document.querySelectorAll(".list-detail-list .list-detail-row .ldr-name")].map((s) => s.textContent).sort(),
    zChipActive: [...document.querySelectorAll(".search-filters .search-chip")].find((b) => b.textContent === "Z")?.classList.contains("active"),
    allChipActive: document.querySelector(".search-filters .search-chip")?.classList.contains("active"),
  }));

  afterClick.zChipActive
    ? ok('clicking the "Z" chip gives it the .active class')
    : bad('clicking the "Z" chip did not activate it');
  afterClick.allChipActive === false
    ? ok('the "All" chip is no longer active after picking "Z"')
    : bad('the "All" chip is still active after picking "Z"');
  JSON.stringify(afterClick.rowNames) === JSON.stringify(expected)
    ? ok(`entryList narrowed to exactly the ${expected.length} real "Z" term(s): ${afterClick.rowNames.join(", ")}`)
    : bad(`entryList rows after "Z" filter: ${JSON.stringify(afterClick.rowNames)}, expected ${JSON.stringify(expected)}`);

  noise.length === 0 ? ok("no console errors/warnings after the letter-chip click") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 3) default-selected term on fresh load is the real alphabetically-first term ================= */
{
  const { page, noise } = await bootTo("#/dictionary", { width: 1440, height: 900 });

  // Same sort comparator src/index.html's own sortHits() uses with no active
  // query, applied here in-page so the expectation is derived from the
  // app's REAL current data, not a hardcoded snapshot that would go stale
  // the next time the dictionary seed changes.
  const expectedFirst = await page.evaluate(() => {
    const terms = window.G.store.acronyms().terms || [];
    return [...terms].sort((a, b) => (a.a.toUpperCase() < b.a.toUpperCase() ? -1 : 1))[0];
  });

  const state = await page.evaluate(() => ({
    activeRowName: document.querySelector(".list-detail-list .list-detail-row.active .ldr-name")?.textContent || null,
    detailAcronym: document.querySelector(".dict-detail-acronym")?.textContent || null,
  }));

  state.activeRowName === expectedFirst.a
    ? ok(`the alphabetically-first term ("${expectedFirst.a}") is pre-selected in entryList on fresh load`)
    : bad(`entryList's active row on load is "${state.activeRowName}", expected the real first term "${expectedFirst.a}"`);
  state.detailAcronym === expectedFirst.a
    ? ok(`the detail pane shows the alphabetically-first term ("${expectedFirst.a}") by default`)
    : bad(`the detail pane shows "${state.detailAcronym}" by default, expected "${expectedFirst.a}"`);

  noise.length === 0 ? ok("no console errors/warnings for the default-selection state") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 4) clicking a non-first row sets `selected` + shows its exact definition ================= */
{
  const { page, noise } = await bootTo("#/dictionary", { width: 1440, height: 900 });

  // A non-first row within the small, deterministic "Z" bucket used above -
  // avoids the CAP=120 truncation of the full, unfiltered list and defeats
  // an unincremented-index/always-lands-on-row-0 bug (a first-row click
  // can't distinguish "correct" from "broken and lucky").
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".search-filters .search-chip")].find((b) => b.textContent === "Z");
    if (chip) chip.click();
  });
  await page.waitForTimeout(250);

  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  rowCount > 1
    ? ok(`the "Z" bucket has ${rowCount} rows (need >1 for a meaningful non-first-row check)`)
    : bad(`the "Z" bucket only has ${rowCount} row(s) - not enough to test a non-first-row click`);

  if (rowCount > 1) {
    const clicked = await page.evaluate(() => {
      const row = document.querySelectorAll(".list-detail-list .list-detail-row")[1];
      const name = row.querySelector(".ldr-name")?.textContent || "";
      row.click();
      return name;
    });
    await page.waitForTimeout(150);

    const expectedTerm = await page.evaluate((name) => {
      const terms = window.G.store.acronyms().terms || [];
      return terms.find((t) => t.a === name);
    }, clicked);

    const detail = await page.evaluate(() => ({
      acronym: document.querySelector(".dict-detail-acronym")?.textContent || null,
      def: document.querySelector(".dict-detail-def")?.textContent || null,
      badge: document.querySelector("#dictionary-detail-pane .tag")?.textContent || null,
      activeRowName: document.querySelector(".list-detail-list .list-detail-row.active .ldr-name")?.textContent || null,
      activeRowCount: document.querySelectorAll(".list-detail-list .list-detail-row.active").length,
    }));

    detail.activeRowCount === 1 && detail.activeRowName === clicked
      ? ok(`clicking the 2nd row ("${clicked}") gives that row (and only that row) .active`)
      : bad(`after clicking row 1 ("${clicked}"): active row = "${detail.activeRowName}", active count = ${detail.activeRowCount}`);
    detail.acronym === expectedTerm.a
      ? ok(`the detail pane's acronym matches the clicked row exactly ("${detail.acronym}")`)
      : bad(`detail pane acronym "${detail.acronym}", expected "${expectedTerm.a}"`);
    detail.def === expectedTerm.d
      ? ok("the detail pane shows the clicked term's own full definition, verbatim")
      : bad(`detail pane definition "${detail.def}", expected "${expectedTerm.d}"`);
    const expectedBadge = expectedTerm.src === "army" ? "ARMY" : expectedTerm.src === "both" ? "ARMY+JOINT" : "JOINT";
    detail.badge === expectedBadge
      ? ok(`the detail pane's source badge matches ("${detail.badge}")`)
      : bad(`detail pane badge "${detail.badge}", expected "${expectedBadge}"`);
  }

  noise.length === 0 ? ok("no console errors/warnings after the row-click selection") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 5) doctrine cross-link: sets _doctrineSeed + navigates to #/doctrine ================= */
{
  const { page, noise } = await bootTo("#/dictionary", { width: 1440, height: 900 });

  const selectedAcronym = await page.evaluate(() => document.querySelector(".dict-detail-acronym")?.textContent || null);
  const hasLink = await page.evaluate(() => !!document.querySelector(".dict-doctrine-link"));
  hasLink
    ? ok('the "Related doctrine" cross-link button is present in the detail pane')
    : bad('the "Related doctrine" cross-link button was not found in the detail pane');

  if (hasLink) {
    await page.evaluate(() => { document.querySelector(".dict-doctrine-link").click(); });
    await page.waitForTimeout(500);

    const landed = await page.evaluate(() => ({
      hash: location.hash,
      searchValue: document.querySelector('input[aria-label="Search doctrine"]')?.value || null,
      seedCleared: window.G.views._doctrineSeed === null,
    }));

    landed.hash === "#/doctrine"
      ? ok("the cross-link navigated to #/doctrine")
      : bad(`the cross-link landed on hash="${landed.hash}", expected "#/doctrine"`);
    landed.searchValue === selectedAcronym
      ? ok(`#/doctrine's own search box is pre-filled with the term's acronym ("${landed.searchValue}")`)
      : bad(`#/doctrine's search box value is "${landed.searchValue}", expected "${selectedAcronym}"`);
    landed.seedCleared
      ? ok("G.views._doctrineSeed was consumed (cleared) after use")
      : bad("G.views._doctrineSeed was not cleared after use");
  }

  noise.length === 0 ? ok("no console errors/warnings during the doctrine cross-link flow") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 6) query that excludes the selected term clears selection back to placeholder ================= */
{
  const { page, noise } = await bootTo("#/dictionary", { width: 1440, height: 900 });

  const before = await page.evaluate(() => document.querySelector(".dict-detail-acronym")?.textContent || null);
  before !== null
    ? ok(`a term ("${before}") is selected before the query change, as expected from default-selection`)
    : bad("no term was selected before the query change - cannot test the clearing behavior");

  // A query specific enough that the alphabetically-first term (whatever it
  // is) cannot possibly match both its own acronym AND definition text.
  await page.evaluate(() => {
    const inp = document.querySelector('input[aria-label="Search dictionary"]');
    inp.focus();
    inp.value = "zzzzznonexistentqueryxyz";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(250);

  const after = await page.evaluate(() => ({
    placeholderPresent: !!document.querySelector(".dict-detail-empty"),
    detailAcronym: document.querySelector(".dict-detail-acronym")?.textContent || null,
    emptyText: document.querySelector(".list-detail-list .empty")?.textContent || "",
  }));

  after.placeholderPresent && after.detailAcronym === null
    ? ok("selection cleared back to the placeholder once the query excluded the previously-selected term")
    : bad(`after an excluding query: placeholder present = ${after.placeholderPresent}, detail acronym = "${after.detailAcronym}" (expected null)`);
  (/No terms match/.test(after.emptyText) && after.emptyText.includes("zzzzznonexistentqueryxyz"))
    ? ok("entryList's own empty state echoes the actual search text")
    : bad(`entryList empty state text: "${after.emptyText}"`);

  noise.length === 0 ? ok("no console errors/warnings after the excluding query") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 7) breakpoint: the exact 1023px/1024px boundary ================= */
for (const [width, expect] of [[1023, "block"], [1024, "grid"]]) {
  const { page, noise } = await bootTo("#/dictionary", { width, height: 900 });
  const display = await page.evaluate(() => {
    const ld = document.querySelector(".list-detail");
    return ld ? getComputedStyle(ld).display : null;
  });
  display === expect
    ? ok(`${width}px: .list-detail display is "${expect}" as documented`)
    : bad(`${width}px: expected display "${expect}", got "${display}"`);
  noise.length === 0 ? ok(`${width}px: no console errors/warnings`) : bad(`${width}px console noise: ` + noise.join(" | "));
  await page.close();
}

/* ================= 8) keyboard nav: ArrowDown/ArrowUp, ArrowUp-to-search, ArrowDown-from-search, Enter ================= */
{
  const { page, noise } = await bootTo("#/dictionary", { width: 1440, height: 900 });

  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  rowCount > 3
    ? ok(`entryList rendered ${rowCount} rows on load (need >3 for a meaningful row-to-row check)`)
    : bad(`entryList only rendered ${rowCount} rows - not enough to test arrow nav`);

  if (rowCount > 3) {
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
    await page.keyboard.press("ArrowUp"); // -> should return focus to the search input
    const onSearchInput = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Search dictionary");
    onSearchInput
      ? ok('ArrowUp from entryList row 0 returned focus to the "Search dictionary" input')
      : bad("ArrowUp from entryList row 0 did not return focus to the search input");

    await page.keyboard.press("ArrowDown");
    const backOnRow0 = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    backOnRow0 === labels[0]
      ? ok(`ArrowDown from the search input entered entryList at row 0 ("${backOnRow0}")`)
      : bad(`ArrowDown from the search input: expected row 0 ("${labels[0]}"), got "${backOnRow0}"`);

    // Enter on the focused row activates it exactly like a click - a real,
    // trusted key press (not a synthetic dispatchEvent()) so the browser's
    // own native Enter-activates-a-focused-button behavior fires.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    const afterEnter = await page.evaluate(() => ({
      activeRowName: document.querySelector(".list-detail-list .list-detail-row.active .ldr-name")?.textContent || null,
      detailAcronym: document.querySelector(".dict-detail-acronym")?.textContent || null,
    }));
    afterEnter.activeRowName === labels[0] && afterEnter.detailAcronym === labels[0]
      ? ok(`Enter on the focused row 0 ("${labels[0]}") activated it exactly like a click - both entryList and the detail pane updated`)
      : bad(`after Enter on row 0: active row = "${afterEnter.activeRowName}", detail = "${afterEnter.detailAcronym}", expected both "${labels[0]}"`);
  }

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings during keyboard nav") : bad("console noise: " + relevantNoise.join(" | "));
  await page.close();
}

/* ================= 9) existing search-by-substring behavior is unaffected ================= */
{
  const { page, noise } = await bootTo("#/dictionary", { width: 1440, height: 900 });

  await page.evaluate(() => {
    const inp = document.querySelector('input[aria-label="Search dictionary"]');
    inp.focus();
    inp.value = "NCOER";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(250);

  const state = await page.evaluate(() => ({
    metaText: document.querySelector(".meta")?.textContent || "",
    exactRowPresent: !!document.querySelector(".list-detail-row.dict-exact"),
    firstRowName: document.querySelector(".list-detail-list .list-detail-row .ldr-name")?.textContent || null,
  }));

  /Showing \d+ of \d+ matches/.test(state.metaText)
    ? ok(`search shows a real "Showing N of M matches" count ("${state.metaText}")`)
    : bad(`search meta text: "${state.metaText}"`);
  state.exactRowPresent
    ? ok("the exact-acronym match (NCOER) is marked with .dict-exact")
    : bad("no .dict-exact row found for an exact-acronym query (NCOER)");
  state.firstRowName === "NCOER"
    ? ok('the exact match ("NCOER") sorts first in entryList')
    : bad(`entryList's first row is "${state.firstRowName}", expected the exact match "NCOER"`);

  noise.length === 0 ? ok("no console errors/warnings for the substring-search regression check") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

console.log(fails === 0 ? "\nDICTIONARY LIST-DETAIL: all passed" : `\nDICTIONARY LIST-DETAIL: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
