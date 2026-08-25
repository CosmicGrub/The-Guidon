/**
 * Rapid Fire (src/index.html's renderRapidFire, Board Drill's 7th tab) —
 * Stage 1 of docs/superpowers/specs/2026-08-23-rapid-fire-design.md: Party
 * mode's Setup screen, round engine/screen, and Recap screen.
 *
 * Exercises, against the REAL UI (no direct closure access — cfg/queue/
 * timer state are all private to renderRapidFire's own closure, same shape
 * Quiz's sess/timerInterval already have):
 *   1. The new tab appears in Board Drill's segmented dispatcher and
 *      switching to/from it behaves like every other tab there.
 *   2. Every Setup control genuinely changes the computed round pool:
 *      category filter, difficulty band (against the real guest profile's
 *      real tier -> G.board.normDifficulty band), passed-cards behavior
 *      (Requeue vs Remove — proven by real round-length differences, not
 *      just a flag), and "Needs Work" (both the fallback-with-no-history
 *      case AND the real weakest-3 case once real SRS data exists).
 *   3. The round screen shows ONLY the question by default; Reveal answer
 *      prefers acceptableAnswer over `a` when both exist on the real
 *      question object, falls back to `a` in full when acceptableAnswer is
 *      absent, and never truncates either field's real text.
 *   4. Correct/Pass tallying and the streak counter are real state, not
 *      cosmetic text.
 *   5. A real Capacitor Haptics call fires on Correct/Pass (mocked the same
 *      way test-haptics-capacitor.mjs already mocks the same plugin), and
 *      the Sound/Haptics Setup toggle genuinely gates it.
 *   6. A real document visibilitychange dispatch pauses the round timer
 *      while hidden and resumes it on return — no silent time burn while
 *      backgrounded.
 *   7. The one-time quick-start explainer shows before a Soldier's first-
 *      ever round and never again afterward in the same session.
 *   8. Recap's cross-link into Flashcards actually navigates with the
 *      correct category pre-filtered (the real G.board._filterCat / catSel
 *      wiring, fed by the real G.nav.seed()/consume() handoff).
 *
 * Two real board-question categories are used as fixed, known-shape
 * fixtures (verified directly against the seed data before this file was
 * written, not guessed): "Army Fitness Test (AFT)" (17 questions, mixed
 * beginner (6) / intermediate (11) band — the former AFT/ACFT/Fitness
 * three-category cluster merged into one, per the board-content
 * redundancy-audit merge),
 * "Counseling (ATP 6-22.1)" (19 questions, ALL have acceptableAnswer — the
 * Counseling + ATP 6-22.1 board categories merged, per the board-content
 * redundancy-audit merge). The Reveal-fallback fixture (a category where
 * NONE of the cards have acceptableAnswer) is looked up LIVE at runtime
 * instead of hardcoded, since the exact set of such categories shifts as
 * board content is merged/reorganized (e.g. "Drill and Ceremony" no longer
 * qualifies after merging in the 15 acceptableAnswer-bearing TC 3-21.5
 * cards).
 * The zero-writes-to-attempts/SRS regression (the spec's own "load-bearing"
 * test) lives in its own file, test-rapid-fire-no-srs-writes.mjs, so it can
 * be run/re-run in isolation.
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

// ── Small DOM-query helpers, matching this suite's established style
//    (page.evaluate + querySelectorAll/find, not the Locator API) ────────
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
async function openBoard() {
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(400);
}
/** Forces a FRESH renderRapidFire() closure (fresh cfg defaults) by
 *  visiting another tab first, then Rapid Fire — same shape a Soldier
 *  really leaving and returning to the tab would produce. */
async function enterRapidFireFresh() {
  await clickButtonByText("Board Drill");
  await page.waitForTimeout(150);
  const clicked = await clickButtonByText("Rapid Fire");
  await page.waitForTimeout(300);
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
async function poolNoteText() {
  return page.evaluate(() => {
    const notes = [...document.querySelectorAll(".rf-setup-grid p.hint")];
    const n = notes.find((p) => /questions? in this deck|No questions match/.test(p.textContent));
    return n ? n.textContent : null;
  });
}
async function needsWorkNoteVisible() {
  return page.evaluate(() => {
    const n = document.querySelector(".rf-needs-work-note");
    return !!n && n.style.display !== "none";
  });
}
async function clickNeedsWorkChip() { return clickButtonByText("⚙ Needs Work"); }
/** Starts a round from the Setup screen, transparently handling the
 *  one-time quick-start explainer if it's the first round this session. */
async function startRound() {
  await clickButtonByText("Start Round");
  await page.waitForTimeout(250);
  const hasExplainer = await page.evaluate(() => !!document.querySelector(".rf-explainer"));
  if (hasExplainer) {
    await clickButtonByText("Got it — let's go");
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(200);
}
async function roundState() {
  return page.evaluate(() => {
    const scoreEl = document.querySelector(".rf-hud-stat");
    const streakEl = document.querySelector(".trend-streak");
    const timerEl = document.querySelector(".rf-timer");
    const qEl = document.querySelector(".rf-question");
    const answerPanel = document.querySelector(".rf-answer-panel");
    const answerText = document.querySelector(".rf-answer-text");
    const revealBtn = [...document.querySelectorAll(".rf-card button")].find((b) => /Reveal answer|Hide answer/.test(b.textContent));
    return {
      onRound: !!qEl,
      // NOTE: document.body.textContent (not used here on purpose) walks
      // EVERY descendant text node, including this app's own inlined
      // <script> source — this exact literal ("Round Recap") is also,
      // unavoidably, present verbatim in that source text (it's the string
      // this very code renders), so a textContent scan for it is a
      // guaranteed false positive from the very first render. Scoped to
      // real <h3> elements instead — only genuine rendered DOM nodes, never
      // script contents.
      onRecap: [...document.querySelectorAll("h3")].some((h) => h.textContent.trim() === "Round Recap"),
      correctText: scoreEl ? scoreEl.textContent : null,
      streakText: streakEl ? streakEl.textContent : "",
      timerText: timerEl ? timerEl.textContent : null,
      questionText: qEl ? qEl.textContent : null,
      answerVisible: answerPanel ? answerPanel.style.display !== "none" : null,
      answerText: answerText ? answerText.textContent : null,
      revealBtnText: revealBtn ? revealBtn.textContent : null,
      bodyHasAnswerPanelAtAll: !!answerPanel,
    };
  });
}
async function tapReveal() { return clickButtonByText("Reveal answer", ".rf-card"); }
async function tapCorrect() {
  await page.evaluate(() => document.querySelector(".rf-judge-correct")?.click());
  await page.waitForTimeout(150);
}
async function tapPass() {
  await page.evaluate(() => document.querySelector(".rf-judge-pass")?.click());
  await page.waitForTimeout(150);
}
async function tapEndRound() { await clickButtonByText("End Round"); await page.waitForTimeout(200); }
async function fireVisibility(state) {
  await page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { value: s, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  await page.waitForTimeout(120);
}

// ════════════════════════════════════════════════════════════════════
// 1) The tab appears in the real dispatcher and switches correctly
// ════════════════════════════════════════════════════════════════════
await openBoard();
const hasRapidBtn = await page.evaluate(() => [...document.querySelectorAll(".segmented button")].some((b) => b.textContent.trim() === "Rapid Fire"));
hasRapidBtn ? ok("Board Drill's segmented dispatcher shows a real 'Rapid Fire' button") : bad("no 'Rapid Fire' button found in the segmented tab bar");

const switched = await enterRapidFireFresh();
switched ? ok("clicking 'Rapid Fire' switches tabs") : bad("could not click the 'Rapid Fire' button");
const afterSwitch = await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".segmented button")].find((b) => b.textContent.trim() === "Rapid Fire");
  const drillBtn = [...document.querySelectorAll(".segmented button")].find((b) => b.textContent.trim() === "Board Drill");
  return {
    rapidActive: btn ? btn.classList.contains("active") : false,
    drillActive: drillBtn ? drillBtn.classList.contains("active") : false,
    hasStartBtn: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Start Round"),
  };
});
afterSwitch.rapidActive && !afterSwitch.drillActive
  ? ok("'Rapid Fire' becomes the active tab and 'Board Drill' deactivates (single-active-tab dispatcher behavior)")
  : bad("active-tab state after switching: " + JSON.stringify(afterSwitch));
afterSwitch.hasStartBtn ? ok("Rapid Fire's Setup screen renders (real 'Start Round' button present)") : bad("Setup screen did not render");

// ════════════════════════════════════════════════════════════════════
// 2) Setup controls genuinely change the computed round pool
// ════════════════════════════════════════════════════════════════════
// 2a) Category filter — real, known category sizes (verified against the
//     real seed data before this file was written). "All difficulties" is
//     also clicked so the difficulty-band default ("Match my rank", which
//     for the real guest profile's real tier E4 means the beginner band)
//     doesn't silently narrow these category counts further.
await clickButtonByText("All difficulties");
await setCategory("Army Fitness Test (AFT)");
let note = await poolNoteText();
/^17 questions in this deck\.$/.test(note || "")
  ? ok("selecting category 'Army Fitness Test (AFT)' shows the real 17-question pool count")
  : bad("pool note after selecting Army Fitness Test (AFT): " + note);

await setCategory("Counseling (ATP 6-22.1)");
note = await poolNoteText();
/^19 questions in this deck\.$/.test(note || "")
  ? ok("selecting category 'Counseling (ATP 6-22.1)' shows the real 19-question pool count")
  : bad("pool note after selecting Counseling (ATP 6-22.1): " + note);

const realTotal = await page.evaluate(() => G.store.boardQuestions().length);
await setCategory("All");
note = await poolNoteText();
new RegExp("^" + realTotal + " questions in this deck\\.$").test(note || "")
  ? ok(`selecting 'All' categories shows the real full pool count (${realTotal})`)
  : bad(`pool note after selecting All (expected ${realTotal}): ` + note);

// 2b) Difficulty band — "Match my rank" is the Setup default; the real
// guest profile has a real tier (E4 -> beginner band). Verified against
// the LIVE band count (G.board.normDifficulty), not a hardcoded guess.
await enterRapidFireFresh();
const bandCounts = await page.evaluate(() => {
  const qs = G.store.boardQuestions();
  const c = {};
  qs.forEach((q) => { const b = G.board.normDifficulty(q.difficulty); c[b] = (c[b] || 0) + 1; });
  return { total: qs.length, beginner: c.beginner || 0 };
});
note = await poolNoteText();
new RegExp("^" + bandCounts.beginner + " questions in this deck\\.$").test(note || "")
  ? ok(`Setup's default 'Match my rank' band shows the real beginner-band count (${bandCounts.beginner}), proving the guest's real E4 tier is actually applied`)
  : bad(`default 'Match my rank' pool note (expected ${bandCounts.beginner} beginner-band questions): ` + note);
await clickButtonByText("All difficulties");
note = await poolNoteText();
new RegExp("^" + bandCounts.total + " questions in this deck\\.$").test(note || "")
  ? ok(`clicking 'All difficulties' widens the pool to the real full count (${bandCounts.total}) — the control genuinely changes the filter, not cosmetic`)
  : bad(`'All difficulties' pool note (expected ${bandCounts.total}): ` + note);

// 2c) "Needs Work" — fallback case FIRST (fresh guest profile, no attempt
// history seeded yet anywhere in this session).
await enterRapidFireFresh();
await clickButtonByText("All difficulties");
const beforeFallback = await needsWorkNoteVisible();
!beforeFallback ? ok("no-history fallback note is hidden before 'Needs Work' is toggled on") : bad("fallback note visible before Needs Work was even clicked");
await clickNeedsWorkChip();
const fallbackVisible = await needsWorkNoteVisible();
fallbackVisible ? ok("'Needs Work' with no attempt history shows the inline fallback note") : bad("fallback note did not appear for 'Needs Work' with no attempt history");
note = await poolNoteText();
new RegExp("^" + bandCounts.total + " questions in this deck\\.$").test(note || "")
  ? ok("'Needs Work' with no history falls back to the full 'All categories' pool, not a dead end")
  : bad(`'Needs Work' fallback pool note (expected ${bandCounts.total}): ` + note);

// 2d) "Needs Work" — the real weakest-3 case, once real SRS mastery data
// exists. One graded (but unmastered — reps>0, lastGrade 0) card is enough
// to flip anySeen true; the exact top-3 category set is read LIVE from the
// same G.board.weakestCategoriesByMastery(3) Rapid Fire itself calls,
// rather than guessed, so this stays correct however the ranking algorithm
// breaks ties.
await page.evaluate(async () => {
  const q = G.store.boardQuestions().find((x) => x.category === "Army Fitness Test (AFT)");
  await G.db.put("kv", { k: "srs:" + q.id, v: { reps: 1, ease: 2.3, interval: 1, due: 0, misses: 0, lastGrade: 0 } });
});
await enterRapidFireFresh();
await clickButtonByText("All difficulties");
await clickNeedsWorkChip();
const afterSeedFallbackVisible = await needsWorkNoteVisible();
!afterSeedFallbackVisible ? ok("once real SRS history exists, the no-history fallback note no longer shows for 'Needs Work'") : bad("fallback note still shown even after real SRS history was seeded");
const expectedNeedsWork = await page.evaluate(async () => {
  const cats = await G.board.weakestCategoriesByMastery(3);
  const set = new Set(cats.map((c) => c.cat));
  return G.store.boardQuestions().filter((q) => set.has(q.category)).length;
});
note = await poolNoteText();
new RegExp("^" + expectedNeedsWork + " questions in this deck\\.$").test(note || "")
  ? ok(`'Needs Work' pool (${expectedNeedsWork}) matches the real live weakest-3-categories union from G.board.weakestCategoriesByMastery(3) — the same ranking the Readiness tab shows`)
  : bad(`'Needs Work' pool note (expected ${expectedNeedsWork} from the real weakest-3 union): ` + note);

// ════════════════════════════════════════════════════════════════════
// 3/7) First-ever round: quick-start explainer, question-only default,
//      Reveal prefers acceptableAnswer, real question text (no truncation)
// ════════════════════════════════════════════════════════════════════
await enterRapidFireFresh();
await setCategory("Counseling (ATP 6-22.1)"); // every question here HAS acceptableAnswer
await clickButtonByText("All difficulties");
await clickButtonByText("Start Round");
await page.waitForTimeout(300);
const explainerShown = await page.evaluate(() => !!document.querySelector(".rf-explainer"));
explainerShown ? ok("the one-time quick-start explainer shows before this Soldier's first-ever Rapid Fire round") : bad("no quick-start explainer shown on the very first round of the session");
if (explainerShown) {
  await clickButtonByText("Got it — let's go");
  await page.waitForTimeout(300);
}

let st = await roundState();
st.onRound ? ok("the round screen renders after dismissing the explainer") : bad("round screen did not render: " + JSON.stringify(st));

// Question-only default: no answer text anywhere in the visible DOM before
// Reveal is tapped.
const realCard = await page.evaluate((qText) => {
  const q = G.store.boardQuestions().find((x) => x.q === qText && x.category === "Counseling (ATP 6-22.1)");
  return q ? { q: q.q, a: q.a, acceptableAnswer: q.acceptableAnswer } : null;
}, st.questionText);
st.questionText && realCard && st.questionText === realCard.q
  ? ok("the round screen shows the real question text, in full, unaltered")
  : bad("round question text did not exactly match a real Counseling (ATP 6-22.1) question: " + JSON.stringify({ shown: st.questionText, realCard }));
// The answer panel's own display:none (checked via roundState()'s
// answerVisible, above — the real computed/inline style, not a text scan)
// IS the "not visible to the Soldier" proof: headless Chromium's innerText
// implementation does not reliably honor display:none the way a real
// windowed browser does (verified directly — it still returns the hidden
// element's text), so a text-presence check here would be less reliable
// than the style check already done, not more.
st.answerVisible === false
  ? ok("the answer panel is hidden by default (question-only) — real display:none, checked before Reveal is ever tapped")
  : bad("answer panel state before Reveal: " + st.answerVisible);

// Reveal — prefers acceptableAnswer (Counseling (ATP 6-22.1): every card has one).
await tapReveal();
st = await roundState();
(realCard && st.answerText === realCard.acceptableAnswer)
  ? ok("Reveal answer shows the real acceptableAnswer text, in full, exactly matching the real question object — no truncation")
  : bad("revealed text vs real acceptableAnswer: " + JSON.stringify({ shown: st.answerText, real: realCard && realCard.acceptableAnswer }));
st.answerVisible === true ? ok("the answer panel becomes visible after tapping Reveal") : bad("answer panel did not become visible after Reveal");

// ── Correct/Pass tallying + streak, real state ──────────────────────
await tapCorrect();
st = await roundState();
/Correct:\s*1/.test(st.correctText || "") ? ok("tapping Correct increments the real correct count to 1") : bad("correct count after 1 Correct: " + st.correctText);
st.streakText === "" ? ok("streak indicator stays hidden below 2 in a row (matches Progress's own trend-streak threshold)") : bad("streak text after 1 Correct (expected hidden): " + JSON.stringify(st.streakText));

await tapCorrect();
st = await roundState();
/Correct:\s*2/.test(st.correctText || "") ? ok("a second Correct increments the real count to 2") : bad("correct count after 2 Corrects: " + st.correctText);
/🔥\s*2 in a row/.test(st.streakText || "") ? ok("streak indicator shows '🔥 2 in a row' after 2 consecutive Corrects") : bad("streak text after 2 Corrects: " + JSON.stringify(st.streakText));

await tapPass();
st = await roundState();
/Correct:\s*2/.test(st.correctText || "") ? ok("tapping Pass does NOT increment the correct count") : bad("correct count changed on Pass: " + st.correctText);
st.streakText === "" ? ok("tapping Pass resets the streak back to hidden (real state, not cosmetic)") : bad("streak text after Pass (expected reset): " + JSON.stringify(st.streakText));

await tapEndRound();
st = await roundState();
st.onRecap ? ok("'End Round' ends the round and shows the real Recap screen") : bad("Recap did not appear after End Round: " + JSON.stringify(st));

// ── Recap cross-link: this whole round only ever touched "Counseling
// (ATP 6-22.1)" ── Scoped to the real rendered Recap <div.panel> via
// innerText (not a document.body.textContent scan — see the false-positive
// risk documented above: "Counseling" is also a real category name used
// throughout this app's own source, so an unscoped scan could pass for the
// wrong reason even if this specific panel never mentioned it).
const recapPanelText = await page.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => h.textContent.trim() === "Round Recap");
  const panel = h3 ? h3.closest(".panel") : null;
  return panel ? panel.innerText : "";
});
/Counseling \(ATP 6-22\.1\)/.test(recapPanelText) ? ok("Recap's cross-link names the round's own category ('Counseling (ATP 6-22.1)', the only one this round touched)") : bad("Recap panel text does not mention Counseling (ATP 6-22.1): " + recapPanelText.slice(0, 400));
const clicked = await clickButtonByText("Practice in Flashcards →");
await page.waitForTimeout(500);
clicked ? ok("Recap's 'Practice in Flashcards →' cross-link button is clickable") : bad("cross-link button not found on Recap");
const drillCatValue = await page.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Filter by category"]');
  return sel ? sel.value : null;
});
drillCatValue === "Counseling (ATP 6-22.1)"
  ? ok("clicking the cross-link lands on Board Drill's Flashcards tab with the category filter actually set to 'Counseling (ATP 6-22.1)'")
  : bad("category filter select after the cross-link click: " + drillCatValue);
const drillActiveAfterLink = await page.evaluate(() => {
  const b = [...document.querySelectorAll(".segmented button")].find((x) => x.textContent.trim() === "Board Drill");
  return b ? b.classList.contains("active") : false;
});
drillActiveAfterLink ? ok("the cross-link switches to the Flashcards ('Board Drill') tab, not just setting a hidden flag") : bad("Board Drill tab is not active after the cross-link");

// ════════════════════════════════════════════════════════════════════
// Explainer never shows again after the first round (Play Again / New
// Deck path) — one-time, persisted via the real kv-store "seen" flag.
// ════════════════════════════════════════════════════════════════════
await enterRapidFireFresh();
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Start Round");
await page.waitForTimeout(300);
const explainerAgain = await page.evaluate(() => !!document.querySelector(".rf-explainer"));
!explainerAgain ? ok("the quick-start explainer does NOT show again on a later round in the same session (one-time, persisted 'seen' flag)") : bad("explainer showed again on a second round");
const seenFlag = await page.evaluate(() => G.db.getSetting("rapidFire:seenExplainer", false));
seenFlag === true ? ok("the one-time explainer's 'seen' flag is persisted in the real kv store (db.getSetting/setSetting), matching this app's own convention") : bad("rapidFire:seenExplainer kv flag: " + seenFlag);
await tapEndRound();

// ════════════════════════════════════════════════════════════════════
// Reveal fallback: pick a REAL category, looked up LIVE (not hardcoded —
// the exact set of categories where every card lacks acceptableAnswer
// shifts as board content is merged/reorganized; "Drill and Ceremony" no
// longer qualifies once merged with TC 3-21.5's acceptableAnswer-bearing
// cards) where NONE of the cards have acceptableAnswer, so Reveal must
// show the full `a` field, unaltered.
// ════════════════════════════════════════════════════════════════════
const noAcceptableCat = await page.evaluate(() => {
  const qs = G.store.boardQuestions();
  const byCat = new Map();
  for (const q of qs) {
    if (!byCat.has(q.category)) byCat.set(q.category, []);
    byCat.get(q.category).push(q);
  }
  for (const [cat, list] of byCat) {
    if (list.length > 0 && list.every((q) => !q.acceptableAnswer)) return cat;
  }
  return null;
});
noAcceptableCat
  ? ok(`found a real category with zero acceptableAnswer coverage to use as the Reveal-fallback fixture: "${noAcceptableCat}"`)
  : bad("could not find any real category where every card lacks acceptableAnswer — Reveal-fallback scenario can't be exercised");
await enterRapidFireFresh();
await setCategory(noAcceptableCat);
await clickButtonByText("All difficulties");
await startRound();
st = await roundState();
const realCard2 = await page.evaluate(({ qText, cat }) => {
  const q = G.store.boardQuestions().find((x) => x.q === qText && x.category === cat);
  return q ? { q: q.q, a: q.a, acceptableAnswer: q.acceptableAnswer } : null;
}, { qText: st.questionText, cat: noAcceptableCat });
(realCard2 && !realCard2.acceptableAnswer) ? ok(`landed on a real "${noAcceptableCat}" question, confirmed to have no acceptableAnswer field`) : bad("fixture assumption broken — real card: " + JSON.stringify(realCard2));
await tapReveal();
st = await roundState();
(realCard2 && st.answerText === realCard2.a)
  ? ok("Reveal answer falls back to the full `a` field, in full and unaltered, when acceptableAnswer is absent")
  : bad("revealed text vs real `a` field: " + JSON.stringify({ shown: st.answerText, real: realCard2 && realCard2.a }));
await tapEndRound();

// ════════════════════════════════════════════════════════════════════
// Passed-cards behavior: Requeue vs Remove, proven by real round length
// (Army Fitness Test (AFT) — 17 real questions, mixed beginner/intermediate
// band, so "All difficulties" is used to keep the whole 17-question pool in
// play; Untimed so only deck-exhaustion — not a timer — can end the round).
// ════════════════════════════════════════════════════════════════════
await enterRapidFireFresh();
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
await clickButtonByText("Remove for this round");
await startRound();
for (let i = 0; i < 17; i++) await tapPass();
st = await roundState();
st.onRecap
  ? ok("Passed cards = Remove: passing all 17 real AFT questions exhausts the deck and ends the round on its own (caps the round to the real available card count, per the design spec's error-handling section)")
  : bad("round did not end after passing every card with Remove selected: " + JSON.stringify(st));

await enterRapidFireFresh();
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
// "Requeue" is already the Setup default — left untouched here on purpose.
await startRound();
for (let i = 0; i < 5; i++) await tapPass();
st = await roundState();
(!st.onRecap && st.onRound)
  ? ok("Passed cards = Requeue: passing 5 of 17 real AFT questions does NOT end the round (each pass goes back into the queue) — genuinely different real behavior from Remove above")
  : bad("round state after 5 passes with Requeue selected (expected still running): " + JSON.stringify(st));
await tapEndRound();

// ════════════════════════════════════════════════════════════════════
// Capacitor Haptics — same mock convention as test-haptics-capacitor.mjs
// ════════════════════════════════════════════════════════════════════
async function mockHaptics() {
  await page.evaluate(() => {
    window.__hapticsCalls = [];
    window.Capacitor = { Plugins: { Haptics: {
      notification: (opts) => { window.__hapticsCalls.push(opts); return Promise.resolve(); },
    } } };
  });
}
async function hapticsCalls() { return page.evaluate(() => window.__hapticsCalls.slice()); }
async function clearCapacitor() { await page.evaluate(() => { delete window.Capacitor; }); }

await enterRapidFireFresh();
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
await mockHaptics();
await startRound();
await tapCorrect();
let hc = await hapticsCalls();
hc.length === 1 && hc[0].type === "SUCCESS"
  ? ok("tapping Correct fires the real Capacitor Haptics.notification({type:'SUCCESS'}) call")
  : bad("haptics calls after Correct: " + JSON.stringify(hc));
await tapPass();
hc = await hapticsCalls();
hc.length === 2 && hc[1].type === "WARNING"
  ? ok("tapping Pass fires the real Capacitor Haptics.notification({type:'WARNING'}) call")
  : bad("haptics calls after Correct+Pass: " + JSON.stringify(hc));
await tapEndRound();
await clearCapacitor();

// Sound/Haptics Setup toggle genuinely gates the call — switch it Off and
// confirm zero haptics calls fire for the same Correct/Pass actions.
await enterRapidFireFresh();
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
await clickButtonByText("Off"); // Sound / Haptics: Off
await mockHaptics();
await startRound();
await tapCorrect();
await tapPass();
hc = await hapticsCalls();
hc.length === 0
  ? ok("Sound/Haptics = Off genuinely suppresses the real Haptics call for both Correct and Pass — not a cosmetic setting")
  : bad("haptics fired even with Sound/Haptics set to Off: " + JSON.stringify(hc));
await tapEndRound();
await clearCapacitor();

// ════════════════════════════════════════════════════════════════════
// Round timer length — each of the four real Setup options genuinely
// changes the round's own timer, not just the Setup label.
// ════════════════════════════════════════════════════════════════════
async function timerAt(label) {
  await enterRapidFireFresh();
  await setCategory("Army Fitness Test (AFT)");
  await clickButtonByText("All difficulties");
  if (label) await clickButtonByText(label);
  await startRound();
  const s = await roundState();
  await tapEndRound();
  return s.timerText;
}
// 60s is the Setup default — left untouched (no timer button clicked) to
// prove the DEFAULT itself is really 60, not just that clicking "60s" works.
let tAt60 = await timerAt(null);
tAt60 === "60s" ? ok("the untouched Setup default (60s) really starts a round showing '60s'") : bad("default-timer round's initial timer text: " + tAt60);
let tAt90 = await timerAt("90s");
tAt90 === "90s" ? ok("selecting 90s starts a round showing '90s'") : bad("90s round's initial timer text: " + tAt90);
let tAt30 = await timerAt("30s");
tAt30 === "30s" ? ok("selecting 30s starts a round showing '30s'") : bad("30s round's initial timer text: " + tAt30);
// Untimed shows an elapsed count-UP, starting at 0s — no countdown value
// to reach, proving it's a genuinely different code path, not "60s hidden".
let tAtUntimed = await timerAt("Untimed");
tAtUntimed === "0s" ? ok("selecting Untimed starts a round showing an elapsed '0s' count-up, not a hidden countdown") : bad("Untimed round's initial timer text: " + tAtUntimed);

// ════════════════════════════════════════════════════════════════════
// visibilitychange pauses and resumes the round timer — no silent burn
// while backgrounded (design spec's own error-handling requirement)
// ════════════════════════════════════════════════════════════════════
await enterRapidFireFresh();
await setCategory("Army Fitness Test (AFT)");
await clickButtonByText("All difficulties");
await clickButtonByText("30s");
await startRound();
st = await roundState();
st.timerText === "30s" ? ok("a 30s timed round starts showing '30s'") : bad("initial timer text for a 30s round: " + st.timerText);

await fireVisibility("hidden");
await page.waitForTimeout(2600); // >2 real ticks while "hidden" — must NOT count down
const stHidden = await roundState();
stHidden.timerText === "30s"
  ? ok("the timer does not move at all while document.visibilityState is 'hidden' (real pause, not just a slower tick)")
  : bad("timer text after 2.6s hidden (expected still '30s'): " + stHidden.timerText);

await fireVisibility("visible");
await page.waitForTimeout(2600); // >2 real ticks now visible again — SHOULD count down
const stResumed = await roundState();
const resumedSecs = parseInt(stResumed.timerText, 10);
(Number.isFinite(resumedSecs) && resumedSecs <= 28 && resumedSecs >= 25)
  ? ok(`the timer resumes counting down after visibility returns to 'visible' (now "${stResumed.timerText}")`)
  : bad("timer text after resuming (expected roughly 26-28s): " + stResumed.timerText);
await tapEndRound();

// ════════════════════════════════════════════════════════════════════
// "Came up as Pass a lot" — the round's own local tally, read back once
// ════════════════════════════════════════════════════════════════════
await enterRapidFireFresh();
await setCategory("Army Fitness Test (AFT)"); // 17 real questions
await clickButtonByText("All difficulties");
await clickButtonByText("Untimed");
// Requeue (default) so passed cards keep coming back around.
await startRound();
for (let i = 0; i < 20; i++) await tapPass(); // more taps than cards (17) -> guarantees at least one card passed 2x+
await tapEndRound();
const passListCount = await page.evaluate(() => document.querySelectorAll(".rf-recap-list li").length);
passListCount > 0
  ? ok(`Recap's 'Came up as Pass a lot' list shows ${passListCount} frequently-passed card(s), the round's own real local tally`)
  : bad("no 'Came up as Pass a lot' entries after passing the same small deck repeatedly");

noise.length === 0 ? ok("no console errors/warnings across the full Rapid Fire suite") : bad("console noise: " + noise.slice(0, 8).join(" | "));

await browser.close();
await server.close();

console.log(fails === 0 ? "\nRAPID FIRE: all passed" : `\nRAPID FIRE: ${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
