/**
 * ROADMAP §3e/§3f integrated regression suite:
 * - PT Planner persistence, 3:1 warning, month/week/day views, reminders.
 * - Team Training's complete 10-exercise catalog.
 * - G.engine collective-decision gate on an authored discuss:true scenario.
 * - Board Simulator wrapper and its engine-backed reporting phase.
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
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil:"load" });
await page.waitForTimeout(700);
await dismissOnboarding(page);
await page.waitForTimeout(250);

const routeTruth = await page.evaluate(() => ({
  pt: window.G.routes.some((r) => r.hash === "#/pt-plan"),
  team: window.G.routes.some((r) => r.hash === "#/team"),
  sim: window.G.routes.some((r) => r.hash === "#/board-sim"),
  teamCatalog: window.G.teamTraining && window.G.teamTraining.CATALOG.length,
  ptApi: !!(window.G.ptPlanner && window.G.ptPlanner._ratio),
  simApi: !!(window.G.mockBoardSim && window.G.mockBoardSim.render)
}));
routeTruth.pt && routeTruth.team && routeTruth.sim ? ok("all three roadmap routes are registered") : bad("route registry: " + JSON.stringify(routeTruth));
routeTruth.teamCatalog === 10 ? ok("team-training catalog contains exactly 10 planned exercises") : bad("team catalog count: " + routeTruth.teamCatalog);
routeTruth.ptApi && routeTruth.simApi ? ok("PT Planner and Board Simulator module APIs are live") : bad("missing module API: " + JSON.stringify(routeTruth));

const prtSessionModel = await page.evaluate(() => {
  const prt = window.GUIDON_SEED && window.GUIDON_SEED.prt;
  const sessions = (prt && prt.sessions) || [];
  const byId = (id) => sessions.find((s) => s.id === id);
  return {
    strength:(byId("strength")?.blocks || []).map((b) => b.drillId),
    endurance:(byId("endurance")?.blocks || []).map((b) => b.drillId),
    pending:Object.keys((prt && prt.pendingDrills) || {}).sort()
  };
});
JSON.stringify(prtSessionModel.strength) === JSON.stringify(["pd","ssd","cd1","cd2","rd"]) &&
JSON.stringify(prtSessionModel.endurance) === JSON.stringify(["pd","hsd","mmd1","mmd2","rd"])
  ? ok("PT Planner publishes the canonical Strength/Endurance session block model")
  : bad("PRT session model mismatch: " + JSON.stringify(prtSessionModel));
prtSessionModel.pending.length === 7
  ? ok("seven not-yet-authored PRT drills stay explicit placeholders instead of fabricated content")
  : bad("pending PRT drill table: " + JSON.stringify(prtSessionModel.pending));

// Seed scenarios and author-validator compatibility.
const scenarioTruth = await page.evaluate(() => {
  const ids = ["sc-collective-decision-relay","sc-board-simulator-reporting"];
  return ids.map((id) => {
    const sc = window.G.store.scenario(id);
    const v = sc && window.G.author && window.G.author.validate ? window.G.author.validate(sc) : null;
    return { id, found:!!sc, validate:v, discussed:sc ? Object.values(sc.nodes || {}).filter((n) => n && n.discuss).length : 0 };
  });
});
for (const row of scenarioTruth) {
  row.found ? ok(row.id + " exists in the real scenario store") : bad(row.id + " missing");
  (!row.validate || row.validate.ok !== false) ? ok(row.id + " is accepted by the current scenario validator") : bad(row.id + " validator errors: " + JSON.stringify(row.validate));
}
const collectiveTruth = scenarioTruth.find((x) => x.id === "sc-collective-decision-relay");
Number(collectiveTruth && collectiveTruth.discussed || 0) >= 3 ? ok("collective relay authors at least three discuss:true decision nodes") : bad("collective decision nodes: " + JSON.stringify(collectiveTruth));

// ---- PT Planner ----
await page.evaluate(() => { location.hash = "#/pt-plan"; });
await page.waitForTimeout(650);
const ptBoot = await page.evaluate(() => ({
  heading: document.querySelector("#route h2, main h2")?.textContent || "",
  days: document.querySelectorAll(".pt-day-card").length,
  ratio: document.querySelector("[data-pt-ratio]")?.textContent || "",
  views: document.querySelectorAll("[data-pt-view]").length
}));
ptBoot.heading === "PT Planner" ? ok("#/pt-plan renders") : bad("PT heading: " + ptBoot.heading);
ptBoot.days === 7 ? ok("week view renders seven editable day cards") : bad("PT day-card count: " + ptBoot.days);
ptBoot.views === 3 ? ok("day/week/month views are present") : bad("PT view count: " + ptBoot.views);
!/Flag:/.test(ptBoot.ratio) ? ok("default balanced template does not trigger the hard:recovery warning") : bad("default template unexpectedly flagged: " + ptBoot.ratio);

const ratioGuard = await page.evaluate(() => {
  const p = window.G.ptPlanner._planFromTemplate("balanced");
  ["sun","mon","tue","wed","thu","fri","sat"].forEach((k, i) => {
    p.days[k] = { id:"custom", title:"X", type:i === 6 ? "rest" : "custom", effort:i < 4 ? "hard" : i === 4 ? "recovery" : "moderate", route:"" };
  });
  return window.G.ptPlanner._ratio(p);
});
ratioGuard.warn === true && ratioGuard.hard === 4 && ratioGuard.recovery === 1
  ? ok("3:1 guard flags a 4-hard/1-recovery week without blocking it")
  : bad("ratio guard result: " + JSON.stringify(ratioGuard));

const historyGuard = await page.evaluate(() => {
  const today = new Date();
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  const rows = [];
  for (let i=0;i<4;i++) {
    const d = new Date(today); d.setDate(today.getDate()-i);
    rows.push({ date:iso(d), effort:i === 3 ? "recovery" : "hard" });
  }
  const safe = window.G.ptPlanner._historyRatio(rows);
  const fifth = new Date(today); fifth.setDate(today.getDate()-4);
  rows.push({ date:iso(fifth), effort:"hard" });
  const flagged = window.G.ptPlanner._historyRatio(rows);
  return { safe, flagged };
});
historyGuard.safe.warn === false && historyGuard.flagged.warn === true
  ? ok("recent PT history applies the non-blocking 3:1 guard only when completed history crosses it")
  : bad("history-ratio guard result: " + JSON.stringify(historyGuard));

const sharedSessionUi = await page.locator('[data-pt-session-blocks="strength"]').first().textContent().catch(() => "");
/Preparation Drill/.test(sharedSessionUi) && /content pending/.test(sharedSessionUi)
  ? ok("scheduled PRT sessions render from the shared block model and label unauthored drills honestly")
  : bad("shared PRT session summary missing/misleading: " + JSON.stringify(sharedSessionUi));

// Persist a custom Monday session through reload.
await page.locator('select[data-pt-session="mon"]').selectOption("custom");
await page.waitForTimeout(250);
const custom = page.locator('input[data-pt-custom="mon"]');
await custom.fill("Ruck technique + recovery");
await custom.press("Tab");
await page.waitForTimeout(350);
await page.reload({ waitUntil:"load" });
await page.waitForTimeout(900);
await dismissOnboarding(page);
await page.evaluate(() => { location.hash = "#/pt-plan"; });
await page.waitForTimeout(600);
const persisted = await page.locator('input[data-pt-custom="mon"]').inputValue().catch(() => "");
persisted === "Ruck technique + recovery" ? ok("PT day edit persists across a real reload") : bad("persisted custom Monday value: " + JSON.stringify(persisted));

// Existing reminders pipeline, new pt kind.
await page.locator('button[data-pt-remind="tue"]').click();
await page.waitForTimeout(500);
const ptReminder = await page.evaluate(async () => ((await window.G.reminders.load()) || []).find((r) => r.kind === "pt"));
ptReminder && /^PT: /.test(ptReminder.label) ? ok("PT Planner writes a real kind:'pt' reminder through G.reminders") : bad("PT reminder missing: " + JSON.stringify(ptReminder));

// Month view should derive 28 dated entries from the saved weekly plan.
await page.locator('button[data-pt-view="month"]').click();
await page.waitForTimeout(250);
const monthDays = await page.locator(".pt-month-day").count();
monthDays === 28 ? ok("month view expands the weekly plan into the next 28 dated sessions") : bad("month entry count: " + monthDays);

// Regression: a delayed Day-history read must never append into a newer Week render.
await page.evaluate(() => {
  const db = window.G.db;
  if (!db.__roadmapOriginalGetSetting) db.__roadmapOriginalGetSetting = db.getSetting.bind(db);
  db.getSetting = async function (key, fallback) {
    if (key === "pt:history:v1") await new Promise((resolve) => setTimeout(resolve, 350));
    return db.__roadmapOriginalGetSetting(key, fallback);
  };
});
await page.locator('button[data-pt-view="day"]').click();
await page.waitForTimeout(40);
await page.locator('button[data-pt-view="week"]').click();
await page.waitForTimeout(500);
const staleDay = await page.evaluate(() => ({
  week:!!document.querySelector("[data-pt-week]"),
  dayComplete:!!document.querySelector("[data-pt-complete]")
}));
staleDay.week && !staleDay.dayComplete
  ? ok("stale async Day history cannot append into a newer Week render")
  : bad("stale PT Day render leaked into Week: " + JSON.stringify(staleDay));
await page.evaluate(() => {
  const db = window.G.db;
  if (db.__roadmapOriginalGetSetting) {
    db.getSetting = db.__roadmapOriginalGetSetting;
    delete db.__roadmapOriginalGetSetting;
  }
});

// ---- Team Training + collective decision engine ----
await page.evaluate(() => { location.hash = "#/team"; });
await page.waitForTimeout(650);
const catalog = await page.evaluate(() => ({
  count: document.querySelectorAll("[data-team-exercise]").length,
  phases: [...document.querySelectorAll("[data-team-exercise] .eyebrow")].map((e) => e.textContent)
}));
catalog.count === 10 ? ok("#/team renders all ten planned exercises") : bad("team exercise count: " + catalog.count);
[1,2,3].every((p) => catalog.phases.some((x) => x.includes("Phase " + p))) ? ok("all three catalog phases are represented") : bad("phase labels: " + JSON.stringify(catalog.phases));

// Regression: Exit cancels a relay lane and must not advance or record completion.
const contactBefore = await page.evaluate(async () => {
  const s = await window.G.db.getSetting("team:training:v1", {});
  return (s && s["contact-relay"] && s["contact-relay"].count) || 0;
});
await page.locator('button[data-team-start="contact-relay"]').click();
await page.waitForTimeout(180);
await page.locator(".engine-head button", { hasText:/^Exit$/ }).click();
await page.waitForTimeout(250);
const exitState = await page.evaluate(async () => {
  const s = await window.G.db.getSetting("team:training:v1", {});
  return {
    count:(s && s["contact-relay"] && s["contact-relay"].count) || 0,
    text:document.querySelector("[data-team-session]")?.textContent || ""
  };
});
exitState.count === contactBefore && /Session not recorded/i.test(exitState.text)
  ? ok("Exit cancels a relay without advancing or recording completion")
  : bad("relay Exit incorrectly counted/advanced: " + JSON.stringify({ before:contactBefore, after:exitState }));
await page.locator("button", { hasText:/Return to catalog/i }).click();
await page.waitForTimeout(250);

await page.locator('button[data-team-start="contact-relay"]').click();
await page.waitForTimeout(450);
const collective = await page.evaluate(() => ({
  shown:!!document.querySelector(".collective-decision"),
  choices:[...document.querySelectorAll(".collective-choice")].map((b) => ({ disabled:b.disabled, pressed:b.getAttribute("aria-pressed") })),
  timer:document.querySelector("[data-collective-timer]")?.textContent || ""
}));
collective.shown ? ok("team relay launches the shared Collective Decision UI") : bad("Collective Decision UI not shown");
collective.choices.length >= 2 && collective.choices.every((x) => x.disabled)
  ? ok("collective choices stay locked during discussion")
  : bad("collective choices should start locked: " + JSON.stringify(collective.choices));
collective.timer ? ok("collective discussion timer renders") : bad("collective timer missing");

await page.locator("button", { hasText:/lock decision early/i }).click();
await page.waitForTimeout(100);
const unlocked = await page.evaluate(() => [...document.querySelectorAll(".collective-choice")].every((b) => !b.disabled));
unlocked ? ok("leader can end discussion early and unlock the team decision") : bad("collective choices did not unlock");
await page.locator(".collective-choice").first().click();
await page.locator("button", { hasText:/commit team answer/i }).click();
await page.waitForTimeout(120);
const feedbackShown = await page.evaluate(() => /Continue/.test(document.querySelector(".collective-decision")?.textContent || ""));
feedbackShown ? ok("committing a team answer exposes feedback before advancing") : bad("collective commit did not reach feedback/continue state");

// Regression: authored single-choice feedback must be shown before advancing.
const singleFeedback = await page.evaluate(async () => {
  const fixture = {
    id:"qa-collective-single-feedback", title:"QA single feedback", tier:["E4"], competency:["Intellect"], difficulty:"Basic",
    defaultMode:"cyoa", renderModes:["cyoa"], start:"n1",
    nodes:{
      n1:{ prompt:"Choose the only transition.", choices:[{ text:"Proceed", goto:"end", feedback:"Teaching point preserved." }] },
      end:{ end:true, outcome:"Done." }
    }
  };
  const host = document.createElement("div");
  host.id = "qa-single-feedback-host";
  document.body.appendChild(host);
  window.__qaCollectiveExit = null;
  window.G.engine.runCollective(fixture, host, (result) => { window.__qaCollectiveExit = result; });
  return !!host.querySelector("button");
});
singleFeedback ? ok("single-choice collective fixture launches") : bad("single-choice collective fixture did not launch");
await page.locator("#qa-single-feedback-host button", { hasText:/Proceed/i }).click();
await page.waitForTimeout(80);
const singleStage = await page.evaluate(() => ({
  feedback:document.querySelector("#qa-single-feedback-host .feedback")?.textContent || "",
  continueVisible:[...document.querySelectorAll("#qa-single-feedback-host button")].some((b) => b.textContent.trim() === "Continue"),
  callback:window.__qaCollectiveExit
}));
/Teaching point preserved/.test(singleStage.feedback) && singleStage.continueVisible && singleStage.callback == null
  ? ok("single-choice collective feedback is preserved behind a separate Continue action")
  : bad("single-choice feedback path malformed: " + JSON.stringify(singleStage));
await page.locator("#qa-single-feedback-host button", { hasText:/^Continue$/ }).click();
await page.waitForTimeout(80);
await page.locator("#qa-single-feedback-host button", { hasText:/^Done$/ }).click();
await page.waitForTimeout(80);
const completionSignal = await page.evaluate(() => window.__qaCollectiveExit);
completionSignal && completionSignal.completed === true && completionSignal.cancelled === false
  ? ok("collective completion emits an explicit completed signal")
  : bad("collective completion signal: " + JSON.stringify(completionSignal));

// ---- Board Simulator wrapper ----
await page.evaluate(() => { location.hash = "#/board-sim"; });
await page.waitForTimeout(650);
const sim = await page.evaluate(() => ({
  heading:document.querySelector("#route h2, main h2")?.textContent || "",
  phases:document.querySelectorAll(".board-sim-phase").length,
  aar:!!document.querySelector("[data-board-sim-aar]")
}));
sim.heading === "Board Simulator" ? ok("#/board-sim renders") : bad("Board Simulator heading: " + sim.heading);
sim.phases === 3 && sim.aar ? ok("Board Simulator exposes reporting, knowledge, judgment, and AAR phases") : bad("Board Simulator phase shape: " + JSON.stringify(sim));

// Regression: capped 20-entry Mock Board history still detects a newly completed board.
const capDetection = await page.evaluate(async () => {
  const rows = Array.from({length:20}, (_, i) => ({ ts:1000+i, pct:70+i%5, marker:"old-"+i }));
  await window.G.db.setSetting("board:mockHistory:v1", rows);
  const state = window.G.mockBoardSim._fresh();
  state.mockHistoryCount = rows.length;
  state.mockHistoryToken = window.G.mockBoardSim._historyToken(rows);
  const newer = rows.slice();
  newer.shift();
  newer.push({ ts:999999, pct:88, marker:"new-board" });
  await window.G.db.setSetting("board:mockHistory:v1", newer);
  const out = await window.G.mockBoardSim._reconcileKnowledge(state);
  const detected = out.knowledgeDone === true;
  await window.G.db.setSetting("board:mockHistory:v1", []);
  await window.G.db.setSetting(window.G.mockBoardSim.KEY, window.G.mockBoardSim._fresh());
  await window.G.mockBoardSim.render(document.querySelector("#route"));
  return detected;
});
capDetection ? ok("Board Simulator detects a new Mock Board even when rolling history stays capped at 20") : bad("20-entry Mock Board cap prevented knowledge completion");

// Regression: AAR draft text survives a simulator rerender.
const aarInput = page.locator("#board-sim-strong");
await aarInput.fill("Keep concise answers and strong eye contact.");
await page.waitForTimeout(160);
await page.evaluate(async () => { await window.G.mockBoardSim.render(document.querySelector("#route")); });
await page.waitForTimeout(120);
const aarPersisted = await page.locator("#board-sim-strong").inputValue().catch(() => "");
aarPersisted === "Keep concise answers and strong eye contact."
  ? ok("Board Simulator preserves AAR draft notes across phase rerenders")
  : bad("AAR draft lost on rerender: " + JSON.stringify(aarPersisted));

await page.locator('button[data-board-sim-reporting]').click();
await page.waitForTimeout(350);
const reporting = await page.evaluate(() => document.querySelector("[data-board-sim-engine]")?.textContent || "");
/BEFORE THE DOOR|Promotion Board Reporting Procedure/i.test(reporting)
  ? ok("reporting phase is actually driven by the shared scenario engine")
  : bad("reporting engine did not launch: " + reporting.slice(0, 250));

// Existing Board Readiness and IOT foundations remain present; this batch builds on them.
const foundations = await page.evaluate(() => ({
  pillars: window.G.board && window.G.board.PILLARS && window.G.board.PILLARS.length,
  iot: ["sc-iot-comms-blackout","sc-iot-motorpool-belt","sc-iot-range-safety"].every((id) => !!window.G.store.scenario(id)),
  mockHook: typeof window.G.board._openMockBoard
}));
foundations.pillars === 6 && foundations.iot ? ok("existing Board Readiness taxonomy and all three IOT scenarios remain intact") : bad("foundation regression: " + JSON.stringify(foundations));

const programGapCoverage = await page.evaluate(() => {
  const ids = ["prog-aer-1","prog-aer-2","prog-acs-1","prog-acs-2","prog-sudcc-1","prog-sudcc-2"];
  const all = window.G.store.boardQuestions();
  return ids.map((id) => {
    const q = all.find((x) => x.id === id);
    return q ? {
      id,
      category:q.category,
      pillar:q.pillar,
      regs:window.G.board.regulationsOf(q.source),
      rich:!!(q.boardAnswer && Array.isArray(q.keyPoints) && q.keyPoints.length)
    } : { id, missing:true };
  });
});
programGapCoverage.every((x) => !x.missing && x.pillar === "Programs & Support" && x.rich)
  ? ok("AER, ACS, and SUDCC now have six source-rich Board Drill cards in the Programs & Support pillar")
  : bad("Army-program board gap coverage: " + JSON.stringify(programGapCoverage));
programGapCoverage.every((x) => x.missing || (
  (/^prog-aer-/.test(x.id) && x.regs.includes("AR 930-4")) ||
  (/^prog-acs-/.test(x.id) && x.regs.includes("AR 608-1")) ||
  (/^prog-sudcc-/.test(x.id) && x.regs.includes("AR 600-85"))
))
  ? ok("each new Army-program card resolves to its governing regulation through the existing regulation grammar")
  : bad("Army-program regulation derivation: " + JSON.stringify(programGapCoverage));

noise.length === 0 ? ok("no console errors/warnings across new roadmap surfaces") : bad(noise.length + " console messages; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? "ROADMAP LEADER READINESS: " + fails + " FAILURE(S)" : "ROADMAP LEADER READINESS: all passed"));
process.exit(fails ? 1 : 0);
