/**
 * Rapid Fire — Team mode's "Handoff Steal Round" mechanic (src/index.html,
 * renderRapidFire's beginTeamMode/advanceToNextTeam/drawStealOffer/
 * stealableCardsFrom/mergeStealIntoTurn), the "steal" idea deliberately
 * deferred at Stage 2 (docs/superpowers/specs/2026-08-23-rapid-fire-design.md,
 * "Deferred to a later pass... a Team 'steal' mechanic - if Team A passes,
 * Team B gets a shot at the same card before moving on"). Chosen after an
 * adversarially-judged comparison against 3 alternatives (a real-time
 * mid-turn freeze, a pooled end-of-game shout-it-out finale, and a
 * scoreless read-only digest) specifically because it needs ZERO changes
 * inside beginRound/judge/advance/finishRound - the steal round is just a
 * second, ordinary beginRound(smallerPool, "party", {onFinish}) call
 * reusing the same onFinish seam Team mode already chains its own turns
 * through.
 *
 * tools/test-rapid-fire-solo-team.mjs and tools/test-rapid-fire-
 * no-srs-writes.mjs both already exercise a Team match that happens to
 * include a Pass (and were updated to Skip the resulting steal offer so
 * their OWN, unrelated assertions keep exercising the baseline flow
 * unaffected by this feature) - this file is the real, dedicated coverage
 * for the mechanic itself:
 *
 *  1. A team that passed on N real cards genuinely offers the NEXT team a
 *     "Steal chance!" naming the real count, instead of a plain handoff.
 *  2. Accepting Steal plays a real mini-round over EXACTLY those N passed
 *     cards (same content, no others, no re-shuffle-in of the wrong deck),
 *     and its outcome (correctCount/points) genuinely folds into the
 *     stealing team's own upcoming turn - summed into the SAME Final
 *     Recap tile Party/Solo/every other Team turn already uses, not shown
 *     as a separate recap - and a stolen correct answer genuinely counts
 *     toward who wins (not just decorative points).
 *  3. Skip declines cleanly: no merge, no steal-bonus flavor line, the
 *     declined-on cards are gone for good (not retained for a later team).
 *  4. Zero passes from the previous team means a plain handoff, not an
 *     offer with "0 cards" - the feature is fully invisible when unearned.
 *  5. The very first team is never offered a steal (nobody played before
 *     them) - the accepted, named asymmetry this design's own trade-offs
 *     section calls out.
 *  6. The three-team chain: a card ACCEPTED-then-re-passed during one
 *     team's own steal round correctly flows forward into the NEXT team's
 *     own offer (mergeStealIntoTurn's passTally union is what makes this
 *     work) - and the LAST team's own passes are never offered to anyone
 *     (the game ends straight to the Final Recap instead).
 *  7. MAX_STEAL_CARDS caps an offer at 8 cards even when more were passed.
 *
 * Same real board-question category fixture every other Rapid Fire test
 * file already uses: "Army Fitness Test (AFT)" (17 questions). "Remove for
 * this round" (not the Requeue default) is used throughout this file
 * specifically so N sequential Pass taps always produce N DISTINCT
 * passTally entries — Requeue could show the same still-open card again
 * before a fixed-count loop finishes, which would make the exact "how many
 * cards got passed" counts this file asserts on non-deterministic.
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

// ── Helpers, same shapes as tools/test-rapid-fire-solo-team.mjs ──────────
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
async function enterRapidFireFresh() {
  await clickButtonByText("Board Drill");
  await page.waitForTimeout(150);
  const clicked = await clickButtonByText("Rapid Fire");
  await page.waitForFunction(
    () => [...document.querySelectorAll(".rf-mode-seg button")].some((b) => b.textContent.trim() === "Party"),
    { timeout: 30000 }
  ).catch(() => {});
  return clicked;
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
  if (hasExplainer) { await clickButtonByText("Got it — let's go"); await page.waitForTimeout(200); }
}
async function currentQuestionText() {
  return page.evaluate(() => document.querySelector(".rf-question")?.textContent || null);
}
async function tapCorrect() { await page.evaluate(() => document.querySelector(".rf-judge-correct")?.click()); await page.waitForTimeout(150); }
async function tapPass() { await page.evaluate(() => document.querySelector(".rf-judge-pass")?.click()); await page.waitForTimeout(150); }
async function tapEndRound() { await clickButtonByText("End Round"); await page.waitForTimeout(200); }
async function passNDistinct(n) {
  // Requires "Remove for this round" so each Pass consumes a distinct card.
  const passed = [];
  for (let i = 0; i < n; i++) {
    passed.push(await currentQuestionText());
    await tapPass();
  }
  return passed;
}
// Same as passNDistinct, but skips (Corrects, so it's still consumed from
// this round's Remove-mode queue without adding a passTally entry) any
// card matching excludeText - used where a test needs to GUARANTEE a
// specific earlier card is never accidentally re-passed this round, since
// a real shuffled queue drawing from the same fixed category pool could
// otherwise coincidentally redraw it (a real, measured ~47% chance with
// AFT's 17-question pool at n=8 - confirmed this exact test was NOT
// discriminating its own regression before this fix, passing whether or
// not the bug it was written to catch was present).
async function passNDistinctExcluding(n, excludeText) {
  const passed = [];
  while (passed.length < n) {
    const q = await currentQuestionText();
    if (q === excludeText) { await tapCorrect(); continue; }
    passed.push(q);
    await tapPass();
  }
  return passed;
}
async function screenState() {
  return page.evaluate(() => {
    const handoffEl = document.querySelector(".rf-team-handoff");
    return {
      onHandoff: handoffEl ? handoffEl.innerText : null,
      onFinalRecap: [...document.querySelectorAll("h3")].some((h) => h.textContent.trim() === "Final Recap"),
      hasRfCard: !!document.querySelector(".rf-card"),
      correctText: document.querySelector(".rf-hud-stat")?.textContent || null,
      question: document.querySelector(".rf-question")?.textContent || null,
    };
  });
}
async function finalRecapText() {
  return page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Final Recap");
    const panel = h3 ? h3.closest(".panel") : null;
    return panel ? panel.innerText : "";
  });
}
async function setupTeamMatch(teamNames) {
  await enterRapidFireFresh();
  const teamClicked = await clickButtonByText("Team");
  if (!teamClicked) throw new Error("Rapid Fire Team mode button was not available");
  await page.waitForFunction(
    () => document.querySelectorAll(".rf-team-row input").length >= 2,
    { timeout: 30000 }
  );
  // The Setup screen ships exactly 2 team-name rows by default; add more
  // via the real "+ Add team" control for a 3+-team match (spec: "2+ named
  // teams", cfg.teams.push("") on click - see src/index.html).
  for (let i = 2; i < teamNames.length; i++) {
    const added = await clickButtonByText("+ Add team");
    if (!added) throw new Error("Rapid Fire + Add team control was not available");
    await page.waitForFunction(
      (count) => document.querySelectorAll(".rf-team-row input").length >= count,
      teamNames.length,
      { timeout: 30000 }
    );
  }
  await page.waitForFunction(
    (count) => document.querySelectorAll(".rf-team-row input").length >= count,
    teamNames.length,
    { timeout: 30000 }
  );
  await page.evaluate((names) => {
    const inputs = [...document.querySelectorAll(".rf-team-row input")];
    if (inputs.length < names.length) throw new Error(`Expected ${names.length} team inputs, found ${inputs.length}`);
    names.forEach((name, i) => { inputs[i].value = name; inputs[i].dispatchEvent(new Event("input")); });
  }, teamNames);
  await page.waitForTimeout(80);
  await setCategory("Army Fitness Test (AFT)");
  await clickButtonByText("All difficulties");
  await clickButtonByText("Untimed");
  await clickButtonByText("Remove for this round");
  await clickButtonByText("Start Round");
  await dismissExplainerIfShown();
}

/* ========================================================================
   1/2) A real Pass count offers a real Steal, and an ACCEPTED steal plays
   exactly those cards and folds its outcome into the recap correctly.
   ======================================================================== */
await setupTeamMatch(["Alpha", "Bravo"]);
let st = await screenState();
(st.onHandoff && !/steal/i.test(st.onHandoff))
  ? ok("The very first team (Alpha) is never offered a steal - a plain handoff, nobody played before them")
  : bad("Alpha's initial handoff unexpectedly mentions a steal: " + JSON.stringify(st));

await clickButtonStartingWith("Start Alpha");
await page.waitForTimeout(200);
const alphaPassed = await passNDistinct(3);
await tapCorrect(); await tapCorrect(); // Alpha: 2 correct, 3 passed (distinct, Remove mode)
st = await screenState();
/Correct:\s*2/.test(st.correctText || "") ? ok("Alpha racked up 2 real Corrects alongside the 3 Passes") : bad("Alpha's correct count: " + st.correctText);
await tapEndRound();

st = await screenState();
(st.onHandoff && /steal chance/i.test(st.onHandoff) && /3 cards/i.test(st.onHandoff))
  ? ok('Alpha\'s 3 real Passes correctly offer Bravo a "Steal chance!" naming the real count (3 cards)')
  : bad("expected a 3-card steal offer for Bravo: " + JSON.stringify(st));

await clickButtonByText("Steal! (3 cards)");
await page.waitForTimeout(250);
st = await screenState();
st.hasRfCard ? ok("Accepting Steal starts a real round screen (.rf-card), not another handoff") : bad("steal round did not start a real card screen: " + JSON.stringify(st));

// Play the 3-card steal round: verify each shown question is genuinely one
// of Alpha's 3 real passed cards (not a re-shuffle of the wrong deck), then
// answer all 3 correctly so it ends naturally (deck exhausted -> finishRound()
// via advance()'s own "!current -> finishRound()" path, same as any round).
const stealSeen = [];
for (let i = 0; i < 3; i++) {
  const q = await currentQuestionText();
  stealSeen.push(q);
  await tapCorrect();
}
const stealMatchesPassed = stealSeen.every((q) => alphaPassed.includes(q)) && new Set(stealSeen).size === 3;
stealMatchesPassed
  ? ok("The steal round showed exactly Alpha's 3 real passed cards, no others, no duplicates: " + JSON.stringify(stealSeen.map((q) => q.slice(0, 30))))
  : bad("steal round cards did not match Alpha's real passes: shown=" + JSON.stringify(stealSeen) + " passed=" + JSON.stringify(alphaPassed));

await page.waitForTimeout(200);
st = await screenState();
(st.onHandoff && /Bravo/.test(st.onHandoff) && !/steal chance/i.test(st.onHandoff))
  ? ok("After the steal round finishes, Bravo gets their OWN real handoff (not merged into the steal round, not another offer)")
  : bad("post-steal-round state, expected Bravo's own handoff: " + JSON.stringify(st));
(/Ready when you are, Bravo/.test(st.onHandoff || "") && !/Pass the device to Bravo/.test(st.onHandoff || ""))
  ? ok("That handoff correctly says 'Ready when you are, Bravo' - not 'Pass the device to Bravo,' since Bravo already has it from the steal offer they just resolved")
  : bad("expected the device-already-here copy after an accepted steal, got: " + JSON.stringify(st.onHandoff));

await clickButtonStartingWith("Start Bravo");
await page.waitForTimeout(200);
st = await screenState();
/Correct:\s*0/.test(st.correctText || "")
  ? ok("Bravo's OWN turn starts fresh at Correct: 0 in the live HUD - the 3 stolen corrects are folded in only at the Final Recap, not shown live mid-turn")
  : bad("Bravo's turn should start at 0 live, got: " + st.correctText);
await tapCorrect();
await tapEndRound();
st = await screenState();
st.onFinalRecap ? ok("2-team match reaches the Final Recap after Bravo's turn (Bravo was the last team)") : bad("expected Final Recap: " + JSON.stringify(st));

const recap1 = await finalRecapText();
// Bravo: 1 real correct of their own + 3 stolen corrects = 4 total.
/Bravo wins with 4 correct/.test(recap1)
  ? ok("Final Recap: Bravo's own 1 correct + the 3 stolen corrects genuinely sum to 4 and decide the real winner - a steal isn't just decorative points")
  : bad("Final Recap winner text did not reflect the merged correct count: " + recap1.slice(0, 300));
/Alpha[\s\S]*2[\s\S]*Bravo[\s\S]*4/.test(recap1)
  ? ok("Final Recap's compare row shows Alpha's real 2 vs Bravo's real merged 4")
  : bad("Final Recap compare row: " + recap1.slice(0, 300));
/Includes a steal bonus:\s*\+3 correct/.test(recap1)
  ? ok("Bravo's own stat block shows the real 'Includes a steal bonus: +3 correct...' flavor line")
  : bad("expected Bravo's steal-bonus flavor line in the recap: " + recap1.slice(0, 500));
// drawTeamRecap appends each team's eyebrow + buildStatsBlock() output as
// FLAT siblings in one shared panel (no per-team container to scope a CSS
// selector to) - so scope precisely by collecting the siblings between
// Alpha's own eyebrow and the NEXT eyebrow (Bravo's), rather than a
// text-window regex that can accidentally span into Bravo's own block.
const alphaBlockHasStealLine = await page.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Final Recap");
  const panel = h3 ? h3.closest(".panel") : null;
  if (!panel) return null;
  const eyebrows = [...panel.querySelectorAll(".eyebrow")];
  const alphaEyebrow = eyebrows.find((e) => e.textContent.trim() === "Alpha");
  if (!alphaEyebrow) return null;
  let node = alphaEyebrow.nextElementSibling;
  let text = "";
  while (node && !(node.classList.contains("eyebrow"))) { text += node.textContent; node = node.nextElementSibling; }
  return /Includes a steal bonus/.test(text);
});
alphaBlockHasStealLine === false
  ? ok("Alpha's own stat block (precisely scoped to the siblings before Bravo's own eyebrow) carries NO steal-bonus line - the flavor line is genuinely per-team, not global")
  : bad("Alpha's block unexpectedly shows a steal-bonus line (or scoping failed): " + JSON.stringify(alphaBlockHasStealLine));

/* ========================================================================
   3) Skip declines cleanly - no merge, no steal-bonus line, cards gone.
   ======================================================================== */
await setupTeamMatch(["Alpha", "Bravo"]);
await clickButtonStartingWith("Start Alpha");
await page.waitForTimeout(200);
await passNDistinct(2);
await tapCorrect(); await tapCorrect(); await tapCorrect(); // Alpha: 3 correct, 2 passed
await tapEndRound();
st = await screenState();
(st.onHandoff && /steal chance/i.test(st.onHandoff) && /2 cards/i.test(st.onHandoff))
  ? ok("A fresh match: Alpha's 2 Passes correctly offer Bravo a 2-card steal chance")
  : bad("expected a 2-card steal offer: " + JSON.stringify(st));

await clickButtonByText("Skip to your turn");
await page.waitForTimeout(200);
st = await screenState();
(st.onHandoff && /Bravo/.test(st.onHandoff) && !/steal chance/i.test(st.onHandoff))
  ? ok("Skip goes straight to Bravo's own real handoff - no steal round played")
  : bad("post-Skip state, expected Bravo's own handoff: " + JSON.stringify(st));
(/Ready when you are, Bravo/.test(st.onHandoff || "") && !/Pass the device to Bravo/.test(st.onHandoff || ""))
  ? ok("That handoff also says 'Ready when you are, Bravo' after Skip - the redundant self-instruction is gone on this path too")
  : bad("expected the device-already-here copy after a Skip, got: " + JSON.stringify(st.onHandoff));

await clickButtonStartingWith("Start Bravo");
await page.waitForTimeout(200);
await tapCorrect();
await tapEndRound();
const recap2 = await finalRecapText();
/Alpha wins with 3 correct/.test(recap2)
  ? ok("Final Recap: Alpha's real 3 correct still wins - Skip genuinely discarded the 2 declined cards, no phantom merge into Bravo's own 1")
  : bad("Final Recap winner text after Skip: " + recap2.slice(0, 300));
!/Includes a steal bonus/.test(recap2)
  ? ok("No 'steal bonus' flavor line appears anywhere in this recap - Skip left stats completely untouched")
  : bad("Skip should never produce a steal-bonus line, but one appeared: " + recap2.slice(0, 500));

/* ========================================================================
   4) Zero Passes -> a plain handoff, not an offer with "0 cards". The
   feature must be fully invisible when nothing was actually passed.
   ======================================================================== */
await setupTeamMatch(["Alpha", "Bravo"]);
await clickButtonStartingWith("Start Alpha");
await page.waitForTimeout(200);
await tapCorrect(); await tapCorrect();
await tapEndRound();
st = await screenState();
(st.onHandoff && /Bravo/.test(st.onHandoff) && !/steal/i.test(st.onHandoff))
  ? ok("Alpha passing on nothing means Bravo gets a genuinely plain handoff - the offer never fires on an empty passTally")
  : bad("expected a plain handoff with zero passes, got: " + JSON.stringify(st));
/Pass the device to Bravo/.test(st.onHandoff || "")
  ? ok("This genuinely plain handoff (no steal offer preceded it) still says the real 'Pass the device to Bravo' - the fix only suppresses that line on the two paths coming out of a steal offer, not this one")
  : bad("expected the normal 'Pass the device' copy on a real, un-preceded handoff: " + JSON.stringify(st.onHandoff));
await clickButtonStartingWith("Start Bravo");
await page.waitForTimeout(200);
await tapCorrect();
await tapEndRound();

/* ========================================================================
   5/6) Three-team chain: an ACCEPTED-then-re-passed card flows forward
   into the NEXT team's own offer, and the LAST team's own passes are
   never offered to anyone (game ends straight to the Final Recap).
   ======================================================================== */
await setupTeamMatch(["Alpha", "Bravo", "Charlie"]);
await clickButtonStartingWith("Start Alpha");
await page.waitForTimeout(200);
await passNDistinct(2);
await tapCorrect(); await tapCorrect();
await tapEndRound();
st = await screenState();
(st.onHandoff && /steal chance/i.test(st.onHandoff) && /2 cards/i.test(st.onHandoff))
  ? ok("3-team match: Alpha's 2 Passes offer Bravo a real 2-card steal")
  : bad("expected Bravo's 2-card offer: " + JSON.stringify(st));

await clickButtonByText("Steal! (2 cards)");
await page.waitForTimeout(250);
// Bravo accepts the steal, gets 1 right and re-Passes the other one - that
// re-Pass is the card this test expects to chain forward to Charlie.
await tapCorrect();
await tapPass();
await page.waitForTimeout(200);
st = await screenState();
(st.onHandoff && /Bravo/.test(st.onHandoff) && !/steal chance/i.test(st.onHandoff))
  ? ok("Bravo's steal round (1 correct, 1 re-Pass) finishes into Bravo's OWN real handoff")
  : bad("post-Bravo-steal-round state: " + JSON.stringify(st));

await clickButtonStartingWith("Start Bravo");
await page.waitForTimeout(200);
await tapCorrect(); await tapCorrect(); await tapCorrect(); // Bravo's own turn: all correct, no new passes
await tapEndRound();
st = await screenState();
(st.onHandoff && /Charlie/.test(st.onHandoff) && /steal chance/i.test(st.onHandoff) && /1 card\b/i.test(st.onHandoff))
  ? ok("CHAIN CONFIRMED: the one card Bravo re-Passed during their OWN accepted steal round correctly flows forward into Charlie's own steal offer (1 card) - mergeStealIntoTurn's passTally union genuinely works across two hops, not just one")
  : bad("expected the chained 1-card offer for Charlie: " + JSON.stringify(st));

await clickButtonByText("Skip to your turn"); // decline it, this test only needed to confirm the offer itself existed
await page.waitForTimeout(200);
await clickButtonStartingWith("Start Charlie");
await page.waitForTimeout(200);
await passNDistinct(2); // Charlie passes on 2 real cards of their own
await tapCorrect();
await tapEndRound();
st = await screenState();
st.onFinalRecap
  ? ok("Charlie's own 2 Passes are NEVER offered to anyone - Charlie is the last team, so the match ends straight to the Final Recap instead of another offer screen")
  : bad("expected the Final Recap right after the last team's turn, got: " + JSON.stringify(st));

/* ========================================================================
   7) MAX_STEAL_CARDS caps an offer at 8 even when more were passed.
   ======================================================================== */
await setupTeamMatch(["Alpha", "Bravo"]);
await clickButtonStartingWith("Start Alpha");
await page.waitForTimeout(200);
await passNDistinct(9); // AFT has 17 real questions - 9 distinct Passes (Remove mode) is safely within range
await tapCorrect();
await tapEndRound();
st = await screenState();
(st.onHandoff && /steal chance/i.test(st.onHandoff) && /8 cards/i.test(st.onHandoff) && !/9 cards/i.test(st.onHandoff))
  ? ok("MAX_STEAL_CARDS holds: 9 real Passes still cap the offer at exactly 8 cards, never 9")
  : bad("expected the offer capped at 8 cards after 9 real passes: " + JSON.stringify(st));
await clickButtonByText("Skip to your turn");
await page.waitForTimeout(200);
await clickButtonStartingWith("Start Bravo");
await page.waitForTimeout(200);
await tapCorrect();
await tapEndRound();

/* ========================================================================
   8) Regression: a chained-forward card must survive MAX_STEAL_CARDS'
   cap over the RECEIVING team's own newer passes, not get silently
   evicted by them (found by an adversarial review pass before this
   shipped - mergeStealIntoTurn originally seeded its merged Map with the
   team's own turn passes FIRST, so >=8 of THEIR OWN new passes could push
   an already-chained card out of stealableCardsFrom's slice(0, 8) before
   the next team ever saw it).
   ======================================================================== */
await setupTeamMatch(["Alpha", "Bravo", "Charlie"]);
await clickButtonStartingWith("Start Alpha");
await page.waitForTimeout(200);
const [chainedCard] = await passNDistinct(1);
await tapCorrect(); await tapCorrect();
await tapEndRound();
st = await screenState();
(st.onHandoff && /steal chance/i.test(st.onHandoff) && /1 card\b/i.test(st.onHandoff))
  ? ok("Regression setup: Alpha's 1 real Pass offers Bravo a 1-card steal")
  : bad("expected a 1-card offer for Bravo: " + JSON.stringify(st));

await clickButtonByText("Steal! (1 card)");
await page.waitForTimeout(250);
// Bravo re-Passes the ONE stolen card - this is the chained card that must
// survive the cap below. Its steal round then ends on its own (1-card
// queue exhausted).
await tapPass();
await page.waitForTimeout(200);

await clickButtonStartingWith("Start Bravo");
await page.waitForTimeout(200);
// Bravo's OWN turn now racks up 8 BRAND-NEW distinct passes - enough on
// its own to fill stealableCardsFrom's entire MAX_STEAL_CARDS=8 cap, if
// the merge gave Bravo's own newer passes priority over the one already-
// chained card from their steal round. Excludes chainedCard by name so a
// coincidental re-shuffle of the SAME 17-question pool can never
// accidentally satisfy this check via Bravo's own passTally instead of
// via the real chain this test exists to prove.
const bravoOwnPasses = await passNDistinctExcluding(8, chainedCard);
!bravoOwnPasses.includes(chainedCard)
  ? ok("Bravo's own 8 new passes are confirmed distinct from the chained card - this test genuinely isolates the chain, not a coincidental reshuffle")
  : bad("test setup failure: chainedCard leaked into Bravo's own passes: " + JSON.stringify(bravoOwnPasses));
await tapEndRound();
st = await screenState();
(st.onHandoff && /Charlie/.test(st.onHandoff) && /steal chance/i.test(st.onHandoff) && /8 cards/i.test(st.onHandoff))
  ? ok("Bravo's combined passes (1 chained + 8 own) correctly cap Charlie's offer at 8, not 9")
  : bad("expected Charlie's offer capped at 8: " + JSON.stringify(st));

await clickButtonByText("Steal! (8 cards)");
await page.waitForTimeout(250);
const charlieSteals = [];
for (let i = 0; i < 8; i++) { charlieSteals.push(await currentQuestionText()); await tapCorrect(); }
charlieSteals.includes(chainedCard)
  ? ok("REGRESSION FIX CONFIRMED: the chained card Bravo re-Passed during their OWN steal round survives the 8-card cap and is genuinely offered to Charlie, even though Bravo separately racked up 8 brand-new passes of their own")
  : bad("the chained card did not survive the cap - expected it among Charlie's 8 stolen cards: chained=" + JSON.stringify(chainedCard) + " shown=" + JSON.stringify(charlieSteals));
await page.waitForTimeout(200);
await clickButtonStartingWith("Start Charlie");
await page.waitForTimeout(200);
await tapCorrect();
await tapEndRound();

/* ========================================================================
   Console/error hygiene across the whole suite.
   ======================================================================== */
const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings across the full steal-round suite") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nRAPID FIRE STEAL ROUND: all passed");
process.exit(fails ? 1 : 0);
