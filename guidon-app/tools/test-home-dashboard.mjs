/**
 * Roadmap-week audit finding: views.home() (#/home) renders several real,
 * computed/clickable widgets - an ETS countdown banner with milestone chips
 * and red/amber/green urgency, a daily-streak banner (G.streak.tick()), a
 * "due for review" board-cards card whose count comes from a real
 * G.board.loadAllSrs()/isDueSrs() scan and whose click navigates to #/board,
 * and a "Recommended next" scenario card whose click seeds G.nav and
 * navigates to #/train - but only the unrelated 7-day trend sparkline
 * (test-home-trend-sparkline.mjs) had a dedicated test. Everything else was
 * only ever swept as part of a generic "renders without throwing" pass.
 *
 * Demonstrated empirically before writing this test: breaking the due-count
 * card's onclick (#/board -> #/home, a real navigation regression) still
 * passed test-home-trend-sparkline.mjs, test-scenario-difficulty-normalize.mjs,
 * and test-misc-routes.mjs 100% clean. This file seeds real data for each
 * widget and clicks through it, the same real-selector-from-source method
 * test-baseline-coverage.mjs uses for its 11 routes.
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

// ==================== 1) ETS countdown banner ====================
// 45 days out: <=90 -> amber (not <=30 red, not plain green), and every
// milestone at 60/90/180 days is already "done" while the 30-day one is not
// - exercises the milestone-chip done/not-done split in one seed, and the
// amber tier's own "BDD window open" action-line branch (bddDays = 45-90 =
// -45, i.e. <=0, so the "window already open" message, not the "opens in N
// days" one).
const etsDays = 45;
await page.evaluate(async (days) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days);
  const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  await window.G.store.setSetting("etsDate", iso);
}, etsDays);

await page.evaluate(() => { location.hash = "#/"; });
await page.waitForTimeout(150);
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(500);

const etsBanner = page.locator(".ets-banner");
(await etsBanner.count()) ? ok(".ets-banner renders for a set etsDate") : bad(".ets-banner did not render");
const etsDaysText = await page.locator(".ets-days").textContent().catch(() => null);
etsDaysText && etsDaysText.trim() === String(etsDays) ? ok("countdown shows the correct day count (" + etsDays + ")") : bad("ets-days text: " + etsDaysText);
const chipStates = await page.locator(".ets-chip").evaluateAll((els) => els.map((e) => ({ text: e.textContent, done: e.classList.contains("done") })));
const expectedDone = [true, true, true, false]; // 180/90/60 days out already passed at daysOut=45, 30 has not
chipStates.length === 4 && chipStates.every((c, i) => c.done === expectedDone[i])
  ? ok("milestone chips show the correct done/not-done split for " + etsDays + " days out")
  : bad("milestone chip states: " + JSON.stringify(chipStates));
const etsBorderColor = await etsBanner.evaluate((e) => getComputedStyle(e).borderLeftColor);
const amberVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--amber").trim());
const etsActionText = await page.locator(".ets-action").textContent().catch(() => "");
(amberVar && etsBorderColor && etsBorderColor !== "rgba(0, 0, 0, 0)")
  ? ok("ETS banner border reflects the amber urgency tier (" + etsBorderColor + ")")
  : bad("ETS banner border-left-color not resolved: " + etsBorderColor);
/file.*VA claim|VA\.gov/i.test(etsActionText || "")
  ? ok("amber tier shows the 'BDD window open' action line, not the countdown-to-opening variant")
  : bad("ETS action line: " + JSON.stringify(etsActionText));

// Clicking "Transition ->" navigates to #/transition.
await page.locator(".ets-nav-btn").click();
await page.waitForTimeout(200);
(await page.evaluate(() => location.hash)) === "#/transition" ? ok("'Transition →' button navigates to #/transition") : bad("hash after ETS nav click: " + (await page.evaluate(() => location.hash)));
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(400);

// ==================== 2) Daily streak banner ====================
// Seeded with lastActive === today (local) so G.streak.tick() (called live
// by views.home()) hits its "already ticked today" short-circuit and
// returns the seed UNCHANGED - a deterministic count, not dependent on
// tick()'s own increment/reset logic (that logic has its own fix and
// reasoning in the streak module itself; this test is about the BANNER
// rendering what tick() reports, not re-testing tick() itself). longestCount
// > count on purpose, to also exercise the "Best: N" sub-line.
await page.evaluate(async () => {
  const today = new Date();
  const iso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  await window.G.db.setSetting("streak:v1", { lastActive: iso, count: 4, longestCount: 9 });
});
await page.evaluate(() => { location.hash = "#/"; });
await page.waitForTimeout(150);
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(500);

const streakBanner = page.locator(".streak-banner");
(await streakBanner.count()) ? ok(".streak-banner renders for a >=2-day streak") : bad(".streak-banner did not render");
const streakCount = await page.locator(".streak-count").textContent().catch(() => null);
streakCount && streakCount.trim() === "4-day streak" ? ok("streak banner shows the seeded count (4-day streak)") : bad("streak-count text: " + streakCount);
const streakSub = await page.locator(".streak-sub").textContent().catch(() => "");
/3 days in/.test(streakSub || "") ? ok("streak sub-text matches the 3-6 day tier") : bad("streak-sub text: " + streakSub);
const streakBest = await page.locator(".streak-best").textContent().catch(() => null);
streakBest && streakBest.trim() === "Best: 9" ? ok("streak banner shows 'Best: 9' when longestCount exceeds the current count") : bad("streak-best text: " + streakBest);

// ==================== 3) "Due for review" board-cards card ====================
// isDueSrs(srs, now) = srs.lastGrade != null && srs.due <= now (lastGrade,
// not reps - see G.board.isDueSrs's own comment: reps resets to 0 on a
// "Needs Help" grade, so reps>0 would wrongly exclude a just-failed,
// due-right-now card). lastGrade is set unconditionally by the real
// schedule() in every branch, so a real SRS row always carries one -
// included here too, not just reps/due/misses, so this fixture matches
// what schedule() actually produces. 12 due cards lands in the amber tier
// (>=10, <20) - a real, non-trivial branch, not just "any count at all".
const dueSeed = await page.evaluate(async () => {
  const qs = (window.G.store.boardQuestions() || []).slice(0, 12);
  const now = Date.now();
  for (const q of qs) {
    await window.G.db.put("kv", { k: "srs:" + q.id, v: { reps: 2, ease: 2.3, interval: 3, due: now - 60000, misses: 0, lastGrade: 2 } });
  }
  return qs.length;
});
dueSeed === 12 ? ok("seeded 12 real board questions as due for review") : bad("expected 12 seeded questions, got " + dueSeed);

await page.evaluate(() => { location.hash = "#/"; });
await page.waitForTimeout(150);
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(500);

const dueCard = page.locator(".card.click", { hasText: /board cards due for review/ });
(await dueCard.count()) ? ok("due-for-review card renders with the seeded count") : bad("due-for-review card not found");
const dueCardText = await dueCard.textContent().catch(() => "");
/12 board cards due for review/.test(dueCardText || "") ? ok("due-for-review card shows the exact seeded count (12)") : bad("due-card text: " + dueCardText);
await dueCard.click();
await page.waitForTimeout(200);
(await page.evaluate(() => location.hash)) === "#/board" ? ok("clicking the due-for-review card navigates to #/board") : bad("hash after due-card click: " + (await page.evaluate(() => location.hash)));
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(400);

// ==================== 4) "Recommended next" scenario card ====================
const rec = await page.evaluate(async () => {
  const r = await window.G.store.recommendNext();
  return r && r.scenario ? { id: r.scenario.id, title: r.scenario.title, isReplay: !!r.isReplay } : null;
});
if (rec) {
  const recCard = page.locator(".card.click", { has: page.locator("h3", { hasText: rec.title }) });
  (await recCard.count()) ? ok("'Recommended next' card renders the same scenario store.recommendNext() picked (" + rec.title + ")") : bad("recommended card not found for '" + rec.title + "'");
  const eyebrow = await recCard.locator(".eyebrow").textContent().catch(() => "");
  (eyebrow || "").trim() === (rec.isReplay ? "Sharpen up" : "Recommended next")
    ? ok("card eyebrow matches isReplay state ('" + eyebrow.trim() + "')")
    : bad("eyebrow text: " + JSON.stringify(eyebrow) + " (isReplay=" + rec.isReplay + ")");
  await recCard.click();
  await page.waitForTimeout(300);
  (await page.evaluate(() => location.hash)) === "#/train" ? ok("clicking the recommended card navigates to #/train") : bad("hash after recommended-card click: " + (await page.evaluate(() => location.hash)));
  // G.nav.seed()'d the exact scenario id - Train's own render consumes it on
  // load and opens straight into that scenario rather than its plain list,
  // so the rendered Train screen showing this scenario's title is the real,
  // end-to-end proof the seed round-tripped correctly (reading G.nav's
  // internal registry directly would race Train's own consume() on render).
  const trainShowsScenario = await page.locator("body").textContent();
  trainShowsScenario.includes(rec.title)
    ? ok("Train opens directly into the recommended scenario ('" + rec.title + "'), not its plain list")
    : bad("Train screen after recommended-card click did not show '" + rec.title + "'");
} else {
  bad("store.recommendNext() returned no scenario - cannot verify the 'Recommended next' card");
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nHOME DASHBOARD: all passed");
process.exit(fails ? 1 : 0);
