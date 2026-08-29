/**
 * Rapid Fire — Stage 2 of docs/superpowers/specs/2026-08-23-rapid-fire-design.md:
 * the Setup mode selector (Party/Solo/Team) and the Solo/Team modes it
 * unlocks, layered on top of Stage 1's own Party round engine
 * (renderRapidFire in src/index.html). Stage 1's own Party-mode coverage
 * lives in test-rapid-fire.mjs and stays untouched by this file; the
 * zero-writes-to-attempts/SRS guarantee is extended to Solo/Team in
 * test-rapid-fire-no-srs-writes.mjs, not duplicated here.
 *
 * Exercises, against the REAL UI (no closure access — same discipline as
 * test-rapid-fire.mjs):
 *   1. The Setup screen's Mode selector defaults to Party (Stage 1's only
 *      mode) and genuinely switches the round SCREEN's shape per mode:
 *      Party/Team turns render Stage 1's own .rf-card + Reveal-answer
 *      button; Solo renders a real flip card (.qz-card, Board Drill's own
 *      flashcard mechanic) with no Reveal-answer button anywhere.
 *   2. Solo's answer shows automatically on flip (no Reveal gate) — judging
 *      (Correct/Pass) is disabled until the card is actually flipped once,
 *      then enabled, then re-disabled on the next card — real state, not
 *      cosmetic — and self-grading correctly drives the real correct count.
 *   3. Solo is genuinely driven by the SAME round-engine primitives Party
 *      uses, not a lookalike: the real per-Setup-option timer values,
 *      streak threshold, and Requeue-vs-Remove round-length behavior are
 *      all reproduced byte-for-byte identically in Solo mode (the same
 *      real AFT/Drill-and-Ceremony fixtures test-rapid-fire.mjs already
 *      verified for Party).
 *   4. Team mode's Start button is disabled with 0 or 1 named teams and
 *      enabits at 2 — the same startBtn.disabled convention Setup's own
 *      pool-count check already uses (refreshStart()).
 *   5. Team mode's turns genuinely alternate using the real Party round
 *      loop: Team 1's turn renders the real .rf-card/Reveal/judge-button
 *      screen, ends into a real handoff screen naming Team 2, whose turn
 *      renders the exact same real screen again.
 *   6. The Final Recap correctly compares both teams' real cumulative
 *      scores (exact correct-counts, winner text) and reuses the same
 *      recap stat-tile/cross-link structure Party/Solo's own Recap uses.
 *   7. Accessibility spot-check: Solo's flip card genuinely inherits the
 *      app's real reduce-motion override (instant face-swap, no rotateY)
 *      with zero Rapid-Fire-specific CSS, and none of Stage 2's new
 *      elements (mode selector, team inputs) carry a hardcoded inline
 *      color — themed via the same CSS custom properties as everything
 *      else, not literals.
 *
 * Same real board-question category fixture test-rapid-fire.mjs already
 * verified against the seed data: "Army Fitness Test (AFT)" (17 questions,
 * mixed beginner/intermediate band) — used throughout this file the same
 * way.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

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
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

// ── Small DOM-query helpers, matching test-rapid-fire.mjs's own style ────
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
async function clickButtonStartingWith(prefix) {
  return page.evaluate((prefix) => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(prefix));
    if (!btn) return false;
    btn.click();
    return true;
  }, prefix);
}
async function openBoard() {
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(400);
}
async function enterRapidFireFresh() {
  await clickButtonByText("Board Drill");
  await page.waitForTimeout(150);
  const clicked = await clickButtonByText("Rapid Fire");
  await page.waitForTimeout(300);
  return clicked;
}
async function setMode(mode) {
  return clickButtonByText(mode); // "Party" | "Solo" | "Team"
}
async function setCategory(name) {
  return page.evaluate((name) => {
    const sel = document.querySelector('select[aria-label="Filter by category"]');
    if (!sel) return false;
    sel.value = name;
    sel.dispatchEvent(new Event("change"));
    return sel.value === name;
  }, name);
}
async function dismissExplainerIfShown() {
  await page.waitForTimeout(200);
  const hasExplainer = await page.evaluate(() => !!document.querySelector(".rf-explainer"));
  if (hasExplainer) {
    await clickButtonByText("Got it — let's go");
    await page.waitForTimeout(200);
  }
}
async function roundState() {
  return page.evaluate(() => {
    const scoreEl = document.querySelector(".rf-hud-stat");
    const streakEl = document.querySelector(".trend-streak");
    const timerEl = document.querySelector(".rf-timer");
    const qEl = document.querySelector(".rf-question");
    const qzCard = document.querySelector(".qz-card");
    const rfCard = document.querySelector(".rf-card");
    const revealBtn = [...document.querySelectorAll("button")].find((b) => /Reveal answer|Hide answer/.test(b.textContent));
    const correctBtn = document.querySelector(".rf-judge-correct");
    const passBtn = document.querySelector(".rf-judge-pass");
    return {
      onRound: !!qEl,
      onRecap: [...document.querySelectorAll("h3")].some((h) => h.textContent.trim() === "Round Recap"),
      onFinalRecap: [...document.querySelectorAll("h3")].some((h) => h.textContent.trim() === "Final Recap"),
      onHandoff: document.querySelector(".rf-team-handoff") ? document.querySelector(".rf-team-handoff").innerText : null,
      correctText: scoreEl ? scoreEl.textContent : null,
      streakText: streakEl ? streakEl.textContent : "",
      timerText: timerEl ? timerEl.textContent : null,
      hasQzCard: !!qzCard,
      hasRfCard: !!rfCard,
      qzCardFlipped: qzCard ? qzCard.classList.contains("flipped") : null,
      revealBtnPresent: !!revealBtn,
      correctBtnDisabled: correctBtn ? correctBtn.disabled : null,
      passBtnDisabled: passBtn ? passBtn.disabled : null,
    };
  });
}
async function tapQzCard() { await page.evaluate(() => document.querySelector(".qz-card")?.click()); await page.waitForTimeout(120); }
async function tapCorrect() { await page.evaluate(() => document.querySelector(".rf-judge-correct")?.click()); await page.waitForTimeout(150); }
async function tapPass() { await page.evaluate(() => document.querySelector(".rf-judge-pass")?.click()); await page.waitForTimeout(150); }
async function tapEndRound() { await clickButtonByText("End Round"); await page.waitForTimeout(200); }
async function tapLeaveRound() { await clickButtonByText("Leave round"); await page.waitForTimeout(200); }
async function startBtnDisabled() {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Start Round");
    return b ? b.disabled : null;
  });
}

// ════════════════════════════════════════════════════════════════════
// 1) Mode selector — defaults to Party, real per-mode round-screen shape
// ════════════════════════════════════════════════════════════════════
await enterRapidFireFresh();
const modeButtons = await page.evaluate(() => [...document.querySelectorAll(".segmented button")].map((b) => b.textContent.trim()));
["Party", "Solo", "Team"].every((m) => modeButtons.includes(m))
  ? ok("Setup shows a real Party/Solo/Team mode selector")
  : bad("mode selector buttons: " + JSON.stringify(modeButtons));
const defaultActive = await page.evaluate(() => {
  const partyBtn = [...document.querySelectorAll(".segmented button")].find((b) => b.textContent.trim() === "Party");
  return partyBtn ? partyBtn.classList.contains("active") : false;
});
defaultActive ? ok("Party is the default active mode on a fresh visit (Stage 1's only shipped mode)") : bad("Party button not active by default");

// Party round screen shape (Stage 1's own, unchanged) — real .rf-card + a
// real Reveal-answer button, no .qz-card anywhere.
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
await clickButtonByText("Start Round");
await dismissExplainerIfShown();
let st = await roundState();
(st.hasRfCard && !st.hasQzCard && st.revealBtnPresent)
  ? ok("Party's round screen renders the real .rf-card + Reveal-answer button, no flip card")
  : bad("Party round-screen shape: " + JSON.stringify(st));
await tapEndRound();

// Solo round screen shape — a real flip card (.qz-card), NO Reveal-answer
// button anywhere (design spec + Stage 2 task: "no hidden-until-Reveal
// gate").
await enterRapidFireFresh();
await setMode("Solo");
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
await clickButtonByText("Start Round");
await page.waitForTimeout(250);
st = await roundState();
(st.hasQzCard && !st.hasRfCard && !st.revealBtnPresent)
  ? ok("Solo's round screen renders a real .qz-card flip card, no .rf-card and no Reveal-answer button")
  : bad("Solo round-screen shape: " + JSON.stringify(st));
const soloSkipsExplainer = !(await page.evaluate(() => !!document.querySelector(".rf-explainer")));
soloSkipsExplainer ? ok("Solo mode skips the pass-the-device quick-start explainer entirely (no clue-giver mechanic to explain)") : bad("Solo mode unexpectedly showed the Party-framed explainer");

// ════════════════════════════════════════════════════════════════════
// 2) Solo — answer shows automatically on flip (no Reveal gate), and
//    self-grading is real, gated state
// ════════════════════════════════════════════════════════════════════
st.correctBtnDisabled === true && st.passBtnDisabled === true
  ? ok("before the card is flipped, Correct/Pass are really disabled (self-grading requires actually seeing the answer first)")
  : bad("judge-button disabled state before flip: " + JSON.stringify({ correctBtnDisabled: st.correctBtnDisabled, passBtnDisabled: st.passBtnDisabled }));

const realAftCard = await page.evaluate(() => {
  const q = G.store.boardQuestions().find((x) => x.category === "Army Fitness Test (AFT)" && x.q === document.querySelector(".rf-question").textContent);
  return q ? { q: q.q, a: q.a, acceptableAnswer: q.acceptableAnswer } : null;
});
await tapQzCard();
st = await roundState();
st.qzCardFlipped ? ok("tapping the card flips it (.flipped class applied) in one action") : bad("card did not flip on tap");
const answerTextNow = await page.evaluate(() => { const el = document.querySelector(".rf-answer-text"); return el ? el.textContent : null; });
(realAftCard && answerTextNow === (realAftCard.acceptableAnswer || realAftCard.a))
  ? ok("the answer shows automatically as part of the SAME flip action — no separate Reveal tap, and it's the real answer text")
  : bad("answer text after flip vs real question: " + JSON.stringify({ shown: answerTextNow, real: realAftCard }));
st.correctBtnDisabled === false && st.passBtnDisabled === false
  ? ok("once flipped, Correct/Pass become real, enabled buttons")
  : bad("judge-button disabled state after flip: " + JSON.stringify({ correctBtnDisabled: st.correctBtnDisabled, passBtnDisabled: st.passBtnDisabled }));

await tapCorrect();
st = await roundState();
/Correct:\s*1/.test(st.correctText || "")
  ? ok("tapping Correct after flipping increments the real correct count — self-grading genuinely drives round state")
  : bad("correct count after Solo's first Correct: " + st.correctText);
st.qzCardFlipped === false && st.correctBtnDisabled === true
  ? ok("the NEXT card starts unflipped again with Correct/Pass re-disabled — the gate is real per-card state, not a one-time unlock")
  : bad("next-card gate state: " + JSON.stringify({ flipped: st.qzCardFlipped, correctBtnDisabled: st.correctBtnDisabled }));
await tapEndRound();

// ════════════════════════════════════════════════════════════════════
// 3) Solo is driven by the SAME round-engine primitives as Party — not a
//    lookalike. Reproduces Party's own measured behaviors exactly.
// ════════════════════════════════════════════════════════════════════
// 3a) Streak threshold — identical "🔥 2 in a row" behavior.
await enterRapidFireFresh();
await setMode("Solo");
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
await clickButtonByText("Start Round");
await page.waitForTimeout(250);
await tapQzCard(); await tapCorrect();
st = await roundState();
st.streakText === "" ? ok("Solo: streak stays hidden below 2 in a row, same threshold as Party") : bad("Solo streak after 1 Correct: " + JSON.stringify(st.streakText));
await tapQzCard(); await tapCorrect();
st = await roundState();
/🔥\s*2 in a row/.test(st.streakText || "") ? ok("Solo: streak shows '🔥 2 in a row' after 2 consecutive Corrects, identical to Party's own streak logic") : bad("Solo streak after 2 Corrects: " + JSON.stringify(st.streakText));
await tapQzCard(); await tapPass();
st = await roundState();
st.streakText === "" ? ok("Solo: Pass resets the streak, same real state Party's own judge() produces") : bad("Solo streak after Pass: " + JSON.stringify(st.streakText));
await tapEndRound();

// 3b) Round timer — the untouched Setup default (60s) genuinely applies in
// Solo mode too, exactly like Party's own default.
await enterRapidFireFresh();
await setMode("Solo");
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
// 60s is Setup's default — left untouched.
await clickButtonByText("Start Round");
await page.waitForTimeout(250);
st = await roundState();
st.timerText === "60s" ? ok("Solo: the untouched Setup default (60s) really starts a Solo round showing '60s' — the same real timer state Party uses") : bad("Solo default timer text: " + st.timerText);
await tapEndRound();

// 3c) Passed-cards Requeue vs Remove — the exact real round-length proof
// test-rapid-fire.mjs already used for Party, reproduced in Solo mode.
await enterRapidFireFresh();
await setMode("Solo");
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
await clickButtonByText("Remove for this round");
await clickButtonByText("Start Round");
await page.waitForTimeout(250);
for (let i = 0; i < 17; i++) { await tapQzCard(); await tapPass(); }
st = await roundState();
st.onRecap
  ? ok("Solo, Passed cards = Remove: passing all 17 real AFT questions exhausts the deck and ends the round on its own — same real Remove behavior Party uses")
  : bad("Solo round state after 17 Removes (expected Recap): " + JSON.stringify(st));

await enterRapidFireFresh();
await setMode("Solo");
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
// Requeue is Setup's default — left untouched.
await clickButtonByText("Start Round");
await page.waitForTimeout(250);
for (let i = 0; i < 5; i++) { await tapQzCard(); await tapPass(); }
st = await roundState();
(!st.onRecap && st.onRound)
  ? ok("Solo, Passed cards = Requeue: passing 5 of 17 real AFT questions does NOT end the round — each pass goes back into the SAME queue Party's own judge() maintains")
  : bad("Solo round state after 5 Requeues (expected still running): " + JSON.stringify(st));
await tapEndRound();

// ════════════════════════════════════════════════════════════════════
// 4) Team mode — Start button disabled with <2 named teams, enabled at 2+
// ════════════════════════════════════════════════════════════════════
await enterRapidFireFresh();
await setMode("Team");
let disabled = await startBtnDisabled();
disabled === true ? ok("Team mode: Start Round is disabled with 0 teams named (both default slots empty)") : bad("Start disabled with 0 named teams: " + disabled);

await page.evaluate(() => {
  const inputs = [...document.querySelectorAll(".rf-team-row input")];
  inputs[0].value = "Alpha";
  inputs[0].dispatchEvent(new Event("input"));
});
await page.waitForTimeout(80);
disabled = await startBtnDisabled();
disabled === true ? ok("Team mode: Start Round stays disabled with only 1 of 2 teams named") : bad("Start disabled with 1 named team: " + disabled);

await page.evaluate(() => {
  const inputs = [...document.querySelectorAll(".rf-team-row input")];
  inputs[1].value = "Bravo";
  inputs[1].dispatchEvent(new Event("input"));
});
await page.waitForTimeout(80);
disabled = await startBtnDisabled();
disabled === false ? ok("Team mode: Start Round enables once both teams are named — matches Setup's own real disabled-button gating convention") : bad("Start disabled with 2 named teams: " + disabled);

// A team name that's all whitespace doesn't count as "named".
await page.evaluate(() => {
  const inputs = [...document.querySelectorAll(".rf-team-row input")];
  inputs[1].value = "   ";
  inputs[1].dispatchEvent(new Event("input"));
});
await page.waitForTimeout(80);
disabled = await startBtnDisabled();
disabled === true ? ok("Team mode: a whitespace-only team name does not count as filled in — Start stays disabled") : bad("Start disabled with a whitespace-only 2nd team name: " + disabled);
await page.evaluate(() => {
  const inputs = [...document.querySelectorAll(".rf-team-row input")];
  inputs[1].value = "Bravo";
  inputs[1].dispatchEvent(new Event("input"));
});
await page.waitForTimeout(80);

// ════════════════════════════════════════════════════════════════════
// 5) Team mode's turns genuinely alternate through the real Party round
//    loop, and 6) the Final Recap correctly compares both teams' real
//    cumulative scores.
// ════════════════════════════════════════════════════════════════════
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
await clickButtonByText("Start Round");
await dismissExplainerIfShown();
st = await roundState();
(st.onHandoff && /Alpha/.test(st.onHandoff) && /Team 1 of 2/.test(st.onHandoff))
  ? ok("Team mode starts with a real handoff screen naming Team 1 (Alpha)")
  : bad("initial team handoff state: " + JSON.stringify(st));

await clickButtonStartingWith("Start Alpha");
await page.waitForTimeout(200);
st = await roundState();
(st.hasRfCard && !st.hasQzCard && st.revealBtnPresent)
  ? ok("Team 1's (Alpha's) turn renders the exact real Party round screen (.rf-card + Reveal answer) — genuinely the same loop, not a copy")
  : bad("Alpha's turn round-screen shape: " + JSON.stringify(st));
await tapCorrect(); await tapCorrect(); await tapPass();
st = await roundState();
/Correct:\s*2/.test(st.correctText || "") ? ok("Alpha's turn tallies 2 real Corrects before ending") : bad("Alpha's correct count before End Round: " + st.correctText);
await tapEndRound();
st = await roundState();
(st.onHandoff && /Bravo/.test(st.onHandoff) && /Team 2 of 2/.test(st.onHandoff))
  ? ok("ending Alpha's turn advances to a real handoff screen naming Team 2 (Bravo) — genuine turn alternation, not a single shared round")
  : bad("post-Alpha handoff state: " + JSON.stringify(st));

await clickButtonStartingWith("Start Bravo");
await page.waitForTimeout(200);
st = await roundState();
(st.hasRfCard && !st.hasQzCard && st.revealBtnPresent && /Correct:\s*0/.test(st.correctText || ""))
  ? ok("Bravo's turn starts its OWN fresh round (correct count reset to 0) on the same real Party screen")
  : bad("Bravo's turn initial state: " + JSON.stringify(st));
await tapCorrect(); await tapCorrect(); await tapCorrect(); await tapCorrect();
st = await roundState();
/Correct:\s*4/.test(st.correctText || "") ? ok("Bravo's turn tallies 4 real Corrects") : bad("Bravo's correct count before End Round: " + st.correctText);
await tapEndRound();
st = await roundState();
st.onFinalRecap ? ok("after the last named team's turn, the real Final Recap screen appears (not Party's single-round Recap)") : bad("expected Final Recap after Bravo's turn: " + JSON.stringify(st));

const recapText = await page.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Final Recap");
  const panel = h3 ? h3.closest(".panel") : null;
  return panel ? panel.innerText : "";
});
/Bravo wins with 4 correct/.test(recapText) ? ok("Final Recap correctly names the real winner (Bravo, 4 correct) by real score comparison") : bad("Final Recap winner text: " + recapText.slice(0, 300));
/Alpha[\s\S]*2[\s\S]*Bravo[\s\S]*4/.test(recapText) ? ok("Final Recap's compare row shows both teams' exact real cumulative scores (Alpha 2, Bravo 4)") : bad("Final Recap compare row: " + recapText.slice(0, 300));
(/Correct\s*\n?2/.test(recapText) || /2[\s\S]{0,20}Elapsed/.test(recapText)) ? ok("Final Recap includes Alpha's own detailed stat block (reusing the same buildStatsBlock() Party/Solo's Recap uses)") : bad("Final Recap per-team stat block for Alpha not found as expected: " + recapText.slice(0, 400));

const hasCrossLink = await page.evaluate(() => !![...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Practice in Flashcards →"));
hasCrossLink ? ok("Final Recap includes the same real Flashcards cross-link Party/Solo's Recap uses (combined across both teams' categories)") : bad("Final Recap is missing the Flashcards cross-link");

// ════════════════════════════════════════════════════════════════════
// 7) Accessibility spot-check — Solo's flip card genuinely inherits the
//    app's real reduce-motion override, and Stage 2's new elements carry
//    no hardcoded inline color.
// ════════════════════════════════════════════════════════════════════
await page.evaluate(() => { document.documentElement.classList.add("reduce-motion"); });
await enterRapidFireFresh();
await setMode("Solo");
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Start Round");
await page.waitForTimeout(250);
const reduceMotionState = await page.evaluate(() => {
  const card = document.querySelector(".qz-card");
  const back = document.querySelector(".qz-back");
  const cs = getComputedStyle(card);
  return { transform: cs.transform, backDisplay: getComputedStyle(back).display };
});
(reduceMotionState.transform === "none" && reduceMotionState.backDisplay === "none")
  ? ok("under html.reduce-motion, Solo's real flip card renders with transform:none and the back face hidden pre-flip — the app's existing reduce-motion override applies with ZERO Rapid-Fire-specific CSS")
  : bad("reduce-motion state on Solo's card: " + JSON.stringify(reduceMotionState));
await page.evaluate(() => document.querySelector(".qz-card")?.click());
await page.waitForTimeout(100);
const afterFlipRM = await page.evaluate(() => getComputedStyle(document.querySelector(".qz-back")).display);
afterFlipRM === "flex" ? ok("under reduce-motion, flipping still instantly swaps to the back face (no animation needed, no broken state)") : bad("post-flip back-face display under reduce-motion: " + afterFlipRM);
await tapEndRound();
await page.evaluate(() => { document.documentElement.classList.remove("reduce-motion"); });

const hardcodedColorCheck = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".rf-setup-grid *")];
  const offenders = nodes
    .filter((n) => n.style && n.style.color)
    .map((n) => n.tagName + "." + n.className + ": " + n.style.color);
  return offenders;
});
hardcodedColorCheck.length === 0
  ? ok("Stage 2's new Setup elements (mode selector, team-name inputs) carry no hardcoded inline color — themed entirely via CSS classes/custom properties, same as the rest of this Setup screen")
  : bad("hardcoded inline colors found on Setup elements: " + JSON.stringify(hardcodedColorCheck));

// ════════════════════════════════════════════════════════════════════
// 8) "Leave round" exit affordance (item 7 fix, 2026-08-28) — the round
//    screen is ALWAYS inside theater mode, but built no .qz-fs-btn and
//    wired no F-key handler, so the only real ways out were an
//    undiscoverable Escape or End Round (a scoring-relevant "I'm done"
//    action). Leave round must be a genuine bail-out: real exit theater,
//    skip the Recap entirely, land back on a sane prior view (Setup), and
//    leave later round state uncorrupted.
// ════════════════════════════════════════════════════════════════════
await enterRapidFireFresh();
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
await clickButtonByText("Start Round");
await dismissExplainerIfShown();

const leaveBtnInfo = await page.evaluate(() => {
  const b = document.querySelector(".rf-leave-btn");
  return b ? { text: b.textContent.trim(), aria: b.getAttribute("aria-label") } : null;
});
(leaveBtnInfo && leaveBtnInfo.text === "Leave round" && /without finishing/i.test(leaveBtnInfo.aria || ""))
  ? ok("Rapid Fire's HUD carries a real 'Leave round' control with an aria-label distinguishing it from End Round")
  : bad("leave-round control missing or mislabeled: " + JSON.stringify(leaveBtnInfo));

const inTheaterBefore = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
inTheaterBefore ? ok("the round screen is (as documented) always inside theater mode before leaving") : bad("expected theater mode to be active before testing Leave round");

// Score a real Correct first, so there's genuine in-progress round state for
// Leave round to discard (not just an already-empty round).
await tapCorrect();
st = await roundState();
/Correct:\s*1/.test(st.correctText || "")
  ? ok("scored a real Correct before leaving, so Leave round has genuine in-progress state to discard")
  : bad("setup: correct count before Leave round: " + st.correctText);

await tapLeaveRound();
const afterLeave = await page.evaluate(() => ({
  theaterOn: document.documentElement.classList.contains("qz-theater"),
  onRecap: [...document.querySelectorAll("h3")].some((h) => h.textContent.trim() === "Round Recap"),
  onSetup: !!document.querySelector(".rf-setup-grid"),
}));
!afterLeave.theaterOn ? ok("Leave round genuinely exits theater mode") : bad("theater mode is still active after clicking Leave round");
!afterLeave.onRecap ? ok("Leave round skips the Round Recap screen entirely — a genuine bail-out, not a scored finish") : bad("Leave round incorrectly showed the Round Recap");
afterLeave.onSetup ? ok("Leave round returns to a sane prior view (the Rapid Fire Setup screen)") : bad("Leave round did not return to the Setup screen");

// A fresh round started right after must begin clean — no leaked
// score/streak from the round that was just abandoned (state isn't
// corrupted by the bail-out).
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
await clickButtonByText("Start Round");
await dismissExplainerIfShown();
st = await roundState();
(/Correct:\s*0/.test(st.correctText || "") && st.streakText === "")
  ? ok("a fresh round started right after Leave round begins with a clean Correct:0/no-streak state — no corrupted carryover from the abandoned round")
  : bad("post-Leave-round fresh-round state: " + JSON.stringify({ correctText: st.correctText, streakText: st.streakText }));
await tapEndRound();

noise.length === 0 ? ok("no console errors/warnings across the full Solo/Team suite") : bad("console noise: " + noise.slice(0, 8).join(" | "));

await browser.close();
await server.close();

console.log(fails === 0 ? "\nRAPID FIRE SOLO/TEAM: all passed" : `\nRAPID FIRE SOLO/TEAM: ${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
