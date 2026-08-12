/**
 * Mock Board: the tab-gated live-drill mode sits behind a client-side tab
 * click, so the generic route sweep never renders it - no suite of any kind
 * (structural or functional) exercised the shipped rubric-weighted scoring,
 * the self-rating sliders, or the per-session history persistence before
 * this. Covers the exact regressions found and fixed this same week:
 * history saving only the first board per sitting, and locking in the
 * default self-rating instead of the Soldier's actual slider input.
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
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);

// Bypass onboarding via a guest session.
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

await page.evaluate(() => { window.G.db.setSetting("board:mockHistory:v1", []); });
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(600);
await page.locator("button", { hasText: /^Mock Board$/ }).click();
await page.waitForTimeout(400);

const setupVisible = await page.evaluate(() => /Set up your board/i.test(document.body.textContent || ""));
setupVisible ? ok("Mock Board tab renders the setup panel") : bad("setup panel not found");

async function playOneBoard(selfRatingValue) {
  await page.locator("select").first().selectOption("5"); // 5 questions, fast
  await page.locator("button.mb-start", { hasText: /begin board/i }).click();
  await page.waitForTimeout(300);
  await page.locator("button", { hasText: /I've reported/i }).click();
  await page.waitForTimeout(300);
  for (let i = 0; i < 5; i++) {
    await page.locator("button.mb-reveal", { hasText: /reveal answer/i }).click();
    await page.waitForTimeout(120);
    await page.locator("button.mb-score-btn").first().click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  if (selfRatingValue != null) {
    const sliders = page.locator("input[type=range]");
    const n = await sliders.count();
    for (let i = 0; i < n; i++) {
      await sliders.nth(i).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, selfRatingValue);
    }
    await page.waitForTimeout(400);
  }
}

// --- board 1: neutral self-rating ---
await playOneBoard(null);
const doneVisible = await page.evaluate(() => /After-Action Review/i.test(document.body.textContent || ""));
doneVisible ? ok("finishing a board reaches the After-Action Review scorecard") : bad("scorecard not shown");

const rubricVisible = await page.evaluate(() => /Board rubric/i.test(document.body.textContent || ""));
rubricVisible ? ok("scorecard shows the Board rubric dimension breakdown") : bad("Board rubric section missing");

const slidersVisible = await page.evaluate(() => document.querySelectorAll('input[type=range]').length >= 3);
slidersVisible ? ok("three self-rating sliders (bearing/communication/appearance) render") : bad("self-rating sliders missing");

const hist1 = await page.evaluate(async () => (await window.G.db.get("kv", "board:mockHistory:v1")).v || []);
hist1.length === 1 ? ok("completing board 1 saves exactly one history entry") : bad("history length after board 1: " + hist1.length);

// --- board 2: rate self at max, then start a new board ---
await page.locator("button.btn.primary", { hasText: /new board/i }).click();
await page.waitForTimeout(300);
await playOneBoard(5);
const hist2 = await page.evaluate(async () => (await window.G.db.get("kv", "board:mockHistory:v1")).v || []);
hist2.length === 2 ? ok("'New board' resets history tracking - board 2 also saves (was silently dropped)") : bad("history length after board 2: " + hist2.length);
(hist2.length === 2 && hist2[1].pct > hist1[0].pct)
  ? ok("board 2's saved score reflects the 5/5/5 self-rating, not the locked 3/3/3 default")
  : bad("board 2 pct (" + (hist2[1] && hist2[1].pct) + ") not higher than board 1 pct (" + hist1[0].pct + ")");

// --- print scorecard includes the rubric breakdown ---
await page.evaluate(() => { window.print = () => {}; });
await page.locator("button", { hasText: /print scorecard/i }).click();
await page.waitForTimeout(400);
const printedRubric = await page.evaluate(() => {
  const h = document.querySelector("#print-holder");
  return h ? /Board rubric/i.test(h.innerHTML) : false;
});
printedRubric ? ok("printed scorecard includes the Board rubric section") : bad("printed scorecard missing the rubric breakdown");

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `MOCKBOARD: ${fails} FAILURE(S)` : "MOCKBOARD: all passed"));
process.exit(fails ? 1 : 0);
