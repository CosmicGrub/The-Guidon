/**
 * module-contract: the STATIC half of tools/test-module-contract.mjs - what
 * can be read off the source without running it. Pure functions over a
 * "src" folder (index.html, *.js shell scripts, app-modules/*.js), so the
 * same code reads the real tree or a stand-in copy with a planted defect.
 *
 * Why it exists: when nine branches met for v1.12.1, recite-user-texts.js
 * still called G.opsecGuard.sanitizeInput, which another branch had removed.
 * The call sat inside  if (typeof G.opsecGuard.sanitizeInput === "function")
 * so it SILENTLY stopped refusing text that carried a classification
 * marking. Nothing failed. A guard like that is a promise that the API may
 * be missing; this module finds every such promise so the test can ask the
 * running app whether it is true, and demand a written reason when it is.
 *
 * Everything here works on comment-blanked text (blankComments): this code
 * base explains itself in long comments that name APIs all the time, and a
 * guard quoted in prose is not a guard. The blanker keeps every offset and
 * line break, so file:line in a failure is the real line. It is a small
 * tokenizer, not a parser; test-module-contract.mjs checks it the only way
 * that matters - every blanked script must still compile.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Lines longer than this are data, not code (the 5 MB seed line, vendored
 *  pdf-lib / pdf.js bundles, base64 PDFs, the install QR) and are never
 *  scanned. The longest real code line in src/ is under 1,000 characters. */
export const MAX_CODE_LINE = 4000;
/** The shell scripts tools/build.mjs splices into web/: every *.js directly in
 *  src/, read from the folder rather than from a list kept here (a list is one
 *  more thing to forget when a script is added, and a script nobody scans is a
 *  place a stale guard can hide). Not sw.js: it runs in the service worker,
 *  where window.G does not exist. */
export const NOT_A_PAGE_SCRIPT = ["sw.js"];
export const shellScripts = (srcDir) => (existsSync(srcDir) ? readdirSync(srcDir).filter((f) => f.endsWith(".js") && !NOT_A_PAGE_SCRIPT.includes(f)).sort() : []);

const REGEX_MAY_FOLLOW = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "yield", "await"]);

const isWordChar = (c) => /[A-Za-z0-9_$]/.test(c);

/**
 * One pass over JavaScript, two results, both the same length as the input
 * with every line break kept (so offsets and line numbers stay true):
 *   text - every comment replaced by spaces. Strings survive, so storage keys
 *          and extension-point names can still be read.
 *   code - comments AND the insides of strings, template text and regular
 *          expressions replaced by spaces. What is left is only code, so an
 *          API named inside a message or a pattern is never taken for a
 *          guard, a reference or an assignment.
 */
export function blankSource(src) {
  const n = src.length;
  const text = new Array(n), code = new Array(n);
  let i = 0, prevSig = "", word = ""; // prevSig: last non-space character that was code; word: the identifier it belongs to, if any
  const stack = []; // one entry per open ${ } inside a template literal: its brace depth
  const sp = (c) => (c === "\n" || c === "\r" ? c : " ");
  const keep = () => { text[i] = code[i] = src[i]; i++; };            // code
  const comment = () => { text[i] = code[i] = sp(src[i]); i++; };      // gone from both
  const literal = () => { text[i] = src[i]; code[i] = sp(src[i]); i++; }; // kept as text, gone from code
  const readString = (q) => { keep(); while (i < n && src[i] !== q && src[i] !== "\n") { if (src[i] === "\\" && i + 1 < n) literal(); literal(); } if (i < n) keep(); };
  const readTemplate = () => {
    while (i < n) {
      if (src[i] === "\\" && i + 1 < n) { literal(); literal(); continue; }
      if (src[i] === "`") { keep(); return; }
      if (src[i] === "$" && src[i + 1] === "{") { keep(); keep(); stack.push(0); return; }
      literal();
    }
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") comment(); continue; }
    if (c === "/" && d === "*") { const end = src.indexOf("*/", i + 2); const stop = end < 0 ? n : end + 2; while (i < stop) comment(); continue; }
    if (c === '"' || c === "'") { readString(c); prevSig = c; continue; }
    if (c === "`") { keep(); readTemplate(); prevSig = "`"; continue; }
    if (c === "/") {
      // A "/" starts a regular expression only where an expression may start:
      // after an operator or opening bracket, or after a keyword such as return.
      // After a name, a number, ")" or "]" it is a division.
      if (REGEX_MAY_FOLLOW.has(prevSig) || (isWordChar(prevSig) && REGEX_AFTER_WORD.has(word))) {
        keep(); let inClass = false;
        while (i < n && src[i] !== "\n") {
          if (src[i] === "\\" && i + 1 < n) { literal(); literal(); continue; }
          if (src[i] === "[") inClass = true; else if (src[i] === "]") inClass = false;
          else if (src[i] === "/" && !inClass) break;
          literal();
        }
        if (i < n && src[i] === "/") keep();
        while (i < n && /[a-z]/i.test(src[i])) keep();
        prevSig = "/"; continue;
      }
    }
    if (stack.length) {
      if (c === "{") stack[stack.length - 1]++;
      else if (c === "}") {
        if (stack[stack.length - 1] === 0) { stack.pop(); keep(); readTemplate(); prevSig = "`"; continue; }
        stack[stack.length - 1]--;
      }
    }
    if (isWordChar(c)) { word = isWordChar(src[i - 1] || "") ? word + c : c; prevSig = c; keep(); continue; }
    if (!/\s/.test(c)) prevSig = c;
    keep();
  }
  return { text: text.join(""), code: code.join("") };
}
/** Comments blanked, strings kept (see blankSource). */
export const blankComments = (src) => blankSource(src).text;

/** index.html with each <script> block put through blankSource. Every offset
 *  and line break is kept. In `text` the markup and the stylesheet are left
 *  exactly as they were; in `code` they are blanked too, because they are not
 *  code: a CSS comment that reads "driven inline by G.theme (--font-head...)"
 *  looked like a CALL of G.theme to a scanner that read the whole file. */
export function blankHtmlScripts(html) {
  const open = /<script\b[^>]*>/g;
  const blocks = [];
  let m;
  while ((m = open.exec(html))) {
    const start = m.index + m[0].length;
    const end = html.indexOf("</script>", start);
    if (end < 0) break;
    blocks.push([start, end]);
    open.lastIndex = end + 9;
  }
  const markup = (s) => s.replace(/[^\n\r]/g, " ");
  let text = "", code = "", at = 0;
  for (const [start, end] of blocks) {
    const b = blankSource(html.slice(start, end));
    text += html.slice(at, start) + b.text; code += markup(html.slice(at, start)) + b.code;
    at = end;
  }
  return { text: text + html.slice(at), code: code + markup(html.slice(at)), blocks };
}

/** Every source file the contract reads: { label, kind, file, raw, text, code, blocks? } (see blankSource for text / code). */
export function readSources(srcDir) {
  const sources = [];
  const norm = (s) => s.replace(/\r\n/g, "\n");
  const indexPath = join(srcDir, "index.html");
  if (existsSync(indexPath)) {
    const raw = norm(readFileSync(indexPath, "utf8"));
    sources.push({ label: "src/index.html", kind: "core", file: "index.html", raw, ...blankHtmlScripts(raw) });
  }
  for (const f of shellScripts(srcDir)) {
    const p = join(srcDir, f);
    if (existsSync(p)) { const raw = norm(readFileSync(p, "utf8")); sources.push({ label: "src/" + f, kind: "shell", file: f, raw, ...blankSource(raw) }); }
  }
  const modDir = join(srcDir, "app-modules");
  if (existsSync(modDir)) {
    for (const f of readdirSync(modDir).filter((x) => x.endsWith(".js")).sort()) {
      const raw = norm(readFileSync(join(modDir, f), "utf8"));
      sources.push({ label: "src/app-modules/" + f, kind: "module", file: f, raw, ...blankSource(raw) });
    }
  }
  return sources;
}

const NAME = String.raw`(?:window\.)?G((?:\.[A-Za-z_$][\w$]*)+)`;
const codeLines = (text) => text.split("\n").map((line, i) => ({ line, no: i + 1 })).filter((l) => l.line.length <= MAX_CODE_LINE);

/**
 * Every GUARDED CALL: a place where the code says "only if this API exists".
 * Shapes (each returns the name of the function that would be called):
 *   typeof      typeof G.a.b === "function"   /  !== "function"  (either order)
 *   and-call    G.a && G.a.b(...)      G.a && G.a.b && G.a.b(...)     G.a && G.a.b ? G.a.b(...) : x
 *   if-call     if (G.a) G.a.b(...)    if (G.a.b) G.a.b(...)
 *   optional    G.a?.b(...)   G.a.b?.(...)
 *   tested      the name is TESTED for existence in one place and CALLED
 *               somewhere else in the same file:
 *                 if (!str || !G.a || !G.a.b) return str;     (early return)
 *                 if (G.a && G.a.b) {   ...next line...   G.a.b(x);   }
 *                 var v = G.a.b ? G.a.b(x) : fallback;
 *               This is how most guards in this code base are actually
 *               written, and it is the v1.12.1 failure exactly: rename
 *               G.opsecGuard.screen and moi-import.js's
 *                 if (!str || !G.opsecGuard || !G.opsecGuard.screen) return str;
 *               hands back text it never checked. "Called somewhere in the
 *               file" is what separates it from a guard on data
 *               (G.a && G.a.value - there is no call to go missing): a name
 *               the file calls has to be a function, so a test of it is a
 *               promise that it may not be there.
 * Not seen: a guard written through an alias (var db = G.db; typeof db.put),
 * a name reached through brackets (G.a["b"]), and guards on data.
 */
export function collectGuards(sources) {
  const guards = [];
  const typeofRe = new RegExp(String.raw`typeof\s+` + NAME + String.raw`\s*[!=]==?\s*["']function["']|["']function["']\s*[!=]==?\s*typeof\s+` + NAME, "g");
  // The right-hand side sits in a lookahead so "G.a && G.a.b && G.a.b.c(" is read as two overlapping pairs.
  const andRe = new RegExp(NAME + String.raw`(?=(\s*&&\s*` + NAME + String.raw`)(?![\w$.]))`, "g");
  const ifRe = new RegExp(String.raw`\bif\s*\(\s*` + NAME + String.raw`\s*\)\s*(?:\{\s*)?` + NAME + String.raw`\s*\(`, "g");
  const optRe = /(?:window\.)?G((?:\??\.[A-Za-z_$][\w$]*)+)\s*(\?\.)?\(/g;
  // "tested": the WHOLE name, as an operand of a truth test - not called, indexed,
  // assigned or chained further (those are uses, not tests).
  const WHOLE = String.raw`(?![\w$.]|\s*[(\[]|\s*=(?!=)|\s*\?\.)`;
  const testedRes = [
    new RegExp(String.raw`!\s*` + NAME + WHOLE, "g"),                     // !G.a.b
    new RegExp(String.raw`&&\s*` + NAME + WHOLE, "g"),                    // x && G.a.b
    new RegExp(String.raw`(?<![\w$.])` + NAME + String.raw`(?![\w$.])\s*(?:&&|\?(?![.?]))`, "g"), // G.a.b && x      G.a.b ? x : y
    new RegExp(String.raw`\bif\s*\(\s*` + NAME + String.raw`\s*\)`, "g"), // if (G.a.b)
  ];
  // A lookbehind, not a consumed character: in G.a(G.b(1)) the "(" before G.b belongs to the first match.
  const callRe = new RegExp(String.raw`(?<![\w$.])` + NAME + String.raw`\s*(?:\?\.\s*)?\(`, "g");
  for (const s of sources) {
    const textLines = s.text.split("\n");
    const lines = codeLines(s.code);
    const called = new Set();
    for (const { line } of lines) if (line.indexOf("G.") >= 0) for (const m of line.matchAll(callRe)) called.add("G" + m[1]);
    for (const { line, no } of lines) {
      if (line.indexOf("G.") < 0 && line.indexOf("G?.") < 0) continue;
      const push = (name, shape) => guards.push({ file: s.label, line: no, name, shape });
      // typeof needs the "function" literal, which only the text variant still has; the
      // typeof keyword itself must be real code (a guard quoted inside a string is not a guard).
      for (const m of textLines[no - 1].matchAll(typeofRe)) { const at = m.index + m[0].indexOf("typeof"); if (line.slice(at, at + 6) === "typeof") push("G" + (m[1] || m[2]), "typeof"); }
      for (const m of line.matchAll(andRe)) {
        const left = "G" + m[1], right = "G" + m[3];
        if (right !== left && !right.startsWith(left + ".")) continue;
        const rest = line.slice(m.index + m[0].length + m[2].length);
        const esc = right.replace(/[.$]/g, "\\$&");
        if (/^\s*\(/.test(rest)) push(right, "and-call");
        else if (new RegExp(String.raw`(?:^|[^\w$.])(?:window\.)?` + esc + String.raw`\s*\(`).test(rest)) push(right, "and-call");
      }
      for (const m of line.matchAll(ifRe)) { const a = "G" + m[1], b = "G" + m[2]; if (b === a || b.startsWith(a + ".")) push(b, "if-call"); }
      for (const m of line.matchAll(optRe)) { if (m[1].includes("?.") || m[2]) push("G" + m[1].replace(/\?\./g, "."), "optional"); }
      // Last, so a guard one of the shapes above already reads keeps that shape's name (one guard per file, line and name).
      for (const re of testedRes) for (const m of line.matchAll(re)) if (called.has("G" + m[1])) push("G" + m[1], "tested");
    }
  }
  // One guard per (file, line, name): "G.a && G.a.b && G.a.b(" is one promise, not two.
  const seen = new Set();
  return guards.filter((g) => { const k = g.file + ":" + g.line + ":" + g.name; if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ---- storage keys a module writes or deletes (static) ---- */
function splitTopLevel(expr, sep) {
  const parts = []; let depth = 0, q = "", cur = "";
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (q) { cur += c; if (c === "\\") { cur += expr[++i] || ""; } else if (c === q) q = ""; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; cur += c; continue; }
    if ("([{".includes(c)) depth++; else if (")]}".includes(c)) depth--;
    if (c === sep && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}
/** The expression starting at `from`: up to a top-level , ; ) ] } or the end of the line. */
function exprAt(text, from) {
  let depth = 0, q = "", i = from;
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = ""; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) break; depth--; }
    else if ((c === "," || c === ";" || c === "\n") && depth === 0) break;
  }
  return text.slice(from, i).trim();
}
/** Resolve a key expression to patterns ("exact" or "prefix*"); null = cannot tell. */
function resolveKeyExpr(expr, text, hops = 0) {
  expr = expr.trim();
  if (hops > 4 || !expr) return null;
  let m;
  if ((m = /^(["'])((?:(?!\1)[^\\\n]|\\.)*)\1$/.exec(expr))) return [m[2]];
  if ((m = /^(["'])((?:(?!\1)[^\\\n]|\\.)*)\1\s*\+/.exec(expr))) return [m[2] + "*"];
  if (/^\[[\s\S]*\]$/.test(expr)) {
    const all = [];
    for (const e of splitTopLevel(expr.slice(1, -1), ",")) { if (!e) continue; const r = resolveKeyExpr(e, text, hops + 1); if (!r) return null; all.push(...r); }
    return all;
  }
  if ((m = /^([A-Za-z_$][\w$]*)$/.exec(expr))) {
    const decl = new RegExp(String.raw`(?:\b(?:var|const|let)\s+|,\s*)` + m[1].replace(/\$/g, "\\$") + String.raw`\s*=\s*`, "g").exec(text);
    if (!decl) return null;
    return resolveKeyExpr(exprAt(text, decl.index + decl[0].length).replace(/;$/, ""), text, hops + 1);
  }
  if ((m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(expr))) {
    const fn = new RegExp(String.raw`function\s+` + m[1].replace(/\$/g, "\\$") + String.raw`\s*\([^)]*\)\s*\{\s*return\s+`, "g").exec(text);
    if (!fn) return null;
    const end = text.indexOf(";", fn.index + fn[0].length);
    return resolveKeyExpr(text.slice(fn.index + fn[0].length, end < 0 ? undefined : end), text, hops + 1);
  }
  return null;
}
/**
 * Writes and deletes a module makes to the on-device store, by static scan of
 * its own calls:  x.put("kv", { k: KEY ...  x.setSetting(KEY ...
 * localStorage.setItem(KEY ...  x.putMany("kv" ...   and the delete forms
 * x.del("kv", KEY)  x.delMany("kv", KEYS)  localStorage.removeItem(KEY).
 * CANNOT see: a write made for the module by a core API (G.reminders.add,
 * G.store.recordAttempt, G.board.noteExternalResult - those rows are core's),
 * a key assembled from values only known at run time (reported as
 * `unresolved`, which the test treats as a failure so the pattern gets a
 * literal or this scanner gets taught), or a store other than "kv".
 */
export function collectStorage(source) {
  const found = [];
  const forms = [
    ["write", /\.put\(\s*["']kv["']\s*,\s*\{\s*k\s*:\s*/g],
    ["write", /\.setSetting\(\s*/g],
    ["write", /\b(?:localStorage|sessionStorage)\.setItem\(\s*/g],
    ["write-many", /\.putMany\(\s*["']kv["']\s*,\s*/g],
    ["delete", /\.del\(\s*["']kv["']\s*,\s*/g],
    ["delete", /\.delMany\(\s*["']kv["']\s*,\s*/g],
    ["delete", /\b(?:localStorage|sessionStorage)\.removeItem\(\s*/g],
  ];
  const lineOf = (idx) => source.text.slice(0, idx).split("\n").length;
  for (const [op, re] of forms) {
    for (const m of source.text.matchAll(re)) {
      if (source.code.slice(m.index, m.index + 4) !== source.text.slice(m.index, m.index + 4)) continue; // inside a string
      const expr = exprAt(source.text, m.index + m[0].length);
      const keys = op === "write-many" ? null : resolveKeyExpr(expr, source.text);
      found.push({ file: source.label, line: lineOf(m.index), op: op === "write-many" ? "write" : op, expr, keys });
    }
  }
  return found;
}
export const keyCovered = (key, declared) => declared.some((d) => d === key || (d.endsWith("*") && (key.startsWith(d.slice(0, -1)))));

/* ---- assignments onto G (to find patches), references to G names, G.ext use ---- */
export function collectAssignments(source) {
  const out = [];
  const aliases = new Map();
  for (const m of source.code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*(?:window\.)?G\.([A-Za-z_$][\w$]*)\s*[,;]/g)) if (m[1] !== "G") aliases.set(m[1], "G." + m[2]);
  const lineOf = (idx) => source.code.slice(0, idx).split("\n").length;
  for (const m of source.code.matchAll(new RegExp(String.raw`(?:^|[^\w$.])` + NAME + String.raw`\s*=(?![=>])`, "g"))) {
    if (m[1].split(".").length - 1 >= 2) out.push({ file: source.label, line: lineOf(m.index), name: "G" + m[1], via: "G" });
  }
  for (const [alias, target] of aliases) {
    const re = new RegExp(String.raw`(?:^|[^\w$.])` + alias.replace(/\$/g, "\\$") + String.raw`\.([A-Za-z_$][\w$]*)\s*=(?![=>])`, "g");
    for (const m of source.code.matchAll(re)) out.push({ file: source.label, line: lineOf(m.index), name: target + "." + m[1], via: alias });
  }
  return out;
}
export function collectReferences(source) {
  const names = new Set();
  for (const { line } of codeLines(source.code)) for (const m of line.matchAll(new RegExp(NAME, "g"))) names.add("G" + m[1]);
  return [...names];
}
export function collectExtUse(sources) {
  const runs = [], ons = [];
  for (const s of sources) {
    const lineOf = (idx) => s.text.slice(0, idx).split("\n").length;
    for (const m of s.text.matchAll(/\bG\.ext\.(run|on)\(\s*(["'])([^"'\n]+)\2/g)) if (s.code.slice(m.index, m.index + 6) === "G.ext.") (m[1] === "run" ? runs : ons).push({ file: s.label, kind: s.kind, line: lineOf(m.index), name: m[3] });
  }
  return { runs, ons };
}

/** The same fingerprint the page computes for each <script>'s text, so a
 *  running script can be matched to the module file it came from. */
export function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return text.length + ":" + h.toString(16);
}
