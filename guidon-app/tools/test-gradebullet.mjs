/**
 * Roadmap audit round 5, "Test Coverage Gaps" bucket: gradeBullet(text, cfg)
 * (js "writing.js" section of src/index.html, #/write's Bullet Builder tab)
 * is a pure, deterministic 7-check bullet-strength grader. The comment right
 * after its definition reads "expose for tests + reuse" and assigns it to
 * G.writing.gradeBullet specifically so it can be driven directly - but
 * grepping every test file in tools/ for "gradeBullet" or "G.writing"
 * before writing this returned nothing. This exercises the function itself
 * (window.G.writing.gradeBullet, no DOM needed) across its four real bands
 * - empty/weak-opener/long-but-otherwise-clean/strong - and then proves the
 * live Bullet Builder textarea's on-screen score/band actually come from
 * this same function rather than some parallel/stale scoring path.
 *
 * cfg values (weakVerbs/bannedWords) are read from the app's own real seed
 * data (GUIDON_SEED.writing.bullet), confirmed by grepping the embedded
 * JSON before picking test strings: weakVerbs includes "was"/"were"/
 * "helped"/"responsible"/etc; bannedWords includes "good job"/"various"/
 * "successfully"/etc.
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

async function grade(text) {
  return page.evaluate((t) => window.G.writing.gradeBullet(t), text);
}

// ==================== 1) Empty string -> band "empty", score 0 ====================
const empty = await grade("");
empty.score === 0 ? ok("empty bullet scores 0") : bad("empty bullet score: " + JSON.stringify(empty.score));
empty.band === "empty" ? ok("empty bullet bands as 'empty'") : bad("empty bullet band: " + JSON.stringify(empty.band));

// ==================== 2) Strong bullet: verb + number + result cue, no banned words, no first person, concise ====================
const STRONG_TEXT = "Trained 24 Soldiers on M4 qualification standards; increased first-time GO rate from 68% to 94%.";
const strong = await grade(STRONG_TEXT);
strong.band === "strong" ? ok("a bullet with a strong verb, quantified impact and a result clause bands as 'strong'") : bad("strong-bullet band: " + JSON.stringify(strong.band) + " (score " + strong.score + ")");
strong.checks.every((c) => c.pass) ? ok("every individual check passes for the strong bullet (verb/quant/result/filler/person/concise)") : bad("strong bullet failing checks: " + JSON.stringify(strong.checks.filter((c) => !c.pass)));

// ==================== 3) Weak-opener bullet: verb check fails with the real weak-opener detail text ====================
const weakOpener = await grade("Was responsible for maintaining 15 vehicles in the motor pool.");
const verbCheck = weakOpener.checks.find((c) => c.id === "verb");
verbCheck && verbCheck.pass === false ? ok("a bullet opening on a weak verb ('Was') fails the 'verb' check") : bad("verb check on weak-opener bullet: " + JSON.stringify(verbCheck));
verbCheck && verbCheck.detail === "“was” is a weak opener — lead with a strong past-tense verb."
  ? ok("the failing 'verb' check shows the exact weak-opener detail text naming the offending word")
  : bad("weak-opener detail text: " + JSON.stringify(verbCheck && verbCheck.detail));

// ==================== 4) Long bullet (>22 words): fails ONLY the "concise" check ====================
const LONG_TEXT = "Trained and mentored 30 new Soldiers arriving to the unit each month on weapons qualification standards and physical fitness requirements, resulting in a significant 40% increase in first-time GO pass rates across the battalion.";
const long = await grade(LONG_TEXT);
long.wordCount > 22 ? ok("the long-bullet fixture is actually over the 22-word concise threshold (" + long.wordCount + " words)") : bad("long-bullet fixture word count too low: " + long.wordCount);
const conciseCheck = long.checks.find((c) => c.id === "concise");
conciseCheck && conciseCheck.pass === false ? ok("the long bullet fails the 'concise' check") : bad("concise check on long bullet: " + JSON.stringify(conciseCheck));
conciseCheck && conciseCheck.detail === long.wordCount + " words — tighten it or split into two bullets."
  ? ok("the failing 'concise' check reports the exact word count in its detail text")
  : bad("concise detail text: " + JSON.stringify(conciseCheck && conciseCheck.detail));
const otherChecksAllPass = long.checks.filter((c) => c.id !== "concise").every((c) => c.pass);
otherChecksAllPass
  ? ok("every OTHER check (verb/quant/result/filler/person) still passes - only 'concise' fails on this bullet")
  : bad("long bullet has unexpected extra failing checks: " + JSON.stringify(long.checks.filter((c) => c.id !== "concise" && !c.pass)));

// ==================== 5) UI-level: the Bullet Builder textarea's live score/band match gradeBullet()'s own return ====================
await page.evaluate(() => { location.hash = "#/write"; });
await page.waitForTimeout(400);
// "bullet" is the module's own default activeTab (renderBullet), so no tab
// click is needed - confirmed by reading render()'s tabbar setup.
const bulletTa = page.locator("textarea.wr-bullet-input");
await bulletTa.waitFor({ state: "visible", timeout: 5000 });
await bulletTa.fill(STRONG_TEXT);
// paint() is debounced 80ms after the "input" event (see renderBullet's own
// `let deb=null; ta.addEventListener("input", ()=>{clearTimeout(deb); deb=
// setTimeout(paint,80);})`) - wait comfortably past that before reading the
// on-screen score/band.
await page.waitForTimeout(300);

const onScreenScore = await page.locator(".wr-score-num").textContent();
const onScreenBandClass = await page.locator(".wr-score-ring").getAttribute("class");
const expected = await grade(STRONG_TEXT);
onScreenScore === String(expected.score)
  ? ok("typing the strong bullet into the live textarea shows the exact score gradeBullet() itself returns (" + expected.score + ")")
  : bad("on-screen score: " + JSON.stringify(onScreenScore) + ", gradeBullet() score: " + expected.score);
(onScreenBandClass || "").includes("band-" + expected.band)
  ? ok("the live score ring's band class matches gradeBullet()'s own band ('" + expected.band + "')")
  : bad("on-screen band class: " + JSON.stringify(onScreenBandClass) + ", gradeBullet() band: " + expected.band);

// Type the weak-opener bullet next and confirm the live UI swaps to match
// ITS band too - not just that the strong case happened to already agree.
await bulletTa.fill("Was responsible for maintaining 15 vehicles in the motor pool.");
await page.waitForTimeout(300);
const onScreenScore2 = await page.locator(".wr-score-num").textContent();
const onScreenBandClass2 = await page.locator(".wr-score-ring").getAttribute("class");
const expected2 = weakOpener;
onScreenScore2 === String(expected2.score)
  ? ok("typing the weak-opener bullet updates the live score to match gradeBullet() again (" + expected2.score + ")")
  : bad("on-screen score after weak-opener bullet: " + JSON.stringify(onScreenScore2) + ", gradeBullet() score: " + expected2.score);
(onScreenBandClass2 || "").includes("band-" + expected2.band)
  ? ok("the live score ring's band class updates to match gradeBullet()'s band for the weak-opener bullet ('" + expected2.band + "')")
  : bad("on-screen band class after weak-opener bullet: " + JSON.stringify(onScreenBandClass2) + ", gradeBullet() band: " + expected2.band);

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nGRADEBULLET: all passed");
process.exit(fails ? 1 : 0);
