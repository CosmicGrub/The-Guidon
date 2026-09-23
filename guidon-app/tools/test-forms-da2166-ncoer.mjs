/**
 * DA Form 2166-9-2 (NCOER), the real rater/senior-rater evaluation report -
 * Forms Trainer id "da4856ncoer" (see src/app-modules/13-da2166-ncoer.js,
 * which extends that pre-existing stub entry in the assembled seed rather
 * than shipping a second, duplicate-numbered catalog card).
 *
 * WHY THIS SUITE EXISTS: without it, the seed data could carry the new Part
 * IV/Part V fields while the actual rendering, live bullet-grading reuse, or
 * the forms:saved autosave round trip silently broke - none of that would
 * be caught by a seed-shape assertion alone. This drives the real running
 * app: the catalog card and the extended field set actually render (Part
 * IV's six Leadership Requirements Model bullets + the fixed rater
 * performance scale, Part V - Senior Rater added where there was none
 * before); the "Check" self-quiz tab now exists (it only appears when
 * f.checks.length, per drawBody() in src/index.html); a real Fill-tab
 * bullet field gets LIVE strength feedback from G.writing.gradeBullet (the
 * same deterministic grader Write -> Bullet Builder uses - proves the reuse
 * the task asked for is real, not just present in a comment) and that a
 * weak bullet scores lower than a strong one; and the real "Save draft" ->
 * kv "forms:saved" -> reload -> "Open" round trip carries every new Part
 * IV/Part V value, not just the pre-existing fields.
 */
import { bootApp, check, finish, waitForRoute, until, untilAsync, clickWhenStable, waitForBoot, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

// A real, finished profile (not Guest): this suite proves a draft survives
// a real page reload, and a Guest session saves nothing on purpose.
const boot = await bootApp({ profile: { ...PERSONAL_PROFILE } });
const { page, noise } = boot;

await page.evaluate(async () => { await window.G.db.put("kv", { k: "forms:saved", value: [] }); });

// ============================================================
// 0) FIXTURE SANITY - straight off window.G.store.forms(), no rendering
//    involved. Catches a data-shape regression before any DOM assertion
//    would, and proves the catalog total is UNCHANGED (this pack extends
//    an existing entry in place, it does not add a 35th form).
// ============================================================
const fixture = await page.evaluate(() => {
  const d = window.G.store.forms();
  const f = (d.forms || []).find((x) => x.id === "da4856ncoer");
  if (!f) return { found: false };
  const fieldIds = (sec) => (sec ? sec.fields.map((fl) => fl.id) : null);
  const partIV = f.sections.find((s) => /Part IV/.test(s.name));
  const partV = f.sections.find((s) => /Part V/.test(s.name));
  return {
    found: true,
    totalForms: d.forms.length,
    form: f.form,
    partIVName: partIV && partIV.name,
    partIVFieldIds: fieldIds(partIV),
    partVName: partV && partV.name,
    partVFieldIds: fieldIds(partV),
    overallOptions: partIV && partIV.fields.find((fl) => fl.id === "overall").options,
    potentialOptions: partV && partV.fields.find((fl) => fl.id === "potential").options,
    checksCount: (f.checks || []).length,
  };
});

check(fixture.found, 'fixture sanity: forms catalog still carries id "da4856ncoer"', 'fixture sanity: "da4856ncoer" not found in window.G.store.forms()');
// One fixed reference point ("34 forms in this trainer") - not a bank-of-
// questions count the content pipeline grows; this pack extends an EXISTING
// entry in place, so the real regression this guards is a 35th card ever
// appearing (the whole point of extending in place, not duplicating).
const EXPECTED_FORM_COUNT = 34;
check(fixture.totalForms === EXPECTED_FORM_COUNT, "fixture sanity: the forms catalog still has exactly " + EXPECTED_FORM_COUNT + " forms (extended in place, not a 35th card)", () => "forms catalog count: " + fixture.totalForms);
check(fixture.form === "DA Form 2166-9-2", "the entry's real form number is DA Form 2166-9-2", () => "form number: " + JSON.stringify(fixture.form));
check(JSON.stringify(fixture.partIVFieldIds) === JSON.stringify(["character", "presence", "intellect", "overall", "leads", "develops", "achieves", "raterComments"]),
  "Part IV carries all six Leadership Requirements Model bullets (Character/Presence/Intellect/Leads/Develops/Achieves) plus the overall-performance box and mandatory rater comments, in order",
  () => "Part IV field ids: " + JSON.stringify(fixture.partIVFieldIds));
check(JSON.stringify(fixture.overallOptions) === JSON.stringify(["Far Exceeded Standard", "Exceeded Standard", "Met Standard", "Did Not Meet Standard"]),
  "the rater's overall-performance scale is the real 4-tier PERFORMANCE scale (not the senior rater's potential scale it used to be mislabeled with)",
  () => "rater overall options: " + JSON.stringify(fixture.overallOptions));
check(fixture.partVName === "Part V — Senior Rater Assessment", "Part V - Senior Rater Assessment now exists (this stub had no Part V at all before)", () => "Part V section name: " + JSON.stringify(fixture.partVName));
check(JSON.stringify(fixture.partVFieldIds) === JSON.stringify(["potential", "srComments"]), "Part V carries the senior rater's potential box and mandatory comments", () => "Part V field ids: " + JSON.stringify(fixture.partVFieldIds));
check(JSON.stringify(fixture.potentialOptions) === JSON.stringify(["Most Qualified", "Highly Qualified", "Qualified", "Not Qualified"]),
  "the senior rater's potential scale is the real 4-tier POTENTIAL scale", () => "senior rater potential options: " + JSON.stringify(fixture.potentialOptions));
const expectChecks = fixture.checksCount; // read from the live app, not typed here - see the (c) literal-deck-size rule this avoids by construction
check(expectChecks > 0, "the entry carries a non-empty set of real self-quiz checks (" + expectChecks + ")", "the entry carries no self-quiz checks at all");

// ============================================================
// 1) CATALOG + DETAIL - open the real card, confirm the Check tab exists
//    now that f.checks.length > 0 (drawBody()'s own condition).
// ============================================================
await waitForRoute(page, "#/forms", { ready: 'input[aria-label="Search forms"]' });
await page.fill('input[aria-label="Search forms"]', "SSG-1SG/MSG");
const narrowed = await until(page, () => {
  const cards = document.querySelectorAll(".form-card");
  return cards.length === 1 && cards[0].querySelector(".form-title")?.textContent === "NCOER (SSG-1SG/MSG Rank) – Report";
});
const searchState = await page.evaluate(() => ({
  cards: document.querySelectorAll(".form-card").length, title: document.querySelector(".form-title")?.textContent,
}));
check(narrowed, "searching narrows to the real DA Form 2166-9-2 card alone", () => "search state: " + JSON.stringify(searchState));

await clickWhenStable(page, page.locator(".form-card").first());
const detailOpened = await until(page, () => document.querySelectorAll(".segmented button").length > 0 && /DA Form 2166-9-2/.test(document.querySelector(".forms-view .section-title")?.textContent || ""));
check(detailOpened, "opening the card navigates to the real form's detail view", "the DA Form 2166-9-2 detail view never rendered");

const tabs = await page.evaluate(() => Array.from(document.querySelectorAll(".segmented button")).map((b) => b.textContent));
check(JSON.stringify(tabs) === JSON.stringify(["Guided", "Form", "Fill", "Check"]),
  "tab bar shows Guided/Form/Fill/Check (no bullet libraries on this form, but real checks now exist)", () => "tabs: " + JSON.stringify(tabs));

// ============================================================
// 2) GUIDED TAB - Part IV / Part V both actually render as real sections.
// ============================================================
await clickWhenStable(page, page.locator(".segmented button", { hasText: /^Guided$/ }));
const guidedReady = await until(page, () => {
  const titles = [...document.querySelectorAll(".section-title.sub")].map((h) => h.textContent || "");
  return titles.some((t) => /^Part IV/.test(t)) && titles.some((t) => /^Part V/.test(t));
});
const guidedSectionTitles = await page.evaluate(() => Array.from(document.querySelectorAll(".section-title.sub")).map((h) => h.textContent));
check(guidedReady, "Guided tab renders both the real Part IV and Part V - Senior Rater Assessment section headings", () => "guided section titles: " + JSON.stringify(guidedSectionTitles));

// ============================================================
// 3) CHECK TAB - the self-quiz cards actually render and reveal.
// ============================================================
await clickWhenStable(page, page.locator(".segmented button", { hasText: /^Check$/ }));
await until(page, () => document.querySelectorAll(".kc-label").length > 0);
const checkCardTexts = await page.evaluate(() => Array.from(document.querySelectorAll(".kc-label")).map((el) => el.textContent));
check(checkCardTexts.length === expectChecks, "Check tab renders all " + expectChecks + " real self-quiz cards", () => "check card count: " + checkCardTexts.length);
check(checkCardTexts.some((t) => /RATER evaluate performance or potential/.test(t)), "the real performance-vs-potential question is among the check cards", () => "check questions: " + JSON.stringify(checkCardTexts));

await clickWhenStable(page, page.locator(".example-chip", { hasText: /^Reveal$/ }).first());
const revealed = await until(page, () => /Far Exceeded\/Exceeded\/Met\/Did Not Meet Standard/.test(document.querySelector(".ex")?.textContent || ""));
const revealedAnswer = await page.evaluate(() => document.querySelector(".ex")?.textContent || "");
check(revealed, "revealing the first check shows the real performance-scale answer", () => "revealed answer: " + JSON.stringify(revealedAnswer));

// ============================================================
// 4) FILL TAB - all real fields render, in order, across Administrative +
//    Part IV + Part V (built from the fixture's own field ids, not a
//    hand-typed literal list).
// ============================================================
await clickWhenStable(page, page.locator(".segmented button", { hasText: /^Fill$/ }));
const EXPECTED_FILL_IDS = ["name", "rank", "period", "reason"].concat(fixture.partIVFieldIds || []).concat(fixture.partVFieldIds || []);
const fillReady = await until(page, (n) => document.querySelectorAll(".field").length === n, EXPECTED_FILL_IDS.length);
const fillFieldIds = await page.evaluate(() => Array.from(document.querySelectorAll(".field")).map((f) => f.getAttribute("data-fid")));
check(fillReady && JSON.stringify(fillFieldIds) === JSON.stringify(EXPECTED_FILL_IDS),
  "Fill tab renders one real field row per authored field, in order, across Administrative + Part IV + Part V",
  () => "fill field ids: " + JSON.stringify(fillFieldIds) + ", expected " + JSON.stringify(EXPECTED_FILL_IDS));

// ============================================================
// 5) LIVE BULLET GRADING - reuses G.writing.gradeBullet (Write -> Bullet
//    Builder's own grader), not a parallel one: a weak bullet must score
//    lower than a strong one, and the on-screen number must MATCH calling
//    G.writing.gradeBullet directly - proving the UI is really wired to
//    that function, not just printing a made-up number nearby.
// ============================================================
const CHAR_ROW = '.field[data-fid="character"]';
const CHAR_TA = CHAR_ROW + " textarea.in";
function readBulletHint(fieldSel) {
  return page.evaluate((sel) => {
    const row = document.querySelector(sel);
    const hints = row ? [...row.querySelectorAll(".hint")] : [];
    return hints.map((h) => h.textContent).find((t) => /Bullet strength/.test(t || "")) || "";
  }, fieldSel);
}

const WEAK_BULLET = "was responsible for morale";
await page.fill(CHAR_TA, WEAK_BULLET);
const weakShown = await until(page, (sel) => {
  const row = document.querySelector(sel);
  const hints = row ? [...row.querySelectorAll(".hint")] : [];
  return hints.some((h) => /Bullet strength/.test(h.textContent || ""));
}, CHAR_ROW);
const weakFeedback = await readBulletHint(CHAR_ROW);
check(weakShown && /Bullet strength \(same grader as Write . Bullet Builder\)/.test(weakFeedback),
  'a weak bullet shows live "Bullet strength (same grader as Write → Bullet Builder)" feedback under the field',
  () => "weak-bullet feedback text: " + JSON.stringify(weakFeedback));

const weakScoreMatch = weakFeedback.match(/(\d+)\/100/);
const uiWeakScore = weakScoreMatch && Number(weakScoreMatch[1]);
const directWeakScore = await page.evaluate((text) => window.G.writing.gradeBullet(text).score, WEAK_BULLET);
check(uiWeakScore === directWeakScore,
  "the live score for the weak bullet (" + uiWeakScore + "/100) matches calling G.writing.gradeBullet() directly - the reuse is real",
  () => "UI weak score " + uiWeakScore + " vs direct G.writing.gradeBullet() score " + directWeakScore);

const STRONG_BULLET = "Reported a $40,000 supply discrepancy against own accountability; recovered 100% of the loss within 72 hours";
await page.fill(CHAR_TA, STRONG_BULLET);
const changed = await until(page, ({ sel, prev }) => {
  const row = document.querySelector(sel);
  const hints = row ? [...row.querySelectorAll(".hint")] : [];
  const hit = hints.map((h) => h.textContent).find((t) => /Bullet strength/.test(t || "")) || "";
  return !!hit && hit !== prev;
}, { sel: CHAR_ROW, prev: weakFeedback });
const strongFeedback = await readBulletHint(CHAR_ROW);
const strongScoreMatch = strongFeedback.match(/(\d+)\/100/);
const uiStrongScore = strongScoreMatch && Number(strongScoreMatch[1]);
check(changed && uiStrongScore !== null && uiWeakScore !== null && uiStrongScore > uiWeakScore,
  "a stronger, quantified bullet scores higher live (" + uiStrongScore + "/100) than the weak one (" + uiWeakScore + "/100) - the grader is genuinely reacting to content, not a static placeholder",
  () => "strong feedback: " + JSON.stringify(strongFeedback));

// A field with no per-form dynamics attached (e.g. the plain text "rank"
// field) must NOT grow a spurious "Bullet strength" hint - proves the
// wiring is scoped to the real bullet fields, not accidentally global.
const rankHasGradeHint = await page.evaluate(() => {
  const row = document.querySelector('.field[data-fid="rank"]');
  return Array.from(row.querySelectorAll(".hint")).some((h) => /Bullet strength/.test(h.textContent || ""));
});
check(rankHasGradeHint === false, 'the non-bullet "rank" field never grows a "Bullet strength" hint', 'the "rank" field unexpectedly shows bullet-grading feedback');

// ============================================================
// 6) SAVE DRAFT -> kv "forms:saved" -> RELOAD -> "Open": every new Part
//    IV/Part V value round-trips, not just the pre-existing fields.
// ============================================================
const MARK = "QA" + Date.now();
await page.fill('.field[data-fid="name"] input.in', "TESTFIRE, PAT J.");
await page.fill('.field[data-fid="rank"] input.in', "SSG / E-6 " + MARK);
await page.locator('.field[data-fid="overall"] select.in').selectOption("Exceeded Standard");
await page.fill('.field[data-fid="presence"] textarea.in', "Physically fit and composed leading a night convoy through a sudden IED threat");
await page.fill('.field[data-fid="intellect"] textarea.in', "Redesigned the maintenance tracker; cut parts-request turnaround by 30 percent");
await page.locator('.field[data-fid="potential"] select.in').selectOption("Most Qualified");
await page.fill('.field[data-fid="srComments"] textarea.in', "Best of the SSGs senior-rated this period " + MARK);

await clickWhenStable(page, page.locator("button", { hasText: /^Save draft$/ }));
const savedLanded = await untilAsync(page, async () => {
  const kv = await window.G.db.get("kv", "forms:saved");
  const rows = (kv && kv.value) || [];
  return rows.some((r) => r.formId === "da4856ncoer");
});
check(savedLanded, 'Save draft persists a real row for formId "da4856ncoer" into kv "forms:saved"', 'no saved "da4856ncoer" row appeared in kv "forms:saved" within the wait budget');

const savedRow = await page.evaluate(async () => {
  const kv = await window.G.db.get("kv", "forms:saved");
  const rows = (kv && kv.value) || [];
  return rows.find((r) => r.formId === "da4856ncoer") || null;
});
check(!!(savedRow && savedRow.values &&
  savedRow.values.overall === "Exceeded Standard" &&
  savedRow.values.potential === "Most Qualified" &&
  Array.isArray(savedRow.values.presence) && savedRow.values.presence[0] === "Physically fit and composed leading a night convoy through a sudden IED threat" &&
  Array.isArray(savedRow.values.intellect) && savedRow.values.intellect.length === 1 &&
  Array.isArray(savedRow.values.srComments) && savedRow.values.srComments[0].includes(MARK) &&
  savedRow.values.rank.includes(MARK)),
  "the persisted draft's real Part IV (overall/presence/intellect) AND Part V (potential/srComments) values all match what was typed",
  () => "persisted draft values: " + JSON.stringify(savedRow && savedRow.values));

await page.reload({ waitUntil: "load" });
await waitForBoot(page);
const overlayAfterReload = await page.locator("#ob-overlay").count();
check(overlayAfterReload === 0, "reloading keeps the seeded owner profile signed in - no onboarding overlay reappears", () => "overlay count after reload: " + overlayAfterReload);

await waitForRoute(page, "#/forms", { ready: 'input[aria-label="Search forms"]', fresh: true });
const draftsShown = await until(page, () => !![...document.querySelectorAll(".section-title.sub")].find((h) => /Saved practice drafts/.test(h.textContent || "")));
check(draftsShown, "'Saved practice drafts' section appears in the catalog after a real page reload (real IndexedDB persistence)", "no 'Saved practice drafts' section appeared after reload");

const draftsGrid = page.locator(".section-title.sub", { hasText: /Saved practice drafts/ }).locator("xpath=following-sibling::div[1]");
await clickWhenStable(page, draftsGrid.locator("button", { hasText: /^Open$/ }).first());
const reopened = await until(page, () => document.querySelector(".segmented button.active")?.textContent === "Fill" && !!document.querySelector('.field[data-fid="rank"] input.in')?.value);
const reopenedValues = await page.evaluate(() => ({
  activeTab: document.querySelector(".segmented button.active")?.textContent,
  rank: document.querySelector('.field[data-fid="rank"] input.in')?.value,
  overall: document.querySelector('.field[data-fid="overall"] select.in')?.value,
  potential: document.querySelector('.field[data-fid="potential"] select.in')?.value,
  srComments: document.querySelector('.field[data-fid="srComments"] textarea.in')?.value,
}));
check(reopened && reopenedValues.activeTab === "Fill", "'Open' on the reloaded draft jumps straight to its Fill tab", () => "reopened active tab: " + JSON.stringify(reopenedValues.activeTab));
check(!!(reopenedValues.rank && reopenedValues.rank.includes(MARK) && reopenedValues.overall === "Exceeded Standard" && reopenedValues.potential === "Most Qualified" && reopenedValues.srComments && reopenedValues.srComments.includes(MARK)),
  "after a real page reload, the reopened draft's Part IV and Part V values round-trip correctly into the Fill tab",
  () => "reopened field values: " + JSON.stringify(reopenedValues));

expectNoConsoleNoise(noise, { ignore: [/favicon/] });
await finish("FORMS DA 2166-9-2 NCOER");
