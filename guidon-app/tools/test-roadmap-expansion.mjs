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

await page.goto(url, { waitUntil:"load" });
await page.waitForTimeout(500);
await dismissOnboarding(page);
await page.waitForTimeout(250);

const api = await page.evaluate(async () => {
  const G = window.G;
  const d = G.ptPlanner.defaultWeek();
  const r = G.ptPlanner.ratio({ week:d });
  await G.ptPlanner.save({ week:d });
  const loaded = await G.ptPlanner.load();
  const readiness = await G.board.readinessScore();
  const marked = ["sc-tccc-ied-strike","sc-medevac-9line-callin","sc-iot-comms-blackout","sc-iot-motorpool-belt","sc-iot-range-safety"].map((id) => {
    const sc = G.store.scenario(id);
    return { id, discussed:Object.values(sc.nodes || {}).filter((n) => n && n.discuss === true).length };
  });
  return {
    hasPlanner:!!G.ptPlanner, week:d.length, loaded:loaded.week.length, ratio:r.label, warning:r.warning,
    teamCatalog:G.teamTools.catalog.length, hasTeamStart:typeof G.teamTools.start === "function",
    readiness, marked, hasRunTeam:typeof G.engine.runTeam === "function"
  };
});
api.hasPlanner && api.week === 7 && api.loaded === 7 ? ok("PT planner persists a seven-day week") : bad("PT planner week/persistence: " + JSON.stringify(api));
api.warning === false ? ok("default PT week stays within the 3:1 hard/recovery caution") : bad("default PT week unexpectedly warns: " + JSON.stringify(api));
api.teamCatalog === 10 && api.hasTeamStart ? ok("10-exercise team-building catalog is available") : bad("team catalog API incomplete: " + JSON.stringify(api));
api.hasRunTeam ? ok("scenario engine exposes backward-compatible runTeam()") : bad("G.engine.runTeam missing");
api.marked.every((x) => x.discussed >= 1) ? ok("selected shipped scenarios carry collective-decision nodes") : bad("collective node tagging: " + JSON.stringify(api.marked));
api.readiness && typeof api.readiness.score === "number" && /80%/.test(api.readiness.formula || "")
  ? ok("combined Board Readiness 2.0 score exposes its transparent formula")
  : bad("readiness rollup missing/invalid: " + JSON.stringify(api.readiness));

await page.evaluate(() => { location.hash = "#/prt"; });
await page.waitForTimeout(500);
const prt = await page.evaluate(() => ({
  text:document.querySelector("#main")?.textContent || "",
  tabs:[...document.querySelectorAll("#main .segmented button")].map((b) => b.textContent.trim())
}));
prt.text.includes("PT Planner") && ["Day","Week","Month"].every((x) => prt.tabs.includes(x))
  ? ok("#/prt renders the Day / Week / Month planner")
  : bad("PT planner UI missing from #/prt: " + JSON.stringify(prt.tabs));

await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(350);
await page.evaluate(() => window.G.board._openReadiness && window.G.board._openReadiness());
await page.waitForTimeout(350);
const readyText = await page.evaluate(() => document.querySelector("#main")?.textContent || "");
readyText.includes("Board Readiness 2.0") && readyText.includes("Combined readiness")
  ? ok("Readiness tab renders the combined readiness rollup")
  : bad("combined readiness UI not found");

await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(250);
await page.evaluate(() => window.G.board._openMockBoard && window.G.board._openMockBoard());
await page.waitForTimeout(250);
const fullMock = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /Full phased board simulation/.test(b.textContent || "")));
fullMock ? ok("Mock Board exposes the full phased simulation preset") : bad("full phased Mock Board preset missing");

const collective = await page.evaluate(() => {
  const host=document.createElement("div"); document.body.appendChild(host);
  window.G.engine.runTeam("sc-iot-comms-blackout","course",host,["Alpha","Bravo"],() => {});
  const text=host.textContent || "";
  const gate=!!host.querySelector("button") && /Collective Decision|has the decision/.test(text);
  host.remove();
  return {gate,text:text.slice(0,220)};
});
collective.gate ? ok("team scenario enters the Collective Decision gate") : bad("collective gate did not render: " + JSON.stringify(collective));

if (noise.length) bad("browser console/page errors: " + noise.join(" | "));
else ok("no browser console/page errors");

await browser.close();
server.close();
if (fails) { console.error("\n" + fails + " roadmap-expansion assertion(s) failed."); process.exit(1); }
console.log("\nRoadmap expansion regression suite passed.");
