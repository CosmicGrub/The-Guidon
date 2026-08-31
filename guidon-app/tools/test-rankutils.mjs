/**
 * G.rankUtils (src/index.html, idp.js section) - the canonical "what tier is
 * the viewing Soldier" resolver: tierOf() (profileTier-first-then-
 * tierFilter), gradeInBand()/isEligibleForBand() (rank-band string parsing
 * for goal/content gating), and matchNcoesRow() (matching a tier against an
 * ncoesStep.grades-shaped row list). rankUtils's own header comment names
 * the exact prior bug this resolver replaced: onboarding's independently-
 * maintained RANK_TO_TIER once collapsed every senior-NCO rank (SFC/MSG/
 * 1SG/SGM/CSM/SMA) down to E6, live, before being caught - and until this
 * test, rankUtils itself (now read from career.js, idp.js, PPW, Profile's
 * quick-estimate calculator, and Settings) had zero direct test coverage of
 * its own: nothing exercised the profile-tier-present vs settings-fallback
 * vs neither-present branches, a malformed band string, or a grades table
 * with a genuinely non-matching row.
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

const rankUtilsPresent = await page.evaluate(() =>
  !!(window.G && window.G.rankUtils && window.G.rankUtils.tierOf && window.G.rankUtils.gradeInBand &&
     window.G.rankUtils.isEligibleForBand && window.G.rankUtils.matchNcoesRow));
rankUtilsPresent
  ? ok("window.G.rankUtils is present with tierOf/gradeInBand/isEligibleForBand/matchNcoesRow")
  : bad("window.G.rankUtils (or one of its methods) is missing");

// ---- tierOf(profile, settings): profile.tier wins when present, falls back
// to settings.tierFilter only when profile has none, and settings.tierFilter
// === "all" means "no filter" (null), same as neither being set at all ----
const TIER_CASES = [
  { name: "profile-tier present, settings also set -> profile wins", profile: { tier: "E7" }, settings: { tierFilter: "E1-E6" }, want: "E7" },
  { name: "profile has no tier, settings set -> falls back to settings", profile: {}, settings: { tierFilter: "E4" }, want: "E4" },
  { name: "profile.tier undefined, settings.tierFilter='all' -> no filter (null)", profile: {}, settings: { tierFilter: "all" }, want: null },
  { name: "neither profile nor settings carry a tier -> null", profile: {}, settings: {}, want: null },
  { name: "profile is null, settings is null -> null (no throw)", profile: null, settings: null, want: null },
  { name: "profile.tier is empty string (falsy) -> falls back to settings", profile: { tier: "" }, settings: { tierFilter: "E5" }, want: "E5" },
];
const tierResults = await page.evaluate((cases) =>
  cases.map((c) => ({ name: c.name, got: window.G.rankUtils.tierOf(c.profile, c.settings) })),
TIER_CASES);
tierResults.forEach((r, i) => {
  r.got === TIER_CASES[i].want
    ? ok("tierOf: " + r.name + " -> " + JSON.stringify(r.got))
    : bad("tierOf: " + r.name + " -> expected " + JSON.stringify(TIER_CASES[i].want) + ", got " + JSON.stringify(r.got));
});

// ---- gradeInBand(band, grade) / isEligibleForBand(tier, band) - same
// function, arguments swapped (isEligibleForBand(tier, band) calls
// gradeInBand(band, tier) internally) - covers a single-grade band ("E6"),
// a range band ("E4-E6"), the "no band/no grade means show" defaults, and a
// malformed band string that the regex can't parse (defensively true, i.e.
// "don't hide content over a parse failure") ----
const BAND_CASES = [
  { name: "range band, grade inside (E4-E6, E5)", band: "E4-E6", grade: "E5", want: true },
  { name: "range band, grade below (E4-E6, E3)", band: "E4-E6", grade: "E3", want: false },
  { name: "range band, grade above (E4-E6, E7)", band: "E4-E6", grade: "E7", want: false },
  { name: "single-grade band, exact match (E6, E6)", band: "E6", grade: "E6", want: true },
  { name: "single-grade band, no match (E6, E5)", band: "E6", grade: "E5", want: false },
  { name: "no band set -> show regardless of grade", band: null, grade: "E5", want: true },
  { name: "no grade known -> show regardless of band", band: "E4-E6", grade: null, want: true },
  { name: "malformed band string doesn't parse -> defensively true", band: "not-a-real-band", grade: "E5", want: true },
];
const bandResults = await page.evaluate((cases) =>
  cases.map((c) => ({
    name: c.name,
    gradeInBand: window.G.rankUtils.gradeInBand(c.band, c.grade),
    isEligibleForBand: window.G.rankUtils.isEligibleForBand(c.grade, c.band),
  })),
BAND_CASES);
bandResults.forEach((r, i) => {
  const want = BAND_CASES[i].want;
  (r.gradeInBand === want)
    ? ok("gradeInBand: " + BAND_CASES[i].name + " -> " + r.gradeInBand)
    : bad("gradeInBand: " + BAND_CASES[i].name + " -> expected " + want + ", got " + r.gradeInBand);
  (r.isEligibleForBand === want)
    ? ok("isEligibleForBand: " + BAND_CASES[i].name + " -> " + r.isEligibleForBand)
    : bad("isEligibleForBand: " + BAND_CASES[i].name + " -> expected " + want + ", got " + r.isEligibleForBand);
});

// ---- matchNcoesRow(tier, grades): finds the row whose left-of-"->" grade
// range covers the given tier, in a real ncoesStep.grades-shaped table -
// including a tier that matches NO row (must return null, not throw or
// silently pick the wrong row) ----
const GRADES = [
  { grade: "E1-E2 -> E3", course: "BLC prerequisite window" },
  { grade: "E4 -> E5 (SGT)", course: "BLC" },
  { grade: "E6 -> E7 (SFC)", course: "ALC" },
];
const ROW_CASES = [
  { name: "tier inside a range row (E1, matches E1-E2 row)", tier: "E1", wantCourse: "BLC prerequisite window" },
  { name: "tier matches a single-grade row (E4)", tier: "E4", wantCourse: "BLC" },
  { name: "tier matches another single-grade row (E6)", tier: "E6", wantCourse: "ALC" },
  { name: "tier matches NO row (E9, a genuine gap in this table)", tier: "E9", wantCourse: null },
  { name: "null tier -> null, no throw", tier: null, wantCourse: null },
];
const rowResults = await page.evaluate(({ grades, cases }) =>
  cases.map((c) => {
    const row = window.G.rankUtils.matchNcoesRow(c.tier, grades);
    return { name: c.name, course: row ? row.course : null };
  }),
{ grades: GRADES, cases: ROW_CASES });
rowResults.forEach((r, i) => {
  r.course === ROW_CASES[i].wantCourse
    ? ok("matchNcoesRow: " + r.name + " -> " + JSON.stringify(r.course))
    : bad("matchNcoesRow: " + r.name + " -> expected " + JSON.stringify(ROW_CASES[i].wantCourse) + ", got " + JSON.stringify(r.course));
});
// grades not an array -> null, not a throw.
const nonArrayResult = await page.evaluate(() => window.G.rankUtils.matchNcoesRow("E5", null));
nonArrayResult === null
  ? ok("matchNcoesRow: grades is not an array -> null (no throw)")
  : bad("matchNcoesRow with non-array grades: " + JSON.stringify(nonArrayResult));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nRANKUTILS: all passed");
process.exit(fails ? 1 : 0);
