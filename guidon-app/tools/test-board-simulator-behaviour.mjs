/**
 * Board Simulator (#/board-sim) behaviour, end to end through the real UI.
 *
 * Every block below is a defect that shipped in v1.12.0 and reproduced on
 * main before the fix - none of it is a grep of source text:
 *
 *  - Tapping the practice screen's Exit button on the very first question,
 *    with nothing answered, marked the step "Complete" ("1 of 3"). A step
 *    now counts only when a run was really finished: the scenario reached
 *    its outcome (an attempt row exists for it since the step was opened).
 *    That holds whichever way the Soldier leaves the outcome screen - Done,
 *    Replay-then-Exit, or the nav bar - and never for a bare Exit.
 *  - With the rank filter on E1-E3 (what onboarding sets for every PVT, PV2
 *    and PFC) or E7-E9, steps 1 and 3 showed a "Scenario not found." toast
 *    over an empty screen and could never be finished. Both steps must open
 *    under EVERY rank filter, always with the same scenario for the same
 *    filter, without leaking a hidden scenario into the rest of the app.
 *  - Finishing (or leaving) a step rebuilt the screen, dropped keyboard
 *    focus to <body> and announced nothing. Same for "Start over".
 *  - The on-screen copy read like a build log ("A deterministic, offline
 *    board run", "active phases", "a judgment lane").
 *  - Guard rails the feature promises: no network at all, the simulator
 *    itself never writes a review-schedule row (the Mock Board it hands off
 *    to stays the single writer, one write per scored question), notes are
 *    not erased without asking, and nothing overflows at phone width.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];
const offsite = [];

async function boot() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  // Short enough that a broken build reports every section's failures in a
  // few minutes instead of sitting on one missing button for half an hour.
  p.setDefaultTimeout(12000);
  p.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  p.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  p.on("request", (r) => { const u = r.url(); if (!u.startsWith(url) && !/^(data|blob|about):/.test(u)) offsite.push(u); });
  await p.goto(url, { waitUntil: "load" });
  await dismissOnboarding(p);
  // Record every toast the app really shows (no stubbing: watch the DOM node
  // util.toast writes into).
  await p.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      const t = document.getElementById("toast");
      if (!t) return;
      for (const m of muts) {
        if (m.type !== "childList") continue;
        if ((m.target === t || Array.from(m.addedNodes).includes(t)) && t.textContent) window.__toasts.push(t.textContent);
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  return p;
}

const page = await boot();
const WAIT = { timeout: 20000 };
// One broken section must not hide the others: a thrown timeout becomes that
// section's FAIL line and the run carries on (each section re-opens the
// simulator itself, and the rank-filter section resets the saved run).
async function section(name, fn) {
  try { await fn(); }
  catch (e) { bad(name + " stopped early: " + String((e && e.message) || e).split(/\r?\n/)[0]); }
}

// Always bounce through another route so a hashchange fires even when the
// simulator is already the current route.
async function openSim(p = page) {
  await p.evaluate(() => { location.hash = "#/home"; });
  await p.waitForFunction(() => !document.querySelector("[data-board-sim-status]"), null, WAIT);
  await p.evaluate(() => { location.hash = "#/board-sim"; });
  await p.waitForFunction(() => !!document.querySelector("[data-board-sim-status]") && !!document.querySelector("[data-board-sim-aar]"), null, WAIT);
  await p.waitForTimeout(150); // the router focuses the page heading after render resolves
}
const stored = (p = page) => p.evaluate(async () => G.db.getSetting("board:sim:v1", null));
const statusText = (p = page) => p.evaluate(() => (document.querySelector("[data-board-sim-status] strong") || {}).textContent || "");
const eyebrow = (n, p = page) => p.evaluate((n) => (document.querySelector('[data-board-sim-phase="' + n + '"] .eyebrow') || {}).textContent || "", n);
const engineText = (p = page) => p.evaluate(() => (document.querySelector("[data-board-sim-engine]") || {}).textContent || "");
const engineTitle = (p = page) => p.evaluate(() => (document.querySelector("[data-board-sim-engine] .engine-head h2") || {}).textContent || "");
const liveText = (p = page) => p.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");
const attempts = (p = page) => p.evaluate(async () => (await G.db.allAttempts()).map((a) => a.scenarioId));
const srsRows = (p = page) => p.evaluate(async () => {
  const all = await G.db.all("kv");
  return all.filter((r) => r && typeof r.k === "string" && r.k.indexOf("srs:") === 0).map((r) => ({ k: r.k, reps: r.v.reps || 0, misses: r.v.misses || 0 })).sort((a, b) => a.k < b.k ? -1 : 1);
});
const overflow = (p = page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const focusInfo = (p = page) => p.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return "BODY";
  for (const n of ["data-board-sim-reporting", "data-board-sim-knowledge", "data-board-sim-judgment", "data-board-sim-reset"]) if (a.hasAttribute(n)) return n;
  if (a.tagName === "H3" && a.closest("[data-board-sim-aar]")) return "aar-heading";
  if (a.closest("[data-board-sim-engine]")) return "inside-engine";
  return a.tagName + "." + a.className;
});
const waitLive = (re, p = page) => p.waitForFunction((src) => new RegExp(src).test((document.getElementById("a11y-live") || {}).textContent || ""), re.source, WAIT).then(() => true).catch(() => false);
const startStep = async (attr, p = page) => {
  await p.locator("button[" + attr + "]").click();
  await p.waitForFunction(() => { const h = document.querySelector("[data-board-sim-engine]"); return !!h && h.children.length > 0; }, null, WAIT).catch(() => {});
};
const engineExit = (p = page) => p.locator("[data-board-sim-engine] .engine-head button", { hasText: /^\s*Exit\s*$/ }).click();
// Answer every question (first choice each time) until the outcome screen.
async function playToOutcome(p = page, host = "[data-board-sim-engine]") {
  for (let i = 0; i < 25; i++) {
    if (await p.locator(host + " .panel.outcome").count()) return true;
    await p.locator(host + " .choice:not(:disabled)").first().click();
    await p.locator(host + " .course-continue-btn").click();
  }
  return (await p.locator(host + " .panel.outcome").count()) > 0;
}
const afterRedraw = (p = page) => p.waitForFunction(() => { const h = document.querySelector("[data-board-sim-engine]"); return !!h && h.children.length === 0; }, null, WAIT);

let s; // the saved run, re-read after each action
// Words a Soldier should never have to read on this screen.
const JARGON = /deterministic|offline|\bengine\b|re-?render|\bmodule\b|wrapper|\bSRS\b|regression|\bshim\b|active phases|\blane\b|\bsequence\b|rubric dimensions|consequence-based|\bsession\b/i;

/* ---- 1. The screen itself: plain words, fits a phone ---- */
await section("section 1", async () => {
await openSim();
(await statusText()) === "0 of 3 practice steps done" ? ok('a new run starts at "0 of 3 practice steps done"') : bad("opening status: " + JSON.stringify(await statusText()));
const simCopy = await page.evaluate(() => document.querySelector("#route").innerText);
const simHit = simCopy.match(JARGON);
!simHit ? ok("the simulator's own copy carries no build-log words") : bad('simulator copy still says "' + simHit[0] + '"');
/no signal/i.test(simCopy) && /board's written instructions \(MOI\)/.test(simCopy)
  ? ok("...and still tells the Soldier it works with no signal and that their own board's instructions come first")
  : bad("simulator intro lost its two load-bearing facts: " + simCopy.slice(0, 300));
(await overflow()) <= 0 ? ok("no horizontal overflow at 390px") : bad("simulator overflows 390px by " + (await overflow()) + "px");
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForFunction(() => !!document.querySelector("[data-roadmap-launch='Board Simulator']"), null, WAIT).catch(() => {});
const launchCopy = await page.evaluate(() => (document.querySelector("[data-roadmap-launch='Board Simulator']") || {}).innerText || "");
(launchCopy && !JARGON.test(launchCopy)) ? ok("the Board screen's Board Simulator launcher is in plain words too") : bad("launcher copy: " + JSON.stringify(launchCopy));
await openSim();
});

/* ---- 2. Exit without answering anything must NOT complete a step ---- */
await section("section 2", async () => {
for (const step of [
  { attr: "data-board-sim-reporting", n: 1, flag: "reportingDone", name: "Reporting practice" },
  { attr: "data-board-sim-judgment", n: 3, flag: "judgmentDone", name: "Leadership problem" },
]) {
  await startStep(step.attr);
  const opened = await engineText();
  opened.length > 40 ? ok(`step ${step.n} opens its practice screen`) : bad(`step ${step.n} did not open: ` + JSON.stringify(opened.slice(0, 120)));
  if (step.n === 1) {
    (await focusInfo()) === "inside-engine" ? ok("opening a step moves keyboard focus into the practice screen") : bad("focus after opening step 1: " + (await focusInfo()));
    (await overflow()) <= 0 ? ok("...which also fits 390px with no horizontal overflow") : bad("practice screen overflows 390px by " + (await overflow()) + "px");
  }
  await engineExit();
  await afterRedraw();
  const s = await stored();
  (s && s[step.flag] === false) ? ok(`Exit with nothing answered leaves ${step.flag} false`) : bad(`Exit with nothing answered set ${step.flag}: ` + JSON.stringify(s));
  const eb = await eyebrow(step.n);
  eb === "Step " + step.n ? ok(`...step ${step.n} is not badged Done`) : bad(`step ${step.n} eyebrow after a bare Exit: ` + JSON.stringify(eb));
  (await statusText()) === "0 of 3 practice steps done" ? ok("...and progress still reads 0 of 3") : bad("progress after a bare Exit: " + JSON.stringify(await statusText()));
  const note = await page.evaluate(() => (document.querySelector("[data-board-sim-note]") || {}).textContent || "");
  /not counted yet/.test(note) ? ok("...with a visible note that the step is not counted yet") : bad("no early-exit note on the page: " + JSON.stringify(note));
  (await focusInfo()) === step.attr ? ok("...focus returns to that step's Start button, not <body>") : bad("focus after a bare Exit: " + (await focusInfo()));
  (await waitLive(new RegExp(step.name + " closed before the end"))) ? ok("...and the early exit is announced") : bad("live region after a bare Exit: " + JSON.stringify(await liveText()));
}
(await attempts()).length === 0 ? ok("no scenario attempt was recorded by either bare Exit") : bad("attempts after bare exits: " + JSON.stringify(await attempts()));
});

/* ---- 3. A real finish counts - by keyboard, from where focus was left ---- */
await section("section 3", async () => {
const srsBefore = JSON.stringify(await srsRows());
// Focus sits on step 3's Start button; walk back to step 1 with the keyboard alone.
for (let i = 0; i < 6 && (await focusInfo()) !== "data-board-sim-reporting"; i++) await page.keyboard.press("Shift+Tab");
(await focusInfo()) === "data-board-sim-reporting" ? ok("step 1's Start button is reachable with Shift+Tab from step 3's") : bad("Shift+Tab walk ended on " + (await focusInfo()));
await page.keyboard.press("Enter");
await page.waitForFunction(() => /BEFORE THE DOOR/.test((document.querySelector("[data-board-sim-engine]") || {}).textContent || ""), null, WAIT).catch(() => {});
await page.keyboard.press("a"); // letter key only works if focus really landed inside the practice
const pickedByKey = await page.locator("[data-board-sim-engine] .course-continue-btn").count();
pickedByKey === 1 ? ok("Enter on the Start button opens the step and the letter key answers it (keyboard reachable end to end)") : bad("letter key did not pick a choice - focus is " + (await focusInfo()));
if (pickedByKey) await page.locator("[data-board-sim-engine] .course-continue-btn").click();
(await playToOutcome()) ? ok("reporting practice plays through to its outcome screen") : bad("never reached the reporting outcome");
const outcomeCopy = await page.evaluate(() => (document.querySelector("[data-board-sim-engine] .panel.outcome .feedback") || {}).textContent || "");
(/Mock Board/.test(outcomeCopy) && /leadership problem/.test(outcomeCopy) && /after-action notes/.test(outcomeCopy) && !/knowledge round|judgment scenario|\bphase\b/i.test(outcomeCopy) && !JARGON.test(outcomeCopy))
  ? ok("the reporting result names the next steps the way the screen does (Mock Board, leadership problem, after-action notes)")
  : bad("reporting result copy: " + JSON.stringify(outcomeCopy));
await page.locator("[data-board-sim-engine] .panel.outcome button", { hasText: /^\s*Done\s*$/ }).click();
await afterRedraw();
s = await stored();
(s.reportingDone === true && s.judgmentDone === false) ? ok("finishing the reporting practice marks step 1 done, and only step 1") : bad("after a real finish: " + JSON.stringify(s));
(await eyebrow(1)) === "Step 1 · Done" ? ok('...badged "Step 1 · Done"') : bad("step 1 eyebrow: " + JSON.stringify(await eyebrow(1)));
(await statusText()) === "1 of 3 practice steps done" ? ok("...progress reads 1 of 3") : bad("progress: " + JSON.stringify(await statusText()));
(await focusInfo()) === "data-board-sim-knowledge" ? ok("...focus moves on to the next unfinished step's button") : bad("focus after finishing step 1: " + (await focusInfo()));
(await waitLive(/Reporting practice finished\. 1 of 3 practice steps done\./)) ? ok("...and the finish is announced with the new count") : bad("live region after finishing step 1: " + JSON.stringify(await liveText()));

// Finish, Replay, then Exit halfway: the finished run still counts.
await startStep("data-board-sim-judgment");
const judgmentTitleAll = await engineTitle();
(await playToOutcome()) ? ok(`leadership problem ("${judgmentTitleAll}") plays through to its outcome`) : bad("never reached the judgment outcome");
await page.locator("[data-board-sim-engine] .panel.outcome button", { hasText: /Replay/ }).click();
await page.waitForFunction(() => !document.querySelector("[data-board-sim-engine] .panel.outcome"), null, WAIT).catch(() => {});
await engineExit();
await afterRedraw();
s = await stored();
s.judgmentDone === true ? ok("finish, Replay, then Exit halfway still counts the finished run") : bad("Replay-then-Exit lost the finished run: " + JSON.stringify(s));
(await waitLive(/Leadership problem finished\. 2 of 3 practice steps done\./)) ? ok("...announced as 2 of 3") : bad("live region after step 3: " + JSON.stringify(await liveText()));
// Opening a finished step again and backing out must not un-finish it or nag.
await startStep("data-board-sim-judgment");
await engineExit();
await afterRedraw();
s = await stored();
const nag = await page.evaluate(() => !!document.querySelector("[data-board-sim-note]"));
(s.judgmentDone === true && !nag && (await focusInfo()) === "data-board-sim-judgment") ? ok("re-opening a finished step and backing out keeps it Done, shows no 'not counted' note, and keeps focus") : bad("re-open + Exit: " + JSON.stringify({ done: s.judgmentDone, nag, focus: await focusInfo() }));
JSON.stringify(await srsRows()) === srsBefore ? ok("steps 1 and 3 wrote no review-schedule rows") : bad("an srs: row changed during the scenario steps");
});

/* ---- 4. Step 2 hands off to the real Mock Board, which stays the only writer ---- */
await section("section 4", async () => {
await page.locator("button[data-board-sim-knowledge]").click();
await page.waitForFunction(() => location.hash === "#/board" && /Set up your board/i.test(document.body.textContent || ""), null, WAIT).catch(() => {});
/Set up your board/i.test(await page.evaluate(() => document.body.textContent || "")) ? ok("step 2 opens the existing Mock Board setup") : bad("Mock Board setup did not open from step 2");
await page.locator(".mb-setup select").first().selectOption("5");
await page.locator("button.mb-start", { hasText: /begin board/i }).click();
await page.locator("button", { hasText: /I've reported/i }).click();
for (let i = 0; i < 5; i++) {
  await page.locator("button.mb-reveal", { hasText: /reveal answer/i }).click();
  await page.locator("button.mb-score-btn").first().click();
}
await page.waitForFunction(() => !!document.querySelector(".mb-done"), null, WAIT).catch(() => {});
await page.waitForFunction(async () => ((await G.db.getSetting("board:mockHistory:v1", [])) || []).length === 1, null, WAIT).catch(() => {});
const rows = await srsRows();
(rows.length === 5 && rows.every((r) => r.reps <= 1 && r.misses <= 1))
  ? ok("one Mock Board of 5 questions wrote exactly 5 review-schedule rows, each graded once (no double write)")
  : bad("review-schedule rows after one 5-question Mock Board: " + JSON.stringify(rows));
const back = page.locator("[data-roadmap-launch='Board Simulator'] button", { hasText: /Open Board Simulator/ });
(await back.count()) === 1 ? ok("the Mock Board's finish screen still offers a way back to the simulator") : bad("no Open Board Simulator button on the Board screen");
await back.click();
await page.waitForFunction(() => !!document.querySelector("[data-board-sim-status]"), null, WAIT);
(await waitLive(/Mock Board finished\. 3 of 3 practice steps done\./)) ? ok("coming back announces the finished Mock Board and 3 of 3") : bad("live region on return: " + JSON.stringify(await liveText()));
s = await stored();
(s.knowledgeDone === true && s.completedAt > 0) ? ok("step 2 is done and the whole run is stamped complete") : bad("state on return: " + JSON.stringify(s));
JSON.stringify(await srsRows()) === JSON.stringify(rows) ? ok("the simulator itself added or changed no review-schedule row") : bad("srs rows changed after returning to the simulator");
/All three steps are done/.test(await page.evaluate(() => document.querySelector("[data-board-sim-status]").textContent)) ? ok("the progress panel says all three steps are done") : bad("3-of-3 hint missing");
});

/* ---- 5. Start over asks first, then lands focus somewhere useful ---- */
await section("section 5", async () => {
await page.locator("#board-sim-strong").fill("Kept answers short and looked at the president.");
await page.waitForFunction(async () => ((await G.db.getSetting("board:sim:v1", {})).aarDraft || {}).strong === "Kept answers short and looked at the president.", null, WAIT).catch(() => {});
await page.locator("button[data-board-sim-reset]").click();
const dialog = page.locator(".gm-box[role=dialog]");
await dialog.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
(await dialog.count()) === 1 && /clears your progress and your after-action notes/.test(await dialog.innerText()) ? ok("Start over asks before erasing notes") : bad("no confirmation before Start over");
await dialog.locator("button", { hasText: /^Cancel$/ }).click();
await dialog.waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
s = await stored();
(s.aarDraft.strong.length > 0 && s.reportingDone === true) ? ok("Cancel keeps the notes and the progress") : bad("Cancel lost work: " + JSON.stringify(s));
await page.locator("button[data-board-sim-reset]").click();
await dialog.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
await dialog.locator("button", { hasText: /^Start over$/ }).click();
await page.waitForFunction(() => /0 of 3/.test((document.querySelector("[data-board-sim-status] strong") || {}).textContent || ""), null, WAIT).catch(() => {});
s = await stored();
(s.reportingDone === false && s.knowledgeDone === false && s.judgmentDone === false && s.aarDraft.strong === "" && s.completedAt === 0) ? ok("Start over clears the run") : bad("after Start over: " + JSON.stringify(s));
(await waitLive(/Started over\. 0 of 3 practice steps done\./)) ? ok("...announces it") : bad("live region after Start over: " + JSON.stringify(await liveText()));
await page.waitForFunction(() => document.activeElement && document.activeElement.hasAttribute && document.activeElement.hasAttribute("data-board-sim-reporting"), null, WAIT).catch(() => {});
(await focusInfo()) === "data-board-sim-reporting" ? ok("...and puts focus on step 1's Start button, not <body>") : bad("focus after Start over: " + (await focusInfo()));
});

/* ---- 6. Finishing and then leaving by the nav bar still counts ---- */
await section("section 6", async () => {
await startStep("data-board-sim-reporting");
await playToOutcome();
await openSim(); // never pressed Done or Exit
s = await stored();
(s.reportingDone === true && (await eyebrow(1)) === "Step 1 · Done") ? ok("a finished practice counts even when the Soldier leaves by the nav bar instead of Done") : bad("nav-away after finishing: " + JSON.stringify(s));
(await waitLive(/Reporting practice finished\. 1 of 3/)) ? ok("...and is announced on return") : bad("live region on return: " + JSON.stringify(await liveText()));

// ...but a step that was opened and walked away from is NOT ticked later by
// finishing the same scenario somewhere else in the app (the Train tab runs
// the very same scenarios through the very same practice screen).
await startStep("data-board-sim-judgment");
const abandoned = await engineTitle();
await openSim(); // left by the nav bar with nothing answered
s = await stored();
(s.judgmentDone === false && !(s.opened && s.opened.judgment)) ? ok("a step left by the nav bar with nothing answered is not counted, and is no longer waiting on a result") : bad("after abandoning step 3: " + JSON.stringify(s));
await page.evaluate(() => {
  const host = document.createElement("div");
  host.id = "outside-run";
  document.querySelector("#route").appendChild(host);
  G.engine.run("sc-iot-range-safety", "course", host, () => host.remove());
});
(await playToOutcome(page, "#outside-run")) ? ok(`the same scenario ("${abandoned}") finished outside the simulator`) : bad("outside run never reached an outcome");
await page.waitForFunction(async () => (await G.db.allAttempts()).some((a) => a.scenarioId === "sc-iot-range-safety"), null, WAIT).catch(() => {});
await openSim();
s = await stored();
(s.judgmentDone === false && (await eyebrow(3)) === "Step 3") ? ok("...and that outside run does not tick the simulator's step 3") : bad("an outside run completed step 3: " + JSON.stringify(s));
});

/* ---- 7. Every rank filter: both steps open, same scenario every time, no raw error ---- */
await section("section 7", async () => {
const JUNIOR = "Staff Duty Integrity Check", LEADER = "Range Fan Violation, First Relay Loaded";
const expectTitle = { all: LEADER, E1: JUNIOR, E2: JUNIOR, E3: JUNIOR, E4: LEADER, E5: LEADER, E6: LEADER, E7: LEADER, E8: LEADER, E9: LEADER };
const storeFn = await page.evaluate(() => { window.__realScenarioFn = G.store.scenario; return true; });
for (const tier of ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "all"]) await section("rank filter " + tier, async () => {
  await page.evaluate(async (t) => { window.__toasts.length = 0; await G.store.setSetting("tierFilter", t); await G.db.setSetting("board:sim:v1", G.mockBoardSim._fresh()); }, tier);
  await openSim();
  await startStep("data-board-sim-reporting");
  const rep = await engineText();
  const hint = await page.evaluate(() => Array.from(document.querySelectorAll('[data-board-sim-phase="3"] .hint')).map((x) => x.textContent).join(" | "));
  await startStep("data-board-sim-judgment");
  const t1 = await engineTitle();
  await startStep("data-board-sim-judgment");
  const t2 = await engineTitle();
  const toasts = await page.evaluate(() => window.__toasts.slice());
  (/BEFORE THE DOOR/.test(rep) && t1 === expectTitle[tier] && t2 === t1 && hint.includes("Your situation: " + t1) && toasts.length === 0)
    ? ok(`rank filter ${tier}: reporting opens, leadership problem is "${t1}" both times and matches the card, no toast`)
    : bad(`rank filter ${tier}: ` + JSON.stringify({ reporting: rep.slice(0, 60), t1, t2, hint, toasts }));
  if (tier === "E3") {
    (await playToOutcome()) ? ok("rank filter E3: the leadership problem plays through to its outcome") : bad("E3: judgment never reached an outcome");
    await page.locator("[data-board-sim-engine] .panel.outcome button", { hasText: /^\s*Done\s*$/ }).click();
    await afterRedraw();
    s = await stored();
    s.judgmentDone === true ? ok("rank filter E3: step 3 can now be finished") : bad("E3: judgmentDone after a full run: " + JSON.stringify(s));
    await startStep("data-board-sim-reporting");
    (await playToOutcome()) ? ok("rank filter E3: reporting practice (hidden by that filter) plays through too") : bad("E3: reporting never reached an outcome");
    await page.locator("[data-board-sim-engine] .panel.outcome button", { hasText: /^\s*Done\s*$/ }).click();
    await afterRedraw();
    s = await stored();
    s.reportingDone === true ? ok("rank filter E3: step 1 can now be finished") : bad("E3: reportingDone after a full run: " + JSON.stringify(s));
    const leak = await page.evaluate(() => ({ same: G.store.scenario === window.__realScenarioFn, hidden: G.store.scenario("sc-board-simulator-reporting") === null && G.store.scenario("sc-iot-range-safety") === null, listed: G.store.scenarios().some((x) => x.id === "sc-board-simulator-reporting") }));
    (leak.same && leak.hidden && !leak.listed) ? ok("...and the rest of the app still sees exactly what the E3 filter allows (nothing leaked, the store is untouched)") : bad("E3 leak check: " + JSON.stringify(leak));
  }
});
void storeFn;
await page.evaluate(async () => { await G.store.setSetting("tierFilter", "all"); });
});

/* ---- 8. A step that truly cannot be opened says so on the page - never a raw error ---- */
await section("section 8", async () => {
const page2 = await boot();
await page2.evaluate(async () => {
  await G.store.setSetting("tierFilter", "E1");
  const list = window.GUIDON_SEED.scenarios.scenarios;
  const i = list.findIndex((x) => x.id === "sc-board-simulator-reporting");
  if (i !== -1) list.splice(i, 1);
});
await openSim(page2);
await page2.locator("button[data-board-sim-reporting]").click();
await page2.waitForFunction(() => !!document.querySelector("[data-board-sim-unavailable]"), null, WAIT).catch(() => {});
const un = await page2.evaluate(() => ({ text: (document.querySelector("[data-board-sim-unavailable]") || {}).textContent || "", toasts: window.__toasts.slice() }));
(/can't be opened right now/.test(un.text) && un.toasts.length === 0) ? ok("a missing scenario shows a plain on-page message and no toast") : bad("missing scenario: " + JSON.stringify(un));
(await waitLive(/can't be opened right now/, page2)) ? ok("...and announces it") : bad("missing scenario not announced: " + JSON.stringify(await liveText(page2)));
});

offsite.length === 0 ? ok("fully offline: not one request left the local app") : bad("off-site requests: " + offsite.join(", "));
noise.length === 0 ? ok("no console errors/warnings or page errors in either context") : bad(`console noise: ${noise.join(" | ")}`);

console.log(fails === 0 ? "\nBOARD SIMULATOR BEHAVIOUR: all passed" : `\nBOARD SIMULATOR BEHAVIOUR: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
