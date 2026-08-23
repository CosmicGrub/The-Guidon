/**
 * Career Calendar: date arithmetic, urgency ordering, persistence.
 *
 * The whole value of this section is one calculation - "your weapons
 * qualification is 25 months old, which is worth zero promotion points" - so
 * the calculation gets a test rather than a glance.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

/** YYYY-MM-DD for "n months before today", computed the same way a user would. */
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const { server, url } = await serve("web");
const browser = await chromium.launch();
// Roadmap Tier 5 width-waste fix: explicit 1024x900 (a canonical breakpoint,
// tools/lint-patterns.mjs check (d)) rather than Playwright's default
// viewport, so every interactive assertion below (setDate, "Remind me",
// reload-persistence) genuinely exercises the 2-column .cal-dates-grid this
// fix introduced, not just the pre-fix single-column layout by accident of
// a wide-enough default. Proves add/edit/remind-me survive the regrouping,
// not merely that the grid *renders*.
const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => { location.hash = "#/calendar"; });
await page.waitForTimeout(900);

const booted = await page.evaluate(() => ({
  heading: (document.querySelector("#view h2, main h2") || {}).textContent,
  dateInputs: document.querySelectorAll('input[type="date"]').length,
  // Derived from the artifact itself, not hardcoded — ETS moved off this
  // list (week 8) to read from the profile/settings ETS date instead of
  // asking for it a second time, so TRACKED's own length is the only
  // correct source for "how many editable date fields should exist."
  trackedCount: (window.G.calendar && window.G.calendar.TRACKED || []).length,
}));
booted.heading === "Career Calendar" ? ok("Career Calendar renders") : bad("heading was " + booted.heading);
booted.dateInputs >= booted.trackedCount
  ? ok(`${booted.dateInputs} tracked date fields`)
  : bad(`only ${booted.dateInputs} date inputs, expected >= ${booted.trackedCount} (TRACKED.length)`);

/* Roadmap Tier 5 width-waste audit: the 6 TRACKED "Your dates" cards used to
   stack single-column no matter the viewport (confirmed pre-fix: still one
   484px-wide column at a 1360px viewport). .cal-dates-grid (src/index.html
   CSS, wired up in src/app-modules/calendar.js's buildInputs()) now grids
   them - real column count and a real bounding-rect same-row comparison,
   not just a CSS-class-exists check, since a `display:grid` container with
   only one track would still trivially "have grid" without fixing anything. */
const gridInfo = await page.evaluate(() => {
  const grid = document.querySelector(".cal-dates-grid");
  if (!grid) return null;
  const cs = getComputedStyle(grid);
  const cards = [...grid.querySelectorAll(":scope > .card")];
  const rects = cards.map((c) => c.getBoundingClientRect());
  return {
    display: cs.display,
    columns: cs.gridTemplateColumns.trim().split(/\s+/).length,
    cardCount: cards.length,
    // Real same-row check: two cards only share a row if the grid actually
    // placed them side by side - same top edge, not one above the other.
    firstTwoSameRow: rects.length >= 2 && Math.abs(rects[0].y - rects[1].y) < 1,
    firstTwoDifferentX: rects.length >= 2 && Math.abs(rects[0].x - rects[1].x) > 1,
  };
});
gridInfo && gridInfo.display === "grid" && gridInfo.columns >= 2
  ? ok(`"Your dates" grids into ${gridInfo.columns} real columns at 1024px wide`)
  : bad("expected a real multi-column grid for the 6 TRACKED cards at 1024px, got " + JSON.stringify(gridInfo));
gridInfo && gridInfo.cardCount === booted.trackedCount
  ? ok(`all ${gridInfo.cardCount} TRACKED cards are present inside the grid`)
  : bad("grid card count " + (gridInfo && gridInfo.cardCount) + " != TRACKED.length " + booted.trackedCount);
gridInfo && gridInfo.firstTwoSameRow && gridInfo.firstTwoDifferentX
  ? ok("first two date cards share a real top edge at different x positions (genuinely side by side, not stacked)")
  : bad("first two date cards are not genuinely side by side: " + JSON.stringify(gridInfo));

/* The fixed anchors nobody enters must always be present. */
const anchors = await page.evaluate(() => document.body.textContent || "");
/Promotion month cut-off/.test(anchors) ? ok("26th-of-month promotion cut-off always shown") : bad("cut-off anchor missing");
/Credentialing Assistance resets/.test(anchors) ? ok("1 Oct CA fiscal-year reset always shown") : bad("CA reset anchor missing");

/** Sets one tracked date and returns the rendered "what is next" rows. */
async function setDate(label, value) {
  return page.evaluate(({ label, value }) => {
    const inp = document.querySelector(`input[type="date"][aria-label="${label}"]`);
    if (!inp) return { error: "no input for " + label };
    inp.value = value;
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }, { label, value });
}

async function rowsNow() {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll(".card")].filter((c) => c.querySelector(".k") && c.querySelector(".v"));
    return cards.map((c) => ({
      label: c.querySelector(".k").textContent.trim(),
      value: c.querySelector(".v").textContent.trim(),
      border: c.style.borderLeftColor || c.style.borderLeft,
    }));
  });
}

// 25 months since qualification: past the 24-month validity, must read OVERDUE.
await setDate("Last weapons qualification", monthsAgo(25));
await page.waitForTimeout(500);
let rows = await rowsNow();
const wpnOver = rows.find((r) => /weapons qualification/i.test(r.label));
wpnOver && wpnOver.value === "OVERDUE"
  ? ok("weapons qual 25 months old reads OVERDUE (24-month rule)")
  : bad("expected OVERDUE, got " + JSON.stringify(wpnOver));

// 1 month since qualification: due in roughly 23 months, so plainly not urgent.
await setDate("Last weapons qualification", monthsAgo(1));
await page.waitForTimeout(500);
rows = await rowsNow();
const wpnOk = rows.find((r) => /weapons qualification/i.test(r.label));
const days = wpnOk ? parseInt(wpnOk.value, 10) : NaN;
days > 600 && days < 730
  ? ok(`weapons qual 1 month old is ${days} days out (~23 months, as expected)`)
  : bad("expected roughly 690 days, got " + JSON.stringify(wpnOk));

// An AFT 11 months old should be inside the 45-day amber window.
await setDate("Last record AFT", monthsAgo(11));
await page.waitForTimeout(500);
rows = await rowsNow();
const aft = rows.find((r) => /AFT/i.test(r.label));
const aftDays = aft ? parseInt(aft.value, 10) : NaN;
aftDays >= 0 && aftDays <= 45
  ? ok(`AFT 11 months old is ${aftDays} days out and flagged`)
  : bad("expected 0-45 days for an 11-month-old AFT, got " + JSON.stringify(aft));

/* Rows must be ordered by urgency, or the page is just a list. */
const ordered = await page.evaluate(() => {
  const vals = [...document.querySelectorAll(".card .v")].map((v) => v.textContent.trim());
  const nums = vals.map((t) => (t === "OVERDUE" ? -1 : parseInt(t, 10))).filter((n) => !isNaN(n));
  return nums.every((n, i) => i === 0 || nums[i - 1] <= n);
});
ordered ? ok("upcoming rows sorted soonest-first") : bad("rows are not in urgency order");

/* "Remind me" quick-add (audit finding #11, ux-consistency): turns a row's
   already-computed due date into a native-reminder round trip in one click -
   no date re-entry, unlike the two freeform Money-tab quick-adds this
   mirrors, because Calendar already knows the date. */
const remindBefore = await page.evaluate(async () => (await window.G.reminders.load()).length);
await page.evaluate(() => {
  const card = [...document.querySelectorAll(".card")].find((c) => /weapons qualification/i.test((c.querySelector(".k") || {}).textContent || ""));
  const btn = card && [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "Remind me");
  if (btn) btn.click();
});
await page.waitForTimeout(300);
const remindAfter = await page.evaluate(async () => {
  const list = await window.G.reminders.load();
  return { count: list.length, last: list[list.length - 1] };
});
remindAfter.count === remindBefore + 1
  ? ok("Clicking Calendar's per-row 'Remind me' adds exactly one reminder")
  : bad(`reminder count ${remindBefore} -> ${remindAfter.count}, expected +1`);
remindAfter.last && remindAfter.last.kind === "weapons" && /weapons qualification/i.test(remindAfter.last.label) && remindAfter.last.date
  ? ok(`The reminder carries the row's kind ('weapons'), label, and a real date (${remindAfter.last.date})`)
  : bad("reminder shape: " + JSON.stringify(remindAfter.last));
const btnAfter = await page.evaluate(() => {
  const card = [...document.querySelectorAll(".card")].find((c) => /weapons qualification/i.test((c.querySelector(".k") || {}).textContent || ""));
  const btn = card && [...card.querySelectorAll("button")].find((b) => /Reminder set/.test(b.textContent));
  return btn ? { text: btn.textContent, disabled: btn.disabled } : null;
});
btnAfter && btnAfter.disabled
  ? ok("The button confirms success in place (disabled, reads 'Reminder set')")
  : bad("button state after click: " + JSON.stringify(btnAfter));
// Cleanup — leaves reminders:v1 as this suite found it.
if (remindAfter.last) await page.evaluate((id) => window.G.reminders.remove(id), remindAfter.last.id);

/* Persistence across a reload. */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);
await page.evaluate(() => { location.hash = "#/calendar"; });
await page.waitForTimeout(1000);
const persisted = await page.evaluate(() => {
  const inp = document.querySelector('input[type="date"][aria-label="Last record AFT"]');
  return inp ? inp.value : null;
});
persisted === monthsAgo(11)
  ? ok("entered dates survive a reload")
  : bad(`expected ${monthsAgo(11)} after reload, got ${persisted}`);

/* Narrow-viewport regression: the same .cal-dates-grid must degrade back to
   the pre-fix clean single column at mobile widths - a fix that helps wide
   viewports must not break narrow ones. Separate context (not a resize of
   `page`) so it's a genuine fresh 375px boot, same as a phone opening the
   app cold, not a desktop layout being shrunk after the fact. */
const narrowCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const narrowPage = await narrowCtx.newPage();
await narrowPage.goto(url, { waitUntil: "load" });
await narrowPage.waitForTimeout(700);
await narrowPage.evaluate(() => { location.hash = "#/calendar"; });
await narrowPage.waitForTimeout(900);
const narrowGrid = await narrowPage.evaluate(() => {
  const grid = document.querySelector(".cal-dates-grid");
  if (!grid) return null;
  const cs = getComputedStyle(grid);
  const cards = [...grid.querySelectorAll(":scope > .card")];
  const rects = cards.map((c) => c.getBoundingClientRect());
  return {
    columns: cs.gridTemplateColumns.trim().split(/\s+/).length,
    cardCount: cards.length,
    // Real same-column check: every card shares the same left edge only if
    // the grid is genuinely one track wide, not partially wrapping.
    allSameLeft: rects.length > 1 && rects.every((r) => Math.abs(r.x - rects[0].x) < 1),
  };
});
narrowGrid && narrowGrid.columns === 1
  ? ok("at 375px, \"Your dates\" stays a real single column (no wide-viewport regression)")
  : bad("expected exactly 1 column at 375px, got " + JSON.stringify(narrowGrid));
narrowGrid && narrowGrid.cardCount === 6 && narrowGrid.allSameLeft
  ? ok("all 6 date cards share the same left edge at 375px (genuinely stacked)")
  : bad("date cards not cleanly stacked at 375px: " + JSON.stringify(narrowGrid));
await narrowCtx.close();

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `CALENDAR: ${fails} FAILURE(S)` : "CALENDAR: all passed"));
process.exit(fails ? 1 : 0);
