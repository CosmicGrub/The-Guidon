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
scenarioTruth[0] && scenarioTruth[0].discuss >= 3 ? ok("collective relay authors at least three discuss:true decision nodes") : bad("collective decision nodes: " + JSON.stringify(scenarioTruth[0]));

// ---- PT Planner ----
await page.evaluate(() => { location.hash = "#/pt-plan"; });
await page.waitForTimeout(650);
const ptBoot = await page.evaluate(() => ({
  heading: document.querySelector("#view h2")?.textContent || "",
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

// ---- Team Training + collective decision engine ----
await page.evaluate(() => { location.hash = "#/team"; });
await page.waitForTimeout(650);
const catalog = await page.evaluate(() => ({
  count: document.querySelectorAll("[data-team-exercise]").length,
  phases: [...document.querySelectorAll("[data-team-exercise] .eyebrow")].map((e) => e.textContent)
}));
catalog.count === 10 ? ok("#/team renders all ten planned exercises") : bad("team exercise count: " + catalog.count);
[1,2,3].every((p) => catalog.phases.some((x) => x.includes("Phase " + p))) ? ok("all three catalog phases are represented") : bad("phase labels: " + JSON.stringify(catalog.phases));

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

// ---- Board Simulator wrapper ----
await page.evaluate(() => { location.hash = "#/board-sim"; });
await page.waitForTimeout(650);
const sim = await page.evaluate(() => ({
  heading:document.querySelector("#view h2")?.textContent || "",
  phases:document.querySelectorAll(".board-sim-phase").length,
  aar:!!document.querySelector("[data-board-sim-aar]")
}));
sim.heading === "Board Simulator" ? ok("#/board-sim renders") : bad("Board Simulator heading: " + sim.heading);
sim.phases === 3 && sim.aar ? ok("Board Simulator exposes reporting, knowledge, judgment, and AAR phases") : bad("Board Simulator phase shape: " + JSON.stringify(sim));
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

noise.length === 0 ? ok("no console errors/warnings across new roadmap surfaces") : bad(noise.length + " console messages; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? "ROADMAP LEADER READINESS: " + fails + " FAILURE(S)" : "ROADMAP LEADER READINESS: all passed"));
process.exit(fails ? 1 : 0);
