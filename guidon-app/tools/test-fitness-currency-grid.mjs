/**
 * Roadmap Tier 5 (width-waste audit), #/currency and #/fitness.
 *
 * #/currency (js/currency.js, G.currency, nav label "Freshness"): already
 * used .card-results-grid (a Fold5/tablet fidelity wave 2 fix from an
 * earlier tier - see the comment above `const grid` in currency.js) - a
 * real auto-fill grid, not a media-query breakpoint, so it was ALREADY
 * multi-column at wide viewports before this tier touched anything. This
 * file's Part 1 is a REGRESSION GUARD proving that's still true today, not
 * a fix.
 *
 * #/fitness (js/fitness.js, G.fitness) genuinely was one long single
 * column at every viewport width - real measured scrollHeight 2,535px at
 * 768px wide (Playwright, chromium, `.main` scroller) with all 9 panels
 * sharing one x-position no matter how wide the viewport got. Fixed by
 * wrapping the four AFT reference panels (two standards / cost table /
 * points note / body composition) in one `.panel-grid-2` and the two CFT
 * reference panels (scoring / deadline) in a second - the same >=600px
 * utility Career's own topGrid already uses (chosen over a fresh
 * >=768px/1024px rule specifically so Fold5-unfolded-portrait, ~673px CSS-
 * wide, still gets the grid - see the CSS comment above .panel-grid-2).
 * The CFT's numbered 7-event walkthrough and the monospace MOS code walls
 * are deliberately left OUT of the grid (see the comments in fitness.js) -
 * Part 2 confirms both of those are still full width, not just that
 * *something* is now a grid.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1024, height: 1000 } })).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);

async function goto(hash) {
  // Same technique used throughout tools/test-*.mjs for this hash router:
  // re-entering the same hash doesn't re-run render(), so bounce through
  // #/home first.
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(200);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(500);
}

async function setWidth(w, h = 1000) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(150); // let CSS media queries settle before reading layout
}

// ============================================================================
// Part 1: #/currency - regression guard. .card-results-grid is an
// auto-fill grid with no media-query gate, so it should already be
// multi-column well above and right at 768px, and fall back to one column
// at 375px.
// ============================================================================
await goto("#/currency");

for (const w of [1024, 768]) {
  await setWidth(w);
  const info = await page.evaluate(() => {
    const grid = document.querySelector(".card-results-grid");
    if (!grid) return { found: false };
    const cols = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
    const cards = [...grid.children].filter((c) => c.classList.contains("panel"));
    const tops = cards.map((c) => Math.round(c.getBoundingClientRect().top));
    return { found: true, colCount: cols.length, cardCount: cards.length, firstTwoTopsMatch: cards.length >= 2 && tops[0] === tops[1] };
  });
  info.found
    ? ok(`#/currency at ${w}px: .card-results-grid is present with ${info.cardCount} domain cards`)
    : bad(`#/currency at ${w}px: no .card-results-grid found`);
  if (info.found) {
    info.colCount >= 2
      ? ok(`#/currency at ${w}px: grid-template-columns resolves to ${info.colCount} real columns (not a stacked single column)`)
      : bad(`#/currency at ${w}px: grid-template-columns resolved to only ${info.colCount} column(s), expected >=2`);
    info.firstTwoTopsMatch
      ? ok(`#/currency at ${w}px: the first two domain cards share the same top edge - genuinely the same grid row, not stacked`)
      : bad(`#/currency at ${w}px: the first two domain cards do NOT share a top edge - looks stacked`);
  }
}

await setWidth(375, 812);
const currencyNarrow = await page.evaluate(() => {
  const grid = document.querySelector(".card-results-grid");
  if (!grid) return { found: false };
  const cols = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
  const cards = [...grid.children].filter((c) => c.classList.contains("panel"));
  const tops = cards.map((c) => Math.round(c.getBoundingClientRect().top));
  const allDistinctTops = new Set(tops).size === tops.length;
  return { found: true, colCount: cols.length, allDistinctTops, cardCount: cards.length };
});
currencyNarrow.found && currencyNarrow.colCount === 1
  ? ok(`#/currency at 375px: collapses back to a single real column (${currencyNarrow.colCount})`)
  : bad(`#/currency at 375px: expected exactly 1 column, got: ${JSON.stringify(currencyNarrow)}`);
currencyNarrow.found && currencyNarrow.allDistinctTops
  ? ok("#/currency at 375px: every domain card has a distinct top edge - a clean stacked single column, no regression")
  : bad("#/currency at 375px: cards do not have distinct top edges - not a clean single column: " + JSON.stringify(currencyNarrow));

// Real content spot-check: the Fitness and Money domains this route tracks
// are still both present and still both link to their real routes.
const currencyContent = await page.evaluate(() => {
  const text = document.querySelector(".main").textContent || "";
  const D = window.G && window.G.currency && window.G.currency.DOMAINS;
  return {
    hasFitnessArea: /Fitness tests of record/.test(text),
    hasMoneyArea: /TSP, BRS, VA and GI Bill/.test(text),
    domainCount: Array.isArray(D) ? D.length : -1,
    fitnessLinksToRoute: Array.isArray(D) && !!D.find((d) => d.short === "Fitness" && d.link === "#/fitness"),
  };
});
currencyContent.hasFitnessArea && currencyContent.hasMoneyArea
  ? ok("#/currency: real domain content (Fitness tests of record, Money/TSP/GI Bill) still renders inside the grid, unchanged")
  : bad("#/currency: expected domain text missing: " + JSON.stringify(currencyContent));
currencyContent.fitnessLinksToRoute
  ? ok(`#/currency: DOMAINS still has ${currencyContent.domainCount} real entries and the Fitness card still links to #/fitness`)
  : bad("#/currency: Fitness domain entry missing or no longer links to #/fitness: " + JSON.stringify(currencyContent));

// ============================================================================
// Part 2: #/fitness - the actual fix. Two .panel-grid-2 groups (AFT panels,
// CFT panels) should be real 2-column grids at >=600px, while the ordered
// CFT event walkthrough and the MOS code-wall panel stay full width, and
// everything collapses to a clean single column at 375px.
// ============================================================================
await goto("#/fitness");

for (const w of [1024, 768]) {
  await setWidth(w);
  const info = await page.evaluate(() => {
    const grids = [...document.querySelectorAll(".panel-grid-2")];
    const main = document.querySelector(".main");
    const mainLeft = main.getBoundingClientRect().left;
    const mainWidth = main.getBoundingClientRect().width;
    const gridDetails = grids.map((g) => {
      const cols = getComputedStyle(g).gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
      const kids = [...g.children];
      const tops = kids.map((k) => Math.round(k.getBoundingClientRect().top));
      return { colCount: cols.length, kidCount: kids.length, firstTwoShareRow: kids.length >= 2 && tops[0] === tops[1] };
    });
    // The ordered 7-event CFT panel: find it by its own eyebrow text, and
    // confirm it is NOT a child of any .panel-grid-2 (still full width).
    const evPanel = [...document.querySelectorAll(".main .panel")].find((p) =>
      /Seven events, in this order/.test(p.textContent || ""));
    const evInGrid = evPanel ? !!evPanel.closest(".panel-grid-2") : null;
    const evWidth = evPanel ? Math.round(evPanel.getBoundingClientRect().width) : null;
    // MOS code-wall panel: same check.
    const listsPanel = [...document.querySelectorAll(".main .panel")].find((p) =>
      /Which list are you on/.test(p.textContent || ""));
    const listsInGrid = listsPanel ? !!listsPanel.closest(".panel-grid-2") : null;
    const listsWidth = listsPanel ? Math.round(listsPanel.getBoundingClientRect().width) : null;
    return { gridCount: grids.length, gridDetails, evInGrid, evWidth, listsInGrid, listsWidth, mainWidth };
  });
  info.gridCount === 2
    ? ok(`#/fitness at ${w}px: exactly 2 .panel-grid-2 groups present (AFT panels, CFT panels)`)
    : bad(`#/fitness at ${w}px: expected 2 .panel-grid-2 groups, found ${info.gridCount}`);
  info.gridDetails.forEach((g, i) => {
    g.colCount >= 2
      ? ok(`#/fitness at ${w}px: grid #${i + 1} resolves to ${g.colCount} real columns (not stacked)`)
      : bad(`#/fitness at ${w}px: grid #${i + 1} resolved to only ${g.colCount} column(s)`);
    g.firstTwoShareRow
      ? ok(`#/fitness at ${w}px: grid #${i + 1}'s first two panels share the same top edge - a real shared row`)
      : bad(`#/fitness at ${w}px: grid #${i + 1}'s first two panels do NOT share a top edge`);
  });
  info.evInGrid === false
    ? ok(`#/fitness at ${w}px: the ordered 7-event CFT walkthrough panel is deliberately NOT inside a .panel-grid-2`)
    : bad(`#/fitness at ${w}px: the 7-event panel's grid membership is wrong (evInGrid=${info.evInGrid})`);
  info.listsInGrid === false
    ? ok(`#/fitness at ${w}px: the MOS code-wall panel is deliberately NOT inside a .panel-grid-2`)
    : bad(`#/fitness at ${w}px: the MOS code-wall panel's grid membership is wrong (listsInGrid=${info.listsInGrid})`);
  if (info.evWidth != null && info.mainWidth) {
    (info.evWidth / info.mainWidth) > 0.85
      ? ok(`#/fitness at ${w}px: the 7-event panel is still full width (${info.evWidth}px of ${info.mainWidth}px container)`)
      : bad(`#/fitness at ${w}px: the 7-event panel looks narrowed (${info.evWidth}px of ${info.mainWidth}px container)`);
  }
}

await setWidth(375, 812);
const fitnessNarrow = await page.evaluate(() => {
  const grids = [...document.querySelectorAll(".panel-grid-2")];
  const details = grids.map((g) => {
    const cs = getComputedStyle(g);
    const kids = [...g.children];
    const tops = kids.map((k) => Math.round(k.getBoundingClientRect().top));
    const allDistinctTops = new Set(tops).size === tops.length;
    return { display: cs.display, allDistinctTops, kidCount: kids.length };
  });
  return { gridCount: grids.length, details };
});
fitnessNarrow.gridCount === 2 && fitnessNarrow.details.every((d) => d.display !== "grid")
  ? ok("#/fitness at 375px: both .panel-grid-2 groups fall back to block layout (no grid) below the 600px breakpoint")
  : bad("#/fitness at 375px: expected both groups to NOT be display:grid at 375px: " + JSON.stringify(fitnessNarrow));
fitnessNarrow.details.every((d) => d.allDistinctTops)
  ? ok("#/fitness at 375px: every panel inside both groups has a distinct top edge - a clean stacked single column, no regression")
  : bad("#/fitness at 375px: panels inside a group share a top edge at mobile width - narrow-viewport regression: " + JSON.stringify(fitnessNarrow));

// Real content spot-check: the specific facts this page exists to carry are
// still present and untouched by the layout change - both standards' point
// thresholds, both MOS lists (with real codes), the 7 CFT events in order,
// and the promotion-points button still navigates to the PPW.
const fitnessContent = await page.evaluate(() => {
  const text = document.querySelector(".main").textContent || "";
  const btn = [...document.querySelectorAll(".main button")].find((b) => /Calculate it in the PPW/.test(b.textContent || ""));
  return {
    hasGeneralStandard: /Minimum 60 points per event AND 300 overall/.test(text),
    hasCombatStandard: /Minimum 60 points per event AND 350 overall/.test(text),
    hasAftList: /\b11B\b/.test(text) && /\b18A\b/.test(text),
    // Exact-substring check, not a \bMOS\b regex: adjacent block-level
    // elements' textContent concatenates with no inserted whitespace, so
    // "...same 21, plus 3" (eyebrow) butts straight up against "12D" (the
    // next paragraph) as "...plus 312D" - a pre-existing textContent-
    // concatenation quirk this layout change didn't touch, not a real
    // content regression. The joined-with-double-space substring is the
    // literal output of CFT_EXTRA_MOS.join("  ") and is unambiguous.
    hasCftExtra: text.includes("12D  89D  89E"),
    eventCount: (text.match(/\d\. (?:1-mile run|30 dead-stop push-ups|100-metre sprint|16 sandbag lifts|50-metre water-can carry|50-metre movement drill)/g) || []).length,
    hasButton: !!btn,
  };
});
await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".main button")].find((b) => /Calculate it in the PPW/.test(b.textContent || ""));
  if (btn) btn.click();
});
await page.waitForTimeout(300);
const hashAfterClick = await page.evaluate(() => location.hash);

fitnessContent.hasGeneralStandard && fitnessContent.hasCombatStandard
  ? ok("#/fitness: both AFT point thresholds (300 general / 350 combat) still render inside the grid, unchanged")
  : bad("#/fitness: AFT threshold text missing: " + JSON.stringify(fitnessContent));
fitnessContent.hasAftList && fitnessContent.hasCftExtra
  ? ok("#/fitness: the real MOS code walls (11B/18A on the AFT list, 12D/89D on the CFT-extra list) are still intact")
  : bad("#/fitness: MOS code content missing: " + JSON.stringify(fitnessContent));
// 7 matches, not 6: "1-mile run" is deliberately reused for both event 1
// and event 7 (the module's own header comment: "everything after it is
// done tired" the first time, "where the 30-minute cap is usually lost"
// the second) - so the pattern matches all 7 numbered steps, one of the
// alternatives twice.
fitnessContent.eventCount === 7
  ? ok("#/fitness: all 7 numbered CFT event steps still render in order, unchanged by the layout change")
  : bad(`#/fitness: expected 7 numbered CFT event matches, found ${fitnessContent.eventCount}`);
fitnessContent.hasButton && hashAfterClick === "#/board"
  ? ok("#/fitness: 'Calculate it in the PPW' button (inside the new AFT grid) still navigates to #/board")
  : bad(`#/fitness: PPW button missing or did not navigate (hash after click: ${hashAfterClick})`);

noise.length === 0 ? ok("no console errors/warnings across either route") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `FITNESS/CURRENCY GRID: ${fails} FAILURE(S)` : "FITNESS/CURRENCY GRID: all passed"));
process.exit(fails ? 1 : 0);
