/**
 * Unit decks, end to end in the real app: import, study, search, readiness, off, remove.
 *
 * WHY THIS SUITE EXISTS. A unit deck is a file somebody else wrote, imported by a
 * Soldier, then shown in five study tools. Every promise below is one a Soldier (or
 * a commander reading the legal package) would rely on, and none is visible from
 * the code alone - each is a click path through the real screens at real widths:
 *
 *  1. Import from Settings -> Study Preferences -> Unit decks, through the real file
 *     input and the paste box: a refusal (not JSON, a Social Security number in card
 *     2's answer, a classification marking, a newer format, a file over 256 KB) says
 *     in plain words which card and field, saves NOTHING and does not move the deck
 *     list; a clean deck shows a PREVIEW (name, unit, counts, three sample cards, the
 *     suggested titles) and the four-part notice (comes from the unit, not checked for
 *     accuracy, never leaves the device, not for classified or controlled
 *     information); nothing is kept until "Add this deck"; Cancel keeps nothing.
 *  2. Board Drill: the deck's cards are there, each face says "Unit deck: <name>", the
 *     back says it is the unit's wording and not By-the-Book, they land in the
 *     pillar-less "Other topics" bucket, a non-publication source makes no regulation
 *     chip while a real regulation does, grading writes srs:unit:<deck>:<card> and
 *     nothing else, and the drill's own Overall readiness is not moved.
 *  3. Quiz and Rapid Fire offer them (Rapid Fire's "match my rank" filter does not
 *     hide them), the Quiz never offers a unit answer as a wrong option to a shipped
 *     question, and global search finds them labelled "Unit deck" and never as doctrine.
 *  4. Readiness has its own "Unit Deck Readiness" row and its "Study" button; the Board
 *     Readiness Score and the six pillars are not moved by them.
 *  5. Recitation Drill shows the deck's suggested TITLES as empty "add yours" prompts
 *     under My unit (title filled in, the words left to the Soldier) - and the deck
 *     carries no words: nothing to recite is stored anywhere.
 *  6. The switch: off hides every card everywhere (drill, search, readiness, prompts)
 *     and back on restores them; the row survives a reload; Remove asks first, says
 *     what happens to study progress and does what is chosen - keep it (it comes
 *     back when the deck is added again) or delete only THIS deck's progress.
 *  7. Text stays text: a deck stuffed with <img onerror>, <script>, <svg onload> and an
 *     <iframe srcdoc> in every field (name, unit, category, question, answer, key
 *     point, source, suggested title) is drawn as literal text on every screen, and
 *     nothing runs and nothing is created.
 *  8. Isolation, in the running app: boardQuestions() and the seed are exactly the
 *     shipped bank (no unit id, same size, same fingerprint, same room-schema bankSig),
 *     the Study Rooms deck picker offers no unit category, doctrine is untouched, and
 *     not one request leaves the page.
 *  9. Keyboard and screen reader: labelled controls, focus lands where the next action
 *     is (Add this deck, the new deck's switch, the Add button after Cancel or Remove),
 *     refusals are announced as alerts, the tag is a real element; nothing scrolls
 *     sideways at 390px with the preview open, the drill card up, or Readiness.
 *
 * The deck used is tools/fixtures/unit-pack-example.pack.json (a made-up "Pinecone Ridge
 * Demo Squadron"); the stuffed one is built here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp, ok, bad, check, finish, waitForRoute, clickWhenStable, until, untilAsync, expectNoConsoleNoise } from "./testkit.mjs";
import { OWNER_PROFILE } from "./device-storage.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "unit-pack-example.pack.json");
const PACK = JSON.parse(readFileSync(FIXTURE, "utf8"));
const DECK = PACK.id, DECK_NAME = PACK.name;
const TAG = "Unit deck: " + DECK_NAME;

const outside = [];
const boot = await bootApp({
  viewport: { width: 1200, height: 900 },
  profile: OWNER_PROFILE,
  beforeLoad: ({ page, url }) => {
    page.on("request", (r) => { if (!r.url().startsWith(url.replace(/[^/]*$/, "")) && !/^(data|blob|about):/.test(r.url())) outside.push(r.url()); });
    page.on("websocket", (w) => outside.push("websocket " + w.url()));
  },
});
const { page, noise } = boot;

/* ----------------------------------------------------------------- helpers */
const kv = (k) => page.evaluate(async (k) => { const r = await G.db.get("kv", k); return r ? r.v : null; }, k);
const kvKeys = (prefix) => page.evaluate(async (p) => (await G.db.all("kv")).map((r) => r.k).filter((k) => typeof k === "string" && k.indexOf(p) === 0).sort(), prefix);
const live = () => page.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const bankFacts = () => page.evaluate(() => {
  const seed = G.store.seed();
  const bq = G.store.boardQuestions();
  return {
    boardLen: bq.length, seedLen: seed.board.questions.length, doctrine: G.store.doctrine("").length,
    unitInBoard: bq.filter((q) => /^unit:/.test(String(q.id)) || q.unitDeck || /^Unit: /.test(q.category)).length,
    unitInSeed: seed.board.questions.filter((q) => /^unit:/.test(String(q.id)) || q.unitDeck || /^Unit: /.test(q.category)).length,
    contentHash: seed.board.contentHash, bankSig: G.roomSchema.bankSig(seed),
    noPillar: bq.filter((q) => !q.pillar).length,
    same: G.store.studyQuestions() === bq,
    unitCards: G.unitDecks.cards().length,
  };
});
const openSettingsPanel = () => waitForRoute(page, "#/settings", { fresh: true, ready: "#settings-unitdecks-panel" });
const panelText = () => page.evaluate(() => document.querySelector("#settings-unitdecks-panel").innerText);
const resultText = () => page.evaluate(() => (document.querySelector("[data-unit-deck-result]") || {}).innerText || "");
const openAddForm = async () => {
  if (!(await page.locator("[data-unit-deck-file]").count())) await clickWhenStable(page, page.locator("[data-unit-deck-open]"));
  await page.waitForSelector("[data-unit-deck-file]");
};
const pasteAndCheck = async (text) => {
  await openAddForm();
  await page.locator("[data-unit-deck-file]").setInputFiles([]);
  await page.fill("[data-unit-deck-text]", text);
  await clickWhenStable(page, page.locator("[data-unit-deck-check]"));
  await until(page, () => !!document.querySelector("[data-unit-deck-refused], [data-unit-deck-preview]"));
};
const fileAndCheck = async (file) => {
  await openAddForm();
  await page.fill("[data-unit-deck-text]", "");
  await page.locator("[data-unit-deck-file]").setInputFiles(file);
  await clickWhenStable(page, page.locator("[data-unit-deck-check]"));
  await until(page, () => !!document.querySelector("[data-unit-deck-refused], [data-unit-deck-preview]"));
};
const refusal = () => page.evaluate(() => {
  const r = document.querySelector("[data-unit-deck-refused]");
  return r ? { stage: r.getAttribute("data-unit-deck-refused"), role: r.getAttribute("role"), text: r.innerText } : null;
});
const focusInfo = () => page.evaluate(() => { const a = document.activeElement; return { tag: a ? a.tagName : "", text: a ? (a.textContent || "").trim().slice(0, 40) : "", attrs: a ? Array.from(a.attributes).map((x) => x.name).join(",") : "", id: a ? a.id : "" }; });
const clone = (x) => JSON.parse(JSON.stringify(x));
const openTab = async (label) => {
  await clickWhenStable(page, page.locator(".segmented button", { hasText: new RegExp("^" + label + "$") }));
};
const openDrill = () => waitForRoute(page, "#/board", { fresh: true, ready: ".qz-card" });
// The app's switches hide the real checkbox and draw a track; a person clicks the label.
const setToggle = async (id, on) => {
  const box = page.locator('[data-unit-deck-toggle="' + id + '"]');
  if ((await box.isChecked()) !== on) await clickWhenStable(page, page.locator('label.toggle:has([data-unit-deck-toggle="' + id + '"])'));
  await until(page, (a) => document.querySelector('[data-unit-deck-toggle="' + a.id + '"]').checked === a.on && !document.querySelector('[data-unit-deck-toggle="' + a.id + '"]').disabled, { id, on });
};
// Rapid Fire shows its "How Rapid Fire works" explainer the first time a round starts.
const startRound = async () => {
  await clickWhenStable(page, page.locator("button", { hasText: /^Start Round$/ }));
  await until(page, () => !!document.querySelector(".rf-explainer, .rf-question"));
  if (await page.locator(".rf-explainer").count()) await clickWhenStable(page, page.locator(".rf-explainer button"));
};
const pickCategoryRow = async (name) => {
  await clickWhenStable(page, page.locator('[aria-label="Jump to category"] .list-detail-row', { has: page.locator(".ldr-name", { hasText: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }) }));
  await until(page, (n) => { const l = document.querySelector(".qz-front .kc-label"); return !!l && l.textContent.indexOf(n) === 0; }, name);
};
const front = () => page.evaluate(() => {
  const f = document.querySelector(".qz-front");
  if (!f) return null;
  return { label: (f.querySelector(".kc-label") || {}).textContent || "", tag: (f.querySelector(".unit-deck-tag") || {}).textContent || null, prompt: (f.querySelector(".qz-prompt") || {}).textContent || "" };
});
const danger = () => page.evaluate(() => ({
  pwned: window.__unitXss === undefined ? 0 : window.__unitXss,
  bad: document.querySelectorAll('#route img[src="x"], #route [onerror], #route [onload], #route iframe, #route script, .gm-back script, #toast script').length,
}));

/* ================================================================= 0. before */
await waitForRoute(page, "#/home", { ready: "#route h1, #route h2" });
const before = await bankFacts();
check(before.boardLen > 1000 && before.unitInBoard === 0 && before.unitInSeed === 0 && before.unitCards === 0 && before.same === true, `before any deck: the study pool IS the shipped bank (${before.boardLen} cards) and holds no unit card`, () => JSON.stringify(before));
check(!!before.contentHash && !!before.bankSig, `the bank has a fingerprint (${before.contentHash}) and a room signature (${before.bankSig}) to compare with later`);

/* ================================================================= 1. import */
await openSettingsPanel();
{
  const t = await panelText();
  check(/^UNIT DECKS/i.test(t) && /No unit decks yet\./.test(t) && /comes from your unit, not from GUIDON or the Army/.test(t) && /stays on this device/.test(t) && /labeled .Unit deck./.test(t), "Settings -> Study Preferences has a Unit decks panel that says the deck is the unit's, stays on the device and is labeled", () => t);
  const inStudyZone = await page.evaluate(() => { const z = Array.from(document.querySelectorAll(".settings-zone-h")).find((h) => /Study Preferences/.test(h.textContent)); const p = document.getElementById("settings-unitdecks-panel"); return !!(z && p && z.nextElementSibling && z.nextElementSibling.contains(p)); });
  check(inStudyZone, "and it sits inside the Study Preferences zone, next to MOS decks and MOI plans");
}
{ // refusals: nothing is saved, the deck list does not move, and the words are plain
  await pasteAndCheck("this is not a deck");
  let r = await refusal();
  check(r && r.stage === "format" && r.role === "alert" && /This deck was not added\. Nothing was saved\./.test(r.text) && /not valid JSON/.test(r.text), "not JSON: refused, announced as an alert, in plain words", () => JSON.stringify(r));

  const ssn = clone(PACK); ssn.cards[1].a += " Use 123-45-6789 to look it up.";
  await pasteAndCheck(JSON.stringify(ssn));
  r = await refusal();
  check(r && r.stage === "screen" && /Card 2 \(sop-002\), answer: this looks like a Social Security number/.test(r.text) && /does not add a deck at all/.test(r.text) && !/123-45-6789/.test(r.text), "a Social Security number in card 2's answer refuses the WHOLE deck, names the card and field, and does not repeat the number", () => JSON.stringify(r));

  const mark = clone(PACK); mark.name = "Deck SECRET//NOFORN";
  await pasteAndCheck(JSON.stringify(mark));
  r = await refusal();
  check(r && r.stage === "screen" && /The deck name: this looks like a classification or handling marking/.test(r.text), "a classification marking in the deck name is refused and named", () => JSON.stringify(r));

  const phone = clone(PACK); phone.cards[0].keyPoints = ["fine", "Call 555-123-4567"]; phone.reciteTitles = ["CUI//SP-PRVCY"];
  await pasteAndCheck(JSON.stringify(phone));
  r = await refusal();
  check(r && /Card 1 \(sop-001\), key point 2: this looks like a phone number/.test(r.text) && /Suggested title 1: this looks like a classification/.test(r.text), "every finding is listed (a phone number in a key point AND a marking in a suggested title)", () => JSON.stringify(r));

  const newer = clone(PACK); newer.formatVersion = 2;
  await pasteAndCheck(JSON.stringify(newer));
  r = await refusal();
  check(r && r.stage === "newer" && /newer deck format \(version 2\)/.test(r.text) && /Update GUIDON/.test(r.text) && !/Fix the deck and try again/.test(r.text), "a newer format version is refused with its own message (update GUIDON)", () => JSON.stringify(r));

  const extra = clone(PACK); extra.cards[0].image = "x.png";
  await pasteAndCheck(JSON.stringify(extra));
  r = await refusal();
  check(r && /Card 1 \(sop-001\) has a field GUIDON does not know \("image"\)/.test(r.text), "a card field the format does not have (an image) is refused and named", () => JSON.stringify(r));

  await fileAndCheck({ name: "big.json", mimeType: "application/json", buffer: Buffer.from(" ".repeat(300 * 1024)) });
  r = await refusal();
  check(r && /bigger than the 256 KB/.test(r.text), "a file over 256 KB is refused without being read", () => JSON.stringify(r));

  const stored = await kvKeys("unit-deck:");
  const listed = await page.evaluate(() => G.unitDecks.list().length);
  check(stored.length === 0 && listed === 0 && /No unit decks yet\./.test(await panelText()), "after every refusal: no row on the device, nothing in the deck list", () => JSON.stringify({ stored, listed }));
}
{ // the preview, and Cancel keeps nothing
  await fileAndCheck(FIXTURE);
  const prev = await page.evaluate(() => {
    const p = document.querySelector("[data-unit-deck-preview]");
    return p ? { text: p.innerText, region: p.getAttribute("role"), label: p.getAttribute("aria-label"), samples: p.querySelectorAll("[data-unit-deck-sample]").length, counts: (p.querySelector("[data-unit-deck-counts]") || {}).textContent, notice: (p.querySelector("[data-unit-deck-preview-notice]") || {}).textContent, replaces: !!p.querySelector("[data-unit-deck-replaces]") } : null;
  });
  // hygiene-ok: these counts are the committed fictional example deck's own (a fixture file), never the bank's
  check(!!prev && prev.region === "region" && prev.label === "Deck preview" && prev.samples === 3 && /^8 cards in 3 categories: Local SOP \(3\), Unit history \(3\), Local promotion-board study \(2\)$/.test(prev.counts) && /Pinecone Ridge Demo Squadron \(fictional\)/.test(prev.text) && /version 2026\.09 \(2026-09-26\)/.test(prev.text) && !prev.replaces, "the preview shows the name, the unit, the version, the counts and three sample cards", () => JSON.stringify(prev));
  check(/comes from your unit/.test(prev.notice) && /has not checked it for accuracy/.test(prev.notice) && /never leaves this device/.test(prev.notice) && /not for classified or controlled information/.test(prev.notice), "and the notice says all four things: the unit's, unchecked for accuracy, never leaves the device, not for classified or controlled information", () => prev.notice);
  check(/Squadron song, Squadron motto/.test(prev.text) && /carries no words to recite/.test(prev.text), "the suggested titles are shown as titles only, with a note that the deck carries no words");
  const f = await focusInfo();
  check(f.tag === "BUTTON" && /^Add this deck$/i.test(f.text), "keyboard focus lands on \"Add this deck\", the next action", () => JSON.stringify(f));
  check((await kvKeys("unit-deck:")).length === 0 && (await page.evaluate(() => G.unitDecks.list().length)) === 0, "at this point (previewed, not confirmed) nothing has been kept");
  await clickWhenStable(page, page.locator("[data-unit-deck-preview] button", { hasText: /^Cancel$/ }));
  await until(page, () => !!document.querySelector("[data-unit-deck-open]") && !document.querySelector("[data-unit-deck-preview]"));
  check((await kvKeys("unit-deck:")).length === 0 && /No unit decks yet\./.test(await panelText()), "Cancel keeps nothing and closes the form");
  check((await focusInfo()).attrs.includes("data-unit-deck-open"), "and focus returns to \"Add a unit deck\"");
}
{ // confirm
  await fileAndCheck(FIXTURE);
  await clickWhenStable(page, page.locator("[data-unit-deck-confirm-add]"));
  await until(page, (id) => !!document.querySelector('[data-unit-deck="' + id + '"]'), DECK);
  const row = await kv("unit-deck:" + DECK);
  check(!!row && row.id === DECK && row.enabled === true && row.cards.length === 8 && row.schema === 1 && row.reciteTitles.length === 2 && row.name === DECK_NAME, "\"Add this deck\" keeps ONE row, under unit-deck:<id>, on by default", () => JSON.stringify(row).slice(0, 300));
  check(row.cards[0].source[0].pub === "Pinecone Ridge Demo Squadron SOP 2026, para 2-1" && row.cards[0].source[0].quoteKind === "paraphrase" && row.cards[0].source[0].edition === "" && row.cards[0].source[0].para === "", "the unit's own source became a named entry - no edition or paragraph invented, never a quote", () => JSON.stringify(row.cards[0].source));
  check(!Object.keys(row).some((k) => /lines|lyrics|recite(?!Titles)/i.test(k)) && !JSON.stringify(row).includes('"lines"'), "the saved deck carries no words to recite - titles only");
  const t = await panelText();
  check(/Pinecone Ridge Demo Squadron study deck/.test(t) && /8 cards/.test(t) && /Not Army doctrine\./.test(t) && /RESET PROGRESS/i.test(t) && /REMOVE DECK/i.test(t), "the deck now shows in the list, marked \"Not Army doctrine\"", () => t);
  const toggle = page.locator('[data-unit-deck-toggle="' + DECK + '"]');
  check((await toggle.isChecked()) && (await toggle.getAttribute("aria-label")) === "Study the unit deck " + DECK_NAME, "with a labelled switch that is on");
  check((await focusInfo()).attrs.includes("data-unit-deck-toggle"), "and focus moves to the new deck's switch");
  await until(page, () => /Added Pinecone Ridge Demo Squadron study deck\./.test((document.getElementById("a11y-live") || {}).textContent || ""));
  check(/Added Pinecone Ridge Demo Squadron study deck\./.test(await live()), "the add is announced to a screen reader", "the live region never said the deck was added");
  const files = await page.locator("[data-unit-deck-file]").count();
  check(files === 0, "the add form has closed itself");
  // Adding the very same deck again is an update, not a second deck, and says so before it does it.
  await fileAndCheck(FIXTURE);
  const rep = await page.evaluate(() => (document.querySelector("[data-unit-deck-replaces]") || {}).textContent || "");
  check(/already have a deck with this id/.test(rep) && /Adding this replaces it/.test(rep) && /progress on cards that are still in the deck is kept/.test(rep), "adding the same deck id again says it will REPLACE the old one, and that progress is kept", () => rep);
  await clickWhenStable(page, page.locator("[data-unit-deck-preview] button", { hasText: /^Cancel$/ }));
  await until(page, () => !document.querySelector("[data-unit-deck-preview]"));
}

/* ================================================================= 2. Board Drill */
const answerOf = (q) => PACK.cards.find((c) => c.q === q);
let graded = null;
{
  await openDrill();
  const facts = await bankFacts();
  check(facts.unitCards === 8 && facts.same === false, "with the deck on, the study pool is the shipped bank plus its 8 cards", () => JSON.stringify(facts));
  const pillarChip = await page.locator('[aria-label="Quick-filter by pillar"] button', { hasText: /^Other topics/ }).textContent();
  check(pillarChip === "Other topics (" + (facts.noPillar + 8) + ")", `the cards land in the pillar-less "Other topics" bucket (${pillarChip})`, () => pillarChip + " vs " + (facts.noPillar + 8));
  // Not under any of the six pillars.
  const pillarChips = await page.locator('[aria-label="Quick-filter by pillar"] button').allTextContents();
  await clickWhenStable(page, page.locator('[aria-label="Quick-filter by pillar"] button', { hasText: /^Doctrinal Thinking/ }));
  await until(page, () => document.querySelector('[aria-label="Quick-filter by pillar"] button.active') && /^Doctrinal/.test(document.querySelector('[aria-label="Quick-filter by pillar"] button.active').textContent));
  const underPillar = await page.locator('[aria-label="Quick-filter by category"] button').allTextContents();
  check(!underPillar.some((t) => /^Unit:/.test(t)) && pillarChips.length > 6, "and not under any of the six pillars (Doctrinal Thinking's categories hold none)", () => underPillar.join(" | "));
  await clickWhenStable(page, page.locator('[aria-label="Quick-filter by pillar"] button', { hasText: /^Other topics/ }));
  await until(page, () => document.querySelector('[aria-label="Quick-filter by pillar"] button.active') && /^Other topics/.test(document.querySelector('[aria-label="Quick-filter by pillar"] button.active').textContent));
  const cats = await page.locator('[aria-label="Quick-filter by category"] button').allTextContents();
  check(["Unit: Local SOP (3)", "Unit: Unit history (3)", "Unit: Local promotion-board study (2)"].every((c) => cats.includes(c)), "\"Other topics\" lists the deck's own categories, each named \"Unit: ...\" so none can be mistaken for a shipped category", () => cats.join(" | "));

  await pickCategoryRow("Unit: Local SOP");
  const f1 = await front();
  check(f1 && f1.tag === TAG && /^Unit: Local SOP/.test(f1.label) && PACK.cards.some((c) => c.q === f1.prompt && c.category === "Local SOP"), "the card face says \"Unit deck: <name>\" and shows one of the deck's questions", () => JSON.stringify(f1));
  const tagEl = await page.evaluate(() => { const t = document.querySelector(".qz-front .unit-deck-tag"); return t ? { tag: t.tagName, id: t.getAttribute("data-unit-deck-tag") } : null; });
  check(tagEl && tagEl.tag === "DIV" && tagEl.id === DECK, "the label is a real element carrying the deck id");
  // regulation chips: only residue sources, so none
  const regSummary = await page.locator(".qf-disclosure summary").textContent();
  check(regSummary === "Filter by regulation", "a deck whose sources are only the unit's own words makes NO regulation chip", () => regSummary);
  // flip and read the back
  await clickWhenStable(page, page.locator(".qz-card"));
  await until(page, () => document.querySelector(".qz-card").classList.contains("flipped"));
  // The prompt and the back are read in ONE snapshot: they are the same card's two faces.
  const back = await page.evaluate(() => { const b = document.querySelector(".qz-back"); return { text: b.innerText, tag: !!b.querySelector(".unit-deck-tag"), prompt: document.querySelector(".qz-front .qz-prompt").textContent }; });
  const card = answerOf(back.prompt);
  check(/From your unit's deck \(GUIDON has not checked it\)/i.test(back.text) && !/By the Book/i.test(back.text) && !/Study-guide answer/.test(back.text) && back.tag, "the back says it is the unit's own wording, not By the Book and not a GUIDON study-guide answer, and repeats the label", () => back.text.slice(0, 300));
  check(back.text.includes(card.a) && back.text.includes("Source (as your unit wrote it): " + card.source), "it shows the unit's answer and its source exactly as the unit wrote it", () => back.text.slice(0, 400));
  // grade it: writes exactly srs:unit:<deck>:<card>
  const srsBefore = await kvKeys("srs:");
  await clickWhenStable(page, page.locator(".qz-grade-btn.qz-grade-2"));
  await untilAsync(page, async (n) => (await G.db.all("kv")).filter((r) => typeof r.k === "string" && r.k.indexOf("srs:") === 0).length > n, srsBefore.length);
  const srsAfter = await kvKeys("srs:");
  graded = srsAfter.filter((k) => !srsBefore.includes(k))[0];
  const after = await kv(graded);
  check(after && after.lastGrade === 2 && srsAfter.length === srsBefore.length + 1 && graded === "srs:unit:" + DECK + ":" + card.id, "grading writes exactly one row, srs:unit:<deck>:<card>, and touches no shipped card's row", () => JSON.stringify({ after, graded, card: card.id, added: srsAfter.filter((k) => !srsBefore.includes(k)) }));
  check(srsAfter.filter((k) => /^srs:unit:/.test(k)).every((k) => /^srs:unit:[a-z0-9-]+:[a-z0-9-]+$/.test(k)), "every unit history key is namespaced srs:unit:<deck>:<card>");
  // the drill's own Overall readiness is the shipped bank only
  const overall = await page.evaluate(() => { const p = document.querySelector(".drill-readiness-pane"); return p ? p.innerText : ""; });
  check(/Overall\s*0%/.test(overall), "the drill's Overall readiness (shipped bank only) did not move when a unit card was graded", () => overall.slice(0, 120));
}
{ // a real regulation next to the unit's own words: one chip, and only for the real one
  await page.evaluate(async () => {
    await G.unitDecks.add({ format: "guidon-unit-pack", formatVersion: 1, id: "reg-deck", name: "Regulation check deck", packVersion: "1", packDate: "2026-09-26",
      cards: [{ id: "r1", category: "Reg check", q: "Which regulation does the SOP follow?", a: "The SOP follows the counseling regulation.", source: "AR 600-20, para 4-5; Battalion SOP 2026" }, { id: "r2", category: "Reg check", q: "Where is the local form kept?", a: "At the supply window.", source: "Battalion SOP 2026" }] });
  });
  await openDrill();
  await pickCategoryRow("Unit: Reg check");
  await page.evaluate(() => { const d = document.querySelector(".qf-disclosure"); if (d) d.open = true; });
  const chips = await page.locator('[aria-label="Quick-filter by regulation"] button').allTextContents();
  check(JSON.stringify(chips) === JSON.stringify(["All regulations", "AR 600-20 (1)"]), "a real regulation cited in a unit card makes its chip (AR 600-20), and \"Battalion SOP 2026\" makes none", () => JSON.stringify(chips));
  await clickWhenStable(page, page.locator('[aria-label="Quick-filter by regulation"] button', { hasText: /^AR 600-20/ }));
  await until(page, () => { const l = document.querySelector(".qz-front .kc-label"); return !!l && /^Unit: Reg check/.test(l.textContent); });
  const f = await front();
  check(f && f.prompt === "Which regulation does the SOP follow?" && f.tag === "Unit deck: Regulation check deck", "the chip narrows the drill to that unit card", () => JSON.stringify(f));
  await page.evaluate(async () => { await G.unitDecks.remove("reg-deck", { deleteHistory: true }); });
}

/* ================================================================= 3. Quiz, Rapid Fire, search */
{
  await openDrill();
  await openTab("Quiz");
  await page.waitForSelector("select[aria-label='Filter by category']");
  await page.selectOption("select[aria-label='Filter by category']", "Unit: Local SOP");
  await clickWhenStable(page, page.locator("button", { hasText: /^Start Quiz$/ }));
  await page.waitForSelector(".quiz-card .prompt");
  const q1 = await page.evaluate(() => ({ tag: (document.querySelector(".quiz-card .unit-deck-tag") || {}).textContent || null, prompt: document.querySelector(".quiz-card .prompt").textContent, opts: Array.from(document.querySelectorAll(".quiz-opt-text")).map((o) => o.textContent) }));
  const qc = answerOf(q1.prompt);
  check(q1.tag === TAG && !!qc && q1.opts.length === 4 && q1.opts.includes(qc.a), "Quiz offers the deck's questions with the same \"Unit deck: <name>\" label and four options including the unit's answer", () => JSON.stringify(q1));
  // A shipped question is never offered a unit answer as a wrong option.
  await openDrill();
  await openTab("Quiz");
  await page.waitForSelector("select[aria-label='Filter by category']");
  const shippedCat = await page.evaluate(() => Array.from(document.querySelectorAll("select[aria-label='Filter by category'] option")).map((o) => o.value).find((v) => v !== "All" && !/^Unit: /.test(v)));
  await page.selectOption("select[aria-label='Filter by category']", shippedCat);
  await clickWhenStable(page, page.locator("button", { hasText: /^Start Quiz$/ }));
  const unitAnswers = PACK.cards.map((c) => c.a.trim());
  let leaked = [], rounds = 0;
  for (let i = 0; i < 8; i++) {
    await page.waitForSelector(".quiz-card .quiz-opt");
    const got = await page.evaluate(() => ({ tag: !!document.querySelector(".quiz-card .unit-deck-tag"), opts: Array.from(document.querySelectorAll(".quiz-opt-text")).map((o) => o.textContent) }));
    rounds++;
    if (got.tag) leaked.push("a unit question in a shipped category");
    got.opts.forEach((o) => { if (unitAnswers.includes(o.trim())) leaked.push(o); });
    await clickWhenStable(page, page.locator(".quiz-opt").first());
    const next = page.locator(".quiz-next-btn");
    await clickWhenStable(page, next);
    await until(page, () => !!document.querySelector(".quiz-card .quiz-opt") || !!document.querySelector(".quiz-card .stat"));
    if (!(await page.locator(".quiz-card .quiz-opt").count())) break;
  }
  check(rounds >= 3 && leaked.length === 0, `Quiz on a shipped category (${shippedCat}) never offers a unit answer, over ${rounds} questions`, () => JSON.stringify(leaked));
}
{
  await openDrill();
  await openTab("Rapid Fire");
  await page.waitForSelector(".rf-setup-grid");
  const chipActive = await page.evaluate(() => Array.from(document.querySelectorAll(".rf-setup-grid button.active, .rf-setup-grid button[aria-pressed='true']")).map((b) => b.textContent.trim()));
  await page.selectOption(".rf-setup-grid select[aria-label='Filter by category']", "Unit: Unit history");
  const rankOn = chipActive.includes("Match my rank");
  await startRound();
  // One atomic read: a Rapid Fire card is redrawn as the round starts, so the tag and the question are captured together.
  await until(page, () => { const t = document.querySelector(".rf-root .unit-deck-tag"), q = document.querySelector(".rf-question"); if (!t || !q) return false; window.__rf = { tag: t.textContent, q: q.textContent, label: (document.querySelector(".rf-root .kc-label") || {}).textContent }; return true; });
  const rf = await page.evaluate(() => window.__rf);
  check(rankOn && rf.tag === TAG && /^Unit: Unit history/.test(rf.label) && PACK.cards.some((c) => c.q === rf.q && c.category === "Unit history"), "Rapid Fire plays the deck, labeled, even with \"Match my rank\" on (a unit deck has no level for that filter to hide it by)", () => JSON.stringify({ rankOn, rf }));
}
{
  await waitForRoute(page, "#/search", { fresh: true, ready: "input[aria-label='Global search']" });
  await page.fill("input[aria-label='Global search']", "pine cone");
  await until(page, () => !!document.querySelector(".search-hit"));
  const hits = await page.evaluate(() => Array.from(document.querySelectorAll(".search-hit")).map((h) => ({ aria: h.getAttribute("aria-label"), sub: (h.querySelector(".search-hit-sub") || {}).textContent, meta: (h.querySelector(".search-hit-meta") || {}).textContent, section: (h.closest(".search-section").querySelector(".search-section-head") || {}).textContent })));
  check(hits.length === 1 && /^unit deck: What is on the demo squadron's guidon\?/.test(hits[0].aria) && hits[0].sub === "Unit deck: " + DECK_NAME + " · Unit history" && /^Unit deck — from your unit, not Army doctrine/.test(hits[0].meta), "search finds the card and labels it \"Unit deck\" in its name, its second line and its own note", () => JSON.stringify(hits));
  await page.fill("input[aria-label='Global search']", "Pinecone Ridge");
  await until(page, () => document.querySelectorAll(".search-hit").length >= 8);
  const byDeck = await page.evaluate(() => Array.from(document.querySelectorAll(".search-hit")).filter((h) => /^unit deck:/.test(h.getAttribute("aria-label"))).length);
  check(byDeck >= 8, "searching the deck's name finds its cards", () => String(byDeck));
  const noDoctrine = await page.evaluate(() => { const sections = Array.from(document.querySelectorAll(".search-section")).map((s) => ((s.querySelector(".search-section-head") || {}).textContent || "")); return sections.filter((t) => /Doctrine|Creeds|Lessons|Dictionary/.test(t)); });
  check(noDoctrine.length === 0, "and none of it shows up under Doctrine, Creeds, Lessons or the Dictionary", () => noDoctrine.join(","));
  await page.fill("input[aria-label='Global search']", "unit deck");
  await until(page, () => Array.from(document.querySelectorAll(".search-hit")).some((h) => /Settings — Unit decks/.test(h.textContent)));
  check(true, "the Settings screen itself is findable (\"Settings — Unit decks\")");
}

/* ================================================================= 4. Readiness */
{
  await openDrill();
  await openTab("Readiness");
  await page.waitForSelector(".readiness-unit-decks");
  const r = await page.evaluate((id) => {
    const p = document.querySelector(".readiness-unit-decks");
    const row = p.querySelector('[data-unit-deck="' + id + '"]');
    const stat = Array.from(document.querySelectorAll(".stat")).find((s) => /Questions mastered/.test(s.textContent));
    return { text: row.innerText.replace(/\n/g, " | "), head: p.innerText, mastered: stat ? stat.innerText.replace(/\n/g, " | ") : "" , pillarRows: document.querySelectorAll(".readiness-pillar-row").length, unitInPillars: Array.from(document.querySelectorAll(".readiness-pillar-row")).filter((x) => /Unit/.test(x.innerText)).length };
  }, DECK);
  const facts = await bankFacts();
  check(/Unit deck: Pinecone Ridge Demo Squadron study deck \| 13% \(1\/8 cards\)/.test(r.text.replace(/\s+/g, " ").replace(/\s\|\s/g, " | ")) || /13%\s*\(1\/8 cards\)/.test(r.text), "Readiness has a \"Unit Deck Readiness\" row for the deck (one card graded Know It: 1 of 8)", () => r.text);
  check(/not Army doctrine/i.test(r.head) && /not counted in the Board Readiness Score/.test(r.head), "and says the deck is not doctrine and not counted in the score", () => r.head);
  check(new RegExp("0 / " + facts.boardLen + "$").test(r.mastered), `the Board Readiness Score's denominator is the shipped bank alone (${facts.boardLen}), and the six pillar rows hold no unit card`, () => r.mastered + " / " + r.unitInPillars);
  check(r.unitInPillars === 0 && r.pillarRows >= 4, "no pillar row mentions a unit deck");
  await clickWhenStable(page, page.locator('.readiness-unit-decks button', { hasText: /^Study Pinecone/ }));
  await page.waitForSelector("[data-unit-deck-banner]");
  await until(page, () => !!document.querySelector(".qz-front .unit-deck-tag"));
  const study = await page.evaluate(() => ({ banner: document.querySelector("[data-unit-deck-banner]").innerText, label: document.querySelector(".qz-front .kc-label").textContent, tag: document.querySelector(".qz-front .unit-deck-tag").textContent }));
  check(/Studying: Unit deck: Pinecone Ridge Demo Squadron study deck/.test(study.banner) && /^Unit: /.test(study.label) && study.tag === TAG, "\"Study <deck>\" opens Board Drill on exactly that deck, with a banner saying so", () => JSON.stringify(study));
  await clickWhenStable(page, page.locator("[data-unit-deck-banner] button", { hasText: /^Study everything again$/ }));
  await until(page, () => !document.querySelector("[data-unit-deck-banner]"));
  check(true, "and \"Study everything again\" clears that narrowing");
}

/* ================================================================= 5. Recitation Drill: titles only */
{
  await waitForRoute(page, "#/recite", { fresh: true, ready: "[data-recite-own]" });
  const s = await page.evaluate(() => ({ btns: Array.from(document.querySelectorAll("[data-recite-suggest]")).map((b) => b.textContent), aria: Array.from(document.querySelectorAll("[data-recite-suggest]")).map((b) => b.getAttribute("aria-label")), hint: (document.querySelector("[data-recite-suggested] .hint") || {}).textContent || "", rows: document.querySelectorAll("[data-recite-own] .list-detail-row").length }));
  check(JSON.stringify(s.btns) === JSON.stringify(["Add: Squadron song", "Add: Squadron motto"]) && /Type the words yourself/.test(s.hint) && s.rows === 0, "My unit shows the deck's suggested titles as empty \"Add: ...\" prompts, and no text yet", () => JSON.stringify(s));
  await clickWhenStable(page, page.locator('[data-recite-suggest="Squadron song"]'));
  await page.waitForSelector("#recite-own-title");
  const form = await page.evaluate(() => ({ title: document.getElementById("recite-own-title").value, text: document.getElementById("recite-own-text").value, focus: document.activeElement && document.activeElement.id }));
  check(form.title === "Squadron song" && form.text === "" && form.focus === "recite-own-text", "choosing one fills in the NAME only and puts focus where the Soldier types their own words", () => JSON.stringify(form));
  check((await kv("guidon:recite:own:v1")) === null && (await page.evaluate(async () => (await G.reciteUser.list()).length)) === 0, "nothing to recite exists anywhere: the deck stored no text and no My unit text was made");
}

/* ================================================================= 6. the switch, reload, remove */
{
  await openSettingsPanel();
  const toggle = page.locator('[data-unit-deck-toggle="' + DECK + '"]');
  await setToggle(DECK, false);
  await untilAsync(page, async (id) => { const r = await G.db.get("kv", "unit-deck:" + id); return !!r && r.v.enabled === false; }, DECK);
  const off = await bankFacts();
  check(off.unitCards === 0 && off.same === true, "switched off: the study pool is exactly the shipped bank again (the same array)", () => JSON.stringify(off));
  await until(page, () => /is off\. Its cards are hidden\./.test((document.getElementById("a11y-live") || {}).textContent || ""));
  check(/is off\. Its cards are hidden\./.test(await live()), "and the change is announced", "the live region never said the deck is off");
  await openDrill();
  const catsOff = await page.locator('[aria-label="Jump to category"] .ldr-name').allTextContents();
  check(!catsOff.some((c) => /^Unit: /.test(c)), "Board Drill lists no unit category");
  await waitForRoute(page, "#/search", { fresh: true, ready: "input[aria-label='Global search']" });
  await page.fill("input[aria-label='Global search']", "pine cone");
  await until(page, () => !!document.querySelector(".search-empty, .search-hit"));
  check((await page.locator(".search-hit").count()) === 0, "search finds nothing of it");
  await openDrill();
  await openTab("Readiness");
  await until(page, () => !!document.querySelector(".readiness-pillars, .drill-readiness-pane, .stat"));
  check((await page.locator(".readiness-unit-decks").count()) === 0, "Readiness has no Unit Deck row (no new DOM for a deck that is off)");
  await waitForRoute(page, "#/recite", { fresh: true, ready: "[data-recite-own]" });
  check((await page.locator("[data-recite-suggested]").count()) === 0, "and Recitation Drill shows no suggested titles");
  // back on, and it survives a reload
  await openSettingsPanel();
  await setToggle(DECK, true);
  await untilAsync(page, async (id) => { const r = await G.db.get("kv", "unit-deck:" + id); return !!r && r.v.enabled === true; }, DECK);
  await page.reload({ waitUntil: "load" });
  await waitForRoute(page, "#/home", { ready: "#route h1, #route h2" });
  await until(page, () => G.unitDecks.cards().length === 8);
  check((await bankFacts()).unitCards === 8, "back on, and the deck is still there after a reload");
}
{ // Remove: asks first; keep progress, then delete progress
  await openSettingsPanel();
  const sentinel = await page.evaluate(async () => {
    const shipped = G.store.boardQuestions()[0].id;
    await G.db.put("kv", { k: "srs:" + shipped, v: { reps: 1, ease: 2.5, interval: 1, due: Date.now() + 1e9, misses: 0, lastGrade: 2 } });
    await G.unitDecks.add({ format: "guidon-unit-pack", formatVersion: 1, id: "other-deck", name: "Other deck", packVersion: "1", packDate: "2026-09-26", cards: [{ id: "o1", category: "Other", q: "Other question one?", a: "Other answer one." }] });
    await G.db.put("kv", { k: "srs:unit:other-deck:o1", v: { reps: 1, ease: 2.5, interval: 1, due: Date.now() + 1e9, misses: 0, lastGrade: 2 } });
    return "srs:" + shipped;
  });
  await openSettingsPanel();
  await clickWhenStable(page, page.locator('[data-unit-deck-remove="' + DECK + '"]'));
  await page.waitForSelector('[data-unit-deck-confirm="' + DECK + '"] [role="group"]');
  const ask = await page.evaluate((id) => { const g = document.querySelector('[data-unit-deck-confirm="' + id + '"]'); return { text: g.textContent, keepChecked: g.querySelector('input[value="keep"]').checked, deleteChecked: g.querySelector('input[value="delete"]').checked, focus: document.activeElement && document.activeElement.value }; }, DECK);
  check(/Remove .Pinecone Ridge Demo Squadron study deck. from this device\? Its 8 cards will leave your study tools\./.test(ask.text) && /what Board Drill has scheduled for you/.test(ask.text) && /Keep it, in case you add this deck again/.test(ask.text) && /Delete it too/.test(ask.text), "Remove asks first, says what leaves, and offers to keep or delete the review progress in plain words", () => ask.text);
  check(ask.keepChecked && !ask.deleteChecked && ask.focus === "keep", "\"Keep it\" is the default and holds focus");
  check((await kv("unit-deck:" + DECK)) !== null, "nothing is removed just by asking");
  await clickWhenStable(page, page.locator('[data-unit-deck-confirm="' + DECK + '"] button', { hasText: /^Cancel$/ }));
  await until(page, (id) => !document.querySelector('[data-unit-deck-confirm="' + id + '"] [role="group"]'), DECK);
  check((await kv("unit-deck:" + DECK)) !== null && (await focusInfo()).attrs.includes("data-unit-deck-remove"), "Cancel removes nothing and returns focus to \"Remove deck\"");
  // remove, KEEPING progress
  await clickWhenStable(page, page.locator('[data-unit-deck-remove="' + DECK + '"]'));
  await clickWhenStable(page, page.locator('[data-unit-deck-remove-go="' + DECK + '"]'));
  await until(page, (id) => !document.querySelector('[data-unit-deck="' + id + '"]'), DECK);
  check((await kv("unit-deck:" + DECK)) === null && (await kv(graded)) !== null, "Remove with \"Keep it\": the deck is gone and its review progress is still on the device", async () => JSON.stringify(await kvKeys("srs:unit:")));
  await until(page, () => /was removed\. Your review progress on it was kept\./.test((document.getElementById("a11y-live") || {}).textContent || ""));
  check(/was removed\. Your review progress on it was kept\./.test(await live()), "the removal is announced (and says the progress was kept)", "the live region never said the deck was removed");
  check((await focusInfo()).attrs.includes("data-unit-deck-open"), "and focus lands on \"Add a unit deck\"", async () => JSON.stringify(await focusInfo()));
  check((await bankFacts()).unitCards === 1, "only the other deck's card is left in the study pool");
  // add it back: the progress is still attached to its cards
  await page.evaluate(async (p) => { await G.unitDecks.add(p); }, PACK);
  check((await kv(graded)) !== null && (await bankFacts()).unitCards === 9, "adding the deck again brings its cards back with their progress");
  // remove, DELETING progress - only this deck's
  await openSettingsPanel();
  await clickWhenStable(page, page.locator('[data-unit-deck-remove="' + DECK + '"]'));
  await page.locator('[data-unit-deck-confirm="' + DECK + '"] input[value="delete"]').check();
  await clickWhenStable(page, page.locator('[data-unit-deck-remove-go="' + DECK + '"]'));
  await until(page, (id) => !document.querySelector('[data-unit-deck="' + id + '"]'), DECK);
  check((await kv(graded)) === null && (await kvKeys("srs:unit:" + DECK + ":")).length === 0, "Remove with \"Delete it too\": this deck's progress is deleted", async () => JSON.stringify(await kvKeys("srs:unit:")));
  check((await kv(sentinel)) !== null && (await kv("srs:unit:other-deck:o1")) !== null, "and no shipped card's progress, and no other deck's, was touched");
  await page.evaluate(async () => { await G.unitDecks.remove("other-deck", { deleteHistory: true }); await G.db.del("kv", "srs:" + G.store.boardQuestions()[0].id); });
  // put the deck back for the remaining sections
  await page.evaluate(async (p) => { await G.unitDecks.add(p); }, PACK);
  // Reset progress asks first
  await openSettingsPanel();
  await page.evaluate(async () => { await G.db.put("kv", { k: "srs:unit:pinecone-ridge-demo:sop-001", v: { reps: 1, ease: 2.5, interval: 1, due: Date.now() + 1e9, misses: 0, lastGrade: 2 } }); });
  await clickWhenStable(page, page.locator('[data-unit-deck-reset="' + DECK + '"]'));
  await page.waitForSelector(".gm-box");
  const dlg = await page.evaluate(() => document.querySelector(".gm-box").innerText);
  check(/Reset your review progress on the 8 cards in .Pinecone Ridge Demo Squadron study deck.\? The deck stays\./.test(dlg), "Reset progress asks first and says the deck stays", () => dlg);
  await clickWhenStable(page, page.locator(".gm-box button", { hasText: /^Reset$/ }));
  await untilAsync(page, async () => !(await G.db.get("kv", "srs:unit:pinecone-ridge-demo:sop-001")));
  check((await bankFacts()).unitCards === 8, "Reset progress clears the progress and keeps the deck");
}

/* ================================================================= 7. text stays text */
{
  const payload = (n, tail) => "<img src=x onerror=\"window.__unitXss=" + n + "\">" + (tail || "");
  const xss = { format: "guidon-unit-pack", formatVersion: 1, id: "xss-deck", name: "Deck <img src=x onerror=window.__unitXss=1>", unit: "<svg onload=window.__unitXss=2>", packVersion: "1", packDate: "2026-09-26",
    reciteTitles: ["<img src=x onerror=window.__unitXss=6>"],
    cards: [1, 2, 3].map((i) => ({ id: "x" + i, category: "<b>cat</b>", q: "<script>window.__unitXss=3<\/script> What is " + i + "?", a: "\"><img src=x onerror=window.__unitXss=4> answer " + i, keyPoints: [payload(5, " point")], source: "<iframe srcdoc=\"<script>parent.__unitXss=7<\/script>\"> SOP" })) };
  const added = await page.evaluate(async (p) => await G.unitDecks.add(p), xss);
  check(added.ok === true, "a deck stuffed with <img onerror>, <script>, <svg onload> and an <iframe srcdoc> in every field is ACCEPTED (it is only text)", () => JSON.stringify(added));
  const LIT = "<img src=x onerror=window.__unitXss=1>";
  const seen = (label, cond, fail) => check(cond, "drawn as literal text, nothing runs and nothing is created: " + label, fail);
  await openSettingsPanel();
  let t = await panelText(), d = await danger();
  seen("Settings (name, unit label, counts)", t.includes("Deck " + LIT) && t.includes("<svg onload=window.__unitXss=2>") && d.pwned === 0 && d.bad === 0, () => JSON.stringify(d) + t.slice(0, 200));
  await fileAndCheck({ name: "x.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(xss)) });
  t = await resultText(); d = await danger();
  seen("the import preview (the same deck again: a replace notice, samples, suggested titles)", t.includes(LIT) && t.includes("<b>cat</b>") && t.includes("<img src=x onerror=window.__unitXss=6>") && d.pwned === 0 && d.bad === 0, () => JSON.stringify(d) + t.slice(0, 300));
  await clickWhenStable(page, page.locator("[data-unit-deck-preview] button", { hasText: /^Cancel$/ }));
  await openDrill();
  await pickCategoryRow("Unit: <b>cat</b>");
  const f = await front(); d = await danger();
  seen("the Board Drill card face (category, tag, question)", f && f.tag === "Unit deck: Deck " + LIT && /<script>window\.__unitXss=3<\/script> What is \d\?/.test(f.prompt) && /^Unit: <b>cat<\/b>/.test(f.label) && d.pwned === 0 && d.bad === 0, () => JSON.stringify({ f, d }));
  await clickWhenStable(page, page.locator(".qz-card"));
  await until(page, () => document.querySelector(".qz-card").classList.contains("flipped"));
  const back = await page.evaluate(() => document.querySelector(".qz-back").innerText); d = await danger();
  seen("the card back (answer, key point, source)", back.includes("\"><img src=x onerror=window.__unitXss=4> answer") && back.includes("<img src=x onerror=\"window.__unitXss=5\"> point") && back.includes("<iframe srcdoc=") && d.pwned === 0 && d.bad === 0, () => JSON.stringify(d) + back.slice(0, 300));
  await openTab("Quiz");
  await page.waitForSelector("select[aria-label='Filter by category']");
  await page.selectOption("select[aria-label='Filter by category']", "Unit: <b>cat</b>");
  await clickWhenStable(page, page.locator("button", { hasText: /^Start Quiz$/ }));
  await page.waitForSelector(".quiz-card .prompt");
  const qz = await page.evaluate(() => ({ tag: document.querySelector(".quiz-card .unit-deck-tag").textContent, prompt: document.querySelector(".quiz-card .prompt").textContent, opts: Array.from(document.querySelectorAll(".quiz-opt-text")).map((o) => o.textContent) })); d = await danger();
  seen("Quiz (question and options)", qz.tag.includes(LIT) && qz.prompt.includes("<script>") && d.pwned === 0 && d.bad === 0, () => JSON.stringify({ qz, d }));
  await openTab("Rapid Fire");
  await page.waitForSelector(".rf-setup-grid");
  await page.selectOption(".rf-setup-grid select[aria-label='Filter by category']", "Unit: <b>cat</b>");
  await startRound();
  await until(page, () => { const t = document.querySelector(".rf-root .unit-deck-tag"), q = document.querySelector(".rf-question"); if (!t || !q) return false; window.__rf = { tag: t.textContent, q: q.textContent }; return true; });
  const rf = await page.evaluate(() => window.__rf); d = await danger();
  seen("Rapid Fire", rf.tag.includes(LIT) && rf.q.includes("<script>") && d.pwned === 0 && d.bad === 0, () => JSON.stringify({ rf, d }));
  await waitForRoute(page, "#/search", { fresh: true, ready: "input[aria-label='Global search']" });
  await page.fill("input[aria-label='Global search']", "unitXss");
  await until(page, () => !!document.querySelector(".search-hit"));
  const sh = await page.evaluate(() => Array.from(document.querySelectorAll(".search-hit")).map((h) => h.innerText)); d = await danger();
  seen("search hits (title, second line, note)", sh.length >= 3 && sh.every((x) => x.includes("<") && /Unit deck/.test(x)) && d.pwned === 0 && d.bad === 0, () => JSON.stringify({ sh: sh.slice(0, 2), d }));
  await openDrill();
  await openTab("Readiness");
  await page.waitForSelector(".readiness-unit-decks");
  const rd = await page.evaluate(() => document.querySelector(".readiness-unit-decks").innerText); d = await danger();
  seen("Readiness row and its Study button", rd.includes("Unit deck: Deck " + LIT) && d.pwned === 0 && d.bad === 0, () => JSON.stringify(d) + rd.slice(0, 200));
  await waitForRoute(page, "#/recite", { fresh: true, ready: "[data-recite-own]" });
  const sg = await page.evaluate(() => Array.from(document.querySelectorAll("[data-recite-suggest]")).map((b) => b.textContent)); d = await danger();
  seen("the suggested-title prompt", sg.includes("Add: <img src=x onerror=window.__unitXss=6>") && d.pwned === 0 && d.bad === 0, () => JSON.stringify({ sg, d }));
  const stored = await kv("unit-deck:xss-deck");
  check(stored && stored.cards[0].q.includes("<script>") && stored.name.includes("<img"), "and the saved row holds the strings exactly as typed (never escaped, never stripped)");
  await page.evaluate(async () => { await G.unitDecks.remove("xss-deck", { deleteHistory: true }); });
  check((await page.evaluate(() => window.__unitXss)) === undefined, "in the end nothing ever ran (window.__unitXss was never set)");
}

/* ================================================================= 8. isolation, in the running app */
{
  const now = await bankFacts();
  check(now.unitCards === 8 && now.unitInBoard === 0 && now.unitInSeed === 0 && now.boardLen === before.boardLen && now.seedLen === before.seedLen && now.doctrine === before.doctrine, "with the deck on: store.boardQuestions() and the seed are exactly the shipped bank (same size, no unit id or category), and doctrine is unchanged", () => JSON.stringify({ now, before }));
  check(now.contentHash === before.contentHash && now.bankSig === before.bankSig, `the bank fingerprint (${now.contentHash}) and the room signature (${now.bankSig}) are unchanged`, () => JSON.stringify({ now, before }));
  await page.evaluate(() => G.store.setSetting("studyGroups", true));
  await waitForRoute(page, "#/group", { fresh: true, ready: "select.sg-category" });
  const opts = await page.evaluate(() => Array.from(document.querySelectorAll("select.sg-category option")).map((o) => o.value));
  check(opts.length > 20 && !opts.some((o) => /^Unit: /.test(o)) && !opts.some((o) => /Local SOP|Unit history|Pinecone/.test(o)), `the Study Rooms deck picker (${opts.length} options) offers no unit category, so a host cannot put a unit card on the LAN`, () => opts.filter((o) => /Unit/.test(o)).join(","));
  const roomText = await page.evaluate(() => document.getElementById("route").innerText);
  check(!/Pinecone|Local SOP|Squadron song/.test(roomText), "and the Study Rooms screen never mentions the deck");
  await page.evaluate(() => G.store.setSetting("studyGroups", false));
  check(outside.length === 0, "not one request left the page (no network, no socket, at any point)", () => outside.slice(0, 5).join(" | "));
}

/* ================================================================= 9. phone width */
{
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettingsPanel();
  await fileAndCheck(FIXTURE);
  const w1 = await overflow();
  check(w1 <= 0, "Settings with the deck preview open: nothing scrolls sideways at 390px", () => w1 + "px too wide");
  await clickWhenStable(page, page.locator("[data-unit-deck-preview] button", { hasText: /^Cancel$/ }));
  await openDrill();
  await pickCategoryRow("Unit: Local SOP");
  const w2 = await overflow();
  check(w2 <= 0, "Board Drill with a unit card up: nothing scrolls sideways at 390px", () => w2 + "px too wide");
  await clickWhenStable(page, page.locator(".qz-card"));
  await until(page, () => document.querySelector(".qz-card").classList.contains("flipped"));
  check((await overflow()) <= 0, "and with its back showing");
  await openTab("Readiness");
  await page.waitForSelector(".readiness-unit-decks");
  check((await overflow()) <= 0, "Readiness with its Unit Deck row: nothing scrolls sideways at 390px");
  await page.setViewportSize({ width: 1200, height: 900 });
}

/* ================================================================= 10. readable in every theme */
// axe-core's colour-contrast rule, run in all of the app's themes (the same per-theme loop
// tools/test-contrast-full.mjs uses) against each screen this feature draws - and only the
// nodes that belong to the feature are counted, so an unrelated finding elsewhere cannot fail this.
{
  await page.addScriptTag({ content: readFileSync(new URL(import.meta.resolve("axe-core/axe.min.js")), "utf8") });
  // Colours are measured at rest: a button part-way through its theme cross-fade reads as a false low contrast
  // (the same reason tools/test-contrast-full.mjs turns transitions off before it sweeps).
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  const themes = await page.evaluate(() => G.theme.ids.themes.slice());
  const sweep = async (label) => {
    const bad1 = [];
    for (const t of themes) {
      await page.evaluate((id) => document.documentElement.setAttribute("data-theme", id), t);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const found = await page.evaluate(async () => {
        const r = await axe.run(document, { runOnly: ["color-contrast"] });
        const mine = [];
        r.violations.forEach((v) => v.nodes.forEach((n) => {
          let el = null;
          try { el = document.querySelector(n.target[n.target.length - 1]); } catch (e) { el = null; }
          if (el && el.closest("#settings-unitdecks-panel, .readiness-unit-decks, .unit-deck-tag, [data-unit-deck-preview]")) mine.push({ target: n.target.join(" "), summary: (n.failureSummary || "").split("\n").slice(0, 2).join(" ") });
        }));
        return mine;
      });
      found.forEach((f) => bad1.push(t + ": " + f.target + " - " + f.summary));
    }
    return bad1;
  };
  await openDrill();
  await pickCategoryRow("Unit: Local SOP");
  let bad1 = await sweep("Board Drill front");
  check(bad1.length === 0 && themes.length >= 20, `the "Unit deck" label on a card face is readable in all ${themes.length} themes (axe colour contrast)`, () => bad1.slice(0, 3).join(" | "));
  await clickWhenStable(page, page.locator(".qz-card"));
  await until(page, () => document.querySelector(".qz-card").classList.contains("flipped"));
  bad1 = await sweep("Board Drill back");
  check(bad1.length === 0, "and on the answer face, in every theme", () => bad1.slice(0, 3).join(" | "));
  await openSettingsPanel();
  await fileAndCheck(FIXTURE);
  bad1 = await sweep("Settings");
  check(bad1.length === 0, "the Unit decks panel (deck row, notice, preview) is readable in every theme", () => bad1.slice(0, 3).join(" | "));
  await clickWhenStable(page, page.locator("[data-unit-deck-preview] button", { hasText: /^Cancel$/ }));
  await openDrill();
  await openTab("Readiness");
  await page.waitForSelector(".readiness-unit-decks");
  bad1 = await sweep("Readiness");
  check(bad1.length === 0, "and so is the Unit Deck Readiness row", () => bad1.slice(0, 3).join(" | "));
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", G.theme.ids.themes[0]));
}

expectNoConsoleNoise(noise);
await finish("UNIT DECKS");
