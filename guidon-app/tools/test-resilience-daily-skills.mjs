/**
 * Roadmap-week audit finding (3rd pass): Resilience's "Daily Skills" tab
 * (#/health, resilience.js) has a persisted daily-practice log ("Mark as
 * practiced today"), an exact-duplicate-per-day guard, and a consecutive-day
 * streak calculation (nextDateStr, UTC-based day-identity comparison) - none
 * of which had any test coverage. The only existing test that visits this
 * route (test-transition-health-grid.mjs) checks a completely different
 * panel (the H2F Domains skill-card grid), never this one.
 *
 * Demonstrated empirically before writing this test: broke the streak's
 * day-increment (d.setUTCDate(d.getUTCDate() + 1) -> + 2), rebuilt, and
 * reran every existing test touching this route - all still passed 100%
 * clean. This file closes that gap.
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
await page.waitForTimeout(400);

const LOG_KEY = "resilience:practiceLog:v1";
async function setLog(entries) { await page.evaluate(({ k, v }) => window.G.db.setSetting(k, v), { k: LOG_KEY, v: entries }); }
async function getLog() { return page.evaluate((k) => window.G.db.getSetting(k, []), LOG_KEY); }
async function gotoHealth() {
  await page.evaluate(() => { location.hash = "#/"; });
  await page.waitForTimeout(150);
  await page.evaluate(() => { location.hash = "#/health"; });
  await page.waitForTimeout(400);
  await page.locator(".tabbar button", { hasText: "Daily Skills" }).click();
  await page.waitForTimeout(300);
}

// ==================== 1) Clean-slate: button offers to log, not already logged ====================
await setLog([]);
await gotoHealth();
(await page.locator("h2", { hasText: "Resilience" }).count()) || (await page.locator(".eyebrow", { hasText: "Practice of the Day" }).count())
  ? ok("#/health Daily Skills tab renders the Practice of the Day panel")
  : bad("Practice of the Day panel not found");
const logBtn = page.locator("button", { hasText: /Mark as practiced today|Practiced today/ });
(await logBtn.count()) ? ok("'Mark as practiced today' button renders") : bad("log button not found");
let btnText = (await logBtn.textContent()).trim();
btnText === "Mark as practiced today" ? ok("with an empty log, button reads 'Mark as practiced today' (not yet logged)") : bad("initial button text: " + btnText);
(await logBtn.isDisabled()) === false ? ok("button is enabled when not yet logged today") : bad("button unexpectedly disabled on a clean slate");

// ==================== 2) Clicking it logs today and confirms visibly ====================
await logBtn.click();
await page.waitForTimeout(300);
const afterClickLog = await getLog();
afterClickLog.length === 1 ? ok("clicking the button persists exactly one entry to kv 'resilience:practiceLog:v1'") : bad("log after click: " + JSON.stringify(afterClickLog));
const todayStr = new Date().toISOString().slice(0, 10);
(afterClickLog[0] && afterClickLog[0].date === todayStr) ? ok("the persisted entry's date is today (" + todayStr + ")") : bad("persisted date: " + JSON.stringify(afterClickLog[0]));
(await logBtn.isVisible()) === false ? ok("the log button hides itself immediately after a successful log") : bad("log button is still visible after clicking it");
const confirmMsg = page.locator('[role="status"][aria-live="polite"]', { hasText: "Logged for today" });
(await confirmMsg.isVisible()) ? ok("a visible '✓ Logged for today' confirmation appears in its place") : bad("post-click confirmation message not visible");

// ==================== 3) A fresh render (already logged today) shows the disabled/relabeled state ====================
await gotoHealth();
const logBtn2 = page.locator("button", { hasText: /Practiced today ✓|Mark as practiced today/ });
const btnText2 = (await logBtn2.textContent()).trim();
btnText2 === "Practiced today ✓" ? ok("re-rendering after already logging today relabels the button 'Practiced today ✓'") : bad("re-rendered button text: " + btnText2);
(await logBtn2.isDisabled()) ? ok("the relabeled button is disabled, preventing a second log for the same day") : bad("relabeled button is not disabled");

// Attempting to click a genuinely disabled button is a real no-op in a
// browser (no click event dispatches) - the actual mechanism preventing a
// duplicate entry, not just an attribute this test takes on faith.
await logBtn2.click({ force: false }).catch(() => {});
await page.waitForTimeout(200);
const afterSecondAttempt = await getLog();
afterSecondAttempt.length === 1 ? ok("attempting to click the disabled button does not add a duplicate log entry for the same day") : bad("log after disabled-click attempt: " + JSON.stringify(afterSecondAttempt));

// ==================== 4) Streak: 2 consecutive days shows the banner ====================
await setLog([
  { date: "2026-08-28", skill: "seed-a", ts: 1 },
  { date: "2026-08-29", skill: "seed-b", ts: 2 },
]);
// The streak only lights up when the most recent log is "live" (today or
// yesterday) - anchor the seeded dates to the real current day so this
// assertion holds regardless of when the suite runs.
await page.evaluate(async (key) => {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const yest = new Date(today.getTime() - 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  await window.G.db.setSetting(key, [
    { date: iso(yest), skill: "seed-a", ts: 1 },
    { date: iso(today), skill: "seed-b", ts: 2 },
  ]);
}, LOG_KEY);
await gotoHealth();
const streakText = await page.locator("span", { hasText: /resilience practice streak/ }).textContent().catch(() => null);
/^🌱 2-day resilience practice streak$/.test((streakText || "").trim())
  ? ok("2 real consecutive days (yesterday + today) shows the correct '2-day resilience practice streak' banner")
  : bad("streak banner text for 2 consecutive days: " + JSON.stringify(streakText));

// ==================== 5) A one-day gap correctly suppresses the streak ====================
await page.evaluate(async (key) => {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const twoAgo = new Date(today.getTime() - 2 * 86400000); // gap: yesterday is missing
  const iso = (d) => d.toISOString().slice(0, 10);
  await window.G.db.setSetting(key, [
    { date: iso(twoAgo), skill: "seed-a", ts: 1 },
    { date: iso(today), skill: "seed-b", ts: 2 },
  ]);
}, LOG_KEY);
await gotoHealth();
const noStreakText = await page.locator("span", { hasText: /resilience practice streak/ }).count();
noStreakText === 0 ? ok("a one-day gap in the log correctly suppresses the streak banner entirely") : bad("streak banner rendered despite a real gap in the log");

// cleanup
await setLog([]);

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nRESILIENCE DAILY SKILLS: all passed");
process.exit(fails ? 1 : 0);
