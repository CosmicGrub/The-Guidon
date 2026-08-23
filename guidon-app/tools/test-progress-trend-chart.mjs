/**
 * Roadmap Tier 3: Progress's weekly trend chart (and the "N-day streak" it
 * derives) used to bucket `p.recent` - a 6-item cap sized for the "Recent
 * After-Action Reviews" DISPLAY list further down the same page, sorted by
 * recency across ALL of history, not scoped to any window. Any week with
 * more than 6 completed scenarios silently undercounted: the 7th-most-recent
 * attempt (and older) fell outside that top-6-by-recency slice even though
 * its timestamp was still inside the last 7 days, so the chart's bars - and
 * the "Today" bucket specifically, and the streak's day-count - read low.
 *
 * getProgress() now also returns `last7Days`, queried directly from the full
 * `attempts` array by real calendar time (an 8-day cutoff, one day of buffer
 * for the chart's own exact-day bucketing) rather than sliced by count, and
 * the trend chart/streak render off that instead. `recent` (still capped at
 * 6) is left untouched for the Recent-AARs list, which legitimately wants a
 * small display cap.
 *
 * This test records 9 attempts (more than the old 6-item cap) in the same
 * instant via the real G.store API (test-progress-cache.mjs's direct-API
 * pattern) and confirms:
 *   1. getProgress().last7Days reflects the true count, not capped at 6.
 *   2. getProgress().recent is still capped at 6 (unchanged, deliberate).
 *   3. The rendered Progress screen's trend chart shows the true 9-session
 *      count and "Today" bar height, not the old undercounted number.
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

// Baseline: fresh guest session, so this should be a clean slate.
const baseline = await page.evaluate(async () => window.G.store.getProgress());
baseline && typeof baseline.totalAttempts === "number"
  ? ok("getProgress() returns a real baseline result (totalAttempts=" + baseline.totalAttempts + ")")
  : bad("getProgress() baseline: " + JSON.stringify(baseline));
Array.isArray(baseline.last7Days)
  ? ok("getProgress() result includes a last7Days array")
  : bad("getProgress() result missing last7Days: " + JSON.stringify(Object.keys(baseline || {})));

// Record 9 attempts back-to-back (well over the old 6-item p.recent cap),
// all "now" - i.e. all genuinely inside the last 7 days/today's bucket.
const ATTEMPT_COUNT = 9;
const afterRecording = await page.evaluate(async (n) => {
  for (let i = 0; i < n; i++) {
    await window.G.store.recordAttempt({
      scenarioId: "qa-trend-chart-test-" + i,
      title: "QA trend chart test " + i,
      mode: "text",
      score: { Leads: 5, Develops: 0, Achieves: 0, Character: 0, Presence: 0, Intellect: 0 },
      total: 5,
    });
  }
  return window.G.store.getProgress();
}, ATTEMPT_COUNT);

afterRecording.totalAttempts === baseline.totalAttempts + ATTEMPT_COUNT
  ? ok("totalAttempts reflects all " + ATTEMPT_COUNT + " recorded attempts (" + afterRecording.totalAttempts + ")")
  : bad("totalAttempts after recording " + ATTEMPT_COUNT + " attempts: " + afterRecording.totalAttempts);

// The core regression check: last7Days must NOT be capped at 6 - it should
// carry every one of today's attempts (plus whatever pre-existed, but the
// fresh guest session means that's just baseline.last7Days.length, 0 here).
const expectedLast7 = baseline.last7Days.length + ATTEMPT_COUNT;
afterRecording.last7Days.length === expectedLast7
  ? ok("last7Days carries all " + expectedLast7 + " attempts inside the window, not capped at 6 (" + afterRecording.last7Days.length + ")")
  : bad("last7Days.length: expected " + expectedLast7 + ", got " + afterRecording.last7Days.length + " - the trend-chart data source is still capped");

// recent must remain capped at 6 - that's a deliberate, unrelated display
// cap for the Recent-AARs list and should NOT change as part of this fix.
afterRecording.recent.length === 6
  ? ok("recent (Recent-AARs display list) is still capped at 6, unaffected by this fix")
  : bad("recent.length: expected 6 (unchanged display cap), got " + afterRecording.recent.length);

// Now confirm the actual rendered Progress screen agrees - navigate there
// and read the trend panel's own heading/bar, not just the raw API result.
await page.evaluate(() => { location.hash = "#/progress"; });
await page.waitForTimeout(500);

const pageText = await page.evaluate(() => document.body.innerText);
const sessionMatch = pageText.match(/(\d+)\s+sessions? in the last 7 days/i);
if (sessionMatch) {
  const rendered = Number(sessionMatch[1]);
  rendered >= ATTEMPT_COUNT
    ? ok("rendered trend-chart heading shows " + rendered + " sessions in the last 7 days (>= " + ATTEMPT_COUNT + " recorded, not capped at 6)")
    : bad("rendered trend-chart heading shows only " + rendered + " sessions - expected at least " + ATTEMPT_COUNT);
} else {
  bad("could not find the trend chart's 'N sessions in the last 7 days' heading on the rendered Progress screen");
}

// The "Today" bar (rightmost column, index 6) should reflect all of today's
// attempts via its tooltip title, not the old undercounted number.
const todayBarTitle = await page.evaluate(() => {
  const cols = document.querySelectorAll(".trend-chart .trend-col");
  if (!cols.length) return null;
  const last = cols[cols.length - 1];
  const bar = last.querySelector(".trend-bar");
  return bar ? bar.title : null;
});
if (todayBarTitle) {
  const m = todayBarTitle.match(/^(\d+)\s+session/);
  const todayCount = m ? Number(m[1]) : -1;
  todayCount >= ATTEMPT_COUNT
    ? ok("rendered 'Today' bar tooltip reports " + todayCount + " sessions (>= " + ATTEMPT_COUNT + ")")
    : bad("rendered 'Today' bar tooltip reports only " + todayCount + " sessions - expected at least " + ATTEMPT_COUNT + " (title: " + todayBarTitle + ")");
} else {
  bad("could not find the rendered trend chart's 'Today' bar to read its tooltip");
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nPROGRESS TREND CHART: all passed");
process.exit(fails ? 1 : 0);
