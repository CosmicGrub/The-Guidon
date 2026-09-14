/**
 * Rapid Fire's streak-multiplier scoring (v2 candidate #1 from
 * docs/superpowers/specs/2026-08-23-rapid-fire-design.md's own "Deferred to
 * a later pass" list) — a pure bonus ON TOP of the existing Correct count,
 * never replacing it: 10 base points per correct card, plus 5 more for
 * every card already in the current streak before this one (card 1 of a
 * streak = 10, card 2 = 15, card 3 = 20, ...), capped at +50 bonus (card 11+
 * in one streak always adds 60). A Pass resets the streak (and therefore the
 * bonus) back to the base rate for whatever streak starts next, but does
 * NOT subtract from points already earned.
 *
 * Exercises the real HUD text (".rf-hud-stat", same element
 * test-rapid-fire.mjs's own roundState() reads for "Correct: N"), the real
 * #a11y-live announcement, the Recap's new "Points" stat tile
 * (buildStatsBlock, shared by Party/Solo's drawRecap AND Team's per-team
 * drawTeamRecap breakdown), and confirms Team mode's own winner-by-
 * correctCount comparison is untouched by this (points is flavor, not a new
 * win condition).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await dismissOnboarding(page);
await page.waitForTimeout(300);

async function clickButtonByText(text, scopeSel) {
  return page.evaluate(({ text, scopeSel }) => {
    const scope = scopeSel ? document.querySelector(scopeSel) : document;
    if (!scope) return false;
    const btn = [...scope.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
    if (!btn) return false;
    btn.click();
    return true;
  }, { text, scopeSel });
}
async function enterRapidFireFresh() {
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(400);
  await clickButtonByText("Board Drill");
  await page.waitForTimeout(150);
  const clicked = await clickButtonByText("Rapid Fire");
  await page.waitForFunction(
    () => [...document.querySelectorAll(".segmented button")].some((b) => b.textContent.trim() === "Party"),
    { timeout: 30000 }
  ).catch(() => {});
  return clicked;
}
async function startRound() {
  await clickButtonByText("Start Round");
  await page.waitForTimeout(250);
  if (await page.evaluate(() => !!document.querySelector(".rf-explainer"))) {
    await clickButtonByText("Got it — let's go");
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(200);
}
async function hudText() { return page.evaluate(() => (document.querySelector(".rf-hud-stat") || {}).textContent || ""); }
async function liveText() { return page.evaluate(() => { const r = document.getElementById("a11y-live"); return r ? r.textContent : null; }); }
async function tapCorrect() { await page.evaluate(() => document.querySelector(".rf-judge-correct")?.click()); await page.waitForTimeout(120); }
async function tapPass() { await page.evaluate(() => document.querySelector(".rf-judge-pass")?.click()); await page.waitForTimeout(120); }
async function tapEndRound() { await clickButtonByText("End Round"); await page.waitForTimeout(200); }
function pointsIn(text) { const m = /(\d+)\s*pts/.exec(text || ""); return m ? Number(m[1]) : null; }

// ==================== Party: streak bonus grows per consecutive correct, resets on Pass ====================
console.log("\n-- Party mode: streak-scaled points, real HUD + #a11y-live values --");
await enterRapidFireFresh();
await startRound();

await tapCorrect();
let hud = await hudText();
pointsIn(hud) === 10
  ? ok(`1st correct in a fresh streak: HUD reads 10 pts (base rate): "${hud}"`)
  : bad("points after 1st correct: " + JSON.stringify(hud));
let live = await liveText();
/\+10 points, 10 total\./.test(live || "")
  ? ok(`#a11y-live announces "+10 points, 10 total.": "${live}"`)
  : bad("live announcement after 1st correct: " + JSON.stringify(live));

await tapCorrect();
hud = await hudText();
pointsIn(hud) === 25
  ? ok(`2nd consecutive correct: HUD reads 25 pts total (10 + 15 for the 2nd card of the streak): "${hud}"`)
  : bad("points after 2nd correct: " + JSON.stringify(hud));

await tapCorrect();
hud = await hudText();
pointsIn(hud) === 45
  ? ok(`3rd consecutive correct: HUD reads 45 pts total (10 + 15 + 20): "${hud}"`)
  : bad("points after 3rd correct: " + JSON.stringify(hud));

// A Pass resets the STREAK (so the next correct card earns only the base
// rate again) but does not claw back points already earned.
await tapPass();
hud = await hudText();
pointsIn(hud) === 45
  ? ok(`a Pass does not subtract from points already earned (still 45): "${hud}"`)
  : bad("points after a Pass: " + JSON.stringify(hud));

await tapCorrect();
hud = await hudText();
pointsIn(hud) === 55
  ? ok(`the next correct card after a Pass earns only the base 10 again (45 + 10 = 55), not a continued bonus: "${hud}"`)
  : bad("points after correct-following-a-pass: " + JSON.stringify(hud));

// ==================== the streak bonus caps at +50 (never an unbounded number) ====================
console.log("\n-- Party mode: streak bonus caps at +50 per card, doesn't grow forever --");
await enterRapidFireFresh();
await startRound();
let expectedTotal = 0;
for (let i = 0; i < 14; i++) {
  const bonus = Math.min(50, i * 5); // streakBeforeThisCard = i (0-indexed)
  expectedTotal += 10 + bonus;
  await tapCorrect();
}
hud = await hudText();
// By card 11 (i=10), the bonus is already capped at 50 (10*5=50); cards
// 12-14 (i=11,12,13) would compute 55/60/65 uncapped but must stay at 50.
pointsIn(hud) === expectedTotal
  ? ok(`14 consecutive correct answers total exactly ${expectedTotal} points, confirming the +50 bonus cap held rather than growing unbounded: "${hud}"`)
  : bad(`points after 14-card streak: got ${pointsIn(hud)}, expected ${expectedTotal} (HUD: ${JSON.stringify(hud)})`);

// ==================== Recap shows a real "Points" stat tile ====================
console.log("\n-- Recap: a real 'Points' stat tile, matching the HUD's own running total --");
await tapEndRound();
const recapPoints = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll(".stat")];
  const t = tiles.find((el) => (el.querySelector(".k") || {}).textContent === "Points");
  return t ? (t.querySelector(".v") || {}).textContent : null;
});
recapPoints === String(expectedTotal)
  ? ok(`Recap's "Points" stat tile reads ${expectedTotal}, matching the round's real running total`)
  : bad("Recap Points tile: " + JSON.stringify(recapPoints));

// ==================== Team mode: points is flavor, NOT a new win condition ====================
console.log("\n-- Team mode: each team's own Points tile, winner still decided by Correct count --");
await enterRapidFireFresh();
await clickButtonByText("Team");
await page.waitForTimeout(200);
const teamInputs = await page.evaluate(() => [...document.querySelectorAll('input[aria-label^="Team"]')].map((i) => i));
// Fill both team-name fields the same way Setup expects (real typed input,
// not just a value assignment, so any input listener actually fires).
await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input[aria-label^="Team"]')];
  if (inputs[0]) { inputs[0].value = "Alpha"; inputs[0].dispatchEvent(new Event("input", { bubbles: true })); }
  if (inputs[1]) { inputs[1].value = "Bravo"; inputs[1].dispatchEvent(new Event("input", { bubbles: true })); }
});
await page.waitForTimeout(150);
await startRound();
// "Start Round" on Setup leads to a per-team HANDOFF screen first
// (drawTeamHandoff), not straight into the round - drawTeamHandoff()'s own
// button text is "Start " + teamName + "'s turn" (curly apostrophe),
// clicked via a real DOM find rather than hardcoding that character.
async function startTeamTurn(teamName) {
  const clicked = await page.evaluate((name) => {
    const b = [...document.querySelectorAll("button")].find((b) => new RegExp("^Start " + name).test(b.textContent || ""));
    if (!b) return false;
    b.click();
    return true;
  }, teamName);
  await page.waitForTimeout(250);
  return clicked;
}
const onAlphaHandoff = await page.evaluate(() => [...document.querySelectorAll("h3")].some((h) => /Alpha/.test(h.textContent || "")));
onAlphaHandoff ? ok("Setup's 'Start Round' leads to Alpha's handoff screen first, as designed") : bad("did not reach Alpha's handoff screen after Setup's Start Round");
const gotAlphaTurn = await startTeamTurn("Alpha");
gotAlphaTurn ? ok("'Start Alpha's turn' begins Alpha's real round") : bad("could not find/click 'Start Alpha's turn'");

// Alpha's turn: 2 correct (streak bonus applies).
await tapCorrect();
await tapCorrect();
await tapEndRound();
await page.waitForTimeout(300);
// Should now be on Bravo's handoff screen.
const onBravoHandoff = await page.evaluate(() => [...document.querySelectorAll("h3")].some((h) => /Bravo/.test(h.textContent || "")));
onBravoHandoff ? ok("Alpha's turn ends and hands off to Bravo, as expected") : bad("did not reach Bravo's handoff screen after Alpha's turn");
const gotBravoTurn = await startTeamTurn("Bravo");
gotBravoTurn ? ok("'Start Bravo's turn' begins Bravo's real round") : bad("could not find/click 'Start Bravo's turn'");
// Bravo's turn: only 1 correct, so Alpha (2 correct) should still win on correctCount.
await tapCorrect();
await tapEndRound();
await page.waitForTimeout(300);
const finalRecapText = await page.evaluate(() => {
  const h = [...document.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Final Recap");
  return h ? h.closest(".panel").textContent : null;
});
finalRecapText && /Alpha wins with 2 correct/.test(finalRecapText)
  ? ok('Final Recap: "Alpha wins with 2 correct." — the winner is still decided by Correct count, not points')
  : bad("Final Recap winner text: " + JSON.stringify(finalRecapText ? finalRecapText.slice(0, 200) : null));
const bothPointsTilesShown = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll(".stat")].filter((el) => (el.querySelector(".k") || {}).textContent === "Points");
  return tiles.length;
});
bothPointsTilesShown === 2
  ? ok("Final Recap shows a separate 'Points' tile for each team (2 total), via the same shared buildStatsBlock() Party/Solo use")
  : bad("expected 2 'Points' tiles in the Final Recap (one per team), found " + bothPointsTilesShown);

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nRAPID FIRE STREAK POINTS: all passed");
process.exit(fails ? 1 : 0);
