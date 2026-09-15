/**
 * "5-Minute Board Reps" - ROADMAP.md §3f, Phase 1 ("a smarter query over
 * the existing SRS due/leech queues, not a new engine").
 *
 * What ships and what this proves, end to end through the real UI:
 *  - Home carries a "5-minute board reps" card (not-done state, "Start →")
 *    that opens Board Drill in reps mode via the one-shot G.board._filterReps
 *    flag (same convention as _filterCat/_filterDue).
 *  - Reps mode is a capped set of exactly REPS_SIZE (12) grades: a counter
 *    banner ("Card N of 12"), a progress bar that tracks grades against the
 *    set (aria-label "Reps progress"), and - unlike the open-ended deck - NO
 *    mid-set reinsertion of a missed card (a miss still schedules the card
 *    due-now, so it leads the next set instead).
 *  - Completing the set shows the tally panel, writes today's record under
 *    the shared G.board.repsKey() (accumulating across sets), and Home then
 *    shows the done-today state with "Another set →".
 *  - "Exit reps" / "Keep drilling" return to the ordinary wrap-around deck.
 *  - A direct #/board visit is untouched (no banner, "Deck progress").
 *  - Bonus fix shipped alongside: Home's "N board cards due → Drill" card
 *    now sets _filterDue so it actually lands on the due-only queue, the
 *    same promise Readiness's own "Drill N Due Now" button already keeps.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(800);

const findRepsCard = () => page.evaluate(() => {
  const c = Array.from(document.querySelectorAll(".card.click")).find((x) => /5-minute board reps|Today's reps done/i.test(x.textContent));
  return c ? { text: c.textContent.replace(/\s+/g, " ").trim(), label: c.getAttribute("aria-label") } : null;
});

/* ---- 1. Home: not-done state ---- */
const size = await page.evaluate(() => G.board.REPS_SIZE);
size === 12 ? ok("G.board.REPS_SIZE is 12 (~5 minutes at a flip-read-grade cadence)") : bad("REPS_SIZE = " + size);
let card = await findRepsCard();
(card && /5-minute board reps/.test(card.text) && /Start/.test(card.text) && /due ones first/.test(card.text))
  ? ok(`Home shows the reps card in its not-done state: "${card.text}"`)
  : bad("Home reps card (not-done) missing or wrong: " + JSON.stringify(card));
(card && /Start today's 5-minute board reps, 12 cards/.test(card.label || ""))
  ? ok("...with a descriptive aria-label for screen readers")
  : bad("reps card aria-label: " + JSON.stringify(card && card.label));

/* ---- 2. Start → Board Drill in reps mode ---- */
await page.evaluate(() => { Array.from(document.querySelectorAll(".card.click")).find((x) => /5-minute board reps/i.test(x.textContent)).click(); });
await page.waitForTimeout(1000);
const hash = await page.evaluate(() => location.hash);
hash === "#/board" ? ok("Start → lands on #/board") : bad("expected #/board, got " + hash);
const bannerText = () => page.evaluate(() => { const b = document.querySelector(".reps-banner"); return b ? b.textContent.replace(/\s+/g, " ").trim() : null; });
const trackLabel = () => page.evaluate(() => { const t = document.querySelector(".qz-progress-track"); return t ? t.getAttribute("aria-label") : null; });
let banner = await bannerText();
(banner && /Card 1 of 12/.test(banner)) ? ok(`reps banner shows "Card 1 of 12": "${banner}"`) : bad("reps banner: " + JSON.stringify(banner));
(await trackLabel()) === "Reps progress" ? ok('progress bar is the reps one ("Reps progress")') : bad("progress bar aria-label: " + JSON.stringify(await trackLabel()));
const flagCleared = await page.evaluate(() => G.board._filterReps == null);
flagCleared ? ok("one-shot _filterReps flag was consumed") : bad("_filterReps still set after render");

/* ---- 3. Grade exactly 12 cards, two of them misses, and prove no reinsertion ---- */
const frontText = () => page.evaluate(() => { const f = document.querySelector(".qz-front"); return f ? f.textContent.replace(/\s+/g, " ").trim() : null; });
const seq = [2, 2, 2, 0, 2, 2, 2, 0, 2, 2, 2, 2]; // 10 recalled, 2 missed
const shown = [];
let doneEarly = false;
for (let i = 0; i < seq.length; i++) {
  const f = await frontText();
  shown.push(f);
  const b = await bannerText();
  if (!(b && new RegExp("Card " + (i + 1) + " of 12").test(b))) bad(`before grade ${i + 1}: banner reads ${JSON.stringify(b)}, expected "Card ${i + 1} of 12"`);
  const clicked = await page.evaluate((g) => { const btns = document.querySelectorAll(".qz-grade-row .qz-grade-btn"); if (!btns[g]) return false; btns[g].click(); return true; }, seq[i]);
  if (!clicked) { bad(`grade ${i + 1}: no grade buttons found`); doneEarly = true; break; }
  await page.waitForTimeout(150);
}
if (!doneEarly) ok("banner counted every grade 1 → 12 in order");
// A miss at position 4 (index 3) would, in the open-ended deck, be spliced
// back in gap=max(2, ceil(12*.15))=2 cards later, i.e. it would be the
// card shown at index 5. In reps mode it must not reappear at all.
const missed = shown[3];
const reappeared = shown.slice(4).some((t) => t && t === missed);
(!reappeared && missed) ? ok("a missed card is NOT reinserted mid-set (12 distinct positions, no repeat of the card missed at #4)") : bad("missed card reappeared inside the set: " + JSON.stringify(missed));
const uniqueShown = new Set(shown.filter(Boolean)).size;
uniqueShown === 12 ? ok("all 12 cards in the set were distinct") : bad(`only ${uniqueShown} distinct cards across 12 positions: ${JSON.stringify(shown)}`);

const doneText = await page.evaluate(() => { const d = document.querySelector(".reps-done"); return d ? d.textContent.replace(/\s+/g, " ").trim() : null; });
(doneText && /10 \/ 12/.test(doneText) && /83%/.test(doneText))
  ? ok(`completion panel after the 12th grade: "${doneText.slice(0, 90)}…"`)
  : bad("completion panel: " + JSON.stringify(doneText));
const noCard = await page.evaluate(() => !document.querySelector(".qz-card"));
noCard ? ok("no further card is drawn once the set is complete") : bad("a card is still showing after completion");

/* ---- 4. the per-day record ---- */
const rec = await page.evaluate(async () => G.db.getSetting(G.board.repsKey(), null));
(rec && rec.sets === 1 && rec.cards === 12 && rec.recalled === 10 && typeof rec.ts === "number")
  ? ok("today's record written under G.board.repsKey(): " + JSON.stringify({ sets: rec.sets, cards: rec.cards, recalled: rec.recalled }))
  : bad("reps record: " + JSON.stringify(rec));
const keyShape = await page.evaluate(() => G.board.repsKey(new Date(2026, 0, 5)));
keyShape === "board:reps:2026-01-05" ? ok("repsKey() uses the LOCAL calendar date, zero-padded") : bad("repsKey(2026-01-05) = " + keyShape);

/* ---- 5. Another set ---- */
await page.evaluate(() => { Array.from(document.querySelectorAll(".reps-done button")).find((b) => /Another set/.test(b.textContent)).click(); });
await page.waitForTimeout(700);
banner = await bannerText();
const doneGone = await page.evaluate(() => !document.querySelector(".reps-done"));
(banner && /Card 1 of 12/.test(banner) && doneGone) ? ok('"Another set" starts a fresh 12-card set') : bad("after Another set: banner=" + JSON.stringify(banner) + " doneGone=" + doneGone);
// Complete a second set quickly (all Know It) so the record accumulates.
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => { document.querySelectorAll(".qz-grade-row .qz-grade-btn")[2].click(); });
  await page.waitForTimeout(120);
}
const rec2 = await page.evaluate(async () => G.db.getSetting(G.board.repsKey(), null));
(rec2 && rec2.sets === 2 && rec2.cards === 24 && rec2.recalled === 22)
  ? ok("second set ACCUMULATES into today's record (sets 2, cards 24, recalled 22) instead of overwriting it")
  : bad("record after second set: " + JSON.stringify(rec2));

/* ---- 6. Keep drilling → ordinary deck ---- */
await page.evaluate(() => { Array.from(document.querySelectorAll(".reps-done button")).find((b) => /Keep drilling/.test(b.textContent)).click(); });
await page.waitForTimeout(700);
const afterKeep = await page.evaluate(() => ({ banner: !!document.querySelector(".reps-banner"), label: document.querySelector(".qz-progress-track")?.getAttribute("aria-label"), card: !!document.querySelector(".qz-card") }));
(!afterKeep.banner && afterKeep.label === "Deck progress" && afterKeep.card)
  ? ok('"Keep drilling" returns to the ordinary deck (no banner, "Deck progress", a card showing)')
  : bad("after Keep drilling: " + JSON.stringify(afterKeep));

/* ---- 7. Home: done-today state ---- */
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(900);
card = await findRepsCard();
(card && /Today's reps done/.test(card.text) && /22\/24 recalled/.test(card.text) && /2 sets today/.test(card.text) && /Another set/.test(card.text))
  ? ok(`Home now shows the done-today state: "${card.text}"`)
  : bad("Home reps card (done) missing or wrong: " + JSON.stringify(card));
// ...and it still opens a fresh reps set, with the Exit control working.
await page.evaluate(() => { Array.from(document.querySelectorAll(".card.click")).find((x) => /Today's reps done/i.test(x.textContent)).click(); });
await page.waitForTimeout(1000);
banner = await bannerText();
(banner && /Card 1 of 12/.test(banner)) ? ok('"Another set →" from Home opens reps mode again') : bad("from Home (done state): banner=" + JSON.stringify(banner));
await page.evaluate(() => { document.querySelector(".reps-banner button").click(); });
await page.waitForTimeout(700);
const afterExit = await page.evaluate(() => ({ banner: !!document.querySelector(".reps-banner"), label: document.querySelector(".qz-progress-track")?.getAttribute("aria-label") }));
(!afterExit.banner && afterExit.label === "Deck progress") ? ok('"Exit reps" returns to the ordinary deck') : bad("after Exit reps: " + JSON.stringify(afterExit));

/* ---- 8. Bonus: Home's due-count card now drills the DUE queue ---- */
// Seed 5 due-now records (dueCount>=3 is the card's own display threshold)
// on a fresh context so the reps grading above can't muddy the count.
const page2 = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page2.on("pageerror", (e) => noise.push("pageerror(p2): " + e.message));
await page2.goto(url, { waitUntil: "load" });
await dismissOnboarding(page2);
const dueSeeded = await page2.evaluate(async () => {
  const ids = G.store.boardQuestions().slice(0, 5).map((q) => q.id);
  for (const id of ids) await G.db.put("kv", { k: "srs:" + id, v: { reps: 1, ease: 2.3, interval: 1, due: Date.now() - 60000, misses: 0, lastGrade: 2 } });
  return ids.length;
});
// Home already rendered (pre-seed) when onboarding closed; setting the same
// hash again fires no hashchange, so bounce through #/board to force a
// fresh Home render that sees the seeded rows.
await page2.evaluate(() => { location.hash = "#/board"; });
await page2.waitForTimeout(500);
await page2.evaluate(() => { location.hash = "#/home"; });
await page2.waitForTimeout(900);
const dueCard = await page2.evaluate(() => { const c = Array.from(document.querySelectorAll(".card.click")).find((x) => /board cards due for review/.test(x.textContent)); return c ? c.textContent.replace(/\s+/g, " ").trim() : null; });
(dueCard && new RegExp("^" + dueSeeded + " board cards due").test(dueCard)) ? ok(`Home due card shows the ${dueSeeded} seeded due cards: "${dueCard}"`) : bad("Home due card: " + JSON.stringify(dueCard));
const dueClicked = await page2.evaluate(() => { const c = Array.from(document.querySelectorAll(".card.click")).find((x) => /board cards due for review/.test(x.textContent)); if (!c) return false; c.click(); return true; });
if (!dueClicked) bad("could not click the Home due card (not rendered)");
await page2.waitForTimeout(1000);
const dueState = await page2.evaluate(() => { const chip = document.querySelector(".due-chip"); return { hash: location.hash, pressed: chip && chip.getAttribute("aria-pressed"), text: chip && chip.textContent.trim() }; });
(dueState.hash === "#/board" && dueState.pressed === "true")
  ? ok(`Home's "Drill →" on the due card lands on the DUE-ONLY queue (due chip pressed: "${dueState.text}")`)
  : bad("after Home due card click: " + JSON.stringify(dueState));

/* ---- 9. A direct #/board visit is untouched ---- */
const page3 = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page3.on("pageerror", (e) => noise.push("pageerror(p3): " + e.message));
await page3.goto(url, { waitUntil: "load" });
await dismissOnboarding(page3);
await page3.evaluate(() => { location.hash = "#/board"; });
await page3.waitForTimeout(900);
const plain = await page3.evaluate(() => ({ banner: !!document.querySelector(".reps-banner"), label: document.querySelector(".qz-progress-track")?.getAttribute("aria-label"), card: !!document.querySelector(".qz-card") }));
(!plain.banner && plain.label === "Deck progress" && plain.card) ? ok("a direct #/board visit is the ordinary deck (no reps banner)") : bad("direct #/board: " + JSON.stringify(plain));

noise.length === 0 ? ok("no console errors/warnings or page errors across all three contexts") : bad(`console noise: ${noise.join(" | ")}`);

console.log(fails === 0 ? "\nBOARD REPS: all passed" : `\nBOARD REPS: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
