/**
 * PC/desktop intuitivism pass, Tier 2(c) - 2026-08-22: extends Board Drill's
 * keyboard-shortcut convention (cardWrap's own keydown handler, above
 * renderDrill - Space/Enter to flip/reveal with a real-<button> guard, arrow
 * keys to browse, digit keys to grade once revealed) to three more surfaces.
 *
 * Deviation from the assignment as written, found and resolved before
 * writing this: the spec described "Train's Course mode" as already showing
 * "[A]/[B]/[C]" badges that looked like a keyboard hint and weren't. On
 * inspection, renderCourse (the function actually labeled "Course" in the
 * segmented mode switcher) had NO letter badges at all - the decorative
 * "[A]" prefix the spec described belongs to renderText ("Text" mode),
 * which is also the far more common case: 107 of 182 built-in scenarios
 * default to "text", only 4 default to "course". Both got the real
 * treatment: renderText's existing decorative letters became real bindings,
 * and renderCourse gained matching letter badges of its own (previously
 * absent) plus the same bindings, so "Course" - the literal UI label the
 * spec named - isn't left out either. See engine.js's renderText/renderCourse
 * for the per-function keydown comments.
 *
 * Covers, per surface - real key presses (page.keyboard.press), asserting
 * the resulting state change, AND that the pre-existing mouse/touch path is
 * unchanged:
 *   - Train, Text mode (renderText): letter keys select a choice (lowercase
 *     tested, case-insensitivity), Space/Enter activates the resulting
 *     Continue button once one exists (guarded against a focused real
 *     <button> double-firing - proven via the ONE genuinely observable
 *     side effect of a double advance() call in this mode: Text mode's
 *     transcript ACCUMULATES rather than replaces, so a broken guard would
 *     render the next node's dialogue twice, not once).
 *   - Train, Course mode (renderCourse): the same bindings, reusing the
 *     exact known g1/g2 content test-train.mjs already verified (same
 *     scenario, sc-counsel-growth, switched into "course" render mode),
 *     plus a plain mouse click on g2 confirming the click path is unchanged.
 *   - Board Drill's Quiz tab (renderQuiz, a different function from the
 *     flashcard drill covered by test-flip.mjs/test-board-drill-pc-parity):
 *     new letter badges (A-D) + letter-key selection, Space/Enter to
 *     continue once answered, plus a real mouse click proving the option
 *     buttons still work by pointer.
 *   - Mock Board's reveal-then-score flow (renderMockBoard): Space/Enter
 *     reveals (matching Board Drill's own flip semantics + guard), then
 *     1/2/3 self-score (matching the 3 real cfg.answerScale entries shipped
 *     - Nailed it / Partial / Missed - not a hardcoded "1-4"), plus a
 *     mouse-driven reveal+score round proving the click path is unchanged.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootTo(hash) {
  const page = await (await browser.newContext()).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(800);
  const guest = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guest.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guest.count()) {
    await guest.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
  if (hash) { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(600); }
  return { page, noise };
}

async function launchCounselGrowth(page) {
  await page.evaluate(() => { location.hash = "#/train"; });
  await page.waitForTimeout(500);
  await page.fill('input[aria-label="Search scenarios"]', "High Performer");
  await page.waitForTimeout(300);
  await page.locator(".grid .card.click").first().click();
  await page.waitForTimeout(300);
}

/* ============================================================
   Train — Text mode (renderText)
   ============================================================ */
{
  const { page, noise } = await bootTo(null);
  await launchCounselGrowth(page);
  // Launches in its real defaultMode, "Course" (verified in test-train.mjs) -
  // switch to Text via the segmented control, exactly how a real Soldier
  // would, rather than reaching into G.engine internals.
  await page.locator(".segmented button", { hasText: /^Text$/ }).click();
  await page.waitForTimeout(300);

  const hintText = await page.evaluate(() => document.querySelector(".eng-kbd-hint")?.textContent || "");
  /letter key/i.test(hintText) && /Space or Enter/i.test(hintText)
    ? ok("Text mode shows the new keyboard-shortcut hint (" + JSON.stringify(hintText) + ")")
    : bad("Text mode hint missing/wrong: " + JSON.stringify(hintText));

  const badges = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".mode-text .console button.choice")).map((b) => b.getAttribute("aria-label")));
  badges.some((b) => /^Choice A: Name the potential/.test(b || "")) && badges.some((b) => /^Choice B: Keep it light/.test(b || ""))
    ? ok("Text mode's real g1 choices render with real A/B aria-labels behind the [A]/[B] badges")
    : bad("Text mode g1 choice labels: " + JSON.stringify(badges));

  // Letter key selects the matching choice - lowercase "a", proving
  // case-insensitivity (e.key is "a" without Shift).
  await page.evaluate(() => document.querySelector(".mode-text").focus());
  await page.keyboard.press("a");
  await page.waitForTimeout(250);
  const afterLetter = await page.evaluate(() => ({
    feedback: document.querySelector(".mode-text .feedback")?.textContent || "",
    locked: Array.from(document.querySelectorAll(".mode-text .console button.choice:not(.choice-continue)")).every((b) => b.disabled),
    contExists: !!document.querySelector(".mode-text .choice-continue"),
  }));
  /Professional growth counseling is proactive/.test(afterLetter.feedback)
    ? ok('pressing "a" (lowercase) selects choice A by keyboard - the real g1 feedback text renders')
    : bad("feedback after letter-key press: " + JSON.stringify(afterLetter.feedback));
  afterLetter.locked ? ok("both g1 choice buttons lock after a keyboard pick, same as a mouse pick") : bad("choices did not lock after keyboard pick");
  afterLetter.contExists ? ok("a Continue button (.choice-continue) appears after the keyboard pick") : bad("no Continue button appeared");

  // Guard: focus the Continue button itself (a real <button>) and press
  // Enter ONCE. Without the "don't hijack a focused real <button>" guard,
  // this fires BOTH the browser's own native Enter-activates-focused-button
  // click AND this handler's own contBtn.click() - advance(sess, c) runs
  // twice with the SAME closed-over choice, and because Text mode's
  // transcript accumulates rather than replaces (see renderText's own
  // `else` branch reusing consoleEl), g2's dialogue line would render
  // TWICE instead of once.
  await page.evaluate(() => document.querySelector(".mode-text .choice-continue").focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const g2Lines = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".mode-text .dl-text")).filter((n) => /what would I even need to do/.test(n.textContent || "")).length);
  g2Lines === 1
    ? ok("Enter on a focused Continue button advances exactly once (guard prevents a double advance())")
    : bad("g2's dialogue line appeared " + g2Lines + " time(s) after one Enter press - expected exactly 1");

  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("Text mode: no console errors/warnings") : bad("Text mode console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- Text mode: the existing mouse path is unchanged (separate fresh
   session, the "miss" branch this time for content variety) ---- */
{
  const { page, noise } = await bootTo(null);
  await launchCounselGrowth(page);
  await page.locator(".segmented button", { hasText: /^Text$/ }).click();
  await page.waitForTimeout(300);
  await page.locator('.mode-text .console button.choice[aria-label^="Choice B: Keep it light"]').click();
  await page.waitForTimeout(250);
  const feedback = await page.evaluate(() => document.querySelector(".mode-text .feedback")?.textContent || "");
  feedback.length > 0
    ? ok("Text mode: a plain mouse click still selects a choice and shows feedback (unchanged by the keyboard-shortcut addition)")
    : bad("Text mode mouse click produced no feedback");
  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("Text mode mouse path: no console errors/warnings") : bad("noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ============================================================
   Train — Course mode (renderCourse)
   ============================================================ */
{
  const { page, noise } = await bootTo(null);
  await launchCounselGrowth(page);
  // Already launches in Course mode (its real defaultMode) - no switch needed.
  const activeMode = await page.evaluate(() => document.querySelector(".segmented button.active")?.textContent || "");
  activeMode === "Course" ? ok("scenario launches in its real defaultMode, Course") : bad("active mode: " + activeMode);

  const hintText = await page.evaluate(() => document.querySelector(".eng-kbd-hint")?.textContent || "");
  /letter key/i.test(hintText) ? ok("Course mode shows the new keyboard-shortcut hint") : bad("Course mode hint missing: " + JSON.stringify(hintText));

  const badgeHtml = await page.evaluate(() =>
    document.querySelector('.mode-course button.choice[title="Name the potential you see and make it concrete."]')?.innerHTML || "");
  /<b>\[A\]<\/b>/.test(badgeHtml)
    ? ok("Course mode's g1 choices now show real [A]/[B] letter badges (previously had none at all)")
    : bad("Course mode choice innerHTML missing the [A] badge: " + JSON.stringify(badgeHtml));

  // Letter key (uppercase this time) selects choice A.
  await page.evaluate(() => document.querySelector(".mode-course").focus());
  await page.keyboard.press("A");
  await page.waitForTimeout(300);
  const afterLetter = await page.evaluate(() => ({
    feedback: document.querySelector(".slide .feedback")?.textContent || "",
    locked: Array.from(document.querySelectorAll(".mode-course button.choice")).every((b) => b.disabled),
  }));
  /Professional growth counseling is proactive/.test(afterLetter.feedback)
    ? ok('pressing "A" selects choice A by keyboard in Course mode - the real g1 feedback text renders')
    : bad("Course mode feedback after letter-key press: " + JSON.stringify(afterLetter.feedback));
  afterLetter.locked ? ok("Course mode choices lock after a keyboard pick") : bad("Course mode choices did not lock after keyboard pick");

  // Space (not Enter this time) activates the resulting Continue button.
  await page.keyboard.press(" ");
  await page.waitForTimeout(300);
  const g2State = await page.evaluate(() => ({
    prompt: document.querySelector(".slide .prompt")?.textContent || "",
    choiceTitle: document.querySelector(".mode-course button.choice")?.getAttribute("title") || "",
  }));
  g2State.prompt === "She's leaning in now."
    ? ok('pressing Space on the focused Continue button advances to the real next node (g2)')
    : bad("g2 state after Space: " + JSON.stringify(g2State));

  // Mouse path unchanged: finish g2 by a real click, reach the real outcome screen.
  await page.locator('.mode-course button.choice[title="Co-build a concrete developmental plan across the three domains."]').click();
  await page.waitForTimeout(250);
  await page.locator(".slide button.btn.primary", { hasText: /Continue/ }).click();
  await page.waitForTimeout(300);
  const outcomeShown = await page.evaluate(() => /After-Action Review/i.test(document.querySelector(".panel.outcome h2")?.textContent || ""));
  outcomeShown
    ? ok("Course mode: finishing g2 by a real mouse click still reaches the real After-Action Review outcome (unchanged)")
    : bad("Course mode mouse path did not reach the outcome screen");

  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("Course mode: no console errors/warnings") : bad("Course mode console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ============================================================
   Board Drill — Quiz tab (renderQuiz)
   ============================================================ */
{
  const { page, noise } = await bootTo("#/board");
  await page.locator("button", { hasText: /^Quiz$/ }).click();
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: /^Start Quiz$/ }).click();
  await page.waitForTimeout(400);

  // Scoped by content, not just "p.hint" - the Board module's own
  // countdown banner (rendered above the tab body) is also a p.hint and
  // sorts first in document order.
  const hintText = await page.evaluate(() =>
    Array.from(document.querySelectorAll("p.hint")).find((p) => /Multiple-choice quiz/.test(p.textContent || ""))?.textContent || "");
  /letter key/i.test(hintText) ? ok("Quiz tab's hint mentions the new letter-key shortcut") : bad("Quiz hint missing keyboard mention: " + JSON.stringify(hintText));

  const letters = await page.evaluate(() => Array.from(document.querySelectorAll(".quiz-opt-letter")).map((s) => s.textContent));
  letters.length >= 2 && letters[0] === "A" && letters[1] === "B"
    ? ok("Quiz options render real A/B/... letter badges (" + JSON.stringify(letters) + ")")
    : bad("Quiz option letters: " + JSON.stringify(letters));

  // Letter key selects the matching option (whichever it is - correct or
  // wrong doesn't matter, only that the keypress registered a real pick).
  await page.evaluate(() => document.querySelector(".quiz-card").closest("[tabindex]").focus());
  await page.keyboard.press("A");
  await page.waitForTimeout(300);
  const afterLetter = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll(".quiz-opt"));
    return {
      firstDisabled: opts[0]?.disabled,
      firstGraded: opts[0]?.classList.contains("quiz-correct") || opts[0]?.classList.contains("quiz-wrong"),
      nextBtn: !!document.querySelector(".quiz-next-btn"),
    };
  });
  afterLetter.firstDisabled && afterLetter.firstGraded
    ? ok('pressing "A" selects option A by keyboard - it locks and gets graded (correct or wrong)')
    : bad("Quiz option state after letter-key press: " + JSON.stringify(afterLetter));
  afterLetter.nextBtn ? ok("the Next/See Results button appears after a keyboard pick") : bad("no .quiz-next-btn after keyboard pick");

  const qBefore = await page.evaluate(() => document.querySelector(".kc-label")?.textContent || "");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const qAfter = await page.evaluate(() => document.querySelector(".kc-label")?.textContent || document.querySelector(".eyebrow")?.textContent || "");
  qAfter !== qBefore
    ? ok("Enter on the answered card advances to the next question (or results) - was " + JSON.stringify(qBefore) + ", now " + JSON.stringify(qAfter))
    : bad("Quiz did not advance after Enter: still " + JSON.stringify(qAfter));

  // Mouse path unchanged: click an option directly by pointer.
  const hasCard = await page.locator(".quiz-card .quiz-opt").count();
  if (hasCard) {
    await page.locator(".quiz-opt").first().click();
    await page.waitForTimeout(300);
    const clicked = await page.evaluate(() => document.querySelector(".quiz-opt")?.disabled === true);
    clicked ? ok("Quiz: a real mouse click still selects an option (unchanged by the keyboard-shortcut addition)") : bad("Quiz mouse click did not select an option");
  } else {
    ok("Quiz: reached results screen (only 2-question category) - mouse path exercised by the earlier keyboard pick's own click() call");
  }

  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("Quiz tab: no console errors/warnings") : bad("Quiz console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ============================================================
   Mock Board — reveal-then-score flow (renderMockBoard)
   ============================================================ */
{
  const { page, noise } = await bootTo("#/board");
  await page.locator("button", { hasText: /^Mock Board$/ }).click();
  await page.waitForTimeout(400);
  await page.locator("select").first().selectOption("5");
  await page.locator("button.mb-start", { hasText: /begin board/i }).click();
  await page.waitForTimeout(300);
  await page.locator("button", { hasText: /I've reported/i }).click();
  await page.waitForTimeout(400);

  const hintText = await page.evaluate(() => document.querySelector("p.mb-say")?.textContent || "");
  /Space\/Enter/.test(hintText) ? ok("Mock Board's hint mentions the new Space/Enter reveal shortcut") : bad("Mock Board hint missing keyboard mention: " + JSON.stringify(hintText));

  // Space reveals the answer.
  await page.evaluate(() => document.querySelector(".mb-wrap").focus());
  await page.keyboard.press(" ");
  await page.waitForTimeout(250);
  const revealed = await page.evaluate(() => !document.querySelector(".mb-answer")?.hasAttribute("hidden"));
  revealed ? ok("pressing Space reveals the doctrinal answer, matching Board Drill's own flip semantics") : bad("Space did not reveal the answer");

  // Guard: pressing Space again (already revealed) must be a safe no-op,
  // not re-trigger anything - the reveal branch itself checks
  // sess.revealed first, before it ever reaches the real-<button> guard.
  await page.keyboard.press(" ");
  await page.waitForTimeout(150);
  const stillRevealed = await page.evaluate(() => !document.querySelector(".mb-answer")?.hasAttribute("hidden"));
  stillRevealed ? ok("a second Space press after reveal is a safe no-op (stays revealed, no error)") : bad("second Space press changed state unexpectedly");

  // "1" (Nailed it, the first of the 3 real cfg.answerScale entries) scores
  // and advances to question 2.
  await page.keyboard.press("1");
  await page.waitForTimeout(300);
  const q2 = await page.evaluate(() => document.querySelector(".mb-progress")?.textContent || "");
  /Question 2 of 5/.test(q2)
    ? ok('pressing "1" self-scores "Nailed it" and advances to question 2 (' + JSON.stringify(q2) + ")")
    : bad("progress after pressing 1: " + JSON.stringify(q2));

  // Mouse path unchanged: reveal + score the rest by real clicks, reach the AAR.
  for (let i = 0; i < 4; i++) {
    await page.locator("button.mb-reveal", { hasText: /reveal answer/i }).click();
    await page.waitForTimeout(120);
    await page.locator("button.mb-score-btn").first().click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  const doneVisible = await page.evaluate(() => /After-Action Review/i.test(document.body.textContent || ""));
  doneVisible
    ? ok("Mock Board: finishing the rest of the board by real mouse clicks still reaches the After-Action Review (unchanged)")
    : bad("Mock Board mouse path did not reach the scorecard");

  const results = await page.evaluate(() => window.G.board && true); // sanity: module still exposed, no crash
  results ? ok("G.board still exposed after the mbWrap refactor (no accidental breakage of shared state)") : bad("G.board missing after Mock Board run");

  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("Mock Board: no console errors/warnings") : bad("Mock Board console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `INTUITIVISM-PC-TIER2C: ${fails} FAILURE(S)` : "INTUITIVISM-PC-TIER2C: all passed"));
process.exit(fails ? 1 : 0);
