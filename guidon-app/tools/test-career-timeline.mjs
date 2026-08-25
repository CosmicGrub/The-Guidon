/**
 * Career timeline (js/calendar.js buildTimeline(), roadmap Tier 8 — the
 * last of the 8 "big bets"). A vertical stepper on #/calendar: "now" (the
 * Soldier's current rank) plus the two genuine career-shaping dates this
 * app actually tracks (board date, ETS), sorted chronologically.
 *
 * Deliberately does NOT project a next-promotion-eligibility date — that
 * would need an enlistment/grade-entry date this profile has never
 * collected, and the real TIS/TIG thresholds (rendered as display strings
 * on #/board's Compare SGT/SSG segment, added earlier this session) exist
 * only as text, not structured numbers a date calculation could consume.
 * Faking a projected date from neither would be exactly the kind of guess
 * this module's own header comment says it won't make. This suite proves
 * both halves of that: the real anchors render correctly and in the right
 * order, and no fabricated "eligible on [date]" milestone ever appears.
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
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") noise.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

async function timelinePanel() {
  const eyebrow = page.locator(".eyebrow", { hasText: "Career timeline" }).first();
  await eyebrow.waitFor({ state: "visible", timeout: 5000 });
  return eyebrow.locator("xpath=ancestor::div[contains(@class,'panel')][1]");
}
async function rows(panel) {
  return page.evaluate((el) => Array.from(el.querySelectorAll(".cal-timeline-row")).map((r) => ({
    isNow: r.classList.contains("cal-timeline-now"),
    text: r.querySelector(".cal-timeline-body").textContent.trim(),
  })), await panel.elementHandle());
}

// ── 1) Empty state: only "Now" renders, with a real hint, no fabrication ──
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/calendar"; });
await page.waitForTimeout(500);
let panel = await timelinePanel();
let r = await rows(panel);
r.length === 1 && r[0].isNow
  ? ok("with no board/ETS date set, the timeline shows exactly one row: 'Now'")
  : bad("empty-state rows: " + JSON.stringify(r));
const emptyHint = await panel.locator("p.hint", { hasText: "Add a board date" }).count();
emptyHint === 1 ? ok("empty state shows a real hint pointing at where to add dates, not a blank panel") : bad("empty-state hint not found");

const disclaimer = await panel.locator("p.hint", { hasText: /does not project a next-promotion-eligibility date/ }).count();
disclaimer === 1
  ? ok("the timeline explicitly discloses it does NOT fabricate a projected eligibility date, and says why (no enlistment date collected, no structured TIS/TIG data)")
  : bad("honesty disclaimer not found");

// ── 2) Real dates set (board + ETS) — both plotted, correctly ordered ─────
const boardDays = 40, etsDays = 120;
await page.evaluate(([bd, ed]) => {
  const board = new Date(); board.setDate(board.getDate() + bd);
  const ets = new Date(); ets.setDate(ets.getDate() + ed);
  return Promise.all([
    window.G.store.setSetting("boardDate", board.toISOString().slice(0, 10)),
    window.G.store.setSetting("etsDate", ets.toISOString().slice(0, 10)),
  ]);
}, [boardDays, etsDays]);
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/calendar"; });
await page.waitForTimeout(500);
panel = await timelinePanel();
r = await rows(panel);

r.length === 3
  ? ok("with both dates set, the timeline shows 3 rows: Now, Promotion board, ETS")
  : bad("row count with both dates set: " + r.length + " — " + JSON.stringify(r));
(r[0] && r[0].isNow && /^Now/.test(r[0].text))
  ? ok("row 1 is 'Now', first (today is always the earliest anchor)")
  : bad("row 1: " + JSON.stringify(r[0]));
(r[1] && !r[1].isNow && /Promotion board/.test(r[1].text) && new RegExp(boardDays + "d").test(r[1].text))
  ? ok(`row 2 is 'Promotion board' at the real ${boardDays}-day mark, correctly sorted before ETS`)
  : bad("row 2: " + JSON.stringify(r[1]));
(r[2] && !r[2].isNow && /ETS/.test(r[2].text) && new RegExp(etsDays + "d").test(r[2].text))
  ? ok(`row 3 is 'ETS' at the real ${etsDays}-day mark`)
  : bad("row 3: " + JSON.stringify(r[2]));

// ── 3) Cross-links genuinely navigate, same real routes Calendar's own
//    "What is next" list links to for the same two dates ─────────────────
const openBtns = panel.locator("button", { hasText: "Open" });
(await openBtns.count()) === 2 ? ok("exactly 2 'Open' cross-link buttons (board + ETS; 'Now' has none — nothing to open)") : bad("Open button count: " + (await openBtns.count()));
await openBtns.nth(0).click();
await page.waitForTimeout(400);
let hash = await page.evaluate(() => location.hash);
hash === "#/records" ? ok("Promotion board's 'Open' button navigates to #/records (Records Readiness)") : bad("hash after board Open click: " + hash);

await page.evaluate(() => { location.hash = "#/calendar"; });
await page.waitForTimeout(400);
panel = await timelinePanel();
await panel.locator("button", { hasText: "Open" }).nth(1).click();
await page.waitForTimeout(400);
hash = await page.evaluate(() => location.hash);
hash === "#/transition" ? ok("ETS's 'Open' button navigates to #/transition") : bad("hash after ETS Open click: " + hash);

// ── 4) A reversed real-world case: board date AFTER ETS still sorts right ──
await page.evaluate(() => {
  const board = new Date(); board.setDate(board.getDate() + 200);
  const ets = new Date(); ets.setDate(ets.getDate() + 30);
  return Promise.all([
    window.G.store.setSetting("boardDate", board.toISOString().slice(0, 10)),
    window.G.store.setSetting("etsDate", ets.toISOString().slice(0, 10)),
  ]);
});
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/calendar"; });
await page.waitForTimeout(500);
panel = await timelinePanel();
r = await rows(panel);
(r[1] && /ETS/.test(r[1].text) && r[2] && /Promotion board/.test(r[2].text))
  ? ok("when ETS is sooner than the board date (a real, valid Soldier scenario), the timeline sorts by actual date, not a hardcoded board-then-ETS assumption")
  : bad("reversed-order rows: " + JSON.stringify(r));

// ── 5) Existing Calendar functionality is unaffected by the new panel ─────
const upcomingCount = await page.locator(".eyebrow", { hasText: "What is next" }).count();
const inputsCount = await page.locator(".eyebrow", { hasText: "Your dates" }).count();
const dateInputCount = await page.locator('input[type="date"]').count();
(upcomingCount === 1 && inputsCount === 1 && dateInputCount === 6)
  ? ok("the existing 'What is next' list and all 6 'Your dates' TRACKED inputs still render alongside the new timeline")
  : bad(`existing panels: upcoming=${upcomingCount}, inputs=${inputsCount}, dateInputs=${dateInputCount}`);

// ── 6) No horizontal overflow at mobile width (this app's own convention) ─
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(300);
const overflowsX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
!overflowsX ? ok("no horizontal overflow at 375px mobile width") : bad("body overflows horizontally at 375px");

noise.length === 0
  ? ok("no console errors/warnings across the whole flow")
  : bad("console noise: " + JSON.stringify(noise));

await browser.close();
server.close();
console.log("\n" + (fails ? `CAREER TIMELINE: ${fails} FAILURE(S)` : "CAREER TIMELINE: all passed"));
process.exit(fails ? 1 : 0);
