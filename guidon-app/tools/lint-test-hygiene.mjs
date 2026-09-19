/**
 * Test-hygiene ratchet for tools/test-*.mjs.
 *
 * Nearly every CI flake this project has chased has one of a few shapes, and
 * three suites broke in one week on a fourth (audit 2026-09, recommendation
 * C / R38). This lint counts them per file, holds each file to the count in
 * the committed baseline (tools/test-hygiene-baseline.json), and lets the
 * numbers move in ONE direction: down.
 *
 *   (a) sleeps          a `.waitForTimeout(` call - a fixed sleep standing in
 *                       for "the app has finished". Too short on a loaded CI
 *                       runner, wasted time everywhere else.
 *                       Instead: waitForRoute(..., { ready }) / until() /
 *                       clickWhenStable() from tools/testkit.mjs.
 *   (b) swallowed waits a waitFor* / expect(...) chain ending in
 *                       `.catch(() => {})`, or a wait inside `try { } catch
 *                       (e) {}` with an empty catch. The wait fails silently
 *                       and the suite trips three lines later on something
 *                       that looks unrelated.
 *                       Instead: until() - it hands back true/false, and the
 *                       assertion that follows reports the miss itself.
 *   (c) literal counts  a number compared for equality against a card /
 *                       question / scenario / category / doctrine count, or
 *                       used as the bound of a loop that walks one. A content
 *                       change makes it wrong ("17 AFT cards").
 *                       Instead: liveCount(page, { category | kind }).
 *
 * An honest exception is marked on the line itself (or on the line above):
 *     await page.waitForTimeout(400); // hygiene-ok: proving nothing happens needs a fixed window
 * The reason is required (10+ characters) - a bare "hygiene-ok" does not count.
 *
 * Checks (PASS/FAIL lines, exit 1 on any FAIL, style of lint-ci-matrix.mjs):
 *   (1) no file's count of (a), (b) or (c) is ABOVE its baseline;
 *   (2) a test file that is not in the baseline has none at all - new suites
 *       start clean (tools/new-suite.mjs writes them that way);
 *   (3) the baseline describes reality: no row for a file that is gone, and
 *       no count that is higher than the file's real one (when you remove a
 *       sleep, bank it: run --write).
 *
 * `--write` rewrites the baseline, and may only LOWER it: a count that rose,
 * or a new file that has any, is refused - fix the suite instead. `--report`
 * prints every hit (file:line) - the to-do list. `--tools <dir>` and
 * `--baseline <file>` point the lint at stand-in copies so the verifier can
 * be verified (tools/test-hygiene-ratchet.mjs plants each defect and watches it
 * fail). No dependencies; run from anywhere.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const TOOLS = argOf("--tools") ? path.resolve(argOf("--tools")) : HERE;
const BASELINE = argOf("--baseline") ? path.resolve(argOf("--baseline")) : path.join(TOOLS, "test-hygiene-baseline.json");
const WRITE = process.argv.includes("--write");
const REPORT = process.argv.includes("--report");
const RULES = ["sleeps", "swallowedWaits", "literalCounts"];
const LABEL = { sleeps: "(a) fixed sleeps", swallowedWaits: "(b) swallowed waits", literalCounts: "(c) literal deck sizes" };
const FIX = {
  sleeps: "wait for the state instead: waitForRoute(page, hash, { ready }), until(page, fn) or clickWhenStable() from tools/testkit.mjs",
  swallowedWaits: "use until(page, fn) from tools/testkit.mjs - it returns true/false, and the assertion after it reports the miss",
  literalCounts: "read it from the running app: liveCount(page, { category }) or liveCount(page, { kind }) from tools/testkit.mjs",
};

/* ---------------------------------------------------------------------
   mask(): the source with comment, string, template and regex CONTENTS
   blanked to spaces. Offsets and line breaks are preserved, so an index in
   the masked text is the same index in the file, and paren matching cannot
   be thrown by a ")" in a message or an apostrophe in a comment. Template
   `${ }` holes are blanked with the rest of the template: a wait hidden
   inside one is not something these suites do.
   --------------------------------------------------------------------- */
const REGEX_MAY_FOLLOW = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_AFTER_WORD = /(?:^|[^\w$.])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
export function mask(text) {
  let out = "";
  let i = 0;
  const blank = (ch) => (ch === "\n" || ch === "\r" ? ch : " ");
  while (i < text.length) {
    const c = text[i], c2 = text[i + 1];
    if (c === "/" && c2 === "/") { while (i < text.length && text[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && c2 === "*") {
      out += "  "; i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) { out += blank(text[i]); i++; }
      if (i < text.length) { out += "  "; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c; i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\" && i + 1 < text.length) { out += " " + blank(text[i + 1]); i += 2; continue; }
        out += blank(text[i]); i++;
      }
      if (i < text.length) { out += c; i++; }
      continue;
    }
    if (c === "/") {
      const before = out.replace(/\s+$/, "");
      const prev = before[before.length - 1];
      if (prev === undefined || REGEX_MAY_FOLLOW.has(prev) || REGEX_AFTER_WORD.test(before.slice(-12))) {
        // a regex literal: blank through the closing "/" (a "/" inside a
        // [class] or after a backslash does not close it), keep the flags
        let j = i + 1, inClass = false, closed = false;
        while (j < text.length && text[j] !== "\n") {
          if (text[j] === "\\") { j += 2; continue; }
          if (text[j] === "[") inClass = true;
          else if (text[j] === "]") inClass = false;
          else if (text[j] === "/" && !inClass) { closed = true; break; }
          j++;
        }
        if (closed) { out += "/" + " ".repeat(j - i - 1) + "/"; i = j + 1; continue; }
      }
    }
    out += c; i++;
  }
  return out;
}

const lineOf = (text, idx) => { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };

function closeParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/* Walk BACK over one call chain - `a.b(c).d[e]`, optional chaining and line
   breaks before a dot included - and return where it starts. One link is a
   name (or a quoted literal) with any (...) / [...] groups after it; links
   are joined by dots. Anything else - an operator, `await`, the previous
   statement - ends the chain. */
function chainStart(code, end) {
  let i = end;
  while (i > 0 && /\s/.test(code[i - 1])) i--;
  for (;;) {
    let moved = false;
    while (i > 0 && (code[i - 1] === ")" || code[i - 1] === "]")) {
      const closeCh = code[i - 1], openCh = closeCh === ")" ? "(" : "[";
      let depth = 0, j = i - 1;
      for (; j >= 0; j--) { if (code[j] === closeCh) depth++; else if (code[j] === openCh) { depth--; if (depth === 0) break; } }
      if (j < 0) return i;
      i = j; moved = true;
    }
    if (i > 0 && /[\w$]/.test(code[i - 1])) { while (i > 0 && /[\w$]/.test(code[i - 1])) i--; moved = true; }
    else if (i > 0 && (code[i - 1] === '"' || code[i - 1] === "'" || code[i - 1] === "`")) {
      const q = code[i - 1]; let j = i - 2; while (j >= 0 && code[j] !== q) j--;
      if (j < 0) return i;
      i = j; moved = true;
    }
    if (!moved) return i;
    let k = i;
    while (k > 0 && /\s/.test(code[k - 1])) k--;
    if (code[k - 1] !== ".") return i;
    k--; if (code[k - 1] === "?") k--;
    i = k;
    while (i > 0 && /\s/.test(code[i - 1])) i--;
  }
}

const WAIT_CALL = /\.\s*waitFor\w*\s*\(|\bexpect\s*\(/;
const EMPTY_HANDLER = /^\s*(?:async\s+)?(?:\(\s*[\w$]*\s*\)|[\w$]+)\s*=>\s*\{\s*\}\s*$|^\s*(?:async\s+)?function\s*[\w$]*\s*\(\s*[\w$]*\s*\)\s*\{\s*\}\s*$/;

/* (c) What makes a number "a deck size". Two kinds of evidence, either is
   enough; both are about the BANK (questions, scenarios, categories,
   doctrine, a deck/pool), never about any list - `rows.length === 2` after
   the suite added two rows is its own fixture and stays legal.

   1. CODE: the operand compared with the number is named as a bank count -
      boardQuestions().length, category.length, scenarioCount, deckSize ...
      "card" is deliberately NOT a bank word here: in this codebase `.card`
      is a screen tile, and wideCards.length === 9 is a layout fact.
   2. WORDS: the assertion's own message says "<the same number> <bank
      things>" - "all 40 92A prompts are in the bank", "exactly 34
      Cybersecurity & OPSEC questions". A message that says the suite MADE
      the number (seeded, added, typed, dealt ...) or that it is a product
      limit (cap, up to, at most, per round ...) is a fixture, not a deck. */
const BANK_WORD = /questions?|scenarios?|categor(?:y|ies)|doctrine|deck|bank|pool/i;
const COUNT_NAME = /(?:questions?|scenarios?|categor(?:y|ies)|doctrine|deck|bank|pool|(?:^cat|Cat)s?)\w*(?:Count|Total|Size|Len|Num|Length)$|^(?:count|total|size|num)(?:Of)?\w*(?:Question|Scenario|Categor|Deck|Bank|Pool)/;
const LIST_METHOD = /^(?:filter|map|slice|concat|flat|flatMap|sort|reverse|values|keys|entries|from|of)$/;
/* Is this call chain a count of bank things? Works on the chain with its
   (...) and [...] groups removed, so it judges WHAT is being counted:
     window.G.store.boardQuestions().filter((q) => ...).length  -> boardQuestions
     hostDeck.names.length                                      -> names (no)
   A `.length` / `.size` must hang off a bank-named list; otherwise the last
   name itself must read as a count (scenarioCount, deckSize, realCatCount). */
function isBankCount(chain) {
  let flat = "", depth = 0;
  for (const ch of chain) { if (ch === "(" || ch === "[") depth++; else if (ch === ")" || ch === "]") depth--; else if (depth === 0) flat += ch; }
  const names = flat.replace(/\?\./g, ".").split(".").map((s) => s.trim().replace(/^(?:await|new|typeof)\s+/, "")).filter(Boolean);
  if (!names.length) return false;
  const last = names[names.length - 1];
  if (last === "length" || last === "size") {
    let i = names.length - 2;
    while (i >= 0 && LIST_METHOD.test(names[i])) i--;
    if (i < 0) return false;
    // Object.keys(byCategory).length / new Set(questions.map(...)).size: judge the argument
    if (/^(?:Object|Array|Set|Map)$/.test(names[i])) return BANK_WORD.test(chain.slice(chain.indexOf("(")));
    return BANK_WORD.test(names[i]);
  }
  return COUNT_NAME.test(last);
}
/* Plural on purpose (the number is 2 or more, so "2 for QA Test Scenario" is
   not a count of scenarios), and a bare "cards" does not count: "9 cards in
   a three-column grid" is about screen tiles. */
const BANK_NOUN = "(?:questions|prompts|scenarios|categories|flashcards|(?:board|source|drill|study|bank|heritage|MOS)[ -]cards|(?:glossary |required |dictionary )?[\\w/&-]* ?terms)";
const MADE_BY_THE_SUITE = /\b(?:seed(?:ed|s)?|added|adding|created|typed|picked|chose[n]?|ticked|injected|dealt|shown|graded|answered|passed|passing|missed|fixture|cap|capped|up to|at most|at least|maximum|max|limit|per (?:page|round|set|session|chunk)|in the set|of \d+)\b/i;
function saysDeckSize(said, n) {
  const num = String(n).replace(/_/g, "");
  if (!new RegExp("(?<![\\w.])" + num + "(?![\\w.])[^\\n\"'`]{0,40}?\\b" + BANK_NOUN + "\\b", "i").test(said)) return false;
  return !MADE_BY_THE_SUITE.test(said);
}

/* The operand on each side of a comparison, as a call chain: walk back (or
   forward) over names, dots and balanced (...) / [...] groups. A chain that
   is not the WHOLE operand (a + b === 5) simply fails to look like a bank
   count or a bare number, and is left alone. */
function chainEnd(code, from) {
  let i = from;
  while (i < code.length && /[ \t]/.test(code[i])) i++;
  for (;;) {
    const ch = code[i];
    if (ch === "(" || ch === "[") {
      const closeCh = ch === "(" ? ")" : "]";
      let depth = 0, j = i;
      for (; j < code.length; j++) { if (code[j] === ch) depth++; else if (code[j] === closeCh) { depth--; if (depth === 0) break; } }
      if (j >= code.length) return i;
      i = j + 1; continue;
    }
    if (ch && /[\w$.]/.test(ch)) { i++; continue; }
    if (ch === "?" && code[i + 1] === ".") { i += 2; continue; }
    return i;
  }
}
const NUM = /^\s*(\d[\d_]*)\s*$/;
/** Every hit in one file: [{ rule, line, text }]. Exported for the self-test. */
export function scan(source) {
  const src = source.replace(/\r\n/g, "\n");
  const code = mask(src);
  const rawLines = src.split("\n");
  const hits = [];
  const exempt = (line) => {
    const ok = (l) => { const m = /\/\/\s*hygiene-ok:\s*(.*)$/.exec(rawLines[l - 1] || ""); return !!m && m[1].trim().length >= 10; };
    // the line itself, or a comment-only line directly above it
    return ok(line) || (/^\s*\/\//.test(rawLines[line - 2] || "") && ok(line - 1));
  };
  const add = (rule, idx) => { const line = lineOf(code, idx); if (!exempt(line)) hits.push({ rule, line, text: (rawLines[line - 1] || "").trim().slice(0, 160) }); };

  // (a)
  for (const m of code.matchAll(/\.\s*waitForTimeout\s*\(/g)) add("sleeps", m.index);

  // (b) chained: <chain with a wait>.catch(<empty handler>)
  for (const m of code.matchAll(/\.\s*catch\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closeParen(code, open);
    if (close === -1 || !EMPTY_HANDLER.test(code.slice(open + 1, close))) continue;
    const start = chainStart(code, m.index);
    if (WAIT_CALL.test(code.slice(start, m.index))) add("swallowedWaits", m.index);
  }
  // (b) try { ...wait... } catch (e) {}
  for (const m of code.matchAll(/\}\s*catch\s*(?:\(\s*[\w$]*\s*\))?\s*\{\s*\}/g)) {
    let depth = 0, j = m.index;
    for (; j >= 0; j--) { if (code[j] === "}") depth++; else if (code[j] === "{") { depth--; if (depth === 0) break; } }
    if (j < 0 || !/\btry\s*$/.test(code.slice(Math.max(0, j - 8), j))) continue;
    if (WAIT_CALL.test(code.slice(j, m.index))) add("swallowedWaits", m.index);
  }

  // (c) <count> === <number>, either way round. 0 and 1 mean "empty" and
  // "exactly one" - structure, not a deck size - and are never flagged.
  for (const m of code.matchAll(/[=!]==?/g)) {
    const after = m.index + m[0].length;
    const L = code.slice(chainStart(code, m.index), m.index), R = code.slice(after, chainEnd(code, after));
    const nl = NUM.exec(L), nr = NUM.exec(R);
    const n = nr ? nr[1] : nl ? nl[1] : null;
    const other = nr ? L : nl ? R : null;
    if (n === null || Number(n.replace(/_/g, "")) < 2 || !other) continue;
    const line = lineOf(code, m.index);
    // evidence 1: the thing compared is NAMED as a bank count
    // evidence 2: the words of this assertion (its own line and the two that
    //             finish it) say "<the same number> <bank things>"
    let last = line; // ... through the line that ends this statement, two more at most
    while (last < line + 2 && last < rawLines.length && !/;\s*(?:\/\/.*)?$/.test(rawLines[last - 1])) last++;
    const said = rawLines.slice(line - 1, last).join("\n");
    if (isBankCount(other) || saysDeckSize(said, n)) add("literalCounts", m.index);
  }
  // (c) for (...; i < <number>; ...) where the words on the line, or a
  // comment directly above, say the number is a deck:
  //   for (let i = 0; i < 17; i++) await tapPass(); // 17 real AFT questions
  for (const m of code.matchAll(/\bfor\s*\(/g)) {
    const close = closeParen(code, m.index + m[0].length - 1);
    if (close === -1) continue;
    const b = /[<>]=?\s*(\d[\d_]*)\s*;/.exec(code.slice(m.index, close));
    if (!b || Number(b[1].replace(/_/g, "")) < 2) continue;
    const line = lineOf(code, m.index);
    const said = (/^\s*\/\//.test(rawLines[line - 2] || "") ? rawLines[line - 2] + "\n" : "") + (rawLines[line - 1] || "");
    if (saysDeckSize(said, b[1])) add("literalCounts", m.index);
  }
  return hits.sort((x, y) => x.line - y.line);
}

export function countsOf(hits) {
  const c = { sleeps: 0, swallowedWaits: 0, literalCounts: 0 };
  for (const h of hits) c[h.rule]++;
  return c;
}

/* ---------------------------------------------------------------------
   CLI
   --------------------------------------------------------------------- */
// Windows hands out the same path with either drive-letter case (Z:\ / z:\).
const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const isMain = !!process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url));
if (isMain) await main();

async function main() {
  let fails = 0;
  const ok = (m) => console.log("  PASS  " + m);
  const bad = (m) => { fails++; console.log("  FAIL  " + m); };
  console.log("lint-test-hygiene: fixed sleeps, swallowed waits and literal deck sizes in tools/test-*.mjs" + (WRITE ? " (--write)" : "") + "\n");

  const files = (await readdir(TOOLS)).filter((f) => /^test-.*\.mjs$/.test(f)).sort();
  const live = {};
  const allHits = {};
  for (const f of files) {
    const hits = scan(await readFile(path.join(TOOLS, f), "utf-8"));
    allHits[f] = hits;
    const c = countsOf(hits);
    if (c.sleeps || c.swallowedWaits || c.literalCounts) live[f] = c;
  }

  let baseline = {};
  let haveBaseline = true;
  try { baseline = JSON.parse(await readFile(BASELINE, "utf-8")).files || {}; }
  catch (e) { haveBaseline = false; }

  if (REPORT) {
    for (const f of files) for (const h of allHits[f]) console.log(`  ${LABEL[h.rule].slice(0, 3)} tools/${f}:${h.line}  ${h.text}`);
    console.log("");
  }

  const zero = { sleeps: 0, swallowedWaits: 0, literalCounts: 0 };
  const rose = [];   // above baseline, or new file with any
  const stale = [];  // baseline higher than reality / row for a missing file
  for (const f of files) {
    const now = live[f] || zero, was = baseline[f];
    for (const r of RULES) {
      if (!was) { if (now[r]) rose.push({ f, r, now: now[r], was: 0, isNew: true }); }
      else if (now[r] > (was[r] || 0)) rose.push({ f, r, now: now[r], was: was[r] || 0, isNew: false });
      else if (now[r] < (was[r] || 0)) stale.push({ f, r, now: now[r], was: was[r] });
    }
  }
  for (const f of Object.keys(baseline)) if (!files.includes(f)) stale.push({ f, gone: true });

  const firstHit = (f, r) => { const h = (allHits[f] || []).filter((x) => x.rule === r); return h.length ? ` (e.g. line ${h[h.length - 1].line}: ${h[h.length - 1].text})` : ""; };

  if (WRITE) {
    if (!haveBaseline && !process.argv.includes("--init")) {
      bad(`--write: ${path.basename(BASELINE)} does not exist. The first baseline is created once, on purpose, with --write --init.`);
    } else if (rose.length && haveBaseline) {
      for (const x of rose) bad(`--write refused: tools/${x.f} ${LABEL[x.r]} would go UP (${x.was} -> ${x.now})${firstHit(x.f, x.r)}. The baseline only ratchets down - ${FIX[x.r]}.`);
    } else {
      const next = {};
      for (const f of files) if (live[f]) next[f] = live[f];
      const totals = RULES.map((r) => Object.values(next).reduce((a, c) => a + c[r], 0));
      // One line per file, so a branch that cleans up one suite and a branch
      // that cleans up another merge without touching the same line.
      const note = "Generated by: node tools/lint-test-hygiene.mjs --write  (it only ever LOWERS these numbers). Per test file: fixed sleeps (waitForTimeout), waits whose failure is swallowed by an empty catch, and literal deck sizes. A file that is not listed must have none. See tools/lint-test-hygiene.mjs.";
      const rows = Object.keys(next).map((f) => `    ${JSON.stringify(f)}: ${JSON.stringify(next[f]).replace(/([{,:])/g, "$1 ").replace(/}/, " }")}`);
      // (No totals line either: it would be the one line every such branch edits.)
      const body = `{\n  "_note": ${JSON.stringify(note)},\n  "files": {\n${rows.join(",\n")}\n  }\n}\n`;
      JSON.parse(body); // never write a baseline the lint itself could not read back
      await writeFile(BASELINE, body, "utf-8");
      baseline = next; stale.length = 0;
      ok(`--write: ${path.basename(BASELINE)} now holds ${Object.keys(next).length} files (${totals[0]} sleeps, ${totals[1]} swallowed waits, ${totals[2]} literal deck sizes)`);
    }
  } else if (!haveBaseline) {
    bad(`${path.basename(BASELINE)} is missing or is not valid JSON - restore it from git (it is committed)`);
  }

  if (haveBaseline || WRITE) {
    if (!WRITE) {
      const up = rose.filter((x) => !x.isNew), fresh = rose.filter((x) => x.isNew);
      for (const x of up) bad(`(1) tools/${x.f}: ${LABEL[x.r]} rose from ${x.was} to ${x.now}${firstHit(x.f, x.r)} - ${FIX[x.r]}. (Truly unavoidable? Say why on the line: // hygiene-ok: <reason>)`);
      if (!up.length) ok(`(1) no suite is above its baseline (${Object.keys(baseline).length} files carry a baseline)`);
      for (const x of fresh) bad(`(2) tools/${x.f} is a new suite with ${x.now} ${LABEL[x.r]}${firstHit(x.f, x.r)} - new suites start clean: ${FIX[x.r]}.`);
      if (!fresh.length) ok(`(2) every suite outside the baseline is clean (${files.length - Object.keys(baseline).filter((f) => files.includes(f)).length} of ${files.length} files)`);
    }
    for (const x of stale) {
      if (x.gone) bad(`(3) the baseline has a row for tools/${x.f}, which no longer exists - run: node tools/lint-test-hygiene.mjs --write`);
      else bad(`(3) tools/${x.f}: ${LABEL[x.r]} fell from ${x.was} to ${x.now} - bank the improvement so it cannot creep back: node tools/lint-test-hygiene.mjs --write`);
    }
    if (!stale.length && !(WRITE && fails)) {
      const t = RULES.map((r) => Object.values(live).reduce((a, c) => a + c[r], 0));
      ok(`(3) the baseline matches reality: ${t[0]} fixed sleeps, ${t[1]} swallowed waits, ${t[2]} literal deck sizes left across ${files.length} suites`);
    }
  }

  console.log("\n" + (fails ? `LINT-TEST-HYGIENE: ${fails} FAILURE(S)` : "LINT-TEST-HYGIENE: all passed"));
  process.exit(fails ? 1 : 0);
}
