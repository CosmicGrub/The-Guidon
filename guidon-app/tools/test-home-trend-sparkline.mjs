/**
 * Home dashboard's "7-day activity" sparkline (views.home, the panel built
 * from `chartRow = el("div.trend-bars-row")`) never actually showed a
 * proportional bar chart - every bar, including the max/"today" bar with an
 * inline `height:100%`, rendered pinned at exactly the JS-set
 * `min-height:3px` floor, a flat line with no real variation regardless of
 * that day's true completion count.
 *
 * Root cause was pure CSS, not the JS bucketing/scaling logic (which was
 * already correct): `.trend-bar-wrap` (the track each `.trend-bar` fills)
 * has `flex:1` -> `flex-basis:0%`. Its parent `.trend-col` was a flex item
 * of `.trend-bars-row`, but that row used `align-items:flex-end` instead of
 * the default `stretch`, so `.trend-col` was never given a definite height -
 * it sized to content. With `.trend-bar-wrap`'s flex-basis at `0%` (not
 * `auto`), it contributed ~0 to that content-based sizing pass, so its own
 * height resolved to 0/indefinite - and a percentage `height` on its
 * `.trend-bar` child can only resolve against a definite containing-block
 * height. Rescued only by the inline `min-height:3px`, which is why every
 * bar - whatever its real value - ended up pinned to that floor.
 *
 * Fix: `.trend-bars-row` now uses `align-items:stretch` (the default), so
 * `.trend-col` gets a real, definite height from the row's own `height:60px`,
 * which flex then resolves down into `.trend-bar-wrap`'s flex:1 track as a
 * definite pixel height - letting `.trend-bar`'s percentage height resolve
 * for real. `.trend-label`/`.trend-count` are unaffected: they keep their
 * natural/auto heights and `.trend-bar-wrap`'s flex:1 just absorbs whatever
 * height they don't use, same bottom-aligned look as before.
 *
 * This test seeds a real multi-day trainingCompletions dataset (varying
 * counts per day, including a same-day zero) and checks the RENDERED
 * `.trend-bar` boxes actually differ in height in proportion to their day's
 * count - not just that the panel renders at all.
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

// Seed 7 days of varying activity directly into trainingCompletions via the
// real setSetting() API. recordTrainingComplete() itself always stamps
// `lastAt` as "now", so to get real distinct day-buckets (the way a week of
// actual use would) each fake completion's `lastAt` is backdated explicitly -
// same shape the store would accumulate naturally, just seeded in one pass.
// Plan (daysAgo: count), 0 = today = the max bucket:
const PLAN = { 6: 1, 5: 0, 4: 3, 3: 0, 2: 5, 1: 2, 0: 8 };
await page.evaluate(async (plan) => {
  const DAY = 86400000;
  const now = Date.now();
  const completions = {};
  let n = 0;
  for (const [daysAgo, count] of Object.entries(plan)) {
    for (let i = 0; i < count; i++) {
      const id = "seed-sparkline-" + (n++);
      const ts = now - Number(daysAgo) * DAY - i * 1000; // stagger within the day
      completions[id] = { count: 1, bestPct: 90, lastAt: new Date(ts).toISOString() };
    }
  }
  await window.G.store.setSetting("trainingCompletions", completions);
}, PLAN);

await page.evaluate(() => { location.hash = "#/"; });
await page.waitForTimeout(150);
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(500);

const row = page.locator(".trend-bars-row");
await row.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
(await row.count())
  ? ok(".trend-bars-row is present")
  : bad(".trend-bars-row not found - sparkline did not render");

const bars = await page.evaluate(() => {
  const cols = Array.from(document.querySelectorAll(".trend-bars-row .trend-col"));
  return cols.map((col) => {
    const bar = col.querySelector(".trend-bar");
    const count = col.querySelector(".trend-count");
    const r = bar.getBoundingClientRect();
    return { count: count ? Number(count.textContent) : 0, cssHeightPct: bar.style.height, pxHeight: r.height };
  });
});
console.log("  bars:", JSON.stringify(bars));

bars.length === 7 ? ok("7 day-columns rendered") : bad("expected 7 columns, got " + bars.length);

// The regression itself: not every bar pinned at the ~3px min-height floor.
const distinctHeights = new Set(bars.map((b) => Math.round(b.pxHeight)));
distinctHeights.size > 1
  ? ok("bars render at varying pixel heights (" + [...distinctHeights].sort((a, b) => a - b).join(", ") + "px) - not all pinned to the 3px floor")
  : bad("all bars rendered at the same height (" + [...distinctHeights] + "px) - still pinned to the min-height floor");

// PLAN maps to bucket index i = 6 - daysAgo:
//   bars[4]=count5(2d ago)  bars[5]=count2(1d ago)  bars[1]=count0(5d ago)
//   bars[6]=count8(today, the max -> inline height:100%)
const today = bars[6], midDay = bars[4], lowDay = bars[5], zeroDay = bars[1];
[today, midDay, lowDay, zeroDay].every((b, i) => b.count === [8, 5, 2, 0][i])
  ? ok("bucketed the seeded counts into the expected day columns")
  : bad("day-bucket mismatch - seeded plan and rendered .trend-count disagree: " + JSON.stringify({ today, midDay, lowDay, zeroDay }));

today.cssHeightPct === "100%"
  ? ok("today's bar (the max count) carries the expected inline height:100%")
  : bad("today's bar height style: expected 100%, got " + today.cssHeightPct);

today.pxHeight > midDay.pxHeight && midDay.pxHeight > lowDay.pxHeight && lowDay.pxHeight > zeroDay.pxHeight
  ? ok("bars scale monotonically with their day's count: today(8)=" + today.pxHeight.toFixed(1) +
       "px > mid(5)=" + midDay.pxHeight.toFixed(1) + "px > low(2)=" + lowDay.pxHeight.toFixed(1) +
       "px > zero(0)=" + zeroDay.pxHeight.toFixed(1) + "px")
  : bad("bars do NOT scale proportionally with count - today(8)=" + today.pxHeight.toFixed(1) +
        "px mid(5)=" + midDay.pxHeight.toFixed(1) + "px low(2)=" + lowDay.pxHeight.toFixed(1) +
        "px zero(0)=" + zeroDay.pxHeight.toFixed(1) + "px");

today.pxHeight > 20
  ? ok("today's bar (height:100% inline) resolves to a real height (" + today.pxHeight.toFixed(1) + "px), not just the 3px floor")
  : bad("today's bar only resolves to " + today.pxHeight.toFixed(1) + "px despite inline height:100%");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0
  ? ok("no console errors/warnings")
  : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nHOME TREND SPARKLINE: all passed");
process.exit(fails ? 1 : 0);
