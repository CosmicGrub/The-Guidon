/**
 * #/creeds (Creeds & Branch Identities, views.creeds in src/index.html) -
 * Milestone 3 of docs/design/content-education-roadmap.md, shipped
 * direct-to-main (commit 73d749e), with zero test-suite coverage of its own
 * until now. Round 9 roadmap-audit's test-coverage lens flagged this
 * alongside #/prt and #/recite as the single highest-value gap - see
 * tools/test-prt.mjs's header for the full rationale shared by all three
 * new suites this round adds.
 *
 * Two things covered here, neither previously exercised anywhere:
 *
 *  (a) store.creeds()'s tier:"all" guard, specifically WITH a specific-rank
 *      tierFilter active. store.creeds()'s own header comment (src/
 *      index.html, ~lines 7779-7790) explains why this deliberately does
 *      NOT copy store.doctrine()'s tier guard verbatim: doctrine's
 *      `d.tier && expandTierTokens(d.tier).indexOf(...)` treats ANY truthy
 *      `d.tier` as rank-specific, which would run
 *      expandTierTokens("all") -> ["all"] and silently hide every
 *      tier:"all" creed the instant a Soldier picks a specific Focus tier -
 *      the opposite of what "all" is supposed to mean. This test proves the
 *      extra `c.tier !== "all"` guard actually works: with a specific-rank
 *      tierFilter active, ground truth read live from window.GUIDON_SEED
 *      (every real creed carries tier:"all" today - there is no
 *      rank-gated creed in the corpus, per the roadmap's own open question
 *      on this) must ALL still come back from store.creeds(), not zero of
 *      them. A regression back to doctrine's verbatim guard would make this
 *      test fail hard (0 results instead of the full count), not just
 *      subtly under-count.
 *
 *  (b) creeds(query)'s substring search filter, across the fields it's
 *      documented to search (officialTitle/branch/motto.text/fullText/
 *      history/source.ref) - an exact single-hit match against a branch
 *      motto, a title-based match, an empty query returning everything,
 *      and a fabricated query matching nothing.
 *
 * Plus a light real route/DOM pass (heading, group filter chips, the
 * list/search UI actually narrowing what's on screen) so this isn't pure
 * function-level testing with no browser-rendered assertion at all -
 * matching tools/test-landnav-drill.mjs/tools/test-moi-import.mjs's own
 * "launch, route to the hash, assert real DOM/state, plus a targeted
 * Node-level check of the pure functions underneath" structure.
 *
 * Round 10 roadmap-audit, "Creeds view fixes" bucket adds (a2) below: the
 * three detail-pane cross-link buttons round 9 introduced ("Also tested in
 * Board Drill →" / "Practice reciting this →" / "View in Doctrine →") had
 * zero coverage of their own - see that section's own comment for why no
 * single creed renders all three at once, and how this suite covers each
 * pairing on the creed that actually has it.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

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
await dismissOnboarding(page);
await page.waitForTimeout(300);

/* ========================================================================
   (a) Real route/DOM pass, ground truth read live from window.GUIDON_SEED
   ======================================================================== */
const truth = await page.evaluate(() => {
  const creeds = window.GUIDON_SEED.creeds || [];
  return {
    count: creeds.length,
    allTierIds: creeds.filter((c) => c.tier === "all").map((c) => c.id),
    groups: Array.from(new Set(creeds.map((c) => c.group))),
  };
});
truth.count > 0
  ? ok(`seed ground truth: ${truth.count} creeds/branch-identity entries, ${truth.allTierIds.length} of them tier:"all"`)
  : bad("seed has no creeds to test against - has the seed changed shape?");

await page.evaluate(() => { location.hash = "#/creeds"; });
await page.waitForTimeout(500);

const headingShown = await page.evaluate(() => /Creeds & Branch Identities/.test(document.querySelector("h2")?.textContent || ""));
headingShown ? ok("#/creeds renders with a 'Creeds & Branch Identities' heading") : bad("'Creeds & Branch Identities' heading not found");

const listCount = await page.evaluate(() => document.querySelectorAll(".list-detail-list .ldr-name").length);
listCount === truth.count
  ? ok(`Landing list shows all ${truth.count} entries with no filter active`)
  : bad(`Landing list shows ${listCount} entries, expected ${truth.count}`);

const groupChipCount = await page.evaluate(() => document.querySelectorAll(".search-filters .chip").length);
groupChipCount === truth.groups.length + 1 // +1 for the "All groups" chip
  ? ok(`Group filter bar shows ${truth.groups.length} real groups plus the "All groups" chip`)
  : bad(`Group filter bar shows ${groupChipCount} chips, expected ${truth.groups.length + 1}`);

const searchNarrows = await page.evaluate(() => {
  const inp = document.querySelector('input[aria-label="Search creeds and branch identities"]');
  if (!inp) return null;
  inp.value = "essayons";
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  return [...document.querySelectorAll(".list-detail-list .ldr-name")].map((el) => el.textContent);
});
searchNarrows && searchNarrows.length === 1 && /Engineer/.test(searchNarrows[0])
  ? ok(`Search box narrows the real list to a single match on the Engineer motto "Essayons": ${JSON.stringify(searchNarrows)}`)
  : bad('Search box did not narrow to the expected single Engineer match: ' + JSON.stringify(searchNarrows));
// Clear it back out so the tier-filter check below starts from an unfiltered list.
await page.evaluate(() => {
  const inp = document.querySelector('input[aria-label="Search creeds and branch identities"]');
  if (inp) { inp.value = ""; inp.dispatchEvent(new Event("input", { bubbles: true })); }
});

/* ========================================================================
   (a2) Detail-pane cross-link buttons (round 9's "Also tested in Board
   Drill →" / "Practice reciting this →" / "View in Doctrine →" additions to
   renderDetail() - src/index.html) - zero prior coverage until now. Rows
   are selected by their real data-creed-id (the list is unfiltered here,
   both group and search reset above) rather than by list position, so a
   future seed reorder can't silently make this click the wrong row.

   Ground truth re-checked directly against the live seed before writing
   this (this project's own discipline of re-verifying an audit's claim
   against the actual data, per ROADMAP.md's cadence notes): no single
   creed in today's corpus renders all three buttons at once. Army Values
   (creed-army-values) carries linkedDoctrineId but no linkedBoardId, so it
   renders ONLY the doctrine cross-link; the three re-homed full creeds
   (creed-soldiers/creed-nco/creed-ranger) carry linkedBoardId to a
   recitable board.questions row but no linkedDoctrineId, so they render
   the other two but never the doctrine one. This suite covers each
   pairing on the creed that actually has it, plus the negative case (the
   cross-link that should NOT appear) on both, mirroring how
   tools/test-dictionary-list-detail.mjs and tools/test-doctrine-card-
   grid.mjs verify the analogous doctrine cross-link elsewhere in the app.
   ======================================================================== */
await page.evaluate(() => { document.querySelector('.list-detail-row[data-creed-id="creed-army-values"]')?.click(); });
await page.waitForTimeout(200);

const armyValuesButtons = await page.evaluate(() => {
  const detail = document.getElementById("creeds-detail");
  return detail ? Array.from(detail.querySelectorAll("button")).map((b) => b.textContent) : [];
});
armyValuesButtons.some((t) => /View in Doctrine/.test(t))
  ? ok(`Army Values' detail pane shows the "View in Doctrine →" cross-link button: ${JSON.stringify(armyValuesButtons)}`)
  : bad(`Army Values' detail pane is missing the "View in Doctrine →" button: ${JSON.stringify(armyValuesButtons)}`);
armyValuesButtons.some((t) => /Also tested in Board Drill/.test(t) || /Practice reciting this/.test(t))
  ? bad(`Army Values unexpectedly shows a Board Drill/Recite cross-link (it carries no linkedBoardId in the seed): ${JSON.stringify(armyValuesButtons)}`)
  : ok("Army Values correctly shows no Board Drill/Recite cross-link (it carries no linkedBoardId)");

const expectedDoctrineTitle = await page.evaluate(() => {
  const entry = (window.G.store.doctrineMeta().entries || []).find((e) => e.id === "army-values");
  return entry ? entry.title : null;
});
expectedDoctrineTitle
  ? ok(`ground truth: the "army-values" doctrine entry exists ("${expectedDoctrineTitle}")`)
  : bad('the "army-values" doctrine entry was not found via store.doctrineMeta() - has the seed changed shape?');

await page.evaluate(() => {
  const btn = Array.from(document.getElementById("creeds-detail").querySelectorAll("button")).find((b) => /View in Doctrine/.test(b.textContent || ""));
  if (btn) btn.click();
});
await page.waitForTimeout(400);

const doctrineLanded = await page.evaluate(() => ({
  hash: location.hash,
  searchValue: document.querySelector('input[aria-label="Search doctrine"]')?.value || null,
  seedCleared: window.G.views._doctrineSeed === null,
}));
doctrineLanded.hash === "#/doctrine"
  ? ok('clicking "View in Doctrine →" navigated to #/doctrine')
  : bad(`clicking "View in Doctrine →" landed on hash="${doctrineLanded.hash}", expected "#/doctrine"`);
doctrineLanded.searchValue === expectedDoctrineTitle
  ? ok(`#/doctrine's search box is pre-filled with the linked entry's own title ("${doctrineLanded.searchValue}")`)
  : bad(`#/doctrine's search box value is "${doctrineLanded.searchValue}", expected "${expectedDoctrineTitle}"`);
doctrineLanded.seedCleared
  ? ok("G.views._doctrineSeed was consumed (cleared) after use")
  : bad("G.views._doctrineSeed was not cleared after use");

// Back to #/creeds, unfiltered, for the Board Drill / Recite button checks
// on The Ranger Creed (linkedBoardId:"creed-7", which store.recitable()
// includes).
await page.evaluate(() => { location.hash = "#/creeds"; });
await page.waitForTimeout(400);
await page.evaluate(() => { document.querySelector('.list-detail-row[data-creed-id="creed-ranger"]')?.click(); });
await page.waitForTimeout(200);

const rangerButtons = await page.evaluate(() => {
  const detail = document.getElementById("creeds-detail");
  return detail ? Array.from(detail.querySelectorAll("button")).map((b) => b.textContent) : [];
});
rangerButtons.some((t) => /Also tested in Board Drill/.test(t))
  ? ok(`The Ranger Creed's detail pane shows "Also tested in Board Drill →": ${JSON.stringify(rangerButtons)}`)
  : bad(`The Ranger Creed's detail pane is missing "Also tested in Board Drill →": ${JSON.stringify(rangerButtons)}`);
rangerButtons.some((t) => /Practice reciting this/.test(t))
  ? ok(`The Ranger Creed's detail pane shows "Practice reciting this →": ${JSON.stringify(rangerButtons)}`)
  : bad(`The Ranger Creed's detail pane is missing "Practice reciting this →": ${JSON.stringify(rangerButtons)}`);
rangerButtons.some((t) => /View in Doctrine/.test(t))
  ? bad(`The Ranger Creed unexpectedly shows a "View in Doctrine →" cross-link (it carries no linkedDoctrineId): ${JSON.stringify(rangerButtons)}`)
  : ok("The Ranger Creed correctly shows no doctrine cross-link (it carries no linkedDoctrineId)");

await page.evaluate(() => {
  const btn = Array.from(document.getElementById("creeds-detail").querySelectorAll("button")).find((b) => /Also tested in Board Drill/.test(b.textContent || ""));
  if (btn) btn.click();
});
await page.waitForTimeout(300);
const boardHash = await page.evaluate(() => location.hash);
boardHash === "#/board"
  ? ok('clicking "Also tested in Board Drill →" navigated to #/board')
  : bad(`clicking "Also tested in Board Drill →" landed on hash="${boardHash}", expected "#/board"`);

// Re-select The Ranger Creed after the navigation above and exercise the
// remaining "Practice reciting this →" button on its own.
await page.evaluate(() => { location.hash = "#/creeds"; });
await page.waitForTimeout(400);
await page.evaluate(() => { document.querySelector('.list-detail-row[data-creed-id="creed-ranger"]')?.click(); });
await page.waitForTimeout(200);
await page.evaluate(() => {
  const btn = Array.from(document.getElementById("creeds-detail").querySelectorAll("button")).find((b) => /Practice reciting this/.test(b.textContent || ""));
  if (btn) btn.click();
});
await page.waitForTimeout(300);
const reciteHash = await page.evaluate(() => location.hash);
reciteHash === "#/recite"
  ? ok('clicking "Practice reciting this →" navigated to #/recite')
  : bad(`clicking "Practice reciting this →" landed on hash="${reciteHash}", expected "#/recite"`);

// Back to #/creeds, unfiltered, for the tier-filter checks below.
await page.evaluate(() => { location.hash = "#/creeds"; });
await page.waitForTimeout(400);

/* ========================================================================
   (b) store.creeds()'s tier:"all" guard, with a specific-rank tierFilter
   ======================================================================== */
await page.evaluate(() => window.G.store.setSetting("tierFilter", "E5"));
const underE5Filter = await page.evaluate(() => window.G.store.creeds().map((c) => c.id));
JSON.stringify(underE5Filter.slice().sort()) === JSON.stringify(truth.allTierIds.slice().sort())
  ? ok(`With Focus tier "E5" active, all ${truth.allTierIds.length} tier:"all" creeds still come back from store.creeds() (the "all" guard, not doctrine's verbatim tier check, is what's running)`)
  : bad(`store.creeds() under tierFilter "E5" returned ${underE5Filter.length} of ${truth.allTierIds.length} expected tier:"all" creeds: ${JSON.stringify(underE5Filter)}`);

// Same check under a DIFFERENT specific tier, to rule out "E5 happens to be
// whatever the default profile tier already was" as a false-positive cause.
await page.evaluate(() => window.G.store.setSetting("tierFilter", "E8"));
const underE8Filter = await page.evaluate(() => window.G.store.creeds().map((c) => c.id));
JSON.stringify(underE8Filter.slice().sort()) === JSON.stringify(truth.allTierIds.slice().sort())
  ? ok(`With Focus tier "E8" active too, all ${truth.allTierIds.length} tier:"all" creeds still come back`)
  : bad(`store.creeds() under tierFilter "E8" returned ${underE8Filter.length} of ${truth.allTierIds.length} expected tier:"all" creeds: ${JSON.stringify(underE8Filter)}`);

// Reset back to "all" - leave no filter state behind for anything after this suite.
await page.evaluate(() => window.G.store.setSetting("tierFilter", "all"));
const backToAll = await page.evaluate(() => window.G.store.creeds().length);
backToAll === truth.count
  ? ok(`Resetting Focus tier back to "all" restores the full ${truth.count}-entry list`)
  : bad(`store.creeds() after resetting tierFilter to "all" returned ${backToAll}, expected ${truth.count}`);

/* ========================================================================
   (b, continued) creeds(query) substring search filtering
   ======================================================================== */
const noQuery = await page.evaluate(() => window.G.store.creeds().length);
noQuery === truth.count
  ? ok(`store.creeds() with no query returns the full ${truth.count}-entry list`)
  : bad(`store.creeds() with no query returned ${noQuery}, expected ${truth.count}`);

const mottoMatch = await page.evaluate(() => window.G.store.creeds("essayons").map((c) => c.id));
JSON.stringify(mottoMatch) === JSON.stringify(["creed-engineer"])
  ? ok('store.creeds("essayons") matches exactly creed-engineer via its motto text')
  : bad('store.creeds("essayons") -> ' + JSON.stringify(mottoMatch));

const titleMatch = await page.evaluate(() => window.G.store.creeds("ranger").map((c) => c.id));
titleMatch.includes("creed-ranger")
  ? ok(`store.creeds("ranger") includes creed-ranger (title match): ${JSON.stringify(titleMatch)}`)
  : bad('store.creeds("ranger") did not include creed-ranger: ' + JSON.stringify(titleMatch));

const caseInsensitive = await page.evaluate(() => window.G.store.creeds("ESSAYONS").map((c) => c.id));
JSON.stringify(caseInsensitive) === JSON.stringify(["creed-engineer"])
  ? ok('store.creeds("ESSAYONS") matches case-insensitively')
  : bad('store.creeds("ESSAYONS") -> ' + JSON.stringify(caseInsensitive));

const noMatch = await page.evaluate(() => window.G.store.creeds("zzz-not-a-real-creed").length);
noMatch === 0
  ? ok("store.creeds() with a fabricated query returns zero results")
  : bad("store.creeds() with a fabricated query returned " + noMatch + " results, expected 0");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nCREEDS: all passed");
process.exit(fails ? 1 : 0);
