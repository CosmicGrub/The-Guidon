/**
 * Roadmap Tier 4: Progress's 12-week activity heatmap (GitHub-contributions
 * style), sitting ADDITIVE next to the existing 7-day Weekly Activity Trend
 * Chart (Tier 3 batch 1) - not a replacement of it. A single 7-day bar strip
 * structurally cannot show a build-up-then-lapse pattern: it only ever has
 * one week's worth of bars on screen, so a Soldier who trained hard for a
 * couple of weeks, went quiet for a long stretch, then came back looks
 * identical to one who trained lightly-but-steadily, whichever week happens
 * to be "now". getProgress() now also returns `last12Weeks` (same real-
 * calendar-time-filter shape as the pre-existing `last7Days`, just widened),
 * and renderActivityHeatmap() renders it as a real Sun-Sat-aligned calendar
 * grid (7 weekday rows x 12 week columns) via the shared G.chart.heatmapGrid
 * primitive.
 *
 * This test seeds a deterministic build-up -> (8-week lapse) -> comeback
 * dataset directly against the "attempts" store (db.putMany(), bypassing
 * recordAttempt()'s forced Date.now() stamp - the same direct-DB seeding
 * shape test-attempts-retention-cap.mjs uses - since real historical
 * timestamps are the whole point here), landing every seeded day in
 * columns 0, 1 and 10 of the grid (columns 2-9 deliberately untouched, a
 * genuine multi-week silent stretch) plus one attempt "today". It then:
 *
 *   1. Independently recomputes the full expected 7x12 grid (value + tooltip
 *      per cell) straight from the seeded rows' own timestamps - a fresh
 *      implementation, not a call into the app's own render code - and
 *      diffs it cell-by-cell against the real rendered SVG's 84 <rect>s.
 *   2. Confirms the deliberately-untouched columns read a real "0 attempts"
 *      per day (a genuine past day with no activity), not "no data" -
 *      proving the lapse is visible as an actual gap, not just missing test
 *      data understood.
 *   3. Confirms the panel heading/hint/ariaLabel total, active-day and
 *      longest-lapse numbers match what was independently computed.
 *   4. Confirms the pre-existing 7-day trend chart and the glance-strip both
 *      still render structurally correct (7 day-columns / 5-or-fewer tiles
 *      present) - the two elements this change was told NOT to touch.
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

// ── Seed a deterministic build-up -> lapse -> comeback dataset, then
//    independently compute the full expected grid from those same raw
//    timestamps. All in one page.evaluate() so seeding and expectation both
//    share the exact same Date/timezone reference. ─────────────────────────
const seeded = await page.evaluate(async () => {
  const store = window.G.store, db = window.G.db;
  await store.resetProgress();

  const DAY = 86400000, WEEKS = 12;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const currentWeekStart = new Date(todayMs - today.getDay() * DAY);
  const gridStart = new Date(currentWeekStart.getTime() - (WEEKS - 1) * 7 * DAY);

  // Build-up (grid's two oldest weeks) + comeback (grid's 11th week, i.e.
  // column 10 - the week just before the current one). Columns 2-9 are
  // deliberately left untouched: a real 8-calendar-week (56-day) silent
  // stretch a 7-day window could never reveal. "Today" itself (current
  // week, column 11) is deliberately NOT in this direct-DB batch - see the
  // real store.recordAttempt() call just below for why.
  const seedPlan = [
    { r: 1, c: 0, count: 1 }, { r: 3, c: 0, count: 2 }, { r: 5, c: 0, count: 3 },
    { r: 0, c: 1, count: 2 }, { r: 2, c: 1, count: 4 }, { r: 4, c: 1, count: 1 },
    { r: 1, c: 10, count: 3 }, { r: 3, c: 10, count: 1 }, { r: 5, c: 10, count: 2 },
  ];

  const rows = [];
  let n = 0;
  seedPlan.forEach((p) => {
    const cellDate = new Date(gridStart.getTime() + (p.c * 7 + p.r) * DAY);
    for (let i = 0; i < p.count; i++) {
      rows.push({
        id: "hm-seed-" + (n++),
        scenarioId: "qa-heatmap-test",
        title: "QA heatmap test",
        mode: "text",
        score: { Leads: 1, Develops: 0, Achieves: 0, Character: 0, Presence: 0, Intellect: 0 },
        total: 1,
        ts: cellDate.getTime() + 12 * 3600000, // noon that day - safely inside it either way
      });
    }
  });
  await db.putMany("attempts", rows);

  // The "today" data point goes through the REAL store.recordAttempt() path
  // instead of another direct db.putMany() row, for two reasons: (1) it
  // naturally stamps real Date.now(), landing in today's own grid cell
  // (row = today's real weekday, column 11) without this test needing to
  // duplicate that arithmetic a third time, and (2) - the reason this
  // can't just be one more putMany() row - db.putMany() writes straight to
  // IndexedDB and does NOT bump state._progressCache the way every real
  // write path does (recordAttempt(), resetProgress()); the 5s TTL cache
  // that resetProgress() nulled up top can otherwise get silently
  // repopulated in between (e.g. by some other view's own "progress:change"
  // listener re-rendering and calling getProgress() while the putMany batch
  // above is still landing), and getProgress() below would then hand back
  // that stale cached read instead of rescanning. recordAttempt() nulls the
  // cache as its own last step, so the getProgress() call right after it is
  // guaranteed fresh.
  const todayAttempt = await store.recordAttempt({
    scenarioId: "qa-heatmap-test-today", title: "QA heatmap test (today)", mode: "text",
    score: { Leads: 1, Develops: 0, Achieves: 0, Character: 0, Presence: 0, Intellect: 0 },
    total: 1,
  });
  // recordAttempt() stamps its own real `id`/`ts` and returns the saved row -
  // fold it into the same `rows` list so seededCount/countByDay below cover
  // all 10 seeded attempts (9 direct-DB + this 1 real-path one), not just 9.
  rows.push(todayAttempt);

  const p = await store.getProgress();

  // Independent recomputation of the full 7x12 grid straight from the
  // seeded rows' own `ts` values (fresh Map/loop, not a call into
  // renderActivityHeatmap or G.chart.heatmapGrid).
  const countByDay = new Map();
  rows.forEach((a) => {
    const key = new Date(a.ts).toDateString();
    countByDay.set(key, (countByDay.get(key) || 0) + 1);
  });
  // Pass 1: row-major (r outer, c inner) - matches heatmapGrid's own <rect>
  // draw order exactly (see charts.js: `for r ... for c ... draw rect`), so
  // flatExpected[i] lines up 1:1 with the DOM's Nth <rect>.
  const flatExpected = [];
  let expectedTotal = 0, expectedActiveDays = 0, expectedPastDays = 0;
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < WEEKS; c++) {
      const d = new Date(gridStart.getTime() + (c * 7 + r) * DAY);
      if (d.getTime() > todayMs) { flatExpected.push(null); continue; }
      expectedPastDays++;
      const count = countByDay.get(d.toDateString()) || 0;
      flatExpected.push(count);
      expectedTotal += count;
      if (count > 0) expectedActiveDays++;
    }
  }

  // Pass 2: column-major (c outer, r inner) - real chronological day order
  // (each column is one week block moving forward in time; within a column,
  // r=0..6 walks Sun->Sat forward too), matching renderActivityHeatmap's OWN
  // loop order exactly - needed so "longest idle stretch" means the same
  // thing here as it does in the app itself, not an artifact of this test's
  // unrelated row-major DOM-comparison order above.
  let longestGap = 0, curGap = 0;
  for (let c = 0; c < WEEKS; c++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(gridStart.getTime() + (c * 7 + r) * DAY);
      if (d.getTime() > todayMs) continue; // future cells don't participate in the streak
      const count = countByDay.get(d.toDateString()) || 0;
      if (count > 0) curGap = 0; else { curGap++; if (curGap > longestGap) longestGap = curGap; }
    }
  }

  return {
    seededCount: rows.length,
    totalAttempts: p.totalAttempts,
    last12WeeksLen: p.last12Weeks.length,
    flatExpected, expectedTotal, expectedActiveDays, expectedPastDays, longestGap,
  };
});

seeded.seededCount === 20
  ? ok("seeded 20 deterministic attempts across a build-up/lapse/comeback timeline")
  : bad("expected 20 seeded rows, got " + seeded.seededCount);
seeded.totalAttempts === seeded.seededCount
  ? ok("getProgress().totalAttempts reflects all " + seeded.seededCount + " seeded attempts")
  : bad("totalAttempts: expected " + seeded.seededCount + ", got " + seeded.totalAttempts);
seeded.last12WeeksLen === seeded.seededCount
  ? ok("getProgress().last12Weeks carries all " + seeded.seededCount + " attempts (none evicted/undercounted)")
  : bad("last12Weeks.length: expected " + seeded.seededCount + ", got " + seeded.last12WeeksLen);
seeded.expectedTotal === seeded.seededCount
  ? ok("independently-recomputed grid total (" + seeded.expectedTotal + ") matches seeded count")
  : bad("independently-recomputed grid total: expected " + seeded.seededCount + ", got " + seeded.expectedTotal);
// Deterministic regardless of which real weekday "today" is: the seed plan's
// longest chronological zero-run always runs from column 1 row 6 through
// column 10 row 0 inclusive - 2 (rest of c1) + 56 (columns 2-9, 8 full
// weeks) + 1 (c10r0) = 59 days - and every other gap in the plan (each <= 7
// days, bounded by "today"'s position in its own partial week at most)
// is well short of that, so this can assert an exact number, not a bound.
seeded.longestGap === 59
  ? ok("independently-recomputed longest idle stretch is exactly 59 days - the deliberate multi-week lapse")
  : bad("expected the longest idle stretch to be exactly 59 days, got " + seeded.longestGap);

// ── Visit Progress and read the rendered heatmap + adjacent elements. ──────
await page.evaluate(() => { location.hash = "#/progress"; });
await page.waitForTimeout(700);

const dom = await page.evaluate(() => {
  const panels = [...document.querySelectorAll(".panel")];
  const heatPanel = panels.find((p) => {
    const h3 = p.querySelector("h3");
    return h3 && /across the last 12 weeks/.test(h3.textContent);
  });
  const svg = heatPanel ? heatPanel.querySelector(".chart-heatmap-svg") : null;
  const rects = svg ? [...svg.querySelectorAll("rect")] : [];
  return {
    heatPanelPresent: !!heatPanel,
    heading: heatPanel ? heatPanel.querySelector("h3").textContent : null,
    hint: heatPanel ? ((heatPanel.querySelector("p.hint") || {}).textContent || null) : null,
    ariaLabel: svg ? svg.getAttribute("aria-label") : null,
    rectCount: rects.length,
    titles: rects.map((r) => { const t = r.querySelector("title"); return t ? t.textContent : null; }),
    // Adjacent, NOT-supposed-to-change elements:
    trendChartPresent: !!document.querySelector(".trend-chart"),
    trendColCount: document.querySelectorAll(".trend-chart .trend-col").length,
    trendHeading: (() => { const h3s = [...document.querySelectorAll(".panel h3")]; const h = h3s.find((x) => /sessions? in the last 7 days/.test(x.textContent)); return h ? h.textContent : null; })(),
    glanceDashPresent: !!document.querySelector('.readiness-dash[aria-label="Progress at a glance"]'),
    glanceTileCount: document.querySelectorAll('.readiness-dash[aria-label="Progress at a glance"] .readiness-tile').length,
    radarPresent: !!document.querySelector(".chart-radar-svg"),
  };
});

dom.heatPanelPresent ? ok("the 12-week activity heatmap panel renders on Progress") : bad("no heatmap panel found (heading matching /across the last 12 weeks/)");

const expectHeading = seeded.expectedTotal + " session" + (seeded.expectedTotal !== 1 ? "s" : "") + " across the last 12 weeks";
dom.heading === expectHeading
  ? ok('heatmap heading reads "' + dom.heading + '"')
  : bad('heatmap heading: expected "' + expectHeading + '", got ' + JSON.stringify(dom.heading));

const expectHint = seeded.expectedActiveDays + " active day" + (seeded.expectedActiveDays !== 1 ? "s" : "") +
  " of " + seeded.expectedPastDays + " · longest lapse " + seeded.longestGap + " day" + (seeded.longestGap !== 1 ? "s" : "") +
  " — build-up and lapse patterns a 7-day window can't show.";
dom.hint === expectHint
  ? ok('heatmap hint reads "' + dom.hint + '"')
  : bad('heatmap hint: expected "' + expectHint + '", got ' + JSON.stringify(dom.hint));

const expectAria = "12-week activity heatmap: " + seeded.expectedTotal + " total attempts across " +
  seeded.expectedActiveDays + " active days out of " + seeded.expectedPastDays;
dom.ariaLabel === expectAria
  ? ok("heatmap svg aria-label matches independently-computed totals")
  : bad("aria-label: expected " + JSON.stringify(expectAria) + ", got " + JSON.stringify(dom.ariaLabel));

dom.rectCount === 84
  ? ok("heatmap renders exactly 84 cells (7 weekday rows x 12 week columns)")
  : bad("expected 84 <rect> cells, got " + dom.rectCount);

// ── Cell-by-cell diff: every one of the 84 rendered cells against the
//    independently-recomputed expected grid. ───────────────────────────────
let cellMismatches = 0;
if (dom.rectCount === seeded.flatExpected.length) {
  for (let i = 0; i < dom.rectCount; i++) {
    const expected = seeded.flatExpected[i];
    const title = dom.titles[i] || "";
    if (expected === null) {
      if (!/^Upcoming/.test(title)) { cellMismatches++; if (cellMismatches <= 5) bad("cell " + i + ": expected 'Upcoming' (future), got " + JSON.stringify(title)); }
    } else {
      const re = new RegExp("^" + expected + "\\s+attempt");
      if (!re.test(title)) { cellMismatches++; if (cellMismatches <= 5) bad("cell " + i + ": expected " + expected + " attempt(s), got " + JSON.stringify(title)); }
    }
  }
}
cellMismatches === 0
  ? ok("all 84 rendered cell tooltips match the independently-computed expected grid exactly")
  : bad(cellMismatches + " of 84 rendered cells mismatched the expected grid");

// ── The deliberate lapse is visible as real zero-count days, not "no data". ─
// Columns 2-9, every row: all real past days (well before "today"), all
// genuinely untouched by the seed plan above.
let lapseCellsChecked = 0, lapseCellsWrong = 0;
for (let r = 0; r < 7; r++) {
  for (let c = 2; c <= 9; c++) {
    const idx = r * 12 + c;
    const expected = seeded.flatExpected[idx];
    if (expected === null) continue; // shouldn't happen for these columns, but be defensive
    lapseCellsChecked++;
    if (expected !== 0 || !/^0\s+attempt/.test(dom.titles[idx] || "")) lapseCellsWrong++;
  }
}
(lapseCellsChecked >= 50 && lapseCellsWrong === 0)
  ? ok("all " + lapseCellsChecked + " lapse-week cells (columns 2-9) read a real '0 attempts', not 'no data' — the lapse is genuinely visible")
  : bad("lapse-week cells: checked " + lapseCellsChecked + ", " + lapseCellsWrong + " did not read a real zero-attempt day");

// ── Adjacent Progress-panel elements this change must NOT break. ───────────
dom.trendChartPresent && dom.trendColCount === 7
  ? ok("the pre-existing 7-day trend chart (.trend-chart, 7 .trend-col bars) still renders untouched")
  : bad("7-day trend chart missing or malformed: present=" + dom.trendChartPresent + " cols=" + dom.trendColCount);
dom.trendHeading
  ? ok('trend chart heading still present: "' + dom.trendHeading + '"')
  : bad("trend chart's 'N sessions in the last 7 days' heading not found");
dom.glanceDashPresent && dom.glanceTileCount > 0
  ? ok("the pre-existing glance-strip (.readiness-dash) still renders with " + dom.glanceTileCount + " tile(s)")
  : bad("glance-strip missing or empty: present=" + dom.glanceDashPresent + " tiles=" + dom.glanceTileCount);
dom.radarPresent
  ? ok("the LRM radar chart still renders untouched")
  : bad("LRM radar chart (.chart-radar-svg) not found");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nPROGRESS ACTIVITY HEATMAP: all passed");
process.exit(fails ? 1 : 0);
