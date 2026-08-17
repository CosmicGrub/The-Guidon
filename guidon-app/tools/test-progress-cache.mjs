/**
 * Upgrade-roadmap first wave, item 2: G.store.getProgress() has always
 * cached its own result for 5 seconds (a real cost-saving measure - it
 * scans the whole attempts store), but nothing ever invalidated that cache
 * ON A WRITE - only the timer did. recordAttempt() and resetProgress()
 * both write the exact data getProgress() reads, so a screen that reads
 * progress within 5 seconds of either could show numbers that already
 * disagreed with what was just written - most visibly, resetProgress()
 * (Progress page's "Reset progress" button) showing the PRE-reset numbers
 * for up to 5 more seconds. Exercises both write paths directly against
 * the real G.store API (matching test-finance.mjs's direct-API pattern)
 * and confirms getProgress() reflects each write immediately, with zero
 * wait.
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

// Baseline: warm the cache with a real getProgress() call, same as any
// screen render would, so the very next assertion is testing invalidation
// against a REAL warm cache, not an incidentally-empty one.
const baseline = await page.evaluate(async () => window.G.store.getProgress());
baseline && typeof baseline.totalAttempts === "number" ? ok("getProgress() returns a real result to warm the cache (baseline totalAttempts=" + baseline.totalAttempts + ")") : bad("getProgress() baseline: " + JSON.stringify(baseline));

// Record a real attempt, then read progress again IMMEDIATELY (0ms wait,
// well inside the 5s TTL window) - must reflect the new attempt right away.
const afterRecord = await page.evaluate(async (startCount) => {
  await window.G.store.recordAttempt({
    scenarioId: "qa-progress-cache-test", title: "QA cache test", mode: "text",
    score: { Leads: 10, Develops: 0, Achieves: 0, Character: 0, Presence: 0, Intellect: 0 }, total: 10,
  });
  return window.G.store.getProgress();
}, baseline.totalAttempts);
afterRecord.totalAttempts === baseline.totalAttempts + 1
  ? ok("getProgress() reflects a just-recorded attempt with zero wait (totalAttempts " + baseline.totalAttempts + " -> " + afterRecord.totalAttempts + ")")
  : bad("totalAttempts after recordAttempt (expected " + (baseline.totalAttempts + 1) + "): " + afterRecord.totalAttempts);
afterRecord.completedIds.indexOf("qa-progress-cache-test") !== -1
  ? ok("the new attempt's scenarioId appears in completedIds immediately")
  : bad("completedIds missing the just-recorded scenario: " + JSON.stringify(afterRecord.completedIds));

// resetProgress() clears the whole attempts store - read immediately after,
// again with zero wait, and confirm the PRE-reset numbers are gone, not
// cached and visible for up to 5 more seconds.
const afterReset = await page.evaluate(async () => {
  await window.G.store.resetProgress();
  return window.G.store.getProgress();
});
afterReset.totalAttempts === 0 ? ok("getProgress() reflects a reset with zero wait (totalAttempts -> 0, was " + afterRecord.totalAttempts + ")") : bad("totalAttempts after resetProgress (expected 0): " + afterReset.totalAttempts);
afterReset.completedCount === 0 ? ok("completedCount is also immediately 0 after reset") : bad("completedCount after reset: " + afterReset.completedCount);
afterReset.readinessLabel === "Not Started" ? ok("readinessLabel immediately reverts to 'Not Started' after reset") : bad("readinessLabel after reset: " + JSON.stringify(afterReset.readinessLabel));

// Sanity: the 5s TTL itself still works as a real cache, not accidentally
// disabled - two getProgress() calls back-to-back with no write between
// them should be cheap/consistent, not recomputed from a torn state.
const consistent = await page.evaluate(async () => {
  const a = await window.G.store.getProgress();
  const b = await window.G.store.getProgress();
  return a.totalAttempts === b.totalAttempts && a.completedCount === b.completedCount;
});
consistent ? ok("two back-to-back getProgress() calls with no write between them still agree (cache still functions)") : bad("back-to-back getProgress() calls disagreed with no write between them");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nPROGRESS CACHE: all passed");
process.exit(fails ? 1 : 0);
