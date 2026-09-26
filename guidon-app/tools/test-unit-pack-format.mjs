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

// Real calendar dates only. The leap-year rule is checked at both edges: 2028-02-29 is a real day, 2027-02-29 and 2100-02-29 are not
// (2100 is divisible by 100 but not by 400), while 2000-02-29 is (divisible by 400).
{
  const dateIs = (d, want) => { const p = clone(BASE); p.packDate = d; const r = valid(p); check(r.ok === want && (want || r.errors.some((e) => e.code === "bad-date")), `the deck date ${d} is ${want ? "accepted" : "refused (not a real date the format allows)"}`, () => JSON.stringify(r.errors.slice(0, 2))); };
  for (const d of ["2028-02-29", "2024-02-29", "2000-02-29", "2026-02-28", "2026-12-31", "2100-12-31", "2026-04-30"]) dateIs(d, true);
  for (const d of ["2027-02-29", "2100-02-29", "2026-02-29", "2026-02-30", "2026-04-31", "2026-06-31", "2026-00-10", "2026-13-01", "2026-01-00", "1999-12-31", "2101-01-01", "2026-9-26", "26-09-26", "2026-09-26T00:00:00Z"]) dateIs(d, false);
}

// Invisible characters are refused wherever text goes (they are how a marking or a number is hidden from a check), in a single-line
// field and in a multi-line answer alike; ordinary Unicode still passes.
{
  const cp = (n) => String.fromCodePoint(n);
  const HIDDEN = [
    ["a soft hyphen", 0xAD], ["a combining grapheme joiner", 0x34F], ["an Arabic letter mark", 0x61C], ["a Hangul filler", 0x3164], ["a Mongolian vowel separator", 0x180E], ["a Mongolian free variation selector", 0x180B], ["the unassigned Mongolian U+180F", 0x180F],
    ["a zero-width space", 0x200B], ["a left-to-right mark", 0x200E], ["a right-to-left mark", 0x200F],
    ["a word joiner", 0x2060], ["an invisible times", 0x2062], ["the unassigned U+2065", 0x2065], ["a deprecated format character", 0x206A], ["a variation selector", 0xFE00], ["an interlinear annotation mark", 0xFFF9],
    ["an unassigned ignorable in the U+FFF0 block", 0xFFF0], ["an object replacement character", 0xFFFC], ["a halfwidth Hangul filler", 0xFFA0],
    ["a musical symbol beam start (U+1D173)", 0x1D173], ["a musical symbol end phrase (U+1D17A)", 0x1D17A], ["a shorthand format letter overlap (U+1BCA0)", 0x1BCA0], ["a shorthand format up step (U+1BCA3)", 0x1BCA3],
    ["an Egyptian hieroglyph format control (U+13430)", 0x13430], ["an Egyptian hieroglyph format control (U+13438)", 0x13438],
    ["a language tag (U+E0001)", 0xE0001], ["a Unicode tag letter", 0xE0041], ["a Unicode tag cancel", 0xE007F], ["an unassigned tag-block ignorable (U+E0FFF)", 0xE0FFF], ["a variation selector supplement", 0xE0100],
  ].map(([what, n]) => [what, cp(n)]);
  const fields = [
    ["the deck name", (p, c) => { p.name = "Alpha" + c; }, "name"], ["the unit label", (p, c) => { p.unit = "Unit" + c; }, "unit"],
    ["a category", (p, c) => { p.cards[0].category = "Local" + c + "SOP"; }, "cards[0].category"], ["a question", (p, c) => { p.cards[0].q = "When is" + c + " formation?"; }, "cards[0].q"],
    ["an answer (multi-line field)", (p, c) => { p.cards[0].a = "Line one\nLine" + c + "two"; }, "cards[0].a"], ["a key point", (p, c) => { p.cards[0].keyPoints = ["fine", "Be" + c + "early"]; }, "cards[0].keyPoints[1]"],
    ["a source", (p, c) => { p.cards[0].source = "Alpha" + c + "SOP"; }, "cards[0].source"], ["a suggested title", (p, c) => { p.reciteTitles = ["Song" + c]; }, "reciteTitles[0]"],
  ];
  let n = 0, missed = [];
  for (const [what, ch] of HIDDEN) for (const [label, mutate, at] of fields) {
    n++;
    const p = clone(BASE); mutate(p, ch);
    const r = valid(p);
    if (!(!r.ok && r.errors.some((e) => e.code === "bad-characters" && e.path === at))) missed.push(what + " in " + label);
  }
  check(missed.length === 0, `every hidden character (${HIDDEN.length} kinds) is refused in every text field (${n} combinations), naming the field`, () => missed.slice(0, 4).join("; "));
  const msg = errsOf(Object.assign(clone(BASE), { name: "Alpha​demo" }))[0].message;
  check(/hidden or unusual character/.test(msg) && /zero-width/.test(msg) && /Retype it as plain text/.test(msg), "and the message says what is wrong in plain words", () => msg);
  // The saved-row check refuses them too (a restored backup or a row already on the device).
  const row = P.toDeck(BASE, { importedAt: "2026-09-26T12:00:00.000Z" });
  for (const [what, ch] of [["a zero-width space", "​"], ["a soft hyphen", "­"], ["a tag character", "\u{E0041}"]]) {
    const r = clone(row); r.cards[0].q = "When is" + ch + " formation?";
    check(!P.validRow(r), `a saved row with ${what} in a question is refused`);
    const r2 = clone(row); r2.cards[0].source[0].pub = "Alpha" + ch + "SOP";
    check(!P.validRow(r2), `and so is one with ${what} in a citation`);
  }
  // The three that ordinary text needs are ALLOWED - and removed from the copy the screen reads, so they hide nothing.
  const ZWJ = "\u200D", ZWNJ = "\u200C", VS16 = "\uFE0F";
  for (const [what, ch] of [["the emoji joiner (ZWJ)", ZWJ], ["the non-joiner (ZWNJ, Persian and Indic text)", ZWNJ], ["the emoji variation selector (U+FE0F)", VS16]]) {
    let allOk = true, why = "";
    for (const [label, mutate] of fields) { const p = clone(BASE); mutate(p, ch); const r = valid(p); if (!r.ok) { allOk = false; why = label + ": " + JSON.stringify(r.errors.slice(0, 1)); break; } }
    check(allOk, `${what} is accepted in every text field`, () => why);
  }
  const family = clone(BASE); family.cards[0].a = "A family: \u{1F468}" + ZWJ + "\u{1F469}" + ZWJ + "\u{1F467}, a heart \u2764" + VS16 + " and a Persian word \u0645\u06CC" + ZWNJ + "\u062E\u0648\u0627\u0647\u0645";
  check(valid(family).ok && P.screen(family, { now: NOW }).ok, "an emoji family (with joiners), an emoji with its variation selector and a Persian word with a non-joiner pass the screen");
  const hides = [
    ["SEC + ZWJ + RET//NOFORN", "SEC" + ZWJ + "RET//NOFORN", /classification or handling marking/],
    ["a Social Security number with a ZWNJ and a variation selector inside", "123" + ZWNJ + "-45" + VS16 + "-6789", /Social Security number/],
    ["CUI//SP-PRVCY broken by a variation selector", "CU" + VS16 + "I//SP-PRVCY", /classification or handling marking/],
  ];
  for (const [label, text, looks] of hides) {
    const p = clone(BASE); p.cards[0].a = text;
    const v = valid(p), sc = P.screen(p, { now: NOW });
    check(v.ok && !sc.ok && sc.findings.some((f) => looks.test(f.looksLike)), `the allowed characters hide nothing: ${label} is still refused`, () => JSON.stringify(sc.findings.slice(0, 2)));
  }
  check(!valid(Object.assign(clone(BASE), { name: "Alpha \u{1D173}demo" })).ok && !valid((() => { const p = clone(BASE); p.cards[0].a = "SEC\u{1D173}RET//NOFORN"; return p; })()).ok, "SEC + U+1D173 + RET//NOFORN (a musical formatting character, once accepted) is refused as a hidden character");
  // The whole property, not a list: every code point that is a Format character (Cf) or a Default_Ignorable_Code_Point is refused, except the three.
  let leaks = [];
  const allowed = new Set([0x200C, 0x200D, 0xFE0F]);
  for (let n = 0; n <= 0x10FFFF; n++) {
    if (n >= 0xD800 && n <= 0xDFFF) continue;
    const ch = String.fromCodePoint(n);
    if (/[\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(ch) && !allowed.has(n) && P.hasHidden("a" + ch + "b", false) !== true) leaks.push("U+" + n.toString(16).toUpperCase());
  }
  check(leaks.length === 0, "every one of the 1.1 million Unicode code points that is a format character or default-ignorable is refused (except the three), whatever this engine's Unicode version says", () => leaks.slice(0, 8).join(", "));
  const fine = clone(BASE); fine.cards[0].a = "Thumbs \u{1F44D}, accents éè, CJK 字, and a Cyrillic word: Привет";
  check(valid(fine).ok && P.screen(fine, { now: NOW }).ok, "an answer with an emoji, accents, a CJK character and an ordinary Cyrillic word is accepted and passes the screen");
}

// Names that are also names of built-in JavaScript things must behave like any other name: every table in the validator, the
// preview and the device registry is keyed by text an author controls.
{
  const NAMES = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "prototype", "__defineGetter__"];
  for (const nm of NAMES) {
    const id = nm.replace(/[^a-z]/g, "") || "name";
    const p = clone(BASE); p.id = id; p.cards[0].id = id; p.cards[0].q = nm; p.cards[0].category = nm; p.reciteTitles = [nm];
    p.cards[1].id = id + "-2"; p.cards[1].category = nm; p.cards[2].id = id + "-3"; p.cards[2].category = nm + "s";
    const r = valid(p);
    check(r.ok, `"${nm}" as a card id, question, category, suggested title and deck id is an ordinary name (no false duplicate)`, () => JSON.stringify(r.errors.slice(0, 2)));
    const sum = P.summarize(p);
    const inCat = (name) => p.cards.filter((c) => c.category === name).length;
    check(sum.categories.length === new Set(p.cards.map((c) => c.category)).size && sum.categories[0].name === nm && sum.categories[0].count === inCat(nm) && sum.categories[1].name === nm + "s" && sum.categories[1].count === inCat(nm + "s"), `the preview counts the category "${nm}" (the cards in it, more than one) and "${nm}s" separately`, () => JSON.stringify(sum.categories));
    check(P.validRow(P.toDeck(p)), `and the saved row for it passes the row check`);
  }
  // Duplicates are still found, whatever the word.
  const dupId = clone(BASE); dupId.cards[1].id = "constructor"; dupId.cards[0].id = "constructor";
  check(valid(dupId).errors.some((e) => e.code === "duplicate" && e.path === "cards[1].id"), "two cards that really share the id \"constructor\" are still refused");
  const dupQ = clone(BASE); dupQ.cards[0].q = "__proto__"; dupQ.cards[1].q = "  __PROTO__ ";
  check(valid(dupQ).errors.some((e) => e.code === "duplicate" && e.path === "cards[1].q"), "two cards that really ask \"__proto__\" are still refused");
  const dupT = clone(BASE); dupT.reciteTitles = ["toString", "TOSTRING"];
  check(valid(dupT).errors.some((e) => e.code === "duplicate" && e.path === "reciteTitles[1]"), "and so is a suggested title given twice");
  check(Object.prototype.polluted === undefined && ({}).polluted === undefined && ({}).constructor === Object, "and nothing on Object.prototype changed");
}

// The category cap counts categories exactly as Board Drill lists them: "Local SOP" and "local sop" are two.
{
  const mk = (names) => { const p = clone(BASE); p.cards = names.map((c, i) => ({ id: "c" + i, category: c, q: "Question number " + i, a: "A" })); return p; };
  check(valid(mk(Array.from({ length: 30 }, (_, i) => "Cat " + i))).ok, "30 different categories are accepted");
  const variants = Array.from({ length: 31 }, (_, i) => "abcdefgh".split("").map((ch, k) => ((i >> (k % 5)) & 1) && k < 5 ? ch.toUpperCase() : ch).join(""));
  const distinct = new Set(variants).size;
  check(distinct === 31 && new Set(variants.map((v) => v.toLowerCase())).size < 31, "(the 31 case variants are distinct as typed but fewer once folded)");
  check(valid(mk(variants)).errors.some((e) => e.code === "too-many-categories"), "31 categories that differ only in capitals are refused, because Board Drill would list all 31");
  check(valid(mk(["Local SOP", "local sop", "LOCAL SOP"])).ok, "and three case variants are accepted (3 is far below the cap)");
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

/* ------------------------------------------------------------------ 2b. what the screen reads: folded text, lists across fields, numbers cut in two */
{
  const refusedIn = (mutate, wantLooks) => { const p = clone(BASE); mutate(p); const v = valid(p); const s = P.screen(p, { now: NOW }); return { v, s, hit: v.ok && !s.ok && (!wantLooks || s.findings.some((f) => wantLooks.test(f.looksLike))) }; };
  // Written oddly, but the same thing: a plain copy is what gets read (never stored).
  const folded = [
    ["fullwidth digits in a Social Security number", "１２３-４５-６７８９", /Social Security number/],
    ["a fullwidth marking", "ＳＥＣＲＥＴ//ＮＯＦＯＲＮ", /classification or handling marking/],
    ["a Cyrillic capital S in SECRET//NOFORN", "ЅECRET//NOFORN", /classification or handling marking/],
    ["Cyrillic and Greek look-alikes in CUI//SP-PRVCY", "СUI//SP-PRVСY Ο", /classification or handling marking/],
    ["en dashes in a Social Security number", "Use 123–45–6789 to look it up.", /Social Security number/],
    ["a minus sign in a Social Security number", "Use 123−45−6789 to look it up.", /Social Security number/],
    ["Armenian hyphens in a Social Security number", "Use 123\u058A45\u058A6789 to look it up.", /Social Security number/],
    ["Hebrew maqaf in a Social Security number", "Use 123\u05BE45\u05BE6789 to look it up.", /Social Security number/],
    ["Mongolian todo soft hyphens in a Social Security number", "Use 123\u180645\u18066789 to look it up.", /Social Security number/],
    ["wave dashes in a Social Security number", "Use 123\u301C45\u301C6789 to look it up.", /Social Security number/],
    ["a small em dash and a fullwidth hyphen-minus in a phone number", "Call 555\uFE58123\uFF0D4567 after hours.", /phone number/],
    ["non-breaking hyphens in a phone number", "Call 555\u2011123\u20114567 now.", /phone number/],
    ["a combining mark laid on a letter of a marking", "ŚECRET//NOFORN", /classification or handling marking/],
    ["a mathematical bold marking", "\u{1D412}\u{1D404}\u{1D402}\u{1D411}\u{1D404}\u{1D413}//NOFORN", /classification or handling marking/],
    ["a circled-digit-free labelled SSN with fullwidth digits", "SSN: １２３４５６７８９", /Social Security number/],
    ["a fullwidth phone number", "Call ５５５-１２３-４５６７", /phone number/],
  ];
  for (const [label, text, looks] of folded) {
    const r = refusedIn((p) => { p.cards[0].a = text; }, looks);
    check(r.hit, `refused even though it is written oddly: ${label}`, () => JSON.stringify([r.v.errors.slice(0, 1), r.s.findings.slice(0, 2)]));
  }
  // ...and what is stored is exactly what was typed.
  const typed = "Use １２３ in Café Ѕ"; const p0 = clone(BASE); p0.cards[0].a = typed;
  check(P.toDeck(p0).cards[0].a === typed && P.cardsOf(P.toDeck(p0))[0].a === typed, "the plain copy is only looked at: the saved card keeps the text exactly as typed (fullwidth digits, accent and Cyrillic letter included)");
  const p1 = clone(BASE); p1.cards[0].a = "Café résumé naïve Ångström – a range 10–20 and “quotes”";
  check(valid(p1).ok && P.screen(p1, { now: NOW }).ok, "accents, en dashes in a range and curly quotes are not refused");
}

// A list of names is a list wherever it sits: in one answer, in one card's key points, or spread one to a card.
{
  const NAMES = ["SGT Smith", "SSG Jones", "SPC Brown", "CPL Green", "PFC White", "PVT Black", "SFC Gray", "MSG Blue"];
  const LASTFIRST = ["Smith, John", "Jones, Mary", "Brown, Sam", "Green, Ann", "White, Tom", "Black, Joe"];
  const deck = (cards) => { const p = clone(BASE); p.cards = cards.map((c, i) => Object.assign({ id: "c" + i, category: "Cat", q: "Question number " + i + "?", a: "Answer " + i }, c)); return p; };
  const verdict = (p) => { const v = valid(p), s = P.screen(p, { now: NOW }); return { ok: v.ok && s.ok, valid: v.ok, s }; };
  const refuse = (label, p, whereRe) => { const r = verdict(p); check(r.valid && !r.s.ok && r.s.findings.some((f) => f.code === "roster-like" && (!whereRe || whereRe.test(f.where))), `refused as a roster: ${label}`, () => JSON.stringify(r.s.findings.slice(0, 3))); };
  const accept = (label, p) => { const r = verdict(p); check(r.ok, `not refused: ${label}`, () => JSON.stringify(r.s.findings.slice(0, 3))); };
  refuse("eight rank-and-name lines in ONE card's key points", deck([{ keyPoints: NAMES }]), /^Card 1 \(c0\), key points$/);
  refuse("three rank-and-name lines in a card's key points", deck([{ keyPoints: NAMES.slice(0, 3) }]), /key points$/);
  refuse("six \"Surname, Given\" lines in one card's key points", deck([{ keyPoints: LASTFIRST }]), /key points$/);
  refuse("one name per card answer, over eight cards", deck(NAMES.map((n) => ({ a: n }))), /short answers and key points/);
  refuse("one \"Surname, Given\" name per card answer, over six cards", deck(LASTFIRST.map((n) => ({ a: n }))), /short answers and key points/);
  refuse("one name per card, half as an answer and half as a one-line key point", deck(NAMES.map((n, i) => (i % 2 ? { keyPoints: [n] } : { a: n }))), /short answers and key points/);
  refuse("the old case, still: eight names in ONE answer", deck([{ a: NAMES.join("\n") }]), /answer$/);
  accept("two rank-and-name lines in a card's key points", deck([{ keyPoints: NAMES.slice(0, 2) }]));
  accept("five short answers that name a commander each (a unit history), below the deck-wide bar of six", deck(NAMES.slice(0, 5).map((n) => ({ a: n }))));
  accept("ranks written as TITLES in eight key points", deck([{ keyPoints: ["PVT Private", "PFC Private First Class", "SPC Specialist", "CPL Corporal", "SGT Sergeant", "SSG Staff Sergeant", "SFC Sergeant First Class", "MSG Master Sergeant"] }]));
  accept("eight cards whose LONG answers each name one person in a sentence (not short lines)", deck(NAMES.map((n) => ({ a: "The troop's first commander was " + n + ", who served from the activation until the reorganization of the squadron." }))));
  accept("eight cards whose answers are short but are not names", deck(NAMES.map((n, i) => ({ a: "Room " + (100 + i) }))));
  // The same verdicts arrive from the saved-row check (a restored backup, a row on the device).
  const rowOf = (p) => P.toDeck(p, { importedAt: "2026-09-26T12:00:00.000Z" });
  const spread = deck(NAMES.map((n) => ({ a: n })));
  check(!P.validRow(rowOf(spread)) && P.validateRow(rowOf(spread)).errors[0].code === "sensitive-text", "a saved row that spreads a roster one name to a card is refused by the row check, with its own code");
  check(!P.validRow(rowOf(deck([{ keyPoints: NAMES }]))), "so is one with the roster in a card's key points");
}

// Round 2: a rank followed by a billet or a role is a duty, not a person - and a unit history may honestly name its commanders. A list of
// names (rank + first + last, or "Surname, Given") is still a roster, in a card's key points, in one answer and one to a card.
{
  const deck = (cards) => { const p = clone(BASE); p.cards = cards.map((c, i) => Object.assign({ id: "c" + i, category: "Cat", q: "Question number " + i + "?", a: "Answer " + i }, c)); return p; };
  const verdict = (p) => { const v = valid(p), s = P.screen(p, { now: NOW }); return { ok: v.ok && s.ok, valid: v.ok, s }; };
  const accept = (label, p) => { const r = verdict(p); check(r.ok, `accepted (an honest deck): ${label}`, () => JSON.stringify(r.valid ? r.s.findings.slice(0, 2) : valid(p).errors.slice(0, 2))); };
  const refuse = (label, p) => { const r = verdict(p); check(r.valid && !r.s.ok && r.s.findings.some((f) => f.code === "roster-like"), `refused as a roster: ${label}`, () => JSON.stringify(r.s.findings.slice(0, 2))); };
  const BILLETS = ["SGT Team Leader", "SSG Squad Leader", "SFC Platoon Sergeant", "1LT Platoon Leader", "CPT Company Commander", "MSG Operations Sergeant", "1SG Company First Sergeant", "SGM Battalion Operations"];
  accept("five rank + billet lines in one card's key points", deck([{ keyPoints: BILLETS.slice(0, 5) }]));
  accept("rank + verb phrases in key points (\"SGT Leads the fire team\")", deck([{ keyPoints: ["SGT Leads the fire team", "SSG Trains the squad", "SFC Advises the platoon leader"] }]));
  accept("eight cards whose short answers are rank + billet", deck(BILLETS.map((a) => ({ a }))));
  accept("all eight billets as ONE multi-line answer", deck([{ a: BILLETS.join("\n") }]));
  accept("rank titles as headings (\"CW2 Chief Warrant Officer Two\" and the like)", deck([{ keyPoints: ["CW2 Chief Warrant Officer Two", "CW3 Chief Warrant Officer Three", "CW4 Chief Warrant Officer Four", "CSM Command Sergeant Major"] }]));
  const COMMANDERS = ["LTC Robert Adams", "COL James Baker", "LTC Thomas Cole", "COL William Davis", "LTC Henry Evans", "COL George Ford", "LTC Peter Grant", "COL Samuel Hill"];
  accept("a unit history: eight one-line commander answers, one to a card (\"LTC Robert Adams\")", deck(COMMANDERS.map((a) => ({ a }))));
  accept("a unit history: five commanders with their dates, in one card's key points", deck([{ keyPoints: ["LTC Robert Adams (1942-1944)", "COL James Baker (1944-1946)", "LTC Thomas Cole (1946-1949)", "COL William Davis (1949-1951)", "LTC Henry Evans (1951-1953)"] }]));
  accept("a unit history: five commanders with their dates, one to a card", deck(["LTC Robert Adams, 1942 to 1944", "COL James Baker, 1944 to 1946", "LTC Thomas Cole, 1946 to 1949", "COL William Davis, 1949 to 1951", "LTC Henry Evans, 1951 to 1953"].map((a) => ({ a }))));
  accept("a schedule full of times and room numbers", deck([{ keyPoints: ["0630 Formation, Bldg 12 Rm 204", "0700-0800 PT at the track", "0830 Class in Rm 118", "1200 Chow", "1300 Motor pool", "1530 Recall in Rm 204"] }, { a: "0630", keyPoints: ["Room 12", "3", "Bldg 4 room 101"] }]));
  accept("an acronym deck", deck(["SAW Squad Automatic Weapon", "MG Machine Gun", "MSG Message", "PT Physical Training", "SOP Standing Operating Procedure", "COL Column", "GEN General Order", "SPC Specialist", "CPL Corporal", "SGT Sergeant"].map((a) => ({ a }))));
  accept("rank titles spelled out in key points", deck([{ keyPoints: ["MSG Master Sergeant", "SGT Sergeant", "SFC Sergeant First Class", "CPL Corporal", "PFC Private First Class", "SSG Staff Sergeant"] }]));
  accept("a publications list", deck([{ keyPoints: ["AR 600-20 Army Command Policy", "AR 600-8-19 Enlisted Promotions", "FM 6-22 Leader Development", "ATP 6-22.1 The Counseling Process", "DA PAM 600-25 NCO Guide", "TC 3-21.5 Drill and Ceremonies"] }]));
  accept("pairs of code words (\"Alpha, Bravo\") and of ideas (\"Command, Control\")", deck([{ keyPoints: ["Alpha, Bravo", "Charlie, Delta", "Echo, Foxtrot", "Golf, Hotel"] }, { keyPoints: ["Command, Control", "Fire, Movement", "Plan, Prepare", "Team, Squad"] }]));
  accept("a deck of long answers that each name a person in a sentence", deck(COMMANDERS.map((n) => ({ a: "The squadron's commander during the long winter of the reorganization was " + n + ", who served until relieved." }))));
  const SMITH = Array.from({ length: 8 }, () => "SGT John Smith");
  const VARIED = ["SGT John Smith", "SSG Mary Jones", "SPC Sam Brown", "CPL Ann Green", "PFC Tom White", "PVT Joe Black", "SFC Jill Gray", "MSG Bob Blue"];
  refuse("eight \"SGT John Smith\" lines in one card's key points", deck([{ keyPoints: SMITH }]));
  refuse("eight \"SGT John Smith\" lines in ONE answer", deck([{ a: SMITH.join("\n") }]));
  refuse("eight \"SGT John Smith\" answers, one to a card", deck(SMITH.map((a) => ({ a }))));
  refuse("eight \"SGT John Smith\" key points, one to a card", deck(SMITH.map((n) => ({ keyPoints: [n] }))));
  refuse("eight different enlisted names, one answer to a card", deck(VARIED.map((a) => ({ a }))));
  refuse("eight different enlisted names, half answers and half key points", deck(VARIED.map((n, i) => (i % 2 ? { keyPoints: [n] } : { a: n }))));
  refuse("three officers in ONE card's key points (a list inside one card is a list, whatever the rank)", deck([{ keyPoints: COMMANDERS.slice(0, 3) }]));
  refuse("a roster with a duty after each name (\"SGT Smith - Alpha Team\")", deck([{ keyPoints: ["SGT Smith - Alpha Team", "SSG Jones - Bravo Team", "SPC Brown - Charlie Team"] }]));
  refuse("bulleted and numbered lines of names", deck([{ a: "1. SGT John Smith\n2. SSG Mary Jones\n3. SPC Sam Brown" }]));
  refuse("six \"Surname, Given\" answers, one to a card", deck(["Smith, John", "Jones, Mary", "Brown, Sam", "Green, Ann", "White, Tom", "Black, Joe"].map((a) => ({ a }))));
  // Officers are not counted ACROSS cards (a history names one per card) - but enlisted names are, and the two are not mixed up.
  accept("eight officers, one to a card, plus five enlisted names, one to a card (enlisted is below the deck-wide bar of six)", deck(COMMANDERS.concat(VARIED.slice(0, 5)).map((a) => ({ a }))));
  refuse("six enlisted names hidden among eight officers, one to a card", deck(COMMANDERS.concat(VARIED.slice(0, 6)).map((a) => ({ a }))));
  // What tripped it is named, so an honest author can see.
  {
    const r = verdict(deck(VARIED.map((a) => ({ a }))));
    const f = r.s.findings.find((x) => x.code === "roster-like");
    const said = P.describeFinding(f);
    check(/Card 1 \(c0\), answer: SGT John Smith; Card 2 \(c1\), answer: SSG Mary Jones; Card 3 \(c2\), answer: SPC Sam Brown/.test(said) && !/Card 4/.test(said), "the message for a roster spread over cards names the first THREE cards and lines it found", () => said);
    const r2 = verdict(deck([{ keyPoints: SMITH }]));
    const said2 = r2.s.findings.map(P.describeFinding).join(" | ");
    check(/Card 1 \(c0\), key points: this looks like a list of people's names \(a roster\) \(.SGT John Smith; SGT John Smith; SGT John Smith.\)/.test(said2), "and for one card's key points it quotes the first three lines", () => said2);
  }
  // The list of words that are duties, not names: every word on it stops a line counting, and real names are not on it.
  const words = P.NOT_NAME_WORDS;
  const wordSet = new Set(words);
  const AS_NAMES = ["Smith", "Jones", "Brown", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White", "Harris", "Clark", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts", "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker", "Cruz", "Edwards", "Collins", "Stewart", "Morris", "Morales", "Murphy", "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper", "Peterson", "Bailey", "Reed", "Kelly", "Howard", "Ramos", "Kim", "Cox", "Ward", "Richardson", "Watson", "Brooks", "Chavez", "Wood", "James", "Bennett", "Gray", "Mendoza", "Ruiz", "Hughes", "Price", "Alvarez", "Castillo", "Sanders", "Patel", "Myers", "Long", "Ross", "Foster", "Jimenez", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Charles", "Christopher", "Daniel", "Matthew", "Anthony", "Mark", "Donald", "Steven", "Paul", "Andrew", "Joshua", "Kenneth", "Kevin", "Brian", "George", "Timothy", "Ronald", "Edward", "Jason", "Jeffrey", "Ryan", "Jacob", "Gary", "Nicholas", "Eric", "Jonathan", "Stephen", "Larry", "Justin", "Scott", "Brandon", "Benjamin", "Samuel", "Gregory", "Alexander", "Frank", "Patrick", "Raymond", "Jack", "Dennis", "Jerry", "Tyler", "Aaron", "Jose", "Adam", "Nathan", "Henry", "Douglas", "Zachary", "Peter", "Kyle", "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen", "Lisa", "Nancy", "Betty", "Sandra", "Ashley", "Kimberly", "Emily", "Donna", "Michelle", "Carol", "Amanda", "Melissa", "Deborah", "Stephanie", "Rebecca", "Laura", "Sharon", "Cynthia", "Kathleen", "Amy", "Shirley", "Angela", "Helen", "Anna", "Brenda", "Pamela", "Nicole", "Ruth", "Katherine", "Samantha", "Christine", "Emma", "Catherine", "Debra", "Virginia", "Rachel", "Carolyn", "Janet", "Maria"];
  const swallowed = AS_NAMES.filter((n) => wordSet.has(n.toLowerCase()));
  check(words.length > 100 && swallowed.length === 0, `the list of ${words.length} duty and title words does not contain a single one of ${AS_NAMES.length} common surnames and given names`, () => swallowed.join(", "));
  const REQUIRED = ["team", "squad", "section", "platoon", "company", "battalion", "brigade", "commander", "leader", "chief", "sergeant", "advisor", "officer", "manager", "xo", "ncoic", "oic", "nco", "advisor", "director", "instructor", "operator", "specialist", "private", "corporal", "lieutenant", "captain", "colonel", "general", "warrant"];
  const missingWords = REQUIRED.filter((w) => !wordSet.has(w));
  check(missingWords.length === 0, "the list holds the echelon, billet and role words a duty description is made of (team, squad, section, platoon, company, battalion, brigade, commander, leader, chief, sergeant, advisor, officer, manager, XO, NCOIC, OIC ...)", () => missingWords.join(", "));
  const passes = words.filter((w) => { const W = w[0].toUpperCase() + w.slice(1); return rosterCheckLine(P, "SGT " + W + " " + W) > 0 || rosterCheckLine(P, "SGT " + W) > 0; });
  check(passes.length === 0, "every word on it stops a line from counting as a person, alone or doubled (\"SGT <word>\", \"SGT <Word> <Word>\")", () => passes.join(", "));
  const upper = words.filter((w) => rosterCheckLine(P, "SGT " + w.toUpperCase()) > 0);
  check(upper.length === 0, "and in ALL CAPS as well", () => upper.join(", "));
  check(rosterCheckLine(P, "SGT Smith") === 1 && rosterCheckLine(P, "SGT J. Smith") === 1 && rosterCheckLine(P, "COL Mary O'Brien") === 1 && rosterCheckLine(P, "SGT Smith Team Leader") === 0, "(and a real name still counts: \"SGT Smith\", \"SGT J. Smith\", \"COL Mary O'Brien\"; a billet anywhere in the name stops it)");
}
// One line through the same code the screen uses: how many people it names (0 or more).
function rosterCheckLine(PP, line) { const r = PP.rosterScan(line); return r.pairs; }

// A number cut in two: the end of one field and the start of the next (or of a later one) of the SAME card. Only what the join makes
// appear counts, so numbers that merely sit next to each other are fine.
{
  const cut = (label, mutate, looks) => { const p = clone(BASE); mutate(p); const v = valid(p), s = P.screen(p, { now: NOW }); check(v.ok && !s.ok && s.findings.some((f) => looks.test(f.looksLike) && /where the .* runs into the/.test(f.where)), `refused, and says where the two halves meet: ${label}`, () => JSON.stringify([v.errors.slice(0, 1), s.findings.slice(0, 2)])); };
  const clean = (label, mutate) => { const p = clone(BASE); mutate(p); const s = P.screen(p, { now: NOW }); check(valid(p).ok && s.ok, `not refused: ${label}`, () => JSON.stringify(s.findings.slice(0, 2))); };
  cut("a Social Security number across a question and a key point", (p) => { p.cards[0].q = "What is the number ending 123-45"; p.cards[0].keyPoints = ["-6789 is it"]; }, /Social Security number/);
  cut("a Social Security number across an answer and the next key point", (p) => { p.cards[0].a = "The number is 123-45"; p.cards[0].keyPoints = ["-6789"]; }, /Social Security number/);
  cut("a labelled Social Security number cut after its label", (p) => { p.cards[0].q = "Give the SSN "; p.cards[0].a = "123456789"; }, /Social Security number/);
  cut("a phone number across a question and an answer", (p) => { p.cards[0].q = "Call 555-1"; p.cards[0].a = "23-4567 after hours"; }, /phone number/);
  // The saved row is trimmed (that is what toDeck keeps), so the file check must read the trimmed words too - or a deck with stray spaces at the
  // joins would pass the import and then fail its own row check at the next start.
  cut("a Social Security number cut in two with stray spaces at the joins (the row keeps it trimmed)", (p) => { p.cards[0].q = "What is the number ending 123-45   "; p.cards[0].a = "The number"; p.cards[0].keyPoints = ["  -6789 is it  "]; }, /Social Security number/);
  cut("a DoD ID number cut after its label", (p) => { p.cards[0].a = "The DoD ID "; p.cards[0].keyPoints = ["1234567890 is listed"]; }, /DoD ID number/);
  clean("digits that end one field and start the next but make nothing", (p) => { p.cards[0].q = "Formation is at 0630 in room 12"; p.cards[0].a = "3 minutes early"; });
  clean("a year that ends one field and a number that starts the next", (p) => { p.cards[0].q = "Which squadron was activated in 2026"; p.cards[0].a = "1st Squadron, 5th Cavalry"; });
  clean("a regulation number split across fields (a citation, not an identifier)", (p) => { p.cards[0].q = "Which regulation covers counseling, AR 600"; p.cards[0].a = "-20 2020 covers it"; });
  clean("a number that already sits complete in a field, followed by a field that starts with a digit", (p) => { p.cards[0].q = "Formation is at 0630"; p.cards[0].a = "0645 for the first sergeant"; });
}

// A source that would split into more than 8 references is refused when it is checked - not saved and then lost at the next start.
{
  const NINE = "AR 600-8-19, AR 600-20, AR 670-1, AR 350-1, DA PAM 600-25, ADP 6-22, FM 6-22, TC 3-21.5, ATP 3-21.8";
  const EIGHT = "AR 600-8-19, AR 600-20, AR 670-1, AR 350-1, DA PAM 600-25, ADP 6-22, FM 6-22, TC 3-21.5";
  check(P.cite(NINE).length === 9 && P.cite(EIGHT).length === 8, "(the citation parser splits the two sources into 9 and 8 entries)");
  const eight = clone(BASE); eight.cards[0].source = EIGHT;
  const r8 = valid(eight);
  check(r8.ok && P.validRow(P.toDeck(eight)), "a source naming 8 publications is accepted, and the row saved from it passes the row check", () => JSON.stringify(r8.errors.concat(P.validateRow(P.toDeck(eight)).errors)));
  const nine = clone(BASE); nine.cards[0].source = NINE;
  const r9 = valid(nine);
  check(!r9.ok && r9.errors.some((e) => e.code === "too-many-sources" && e.path === "cards[0].source" && /Card 1 \(sop-001\): the source lists 9 separate references; the most GUIDON keeps on one card is 8/.test(e.message)), "a source naming 9 publications is REFUSED at the import check, in plain words, naming the card", () => JSON.stringify(r9.errors));
  const long = clone(BASE); long.cards[0].source = Array.from({ length: 33 }, (_, i) => "AR " + (i + 1)).join("; ").slice(0, 200).replace(/; [^;]*$/, "");
  check(P.cite(long.cards[0].source).length > 8 && !valid(long).ok, "a 200-character source that would split into more than 8 entries is refused too", () => P.cite(long.cards[0].source).length + " entries");
  // One rule, two doors: 8 is the last number both accept, 9 the first both refuse.
  const row = P.toDeck(eight, { importedAt: "2026-09-26T12:00:00.000Z" });
  check(P.validRow(row) && row.cards[0].source.length === 8, "the row check accepts exactly 8 source entries...");
  const row9 = clone(row); row9.cards[0].source = row9.cards[0].source.concat([{ pub: "ATP 3-21.8", edition: "", para: "", quoteKind: "paraphrase" }]);
  check(!P.validRow(row9) && P.validateRow(row9).errors.some((e) => e.path === "cards[0].source"), "...and refuses a 9th");
  // The whole idea: whatever validate() + screen() accept, validateRow() accepts. A generated table, 9-plus-source cases included.
  let seed = 424242;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const PUBS = ["AR 600-20", "AR 670-1", "DA PAM 600-25", "ATP 6-22.1", "ADP 6-22", "FM 7-22", "TC 3-21.5", "DoDI 1300.17", "37 USC 403", "UCMJ Art. 86", "DA Form 4856"];
  const RES = ["Battalion SOP 2026", "unit SOP", "Squadron training schedule", "Company policy letter 4", "myPay", "Brigade standing order 4"];
  const WORDS = ["formation", "supply", "the troop", "guidon", "  padded  ", "café", "50-50", "Room 12", "0630", "AR 600-20 2020", "CPT", "Smith", "the first sergeant", "1st Squadron", "(fictional)"];
  const text = (max) => { let s = ""; const n = 1 + Math.floor(rnd() * 8); for (let i = 0; i < n; i++) s += (i ? " " : "") + pick(WORDS); return s.trim().slice(0, max) || "x"; };
  // Editions of every length the parser accepts (a month word may be as long as the source allows: "Jan" + 43 x's + " 2019"), and long locators.
  const edition = () => pick(["Jan 2019", "1 Jul 2024", "2020-03", "2021-05-04", "Sept 2019", "Jan" + "x".repeat(Math.floor(rnd() * 150)) + " 2019", "15 Mar" + "z".repeat(Math.floor(rnd() * 60)) + ". 2022"]);
  const source = () => {
    const n = 1 + Math.floor(rnd() * 11), parts = [];
    for (let i = 0; i < n; i++) {
      let piece = rnd() < 0.7 ? pick(PUBS) : pick(RES);
      if (rnd() < 0.3) piece += ", para " + (1 + Math.floor(rnd() * 9)) + "-" + (1 + Math.floor(rnd() * 9)) + (rnd() < 0.15 ? "x".repeat(Math.floor(rnd() * 120)) : "");
      if (rnd() < 0.25) piece += " (" + edition() + ")";
      parts.push(piece);
    }
    return parts.join(pick(["; ", ", ", " / ", "; "])).slice(0, 200);
  };
  let accepted = 0, refusedBySource = 0, otherRefused = 0, broken = [];
  for (let n = 0; n < 500; n++) {
    const p = { format: "guidon-unit-pack", formatVersion: 1, id: "gen-" + n, name: text(60), packVersion: "1." + n, packDate: "2026-09-26", cards: [] };
    const cards = 1 + Math.floor(rnd() * 12);
    for (let i = 0; i < cards; i++) {
      const c = { id: "c" + i, category: pick(["Cat one", "cat one", "History", "Local SOP", "constructor"]), q: "Question " + i + " " + text(100) + "?", a: (rnd() < 0.3 ? "  " : "") + text(300) + (rnd() < 0.3 ? "\r\n" + text(100) : "") + (rnd() < 0.3 ? "  " : "") };
      if (rnd() < 0.7) c.keyPoints = Array.from({ length: Math.floor(rnd() * 9) }, () => text(60));
      if (rnd() < 0.8) c.source = source();
      p.cards.push(c);
    }
    const v = valid(p);
    if (!v.ok) { if (v.errors.some((e) => e.code === "too-many-sources")) refusedBySource++; else otherRefused++; continue; }
    const s = P.screen(p, { now: NOW });
    if (!s.ok) { otherRefused++; continue; }
    accepted++;
    const rv = P.validateRow(P.toDeck(p, { importedAt: "2026-09-26T12:00:00.000Z" }));
    if (!rv.ok) broken.push({ n, errors: rv.errors.slice(0, 2) });
  }
  check(broken.length === 0, `validate() + screen() and validateRow() agree: of ${accepted + refusedBySource + otherRefused} generated decks, all ${accepted} that the import check accepted make a row the app keeps`, () => JSON.stringify(broken.slice(0, 2)));
  check(accepted > 100 && refusedBySource > 20, `(that table is meaningful: ${accepted} accepted, ${refusedBySource} refused for a source with too many references, ${otherRefused} refused for another reason)`, () => `${accepted}/${refusedBySource}/${otherRefused}`);
}

// Round 2: an edition longer than 40 characters ("Jan" + 43 x's + " 2019") is a real edition to the parser and used to be refused only by the
// ROW check, so the deck was accepted at import and vanished at the next start. Every citation field is now bounded by the 200-character
// source it came from - the same number in both checks.
{
  const longEd = "AR 600-8-19 (Jan" + "x".repeat(43) + " 2019)";
  check(longEd.length <= L.source && P.cite(longEd)[0].edition.length > 40, "(the reviewer's source parses to an edition longer than 40 characters)", () => JSON.stringify(P.cite(longEd)));
  const p = clone(BASE); p.cards[0].source = longEd;
  const row = P.toDeck(p, { importedAt: "2026-09-26T12:00:00.000Z" });
  check(valid(p).ok && P.validRow(row), "a deck whose source has a 51-character edition is accepted and its saved row is kept", () => JSON.stringify(valid(p).errors.concat(P.validateRow(row).errors)));
  const widest = "AR 1 (Jan" + "x".repeat(L.source - "AR 1 (Jan".length - " 2019)".length) + " 2019)";
  const p2 = clone(BASE); p2.cards[0].source = widest;
  const row2 = P.toDeck(p2, { importedAt: "2026-09-26T12:00:00.000Z" });
  check(widest.length === L.source && valid(p2).ok && P.validRow(row2), "and so is one whose edition fills the whole 200 characters", () => JSON.stringify(P.validateRow(row2).errors));
  const bad = clone(row); bad.cards[0].source[0].edition = "x".repeat(L.source + 1);
  check(!P.validRow(bad), "while the row check still refuses an edition past the 200 the source allows");
  // A fuzz over arbitrary source strings (pieces the parser reacts to, glued at random): whenever the import accepts one, the row check does.
  let seed = 90210;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const TOK = ["AR ", "DA PAM ", "FM ", "600-20", "6-22", "para ", "Ch ", "Table 4-1", "3-9c", "(", ")", " ", " ", ", ", ", ", "; ", " / ", " · ", "Jan", "Sept", "Mar.", "2019", "2020-03", "x", "x".repeat(40), "y".repeat(90), "\"", "and", "—", ":", "SOP", "Battalion", "supersedes", "USC", "10 ", "U.S.C. 892", "DA Form 4856", "CFR 199"];
  let tried = 0, accepted = 0, drift = [];
  for (let n = 0; n < 4000; n++) {
    let src = ""; const k = 1 + Math.floor(rnd() * 24);
    for (let i = 0; i < k; i++) src += TOK[Math.floor(rnd() * TOK.length)];
    src = src.slice(0, L.source);
    if (!src.trim()) continue;
    const p3 = clone(BASE); p3.cards[0].source = src;
    tried++;
    if (!valid(p3).ok) continue;
    accepted++;
    const rv = P.validateRow(P.toDeck(p3, { importedAt: "2026-09-26T12:00:00.000Z" }));
    if (!rv.ok) drift.push({ src, errors: rv.errors.slice(0, 1) });
  }
  check(drift.length === 0 && accepted > 1000, `whenever the import accepts a source, its row is kept: ${accepted} of ${tried} random sources checked, none disagreed`, () => JSON.stringify(drift.slice(0, 2)));
}

// Round 2: the row is judged as of the day it was ADDED, not the device's clock today. The one rule that reads the calendar (a FUTURE date
// with a place and a unit activity) would otherwise drop a saved deck at start-up on a device whose clock is wrong.
{
  const p = clone(BASE); p.cards[0].a = "The convoy departs Fort Foo on 15 March 2099.";
  check(!P.screen(p, { now: "2026-09-26" }).ok && P.screen(p, { now: "2100-01-01" }).ok, "(a sentence about a movement on 15 March 2099 is refused when added today, and fine on a device whose clock already reads 2100)");
  const addedLate = P.toDeck(p, { importedAt: "2100-01-01T00:00:00.000Z" });
  check(P.validRow(addedLate), "a row added when the date had passed is kept whatever the clock says now (it is judged as of the day it was added)", () => JSON.stringify(P.validateRow(addedLate).errors));
  const addedEarly = P.toDeck(p, { importedAt: "2026-09-26T00:00:00.000Z" });
  const v = P.validateRow(addedEarly);
  check(!v.ok && v.errors[0].code === "sensitive-text", "while a row added when that date was still ahead is refused, exactly as the import refused it");
  check(P.screenRow(addedLate, { now: "2026-09-26" }).ok === false, "(an explicit 'now' still overrides, for a caller that wants the clock)");
}

// A deck as large as the file may be, with the most source entries a card may have, is one the row check keeps.
{
  const src = "AR 1; AR 2; AR 3; AR 4; AR 5; AR 6; AR 7; AR 8";
  const big = clone(BASE); big.id = "biggest-deck";
  big.cards = Array.from({ length: L.cards }, (_, i) => ({ id: "c" + i, category: "Cat " + (i % 30), q: "Question number " + i + " " + strOf(20, "q"), a: strOf(1100, "a"), source: src }));
  const v = valid(big);
  const fileBytes = P.utf8Bytes(JSON.stringify(big)), row = P.toDeck(big, { importedAt: "2026-09-26T12:00:00.000Z" }), rowBytes = P.utf8Bytes(JSON.stringify(row));
  check(v.ok && fileBytes <= L.bytes && fileBytes > L.bytes * 0.9, `a 200-card deck of ${Math.round(fileBytes / 1024)} KB (the file limit is ${L.bytes / 1024} KB) is accepted`, () => JSON.stringify(v.errors.slice(0, 2)) + " " + fileBytes);
  check(rowBytes > L.bytes && rowBytes <= L.rowBytes && P.validRow(row), `its saved row is ${Math.round(rowBytes / 1024)} KB (each citation becomes a small object, so a row may be larger than the file: up to ${L.rowBytes / 1024} KB) and passes the row check`, () => JSON.stringify(P.validateRow(row).errors.slice(0, 2)) + " " + rowBytes);
  const huge = clone(row); huge.cards.forEach((c) => { c.keyPoints = Array.from({ length: 8 }, () => strOf(200, "k")); });
  const hv = P.validateRow(huge);
  check(!hv.ok && hv.errors[0].code === "too-big" && new RegExp("the most GUIDON keeps is " + L.rowBytes / 1024 + " KB").test(hv.errors[0].message), "a saved row larger than the row limit is refused (the row check has its own size cap)", () => JSON.stringify(hv.errors.slice(0, 1)));
}

// The saved-row check repeats the sensitive-text screen: a row that came in with a restored backup never went past the import check.
{
  const row = P.toDeck(BASE, { importedAt: "2026-09-26T12:00:00.000Z" });
  const dirty = (label, mutate) => { const r = clone(row); mutate(r); const v = P.validateRow(r); check(!v.ok && v.errors.some((e) => e.code === "sensitive-text"), `the row check refuses a saved deck with ${label}, as "sensitive-text"`, () => JSON.stringify(v.errors.slice(0, 2))); };
  dirty("a Social Security number in an answer", (r) => { r.cards[1].a = "Use 123-45-6789 to look it up."; });
  dirty("a classification marking in a question", (r) => { r.cards[0].q = "Is this SECRET//NOFORN?"; });
  dirty("a marking in a citation", (r) => { r.cards[0].source[0].pub = "Annex CUI//SP-PRVCY"; });
  dirty("an email address in the unit label", (r) => { r.unit = "Alpha a.b@example.com"; });
  dirty("a phone number in a key point", (r) => { r.cards[0].keyPoints = ["fine", "Call 555-123-4567"]; });
  dirty("a marking in a suggested title", (r) => { r.reciteTitles = ["CUI//SP-PRVCY"]; });
  dirty("a fullwidth Social Security number", (r) => { r.cards[1].a = "１２３-４５-６７８９"; });
  dirty("a roster in one card's key points", (r) => { r.cards[0].keyPoints = ["SGT Smith", "SSG Jones", "SPC Brown"]; });
  const v = P.validateRow(row);
  check(v.ok && P.screenRow(row).ok, "while a clean row passes both", () => JSON.stringify(v.errors));
  const fixtureRow = P.toDeck(JSON.parse(readFileSync(path.join(HERE, "fixtures", "unit-pack-example.pack.json"), "utf8")), { importedAt: "2026-09-26T12:00:00.000Z" });
  check(P.screenRow(fixtureRow, { now: NOW }).ok && P.validRow(fixtureRow), "the fictional example deck's row is clean");
  // Fail closed here too.
  const bare = loadUnitPackKit(); delete bare.opsecGuard;
  const bv = bare.unitPack.validateRow(row);
  check(!bv.ok && bv.errors.some((e) => e.code === "sensitive-text" && /not available/.test(e.message)), "with no sensitive-text check available a saved row is refused, never trusted");
  // What the row check found is one plain sentence for Diagnostics, without repeating the identifier.
  const r2 = clone(row); r2.cards[1].a = "Use 123-45-6789 to look it up.";
  const m = P.validateRow(r2).errors[0].message;
  check(/left out because its text looks like something that does not belong in a study deck/.test(m) && !/123-45-6789/.test(m), "and the message names the card and field without repeating the number", () => m);
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
    `no more than ${L.sourceEntries} separate references`, `keeps at most ${L.decks} decks`,
    "guidon-unit-pack", "Unit deck: (name)", "Add this deck",
  ];
  const missing = want.filter((w) => !docs.includes(w));
  check(missing.length === 0, "docs/unit-packs.md states every limit the code enforces, with the same numbers", () => "missing: " + missing.join(" | "));
  const gone = ["classification", "CUI", "roster", "song", "lyrics", "copyright", "accuracy", "approval"].filter((w) => !new RegExp(w, "i").test(docs));
  check(gone.length === 0, "and says what may not go in (classified/CUI, rosters, copyrighted words, unapproved material) and who is responsible", () => "missing: " + gone.join(" | "));
  // What the app really does with a deck is what the page says it does: the statements a leader and a Soldier rely on.
  const claims = [
    [/every backup you export\s+includes them/, "every exported backup includes the decks (no opt-in)"],
    [/Decks already on the device are still there to study\s+in a Guest or Kiosk session/, "a Guest or Kiosk session can still study a deck already on the device"],
    [/checked again the same way/, "a saved deck is checked again at every start and restore"],
    [/has no place for words to recite/, "the format has no place for words to recite (and does not claim the schema prevents it)"],
    [/Quiz best scores/, "Remove and Reset say Quiz best scores are part of the progress"],
    [/the study level in Board Drill and Quiz/, "the study level never hides a unit deck"],
    [/fullwidth\s+digits and letters/, "the plain copy the check reads is described"],
    [/Quiz best scores for topics\s+no other deck uses/, "Remove and Reset say a topic another deck also has keeps its Quiz score"],
    [/saved deck may be up to\s+448 KB/, "the saved-row size limit (448 KB) is stated next to the 256 KB file limit"],
    [/could not be loaded[\s\S]*Remove it/, "a deck that fails the re-check is listed in Settings with a Remove button"],
    [/not\s+deleted behind your back/, "and it is not deleted behind the Soldier's back"],
    [/What still gets\s+through, plainly/, "the docs say plainly what the check still lets through"],
    [/ALL-CAPS "SMITH, JOHN"/, "and name the list shapes it does not catch"],
    [/Devanagari/, "and the digits of other alphabets"],
    [/"SGT Team Leader"/, "the docs say a rank followed by a billet is not a person"],
    [/first three lines that tripped it/, "the docs say the refusal names the first three lines"],
    [/every kind of dash/, "the docs say every dash is folded"],
    [/emoji variation selector/, "the docs say which three hidden characters are allowed"],
  ];
  const unsaid = claims.filter(([re]) => !re.test(docs)).map(([, what]) => what);
  check(unsaid.length === 0, "and states what the app really does: backups, Guest and Kiosk, the re-check, no place for recitation words, what Remove deletes, the study level", () => "missing: " + unsaid.join(" | "));
  check(!/never leaves (?:the|this) device/i.test(docs) && !/cannot carry text to recite/.test(docs), "and no longer says \"never leaves the device\" (a deck goes into every exported backup) or that a deck \"cannot carry text to recite\"");
}
{
  const { modules } = loadModules();
  const core = modules.find((m) => m.id === "unit-decks-core"), rt = modules.find((m) => m.id === "unit-decks");
  const idx = (id) => modules.findIndex((m) => m.id === id);
  check(!!core && core.kind === "feature" && core.headless === true && core.requires.includes("opsec-guard") && idx("opsec-guard") < idx("unit-decks-core"), "unit-decks-core is a headless feature that requires (and loads after) the sensitive-text check");
  check(!!rt && rt.kind === "feature" && rt.emit === undefined && rt.requires.includes("unit-decks-core") && rt.storageKeys.includes("unit-deck:*") && rt.clearsKeys.length === 2 && rt.clearsKeys.includes("srs:*") && rt.clearsKeys.includes("boardQuiz:best:*") && idx("unit-decks-core") < idx("unit-decks"), "unit-decks is a runtime feature that owns unit-deck:* and only clears srs:* and boardQuiz:best:* (a deck's own review schedule and Quiz scores)");
  check(!modules.some((m) => (m.kind === "content-pack" || m.kind === "finalize") && /unit-deck/.test(m.id)), "neither is a content pack: a unit deck is never merged into the bank");
  check(Object.keys(G.unitPack).length > 15 && core.provides.every((n) => { const parts = n.split("."); let o = G; for (const p of parts.slice(1)) { o = o && o[p]; } return o !== undefined; }), "every API name unit-decks-core lists under provides exists in the loaded file");
}

await finish("UNIT PACK FORMAT");
