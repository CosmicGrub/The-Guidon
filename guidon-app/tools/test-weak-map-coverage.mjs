/**
 * Onboarding's WeakPoints step (WEAK_AREAS, module scope in profile.js) and
 * generateActionPlan()'s WEAK_MAP lookup (same file, "Study weak points ->
 * map to board categories") are two hand-maintained lists that have to stay
 * in sync by convention alone - nothing in the code enforces it. Roadmap
 * Tier 3 audit: cross-referencing every WEAK_AREAS id against WEAK_MAP's own
 * keys (substring match, exactly what the real forEach in generateActionPlan
 * does) found 7 ids with NO matching key - "chain of command", "promotions",
 * "supply", "evaluations", "adp", and "weapons" (a prior scoping pass's
 * 5-item list, itself already stale), PLUS "acft", which that same prior
 * pass missed entirely. A Soldier checking any of those 7 boxes got zero
 * "Study Gaps" item back from the wizard's own Summary step, silently - the
 * forEach just finds no match and moves on, nothing throws, nothing logs.
 *
 * This walks the real first-run wizard, selects all 7 previously-gapped
 * chips (2 reachable at the default "Foundations" group, 5 behind the
 * "+more" toggle across the other two groups), and confirms a real,
 * non-empty, correctly-routed action item exists for every single one - both
 * on the wizard's own Summary step (proves generateActionPlan() genuinely
 * produces them, not just that the checkbox saved) and again in the saved
 * profile's actionPlan after "Save profile & start" (proves it round-trips
 * through the real save path, not just the in-memory wizard render).
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

// Previously-gapped WEAK_AREAS ids, keyed to the button locator that selects
// each one and the substring the fix's WEAK_MAP action text must contain -
// checked against generateActionPlan()'s real output, not re-derived here.
const GAPPED = [
  { id: "chain of command", locator: () => page.locator("button.ob-weak-btn", { hasText: "Chain of Command" }), needle: "chain of command" },
  { id: "promotions",       locator: () => page.locator('button[aria-label="Promotions / Points (AR 600-8-19)"]'), needle: "AR 600-8-19" },
  { id: "supply",           locator: () => page.locator("button.ob-weak-btn", { hasText: "Supply / Property Accountability (FLIPL)" }), needle: "FLIPL" },
  { id: "evaluations",      locator: () => page.locator("button.ob-weak-btn", { hasText: "NCOERs / DA 2166-9 / Support Forms" }), needle: "NCOER" },
  { id: "adp",              locator: () => page.locator('button[aria-label="Army Doctrine Publications (ADP 3-0, 5-0, 6-0, 6-22)"]'), needle: "doctrine hierarchy" },
  { id: "acft",             locator: () => page.locator("button.ob-weak-btn", { hasText: "AFT Events & Standards" }), needle: "AFT event standards" },
  { id: "weapons",          locator: () => page.locator("button.ob-weak-btn", { hasText: "Weapons (M4, M9, crew-served)" }), needle: "M4, M9" },
];

// ---- Walk the real first-run wizard to the WeakPoints step ----
await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).waitFor({ state: "visible", timeout: 8000 });
await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).click();
await page.waitForTimeout(300);
await page.locator(".ob-rank-btn", { hasText: /^SSG$/ }).click();
await page.locator("button.ob-next", { hasText: /Next/ }).click(); // identity -> role
await page.waitForTimeout(300);
await page.locator("button.ob-next", { hasText: /Next/ }).click(); // role -> concerns
await page.waitForTimeout(300);
await page.locator("button", { hasText: /^Next →$/ }).click(); // concerns -> weakpoints
await page.waitForTimeout(300);

const onWeakStep = await page.evaluate(() => /weak points|weakest/i.test(document.body.textContent || ""));
onWeakStep ? ok("Reached the WeakPoints onboarding step") : bad("did not land on the WeakPoints step");

// Two of the seven ("chain of command", "promotions") live in the default-
// open "Foundations" group; select those first, before touching the toggle.
await GAPPED[0].locator().click();
await GAPPED[1].locator().click();

// The other five live behind "+more" - expand it if it's still collapsed
// (Playwright's default 1280x720 viewport is already past the >=1024px
// tier where the group starts pre-expanded, so this may already be a
// no-op; same conditional test-onboarding.mjs uses for the same reason).
const weakMoreToggle = page.locator("button", { hasText: /more ▾|Show fewer ▴/ });
if (/more ▾/.test((await weakMoreToggle.textContent()) || "")) {
  await weakMoreToggle.click();
  await page.waitForTimeout(200);
}
for (const g of GAPPED.slice(2)) {
  await g.locator().click();
}
await page.waitForTimeout(150);

// Confirm all 7 actually registered as selected (.active) before moving on -
// if a locator above silently matched zero elements, this catches it here
// rather than producing a confusing "missing action item" failure later.
let selectedCount = 0;
for (const g of GAPPED) {
  const isActive = await g.locator().evaluate((btn) => btn.classList.contains("active")).catch(() => false);
  if (isActive) selectedCount++; else bad(`checkbox for "${g.id}" did not end up active after clicking`);
}
selectedCount === GAPPED.length
  ? ok(`All ${GAPPED.length} previously-gapped weak-point chips (${GAPPED.map((g) => g.id).join(", ")}) selected`)
  : bad(`only ${selectedCount}/${GAPPED.length} gapped chips ended up selected`);

await page.locator("button", { hasText: /Build my plan/ }).click(); // weakpoints -> boarddate
await page.waitForTimeout(300);
await page.locator("button", { hasText: /^Skip$/ }).click(); // boarddate -> summary
await page.waitForTimeout(300);

// ---- Summary step: generateActionPlan() ran for real; read its output ----
const onSummaryStep = await page.evaluate(() => /Your priorities,/.test(document.body.textContent || ""));
onSummaryStep ? ok("Reached the Summary step (generateActionPlan() has run)") : bad("did not reach the Summary step");

const studyGapItems = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".ob-plan-item"));
  return rows
    .filter((row) => /Study Gaps/.test(row.querySelector(".ob-plan-cat")?.textContent || ""))
    .map((row) => row.querySelector(".ob-plan-action")?.textContent || "");
});

studyGapItems.length === GAPPED.length
  ? ok(`Summary step shows exactly ${GAPPED.length} "Study Gaps" items - one per previously-gapped weak point, no duplicates or drops`)
  : bad(`expected ${GAPPED.length} "Study Gaps" items on Summary, found ${studyGapItems.length}: ${JSON.stringify(studyGapItems)}`);

for (const g of GAPPED) {
  const match = studyGapItems.find((text) => text && text.length > 0 && text.includes(g.needle));
  match
    ? ok(`"${g.id}" produced a real action-plan item on Summary ("${match}")`)
    : bad(`no Summary action item found for "${g.id}" containing "${g.needle}" - items were: ${JSON.stringify(studyGapItems)}`);
}

// ---- Save, then confirm the same 7 items round-trip through storage ----
await page.locator("button", { hasText: /Save profile & start/ }).click();
await page.waitForTimeout(500);

const savedPlan = await page.evaluate(async () => {
  const row = await window.G.db.get("kv", "guidon:profile:v1");
  return (row && row.v && row.v.actionPlan) || [];
});
const savedStudyGaps = savedPlan.filter((p) => p && p.category === "Study Gaps");

savedStudyGaps.length === GAPPED.length
  ? ok(`Saved profile's actionPlan has ${GAPPED.length} "Study Gaps" entries, matching the Summary preview`)
  : bad(`saved actionPlan Study Gaps count: ${savedStudyGaps.length}, expected ${GAPPED.length}: ${JSON.stringify(savedPlan.map((p) => p.id))}`);

for (const g of GAPPED) {
  const entry = savedPlan.find((p) => p && p.id === "weak-" + g.id);
  const hasRealRoute = entry && typeof entry.route === "string" && entry.route.startsWith("#/");
  const hasRealAction = entry && typeof entry.action === "string" && entry.action.trim().length > 0;
  entry && hasRealRoute && hasRealAction
    ? ok(`Saved actionPlan item "weak-${g.id}" exists with a real route (${entry.route}) and non-empty action text`)
    : bad(`saved actionPlan item "weak-${g.id}" missing or malformed: ${JSON.stringify(entry)}`);
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nWEAK MAP COVERAGE: all passed");
process.exit(fails ? 1 : 0);
