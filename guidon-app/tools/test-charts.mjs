/**
 * Roadmap Tier 4 (foundational item): shared inline-SVG chart primitives —
 * G.chart.radar / G.chart.heatmapGrid / G.chart.densityTimeline (js/charts.js).
 *
 * Two things this test exists to prove:
 *
 *   1. Progress's radar MIGRATION is a real no-visual-change swap: the old
 *      bespoke radarChart() SVG builder is gone, Progress's render path now
 *      goes through the shared G.chart.radar() primitive, and the rendered
 *      chart on the real #/progress route still has 6 axes with real
 *      computed percentage values (not zeroed out, not double-counted).
 *
 *   2. The two primitives with no existing consumer yet — HEATMAP-GRID and
 *      DENSITY-TIMELINE — are exercised directly with real-shaped data (a
 *      93-row x 5-col grid like Board Drill's actual category count, a
 *      90-day timeline like Reminders' actual window, an 8-axis radar to
 *      prove the axis count generalizes past the old hardcoded 6) and the
 *      real rendered SVG structure is asserted: right number of
 *      cells/points/bars, colors driven by the real data values (not
 *      hardcoded — a bar's fill literally depends on whether its value is
 *      zero/highest/neither), labels present, and theme-color values
 *      actually differ between a light-theme and a dark-theme render of the
 *      exact same DOM nodes (CSS custom properties resolved live, not baked
 *      in at render time).
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
await page.waitForTimeout(400);

// ── Part 1: Progress's radar migration ──────────────────────────────────
// Record one deterministic, unbalanced attempt so every one of the 6 LRM
// axes has a real, distinguishable, non-zero percentage — a genuine
// regression here (e.g. all-zero axes, or only 5 of 6 axes rendering)
// would otherwise hide behind an all-zero baseline chart.
await page.evaluate(async () => {
  await window.G.store.recordAttempt({
    scenarioId: "qa-chart-migration-test",
    title: "QA chart migration test",
    mode: "text",
    score: { Leads: 8, Develops: 4, Achieves: 2, Character: 6, Presence: 3, Intellect: 5 },
    total: 28,
  });
});
await page.evaluate(() => { location.hash = "#/progress"; });
await page.waitForTimeout(500);

const radarInfo = await page.evaluate(() => {
  const old = document.querySelector(".lrm-radar-svg");
  const svg = document.querySelector(".chart-radar-svg");
  if (!svg) return { found: false, oldClassPresent: !!old };
  return {
    found: true,
    oldClassPresent: !!old,
    role: svg.getAttribute("role"),
    ariaLabel: svg.getAttribute("aria-label"),
    dots: svg.querySelectorAll("circle").length,
    labelTexts: [...svg.querySelectorAll("text")].map((t) => t.textContent),
  };
});

radarInfo.found
  ? ok("Progress renders the migrated .chart-radar-svg (shared RADAR primitive)")
  : bad("Progress did not render a .chart-radar-svg at #/progress");
!radarInfo.oldClassPresent
  ? ok("old .lrm-radar-svg class is gone — single radar implementation, no leftover")
  : bad("old .lrm-radar-svg class is still present alongside the new one");
if (radarInfo.found) {
  radarInfo.role === "img"
    ? ok("migrated radar carries role=\"img\"")
    : bad("migrated radar role attribute: " + radarInfo.role);
  radarInfo.ariaLabel && /six dimensions/i.test(radarInfo.ariaLabel)
    ? ok("migrated radar aria-label unchanged: \"" + radarInfo.ariaLabel + "\"")
    : bad("migrated radar aria-label: " + radarInfo.ariaLabel);
  radarInfo.dots === 6
    ? ok("migrated radar still renders exactly 6 vertex dots (6 LRM axes)")
    : bad("migrated radar vertex dot count: expected 6, got " + radarInfo.dots);
  const hasRealPct = radarInfo.labelTexts.some((t) => /\(\d{1,3}%\)/.test(t) && !/\(0%\)/.test(t));
  hasRealPct
    ? ok("migrated radar shows at least one real non-zero axis percentage")
    : bad("migrated radar axis labels show no non-zero percentage: " + JSON.stringify(radarInfo.labelTexts));
}

// ── Part 2: the three primitives called directly, real-shaped data ──────
const direct = await page.evaluate(() => {
  const out = {};
  const mount = document.createElement("div");
  mount.id = "qa-chart-mount";
  document.body.appendChild(mount);

  // 2a. RADAR — 8 axes (past the old hardcoded-6 shape), mixed per-axis max.
  const radarCfg = {
    axes: [
      { label: "Tactics", value: 70 }, { label: "Doctrine", value: 40 },
      { label: "Fitness", value: 90 }, { label: "Comms", value: 55 },
      { label: "Land Nav", value: 30 }, { label: "First Aid", value: 65 },
      { label: "Marksmanship", value: 8, max: 10 }, { label: "Leadership", value: 85 },
    ],
    ariaLabel: "QA 8-axis radar",
  };
  const radarNode = window.G.chart.radar(radarCfg);
  mount.appendChild(radarNode);
  const radarSvg = radarNode.querySelector("svg");
  out.radar = {
    points: radarSvg.querySelectorAll("circle").length,
    texts: radarSvg.querySelectorAll("text").length,
    role: radarSvg.getAttribute("role"),
    ariaLabel: radarSvg.getAttribute("aria-label"),
    // marksmanship axis: value 8 / max 10 -> should read 80%, NOT 8%
    marksmanshipLabel: [...radarSvg.querySelectorAll("text")].map((t) => t.textContent).find((t) => /Marksmanship/.test(t)),
  };

  // 2b. HEATMAP-GRID — 93 rows x 5 cols, like Board Drill's real category
  // count x an SRS-bucket-style column set. Values span the full range so
  // the color-scale assertions below have real low/mid/high cells to check.
  const ROWS = Array.from({ length: 93 }, (_, i) => "Category " + (i + 1));
  const COLS = ["New", "Learning", "Young", "Mature", "Mastered"];
  const values = ROWS.map((_, r) => COLS.map((_, c) => (r + c) % 11)); // 0..10 spread, deterministic
  const heatNode = window.G.chart.heatmapGrid({
    rows: ROWS, cols: COLS, values, min: 0, max: 10,
    ariaLabel: "QA 93x5 heatmap",
  });
  mount.appendChild(heatNode);
  const heatSvg = heatNode.querySelector("svg");
  const cells = [...heatSvg.querySelectorAll(".chart-heatmap-cell")];
  out.heatmap = {
    wrapClass: heatNode.className,
    cellCount: cells.length,
    rowLabelCount: heatSvg.querySelectorAll("text").length - COLS.length, // total texts minus col headers
    role: heatSvg.getAttribute("role"),
    ariaLabel: heatSvg.getAttribute("aria-label"),
    // a zero-value cell (r=0,c=0 -> (0+0)%11=0) should be visibly dimmer
    // than a max-value cell (r=0,c=10%... find one with value 10)
    minOpacity: parseFloat(cells[0].getAttribute("fill-opacity")),
    maxOpacity: Math.max(...cells.map((c) => parseFloat(c.getAttribute("fill-opacity")))),
  };

  // 2c. DENSITY-TIMELINE — 90 days, like Reminders' real window. Day 0 and
  // day 45 are zero: everything else ramps up so the highlight/empty color
  // assertions below have real distinguishing data to check.
  const days = Array.from({ length: 90 }, (_, i) => ({
    date: "day-" + i, label: "D" + i,
    value: i === 0 || i === 45 ? 0 : (i % 7) + 1,
  }));
  const densNode = window.G.chart.densityTimeline({ days, ariaLabel: "QA 90-day density timeline" });
  mount.appendChild(densNode);
  const densSvg = densNode.querySelector("svg");
  const bars = [...densSvg.querySelectorAll(".cdt-bar")];
  out.density = {
    barCount: bars.length,
    role: densSvg.getAttribute("role"),
    ariaLabel: densSvg.getAttribute("aria-label"),
    firstBarFill: bars[0].getAttribute("fill"),       // value 0 -> emptyColor
    lastBarFill: bars[bars.length - 1].getAttribute("fill"), // last bucket -> highlightColor
    midBarFill: bars[10].getAttribute("fill"),         // real non-zero, non-last -> accentColor
  };

  return out;
});

// RADAR assertions
direct.radar.points === 8 ? ok("direct RADAR call: 8 vertex dots for 8 axes (past the old hardcoded-6 shape)")
  : bad("direct RADAR call: expected 8 vertex dots, got " + direct.radar.points);
direct.radar.role === "img" && direct.radar.ariaLabel === "QA 8-axis radar"
  ? ok("direct RADAR call: role=img + caller-supplied aria-label honored")
  : bad("direct RADAR call: role=" + direct.radar.role + " ariaLabel=" + direct.radar.ariaLabel);
direct.radar.marksmanshipLabel && /\(80%\)/.test(direct.radar.marksmanshipLabel)
  ? ok("direct RADAR call: per-axis max honored (8/10 -> 80%, not 8%): \"" + direct.radar.marksmanshipLabel + "\"")
  : bad("direct RADAR call: per-axis max not honored: " + direct.radar.marksmanshipLabel);

// HEATMAP-GRID assertions
direct.heatmap.cellCount === 93 * 5
  ? ok("direct HEATMAP-GRID call: " + direct.heatmap.cellCount + " cells for 93 rows x 5 cols")
  : bad("direct HEATMAP-GRID call: expected 465 cells, got " + direct.heatmap.cellCount);
direct.heatmap.rowLabelCount === 93
  ? ok("direct HEATMAP-GRID call: 93 row labels rendered")
  : bad("direct HEATMAP-GRID call: expected 93 row labels, got " + direct.heatmap.rowLabelCount);
/chart-heatmap-wrap/.test(direct.heatmap.wrapClass)
  ? ok("direct HEATMAP-GRID call: wrapper carries .chart-heatmap-wrap (the scroll boundary)")
  : bad("direct HEATMAP-GRID call: wrapper class missing chart-heatmap-wrap: " + direct.heatmap.wrapClass);
direct.heatmap.role === "img" && direct.heatmap.ariaLabel === "QA 93x5 heatmap"
  ? ok("direct HEATMAP-GRID call: role=img + caller-supplied aria-label honored")
  : bad("direct HEATMAP-GRID call: role=" + direct.heatmap.role + " ariaLabel=" + direct.heatmap.ariaLabel);
direct.heatmap.maxOpacity > direct.heatmap.minOpacity
  ? ok("direct HEATMAP-GRID call: cell fill-opacity genuinely driven by data (min=" + direct.heatmap.minOpacity + ", max=" + direct.heatmap.maxOpacity + ")")
  : bad("direct HEATMAP-GRID call: cell opacity does not vary with data (min=" + direct.heatmap.minOpacity + ", max=" + direct.heatmap.maxOpacity + ")");

// DENSITY-TIMELINE assertions
direct.density.barCount === 90
  ? ok("direct DENSITY-TIMELINE call: 90 bars for a 90-day window")
  : bad("direct DENSITY-TIMELINE call: expected 90 bars, got " + direct.density.barCount);
direct.density.role === "img" && direct.density.ariaLabel === "QA 90-day density timeline"
  ? ok("direct DENSITY-TIMELINE call: role=img + caller-supplied aria-label honored")
  : bad("direct DENSITY-TIMELINE call: role=" + direct.density.role + " ariaLabel=" + direct.density.ariaLabel);
direct.density.firstBarFill === "var(--text-dim)"
  ? ok("direct DENSITY-TIMELINE call: zero-value day uses the dimmed empty color")
  : bad("direct DENSITY-TIMELINE call: zero-value day fill: " + direct.density.firstBarFill);
direct.density.lastBarFill === "var(--amber)"
  ? ok("direct DENSITY-TIMELINE call: last (\"today\") bucket highlighted var(--amber)")
  : bad("direct DENSITY-TIMELINE call: last bucket fill: " + direct.density.lastBarFill);
direct.density.midBarFill === "var(--cyan)"
  ? ok("direct DENSITY-TIMELINE call: a real non-zero, non-last day uses the base accent color")
  : bad("direct DENSITY-TIMELINE call: mid bar fill: " + direct.density.midBarFill);

// ── Part 3: theme-awareness — same rendered nodes, colors actually change ─
// Named palette themes carry their own `html[data-theme="…"]` custom-
// property block, which is what's actually live on a real session (this
// app applies a specific theme id, not just the plain html.light toggle
// class in isolation) — so the real "does the color change" check has to
// swap data-theme itself, same as this app's own theme switcher does
// (see G.theme.applyTheme / the bootstrap snippet at the top of <html>:
// both set data-theme AND toggle the .light class together). Two theme
// ids confirmed to exist and sit on opposite sides of dark/light (from the
// THEMES registry in js/theme.js): "night-vision" (dark) and "ink-paper"
// (light, high-contrast).
async function readColors() {
  return page.evaluate(() => {
    const cell = document.querySelector("#qa-chart-mount .chart-heatmap-cell");
    const bar = document.querySelector("#qa-chart-mount .cdt-bar");
    const dot = document.querySelector("#qa-chart-mount svg circle");
    return {
      cellFill: getComputedStyle(cell).fill,
      barFill: getComputedStyle(bar).fill,
      dotFill: dot ? getComputedStyle(dot).fill : null,
    };
  });
}
async function setTheme(id, light) {
  await page.evaluate(({ id, light }) => {
    document.documentElement.setAttribute("data-theme", id);
    document.documentElement.classList.toggle("light", light);
  }, { id, light });
  await page.waitForTimeout(150);
}

await setTheme("night-vision", false);
const beforeTheme = await readColors();
await setTheme("ink-paper", true);
const afterTheme = await readColors();

beforeTheme.cellFill !== afterTheme.cellFill
  ? ok("HEATMAP-GRID cell color actually changes between dark/light theme (" + beforeTheme.cellFill + " -> " + afterTheme.cellFill + ")")
  : bad("HEATMAP-GRID cell color identical across themes (" + beforeTheme.cellFill + ") — likely hardcoded, not CSS-var-driven");
beforeTheme.dotFill !== afterTheme.dotFill
  ? ok("RADAR vertex-dot color actually changes between dark/light theme (" + beforeTheme.dotFill + " -> " + afterTheme.dotFill + ")")
  : bad("RADAR vertex-dot color identical across themes (" + beforeTheme.dotFill + ") — likely hardcoded, not CSS-var-driven");
// DENSITY-TIMELINE's mid bar uses var(--cyan) same as the radar dot's
// accent, but confirmed independently in case a future change diverges them.
beforeTheme.barFill !== afterTheme.barFill
  ? ok("DENSITY-TIMELINE bar color actually changes between dark/light theme (" + beforeTheme.barFill + " -> " + afterTheme.barFill + ")")
  : bad("DENSITY-TIMELINE bar color identical across themes (" + beforeTheme.barFill + ") — likely hardcoded, not CSS-var-driven");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSHARED CHART PRIMITIVES: all passed");
process.exit(fails ? 1 : 0);
