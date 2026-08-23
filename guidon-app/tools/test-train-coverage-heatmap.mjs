/**
 * Tier 4 roadmap: Train catalog's competency × rank-tier coverage heatmap
 * (js/charts.js G.chart.heatmapGrid, mounted in views.train just above the
 * search/tab/chip filter controls - see src/index.html's "Tier 4 roadmap:
 * competency × rank-tier coverage heatmap" comment block in views.train).
 *
 * The roadmap's claim - "junior tiers are covered thinner, invisible today
 * since the catalog only ever filters one tier at a time" - was
 * independently re-verified against the live seed data before this was
 * built (a one-off node script reading window.GUIDON_SEED directly): junior
 * rank tiers do carry meaningfully fewer scenario-tier tags per tier than
 * senior tiers (roughly 19 vs 104 scenario-tags/tier at the time of
 * writing, ~5.4x thinner - the roadmap's own "4x" figure had drifted a bit,
 * but the underlying claim - junior tiers are real, meaningfully thinner,
 * and invisible in a one-tier-at-a-time filtered view - holds).
 *
 * This test:
 *   1. Confirms the panel renders on #/train, above the search/tab/filter
 *      controls, with the right row/column counts and REAL cell values -
 *      computed independently in this test from window.G.store.scenarios(),
 *      the exact same source the app itself reads, so a future drift in the
 *      seed data can't silently go unnoticed behind a hardcoded matrix.
 *   2. Confirms the toggle collapses/reopens the panel.
 *   3. Confirms the existing filter-driven catalog list below still works
 *      unchanged (card cap, tab labels, a real competency-chip filter).
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
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

await page.evaluate(() => { location.hash = "#/train"; });
await page.waitForTimeout(600);

// ── Independently derive the expected matrix from the SAME live data the
// app itself reads (window.G.store.scenarios()), mirroring the app's own
// row/column derivation exactly (fixed competency order; tier columns
// discovered from the real data, naturally sorted) - not a hardcoded
// snapshot that could silently go stale as the seed data changes.
const expected = await page.evaluate(() => {
  const HEATMAP_COMPS = ["Leads", "Develops", "Achieves", "Character", "Presence", "Intellect"];
  const scenarios = window.G.store.scenarios();
  const tierSet = new Set();
  scenarios.forEach((s) => (s.tier || []).forEach((t) => tierSet.add(t)));
  const naturalTierSort = (a, b) => {
    const na = parseInt(String(a).replace(/\D/g, ""), 10);
    const nb = parseInt(String(b).replace(/\D/g, ""), 10);
    if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b));
  };
  const tiers = Array.from(tierSet).sort(naturalTierSort);
  const matrix = HEATMAP_COMPS.map((comp) =>
    tiers.map((t) => scenarios.filter((s) =>
      (s.competency || []).includes(comp) && (s.tier || []).includes(t)
    ).length)
  );
  const titles = [];
  HEATMAP_COMPS.forEach((comp, ri) => {
    tiers.forEach((t, ci) => {
      const v = matrix[ri][ci];
      titles.push(v + " scenario" + (v === 1 ? "" : "s") + " tagged " + comp + " at " + t);
    });
  });
  let coverageNote = "";
  const half = Math.floor(tiers.length / 2);
  if (half >= 1 && tiers.length - half >= 1) {
    const juniorTiers = tiers.slice(0, half), seniorTiers = tiers.slice(half);
    const tagCountFor = (t) => scenarios.filter((s) => (s.tier || []).includes(t)).length;
    const avg = (ts) => ts.reduce((sum, t) => sum + tagCountFor(t), 0) / ts.length;
    const juniorAvg = avg(juniorTiers), seniorAvg = avg(seniorTiers);
    if (juniorAvg > 0 && seniorAvg > juniorAvg) {
      coverageNote = juniorTiers.join("/") + " average " + Math.round(juniorAvg) +
        " scenarios each vs " + seniorTiers.join("/") + "'s " + Math.round(seniorAvg) +
        " — about " + (seniorAvg / juniorAvg).toFixed(1) + "× thinner junior-tier coverage.";
    }
  }
  return {
    comps: HEATMAP_COMPS, tiers, matrix, titles, coverageNote,
    totalScenarios: scenarios.length,
    trainingCount: scenarios.filter((s) => s.defaultMode === "training").length,
    leadsCount: scenarios.filter((s) => (s.competency || []).includes("Leads")).length,
  };
});

expected.tiers.length >= 2 && expected.comps.length === 6
  ? ok("fixture sanity: catalog has " + expected.tiers.length + " real rank tiers (" + expected.tiers.join(",") + ") across all 6 competencies")
  : bad("unexpected fixture shape: " + JSON.stringify({ tiers: expected.tiers, comps: expected.comps }));

// The roadmap's actual claim, re-verified against live data.
expected.coverageNote
  ? ok("re-verified against the live catalog: " + expected.coverageNote)
  : bad("coverage-note computation produced nothing - junior/senior split found no real disparity to report");

// ── Panel renders, above the filter controls, with real row/col/cell data ──
const panel = await page.evaluate(() => {
  const panelEl = document.querySelector(".tr-coverage-panel");
  const svg = document.querySelector(".tr-coverage-heatmap");
  if (!panelEl || !svg) return { found: false };
  const rowLabels = [...svg.querySelectorAll("text")].filter((t) => t.getAttribute("text-anchor") === "end").map((t) => t.textContent);
  const colHeaders = [...svg.querySelectorAll("text")].filter((t) => t.getAttribute("text-anchor") === "middle").map((t) => t.textContent);
  const cellTitles = [...svg.querySelectorAll(".chart-heatmap-cell title")].map((t) => t.textContent);
  const searchInputEl = document.querySelector('input[aria-label="Search scenarios"]');
  return {
    found: true,
    role: svg.getAttribute("role"),
    ariaLabel: svg.getAttribute("aria-label"),
    rowLabels, colHeaders, cellTitles,
    heading: document.querySelector(".tr-coverage-panel h3")?.textContent || "",
    hint: panelEl.querySelector("p.hint")?.textContent || "",
    // DOM order check: the panel must precede the search input, i.e. sit
    // above the filter controls per the roadmap item's placement ask.
    precedesSearch: !!(searchInputEl && (panelEl.compareDocumentPosition(searchInputEl) & Node.DOCUMENT_POSITION_FOLLOWING)),
  };
});

panel.found ? ok("coverage panel (.tr-coverage-panel) and heatmap (.tr-coverage-heatmap) render on #/train")
  : bad(".tr-coverage-panel or .tr-coverage-heatmap not found on #/train");

if (panel.found) {
  panel.precedesSearch
    ? ok("coverage panel sits above the search/filter controls in DOM order")
    : bad("coverage panel does not precede the search input - not positioned above the filter controls");
  panel.role === "img" && panel.ariaLabel === "Scenario catalog coverage by competency and rank tier"
    ? ok("heatmap carries role=img and the expected aria-label")
    : bad("heatmap role/ariaLabel: " + panel.role + " / " + panel.ariaLabel);
  panel.heading === "Catalog coverage: competency × rank tier"
    ? ok("panel heading reads as expected")
    : bad("panel heading: " + JSON.stringify(panel.heading));
  JSON.stringify(panel.rowLabels) === JSON.stringify(expected.comps)
    ? ok("heatmap row labels are the real 6 competencies in canonical order: " + panel.rowLabels.join(", "))
    : bad("row labels: " + JSON.stringify(panel.rowLabels) + " expected " + JSON.stringify(expected.comps));
  JSON.stringify(panel.colHeaders) === JSON.stringify(expected.tiers)
    ? ok("heatmap column headers are the real rank tiers, naturally sorted: " + panel.colHeaders.join(", "))
    : bad("column headers: " + JSON.stringify(panel.colHeaders) + " expected " + JSON.stringify(expected.tiers));
  const cellCountExpected = expected.comps.length * expected.tiers.length;
  panel.cellTitles.length === cellCountExpected
    ? ok("heatmap renders exactly " + cellCountExpected + " cells (" + expected.comps.length + " competencies × " + expected.tiers.length + " tiers)")
    : bad("cell count: " + panel.cellTitles.length + " expected " + cellCountExpected);
  JSON.stringify(panel.cellTitles) === JSON.stringify(expected.titles)
    ? ok("every cell's real scenario count matches what's independently computed from window.G.store.scenarios() - spot check: " + panel.cellTitles.slice(0, 3).join(" | "))
    : bad("cell titles mismatch expected real counts - first few got: " + JSON.stringify(panel.cellTitles.slice(0, 5)) + " expected: " + JSON.stringify(expected.titles.slice(0, 5)));
  (!expected.coverageNote || panel.hint.includes(expected.coverageNote))
    ? ok("panel hint text includes the real, dynamically-computed junior-vs-senior coverage note")
    : bad("panel hint text missing the expected coverage note.\n  got: " + panel.hint + "\n  expected to include: " + expected.coverageNote);
}

// ── Toggle collapses/reopens the panel ──────────────────────────────────
const toggle = page.locator(".tr-coverage-toggle");
const bodyVisibleBefore = await page.evaluate(() => getComputedStyle(document.querySelector(".tr-coverage-body")).display !== "none");
bodyVisibleBefore ? ok("coverage heatmap body is visible by default (not hidden behind an extra click)") : bad("coverage heatmap body is hidden by default");
await toggle.click();
await page.waitForTimeout(150);
const afterHide = await page.evaluate(() => ({
  display: getComputedStyle(document.querySelector(".tr-coverage-body")).display,
  text: document.querySelector(".tr-coverage-toggle").textContent,
  expanded: document.querySelector(".tr-coverage-toggle").getAttribute("aria-expanded"),
}));
afterHide.display === "none" && afterHide.expanded === "false"
  ? ok("clicking the toggle hides the heatmap body and flips aria-expanded to false")
  : bad("state after hiding: " + JSON.stringify(afterHide));
await toggle.click();
await page.waitForTimeout(150);
const afterShow = await page.evaluate(() => ({
  display: getComputedStyle(document.querySelector(".tr-coverage-body")).display,
  expanded: document.querySelector(".tr-coverage-toggle").getAttribute("aria-expanded"),
}));
afterShow.display !== "none" && afterShow.expanded === "true"
  ? ok("clicking the toggle again reopens the heatmap body")
  : bad("state after reopening: " + JSON.stringify(afterShow));

// ── Existing filter-driven catalog list still works, unchanged ─────────
const listState = await page.evaluate(() => ({
  heading: document.querySelector(".section-title h2")?.textContent,
  cardCount: document.querySelectorAll(".grid .card.click").length,
  tabLabels: Array.from(document.querySelectorAll(".tabbar .tab")).map((b) => b.textContent),
}));
listState.heading === "Train" ? ok("Train section heading still renders") : bad("heading: " + listState.heading);
listState.cardCount === Math.min(60, expected.totalScenarios)
  ? ok("scenario grid still renders " + listState.cardCount + " cards under the new panel")
  : bad("card count: " + listState.cardCount);
listState.tabLabels[0] === "All (" + expected.totalScenarios + ")" && listState.tabLabels[1] === "Leadership" && listState.tabLabels[2] === "Mandatory Training"
  ? ok("tab bar still shows the real All/Leadership/Mandatory Training labels")
  : bad("tab labels: " + JSON.stringify(listState.tabLabels));

// Filters toggle (Tier 1(g) disclosure) still opens the real competency chips
// - and, importantly, the coverage panel's OWN toggle (mounted earlier in
// the DOM) doesn't hijack this lookup: see the "aria-expanded"/"ghost"
// class-avoidance comment at this toggle's creation site in src/index.html.
const filtersToggle = page.locator("button", { hasText: /^(Filters|Hide filters)/ });
await filtersToggle.click();
await page.waitForTimeout(150);
await page.locator('[aria-label="Filter by competency"] .search-chip', { hasText: /^Leads$/ }).click();
await page.waitForTimeout(200);
const afterLeadsChip = await page.evaluate(() => document.querySelectorAll(".grid .card.click").length);
afterLeadsChip === Math.min(60, expected.leadsCount)
  ? ok("the 'Leads' competency chip still filters the grid correctly (" + afterLeadsChip + " cards) - unaffected by the new panel above it")
  : bad("card count after Leads chip: " + afterLeadsChip + " expected " + Math.min(60, expected.leadsCount));

noise.length === 0 ? ok("no console errors") : bad("console errors: " + noise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nTRAIN COVERAGE HEATMAP: all passed");
process.exit(fails ? 1 : 0);
