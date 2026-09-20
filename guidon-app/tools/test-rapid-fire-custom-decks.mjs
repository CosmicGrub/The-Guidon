/**
 * Rapid Fire's "Custom mix" deck picker (v2 candidates from
 * docs/superpowers/specs/2026-08-23-rapid-fire-design.md's own "Deferred to
 * a later pass" list: "custom category weighting" and "saved custom
 * decks"). The existing Deck/Categories <select> already covers "one
 * category at a time" (or All / Needs Work) - this is the multi-pick step
 * beyond it: checkboxes (not a native <select multiple>, whose touch multi-
 * select UX would be worse than this app's existing single-<select> row on
 * the exact devices this app targets) let a Soldier build an arbitrary mix
 * of categories, optionally saved by name via the same real
 * db.getSetting/setSetting mechanism Quiz's own per-category best score
 * already uses (rapidFire:savedDecks kv row).
 *
 * Uses the same two fixed, known-shape board-question categories
 * test-rapid-fire.mjs already verified and documents: "Army Fitness Test
 * (AFT)" (17 questions) and "Counseling (ATP 6-22.1)" (19 questions) - a
 * custom mix of both should show exactly 36 questions, a real, independent
 * arithmetic check, not just "some questions."
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { loadManifest } from "./content-manifest.mjs";
import { clickButtonByText } from "./testkit.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await dismissOnboarding(page);
await page.waitForTimeout(300);

// Start from a clean saved-decks slate - a prior run/suite leaving decks
// behind shouldn't change this file's own counts.
await page.evaluate(() => window.G.db.setSetting("rapidFire:savedDecks", []));

async function openRapidFireSetup() {
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(400);
  await clickButtonByText(page, "Board Drill");
  await page.waitForTimeout(150);
  await clickButtonByText(page, "Rapid Fire");
  await page.waitForFunction(
    () => [...document.querySelectorAll(".segmented button")].some((b) => b.textContent.trim() === "Party"),
    { timeout: 30000 }
  ).catch(() => {});
}
async function selectCustomMix() {
  return page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Filter by category"]');
    if (!sel) return false;
    const opt = [...sel.options].find((o) => o.text === "Custom mix…");
    if (!opt) return false;
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change"));
    return true;
  });
}
async function checkCategory(name, checked) {
  return page.evaluate(({ name, checked }) => {
    const cb = document.querySelector(`.rf-custom-list input[aria-label="${name}"]`);
    if (!cb) return false;
    if (cb.checked !== checked) { cb.checked = checked; cb.dispatchEvent(new Event("change", { bubbles: true })); }
    return true;
  }, { name, checked });
}
async function poolNoteText() {
  return page.evaluate(() => {
    const notes = [...document.querySelectorAll(".rf-setup-grid p.hint")];
    const n = notes.find((p) => /questions? in this deck|No questions match/.test(p.textContent));
    return n ? n.textContent : null;
  });
}
async function selectedHintText() {
  return page.evaluate(() => {
    const h = [...document.querySelectorAll(".rf-custom-decks p.hint")].find((p) => /categor(y|ies) selected|No categories selected/.test(p.textContent));
    return h ? h.textContent : null;
  });
}

// ==================== Selecting "Custom mix…" reveals the picker ====================
console.log('\n-- "Custom mix…" reveals a real checkbox picker over every category --');
await openRapidFireSetup();
// Setup's own "Difficulty band" defaults to "Match my rank" (cfg.diffMode
// "rank"), which stacks with ANY category filter including this one - AFT's
// real 17 questions are 6 beginner/11 intermediate (test-rapid-fire.mjs's
// own documented fixture), so a guest-rank default would silently narrow
// the counts below to whatever band the guest profile maps to. Switched to
// "All difficulties" so this file's own category-only assertions stay
// isolated from that separate, already-covered feature.
await clickButtonByText(page, "All difficulties");
await page.waitForTimeout(150);
const pickerHiddenBefore = await page.evaluate(() => {
  const box = document.querySelector(".rf-custom-decks");
  return !box || box.style.display === "none";
});
pickerHiddenBefore ? ok("the custom picker is hidden by default (Deck/Categories starts on 'All')") : bad("custom picker was visible before selecting 'Custom mix…'");

await selectCustomMix();
await page.waitForTimeout(200);
const pickerVisible = await page.evaluate(() => {
  const box = document.querySelector(".rf-custom-decks");
  return !!box && box.style.display !== "none";
});
pickerVisible ? ok("selecting 'Custom mix…' reveals the checkbox picker") : bad("custom picker did not appear after selecting 'Custom mix…'");

const checkboxCount = await page.evaluate(() => document.querySelectorAll(".rf-custom-list input[type=checkbox]").length);
checkboxCount > 50
  ? ok(`the picker lists a real checkbox per category (${checkboxCount} found, matching the app's own real ~78-category board-question bank)`)
  : bad("custom picker checkbox count: " + checkboxCount);

let hint = await selectedHintText();
hint === "No categories selected yet — pick at least one, or this round uses every category."
  ? ok(`starts with zero selected, and says so plainly: "${hint}"`)
  : bad('initial "selected" hint: ' + JSON.stringify(hint));

// ==================== checking 2 known categories computes a real, exact pool ====================
console.log("\n-- checking 2 known categories computes an exact, independently-verifiable pool --");
await checkCategory("Army Fitness Test (AFT)", true);
await page.waitForTimeout(150);
hint = await selectedHintText();
hint === "1 category selected."
  ? ok(`checking one category updates the live hint to "1 category selected." (singular, updates without a full re-render)`)
  : bad('hint after 1 check: ' + JSON.stringify(hint));
// Fixture-obsolescence fix (2026-09-15): the 17 / 36 literals here broke
// the moment two real counseling-process cards landed (PR #167, per the
// standing every-sourced-fact-gets-board-cards rule). Counts are now read
// live from the same tier-filtered G.store.boardQuestions() the round pool
// is built from - the "independently-verifiable sum" claim still holds
// (AFT + Counseling, computed separately, must equal the note). The typed
// floors (17 / 19) that guarded against a category silently losing cards
// are now the committed content manifest's own per-category figures
// (tools/content-manifest.json): this guest pool has no tier or MOS filter,
// so the live count must equal them exactly.
const categoryCount = (cat) => page.evaluate((c) => G.store.boardQuestions().filter((q) => q.category === c).length, cat);
const reviewedSize = loadManifest().board.byCategory;
const aftCount = await categoryCount("Army Fitness Test (AFT)");
const counselCount = await categoryCount("Counseling (ATP 6-22.1)");
let note = await poolNoteText();
(aftCount > 0 && aftCount === reviewedSize["Army Fitness Test (AFT)"] && new RegExp("^" + aftCount + " questions in this deck\\.$").test(note || ""))
  ? ok(`pool note reads "${aftCount} questions in this deck." for AFT alone, matching the real live category size and the content manifest's figure for it`)
  : bad(`pool note after 1 category (live ${aftCount}, content manifest ${reviewedSize["Army Fitness Test (AFT)"]}): ` + JSON.stringify(note));

await checkCategory("Counseling (ATP 6-22.1)", true);
await page.waitForTimeout(150);
hint = await selectedHintText();
hint === "2 categories selected."
  ? ok('checking a second category updates the hint to "2 categories selected." (plural)')
  : bad("hint after 2 checks: " + JSON.stringify(hint));
note = await poolNoteText();
const twoCatSum = aftCount + counselCount;
(counselCount > 0 && counselCount === reviewedSize["Counseling (ATP 6-22.1)"] && new RegExp("^" + twoCatSum + " questions in this deck\\.$").test(note || ""))
  ? ok(`pool note reads "${twoCatSum} questions in this deck." — the real independent sum of AFT (${aftCount}) + Counseling (${counselCount}), not a guess`)
  : bad(`pool note after 2 categories (expected ${twoCatSum} = ${aftCount} + ${counselCount}; live Counseling ${counselCount}, content manifest ${reviewedSize["Counseling (ATP 6-22.1)"]}): ` + JSON.stringify(note));

// ==================== a custom-mix round actually only draws from the checked categories ====================
console.log("\n-- starting a round with this custom mix only ever draws AFT/Counseling cards --");
await clickButtonByText(page, "Start Round");
await page.waitForTimeout(250);
if (await page.evaluate(() => !!document.querySelector(".rf-explainer"))) {
  await clickButtonByText(page, "Got it — let's go");
  await page.waitForTimeout(250);
}
await page.waitForTimeout(200);
const seenCategories = new Set();
for (let i = 0; i < 10; i++) {
  const cat = await page.evaluate(() => (document.querySelector(".kc-label") || {}).textContent || null);
  if (cat) seenCategories.add(cat);
  const stillOnRound = await page.evaluate(() => !!document.querySelector(".rf-question"));
  if (!stillOnRound) break;
  await page.evaluate(() => document.querySelector(".rf-judge-pass")?.click());
  await page.waitForTimeout(100);
}
const onlyKnownCats = [...seenCategories].every((c) => c === "Army Fitness Test (AFT)" || c === "Counseling (ATP 6-22.1)");
onlyKnownCats && seenCategories.size > 0
  ? ok(`every card drawn across 10 passes came from the custom mix only: ${JSON.stringify([...seenCategories])}`)
  : bad("categories seen during the custom-mix round: " + JSON.stringify([...seenCategories]));
await clickButtonByText(page, "End Round");
await page.waitForTimeout(200);

// ==================== Select all / Clear all ====================
console.log("\n-- 'Select all' and 'Clear all' really (de)select every checkbox --");
await clickButtonByText(page, "New Deck");
await page.waitForTimeout(300);
await selectCustomMix();
await page.waitForTimeout(200);
await clickButtonByText(page, "Select all");
await page.waitForTimeout(150);
const allChecked = await page.evaluate(() => [...document.querySelectorAll(".rf-custom-list input[type=checkbox]")].every((cb) => cb.checked));
allChecked ? ok("'Select all' checks every real category checkbox") : bad("'Select all' left some checkboxes unchecked");
hint = await selectedHintText();
new RegExp("^" + checkboxCount + " categories selected\\.$").test(hint || "")
  ? ok(`hint updates to "${checkboxCount} categories selected." after Select all`)
  : bad('hint after Select all: ' + JSON.stringify(hint));

await clickButtonByText(page, "Clear all");
await page.waitForTimeout(150);
const noneChecked = await page.evaluate(() => [...document.querySelectorAll(".rf-custom-list input[type=checkbox]")].every((cb) => !cb.checked));
noneChecked ? ok("'Clear all' unchecks every checkbox") : bad("'Clear all' left some checkboxes checked");

// ==================== saving, reloading, and deleting a named deck ====================
console.log("\n-- saving a named deck persists it to kv, survives a real re-render, and can be deleted --");
await checkCategory("Army Fitness Test (AFT)", true);
await checkCategory("Counseling (ATP 6-22.1)", true);
await page.waitForTimeout(150);
await page.evaluate(() => { const i = document.querySelector('input[aria-label="New deck name"]'); i.value = "Fitness + Counseling"; i.dispatchEvent(new Event("input", { bubbles: true })); });
await clickButtonByText(page, "Save this deck");
await page.waitForTimeout(250);

const persistedDecks = await page.evaluate(async () => window.G.db.getSetting("rapidFire:savedDecks", []));
persistedDecks.length === 1 && persistedDecks[0].name === "Fitness + Counseling" && persistedDecks[0].categories.sort().join(",") === ["Army Fitness Test (AFT)", "Counseling (ATP 6-22.1)"].sort().join(",")
  ? ok(`the named deck persists to the real "rapidFire:savedDecks" kv row: ${JSON.stringify(persistedDecks)}`)
  : bad("persisted decks after save: " + JSON.stringify(persistedDecks));

const savedChipVisible = await page.evaluate(() => [...document.querySelectorAll(".rf-custom-decks button")].some((b) => /Fitness \+ Counseling \(2\)/.test(b.textContent || "")));
savedChipVisible ? ok('a "Fitness + Counseling (2)" chip appears in the Saved decks row, showing its own category count') : bad("saved-deck chip not found after saving");

// Leave and come back — the saved deck must survive a real re-render, not just live in this render's own closure.
await clickButtonByText(page, "New Deck");
await page.waitForTimeout(300);
await openRapidFireSetup();
await selectCustomMix();
await page.waitForTimeout(200);
const chipAfterRerender = await page.evaluate(() => [...document.querySelectorAll(".rf-custom-decks button")].some((b) => /Fitness \+ Counseling \(2\)/.test(b.textContent || "")));
chipAfterRerender ? ok("the saved deck survives leaving and re-entering Rapid Fire entirely") : bad("saved deck chip did not survive re-render");

// Loading the saved deck re-checks the right boxes.
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".rf-custom-decks button")].find((b) => /Fitness \+ Counseling \(2\)/.test(b.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(200);
const loadedChecks = await page.evaluate(() => ({
  aft: document.querySelector('.rf-custom-list input[aria-label="Army Fitness Test (AFT)"]')?.checked,
  counsel: document.querySelector('.rf-custom-list input[aria-label="Counseling (ATP 6-22.1)"]')?.checked,
}));
loadedChecks.aft && loadedChecks.counsel
  ? ok("clicking the saved-deck chip re-checks exactly the categories it was saved with")
  : bad("checkbox state after loading saved deck: " + JSON.stringify(loadedChecks));

// Delete it.
await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="Delete saved deck Fitness + Counseling"]');
  if (b) b.click();
});
await page.waitForTimeout(250);
const decksAfterDelete = await page.evaluate(async () => window.G.db.getSetting("rapidFire:savedDecks", []));
decksAfterDelete.length === 0
  ? ok("deleting the saved deck removes it from the real kv row")
  : bad("decks after delete: " + JSON.stringify(decksAfterDelete));
const chipGoneVisually = await page.evaluate(() => ![...document.querySelectorAll(".rf-custom-decks button")].some((b) => /Fitness \+ Counseling/.test(b.textContent || "")));
chipGoneVisually ? ok("the deleted deck's chip disappears from the Setup screen immediately") : bad("deleted deck's chip still visible");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

// cleanup
await page.evaluate(() => window.G.db.setSetting("rapidFire:savedDecks", []));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nRAPID FIRE CUSTOM DECKS: all passed");
process.exit(fails ? 1 : 0);
