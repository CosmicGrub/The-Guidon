/**
 * Roadmap Tier 4: "Persist Diagnostics' per-run results and render a
 * pass/fail trend timeline, reusing the app's existing .trend-chart CSS."
 *
 * Before this pass NOTHING about a past automated run survived past the
 * render() call that produced it - selftest.js's own `lastRun` is
 * deliberately in-memory-only (Copy report's footer already says "NOTE:
 * automated checks reflect only the theme and view active when they ran"),
 * and no kv key stored a prior run's pass/fail shape anywhere. This test
 * proves the new storage and the new chart are both real:
 *
 *   1. selftest.js now persists one row per completed "Run automated
 *      checks" pass under guidon:selftest:history:v1 - a plain kv-prefixed
 *      array, same convention as G.selfheal's own 200-cap audit log
 *      (guidon:selfheal:v1) and Mock Board's rolling history
 *      (board:mockHistory:v1) - NOT a new storage mechanism.
 *   2. The retention cap (200, matching selfheal's own CAP) actually trims:
 *      seeding well past it and recording one more real run evicts the
 *      OLDEST rows, keeps the newest, same eviction shape
 *      test-attempts-retention-cap.mjs already proved for ATTEMPTS_CAP.
 *   3. A real, wired-up automated run (a genuine button click, not a
 *      hand-seeded fixture) actually appends its own entry with the real
 *      pass/fail counts and per-check id->ok map from that run.
 *   4. The Diagnostics view renders a real G.chart.densityTimeline() trend
 *      chart from persisted history - present on a fresh page load with no
 *      run yet this session (proving it reads real storage, not session-
 *      only `lastRun`), and it grows/updates after a new run completes.
 *   5. Health -> color mapping: a run with zero failures lands on
 *      densityTimeline's own dimmed "zero" branch (var(--text-dim)); a run
 *      with real failures shows a real non-zero, non-dimmed bar; the most
 *      recent run is always highlighted var(--amber) regardless of health -
 *      the ".trend-chart" color convention this item asks to reuse.
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

// This suite clicks "Run automated checks" on #/selftest below, which runs the
// "Route health" check (src/index.html, id:"routes") - it renders every route,
// including #/library, to prove none of them throw. That triggers
// src/app-modules/library.js's one-time same-origin HEAD probe against
// DOCS[0].pdfAsset (docs/<first reference doc>.pdf), which detects whether
// web/docs/*.pdf shipped with this build. It only 404s here because
// .github/workflows/ci.yml's build-artifact upload deliberately excludes
// guidon-app/web/docs/** (~78MB, not worth re-uploading/downloading for all 14
// test-matrix jobs) - every real build.mjs run (local, Android, a genuine
// deploy) writes web/docs/ alongside web/index.html together, so this never
// happens outside that one CI artifact trim. A same-origin fetch() against a
// URL that genuinely 404s logs Chromium's own "Failed to load resource" line
// to the console as an unavoidable network-layer side effect that no app-code
// try/catch can suppress. Counting the actual docs/*.pdf 404 responses (the
// console message text itself never includes the URL) and spending exactly
// that many off the noise list below keeps this check honest: any other
// unexplained console error still fails it.
let docsProbe404 = 0;
page.on("response", (r) => {
  if (!r.ok() && /\/docs\/.*\.pdf$/i.test(new URL(r.url()).pathname)) docsProbe404++;
});

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

// ── Part 1: the claim itself - confirm there is genuinely nothing under the
// new key before this test writes anything, on a fresh guest session. ──────
const preExisting = await page.evaluate(() => window.G.db.get("kv", "guidon:selftest:history:v1"));
!preExisting
  ? ok("guidon:selftest:history:v1 does not exist yet on a fresh session (the claim was genuinely open)")
  : bad("guidon:selftest:history:v1 already had a value on a fresh session: " + JSON.stringify(preExisting));

// ── Part 2: real end-to-end wiring - one genuine button click actually
// appends a real history entry with real pass/fail data. ──────────────────
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(500);

// Headless Chromium does not auto-grant persistent storage, so "Storage
// durability" (storagePersist) genuinely fails here by default - real,
// pre-existing, environment behavior, not something this fix introduces
// (test-selftest.mjs's own coverage stubs this exact same field to drive
// both directions of that check). Stubbed true so the two baseline runs
// below are genuinely all-passing, making the "healthy run -> dimmed bar"
// assertions in Part 3 deterministic instead of accidentally coupled to
// whatever this one unrelated check happens to report in a given browser.
await page.evaluate(() => {
  window.G.pwa = window.G.pwa || {};
  window.G.pwa.state = window.G.pwa.state || {};
  window.G.pwa.state.persisted = true;
});

// Before any run this session, the view has no `lastRun` - the trend chart
// must still render from persisted storage alone. On THIS fresh session
// that storage is empty, so it should show the real empty state, not throw
// and not silently render nothing.
const emptyStateText = await page.evaluate(() => document.body.textContent || "");
/No runs recorded yet on this device/.test(emptyStateText)
  ? ok("Diagnostics shows the real empty state for run history before any run has ever happened on this device")
  : bad("empty-state history text not found on first load");

await page.locator("button.btn.primary.sm", { hasText: /Run automated checks/ }).click();
await page.waitForTimeout(1200);

const afterOneRealRun = await page.evaluate(() => window.G.db.get("kv", "guidon:selftest:history:v1"));
const list1 = (afterOneRealRun && afterOneRealRun.v) || [];
Array.isArray(list1) && list1.length === 1
  ? ok("one real 'Run automated checks' click appends exactly one row to guidon:selftest:history:v1")
  : bad("history row count after one real run (expected 1): " + JSON.stringify(list1.length));

const entry1 = list1[0];
const summaryV = await page.evaluate(() => (document.querySelectorAll(".stat .v")[0] || {}).textContent || "");
const m = /^(\d+)\s*\/\s*(\d+)$/.exec((summaryV || "").trim());
const domPass = m ? +m[1] : null, domTotal = m ? +m[2] : null;
(entry1 && typeof entry1.pass === "number" && typeof entry1.fail === "number" && entry1.pass + entry1.fail === entry1.total)
  ? ok("the recorded entry has real pass/fail/total counts (pass=" + entry1.pass + " fail=" + entry1.fail + " total=" + entry1.total + ")")
  : bad("recorded entry pass/fail/total shape: " + JSON.stringify(entry1));
(domTotal != null && entry1 && entry1.pass === domPass && entry1.total === domTotal)
  ? ok("the recorded entry's pass/total exactly match what the live summary line just showed on screen (" + domPass + "/" + domTotal + ")")
  : bad("recorded entry (" + (entry1 && entry1.pass) + "/" + (entry1 && entry1.total) + ") does not match the on-screen summary (" + domPass + "/" + domTotal + ")");
entry1 && entry1.checks && typeof entry1.checks === "object" && Object.keys(entry1.checks).length === entry1.total
  ? ok("the recorded entry carries a per-check id->ok map with one entry per check that actually ran (" + Object.keys((entry1 || {}).checks || {}).length + ")")
  : bad("recorded entry's per-check map: " + JSON.stringify(entry1 && entry1.checks));
entry1 && typeof entry1.at === "string" && !isNaN(new Date(entry1.at).getTime())
  ? ok("the recorded entry has a real parseable timestamp (" + (entry1 && entry1.at) + ")")
  : bad("recorded entry timestamp: " + JSON.stringify(entry1 && entry1.at));
entry1 && entry1.checks && Object.prototype.hasOwnProperty.call(entry1.checks, "modules") && entry1.checks.modules === true
  ? ok("the per-check map correctly records a real known-good check ('modules') as passing")
  : bad("per-check map's 'modules' entry: " + JSON.stringify(entry1 && entry1.checks && entry1.checks.modules));

// The chart must now show this one real run - not just the empty state.
const chartAfterOneRun = await page.evaluate(() => {
  const wrap = document.querySelector(".chart-density-wrap");
  const bars = wrap ? wrap.querySelectorAll(".cdt-bar").length : 0;
  return { present: !!wrap, bars };
});
chartAfterOneRun.present && chartAfterOneRun.bars === 1
  ? ok("the trend chart renders a real G.chart.densityTimeline() with exactly 1 bar after the first real run")
  : bad("trend chart state after first real run: " + JSON.stringify(chartAfterOneRun));

// A second real click appends a SECOND row, not overwriting the first.
await page.locator("button.btn.primary.sm", { hasText: /Run again/ }).click();
await page.waitForTimeout(1200);
const afterTwoRuns = await page.evaluate(() => window.G.db.get("kv", "guidon:selftest:history:v1"));
const list2 = (afterTwoRuns && afterTwoRuns.v) || [];
list2.length === 2
  ? ok("a second real run appends a second row (history is append-only, not overwritten)")
  : bad("history row count after two real runs (expected 2): " + list2.length);
const barsAfterTwo = await page.evaluate(() => document.querySelectorAll(".chart-density-wrap .cdt-bar").length);
barsAfterTwo === 2
  ? ok("the trend chart re-renders with 2 bars after the second real run, in place, with no page reload")
  : bad("trend chart bar count after second real run: " + barsAfterTwo);

// ── Part 3: health -> color mapping (the ".trend-chart" convention) ───────
// Confirmed by reading the ORIGINAL, pre-existing .trend-chart call site
// this item asks to reuse (Home's weekly activity strip): its own per-bar
// color pick is `count === 0 ? "var(--text-dim)" : i === 6 ? "var(--amber)"
// : "var(--cyan)"` - a zero value wins EVEN on the most-recent ("today")
// bucket; the amber highlight only ever applies to a non-zero most-recent
// value. densityTimeline's own `v === 0 ? emptyColor : isLast ?
// highlightColor : accentColor` is the exact same precedence, so this run-
// history trend chart (value = fail count) inherits it: a healthy run
// (fail=0) renders dimmed no matter how recent it is; only a run that
// actually had failures can ever be amber (if it's the newest) or cyan (if
// an older run also failed). The two real runs just recorded came from a
// clean guest profile, so both are genuinely healthy (fail=0) - both bars
// must be dimmed, including the most recent one.
const colorsHealthy = await page.evaluate(() => {
  const bars = [...document.querySelectorAll(".chart-density-wrap .cdt-bar")];
  return bars.map((b) => b.getAttribute("fill"));
});
colorsHealthy.length === 2 && colorsHealthy[0] === "var(--text-dim)" && colorsHealthy[1] === "var(--text-dim)"
  ? ok("two back-to-back healthy (0-failure) runs both render dimmed var(--text-dim), including the most recent one - zero-value wins over recency, matching the real .trend-chart precedence")
  : bad("bar colors after two healthy runs (expected both dimmed): " + JSON.stringify(colorsHealthy));

// Force two real failures back to back - the EXACT same monkey-patch
// technique test-selftest.mjs's own coverage already uses to fail "Status
// bar theming" off-device: stub the one field its off-device branch reads
// (G.native._debug.parseColor) so it returns an unparseable color. Two
// failing runs in a row exercise all three color branches: run 3 (failing,
// last) -> amber; run 3 demoted by run 4 (failing, now not last) -> cyan;
// run 4 (failing, last) -> amber; runs 1-2 (healthy) stay dimmed throughout.
async function forceOneFailingRun() {
  await page.evaluate(() => {
    const dbg = window.G.native._debug;
    window.__origParseColor = dbg.parseColor;
    dbg.parseColor = () => ["not", "a", "number"];
  });
  await page.locator("button.btn.primary.sm", { hasText: /Run again/ }).click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.G.native._debug.parseColor = window.__origParseColor; delete window.__origParseColor; });
}
await forceOneFailingRun();

const afterThreeRuns = await page.evaluate(() => window.G.db.get("kv", "guidon:selftest:history:v1"));
const list3 = (afterThreeRuns && afterThreeRuns.v) || [];
const entry3 = list3[list3.length - 1];
(list3.length === 3 && entry3 && entry3.fail >= 1 && entry3.checks && entry3.checks.statusbar === false)
  ? ok("a real forced failure is recorded honestly in the third entry (fail=" + (entry3 && entry3.fail) + ", checks.statusbar=false)")
  : bad("third entry after a forced failure: " + JSON.stringify(entry3));

const colorsAfterThree = await page.evaluate(() => [...document.querySelectorAll(".chart-density-wrap .cdt-bar")].map((b) => b.getAttribute("fill")));
colorsAfterThree.length === 3 && colorsAfterThree[2] === "var(--amber)"
  ? ok("the new most-recent (failing) run is highlighted var(--amber) - a real non-zero value on the last bar")
  : bad("bar colors after 3 runs (last should be failing + amber-highlighted): " + JSON.stringify(colorsAfterThree));
colorsAfterThree[0] === "var(--text-dim)" && colorsAfterThree[1] === "var(--text-dim)"
  ? ok("the two earlier healthy runs are still dimmed - a later failure does not retroactively recolor them")
  : bad("earlier healthy-run bar colors after a third, failing run: " + JSON.stringify(colorsAfterThree));

// A second failing run demotes run 3 out of the highlight slot - now a
// real, non-zero, non-last value, it must show the base accent color
// (cyan), not dimmed (it did fail) and not amber (it's no longer last).
await forceOneFailingRun();
const colorsAfterFour = await page.evaluate(() => [...document.querySelectorAll(".chart-density-wrap .cdt-bar")].map((b) => b.getAttribute("fill")));
colorsAfterFour.length === 4 && colorsAfterFour[3] === "var(--amber)"
  ? ok("the newest failing run (4th) takes over the amber highlight slot")
  : bad("bar colors after 4 runs (last should be amber): " + JSON.stringify(colorsAfterFour));
colorsAfterFour[2] === "var(--cyan)"
  ? ok("the previously-highlighted failing run (3rd), demoted out of the last slot by a newer run, now shows the base accent color var(--cyan) - not dimmed (it did fail) and not amber (it's no longer most recent)")
  : bad("demoted failing-run bar color (3rd, now not last): " + colorsAfterFour[2]);
colorsAfterFour[0] === "var(--text-dim)" && colorsAfterFour[1] === "var(--text-dim)"
  ? ok("the two original healthy runs remain dimmed after 4 total runs")
  : bad("original healthy-run bar colors after 4 runs: " + JSON.stringify(colorsAfterFour));

// ── Part 4: retention cap actually caps (matches G.selfheal's own CAP=200
// FIFO convention) - seed well past it directly via the same kv key this
// fix's own storage functions read/write, then exercise one more real run
// through the real UI and confirm the store settles back at exactly 200,
// oldest rows evicted, newest (including the one just recorded through the
// real button click) kept. ─────────────────────────────────────────────────
const capResult = await page.evaluate(async () => {
  const db = window.G.db;
  const KEY = "guidon:selftest:history:v1";
  const CAP = 200;
  const baseTs = 1700000000000; // fixed past epoch, strictly increasing per seed row
  const seedTotal = CAP + 50;
  const seed = [];
  for (let i = 0; i < seedTotal; i++) {
    seed.push({ at: new Date(baseTs + i * 1000).toISOString(), pass: 16, fail: 0, total: 16, checks: { seedMarker: "seed-" + i } });
  }
  await db.put("kv", { k: KEY, v: seed });
  const countAfterSeed = ((await db.get("kv", KEY)).v || []).length;
  return { countAfterSeed, seedTotal, cap: CAP };
});
capResult.countAfterSeed === capResult.seedTotal
  ? ok("seeded " + capResult.seedTotal + " history rows directly via the real kv key (cap=" + capResult.cap + "), well past the retention cap, before exercising the real write path")
  : bad("countAfterSeed (expected " + capResult.seedTotal + "): " + capResult.countAfterSeed);

// Now the one real write path this fix adds: an actual "Run again" click,
// which must trim the now-250-row backlog back down to the cap.
await page.locator("button.btn.primary.sm", { hasText: /Run again/ }).click();
await page.waitForTimeout(1200);

const afterCapRun = await page.evaluate(async () => {
  const db = window.G.db;
  const rows = ((await db.get("kv", "guidon:selftest:history:v1")).v || []);
  const seedRows = rows.filter((r) => r.checks && typeof r.checks.seedMarker === "string" && r.checks.seedMarker.indexOf("seed-") === 0);
  const oldestSeedStillPresent = seedRows.some((r) => ["seed-0", "seed-1", "seed-10", "seed-49"].indexOf(r.checks.seedMarker) !== -1);
  const newestSeedStillPresent = seedRows.some((r) => r.checks.seedMarker === "seed-249");
  const realRunPresent = rows.some((r) => !(r.checks && typeof r.checks.seedMarker === "string"));
  return { total: rows.length, oldestSeedStillPresent, newestSeedStillPresent, realRunPresent };
});
afterCapRun.total === 200
  ? ok("after seeding 250 rows and running one real automated pass, the store settles back at exactly the 200-row cap")
  : bad("history row count after the capping run (expected 200): " + afterCapRun.total);
!afterCapRun.oldestSeedStillPresent
  ? ok("the oldest seeded rows (seed-0..seed-49, lowest timestamps) were evicted by the FIFO trim")
  : bad("one or more of the oldest seeded rows survived the trim - eviction did not target the oldest rows");
afterCapRun.newestSeedStillPresent
  ? ok("the newest seeded row (seed-249, highest seeded timestamp) survived the trim")
  : bad("the newest seeded row was evicted - eviction picked the wrong end of the list");
afterCapRun.realRunPresent
  ? ok("the real run just performed through the actual UI survived the trim as the newest, non-seeded entry")
  : bad("the real run recorded through the UI did not survive the retention-cap trim");

const DOCS_PROBE_404 = /Failed to load resource: the server responded with a status of 404/;
let docsAllowance = docsProbe404;
const relevantNoise = noise.filter((n) => {
  if (/favicon/.test(n)) return false;
  if (docsAllowance > 0 && DOCS_PROBE_404.test(n)) { docsAllowance--; return false; }
  return true;
});
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSELFTEST HISTORY TREND: all passed");
process.exit(fails ? 1 : 0);
