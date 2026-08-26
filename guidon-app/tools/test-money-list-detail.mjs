/**
 * Roadmap Tier 6c, #/money: the category-left/detail-right list-detail
 * split for the Money route's 8 tabs (BRS & TSP, TSP Funds, Budget,
 * Predatory Lending, ETS Finance, VA Compensation, Credit & Debt, Salary
 * Negotiation).
 *
 * Unlike #/resources' own Tier 6c split (test-resources-list-detail.mjs) -
 * a static jump-TO-existing-content index onto a single grid that always
 * holds all categories at once - Money's 8 tabs are mutually-exclusive
 * full-panel content blocks (tables, calculators, panel lists): only the
 * ACTIVE tab is ever in the DOM, the other 7 aren't rendered at all. So
 * the fitting precedent is Board Drill's catList (test-list-nav-tier2d.mjs)
 * - a rebuild-on-select pane that drives the exact same closures the
 * existing .tabbar buttons already use, not a scroll-to-existing-content
 * jump list. Concretely: navList's row onclick calls the SAME tabGo[i]
 * closure util.tabBtn's onclick already uses (see index.html's own
 * comment at the tabDefs/tabGo array), so the two controls can never drift
 * out of sync with each other, and every tab switch is a full re-render of
 * both (render() does util.clear(mount) + rebuild on every call, so there
 * is no separate "supplementary view survives an in-place update" case to
 * worry about here, unlike Board Drill's live-filtering catList).
 *
 * Covers:
 *   - navList renders exactly 8 rows, matching the 8 .tabbar tab labels,
 *     in the same order.
 *   - clicking a non-first, non-active navList row (Budget, row 3 of 8 -
 *     not row 1/BRS & TSP, which starts active) switches activeTab and
 *     re-renders #finance-stage with Budget's own real, distinguishing
 *     content (the "50/30/20 allocator" .fin-h heading, absent from every
 *     other tab) - not just "something changed".
 *   - the clicked row gets .active/aria-selected=true; no other row does.
 *   - .tabbar and navList never drift: clicking a .tabbar button updates
 *     navList's active row to match, and vice versa.
 *   - both G.finance._pendingTab deep-links (the VA combined-rating
 *     calculator's "See the full VA Compensation breakdown" button on
 *     #/transition's VA / BDD tab, and the "Open Job Offer Evaluation
 *     Checklist" button on its Federal Hiring tab - see G.transition's own
 *     _pendingTab writes in index.html) land on #/money with the CORRECT
 *     navList row (and .tabbar button) pre-highlighted, not just the
 *     module's default "brs" tab.
 *   - keyboard nav: ArrowDown/ArrowUp move row-to-row and CLAMP at both
 *     ends (no filter/search input sits above navList the way Doctrine's
 *     "Search doctrine" input sits above its entryList - same shape as
 *     Board Drill's catList, which also has no such input; see that list's
 *     own keydown comment in index.html); Enter on a focused row activates
 *     it exactly like a click.
 *   - no console errors/warnings anywhere in the above.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

const TAB_LABELS = [
  "BRS & TSP", "TSP Funds", "Budget", "Predatory Lending",
  "ETS Finance", "VA Compensation", "Credit & Debt", "Salary Negotiation",
];

async function bootTo(hash, viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(1000);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(700);
  return { page, noise };
}

/* ================= 1) navList renders exactly 8 rows, matching .tabbar, in order ================= */
{
  const { page, noise } = await bootTo("#/money", { width: 1440, height: 900 });

  const tabbarLabels = await page.evaluate(() => [...document.querySelectorAll(".tabbar button")].map((b) => b.textContent));
  const navListLabels = await page.evaluate(() => [...document.querySelectorAll(".list-detail-list .list-detail-row .ldr-name")].map((s) => s.textContent));

  tabbarLabels.length === 8
    ? ok(`#/money's .tabbar has 8 tab buttons as documented (found ${tabbarLabels.length})`)
    : bad(`expected 8 .tabbar buttons, found ${tabbarLabels.length}: ${JSON.stringify(tabbarLabels)}`);
  navListLabels.length === 8
    ? ok(`navList rendered 8 rows, one per tab (found ${navListLabels.length})`)
    : bad(`navList rendered ${navListLabels.length} rows, expected 8: ${JSON.stringify(navListLabels)}`);

  JSON.stringify(tabbarLabels) === JSON.stringify(TAB_LABELS)
    ? ok("the .tabbar labels match the documented 8 tabs, in order")
    : bad(`.tabbar labels: ${JSON.stringify(tabbarLabels)}, expected ${JSON.stringify(TAB_LABELS)}`);
  JSON.stringify(navListLabels) === JSON.stringify(TAB_LABELS)
    ? ok("navList's row labels exactly match .tabbar's labels, in the same order")
    : bad(`navList labels: ${JSON.stringify(navListLabels)}, expected ${JSON.stringify(TAB_LABELS)}`);

  // Default tab (brs) starts active on both controls, in sync.
  const initialActive = await page.evaluate(() => ({
    tabbar: (document.querySelector(".tabbar button.active") || {}).textContent || null,
    navList: (document.querySelector(".list-detail-list .list-detail-row.active .ldr-name") || {}).textContent || null,
  }));
  initialActive.tabbar === "BRS & TSP" && initialActive.navList === "BRS & TSP"
    ? ok('on initial load, both .tabbar and navList agree the active tab is "BRS & TSP"')
    : bad(`initial active state: ${JSON.stringify(initialActive)}, expected both "BRS & TSP"`);

  noise.length === 0 ? ok("no console errors/warnings on #/money load") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 2) clicking a non-first navList row (Budget, row 3) switches tabs correctly ================= */
{
  const { page, noise } = await bootTo("#/money", { width: 1440, height: 900 });

  const rows = await page.evaluate(() => [...document.querySelectorAll(".list-detail-list .list-detail-row")].map((r) => r.querySelector(".ldr-name")?.textContent || ""));
  rows[2] === "Budget"
    ? ok('navList row index 2 (the 3rd row) is "Budget", as expected from the documented tab order')
    : bad(`navList row index 2 is "${rows[2]}", expected "Budget"`);

  await page.evaluate(() => { document.querySelectorAll(".list-detail-list .list-detail-row")[2].click(); });
  await page.waitForTimeout(300);

  const afterClick = await page.evaluate(() => ({
    activeRowLabel: (document.querySelector(".list-detail-list .list-detail-row.active .ldr-name") || {}).textContent || null,
    activeRowCount: document.querySelectorAll(".list-detail-list .list-detail-row.active").length,
    activeTabbarLabel: (document.querySelector(".tabbar button.active") || {}).textContent || null,
    budgetHeading: [...document.querySelectorAll("#finance-stage .fin-h")].map((h) => h.textContent),
    stillHasFundsContent: !!document.querySelector("#finance-stage .fin-funds"),
  }));

  afterClick.activeRowLabel === "Budget"
    ? ok('clicking navList row 2 ("Budget") gives that row the .active class')
    : bad(`after clicking row 2, the active navList row is "${afterClick.activeRowLabel}", expected "Budget"`);
  afterClick.activeRowCount === 1
    ? ok("exactly one navList row carries .active after the click (no drift/duplication)")
    : bad(`${afterClick.activeRowCount} navList rows carry .active after the click, expected exactly 1`);
  afterClick.activeTabbarLabel === "Budget"
    ? ok('the matching .tabbar button ("Budget") is also active - no drift between .tabbar and navList')
    : bad(`.tabbar's active button is "${afterClick.activeTabbarLabel}" after clicking navList's Budget row, expected "Budget"`);
  afterClick.budgetHeading.includes("50/30/20 allocator")
    ? ok('#finance-stage re-rendered with Budget\'s own distinguishing content (the "50/30/20 allocator" heading)')
    : bad(`#finance-stage headings after the click: ${JSON.stringify(afterClick.budgetHeading)}, expected to include "50/30/20 allocator"`);
  afterClick.stillHasFundsContent === false
    ? ok("the previous tab's content (.fin-funds, TSP Funds) is gone - a real rebuild, not an additive stack")
    : bad("#finance-stage still contains .fin-funds content after switching to Budget");

  noise.length === 0 ? ok("no console errors/warnings after the navList row click") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 3) clicking a .tabbar button updates navList to match (symmetric, no drift) ================= */
{
  const { page, noise } = await bootTo("#/money", { width: 1440, height: 900 });

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".tabbar button")].find((b) => b.textContent === "Credit & Debt");
    btn.click();
  });
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    activeTabbarLabel: (document.querySelector(".tabbar button.active") || {}).textContent || null,
    activeRowLabel: (document.querySelector(".list-detail-list .list-detail-row.active .ldr-name") || {}).textContent || null,
    creditBasicsPresent: [...document.querySelectorAll("#finance-stage .eyebrow")].some((e) => e.textContent === "Credit basics"),
  }));
  state.activeTabbarLabel === "Credit & Debt" && state.activeRowLabel === "Credit & Debt"
    ? ok('clicking the .tabbar "Credit & Debt" button also updates navList\'s active row to "Credit & Debt" - symmetric, no drift')
    : bad(`after clicking .tabbar's Credit & Debt button: ${JSON.stringify(state)}`);
  state.creditBasicsPresent
    ? ok('#finance-stage shows Credit & Debt\'s own distinguishing content ("Credit basics")')
    : bad("#finance-stage does not show the Credit & Debt tab's own content after the .tabbar click");

  noise.length === 0 ? ok("no console errors/warnings after the .tabbar click") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 4) deep-link: VA combined-rating calculator -> #/money "VA Compensation" ================= */
{
  const { page, noise } = await bootTo("#/transition", { width: 1440, height: 900 });

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".tabbar button")].find((b) => b.textContent === "VA / BDD");
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);

  const calcInput = page.locator(".fin-calc input[type=number]").first();
  const hasCalc = await calcInput.count();
  hasCalc > 0
    ? ok('found the VA combined-rating calculator\'s first rating input on #/transition\'s "VA / BDD" tab')
    : bad('the VA combined-rating calculator was not found on #/transition\'s "VA / BDD" tab');

  if (hasCalc) {
    await calcInput.fill("50");
    await page.waitForTimeout(200); // past the 60ms recalcVa() debounce

    const xlBtn = page.locator(".fin-calc button", { hasText: "VA Compensation" }).first();
    const hasXlBtn = await xlBtn.count();
    hasXlBtn > 0
      ? ok('found the "See the full VA Compensation breakdown" cross-link button after entering a rating')
      : bad('the "See the full VA Compensation breakdown" cross-link button did not appear after entering a rating');

    if (hasXlBtn) {
      await xlBtn.click();
      await page.waitForTimeout(500);

      const landed = await page.evaluate(() => ({
        hash: location.hash,
        activeTabbarLabel: (document.querySelector(".tabbar button.active") || {}).textContent || null,
        activeRowLabel: (document.querySelector(".list-detail-list .list-detail-row.active .ldr-name") || {}).textContent || null,
        vaGridPresent: !!document.querySelector("#finance-stage .fin-va-grid"),
      }));
      landed.hash === "#/money"
        ? ok("the cross-link navigated to #/money")
        : bad(`the cross-link landed on hash="${landed.hash}", expected "#/money"`);
      landed.activeTabbarLabel === "VA Compensation" && landed.activeRowLabel === "VA Compensation"
        ? ok('#/money landed directly on "VA Compensation" - BOTH .tabbar and navList\'s row are pre-highlighted correctly (G.finance._pendingTab)')
        : bad(`after the VA deep-link: .tabbar active="${landed.activeTabbarLabel}", navList active="${landed.activeRowLabel}", expected both "VA Compensation"`);
      landed.vaGridPresent
        ? ok("#finance-stage shows the VA Compensation tab's own distinguishing content (.fin-va-grid)")
        : bad("#finance-stage does not show .fin-va-grid after the VA deep-link");
    }
  }

  noise.length === 0 ? ok("no console errors/warnings during the VA Compensation deep-link flow") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 5) deep-link: Federal Hiring's Job Offer Checklist -> #/money "Salary Negotiation" ================= */
{
  const { page, noise } = await bootTo("#/transition", { width: 1440, height: 900 });

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".tabbar button")].find((b) => b.textContent === "Federal Hiring");
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);

  const xlBtn = page.locator("button", { hasText: "Job Offer Evaluation Checklist" }).first();
  const hasXlBtn = await xlBtn.count();
  hasXlBtn > 0
    ? ok('found the "Open Job Offer Evaluation Checklist" cross-link button on #/transition\'s "Federal Hiring" tab')
    : bad('the "Open Job Offer Evaluation Checklist" cross-link button was not found on the Federal Hiring tab');

  if (hasXlBtn) {
    await xlBtn.click();
    await page.waitForTimeout(500);

    const landed = await page.evaluate(() => ({
      hash: location.hash,
      activeTabbarLabel: (document.querySelector(".tabbar button.active") || {}).textContent || null,
      activeRowLabel: (document.querySelector(".list-detail-list .list-detail-row.active .ldr-name") || {}).textContent || null,
      hasSalaryRangeWorksheet: /Salary Range Research worksheet/.test(document.body.textContent || ""),
    }));
    landed.hash === "#/money"
      ? ok("the cross-link navigated to #/money")
      : bad(`the cross-link landed on hash="${landed.hash}", expected "#/money"`);
    landed.activeTabbarLabel === "Salary Negotiation" && landed.activeRowLabel === "Salary Negotiation"
      ? ok('#/money landed directly on "Salary Negotiation" - BOTH .tabbar and navList\'s row are pre-highlighted correctly (G.finance._pendingTab)')
      : bad(`after the Salary Negotiation deep-link: .tabbar active="${landed.activeTabbarLabel}", navList active="${landed.activeRowLabel}", expected both "Salary Negotiation"`);
    landed.hasSalaryRangeWorksheet
      ? ok('#finance-stage shows the Salary Negotiation tab\'s own distinguishing content ("Salary Range Research worksheet")')
      : bad("#finance-stage does not show the Salary Range Research worksheet after the Salary Negotiation deep-link");
  }

  noise.length === 0 ? ok("no console errors/warnings during the Salary Negotiation deep-link flow") : bad("console noise: " + noise.join(" | "));
  await page.close();
}

/* ================= 6) keyboard nav: ArrowDown/ArrowUp clamp at both ends, Enter activates ================= */
{
  const { page, noise } = await bootTo("#/money", { width: 1440, height: 900 });

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

  // ArrowUp from row 0 CLAMPS (stays on row 0) - navList has no filter/search
  // input positioned above it (unlike Doctrine's entryList), so unlike that
  // list's ArrowUp-returns-to-search-input behavior, this matches Board
  // Drill's catList, which clamps at row 0 for the same structural reason.
  await page.keyboard.press("ArrowUp"); // -> row 0
  await page.keyboard.press("ArrowUp"); // -> should clamp, stay on row 0
  activeLabel = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
  activeLabel === labels[0]
    ? ok(`ArrowUp from row 0 clamps - focus stays on row 0 ("${activeLabel}"), no input to return to above navList`)
    : bad(`ArrowUp from row 0: expected focus to clamp on row 0 ("${labels[0]}"), got "${activeLabel}"`);

  // Enter on the focused row (row 0, "BRS & TSP") activates it exactly like a click.
  // Move to a DIFFERENT tab first (Predatory Lending, row 3) so activating
  // row 0 via Enter is a real, observable switch, not a no-op on the
  // already-active tab.
  await page.evaluate(() => { document.querySelectorAll(".list-detail-list .list-detail-row")[3].click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelectorAll(".list-detail-list .list-detail-row")[0].focus(); });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  const afterEnter = await page.evaluate(() => ({
    activeRowLabel: (document.querySelector(".list-detail-list .list-detail-row.active .ldr-name") || {}).textContent || null,
    activeTabbarLabel: (document.querySelector(".tabbar button.active") || {}).textContent || null,
  }));
  afterEnter.activeRowLabel === "BRS & TSP" && afterEnter.activeTabbarLabel === "BRS & TSP"
    ? ok('Enter on the focused row 0 ("BRS & TSP") activated it exactly like a click - both .tabbar and navList switched')
    : bad(`after pressing Enter on row 0: ${JSON.stringify(afterEnter)}, expected both "BRS & TSP"`);

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings during keyboard nav") : bad("console noise: " + relevantNoise.join(" | "));
  await page.close();
}

console.log(fails === 0 ? "\nMONEY LIST-DETAIL: all passed" : `\nMONEY LIST-DETAIL: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
