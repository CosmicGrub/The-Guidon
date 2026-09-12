/**
 * #/prt (Physical Readiness Hub, views.prt in src/index.html) - Milestone 2
 * of docs/design/content-education-roadmap.md, shipped direct-to-main
 * (commit 38e531c) alongside Milestones 1 and 3, with zero test-suite
 * coverage of its own until now. Roadmap-audit round 9's test-coverage lens
 * flagged this as the single highest-value gap: #/prt, #/creeds, and
 * #/recite all landed with real content and real interaction paths, but no
 * tools/test-*.mjs suite ever exercised any of them - this file plus the
 * sibling test-creeds.mjs/test-recite.mjs close that gap, one suite per
 * route, matching this repo's established one-route-one-suite convention
 * (tools/test-landnav-drill.mjs and tools/test-moi-import.mjs are the
 * structural templates: a real route/DOM pass, plus a direct Node-level
 * check of the pure store/util functions underneath it).
 *
 * Five things covered here, none previously exercised anywhere:
 *
 *  (a) A real route/DOM pass: #/prt renders the Preparation Drill panel and
 *      lists all 10 exercises in fixed order, matching store.prtMeta()'s
 *      own real seed content (not a fixture) - ground truth is read live
 *      from window.GUIDON_SEED, same discipline
 *      tools/test-doctrine-tier-range-filter.mjs already established, so
 *      this stays correct if the seed content changes.
 *
 *  (b) store.prt(query)'s substring search filter - a name match, a
 *      case-insensitive match, an empty query returning the full flattened
 *      exercise list, and a query with zero real matches.
 *
 *  (c) util.makeRoundTimer's two behaviors #/prt's "Run the drill" mode
 *      depends on, exercised directly against a throwaway anchor element
 *      rather than by actually running a full drill (several exercises run
 *      10 reps at up to 80 counts/min, i.e. tens of real seconds each - far
 *      too slow for a unit-style check): the countdown reaching zero fires
 *      onDone() exactly once, and a real `visibilitychange` dispatch (the
 *      same idiom tools/test-rapid-fire.mjs's own fireVisibility() already
 *      established for Rapid Fire's independent timer) pauses the tick
 *      loop while the tab is hidden and resumes it on return - no silent
 *      time burn while backgrounded.
 *
 *  (d) util.fmtClock's rounding/padding/negative-clamp edge cases - a
 *      multi-minute PRT runthrough is exactly the case this helper was
 *      added for (see its own header comment: existing timers were
 *      seconds-only, wrong for anything over 60s).
 *
 *  (e) G.board.noteExternalResult(), the SAME generic SRS write hook Board
 *      Drill/Quiz/Mock Board/Recitation Drill all share, driven here via a
 *      REAL grade-button click on a PRT exercise (not a direct API call) so
 *      the exact call site at views.prt's own renderDetail() is what's
 *      under test. Confirms the write path tolerates a PRT-exercise id
 *      ("pd-ex-NN") - a namespace srsKey()/loadSrs()/saveSrs() were never
 *      written with in mind, only ever having seen board-question ids
 *      before this milestone - by checking the resulting kv row lands
 *      under "srs:<that exact id>" with the schedule() output a fresh
 *      grade-2 ("Know It") card should produce.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

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
await dismissOnboarding(page);
await page.waitForTimeout(300);

/* ========================================================================
   (a) Real route/DOM pass, ground truth read live from window.GUIDON_SEED
   ======================================================================== */
const truth = await page.evaluate(() => {
  const drill = (window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.drills[0]) || null;
  if (!drill) return null;
  const exercises = drill.exercises.slice().sort((a, b) => a.order - b.order);
  return { name: drill.name, abbr: drill.abbr, count: exercises.length, names: exercises.map((e) => e.name), firstId: exercises[0].id };
});
truth && truth.count > 0
  ? ok(`seed ground truth: drill "${truth.name}" (${truth.abbr}) has ${truth.count} exercises`)
  : bad("seed has no PRT drill/exercises to test against - has the seed changed shape?");

await page.evaluate(() => { location.hash = "#/prt"; });
await page.waitForTimeout(500);

const headingShown = await page.evaluate(() => /Physical Readiness/.test(document.querySelector("h2")?.textContent || ""));
headingShown ? ok("#/prt renders with a 'Physical Readiness' heading") : bad("'Physical Readiness' heading not found");

const panelText = await page.evaluate(() => document.querySelector(".panel")?.textContent || "");
truth && panelText.includes(truth.name + " (" + truth.abbr + ")")
  ? ok(`Drill panel shows the real drill name/abbreviation: "${truth.name} (${truth.abbr})"`)
  : bad(`Drill panel text did not include "${truth && truth.name} (${truth && truth.abbr})": ${panelText.slice(0, 200)}`);

const listNames = await page.evaluate(() =>
  [...document.querySelectorAll(".list-detail-list .ldr-name")].map((el) => el.textContent));
truth && JSON.stringify(listNames) === JSON.stringify(truth.names.map((n, i) => (i + 1) + ". " + n))
  ? ok(`Exercise list shows all ${truth.count} exercises in real fixed order: ${JSON.stringify(listNames)}`)
  : bad("Exercise list did not match the real seed order: " + JSON.stringify(listNames) + " vs expected " + JSON.stringify(truth && truth.names));

const runBtnPresent = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /Run the drill/.test(b.textContent || "")));
runBtnPresent ? ok("'▶ Run the drill' button is present") : bad("'Run the drill' button not found");

const gradeRowPresent = await page.evaluate(() => !!document.querySelector(".qz-grade-row"));
gradeRowPresent ? ok("The first exercise's detail card shows the 4-level self-grade row") : bad("no .qz-grade-row found on the default-selected exercise");

/* ========================================================================
   (b) store.prt(query) - substring search filtering
   ======================================================================== */
const noQuery = await page.evaluate(() => window.G.store.prt().length);
truth && noQuery === truth.count
  ? ok(`store.prt() with no query returns the full flattened exercise list (${noQuery})`)
  : bad(`store.prt() with no query returned ${noQuery}, expected ${truth && truth.count}`);

const nameMatch = await page.evaluate(() => window.G.store.prt("push-up").map((p) => p.name));
JSON.stringify(nameMatch) === JSON.stringify(["Push-Up"])
  ? ok('store.prt("push-up") returns exactly the "Push-Up" exercise')
  : bad('store.prt("push-up") -> ' + JSON.stringify(nameMatch));

const caseInsensitive = await page.evaluate(() => window.G.store.prt("ROWER").map((p) => p.name));
JSON.stringify(caseInsensitive) === JSON.stringify(["Rower"])
  ? ok('store.prt("ROWER") matches "Rower" case-insensitively')
  : bad('store.prt("ROWER") -> ' + JSON.stringify(caseInsensitive));

const noMatch = await page.evaluate(() => window.G.store.prt("zzz-not-a-real-exercise").length);
noMatch === 0
  ? ok("store.prt() with a fabricated query returns zero results")
  : bad("store.prt() with a fabricated query returned " + noMatch + " results, expected 0");

/* ========================================================================
   (c) util.makeRoundTimer - countdown-to-zero onDone(), pause-on-hidden-tab
   ======================================================================== */
// ---- countdown reaching zero calls onDone() exactly once, with the final
// onTick(elapsedMs, 0) firing first (same "0 = done" contract prtRunDrill's
// own onDone callback relies on to advance to the next exercise) ----
await page.evaluate(() => {
  window.__prtDoneAnchor = document.createElement("div");
  document.body.appendChild(window.__prtDoneAnchor);
  window.__prtDoneTicks = [];
  window.__prtDoneCalls = 0;
  window.__prtDoneTimer = window.G.util.makeRoundTimer({
    anchorEl: window.__prtDoneAnchor,
    totalSec: 2,
    onTick: (elapsedMs, remainingSec) => { window.__prtDoneTicks.push(remainingSec); },
    onDone: () => { window.__prtDoneCalls++; },
  });
});
await page.waitForTimeout(2500); // >2 real 1s ticks - the countdown must have already finished
const doneResult = await page.evaluate(() => ({ calls: window.__prtDoneCalls, ticks: window.__prtDoneTicks.slice() }));
doneResult.calls === 1
  ? ok("makeRoundTimer({totalSec:2}): onDone() fires exactly once when the countdown reaches zero")
  : bad("onDone() call count after a 2s countdown: " + doneResult.calls + " (expected 1)");
JSON.stringify(doneResult.ticks) === JSON.stringify([1, 0])
  ? ok('makeRoundTimer({totalSec:2}): onTick fires with remainingSec [1, 0], the final tick landing on 0 before onDone')
  : bad("tick sequence for a 2s countdown: " + JSON.stringify(doneResult.ticks) + " (expected [1, 0])");
await page.evaluate(() => {
  window.__prtDoneAnchor.remove();
  delete window.__prtDoneTimer; delete window.__prtDoneAnchor; delete window.__prtDoneTicks; delete window.__prtDoneCalls;
});

// ---- a real document.visibilitychange dispatch pauses the tick loop while
// hidden and resumes it on return (mirrors tools/test-rapid-fire.mjs's own
// fireVisibility() idiom for its own, separate timer implementation) ----
async function fireVisibility(state) {
  await page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { value: s, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}
await page.evaluate(() => {
  window.__prtPauseAnchor = document.createElement("div");
  document.body.appendChild(window.__prtPauseAnchor);
  window.__prtPauseTicks = [];
  window.__prtPauseTimer = window.G.util.makeRoundTimer({
    anchorEl: window.__prtPauseAnchor,
    totalSec: 30,
    onTick: (elapsedMs, remainingSec) => { window.__prtPauseTicks.push(remainingSec); },
  });
});
await page.waitForTimeout(1200); // >=1 real tick while visible
const afterFirstTick = await page.evaluate(() => window.__prtPauseTicks.slice());
afterFirstTick.length >= 1
  ? ok(`makeRoundTimer ticks normally while visible (${afterFirstTick.length} tick(s) after 1.2s: ${JSON.stringify(afterFirstTick)})`)
  : bad("makeRoundTimer produced no ticks at all after 1.2s while visible");

await fireVisibility("hidden");
await page.waitForTimeout(2400); // >2 ticks' worth - must NOT progress while hidden
const afterHidden = await page.evaluate(() => window.__prtPauseTicks.slice());
afterHidden.length === afterFirstTick.length
  ? ok(`makeRoundTimer does not tick at all while document.visibilityState is "hidden" (still ${afterHidden.length} tick(s), real pause not a slower tick)`)
  : bad(`ticks kept advancing while hidden: ${JSON.stringify(afterFirstTick)} -> ${JSON.stringify(afterHidden)}`);

await fireVisibility("visible");
await page.waitForTimeout(2400); // >2 ticks' worth - SHOULD resume progressing
const afterResume = await page.evaluate(() => window.__prtPauseTicks.slice());
afterResume.length > afterHidden.length
  ? ok(`makeRoundTimer resumes ticking once visibilityState returns to "visible" (${afterResume.length} tick(s) now: ${JSON.stringify(afterResume)})`)
  : bad(`makeRoundTimer never resumed after visibility returned to "visible": ${JSON.stringify(afterResume)}`);
await page.evaluate(() => {
  window.__prtPauseTimer.stop();
  window.__prtPauseAnchor.remove();
  delete window.__prtPauseTimer; delete window.__prtPauseAnchor; delete window.__prtPauseTicks;
});

/* ========================================================================
   (d) util.fmtClock - rounding/padding/negative-clamp edge cases
   ======================================================================== */
const FMT_CASES = [
  { in: 0, want: "0:00", desc: "fmtClock(0)" },
  { in: -5, want: "0:00", desc: "fmtClock(-5) - negative input clamps to zero, never a negative or NaN display" },
  { in: 65, want: "1:05", desc: "fmtClock(65) - minutes:seconds, seconds zero-padded to 2 digits" },
  { in: 59.6, want: "1:00", desc: "fmtClock(59.6) - rounds to the nearest whole second (60) before splitting into m:ss, does not truncate to 0:59" },
  { in: 61, want: "1:01", desc: "fmtClock(61) - single-digit seconds component still zero-padded ('01', not '1')" },
];
const fmtResults = await page.evaluate((cases) => cases.map((c) => window.G.util.fmtClock(c.in)), FMT_CASES);
fmtResults.forEach((got, i) => {
  got === FMT_CASES[i].want
    ? ok(FMT_CASES[i].desc + ' -> "' + got + '"')
    : bad(FMT_CASES[i].desc + ': expected "' + FMT_CASES[i].want + '", got "' + got + '"');
});

/* ========================================================================
   (e) G.board.noteExternalResult() tolerates a PRT-exercise id, driven via
   a real grade-button click at the exact views.prt() call site
   ======================================================================== */
await page.evaluate(() => { location.hash = "#/prt"; });
await page.waitForTimeout(400);
// Clean slate: this kv row can carry state across runs on a shared profile
// (same discipline tools/test-moi-import.mjs already applies to its own key).
if (truth) await page.evaluate(async (id) => { await window.G.db.put("kv", { k: "srs:" + id, v: null }); }, truth.firstId);

await page.evaluate(() => {
  const t = document.getElementById("toast");
  if (t) t.classList.remove("show");
});
const gradeClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".qz-grade-row button")].find((b) => /Know It/.test(b.textContent || ""));
  if (btn) { btn.click(); return true; }
  return false;
});
gradeClicked ? ok("'Know It' grade button found and clicked on the default-selected PRT exercise") : bad("'Know It' grade button not found");
await page.waitForTimeout(400);

const toastText = await page.evaluate(() => (document.getElementById("toast") || {}).textContent || "");
/Graded/.test(toastText) && /Know It/.test(toastText) && /scheduled for review/.test(toastText)
  ? ok('Grading toasts a confirmation: "' + toastText + '"')
  : bad('grade toast text: "' + toastText + '" (expected it to mention Graded/Know It/scheduled for review)');

const savedRec = truth ? await page.evaluate(async (id) => {
  const r = await window.G.db.get("kv", "srs:" + id);
  return r && r.v;
}, truth.firstId) : null;
savedRec && savedRec.reps === 1 && savedRec.interval === 1 && savedRec.lastGrade === 2
  ? ok(`The SRS write path accepts a PRT-exercise id ("${truth.firstId}", not a board-question id) - kv row "srs:${truth.firstId}" holds a real fresh grade-2 schedule (reps:1, interval:1, lastGrade:2)`)
  : bad('kv row "srs:' + (truth && truth.firstId) + '" after grading: ' + JSON.stringify(savedRec));
savedRec && typeof savedRec.due === "number" && savedRec.due > Date.now() && savedRec.due <= Date.now() + 2 * 86400000
  ? ok("The saved schedule's due date is real (~1 day out), not a placeholder")
  : bad("saved schedule's due date looks wrong: " + JSON.stringify(savedRec && savedRec.due));

// Leave no trace in the shared profile's kv store.
if (truth) await page.evaluate(async (id) => { await window.G.db.put("kv", { k: "srs:" + id, v: null }); }, truth.firstId);

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nPRT: all passed");
process.exit(fails ? 1 : 0);
