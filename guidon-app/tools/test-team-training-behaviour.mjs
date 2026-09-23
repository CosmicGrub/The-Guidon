/**
 * Team Training (#/team, src/app-modules/team-training.js) - behaviour suite.
 *
 * The roadmap suite only ever started ONE of the ten exercises, at the default
 * "all ranks" filter. That is how half the catalog could dead-end for every
 * senior leader without a single red test. This suite starts every exercise
 * under three rank filters and then actually runs the different kinds of
 * session to the end, through the real UI.
 *
 * What each block guards:
 *  1. Rank-filter matrix: with the device owner's rank filter at "all", "E3"
 *     and "E7", every one of the ten Start buttons opens something a team can
 *     use - a live decision lane or a session panel with a working button -
 *     and never an internal scenario id. (On the old code five exercises
 *     dead-ended at E7 and two at E3, with no button on screen.)
 *  2. A lane GUIDON cannot find degrades in plain words: a shorter relay when
 *     some lanes exist, a clear panel with "Return to catalog" when none do.
 *  3. A relay run to the end at E7 records one completion, shows it on the
 *     card, and "Return to catalog" puts focus back on that exercise.
 *  4. Multi-lane hand-off: finishing lane 1 starts lane 2; exiting lane 2
 *     records nothing and still offers the way back.
 *  5. Teach-Back: six prompts, answers hidden until revealed, a fresh draw is
 *     really different, a double tap records once, focus is never dropped.
 *  6. AAR, facilitator card and linked-drill sessions: focus lands on the new
 *     panel, recording works, focus is kept.
 *  7. Phase filter: pressed state, card count, announcement.
 *  8. 390px: no horizontal overflow on the catalog or inside a live lane.
 *
 * One browser, two contexts (desktop / phone).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));
// A thrown locator timeout in one block must not hide the blocks after it.
async function section(title, fn) {
  console.log("\n" + title);
  try { await fn(); } catch (e) { bad("block stopped early: " + String(e && e.message || e).split("\n")[0]); }
}

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];
const watch = (page, tag) => {
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(tag + " " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push(tag + " pageerror: " + e.message));
};

const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(5000);
watch(page, "[main]");
await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);

const LANE_EXERCISES = ["contact-relay", "all-domain", "casualty-chain", "degraded-9line", "tccc-night"];
const sleep = (ms) => page.waitForTimeout(ms);
async function openTeam(p = page) {
  await p.evaluate(() => { location.hash = "#/home"; });
  await p.waitForTimeout(150);
  await p.evaluate(() => { location.hash = "#/team"; });
  await p.waitForSelector("[data-team-start]", { timeout: 8000 });
}
const setTier = (tier, p = page) => p.evaluate(async (t) => { await window.G.store.setSetting("tierFilter", t); }, tier);
const counts = (p = page) => p.evaluate(() => window.G.db.getSetting("team:training:v1", {}));
const live = (p = page) => p.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");
const focusInfo = (p = page) => p.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return { where: "BODY", inSession: false };
  return { where: a.tagName.toLowerCase() + ":" + (a.textContent || "").trim().slice(0, 40), inSession: !!a.closest("[data-team-session]"), start: a.getAttribute("data-team-start") };
});
const sessionState = (p = page) => p.evaluate(() => {
  const s = document.querySelector("[data-team-session]");
  const usable = Array.from(s.querySelectorAll("button")).filter((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true");
  return {
    text: (s.textContent || "").replace(/\s+/g, " ").trim(),
    buttons: usable.map((b) => (b.textContent || "").trim()),
    lane: !!s.querySelector(".engine-head"),
    heading: !!s.querySelector("[data-team-heading]"),
  };
});
// Drives whatever the collective engine is showing until `stop()` is true.
async function walkLane(stop, maxSteps = 120) {
  for (let i = 0; i < maxSteps; i++) {
    if (await stop()) return true;
    const acted = await page.evaluate(() => {
      const host = document.querySelector("[data-team-session] .team-engine-host");
      if (!host) return "none";
      const usable = (sel) => Array.from(host.querySelectorAll(sel)).filter((b) => !b.disabled);
      const byText = (re) => usable("button").find((b) => re.test((b.textContent || "").trim()));
      const done = byText(/^Done$/i); if (done) { done.click(); return "done"; }
      const cont = byText(/^Continue$/i); if (cont) { cont.click(); return "continue"; }
      const commit = byText(/^Commit team answer$/i); if (commit) { commit.click(); return "commit"; }
      const choice = usable(".collective-choice")[0]; if (choice) { choice.click(); return "choice"; }
      const early = byText(/^Lock decision early$/i); if (early) { early.click(); return "early"; }
      const primary = usable("button.btn.primary")[0]; if (primary) { primary.click(); return "primary"; }
      return "stuck";
    });
    if (acted === "stuck" || acted === "none") { await sleep(120); }
    await sleep(40);
  }
  return false;
}

await section("1. Every exercise starts under every rank filter", async () => {
  const ids = await page.evaluate(() => window.G.teamTraining.CATALOG.map((x) => x.id));
  check(ids.length === 10, "the catalog lists ten exercises", "catalog ids: " + JSON.stringify(ids));
  for (const tier of ["all", "E3", "E7"]) {
    await setTier(tier);
    await openTeam();
    const dead = [];
    for (const id of ids) {
      await page.locator('[data-team-start="' + id + '"]').click();
      await sleep(180);
      const st = await sessionState();
      const leaked = /Scenario unavailable|\bsc-[a-z0-9-]+/i.test(st.text);
      const wantsLane = LANE_EXERCISES.includes(id);
      if (leaked || !st.buttons.length || (wantsLane && !st.lane) || (!wantsLane && !st.heading)) dead.push(id + " -> " + JSON.stringify({ lane: st.lane, buttons: st.buttons.slice(0, 3), text: st.text.slice(0, 90) }));
    }
    check(dead.length === 0, "rank filter " + tier + ": all ten Start buttons open a usable session (five of them a live decision lane)", "rank filter " + tier + ": " + dead.length + " exercise(s) dead-end: " + dead.join(" | "));
  }
});

await section("2. A lane that cannot be found degrades in plain words", async () => {
  await setTier("E7");
  await openTeam();
  // Point real catalog rows at lanes that do not exist (restored below).
  await page.evaluate(() => {
    const C = window.G.teamTraining.CATALOG, by = (id) => C.find((x) => x.id === id);
    window.__lanesBackup = { a: by("degraded-9line").lanes.slice(), b: by("tccc-night").lanes.slice() };
    by("degraded-9line").lanes = ["sc-this-lane-does-not-exist"];
    by("tccc-night").lanes = ["sc-this-lane-does-not-exist", "sc-medevac-9line-callin"];
  });
  await page.locator('[data-team-start="degraded-9line"]').click();
  await sleep(200);
  let st = await sessionState();
  check(/isn.t available on this device/i.test(st.text) && !/sc-/.test(st.text), "no lane at all: a plain-language panel, no internal id", "unavailable panel text: " + st.text.slice(0, 160));
  check(st.buttons.some((b) => /return to catalog/i.test(b)), "...with a Return to catalog button", "buttons on the unavailable panel: " + JSON.stringify(st.buttons));
  check((await focusInfo()).inSession, "...and focus moved onto the panel", "focus: " + JSON.stringify(await focusInfo()));
  const before = await counts();
  check(!before["degraded-9line"], "...and nothing was recorded", "counts: " + JSON.stringify(before));
  await page.locator('[data-team-start="tccc-night"]').click();
  await sleep(200);
  st = await sessionState();
  check(st.lane && /Relay 1 of 1/.test(st.text) && /shorter/i.test(st.text) && !/sc-/.test(st.text), "one lane of two missing: the relay still runs, one lane shorter, and says so", "partial relay: " + st.text.slice(0, 200));
  await page.evaluate(() => {
    const C = window.G.teamTraining.CATALOG, by = (id) => C.find((x) => x.id === id);
    by("degraded-9line").lanes = window.__lanesBackup.a; by("tccc-night").lanes = window.__lanesBackup.b;
  });
});

await section("3. A relay run to the end (rank filter E7) records once and hands focus back", async () => {
  await setTier("E7");
  await page.evaluate(() => window.G.db.setSetting("team:training:v1", {}));
  await openTeam();
  await page.locator('[data-team-start="contact-relay"]').click();
  await page.waitForSelector("[data-team-session] .engine-head", { timeout: 4000 });
  await sleep(120);
  check(/contact report relay started/i.test(await live()), "starting an exercise is announced (\"" + (await live()) + "\")", "announcement after Start: " + JSON.stringify(await live()));
  const finished = await walkLane(async () => /Relay complete/.test((await sessionState()).text));
  check(finished, "the collective lane can be played to \"Relay complete\"", "lane never completed: " + (await sessionState()).text.slice(0, 200));
  await sleep(250);
  const c = await counts();
  check(c["contact-relay"] && c["contact-relay"].count === 1, "one completion is recorded", "counts: " + JSON.stringify(c));
  const cardCount = await page.locator('[data-team-count="contact-relay"]').innerText().catch(() => "");
  check(/1/.test(cardCount), "the exercise card shows it without leaving the screen (\"" + cardCount + "\")", "card completions line: " + JSON.stringify(cardCount));
  check((await focusInfo()).inSession, "focus is on the completion panel", "focus: " + JSON.stringify(await focusInfo()));
  await page.locator("[data-team-return]").click();
  await page.waitForSelector("[data-team-start]", { timeout: 4000 });
  await sleep(250);
  const f = await focusInfo();
  check(f.start === "contact-relay", "\"Return to catalog\" puts focus on that exercise's Start button", "focus after return: " + JSON.stringify(f));
});

await section("4. Multi-lane hand-off and exit", async () => {
  await openTeam();
  await page.locator('[data-team-start="tccc-night"]').click();
  await page.waitForSelector("[data-team-session] .engine-head", { timeout: 4000 });
  check(/Relay 1 of 2/.test((await sessionState()).text), "the two-lane circuit starts on lane 1 of 2", "session: " + (await sessionState()).text.slice(0, 120));
  const handed = await walkLane(async () => /Relay 2 of 2/.test((await sessionState()).text));
  check(handed, "finishing lane 1 hands off to lane 2", "never reached lane 2: " + (await sessionState()).text.slice(0, 160));
  await page.locator("[data-team-session] .engine-head button", { hasText: /^Exit$/ }).click();
  await sleep(250);
  const st = await sessionState();
  check(/not recorded/i.test(st.text) && st.buttons.some((b) => /return to catalog/i.test(b)), "exiting lane 2 says nothing was recorded and offers the way back", "after exit: " + st.text.slice(0, 160) + " " + JSON.stringify(st.buttons));
  check(!(await counts())["tccc-night"], "...and no completion was added", "counts: " + JSON.stringify(await counts()));
  check((await focusInfo()).where !== "BODY", "...and focus is not dropped", "focus fell to <body> after Exit");
});

await section("5. Teach-Back Rounds", async () => {
  await setTier("all");
  await openTeam();
  await page.locator('[data-team-start="teach-back"]').click();
  await sleep(200);
  const tb = () => page.evaluate(() => ({
    ids: Array.from(document.querySelectorAll("[data-teachback-card]")).map((c) => c.getAttribute("data-teachback-card")),
    hidden: Array.from(document.querySelectorAll("[data-teachback-answer]")).map((a) => a.textContent),
  }));
  let t = await tb();
  check(t.ids.length === 6 && t.hidden.every((x) => x === "Answer hidden"), "six prompts, every answer hidden", "teach-back: " + JSON.stringify(t));
  check((await focusInfo()).inSession, "focus moved to the new panel", "focus: " + JSON.stringify(await focusInfo()));
  await page.locator('[data-teachback-reveal="0"]').focus();
  await page.locator('[data-teachback-reveal="0"]').click();
  const shown = await page.locator('[data-teachback-answer="0"]').innerText();
  check(shown.length > 3 && shown !== "Answer hidden" && !/\[object/.test(shown), "Reveal shows the answer", "revealed text: " + JSON.stringify(shown));
  check((await focusInfo()).where !== "BODY", "...and focus is kept on the used button", "focus fell to <body> after Reveal");
  let different = false;
  for (let i = 0; i < 5 && !different; i++) {
    await page.locator("[data-teachback-again]").click();
    await sleep(120);
    const n = await tb();
    different = JSON.stringify(n.ids) !== JSON.stringify(t.ids);
    t = n;
  }
  check(different, "a new round draws different questions (it used to be the same six every time)", "five redraws all served " + JSON.stringify(t.ids));
  await page.evaluate(() => window.G.db.setSetting("team:training:v1", {}));
  await page.evaluate(() => { const b = document.querySelector("[data-team-session] [data-team-record]"); b.focus(); b.click(); b.click(); });
  await sleep(500);
  const c = await counts();
  check(c["teach-back"] && c["teach-back"].count === 1, "a double tap on Record counts once", "counts after double tap: " + JSON.stringify(c));
  check((await focusInfo()).where !== "BODY", "...and focus is kept", "focus fell to <body> after recording");
});

await section("6. AAR, facilitator card and linked drills", async () => {
  await openTeam();
  await page.evaluate(() => window.G.db.setSetting("team:training:v1", {}));
  for (const [id, mustHave] of [["aar-huddle", /What was supposed to happen/], ["blind-relay", /Brief the objective/], ["pace-trust", /Open Leadership Drills/i]]) {
    await page.locator('[data-team-start="' + id + '"]').click();
    await sleep(200);
    const st = await sessionState();
    check(mustHave.test(st.text) && (await focusInfo()).inSession, id + ": opens its session panel and moves focus to it", id + ": " + st.text.slice(0, 120) + " focus=" + JSON.stringify(await focusInfo()));
    await page.locator("[data-team-session] [data-team-record]").focus();
    await page.locator("[data-team-session] [data-team-record]").click();
    await sleep(350);
    const c = await counts();
    check(c[id] && c[id].count === 1 && (await focusInfo()).where !== "BODY", id + ": recording works and keeps focus", id + ": counts=" + JSON.stringify(c[id]) + " focus=" + JSON.stringify(await focusInfo()));
  }
  // Same auto-waiting click idiom as the loop above (line 232), instead of
  // an unguarded document.querySelector(...).click() inside page.evaluate()
  // - a null element there would throw and crash the whole suite rather
  // than fail with a diagnosable timeout.
  await page.locator('[data-team-start="aar-huddle"]').click();
  const labelled = await page.evaluate(() => Array.from(document.querySelectorAll("[data-team-session] textarea")).every((t) => !!t.getAttribute("aria-label") && !!document.querySelector('label[for="' + t.id + '"]')));
  check(labelled, "every AAR note box has a visible label", "an AAR textarea has no label");
  const all = await counts();
  check(Object.keys(all).length === 3, "three sessions recorded back to back are all kept", "counts: " + JSON.stringify(all));
});

await section("7. Phase filter", async () => {
  await openTeam();
  await page.locator('[data-team-phase="2"]').click();
  await sleep(150);
  const ph = await page.evaluate(() => ({
    cards: document.querySelectorAll("[data-team-exercise]").length,
    pressed: Array.from(document.querySelectorAll("[data-team-phase]")).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-team-phase")),
  }));
  check(ph.cards === 3 && JSON.stringify(ph.pressed) === '["2"]', "Phase 2 shows its three exercises and is the only pressed filter", "phase filter: " + JSON.stringify(ph));
  check(/phase 2/i.test(await live()) && /3/.test(await live()), "...and the change is announced (\"" + (await live()) + "\")", "announcement: " + JSON.stringify(await live()));
  check((await focusInfo()).where !== "BODY", "...and focus stays on the filter", "focus fell to <body>");
});

await section("8. Phone width (390px)", async () => {
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page3 = await ctx3.newPage();
  page3.setDefaultTimeout(5000);
  watch(page3, "[phone]");
  await page3.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page3);
  await setTier("E7", page3);
  await openTeam(page3);
  const fit = () => page3.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  let o = await fit();
  check(o.sw <= o.cw, "the catalog fits 390px (" + o.sw + " <= " + o.cw + ")", "catalog overflows at 390px: " + o.sw + " > " + o.cw);
  await page3.locator('[data-team-start="all-domain"]').click();
  await page3.waitForSelector("[data-team-session] .engine-head", { timeout: 4000 });
  await page3.waitForTimeout(250);
  o = await fit();
  check(o.sw <= o.cw, "a live decision lane fits 390px (" + o.sw + " <= " + o.cw + ")", "live lane overflows at 390px: " + o.sw + " > " + o.cw);
  await ctx3.close();
});

check(noise.length === 0, "no console errors/warnings or page errors in any context", "console noise: " + noise.slice(0, 5).join(" | "));

console.log(fails === 0 ? "\nTEAM TRAINING BEHAVIOUR: all passed" : "\nTEAM TRAINING BEHAVIOUR: " + fails + " failed");
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
