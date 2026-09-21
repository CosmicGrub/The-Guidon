/**
 * Career Calendar's "Zero Board" layout (ROADMAP 3g "customizable screen
 * layouts" Phase B, src/app-modules/calendar.js's renderZeroBoard()) - a
 * range-control countdown board (NEXT ZERO hero, a cyan Today/Board/ETS
 * readout, RED/AMBER/STANDBY shelves) instead of Classic's sorted card list,
 * built from the exact same G.calendar.computeRows() every other layout
 * already uses.
 *
 * WHY THIS SUITE EXISTS: LAYOUTS["zero-board"] is a THIRD entry in the same
 * id -> {label, render} registry test-screen-layouts.mjs already guards for
 * "classic"/"shared-grid" - that suite's own boots never touch this layout
 * at all, so a broken hero pick, a row landing on the wrong shelf, a tile
 * that doesn't actually expand, or a "Remind me" button that silently stops
 * creating reminders once wired into a tile instead of a card would all ship
 * invisibly. Covers: switching to it via Settings' real picker, the hero
 * strip naming the single most urgent row app-wide (a deliberately deep
 * OVERDUE seed), each seeded row landing on the shelf its own real urgency
 * function says it should, a tile expanding in place to reveal strictly more
 * (never different) information plus a real working "Remind me" button
 * (G.reminders.addManaged, source-stamped, same as Classic), the violet
 * no-due-date reference strip, and switching back to Classic with zero
 * regression.
 *
 * House rules (tools/lint-test-hygiene.mjs holds this suite to all of them):
 *   no fixed sleeps - waitForRoute(page, hash, { ready }) and until(page, fn)
 *   wait for the STATE; one browser (bootApp() once); drive the real screen
 *   (Settings' own <select>, the tile's own button), never stub the thing
 *   under test.
 */
import { bootApp, check, finish, waitForRoute, until, clickWhenStable, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

/** YYYY-MM-DD for "n months before today", computed the same way a Soldier
 *  would - identical helper to test-calendar.mjs's own monthsAgo(). */
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const boot = await bootApp({
  viewport: { width: 1024, height: 900 },
  profile: PERSONAL_PROFILE,
});
const { page, noise } = boot;

const CAL_SEL = 'select[aria-label="Career Calendar layout"]';

/* ---- 1) Seed one RED (deeply overdue), one AMBER, one GREEN case, plus a
   no-due-date "tos" fact, through Classic's own real date inputs - the only
   editor this app has, same technique test-calendar.mjs already uses. ---- */
await waitForRoute(page, "#/calendar", { ready: 'input[type="date"][aria-label="Last weapons qualification"]' });

/** Sets one TRACKED date input and waits for the real on-device write to
 *  land (G.calendar.KEY's own kv row) before returning - buildInputs()'s
 *  change handler calls persist() without the caller awaiting it, so a
 *  navigation right after dispatching "change" could otherwise race the
 *  IndexedDB write this suite depends on once it leaves Classic. */
async function setTrackedDate(label, key, value) {
  await page.evaluate(({ label, value }) => {
    const inp = document.querySelector(`input[type="date"][aria-label="${label}"]`);
    if (!inp) throw new Error("no input for " + label);
    inp.value = value;
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  }, { label, value });
  return until(page, async ({ key, value }) => {
    const row = await window.G.db.get("kv", window.G.calendar.KEY);
    return !!(row && row.v && row.v[key] === value);
  }, { key, value });
}

// 40 months since qualification: far past the 24-month validity - guarantees
// this is the single most negative `days` value app-wide (the hero pick),
// not merely "inside the red window", regardless of what day this runs.
const wpnDate = monthsAgo(40);
let settled = await setTrackedDate("Last weapons qualification", "wpnQual", wpnDate);
check(settled, "seeded weapons qualification 40 months ago (RED/overdue, and the app-wide soonest)");

// 11 months since AFT (valid 12): due in roughly 30 days - inside
// util.genericUrgency's 45-day amber window, same case test-calendar.mjs
// already proves lands amber.
const aftDate = monthsAgo(11);
settled = await setTrackedDate("Last record AFT", "aft", aftDate);
check(settled, "seeded AFT 11 months ago (AMBER)");

// 1 month since CFT (valid 12): due in roughly 11 months - comfortably past
// the 45-day amber ceiling, so genericUrgency reads green/STANDBY.
const cftDate = monthsAgo(1);
settled = await setTrackedDate("Last Combat Field Test", "cft", cftDate);
check(settled, "seeded Combat Field Test 1 month ago (GREEN/STANDBY)");

// "Arrived at current duty station" has months:0 and no `future` flag -
// computeRows() excludes it entirely (no due date to be urgent about), so
// it should surface only on the violet reference strip, never a shelf.
const tosDate = monthsAgo(5);
settled = await setTrackedDate("Arrived at current duty station", "tos", tosDate);
check(settled, "seeded time-on-station 5 months ago (no due date - reference only)");

/* ---- 2) Switch to "The Zero Board" via Settings' real picker ---- */
await waitForRoute(page, "#/settings", { ready: CAL_SEL, fresh: true });
const calOptions = await page.locator(CAL_SEL).locator("option").allTextContents();
check(calOptions.some((t) => /the zero board/i.test(t)),
  "Career Calendar layout offers \"The Zero Board\"", () => JSON.stringify(calOptions));

await page.locator(CAL_SEL).selectOption({ value: "zero-board" });
let layoutSettled = await until(page, () => window.G.store.settings().calendarLayout === "zero-board");
check(layoutSettled, "choosing \"The Zero Board\" persists calendarLayout=\"zero-board\"");

/* ---- 3) Career Calendar now renders the Zero Board ---- */
await waitForRoute(page, "#/calendar", { ready: ".zb-hero-count", fresh: true });

const board = await page.evaluate(() => ({
  classicMarkers: document.querySelectorAll(".cal-dates-grid, .cal-timeline").length,
  heroLabel: (document.querySelector(".zb-hero-label") || {}).textContent || "",
  heroCount: (document.querySelector(".zb-hero-count") || {}).textContent || "",
  dtgSegs: [...document.querySelectorAll(".zb-dtg-seg")].map((s) => ({
    label: (s.querySelector(".zb-dtg-label") || {}).textContent,
    count: (s.querySelector(".zb-dtg-count") || {}).textContent,
  })),
  reference: (document.querySelector(".zb-reference") || {}).textContent || null,
}));
check(board.classicMarkers === 0, "Classic-only markup (date grid / timeline) is not present on the Zero Board", () => JSON.stringify(board));

/* ---- 4) NEXT ZERO hero names the single most urgent row app-wide ---- */
check(/weapons qualification/i.test(board.heroLabel), "the NEXT ZERO hero names the deeply-overdue weapons qualification row", () => JSON.stringify(board.heroLabel));
check(board.heroCount === "OVERDUE", "the hero's count reads OVERDUE, not a day number", () => board.heroCount);

/* ---- 5) The cyan DTG readout shows Today plus Board/ETS ("Not set" for
   this profile, which never set either) - orientation chrome, not a second
   red/amber/green vocabulary. ---- */
check(board.dtgSegs.length === 3, "the DTG readout has exactly 3 segments (Today / Promotion board / ETS)", () => JSON.stringify(board.dtgSegs));
check(board.dtgSegs.some((s) => /today/i.test(s.label || "")), "one DTG segment is Today", () => JSON.stringify(board.dtgSegs));
check(board.dtgSegs.some((s) => /promotion board/i.test(s.label || "") && s.count === "—"),
  "the Promotion board segment reads unset for this profile", () => JSON.stringify(board.dtgSegs));
check(board.dtgSegs.some((s) => /ets/i.test(s.label || "") && s.count === "—"),
  "the ETS segment reads unset for this profile", () => JSON.stringify(board.dtgSegs));

/* ---- 6) Shelf membership matches each seeded row's own real urgency ---- */
const shelves = await page.evaluate(() => {
  function tileInfo(shelfSel) {
    return [...document.querySelectorAll(shelfSel + " .zb-tile-head")].map((h) => ({
      ariaLabel: h.getAttribute("aria-label"),
      expanded: h.getAttribute("aria-expanded"),
    }));
  }
  return { red: tileInfo(".zb-shelf-red"), amber: tileInfo(".zb-shelf-amber"), green: tileInfo(".zb-shelf-green") };
});

check(shelves.red.some((t) => /weapons qualification/i.test(t.ariaLabel) && /overdue/i.test(t.ariaLabel)),
  "the RED shelf holds the overdue weapons-qualification tile", () => JSON.stringify(shelves.red));
check(shelves.amber.some((t) => /record aft/i.test(t.ariaLabel)),
  "the AMBER shelf holds the 11-month AFT tile", () => JSON.stringify(shelves.amber));
check(shelves.green.some((t) => /combat field test/i.test(t.ariaLabel)),
  "the STANDBY (green) shelf holds the 1-month Combat Field Test tile", () => JSON.stringify(shelves.green));
// Every shelf carries its own real visible text label - never color alone.
const shelfLabels = await page.evaluate(() => [...document.querySelectorAll(".zb-shelf-title")].map((s) => s.textContent.trim()));
check(shelfLabels.includes("RED") && shelfLabels.includes("AMBER") && shelfLabels.includes("STANDBY"),
  "all three shelves carry a real RED/AMBER/STANDBY text label", () => JSON.stringify(shelfLabels));

/* ---- 7) The violet reference strip carries the no-due-date "tos" fact,
   never on a shelf (it has no due date to be urgent about). ---- */
check(board.reference && /arrived at current duty station/i.test(board.reference) && /5 months/i.test(board.reference),
  "the violet reference strip shows time-on-station as a fact, not an urgency row", () => JSON.stringify(board.reference));
check(!shelves.red.concat(shelves.amber, shelves.green).some((t) => /duty station/i.test(t.ariaLabel)),
  "the duty-station fact is not on any of the three urgency shelves", () => JSON.stringify(shelves));

/* ---- 8) Expanding the overdue tile reveals strictly MORE information
   (never different) - the real date and consequence text - and its real
   "Remind me" button, reusing G.reminders.addManaged (Screen Layouts /
   ROADMAP 3g's own source-stamped lifecycle), same as Classic's own cards. */
// Exactly one row was seeded into RED (the overdue weapons qualification).
const wpnHead = page.locator('.zb-shelf-red .zb-tile-head[aria-expanded="false"]').first();
await clickWhenStable(page, wpnHead);

const expanded = await page.evaluate(() => {
  const head = document.querySelector(".zb-shelf-red .zb-tile-head");
  const body = head && head.parentElement.querySelector(".zb-tile-body");
  return {
    ariaExpanded: head && head.getAttribute("aria-expanded"),
    ariaLabel: head && head.getAttribute("aria-label"),
    bodyHidden: body && body.hasAttribute("hidden"),
    bodyText: body ? body.textContent : "",
    remindBtn: !!(body && [...body.querySelectorAll("button")].some((b) => b.textContent.trim() === "Remind me")),
  };
});
check(expanded.ariaExpanded === "true", "clicking the overdue tile sets aria-expanded=true");
check(!expanded.bodyHidden, "the tile body is revealed (no longer hidden)");
check(expanded.ariaLabel && expanded.ariaLabel.indexOf("RED zone: weapons qualification, overdue") === 0,
  "the expanded aria-label KEEPS the exact collapsed wording as its prefix", () => expanded.ariaLabel);
check(expanded.ariaLabel && /due/i.test(expanded.ariaLabel) && /promotion points/i.test(expanded.ariaLabel),
  "...and GAINS the real date and consequence text on top of it", () => expanded.ariaLabel);
check(/promotion points/i.test(expanded.bodyText), "the revealed body shows the row's real consequence text", () => expanded.bodyText);
check(expanded.remindBtn, "the expanded tile offers a real \"Remind me\" button");

/* ---- 9) Clicking "Remind me" actually creates a reminder - same shape
   Classic's own suite (test-calendar.mjs) already proves for this exact
   button, not a re-invented check. ---- */
const remindBefore = await page.evaluate(async () => (await window.G.reminders.load()).length);
await page.evaluate(() => {
  const head = document.querySelector(".zb-shelf-red .zb-tile-head");
  const body = head.parentElement.querySelector(".zb-tile-body");
  const btn = [...body.querySelectorAll("button")].find((b) => b.textContent.trim() === "Remind me");
  btn.click();
});
const reminded = await until(page, async () => (await window.G.reminders.load()).some((r) => r.source === "calendar:wpnQual"), null, { timeout: 4000 });
check(reminded, "clicking the Zero Board tile's \"Remind me\" creates a reminder stamped source:\"calendar:wpnQual\"");
const remindAfter = await page.evaluate(async () => {
  const list = await window.G.reminders.load();
  return { count: list.length, last: list.find((r) => r.source === "calendar:wpnQual") };
});
check(remindAfter.count === remindBefore + 1, "exactly one reminder was added", () => `${remindBefore} -> ${remindAfter.count}`);
// The reminder's date is the row's COMPUTED due date (40-months-ago-last
// plus the 24-month validity window, i.e. roughly 16 months ago), not the
// raw date typed into the input - same distinction test-calendar.mjs's own
// equivalent check draws, so this only asserts shape/kind/label, not an
// exact date this suite would have to re-derive addMonths() to predict.
check(remindAfter.last && remindAfter.last.kind === "weapons" && /weapons qualification/i.test(remindAfter.last.label) && /^\d{4}-\d{2}-\d{2}$/.test(remindAfter.last.date || ""),
  "the reminder carries the row's real kind ('weapons'), label, and a real computed due date", () => JSON.stringify(remindAfter.last));
const btnAfter = await page.evaluate(() => {
  const head = document.querySelector(".zb-shelf-red .zb-tile-head");
  const body = head.parentElement.querySelector(".zb-tile-body");
  const btn = [...body.querySelectorAll("button")].find((b) => /Reminder set/.test(b.textContent));
  return btn ? { text: btn.textContent, disabled: btn.disabled } : null;
});
check(!!(btnAfter && btnAfter.disabled), "the button confirms success in place (disabled, reads 'Reminder set')", () => JSON.stringify(btnAfter));
// Cleanup - leaves reminders:v1 as this suite found it.
if (remindAfter.last) await page.evaluate((id) => window.G.reminders.remove(id), remindAfter.last.id);

/* ---- 10) Switching back to Classic restores the original view - zero
   regression, both directions. ---- */
await waitForRoute(page, "#/settings", { ready: CAL_SEL, fresh: true });
await page.locator(CAL_SEL).selectOption({ value: "classic" });
layoutSettled = await until(page, () => window.G.store.settings().calendarLayout === "classic");
check(layoutSettled, "switching back to \"Classic\" persists calendarLayout=\"classic\"");

await waitForRoute(page, "#/calendar", { ready: ".cal-dates-grid", fresh: true });
const classicView = await page.evaluate(() => ({
  datesGrid: !!document.querySelector(".cal-dates-grid"),
  timeline: !!document.querySelector(".cal-timeline"),
  zeroBoard: document.querySelectorAll(".zb-board").length,
  wpnValue: (document.querySelector('input[type="date"][aria-label="Last weapons qualification"]') || {}).value,
}));
check(classicView.datesGrid && classicView.timeline, "switching back to Classic restores \"Your dates\" and the career timeline", () => JSON.stringify(classicView));
check(classicView.zeroBoard === 0, "...and the Zero Board's own markup is gone", () => JSON.stringify(classicView));
check(classicView.wpnValue === wpnDate, "the seeded weapons-qualification date survived the round trip through the Zero Board and back", () => classicView.wpnValue);

/* ---- 11) Zero console noise across the whole round trip ---- */
expectNoConsoleNoise(noise);

await finish("CALENDAR ZERO BOARD");
