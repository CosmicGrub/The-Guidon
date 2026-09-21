/**
 * Storage-contract lint for GUIDON (ROADMAP 3g item B, 2026-09-19).
 *
 * Two promises the app makes are only true while every feature stores its
 * data the same way:
 *
 *   "A Guest or Kiosk session saves nothing."  True because ONE place - the
 *   db section of src/index.html (G.db and G.db.local) - decides whether a
 *   write reaches the device or stays in memory. A feature that writes to
 *   window.localStorage or opens IndexedDB on its own walks straight past
 *   that decision, and nobody would notice until a guest's data turned up
 *   on someone's phone.
 *
 *   "A backup carries your data to another device."  True for a saved item
 *   only if the restore knows what that item should look like
 *   (KV_VALIDATORS / KV_PREFIX_VALIDATORS in the backup section). The
 *   2026-09 tools shipped without that and were caught by an audit, not by
 *   a build.
 *
 * So this lint fails the build when:
 *
 *   (s1) anything outside the db section WRITES window.localStorage
 *        (setItem / removeItem / clear / an assignment). Reads are fine.
 *        sessionStorage is deliberately allowed: it dies with the tab, and
 *        the Kiosk tour uses it on purpose to survive a reload mid-tour.
 *   (s2) anything outside the db section opens or deletes an IndexedDB
 *        database.
 *   (s3) a saved-item key the source writes has no restore check - neither
 *        an exact KV_VALIDATORS entry nor a KV_PREFIX_VALIDATORS family -
 *        and is not on UNCHECKED below with a written reason. UNCHECKED is a
 *        ratchet: the keys on it predate this lint. A NEW key must get a
 *        real check; and an UNCHECKED entry whose key has since gained a
 *        check, or is no longer written anywhere, must leave the list.
 *
 * Scanned: src/index.html (every line of 20,000 chars or less - the seed,
 * the vendored PDF bundles and the embedded form are each one longer line
 * and hold no app code), src/*.js, src/app-modules/*.js. Comments are
 * stripped first, so NAMING localStorage in a comment is not a use.
 *
 * Known limits, stated rather than pretended away: (s3) reads string
 * literals and UPPER_CASE key constants at the call sites it recognises
 * (setSetting("..."), put("kv", { k: ... }), putMany rows, "prefix:" + id).
 * A key assembled some other way is not seen - add a recognised form or a
 * row here, never a second list somewhere else.
 *
 * `--src <dir>` points the whole scan at another copy of src/ so the
 * verifier can be verified (tools/test-storage-contract-lint.mjs plants one
 * defect per rule in a temp copy and expects each to be named).
 * No dependencies; run from anywhere (paths resolve from this file).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const SRC = path.resolve(argOf("--src") || path.join(APP, "src"));
const MAX_LINE = 20000;
const DB_BEGIN = "/* ==== js/db.js ==== */";
const DB_END = "/* ==== js/store.js ==== */";
const BACKUP_BEGIN = "/* ==== js/backup.js ==== */";

/* Saved-item keys that are written today with NO restore check, and why that
   is acceptable for each. Every one is a single flag, date or number whose
   reader already tolerates any value - nothing a damaged backup could use to
   break a screen. A key holding a list or an object a screen walks through
   does not belong here: give it a real check instead. */
const UNCHECKED = {
  "legacyStorageMigration:v1": "one true/false flag; read with a truthiness test only",
  "backup:lastExportAt": "one date string; the reader handles an unreadable date as 'never backed up'",
  "guidon:whatsnew:v1": "{ lastSeenVersion }; the reader treats anything unreadable as 'no record' and shows nothing",
  "boardQuiz:timedMode": "one true/false preference",
  "rapidFire:seenExplainer": "one true/false flag",
  "rapidFire:savedDecks": "predates this lint - Rapid Fire's saved decks; needs a real check (tracked in the storage report)",
  "writing:drafts:v1": "predates this lint - Writing drafts; needs a real check (tracked in the storage report)",
  "guidon:moi:legacyMigrated:v1": "one true/false flag; read with a truthiness test only (marks the one-time guidon:moi:plan:v1 -> guidon:moi:plans:v1 migration done, MOI Import Phase 1)",
};

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const rel = (p) => path.relative(SRC, p).split(path.sep).join("/");

/* Strip comments but keep line numbers and string contents. Good enough for
   this codebase's style; a "//" inside a string or regex can swallow the
   rest of its line (fewer detections, never more). */
function stripComments(text) {
  let out = "", i = 0, mode = "code", quote = "";
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "/" && n === "/" && text[i - 1] !== ":" && text[i - 1] !== "\\") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { mode = "str"; quote = c; }
      out += c; i++; continue;
    }
    if (mode === "str") {
      if (c === "\\") { out += c + (n || ""); i += 2; continue; }
      if (c === quote || (c === "\n" && quote !== "`")) mode = "code";
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } else out += " "; i++; continue; }
    if (c === "*" && n === "/") { mode = "code"; out += "  "; i += 2; continue; }
    out += c === "\n" ? "\n" : " "; i++;
  }
  return out;
}

async function sources() {
  const files = [];
  const index = path.join(SRC, "index.html");
  files.push(index);
  for (const dir of [SRC, path.join(SRC, "app-modules")]) {
    let names = [];
    try { names = await readdir(dir); } catch (e) { names = []; }
    names.filter((n) => n.endsWith(".js")).sort().forEach((n) => files.push(path.join(dir, n)));
  }
  const out = [];
  for (const f of files) {
    const raw = await readFile(f, "utf8");
    // Long lines are data (the seed, vendored bundles): blank them, keep numbering.
    const kept = raw.split("\n").map((l) => (l.length > MAX_LINE ? "" : l)).join("\n");
    out.push({ file: f, name: rel(f), raw: kept, code: stripComments(kept) });
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

const all = await sources();
const index = all.find((s) => s.name === "index.html");
const dbStart = index.raw.indexOf(DB_BEGIN), dbEnd = index.raw.indexOf(DB_END);
if (dbStart === -1 || dbEnd === -1 || dbEnd < dbStart) {
  bad("could not find the db section in index.html (" + DB_BEGIN + " ... " + DB_END + ") - the contract has no home to check");
}
const inDbSection = (s, i) => s === index && i >= dbStart && i < dbEnd;

/* ------------------------------------------------------------------ s1/s2 */
const WRITES = [
  { rule: "(s1)", re: /\blocalStorage\s*\.\s*(setItem|removeItem|clear)\s*\(/g, what: (m) => "localStorage." + m[1] + "()" },
  { rule: "(s1)", re: /\blocalStorage\s*(\[[^\]]+\]|\.\s*(?!getItem\b|key\b|length\b|setItem\b|removeItem\b|clear\b)[A-Za-z_$][\w$]*)\s*=(?!=)/g, what: () => "an assignment to localStorage" },
  { rule: "(s2)", re: /\bindexedDB\s*\.\s*(open|deleteDatabase)\s*\(/g, what: (m) => "indexedDB." + m[1] + "()" },
];
const found = { "(s1)": [], "(s2)": [] };
for (const s of all) {
  for (const w of WRITES) {
    w.re.lastIndex = 0;
    let m;
    while ((m = w.re.exec(s.code))) {
      if (inDbSection(s, m.index)) continue;
      found[w.rule].push(s.name + ":" + lineOf(s.code, m.index) + " " + w.what(m));
    }
  }
}
found["(s1)"].length
  ? found["(s1)"].forEach((f) => bad("(s1) " + f + " - write through G.db.local so a Guest or Kiosk session saves nothing (src/index.html, db section)"))
  : ok("(s1) nothing outside the db section writes window.localStorage (" + all.length + " files scanned)");
found["(s2)"].length
  ? found["(s2)"].forEach((f) => bad("(s2) " + f + " - only the db section may open or delete the database; use G.db"))
  : ok("(s2) nothing outside the db section opens or deletes an IndexedDB database");

/* --------------------------------------------------------------------- s3 */
// The restore checks that exist, read from the backup section itself.
const backupStart = index.code.indexOf(BACKUP_BEGIN) !== -1 ? index.code.indexOf(BACKUP_BEGIN) : index.raw.indexOf(BACKUP_BEGIN);
const backupText = index.code.slice(backupStart, backupStart + 40000);
const exact = new Set(), families = [];
{
  const table = backupText.slice(backupText.indexOf("KV_VALIDATORS = {"), backupText.indexOf("KV_PREFIX_VALIDATORS"));
  let m; const re = /^\s*(["'])([^"'\n]+)\1\s*:\s*function/gm;
  while ((m = re.exec(table))) exact.add(m[2]);
  const fam = backupText.slice(backupText.indexOf("KV_PREFIX_VALIDATORS = ["));
  const re2 = /\{\s*prefix:\s*(["'])([^"'\n]+)\1/g;
  // The list ends at the first line that is only "];" - a "];" INSIDE a
  // check's own body (var counts = [...];) must not end it early.
  const famEnd = fam.search(/\n\s*\];/);
  while ((m = re2.exec(famEnd === -1 ? fam : fam.slice(0, famEnd)))) families.push(m[2]);
}
if (!exact.size || !families.length) bad("(s3) could not read KV_VALIDATORS / KV_PREFIX_VALIDATORS from the backup section");
// The profile row has its own, stricter check inside importAll().
exact.add("guidon:profile:v1");

// Keys the source writes.
const written = new Map(); // key -> "file:line"
const note = (key, s, i) => { if (!written.has(key)) written.set(key, s.name + ":" + lineOf(s.code, i)); };
const looksLikeKey = (k) => /^[A-Za-z][\w.-]*(:[\w.-]+)*:?$/.test(k) && k.length <= 60;
for (const s of all) {
  // Constants: const KEY = "team:training:v1"  (nearest earlier declaration wins at a use site)
  const consts = [];
  { let m; const re = /\b(?:const|var|let)\s+([A-Z][A-Z0-9_]*)\s*=\s*(["'])([^"'\n]+)\2/g; while ((m = re.exec(s.code))) consts.push({ name: m[1], value: m[3], at: m.index }); }
  const resolve = (name, at) => { let hit = null; for (const c of consts) if (c.name === name && c.at < at) hit = c; return hit ? hit.value : null; };
  // A key built by a small helper is a FAMILY, recorded by its prefix:
  //   function srsKey(id) { return "srs:" + id; }      repsKey(d) { ...; return "board:reps:" + ...; }
  // The prefix itself is sometimes a separately declared constant rather than
  // an inline literal - quizBestKey() (Board Quiz's per-category/level best
  // score) is exactly this shape:
  //   const QUIZ_BEST_PREFIX = "boardQuiz:best:";
  //   function quizBestKey(cat, lvl) { return QUIZ_BEST_PREFIX + cat + ...; }
  // The inline-literal-only version of this regex never matched that helper,
  // so quizBestKey()'s write site was invisible to (s3) - not flagged as
  // unchecked, but not confirmed checked either. A verifier that silently
  // stops watching a real, actively-written key family is worse than one
  // that never watched it: removing boardQuiz:best:'s real KV_PREFIX_VALIDATORS
  // entry passed this lint with zero complaint (tools/test-storage-contract-lint.mjs
  // plants exactly that defect and expects it named).
  const helpers = {};
  {
    let h; const reH = /\b(?:function\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{[^{}]{0,200}?return\s+(?:(["'])([A-Za-z][\w.-]*(?::[\w.-]+)*:)\2|([A-Z][A-Z0-9_]*))\s*\+/g;
    while ((h = reH.exec(s.code))) {
      if (helpers[h[1]]) continue;
      if (h[3]) { helpers[h[1]] = h[3]; continue; }
      if (h[4]) { const c = resolve(h[4], h.index); if (c && c.endsWith(":")) helpers[h[1]] = c; }
    }
  }
  // The key a write names, from the expression in the key position.
  const keyOfExpr = (expr, at) => {
    expr = expr.trim();
    let x;
    if ((x = /^(["'])([^"'\n]+)\1\s*\+/.exec(expr))) return x[2].endsWith(":") ? x[2] : null; // "srs:" + id
    if ((x = /^(["'])([^"'\n]+)\1$/.exec(expr))) return x[2];                                  // "streak:v1"
    if ((x = /^([A-Z][A-Z0-9_]*)$/.exec(expr))) return resolve(x[1], at);                       // KEY
    if ((x = /^(?:[\w$]+\s*\.\s*)*([A-Za-z_$][\w$]*)\s*\(/.exec(expr)) && helpers[x[1]]) return helpers[x[1]]; // srsKey(id), G.board.repsKey()
    // A local that was just given its key:  const key = G.board.repsKey();  ...  setSetting(key, rec)
    if ((x = /^([a-z_$][\w$]*)$/.exec(expr))) {
      const before = s.code.slice(Math.max(0, at - 1500), at);
      const decl = new RegExp("(?:const|let|var)\\s+" + x[1].replace(/\$/g, "\\$") + "\\s*=\\s*([^;\\n]+);", "g");
      let d, last = null;
      while ((d = decl.exec(before))) last = d[1];
      if (last && !/^[a-z_$][\w$]*$/.test(last.trim())) return keyOfExpr(last, at);
    }
    return null;
  };
  let m;
  // G.db.setSetting(KEY, ...) / db.setSetting(...) / this.setSetting(...) inside the db object itself.
  // NOT store.setSetting("theme", ...): that edits one field of the single "settings" item.
  // (getSetting is a read and creates nothing.)
  const reSet = /(?:\bG\s*\.\s*db|\bdb|\bthis)\s*\.\s*setSetting\s*\(\s*([^,()]+(?:\([^()]*\))?)\s*,/g;
  while ((m = reSet.exec(s.code))) { const k = keyOfExpr(m[1], m.index); if (k && looksLikeKey(k)) note(k, s, m.index); }
  // put("kv", { k: <expr>, ... })
  const rePut = /\.\s*put\s*\(\s*(["'])kv\1\s*,\s*\{\s*k\s*:\s*([^,{}]+?)\s*,/g;
  while ((m = rePut.exec(s.code))) { const k = keyOfExpr(m[2], m.index); if (k && looksLikeKey(k)) note(k, s, m.index); }
  // putMany("kv", [ {k: <expr>, ...}, {k: <expr>, ...}, ... ]) - a bulk write
  // (backup restore, a seeded batch) is a supported, commonly used path, and
  // its rows go through backup export exactly like a single put() row does,
  // so a key introduced only through putMany needs the same (s3) coverage.
  // findArrayEnd walks bracket depth (masked code, so a "]"/"[" inside a
  // string or comment was already blanked) to the array literal's real
  // closing bracket, so a key expression that itself contains "]" (an
  // indexed lookup) cannot end the scan early.
  const findArrayEnd = (code, openIdx) => {
    let depth = 0;
    for (let i = openIdx; i < code.length; i++) {
      if (code[i] === "[") depth++;
      else if (code[i] === "]") { depth--; if (depth === 0) return i; }
    }
    return code.length;
  };
  const rePutMany = /\.\s*putMany\s*\(\s*(["'])kv\1\s*,\s*(\[)/g;
  while ((m = rePutMany.exec(s.code))) {
    const openIdx = m.index + m[0].length - 1;
    const end = findArrayEnd(s.code, openIdx);
    const body = s.code.slice(openIdx, end);
    const reRow = /\{\s*k\s*:\s*([^,{}]+?)\s*,/g;
    let rm;
    while ((rm = reRow.exec(body))) { const k = keyOfExpr(rm[1], openIdx + rm.index); if (k && looksLikeKey(k)) note(k, s, openIdx + rm.index); }
  }
}
const covered = (k) => exact.has(k) || families.some((p) => k.indexOf(p) === 0 || (k.endsWith(":") && p === k));
// `--list`: print every saved-item key the scan saw, where, and how it is
// checked - the same list a module manifest's storageKeys must agree with.
if (process.argv.includes("--list")) {
  Array.from(written.keys()).sort().forEach((k) => console.log("  " + k.padEnd(34) + written.get(k).padEnd(44) + (covered(k) ? "checked" : Object.prototype.hasOwnProperty.call(UNCHECKED, k) ? "no check (listed)" : "NO CHECK")));
}
const unchecked = [];
for (const [k, where] of written) {
  if (s3Skip(k)) continue;
  if (covered(k)) continue;
  if (Object.prototype.hasOwnProperty.call(UNCHECKED, k)) continue;
  unchecked.push(k + " (" + where + ")");
}
function s3Skip(k) { return k === "settings" ? false : /^seed:/.test(k); } // seed:* rows live in the "meta" store (cached built-in content), never in a backup
unchecked.length
  ? unchecked.forEach((u) => bad("(s3) saved item " + u + " has no restore check - add it to KV_VALIDATORS (or a KV_PREFIX_VALIDATORS family) in the backup section with a real shape check, so it survives a backup and a damaged copy is refused"))
  : ok("(s3) every saved item the source writes has a restore check (" + written.size + " keys/families seen; " + exact.size + " exact checks, " + families.length + " families, " + Object.keys(UNCHECKED).length + " on the named no-check list)");
const stale = Object.keys(UNCHECKED).filter((k) => covered(k) || !written.has(k));
stale.length
  ? stale.forEach((k) => bad("(s3) UNCHECKED lists \"" + k + "\" but " + (covered(k) ? "it has a restore check now" : "nothing writes it any more") + " - delete that line from tools/lint-storage-contract.mjs"))
  : ok("(s3) the no-check list is current: every key on it is still written and still unchecked");

console.log(fails ? "\nLINT-STORAGE-CONTRACT: " + fails + " FAILURE(S)" : "\nLINT-STORAGE-CONTRACT: all passed");
process.exit(fails ? 1 : 0);
