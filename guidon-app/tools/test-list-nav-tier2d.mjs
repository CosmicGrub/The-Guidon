/**
 * PC/desktop intuitivism pass, Tier 2(d) - 2026-08-22: backport Search's
 * arrow-key list navigation to Doctrine's entryList ("Jump to entry", up to
 * DOC_CAP=150 rows) and Board Drill's catList ("Jump to category").
 *
 * Independently re-verified before writing this (per this project's own
 * discipline of re-checking audit claims against the actual code, the way
 * Tier 1(b) did for Search's separate width bug): NEITHER list's
 * .list-detail-row buttons had ANY keydown handler before this change - only
 * a click listener. The audit's framing ("Search already has this exact
 * handler... never carried back to the list it was modeled on") is correct
 * in spirit but not literal - the arrow-key handler Search actually owns
 * lives on its .search-hit result CARDS (in resultsDiv), not on its own
 * entryList jump-list rows (which, like Doctrine's and Board Drill's, only
 * ever had a click listener). What got backported here is that same
 * navigational SHAPE (clamp at both ends, Enter/Space activates, ArrowUp
 * from the first row returns to a filter input where one genuinely sits
 * above the list) applied to the two lists this item names.
 *
 * Covers:
 *   - Doctrine's entryList: ArrowDown/ArrowUp move row-to-row and clamp at
 *     the bottom; ArrowUp from row 0 returns focus to the "Search doctrine"
 *     input (which sits directly above entryList and is entryList's own
 *     filter source); ArrowDown from that input enters at row 0; Enter/Space
 *     on a focused row jumps to and pulses the matching doc-entry-card,
 *     exactly like a click on that row does.
 *   - Board Drill's catList: ArrowDown/ArrowUp move row-to-row and clamp at
 *     BOTH ends (no return-to-input on ArrowUp from row 0 - catList has no
 *     equivalent control positioned above it the way Doctrine's search box
 *     does; catSel/diffSel live in a different .drill-layout column
 *     entirely); Enter/Space on a focused row sets catSel's value and fires
 *     its change event, exactly like a click on that row does.
 *   - Existing click-to-select behavior on both lists is unchanged by this
 *     purely-additive keyboard support.
 *
 * Roadmap audit round 9, "List-detail selection focus fix" bucket -
 * appended below rather than filed as a new test file (no package.json/
 * ci.yml matrix edit needed for a pure content addition to an already-
 * registered suite): Creeds' listPane, Recite's listPane, and PRT's
 * listPane (src/index.html, all three views' own renderList()) had the
 * *opposite* problem from what this file's two 2026-08-22 blocks above
 * fixed - not a missing keydown handler, but a click handler that called
 * renderList() on every selection, which util.clear()'d the pane and
 * rebuilt EVERY row from scratch, destroying the very button the click/
 * Enter/Space came from and dropping keyboard focus to <body>. Fixed by
 * the same in-place classList/aria-selected update Dictionary's
 * selectTerm() and Courses' selectCourse() already used (this file's own
 * src/index.html), plus the same ArrowUp/ArrowDown row-to-row support
 * this file's other two blocks cover. Each block below re-verifies BOTH
 * halves: rows survive a selection as the SAME DOM node (tagged with a
 * throwaway custom property before selecting, checked for survival
 * after - a rebuilt row would be a fresh node without it), and arrow-key
 * navigation actually moves row-to-row and clamps correctly.
 *   - Creeds' listPane: clamps at the bottom; ArrowUp from row 0 returns
 *     focus to the "Search creeds and branch identities" input above it.
 *   - Recite's listPane: clamps at BOTH ends (no filter/search input
 *     positioned above this particular list).
 *   - PRT's listPane: clamps at BOTH ends (same shape as Recite - the
 *     controls above this list are session-context chips/a run button,
 *     not a filter source for the list itself).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

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
  await dismissOnboarding(page);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(1000);
  return { page, noise };
}

/* ================= Doctrine's entryList ================= */
{
  const { page, noise } = await bootTo("#/doctrine", { width: 1440, height: 900 });

  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  rowCount > 3
    ? ok(`Doctrine's entryList rendered ${rowCount} rows on load (need >3 for a meaningful row-to-row check)`)
    : bad(`Doctrine's entryList only rendered ${rowCount} rows - not enough to test arrow nav`);

  if (rowCount > 3) {
    // Focus row 0, then walk down twice - each ArrowDown must land on the
    // NEXT row's own label, not just "some" different element (a naive
    // "focus changed" check can't distinguish real row-to-row movement from,
    // say, focus jumping straight to the last row).
    const labels = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
      rows[0].focus();
      return rows.slice(0, 3).map((r) => r.querySelector(".ldr-name")?.textContent || "");
    });

    await page.keyboard.press("ArrowDown");
    let activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[1]
      ? ok(`ArrowDown from entryList row 0 moved focus to row 1 ("${activeLabel}")`)
      : bad(`ArrowDown from row 0: expected to land on row 1 ("${labels[1]}"), got "${activeLabel}"`);

    await page.keyboard.press("ArrowDown");
    activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[2]
      ? ok(`ArrowDown again moved focus to row 2 ("${activeLabel}")`)
      : bad(`ArrowDown from row 1: expected to land on row 2 ("${labels[2]}"), got "${activeLabel}"`);

    await page.keyboard.press("ArrowUp");
    activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[1]
      ? ok(`ArrowUp from row 2 moved focus back to row 1 ("${activeLabel}")`)
      : bad(`ArrowUp from row 2: expected to land on row 1 ("${labels[1]}"), got "${activeLabel}"`);

    await page.keyboard.press("ArrowUp");
    // now on row 0
    await page.keyboard.press("ArrowUp");
    const onSearchInput = await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label") === "Search doctrine");
    onSearchInput
      ? ok("ArrowUp from entryList row 0 returned focus to the \"Search doctrine\" filter input above the list")
      : bad("ArrowUp from entryList row 0 did not return focus to the search input");

    await page.keyboard.press("ArrowDown");
    const backOnRow0 = await page.evaluate(() =>
      document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    backOnRow0 === labels[0]
      ? ok(`ArrowDown from the search input entered entryList at row 0 ("${backOnRow0}")`)
      : bad(`ArrowDown from the search input: expected row 0 ("${labels[0]}"), got "${backOnRow0}"`);

    // Enter/Space activates the focused row exactly like a click - jumps to
    // and pulses the matching doc-entry-card. Uses a real, trusted
    // page.keyboard press rather than a synthetic dispatchEvent(): these
    // rows are real <button> elements, so this exercises the BROWSER's own
    // native Enter-activates-a-focused-button behavior (which a synthetic,
    // untrusted KeyboardEvent does not trigger) - the same reason this
    // item's own row keydown handler deliberately does not duplicate
    // Enter/Space handling itself (see the src/index.html comment at the
    // row's keydown listener).
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const pulsedTitle = await page.evaluate(() => {
      const pulsed = document.querySelector(".list-detail-jumped");
      return pulsed ? pulsed.querySelector(".doc-title")?.textContent || "" : null;
    });
    pulsedTitle !== null && (pulsedTitle === labels[0] || labels[0].startsWith(pulsedTitle) || pulsedTitle.startsWith(labels[0]))
      ? ok(`Enter on the focused entryList row activated it, jumping to and pulsing the matching card ("${pulsedTitle}")`)
      : bad(`Enter on the focused entryList row did not activate the matching card (got pulsed title "${pulsedTitle}", expected "${labels[0]}")`);

    // Regression: existing click-to-select path on a row NOT touched by the
    // keyboard walk above must still work, and land on the correct card
    // (not just any card) - same non-first-row mutation-catching shape as
    // test-search-list-detail.mjs uses for Search's own jump index.
    await page.waitForTimeout(1700); // let the previous pulse's own removal timer clear first
    const clickResult = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
      const row = rows[2];
      const label = row.querySelector(".ldr-name")?.textContent || "";
      row.click();
      return label;
    });
    await page.waitForTimeout(300);
    const clickPulsedTitle = await page.evaluate(() => {
      const pulsed = document.querySelector(".list-detail-jumped");
      return pulsed ? pulsed.querySelector(".doc-title")?.textContent || "" : null;
    });
    clickPulsedTitle !== null && (clickPulsedTitle === clickResult || clickResult.startsWith(clickPulsedTitle) || clickPulsedTitle.startsWith(clickResult))
      ? ok(`existing click-to-select on entryList row 2 still works unchanged, landing on the matching card ("${clickPulsedTitle}")`)
      : bad(`click on entryList row 2 ("${clickResult}") did not land on the matching card (got "${clickPulsedTitle}") - click regression`);
  }

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (Doctrine entryList arrow nav)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await page.close();
}

/* ================= Board Drill's catList ================= */
{
  const { page, noise } = await bootTo("#/board", { width: 1440, height: 900 });
  // refreshCatList() awaits an IndexedDB SRS load before populating rows -
  // give it real headroom rather than assuming the fixed boot wait above
  // already covered it.
  await page.waitForFunction(() => document.querySelectorAll(".drill-layout .list-detail-list .list-detail-row").length > 1, { timeout: 5000 }).catch(() => {});

  const rowCount = await page.evaluate(() => document.querySelectorAll(".drill-layout .list-detail-list .list-detail-row").length);
  rowCount > 2
    ? ok(`Board Drill's catList rendered ${rowCount} category rows (need >2 for a meaningful row-to-row check)`)
    : bad(`Board Drill's catList only rendered ${rowCount} rows - not enough to test arrow nav`);

  if (rowCount > 2) {
    const labels = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".drill-layout .list-detail-list .list-detail-row")];
      rows[0].focus();
      return rows.slice(0, 3).map((r) => r.querySelector(".ldr-name")?.textContent || "");
    });

    await page.keyboard.press("ArrowDown");
    let activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[1]
      ? ok(`ArrowDown from catList row 0 ("${labels[0]}") moved focus to row 1 ("${activeLabel}")`)
      : bad(`ArrowDown from catList row 0: expected row 1 ("${labels[1]}"), got "${activeLabel}"`);

    await page.keyboard.press("ArrowDown");
    activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[2]
      ? ok(`ArrowDown again moved focus to row 2 ("${activeLabel}")`)
      : bad(`ArrowDown from catList row 1: expected row 2 ("${labels[2]}"), got "${activeLabel}"`);

    await page.keyboard.press("ArrowUp");
    activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[1]
      ? ok(`ArrowUp from catList row 2 moved focus back to row 1 ("${activeLabel}")`)
      : bad(`ArrowUp from catList row 2: expected row 1 ("${labels[1]}"), got "${activeLabel}"`);

    // Back to row 0, then one more ArrowUp: unlike Doctrine, catList has no
    // filter/search input positioned above it, so this must CLAMP at row 0
    // rather than moving focus anywhere else.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    const stillOnRow0 = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    stillOnRow0 === labels[0]
      ? ok(`ArrowUp from catList row 0 clamps in place ("${stillOnRow0}") - no equivalent above-list control to return focus to, unlike Doctrine`)
      : bad(`ArrowUp from catList row 0: expected to stay on row 0 ("${labels[0]}"), got "${stillOnRow0}"`);

    // Enter/Space activates the focused row exactly like a click - sets
    // catSel's value and fires its change event, filtering the flashcard
    // queue to that category.
    await page.keyboard.press("ArrowDown"); // move onto row 1 (a real, non-"All" category)
    const targetLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    // Real, trusted key press - see the matching comment on Doctrine's
    // Enter-activation check above for why a synthetic dispatchEvent()
    // would not exercise this (these rows rely on the browser's own native
    // Enter-activates-a-focused-button behavior, not a JS handler).
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const catSelValue = await page.evaluate(() => document.querySelector('select[aria-label="Filter by category"]')?.value);
    catSelValue === targetLabel
      ? ok(`Enter on catList row "${targetLabel}" activated it, setting the category filter to match (catSel.value === "${catSelValue}")`)
      : bad(`Enter on catList row "${targetLabel}" did not set the category filter (catSel.value === "${catSelValue}")`);

    // Regression: existing click-to-select path on catList still works,
    // switching the filter back to "All" (row 0).
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".drill-layout .list-detail-list .list-detail-row")];
      rows[0].click();
    });
    await page.waitForTimeout(400);
    const backToAll = await page.evaluate(() => document.querySelector('select[aria-label="Filter by category"]')?.value);
    backToAll === labels[0]
      ? ok(`existing click-to-select on catList row 0 still works unchanged, resetting the filter to "${backToAll}"`)
      : bad(`click on catList row 0 did not reset the filter (catSel.value === "${backToAll}", expected "${labels[0]}") - click regression`);
  }

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (Board Drill catList arrow nav)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await page.close();
}

/* ================= Creeds' listPane (round 9 focus fix) ================= */
{
  const { page, noise } = await bootTo("#/creeds", { width: 1440, height: 900 });

  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  rowCount > 3
    ? ok(`Creeds' listPane rendered ${rowCount} rows on load (need >3 for a meaningful row-to-row check)`)
    : bad(`Creeds' listPane only rendered ${rowCount} rows - not enough to test arrow nav`);

  if (rowCount > 3) {
    // Tag every row with a throwaway custom property before selecting -
    // it survives ONLY if the row's own DOM node survives the selection.
    // A renderList()-driven destroy-and-rebuild (the round 9 bug) would
    // replace every row with a fresh node that never got tagged.
    const labels = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
      rows.forEach((r, i) => { r.__t9tag = "row" + i; });
      rows[0].focus();
      return rows.slice(0, 3).map((r) => r.querySelector(".ldr-name")?.textContent || "");
    });

    // A REAL Playwright mouse click, not a scripted .click() call - only a
    // genuine click moves DOM focus the way a scripted .click() does not,
    // and focus landing ON the clicked row (not dropping to <body>, the
    // round 9 bug) is the actual behavior under test here.
    await page.locator(".list-detail-list .list-detail-row").nth(1).click();

    const survival = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
      return {
        row0Tagged: rows[0] && rows[0].__t9tag === "row0",
        row1Tagged: rows[1] && rows[1].__t9tag === "row1",
        row1Active: !!rows[1] && rows[1].classList.contains("active") && rows[1].getAttribute("aria-selected") === "true",
        row0NotActive: !!rows[0] && !rows[0].classList.contains("active") && rows[0].getAttribute("aria-selected") === "false",
        focusOnRow1: document.activeElement === rows[1],
      };
    });
    survival.row0Tagged && survival.row1Tagged
      ? ok("clicking a Creeds row kept every row as the SAME DOM node (no destroy-and-rebuild)")
      : bad("clicking a Creeds row destroyed/rebuilt row nodes: " + JSON.stringify(survival));
    survival.row1Active && survival.row0NotActive
      ? ok("clicking a Creeds row moved .active/aria-selected onto the clicked row in place")
      : bad("clicking a Creeds row did not correctly move .active/aria-selected: " + JSON.stringify(survival));
    survival.focusOnRow1
      ? ok("clicking a Creeds row kept keyboard focus ON that row (not dropped to <body>)")
      : bad("clicking a Creeds row did not keep keyboard focus on the row: " + JSON.stringify(survival));

    // Row 1 now genuinely has focus - arrow nav from here should walk
    // row-to-row exactly like Doctrine's entryList above.
    await page.keyboard.press("ArrowDown");
    let activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[2]
      ? ok(`ArrowDown from Creeds row 1 moved focus to row 2 ("${activeLabel}")`)
      : bad(`ArrowDown from Creeds row 1: expected row 2 ("${labels[2]}"), got "${activeLabel}"`);

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[0]
      ? ok(`ArrowUp x2 from Creeds row 2 moved focus back to row 0 ("${activeLabel}")`)
      : bad(`ArrowUp x2 from Creeds row 2: expected row 0 ("${labels[0]}"), got "${activeLabel}"`);

    await page.keyboard.press("ArrowUp");
    const onSearchInput = await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label") === "Search creeds and branch identities");
    onSearchInput
      ? ok("ArrowUp from Creeds listPane row 0 returned focus to the search input above the list")
      : bad("ArrowUp from Creeds listPane row 0 did not return focus to the search input");
  }

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (Creeds listPane focus fix)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await page.close();
}

/* ================= Recite's listPane (round 9 focus fix) ================= */
{
  const { page, noise } = await bootTo("#/recite", { width: 1440, height: 900 });

  // Exactly 3 recitable creeds today (store.recitable(): creed-4/creed-5/
  // creed-7 - see src/index.html) - >=3, not >3, is the meaningful floor.
  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  rowCount >= 3
    ? ok(`Recite's listPane rendered ${rowCount} rows on load (need >=3 for a meaningful row-to-row check)`)
    : bad(`Recite's listPane only rendered ${rowCount} rows - not enough to test arrow nav`);

  if (rowCount >= 3) {
    const labels = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
      rows.forEach((r, i) => { r.__t9tag = "row" + i; });
      rows[0].focus();
      return rows.slice(0, 3).map((r) => r.querySelector(".ldr-name")?.textContent || "");
    });

    // Real Playwright click (see Creeds' matching comment above for why a
    // scripted .click() call would not exercise the actual focus-retention
    // behavior under test).
    await page.locator(".list-detail-list .list-detail-row").nth(1).click();

    const survival = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
      return {
        row0Tagged: rows[0] && rows[0].__t9tag === "row0",
        row1Tagged: rows[1] && rows[1].__t9tag === "row1",
        row1Active: !!rows[1] && rows[1].classList.contains("active") && rows[1].getAttribute("aria-selected") === "true",
        row0NotActive: !!rows[0] && !rows[0].classList.contains("active") && rows[0].getAttribute("aria-selected") === "false",
        focusOnRow1: document.activeElement === rows[1],
      };
    });
    survival.row0Tagged && survival.row1Tagged
      ? ok("clicking a Recite row kept every row as the SAME DOM node (no destroy-and-rebuild)")
      : bad("clicking a Recite row destroyed/rebuilt row nodes: " + JSON.stringify(survival));
    survival.row1Active && survival.row0NotActive
      ? ok("clicking a Recite row moved .active/aria-selected onto the clicked row in place")
      : bad("clicking a Recite row did not correctly move .active/aria-selected: " + JSON.stringify(survival));
    survival.focusOnRow1
      ? ok("clicking a Recite row kept keyboard focus ON that row (not dropped to <body>)")
      : bad("clicking a Recite row did not keep keyboard focus on the row: " + JSON.stringify(survival));

    await page.keyboard.press("ArrowDown");
    let activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[2]
      ? ok(`ArrowDown from Recite row 1 moved focus to row 2 ("${activeLabel}")`)
      : bad(`ArrowDown from Recite row 1: expected row 2 ("${labels[2]}"), got "${activeLabel}"`);

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[0]
      ? ok(`ArrowUp x2 from Recite row 2 moved focus back to row 0 ("${activeLabel}")`)
      : bad(`ArrowUp x2 from Recite row 2: expected row 0 ("${labels[0]}"), got "${activeLabel}"`);

    // Unlike Creeds/Doctrine, no filter/search input sits above this
    // particular list - ArrowUp from row 0 must clamp in place.
    await page.keyboard.press("ArrowUp");
    const stillOnRow0 = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    stillOnRow0 === labels[0]
      ? ok(`ArrowUp from Recite listPane row 0 clamps in place ("${stillOnRow0}")`)
      : bad(`ArrowUp from Recite listPane row 0: expected to stay on row 0 ("${labels[0]}"), got "${stillOnRow0}"`);
  }

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (Recite listPane focus fix)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await page.close();
}

/* ================= PRT's listPane (round 9 focus fix) ================= */
{
  const { page, noise } = await bootTo("#/prt", { width: 1440, height: 900 });

  const rowCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .list-detail-row").length);
  rowCount > 3
    ? ok(`PRT's listPane rendered ${rowCount} exercise rows on load (need >3 for a meaningful row-to-row check)`)
    : bad(`PRT's listPane only rendered ${rowCount} rows - not enough to test arrow nav`);

  if (rowCount > 3) {
    const labels = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
      rows.forEach((r, i) => { r.__t9tag = "row" + i; });
      rows[0].focus();
      return rows.slice(0, 3).map((r) => r.querySelector(".ldr-name")?.textContent || "");
    });

    // Real Playwright click (see Creeds' matching comment above for why a
    // scripted .click() call would not exercise the actual focus-retention
    // behavior under test).
    await page.locator(".list-detail-list .list-detail-row").nth(1).click();

    const survival = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
      return {
        row0Tagged: rows[0] && rows[0].__t9tag === "row0",
        row1Tagged: rows[1] && rows[1].__t9tag === "row1",
        row1Active: !!rows[1] && rows[1].classList.contains("active") && rows[1].getAttribute("aria-selected") === "true",
        row0NotActive: !!rows[0] && !rows[0].classList.contains("active") && rows[0].getAttribute("aria-selected") === "false",
        focusOnRow1: document.activeElement === rows[1],
      };
    });
    survival.row0Tagged && survival.row1Tagged
      ? ok("clicking a PRT exercise row kept every row as the SAME DOM node (no destroy-and-rebuild)")
      : bad("clicking a PRT exercise row destroyed/rebuilt row nodes: " + JSON.stringify(survival));
    survival.row1Active && survival.row0NotActive
      ? ok("clicking a PRT exercise row moved .active/aria-selected onto the clicked row in place")
      : bad("clicking a PRT exercise row did not correctly move .active/aria-selected: " + JSON.stringify(survival));
    survival.focusOnRow1
      ? ok("clicking a PRT exercise row kept keyboard focus ON that row (not dropped to <body>)")
      : bad("clicking a PRT exercise row did not keep keyboard focus on the row: " + JSON.stringify(survival));

    await page.keyboard.press("ArrowDown");
    let activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[2]
      ? ok(`ArrowDown from PRT row 1 moved focus to row 2 ("${activeLabel}")`)
      : bad(`ArrowDown from PRT row 1: expected row 2 ("${labels[2]}"), got "${activeLabel}"`);

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    activeLabel === labels[0]
      ? ok(`ArrowUp x2 from PRT row 2 moved focus back to row 0 ("${activeLabel}")`)
      : bad(`ArrowUp x2 from PRT row 2: expected row 0 ("${labels[0]}"), got "${activeLabel}"`);

    // No filter/search input sits above this list either (session-context
    // chips and a "Run the drill" button do, but neither filters listPane)
    // - ArrowUp from row 0 must clamp in place.
    await page.keyboard.press("ArrowUp");
    const stillOnRow0 = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
    stillOnRow0 === labels[0]
      ? ok(`ArrowUp from PRT listPane row 0 clamps in place ("${stillOnRow0}")`)
      : bad(`ArrowUp from PRT listPane row 0: expected to stay on row 0 ("${labels[0]}"), got "${stillOnRow0}"`);
  }

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (PRT listPane focus fix)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `LIST ARROW-KEY NAV (TIER 2d): ${fails} FAILURE(S)` : "LIST ARROW-KEY NAV (TIER 2d): all passed"));
process.exit(fails ? 1 : 0);
