/**
 * Reminders' 90-day density timeline strip (roadmap Tier 4): "90-day density
 * timeline strip above Reminders' flat bucket list - a real ~250-reminder
 * account is an undifferentiated wall even capped." MAX_REMINDERS' own
 * comment in reminders.js (src/index.html) already records ~250 reminders
 * actually observed on one real account, so the claim is genuinely real, not
 * hypothetical - this seeds a smaller-but-real, unevenly-distributed set
 * (28 reminders, one dense 4-reminder cluster, real day gaps, both past-due
 * and upcoming, plus two reminders deliberately OUTSIDE the 90-day window)
 * and proves three things:
 *
 *   1. G.chart.densityTimeline renders above the bucket list with exactly
 *      90 real per-day bars, and every single bar's rendered count matches
 *      an INDEPENDENT tally this test computes itself from the same seeded
 *      data (parsed back out of each bar's own tooltip date - never by
 *      calling into reminders.js's own aggregation code), so a bug in the
 *      real aggregation logic can't hide behind a test that just re-runs
 *      the same buggy logic.
 *   2. "Today" lands in the real chronological MIDDLE of the strip (not
 *      forced to the last bucket the way G.chart.densityTimeline's
 *      highlightLast convention assumes) because the window spans both
 *      past-due and upcoming reminders - and no bar gets the amber
 *      "highlightLast" color, since forcing it here would mis-color a
 *      future day as if it were today.
 *   3. The existing overdue/soon/later bucket list below the strip still
 *      renders correctly and unchanged - same section headers, same
 *      counts, same CAP=25 row limit, same "Show all" overflow button.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

/** YYYY-MM-DD for "n days from today", local date arithmetic - same
    technique test-reminders-urgency-parity.mjs and
    test-consistency-extended.mjs already use, matching how the app's own
    util.parseISODate()/daysUntil() read a stored reminder date. */
function daysFromNowStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const todayStr = () => daysFromNowStr(0);

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
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

// ── Build the seeded reminder set (real, uneven, spans past + future) ────
// Offsets are in days from "today". Window under test is ~45 days back /
// ~44 days ahead - -60 and +60 are deliberately OUTSIDE it (proves the
// strip windows the data rather than silently absorbing everything).
const offsetCounts = [
  [-60, 1], // outside window (too far overdue)
  [-40, 1], [-30, 1], [-25, 1], [-20, 1], [-15, 1],
  [-10, 4], // dense overdue cluster
  [-8, 1], [-3, 1], [-1, 1],
  [0, 2],   // today itself
  [1, 1], [3, 1],
  [5, 4],   // dense upcoming cluster
  [7, 1], [12, 1],
  [20, 1], [30, 1], [40, 1],
  [60, 1],  // outside window (too far ahead)
];
const seed = [];
let n = 0;
for (const [offset, count] of offsetCounts) {
  for (let i = 0; i < count; i++) {
    n++;
    seed.push({ id: "rd" + n, kind: "other", label: "Density QA " + n, date: daysFromNowStr(offset), note: "" });
  }
}
const totalSeeded = seed.length; // 28
// Independent expected bucket tallies (overdue/soon/later), computed here
// with the SAME semantics reminders.js's bucket() uses (d<0 / 0<=d<=14 / d>14) -
// NOT by calling bucket() itself.
let expOverdue = 0, expSoon = 0, expLater = 0;
for (const [offset, count] of offsetCounts) {
  if (offset < 0) expOverdue += count;
  else if (offset <= 14) expSoon += count;
  else expLater += count;
}
const expTotal = expOverdue + expSoon + expLater;

await page.evaluate((s) => window.G.db.setSetting("reminders:v1", s), seed);
await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(700);

const editorVisible = await page.evaluate(() => !!document.querySelector(".rem-list-mount"));
editorVisible ? ok("Reminders editor renders on the Profile view") : bad(".rem-list-mount not found");

// ── Part 1: the timeline strip itself ─────────────────────────────────────
const chart = await page.evaluate(() => {
  const timelineMount = document.querySelector(".rem-timeline-mount");
  const listMount = document.querySelector(".rem-list-mount");
  const svg = timelineMount ? timelineMount.querySelector(".chart-density-svg") : null;
  if (!svg) return { found: false, timelineMount: !!timelineMount, listMount: !!listMount };
  const bars = [...svg.querySelectorAll(".cdt-bar")];
  const parsed = bars.map((b) => {
    const t = b.querySelector("title");
    const title = t ? t.textContent : "";
    const m = /^(\d+) reminders? on (\d{4}-\d{2}-\d{2})$/.exec(title);
    return { fill: b.getAttribute("fill"), opacity: b.getAttribute("opacity"), title, count: m ? +m[1] : null, date: m ? m[2] : null };
  });
  const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent);
  // DOM ordering: is the timeline mount really ABOVE (before) the list mount?
  let timelineBeforeList = false;
  if (timelineMount && listMount) {
    timelineBeforeList = !!(timelineMount.compareDocumentPosition(listMount) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  return {
    found: true,
    ariaLabel: svg.getAttribute("aria-label"),
    role: svg.getAttribute("role"),
    barCount: bars.length,
    parsed,
    hasTodayLabel: texts.indexOf("Today") !== -1,
    timelineBeforeList,
  };
});

chart.found ? ok("timeline strip (.chart-density-svg) renders inside .rem-timeline-mount")
  : bad("timeline strip not found (timelineMount=" + chart.timelineMount + " listMount=" + chart.listMount + ")");

if (chart.found) {
  chart.timelineBeforeList
    ? ok("timeline strip sits ABOVE the bucket list in DOM order (a strip, not a replacement)")
    : bad("timeline strip is not positioned before .rem-list-mount");

  chart.role === "img" ? ok("timeline svg carries role=\"img\"") : bad("timeline svg role: " + chart.role);

  chart.barCount === 90 ? ok("timeline renders exactly 90 bars for the 90-day window")
    : bad("expected 90 bars, got " + chart.barCount);

  // Independent per-day tally from the SAME seeded data (plain date-string
  // grouping - no reliance on reminders.js's own aggregation function).
  const tally = new Map();
  for (const r of seed) tally.set(r.date, (tally.get(r.date) || 0) + 1);

  let mismatches = 0;
  let unparsed = 0;
  for (const bar of chart.parsed) {
    if (bar.date === null) { unparsed++; continue; }
    const expected = tally.get(bar.date) || 0;
    if (bar.count !== expected) mismatches++;
  }
  unparsed === 0 ? ok("every bar's tooltip parsed to a real (count, date) pair")
    : bad(unparsed + " bar(s) had an unparseable tooltip");
  mismatches === 0
    ? ok("every one of the 90 bars' rendered count matches this test's own independent per-day tally of the seeded data")
    : bad(mismatches + " bar(s) disagree with the independently computed per-day count");

  // Today: present, in the middle (not first, not last), labeled "Today".
  const todayBar = chart.parsed.find((b) => b.date === todayStr());
  todayBar ? ok("a bar exists for today's exact date (" + todayStr() + ")") : bad("no bar found for today (" + todayStr() + ")");
  if (todayBar) {
    todayBar.count === 2 ? ok("today's bar count matches the 2 reminders seeded on today's date")
      : bad("today's bar count: expected 2, got " + todayBar.count);
  }
  chart.hasTodayLabel ? ok("the strip renders a \"Today\" text label (guaranteed onto a real tick via labelEvery)")
    : bad("no \"Today\" label text found in the timeline svg");

  const dates = chart.parsed.map((b) => b.date).filter(Boolean);
  const todayIdx = dates.indexOf(todayStr());
  (todayIdx > 0 && todayIdx < dates.length - 1)
    ? ok("today sits in the real chronological MIDDLE of the strip (index " + todayIdx + " of " + dates.length + ") - not forced to either edge")
    : bad("today's index in the strip: " + todayIdx + " of " + dates.length + " (expected strictly between the edges)");
  (dates[0] < todayStr() && dates[dates.length - 1] > todayStr())
    ? ok("the window genuinely spans both past-due (" + dates[0] + ") and upcoming (" + dates[dates.length - 1] + ") dates")
    : bad("window does not span past+future: first=" + dates[0] + " last=" + dates[dates.length - 1]);

  // highlightLast must be OFF: no bar anywhere should carry the amber
  // "highlightLast" color, since the real last bucket here is a future
  // date, not today.
  const amberBars = chart.parsed.filter((b) => b.fill === "var(--amber)");
  amberBars.length === 0
    ? ok("no bar uses the amber highlightLast color (today is not forced onto the last bucket)")
    : bad(amberBars.length + " bar(s) incorrectly use the amber highlightLast color");

  // A real dense cluster (4 reminders, 10 days overdue) reads distinctly.
  const clusterDate = daysFromNowStr(-10);
  const clusterBar = chart.parsed.find((b) => b.date === clusterDate);
  clusterBar && clusterBar.count === 4 && clusterBar.fill === "var(--cyan)"
    ? ok("the seeded 4-reminder dense cluster (" + clusterDate + ") renders with count 4 and the base accent color")
    : bad("dense cluster bar: " + JSON.stringify(clusterBar));

  // A real gap (a day inside the window with zero reminders) renders dim.
  const gapDate = daysFromNowStr(-35); // deliberately not seeded
  const gapBar = chart.parsed.find((b) => b.date === gapDate);
  gapBar && gapBar.count === 0 && gapBar.fill === "var(--text-dim)" && parseFloat(gapBar.opacity) < 1
    ? ok("a real gap day (" + gapDate + ", zero reminders) renders dim/zero, proving the strip shows real variation, not uniform placeholder data")
    : bad("gap-day bar: " + JSON.stringify(gapBar));

  // windowTotal (sum of the 90 bars) should equal total seeded MINUS the
  // two deliberately-out-of-window reminders (-60 and +60 day offsets).
  const windowTotal = chart.parsed.reduce((s, b) => s + (b.count || 0), 0);
  windowTotal === totalSeeded - 2
    ? ok("windowed total (" + windowTotal + ") correctly excludes the 2 out-of-window reminders (" + totalSeeded + " seeded total)")
    : bad("windowed total: expected " + (totalSeeded - 2) + ", got " + windowTotal);

  // aria-label reports both the windowed count and the true total.
  const m = chart.ariaLabel && /(\d+) of (\d+) total reminders/.exec(chart.ariaLabel);
  m && +m[1] === windowTotal && +m[2] === totalSeeded
    ? ok("aria-label correctly reports \"" + m[1] + " of " + m[2] + " total reminders\": \"" + chart.ariaLabel + "\"")
    : bad("aria-label did not match expected windowed/total counts: \"" + chart.ariaLabel + "\"");
}

// ── Part 2: the existing bucket list below is unchanged ──────────────────
const list = await page.evaluate(() => {
  const listMount = document.querySelector(".rem-list-mount");
  const headers = [...listMount.querySelectorAll(".eyebrow")].map((h) => h.textContent);
  const rows = listMount.querySelectorAll("button[data-row-index]").length;
  const showAll = [...listMount.querySelectorAll("button")].map((b) => b.textContent).find((t) => /^Show all/.test(t || ""));
  return { headers, rows, showAll: showAll || null };
});

list.headers.indexOf(`Overdue (${expOverdue})`) !== -1
  ? ok(`bucket list still shows "Overdue (${expOverdue})" with the correct count`)
  : bad("Overdue header missing/wrong: " + JSON.stringify(list.headers));
list.headers.indexOf(`Next 14 days (${expSoon})`) !== -1
  ? ok(`bucket list still shows "Next 14 days (${expSoon})" with the correct count`)
  : bad("Next 14 days header missing/wrong: " + JSON.stringify(list.headers));
list.headers.indexOf(`Later (${expLater})`) !== -1
  ? ok(`bucket list still shows "Later (${expLater})" with the correct count`)
  : bad("Later header missing/wrong: " + JSON.stringify(list.headers));

const expShown = Math.min(expTotal, 25);
list.rows === expShown
  ? ok("bucket list renders exactly " + expShown + " rows (CAP=25 respected, unchanged)")
  : bad("bucket list row count: expected " + expShown + ", got " + list.rows);

const expMore = expTotal - 25;
list.showAll && list.showAll.indexOf(`Show all ${expTotal} (${expMore} more)`) !== -1
  ? ok("\"Show all " + expTotal + " (" + expMore + " more)\" overflow button still renders correctly")
  : bad("Show-all button text: " + JSON.stringify(list.showAll));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
server.close();
console.log("\n" + (fails ? `REMINDERS DENSITY TIMELINE: ${fails} FAILURE(S)` : "REMINDERS DENSITY TIMELINE: all passed"));
process.exit(fails ? 1 : 0);
