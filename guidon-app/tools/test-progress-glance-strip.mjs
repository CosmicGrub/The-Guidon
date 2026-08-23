/**
 * Roadmap Tier 3: "at a glance" dashboard strip for Progress.
 *
 * Progress's own render pass already computes every number a quick-glance
 * summary needs - overall %, weakest LRM dimension, mandatory-training
 * completion %, study streak, and Board Drill cards due - but (before this
 * fix) each one only ever surfaced inside its own separate panel, scattered
 * down the page (headline / coverage-gaps callout / Mandatory Training
 * panel / Weekly Study Goal panel / Board Q Readiness teaser). This test
 * seeds one deterministic profile via the real G.store/G.db APIs (same
 * direct-API seeding style as test-progress-cache.mjs and
 * test-consistency-extended.mjs), then confirms:
 *
 *   1. A new .readiness-dash strip renders directly under the headline
 *      panel (before the Mandatory Training panel in DOM order), reusing
 *      Home's existing .readiness-tile compact-stat-card shape.
 *   2. All 5 tiles show real, correct values for the seeded profile.
 *   3. None of those 5 values drift from what the pre-existing panels
 *      further down the same page independently show for the identical
 *      underlying data - the exact failure mode
 *      test-consistency-extended.mjs already guards elsewhere in this app.
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
// Onboarding lands on #/home - step off it so the real navigation to
// #/progress below actually fires the router instead of a same-hash no-op.
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(300);

// ── Pick two real board-question categories to seed against, dynamically -
//    same approach test-consistency-extended.mjs uses, so this test doesn't
//    pin the exact corpus shape (which can legitimately shift release to
//    release), just that it's big enough to hold a deterministic seed. ─────
const catMeta = await page.evaluate(() => {
  const qs = (window.G.store && window.G.store.boardQuestions && window.G.store.boardQuestions()) || [];
  const byCat = {};
  qs.forEach((q) => { (byCat[q.category] = byCat[q.category] || []).push(q.id); });
  let cats = Object.keys(byCat).filter((c) => byCat[c].length >= 8);
  if (cats.length < 2) cats = Object.keys(byCat).filter((c) => byCat[c].length >= 5);
  cats.sort((a, b) => byCat[b].length - byCat[a].length);
  return { catA: cats[0], catB: cats[1], idsA: cats[0] ? byCat[cats[0]] : [], idsB: cats[1] ? byCat[cats[1]] : [] };
});
if (!catMeta.catA || !catMeta.catB) {
  bad("could not find two board-question categories large enough to seed - aborting");
  await browser.close(); await server.close(); process.exit(1);
}
const dueIds = catMeta.idsA.slice(0, 5);       // 5 "due" cards
const masteredIds = catMeta.idsB.slice(0, 4);  // 4 "mastered" (not due) cards
ok(`seeding board SRS against real categories "${catMeta.catA}" and "${catMeta.catB}" (5 due + 4 mastered)`);

// ── Seed a fully deterministic profile via the real store/db APIs. ────────
const seedResult = await page.evaluate(async ({ dueIds, masteredIds }) => {
  const store = window.G.store, db = window.G.db;

  // 1) Scenario attempts / LRM dims: reset first for a clean slate, then
  //    record ONE attempt that scores every dimension except "Character"
  //    at 10 (clamps to 100% given a single touched scenario's dimTarget of
  //    4 - see store.getProgress()'s dimTarget formula) while leaving
  //    Character untouched (falsy 0 never increments dimTouches, so its
  //    dimTarget still floors at 4 and its score stays 0 -> 0%). That makes
  //    Character the unambiguous single weakest dimension at exactly 0%,
  //    and (COMPS.reduce sum 100*5+0)/6 = round(500/6) = 83% overall,
  //    landing in the "Strong" band (60-85) - both hand-computable without
  //    duplicating getProgress()'s own scaling logic in this test.
  await store.resetProgress();
  await store.recordAttempt({
    scenarioId: "qa-glance-strip-test", title: "QA Glance Strip Test", mode: "text",
    score: { Leads: 10, Develops: 10, Achieves: 10, Character: 0, Presence: 10, Intellect: 10 },
    total: 50,
  });

  // 2) Mandatory training: mark every real training scenario passed at
  //    100% via the real recordTrainingComplete() API (same call site
  //    Train mode itself uses after a passing run) so the strip's
  //    "Training passed" tile and the Mandatory Training panel read a
  //    deterministic, matching N/N.
  const trainingScs = store.scenarios().filter((s) => s.defaultMode === "training");
  trainingScs.forEach((s) => store.recordTrainingComplete(s.id, 100));

  // 3) Study streak - seeded the same way test-consistency-extended.mjs
  //    seeds it: real srs:/streak:v1 kv shape, lastActive "today" (UTC, via
  //    the app's own today()) so nothing on the page ticks/mutates it
  //    out from under this test on render.
  const today = new Date().toISOString().slice(0, 10);
  await db.setSetting("streak:v1", { lastActive: today, count: 5, longestCount: 9 });

  // 4) Board Drill SRS rows - same real srs: row shape
  //    test-consistency-extended.mjs seeds (reps/ease/interval/due/misses/
  //    lastGrade), 5 due-now cards and 4 mastered-not-due cards.
  const now = Date.now();
  const DAY = 86400000;
  for (const id of dueIds) {
    await db.setSetting("srs:" + id, { reps: 3, ease: 2.3, interval: 3, due: now - 2 * DAY, misses: 0, lastGrade: 1 });
  }
  for (const id of masteredIds) {
    await db.setSetting("srs:" + id, { reps: 2, ease: 2.5, interval: 30, due: now + 30 * DAY, misses: 0, lastGrade: 2 });
  }

  return { trainingTotal: trainingScs.length };
}, { dueIds, masteredIds });

const trainingTotal = seedResult.trainingTotal;
trainingTotal > 0 ? ok(`seeded ${trainingTotal} mandatory-training scenario(s), all passed at 100%`) : bad("no mandatory-training scenarios found in the seed corpus - training tile can't be exercised");

// ── Visit Progress and read the strip + every panel it summarizes. ────────
await page.evaluate(() => { location.hash = "#/progress"; });
await page.waitForTimeout(1200);

const data = await page.evaluate(() => {
  const out = {};

  // The new strip.
  const dash = document.querySelector('.readiness-dash[aria-label="Progress at a glance"]');
  out.dashPresent = !!dash;
  out.tiles = dash ? [...dash.querySelectorAll(".readiness-tile")].map((t) => ({
    tone: t.getAttribute("data-tone"),
    val: (t.querySelector(".readiness-val") || {}).textContent || "",
    label: (t.querySelector(".readiness-label") || {}).textContent || "",
    sub: (t.querySelector(".readiness-sub") || {}).textContent || "",
  })) : [];

  // DOM order: strip must land between the headline panel and the
  // Mandatory Training panel, per the roadmap's "under the headline panel"
  // placement. route()'s per-render `frame` div (a plain, class-less <div>
  // appended into #route - see src/index.html's route()/routeEl) is the
  // actual `mount` every view's render(mount) receives, so top-level
  // panels are its direct children.
  const panels = [...document.querySelectorAll("#route > div > .panel, #route > div > .readiness-dash")];
  out.domOrder = panels.map((p) => p.className);

  function statValue(labelText) {
    for (const s of document.querySelectorAll(".stat")) {
      const k = s.querySelector(".k"), v = s.querySelector(".v");
      if (k && v && k.textContent.trim() === labelText) return v.textContent.trim();
    }
    return null;
  }
  out.headlineReadiness = statValue("Promotable Readiness (LRM)");
  out.trainingPanelStat = statValue("Mandatory Training");
  out.streakPanelStat = statValue("Study streak");

  // Focus-area callout (coverage-gaps card).
  const focusCard = [...document.querySelectorAll(".card")].find((c) => {
    const eb = c.querySelector(".eyebrow");
    return eb && eb.textContent.trim() === "Focus area";
  });
  out.focusHeading = focusCard ? (focusCard.querySelector("h3") || {}).textContent : null;

  // Board Q Readiness teaser (intuitivism-pass one-stat-teaser panel).
  function panelByEyebrow(label) {
    for (const p of document.querySelectorAll(".panel")) {
      const eyebrow = p.querySelector(".eyebrow");
      if (eyebrow && eyebrow.textContent.trim() === label) return p;
    }
    return null;
  }
  const bqPanel = panelByEyebrow("Board Q Readiness");
  const bqHint = bqPanel ? bqPanel.querySelector("p.hint") : null;
  out.bqHint = bqHint ? bqHint.textContent.trim() : null;

  return out;
});

// ── 1. Strip renders, in the right place, with exactly 5 tiles. ───────────
data.dashPresent ? ok("the .readiness-dash strip renders on Progress") : bad("no .readiness-dash strip found on Progress");
data.tiles.length === 5 ? ok("strip shows all 5 tiles (overall / weakest / training / streak / cards due)") : bad("expected 5 tiles, got " + data.tiles.length + ": " + JSON.stringify(data.tiles));

const headlineIdx = data.domOrder.findIndex((c) => c.includes("panel"));
const dashIdx = data.domOrder.findIndex((c) => c.includes("readiness-dash"));
headlineIdx !== -1 && dashIdx !== -1 && dashIdx === headlineIdx + 1
  ? ok("strip sits immediately under the headline panel in DOM order")
  : bad("strip DOM position: headline@" + headlineIdx + " dash@" + dashIdx + " (expected dash directly after headline) - order: " + JSON.stringify(data.domOrder.slice(0, 5)));

// ── 2/3. Each tile's value is correct AND matches the panel it summarizes. ─
const [tOverall, tWeakest, tTraining, tStreak, tDue] = data.tiles;

// Tile 1: Overall readiness - 83%, "Strong", cyan (matches the headline
// panel's own "Promotable Readiness (LRM)" stat, hand-computed above).
tOverall && tOverall.val === "83%" && tOverall.sub === "Strong" && tOverall.tone === "cyan"
  ? ok(`Overall readiness tile reads "${tOverall.val} / ${tOverall.sub}" (cyan)`)
  : bad("Overall readiness tile: " + JSON.stringify(tOverall));
data.headlineReadiness === "Strong"
  ? ok('headline panel\'s own "Promotable Readiness (LRM)" stat also reads "Strong" (no drift)')
  : bad('headline panel "Promotable Readiness (LRM)": expected "Strong", got ' + JSON.stringify(data.headlineReadiness));

// Tile 2: Weakest dimension - Character at 0%, amber (matches the
// coverage-gaps "Focus area" callout, which only appears below 40%).
tWeakest && tWeakest.label === "Character" && tWeakest.val === "0%" && tWeakest.tone === "amber"
  ? ok(`Weakest-dimension tile reads "${tWeakest.label}: ${tWeakest.val}" (amber)`)
  : bad("Weakest-dimension tile: " + JSON.stringify(tWeakest));
data.focusHeading && data.focusHeading.trim() === "Character (0%)"
  ? ok('Focus-area callout also reads "Character (0%)" (no drift)')
  : bad('Focus-area callout: expected "Character (0%)", got ' + JSON.stringify(data.focusHeading));

// Tile 3: Training passed - N/N, "Complete", green (matches the Mandatory
// Training panel's own PASSED count).
const expectTraining = trainingTotal + "/" + trainingTotal;
tTraining && tTraining.val === expectTraining && tTraining.sub === "Complete" && tTraining.tone === "green"
  ? ok(`Training-passed tile reads "${tTraining.val}" (Complete, green)`)
  : bad("Training-passed tile: expected " + expectTraining + ", got " + JSON.stringify(tTraining));
data.trainingPanelStat === trainingTotal + " / " + trainingTotal + " PASSED"
  ? ok(`Mandatory Training panel also reads "${data.trainingPanelStat}" (no drift)`)
  : bad('Mandatory Training panel: expected "' + trainingTotal + " / " + trainingTotal + ' PASSED", got ' + JSON.stringify(data.trainingPanelStat));

// Tile 4: Study streak - 5d, best 9d, amber (matches the Weekly Study Goal
// panel's own "Study streak" stat).
tStreak && tStreak.val === "5d" && tStreak.sub === "Best: 9d" && tStreak.tone === "amber"
  ? ok(`Study-streak tile reads "${tStreak.val}" (${tStreak.sub}, amber)`)
  : bad("Study-streak tile: " + JSON.stringify(tStreak));
data.streakPanelStat === "🔥 5d  (best: 9d)"
  ? ok('Weekly Study Goal panel also reads "🔥 5d  (best: 9d)" (no drift)')
  : bad('Weekly Study Goal panel "Study streak": expected "🔥 5d  (best: 9d)", got ' + JSON.stringify(data.streakPanelStat));

// Tile 5: Cards due - 5 (the seeded due count), amber (matches the Board Q
// Readiness teaser's own raw due count in its hint text).
tDue && tDue.val === "5" && tDue.label === "Cards due" && tDue.sub === "Ready to drill" && tDue.tone === "amber"
  ? ok(`Cards-due tile reads "${tDue.val}" (Ready to drill, amber)`)
  : bad("Cards-due tile: " + JSON.stringify(tDue));
const bqDueMatch = data.bqHint && data.bqHint.match(/(\d+)\s+due for review/);
bqDueMatch && parseInt(bqDueMatch[1], 10) === 5
  ? ok(`Board Q Readiness teaser also reads "${data.bqHint}" (5 due, no drift)`)
  : bad('Board Q Readiness teaser: expected "...5 due for review...", got ' + JSON.stringify(data.bqHint));

// ── Console hygiene, same bar every other suite in this repo holds to. ────
const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nPROGRESS GLANCE STRIP: all passed");
process.exit(fails ? 1 : 0);
