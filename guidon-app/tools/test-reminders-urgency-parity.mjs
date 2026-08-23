/**
 * Reminders urgency-scale convergence (roadmap Tier 3 batch 2, "unify
 * Reminders' urgency scale with the shared util.boardUrgency()/etsUrgency()
 * pattern"). Reminders used to run its own hardcoded 14-day/3-day cutoffs
 * (bucket()/renderStrip() in reminders.js, src/index.html) instead of the
 * shared util.boardUrgency()/util.etsUrgency() scale Calendar/Home/Transition
 * already agreed on - so an identical board-date reminder could show a
 * DIFFERENT colour on Home's "Coming up" strip than the same date showed in
 * Calendar's own "What is next" list.
 *
 * This seeds one real profile boardDate as BOTH a Calendar-tracked date AND
 * a real "board"-kind Reminder, then confirms Calendar's row and the
 * Reminders strip's row report the exact same colour for it. Two further
 * checks cover the fix's full range, since the old bug had two distinct
 * failure modes in opposite directions:
 *   - a board date >3 but <=14 days out showed NO colour at all in
 *     Reminders (old cutoff was a flat "<=3 days"), even though Calendar
 *     already showed amber for it per util.boardUrgency's real thresholds;
 *   - a board date <=3 days out showed AMBER in Reminders (it fell inside
 *     the old "<=3 days -> soon" bucket), when util.boardUrgency says that
 *     band should be RED.
 * A third check confirms a non-board/ETS kind now resolves through the new
 * util.genericUrgency() - the same scale calendar.js itself uses for every
 * other tracked date - rather than a third, still-independently-invented
 * scale of Reminders' own.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

/** YYYY-MM-DD for "n days from today", local date arithmetic matching how a
    Soldier would enter a date and how the app's own date parsing reads it -
    same technique test-consistency-extended.mjs uses. */
function daysFromNowStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(300);

// ── Colour-band reference, resolved in-browser the same way the app itself
//    resolves --red/--amber/--green, so string-comparing a computed colour
//    to these is meaningful regardless of theme. Same technique as
//    test-consistency-extended.mjs's own colorRefs helper. ─────────────────
const colorRefs = await page.evaluate(() => {
  function probe(name) {
    const p = document.createElement("div");
    p.style.color = "var(--" + name + ")";
    document.body.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }
  return { red: probe("red"), amber: probe("amber"), green: probe("green") };
});
function band(color) {
  if (color === colorRefs.red) return "red";
  if (color === colorRefs.amber) return "amber";
  if (color === colorRefs.green) return "green";
  return "unknown(" + color + ")";
}

// ═══════════════════════════════════════════════════════════════════════
// Case 1 (the roadmap's own example): an identical board date, seeded as
// BOTH the profile's real boardDate (what Calendar's "Promotion board" row
// reads) AND a real "board"-kind Reminder. 10 days out lands in
// util.boardUrgency's amber band (>3, <=14) - deliberately NOT inside
// Reminders' OLD hardcoded "<=3" cutoff, so before this fix Reminders
// painted it with no colour class at all even though Calendar already
// showed amber for the identical date.
// ═══════════════════════════════════════════════════════════════════════
const boardDateStr = daysFromNowStr(10);
await page.evaluate(async ({ boardDateStr }) => {
  await window.G.db.setSetting("reminders:v1", []);
  await window.G.store.setSetting("boardDate", boardDateStr);
  await window.G.reminders.add({ kind: "board", label: "Board reminder parity check", date: boardDateStr });
}, { boardDateStr });

await page.evaluate(() => { location.hash = "#/calendar"; });
await page.waitForTimeout(1000);
const calBoard = await page.evaluate(() => {
  for (const c of document.querySelectorAll(".card")) {
    const k = c.querySelector(".k"), v = c.querySelector(".v");
    if (k && v && k.textContent.trim() === "Promotion board") {
      return { days: parseInt(v.textContent.trim(), 10), color: getComputedStyle(c).borderLeftColor };
    }
  }
  return null;
});
calBoard && calBoard.days === 10 ? ok("Calendar's board-date row reads 10 days out") : bad("Calendar board-date days: expected 10, got " + JSON.stringify(calBoard));
calBoard && band(calBoard.color) === "amber" ? ok("Calendar's board-date row colour is amber") : bad("Calendar board-date colour band: " + (calBoard && band(calBoard.color)));

await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(1000);
const stripBoard = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".reminder-row")].find((r) => /Board reminder parity check/.test(r.textContent || ""));
  return row ? { classes: row.className, color: getComputedStyle(row).borderTopColor } : null;
});
stripBoard ? ok("the seeded board reminder appears in Home's 'Coming up' strip") : bad("board reminder not found in Home's Reminders strip");
stripBoard && band(stripBoard.color) === "amber"
  ? ok("Home's Reminders strip shows the SAME amber colour as Calendar for the identical board date (previously: no colour at all)")
  : bad("Reminders strip board-date colour band: " + (stripBoard && band(stripBoard.color)) + " (classes: " + (stripBoard && stripBoard.classes) + ")");
calBoard && stripBoard && calBoard.color === stripBoard.color
  ? ok("Calendar and Reminders resolve to the literal same computed colour value for the identical board date")
  : bad("colour mismatch: Calendar=" + (calBoard && calBoard.color) + " vs Reminders strip=" + (stripBoard && stripBoard.color));

// ═══════════════════════════════════════════════════════════════════════
// Case 2: a second "board"-kind reminder 2 days out - util.boardUrgency's
// own RED band (<=3). The OLD hardcoded "<=3 days -> .soon" cutoff in
// renderStrip() painted this AMBER - the opposite-direction failure from
// Case 1's miss (no colour), proving the fix covers both.
// ═══════════════════════════════════════════════════════════════════════
const soonDateStr = daysFromNowStr(2);
await page.evaluate(async ({ soonDateStr }) => {
  await window.G.reminders.add({ kind: "board", label: "Board reminder red-band check", date: soonDateStr });
}, { soonDateStr });
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(1000);
const stripRed = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".reminder-row")].find((r) => /Board reminder red-band check/.test(r.textContent || ""));
  return row ? { classes: row.className, color: getComputedStyle(row).borderTopColor } : null;
});
stripRed ? ok("the 2-day-out board reminder appears in Home's strip") : bad("2-day board reminder not found in strip");
stripRed && band(stripRed.color) === "red"
  ? ok("Home's Reminders strip shows RED for a board reminder inside util.boardUrgency's 3-day red band (previously: amber)")
  : bad("2-day board reminder colour band: " + (stripRed && band(stripRed.color)) + " (classes: " + (stripRed && stripRed.classes) + ")");
stripRed && /\burgent\b/.test(stripRed.classes || "")
  ? ok("...via the new .urgent class specifically (distinct from .overdue, since this reminder is not actually overdue)")
  : bad("expected .urgent class on the 2-day board reminder row, got: " + (stripRed && stripRed.classes));

// ═══════════════════════════════════════════════════════════════════════
// Case 3: a generic-kind (non-board/ETS) reminder should now resolve
// through util.genericUrgency() - the same 14/45-day scale calendar.js
// itself uses for every other tracked date - instead of a third,
// independently-invented scale of Reminders' own.
// ═══════════════════════════════════════════════════════════════════════
const genericDateStr = daysFromNowStr(8);
await page.evaluate(async ({ genericDateStr }) => {
  await window.G.reminders.add({ kind: "weapons", label: "Generic-kind urgency check", date: genericDateStr });
}, { genericDateStr });
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(1000);
const stripGeneric = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".reminder-row")].find((r) => /Generic-kind urgency check/.test(r.textContent || ""));
  return row ? { classes: row.className, color: getComputedStyle(row).borderTopColor } : null;
});
const expectedGenericLevel = await page.evaluate(() => window.G.util.genericUrgency(8).level);
stripGeneric ? ok("the generic-kind (weapons) reminder appears in Home's strip") : bad("generic-kind reminder not found in strip");
stripGeneric && band(stripGeneric.color) === expectedGenericLevel
  ? ok("Home's Reminders strip colours a generic-kind reminder per util.genericUrgency() (" + expectedGenericLevel + " at 8 days out), matching calendar.js's own scale for every other tracked date")
  : bad("generic-kind reminder colour band: expected " + expectedGenericLevel + ", got " + (stripGeneric && band(stripGeneric.color)));

// ── Console hygiene, same bar every other suite in this repo holds to. ────
noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `REMINDERS-URGENCY-PARITY: ${fails} FAILURE(S)` : "REMINDERS-URGENCY-PARITY: all passed"));
process.exit(fails ? 1 : 0);
