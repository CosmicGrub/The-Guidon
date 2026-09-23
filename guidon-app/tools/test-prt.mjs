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
 * Six things covered here, none previously exercised anywhere:
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
 *
 *  (f) prtRunDrill's Pause/Resume button carries a real `aria-pressed`
 *      state, not just a textContent swap (roadmap-audit round 10,
 *      prt-aria-and-cache-tests bucket - matches the pattern Quiz mode's own
 *      Timer toggle button already established, search this file's sibling
 *      src/index.html for `timerBtn.setAttribute("aria-pressed"`). Driven
 *      via real clicks on the actual "Run the drill" button and the actual
 *      Pause/Resume button - not a direct call into prtRunDrill()'s
 *      internals - so the exact click handler under test is the one a real
 *      Soldier's screen reader would see.
 *
 *  (g) src/app-modules/12-prt-drills-expansion.js shipped five more PRT
 *      drills (CD1, CD2, CL1, CL2, GD) alongside "pd" - #/prt's own prtHub()
 *      still only ever renders drills[0] ("pd" stays first: the content
 *      pack only ever pushes onto seed.prt.drills, never reorders it), so
 *      this section does NOT drive a UI pass for the other five the way (a)
 *      does for PD. It generalizes (a)'s own "ground truth read live from
 *      the seed" discipline to the WHOLE window.GUIDON_SEED.prt.drills
 *      array instead of just index 0: every drill's exercises carry the
 *      required fields, sequential 1..N order, and a sourceStatus that is
 *      either "verified" (with real, mutually-distinct starting-position/
 *      movement text) or "pending-source" (matching the same discipline
 *      tools/lint-prt-sources.mjs enforces against the assembled bank) -
 *      plus a handful of real, specific spot-checks so a future edit that
 *      quietly hollows out one drill's content (while leaving its
 *      sourceStatus untouched) still fails a real assertion, not just a
 *      shape check.
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
  return { name: drill.name, abbr: drill.abbr, count: exercises.length, names: exercises.map((e) => e.name),
    firstId: exercises[0].id, lastId: exercises[exercises.length - 1].id,
    exercises: exercises.map((e) => ({ id: e.id, name: e.name, sourceStatus: e.sourceStatus,
      startingPosition: e.startingPosition, movementDescription: e.movementDescription,
      sourceRef: e.source && e.source.map((s) => s.pub).join("; "), sourcePara: e.source && e.source.map((s) => s.para).filter(Boolean).join("; ") })) };
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

// ---- ATP 7-22.02 content (ROADMAP.md §3): every exercise now ships a real,
// verified startingPosition/movementDescription - confirm the detail card
// actually renders that text (not the old "reference pending" placeholder),
// per-exercise (not just the default-selected one), reading expected text
// live from the seed so this stays correct if the transcription is ever
// revised. ----
const firstTruth = truth && truth.exercises[0];
const firstDetailText = await page.evaluate(() => document.querySelector(".card")?.textContent || "");
firstTruth && firstTruth.sourceStatus === "verified" && firstDetailText.includes("Starting position: " + firstTruth.startingPosition)
  ? ok(`Default-selected exercise ("${firstTruth.name}") detail card shows its real, verified starting position`)
  : bad(`Default-selected exercise detail card did not show the expected starting position text. sourceStatus=${firstTruth && firstTruth.sourceStatus}, card text: ${firstDetailText.slice(0, 200)}`);
firstTruth && firstDetailText.includes(firstTruth.movementDescription)
  ? ok(`Default-selected exercise ("${firstTruth.name}") detail card shows its real movement description`)
  : bad(`Default-selected exercise detail card did not show the expected movement description: ${firstDetailText.slice(0, 300)}`);
!firstDetailText.includes("reference pending")
  ? ok('Default-selected exercise no longer shows the "reference pending" placeholder')
  : bad('Default-selected exercise detail card still shows "reference pending": ' + firstDetailText.slice(0, 300));

// Select a DIFFERENT exercise (the last one, Push-Up) via a real click on
// its list row, and confirm the detail pane swaps to ITS OWN distinct real
// text - not the first exercise's text left stale, and not every exercise
// coincidentally sharing the same placeholder.
const lastTruth = truth && truth.exercises[truth.exercises.length - 1];
await page.evaluate((id) => {
  document.querySelector(`.list-detail-row[data-exercise-id="${id}"]`)?.click();
}, truth && truth.lastId);
await page.waitForTimeout(150);
const lastDetailText = await page.evaluate(() => document.querySelector(".card")?.textContent || "");
lastTruth && lastTruth.sourceStatus === "verified" && lastDetailText.includes("Starting position: " + lastTruth.startingPosition)
  ? ok(`Selecting a different exercise ("${lastTruth.name}") via a real click swaps the detail card to ITS OWN real starting position`)
  : bad(`After selecting "${lastTruth && lastTruth.name}", detail card did not show its expected starting position: ${lastDetailText.slice(0, 300)}`);
lastTruth && lastTruth.startingPosition !== firstTruth.startingPosition
  ? ok("The first and last exercise's starting-position text are genuinely distinct (real per-exercise content, not one shared string)")
  : bad("First and last exercise's starting-position text were identical - suspicious, check the seed");
const sourceLineText = await page.evaluate(() => [...document.querySelectorAll(".card p.hint")].map((p) => p.textContent).find((t) => t.startsWith("Source:")) || "");
lastTruth && sourceLineText === `Source: ${lastTruth.sourceRef}, para ${lastTruth.sourcePara}`
  ? ok(`Source line cites the real reference: "${sourceLineText}"`)
  : bad(`Source line did not match expected "Source: ${lastTruth && lastTruth.sourceRef}, para ${lastTruth && lastTruth.sourcePara}": got "${sourceLineText}"`);

// Every one of the 10 exercises is verified with real, distinct text - not
// just the two spot-checked above. lint-prt-sources.mjs already gates the
// seed itself; this confirms the RENDER side actually reflects that for
// every exercise, not just the two clicked here.
const allVerified = truth.exercises.every((e) => e.sourceStatus === "verified" && e.startingPosition && e.movementDescription);
const distinctPositions = new Set(truth.exercises.map((e) => e.startingPosition)).size;
allVerified && distinctPositions === truth.exercises.length
  ? ok(`All ${truth.exercises.length} exercises are sourceStatus:"verified" with real, mutually distinct starting-position text`)
  : bad(`Not every exercise is verified with distinct text: allVerified=${allVerified}, distinctPositions=${distinctPositions}/${truth.exercises.length}`);

/* ========================================================================
   (g) Every additional PRT drill shipped alongside PD (CD1, CD2, CL1, CL2,
   GD - src/app-modules/12-prt-drills-expansion.js) is present in
   window.GUIDON_SEED.prt.drills with the same content-integrity properties
   PD's own record has, read live from the seed (never a copy hard-coded
   here), generalizing section (a)'s own discipline to the whole array.
   ======================================================================== */
const allDrillsTruth = await page.evaluate(() => {
  const VALID_SOURCE_STATUS = ["pending-source", "verified"];
  const drills = (window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.drills) || [];
  return drills.map((d) => {
    const exercises = (d.exercises || []).slice().sort((a, b) => a.order - b.order);
    return {
      id: d.id, name: d.name,
      orders: exercises.map((e) => e.order),
      names: exercises.map((e) => e.name),
      sourceStatuses: exercises.map((e) => e.sourceStatus),
      allStatusValid: exercises.every((e) => VALID_SOURCE_STATUS.includes(e.sourceStatus)),
      verifiedHaveText: exercises.filter((e) => e.sourceStatus === "verified")
        .every((e) => typeof e.startingPosition === "string" && e.startingPosition.trim() && typeof e.movementDescription === "string" && e.movementDescription.trim()),
      distinctPositions: new Set(exercises.filter((e) => e.sourceStatus === "verified").map((e) => e.startingPosition)).size,
      verifiedCount: exercises.filter((e) => e.sourceStatus === "verified").length,
    };
  });
});
const drillIds = allDrillsTruth.map((d) => d.id);
["pd", "cd1", "cd2", "cl1", "cl2", "gd"].every((id) => drillIds.includes(id))
  ? ok(`window.GUIDON_SEED.prt.drills carries all 6 expected drills: ${JSON.stringify(drillIds)}`)
  : bad(`expected drill ids pd/cd1/cd2/cl1/cl2/gd, got: ${JSON.stringify(drillIds)}`);

const EXPECTED_COUNTS = { pd: 10, cd1: 5, cd2: 5, cl1: 5, cl2: 5, gd: 3 };
allDrillsTruth.forEach((d) => {
  const expected = EXPECTED_COUNTS[d.id];
  if (expected === undefined) return; // an id this suite doesn't know about yet - not this section's job to police the roster
  const sortedOrders = d.orders.slice().sort((a, b) => a - b);
  const ordersOk = d.orders.length === expected && JSON.stringify(sortedOrders) === JSON.stringify(Array.from({ length: expected }, (_, i) => i + 1));
  ordersOk
    ? ok(`"${d.id}" (${d.name}) has ${expected} exercises, order 1..${expected} with no gaps or duplicates`)
    : bad(`"${d.id}" exercise order mismatch: got ${JSON.stringify(d.orders)}, expected exactly 1..${expected}`);
  d.allStatusValid
    ? ok(`"${d.id}": every exercise's sourceStatus is "verified" or "pending-source"`)
    : bad(`"${d.id}": an exercise has an invalid sourceStatus: ${JSON.stringify(d.sourceStatuses)}`);
  d.verifiedHaveText
    ? ok(`"${d.id}": every "verified" exercise actually carries real starting-position/movement text`)
    : bad(`"${d.id}": a "verified" exercise is missing real starting-position/movement text`);
  (d.verifiedCount === 0 || d.distinctPositions === d.verifiedCount)
    ? ok(`"${d.id}": ${d.verifiedCount} verified exercise(s) have mutually distinct starting-position text (no copy-pasted duplicate)`)
    : bad(`"${d.id}": verified exercises don't all have distinct starting-position text (${d.distinctPositions}/${d.verifiedCount} distinct)`);
});

// Real, specific spot-checks - not just shape/count checks - so a future
// edit that hollows out one drill's actual content while leaving its
// sourceStatus untouched still fails something concrete here.
const cd1 = allDrillsTruth.find((d) => d.id === "cd1");
JSON.stringify(cd1 && cd1.names) === JSON.stringify(["Power Jump", "V-Up", "Mountain Climber", "Leg-Tuck and Twist", "Single-Leg Push-Up"])
  ? ok(`CD1's 5 exercises are the real ATP 7-22.02 sequence, in order: ${JSON.stringify(cd1.names)}`)
  : bad(`CD1 exercise names/order: ${JSON.stringify(cd1 && cd1.names)}`);
const cd2 = allDrillsTruth.find((d) => d.id === "cd2");
JSON.stringify(cd2 && cd2.names) === JSON.stringify(["Turn and Lunge", "Supine Bicycle", "Half Jack", "Swimmer", "8-Count T Push-Up"])
  ? ok(`CD2's 5 exercises are the real ATP 7-22.02 sequence, in order: ${JSON.stringify(cd2.names)}`)
  : bad(`CD2 exercise names/order: ${JSON.stringify(cd2 && cd2.names)}`);
const cl1 = allDrillsTruth.find((d) => d.id === "cl1");
JSON.stringify(cl1 && cl1.names) === JSON.stringify(["Straight-Arm Pull", "Heel Hook", "Pull-Up", "Leg Tuck", "Alternating Grip Pull-Up"])
  ? ok(`CL1's 5 exercises are the real ATP 7-22.02 sequence, in order: ${JSON.stringify(cl1.names)}`)
  : bad(`CL1 exercise names/order: ${JSON.stringify(cl1 && cl1.names)}`);
const cl2 = allDrillsTruth.find((d) => d.id === "cl2");
JSON.stringify(cl2 && cl2.names) === JSON.stringify(["Flexed-Arm Hang", "Heel Hook", "Pull-Up", "Leg Tuck", "Alternating Grip Pull-Up"])
  ? ok(`CL2's 5 exercises are the real ATP 7-22.02 sequence, in order: ${JSON.stringify(cl2.names)}`)
  : bad(`CL2 exercise names/order: ${JSON.stringify(cl2 && cl2.names)}`);
const gd = allDrillsTruth.find((d) => d.id === "gd");
JSON.stringify(gd && gd.names) === JSON.stringify(["Shoulder Roll", "Lunge Walk", "Soldier Carry"])
  ? ok(`GD's 3 exercises are the real ATP 7-22.02 sequence, in order: ${JSON.stringify(gd.names)}`)
  : bad(`GD exercise names/order: ${JSON.stringify(gd && gd.names)}`);

// GD's repRule itself asserts something plainly stated (not an inference) -
// this file's own header for src/app-modules/12-prt-drills-expansion.js
// explains why: three exercises, no rep-count structure, progressing to up
// to three sets. Confirm the seed record actually says that.
const gdRepRule = await page.evaluate(() => {
  const d = ((window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.drills) || []).find((x) => x.id === "gd");
  return d ? { sourceStatus: d.repRule.sourceStatus, note: d.repRule.note, standalone: d.repRule.standalone } : null;
});
gdRepRule && gdRepRule.sourceStatus === "verified" && gdRepRule.standalone === null && /three sets/.test(gdRepRule.note || "")
  ? ok('GD\'s repRule is sourceStatus:"verified" and honestly describes set-based (not rep-count) progression')
  : bad("GD repRule: " + JSON.stringify(gdRepRule));

// Reselect the first exercise so later sections (e)/(f) - which assume the
// default-selected exercise - aren't left pointed at the last one.
await page.evaluate((id) => {
  document.querySelector(`.list-detail-row[data-exercise-id="${id}"]`)?.click();
}, truth && truth.firstId);
await page.waitForTimeout(150);

/* ========================================================================
   (b) store.prt(query) - substring search filtering
   ======================================================================== */
// store.prt() flattens EVERY drill in window.GUIDON_SEED.prt.drills, not
// just PD's own - expected total is the real sum read live from (g)'s own
// ground truth above, not the old PD-only count of 10 (src/app-modules/
// 12-prt-drills-expansion.js added 23 more exercises across 5 drills).
const expectedFlatCount = allDrillsTruth.reduce((n, d) => n + d.names.length, 0);
const noQuery = await page.evaluate(() => window.G.store.prt().length);
expectedFlatCount > 0 && noQuery === expectedFlatCount
  ? ok(`store.prt() with no query returns the full flattened exercise list across every drill (${noQuery})`)
  : bad(`store.prt() with no query returned ${noQuery}, expected ${expectedFlatCount}`);

// "push-up" now matches three real exercises across three different drills
// (PD's own Push-Up, CD1's Single-Leg Push-Up, CD2's 8-Count T Push-Up) -
// still a real, sourced substring match, not a broken query.
const nameMatch = await page.evaluate(() => window.G.store.prt("push-up").map((p) => p.name).sort());
JSON.stringify(nameMatch) === JSON.stringify(["8-Count T Push-Up", "Push-Up", "Single-Leg Push-Up"])
  ? ok('store.prt("push-up") returns all three real Push-Up exercises across drills: ' + JSON.stringify(nameMatch))
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

/* ========================================================================
   (f) prtRunDrill's Pause/Resume button - real aria-pressed toggling on a
   real click, not just the underlying timer factory in isolation (see (c)
   above for that direct check). Roadmap-audit round 10 finding: this button
   swapped textContent between "Pause"/"Resume" but never carried
   aria-pressed at all, giving assistive tech no programmatic state - fixed
   to match Quiz mode's own Timer toggle button (same file, search for
   `timerBtn.setAttribute("aria-pressed"`).
   ======================================================================== */
await page.evaluate(() => { location.hash = "#/prt"; });
await page.waitForTimeout(400);

const runClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Run the drill/.test(b.textContent || ""));
  if (btn) { btn.click(); return true; }
  return false;
});
runClicked ? ok("'▶ Run the drill' button found and clicked, to reach the real Pause/Resume button") : bad("'Run the drill' button not found");
await page.waitForTimeout(300);

function readPauseBtn() {
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^(Pause|Resume)$/.test((b.textContent || "").trim()));
    return btn ? { text: btn.textContent.trim(), ariaPressed: btn.getAttribute("aria-pressed") } : null;
  });
}
function clickPauseBtn() {
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^(Pause|Resume)$/.test((b.textContent || "").trim()));
    if (btn) { btn.click(); return true; }
    return false;
  });
}

const pauseBefore = await readPauseBtn();
pauseBefore && pauseBefore.text === "Pause" && pauseBefore.ariaPressed === "false"
  ? ok('Pause/Resume button starts as "Pause" with aria-pressed="false"')
  : bad("Pause/Resume button's initial state: " + JSON.stringify(pauseBefore));

const clickedToPause = await clickPauseBtn();
clickedToPause ? ok("Pause/Resume button clicked once (Pause -> Resume)") : bad("Pause/Resume button not found to click");

const pauseAfterClick1 = await readPauseBtn();
pauseAfterClick1 && pauseAfterClick1.text === "Resume" && pauseAfterClick1.ariaPressed === "true"
  ? ok('After a real click: button reads "Resume" with aria-pressed="true"')
  : bad("Pause/Resume button state after first (pausing) click: " + JSON.stringify(pauseAfterClick1));

const clickedToResume = await clickPauseBtn();
clickedToResume ? ok("Pause/Resume button clicked a second time (Resume -> Pause)") : bad("Pause/Resume button not found for the second click");

const pauseAfterClick2 = await readPauseBtn();
pauseAfterClick2 && pauseAfterClick2.text === "Pause" && pauseAfterClick2.ariaPressed === "false"
  ? ok('After a second real click: button reads "Pause" with aria-pressed="false" again')
  : bad("Pause/Resume button state after second (resuming) click: " + JSON.stringify(pauseAfterClick2));

// Leave the drill via its own real "End" button, same as a real Soldier
// would, so this suite doesn't leave a live round timer running behind it.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "End");
  if (btn) btn.click();
});
await page.waitForTimeout(300);

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nPRT: all passed");
process.exit(fails ? 1 : 0);
