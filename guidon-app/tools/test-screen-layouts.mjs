/**
 * ROADMAP 3g "customizable screen layouts", Phase A: Settings' new "Screen
 * Layouts" pickers (ptPlannerLayout/calendarLayout settings), and the
 * "shared-grid" layout both PT Planner and Career Calendar can render
 * through (G.dateGrid.renderWeek, src/app-modules/date-grid.js).
 *
 * WHY THIS SUITE EXISTS: PT Planner's and Career Calendar's own render()
 * now dispatch through a small id -> {label, render} LAYOUTS registry
 * instead of one hardcoded view - a regression that silently broke the
 * dispatcher (wrong default, a setting that never persists, a layout that
 * renders the wrong screen's data) would not be caught by
 * test-pt-planner-behaviour.mjs / test-calendar.mjs, which only ever
 * exercise the "classic" layout (the default, so those suites' own boots
 * never touch this code path at all).
 *
 * Started with tools/new-suite.mjs screen-layouts. House rules
 * (tools/lint-test-hygiene.mjs holds this suite to all of them):
 *   - no fixed sleeps: waitForRoute(page, hash, { ready }), until(page, fn)
 *     wait for the STATE instead;
 *   - no swallowed waits: until() returns true/false - assert on what follows;
 *   - one browser: bootApp() once;
 *   - drive the real screen (Settings' own <select>s), never stub the thing
 *     under test.
 */
import { bootApp, ok, bad, check, finish, waitForRoute, until, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

/** YYYY-MM-DD for "n days from today", computed the same way a Soldier would. */
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A board date 2 days out guarantees Career Calendar's shared-grid has a
// real titled cell within its 7-day window regardless of what day this
// suite happens to run on (the promotion-month-cutoff/Credentialing
// Assistance fixed anchors alone aren't reliably inside any given 7-day
// window, but a profile-sourced board date always lands on its own exact
// day with no months-math involved).
const boot = await bootApp({
  viewport: { width: 1024, height: 900 },
  profile: Object.assign({}, PERSONAL_PROFILE, { boardDate: daysFromNow(2) }),
});
const { page, noise } = boot;

const PT_SEL = 'select[aria-label="PT Planner layout"]';
const CAL_SEL = 'select[aria-label="Career Calendar layout"]';

/* ---- 1) Settings: both pickers exist, offering Classic + a Shared grid option ---- */
await waitForRoute(page, "#/settings", { ready: PT_SEL });

const ptSelCount = await page.locator(PT_SEL).count();
check(ptSelCount === 1, "Settings has a \"PT Planner layout\" select", () => "count=" + ptSelCount);
const calSelCount = await page.locator(CAL_SEL).count();
check(calSelCount === 1, "Settings has a \"Career Calendar layout\" select", () => "count=" + calSelCount);

const ptOptions = await page.locator(PT_SEL).locator("option").allTextContents();
check(ptOptions.includes("Classic") && ptOptions.some((t) => /shared grid/i.test(t)),
  "PT Planner layout offers Classic and a Shared grid option", () => JSON.stringify(ptOptions));

const calOptions = await page.locator(CAL_SEL).locator("option").allTextContents();
check(calOptions.includes("Classic") && calOptions.some((t) => /shared grid/i.test(t)),
  "Career Calendar layout offers Classic and a Shared grid option", () => JSON.stringify(calOptions));

// Both start on "classic" (DEFAULT_SETTINGS) for a fresh profile.
const startValues = await page.evaluate(() => {
  const s = window.G.store.settings();
  return { pt: s.ptPlannerLayout, cal: s.calendarLayout };
});
check(startValues.pt === "classic" && startValues.cal === "classic",
  "both layout settings default to \"classic\" for a fresh profile", () => JSON.stringify(startValues));

/* ---- 2) Choosing "Shared grid" persists the setting ---- */
const ptSharedLabel = await page.locator(PT_SEL).locator('option[value="shared-grid"]').textContent();
await page.locator(PT_SEL).selectOption({ value: "shared-grid" });
let settled = await until(page, () => window.G.store.settings().ptPlannerLayout === "shared-grid");
let ptLayoutNow = await page.evaluate(() => window.G.store.settings().ptPlannerLayout);
check(settled, "choosing \"" + ptSharedLabel + "\" persists ptPlannerLayout=\"shared-grid\"",
  () => "settings.ptPlannerLayout=" + JSON.stringify(ptLayoutNow));

const calSharedLabel = await page.locator(CAL_SEL).locator('option[value="shared-grid"]').textContent();
await page.locator(CAL_SEL).selectOption({ value: "shared-grid" });
settled = await until(page, () => window.G.store.settings().calendarLayout === "shared-grid");
check(settled, "choosing \"" + calSharedLabel + "\" persists calendarLayout=\"shared-grid\"");

// Survives a reload (the same real "settings" kv row every other setting
// uses). setSetting() debounces its whole-row save 300ms (src/index.html's
// debouncedSettingsSave) - waits for the REAL state (both keys gone from
// store._dirtySettingsKeys(), the same "has the pending write actually
// landed" signal src/xwin.js's own cross-context bus relies on) rather than
// a blind sleep, so this can never race a slow CI runner.
const flushed = await until(page, () => {
  const dirty = window.G.store._dirtySettingsKeys();
  return dirty.indexOf("ptPlannerLayout") === -1 && dirty.indexOf("calendarLayout") === -1;
}, null, { timeout: 5000 });
check(flushed, "the debounced settings save lands before reload (store._dirtySettingsKeys() clears)");
await page.reload({ waitUntil: "load" });
await waitForRoute(page, "#/settings", { ready: PT_SEL, fresh: true });
const afterReload = await page.evaluate(() => {
  const s = window.G.store.settings();
  return { pt: s.ptPlannerLayout, cal: s.calendarLayout };
});
check(afterReload.pt === "shared-grid" && afterReload.cal === "shared-grid",
  "both layout choices survive a reload", () => JSON.stringify(afterReload));

/* ---- 3) PT Planner renders the shared-grid layout with correct data ---- */
await waitForRoute(page, "#/pt-plan", { ready: ".date-grid-row", fresh: true });

const ptGrid = await page.evaluate(() => ({
  cols: document.querySelectorAll(".date-grid-col").length,
  switcherLabels: [...document.querySelectorAll(".date-grid-switch button")].map((b) => b.textContent.trim()),
  activeLabel: (document.querySelector(".date-grid-switch button.active") || {}).textContent,
  titledCells: document.querySelectorAll(".date-grid-title").length,
  classicMarkers: document.querySelectorAll("[data-pt-week], [data-pt-month], [data-pt-day], [data-pt-stage]").length,
}));
check(ptGrid.cols === 7, "PT Planner's shared-grid layout draws 7 day columns", () => JSON.stringify(ptGrid));
check(ptGrid.switcherLabels.some((t) => /pt planner/i.test(t)) && ptGrid.switcherLabels.some((t) => /career calendar/i.test(t)),
  "the PT/Career switcher offers both screens", () => JSON.stringify(ptGrid.switcherLabels));
check(/pt planner/i.test(ptGrid.activeLabel || ""), "the switcher's active tab is PT Planner", () => ptGrid.activeLabel);
check(ptGrid.titledCells > 0, "at least one day cell shows a real planned-session title (the default \"Balanced week\" template)", () => JSON.stringify(ptGrid));
check(ptGrid.classicMarkers === 0, "Classic-only PT Planner markup (Day/Week/Month stage) is not present while shared-grid is active", () => JSON.stringify(ptGrid));

/* The switcher's "Career Calendar" tab navigates to #/calendar (each screen
   owns its own layout choice independently - see date-grid.js's own
   render()'s comment on why this jumps rather than rendering inline). */
await page.locator(".date-grid-switch button", { hasText: "Career Calendar" }).first().click();
await until(page, () => location.hash === "#/calendar");
check(true, "the switcher's Career Calendar tab navigates to #/calendar");

/* ---- 4) Career Calendar renders the shared-grid layout with correct data ---- */
await waitForRoute(page, "#/calendar", { ready: ".date-grid-row", fresh: true });
const calGrid = await page.evaluate(() => ({
  cols: document.querySelectorAll(".date-grid-col").length,
  switcherLabels: [...document.querySelectorAll(".date-grid-switch button")].map((b) => b.textContent.trim()),
  activeLabel: (document.querySelector(".date-grid-switch button.active") || {}).textContent,
  titles: [...document.querySelectorAll(".date-grid-title")].map((t) => t.textContent),
  classicMarkers: document.querySelectorAll(".cal-dates-grid, .cal-timeline").length,
}));
check(calGrid.cols === 7, "Career Calendar's shared-grid layout draws 7 day columns", () => JSON.stringify(calGrid));
check(/career calendar/i.test(calGrid.activeLabel || ""), "the switcher's active tab is Career Calendar", () => calGrid.activeLabel);
check(calGrid.titles.some((t) => /promotion board/i.test(t)),
  "the seeded board date (2 days out) shows as a real titled cell", () => JSON.stringify(calGrid.titles));
check(calGrid.classicMarkers === 0, "Classic-only Calendar markup (date grid / timeline) is not present while shared-grid is active", () => JSON.stringify(calGrid));

/* ---- 5) Switching back to Classic restores the original view, both ways ---- */
await waitForRoute(page, "#/settings", { ready: PT_SEL, fresh: true });
await page.locator(PT_SEL).selectOption({ value: "classic" });
await until(page, () => window.G.store.settings().ptPlannerLayout === "classic");
await page.locator(CAL_SEL).selectOption({ value: "classic" });
await until(page, () => window.G.store.settings().calendarLayout === "classic");

await waitForRoute(page, "#/pt-plan", { ready: '[role="tablist"][aria-label="PT planner view"]', fresh: true });
const ptClassic = await page.evaluate(() => ({
  tabs: document.querySelectorAll('[role="tablist"][aria-label="PT planner view"] button').length,
  weekGrid: !!document.querySelector('[data-pt-week]'),
  sharedGrid: document.querySelectorAll(".date-grid-row").length,
}));
check(ptClassic.tabs === 3 && ptClassic.weekGrid, "switching PT Planner back to Classic restores the Day/Week/Month tablist", () => JSON.stringify(ptClassic));
check(ptClassic.sharedGrid === 0, "...and the shared-grid component is gone", () => JSON.stringify(ptClassic));

await waitForRoute(page, "#/calendar", { ready: ".cal-dates-grid", fresh: true });
const calClassic = await page.evaluate(() => ({
  datesGrid: !!document.querySelector(".cal-dates-grid"),
  timeline: !!document.querySelector(".cal-timeline"),
  sharedGrid: document.querySelectorAll(".date-grid-row").length,
}));
check(calClassic.datesGrid && calClassic.timeline, "switching Career Calendar back to Classic restores \"Your dates\" and the career timeline", () => JSON.stringify(calClassic));
check(calClassic.sharedGrid === 0, "...and the shared-grid component is gone", () => JSON.stringify(calClassic));

/* ---- 6) Zero console noise across the whole round trip (both directions, both screens) ---- */
expectNoConsoleNoise(noise);

await finish("SCREEN LAYOUTS");
