/**
 * Superseded-publication gate (audit 2026-10, item 10).
 *
 * WHY THIS EXISTS. A Soldier studying today reads a card headed "By the Book
 * (verbatim doctrine)" whose source says only "TC 4-02.1" - a manual the Army
 * replaced in March 2026 with ATP 4-02.11, a copy of which sits in the app's own
 * Library. 26 board cards, 3 doctrine entries, 1 scenario and a whole 9-lesson
 * curriculum course taught the old designator as current, and nothing could see
 * it: ROADMAP 3g F promised that structured citations would make a
 * superseded-publication check mechanical, and the check was never built.
 *
 * THE ONE TABLE. The list of "this publication was replaced by that one" is
 * MOI_CITATION_ALIASES in src/app-modules/moi-import.js - the table MOI Import
 * already uses to tell a Soldier "Superseded citation". This lint READS THAT
 * TABLE FROM THAT FILE; there is deliberately no second list. Adding a row to
 * it teaches both MOI Import and this gate; renaming or removing a row does too.
 *
 * EVIDENCE, NOT ASSERTION. A row is only ENFORCED here when the bundled
 * Reference Library proves it: the replacing publication's own cover page (the
 * first pages of its text in src/app-modules/library.js, which build-library-data
 * extracts from the real PDF) must say it "supersedes" the old designator. Today
 * that proves TC 4-02.1 -> ATP 4-02.11 ("supersedes TC 4-02.1, dated 21 January
 * 2016") and FM 3-22.9 -> TC 3-22.9 ("supersedes FM 3-22.9, 12 August 2008").
 * A row with no such proof - FM 3-23.35, AR 600-8-1, and FM 6-22 - is listed as
 * "not enforced" and never fails anything: gating a card on a supersession nobody
 * has shown would be inventing a fact. (FM 6-22 is the live example of why: the
 * bundled ADP 6-22 still cites "FM 6-22" as the current leader-development
 * companion manual, so ADP 6-22 did NOT replace it, whatever the MOI table says.)
 *
 * THE RULE. Across the WHOLE assembled bank (tools/assemble-bank.mjs: static
 * seed + every "emit":"build" content pack; every top-level section, not just
 * board / doctrine / scenarios - the curriculum course was the one the first
 * audit missed), no string may name an enforced old designator unless the
 * sentence it sits in marks the change: formerly / supersede(s|d) / replaced /
 * renamed / rescinded / retired / no longer / older / previous / prior ("ATP
 * 4-02.11, which superseded TC 4-02.1 in March 2026" is fine; "Per TC 4-02.1:
 * ..." and a source entry whose `pub` is "TC 4-02.1" are not). That one rule
 * covers the structured citation (source[].pub, scenario doctrine[].pub) and the
 * prose cite at the end of an answer alike, and it is what "a card teaches a
 * superseded publication as verbatim" means: a board card with no quoteKind
 * reads "By the Book" by default, so the gate does not wait for someone to have
 * typed the word verbatim - the failure line says whether the card reads as a
 * quotation.
 *
 * A DESIGNATOR IS WHOLE. "TC 4-02.1" must not fire on "ATP 4-02.1" (Army Medical
 * Logistics, a different manual) or on a longer number ("TC 4-02.11"): the match
 * needs the pub type as a whole word and no digit, dash-digit or .digit after
 * the number.
 *
 * `--seed <path>` and `--modules <dir>` point the bank at a stand-in copy, and
 * `--moi <path>` / `--library <path>` at stand-in copies of the two source files,
 * so the gate can be verified (tools/test-pub-supersession.mjs plants defects
 * that way, including a Library whose cover no longer proves the supersession).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleBank } from "./assemble-bank.mjs";
import { quoteKindOf } from "./citation-parse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
export const MOI_PATH = path.join(APP, "src", "app-modules", "moi-import.js");
export const LIBRARY_PATH = path.join(APP, "src", "app-modules", "library.js");

/** How many leading pages of a Library document count as its "cover" (the
 *  distribution statement - "This publication supersedes ..." - sits on page 1
 *  or 2 of every document; the first 6 leave room for a long front-matter run). */
export const COVER_PAGES = 6;

/** Words that mark a mention as a statement ABOUT the change, not a teaching of
 *  the old publication as current. Matched inside the one sentence. */
export const MARKED_CHANGE = /\b(formerly|supersed(?:e|es|ed|ing)|replac(?:e|es|ed|ing|ement)|renam(?:e|ed|ing)|rescind(?:ed|s)?|retired|no longer|obsolete|older|previous(?:ly)?|prior|used to)\b/i;

/* ---------------------------------------------------------------------
   The table (read from moi-import.js) and the proof (read from library.js)
   --------------------------------------------------------------------- */

/** Pull MOI_CITATION_ALIASES out of moi-import.js's source text. The literal is
 *  plain `"OLD": "NEW",` rows with trailing comments, so it is evaluated as a JS
 *  expression in an empty scope. Throws if it cannot be found or is not a plain
 *  string-to-string table - a renamed constant must fail loudly, never quietly
 *  turn the gate off. */
export function readAliasTable(source) {
  const m = source.match(/const MOI_CITATION_ALIASES = (\{[\s\S]*?\n  \});/);
  if (!m) throw new Error("could not find `const MOI_CITATION_ALIASES = {...};` in the MOI Import module - the gate reads its table from there");
  let table;
  try { table = new Function('"use strict"; return (' + m[1] + ");")(); }
  catch (e) { throw new Error("MOI_CITATION_ALIASES is not a plain literal this gate can read: " + e.message); }
  const rows = Object.entries(table || {});
  if (!rows.length) throw new Error("MOI_CITATION_ALIASES is empty");
  for (const [k, v] of rows) if (typeof k !== "string" || typeof v !== "string" || !k.trim() || !v.trim()) throw new Error("MOI_CITATION_ALIASES has a row that is not a non-empty string pair: " + JSON.stringify([k, v]));
  return table;
}

/** The Library's document list (id, citation, pages[]) out of library.js. */
export function readLibraryDocs(source) {
  const m = source.match(/const DOCS = JSON\.parse\(("(?:[^"\\]|\\.)*")\);/);
  if (!m) throw new Error("could not find `const DOCS = JSON.parse(\"...\");` in the Library module");
  const docs = JSON.parse(JSON.parse(m[1]));
  if (!Array.isArray(docs) || !docs.length) throw new Error("the Library document list is empty");
  return docs;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DASH = "[-\\u2010-\\u2015\\u2212]";

/** A global, case-insensitive RegExp for one designator ("TC 4-02.1"): the pub
 *  type is a whole word, spaces and dashes match any run / dash variety, and the
 *  number must END there (no further digit, dash-digit or .digit). */
export function designatorRegex(designator) {
  const body = designator.trim().split(/\s+/).map((part) => part.split(/[-‐-―−]/).map(escapeRe).join(DASH)).join("\\s+");
  return new RegExp("(?<![A-Za-z0-9])" + body + "(?![0-9]|" + DASH + "[0-9]|\\.[0-9])", "gi");
}

/** Does the replacing publication's cover prove it supersedes `oldKey`? */
export function coverEvidence(docs, oldKey, newKey) {
  const doc = docs.find((d) => String(d.citation || "").toUpperCase() === newKey.toUpperCase());
  if (!doc) return { proven: false, why: newKey + " is not in the bundled Library" };
  const cover = (doc.pages || []).slice(0, COVER_PAGES).join("\n").replace(/\s+/g, " ");
  const old = designatorRegex(oldKey).source;
  // "This publication supersedes TC 4-02.1, dated 21 January 2016." - keep the rest of the sentence (the date) in the quote.
  const hit = new RegExp("supersede[sd]?\\b[^.]{0,260}?" + old + "[^.]{0,80}", "i").exec(cover);
  if (!hit) return { proven: false, why: newKey + "'s cover (first " + COVER_PAGES + " pages of the Library copy) does not say it supersedes " + oldKey, doc };
  return { proven: true, quote: hit[0].slice(0, 200), doc };
}

/** The supersessions this gate enforces, and the ones it does not. */
export function loadSupersessions({ moiPath = MOI_PATH, libraryPath = LIBRARY_PATH } = {}) {
  const table = readAliasTable(readFileSync(moiPath, "utf8"));
  const docs = readLibraryDocs(readFileSync(libraryPath, "utf8"));
  const enforced = [], notEnforced = [];
  for (const [oldKey, newKey] of Object.entries(table)) {
    const ev = coverEvidence(docs, oldKey, newKey);
    (ev.proven ? enforced : notEnforced).push({ oldKey, newKey, quote: ev.quote || null, why: ev.why || null });
  }
  return { table, enforced, notEnforced };
}

/* ---------------------------------------------------------------------
   Scanning the bank
   --------------------------------------------------------------------- */

/** The sentence (or clause run) around a match, bounded by . ! ? ; followed by
 *  whitespace, a newline, or the string's own ends. The "." inside a designator
 *  ("4-02.1") is followed by a digit, not whitespace, so it never splits one. */
export function sentenceAround(text, index, length) {
  const before = text.slice(0, index), after = text.slice(index + length);
  const starts = [...before.matchAll(/[.!?;]\s|\n/g)];
  const from = starts.length ? starts[starts.length - 1].index + starts[starts.length - 1][0].length : 0;
  const m = /[.!?;]\s|\n/.exec(after);
  const to = m ? index + length + m.index + 1 : text.length;
  return text.slice(from, to);
}

/** Every unmarked mention of `designator` in `text`: [{ at, snippet }]. */
export function unmarkedMentions(text, designator) {
  const out = [];
  const re = designatorRegex(designator);
  let m;
  while ((m = re.exec(text))) {
    const sentence = sentenceAround(text, m.index, m[0].length);
    if (!MARKED_CHANGE.test(sentence)) out.push({ at: m.index, snippet: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 50).replace(/\s+/g, " ") });
  }
  return out;
}

/** Walk a value, calling visit(string, pathString, ownerRecord) for every
 *  string. `owner` is the nearest enclosing object that has a string `id`. */
export function walkStrings(value, visit, pathStr = "", owner = null) {
  if (typeof value === "string") { visit(value, pathStr, owner); return; }
  if (Array.isArray(value)) { value.forEach((v, i) => walkStrings(v, visit, pathStr + "[" + i + "]", owner)); return; }
  if (value && typeof value === "object") {
    const here = typeof value.id === "string" ? value : owner;
    for (const k of Object.keys(value)) walkStrings(value[k], visit, pathStr + "." + k, here);
  }
}

/** All violations of the gate in an assembled bank: [{ section, id, pack, path, old, new, snippet, quotation }]. */
export function findViolations(data, enforced) {
  const out = [];
  for (const section of Object.keys(data)) {
    walkStrings(data[section], (text, p, owner) => {
      for (const row of enforced) {
        for (const hit of unmarkedMentions(text, row.oldKey)) {
          out.push({
            section, id: owner ? owner.id : "(no id)", pack: owner && owner.__pack ? owner.__pack : null,
            path: section + p, old: row.oldKey, now: row.newKey, snippet: hit.snippet,
            quotation: !!(owner && Array.isArray(owner.source) && section === "board" && quoteKindOf(owner.source) === "verbatim"),
          });
        }
      }
    }, "");
  }
  return out;
}

/* ---------------------------------------------------------------------
   CLI
   --------------------------------------------------------------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
  let fails = 0;
  const ok = (m) => console.log("  PASS  " + m);
  const bad = (m) => { fails++; console.log("  FAIL  " + m); };
  console.log("lint-pub-supersession: no card teaches a publication the bundled Library proves was replaced\n");

  let sup, data;
  try {
    sup = loadSupersessions({ moiPath: argOf("--moi") ? path.resolve(argOf("--moi")) : MOI_PATH, libraryPath: argOf("--library") ? path.resolve(argOf("--library")) : LIBRARY_PATH });
    const bankOpts = {};
    if (argOf("--seed")) bankOpts.seedPath = path.resolve(argOf("--seed"));
    if (argOf("--modules")) bankOpts.moduleDir = path.resolve(argOf("--modules")) + path.sep;
    data = assembleBank(bankOpts).data;
  } catch (e) {
    bad("could not set the gate up: " + e.message);
    console.log("\nLINT-PUB-SUPERSESSION: " + fails + " FAILURE(S)");
    process.exit(1);
  }

  const total = Object.keys(sup.table).length;
  sup.enforced.length > 0
    ? ok(`${sup.enforced.length} of the ${total} rows in MOI_CITATION_ALIASES are proven by the bundled Library and enforced: ` + sup.enforced.map((r) => `${r.oldKey} -> ${r.newKey}`).join(", "))
    : bad(`none of the ${total} rows in MOI_CITATION_ALIASES is proven by the bundled Library - the gate would enforce nothing`);
  for (const r of sup.notEnforced) console.log(`  NOTE  ${r.oldKey} -> ${r.newKey} is NOT enforced: ${r.why}`);

  const violations = findViolations(data, sup.enforced);
  if (!violations.length) {
    ok("no string anywhere in the assembled bank names an enforced old designator unless its sentence marks the change (" + sup.enforced.map((r) => r.oldKey).join(", ") + ")");
  } else {
    const byRecord = new Map();
    for (const v of violations) { const k = v.section + ":" + v.id + (v.pack ? " [pack " + v.pack + "]" : ""); (byRecord.get(k) || byRecord.set(k, []).get(k)).push(v); }
    for (const [rec, list] of byRecord) {
      const v = list[0];
      bad(`${rec} names ${v.old}, which ${v.now}'s own cover page says it replaced, with no word saying so (${list.length} mention${list.length === 1 ? "" : "s"}${v.quotation ? "; the card reads as a verbatim quotation" : ""}) - first at ${v.path}: "...${v.snippet}..." - cite ${v.now}, or say "formerly"/"superseded" in the same sentence`);
    }
  }
  console.log("\n" + (fails ? "LINT-PUB-SUPERSESSION: " + fails + " FAILURE(S)" : "LINT-PUB-SUPERSESSION: all passed"));
  process.exit(fails ? 1 : 0);
}
