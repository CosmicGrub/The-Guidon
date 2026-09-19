/**
 * The rules "What's new" copy has to follow, as code.
 *
 * WHY THIS EXISTS. The plain-language rule for the in-app release notes was
 * a comment above G.whatsNew.RELEASE_NOTES, and nothing checked it. The
 * 1.10.1, 1.11.0 and 1.12.0 entries all broke it: "first-class iOS project
 * ... same app bundle", "packaged from one tagged source across web/PWA ...",
 * "without creating a second scenario engine", "canonical ... unauthored
 * drills", "deterministic ... MOI-aware". That panel is the one piece of
 * release writing every Soldier is shown at launch. tools/lint-patterns.mjs
 * check (h) now runs these rules on every entry, wherever it lives
 * (src/index.html or src/app-modules/99-release-*.js).
 *
 * The list is words that only make sense to someone building the app, plus
 * claims about how or where the app was packaged (a Soldier cannot act on
 * those, and twice they were not even true). It is matched against titles
 * and highlights ONLY - never comments - so an entry's own comment can still
 * explain itself. "Board Simulator" is a feature name and is fine; Apple's
 * "iOS Simulator" is not something a Soldier has.
 */

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

/** Bullets longer than this stop being a highlight. Applies from FIRST_CHECKED_VERSION on. */
export const MAX_HIGHLIGHT_CHARS = 240;
/** Entries older than this were already shown to everyone and are left as written. */
export const LENGTH_RULE_SINCE = "1.10.0";

const cmp = (a, b) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]; };
const unquote = (lit) => { try { return JSON.parse(lit); } catch (e) { return lit.slice(1, -1); } };

function balanced(text, openIdx) {
  let depth = 0, inStr = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
  }
  return null;
}

/** The text between the [ ] of G.whatsNew.RELEASE_NOTES in src/index.html, or null. */
export function extractNotesArray(html) {
  const decl = html.indexOf("G.whatsNew = {");
  const at = decl === -1 ? -1 : html.indexOf("RELEASE_NOTES: [", decl);
  return at === -1 ? null : balanced(html, html.indexOf("[", at));
}

/**
 * Source text (the RELEASE_NOTES array body and/or 99-release-*.js files)
 * -> [{ version, title, highlights[], unreleased }] in source order.
 * Comments are dropped first, so nothing inside one is ever read as copy.
 */
export function parseReleaseNotes(sourceText) {
  const text = String(sourceText).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const hits = [...text.matchAll(/\bversion:\s*"(\d+\.\d+\.\d+)"/g)];
  return hits.map((m, i) => {
    const chunk = text.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : text.length);
    const title = /\btitle:\s*("(?:[^"\\]|\\.)*")/.exec(chunk);
    const hIdx = chunk.indexOf("highlights:");
    const body = hIdx === -1 ? null : balanced(chunk, chunk.indexOf("[", hIdx));
    return { version: m[1], title: title ? unquote(title[1]) : "", unreleased: /\breleased:\s*false\b/.test(chunk),
      highlights: body == null ? [] : (body.match(/"(?:[^"\\]|\\.)*"/g) || []).map(unquote) };
  });
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
        if (m) problems.push(`What's New ${e.version} ${where} says "${m[0]}" - that is builder's language, not a Soldier's${instead ? ` (${instead})` : ""}: "${s.length > 90 ? s.slice(0, 87) + "..." : s}"`);
      }
      if (where !== "title" && cmp(e.version, LENGTH_RULE_SINCE) >= 0 && s.length > MAX_HIGHLIGHT_CHARS) problems.push(`What's New ${e.version} ${where} is ${s.length} characters (max ${MAX_HIGHLIGHT_CHARS}) - split it or cut it`);
    }
  }
  return problems;
}
