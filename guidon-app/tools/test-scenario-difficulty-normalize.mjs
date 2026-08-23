/**
 * Scenario-difficulty vocabulary normalization (store.normDifficulty /
 * store.SCENARIO_DIFF_MAP / store.SCENARIO_DIFFICULTY_TIERS): five
 * independently hand-maintained vocabularies used to exist for the same
 * concept - the seed data's own six literal spellings on scenarios (Basic,
 * Intermediate, "Board Prep", Core, Advanced, NCO - the last two from a
 * later curriculum-expansion batch of 52 E5/E6 scenarios), Train's own
 * filter-chip list (only Basic/Intermediate/Advanced - no chip could ever
 * select an NCO/"Board Prep"/Core-tagged scenario), the Authoring Studio's
 * difficulty dropdown (only Basic/Intermediate/NCO/"Board Prep" - couldn't
 * even display "Advanced" or "Core" scenarios' real value), and
 * recommendNext()'s own diffRank map (same 4-value gap, `?? 1` fallback
 * silently rated "Advanced"/"Core" as mid-tier instead of the hardest rank).
 *
 * This is deliberately NOT a reuse of G.board.normDifficulty() (see its own
 * comment) - that function's MAP is Board Drill's own lowercase beginner/
 * basic/intermediate/advanced/expert vocabulary for a different field on a
 * different dataset, and this domain's "Advanced" needs to land in the
 * *hardest* tier alongside "NCO", not get treated as a synonym of Board
 * Drill's "expert". Same normalize-at-one-read-boundary pattern, its own
 * scoped vocabulary, promoted to store (G.store) since scenarios() already
 * lives there.
 *
 * This exercises 6 real seed scenarios - one per literal spelling - and
 * confirms store.normDifficulty(), Train's real filter chips, the
 * Authoring Studio's real difficulty <select>, and the exact rank
 * computation recommendNext() itself runs all now classify each one
 * identically instead of five vocabularies silently diverging again.
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

// The 6 real literal spellings in the seed data, one concrete scenario each,
// and the canonical tier each is expected to converge on.
const FIXTURES = [
  { id: "sc-late-soldier",      title: "The Chronically Late Soldier",              raw: "Basic",        tier: "Basic" },
  { id: "sc-field-movement",    title: "The Foot Movement",                         raw: "Intermediate", tier: "Intermediate" },
  { id: "sc-board-room",        title: "The Promotion Board",                       raw: "Board Prep",   tier: "Intermediate" },
  { id: "sc_marriage_inprocess",title: "'SGT, I Got Married This Weekend'",         raw: "Core",          tier: "Intermediate" },
  { id: "sc_sharp_report",      title: "A SHARP Report Lands on Your Desk",         raw: "Advanced",      tier: "Advanced" },
  { id: "sc-ncoer",             title: "Writing the NCOER",                         raw: "NCO",            tier: "Advanced" },
];

// ---- fixture sanity: the seed data really still carries these exact
// literal spellings (if this drifts, the rest of the test is meaningless) ----
const fixtureCheck = await page.evaluate((fixtures) => {
  const byId = new Map(window.G.store.scenarios().map((s) => [s.id, s]));
  return fixtures.map((f) => {
    const s = byId.get(f.id);
    return { id: f.id, found: !!s, difficulty: s?.difficulty, title: s?.title };
  });
}, FIXTURES);
const fixturesOk = fixtureCheck.every((r, i) => r.found && r.difficulty === FIXTURES[i].raw && r.title === FIXTURES[i].title);
fixturesOk
  ? ok("fixture sanity: all 6 concrete scenarios still carry their real literal difficulty spelling")
  : bad("fixture drift: " + JSON.stringify(fixtureCheck));

// ---- store.normDifficulty() itself: every raw spelling converges on its
// expected canonical tier through the one shared function ----
const normResults = await page.evaluate((fixtures) =>
  fixtures.map((f) => ({ raw: f.raw, got: window.G.store.normDifficulty(f.raw) })),
FIXTURES);
const normOk = normResults.every((r, i) => r.got === FIXTURES[i].tier);
normOk
  ? ok("store.normDifficulty() maps all 6 literal spellings to their expected canonical tier: " +
      normResults.map((r) => r.raw + "→" + r.got).join(", "))
  : bad("normDifficulty results: " + JSON.stringify(normResults));

const tiers = await page.evaluate(() => window.G.store.SCENARIO_DIFFICULTY_TIERS);
JSON.stringify(tiers) === JSON.stringify(["Basic", "Intermediate", "Advanced"])
  ? ok("store.SCENARIO_DIFFICULTY_TIERS is the single ordered canonical tier list ['Basic','Intermediate','Advanced']")
  : bad("SCENARIO_DIFFICULTY_TIERS: " + JSON.stringify(tiers));

// ---- recommendNext()'s own rank computation: NCO and Advanced (both
// canonical "Advanced") must now rank identically, and so must "Board Prep"
// and "Core" (both canonical "Intermediate") - this is the exact expression
// recommendNext() itself evaluates per scenario, not a reimplementation ----
const ranks = await page.evaluate((fixtures) =>
  fixtures.map((f) => ({
    raw: f.raw,
    rank: window.G.store.SCENARIO_DIFFICULTY_TIERS.indexOf(window.G.store.normDifficulty(f.raw)),
  })),
FIXTURES);
const rankById = Object.fromEntries(ranks.map((r) => [r.raw, r.rank]));
(rankById["NCO"] === rankById["Advanced"] && rankById["NCO"] === 2)
  ? ok("recommendNext()'s rank computation now ranks 'NCO' and 'Advanced' identically (both rank 2, the hardest tier) - previously NCO ranked 2 while Advanced fell through '?? 1' to rank 1")
  : bad("NCO/Advanced ranks: " + JSON.stringify(rankById));
(rankById["Board Prep"] === rankById["Core"] && rankById["Board Prep"] === rankById["Intermediate"] && rankById["Board Prep"] === 1)
  ? ok("recommendNext()'s rank computation ranks 'Board Prep', 'Core', and 'Intermediate' identically (all rank 1)")
  : bad("Board Prep/Core/Intermediate ranks: " + JSON.stringify(rankById));
rankById["Basic"] === 0 ? ok("'Basic' ranks 0 (easiest)") : bad("Basic rank: " + rankById["Basic"]);

// recommendNext() itself still runs end-to-end without throwing.
const rec = await page.evaluate(() => window.G.store.recommendNext());
(rec && rec.scenario && typeof rec.reason === "string")
  ? ok("store.recommendNext() runs end-to-end and returns a real {scenario, reason, weakest} pick")
  : bad("recommendNext() result: " + JSON.stringify(rec));

// ---- Train's real filter chips: clicking one chip pulls in scenarios from
// every raw spelling that converges on that tier, not just the literal
// spelling matching the chip's own label ----
await page.evaluate(() => { location.hash = "#/train"; });
await page.waitForTimeout(600);
const filtersToggle = page.locator("button", { hasText: /^(Filters|Hide filters)/ });
if ((await filtersToggle.textContent())?.trim().startsWith("Filters")) {
  await filtersToggle.click();
  await page.waitForTimeout(150);
}

async function cardTitlesForChip(tierLabel) {
  await page.locator('[aria-label="Filter by difficulty"] .search-chip', { hasText: new RegExp("^" + tierLabel + "$") }).click();
  await page.waitForTimeout(200);
  const titles = await page.evaluate(() => Array.from(document.querySelectorAll(".grid .card.click")).map((c) => c.getAttribute("aria-label") || ""));
  await page.locator('[aria-label="Filter by difficulty"] .search-chip', { hasText: /^All difficulties$/ }).click();
  await page.waitForTimeout(200);
  return titles;
}

const advancedTitles = await cardTitlesForChip("Advanced");
const advancedOk = advancedTitles.some((t) => t.includes("A SHARP Report Lands on Your Desk")) &&
  advancedTitles.some((t) => t.includes("Writing the NCOER")) &&
  !advancedTitles.some((t) => t.includes("The Chronically Late Soldier"));
advancedOk
  ? ok("Train's 'Advanced' chip now includes both the raw-'Advanced' and the raw-'NCO' scenario (converged), and excludes a raw-'Basic' one")
  : bad("cards under 'Advanced' chip: " + JSON.stringify(advancedTitles));

const intermediateTitles = await cardTitlesForChip("Intermediate");
const intermediateOk = intermediateTitles.some((t) => t.includes("The Foot Movement")) &&
  intermediateTitles.some((t) => t.includes("The Promotion Board")) &&
  intermediateTitles.some((t) => t.includes("SGT, I Got Married This Weekend"));
intermediateOk
  ? ok("Train's 'Intermediate' chip includes the raw-'Intermediate', raw-'Board Prep', and raw-'Core' scenarios (all converged)")
  : bad("cards under 'Intermediate' chip: " + JSON.stringify(intermediateTitles));

const basicTitles = await cardTitlesForChip("Basic");
const basicOk = basicTitles.some((t) => t.includes("The Chronically Late Soldier")) &&
  !basicTitles.some((t) => t.includes("Writing the NCOER")) &&
  !basicTitles.some((t) => t.includes("A SHARP Report Lands on Your Desk"));
basicOk
  ? ok("Train's 'Basic' chip includes the raw-'Basic' scenario and excludes the Advanced-tier ones")
  : bad("cards under 'Basic' chip: " + JSON.stringify(basicTitles));

// ---- Authoring Studio's difficulty dropdown: its option list now derives
// from the same shared map, so every real literal spelling (including
// "Advanced" and "Core", which the old hand-typed DIFFS list omitted
// entirely) is representable/selectable ----
await page.evaluate(async () => {
  const all = (await window.G.db.allUserScenarios()) || [];
  for (const sc of all) await window.G.db.delUserScenario(sc.id);
});
await page.evaluate(() => { location.hash = "#/author"; });
await page.waitForTimeout(500);
await page.locator("button", { hasText: /New Scenario/ }).click();
await page.waitForTimeout(300);

const diffOptions = await page.evaluate(() => {
  const selects = Array.from(document.querySelectorAll(".panel select"));
  const diffSelect = selects.find((s) => Array.from(s.options).some((o) => o.value === "Basic"));
  return diffSelect ? Array.from(diffSelect.options).map((o) => o.value) : null;
});
const expectedDiffOptions = ["Basic", "Intermediate", "Board Prep", "Core", "Advanced", "NCO"];
diffOptions && expectedDiffOptions.every((v) => diffOptions.includes(v)) && diffOptions.length === expectedDiffOptions.length
  ? ok("Authoring Studio's difficulty <select> now offers all 6 real literal spellings, including 'Advanced' and 'Core' (previously missing): " + JSON.stringify(diffOptions))
  : bad("difficulty <select> options: " + JSON.stringify(diffOptions));

// Clean up the scratch scenario this test created.
await page.evaluate(async () => {
  const all = (await window.G.db.allUserScenarios()) || [];
  for (const sc of all) await window.G.db.delUserScenario(sc.id);
});

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `SCENARIO-DIFFICULTY-NORMALIZE: ${fails} FAILURE(S)` : "SCENARIO-DIFFICULTY-NORMALIZE: all passed"));
process.exit(fails ? 1 : 0);
