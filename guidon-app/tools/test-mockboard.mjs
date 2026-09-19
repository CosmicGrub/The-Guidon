/**
 * Mock Board: the tab-gated live-drill mode sits behind a client-side tab
 * click, so the generic route sweep never renders it - no suite of any kind
 * (structural or functional) exercised the shipped rubric-weighted scoring,
 * the self-rating sliders, or the per-session history persistence before
 * this. Covers the exact regressions found and fixed this same week:
 * history saving only the first board per sitting, and locking in the
 * default self-rating instead of the Soldier's actual slider input.
 */
import { bootApp, ok, bad, finish, waitForRoute, clickWhenStable, until, expectNoConsoleNoise } from "./testkit.mjs";

// Guest session, past onboarding.
const { page, noise } = await bootApp();

const history = () => page.evaluate(async () => ((await window.G.db.get("kv", "board:mockHistory:v1")) || {}).v || []);

await page.evaluate(() => window.G.db.setSetting("board:mockHistory:v1", []));
await waitForRoute(page, "#/board", { ready: page.locator("button", { hasText: /^Mock Board$/ }) });
await clickWhenStable(page, page.locator("button", { hasText: /^Mock Board$/ }));
await until(page, () => !!document.querySelector("button.mb-start"));

const setupVisible = await page.evaluate(() => /Set up your board/i.test(document.body.textContent || ""));
setupVisible ? ok("Mock Board tab renders the setup panel") : bad("setup panel not found");

async function playOneBoard(selfRatingValue) {
  await page.locator("select").first().selectOption("5"); // 5 questions, fast
  // Every step below redraws the panel, so each click waits for ITS button
  // to be on screen and at rest - the Reveal button hides itself when used
  // and each new question brings a new one, which is what paces the loop.
  await clickWhenStable(page, page.locator("button.mb-start", { hasText: /begin board/i }));
  await clickWhenStable(page, page.locator("button", { hasText: /I've reported/i }));
  for (let i = 0; i < 5; i++) {
    await clickWhenStable(page, page.locator("button.mb-reveal", { hasText: /reveal answer/i }));
    await clickWhenStable(page, page.locator("button.mb-score-btn").first());
  }
  await until(page, () => /After-Action Review/i.test(document.body.textContent || "") && document.querySelectorAll("input[type=range]").length >= 3);
  if (selfRatingValue != null) {
    const sliders = page.locator("input[type=range]");
    const n = await sliders.count();
    for (let i = 0; i < n; i++) {
      await sliders.nth(i).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, selfRatingValue);
    }
  }
}

// --- board 1: neutral self-rating ---
await playOneBoard(null);
await until(page, async () => (((await window.G.db.get("kv", "board:mockHistory:v1")) || {}).v || []).length === 1);
const doneVisible = await page.evaluate(() => /After-Action Review/i.test(document.body.textContent || ""));
doneVisible ? ok("finishing a board reaches the After-Action Review scorecard") : bad("scorecard not shown");

const rubricVisible = await page.evaluate(() => /Board rubric/i.test(document.body.textContent || ""));
rubricVisible ? ok("scorecard shows the Board rubric dimension breakdown") : bad("Board rubric section missing");

const slidersVisible = await page.evaluate(() => document.querySelectorAll('input[type=range]').length >= 3);
slidersVisible ? ok("three self-rating sliders (bearing/communication/appearance) render") : bad("self-rating sliders missing");

const hist1 = await history();
hist1.length === 1 ? ok("completing board 1 saves exactly one history entry") : bad("history length after board 1: " + hist1.length);

// --- board 2: rate self at max, then start a new board ---
await clickWhenStable(page, page.locator("button.btn.primary", { hasText: /new board/i }));
await until(page, () => !!document.querySelector("button.mb-start"));
await playOneBoard(5);
// The 5/5/5 self-rating is saved a moment after the sliders move.
await until(page, async (first) => { const h = ((await window.G.db.get("kv", "board:mockHistory:v1")) || {}).v || []; return h.length === 2 && h[1].pct > first; }, hist1[0] ? hist1[0].pct : 0, { timeout: 5000 });
const hist2 = await history();
hist2.length === 2 ? ok("'New board' resets history tracking - board 2 also saves (was silently dropped)") : bad("history length after board 2: " + hist2.length);
(hist2.length === 2 && hist2[1].pct > hist1[0].pct)
  ? ok("board 2's saved score reflects the 5/5/5 self-rating, not the locked 3/3/3 default")
  : bad("board 2 pct (" + (hist2[1] && hist2[1].pct) + ") not higher than board 1 pct (" + hist1[0].pct + ")");

// --- print scorecard includes the rubric breakdown ---
await page.evaluate(() => { window.print = () => {}; });
await clickWhenStable(page, page.locator("button", { hasText: /print scorecard/i }));
await until(page, () => { const h = document.querySelector("#print-holder"); return !!(h && h.innerHTML); }, null, { timeout: 5000 });
const printedRubric = await page.evaluate(() => {
  const h = document.querySelector("#print-holder");
  return h ? /Board rubric/i.test(h.innerHTML) : false;
});
printedRubric ? ok("printed scorecard includes the Board rubric section") : bad("printed scorecard missing the rubric breakdown");

expectNoConsoleNoise(noise, { pass: "no console errors/warnings" });
await finish("MOCKBOARD");
