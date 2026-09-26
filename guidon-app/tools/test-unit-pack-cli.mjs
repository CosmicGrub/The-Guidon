/**
 * The unit-deck authoring command (tools/make-unit-pack.mjs), run for real against
 * the fictional example deck.
 *
 * WHY THIS SUITE EXISTS. A unit leader builds a deck with this command, not by hand,
 * and the promise is "a deck this command writes is a deck the app accepts, and one
 * it refuses the app would refuse too". That promise breaks silently if the command
 * grows its own idea of the limits, or if its CSV reader drops a column, a quoted
 * comma or a line break, or if it writes a deck the sensitive-text check would have
 * stopped. Every step is run as a child process, exactly as a leader would:
 *
 *  1. the committed fictional example is rebuilt from BOTH authoring inputs (the
 *     spreadsheet and the JSON form) and each result is byte for byte the committed
 *     pack, which the app's own validator and screen accept;
 *  2. --check writes nothing; a normal run writes exactly one file;
 *  3. exit 1 for a format or limit problem (an over-long answer, a missing or unknown
 *     column, a bad date, a repeated id, an unknown field, a newer format version),
 *     each naming the card and field in plain words, and NOTHING written; exit 2 when
 *     the sensitive-text check finds anything, naming the card and field, and nothing
 *     written - both agree with the app's validator on a table of planted decks;
 *  4. the spreadsheet reader: quoted commas and doubled quotes, line breaks inside a
 *     quoted answer, Windows line endings, a byte-order mark, blank lines, "|" between
 *     key points, deck details from # lines with the command line overriding them -
 *     and a row with MORE (or fewer) cells than the header is refused, naming the row,
 *     instead of quietly dropping the words after an unquoted comma;
 *  5. a deck cannot carry words to recite: a lyrics or recite-text column or field is
 *     refused; only titles pass (# recite: / --recite);
 *  6. the command loads the app's own file for every rule (no limits of its own), and
 *     the user-facing help and messages carry no jargon.
 *
 * Pure node; no browser.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, finish } from "./testkit.mjs";
import { loadUnitPackKit } from "./unit-pack-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "make-unit-pack.mjs");
const FIX = path.join(HERE, "fixtures");
const scratch = mkdtempSync(path.join(tmpdir(), "guidon-unit-cli-"));
const G = loadUnitPackKit();
const P = G.unitPack;
const NOW = "2026-09-26";

const run = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: scratch, ...opts });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", both: (r.stdout || "") + (r.stderr || "") };
};
const at = (name) => path.join(scratch, name);
const write = (name, text) => { writeFileSync(at(name), text); return at(name); };
const readOut = (name) => readFileSync(at(name), "utf8");
const filesInScratch = () => readdirSync(scratch).sort();

try {
  /* -------------------------------------------------- 1. the fictional example, both inputs */
  const committed = readFileSync(path.join(FIX, "unit-pack-example.pack.json"), "utf8");
  {
    const r = run([path.join(FIX, "unit-pack-example.csv"), "--out", at("from-csv.pack.json")]);
    check(r.code === 0 && existsSync(at("from-csv.pack.json")), "the spreadsheet example builds (exit 0)", () => r.both);
    check(readOut("from-csv.pack.json") === committed, "and is byte for byte the committed fictional pack", () => "differs");
    check(/8 in 3 categories/.test(r.out) && /Squadron song, Squadron motto/.test(r.out) && /titles only - no words to recite/.test(r.out), "the summary names the cards, categories and the suggested titles (titles only)", () => r.out);
    const j = run([path.join(FIX, "unit-pack-authoring-example.json"), "--out", at("from-json.pack.json")]);
    check(j.code === 0 && readOut("from-json.pack.json") === committed, "the JSON authoring form builds the very same pack", () => j.both);
    const pack = JSON.parse(committed);
    check(P.validate(pack).ok && P.screen(pack, { now: NOW }).ok, "and the app's own validator and screen accept it");
    check(!/[<>]/.test(committed) && pack.cards.every((c) => !/lines|lyrics|reciteText/.test(Object.keys(c).join())), "the fictional deck is harmless: no markup and nothing to recite");
  }

  /* -------------------------------------------------- 2. --check, default output name */
  {
    const before = filesInScratch();
    const r = run([path.join(FIX, "unit-pack-example.csv"), "--check", "--out", at("never.pack.json")]);
    check(r.code === 0 && /check\s+ok - nothing written/.test(r.out) && !existsSync(at("never.pack.json")) && JSON.stringify(filesInScratch()) === JSON.stringify(before), "--check validates and writes nothing", () => r.both);
    write("mine.csv", readFileSync(path.join(FIX, "unit-pack-example.csv"), "utf8"));
    const d = run([at("mine.csv")]);
    check(d.code === 0 && existsSync(at("mine.pack.json")), "with no --out the pack lands beside the input as <name>.pack.json", () => d.both);
    const o = run([at("mine.csv"), "--out", at("mine.csv")]);
    check(o.code === 1 && /overwrite the input/.test(o.err), "it will not overwrite its own input", () => o.both);
  }

  /* -------------------------------------------------- 3. exit codes, and agreement with the app's validator */
  const head = "# id: test-deck\n# name: Test deck\n# version: 1\n# date: 2026-09-26\n";
  const csv = (rows, header = "id,category,question,answer") => head + header + "\n" + rows.join("\n") + "\n";
  const bad1 = (label, file, args, wantRe) => {
    const r = run([file, ...args]);
    check(r.code === 1 && wantRe.test(r.err) && !/^wrote/m.test(r.out), `exit 1, nothing written: ${label}`, () => `exit ${r.code}: ${r.both}`);
  };
  {
    bad1("an answer over 1,200 characters", write("long.csv", csv(["c1,Cat,Why?," + "x".repeat(1201)])), ["--out", at("long.out.json")], /Card 1 \(c1\): the answer is longer than 1,200 characters/);
    check(!existsSync(at("long.out.json")), "no file was left behind by a refused deck");
    bad1("a missing answer column", write("noans.csv", head + "id,category,question\nc1,Cat,Why?\n"), [], /needs a "answer" column/);
    bad1("an unknown column", write("extra.csv", head + "id,category,question,answer,colour\nc1,Cat,Why?,Because,red\n"), [], /column called "colour" that GUIDON does not use/);
    bad1("a lyrics column (a deck cannot carry words to recite)", write("lyr.csv", head + "id,category,question,answer,lyrics\nc1,Cat,Why?,Because,la la\n"), [], /column called "lyrics"/);
    bad1("a bad date", write("date.csv", "# id: test-deck\n# name: Test deck\n# version: 1\n# date: 2026-02-30\nid,category,question,answer\nc1,Cat,Q?,A\n"), [], /must be a real calendar date/);
    bad1("no deck id anywhere", write("noid.csv", "# name: T\n# version: 1\nid,category,question,answer\nc1,Cat,Q?,A\n"), [], /The deck id is missing/);
    bad1("two cards with one id", write("dup.csv", csv(["c1,Cat,First?,A", "c1,Cat,Second?,B"])), [], /Card 2 \(c1\): the card id "c1" is used by an earlier card too/);
    bad1("no cards", write("empty.csv", head + "id,category,question,answer\n"), [], /has no cards/);
    bad1("a header only spreadsheet with no header row", write("blank.csv", ""), [], /no header row/);
    bad1("an unclosed quote", write("quote.csv", head + "id,category,question,answer\nc1,Cat,\"Q?,A\n"), [], /quote that is never closed/);
    bad1("a JSON field the format does not have", write("extra.json", JSON.stringify({ id: "test-deck", name: "T", version: "1", date: "2026-09-26", cards: [{ id: "c1", category: "C", q: "Q?", a: "A", image: "x.png" }] })), [], /Card 1 \(c1\) has a field GUIDON does not know \("image"\)/);
    bad1("a JSON file that is not JSON", write("notjson.json", "{ nope"), [], /not valid JSON/);
    bad1("a newer format version", write("newer.json", JSON.stringify({ format: "guidon-unit-pack", formatVersion: 2, id: "test-deck", name: "T", packVersion: "1", packDate: "2026-09-26", cards: [] })), [], /newer deck format \(version 2\)/);
    bad1("a file that does not exist", at("nope.csv"), [], /cannot read/);
    const u = run([write("u.csv", csv(["c1,Cat,Q?,A"])), "--bogus"]);
    check(u.code === 1 && /unknown option --bogus/.test(u.err), "an unknown option is refused (exit 1)", () => u.both);
    const two = run([at("u.csv"), at("mine.csv")]);
    check(two.code === 1 && /exactly one input file/.test(two.err), "two input files are refused (exit 1)", () => two.both);
    const h = run(["--help"]);
    check(h.code === 0 && /Exit 2: the sensitive-text check found something/.test(h.out), "--help explains the exit codes (exit 0)", () => h.both);
  }
  {
    const cases = [
      ["a Social Security number in an answer", csv(["c1,Cat,Q?,Use 123-45-6789 to look it up."]), /Card 1 \(c1\), answer: this looks like a Social Security number/],
      ["a classification marking in a source", head + "id,category,question,answer,source\nc1,Cat,Q?,A,Annex SECRET//NOFORN\n", /Card 1 \(c1\), source: this looks like a classification or handling marking/],
      ["a phone number in a key point", head + "id,category,question,answer,key points\nc1,Cat,Q?,A,fine | Call 555-123-4567\n", /Card 1 \(c1\), key point 2: this looks like a phone number/],
      ["an email address in the deck name", "# id: test-deck\n# name: Contact a.b@example.com\n# version: 1\n# date: 2026-09-26\nid,category,question,answer\nc1,Cat,Q?,A\n", /The deck name: this looks like an email address/],
      ["a roster of names", csv(["c1,Cat,Q?,\"SGT Smith\nSSG Jones\nSPC Brown\""]), /this looks like a list of people's names/],
      ["a suggested title that is a marking", csv(["c1,Cat,Q?,A"]).replace("# date:", "# recite: CUI//SP-PRVCY\n# date:"), /Suggested title 1: this looks like a classification or handling marking/],
    ];
    for (const [label, text, want] of cases) {
      const before = filesInScratch();
      const f = write("sens.csv", text);
      const r = run([f, "--out", at("sens.out.json"), "--now", NOW]);
      check(r.code === 2 && want.test(r.err) && !existsSync(at("sens.out.json")) && /Nothing was written/.test(r.err), `exit 2, nothing written, card and field named: ${label}`, () => `exit ${r.code}: ${r.both}`);
    }
    const fut = csv(["c1,Cat,When?,The convoy departs Fort Foo on 15 March 2027."]);
    const a = run([write("fut.csv", fut), "--check", "--now", NOW]), b = run([at("fut.csv"), "--check", "--now", "2028-01-01"]);
    check(a.code === 2 && b.code === 0, "the future-date check follows the clock the command is given (--now)", () => a.code + "/" + b.code);
  }
  // The command and the app agree, on a table of decks (JSON in, verdict out).
  {
    const base = () => ({ format: "guidon-unit-pack", formatVersion: 1, id: "agree-deck", name: "Agree", packVersion: "1", packDate: "2026-09-26", cards: [{ id: "c1", category: "C", q: "Q one?", a: "A one." }, { id: "c2", category: "C", q: "Q two?", a: "A two." }] });
    const tbl = [
      ["a clean deck", (p) => p],
      ["a long question", (p) => { p.cards[0].q = "q".repeat(301); return p; }],
      ["a 9th key point", (p) => { p.cards[0].keyPoints = Array.from({ length: 9 }, (_, i) => "k" + i); return p; }],
      ["a marking", (p) => { p.cards[1].a = "This is SECRET//NOFORN"; return p; }],
      ["an SSN", (p) => { p.cards[1].a = "123-45-6789"; return p; }],
      ["a 31st category", (p) => { p.cards = Array.from({ length: 31 }, (_, i) => ({ id: "c" + i, category: "Cat " + i, q: "Q" + i + "?", a: "A" })); return p; }],
      ["an id with capitals", (p) => { p.cards[0].id = "Bad"; return p; }],
    ];
    for (const [label, mutate] of tbl) {
      const p = mutate(base());
      const file = write("agree.json", JSON.stringify(p));
      const r = run([file, "--check", "--now", NOW]);
      const v = P.validate(p), s = v.ok ? P.screen(p, { now: NOW }) : { ok: true };
      const appVerdict = !v.ok ? 1 : !s.ok ? 2 : 0;
      check(r.code === appVerdict, `the command and the app give the same verdict (${appVerdict}): ${label}`, () => `cli ${r.code} vs app ${appVerdict}: ${r.both}`);
    }
  }

  /* -------------------------------------------------- 3b. a row must have as many cells as the header */
  {
    // "At 0630, every day" typed without quotes is two cells. The command used to keep the first and drop the rest without a word.
    const f = write("comma.csv", csv(["c1,SOP,When is formation?,At 0630, every day"]));
    const r = run([f, "--out", at("comma.out.json")]);
    check(r.code === 1 && /spreadsheet row 2 \(the header is row 1\) has 5 cells but the header has 4/.test(r.err) && /c1,SOP,When is formation\?,At 0630, every day/.test(r.err) && /quotes around the whole cell, like "At 0630, every day"/.test(r.err) && /Nothing was written/.test(r.err) && !existsSync(at("comma.out.json")),
      "exit 1, nothing written: a row with MORE cells than the header (an unquoted comma), naming the row and showing where it starts", () => `exit ${r.code}: ${r.both}`);
    const q = run([write("comma-q.csv", csv(['c1,SOP,When is formation?,"At 0630, every day"'])), "--out", at("comma-q.out.json")]);
    check(q.code === 0 && JSON.parse(readOut("comma-q.out.json")).cards[0].a === "At 0630, every day", "the same words with quotes around the cell are kept whole", () => q.both);
    const few = run([write("few.csv", head + "id,category,question,answer,key points,source\nc1,SOP,When?,At 0630\n"), "--check"]);
    check(few.code === 1 && /spreadsheet row 2 \(the header is row 1\) has 4 cells but the header has 6/.test(few.err) && /Add the missing commas at the end of the row \(an empty cell is fine\)/.test(few.err), "a row with FEWER cells is refused too, with what to do about it", () => `exit ${few.code}: ${few.both}`);
    const third = run([write("third.csv", csv(["c1,A,Q1?,A1", "c2,B,Q2?,A2", "c3,C,Q3?,A3, and more"])), "--check"]);
    check(third.code === 1 && /spreadsheet row 4 \(the header is row 1\) has 5 cells/.test(third.err) && /c3,C,Q3\?,A3, and more/.test(third.err), "it names the row that is wrong (the third card is row 4), not the first", () => third.both);
    const blanks = run([write("blank-lines.csv", csv(["c1,A,Q1?,A1", "", "   ", "c2,B,Q2?,A2"])), "--check"]);
    check(blanks.code === 0, "blank lines and lines of only spaces between cards are still fine", () => blanks.both);
    const full = run([write("full-empty.csv", head + "id,category,question,answer,key points,source\nc1,SOP,When?,At 0630,,\n"), "--check"]);
    check(full.code === 0, "a row that spells out its empty cells (the way a spreadsheet exports it) is fine", () => full.both);
    // The rule is the command's own reading of the file; a deck that has already been read is judged by the app's validator as before.
    const p = run([write("comma-nothing.csv", csv(["c1,SOP,When?,At 0630, every day"])), "--check"]);
    check(p.code === 1 && !/wrote/.test(p.out), "and --check refuses it as well (it never writes anyway)", () => p.both);
  }

  /* -------------------------------------------------- 4. the spreadsheet reader */
  {
    const text = "﻿# id: reader-test\r\n# name: Reader test\r\n# unit: Test Unit\r\n# version: 2\r\n# date: 2026-09-26\r\n# recite: Unit song\r\n# recite: Unit motto\r\n\r\n" +
      "ID,Category,Question,Answer,Key Points,Source\r\n" +
      "a-1,Cat one,\"What is a, b and c?\",\"He said \"\"go\"\", then left.\",One | Two | Three,\"Unit SOP 2026, para 2\"\r\n" +
      "\r\n" +
      "a-2,Cat one,Two lines?,\"Line one\nLine two\",,\r\n";
    const f = write("reader.csv", text);
    const r = run([f, "--out", at("reader.pack.json")]);
    check(r.code === 0, "a spreadsheet with a byte-order mark, Windows line endings, quotes and a blank line builds", () => r.both);
    const pack = JSON.parse(readOut("reader.pack.json"));
    const c1 = pack.cards[0], c2 = pack.cards[1];
    check(pack.cards.length === 2 && c1.q === "What is a, b and c?" && c1.a === 'He said "go", then left.', "quoted commas and doubled quotes are read as typed", () => JSON.stringify(c1));
    check(JSON.stringify(c1.keyPoints) === JSON.stringify(["One", "Two", "Three"]) && c1.source === "Unit SOP 2026, para 2" && c2.keyPoints === undefined && c2.source === undefined, "key points split at |, and an empty key points or source cell adds nothing", () => JSON.stringify([c1, c2]));
    check(c2.a === "Line one\nLine two", "a line break inside a quoted answer is kept", () => JSON.stringify(c2.a));
    check(pack.id === "reader-test" && pack.unit === "Test Unit" && pack.packVersion === "2" && JSON.stringify(pack.reciteTitles) === JSON.stringify(["Unit song", "Unit motto"]), "deck details come from the # lines, and # recite: lines are titles", () => JSON.stringify(pack));
    const o = run([f, "--out", at("override.pack.json"), "--id", "override-id", "--name", "Override name", "--unit", "Other Unit", "--version", "9", "--date", "2026-01-02", "--recite", "Only title"]);
    const ov = JSON.parse(readOut("override.pack.json"));
    check(o.code === 0 && ov.id === "override-id" && ov.name === "Override name" && ov.unit === "Other Unit" && ov.packVersion === "9" && ov.packDate === "2026-01-02" && JSON.stringify(ov.reciteTitles) === JSON.stringify(["Only title"]), "command-line options override the # lines (and --recite replaces the listed titles)", () => JSON.stringify(ov));
    const noId = run([write("noid-col.csv", head + "category,question,answer\nCat,First?,A\nCat,Second?,B\n"), "--out", at("noid-col.pack.json")]);
    const ni = JSON.parse(readOut("noid-col.pack.json"));
    check(noId.code === 0 && ni.cards[0].id === "c001" && ni.cards[1].id === "c002" && /no id column/.test(noId.out) && /break|wrong cards/i.test(noId.out), "with no id column, ids are c001, c002 ... and the command warns that reordering rows breaks saved progress", () => noId.both);
  }

  /* -------------------------------------------------- 5. no words to recite */
  {
    const j = run([write("recite.json", JSON.stringify({ id: "test-deck", name: "T", version: "1", date: "2026-09-26", reciteTitles: ["Unit song"], reciteText: "la la la", cards: [{ id: "c1", category: "C", q: "Q?", a: "A" }] })), "--check"]);
    check(j.code === 1 && /has a field GUIDON does not know \("reciteText"\)/.test(j.err), "a JSON deck with recitation text is refused; only titles are allowed", () => j.both);
    const card = run([write("recite2.json", JSON.stringify({ id: "test-deck", name: "T", version: "1", date: "2026-09-26", cards: [{ id: "c1", category: "C", q: "Q?", a: "A", lines: ["one", "two"] }] })), "--check"]);
    check(card.code === 1 && /Card 1 \(c1\) has a field GUIDON does not know \("lines"\)/.test(card.err), "and so is a card that carries lines to recite", () => card.both);
    const ok1 = run([write("titles.json", JSON.stringify({ id: "test-deck", name: "T", version: "1", date: "2026-09-26", reciteTitles: ["Unit song", "Unit motto"], cards: [{ id: "c1", category: "C", q: "Q?", a: "A" }] })), "--out", at("titles.pack.json")]);
    check(ok1.code === 0 && JSON.parse(readOut("titles.pack.json")).reciteTitles.length === 2, "two suggested titles are fine");
  }

  /* -------------------------------------------------- 6. one validator, plain words */
  {
    const src = readFileSync(CLI, "utf8");
    check(/loadUnitPackKit/.test(src) && /unit-pack-kit\.mjs/.test(src), "the command loads the app's own validator through tools/unit-pack-kit.mjs");
    check(!/262144|\b1200\b|\b200\b.*cards|MAX_CARDS|LIMITS\s*=/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "and keeps no limits of its own");
    const kit = readFileSync(path.join(HERE, "unit-pack-kit.mjs"), "utf8");
    check(/unit-decks-core\.js|"unit-decks-core"/.test(kit) && /opsec-guard/.test(kit), "the kit loads exactly the app's sensitive-text check and unit-decks-core.js from src/app-modules");
    const helpText = run(["--help"]).out;
    const jargon = /\b(schema|regex|stack trace|undefined|AST|JSON path)\b/i.exec(run([at("long.csv")]).err + helpText);
    check(!jargon, "the help and the messages a leader reads carry no builder's jargon", () => String(jargon));
    check(/docs\/unit-packs\.md/.test(helpText), "the help points to docs/unit-packs.md");
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

await finish("UNIT PACK CLI");
