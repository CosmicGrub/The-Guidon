/**
 * Doctrine/scenario/board tier-range filter fix: store.doctrine() (and
 * store.scenarios()/boardQuestions(), which share the exact same pattern)
 * filtered by tier with `util.asArray(d.tier).indexOf(s.tierFilter)`.
 * util.asArray() only ever coerces a bare value into a one-element array -
 * it does NOT split a hyphenated range string - so a card seeded with
 * "tier":"E4-E6" became ["E4-E6"], and `.indexOf("E4")` (or any single rank
 * tierFilter is ever set to - "all | E1..E9") was always -1. That card was
 * silently hidden from #/doctrine (and would have been from Train/Board
 * Drill too, had either corpus used the same shape) for every specific-
 * tier Focus tier selection, only ever appearing under "All ranks". This
 * wasn't a hypothetical edge case: 68 doctrine entries carry "tier":"E4-E6"
 * and 34 carry "tier":"E5-E6" in the live seed.
 *
 * Fix: a new util.expandTierTokens() helper (kept separate from asArray,
 * which many unrelated fields still rely on to keep a hyphenated string
 * intact) expands a "E4-E6"-shape token into ["E4","E5","E6"] before the
 * tierFilter comparison, in all three call sites. This test drives the
 * real Focus tier <select> in Settings (not a direct store call) and
 * confirms, on the real #/doctrine view, that:
 *   - a card seeded "tier":"E4-E6" is visible under Focus tier E4, E5, AND E6
 *   - a card seeded "tier":"E5-E6" is visible under E5 and E6, but NOT E4
 *   - neither is visible under an out-of-range tier (E1)
 * Ground truth (which titles carry which raw tier string) is read live
 * from window.GUIDON_SEED so this stays correct if the seed content
 * changes, rather than hardcoding today's titles. Verification goes
 * through the search box (not a raw DOM card count) so it isn't affected
 * by #/doctrine's own DOC_CAP=150 render cap - E5/E6 alone already pass
 * 200+ entries, well past that cap, so scanning unfiltered card order
 * would be flaky; searching the entry's own title narrows the result set
 * to just that card regardless of where it falls in tier-filtered order.
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
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(700);

// ---- Ground truth straight from the live seed, not hardcoded titles ----
const truth = await page.evaluate(() => {
  const entries = (window.GUIDON_SEED && window.GUIDON_SEED.doctrine && window.GUIDON_SEED.doctrine.entries) || [];
  const byTier = (t) => entries.filter((e) => e.tier === t).map((e) => e.title);
  return { e4e6: byTier("E4-E6"), e5e6: byTier("E5-E6") };
});

truth.e4e6.length > 0
  ? ok(`seed ground truth: ${truth.e4e6.length} doctrine entries carry the hyphenated tier "E4-E6"`)
  : bad('seed has no "E4-E6"-tagged doctrine entries to test against - has the seed changed shape?');
truth.e5e6.length > 0
  ? ok(`seed ground truth: ${truth.e5e6.length} doctrine entries carry the hyphenated tier "E5-E6"`)
  : bad('seed has no "E5-E6"-tagged doctrine entries to test against - has the seed changed shape?');

const sampleE4E6 = truth.e4e6[0];
const sampleE5E6 = truth.e5e6[0];

// ---- Drive the real Focus tier <select> in Settings, then search #/doctrine ----
async function titleVisibleAtTier(tier, title) {
  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(400);
  const tierSel = page.locator('select[aria-label^="Focus tier"]');
  await tierSel.waitFor({ state: "visible", timeout: 5000 });
  await tierSel.selectOption(tier);
  await page.waitForTimeout(200);
  await page.evaluate(() => { location.hash = "#/doctrine"; });
  await page.waitForTimeout(400);
  const search = page.locator('input[aria-label="Search doctrine"]');
  await search.waitFor({ state: "visible", timeout: 5000 });
  await search.fill(title);
  await page.waitForTimeout(300); // 120ms debounce + margin
  const titles = await page.evaluate(() => Array.from(document.querySelectorAll(".doc-title")).map((h) => h.textContent));
  return titles.includes(title);
}

if (sampleE4E6) {
  for (const tier of ["E4", "E5", "E6"]) {
    (await titleVisibleAtTier(tier, sampleE4E6))
      ? ok(`Focus tier ${tier}: "${sampleE4E6}" (seed tier "E4-E6") is visible on #/doctrine`)
      : bad(`Focus tier ${tier}: "${sampleE4E6}" (seed tier "E4-E6") is MISSING - range-tier filter still broken`);
  }
  (await titleVisibleAtTier("E1", sampleE4E6))
    ? bad(`Focus tier E1: "${sampleE4E6}" (seed tier "E4-E6", excludes E1) unexpectedly visible`)
    : ok(`Focus tier E1: "${sampleE4E6}" (seed tier "E4-E6", excludes E1) correctly stays hidden`);
}

if (sampleE5E6) {
  for (const tier of ["E5", "E6"]) {
    (await titleVisibleAtTier(tier, sampleE5E6))
      ? ok(`Focus tier ${tier}: "${sampleE5E6}" (seed tier "E5-E6") is visible on #/doctrine`)
      : bad(`Focus tier ${tier}: "${sampleE5E6}" (seed tier "E5-E6") is MISSING - range-tier filter still broken`);
  }
  (await titleVisibleAtTier("E4", sampleE5E6))
    ? bad(`Focus tier E4: "${sampleE5E6}" (seed tier "E5-E6", excludes E4) unexpectedly visible - range lower bound not respected`)
    : ok(`Focus tier E4: "${sampleE5E6}" (seed tier "E5-E6", excludes E4) correctly stays hidden`);
}

// ---- Reset Focus tier back to "all" so this suite leaves no state behind ----
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(400);
await page.locator('select[aria-label^="Focus tier"]').selectOption("all");
await page.waitForTimeout(200);

noise.length === 0
  ? ok("no console errors/warnings across all Focus tier checks")
  : bad(`console noise: ${noise.join(" | ")}`);

console.log(fails === 0 ? "\nDOCTRINE TIER-RANGE FILTER: all passed" : `\nDOCTRINE TIER-RANGE FILTER: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
