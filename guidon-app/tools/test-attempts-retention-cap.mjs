/**
 * Retention-cap policy for the "attempts" IndexedDB store (Tier 2 shared-
 * infrastructure item): store.recordAttempt() - the write path for every
 * scenario-completion record (renderTrainingOutcome()/renderOutcome() in
 * the Train engine both call it) - used to write unconditionally with no
 * row-count cap, unlike its sibling recordBullet() (Profile's bullet-
 * history list, capped at 200 rows via push+shift). getProgress() then
 * full-scans the ENTIRE attempts store on every 5s cache-miss (see
 * test-progress-cache.mjs for that cache's own behavior), so an uncapped
 * store meant both an ever-growing on-disk footprint AND an ever-growing
 * scan cost.
 *
 * recordAttempt() now trims the store down to ATTEMPTS_CAP (1000 - see the
 * comment above that constant in store.js for why 1000 and not
 * recordBullet()'s 200) via db.trimAttempts(), evicting the OLDEST rows
 * first (by `ts`, mirroring recordBullet()'s "push, then shift the front
 * off" shape) and keeping the newest.
 *
 * This seeds well over the cap directly against the DB (db.putMany(),
 * bypassing recordAttempt() entirely - the same "seed the backlog, then
 * exercise the real write path once" shape test-reminders.mjs uses for
 * MAX_REMINDERS) so the test also proves trimAttempts() correctly collapses
 * an EXISTING over-cap backlog (e.g. from a bulk backup restore or
 * progress-file import that bypassed recordAttempt()'s own +1-at-a-time
 * growth), not just a store that was already at-or-under cap before the
 * write under test.
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

const capExposed = await page.evaluate(() => window.G.store.ATTEMPTS_CAP);
typeof capExposed === "number" && capExposed > 0
  ? ok("store.ATTEMPTS_CAP is exposed as a real positive number (" + capExposed + ")")
  : bad("store.ATTEMPTS_CAP: " + JSON.stringify(capExposed));

const result = await page.evaluate(async (cap) => {
  const db = window.G.db, store = window.G.store;

  // Clean slate: resetProgress() clears the whole "attempts" store (and its
  // progress cache) so this test's counts don't depend on whatever else ran
  // against this same browser context first.
  await store.resetProgress();

  // Seed CAP + 50 rows DIRECTLY via db.putMany() - bypassing recordAttempt()
  // (and therefore its cap logic) entirely, with strictly increasing `ts`
  // values so "oldest" is unambiguous (a tight loop can call Date.now()
  // fast enough to tie within the same millisecond, which a fixed
  // baseTs+i counter avoids). This intentionally leaves the store 50 rows
  // OVER cap before the write under test even runs.
  const baseTs = 1700000000000; // fixed past epoch ms (real, but far behind "now")
  const seedTotal = cap + 50;
  const seedRows = [];
  for (let i = 0; i < seedTotal; i++) {
    seedRows.push({
      id: "seed-" + i,
      scenarioId: "seed-scenario-" + i,
      title: "Seed " + i,
      mode: "text",
      score: { Leads: 1, Develops: 0, Achieves: 0, Character: 0, Presence: 0, Intellect: 0 },
      total: 1,
      ts: baseTs + i, // seed-0 = oldest ... seed-(seedTotal-1) = newest of the seed batch
    });
  }
  await db.putMany("attempts", seedRows);
  const countAfterSeed = (await db.allAttempts()).length;

  // Now exercise the REAL write path under test: one more attempt recorded
  // through store.recordAttempt() itself (not a direct db write), on a
  // distinct scenarioId so it's unambiguous in both the raw row set and in
  // getProgress()'s per-scenario `best` map. recordAttempt() stamps its own
  // `id` (util.uid("att")) and `ts` (Date.now(), always after baseTs), so
  // scenarioId is what this test tracks it by.
  await store.recordAttempt({
    scenarioId: "attempts-cap-test-newest",
    title: "Newest attempt (cap test)",
    mode: "text",
    score: { Leads: 10, Develops: 0, Achieves: 0, Character: 0, Presence: 0, Intellect: 0 },
    total: 10,
  });

  const after = await db.allAttempts();
  const seedIdsPresent = after.filter((a) => typeof a.id === "string" && a.id.indexOf("seed-") === 0).map((a) => a.id);
  const oldestSeedIdsStillPresent = [];
  for (let i = 0; i < 51; i++) { if (seedIdsPresent.indexOf("seed-" + i) !== -1) oldestSeedIdsStillPresent.push("seed-" + i); }
  const newestSeedIdMissing = seedIdsPresent.indexOf("seed-" + (seedTotal - 1)) === -1;

  const progress = await store.getProgress();

  return {
    cap, seedTotal, countAfterSeed,
    afterCount: after.length,
    oldestSeedIdsStillPresent,
    newestSeedIdMissing,
    hasNewestRecorded: after.some((a) => a.scenarioId === "attempts-cap-test-newest"),
    progress,
  };
}, capExposed);

result.countAfterSeed === result.seedTotal
  ? ok("bulk seed via db.putMany() landed all " + result.seedTotal + " rows before the write under test (cap=" + result.cap + ")")
  : bad("countAfterSeed (expected " + result.seedTotal + "): " + result.countAfterSeed);

result.afterCount === result.cap
  ? ok("store.recordAttempt() trims the store back down to exactly ATTEMPTS_CAP (" + result.cap + ") after seeding " + result.seedTotal + " rows")
  : bad("stored row count after recordAttempt() (expected " + result.cap + "): " + result.afterCount);

result.oldestSeedIdsStillPresent.length === 0
  ? ok("the 51 OLDEST seeded rows (seed-0..seed-50, lowest ts) were evicted, not the newest")
  : bad(result.oldestSeedIdsStillPresent.length + " of the oldest 51 seeded rows survived the trim (should be 0): " + result.oldestSeedIdsStillPresent.slice(0, 5).join(","));

!result.newestSeedIdMissing
  ? ok("the newest seeded row (seed-" + (result.seedTotal - 1) + ", highest ts of the seed batch) was kept")
  : bad("the newest seeded row was evicted - eviction picked the wrong end of the list");

result.hasNewestRecorded
  ? ok("the attempt just recorded through the real store.recordAttempt() write path survived the trim")
  : bad("the just-recorded attempt (scenarioId=attempts-cap-test-newest) is missing after the trim");

// getProgress() must still return sane, uncorrupted data reflecting the
// most recent attempts after a trim this large - not NaNs, not a stale
// pre-trim total (the same cache-invalidation guarantee test-progress-
// cache.mjs already covers for a single recordAttempt(), now checked here
// immediately after a 51-row eviction instead of a simple +1 write).
const p = result.progress;
p && p.totalAttempts === result.cap
  ? ok("getProgress().totalAttempts reflects the capped count (" + result.cap + "), not the pre-trim " + result.seedTotal + " + 1")
  : bad("getProgress().totalAttempts (expected " + result.cap + "): " + (p && p.totalAttempts));

p && Array.isArray(p.completedIds) && p.completedIds.indexOf("attempts-cap-test-newest") !== -1
  ? ok("getProgress().completedIds includes the just-recorded scenario")
  : bad("completedIds missing attempts-cap-test-newest: " + JSON.stringify(p && p.completedIds && p.completedIds.slice(0, 5)));

const dimKeys = ["Leads", "Develops", "Achieves", "Character", "Presence", "Intellect"];
const dimsSane = p && p.dims && dimKeys.every((d) => p.dims[d] && Number.isFinite(p.dims[d].pct) && p.dims[d].pct >= 0 && p.dims[d].pct <= 100);
dimsSane
  ? ok("getProgress().dims has all 6 dimensions with finite, in-range percentages (no NaN/undefined from the trim)")
  : bad("getProgress().dims not sane after trim: " + JSON.stringify(p && p.dims));

typeof p?.readinessLabel === "string" && p.readinessLabel.length > 0
  ? ok("getProgress().readinessLabel is a real label (\"" + p?.readinessLabel + "\"), not corrupted")
  : bad("readinessLabel after trim: " + JSON.stringify(p && p.readinessLabel));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nATTEMPTS RETENTION CAP: all passed");
process.exit(fails ? 1 : 0);
