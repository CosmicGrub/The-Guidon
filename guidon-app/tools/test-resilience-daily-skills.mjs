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
 *
 * Calendar day = the Soldier's LOCAL day. The app keys the log by
 * localIsoDate() (local year-month-day) and lights the streak only when the
 * newest entry is the local today or yesterday. This suite used to compute
 * its expected dates with toISOString() (UTC), which is tomorrow's date
 * from 19:00 local in Central Daylight Time, so it went red every evening
 * ("persisted date ... 2026-09-04" while it expected 2026-09-05, and the
 * seeded "today" was a day the app had not reached yet, so no streak). The
 * expectation is now computed IN THE PAGE with local getters, and the
 * straddle is provable on demand: GUIDON_CLOCK=<local date-time> installs a
 * Playwright page clock at that instant (time then flows normally), e.g.
 *   GUIDON_CLOCK=2026-09-04T23:30:00 node tools/test-resilience-daily-skills.mjs
 *   GUIDON_CLOCK=2026-09-05T00:30:00 node tools/test-resilience-daily-skills.mjs
 * The INFO line prints the page's local day next to its UTC day so a
 * straddling run is visible in the output.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

const FAKE_CLOCK = process.env.GUIDON_CLOCK || "";
if (FAKE_CLOCK) {
  const at = new Date(FAKE_CLOCK);
  if (Number.isNaN(at.getTime())) { bad("GUIDON_CLOCK is not a date: " + FAKE_CLOCK); process.exit(1); }
  await page.clock.install({ time: at });
  info("page clock installed at " + at.toString());
}
/* The page's own calendar: local day strings, computed with the same local
   getters a Soldier's device uses. Read fresh each time (the clock flows). */
async function pageDays() {
  return page.evaluate(() => {
    const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const t = new Date();
    return {
      today: iso(t),
      yest: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1)),
      twoAgo: iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 2)),
      utc: t.toISOString().slice(0, 10),
      clock: t.toString(),
    };
  });
}

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await dismissOnboarding(page);
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
const days = await pageDays();
info("page clock " + days.clock + " -> local day " + days.today + ", UTC day " + days.utc + (days.today === days.utc ? "" : " (STRADDLE: the two calendars disagree right now)"));
(afterClickLog[0] && afterClickLog[0].date === days.today) ? ok("the persisted entry's date is the LOCAL today (" + days.today + ")") : bad("persisted date: " + JSON.stringify(afterClickLog[0]) + ", expected local today " + days.today);
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
// yesterday) - anchor the seeded dates to the page's LOCAL current day so
// this assertion holds regardless of when the suite runs (UTC-anchored
// seeds put "today" one day ahead of the app every evening in CDT).
{
  const d = await pageDays();
  await setLog([
    { date: d.yest, skill: "seed-a", ts: 1 },
    { date: d.today, skill: "seed-b", ts: 2 },
  ]);
}
await gotoHealth();
const streakText = await page.locator("span", { hasText: /resilience practice streak/ }).textContent().catch(() => null);
/^🌱 2-day resilience practice streak$/.test((streakText || "").trim())
  ? ok("2 real consecutive days (yesterday + today) shows the correct '2-day resilience practice streak' banner")
  : bad("streak banner text for 2 consecutive days: " + JSON.stringify(streakText));

// ==================== 5) A one-day gap correctly suppresses the streak ====================
{
  const d = await pageDays();
  await setLog([
    { date: d.twoAgo, skill: "seed-a", ts: 1 }, // gap: yesterday is missing
    { date: d.today, skill: "seed-b", ts: 2 },
  ]);
}
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
