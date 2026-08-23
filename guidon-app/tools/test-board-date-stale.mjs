/**
 * Roadmap Tier 3 (quick wins): a past board date. generateActionPlan()'s
 * board-date branch (profile.js) only pushes items for a non-negative
 * days-until value (`out >= 0`) - a board date that has already passed (a
 * real board happened and the Soldier forgot to update it, or it slipped)
 * silently produced nothing there, and nothing on the Profile screen ever
 * told the Soldier their saved board date was stale - the only place a past
 * board date showed at all was a parenthetical "(past)" buried in the
 * "Print readiness summary" output. Fixed by surfacing renderBoardCountdown()
 * (already shared by Home and Board Drill, and already rendering this exact
 * "N days since your board" / red-urgency case correctly) on the Profile
 * screen itself, but ONLY when the saved board date is in the past - a
 * future board date must stay silent here, since Home/Board Drill already
 * own the day-to-day countdown for that case.
 *
 * This seeds a real (non-guest) personal profile directly into IndexedDB -
 * same pattern test-career.mjs uses for its profile.mos prefill case - then
 * reloads so profile.js's module-private _cache picks up the seeded row on
 * its very first read, rather than racing the page's own boot-time reads.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

function isoDaysFromToday(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);

// ============================================================================
// Part 1: a board date 14 days in the PAST must show the stale-date flag.
// ============================================================================
const pastDate = isoDaysFromToday(-14);
await page.evaluate(async (bd) => {
  await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
    onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
    lastName: "PASTDUE", boardDate: bd,
  } });
}, pastDate);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(700);

const pastState = await page.evaluate(() => {
  // Scoped to #app (the router's mount point), not document.body: the
  // giant inline <script> lives INSIDE <body> in this single-file app (see
  // index.html - <body> opens at line 5039, the main <script> at 5093), so
  // document.body.textContent recursively includes the entire raw JS
  // source as text - which trivially "contains" any string this fix's own
  // source code mentions, regardless of whether it was actually rendered.
  // #app has no <script> descendants, so its textContent reflects only
  // what actually rendered.
  const body = (document.getElementById("app") || document.body).textContent || "";
  const banner = document.querySelector(".tx-countdown-banner");
  return {
    hasHint: /Your saved board date has passed/.test(body),
    hasBanner: !!banner,
    bannerText: banner ? banner.textContent : null,
    bannerBorderColor: banner ? getComputedStyle(banner).borderLeftColor || banner.style.borderColor : null,
    hasChangeBtn: banner ? [...banner.querySelectorAll("button")].some((b) => /Change/.test(b.textContent || "")) : false,
  };
});

pastState.hasHint
  ? ok("a past board date shows the explanatory hint prompting the Soldier to update or confirm it")
  : bad("no 'Your saved board date has passed' hint found on the Profile screen for a 14-days-ago board date");
pastState.hasBanner
  ? ok("a past board date renders the shared .tx-countdown-banner (renderBoardCountdown()) on the Profile screen")
  : bad(".tx-countdown-banner not found on the Profile screen for a past board date");
(pastState.bannerText && /days since your board/i.test(pastState.bannerText))
  ? ok("the banner uses the app's own existing 'N days since your board' language, not invented copy")
  : bad("banner text did not contain 'days since your board': " + JSON.stringify(pastState.bannerText));
pastState.hasChangeBtn
  ? ok("the banner includes a working 'Change' control so the Soldier can actually update the stale date")
  : bad("no 'Change' button found inside the past-board-date banner");

// ============================================================================
// Part 2: a board date 30 days in the FUTURE must show no such flag - only
// the stale (past) case is flagged here; Home/Board Drill already own the
// live countdown for an upcoming board.
// ============================================================================
const futureDate = isoDaysFromToday(30);
await page.evaluate(async (bd) => {
  await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
    onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
    lastName: "PASTDUE", boardDate: bd,
  } });
}, futureDate);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(700);

const futureState = await page.evaluate(() => {
  const body = (document.getElementById("app") || document.body).textContent || "";
  return {
    hasHint: /Your saved board date has passed/.test(body),
    hasBanner: !!document.querySelector(".tx-countdown-banner"),
  };
});
(!futureState.hasHint && !futureState.hasBanner)
  ? ok("a future (30-days-out) board date shows no stale-date flag/banner on the Profile screen")
  : bad("a future board date incorrectly showed the stale-date flag: " + JSON.stringify(futureState));

// ============================================================================
// Part 3: no saved board date at all must also show no flag (nothing to be
// stale about) - guards against the check firing on an unset/empty field.
// ============================================================================
await page.evaluate(async () => {
  await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
    onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
    lastName: "NODATE", boardDate: "",
  } });
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(700);

const noDateState = await page.evaluate(() => ({
  hasHint: /Your saved board date has passed/.test((document.getElementById("app") || document.body).textContent || ""),
  hasBanner: !!document.querySelector(".tx-countdown-banner"),
}));
(!noDateState.hasHint && !noDateState.hasBanner)
  ? ok("no saved board date at all shows no stale-date flag/banner (nothing to flag)")
  : bad("an unset board date incorrectly showed the stale-date flag: " + JSON.stringify(noDateState));

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `BOARD DATE STALE: ${fails} FAILURE(S)` : "BOARD DATE STALE: all passed"));
process.exit(fails ? 1 : 0);
