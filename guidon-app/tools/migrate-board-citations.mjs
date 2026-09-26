#!/usr/bin/env node
/**
 * migrate-board-citations: ROADMAP item F Wave 2 - moves the STATIC seed's
 * board.questions[].source from a free-text string to the structured
 * `source: [{ pub, edition, para, quoteKind }]` array, and folds the old
 * `verbatim` boolean into `quoteKind`, WITHOUT re-serialising the seed.
 *
 *   node tools/migrate-board-citations.mjs            # migrate src/index.html in place
 *   node tools/migrate-board-citations.mjs --check    # dry run: report, write nothing
 *   node tools/migrate-board-citations.mjs --path <f> # another copy of index.html
 *
 * HOW (the rules the seed's 5 MB one-line literal imposes):
 *   - The seed is edited as TEXT. A JSON-aware scanner finds each board
 *     question's own "source" (and "verbatim") member by position, and only
 *     those byte ranges are replaced; every other byte of the literal - and of
 *     the other 40,000 lines - is untouched. Nothing is parsed and written back,
 *     so key order, spacing and every unrelated record stay exactly as they were.
 *   - Content packs are NOT touched here. A pack's cards are built at build
 *     time; each pack calls ctx.cite(text, quoteKind) (tools/content-pack-
 *     engine.mjs) and tools/lint-citation-schema.mjs gates the assembled bank.
 *   - The parse is tools/citation-parse.mjs's: conservative, and proven per
 *     entry to render back to the exact original text.
 *
 * quoteKind (the `verbatim` fold - see tools/lint-citation-schema.mjs):
 *   verbatim:false          -> "paraphrase"
 *   verbatim:true / absent  -> "verbatim"   (absent is what every static card
 *                                            carries; the card back has always
 *                                            said "By the Book (verbatim
 *                                            doctrine)" for it, so the mapping
 *                                            keeps that exactly)
 *
 * SAFETY, all checked before a byte is written:
 *   - idempotent: a card whose source is already an array is skipped; a seed
 *     with nothing left to do exits 0 having changed nothing.
 *   - count-checked: every string source is replaced exactly once.
 *   - the new literal still parses, has the same keys everywhere else, and each
 *     migrated card renders back (tools/cite-schema.mjs renderCitation) to its
 *     original text and yields the same regulation ids the old parser did.
 *   - the file is replaced through a temp file + rename (atomic).
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSeed } from "./seed-io.mjs";
import { cite, legacyRegulationsOf, regulationsOfEntries } from "./citation-parse.mjs";
import { renderCitation } from "./cite-schema.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const TARGET = path.resolve(arg("--path") || path.join(HERE, "..", "src", "index.html"));
const CHECK_ONLY = flag("--check");

/* ---------------------------------------------------------------------
   A minimal JSON position scanner: enough to find board.questions[i] and the
   byte range of one member of each.
   --------------------------------------------------------------------- */
function makeScanner(raw) {
  const skipWs = (i) => { while (i < raw.length && " \t\r\n".includes(raw[i])) i++; return i; };
  const skipString = (i) => {
    if (raw[i] !== '"') throw new Error(`expected a string at ${i}`);
    i++;
    while (i < raw.length) { const c = raw[i]; if (c === "\\") i += 2; else if (c === '"') return i + 1; else i++; }
    throw new Error("unterminated string");
  };
  const skipValue = (i) => {
    i = skipWs(i);
    const c = raw[i];
    if (c === '"') return skipString(i);
    if (c === "{" || c === "[") {
      let depth = 0;
      for (; i < raw.length; i++) {
        const d = raw[i];
        if (d === '"') { i = skipString(i) - 1; continue; }
        if (d === "{" || d === "[") depth++;
        else if (d === "}" || d === "]") { depth--; if (depth === 0) return i + 1; }
      }
      throw new Error("unterminated container");
    }
    while (i < raw.length && !",}] \t\r\n".includes(raw[i])) i++;
    return i;
  };
  /** Iterate the members of the object starting at `i` ("{"): cb(key, memberStart, valueStart, valueEnd) -> return true to stop. */
  const eachMember = (i, cb) => {
    if (raw[i] !== "{") throw new Error(`expected an object at ${i}`);
    i = skipWs(i + 1);
    let index = 0;
    while (raw[i] !== "}") {
      const memberStart = i;
      const keyEnd = skipString(i);
      const key = JSON.parse(raw.slice(i, keyEnd));
      i = skipWs(keyEnd); if (raw[i] !== ":") throw new Error(`expected ':' at ${i}`);
      const valueStart = skipWs(i + 1);
      const valueEnd = skipValue(valueStart);
      if (cb(key, memberStart, valueStart, valueEnd, index) === true) return;
      index++;
      i = skipWs(valueEnd);
      if (raw[i] === ",") i = skipWs(i + 1);
    }
  };
  const eachElement = (i, cb) => {
    if (raw[i] !== "[") throw new Error(`expected an array at ${i}`);
    i = skipWs(i + 1);
    let index = 0;
    while (raw[i] !== "]") {
      const end = skipValue(i);
      cb(i, end, index++);
      i = skipWs(end);
      if (raw[i] === ",") i = skipWs(i + 1);
    }
  };
  return { eachMember, eachElement, skipWs };
}

/** One record per board card: where its "source" and "verbatim" members sit in the literal. */
function scanCards(raw) {
  const S = makeScanner(raw);
  let boardStart = -1;
  S.eachMember(S.skipWs(0), (key, _m, vs) => { if (key === "board") { boardStart = vs; return true; } });
  if (boardStart < 0) throw new Error('the seed has no "board" section');
  let qStart = -1;
  S.eachMember(boardStart, (key, _m, vs) => { if (key === "questions") { qStart = vs; return true; } });
  if (qStart < 0) throw new Error('the seed has no "board.questions" array');

  const cards = [];
  S.eachElement(qStart, (start, end) => {
    const card = { id: null, sourceStr: null, sourceIsArray: false, verbatim: undefined, hasVerbatim: false, srcRange: null };
    const members = [];
    S.eachMember(start, (key, memberStart, vs, ve, index) => {
      members.push({ key, memberStart, vs, ve, index });
      if (key === "id") card.id = JSON.parse(raw.slice(vs, ve));
      if (key === "source") {
        if (raw[vs] === '"') card.sourceStr = JSON.parse(raw.slice(vs, ve)); else card.sourceIsArray = true;
        card.srcRange = [vs, ve];
      }
      if (key === "verbatim") { card.hasVerbatim = true; card.verbatim = JSON.parse(raw.slice(vs, ve)); }
    });
    card.members = members;
    cards.push(card);
  });
  return cards;
}

/* ---------------------------------------------------------------------
   Run
   --------------------------------------------------------------------- */
if (!existsSync(TARGET)) { console.error("migrate-board-citations: no such file " + TARGET); process.exit(2); }
const { data: before, raw } = readSeed(TARGET);
const cards = scanCards(raw);
const questions = (before.board && before.board.questions) || [];
if (cards.length !== questions.length) { console.error(`migrate-board-citations: scanner found ${cards.length} cards, JSON.parse found ${questions.length} - refusing`); process.exit(2); }

const todo = cards.filter((c) => c.sourceStr !== null || c.hasVerbatim);
const alreadyArray = cards.filter((c) => c.sourceIsArray).length;
console.log(`migrate-board-citations: ${cards.length} board cards in ${path.relative(process.cwd(), TARGET) || TARGET}: ${cards.length - alreadyArray} with a string source, ${alreadyArray} already structured, ${cards.filter((c) => c.hasVerbatim).length} still carrying a verbatim flag`);
if (!todo.length) { console.log("nothing to migrate (already done) - no change made"); process.exit(0); }

const noSource = cards.filter((c) => c.srcRange === null);
if (noSource.length) { console.error(`migrate-board-citations: ${noSource.length} card(s) have no source at all (${noSource.slice(0, 5).map((c) => c.id).join(", ")}) - refusing; fix the content first`); process.exit(2); }

// Build the byte-range edits (one for each source, one for each verbatim key).
const edits = [];
const report = { migrated: 0, whole: 0, entries: 0, kinds: { verbatim: 0, paraphrase: 0 }, verbatimRemoved: 0 };
for (const c of todo) {
  const q = questions.find((x) => x.id === c.id);
  const kind = c.verbatim === false ? "paraphrase" : "verbatim";
  if (c.sourceStr !== null) {
    const arr = cite(c.sourceStr, kind);
    if (renderCitation(arr) !== c.sourceStr) throw new Error(`card ${c.id}: the structured source does not render back to its original text`);
    if (JSON.stringify(regulationsOfEntries(arr)) !== JSON.stringify(legacyRegulationsOf(c.sourceStr))) throw new Error(`card ${c.id}: regulation ids changed for ${JSON.stringify(c.sourceStr)}`);
    edits.push({ start: c.srcRange[0], end: c.srcRange[1], text: JSON.stringify(arr) });
    report.migrated++; report.entries += arr.length; report.kinds[kind] += 1;
  } else if (c.sourceIsArray && c.hasVerbatim) {
    // Already structured but still carrying the flag: fold it into each entry's kind.
    const arr = q.source.map((e) => (kind === "paraphrase" ? { ...e, quoteKind: "paraphrase" } : e));
    edits.push({ start: c.srcRange[0], end: c.srcRange[1], text: JSON.stringify(arr) });
  }
  if (c.hasVerbatim) {
    // Remove the whole `"verbatim":<bool>` member with ONE neighbouring comma.
    const m = c.members;
    const me = m.find((x) => x.key === "verbatim");
    const isFirst = me.index === 0;
    const next = m[me.index + 1];
    const start = isFirst ? me.memberStart : (() => { let i = me.memberStart - 1; while (raw[i] !== ",") i--; return i; })();
    const end = isFirst && next ? next.memberStart : me.ve;
    edits.push({ start, end, text: "" });
    report.verbatimRemoved++;
  }
}
edits.sort((a, b) => a.start - b.start);
for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i - 1].end) throw new Error("overlapping edits - refusing");

let out = "", cursor = 0;
for (const e of edits) { out += raw.slice(cursor, e.start) + e.text; cursor = e.end; }
out += raw.slice(cursor);

// Verify the new literal before anything is written.
let after;
try { after = JSON.parse(out); } catch (e) { console.error("migrate-board-citations: the migrated literal no longer parses: " + e.message); process.exit(2); }
const aq = after.board.questions;
if (aq.length !== questions.length) throw new Error("card count changed");
for (let i = 0; i < aq.length; i++) {
  const o = questions[i], n = aq[i];
  if (o.id !== n.id) throw new Error("card order changed at " + i);
  const oKeys = Object.keys(o).filter((k) => k !== "source" && k !== "verbatim"), nKeys = Object.keys(n).filter((k) => k !== "source");
  if (JSON.stringify(oKeys) !== JSON.stringify(nKeys)) throw new Error(`card ${o.id}: keys changed`);
  for (const k of oKeys) if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) throw new Error(`card ${o.id}: field ${k} changed`);
  if ("verbatim" in n) throw new Error(`card ${o.id}: verbatim is still there`);
  const oldText = typeof o.source === "string" ? o.source : renderCitation(o.source);
  if (renderCitation(n.source) !== oldText) throw new Error(`card ${o.id}: rendered citation changed`);
}
for (const k of Object.keys(before)) if (k !== "board" && JSON.stringify(before[k]) !== JSON.stringify(after[k])) throw new Error(`section ${k} changed`);
for (const k of Object.keys(before.board)) if (k !== "questions" && JSON.stringify(before.board[k]) !== JSON.stringify(after.board[k])) throw new Error(`board.${k} changed`);
if (report.migrated !== todo.filter((c) => c.sourceStr !== null).length) throw new Error("count check failed");

console.log(`  ${report.migrated} sources structured into ${report.entries} entries (${report.kinds.verbatim} cards verbatim, ${report.kinds.paraphrase} paraphrase); ${report.verbatimRemoved} verbatim flag(s) folded away`);
console.log(`  literal ${raw.length} -> ${out.length} bytes; every other member of every card, and every other section, is byte-identical`);
if (CHECK_ONLY) { console.log("--check: nothing written"); process.exit(0); }

const txt = readFileSync(TARGET, "utf8");
const at = txt.indexOf(raw);
if (at < 0 || txt.indexOf(raw, at + 1) >= 0) { console.error("migrate-board-citations: could not locate the literal exactly once - refusing"); process.exit(2); }
const next = txt.slice(0, at) + out + txt.slice(at + raw.length);
const tmp = `${TARGET}.migrate-${process.pid}.tmp`;
try { writeFileSync(tmp, next, "utf8"); renameSync(tmp, TARGET); } finally { if (existsSync(tmp)) { try { unlinkSync(tmp); } catch { /* best effort */ } } }
// Re-read the file as the build will and confirm.
const reread = readSeed(TARGET).data.board.questions;
if (reread.some((q) => !Array.isArray(q.source) || "verbatim" in q)) throw new Error("post-write verification failed");
console.log(`  wrote ${path.relative(process.cwd(), TARGET) || TARGET}; re-read OK (${reread.length} cards, all structured)`);
