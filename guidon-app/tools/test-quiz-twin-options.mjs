/**
 * Board Drill's Quiz must never offer two options that read the same.
 *
 * The defect (audit finding C27): buildDistractors() in src/index.html
 * de-duplicated answer options on trim().toLowerCase() only. Two cards in
 * one category whose answers differed by nothing but a trailing comma were
 * therefore offered side by side; a Soldier who picked the look-alike was
 * marked Incorrect and a "Needs Help" grade was written to that card's real
 * review record. It shipped with three line-recall cards that have since
 * been removed for an unrelated reason (they quoted a song GUIDON may not
 * bundle), so this suite brings its own look-alike cards instead of leaning
 * on whatever content happens to be in the bank this month.
 *
 * How: four-plus synthetic cards are pushed into window.GUIDON_SEED before
 * the app starts (an init script's DOMContentLoaded listener is registered
 * before any page script, so it runs before the app's own), in a category of
 * their own. Nothing in the app is stubbed - the real Quiz tab draws the
 * real options through the real buildDistractors(). On the old code every
 * look-alike question here is GUARANTEED to show its twin (the category
 * holds only two other answers, and three wrong options are needed), so the
 * first assertion below cannot pass by luck.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const CATEGORY = "ZZ Look-alike Check";
const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.addInitScript((category) => {
  document.addEventListener("DOMContentLoaded", () => {
    const bank = window.GUIDON_SEED && window.GUIDON_SEED.board && window.GUIDON_SEED.board.questions;
    if (!Array.isArray(bank)) return;
    const mk = (id, q, a) => ({ id, category, q, a, boardAnswer: a, source: "Test fixture", concept: "Look-alike check", keyPoints: [a], difficulty: "basic" });
    bank.push(
      mk("zz-twin-a", "Look-alike question one?", "Alpha bravo charlie delta echo,"),
      mk("zz-twin-b", "Look-alike question two?", "Alpha bravo charlie delta echo"),
      mk("zz-twin-e", "Look-alike question three?", "Alpha  bravo charlie delta echo."),
      mk("zz-plain-c", "Plain question one?", "Foxtrot golf hotel india juliet."),
      mk("zz-plain-d", "Plain question two?", "Kilo lima mike november oscar.")
    );
  });
}, CATEGORY);

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);

const injected = await page.evaluate((category) => window.G.store.boardQuestions().filter((q) => q.category === category).length, CATEGORY);
injected === 5
  ? ok("the five fixture cards reached the app's real question bank before it started")
  : bad("fixture cards did not reach store.boardQuestions(): found " + injected);

await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(600);
await page.locator("button", { hasText: /^Quiz$/ }).click();
await page.waitForTimeout(400);
await page.locator('select[aria-label="Filter by category"]').selectOption(CATEGORY);
await page.locator("button", { hasText: /^Start Quiz$/ }).click();
await page.waitForTimeout(400);

// The same "reads the same" rule a person applies: case, spacing and
// trailing punctuation do not make two answers different.
const reads = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").replace(/[\s.,;:!?]+$/, "").trim();

let lookAlikeQuestions = 0, clashes = [], wrongful = [];
for (let i = 0; i < 5; i++) {
  const shown = await page.evaluate(() => ({
    prompt: (document.querySelector(".quiz-card .prompt") || {}).textContent || "",
    options: Array.from(document.querySelectorAll(".quiz-card .quiz-opt-text")).map((s) => s.textContent),
  }));
  if (shown.options.length !== 4) { bad(`question ${i + 1} ("${shown.prompt}") drew ${shown.options.length} options, expected 4`); break; }
  const truth = await page.evaluate((prompt) => {
    const q = window.G.store.boardQuestions().find((x) => x.q === prompt);
    return q ? { id: q.id, answer: q.acceptableAnswer || q.a } : null;
  }, shown.prompt);
  if (!truth) { bad("could not match the on-screen prompt to a card: " + shown.prompt); break; }
  if (/^zz-twin-/.test(truth.id)) lookAlikeQuestions++;

  const keys = shown.options.map(reads);
  if (new Set(keys).size !== keys.length) clashes.push({ card: truth.id, options: shown.options });

  // Answer the way a Soldier would: tap the first option that reads like
  // the right answer. With a twin on screen that is a coin flip the old
  // code could lose; with no twin it is always the correct button.
  const pick = keys.indexOf(reads(truth.answer));
  await page.locator(".quiz-card .quiz-opt").nth(pick).click();
  await page.waitForTimeout(150);
  const result = await page.evaluate(async (id) => {
    const row = await window.G.db.get("kv", "srs:" + id);
    return { feedback: (document.querySelector(".quiz-feedback") || {}).textContent || "", graded: !!(row && row.v) };
  }, truth.id);
  if (!/^Correct/.test(result.feedback) || result.graded) wrongful.push({ card: truth.id, feedback: result.feedback, reviewRowWritten: result.graded });

  await page.locator(".quiz-next-btn").click();
  await page.waitForTimeout(700);
}

lookAlikeQuestions === 3
  ? ok("the quiz really asked all three look-alike cards")
  : bad("expected the three look-alike cards to come up, saw " + lookAlikeQuestions);
clashes.length === 0
  ? ok("no question ever showed two options that read the same (trailing punctuation and spacing ignored)")
  : bad("two options that read the same were offered side by side: " + JSON.stringify(clashes));
wrongful.length === 0
  ? ok("tapping the answer that reads correct is always marked Correct, and no \"Needs Help\" grade is written to the card's review record")
  : bad("a right-reading answer was marked wrong, or a review grade was written for it: " + JSON.stringify(wrongful));

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
overflow <= 0 ? ok("no sideways scrolling at phone width (390px)") : bad("page is " + overflow + "px wider than the 390px screen");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors or warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nQUIZ LOOK-ALIKE OPTIONS: all passed");
process.exit(fails ? 1 : 0);
