/**
 * "Add persistence to the memory-less drills" pass: squadDrill() and
 * mdmpDrill() (#/drills -> "Squad Drill sequence" / "MDMP step trainer",
 * src/index.html "drills.js") are pure reveal-and-read steppers with no
 * grading mechanic - unlike citDrill()/briefDrill()'s rubric checkboxes
 * (see test-baseline-coverage.mjs's own "#/drills" section) there was no
 * existing state to hook a best-score onto, and unlike Land Nav Drill
 * (test-landnav-drill.mjs) there's no generated-answer-checked() event
 * either. What both DO have is a real, honest completion event - cycling
 * all the way through the sequence and wrapping back to step 1 - which
 * used to mean nothing at all: leave the route, come back, and you're
 * back at 0 passes with no memory you'd ever been through it.
 *
 * This drives a full pass through each drill via real "Next →" clicks,
 * confirms the pass is only counted on the WRAP (not on every click),
 * confirms it persists to the same "guidon:drills:v1" kv row every other
 * drill in this module shares, and confirms it survives a real page
 * reload - the same bar test-baseline-coverage.mjs and test-landnav-
 * drill.mjs already hold their own persistence to.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { openAsOwner } from "./device-storage.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const DRILLS_KEY = "guidon:drills:v1";

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
// A real profile, not a Guest session: this suite checks that what it does is
// still there after a reload, and a Guest session saves nothing (the storage
// contract - see tools/device-storage.mjs and test-guest-saves-nothing.mjs).
await openAsOwner(page, url);
await page.waitForTimeout(400);

// Start from a known-empty state - a prior suite in the same shared kv row
// (test-baseline-coverage.mjs) cleans up after itself, but this suite
// shouldn't depend on running after it.
await page.evaluate((k) => window.G.db.put("kv", { k, v: {} }), DRILLS_KEY);

async function openDrill(name) {
  // Route to #/home first: setting location.hash to a value it's ALREADY
  // at (e.g. calling this a second time while still inside a #/drills
  // sub-view) is a same-hash no-op for the router's hashchange listener,
  // so it would silently leave the previous drill's sub-view on screen
  // instead of returning to the picker menu.
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(200);
  await page.evaluate(() => { location.hash = "#/drills"; });
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: name }).click();
  await page.waitForTimeout(300);
}

function passHint() {
  return page.locator(".panel p.hint").filter({ hasText: /Completed \d+ full pass/ }).first();
}
// MDMP's panel has a static intro hint ("Introduced at ALC...") ahead of
// its "Step N of 7" progress line, unlike Squad Drill's panel - a bare
// ".panel p.hint" .first() picks up the wrong element there.
function progressHint() {
  return page.locator(".panel p.hint").filter({ hasText: /^Step \d+ of/ }).first();
}

// ==================== Squad Drill: 20 steps ====================
console.log('\n-- "Squad Drill sequence" (20 steps) - pass counter --');
await openDrill(/Squad Drill sequence/);

const squadHintBefore = await page.evaluate(() => {
  const hints = [...document.querySelectorAll(".panel p.hint")];
  return hints.some((el) => /Completed \d+ full pass/.test(el.textContent || ""));
});
squadHintBefore ? bad("Squad Drill shows a pass count before completing a single pass") : ok("Squad Drill shows no pass-count hint before the first completed pass (empty, not '0 full passes')");

// Click "Next →" 19 times (steps 1..20, i.e. 19 forward moves) without
// wrapping - the pass must NOT be counted yet.
for (let i = 0; i < 19; i++) {
  await page.locator("button", { hasText: "Next →" }).click();
  await page.waitForTimeout(30);
}
const squadStep20 = await progressHint().textContent();
/Step 20 of 20/.test(squadStep20 || "")
  ? ok("19 clicks of 'Next →' land on step 20 of 20 (no wrap yet)")
  : bad("Squad Drill progress after 19 clicks: " + JSON.stringify(squadStep20));
const squadHintStillNone = await page.evaluate(() => {
  const hints = [...document.querySelectorAll(".panel p.hint")];
  return hints.some((el) => /Completed \d+ full pass/.test(el.textContent || ""));
});
squadHintStillNone ? bad("Squad Drill counted a pass before actually wrapping back to step 1") : ok("Squad Drill still shows no pass yet at step 20 (the wrap hasn't happened)");

// The 20th click wraps from step 20 back to step 1 - THIS is the completed pass.
await page.locator("button", { hasText: "Next →" }).click();
await page.waitForTimeout(150);
const squadStep1Again = await progressHint().textContent();
/Step 1 of 20/.test(squadStep1Again || "")
  ? ok("the 20th click wraps back to step 1 of 20")
  : bad("Squad Drill progress after wrap: " + JSON.stringify(squadStep1Again));
const squadPassAfterOne = await passHint().textContent();
/^Completed 1 full pass · last \d{4}-\d{2}-\d{2}$/.test(squadPassAfterOne || "")
  ? ok(`Squad Drill counts exactly one completed pass on the wrap, with today's date: "${squadPassAfterOne}"`)
  : bad("Squad Drill pass hint after one wrap: " + JSON.stringify(squadPassAfterOne));

const squadPersisted1 = await page.evaluate(async (k) => {
  const r = await window.G.db.get("kv", k);
  return r && r.v ? { passes: r.v.squadPasses, date: r.v.squadLastDate } : null;
}, DRILLS_KEY);
squadPersisted1 && squadPersisted1.passes === 1 && /^\d{4}-\d{2}-\d{2}$/.test(squadPersisted1.date || "")
  ? ok(`Squad Drill pass count (1) and date persist to kv "${DRILLS_KEY}"`)
  : bad("Squad Drill persisted pass state: " + JSON.stringify(squadPersisted1));

// A second full wrap (20 more clicks) should increment to 2, not reset.
for (let i = 0; i < 20; i++) {
  await page.locator("button", { hasText: "Next →" }).click();
  await page.waitForTimeout(30);
}
const squadPassAfterTwo = await passHint().textContent();
/^Completed 2 full passes · last \d{4}-\d{2}-\d{2}$/.test(squadPassAfterTwo || "")
  ? ok(`Squad Drill counts a second wrap as "2 full passes" (plural), not resetting: "${squadPassAfterTwo}"`)
  : bad("Squad Drill pass hint after two wraps: " + JSON.stringify(squadPassAfterTwo));

// "Restart" (i=0 without wrapping through Next) must NOT count as a pass.
await page.locator("button", { hasText: "Next →" }).click();
await page.waitForTimeout(50);
await page.locator("button", { hasText: "↺ Restart" }).click();
await page.waitForTimeout(150);
const squadPassAfterRestart = await passHint().textContent();
squadPassAfterRestart === squadPassAfterTwo
  ? ok("clicking 'Restart' does not itself count as a completed pass")
  : bad("Squad Drill pass hint changed after Restart alone: " + JSON.stringify(squadPassAfterRestart) + " (was " + JSON.stringify(squadPassAfterTwo) + ")");

// Survives leaving the route and a real reload, not just an in-app re-render.
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(200);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
await dismissOnboarding(page);
await page.waitForTimeout(300);
await openDrill(/Squad Drill sequence/);
const squadPassAfterReload = await passHint().textContent();
squadPassAfterReload === squadPassAfterTwo
  ? ok("Squad Drill pass count survives a real page reload")
  : bad("Squad Drill pass hint after reload: " + JSON.stringify(squadPassAfterReload));

// ==================== MDMP: 7 steps ====================
console.log('\n-- "MDMP step trainer" (7 steps) - pass counter --');
await openDrill(/MDMP step trainer/);

const mdmpHintBefore = await page.evaluate(() => {
  const hints = [...document.querySelectorAll(".panel p.hint")];
  return hints.some((el) => /Completed \d+ full pass/.test(el.textContent || ""));
});
mdmpHintBefore ? bad("MDMP shows a pass count before completing a single pass") : ok("MDMP shows no pass-count hint before the first completed pass");

for (let i = 0; i < 6; i++) {
  await page.locator("button", { hasText: "Next →" }).click();
  await page.waitForTimeout(30);
}
const mdmpStep7 = await progressHint().textContent();
/Step 7 of 7/.test(mdmpStep7 || "")
  ? ok("6 clicks of 'Next →' land on step 7 of 7 (no wrap yet)")
  : bad("MDMP progress after 6 clicks: " + JSON.stringify(mdmpStep7));

await page.locator("button", { hasText: "Next →" }).click();
await page.waitForTimeout(150);
const mdmpStep1Again = await progressHint().textContent();
/Step 1 of 7/.test(mdmpStep1Again || "")
  ? ok("the 7th click wraps back to step 1 of 7")
  : bad("MDMP progress after wrap: " + JSON.stringify(mdmpStep1Again));
const mdmpPassAfterOne = await passHint().textContent();
/^Completed 1 full pass · last \d{4}-\d{2}-\d{2}$/.test(mdmpPassAfterOne || "")
  ? ok(`MDMP counts exactly one completed pass on the wrap: "${mdmpPassAfterOne}"`)
  : bad("MDMP pass hint after one wrap: " + JSON.stringify(mdmpPassAfterOne));

const mdmpPersisted = await page.evaluate(async (k) => {
  const r = await window.G.db.get("kv", k);
  return r && r.v ? { passes: r.v.mdmpPasses, date: r.v.mdmpLastDate, squadUntouched: r.v.squadPasses } : null;
}, DRILLS_KEY);
mdmpPersisted && mdmpPersisted.passes === 1 && mdmpPersisted.squadUntouched === 2
  ? ok(`MDMP pass count (1) persists to its own "mdmpPasses" key in the shared kv row, without disturbing Squad Drill's own "squadPasses" (still 2)`)
  : bad("MDMP persisted pass state: " + JSON.stringify(mdmpPersisted));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

// cleanup
await page.evaluate((k) => window.G.db.put("kv", { k, v: {} }), DRILLS_KEY);

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSQUAD/MDMP DRILL PASSES: all passed");
process.exit(fails ? 1 : 0);
