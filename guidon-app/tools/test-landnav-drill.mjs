/**
 * New feature: the Land Navigation practice drill (#/drills -> "Land
 * Navigation practice drill", landNavDrill() in js "drills.js") closes a
 * confirmed practice-tool gap -- GUIDON had a 25-item Land Navigation
 * self-check question bank plus a couple of doctrine cards on MGRS/pace
 * count/marginal info, but nothing hands-on. This drives all three
 * generated-and-checked modes (azimuth<->back-azimuth in both degrees and
 * mils, the pace-count word problem, and grid-coordinate component
 * reading) through REAL interaction: read the generated problem straight
 * out of the DOM, compute the expected answer independently in this test
 * (not by re-reading the app's own displayed answer), type it in, check
 * both a correct and an incorrect submission, confirm the score tally and
 * feedback text update, then advance to a new problem and confirm the
 * question actually changes.
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
await page.waitForTimeout(400);

async function openLandNavDrill() {
  await page.evaluate(() => { location.hash = "#/drills"; });
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: /Land Navigation practice drill/ }).click();
  await page.waitForTimeout(300);
}

// ==================== menu card is real, not just present ====================
await page.evaluate(() => { location.hash = "#/drills"; });
await page.waitForTimeout(400);
const cardText = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Land Navigation practice drill/.test(b.textContent || ""));
  return btn ? btn.textContent : null;
});
cardText && /TC 3-25\.26/.test(cardText)
  ? ok("#/drills menu shows the Land Navigation card with its TC 3-25.26 blurb")
  : bad("Land Navigation menu card missing or blurb didn't cite TC 3-25.26: " + JSON.stringify(cardText));

await openLandNavDrill();
const modeButtons = await page.locator(".panel .segmented button").allTextContents();
JSON.stringify(modeButtons.slice(0, 3)) === JSON.stringify(["Back azimuth", "Pace count", "Grid coordinate"])
  ? ok('Land Navigation drill opens on the three-mode switch: "Back azimuth" / "Pace count" / "Grid coordinate"')
  : bad("mode switch buttons: " + JSON.stringify(modeButtons));

// ==================== (a) Back azimuth: degrees, a correct then an incorrect submission ====================
const azHeading = await page.locator(".panel h3").first().textContent();
let m = /Azimuth:\s*(\d+)°/.exec(azHeading || "");
m ? ok(`Back azimuth (degrees) shows a generated azimuth: "${azHeading}"`) : bad('Back azimuth heading did not match "Azimuth: N°": ' + JSON.stringify(azHeading));
let az = m ? Number(m[1]) : NaN;
let expected = az <= 180 ? az + 180 : az - 180;

const azInput = page.locator('input[aria-label="Back azimuth answer"]');
const azCheckBtn = page.locator("button", { hasText: "Check" }).first();

// Correct answer
await azInput.fill(String(expected));
await azCheckBtn.click();
await page.waitForTimeout(150);
let fbText = await page.locator(".feedback").first().textContent();
(fbText || "").startsWith("Correct.") && new RegExp(String(az) + (az <= 180 ? " \\+ 180" : " \\D 180")).test(fbText)
  ? ok(`Back azimuth: correct answer (${expected}) for azimuth ${az}° is graded "Correct." and the worked rule is shown: "${fbText}"`)
  : bad(`Back azimuth correct-answer feedback: "${fbText}" (azimuth=${az}, expected=${expected})`);
let score = await page.locator(".stat .v").first().textContent();
score === "1 / 1" ? ok("Back azimuth: score tally reads 1 / 1 after one correct answer") : bad("Back azimuth score after correct: " + JSON.stringify(score));

// Incorrect answer on the SAME problem (no "New azimuth" click yet)
const wrongGuess = expected + 7;
await azInput.fill(String(wrongGuess));
await azCheckBtn.click();
await page.waitForTimeout(150);
fbText = await page.locator(".feedback").first().textContent();
(fbText || "").includes("Not quite") && fbText.includes(String(expected) + "°")
  ? ok(`Back azimuth: wrong answer (${wrongGuess}) is graded "Not quite" and still states the real correct answer (${expected}°)`)
  : bad(`Back azimuth wrong-answer feedback: "${fbText}"`);
score = await page.locator(".stat .v").first().textContent();
score === "1 / 2" ? ok("Back azimuth: score tally reads 1 / 2 after a right then a wrong answer") : bad("Back azimuth score after wrong: " + JSON.stringify(score));

// Advance to a new problem: the generated azimuth must actually change the question, and the answer input clears.
let sawNewAzimuth = false;
for (let i = 0; i < 6; i++) {
  await page.locator("button", { hasText: "New azimuth →" }).click();
  await page.waitForTimeout(120);
  const nextHeading = await page.locator(".panel h3").first().textContent();
  if (nextHeading !== azHeading) { sawNewAzimuth = true; azHeading; break; }
}
sawNewAzimuth
  ? ok('Back azimuth: "New azimuth →" regenerates a different azimuth (real advance, not a static card)')
  : bad("Back azimuth: azimuth heading never changed across 6 clicks of 'New azimuth →'");
const clearedInput = await page.locator('input[aria-label="Back azimuth answer"]').inputValue();
clearedInput === "" ? ok("Back azimuth: the answer field is empty on a fresh problem") : bad("Back azimuth answer field after New azimuth: " + JSON.stringify(clearedInput));

// ==================== unit switch to mils uses the ±3,200 rule and resets the score ====================
await page.locator(".segmented button", { hasText: "Mils" }).click();
await page.waitForTimeout(150);
const milHeading = await page.locator(".panel h3").first().textContent();
const mMil = /Azimuth:\s*(\d+)\s*mils/.exec(milHeading || "");
mMil ? ok(`Switching to Mils regenerates the problem in mils: "${milHeading}"`) : bad('Mils heading did not match "Azimuth: N mils": ' + JSON.stringify(milHeading));
const azMil = mMil ? Number(mMil[1]) : NaN;
const expectedMil = azMil <= 3200 ? azMil + 3200 : azMil - 3200;
const scoreAfterUnitSwitch = await page.locator(".stat .v").first().textContent();
scoreAfterUnitSwitch === "0 / 0" ? ok("Switching units resets the score tally to 0 / 0") : bad("score after unit switch: " + JSON.stringify(scoreAfterUnitSwitch));
await page.locator('input[aria-label="Back azimuth answer"]').fill(String(expectedMil));
await page.locator("button", { hasText: "Check" }).first().click();
await page.waitForTimeout(150);
const milFb = await page.locator(".feedback").first().textContent();
(milFb || "").startsWith("Correct.") && /3,200/.test(milFb)
  ? ok(`Mils mode: correct answer (${expectedMil}) for azimuth ${azMil} mils is graded "Correct." and cites the 3,200-mil rule: "${milFb}"`)
  : bad(`Mils mode correct-answer feedback: "${milFb}" (azimuth=${azMil}, expected=${expectedMil})`);

// ==================== (b) Pace count word problem ====================
await page.locator(".segmented button", { hasText: "Pace count" }).click();
await page.waitForTimeout(200);
const paceHeading = await page.locator(".panel h3").first().textContent();
const paceQ = await page.locator(".panel .hint").filter({ hasText: /How many total paces/ }).first().textContent();
const mPace = /Pace count:\s*(\d+)\s*paces per 100 m/.exec(paceHeading || "");
const mDist = /cover\s*(\d+)\s*meters/.exec(paceQ || "");
(mPace && mDist)
  ? ok(`Pace count problem shows a generated pace count and distance: "${paceHeading}" / "${paceQ}"`)
  : bad(`Pace count problem text: heading="${paceHeading}" question="${paceQ}"`);
const paceCount = mPace ? Number(mPace[1]) : NaN;
const distance = mDist ? Number(mDist[1]) : NaN;
const paceExpected = Math.round((paceCount * distance) / 100);

const paceInput = page.locator('input[aria-label="Total paces answer"]');
await paceInput.fill(String(paceExpected));
await page.locator("button", { hasText: "Check" }).first().click();
await page.waitForTimeout(150);
let paceFb = await page.locator(".feedback").first().textContent();
(paceFb || "").startsWith("Correct.") && paceFb.includes("para 5-3") && paceFb.includes(String(paceExpected) + " paces")
  ? ok(`Pace count: correct answer (${paceExpected}) for ${paceCount} paces/100m over ${distance}m is graded "Correct." and cites TC 3-25.26 para 5-3: "${paceFb}"`)
  : bad(`Pace count correct-answer feedback: "${paceFb}" (paceCount=${paceCount}, distance=${distance}, expected=${paceExpected})`);

await paceInput.fill(String(paceExpected + 3));
await page.locator("button", { hasText: "Check" }).first().click();
await page.waitForTimeout(150);
paceFb = await page.locator(".feedback").first().textContent();
(paceFb || "").includes("Not quite") && paceFb.includes(String(paceExpected) + " paces")
  ? ok(`Pace count: wrong answer is graded "Not quite" and states the real correct total (${paceExpected} paces)`)
  : bad(`Pace count wrong-answer feedback: "${paceFb}"`);
const paceScore = await page.locator(".stat .v").first().textContent();
paceScore === "1 / 2" ? ok("Pace count: score tally reads 1 / 2 after a right then a wrong answer") : bad("Pace count score: " + JSON.stringify(paceScore));

let sawNewPaceProblem = false;
for (let i = 0; i < 6; i++) {
  await page.locator("button", { hasText: "New problem →" }).click();
  await page.waitForTimeout(120);
  const nextHeading = await page.locator(".panel h3").first().textContent();
  if (nextHeading !== paceHeading) { sawNewPaceProblem = true; break; }
}
sawNewPaceProblem
  ? ok('Pace count: "New problem →" regenerates a different pace count/distance (real advance)')
  : bad("Pace count: heading never changed across 6 clicks of 'New problem →'");

// ==================== (c) Grid coordinate component reading ====================
await page.locator(".segmented button", { hasText: "Grid coordinate" }).click();
await page.waitForTimeout(200);
const combined = (await page.locator(".panel h3").first().textContent()) || "";
const mGrid = /^([A-Z]{2})(\d{4})(\d{4})$/.exec(combined.trim());
mGrid
  ? ok(`Grid coordinate problem shows a generated 10-character coordinate: "${combined}"`)
  : bad(`Grid coordinate combined string didn't match SQ+EEEE+NNNN: "${combined}"`);
const [, sq, easting, northing] = mGrid || [, "", "", ""];

const sqIn = page.locator('input[aria-label="100,000-meter square identifier (2 letters)"]');
const eIn = page.locator('input[aria-label="Easting (4 digits)"]');
const nIn = page.locator('input[aria-label="Northing (4 digits)"]');

// Correct submission, lowercase square letters to confirm case-insensitive matching.
await sqIn.fill(sq.toLowerCase());
await eIn.fill(easting);
await nIn.fill(northing);
await page.locator("button", { hasText: "Check" }).first().click();
await page.waitForTimeout(150);
let gridFb = await page.locator(".feedback").first().textContent();
(gridFb || "").startsWith("Correct.") && gridFb.includes("para 4-16") && gridFb.includes("Para 4-15")
  ? ok(`Grid coordinate: correct components (${sq}/${easting}/${northing}, lowercase square accepted) graded "Correct." citing paras 4-15/4-16: "${gridFb}"`)
  : bad(`Grid coordinate correct-answer feedback: "${gridFb}"`);
const gridScore1 = await page.locator(".stat .v").first().textContent();
gridScore1 === "1 / 1" ? ok("Grid coordinate: score tally reads 1 / 1 after a correct submission") : bad("Grid coordinate score after correct: " + JSON.stringify(gridScore1));

// Wrong easting only -> feedback should name exactly the easting as wrong, not the other two correct fields.
const wrongEasting = String(((Number(easting) + 11) % 9000) + 1000);
await eIn.fill(wrongEasting);
await page.locator("button", { hasText: "Check" }).first().click();
await page.waitForTimeout(150);
gridFb = await page.locator(".feedback").first().textContent();
(gridFb || "").includes("Not quite") && gridFb.includes("easting is " + easting) && !gridFb.includes("square identifier is") && !gridFb.includes("northing is")
  ? ok(`Grid coordinate: submitting a wrong easting only is graded "Not quite" and names ONLY the easting (real correct value ${easting}), not the still-correct square/northing`)
  : bad(`Grid coordinate wrong-easting feedback: "${gridFb}"`);
const gridScore2 = await page.locator(".stat .v").first().textContent();
gridScore2 === "1 / 2" ? ok("Grid coordinate: score tally reads 1 / 2 after the wrong-easting submission") : bad("Grid coordinate score after wrong: " + JSON.stringify(gridScore2));

let sawNewGrid = false;
for (let i = 0; i < 6; i++) {
  await page.locator("button", { hasText: "New coordinate →" }).click();
  await page.waitForTimeout(120);
  const nextCombined = (await page.locator(".panel h3").first().textContent()) || "";
  if (nextCombined.trim() !== combined.trim()) { sawNewGrid = true; break; }
}
sawNewGrid
  ? ok('Grid coordinate: "New coordinate →" regenerates a different coordinate (real advance)')
  : bad("Grid coordinate: combined string never changed across 6 clicks of 'New coordinate →'");
const clearedSq = await sqIn.inputValue();
clearedSq === "" ? ok("Grid coordinate: the square-identifier field is empty on a fresh problem") : bad("Grid coordinate square field after New coordinate: " + JSON.stringify(clearedSq));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nLAND NAV DRILL: all passed");
process.exit(fails ? 1 : 0);
