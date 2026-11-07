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
 * sentence it sits in shows a status change OF THE PUBLICATION ("ATP 4-02.11,
 * which superseded TC 4-02.1 in March 2026" is fine; "Per TC 4-02.1: ..." and a
 * source entry whose `pub` is "TC 4-02.1" are not). Four shapes count, each
 * within MARKER_REACH characters of the designator and in the same sentence:
 *   1. a strict publication-status word - formerly, superseded / supersedes /
 *      superseding, supersession, rescinded, "(retired)";
 *   2. the designator is the subject of a status predicate right after it
 *      ("TC 4-02.1 has been replaced", "TC 4-02.1 is no longer used", "TC 4-02.1
 *      is outdated", "TC 4-02.1, retired in 2026,"), or a status verb or adjective
 *      sits right before it ("replacing TC 4-02.1", "the old TC 4-02.1");
 *   3. a naming phrase ("the older name", "the former designation", "previous
 *      edition");
 *   4. a change word (replaced / replaces / replacing / replacement / renamed /
 *      retired / outdated / obsolete / used to be / no longer current) together
 *      with ANOTHER publication designator (ATP / TC / FM / AR / DA PAM ...) in
 *      that sentence.
 * A bare everyday word never excuses a mention, however close: "prior to",
 * "previous severe bleeding", "replace the dressing", "an older casualty", "a
 * second tourniquet replaces the first", "a wet dressing is replaced with a dry
 * one" and "the strap used to be tightened" are medical prose, and a sentence
 * that teaches from TC 4-02.1 while saying one of them is still a teaching. That one rule
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

/** Strict publication-status words: they are only ever said ABOUT a publication, so one
 *  excuses a mention anywhere within MARKER_REACH characters of it in the same sentence.
 *  Everyday medical and card prose uses "prior to", "previous", "older", "replace the
 *  dressing", "replaces", "replaced with", "renamed", "used to be", "obsolete" and "no
 *  longer" constantly, and any one of those beside a cite used to excuse it ("Per TC
 *  4-02.1 a wet dressing is replaced with a dry one" passed) - none of them is here; the
 *  status shapes below need the word to sit on the publication itself. */
export const MARKED_CHANGE = /(?:\b(?:formerly|supersed(?:e|es|ed|ing)|supersession|rescind(?:ed|s)?)\b|\(retired\))/gi;
/** How far (in characters) a marker may sit from the designator and still be about it. */
export const MARKER_REACH = 60;

/** Status words that describe a publication when they follow its designator directly. */
const STATUS_WORDS = "replaced|retired|outdated|obsolete|withdrawn|renamed|out of date|no longer (?:used|current|in effect|valid|authoritative|the source)";
/** "TC 4-02.1 has been replaced." / "TC 4-02.1 is no longer used;" / "TC 4-02.1, retired in 2026,": the status word
 *  must end the thought ("replaced by", "retired in 2026,") - "replaced items" and "obsolete dressings" do not count. */
const STATUS_AFTER = new RegExp(
  "^[\\s,()\\u2013\\u2014-]*(?:(?:is|was|were|has|have|had|been|being|now|later|since|also|officially|already)\\s+)*(?:" + STATUS_WORDS + ")"
  + "(?=\\s*(?:$|[.,;:)\\u2013\\u2014-]|(?:by|with|in|on|as|since|from|after|before|and|to|ATP|TC|FM|AR|ADP|DA)\\b))", "i");
/** A status verb or adjective directly before the designator: "replacing TC 4-02.1", "the old TC 4-02.1". */
const STATUS_BEFORE = /(?:\b(?:replac(?:es|ed|ing)|retir(?:ed|es|ing)|supersed\w*|rescind\w*|withdr[ae]w\w*)\s+(?:the\s+|its\s+)?|\b(?:old|older|former|previous|prior|earlier|outdated|obsolete|retired|rescinded|superseded|withdrawn)\s+(?:[A-Za-z]+\s+)?)$/i;
/** Naming phrases about a publication: "the older name", "the former designation", "previous edition". */
const NAMING_PHRASE = /\b(?:old|older|former|previous|prior|earlier|original|superseded|retired|outdated)\s+(?:name|designation|designator|title|number|edition|version|manual|publication)\b/gi;
/** Change words that only count when ANOTHER publication designator sits in the same sentence. */
const CHANGE_WORDS = /\b(?:replac(?:es|ed|ing|ement)|renamed|retired|outdated|obsolete|used to be|no longer (?:used|current|in effect|valid|authoritative))\b/gi;
const PUB_DESIGNATOR = /(?<![A-Za-z0-9])(?:ATP|ATTP|TC|FM|AR|DA\s+PAM|ADP|ADRP|TM|STP|JP|DODI|AFI|GTA)\s*\d[\d.‐-―−-]*\d/gi;

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
export function sentenceBounds(text, index, length) {
  const before = text.slice(0, index), after = text.slice(index + length);
  const starts = [...before.matchAll(/[.!?;]\s|\n/g)];
  const from = starts.length ? starts[starts.length - 1].index + starts[starts.length - 1][0].length : 0;
  const m = /[.!?;]\s|\n/.exec(after);
  const to = m ? index + length + m.index + 1 : text.length;
  return { from, to };
}
export function sentenceAround(text, index, length) {
  const { from, to } = sentenceBounds(text, index, length);
  return text.slice(from, to);
}
/** Is this mention (at [index, index+length)) shown to be about the publication's status
 *  change? Same sentence, within MARKER_REACH characters of the designator, in one of the
 *  four shapes the header lists (strict word; status predicate / status word on the
 *  designator; naming phrase; change word beside ANOTHER publication designator). */
export function isMarked(text, index, length) {
  const { from, to } = sentenceBounds(text, index, length);
  const sentence = text.slice(from, to);
  const ds = index - from, de = ds + length;
  const near = (start, end) => (start >= de ? start - de : ds >= end ? ds - end : 0) <= MARKER_REACH;
  // 1. strict publication-status words
  for (const mm of sentence.matchAll(new RegExp(MARKED_CHANGE.source, "gi"))) if (near(mm.index, mm.index + mm[0].length)) return true;
  // 2. the designator is the subject of a status predicate, or a status verb / adjective sits right before it
  if (STATUS_AFTER.test(sentence.slice(de, de + 90))) return true;
  if (STATUS_BEFORE.test(sentence.slice(Math.max(0, ds - 40), ds))) return true;
  // 3. naming phrases
  for (const mm of sentence.matchAll(new RegExp(NAMING_PHRASE.source, "gi"))) if (near(mm.index, mm.index + mm[0].length)) return true;
  // 4. a change word together with ANOTHER publication designator nearby
  const others = [...sentence.matchAll(new RegExp(PUB_DESIGNATOR.source, "gi"))]
    .filter((o) => o.index + o[0].length <= ds || o.index >= de)
    .filter((o) => near(o.index, o.index + o[0].length));
  if (others.length) for (const mm of sentence.matchAll(new RegExp(CHANGE_WORDS.source, "gi"))) if (near(mm.index, mm.index + mm[0].length)) return true;
  return false;
}

/** Every unmarked mention of `designator` in `text`: [{ at, snippet }]. */
export function unmarkedMentions(text, designator) {
  const out = [];
  const re = designatorRegex(designator);
  let m;
  while ((m = re.exec(text))) {
    if (!isMarked(text, m.index, m[0].length)) out.push({ at: m.index, snippet: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 50).replace(/\s+/g, " ") });
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
