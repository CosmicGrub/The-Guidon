/**
 * The "What's new" data file, and the rules its copy has to follow, as code.
 *
 * WHERE THE ENTRIES LIVE. Every release entry is one object in the "entries"
 * list of src/data/whats-new.json - { version, date, title, highlights[] } and,
 * only for a number that was prepared but never cut, "released": false.
 * tools/build.mjs reads that ONE file and writes it into
 * G.whatsNew.RELEASE_NOTES in dist/guidon-standalone.html and web/ (and so in
 * every fork that loads them). Until the ROADMAP's data-driven item, every
 * release added a small src/app-modules/99-release-vNNNN.js that pushed an
 * entry onto the array, plus a manifest.json line, and these tools read
 * entries back OUT OF SOURCE TEXT with regular expressions. Reading a JSON
 * file instead removes that whole class of "the parser and the code
 * disagreed" problem: what the build inlines, what lint-patterns check (h)
 * judges and what lint-release-state check (d) counts are the same parsed
 * objects.
 *
 * This module is the ONE reader: shape checks (a malformed file must fail the
 * build, not render half a panel), the plain-language copy rules, the
 * "the current version must have an entry" rule, and the literal the build
 * pastes into the page.
 *
 * WHY THE COPY RULES EXIST. The plain-language rule for the in-app release
 * notes was a comment above G.whatsNew.RELEASE_NOTES, and nothing checked it.
 * The 1.10.1, 1.11.0 and 1.12.0 entries all broke it: "first-class iOS project
 * ... same app bundle", "packaged from one tagged source across web/PWA ...",
 * "without creating a second scenario engine", "canonical ... unauthored
 * drills", "deterministic ... MOI-aware". That panel is the one piece of
 * release writing every Soldier is shown at launch. tools/lint-patterns.mjs
 * check (h) now runs these rules on every entry in the data file.
 *
 * The list is words that only make sense to someone building the app, plus
 * claims about how or where the app was packaged (a Soldier cannot act on
 * those, and twice they were not even true). It is matched against titles
 * and highlights ONLY - never the file's "$doc" - so the file can still
 * explain itself. "Board Simulator" is a feature name and is fine; Apple's
 * "iOS Simulator" is not something a Soldier has.
 */
import { readFileSync, existsSync } from "node:fs";

/** The data file, relative to guidon-app/ (the folder every tool runs from). */
export const WHATS_NEW_FILE = "src/data/whats-new.json";
/** The same file as the repo-relative path a person would type or click. */
export const WHATS_NEW_REPO_PATH = "guidon-app/" + WHATS_NEW_FILE;
/** The one placeholder in src/index.html that the build replaces with the entries. */
export const WHATS_NEW_ANCHOR = "RELEASE_NOTES: /*@@WHATS_NEW_ENTRIES@@*/ [],";
/** The only fields an entry may carry. */
export const ENTRY_FIELDS = ["version", "released", "date", "title", "highlights"];
/** The only top-level keys of the file: notes for the person editing it, and the entries. */
export const FILE_KEYS = ["$doc", "entries"];

/** [pattern, what to say instead]. Case-insensitive unless the pattern says otherwise. */
export const BANNED = [
  [/\bengines?\b/i, "say what the Soldier can do, not what runs it"],
  [/\btaxonom(y|ies)\b/i, "say \"study areas\" or name them"],
  [/\bcanonical\b/i, null], [/\bpersistent\b/i, "say it is saved / remembered"], [/\bdeterministic\b/i, null],
  [/\bunauthored\b/i, null], [/\bparity\b/i, "say it works the same on ..."], [/\bforks?\b/i, "name the device: Android, Windows, iPhone"],
  [/\bregressions?\b/i, null], [/\bmodules?\b/i, null], [/\bshims?\b/i, null], [/\bSRS\b/, "say \"review schedule\""],
  [/\bre-?renders?\b/i, null], [/\bPR ?#?\d+/, null], [/#\d{2,}\b/, null], [/\bcodebase\b/i, null], [/\brefactor/i, null],
  [/\bAPIs?\b/, null], [/\bCI\b/, null], [/\bworkflows?\b/i, null], [/\bpipelines?\b/i, null], [/\bschemas?\b/i, null],
  [/\bbundles?\b/i, null], [/\bbinar(y|ies)\b/i, null], [/\brender evidence\b/i, null], [/\bfirst-class\b/i, null],
  [/\biOS Simulator\b/i, null], [/\bSimulator (failures?|evidence|package)\b/i, null], [/\bMOI-aware\b/i, null],
  [/\boffline progression\b/i, null], [/\bCapacitor\b/i, null], [/\bTauri\b/i, null], [/\bWebView\b/i, null], [/\bIndexedDB\b/i, null],
  [/\bPWA\b/, "say \"the web version\""], [/\bstandalone\b/i, null], [/\bESP32\b/i, "say \"the flashcard handheld\""],
  // Packaging / distribution claims: not a Soldier's concern, and false twice.
  [/\bpackaged\b/i, "do not describe how the app is packaged"], [/\btagged\b/i, "do not describe how the app is released"],
  [/\bacross all\b/i, null], [/\brelease lane\b/i, null], [/\bverification\b/i, "say what was checked, in plain words"],
];

/** The panel says what changed, never which release: "1.16.0" or "v1.16.0" never appears in a title or highlight. */
export const VERSION_IN_TEXT = /\bv?\d+\.\d+\.\d+\b/;

/** Bullets longer than this stop being a highlight. Applies from LENGTH_RULE_SINCE on. */
export const MAX_HIGHLIGHT_CHARS = 240;
/** Entries older than this were already shown to everyone and are left as written. */
export const LENGTH_RULE_SINCE = "1.10.0";

const VERSION = /^\d+\.\d+\.\d+$/;
const cmp = (a, b) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]; };
const isText = (v) => typeof v === "string" && v.trim().length > 0;
const show = (v) => (v === undefined ? "missing" : JSON.stringify(v).slice(0, 40));
const clip = (s) => (s.length > 90 ? s.slice(0, 87) + "..." : s);

/**
 * The text of the data file -> { raw, problems }. `raw` is the "entries" list
 * exactly as written (the build pastes it into the page unchanged, so what a
 * Soldier's app holds is what this file says); `problems` is empty when the
 * file is well formed. Checks shape only - the wording rules are checkCopy().
 */
export function parseWhatsNewText(text, label = WHATS_NEW_FILE) {
  const problems = [];
  let doc;
  try { doc = JSON.parse(String(text).charCodeAt(0) === 0xFEFF ? String(text).slice(1) : String(text)); }
  catch (e) { return { raw: [], problems: [`${label} is not valid JSON (${e.message})`] }; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { raw: [], problems: [`${label} must be an object with an "entries" list`] };
  for (const k of Object.keys(doc)) if (!FILE_KEYS.includes(k)) problems.push(`${label} has an unknown top-level key "${k}" - the only keys are ${FILE_KEYS.map((x) => `"${x}"`).join(" and ")}`);
  if (!Array.isArray(doc.entries)) return { raw: [], problems: [...problems, `${label} needs an "entries" list`] };
  if (!doc.entries.length) problems.push(`${label} has no entries - a Soldier would never be shown anything`);
  doc.entries.forEach((e, i) => {
    const where = `${label} entry ${i + 1}${e && typeof e === "object" && isText(e.version) ? ` (${e.version})` : ""}`;
    if (!e || typeof e !== "object" || Array.isArray(e)) { problems.push(`${where} must be an object`); return; }
    for (const k of Object.keys(e)) if (!ENTRY_FIELDS.includes(k)) problems.push(`${where} has an unknown field "${k}" - an entry has only ${ENTRY_FIELDS.join(", ")}`);
    if (typeof e.version !== "string" || !VERSION.test(e.version)) problems.push(`${where}: "version" must be x.y.z like "1.16.0" (found ${show(e.version)})`);
    if (!isText(e.date)) problems.push(`${where}: "date" must be text like "September 2026" (found ${show(e.date)})`);
    if (!isText(e.title)) problems.push(`${where}: "title" must be text (found ${show(e.title)})`);
    if (e.released !== undefined && e.released !== false) problems.push(`${where}: "released" may only be false (a number that was prepared but never cut) - leave it out for a real release (found ${show(e.released)})`);
    if (!Array.isArray(e.highlights) || !e.highlights.length) problems.push(`${where}: "highlights" must be a list with at least one line - an empty list shows a Soldier an empty panel`);
    else e.highlights.forEach((h, j) => { if (!isText(h)) problems.push(`${where}: highlight ${j + 1} must be non-empty text (found ${show(h)})`); });
  });
  return { raw: doc.entries, problems };
}

/** Reads the data file from disk -> { raw, entries, problems }. A missing file is a problem, never a throw. */
export function readWhatsNewFile(file = WHATS_NEW_FILE, label = file) {
  if (!existsSync(file)) return { raw: [], entries: [], problems: [`${label} is missing - every What's New entry lives there`] };
  const { raw, problems } = parseWhatsNewText(readFileSync(file, "utf8"), label);
  return { raw, entries: toEntries(raw), problems };
}

/** Raw entries -> [{ version, date, title, highlights[], unreleased }] in file order (what every checker below reads). */
export function toEntries(raw) {
  return (Array.isArray(raw) ? raw : []).filter((e) => e && typeof e === "object").map((e) => ({
    version: typeof e.version === "string" ? e.version : "",
    date: typeof e.date === "string" ? e.date : "",
    title: typeof e.title === "string" ? e.title : "",
    unreleased: e.released === false,
    highlights: Array.isArray(e.highlights) ? e.highlights.filter((h) => typeof h === "string") : [],
  }));
}

/** The highest version among the entries (numbers, not text, so 1.12.10 beats 1.12.2), or null. */
export function newestVersion(entries) {
  const vs = entries.map((e) => e.version).filter((v) => VERSION.test(v));
  return vs.length ? vs.reduce((a, b) => (cmp(a, b) >= 0 ? a : b)) : null;
}

/**
 * The rule "the current version must have an entry". `where` is the path a
 * person would open to fix it. -> [string] problems; empty means the entry is
 * there and says something.
 */
export function checkCurrent(entries, version, where = WHATS_NEW_REPO_PATH) {
  const mine = entries.filter((e) => e.version === version);
  if (!mine.length) {
    const newest = newestVersion(entries);
    return [`What's New has no entry for the current version ${version} (package.json) - add one to ${where}: { "version": "${version}", "date": "...", "title": "...", "highlights": ["..."] }${newest ? ` (the newest entry there is ${newest})` : ""}. Without it a Soldier who updates to ${version} sees no notes at all.`];
  }
  if (!mine.some((e) => e.highlights.length)) return [`What's New's entry for the current version ${version} has no highlights - a Soldier updating to this release would see an empty "What's new" panel`];
  return [];
}

/**
 * The text the build puts where the placeholder was: the entries as a JS
 * array literal. JSON is a subset of that, so what a Soldier's app holds is
 * exactly what the file says (same fields, same order). `<` is escaped so a
 * highlight can never close the page's own <script>, and the two line
 * separators JSON allows but old script parsers do not are escaped too.
 */
export function whatsNewLiteral(raw) {
  return JSON.stringify(raw).replace(/</g, "\\u003c").split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");
}

/**
 * Everything lint-patterns check (h) judges, as one pure function so a test
 * can plant a defect in each input: `html` is src/index.html's text,
 * `dataText` the data file's text (null when the file is missing), `version`
 * package.json's. -> { problems, passes } (both lists of strings; the caller
 * adds its own "(h) " prefix).
 */
export function lintWhatsNew({ html, dataText, version }) {
  const problems = [], passes = [];
  const declIdx = html.indexOf("G.whatsNew = {");
  const notesIdx = declIdx === -1 ? -1 : html.indexOf("RELEASE_NOTES:", declIdx);
  if (notesIdx === -1) return { problems: ["could not locate G.whatsNew.RELEASE_NOTES in src/index.html"], passes };
  // The build fills exactly one placeholder; anything else typed there would be invisible to every release check.
  if (html.split(WHATS_NEW_ANCHOR).length !== 2 || html.indexOf(WHATS_NEW_ANCHOR) !== notesIdx) {
    return { problems: [`src/index.html's G.whatsNew.RELEASE_NOTES is not the placeholder "${WHATS_NEW_ANCHOR}" - What's New entries live in ${WHATS_NEW_FILE} (the build writes them in); an entry typed here would be invisible to the release checks and the build would refuse to run`], passes };
  }
  if (dataText == null) return { problems: [`${WHATS_NEW_FILE} is missing - every What's New entry lives there`], passes };
  const { raw, problems: shape } = parseWhatsNewText(dataText);
  if (shape.length) return { problems: shape, passes };
  const entries = toEntries(raw);
  const copy = checkCopy(entries);
  problems.push(...copy);
  if (!copy.length) passes.push(`all ${entries.length} What's New entries are in plain language (no builder's terms, no packaging claims, no version numbers, highlights within length)`);
  const current = checkCurrent(entries, version);
  problems.push(...current);
  if (!current.length) passes.push(`${WHATS_NEW_FILE} has a real entry for the current version (${version}, ${entries.length} total entries, ${entries.filter((e) => e.version === version).reduce((n, e) => n + e.highlights.length, 0)} highlight(s) for this one)`);
  return { problems, passes };
}

/** -> [string] problems; empty means the copy follows the rules. */
export function checkCopy(entries) {
  const problems = [];
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.version)) problems.push(`What's New has two entries for ${e.version}`);
    seen.add(e.version);
    const lines = [["title", e.title], ...e.highlights.map((h, i) => [`highlight ${i + 1}`, h])];
    for (const [where, s] of lines) {
      for (const [re, instead] of BANNED) {
        const m = re.exec(s);
        if (m) problems.push(`What's New ${e.version} ${where} says "${m[0]}" - that is builder's language, not a Soldier's${instead ? ` (${instead})` : ""}: "${clip(s)}"`);
      }
      const vn = VERSION_IN_TEXT.exec(s);
      if (vn) problems.push(`What's New ${e.version} ${where} names a version number ("${vn[0]}") - the panel says what changed, never which release: "${clip(s)}"`);
      if (where !== "title" && VERSION.test(e.version) && cmp(e.version, LENGTH_RULE_SINCE) >= 0 && s.length > MAX_HIGHLIGHT_CHARS) problems.push(`What's New ${e.version} ${where} is ${s.length} characters (max ${MAX_HIGHLIGHT_CHARS}) - split it or cut it`);
    }
  }
  return problems;
}
