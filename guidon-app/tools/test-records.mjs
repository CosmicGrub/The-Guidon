/**
 * Records Readiness (#/records, G.records): the pre-board paperwork
 * checklist (30 items across 6 groups - see the "Board Packet Checklist"
 * feature comment in records.js above the 6th group for where the 23 -> 30
 * jump came from). The generic route sweep only loads it once and never
 * checks a box, so its actual persistence, live progress math, and the
 * VALID_IDS staleness guard (which ignores any kv key that doesn't name a
 * checklist item the CURRENT GROUPS shape can produce - the defense against
 * a future reorder/resize silently misapplying or over-counting an orphaned
 * key) had no interactive coverage at all.
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
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

// Clean slate: this key can carry state across test runs on a shared profile.
await page.evaluate(() => window.G.db.put("kv", { k: "guidon:records:checks:v1", v: {} }));
await page.evaluate(() => { location.hash = "#/records"; });
await page.waitForTimeout(500);

const heading = await page.evaluate(() => /Records Readiness/.test(document.body.textContent || ""));
heading ? ok("Records Readiness view renders") : bad("heading not found");

const checkboxCount = await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]').length);
checkboxCount === 30 ? ok("Renders all 30 checklist items across 6 groups") : bad("checkbox count: " + checkboxCount);

const progressInitial = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
progressInitial === "0 of 30 confirmed" ? ok("Progress starts at '0 of 30 confirmed'") : bad("initial progress text: " + progressInitial);

const fillWidthInitial = await page.evaluate(() => document.querySelector(".panel div[style*='width']")?.style.width || "");
fillWidthInitial === "0%" ? ok("Progress bar fill starts at 0%") : bad("initial fill width: " + fillWidthInitial);

// ---- checking one box updates progress and persists ----
const firstBox = page.locator('input[type="checkbox"]').first();
await firstBox.check();
await page.waitForTimeout(200);
const progressAfterOne = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
progressAfterOne === "1 of 30 confirmed" ? ok("Checking one item updates progress to '1 of 30 confirmed'") : bad("progress after one check: " + progressAfterOne);

const persistedAfterOne = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "guidon:records:checks:v1");
  return r && r.v && r.v["rec-0-0"] === true;
});
persistedAfterOne ? ok("Checking a box persists it to IndexedDB (rec-0-0: true)") : bad("checkbox state not persisted");

// ---- survives a fresh re-render (not just in-memory) ----
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/records"; });
await page.waitForTimeout(500);
const firstBoxCheckedAfterRerender = await page.locator('input[type="checkbox"]').first().isChecked();
firstBoxCheckedAfterRerender ? ok("Checked state survives a full re-render of the view") : bad("checkbox did not survive re-render");
const progressAfterRerender = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
progressAfterRerender === "1 of 30 confirmed" ? ok("Progress count is correct on re-render") : bad("progress after re-render: " + progressAfterRerender);

// ---- unchecking decrements ----
await page.locator('input[type="checkbox"]').first().uncheck();
await page.waitForTimeout(200);
const progressAfterUncheck = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
progressAfterUncheck === "0 of 30 confirmed" ? ok("Unchecking the item returns progress to '0 of 30 confirmed'") : bad("progress after uncheck: " + progressAfterUncheck);

// ---- VALID_IDS staleness guard: an orphaned/malformed key must not be
// counted or crash the view, even though it's a real truthy entry in the kv row ----
await page.evaluate(() => window.G.db.put("kv", {
  k: "guidon:records:checks:v1",
  v: { "rec-0-0": true, "rec-99-99": true, "rec-0-1": "not-a-boolean" },
}));
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/records"; });
await page.waitForTimeout(500);
const progressWithStaleKey = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
// rec-0-0 is a real, currently-valid id (counts) - rec-99-99 doesn't name any
// real item under the current 6x{5,5,5,4,4,7} GROUPS shape (ignored) -
// rec-0-1's truthy-but-non-boolean value still counts (the guard only
// checks VALID_IDS[k], not typeof saved[k] - matches the module's own
// documented "if (VALID_IDS[k] && saved[k])" check).
progressWithStaleKey === "2 of 30 confirmed" ? ok("Orphaned key (rec-99-99) is silently ignored, not counted or crashing (VALID_IDS guard)") : bad("progress with stale key present: " + progressWithStaleKey);

// ---- the new "Board Packet Checklist" group (rec-5-*, appended at the END
// of GROUPS - see records.js's comment on why it's appended rather than
// inserted): every one of the 7 real board-packet requirements is present,
// checking one of them persists under its own positional id, and the group
// isn't just folded silently into an existing one. ----
await page.evaluate(() => window.G.db.put("kv", { k: "guidon:records:checks:v1", v: {} }));
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(150);
await page.evaluate(() => { location.hash = "#/records"; });
await page.waitForTimeout(500);

const packetGroup = await page.evaluate(() => {
  const eyebrow = [...document.querySelectorAll(".eyebrow")].find((n) => /The board packet/i.test(n.textContent || ""));
  const panel = eyebrow && eyebrow.closest(".panel");
  if (!panel) return null;
  return [...panel.querySelectorAll("label")].map((l) => l.textContent);
});
const expectedPacketSubstrings = [
  /biography/i,
  /Soldier Talent Profile/i,
  /head-to-toe/i,
  /leadership essay/i,
  /APA/i,
  /ADP 6-22/i,
  /AFT scorecard/i,
  /DA Form 5500\/5501/i,
  /qualification score sheet/i,
  /NCOER/i,
];
packetGroup && packetGroup.length === 7
  ? ok("The 'board packet' group renders all 7 packet items")
  : bad("packet group items: " + JSON.stringify(packetGroup));
const packetText = (packetGroup || []).join(" | ");
const missingPacketTerms = expectedPacketSubstrings.filter((re) => !re.test(packetText));
missingPacketTerms.length === 0
  ? ok("Packet items cover biography, STP, ASU photo, ADP 6-22 essay in APA format, AFT/DA 5500-5501, weapons qual, and NCOERs")
  : bad("packet items missing terms: " + missingPacketTerms.map(String).join(", ") + " (text: " + packetText + ")");

const packetFirstBox = page.locator('.panel:has(.eyebrow:has-text("The board packet")) input[type="checkbox"]').first();
await packetFirstBox.check();
await page.waitForTimeout(200);
const packetPersisted = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "guidon:records:checks:v1");
  return r && r.v && r.v["rec-5-0"] === true;
});
packetPersisted ? ok("Checking a packet item persists it under its own group's id (rec-5-0: true)") : bad("packet checkbox state not persisted under rec-5-0");
const progressAfterPacketCheck = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
progressAfterPacketCheck === "1 of 30 confirmed" ? ok("Packet group items count toward the same shared progress total") : bad("progress after packet check: " + progressAfterPacketCheck);
await page.evaluate(() => window.G.db.put("kv", { k: "guidon:records:checks:v1", v: {} }));

// ---- "Remind me before the cutoff" (audit finding #11, ux-consistency):
// the one date-sensitive fact this checklist page can't let a Soldier tick
// off from memory - a one-click reminder for the next 26th-of-month
// promotion cutoff, reusing Reminders' own pre-existing "promopoints" kind. ----
const cutoffPanelText = await page.evaluate(() => {
  const eyebrow = [...document.querySelectorAll(".eyebrow")].find((n) => /Remind me before the cutoff/i.test(n.textContent || ""));
  return eyebrow ? eyebrow.closest(".panel").textContent : null;
});
cutoffPanelText ? ok("The 'Remind me before the cutoff' panel renders") : bad("cutoff reminder panel not found");
/\d{4}/.test(cutoffPanelText || "") ? ok("It names a real cutoff date, not a placeholder") : bad("panel text: " + cutoffPanelText);

const remindBefore = await page.evaluate(async () => (await window.G.reminders.load()).length);
await page.evaluate(() => {
  const eyebrow = [...document.querySelectorAll(".eyebrow")].find((n) => /Remind me before the cutoff/i.test(n.textContent || ""));
  const panel = eyebrow && eyebrow.closest(".panel");
  const btn = panel && [...panel.querySelectorAll("button")].find((b) => b.textContent.trim() === "Remind me");
  if (btn) btn.click();
});
await page.waitForTimeout(300);
const remindAfter = await page.evaluate(async () => {
  const list = await window.G.reminders.load();
  return { count: list.length, last: list[list.length - 1] };
});
remindAfter.count === remindBefore + 1
  ? ok("Clicking 'Remind me' adds exactly one reminder")
  : bad(`reminder count ${remindBefore} -> ${remindAfter.count}, expected +1`);
remindAfter.last && remindAfter.last.kind === "promopoints" && remindAfter.last.label === "Records Readiness cutoff" && remindAfter.last.date
  ? ok(`The reminder reuses Reminders' existing 'promopoints' kind and carries a real date (${remindAfter.last.date})`)
  : bad("reminder shape: " + JSON.stringify(remindAfter.last));
const btnAfter = await page.evaluate(() => {
  const eyebrow = [...document.querySelectorAll(".eyebrow")].find((n) => /Remind me before the cutoff/i.test(n.textContent || ""));
  const panel = eyebrow && eyebrow.closest(".panel");
  const btn = panel && [...panel.querySelectorAll("button")].find((b) => /Reminder set/.test(b.textContent));
  return btn ? { text: btn.textContent, disabled: btn.disabled } : null;
});
btnAfter && btnAfter.disabled
  ? ok("The button confirms success in place (disabled, reads 'Reminder set')")
  : bad("button state after click: " + JSON.stringify(btnAfter));
if (remindAfter.last) await page.evaluate((id) => window.G.reminders.remove(id), remindAfter.last.id);

// ---- nextCutoff() month-rollover boundary (audit round 4, "test coverage
// gaps" bucket): nextCutoff() rolls from "26th of this month" to "26th of
// NEXT month" once today's date passes the 26th, including a December ->
// January year rollover (new Date(y, 12, 26) relies on JS's own month
// overflow to land in January of y+1). Until now this branch only ever ran
// whichever way CI's real wall-clock date happened to fall on any given
// day, so the rollover arm - and the year-rollover case specifically -
// could silently break without any test noticing. Freezes the page's Date
// constructor to three fixed "today"s (a class that SUBCLASSES the real
// Date rather than replacing it, so every other Date call already running
// in the app - reminders, calendar, IndexedDB - keeps working normally),
// then re-renders #/records and reads the exact cutoff string off the
// "Remind me before the cutoff" panel. The expected string is built
// independently in-page from a fresh Date the test constructs itself
// (never by calling nextCutoff()/fmt() directly), so a bug in the real
// branch can't hide behind a test that just re-runs the same logic. ----
async function freezeToday(y, m, d) {
  await page.evaluate(({ y, m, d }) => {
    const RealDate = Date;
    // Noon, not midnight, so the frozen instant can't drift onto the
    // adjacent calendar day under any timezone this test might run in.
    const fixedMs = new RealDate(y, m, d, 12, 0, 0, 0).getTime();
    class FrozenDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) { super(fixedMs); return; }
        super(...args);
      }
      static now() { return fixedMs; }
    }
    window.Date = FrozenDate;
  }, { y, m, d });
}
async function assertCutoff(label, y, m, d, expY, expM) {
  await freezeToday(y, m, d);
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(150);
  await page.evaluate(() => { location.hash = "#/records"; });
  await page.waitForTimeout(400);
  const result = await page.evaluate(({ expY, expM }) => {
    const eyebrow = [...document.querySelectorAll(".eyebrow")].find((n) => /Remind me before the cutoff/i.test(n.textContent || ""));
    const panel = eyebrow && eyebrow.closest(".panel");
    const hint = panel ? panel.querySelector("p.hint") : null;
    const rendered = hint ? hint.textContent : null;
    const expectedStr = new Date(expY, expM, 26).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    return { rendered, expectedStr };
  }, { expY, expM });
  (result.rendered && result.rendered.indexOf(result.expectedStr) !== -1)
    ? ok(label + ": cutoff correctly renders \"" + result.expectedStr + "\"")
    : bad(label + ": expected cutoff \"" + result.expectedStr + "\" not found in \"" + result.rendered + "\"");
}
// Same-month branch: the 20th is still before the 26th, so the cutoff stays in March.
await assertCutoff("today=Mar 20, 2026 (before cutoff, same month)", 2026, 2, 20, 2026, 2);
// Next-month branch, same year: the 27th has already passed the 26th, so the cutoff rolls to April.
await assertCutoff("today=Mar 27, 2026 (after cutoff, rolls to next month)", 2026, 2, 27, 2026, 3);
// Next-month branch, December -> January year rollover.
await assertCutoff("today=Dec 27, 2025 (after cutoff, rolls into next YEAR)", 2025, 11, 27, 2026, 0);

// cleanup
await page.evaluate(() => window.G.db.put("kv", { k: "guidon:records:checks:v1", v: {} }));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nRECORDS: all passed");
process.exit(fails ? 1 : 0);
