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
 *    mid-set reinsertion of a missed card. The set is strictly linear:
 *    Previous/Next are absent, the arrow keys and Shuffle are inert.
 *  - Composition is asserted, not assumed (a reversed-tier composer used to
 *    pass every assertion here): cards missed in one set are PINNED to the
 *    front of the next set (the completion copy's "leads your next set" is
 *    a guarantee, persisted in the day record's `missed` list), then a
 *    non-due leech leads, then the weakest-3 categories follow.
 *  - Completing the set shows the tally panel (and the "This session" stat
 *    agrees with it), writes today's record under the shared
 *    G.board.repsKey() (accumulating across sets), and Home then shows the
 *    done-today state with "Another set →".
 *  - After completion, stray keyboard input (1-4, arrows) on the panel does
 *    NOT grade an off-screen card - a real regression a reviewer reproduced
 *    (flipped stayed true past the 12th grade; the panel read "13 / 12").
 *  - "Exit reps" / "Keep drilling" return to the ordinary wrap-around deck.
 *  - A direct #/board visit is untouched (no banner, "Deck progress").
 *  - Bonus fix shipped alongside: Home's "N board cards due → Drill" card
 *    now sets _filterDue so it actually lands on the due-only queue, the
 *    same promise Readiness's own "Drill N Due Now" button already keeps.
 *  - At phone width the Home CTAs stay on one line (the two-line sub text
 *    used to squeeze "Start →" into "START" over "→").
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
const bannerText = () => page.evaluate(() => { const b = document.querySelector(".reps-banner"); return b ? b.textContent.replace(/\s+/g, " ").trim() : null; });
const trackLabel = () => page.evaluate(() => { const t = document.querySelector(".qz-progress-track"); return t ? t.getAttribute("aria-label") : null; });
// The prompt only - the kc-label above it flips from "new" to "due · 1×
// reviewed" after a grade, so whole-front text would make one card look
// like two.
const promptText = () => page.evaluate(() => { const p = document.querySelector(".qz-front .qz-prompt"); return p ? p.textContent.trim() : null; });
const doneText = () => page.evaluate(() => { const d = document.querySelector(".reps-done"); return d ? d.textContent.replace(/\s+/g, " ").trim() : null; });
const tallyText = () => page.evaluate(() => { const s = Array.from(document.querySelectorAll(".stat")).find((x) => /This session/.test(x.textContent)); return s ? (s.querySelector(".v") || {}).textContent : null; });
const record = () => page.evaluate(async () => G.db.getSetting(G.board.repsKey(), null));
const clickGrade = (g) => page.evaluate((g) => { const btns = document.querySelectorAll(".qz-grade-row .qz-grade-btn"); if (!btns[g]) return false; btns[g].click(); return true; }, g);
const promptsOf = (ids) => page.evaluate((ids) => ids.map((id) => { const q = G.store.boardQuestions().find((x) => x.id === id); return q ? q.q : null; }), ids);

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
let banner = await bannerText();
(banner && /Card 1 of 12/.test(banner)) ? ok(`reps banner shows "Card 1 of 12": "${banner}"`) : bad("reps banner: " + JSON.stringify(banner));
(await trackLabel()) === "Reps progress" ? ok('progress bar is the reps one ("Reps progress")') : bad("progress bar aria-label: " + JSON.stringify(await trackLabel()));
const flagCleared = await page.evaluate(() => G.board._filterReps == null);
flagCleared ? ok("one-shot _filterReps flag was consumed") : bad("_filterReps still set after render");
const navInReps = await page.evaluate(() => ({ prev: !!document.querySelector('button[aria-label="Previous card"]'), next: !!document.querySelector('button[aria-label="Next card"]'), flip: !!document.querySelector('button[aria-label="Flip card"]') }));
(!navInReps.prev && !navInReps.next && navInReps.flip) ? ok("reps mode hides Previous/Next (the set is a fixed sequence) but keeps Flip") : bad("nav row in reps mode: " + JSON.stringify(navInReps));
const before = await promptText();
await page.evaluate(() => { const w = document.querySelector(".qz-wrap"); w.focus(); w.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); w.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
await page.waitForTimeout(150);
(await promptText()) === before ? ok("ArrowRight/ArrowLeft are inert inside a reps set (same card stays up)") : bad("arrow keys moved the card inside a reps set");
await page.evaluate(() => { document.querySelector(".qz-shuffle-btn").click(); });
await page.waitForTimeout(150);
(await promptText()) === before && /Card 1 of 12/.test((await bannerText()) || "") ? ok("Shuffle is inert inside a reps set (same card, banner still Card 1 of 12)") : bad("Shuffle changed the reps set");

/* ---- 3. Grade exactly 12 cards (two misses), the last one by real keyboard, and prove no reinsertion ---- */
const seq = [2, 2, 2, 0, 2, 2, 2, 0, 2, 2, 2, 2]; // 10 recalled, 2 missed (positions 4 and 8)
const shown = [];
let doneEarly = false, bannerOk = true;
for (let i = 0; i < 11; i++) {
  shown.push(await promptText());
  const b = await bannerText();
  if (!(b && new RegExp("Card " + (i + 1) + " of 12").test(b))) { bannerOk = false; bad(`before grade ${i + 1}: banner reads ${JSON.stringify(b)}, expected "Card ${i + 1} of 12"`); }
  const clicked = await clickGrade(seq[i]);
  if (!clicked) { bad(`grade ${i + 1}: no grade buttons found`); doneEarly = true; break; }
  await page.waitForTimeout(150);
}
// 12th grade through the real keyboard path: Space flips, "3" grades Know
// It - this is the path that used to leave `flipped` true on the panel.
shown.push(await promptText());
const b12 = await bannerText();
if (!(b12 && /Card 12 of 12/.test(b12))) { bannerOk = false; bad(`before grade 12: banner reads ${JSON.stringify(b12)}`); }
await page.focus(".qz-wrap");
await page.keyboard.press("Space");
await page.waitForTimeout(900);
const flippedNow = await page.evaluate(() => !!document.querySelector(".qz-card.flipped, .qz-card[data-flipped='true'], .qz-scene .flipped") || /flipped/.test(document.querySelector(".qz-card")?.className || ""));
await page.keyboard.press("3");
await page.waitForTimeout(400);
if (!doneEarly && bannerOk) ok("banner counted every grade 1 → 12 in order");
const missed = [shown[3], shown[7]];
const reappeared = shown.slice(4).some((t) => t && t === missed[0]) || shown.slice(8).some((t) => t && t === missed[1]);
(!reappeared && missed.every(Boolean)) ? ok("a missed card is NOT reinserted mid-set (no repeat of the cards missed at #4 and #8)") : bad("missed card reappeared inside the set: " + JSON.stringify(missed));
const uniqueShown = new Set(shown.filter(Boolean)).size;
uniqueShown === 12 ? ok("all 12 cards in the set were distinct prompts") : bad(`only ${uniqueShown} distinct prompts across 12 positions: ${JSON.stringify(shown)}`);

let done = await doneText();
(done && /10 \/ 12/.test(done) && /83%/.test(done) && /leads your next set/.test(done))
  ? ok(`completion panel after the 12th (keyboard) grade: "${done.slice(0, 100)}…"`)
  : bad("completion panel (12th grade via keyboard; flipped=" + flippedNow + "): " + JSON.stringify(done));
const noCard = await page.evaluate(() => !document.querySelector(".qz-card"));
noCard ? ok("no further card is drawn once the set is complete") : bad("a card is still showing after completion");
const tallyDone = await tallyText();
(tallyDone && /Set complete/.test(tallyDone) && /recalled 10\/12/.test(tallyDone)) ? ok(`"This session" stat agrees with the panel: "${tallyDone}"`) : bad("This session stat on the done screen: " + JSON.stringify(tallyDone));

// Stray keyboard input on the completion panel must be inert.
const srsBefore = await page.evaluate(async () => JSON.stringify(await G.board.loadAllSrs()));
await page.focus(".qz-wrap");
await page.keyboard.press("3");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("2");
await page.keyboard.press("1");
await page.waitForTimeout(400);
const srsAfter = await page.evaluate(async () => JSON.stringify(await G.board.loadAllSrs()));
const doneAfterKeys = await doneText();
(doneAfterKeys === done && srsBefore === srsAfter)
  ? ok("stray 1-4 / arrow keypresses on the completion panel grade nothing (panel unchanged, no SRS row changed)")
  : bad("stray keys on the panel: panel " + (doneAfterKeys === done ? "unchanged" : "CHANGED to " + JSON.stringify(doneAfterKeys)) + ", srs " + (srsBefore === srsAfter ? "unchanged" : "CHANGED"));

/* ---- 4. the per-day record, including the carry-over list ---- */
let rec = await record();
(rec && rec.sets === 1 && rec.cards === 12 && rec.recalled === 10 && typeof rec.ts === "number")
  ? ok("today's record written under G.board.repsKey(): " + JSON.stringify({ sets: rec.sets, cards: rec.cards, recalled: rec.recalled }))
  : bad("reps record: " + JSON.stringify(rec));
const missedPrompts = rec && Array.isArray(rec.missed) ? await promptsOf(rec.missed) : null;
(missedPrompts && missedPrompts.length === 2 && missed.every((m) => missedPrompts.includes(m)))
  ? ok("the record's `missed` list holds exactly the two cards graded Needs Help")
  : bad("record.missed -> prompts: " + JSON.stringify(missedPrompts) + " vs missed " + JSON.stringify(missed));
const keyShape = await page.evaluate(() => G.board.repsKey(new Date(2026, 0, 5)));
keyShape === "board:reps:2026-01-05" ? ok("repsKey() uses the LOCAL calendar date, zero-padded") : bad("repsKey(2026-01-05) = " + keyShape);

/* ---- 5. Another set: the two misses lead, then composition accumulates ---- */
await page.evaluate(() => { Array.from(document.querySelectorAll(".reps-done button")).find((b) => /Another set/.test(b.textContent)).click(); });
await page.waitForTimeout(700);
banner = await bannerText();
const doneGone = await page.evaluate(() => !document.querySelector(".reps-done"));
(banner && /Card 1 of 12/.test(banner) && doneGone) ? ok('"Another set" starts a fresh 12-card set') : bad("after Another set: banner=" + JSON.stringify(banner) + " doneGone=" + doneGone);
const shown2 = [];
for (let i = 0; i < 12; i++) {
  shown2.push(await promptText());
  await clickGrade(2);
  await page.waitForTimeout(150);
}
const lead2 = new Set(shown2.slice(0, 2));
(lead2.size === 2 && missed.every((m) => lead2.has(m)) && !shown2.slice(2).some((t) => missed.includes(t)))
  ? ok("set 2 opens with exactly the two cards missed in set 1 (pinned first, then never repeated)")
  : bad("set 2 order: first two " + JSON.stringify(shown2.slice(0, 2)) + " vs missed " + JSON.stringify(missed));
rec = await record();
(rec && rec.sets === 2 && rec.cards === 24 && rec.recalled === 22 && Array.isArray(rec.missed) && rec.missed.length === 0)
  ? ok("second set ACCUMULATES into today's record (sets 2, cards 24, recalled 22) and clears the carry-over list once those cards were recalled")
  : bad("record after second set: " + JSON.stringify(rec));

// Leech tier, then weakest-3 tier: seed one NON-due leech in a category
// outside the current weakest-3, start a third set, and read the order.
const seeded = await page.evaluate(async () => {
  const weak = (await G.board.weakestCategoriesByMastery(3)).map((c) => c.cat);
  const srs = await G.board.loadAllSrs();
  const q = G.store.boardQuestions().find((x) => !weak.includes(x.category) && !srs[x.id]);
  if (!q) return null;
  await G.db.put("kv", { k: "srs:" + q.id, v: { reps: 1, ease: 2.3, interval: 1, due: Date.now() + 86400000, misses: 4, lastGrade: 2 } });
  return { id: q.id, prompt: q.q, category: q.category, weak };
});
if (!seeded) bad("could not seed a non-due leech outside the weakest-3 categories");
await page.evaluate(() => { Array.from(document.querySelectorAll(".reps-done button")).find((b) => /Another set/.test(b.textContent)).click(); });
await page.waitForTimeout(700);
const first3 = await promptText();
(seeded && first3 === seeded.prompt) ? ok(`set 3 opens with the seeded non-due leech ("${seeded.category}") - the leech tier comes right after pinned misses and due cards`) : bad("set 3 first card: " + JSON.stringify(first3) + " expected leech " + JSON.stringify(seeded && seeded.prompt));
await clickGrade(2);
await page.waitForTimeout(200);
const second3 = await page.evaluate(() => { const p = document.querySelector(".qz-front .qz-prompt")?.textContent.trim(); const q = G.store.boardQuestions().find((x) => x.q === p); return q ? q.category : null; });
const weakNow = await page.evaluate(async () => (await G.board.weakestCategoriesByMastery(3)).map((c) => c.cat));
(second3 && weakNow.includes(second3)) ? ok(`...then a card from the weakest-3 categories ("${second3}" ∈ ${JSON.stringify(weakNow)})`) : bad("set 3 second card category " + JSON.stringify(second3) + " not in weakest-3 " + JSON.stringify(weakNow));
for (let i = 1; i < 12; i++) { await clickGrade(2); await page.waitForTimeout(120); }

/* ---- 6. Keep drilling → ordinary deck ---- */
await page.evaluate(() => { Array.from(document.querySelectorAll(".reps-done button")).find((b) => /Keep drilling/.test(b.textContent)).click(); });
await page.waitForTimeout(700);
const afterKeep = await page.evaluate(() => ({ banner: !!document.querySelector(".reps-banner"), label: document.querySelector(".qz-progress-track")?.getAttribute("aria-label"), card: !!document.querySelector(".qz-card"), next: !!document.querySelector('button[aria-label="Next card"]') }));
(!afterKeep.banner && afterKeep.label === "Deck progress" && afterKeep.card && afterKeep.next)
  ? ok('"Keep drilling" returns to the ordinary deck (no banner, "Deck progress", Next card back)')
  : bad("after Keep drilling: " + JSON.stringify(afterKeep));

/* ---- 7. Home: done-today state ---- */
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(900);
card = await findRepsCard();
(card && /Today's reps done/.test(card.text) && /34\/36 recalled/.test(card.text) && /3 sets today/.test(card.text) && /Another set/.test(card.text))
  ? ok(`Home now shows the done-today state: "${card.text}"`)
  : bad("Home reps card (done) missing or wrong: " + JSON.stringify(card));
await page.evaluate(() => { Array.from(document.querySelectorAll(".card.click")).find((x) => /Today's reps done/i.test(x.textContent)).click(); });
await page.waitForTimeout(1000);
banner = await bannerText();
(banner && /Card 1 of 12/.test(banner)) ? ok('"Another set →" from Home opens reps mode again') : bad("from Home (done state): banner=" + JSON.stringify(banner));
await page.evaluate(() => { document.querySelector(".reps-banner button").click(); });
await page.waitForTimeout(700);
const afterExit = await page.evaluate(() => ({ banner: !!document.querySelector(".reps-banner"), label: document.querySelector(".qz-progress-track")?.getAttribute("aria-label") }));
(!afterExit.banner && afterExit.label === "Deck progress") ? ok('"Exit reps" returns to the ordinary deck') : bad("after Exit reps: " + JSON.stringify(afterExit));

/* ---- 8. Bonus: Home's due-count card now drills the DUE queue ---- */
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
const plain = await page3.evaluate(() => ({ banner: !!document.querySelector(".reps-banner"), label: document.querySelector(".qz-progress-track")?.getAttribute("aria-label"), card: !!document.querySelector(".qz-card"), next: !!document.querySelector('button[aria-label="Next card"]') }));
(!plain.banner && plain.label === "Deck progress" && plain.card && plain.next) ? ok("a direct #/board visit is the ordinary deck (no reps banner, Next card present)") : bad("direct #/board: " + JSON.stringify(plain));

/* ---- 10. Phone width: the Home CTAs stay on one line ---- */
const page4 = await (await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true })).newPage();
page4.on("pageerror", (e) => noise.push("pageerror(p4): " + e.message));
await page4.goto(url, { waitUntil: "load" });
await dismissOnboarding(page4);
await page4.evaluate(() => { location.hash = "#/board"; });
await page4.waitForTimeout(400);
await page4.evaluate(() => { location.hash = "#/home"; });
await page4.waitForTimeout(900);
const cta = await page4.evaluate(() => {
  const c = Array.from(document.querySelectorAll(".card.click")).find((x) => /5-minute board reps/i.test(x.textContent));
  const btn = c && c.querySelector("button");
  if (!btn) return null;
  const r = document.createRange(); r.selectNodeContents(btn);
  return { lines: r.getClientRects().length, width: Math.round(btn.getBoundingClientRect().width), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
});
(cta && cta.lines === 1 && !cta.overflow) ? ok(`at 360px the reps card's "Start →" is one line box (${cta.width}px wide), no horizontal overflow`) : bad("phone-width CTA: " + JSON.stringify(cta));

noise.length === 0 ? ok("no console errors/warnings or page errors across all four contexts") : bad(`console noise: ${noise.join(" | ")}`);

console.log(fails === 0 ? "\nBOARD REPS: all passed" : `\nBOARD REPS: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
