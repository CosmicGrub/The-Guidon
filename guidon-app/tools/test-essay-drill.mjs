/**
 * Roadmap audit round 5, "Test Coverage Gaps" bucket: the Essay word-count
 * & rubric drill (#/drills -> "Essay word-count & rubric", essayDrill() in
 * js "drills.js") had zero test coverage for its live target-range
 * messaging or its debounced draft persistence. test-flush-on-background.mjs
 * even lists "drills:essay" in its own header comment as one of the ~7
 * util.onFlush registrants this whole app has, but its actual body only
 * ever drives the "ppw" registrant - confirmed by reading that file before
 * writing this one.
 *
 * Real TARGETS confirmed from source (essayDrill(), src/index.html):
 *   cc  (default-selected): min 250, max 750  - Compare & Contrast
 *   inf: min 750, max 1250 - Informative essay
 * count() renders the exact strings "Short by N words.", "Over by N
 * words — Concision is a scored standard.", and "Inside the required
 * range." depending on where the live word count falls against the
 * SELECTED assignment's [min,max]. Draft persistence: doPersistEssay()
 * writes {essayKey, essayText} into the SAME kv row (KEY =
 * "guidon:drills:v1") the CIT/brief-rubric checklists already use,
 * debounced 1500ms via persistEssayDebounced() and also registered as
 * util.onFlush("drills:essay", ...) so a backgrounded tab still saves.
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

const DRILLS_KEY = "guidon:drills:v1";
// Clean slate regardless of anything a prior test left in this shared kv row.
await page.evaluate((k) => window.G.db.put("kv", { k, v: {} }), DRILLS_KEY);

async function openEssayDrill() {
  await page.evaluate(() => { location.hash = "#/drills"; });
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: /Essay word-count & rubric/ }).click();
  await page.waitForTimeout(300);
}
await openEssayDrill();

const ta = page.locator('textarea[aria-label="Paste or draft your essay here"]');
(await ta.count()) === 1 ? ok("the essay drill's textarea renders") : bad("essay textarea count: " + (await ta.count()));

function words(n) { return Array(n).fill("word").join(" "); }

// ==================== 1) Word-count math + exact message text, per target ("cc": 250–750) ====================
await ta.fill(words(200)); // short by 50
await page.waitForTimeout(150);
let note = await page.locator(".panel .hint").first().textContent();
note === "Short by 50 words." ? ok("200 words against the 250–750 'cc' target shows the exact 'Short by 50 words.' message") : bad("note at 200 words: " + JSON.stringify(note));

await ta.fill(words(800)); // over by 50
await page.waitForTimeout(150);
note = await page.locator(".panel .hint").first().textContent();
note === "Over by 50 words — Concision is a scored standard."
  ? ok("800 words against the 250–750 'cc' target shows the exact 'Over by 50 words — Concision is a scored standard.' message")
  : bad("note at 800 words: " + JSON.stringify(note));

await ta.fill(words(500)); // inside range
await page.waitForTimeout(150);
note = await page.locator(".panel .hint").first().textContent();
note === "Inside the required range." ? ok("500 words against the 250–750 'cc' target shows the exact 'Inside the required range.' message") : bad("note at 500 words: " + JSON.stringify(note));

const wordsOut = await page.locator(".stat .v").first().textContent();
wordsOut.startsWith("500") && /250.?750/.test(wordsOut)
  ? ok("the live word-count readout shows the actual count and the 'cc' target range (250–750)")
  : bad("word-count readout: " + JSON.stringify(wordsOut));

// ==================== 2) Switching the assignment select updates the target range ====================
const sel = page.locator('select[aria-label="Assignment"]');
await sel.selectOption("inf"); // Informative essay: 750–1250
await page.waitForTimeout(150);
const wordsOutAfterSwitch = await page.locator(".stat .v").first().textContent();
/750.?1250/.test(wordsOutAfterSwitch)
  ? ok("switching the Assignment select to 'Informative essay' updates the live target range to 750–1250")
  : bad("word-count readout after switching assignment: " + JSON.stringify(wordsOutAfterSwitch));
// Same 500-word text is now short against the NEW 750–1250 target.
const noteAfterSwitch = await page.locator(".panel .hint").first().textContent();
noteAfterSwitch === "Short by 250 words." ? ok("the same 500-word draft is correctly re-evaluated as 'Short by 250 words.' against the new target") : bad("note after switching assignment: " + JSON.stringify(noteAfterSwitch));

// ==================== 3) Debounced draft persistence survives a backgrounded tab ====================
// Switch back to "cc" and type a fresh, distinctive draft so this section's
// assertions aren't just re-confirming section 1/2's leftover state.
await sel.selectOption("cc");
await page.waitForTimeout(150);
const DRAFT_TEXT = words(300) + " distinctive-essay-draft-marker";
await ta.fill(DRAFT_TEXT);
// Fires the "input" listener, which calls persistEssayDebounced() - that
// only starts a 1500ms setTimeout, it does NOT write to kv yet.
await ta.dispatchEvent("input");

// Simulate the tab backgrounding WITHOUT waiting for the 1500ms debounce to
// elapse on its own first - document.visibilityState is normally read-only/
// tied to the real OS, so override the property descriptor and dispatch the
// event by hand, the same technique test-flush-on-background.mjs already
// established for this exact API (and the one its own header says every
// util.onFlush registrant, "drills:essay" included, exists to be exercised
// with).
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
// Only long enough for the flush callback's own async G.db.put() to
// resolve - well under the 1500ms debounce window, so the field's natural
// setTimeout never gets a chance to fire on its own before the reload below
// tears down this whole JS context (and its still-pending timer) out from
// under it.
await page.waitForTimeout(200);

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1000);
// A reload re-runs onboarding for a guest session (the profile is
// in-memory only) - dismiss it again before touching #/drills underneath it
// (same idiom test-flush-on-background.mjs's own reload step establishes).
const guestCard2 = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard2.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard2.count()) {
  await guestCard2.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);
await openEssayDrill();

const taAfterReload = await page.locator('textarea[aria-label="Paste or draft your essay here"]').inputValue();
taAfterReload === DRAFT_TEXT
  ? ok("visibilitychange->hidden flushed the in-flight debounced essay draft before its 1500ms timer ever got a chance to fire on its own, and the text survived a reload")
  : bad("essay textarea after flush+reload: expected the distinctive draft text, got: " + JSON.stringify(taAfterReload.slice(0, 80)));
const selAfterReload = await page.locator('select[aria-label="Assignment"]').inputValue();
selAfterReload === "cc" ? ok("the selected assignment ('cc') also survived the flush+reload") : bad("assignment select after flush+reload: " + JSON.stringify(selAfterReload));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

// cleanup
await page.evaluate((k) => window.G.db.put("kv", { k, v: {} }), DRILLS_KEY);

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nESSAY DRILL: all passed");
process.exit(fails ? 1 : 0);
