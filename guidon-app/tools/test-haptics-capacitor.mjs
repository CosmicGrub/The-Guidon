/**
 * util.haptic(kind) (src/index.html) - the @capacitor/haptics migration's
 * native call path, for both of its real call sites: Board Drill grading
 * (grade()) and Quiz feedback (selectOption()).
 *
 * test-board-drill-grading.mjs already covers util.haptic()'s WEB fallback
 * branch (navigator.vibrate directly) for Board Drill grading - it spies on
 * navigator.vibrate in a plain browser context, where window.Capacitor is
 * absent, exactly like every other test in this suite. What nothing
 * exercised before this file:
 *
 *   1. The actual @capacitor/haptics call path - Cap.Plugins.Haptics
 *      .notification({type}) - for EITHER touchpoint. Mutating that branch
 *      (wrong method, wrong type string, or deleting the call outright)
 *      built clean and passed every existing suite, because nothing ever
 *      stood up a Haptics plugin mock to observe it.
 *   2. Quiz feedback's fallback branch at all - test-board-drill-grading.mjs
 *      only drives Board Drill's grade buttons, never Quiz's answer flow.
 *   3. That once Cap.Plugins.Haptics is present, the OLD navigator.vibrate()
 *      call site is genuinely gone - not just "also still firing" behind
 *      the new one (util.haptic()'s own `if (Haptics) { ...; return; }`
 *      shape means it should be, but nothing asserted zero vibrate() calls
 *      when the plugin mock answers).
 *
 * Mocking convention matches test-native-download.mjs (this suite's
 * established pattern for stubbing a Capacitor plugin): assign a fake
 * `window.Capacitor = { Plugins: { <Name>: { <method>: spy } } }` inside
 * page.evaluate, drive the real UI, then inspect the spy's captured calls -
 * not a source-string check.
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

/** Installs a fresh Haptics plugin mock + navigator.vibrate spy, both
 *  readable back via window.__hapticsCalls / window.__vibrateCalls. */
async function mockCapacitorHaptics() {
  await page.evaluate(() => {
    window.__hapticsCalls = [];
    window.__vibrateCalls = [];
    window.Capacitor = { Plugins: { Haptics: {
      notification: (opts) => { window.__hapticsCalls.push(opts); return Promise.resolve(); },
    } } };
    navigator.vibrate = (pattern) => { window.__vibrateCalls.push(pattern); return true; };
  });
}
async function readSpies() {
  return page.evaluate(() => ({ haptics: window.__hapticsCalls.slice(), vibrate: window.__vibrateCalls.slice() }));
}
async function clearCapacitor() {
  await page.evaluate(() => { delete window.Capacitor; });
}

/* ============================================================ PART 1 ===
   Board Drill grading, Capacitor Haptics mocked as present (the "native"
   branch). */
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
  await mockCapacitorHaptics();

  // grade 2 ("Know It") -> gradeLevel>=2 -> "success" -> NotificationType.Success.
  const r1 = await flipAndGrade("qz-grade-2");
  r1.flipped && r1.clicked ? ok("Board Drill: card flips and 'Know It' (grade 2) is clickable") : bad("Board Drill: could not flip/grade the first card");
  const s1 = await readSpies();
  s1.haptics.length === 1 && s1.haptics[0] && s1.haptics[0].type === "SUCCESS"
    ? ok("Board Drill grade 2 ('Know It') calls Capacitor Haptics.notification({type:'SUCCESS'}) exactly once")
    : bad("Board Drill grade 2: expected one Haptics.notification({type:'SUCCESS'}) call, got " + JSON.stringify(s1.haptics));
  s1.vibrate.length === 0
    ? ok("Board Drill grade 2: navigator.vibrate() is NOT called once Capacitor Haptics is present")
    : bad("Board Drill grade 2: navigator.vibrate() fired " + s1.vibrate.length + " time(s) even though Haptics plugin was present: " + JSON.stringify(s1.vibrate));

  // grade 0 ("Needs Help") -> gradeLevel<2 -> "warning" -> NotificationType.Warning, on the next card.
  const r2 = await flipAndGrade("qz-grade-0");
  r2.flipped && r2.clicked ? ok("Board Drill: second card flips and 'Needs Help' (grade 0) is clickable") : bad("Board Drill: could not flip/grade the second card");
  const s2 = await readSpies();
  s2.haptics.length === 2 && s2.haptics[1] && s2.haptics[1].type === "WARNING"
    ? ok("Board Drill grade 0 ('Needs Help') calls Capacitor Haptics.notification({type:'WARNING'})")
    : bad("Board Drill grade 0: expected a second Haptics.notification({type:'WARNING'}) call, got " + JSON.stringify(s2.haptics));
  s2.vibrate.length === 0
    ? ok("Board Drill grade 0: navigator.vibrate() still NOT called (2 grades in, 0 vibrate() calls total)")
    : bad("Board Drill grade 0: navigator.vibrate() fired " + s2.vibrate.length + " time(s) even though Haptics plugin was present: " + JSON.stringify(s2.vibrate));

  await clearCapacitor();
} else {
  bad("Board Drill: skipped Capacitor Haptics assertions, no flashcard to grade");
}

/* ============================================================ PART 2 ===
   Quiz feedback: both the Capacitor-mocked branch (new coverage) and the
   plain-web fallback branch (navigator.vibrate directly - never exercised
   for Quiz by any existing test), tied to the app's OWN "Correct!" /
   "Incorrect" verdict rather than a guessed option index, since the correct
   option's position is shuffled per question. */
async function openQuizTab() {
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Quiz");
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForTimeout(400);
  return clicked;
}
async function startQuiz() {
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Start Quiz");
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForTimeout(400);
  return clicked;
}
/** Clicks the first answer option and returns whether the app scored it
 *  correct, read from the real .quiz-feedback text the app itself wrote. */
async function answerFirstOption() {
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector(".quiz-opt");
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForTimeout(300);
  const feedback = await page.evaluate(() => {
    const f = document.querySelector(".quiz-feedback");
    return f ? f.textContent : null;
  });
  return { clicked, ok: !!feedback && feedback.indexOf("Correct!") === 0 };
}
async function clickNextQuestion() {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Next →|See Results/.test(b.textContent));
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
}

const quizTabOpened = await openQuizTab();
quizTabOpened ? ok("Quiz tab opens") : bad("Quiz tab button not found");

if (quizTabOpened) {
  const quizStarted = await startQuiz();
  const hasQuizCard = await page.evaluate(() => !!document.querySelector(".quiz-opt"));
  quizStarted && hasQuizCard ? ok("Quiz: Start Quiz renders a real question with answer options") : bad("Quiz: no question rendered after Start Quiz");

  if (hasQuizCard) {
    // 2a) Capacitor Haptics mocked - the native branch.
    await mockCapacitorHaptics();
    const a1 = await answerFirstOption();
    a1.clicked ? ok("Quiz: first answer option is clickable") : bad("Quiz: could not click an answer option");
    const qs1 = await readSpies();
    const expectType = a1.ok ? "SUCCESS" : "WARNING";
    qs1.haptics.length === 1 && qs1.haptics[0] && qs1.haptics[0].type === expectType
      ? ok("Quiz feedback (" + (a1.ok ? "correct" : "incorrect") + " answer) calls Capacitor Haptics.notification({type:'" + expectType + "'})")
      : bad("Quiz feedback: expected one Haptics.notification({type:'" + expectType + "'}) call matching the app's own '" + (a1.ok ? "Correct!" : "Incorrect") + "' verdict, got " + JSON.stringify(qs1.haptics));
    qs1.vibrate.length === 0
      ? ok("Quiz feedback: navigator.vibrate() is NOT called once Capacitor Haptics is present")
      : bad("Quiz feedback: navigator.vibrate() fired " + qs1.vibrate.length + " time(s) even though Haptics plugin was present: " + JSON.stringify(qs1.vibrate));
    await clearCapacitor();

    // 2b) No Capacitor at all - the plain-web fallback branch, exercised for
    // Quiz feedback for the first time (test-board-drill-grading.mjs already
    // covers this branch for Board Drill grading).
    await clickNextQuestion();
    const hasSecondCard = await page.evaluate(() => !!document.querySelector(".quiz-opt"));
    if (hasSecondCard) {
      await page.evaluate(() => {
        window.__vibrateCalls = [];
        navigator.vibrate = (pattern) => { window.__vibrateCalls.push(pattern); return true; };
      });
      const a2 = await answerFirstOption();
      const fallback = await page.evaluate(() => window.__vibrateCalls.slice());
      const expectPattern = a2.ok ? 30 : "30,30,30";
      const got = fallback.length ? (Array.isArray(fallback[0]) ? fallback[0].join(",") : fallback[0]) : null;
      String(got) === String(expectPattern)
        ? ok("Quiz feedback fallback (no Capacitor present): navigator.vibrate(" + JSON.stringify(expectPattern) + ") fires for a " + (a2.ok ? "correct" : "incorrect") + " answer, matching the app's own verdict")
        : bad("Quiz feedback fallback: expected navigator.vibrate(" + JSON.stringify(expectPattern) + "), got " + JSON.stringify(fallback));
    } else {
      bad("Quiz: no second question to test the fallback vibrate branch on");
    }
  }
} else {
  bad("Quiz: skipped feedback haptic assertions, tab never opened");
}

noise.length === 0 ? ok("no console errors/warnings across either branch") : bad("console noise: " + noise.join(" | "));

console.log(fails === 0 ? "\nHAPTICS (CAPACITOR): all passed" : `\nHAPTICS (CAPACITOR): ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
