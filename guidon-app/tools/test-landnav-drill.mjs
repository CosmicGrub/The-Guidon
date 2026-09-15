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

// v1.9.0 discoverability pass: the card itself carries a "New" badge (same
// DRILLS.since convention as the "Grid plot" mode button below) so a
// Soldier browsing #/drills sees the grid-plotting addition before ever
// opening the drill - checked here separately from the mode-switch badge.
const landnavCardInfo = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Land Navigation practice drill/.test(b.textContent || ""));
  return btn ? { ariaLabel: btn.getAttribute("aria-label"), badgeText: btn.querySelector(".badge.green")?.textContent || null } : null;
});
landnavCardInfo && landnavCardInfo.ariaLabel === "Land Navigation practice drill (New)" && landnavCardInfo.badgeText === "New"
  ? ok('the #/drills menu card itself carries a "New" badge (accessible name "...(New)", visible .badge.green "New")')
  : bad("Land Navigation menu card New-badge info: " + JSON.stringify(landnavCardInfo));

await openLandNavDrill();
// aria-label, not textContent: "Grid plot" carries a visible "New" badge as
// a child node (v1.9.0, same discoverability convention as THEMES' own
// `since` field in theme.js), so its real textContent is now "Grid plotNew"
// - the accessible name is the exact, stable signal for what each button
// IS, independent of that visible-but-decorative badge markup.
const modeButtons = await page.locator(".panel .segmented button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
JSON.stringify(modeButtons.slice(0, 3)) === JSON.stringify(["Back azimuth", "Pace count", "Grid coordinate"])
  ? ok('Land Navigation drill opens on the three-mode switch: "Back azimuth" / "Pace count" / "Grid coordinate"')
  : bad("mode switch buttons: " + JSON.stringify(modeButtons));
modeButtons[3] === "Grid plot (New)"
  ? ok('a 4th mode, "Grid plot", is present alongside the original three, marked "(New)" in its accessible name')
  : bad("4th mode button: " + JSON.stringify(modeButtons[3]));
const plotBadge = await page.locator(".segmented button", { hasText: "Grid plot" }).locator(".badge.green").textContent();
plotBadge === "New"
  ? ok('the "Grid plot" mode button carries a visible "New" badge (.badge.green, reusing the theme wall\'s own component)')
  : bad('Grid plot "New" badge: ' + JSON.stringify(plotBadge));

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

// "Add persistence to the memory-less drills" pass: scoreRow()'s new
// lifetime hint (src/index.html) - unlike the session tally just above
// (reset to 0/0 by the deg<->mils unit switch), this accumulates across
// BOTH unit formats since they're the same underlying skill. By this
// point the deg phase went 1 right / 2 attempts and the mils phase just
// went 1 right / 1 attempt - 2/3 lifetime, 67%.
const azLifeHint = await page.locator(".panel p.hint").filter({ hasText: /Lifetime:/ }).first().textContent();
azLifeHint === "Lifetime: 67% (2/3)"
  ? ok('Back azimuth: lifetime hint accumulates across the deg/mils unit switch ("Lifetime: 67% (2/3)")')
  : bad("Back azimuth lifetime hint: " + JSON.stringify(azLifeHint));
const azLifePersisted = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "guidon:drills:v1");
  return r && r.v && r.v.landnav ? r.v.landnav.azimuth : null;
});
azLifePersisted && azLifePersisted.attempts === 3 && azLifePersisted.right === 2
  ? ok('Back azimuth lifetime score persists to kv "guidon:drills:v1" (landnav.azimuth: {attempts:3, right:2})')
  : bad("Back azimuth persisted lifetime score: " + JSON.stringify(azLifePersisted));

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

const paceLifeHint = await page.locator(".panel p.hint").filter({ hasText: /Lifetime:/ }).first().textContent();
paceLifeHint === "Lifetime: 50% (1/2)"
  ? ok('Pace count: lifetime hint reads "Lifetime: 50% (1/2)" (its own bucket, unaffected by azimuth mode above)')
  : bad("Pace count lifetime hint: " + JSON.stringify(paceLifeHint));
const paceLifePersisted = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "guidon:drills:v1");
  return r && r.v && r.v.landnav ? r.v.landnav.pace : null;
});
paceLifePersisted && paceLifePersisted.attempts === 2 && paceLifePersisted.right === 1
  ? ok('Pace count lifetime score persists to kv "guidon:drills:v1" (landnav.pace: {attempts:2, right:1}), separate from landnav.azimuth')
  : bad("Pace count persisted lifetime score: " + JSON.stringify(paceLifePersisted));

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

const gridLifeHint = await page.locator(".panel p.hint").filter({ hasText: /Lifetime:/ }).first().textContent();
gridLifeHint === "Lifetime: 50% (1/2)"
  ? ok('Grid coordinate: lifetime hint reads "Lifetime: 50% (1/2)" (its own bucket)')
  : bad("Grid coordinate lifetime hint: " + JSON.stringify(gridLifeHint));
const gridLifePersisted = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "guidon:drills:v1");
  return r && r.v && r.v.landnav ? r.v.landnav.grid : null;
});
gridLifePersisted && gridLifePersisted.attempts === 2 && gridLifePersisted.right === 1
  ? ok('Grid coordinate lifetime score persists to kv "guidon:drills:v1" (landnav.grid: {attempts:2, right:1})')
  : bad("Grid coordinate persisted lifetime score: " + JSON.stringify(gridLifePersisted));

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

// ==================== (d) Grid plot: the app's first real click-to-plot spatial interaction ====================
// Casualty-care-and-cohesion design pass (docs/design/casualty-care-and-
// cohesion.md §2b, "Land-nav-plot" item): gridMode() above only ever
// asks a Soldier to decompose a GIVEN coordinate string into parts -
// this is the first mode that asks anyone to actually place a point on
// something, or read one off. Real click math (getScreenCTM().inverse())
// against the live SVG, real distance-in-meters grading (not exact-pixel
// match), and a full keyboard-only path (typed Easting/Northing) as the
// accessible equivalent to clicking - verified independently below.
await page.locator(".segmented button", { hasText: "Grid plot" }).click();
await page.waitForTimeout(200);

const plotSubModes = await page.locator(".panel .segmented button").allTextContents();
JSON.stringify(plotSubModes.slice(-2)) === JSON.stringify(["Plot a point", "Read a point"])
  ? ok('Grid plot opens with a "Plot a point" / "Read a point" sub-toggle, defaulting to Plot')
  : bad("plot sub-mode buttons: " + JSON.stringify(plotSubModes));

const svgInfo = await page.evaluate(() => {
  const svg = document.querySelector('svg[role="img"]');
  return svg ? { viewBox: svg.getAttribute("viewBox"), lineCount: svg.querySelectorAll("line").length } : null;
});
svgInfo && svgInfo.viewBox === "0 0 1000 1000" && svgInfo.lineCount === 22
  ? ok("Grid plot renders a real SVG grid: viewBox 0 0 1000 1000, 22 gridlines (11 vertical + 11 horizontal at 100m spacing)")
  : bad("Grid plot SVG: " + JSON.stringify(svgInfo));

async function readPlotHint() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".panel p.hint")).map((p) => p.textContent).find((t) => /Plot this point|Read the marked point/.test(t || "")) || ""
  );
}
let plotHint = await readPlotHint();
let mPlot = /Easting (\d+)m, Northing (\d+)m/.exec(plotHint);
mPlot ? ok(`Plot-a-point states a real target coordinate: "${plotHint}"`) : bad("could not parse plot target from hint: " + plotHint);
let [, tx, ty] = mPlot || [, "0", "0"];
tx = Number(tx); ty = Number(ty);

// Click exactly at the target - real getScreenCTM()-based coordinate math should land within a few meters (pixel rounding only).
// Use a locator with a position offset (not raw page.mouse.click at absolute
// viewport coordinates): the panel sits well down the page, so for low-
// northing targets the naive rect-based screen point can fall below the
// unscrolled 720px viewport and silently miss. locator.click({position})
// scrolls the element into view first, then clicks relative to ITS OWN
// freshly-measured box - immune to that.
const PX_SIZE = 320; // matches plotMode()'s own on-screen SVG size (PX const)
await page.locator('svg[role="img"]').click({ position: { x: (tx / 1000) * PX_SIZE, y: ((1000 - ty) / 1000) * PX_SIZE } });
await page.waitForTimeout(150);
const afterClick = await page.evaluate(() => ({
  eVal: Number(document.querySelector('input[aria-label*="Easting"]')?.value),
  nVal: Number(document.querySelector('input[aria-label*="Northing"]')?.value),
  markerCount: document.querySelectorAll("[data-marker]").length,
}));
(Math.abs(afterClick.eVal - tx) <= 15 && Math.abs(afterClick.nVal - ty) <= 15)
  ? ok(`clicking the SVG at the target populates the Easting/Northing inputs via real getScreenCTM() math (clicked (${afterClick.eVal}, ${afterClick.nVal}) vs target (${tx}, ${ty}))`)
  : bad(`click-to-coordinate math off: got (${afterClick.eVal}, ${afterClick.nVal}), target (${tx}, ${ty})`);
afterClick.markerCount === 1
  ? ok("exactly 1 marker shown after clicking - the guess only, target not revealed before Check")
  : bad("marker count after click (pre-Check): " + afterClick.markerCount);

await page.locator("button", { hasText: "Check" }).first().click();
await page.waitForTimeout(150);
const plotCheck = await page.evaluate(() => ({
  feedback: document.querySelector(".feedback")?.textContent,
  cls: document.querySelector(".feedback")?.className,
  markerCount: document.querySelectorAll("[data-marker]").length,
  score: document.querySelector(".stat .v")?.textContent,
}));
/^Correct — within \d+m of the real point/.test(plotCheck.feedback || "") && (plotCheck.cls || "").includes("good")
  ? ok(`a click within tolerance is graded "Correct" with a real distance-in-meters figure: "${plotCheck.feedback}"`)
  : bad(`plot correct-click feedback: "${plotCheck.feedback}" (class: ${plotCheck.cls})`);
plotCheck.markerCount === 2
  ? ok("both the target and the guess are marked on the grid after Check, for visual comparison")
  : bad("marker count after Check: " + plotCheck.markerCount);
plotCheck.score === "1 / 1" ? ok("Grid plot: score tally reads 1 / 1 after a correct plot") : bad("Grid plot score: " + JSON.stringify(plotCheck.score));

// A deliberately-wrong plot (typed, not clicked) must report a real miss-distance, not just "wrong".
await page.locator("button", { hasText: "New point →" }).click();
await page.waitForTimeout(150);
plotHint = await readPlotHint();
mPlot = /Easting (\d+)m, Northing (\d+)m/.exec(plotHint);
[, tx, ty] = mPlot || [, "0", "0"]; tx = Number(tx); ty = Number(ty);
const farE = tx > 500 ? tx - 300 : tx + 300, farN = ty > 500 ? ty - 300 : ty + 300;
await page.fill('input[aria-label*="Easting"]', String(farE));
await page.fill('input[aria-label*="Northing"]', String(farN));
await page.locator("button", { hasText: "Check" }).first().click();
await page.waitForTimeout(150);
const wrongPlot = await page.evaluate(() => ({ feedback: document.querySelector(".feedback")?.textContent, cls: document.querySelector(".feedback")?.className }));
const expectedDist = Math.round(Math.hypot(farE - tx, farN - ty));
(wrongPlot.feedback || "").includes(`Off by ${expectedDist}m`) && (wrongPlot.cls || "").includes("bad")
  ? ok(`a wrong plot (typed, no click) reports the real miss-distance: "${wrongPlot.feedback}"`)
  : bad(`plot wrong-answer feedback: "${wrongPlot.feedback}" (expected ~${expectedDist}m off)`);
const plotScore2 = await page.locator(".stat .v").first().textContent();
plotScore2 === "1 / 2" ? ok("Grid plot: score tally reads 1 / 2 after the wrong plot") : bad("Grid plot score after wrong: " + JSON.stringify(plotScore2));

const plotLifeHint = await page.locator(".panel p.hint").filter({ hasText: /Lifetime:/ }).first().textContent();
plotLifeHint === "Lifetime: 50% (1/2)"
  ? ok('Grid plot: lifetime hint reads "Lifetime: 50% (1/2)" (its own bucket, unaffected by azimuth/pace/grid above)')
  : bad("Grid plot lifetime hint: " + JSON.stringify(plotLifeHint));
const plotLifePersisted = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "guidon:drills:v1");
  return r && r.v && r.v.landnav ? r.v.landnav.plot : null;
});
plotLifePersisted && plotLifePersisted.attempts === 2 && plotLifePersisted.right === 1
  ? ok('Grid plot lifetime score persists to kv "guidon:drills:v1" (landnav.plot: {attempts:2, right:1})')
  : bad("Grid plot persisted lifetime score: " + JSON.stringify(plotLifePersisted));

// Read-a-point: a marked point is shown up front (this is the genuinely
// visual half of this mode), and it's answerable purely by keyboard -
// typing Easting/Northing and pressing Enter, never touching the SVG.
await page.locator(".segmented button", { hasText: "Read a point" }).click();
await page.waitForTimeout(200);
const readState = await page.evaluate(() => ({ markerCount: document.querySelectorAll("[data-marker]").length }));
readState.markerCount === 1
  ? ok("Read-a-point shows exactly 1 marker (the point to read) immediately, before any answer")
  : bad("Read-a-point marker count before answering: " + readState.markerCount);
plotHint = await readPlotHint();
/Read the marked point below/.test(plotHint)
  ? ok('Read-a-point prompt text: "' + plotHint + '"')
  : bad("Read-a-point hint text: " + plotHint);
// Read the real marked point straight off the SVG (cx, and cy inverted
// per toSvgY()'s SIZE - m flip) so the guess below can be a DETERMINISTIC
// miss, rather than gambling on a fixed guess happening to land within
// 50m of an independently-random target.
const readTarget = await page.evaluate(() => {
  const c = document.querySelector("[data-marker]");
  return c ? { x: Number(c.getAttribute("cx")), y: 1000 - Number(c.getAttribute("cy")) } : null;
});
const readGuessE = readTarget.x > 500 ? readTarget.x - 300 : readTarget.x + 300;
const readGuessN = readTarget.y > 500 ? readTarget.y - 300 : readTarget.y + 300;
await page.fill('input[aria-label*="easting"]', String(readGuessE));
await page.fill('input[aria-label*="northing"]', String(readGuessN));
await page.keyboard.press("Enter"); // Enter-to-submit, no click anywhere in this whole sub-mode
await page.waitForTimeout(150);
const readFb = await page.evaluate(() => document.querySelector(".feedback")?.textContent || "");
const readExpectedDist = Math.round(Math.hypot(readGuessE - readTarget.x, readGuessN - readTarget.y));
readFb.includes(`Off by ${readExpectedDist}m`)
  ? ok(`Read-a-point is fully keyboard-operable end to end (typed inputs + Enter, no click), reporting the real miss-distance: "${readFb}"`)
  : bad(`Read-a-point keyboard-only check: "${readFb}" (expected ~${readExpectedDist}m off, target was (${readTarget.x}, ${readTarget.y}))`);

// All four lifetime scores must survive a REAL reload (a fresh page
// load, not just an in-app re-render) - the same bar test-baseline-
// coverage.mjs already holds citDrill()/briefDrill()'s own persistence to.
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
await dismissOnboarding(page);
await page.waitForTimeout(300);
await openLandNavDrill();
const azLifeAfterReload = await page.locator(".panel p.hint").filter({ hasText: /Lifetime:/ }).first().textContent();
azLifeAfterReload === "Lifetime: 67% (2/3)"
  ? ok("Back azimuth lifetime score survives a real page reload (67% (2/3))")
  : bad("Back azimuth lifetime hint after reload: " + JSON.stringify(azLifeAfterReload));
await page.locator(".segmented button", { hasText: "Pace count" }).click();
await page.waitForTimeout(200);
const paceLifeAfterReload = await page.locator(".panel p.hint").filter({ hasText: /Lifetime:/ }).first().textContent();
paceLifeAfterReload === "Lifetime: 50% (1/2)"
  ? ok("Pace count lifetime score survives a real page reload (50% (1/2))")
  : bad("Pace count lifetime hint after reload: " + JSON.stringify(paceLifeAfterReload));
await page.locator(".segmented button", { hasText: "Grid coordinate" }).click();
await page.waitForTimeout(200);
const gridLifeAfterReload = await page.locator(".panel p.hint").filter({ hasText: /Lifetime:/ }).first().textContent();
gridLifeAfterReload === "Lifetime: 50% (1/2)"
  ? ok("Grid coordinate lifetime score survives a real page reload (50% (1/2))")
  : bad("Grid coordinate lifetime hint after reload: " + JSON.stringify(gridLifeAfterReload));
await page.locator(".segmented button", { hasText: "Grid plot" }).click();
await page.waitForTimeout(200);
const plotLifeAfterReload = await page.locator(".panel p.hint").filter({ hasText: /Lifetime:/ }).first().textContent();
// 1/2 from the plot-mode checks above, plus the Read-a-point keyboard-only
// submission (a fixed 500/500 guess against a random target, almost always
// a miss) = 3 attempts, 1 right.
plotLifeAfterReload === "Lifetime: 33% (1/3)"
  ? ok("Grid plot lifetime score survives a real page reload (33% (1/3))")
  : bad("Grid plot lifetime hint after reload: " + JSON.stringify(plotLifeAfterReload));

// cleanup so this drill's saved lifetime scores don't bleed into another suite
await page.evaluate(() => window.G.db.put("kv", { k: "guidon:drills:v1", v: {} }));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nLAND NAV DRILL: all passed");
process.exit(fails ? 1 : 0);
