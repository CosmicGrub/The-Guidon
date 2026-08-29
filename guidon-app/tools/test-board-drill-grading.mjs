/**
 * Board Drill's real flashcard grading UI: the flip -> grade() path that
 * util.haptic() lives on (src/index.html's grade() function, GRADE_DEFS
 * buttons .qz-grade-0..3).
 *
 * Written after a mutation-testing pass found two real, silent gaps in the
 * existing suite:
 *   - test-bridge.mjs only calls G.board.noteExternalResult(id, grade)
 *     directly - it never clicks the actual .qz-grade-btn UI, so grade()
 *     itself (and everything gated behind it, including util.haptic) was
 *     never exercised end-to-end. A gradeLevel>=2 -> gradeLevel>2 off-by-
 *     one mutation there built clean and passed every existing suite.
 *   - No test anywhere asserted WHICH haptic pattern a grade actually
 *     triggers. A mutation that swapped success/warning's patterns also
 *     built clean and passed every existing suite.
 *
 * This test drives the real UI (flip the real card, click the real grade
 * button) and spies on navigator.vibrate - the fallback path util.haptic()
 * takes in a plain browser (no window.Capacitor here, matching how every
 * other test in this suite runs) - to assert the exact pattern per grade,
 * not just "no exception was thrown."
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
await page.waitForTimeout(1100);
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1100);
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(1100);

// Spy on the fallback vibrate path - the real code path exercised in every
// browser-based test in this suite, since window.Capacitor doesn't exist
// here (that branch is covered separately by on-device CDP verification).
await page.evaluate(() => {
  window.__vibrateCalls = [];
  navigator.vibrate = (pattern) => { window.__vibrateCalls.push(pattern); return true; };
});

async function flipAndGrade(gradeCls) {
  await page.evaluate(() => document.querySelector(".qz-wrap")?.focus());
  await page.keyboard.press("Space");
  await page.waitForTimeout(500);
  const flipped = await page.evaluate(() => !!document.querySelector(".qz-card.flipped"));
  if (!flipped) return { flipped: false };
  const clicked = await page.evaluate((cls) => {
    const btn = document.querySelector(".qz-grade-btn." + cls);
    if (!btn) return false;
    btn.click();
    return true;
  }, gradeCls);
  await page.waitForTimeout(300);
  return { flipped: true, clicked };
}

const hasCard = await page.evaluate(() => !!document.querySelector(".qz-wrap"));
hasCard ? ok("#/board renders a real flashcard (.qz-wrap present)") : bad("#/board: no flashcard rendered");

if (hasCard) {
  // grade 2 ("Know It") - the exact >=2 boundary the off-by-one mutation flips.
  const r1 = await flipAndGrade("qz-grade-2");
  r1.flipped ? ok("card flips on Space") : bad("card did not flip");
  r1.clicked ? ok("'Know It' (grade 2) button clicked") : bad("'Know It' button not found");

  const afterKnowIt = await page.evaluate(() => window.__vibrateCalls.slice());
  const lastKnowIt = afterKnowIt[afterKnowIt.length - 1];
  lastKnowIt === 30
    ? ok("grade 2 ('Know It', the gradeLevel>=2 boundary) triggers the 'success' pattern (30)")
    : bad("grade 2 triggered vibrate(" + JSON.stringify(lastKnowIt) + "), expected 30 ('success')");

  // grade 0 ("Needs Help") - the clear warning case, on the next card.
  const r2 = await flipAndGrade("qz-grade-0");
  if (r2.flipped && r2.clicked) {
    const afterNeedsHelp = await page.evaluate(() => window.__vibrateCalls.slice());
    const lastNeedsHelp = afterNeedsHelp[afterNeedsHelp.length - 1];
    Array.isArray(lastNeedsHelp) && lastNeedsHelp.join(",") === "30,30,30"
      ? ok("grade 0 ('Needs Help') triggers the 'warning' pattern ([30,30,30])")
      : bad("grade 0 triggered vibrate(" + JSON.stringify(lastNeedsHelp) + "), expected [30,30,30] ('warning')");
  } else {
    bad("could not reach a second card to test grade 0 (flipped=" + r2.flipped + " clicked=" + r2.clicked + ")");
  }
}

// ─────────────────────────────────────────────────────────────────────
// Item 9 regression: grade() and the arrow-key nav handlers no longer
// strand keyboard focus on <body> after draw() tears down and rebuilds
// cardWrap's entire DOM (util.clear(cardWrap), in draw()). A keyboard-only
// user who Tabs to a grade/nav button (rather than using the 1-4 number-
// key shortcut) previously lost their place in page tab order on every
// single grade/nav action.
//
// Uses REAL keyboard Tab presses to reach the target button - not
// element.focus() on it directly - the same real-:focus-visible/keyboard-
// modality distinction tools/test-focus-rings-list-detail.mjs's own
// comment documents verifying (a script .focus() call also sets
// :focus-visible in this Chromium context, but a genuine Tab walk is used
// here anyway since what's under test is real Tab-reachability into a
// freshly-rebuilt subtree, not just "focus can land somewhere").
async function tabUntil(matchFn, maxTabs) {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(matchFn)) return true;
  }
  return false;
}
async function activeElementLabel() {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return "none";
    if (a === document.querySelector(".qz-wrap")) return "qz-wrap";
    if (a === document.body) return "body";
    return a.tagName + "." + Array.from(a.classList || []).join(".");
  });
}

if (hasCard) {
  // Re-anchor on cardWrap (same seed flipAndGrade() above already uses) and
  // flip via a real Space keypress so the grade row exists to Tab into.
  await page.evaluate(() => document.querySelector(".qz-wrap")?.focus());
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  const flippedForFocusTest = await page.evaluate(() => !!document.querySelector(".qz-card.flipped"));
  if (flippedForFocusTest) {
    const reachedGradeBtn = await tabUntil(
      () => !!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("qz-grade-btn")),
      15
    );
    if (reachedGradeBtn) {
      ok("real Tab navigation (not .focus()) reaches a .qz-grade-btn from cardWrap");
      await page.keyboard.press("Enter"); // real keyboard activation -> click -> grade() -> draw()
      await page.waitForTimeout(300);
      const afterGrade = await activeElementLabel();
      afterGrade === "qz-wrap"
        ? ok("Item 9: grading via a real Tab-focused grade button + Enter leaves focus on .qz-wrap, not <body>")
        : bad("Item 9: expected focus on .qz-wrap after grading, got: " + afterGrade);
    } else {
      bad("could not reach a .qz-grade-btn via real Tab navigation within 15 tabs");
    }
  } else {
    bad("could not flip a card to set up the Item 9 focus-after-grade test");
  }

  // Arrow-key nav: Tab to the real "Next card" button (Board Drill's own
  // prev/next arrows in .qz-nav-row) and press ArrowRight for real while it
  // holds focus - draw()'s rebuild previously destroyed that very button
  // without ever restoring focus afterward.
  const reachedNextBtn = await tabUntil(
    () => !!(document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute("aria-label") === "Next card"),
    15
  );
  if (reachedNextBtn) {
    ok("real Tab navigation reaches the 'Next card' nav button from cardWrap");
    await page.keyboard.press("ArrowRight"); // real keyboard arrow-nav, matches the app's own ArrowLeft/ArrowRight shortcut
    await page.waitForTimeout(300);
    const afterNav = await activeElementLabel();
    afterNav === "qz-wrap"
      ? ok("Item 9: arrow-key nav (ArrowRight) from a real Tab-focused nav button leaves focus on .qz-wrap, not <body>")
      : bad("Item 9: expected focus on .qz-wrap after arrow-nav, got: " + afterNav);
  } else {
    bad("could not reach the 'Next card' nav button via real Tab navigation within 15 tabs");
  }
}

noise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + noise.join(" | "));

console.log(fails === 0 ? "\nBOARD DRILL GRADING: all passed" : `\nBOARD DRILL GRADING: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
