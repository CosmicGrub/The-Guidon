/**
 * Board Drill's SRS/leech mastery signal reaching Home's "Weak areas" banner
 * and Progress's "Do these next" priority queue (audit finding, new-
 * features lens): both previously read ONLY boardQuiz:best (Quiz mode
 * scores), so a Soldier who studies mainly via Board Drill flashcards -
 * never touching Quiz mode - got an empty or misleading panel on both
 * screens despite Board Drill's own leech data being the richest "what
 * does this Soldier not know" signal in the app. Seeds real leeched srs:
 * rows for one category (no boardQuiz:best rows at all, to prove the
 * signal is genuinely SRS-derived, not quiz-derived) and drives both
 * screens through the real UI.
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

async function dismissOnboarding() {
  const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guestCard.count()) {
    await guestCard.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await dismissOnboarding();

// Seed: a board date within 7 days (Home's weak-areas panel is gated on
// this), and 3 leeched srs: rows all in the SAME real category - misses
// >= 4 is G.board.isLeech()'s own threshold. No boardQuiz:best rows exist
// anywhere, so any weak-area signal that shows up can only have come from
// this SRS data, not Quiz mode.
const SEED_LEECHES = 3;
const seeded = await page.evaluate(async (n) => {
  const boardDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await window.G.store.setSetting("boardDate", boardDate);
  const qs = window.G.store.boardQuestions();
  const cat = qs[0].category;
  const sameCat = qs.filter((q) => q.category === cat).slice(0, n);
  for (const q of sameCat) {
    await window.G.db.put("kv", { k: "srs:" + q.id, v: { reps: 5, ease: 2.3, interval: 1, due: 0, misses: 5 } });
  }
  return { cat, count: sameCat.length };
}, SEED_LEECHES);
seeded.count === SEED_LEECHES ? ok("Seeded " + SEED_LEECHES + " leeched srs: rows in category '" + seeded.cat + "'") : bad("only found " + seeded.count + " questions in the seed category");

// ---- Home: the leech-derived entry appears in the weak-areas banner ----
// No reload here (unlike the Settings test's profile-cache scenario) - a
// reload re-runs onboarding for a guest session, which starts a fresh
// session and discards the seeded boardDate. A same-session hash
// navigation is enough to prove this isn't just in-memory render state,
// since Home's own render() is a fresh call reading store.settings() and
// G.db.all("kv") each time.
//
// The onboarding overlay's own completion callback already lands on
// "#/home" via a direct route() call (index.html's app.start()), so by
// the time seeding above runs, location.hash is ALREADY "#/home" -
// setting it to the same value is a same-value assignment and does NOT
// fire "hashchange" (the router's only re-render trigger besides that one
// direct boot-time call). Hopping to a different route first guarantees a
// real hashchange back into Home, so it re-renders and actually reads the
// seeded boardDate/srs: data instead of showing its pre-seed boot render.
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(400);
// The weak-areas panel renders via its own un-awaited async IIFE (a real
// db.all("kv") scan), so wait for it rather than a fixed sleep.
await page.locator(".eyebrow", { hasText: /Weak areas to hit/i }).waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
// Query the panel itself (not document.body) - <noscript>'s fallback text
// is part of the DOM's textContent even with JS enabled, and pollutes any
// whole-body text match.
const weakPanelText = await page.evaluate(() => {
  const eyebrow = Array.from(document.querySelectorAll(".eyebrow")).find((n) => /Weak areas to hit/i.test(n.textContent || ""));
  return eyebrow ? eyebrow.closest(".panel").textContent : null;
});
weakPanelText && new RegExp(seeded.cat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(weakPanelText)
  ? ok("Home's weak-areas panel names the leeched category ('" + seeded.cat + "')")
  : bad("Weak-areas panel missing or doesn't name the category: " + weakPanelText);
weakPanelText && new RegExp(SEED_LEECHES + "\\s*leech").test(weakPanelText)
  ? ok("Home's weak-areas panel shows the real leech count (" + SEED_LEECHES + "), not a fabricated percentage")
  : bad("leech count text not found in the weak-areas panel: " + weakPanelText);

// ---- Progress: the same signal reaches "Do these next" ----
await page.evaluate(() => { location.hash = "#/progress"; });
await page.waitForTimeout(600);
const progressText = await page.evaluate(() => document.body.textContent || "");
/Do these next/.test(progressText) ? ok("Progress's priority queue panel renders") : bad("'Do these next' heading not found on Progress");
/Board Drill/.test(progressText) && new RegExp("Focus:\\s*" + seeded.cat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(progressText)
  ? ok("Progress's priority queue includes a Board Drill entry naming the specific weak category")
  : bad("no category-specific Board Drill priority found: " + progressText.slice(0, 600));

// Clicking it should navigate to Board Drill with the category filter set.
// G.board._filterCat is a one-shot flag - Board Drill's own render() reads
// it into the visible category <select> and immediately clears it back to
// null (same pattern the Readiness tab's "Drill <category>" button uses),
// so the real, durable proof is the select's own value, not the flag.
const focusRow = page.locator(".prog-pri-row", { hasText: /Focus:/ });
if (await focusRow.count()) {
  await focusRow.locator("button", { hasText: /Go/ }).click();
  await page.waitForTimeout(600);
  const catSelValue = await page.locator('select[aria-label="Filter by category"]').first().inputValue().catch(() => null);
  catSelValue === seeded.cat
    ? ok("Clicking the Board Drill priority navigates to Board Drill with the category filter actually applied")
    : bad("category filter select shows '" + catSelValue + "', expected '" + seeded.cat + "'");
} else {
  bad("could not find the Board Drill priority row to click");
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nWEAK AREAS: all passed");
process.exit(fails ? 1 : 0);
