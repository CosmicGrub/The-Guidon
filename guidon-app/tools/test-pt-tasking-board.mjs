/**
 * PT Planner Phase B: the Tasking Board layout (Mission Library staging, Week Board assignment, hard:recovery guard)
 *
 * WHY THIS SUITE EXISTS: ROADMAP 3g "customizable screen layouts" Phase B
 * (src/app-modules/pt-planner.js renderTaskingBoard()) adds a third
 * PT-Planner-ONLY layout on top of Phase A's LAYOUTS registry - a company-
 * ops-board metaphor where a "Mission Library" of sessions is staged one at
 * a time onto a 7-day "Week Board". None of the existing suites would catch
 * a regression here: test-pt-planner-behaviour.mjs and test-module-contract
 * never touch a non-"classic" layout, and test-screen-layouts.mjs (Phase A)
 * only knows about "shared-grid". Without this suite, a broken Tasking
 * Board - the Settings option missing, staging that never shows an Assign
 * button, an Assign that writes to the wrong day or never persists, a
 * hard:recovery guard that silently duplicates (and drifts from) Classic's
 * own ratioOf()/countsLine()/ratioMessage() text, or an action that drops
 * keyboard focus to <body> - would ship unnoticed.
 *
 * Started with tools/new-suite.mjs pt-tasking-board. The house rules it
 * starts you with (tools/lint-test-hygiene.mjs holds a new suite to all of
 * them):
 *   - no fixed sleeps: waitForRoute(page, hash, { ready }), until(page, fn),
 *     clickWhenStable(page, target) wait for the STATE instead;
 *   - no swallowed waits: until() returns true/false - assert on what follows;
 *   - one browser: bootApp() once;
 *   - drive the real screen (Settings' own <select>, the real chip/Assign
 *     buttons), never stub the thing under test, and end with the
 *     zero-console-noise check.
 */
import { bootApp, check, finish, waitForRoute, clickWhenStable, until, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

const boot = await bootApp({ viewport: { width: 1024, height: 900 }, profile: PERSONAL_PROFILE });
const { page, noise } = boot;

const PT_SEL = 'select[aria-label="PT Planner layout"]';
const live = () => page.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");

/* ---- 1) Settings: Phase B registered a real "Tasking Board" option, and choosing it persists ---- */
await waitForRoute(page, "#/settings", { ready: PT_SEL });
const options = await page.locator(PT_SEL).locator("option").allTextContents();
check(options.includes("Tasking Board"), "PT Planner layout offers a \"Tasking Board\" option (LAYOUTS is read dynamically by the picker)", () => JSON.stringify(options));

await page.locator(PT_SEL).selectOption({ value: "tasking-board" });
let settled = await until(page, () => window.G.store.settings().ptPlannerLayout === "tasking-board");
check(settled, "choosing \"Tasking Board\" persists ptPlannerLayout=\"tasking-board\"");

/* ---- 2) PT Planner renders the Tasking Board layout, not Classic ---- */
await waitForRoute(page, "#/pt-plan", { ready: "[data-tb-week]", fresh: true });
const markers = await page.evaluate(() => ({
  library: !!document.querySelector("[data-tb-library]"),
  week: !!document.querySelector("[data-tb-week]"),
  guard: !!document.querySelector("[data-tb-guard]"),
  classic: document.querySelectorAll("[data-pt-week], [data-pt-month], [data-pt-day], [data-pt-stage]").length,
}));
check(markers.library && markers.week && markers.guard, "Mission Library, Week Board and the guard panel all render", () => JSON.stringify(markers));
check(markers.classic === 0, "Classic-only PT Planner markup is not present while Tasking Board is active", () => JSON.stringify(markers));

/* ---- 3) Mission Library: one chip per PRESETS entry, effort is never color-only ---- */
const presetIds = await page.evaluate(() => Object.keys(window.G.ptPlanner.PRESETS));
const chipsBoot = await page.evaluate(() => [...document.querySelectorAll("[data-tb-chip]")].map((b) => ({
  id: b.getAttribute("data-tb-chip"), text: b.textContent, pressed: b.getAttribute("aria-pressed"),
})));
check(chipsBoot.length === presetIds.length && presetIds.every((id) => chipsBoot.some((c) => c.id === id)),
  "the Mission Library has one chip per real PRESETS entry (" + presetIds.length + ")", () => JSON.stringify({ presetIds, chipsBoot }));
check(chipsBoot.every((c) => /HARD|MODERATE|RECOVERY/.test(c.text)), "every chip shows its effort as a real word (HARD/MODERATE/RECOVERY), not color alone", () => JSON.stringify(chipsBoot));
check(chipsBoot.every((c) => c.pressed === "false"), "no chip starts staged", () => JSON.stringify(chipsBoot));

/* ---- 4) Week Board shows the real current-week assignment (the default "Balanced week" template) ---- */
const dayKeysRendered = await page.evaluate(() => [...document.querySelectorAll("[data-tb-day]")].map((c) => c.getAttribute("data-tb-day")));
check(JSON.stringify(dayKeysRendered) === JSON.stringify(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]),
  "the Week Board draws all 7 days, sun..sat (the order plan.days already uses)", () => JSON.stringify(dayKeysRendered));

const weekCheck = await page.evaluate(() => {
  const expected = window.G.ptPlanner._planFromTemplate("balanced").days;
  const rendered = {};
  document.querySelectorAll("[data-tb-day]").forEach((col) => { rendered[col.getAttribute("data-tb-day")] = col.textContent; });
  const mismatches = Object.keys(expected).filter((k) => !rendered[k] || rendered[k].indexOf(expected[k].title) === -1);
  return { ok: mismatches.length === 0, expected, rendered, mismatches };
});
check(weekCheck.ok, "the Week Board shows the real current-week session for every day (the default \"Balanced week\" template)", () => JSON.stringify(weekCheck));

/* ---- 5) Staging a Mission Library chip: visible STAGED pill, aria-pressed, real live announcement, Assign buttons appear ---- */
await clickWhenStable(page, '[data-tb-chip="recovery"]');
let stagedOn = await until(page, () => (document.querySelector('[data-tb-chip="recovery"]') || {}).getAttribute("aria-pressed") === "true");
check(stagedOn, "tapping a chip stages it (aria-pressed=\"true\")");
const stagedBadgeCount = await page.locator('[data-tb-chip="recovery"] .badge').count();
check(stagedBadgeCount === 1, "the staged chip shows a visible \"STAGED\" pill (never color-only)");
// util.announce() clears the live region then sets it 30ms later (so a
// screen reader re-announces even an identical message) - wait for the real
// text with until(), don't race that timer with a bare read.
let liveStagedOk = await until(page, () => /recovery \/ mobility staged/i.test((document.getElementById("a11y-live") || {}).textContent || ""));
let liveStagedText = await live();
check(liveStagedOk, "staging announces through the app's real live region (util.announce -> #a11y-live, the same say() renderClassic() uses)", () => JSON.stringify(liveStagedText));
const assignCountStaged = await page.locator("[data-tb-assign]").count();
check(assignCountStaged === 7, "every one of the 7 day columns grows an Assign button once a chip is staged", () => "count=" + assignCountStaged);

/* ---- Un-staging: tapping the same chip again clears it, announces, focus never drops to <body> ---- */
await clickWhenStable(page, '[data-tb-chip="recovery"]');
let stagedOff = await until(page, () => (document.querySelector('[data-tb-chip="recovery"]') || {}).getAttribute("aria-pressed") === "false");
check(stagedOff, "tapping the staged chip again un-stages it (aria-pressed=\"false\")");
const assignCountUnstaged = await page.locator("[data-tb-assign]").count();
check(assignCountUnstaged === 0, "un-staging removes every Assign button", () => "count=" + assignCountUnstaged);
let liveUnstagedOk = await until(page, () => /un-staged/i.test((document.getElementById("a11y-live") || {}).textContent || ""));
let liveUnstagedText = await live();
check(liveUnstagedOk, "un-staging is announced too, not silently", () => JSON.stringify(liveUnstagedText));
let focusAfterUnstage = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-tb-chip"));
check(focusAfterUnstage === "recovery", "focus returns to the chip itself after un-staging, never drops to <body>", () => String(focusAfterUnstage));

/* ---- 6) Stage + Assign actually persists: writes the day, clears staging, announces, focuses the day, survives reload ---- */
await clickWhenStable(page, '[data-tb-chip="recovery"]');
await until(page, () => document.querySelectorAll("[data-tb-assign]").length === 7);
await clickWhenStable(page, '[data-tb-assign="sun"]');
let assigned = await until(page, () => {
  const col = document.querySelector('[data-tb-day="sun"]');
  return !!col && /Recovery \/ mobility/.test(col.textContent) && document.querySelectorAll("[data-tb-assign]").length === 0;
});
check(assigned, "assigning writes the staged session into that day's slot (Sunday) and clears staging everywhere");
let liveAssignedOk = await until(page, () => /Sunday assigned Recovery \/ mobility/i.test((document.getElementById("a11y-live") || {}).textContent || ""));
let liveAssignedText = await live();
check(liveAssignedOk, "assigning announces which day got which session", () => JSON.stringify(liveAssignedText));
let focusAfterAssign = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-tb-day"));
check(focusAfterAssign === "sun", "focus lands on the day column that was just assigned, never <body>", () => String(focusAfterAssign));

const storedSunBeforeReload = await page.evaluate(async () => {
  const plan = await window.G.db.getSetting(window.G.ptPlanner.KEY, null);
  return plan && plan.days && plan.days.sun && plan.days.sun.title;
});
check(storedSunBeforeReload === "Recovery / mobility", "the assignment reached real storage via savePlan() - the exact function renderClassic()'s own commit() calls", () => String(storedSunBeforeReload));

await page.reload({ waitUntil: "load" });
await waitForRoute(page, "#/pt-plan", { ready: '[data-tb-day="sun"]', fresh: true });
let sunAfterReload = await page.evaluate(() => (document.querySelector('[data-tb-day="sun"]') || {}).textContent || "");
check(/Recovery \/ mobility/.test(sunAfterReload), "Sunday's new assignment survives a reload", () => sunAfterReload);

/* ---- 7) Guard: a real 3-hard-days-in-a-row scenario raises the SAME hard:recovery flag Classic computes ---- */
await page.evaluate(async () => {
  // 3 hard days (mon/wed/fri), 4 moderate ("custom") days, zero recovery/rest:
  // guardFrom()'s relief bucket is 0, so warn = hard >= 3 = true. Minimal
  // entries only - normalizeEntry() rebuilds every non-"custom" one fresh
  // from PRESETS by id, ignoring any other field in the seed.
  const plan = {
    version: 1, templateId: "balanced", weekStart: "sun", overrides: {},
    days: {
      sun: { id: "custom" }, mon: { id: "strength" }, tue: { id: "custom" },
      wed: { id: "endurance" }, thu: { id: "custom" }, fri: { id: "circuit" }, sat: { id: "custom" },
    },
  };
  await window.G.db.setSetting(window.G.ptPlanner.KEY, plan);
});
await waitForRoute(page, "#/pt-plan", { ready: "[data-tb-guard]", fresh: true });

const guard = await page.evaluate(() => ({
  seg: [...document.querySelectorAll(".tb-guard-seg")].map((s) => s.getAttribute("style") || ""),
  text: (document.querySelector("[data-tb-guard]") || {}).textContent || "",
}));
const redSegs = guard.seg.filter((s) => /var\(--red\)/.test(s)).length;
const cyanSegs = guard.seg.filter((s) => /var\(--cyan\)/.test(s)).length;
check(guard.seg.length === 7 && redSegs === 3 && cyanSegs === 4,
  "the 7-segment guard strip colors exactly the 3 hard days red and the 4 moderate days cyan (--red/--cyan tokens)", () => JSON.stringify(guard.seg));
check(/3 hard/.test(guard.text), "the accessible text panel states the real hard count in words, never color-only", () => guard.text);
check(/Flag:/.test(guard.text), "3 hard sessions with zero recovery/rest raises the real hard:recovery flag (ratioOf(), reused unchanged from renderClassic())", () => guard.text);

const dayWords = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll("[data-tb-day]").forEach((c) => { out[c.getAttribute("data-tb-day")] = c.textContent; });
  return out;
});
check(["mon", "wed", "fri"].every((k) => /HARD/.test(dayWords[k])) && ["sun", "tue", "thu", "sat"].every((k) => /MODERATE/.test(dayWords[k])),
  "each Week Board day also shows its own effort as a real word, matching the guard strip's colors", () => JSON.stringify(dayWords));

/* ---- 8) Switching back to Classic restores the original view, zero regression ---- */
await waitForRoute(page, "#/settings", { ready: PT_SEL, fresh: true });
await page.locator(PT_SEL).selectOption({ value: "classic" });
await until(page, () => window.G.store.settings().ptPlannerLayout === "classic");

await waitForRoute(page, "#/pt-plan", { ready: '[role="tablist"][aria-label="PT planner view"]', fresh: true });
const classicBack = await page.evaluate(() => ({
  tabs: document.querySelectorAll('[role="tablist"][aria-label="PT planner view"] button').length,
  weekGrid: !!document.querySelector("[data-pt-week]"),
  tb: document.querySelectorAll("[data-tb-content]").length,
  ratioText: (document.querySelector("[data-pt-ratio]") || {}).textContent || "",
}));
check(classicBack.tabs === 3 && classicBack.weekGrid, "switching PT Planner back to Classic restores the Day/Week/Month tablist", () => JSON.stringify(classicBack));
check(classicBack.tb === 0, "...and every Tasking Board node is gone", () => JSON.stringify(classicBack));
check(classicBack.ratioText.length > 0 && /hard/i.test(classicBack.ratioText),
  "Classic's own hard:recovery panel still renders real text (the countsLine()/ratioMessage() extraction did not change its behavior)", () => classicBack.ratioText);

/* ---- 9) Zero console noise across the whole round trip ---- */
expectNoConsoleNoise(noise);

await finish("PT TASKING BOARD");
