#!/usr/bin/env node
/**
 * make-unit-pack: turn a simple spreadsheet (CSV) or JSON authoring file into a
 * GUIDON unit deck - the "guidon-unit-pack" v1 file a Soldier imports under
 * Settings -> Study Preferences -> Unit decks.
 *
 *   node tools/make-unit-pack.mjs cards.csv --id my-unit-sop --name "My unit's SOP facts" --unit "Alpha Troop"
 *   node tools/make-unit-pack.mjs deck.json --out deck.pack.json
 *   node tools/make-unit-pack.mjs cards.csv --check            (check only, write nothing)
 *
 * It checks the deck with the app's OWN validator - src/app-modules/unit-decks-core.js,
 * loaded by tools/unit-pack-kit.mjs - so the caps, the closed schema and the
 * sensitive-text screening are the ones the app applies on import, not a copy.
 * A deck this command writes is a deck the app accepts; one it refuses, the app
 * would refuse too. The same plain-language messages are printed, naming the
 * card and the field.
 *
 * INPUT
 *   CSV   The first row is the header. Columns (any order, upper or lower case):
 *           category, question (or q), answer (or a)     required
 *           key points   optional, several points separated by |
 *           source       optional, your unit's own words ("Squadron SOP 2026, para 4")
 *           id           optional but recommended: a short stable name for the card
 *                        ("sop-001"). Without it ids are assigned by row order, which
 *                        breaks Soldiers' saved progress if you reorder rows later.
 *         Lines at the very top that start with # give the deck's details:
 *           # id: pinecone-ridge-demo        # name: ...     # unit: ...
 *           # version: 2026.09               # date: 2026-09-26
 *           # recite: Unit song              (a suggested TITLE only; repeat for more)
 *         Command-line options override them.
 *   JSON  Either a finished pack, or the same thing with these conveniences:
 *         "version" / "date" instead of packVersion / packDate, no format fields,
 *         card "question" / "answer" spelled out, "keyPoints" as one string with |,
 *         and cards without an id.
 *
 * WHAT IT WILL NOT DO
 *   - write a deck the app would refuse (exit 1: a format or limit problem;
 *     exit 2: the sensitive-text check found something - nothing is written);
 *   - accept recitation text. A deck may only suggest TITLES ("Unit song");
 *     the words are always the Soldier's own (a unit song is usually copyrighted);
 *   - clear a deck. The check is a prevention aid; the author remains responsible
 *     for everything in the deck. See docs/unit-packs.md.
 *
 * Options: --out <file>  --check  --id  --name  --unit  --version  --date
 *          --recite <title> (repeatable)  --now <YYYY-MM-DD> (the date the check
 *          treats as "today", for tests)  --help
 * No dependencies; run from anywhere.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadUnitPackKit } from "./unit-pack-kit.mjs";

const HELP = `make-unit-pack: build a GUIDON unit deck from a CSV or JSON authoring file.

  node tools/make-unit-pack.mjs <input.csv|input.json> [--out file] [--check]
      [--id deck-id] [--name "Deck name"] [--unit "Unit label"] [--version 2026.09]
      [--date YYYY-MM-DD] [--recite "Unit song"] ...

Exit 0: the deck is valid and was written (or, with --check, is valid).
Exit 1: the file, the format or a limit is wrong. Exit 2: the sensitive-text check found something.
See docs/unit-packs.md.`;

const argv = process.argv.slice(2);
const VALUE_FLAGS = ["--out", "--id", "--name", "--unit", "--version", "--date", "--recite", "--now"];
const flags = { recite: [] };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--help" || a === "-h") { console.log(HELP); process.exit(0); }
  if (a === "--check") { flags.check = true; continue; }
  if (VALUE_FLAGS.includes(a)) {
    if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) fail(1, `${a} needs a value after it.`);
    const v = argv[++i];
    if (a === "--recite") flags.recite.push(v); else flags[a.slice(2)] = v;
    continue;
  }
  if (a.startsWith("--")) fail(1, `unknown option ${a}. Run with --help to see the options.`);
  positional.push(a);
}
if (positional.length !== 1) fail(1, "give exactly one input file (a .csv or .json). Run with --help for usage.");

function fail(code, msg) { console.error("make-unit-pack: " + msg); process.exit(code); }

const inputPath = path.resolve(positional[0]);
let raw;
try { raw = readFileSync(inputPath, "utf8"); } catch (e) { fail(1, `cannot read ${positional[0]} (${e.code || e.message}).`); }
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

/* ------------------------------------------------------------------ CSV */
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false, i = 0, any = false;
  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); if (row.length > 1 || row[0] !== "" || any) rows.push(row); row = []; any = false; };
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
      continue;
    }
    if (c === '"' && cell === "") { q = true; any = true; continue; }
    if (c === ",") { any = true; endCell(); continue; }
    if (c === "\r") { if (text[i + 1] === "\n") i++; endRow(); continue; }
    if (c === "\n") { endRow(); continue; }
    cell += c; any = true;
  }
  if (q) fail(1, "the CSV has a quote that is never closed. Check the cell that starts with a quote mark.");
  if (cell !== "" || row.length) endRow();
  return rows;
}

const COLUMN_ALIASES = {
  category: "category", question: "q", q: "q", answer: "a", a: "a",
  "key points": "keyPoints", keypoints: "keyPoints", "key_points": "keyPoints", "key point": "keyPoints",
  source: "source", id: "id",
};
const splitPoints = (s) => String(s).split(/\s*\|\s*|\r?\n/).map((x) => x.trim()).filter(Boolean);

function fromCsv(text) {
  const meta = {}, recite = [];
  const lines = text.split(/\r\n|\r|\n/);
  let k = 0;
  // A # line is a deck detail when it is "# id: ...", "# name: ..." (and so on); any other # line is
  // a comment for the person editing the file and is ignored.
  while (k < lines.length && (/^\s*#/.test(lines[k]) || !lines[k].trim())) {
    const m = /^\s*#\s*(id|name|unit|version|date|recite)\s*:\s*(.*?)\s*$/i.exec(lines[k]);
    if (m) { const key = m[1].toLowerCase(); if (key === "recite") recite.push(m[2]); else meta[key] = m[2]; }
    k++;
  }
  const rows = parseCsv(lines.slice(k).join("\n"));
  if (!rows.length) fail(1, "the CSV has no header row and no cards.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const cols = header.map((h) => COLUMN_ALIASES[h]);
  header.forEach((h, i) => { if (!cols[i]) fail(1, `the CSV has a column called "${rows[0][i].trim()}" that GUIDON does not use. Columns: category, question, answer, key points, source, id.`); });
  for (const need of ["category", "q", "a"]) if (!cols.includes(need)) fail(1, `the CSV needs a "${need === "q" ? "question" : need === "a" ? "answer" : need}" column.`);
  // Every row must have exactly as many cells as the header. A comma inside a cell that is not wrapped in quotes splits it in two
  // ("At 0630, every day" becomes "At 0630" and "every day"), and reading on would quietly drop the words after the comma.
  const body = rows.slice(1).map((r, i) => ({ r, n: i + 2 })).filter(({ r }) => !(r.length === 1 && !r[0].trim()));
  for (const { r, n } of body) {
    if (r.length === header.length) continue;
    const start = r.join(",").replace(/\s+/g, " ").slice(0, 60);
    fail(1, `spreadsheet row ${n} (the header is row 1) has ${r.length} cell${r.length === 1 ? "" : "s"} but the header has ${header.length}. It starts: "${start}". ` +
      (r.length > header.length
        ? `A comma inside a cell must have quotes around the whole cell, like "At 0630, every day", or it splits the cell in two and the words after it are lost.`
        : `Add the missing commas at the end of the row (an empty cell is fine).`) + " Nothing was written.");
  }
  const cards = body.map(({ r }) => {
    const c = {};
    cols.forEach((name, i) => {
      const v = (r[i] || "").trim();
      if (name === "keyPoints") { const pts = splitPoints(v); if (pts.length) c.keyPoints = pts; }
      else if (v !== "" || name === "category" || name === "q" || name === "a") c[name] = v;
    });
    return c;
  });
  return { meta, recite, cards, hasIdColumn: cols.includes("id") };
}

/* ----------------------------------------------------------------- JSON */
function fromJson(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { fail(1, "the JSON file is not valid JSON (" + String(e.message).split("\n")[0] + ")."); }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) fail(1, "the JSON file must be one object: the deck.");
  const meta = {};
  const out = {};
  for (const k of Object.keys(obj)) {
    if (k === "version") meta.version = obj[k];
    else if (k === "date") meta.date = obj[k];
    else out[k] = obj[k];
  }
  const cards = Array.isArray(out.cards) ? out.cards.map((c) => {
    if (c === null || typeof c !== "object" || Array.isArray(c)) return c;
    const n = {};
    for (const k of Object.keys(c)) {
      if (k === "question") n.q = c[k];
      else if (k === "answer") n.a = c[k];
      else if (k === "keyPoints" && typeof c[k] === "string") n.keyPoints = splitPoints(c[k]);
      else n[k] = c[k];
    }
    return n;
  }) : out.cards;
  return { meta, out, cards };
}

/* ------------------------------------------------------ build the pack */
const isCsv = /\.csv$/i.test(inputPath) || (!/\.json$/i.test(inputPath) && !/^\s*[{[]/.test(raw));
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const warnings = [];

let pack;
if (isCsv) {
  const c = fromCsv(raw);
  const m = c.meta;
  const cards = c.cards.map((card, i) => {
    const out = {};
    out.id = card.id || "c" + String(i + 1).padStart(3, "0");
    out.category = card.category; out.q = card.q; out.a = card.a;
    if (card.keyPoints) out.keyPoints = card.keyPoints;
    if (card.source) out.source = card.source;
    return out;
  });
  if (!c.hasIdColumn) warnings.push("the CSV has no id column, so card ids were assigned by row order (c001, c002, ...). If you later reorder or insert rows, Soldiers' saved progress will attach to the wrong cards. Add an id column to keep progress steady.");
  pack = { format: "guidon-unit-pack", formatVersion: 1, id: flags.id || m.id, name: flags.name || m.name };
  const unit = flags.unit || m.unit; if (unit) pack.unit = unit;
  pack.packVersion = flags.version || m.version; pack.packDate = flags.date || m.date || today();
  pack.cards = cards;
  const titles = flags.recite.length ? flags.recite : c.recite; if (titles.length) pack.reciteTitles = titles;
} else {
  const j = fromJson(raw);
  pack = { format: "guidon-unit-pack", formatVersion: 1 };
  const o = j.out;
  pack.id = flags.id || o.id; pack.name = flags.name || o.name;
  const unit = flags.unit || o.unit; if (unit !== undefined) pack.unit = unit;
  pack.packVersion = flags.version || o.packVersion || j.meta.version; pack.packDate = flags.date || o.packDate || j.meta.date || today();
  if (Array.isArray(j.cards)) {
    let auto = false;
    pack.cards = j.cards.map((card, i) => {
      if (card && typeof card === "object" && !Array.isArray(card) && card.id === undefined) { auto = true; return Object.assign({ id: "c" + String(i + 1).padStart(3, "0") }, card); }
      return card;
    });
    if (auto) warnings.push("some cards had no id, so ids were assigned by position (c001, c002, ...). Give each card a stable id so Soldiers' saved progress survives later edits.");
  } else pack.cards = j.cards;
  const titles = flags.recite.length ? flags.recite : o.reciteTitles; if (titles !== undefined) pack.reciteTitles = titles;
  // Anything else in the file is passed through so the validator names it, not silently dropped.
  for (const k of Object.keys(o)) if (!["format", "formatVersion", "id", "name", "unit", "packVersion", "packDate", "cards", "reciteTitles"].includes(k)) pack[k] = o[k];
  if (o.format !== undefined) pack.format = o.format;
  if (o.formatVersion !== undefined) pack.formatVersion = o.formatVersion;
}
for (const k of Object.keys(pack)) if (pack[k] === undefined) delete pack[k];

/* -------------------------------------------------- check, the app's way */
const G = loadUnitPackKit();
const P = G.unitPack;
const v = P.validate(pack);
if (!v.ok) {
  console.error(`make-unit-pack: this deck cannot be used (${v.errors.length}${v.truncated ? "+" : ""} problem${v.errors.length === 1 ? "" : "s"}). Nothing was written.`);
  for (const e of v.errors) console.error("  - " + e.message);
  process.exit(1);
}
const size = P.utf8Bytes(JSON.stringify(pack, null, 2)) + 1;
if (size > P.LIMITS.bytes) { console.error(`make-unit-pack: the finished file would be ${Math.round(size / 1024)} KB; a unit deck may be at most ${P.LIMITS.bytes / 1024} KB. Nothing was written.`); process.exit(1); }
const s = P.screen(pack, flags.now ? { now: flags.now } : undefined);
if (s.unavailable) fail(1, s.message);
if (!s.ok) {
  console.error(`make-unit-pack: the sensitive-text check found ${s.total} thing${s.total === 1 ? "" : "s"} that do not belong in a study deck. Nothing was written.`);
  for (const f of s.findings) console.error("  - " + P.describeFinding(f));
  if (s.truncated) console.error(`  ... and ${s.total - s.findings.length} more.`);
  console.error("Reword or remove them, then run this again. (The check is a prevention aid, not a clearance: you are still responsible for what is in the deck.)");
  process.exit(2);
}

const sum = P.summarize(pack);
const text = JSON.stringify(pack, null, 2) + "\n";
console.log(`deck    ${sum.name}${sum.unit ? " (" + sum.unit + ")" : ""}`);
console.log(`id      ${sum.id}    version ${sum.packVersion}    date ${sum.packDate}`);
console.log(`cards   ${sum.cards} in ${sum.categories.length} categor${sum.categories.length === 1 ? "y" : "ies"}: ${sum.categories.map((c) => c.name + " (" + c.count + ")").join(", ")}`);
console.log(`sources ${sum.withSource} of ${sum.cards} cards cite a source`);
if (sum.reciteTitles.length) console.log(`titles  ${sum.reciteTitles.join(", ")} (titles only - no words to recite)`);
console.log(`size    ${(P.utf8Bytes(text) / 1024).toFixed(1)} KB of ${P.LIMITS.bytes / 1024} KB`);
for (const w of warnings) console.log("note    " + w);
if (flags.check) { console.log("check   ok - nothing written (--check)"); process.exit(0); }
const out = path.resolve(flags.out || inputPath.replace(/\.(csv|json)$/i, "") + ".pack.json");
if (out === inputPath) fail(1, "the output file would overwrite the input. Choose another with --out.");
writeFileSync(out, text);
console.log("wrote   " + out);
console.log("Next: hand that file to your Soldiers. They add it under Settings -> Study Preferences -> Unit decks. See docs/unit-packs.md.");
