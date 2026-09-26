/**
 * Unit deck format: the closed schema, every cap, the sensitive-text screen, the
 * citation parser twin and the saved-row check.
 *
 * WHY THIS SUITE EXISTS. A unit deck is a NEW input surface: a file a leader
 * writes and Soldiers import. Until now the app ingested only its own backups,
 * shared plan files, MOI text and pasted text. Everything a deck may do is
 * decided by ONE file, src/app-modules/unit-decks-core.js (the app, the authoring
 * command and these tests all load that same file), and if any rule in it slipped
 * nothing on screen would say so until a Soldier imported a deck that should have
 * been refused. So every rule is held here by a planted defect that must be named:
 *
 *  1. The closed schema. Every cap is checked at the limit (accepted) and one past
 *     it (refused, naming the card and the field); every field is checked for the
 *     wrong type; any key the format does not list is refused, at the top and on a
 *     card; a newer format version is refused with its own plain message and the
 *     rest of that deck is not judged; control characters and direction overrides
 *     are refused; a string full of HTML is ACCEPTED as text (nothing here treats it
 *     as markup) and comes out the other side exactly as typed.
 *  2. The sensitive-text screen, field by field: a finding planted in the deck
 *     name, unit label, deck id, card id, category, question, answer (on its second
 *     line), a key point, a source and a suggested title each REFUSES THE WHOLE DECK
 *     and names that card and that field. Every severity the guard has (marking
 *     syntax; Social Security and DoD ID numbers; a labelled UIC; a phone number; an
 *     email address; a sentence stating a classification; a future date with a
 *     place and a unit activity) and a roster-like list of names each refuse it -
 *     while ordinary study words ("secret", "confidential"), a list of rank
 *     TITLES and the fictional example deck do not. With no screen available the
 *     answer is "refused", never "accepted".
 *  3. The citation twin. A page cannot import tools/citation-parse.mjs, so the app
 *     carries a port; here BOTH parse every citation the shipped bank uses plus
 *     6,000 generated strings and must agree on every entry, every separator and
 *     every regulation chip - and a "Battalion SOP 2026" makes no chip.
 *  4. The saved row: what a restore, Diagnostics and the app's own start-up trust.
 *     A planted defect in each part of a row (an unknown key, a wrong version, a
 *     claim of "verbatim", a card with no answer ...) is refused; a row the app
 *     itself produces is accepted.
 *  5. Namespaced ids: no shipped card id can equal a unit card id, and two decks
 *     that reuse card ids still get distinct history ids.
 *  6. No markup and no network in the modules that draw or keep a deck (a static
 *     scan), and the numbers in docs/unit-packs.md are the numbers in the code.
 *
 * Pure node: the validator runs in a node:vm sandbox with no page.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, bad, check, finish } from "./testkit.mjs";
import { assembleBank } from "./assemble-bank.mjs";
import { loadModules } from "./module-manifest.mjs";
import { loadUnitPackKit, nodeCite, nodeParseSource, nodeRenderCitation, nodeRegulationsOfEntries, nodeStartsWithDesignator } from "./unit-pack-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const clone = (x) => JSON.parse(JSON.stringify(x));
const G = loadUnitPackKit();
const P = G.unitPack;
const L = P.LIMITS;
const NOW = "2026-09-26";

const BASE = {
  format: "guidon-unit-pack", formatVersion: 1, id: "alpha-demo", name: "Alpha demo deck", unit: "Alpha Demo Troop (fictional)",
  packVersion: "2026.09", packDate: "2026-09-26",
  cards: [
    { id: "sop-001", category: "Local SOP", q: "When is formation?", a: "0630.", keyPoints: ["Be early", "Be in uniform"], source: "Alpha Demo SOP 2026, para 2-1" },
    { id: "sop-002", category: "Local SOP", q: "Where is the supply window?", a: "Building A, west door.\nOpen weekdays.", keyPoints: ["West door"] },
    { id: "hist-001", category: "History", q: "What year was the troop activated?", a: "2026.", source: "Alpha Demo history handout" },
  ],
  reciteTitles: ["Troop song", "Troop motto"],
};
const valid = (p) => P.validate(p);
const errsOf = (p) => valid(p).errors;
const strOf = (n, c = "x") => c.repeat(n);

/* ------------------------------------------------------------------ 0. the baseline */
{
  const r = valid(BASE);
  check(r.ok, "a small, honest deck is accepted", () => JSON.stringify(r.errors));
  const fixture = JSON.parse(readFileSync(path.join(HERE, "fixtures", "unit-pack-example.pack.json"), "utf8"));
  check(valid(fixture).ok && P.screen(fixture, { now: NOW }).ok, "the fictional example deck (tools/fixtures/unit-pack-example.pack.json) passes the validator and the screen", () => JSON.stringify(valid(fixture).errors.concat(P.screen(fixture, { now: NOW }).findings)));
}

/* ------------------------------------------------------------------ 1. the closed schema */
// Every cap: at the limit it is accepted, one past it it is refused with a message that names the card and the field.
{
  const at = (label, mutate) => { const p = clone(BASE); mutate(p); const r = valid(p); check(r.ok, `at the limit is accepted: ${label}`, () => JSON.stringify(r.errors.slice(0, 2))); };
  const past = (label, mutate, code, wantText) => {
    const p = clone(BASE); mutate(p); const r = valid(p);
    const hit = !r.ok && r.errors.some((e) => e.code === code && (!wantText || wantText.test(e.message)));
    check(hit, `one past the limit is refused, in plain words: ${label}`, () => JSON.stringify(r.errors.slice(0, 3)));
  };
  at("deck id, 40 characters", (p) => { p.id = strOf(40, "a"); });
  past("deck id, 41 characters", (p) => { p.id = strOf(41, "a"); }, "bad-id", /deck id/);
  past("deck id, 2 characters", (p) => { p.id = "ab"; }, "bad-id", /deck id/);
  past("deck id with capitals or spaces", (p) => { p.id = "Alpha Demo"; }, "bad-id", /deck id/);
  at("deck name, 60 characters", (p) => { p.name = strOf(L.name); });
  past("deck name, 61 characters", (p) => { p.name = strOf(L.name + 1); }, "too-long", /deck name is longer than 60 characters \(it has 61\)/);
  at("unit label, 60 characters", (p) => { p.unit = strOf(L.unit); });
  past("unit label, 61 characters", (p) => { p.unit = strOf(L.unit + 1); }, "too-long", /unit label/);
  at("version label, 20 characters", (p) => { p.packVersion = strOf(L.packVersion, "1"); });
  past("version label, 21 characters", (p) => { p.packVersion = strOf(L.packVersion + 1, "1"); }, "bad-version-label", /version label/);
  past("version label with a space", (p) => { p.packVersion = "2026 09"; }, "bad-version-label", /version label/);
  at("card id, 30 characters", (p) => { p.cards[0].id = strOf(L.cardIdMax, "a"); });
  past("card id, 31 characters", (p) => { p.cards[0].id = strOf(L.cardIdMax + 1, "a"); }, "bad-id", /Card 1.*card id/);
  at("category, 40 characters", (p) => { p.cards[0].category = strOf(L.category); });
  past("category, 41 characters", (p) => { p.cards[0].category = strOf(L.category + 1); }, "too-long", /Card 1 \(sop-001\): the category is longer than 40/);
  at("question, 300 characters", (p) => { p.cards[0].q = strOf(L.question); });
  past("question, 301 characters", (p) => { p.cards[0].q = strOf(L.question + 1); }, "too-long", /the question is longer than 300 characters \(it has 301\)/);
  at("answer, 1200 characters", (p) => { p.cards[0].a = strOf(L.answer); });
  past("answer, 1201 characters", (p) => { p.cards[0].a = strOf(L.answer + 1); }, "too-long", /the answer is longer than 1,200 characters \(it has 1,201\)/);
  at("8 key points", (p) => { p.cards[0].keyPoints = Array.from({ length: L.keyPoints }, (_, i) => "point " + i); });
  past("9 key points", (p) => { p.cards[0].keyPoints = Array.from({ length: L.keyPoints + 1 }, (_, i) => "point " + i); }, "too-many", /9 key points; the most allowed is 8/);
  at("a key point of 200 characters", (p) => { p.cards[0].keyPoints = [strOf(L.keyPoint)]; });
  past("a key point of 201 characters", (p) => { p.cards[0].keyPoints = [strOf(L.keyPoint + 1)]; }, "too-long", /key point 1/);
  at("a source of 200 characters", (p) => { p.cards[0].source = strOf(L.source); });
  past("a source of 201 characters", (p) => { p.cards[0].source = strOf(L.source + 1); }, "too-long", /the source/);
  at("8 suggested titles", (p) => { p.reciteTitles = Array.from({ length: L.reciteTitles }, (_, i) => "Title " + i); });
  past("9 suggested titles", (p) => { p.reciteTitles = Array.from({ length: L.reciteTitles + 1 }, (_, i) => "Title " + i); }, "too-many", /suggested titles/);
  at("a suggested title of 60 characters", (p) => { p.reciteTitles = [strOf(L.reciteTitle)]; });
  past("a suggested title of 61 characters", (p) => { p.reciteTitles = [strOf(L.reciteTitle + 1)]; }, "too-long", /Suggested title 1/);
  at("exactly 200 cards", (p) => { p.cards = Array.from({ length: L.cards }, (_, i) => ({ id: "c" + i, category: "Cat " + (i % 30), q: "Question number " + i, a: "Answer " + i })); });
  past("201 cards", (p) => { p.cards = Array.from({ length: L.cards + 1 }, (_, i) => ({ id: "c" + i, category: "Cat", q: "Question number " + i, a: "A" })); }, "too-many", /201 cards; the most allowed is 200/);
  past("no cards at all", (p) => { p.cards = []; }, "empty", /no cards/);
  at("30 categories", (p) => { p.cards = Array.from({ length: 30 }, (_, i) => ({ id: "c" + i, category: "Cat " + i, q: "Question number " + i, a: "A" })); });
  past("31 categories", (p) => { p.cards = Array.from({ length: 31 }, (_, i) => ({ id: "c" + i, category: "Cat " + i, q: "Question number " + i, a: "A" })); }, "too-many-categories", /31 different categories/);
  // The total: 200 cards each near its own caps is far past 256 KB.
  past("the whole deck over 256 KB", (p) => { p.cards = Array.from({ length: L.cards }, (_, i) => ({ id: "c" + i, category: "Cat", q: "Question " + i + " " + strOf(L.question - 20), a: strOf(L.answer), keyPoints: Array.from({ length: 8 }, () => strOf(L.keyPoint)), source: strOf(L.source) })); }, "too-big", /KB; the most allowed is 256 KB/);
  // Bytes, not characters: a deck of 3-byte characters hits the cap sooner.
  past("bytes, not characters (multi-byte text)", (p) => { p.cards = Array.from({ length: L.cards }, (_, i) => ({ id: "c" + i, category: "Cat", q: "Q" + i, a: strOf(500, "€"), keyPoints: Array.from({ length: 8 }, () => strOf(190, "€")), source: strOf(150, "€") })); }, "too-big");
}

// Wrong types and missing parts, one at a time.
{
  const bogus = (label, mutate, code, path) => { const p = clone(BASE); mutate(p); const r = valid(p); check(!r.ok && r.errors.some((e) => e.code === code && (!path || e.path === path)), `refused: ${label}`, () => JSON.stringify(r.errors.slice(0, 3))); };
  bogus("name is a number", (p) => { p.name = 7; }, "wrong-type", "name");
  bogus("name is missing", (p) => { delete p.name; }, "missing", "name");
  bogus("name is only spaces", (p) => { p.name = "   "; }, "empty", "name");
  bogus("unit label present but empty", (p) => { p.unit = ""; }, "empty", "unit");
  bogus("id is missing", (p) => { delete p.id; }, "missing", "id");
  bogus("packVersion is a number", (p) => { p.packVersion = 2026.09; }, "bad-version-label", "packVersion");
  bogus("packDate is not a date (30 February)", (p) => { p.packDate = "2026-02-30"; }, "bad-date", "packDate");
  bogus("packDate is written the American way", (p) => { p.packDate = "09/26/2026"; }, "bad-date", "packDate");
  bogus("packDate is missing", (p) => { delete p.packDate; }, "bad-date", "packDate");
  bogus("cards is an object", (p) => { p.cards = { a: 1 }; }, "wrong-type", "cards");
  bogus("a card is a string", (p) => { p.cards[1] = "just text"; }, "wrong-type", "cards[1]");
  bogus("a card is null", (p) => { p.cards[1] = null; }, "wrong-type", "cards[1]");
  bogus("a card has no question", (p) => { delete p.cards[0].q; }, "missing", "cards[0].q");
  bogus("a card's answer is a list", (p) => { p.cards[0].a = ["a"]; }, "wrong-type", "cards[0].a");
  bogus("a card's answer is empty", (p) => { p.cards[0].a = ""; }, "empty", "cards[0].a");
  bogus("keyPoints is a string", (p) => { p.cards[0].keyPoints = "one | two"; }, "wrong-type", "cards[0].keyPoints");
  bogus("a key point is a number", (p) => { p.cards[0].keyPoints = [1]; }, "wrong-type", "cards[0].keyPoints[0]");
  bogus("source is a list", (p) => { p.cards[0].source = [{ pub: "AR 600-20" }]; }, "wrong-type", "cards[0].source");
  bogus("reciteTitles is a string", (p) => { p.reciteTitles = "Unit song"; }, "wrong-type", "reciteTitles");
  bogus("a suggested title is empty", (p) => { p.reciteTitles = [""]; }, "empty", "reciteTitles[0]");
  bogus("the same suggested title twice (any case)", (p) => { p.reciteTitles = ["Unit song", "unit SONG"]; }, "duplicate", "reciteTitles[1]");
  bogus("two cards share an id", (p) => { p.cards[1].id = "sop-001"; }, "duplicate", "cards[1].id");
  bogus("two cards ask the same question (any case, spacing)", (p) => { p.cards[1].q = "  WHEN   is formation? "; }, "duplicate", "cards[1].q");
  bogus("format is not ours", (p) => { p.format = "something-else"; }, "wrong-format", "format");
  bogus("format is missing", (p) => { delete p.format; }, "wrong-format", "format");
  bogus("formatVersion is the string \"1\"", (p) => { p.formatVersion = "1"; }, "bad-version", "formatVersion");
  bogus("formatVersion is 0", (p) => { p.formatVersion = 0; }, "bad-version", "formatVersion");
  bogus("formatVersion is 1.5", (p) => { p.formatVersion = 1.5; }, "bad-version", "formatVersion");
  for (const bad of [null, [], 7, "text", true]) check(!valid(bad).ok && valid(bad).errors[0].code === "not-a-deck", `a deck that is ${JSON.stringify(bad)} is refused as "not a deck"`);
}

// Unknown keys: the schema is closed.
{
  const p = clone(BASE); p.author = "someone";
  const r = valid(p);
  check(!r.ok && r.errors.some((e) => e.code === "unknown-key" && e.path === "author" && /"author"/.test(e.message) && /may only use/.test(e.message)), "an unknown top-level field is refused and named", () => JSON.stringify(r.errors));
  const q = clone(BASE); q.cards[2].image = "data:image/png;base64,AAAA";
  const r2 = valid(q);
  check(!r2.ok && r2.errors.some((e) => e.code === "unknown-key" && e.path === "cards[2].image" && /Card 3 \(hist-001\)/.test(e.message)), "an unknown field on a card (an image, say) is refused and names the card", () => JSON.stringify(r2.errors));
  for (const k of ["html", "script", "url", "href", "onclick", "image", "images", "code", "difficulty", "pillar", "tier", "mos", "lines", "reciteText", "lyrics"]) {
    const c = clone(BASE); c.cards[0][k] = "x";
    check(!valid(c).ok, `a card field "${k}" is refused (a unit deck cannot carry ${k})`);
  }
  // JSON.parse makes "__proto__" an ordinary own key; it must be refused as unknown, never merged.
  const parsed = JSON.parse('{"format":"guidon-unit-pack","formatVersion":1,"__proto__":{"polluted":true}}');
  const r3 = valid(parsed);
  check(!r3.ok && Object.prototype.polluted === undefined && ({}).polluted === undefined, "a \"__proto__\" key in a deck pollutes nothing and is refused", () => JSON.stringify(r3.errors.slice(0, 2)));
}

// A newer format is refused with its own message, and the rest is not judged.
{
  const p = clone(BASE); p.formatVersion = 2; p.somethingNew = { a: 1 }; p.cards[0].futureField = 1;
  const r = valid(p);
  check(!r.ok && r.newer === true && r.errors.length === 1 && r.errors[0].code === "newer-version" && /newer deck format \(version 2\)/.test(r.errors[0].message) && /Update GUIDON/.test(r.errors[0].message),
    "a deck from a newer format is refused with one plain message (update GUIDON), not a list of unknown fields", () => JSON.stringify(r));
  const t = P.parse(JSON.stringify(p));
  check(!t.ok && t.newer === true, "the same, arriving as text");
}

// Characters that have no place in study text.
{
  const bogus = (label, mutate) => { const p = clone(BASE); mutate(p); const r = valid(p); check(!r.ok && r.errors.some((e) => e.code === "bad-characters"), `refused: ${label}`, () => JSON.stringify(r.errors.slice(0, 2))); };
  bogus("a NUL byte in a question", (p) => { p.cards[0].q = "Formation\u0000 time?"; });
  bogus("a line break in a question", (p) => { p.cards[0].q = "Formation\ntime?"; });
  bogus("a tab in a category", (p) => { p.cards[0].category = "Local\tSOP"; });
  bogus("a right-to-left override in an answer", (p) => { p.cards[0].a = "Nine ‮eno‬"; });
  bogus("an isolate control in the deck name", (p) => { p.name = "Alpha ⁦demo"; });
  bogus("a lone surrogate in a key point", (p) => { p.cards[0].keyPoints = ["half \uD83D"]; });
  bogus("a byte-order mark in the middle of a source", (p) => { p.cards[0].source = "SOP﻿ 2026"; });
  const p = clone(BASE); p.cards[0].a = "Line one\r\nLine two\n\tindented";
  check(valid(p).ok, "an answer may have line breaks, carriage returns and tabs");
  const e = clone(BASE); e.cards[0].a = "Well done \u{1F44D} éè 字";
  check(valid(e).ok, "ordinary Unicode (an emoji, accents, a CJK character) is fine");
}

// HTML is TEXT: accepted, never interpreted, and unchanged on the far side.
{
  const html = "<img src=x onerror=alert(1)> <script>alert(2)<\/script> &amp; \"quoted\" 'single' <b>bold</b>";
  const p = clone(BASE); p.name = "Deck <i>one</i>"; p.cards[0].q = "What is " + html + "?"; p.cards[0].a = html; p.cards[0].keyPoints = [html]; p.cards[0].source = "SOP <u>2026</u>"; p.reciteTitles = ["Song <b>1</b>"];
  const r = valid(p);
  check(r.ok, "text with angle brackets, quotes and script tags is accepted as ordinary text", () => JSON.stringify(r.errors));
  const row = P.toDeck(p, { importedAt: "2026-09-26T00:00:00.000Z" });
  const cards = P.cardsOf(row);
  check(cards[0].a === html && cards[0].q === "What is " + html + "?" && cards[0].keyPoints[0] === html && row.name === "Deck <i>one</i>" && row.reciteTitles[0] === "Song <b>1</b>",
    "and it comes out the other side character for character, never escaped, stripped or interpreted");
  check(P.renderCitation(cards[0].source) === "SOP <u>2026</u>", "a source with markup renders back as the same text");
}

// parse(): everything before the schema.
{
  const text = JSON.stringify(BASE);
  check(P.parse(text).ok, "parse() accepts the deck as text");
  check(P.parse("﻿" + text).ok, "a leading byte-order mark (Windows editors add one) is ignored");
  for (const [label, t, code] of [["nothing at all", "", "empty"], ["only spaces", "  \n ", "empty"], ["not JSON", "hello", "not-json"], ["a truncated file", text.slice(0, 40), "not-json"], ["an array", "[1,2]", "not-a-deck"]]) {
    const r = P.parse(t);
    check(!r.ok && r.errors[0].code === code, `parse() refuses ${label}`, () => JSON.stringify(r));
  }
  const r = P.parse("x".repeat(L.bytes + 1));
  check(!r.ok && r.errors[0].code === "too-big", "parse() refuses text over 256 KB before it tries to read it");
  check(!P.parse(12).ok, "parse() refuses a value that is not text");
  const deep = "[".repeat(100000) + "]".repeat(100000);
  check(!P.parse(deep).ok, "a file that is nothing but nested brackets is refused without a crash");
  const msgs = errsOf(Object.assign(clone(BASE), { cards: [{ id: "x1", category: 5 }, 7] })).map((e) => e.message).join(" ");
  check(!/undefined|\[object|TypeError|NaN|null/.test(msgs), "no message ever reads \"undefined\", \"[object Object]\" or an engine error", () => msgs);
}

// Many problems: the list is capped, and says so.
{
  const p = clone(BASE); p.cards = Array.from({ length: 150 }, (_, i) => ({ id: "c" + i, category: "", q: "", a: "" }));
  const r = valid(p);
  check(!r.ok && r.errors.length <= 60 && r.truncated === true, "a deck with hundreds of problems reports at most 60 and says the list is cut", () => r.errors.length + " " + r.truncated);
}

/* ------------------------------------------------------------------ 2. sensitive-text screen */
const findsAt = (mutate, whereRe, looksRe) => {
  const p = clone(BASE); mutate(p);
  const v = valid(p);
  const s = P.screen(p, { now: NOW });
  return { valid: v.ok, s, hit: !s.ok && s.findings.some((f) => whereRe.test(f.where) && (!looksRe || looksRe.test(f.looksLike))) };
};
{
  const SSN = "123-45-6789", MARK = "SECRET//NOFORN";
  const fields = [
    ["the deck name", (p) => { p.name = "Deck " + MARK; }, /^The deck name$/],
    ["the unit label", (p) => { p.unit = "Unit " + MARK; }, /^The unit label$/],
    ["the deck id", (p) => { p.id = "ssn-" + SSN; }, /^The deck id$/],
    ["a card id", (p) => { p.cards[1].id = "ssn-" + SSN; }, /^Card 2 \(ssn-123-45-6789\), id$/],
    ["a category", (p) => { p.cards[2].category = "History " + MARK; }, /^Card 3 \(hist-001\), category$/],
    ["a question", (p) => { p.cards[0].q = "Who has SSN " + SSN + "?"; }, /^Card 1 \(sop-001\), question$/],
    ["an answer", (p) => { p.cards[1].a = "Building A.\nCall the office: " + MARK; }, /^Card 2 \(sop-002\), answer$/],
    ["a key point", (p) => { p.cards[0].keyPoints = ["fine", "Marked " + MARK]; }, /^Card 1 \(sop-001\), key point 2$/],
    ["a source", (p) => { p.cards[0].source = "Annex " + MARK; }, /^Card 1 \(sop-001\), source$/],
    ["a suggested title", (p) => { p.reciteTitles = ["Song", MARK]; }, /^Suggested title 2$/],
  ];
  for (const [label, mutate, where] of fields) {
    const r = findsAt(mutate, where);
    check(r.valid && r.hit, `a finding planted in ${label} refuses the whole deck and names that field`, () => JSON.stringify(r.s.findings.slice(0, 3)));
  }
  // The second line of an answer: the message says "line 2".
  const p = clone(BASE); p.cards[1].a = "Building A.\nCall the office: " + MARK;
  const s = P.screen(p, { now: NOW });
  check(s.findings.length === 1 && s.findings[0].line === 2 && /^Card 2 \(sop-002\), answer, line 2: this looks like a classification or handling marking/.test(P.describeFinding(s.findings[0])),
    "the message names the card, the field and the line, in plain words", () => P.describeFinding(s.findings[0] || {}));

  // Every kind of finding the guard can make.
  const kinds = [
    ["a classification banner line", "Notes:\nSECRET\nmore", /classification or handling marking/],
    ["a control marking", "Handle as CUI//SP-PRVCY", /classification or handling marking/],
    ["a portion mark that starts a line", "(S) The unit departs the area.", /classification or handling marking/],
    ["a CUI designation block", "CUI Category: PRVCY", /CUI handling block/],
    ["a classification label", "Classification: SECRET", /classification or handling marking/],
    ["a Social Security number", "Use " + SSN + " to look it up.", /Social Security number/],
    ["a labelled Social Security number", "SSN 123456789", /Social Security number/],
    ["a labelled DoD ID number", "DoD ID 1234567890", /DoD ID number/],
    ["a labelled unit identification code", "UIC: WABC12", /unit identification code/],
    ["a phone number", "Call 555-123-4567 after hours.", /phone number/],
    ["an email address", "Write to first.last@example.com.", /email address/],
    ["a sentence stating a classification", "This document is SECRET.", /sentence saying the text is classified/],
    ["a future date, a place and a unit activity", "The convoy departs Fort Foo on 15 March 2027.", /future date and place/],
    ["a roster of ranks and names, one per line", "SGT Smith\nSSG Jones\nSPC Brown", /list of people's names/],
    ["a roster of ranks and names, on one line", "SGT Smith, SSG Jones, SPC Brown, CPL Green went.", /list of people's names/],
    ["a roster written surname, first name", "SMITH, John\nJONES, Mary\nBROWN, Sam", /list of people's names/],
  ];
  for (const [label, text, looks] of kinds) {
    const r = findsAt((q) => { q.cards[0].a = text; }, /^Card 1 \(sop-001\), answer$/, looks);
    check(r.valid && r.hit, `refused: ${label}`, () => JSON.stringify(r.s.findings.slice(0, 3)));
  }
  // Ordinary study text must NOT be refused.
  const clean = [
    ["the everyday words secret and confidential", "A secret ballot keeps a vote confidential; keep it a secret."],
    ["study text about markings", "Top Secret, Secret, and Confidential are the three classification levels. CUI is unclassified information that needs safeguarding."],
    ["a past date with a place and an activity", "The convoy departed Fort Foo on 15 March 2020."],
    ["a regulation followed by its year", "See AR 600-20 2020 for the policy."],
    ["a toll-free hotline", "The veterans line is 800-273-8255."],
    ["a list of rank TITLES", "PVT Private, PFC Private First Class, SPC Specialist, CPL Corporal, SGT Sergeant"],
    ["a school name that starts with a rank abbreviation", "The SGM Academy runs the course."],
    ["one person named once", "SGT York is the unit's namesake."],
  ];
  for (const [label, text] of clean) {
    const p2 = clone(BASE); p2.cards[0].a = text;
    const s2 = P.screen(p2, { now: NOW });
    check(s2.ok, `not refused: ${label}`, () => JSON.stringify(s2.findings));
  }
  // The same future-date sentence with a date already past is fine (the device clock decides).
  const past = clone(BASE); past.cards[0].a = "The convoy departs Fort Foo on 15 March 2027.";
  check(P.screen(past, { now: "2028-01-01" }).ok && !P.screen(past, { now: "2026-09-26" }).ok, "the future-date check reads the clock: refused before the date, fine after it");
}

// One bad field among 100 clean cards refuses the whole deck.
{
  const p = clone(BASE);
  p.cards = Array.from({ length: 100 }, (_, i) => ({ id: "c" + i, category: "Cat " + (i % 5), q: "Question number " + i, a: "A plain answer number " + i }));
  check(P.screen(p, { now: NOW }).ok, "a hundred clean cards pass the screen");
  p.cards[57].a += " (CUI//SP-PRVCY)";
  const s = P.screen(p, { now: NOW });
  check(!s.ok && s.total === 1 && /^Card 58 \(c57\), answer$/.test(s.findings[0].where), "one bad field in a hundred cards refuses the deck and names that one card", () => JSON.stringify(s.findings));
}
// A pasted list of phone numbers: the report is capped and says how many there were.
{
  const p = clone(BASE); p.cards[0].a = Array.from({ length: 30 }, (_, i) => "555-010-" + String(1000 + i)).join("\n");
  const s = P.screen(p, { now: NOW });
  check(!s.ok && s.findings.length <= 50 && s.total >= s.findings.length, "a wall of findings is capped in the list but counted in full", () => s.total + " " + s.findings.length);
}
// Fail closed.
{
  const bare = loadUnitPackKit();
  delete bare.opsecGuard;
  const s = bare.unitPack.screen(BASE, { now: NOW });
  check(s.ok === false && s.unavailable === true && /not available/.test(s.message), "with no sensitive-text check available the deck is refused, never accepted");
}
// Excerpts never repeat a whole identifier: an SSN inside an excerpt of some OTHER finding is masked.
{
  const p = clone(BASE); p.cards[0].a = "Call 555-123-4567 or use SSN 123-45-6789 today.";
  const shown = P.screen(p, { now: NOW }).findings.map(P.describeFinding).join(" | ");
  check(!/123-45-6789/.test(shown), "a Social Security number is never repeated in full in what the Soldier is shown", () => shown);
}

/* ------------------------------------------------------------------ 3. the citation twin */
{
  const bank = assembleBank().data;
  const texts = new Set();
  const add = (s) => { if (typeof s === "string" && s) texts.add(s); };
  (bank.board.questions || []).forEach((q) => add(nodeRenderCitation(q.source)));
  (bank.doctrine.entries || []).forEach((e) => add(nodeRenderCitation(e.source)));
  // Generated: publications, locators, editions, joiners, names of things that are not publications, and damage.
  let seed = 20260926;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const PUBS = ["AR 600-20", "AR 600-8-19", "DA PAM 600-25", "DA Pam 623-3", "ATP 6-22.1", "ADP 6-22", "FM 7-22", "TC 3-21.5", "TC 3-22.9", "DoDI 1300.17", "DODD 5205.02", "37 USC 403", "10 U.S.C. 892", "32 CFR 199", "UCMJ Art. 86", "UCMJ", "DA Form 4856", "DD Form 2977", "EO 10631", "Army Directive 2025-06", "ALARACT 100/2025", "MILPER 25-100", "STP 21-1-SMCT", "TB MED 507", "MRE 313", "Geneva Conventions", "Posse Comitatus Act", "SCRA", "JTR", "National Response Framework"];
  const RESIDUE = ["Battalion SOP 2026", "Squadron SOP", "unit SOP", "Local promotion-board MOI", "VA.gov", "DFAS", "myPay", "Company policy letter", "Brigade standing order 4", "Creeds", "Army MRT curriculum", "pending-source: check with S1", "not a publication; unit handout", "this pack cites directly", "confidence: low"];
  const LOC = ["para 3-9c", "paras 4-3 and 6-5", "Ch 2", "Chapter 6", "Table 16-1", "Appendix B", "Section II", "Figure 3-1", "MOS 92A", "Art. 15", "step 4"];
  const ED = ["1 Jul 2024", "Mar 2025", "2020", "2026-03", "15 Apr 2026", "Sept 2019", "2021-05-04"];
  const JOIN = ["; ", " / ", ", ", " · ", "; ", " and ", " — "];
  const DAMAGE = [(s) => s + " ", (s) => " " + s, (s) => s.replace(/ /, "  "), (s) => s + " (", (s) => "(" + s, (s) => s + ")", (s) => '"' + s, (s) => s + ",", (s) => s.toUpperCase(), (s) => s.toLowerCase(), (s) => s + ";", (s) => s + " ;"];
  const piece = () => {
    const kind = rnd();
    let s = kind < 0.6 ? pick(PUBS) : pick(RESIDUE);
    if (kind < 0.6 && rnd() < 0.55) s += (rnd() < 0.7 ? ", " : " ") + pick(LOC);
    if (rnd() < 0.3) s += " (" + pick(ED) + ")";
    if (kind < 0.6 && rnd() < 0.15) s += " (" + pick(["Counseling", "BRS", "TAMMS", "fictional"]) + ")";
    return s;
  };
  for (let i = 0; i < 6000; i++) {
    let s = piece();
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 1; k < n; k++) s += pick(JOIN) + piece();
    if (rnd() < 0.2) s = pick(DAMAGE)(s);
    texts.add(s);
  }
  let checked = 0, drift = [];
  for (const text of texts) {
    checked++;
    let want, got;
    try { want = nodeCite(text, "paraphrase"); } catch (e) { want = "throws"; }
    try { got = P.cite(text); } catch (e) { got = "throws"; }
    if (JSON.stringify(want) !== JSON.stringify(got)) drift.push({ text, want, got });
    const wp = nodeParseSource(text), gp = P.parseSource(text);
    if (JSON.stringify(wp) !== JSON.stringify(gp)) drift.push({ text, parse: [wp, gp] });
    if (Array.isArray(want)) {
      const wantRegs = nodeRegulationsOfEntries(want.filter((e) => nodeStartsWithDesignator(e.pub)));
      const gotRegs = P.regulationsOfEntries(got);
      if (JSON.stringify(wantRegs) !== JSON.stringify(gotRegs)) drift.push({ text, regs: [wantRegs, gotRegs] });
      // The parser's own promise: it renders back to exactly what was written (when written cleanly).
      if (text === text.trim() && text && P.renderCitation(got) !== text && !/\s{2,}/.test(text)) drift.push({ text, render: P.renderCitation(got) });
    }
  }
  check(drift.length === 0, `the page's citation parser and tools/citation-parse.mjs agree on all ${checked} strings (the shipped bank's citations and 6,000 generated ones): every entry, joiner and regulation chip`, () => drift.length + " differ, first: " + JSON.stringify(drift[0]).slice(0, 500));
  check(checked > 1500, `that is a real corpus (${checked} distinct citations)`, () => String(checked));

  const named = P.cite("Battalion SOP 2026");
  check(named.length === 1 && named[0].pub === "Battalion SOP 2026" && named[0].edition === "" && named[0].para === "" && named[0].quoteKind === "paraphrase", "\"Battalion SOP 2026\" becomes ONE named entry with no invented edition or paragraph, never a quote", () => JSON.stringify(named));
  check(P.regulationsOfEntries(named).length === 0, "and a non-publication makes no regulation chip");
  const mixed = P.cite("AR 600-20, para 4-5; Battalion SOP 2026, para 3");
  check(mixed.length === 2 && mixed[0].pub === "AR 600-20" && mixed[1].pub === "Battalion SOP 2026, para 3" && JSON.stringify(P.regulationsOfEntries(mixed)) === JSON.stringify(["AR 600-20"]), "a real regulation next to the unit's own SOP: one chip (AR 600-20), and the SOP stays as written", () => JSON.stringify(mixed));
  check(P.cite("AR 600-20, para 4-5").every((e) => e.quoteKind === "paraphrase") && P.cite("Ch 6 of ADP 6-22").every((e) => e.quoteKind === "paraphrase"), "no unit source is ever marked as a word-for-word quote");
  check(P.cite(" spaced ").length === 1 && P.renderCitation(P.cite("Alpha SOP 2026  x")) === "Alpha SOP 2026  x", "odd spacing is kept whole, exactly as typed (nothing is guessed)");
}

/* ------------------------------------------------------------------ 4. the saved row */
{
  const row = P.toDeck(BASE, { importedAt: "2026-09-26T12:00:00.000Z" });
  const r0 = P.validateRow(row);
  check(r0.ok && P.validRow(row), "a row the app itself produces passes the row check", () => JSON.stringify(r0.errors));
  check(JSON.stringify(Object.keys(row)) === JSON.stringify(["schema", "id", "name", "unit", "packVersion", "packDate", "importedAt", "enabled", "cards", "reciteTitles"]), "the saved row has exactly the documented keys, in order");
  check(row.enabled === true && row.cards.length === 3 && row.cards[0].source[0].quoteKind === "paraphrase" && row.cards[1].source === undefined, "a new deck is on by default, and a card with no source has none");
  check(P.toDeck(BASE, { enabled: false, importedAt: "2026-09-26T12:00:00.000Z" }).enabled === false, "a deck can be built switched off (what \"replace\" does for a deck the Soldier had turned off)");
  const fixtureRow = P.toDeck(JSON.parse(readFileSync(path.join(HERE, "fixtures", "unit-pack-example.pack.json"), "utf8")), { importedAt: "2026-09-26T12:00:00.000Z" });
  check(P.validRow(fixtureRow), "and so is the row made from the fictional example deck");
  const planted = (label, mutate) => { const r = clone(row); mutate(r); check(!P.validRow(r), `the row check refuses: ${label}`, () => JSON.stringify(P.validateRow(r).errors.slice(0, 2))); };
  planted("an unknown key", (r) => { r.evil = 1; });
  planted("another row version", (r) => { r.schema = 2; });
  planted("a missing id", (r) => { delete r.id; });
  planted("an id that is not a slug", (r) => { r.id = "Bad Id"; });
  planted("enabled as a string", (r) => { r.enabled = "true"; });
  planted("a bad added-on time", (r) => { r.importedAt = "yesterday"; });
  planted("a bad date", (r) => { r.packDate = "2026-13-01"; });
  planted("no cards", (r) => { r.cards = []; });
  planted("more than 200 cards", (r) => { r.cards = Array.from({ length: 201 }, (_, i) => ({ id: "c" + i, category: "C", q: "Q" + i, a: "A", keyPoints: [] })); });
  planted("a card with no answer", (r) => { delete r.cards[0].a; });
  planted("an over-long answer", (r) => { r.cards[0].a = "x".repeat(L.answer + 1); });
  planted("a card with an unknown key", (r) => { r.cards[0].html = "<b>"; });
  planted("key points that are not a list", (r) => { r.cards[0].keyPoints = "a"; });
  planted("a source that claims to be a word-for-word quote", (r) => { r.cards[0].source[0].quoteKind = "verbatim"; });
  planted("a source entry with an unknown key", (r) => { r.cards[0].source[0].href = "http://x"; });
  planted("a source entry with no name", (r) => { r.cards[0].source[0].pub = ""; });
  planted("a source that is a plain string", (r) => { r.cards[0].source = "AR 600-20"; });
  planted("a bad separator in a source", (r) => { r.cards[0].source[0].sepAfter = "<br>"; });
  planted("titles that are not a list", (r) => { r.reciteTitles = "x"; });
  planted("two cards with one id", (r) => { r.cards[1].id = r.cards[0].id; });
  planted("a control character in a question", (r) => { r.cards[0].q = "a\u0000b"; });
  for (const v of [null, [], "x", 3]) check(!P.validRow(v), `the row check refuses ${JSON.stringify(v)}`);
}

/* ------------------------------------------------------------------ 5. ids */
{
  const bank = assembleBank().data.board.questions;
  const shipped = new Set(bank.map((q) => String(q.id)));
  check(bank.length > 1000 && !bank.some((q) => String(q.id).startsWith("unit:")), `no shipped card id (${bank.length} of them) starts with "unit:"`, () => "found one");
  const a = P.cardsOf(P.toDeck(Object.assign(clone(BASE), { id: "deck-a" }))).map((c) => c.id);
  const b = P.cardsOf(P.toDeck(Object.assign(clone(BASE), { id: "deck-b" }))).map((c) => c.id);
  check(a.every((id) => /^unit:deck-a:[a-z0-9-]+$/.test(id)) && a.every((id, i) => id !== b[i]), "two decks that reuse card ids get different history ids (unit:<deck>:<card>)", () => a.join(",") + " / " + b.join(","));
  check(![...a, ...b].some((id) => shipped.has(id)), "and none of them is a shipped card's id");
  // The worst case an author could try: ids that spell a shipped id.
  const tricky = P.toDeck(Object.assign(clone(BASE), { id: "bq", cards: [{ id: "11", category: "C", q: "Q", a: "A" }] }));
  check(!shipped.has(P.cardsOf(tricky)[0].id) && P.cardsOf(tricky)[0].id === "unit:bq:11", "a deck named for a shipped id prefix still cannot land on a shipped id", () => P.cardsOf(tricky)[0].id);
  const cs = P.cardsOf(P.toDeck(BASE));
  check(cs.every((c) => c.category.startsWith("Unit: ") && c.pillar === undefined && c.tier === undefined && c.mos === undefined && c.difficulty === undefined && c.unitDeck && c.unitDeck.id === "alpha-demo"), "every unit card is in a \"Unit: ...\" category, has no pillar, tier, MOS or level, and knows its deck");
  check(P.isUnitId("unit:a:b") && !P.isUnitId("bq11") && !P.isUnitId(null), "isUnitId tells them apart");
}

/* ------------------------------------------------------------------ 6. no markup, no network; docs match code; manifest */
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\"'])\/\/[^\n]*/g, "$1 ");
  const files = ["unit-decks-core.js", "unit-decks.js"];
  const SINKS = [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /\bdocument\.write\b/, /\bcreateContextualFragment\b/, /\bDOMParser\b/, /\bhtml\s*:/, /\bsrcdoc\b/, /\.setAttribute\(\s*["'](?:on|src|href|style|srcdoc)/i];
  const NET = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bsendBeacon\b/, /\bEventSource\b/, /\bimportScripts\b/, /\bnew\s+Image\b/, /\bwindow\.open\b/, /(?:^|[^\w."])location\s*(?:\.\s*(?:href|hash|assign|replace|reload)|=)/, /\beval\s*\(/, /\bnew\s+Function\b/, /\bFunction\s*\(/, /https?:\/\//, /\bWebRTC\b|RTCPeerConnection/, /\bBroadcastChannel\b/, /\bpostMessage\b/, /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/];
  for (const f of files) {
    const code = strip(readFileSync(path.join(APP, "src", "app-modules", f), "utf8"));
    const sinks = SINKS.filter((re) => re.test(code)).map(String);
    check(sinks.length === 0, `${f} has no markup path (no innerHTML, html:, insertAdjacentHTML, DOMParser, srcdoc or event-handler attribute)`, () => sinks.join(", "));
    const net = NET.filter((re) => re.test(code)).map(String);
    check(net.length === 0, `${f} has no network, script, storage or navigation primitive of its own`, () => net.join(", "));
  }
  // Every line of the page that mentions a unit deck draws text, never markup.
  const html = readFileSync(path.join(APP, "src", "index.html"), "utf8").split("\n");
  const touching = html.map((l, i) => [i + 1, l]).filter(([, l]) => l.length < 20000 && /unitDeck|unitTag|unit-deck|unitFilterId|studyQuestions|unitCards|unitRows|unitAllCards|suggested\b/.test(l));
  const offenders = touching.filter(([, l]) => /\bhtml\s*:|innerHTML|insertAdjacentHTML|outerHTML/.test(l)).map(([n]) => n);
  check(touching.length > 20 && offenders.length === 0, `the ${touching.length} lines of src/index.html that draw unit-deck text never use html:/innerHTML`, () => "lines " + offenders.join(","));
}
{
  const docs = readFileSync(path.join(APP, "docs", "unit-packs.md"), "utf8");
  const n = (x) => x.toLocaleString("en-US");
  const want = [
    `1 to ${L.cards} cards`, `no more than ${L.categories} different categories`, `up to ${L.name} characters`, `up to ${L.unit} characters`,
    `up to ${L.packVersion} characters`, `up to ${L.category} characters`, `up to ${L.question} characters`, `up to ${n(L.answer)} characters`,
    `Up to ${L.keyPoints} points`, `up to ${L.keyPoint} characters each`, `Up to ${L.source} characters`, `Up to ${L.reciteTitles} titles`,
    `up to ${L.reciteTitle} characters each`, `Up to ${L.bytes / 1024} KB`, `up to ${L.decks} unit decks`, `${L.deckIdMin} to ${L.deckIdMax} characters`, `1 to ${L.cardIdMax} characters`,
    "guidon-unit-pack", "Unit deck: (name)", "Add this deck",
  ];
  const missing = want.filter((w) => !docs.includes(w));
  check(missing.length === 0, "docs/unit-packs.md states every limit the code enforces, with the same numbers", () => "missing: " + missing.join(" | "));
  const gone = ["classification", "CUI", "roster", "song", "lyrics", "copyright", "accuracy", "approval"].filter((w) => !new RegExp(w, "i").test(docs));
  check(gone.length === 0, "and says what may not go in (classified/CUI, rosters, copyrighted words, unapproved material) and who is responsible", () => "missing: " + gone.join(" | "));
}
{
  const { modules } = loadModules();
  const core = modules.find((m) => m.id === "unit-decks-core"), rt = modules.find((m) => m.id === "unit-decks");
  const idx = (id) => modules.findIndex((m) => m.id === id);
  check(!!core && core.kind === "feature" && core.headless === true && core.requires.includes("opsec-guard") && idx("opsec-guard") < idx("unit-decks-core"), "unit-decks-core is a headless feature that requires (and loads after) the sensitive-text check");
  check(!!rt && rt.kind === "feature" && rt.emit === undefined && rt.requires.includes("unit-decks-core") && rt.storageKeys.includes("unit-deck:*") && rt.clearsKeys.includes("srs:*") && idx("unit-decks-core") < idx("unit-decks"), "unit-decks is a runtime feature that owns unit-deck:* and only clears srs:* (a deck's own history)");
  check(!modules.some((m) => (m.kind === "content-pack" || m.kind === "finalize") && /unit-deck/.test(m.id)), "neither is a content pack: a unit deck is never merged into the bank");
  check(Object.keys(G.unitPack).length > 15 && core.provides.every((n) => { const parts = n.split("."); let o = G; for (const p of parts.slice(1)) { o = o && o[p]; } return o !== undefined; }), "every API name unit-decks-core lists under provides exists in the loaded file");
}

await finish("UNIT PACK FORMAT");
