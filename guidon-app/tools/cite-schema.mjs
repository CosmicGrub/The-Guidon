/**
 * cite-schema: the ONE Node-side definition of GUIDON's structured citation
 * shape (ROADMAP.md item F) - what a citation entry is, how one is turned
 * back into the text a Soldier reads, which seed records carry Wave 3
 * citations, and how a legacy free-text citation string is parsed.
 *
 * WHY A SHARED FILE: three different tools need the same facts and used to
 * be at risk of each keeping its own copy - tools/lint-citation-schema.mjs
 * (the CI gate), tools/migrate-citations-wave3.mjs (the one-time, re-runnable
 * seed migration) and tools/test-section-citations.mjs (the suite that proves
 * the page renders what the data says). The page itself has its own twin of
 * renderCitation() - G.util.citeText in src/index.html, which cannot import a
 * Node module - and test-section-citations.mjs asserts, in the real page,
 * that the two agree on every record.
 *
 * THE SHAPE (unchanged from Wave 1, plus two optional punctuation keys):
 *
 *   source: [ { pub, edition, para, quoteKind, sepAfter?, paraSep? }, ... ]
 *
 *   pub        the publication (or, for text this parser could not confidently
 *              classify, the whole original wording - see parseLegacyCitation)
 *   edition    "2019", "15 Apr 2026" ... ("" = not stated; never guessed)
 *   para       where in the publication ("para 4-6b", "Ch 6" ...; "" = not stated)
 *   quoteKind  "verbatim" | "paraphrase" | "synthesis"
 *
 *   sepAfter   OPTIONAL. The text between this entry and the NEXT one when a
 *              record cites more than one publication. Default "; ". Present
 *              only where the original wording used something else (" / ",
 *              " · ") so migrating a record does not change a single character
 *              a Soldier sees. New content never needs it.
 *   paraSep    OPTIONAL. The text between pub and para. Default ", ". Same
 *              reason (the original said "AR 600-20 Ch.7", no comma).
 *
 * A record with no citation simply has no `source` key (an empty array is a
 * lint failure - "no source" and "a source with nothing in it" must not both
 * be spellable).
 */

export const VALID_QUOTE_KIND = ["verbatim", "paraphrase", "synthesis"];
export const DEFAULT_SEP_AFTER = "; ";
export const DEFAULT_PARA_SEP = ", ";

/** The text a Soldier reads for a `source` value. Twin of G.util.citeText in
 *  src/index.html - keep the two in step (test-section-citations.mjs checks). */
export function renderCitation(source) {
  if (typeof source === "string") return source; // defensive: a hand-built legacy string renders as itself
  if (!Array.isArray(source)) return "";
  let out = "";
  source.forEach((e, i) => {
    if (!e || typeof e !== "object") return;
    let t = String(e.pub == null ? "" : e.pub);
    if (e.para) t += (typeof e.paraSep === "string" ? e.paraSep : DEFAULT_PARA_SEP) + e.para;
    if (e.edition) t += " (" + e.edition + ")";
    out += t;
    if (i < source.length - 1) out += (typeof e.sepAfter === "string" ? e.sepAfter : DEFAULT_SEP_AFTER);
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Legacy free text -> structured entries (conservative, allowlist-driven)
 * ------------------------------------------------------------------ */

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
// What may sit in a trailing "(...)" and count as an EDITION. Anything else in
// parentheses ("(Counseling)", "(BRS)", "(TAMMS)") is part of the name.
const EDITION_RX = new RegExp("^(?:\\d{4}(?:[-/]\\d{2,4})?|\\d{1,2} (?:" + MONTHS + ") \\d{4}|(?:" + MONTHS + ") \\d{4}|\\d{4}, Chg \\d+, \\d{4})$");

// A segment is only ever split out as its OWN publication when it starts with
// one of these. The list is deliberately short and literal: a publication
// series prefix followed by a number, a handful of named statutes and
// documents. Everything else stays whole.
const NUMBERED = [
  /^(?:AR|ATP|ADP|ADRP|ATTP|FM|TC|TM|STP|GTA|JP|DA PAM|DA Pam|TRADOC Pam|TRADOC Reg|DoDI|DoDD|DA Form|DD Form) \d[\w.-]*(?:\/[A-Z][A-Za-z]* \d[\w.-]*)?/,
  /^DA \d{4}\b/,
  /^(?:Army Directive|AD) \d{4}-\d+/,
  /^ALARACT \d+\/\d{4}/,
  /^UCMJ Art\. \d+(?:\([a-z]\))?/,
  /^Articles? \d+(?:\([a-z]\))?(?:, \d+)*, UCMJ/,
  /^\d+ (?:U\.S\.C\.|USC|CFR)/,
  /^IRS Notice \d{4}-\d+/,
  /^TSP Bulletin \d+-\d+/,
  /^DOL Employment Workshop \(EW\) 6\.0/,
  /^DOL EW 6\.0/,
];
const NAMED = [/^(?:UCMJ|JTR|DoD FMR|MILPER Msg|National Response Framework|Soldier's Creed|NCO Creed)(?![\w])/];
const DESIGNATORS = NUMBERED.concat(NAMED);
// Anywhere-in-the-text version, only used to choose quoteKind for a whole entry.
const ANYWHERE = /\b(?:AR|ATP|ADP|ADRP|ATTP|FM|TC|TM|STP|GTA|JP|DA PAM|DA Pam|TRADOC Pam|TRADOC Reg|DoDI|DoDD|DA Form|DD Form|Army Directive|ALARACT|UCMJ|IRS Notice|TSP Bulletin) [\dA-Z]|\bUCMJ\b|\b\d+ (?:U\.S\.C\.|USC|CFR)\b/;

const LOCATOR_WORD = "(?:paras?|Ch\\.?|Chapters?|Sections?|App|Appendix|Activity|Figure|Table|Glossary|glossary|Part)";
// A locator never runs into a " — note" (that text stays part of pub, as typed).
const LOC_TAIL = "(?:(?! — ).)*";
const LOC_COMMA = new RegExp("^, (" + LOCATOR_WORD + "\\b" + LOC_TAIL + ")$");
const LOC_SPACE = new RegExp("^ (" + LOCATOR_WORD + "\\b" + LOC_TAIL + "|\\d+-\\d+[a-z]?(?:\\(\\d+\\))?)$");
const LOC_DASH = /^ — (.+)$/;

function designatorAt(text, idx, numberedOnly) {
  const rest = text.slice(idx);
  return (numberedOnly ? NUMBERED : DESIGNATORS).some((rx) => rx.test(rest));
}

/** Split at depth-0 " / ", "; ", " · " and ", " (the comma only before a
 *  NUMBERED publication, so "AR 623-3, paras 2-5, 3-41" is never cut). */
function splitTopLevel(s) {
  const segs = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    for (const sep of [" / ", "; ", " · ", ", "]) {
      if (!s.startsWith(sep, i)) continue;
      if (sep === ", " && !designatorAt(s, i + 2, true)) continue;
      segs.push({ text: s.slice(start, i), sepAfter: sep });
      start = i + sep.length;
      i = start - 1;
      break;
    }
  }
  segs.push({ text: s.slice(start), sepAfter: null });
  return segs;
}

/** One segment -> {pub, edition, para, paraSep?} or null when it does not
 *  start with an allowlisted designator. */
function parseSegment(seg) {
  const m = DESIGNATORS.map((rx) => seg.match(rx)).find(Boolean);
  if (!m) return null;
  const designator = m[0];
  let edition = "";
  let core = seg;
  const em = seg.match(/ \(([^()]*)\)$/);
  if (em && EDITION_RX.test(em[1])) { edition = em[1]; core = seg.slice(0, seg.length - em[0].length); }
  const rest = core.slice(designator.length);
  if (rest === "") return { pub: designator, edition, para: "" };
  let lm;
  if ((lm = rest.match(LOC_COMMA))) return { pub: designator, edition, para: lm[1] };
  if ((lm = rest.match(LOC_SPACE))) return { pub: designator, edition, para: lm[1], paraSep: " " };
  if ((lm = rest.match(LOC_DASH))) return { pub: designator, edition, para: lm[1], paraSep: " — " };
  // Something after the designator that is not a locator (a title, a program
  // name, a qualifier): it stays inside `pub`, exactly as typed.
  return { pub: core, edition, para: "" };
}

function whole(text) {
  return [{ pub: text, edition: "", para: "", quoteKind: ANYWHERE.test(text) ? "paraphrase" : "synthesis" }];
}

/**
 * parseLegacyCitation(text) -> { entries, how }
 *
 *   how "compound"   every segment started with an allowlisted publication
 *                    ("ADP 6-22 / FM 6-22", "AR 600-9; AR 600-8-2") -> one entry each
 *   how "single"     one allowlisted publication (+ optional locator/edition)
 *   how "whole"      anything else: ONE entry whose pub is the entire original
 *                    text, so nothing is guessed or dropped
 *
 * HARD GUARANTEE, checked here rather than trusted: renderCitation(entries)
 * === text. If a parse would not reproduce the original character for
 * character it is thrown away and the whole text is kept as one entry.
 *
 * quoteKind: never "verbatim" (nothing here can verify a quotation against
 * the source text). "paraphrase" for anything that cites a publication;
 * "synthesis" only for whole text that names no publication at all (a
 * program or a framework, e.g. "Army MRT curriculum").
 */
export function parseLegacyCitation(text) {
  if (typeof text !== "string" || text === "") return { entries: [], how: "empty" };
  const segs = splitTopLevel(text);
  const parsed = segs.map((sg) => parseSegment(sg.text));
  let entries = null, how = "whole";
  if (parsed.every(Boolean)) {
    entries = parsed.map((p, i) => {
      const e = { pub: p.pub, edition: p.edition, para: p.para, quoteKind: "paraphrase" };
      if (p.paraSep !== undefined) e.paraSep = p.paraSep;
      if (i < segs.length - 1 && segs[i].sepAfter !== DEFAULT_SEP_AFTER) e.sepAfter = segs[i].sepAfter;
      return e;
    });
    how = segs.length > 1 ? "compound" : "single";
  } else if (segs.length === 1) {
    const one = parseSegment(text);
    if (one) {
      const e = { pub: one.pub, edition: one.edition, para: one.para, quoteKind: "paraphrase" };
      if (one.paraSep !== undefined) e.paraSep = one.paraSep;
      entries = [e];
      how = "single";
    }
  }
  if (!entries || renderCitation(entries) !== text) return { entries: whole(text), how: "whole" };
  return { entries, how };
}

/* ------------------------------------------------------------------ *
 * Which seed records carry a Wave 3 citation
 * ------------------------------------------------------------------ */

const asArr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

/**
 * Every collection Wave 3 migrated. Each has:
 *   id        stable name (lint messages, the migrator's report)
 *   oldField  where the free text used to live
 *   field     where the structured array lives now ("source" everywhere)
 *   owners(data) -> [{ owner, path }]   every record that may carry it
 *
 * `path` is the key path of the OWNER object inside the bank, so the migrator
 * can find its exact text span and lints can name the record.
 */
export const WAVE3 = [
  { id: "curriculum.courses", oldField: "source", field: "source",
    owners: (d) => asArr(d.curriculum && d.curriculum.courses).map((c, i) => ({ owner: c, path: ["curriculum", "courses", i] })) },
  { id: "curriculum.lessons", oldField: "citation", field: "source",
    owners: (d) => asArr(d.curriculum && d.curriculum.courses).flatMap((c, i) => asArr(c && c.lessons).map((l, j) => ({ owner: l, path: ["curriculum", "courses", i, "lessons", j] }))) },
  { id: "counsel.examples", oldField: "ref", field: "source",
    owners: (d) => asArr(d.counsel && d.counsel.examples).map((e, i) => ({ owner: e, path: ["counsel", "examples", i] })) },
  { id: "counsel.skills", oldField: "ref", field: "source",
    owners: (d) => asArr(d.counsel && d.counsel.skills).map((e, i) => ({ owner: e, path: ["counsel", "skills", i] })) },
  { id: "counsel_bullets", oldField: "cite", field: "source",
    owners: (d) => {
      const out = [];
      const by = (d.counsel_bullets && d.counsel_bullets.byCategory) || {};
      Object.keys(by).forEach((cat) => Object.keys(by[cat] || {}).forEach((grp) => asArr(by[cat][grp]).forEach((b, i) => out.push({ owner: b, path: ["counsel_bullets", "byCategory", cat, grp, i] }))));
      return out;
    } },
  { id: "forms.forms", oldField: "reference", field: "source",
    owners: (d) => asArr(d.forms && d.forms.forms).map((f, i) => ({ owner: f, path: ["forms", "forms", i] })) },
  { id: "forms.useCases", oldField: "ref", field: "source",
    owners: (d) => asArr(d.forms && d.forms.forms).flatMap((f, i) => asArr(f && f.useCases).map((u, j) => ({ owner: u, path: ["forms", "forms", i, "useCases", j] }))) },
  { id: "idp.goalTemplates", oldField: "cite", field: "source",
    owners: (d) => asArr(d.idp && d.idp.goalTemplates).map((e, i) => ({ owner: e, path: ["idp", "goalTemplates", i] })) },
  { id: "idp.planner7906", oldField: "cite", field: "source",
    owners: (d) => asArr(d.idp && d.idp.planner7906).map((e, i) => ({ owner: e, path: ["idp", "planner7906", i] })) },
  { id: "idp.selfDevVariations", oldField: "cite", field: "source",
    owners: (d) => asArr(d.idp && d.idp.selfDevVariations).map((e, i) => ({ owner: e, path: ["idp", "selfDevVariations", i] })) },
  { id: "idp.smartFramework", oldField: "cite", field: "source",
    owners: (d) => (d.idp && isObj(d.idp.smartFramework) ? [{ owner: d.idp.smartFramework, path: ["idp", "smartFramework"] }] : []) },
  { id: "resilience.skills", oldField: "ref", field: "source",
    owners: (d) => asArr(d.resilience && d.resilience.skills).map((e, i) => ({ owner: e, path: ["resilience", "skills", i] })) },
  { id: "finance.brs.limits2026", oldField: "cite", field: "source",
    owners: (d) => (d.finance && d.finance.brs && isObj(d.finance.brs.limits2026) ? [{ owner: d.finance.brs.limits2026, path: ["finance", "brs", "limits2026"] }] : []) },
  { id: "finance.salary_negotiation", oldField: "cite", field: "source",
    owners: (d) => {
      const sn = d.finance && d.finance.salary_negotiation;
      if (!isObj(sn)) return [];
      const out = [{ owner: sn, path: ["finance", "salary_negotiation"] }];
      ["job_offer_checklist", "negotiation_planner", "skills_comparison"].forEach((k) => { if (isObj(sn[k])) out.push({ owner: sn[k], path: ["finance", "salary_negotiation", k] }); });
      return out;
    } },
  { id: "transition.federal_hiring", oldField: "cite", field: "source",
    owners: (d) => (d.transition && isObj(d.transition.federal_hiring) ? [{ owner: d.transition.federal_hiring, path: ["transition", "federal_hiring"] }] : []) },
  { id: "writing.resume_example", oldField: "cite", field: "source",
    owners: (d) => (d.writing && isObj(d.writing.resume_example) ? [{ owner: d.writing.resume_example, path: ["writing", "resume_example"] }] : []) },
  // Wave 1 leftover: PRT's per-exercise cadenceOverride kept the OLD
  // {ref, para, asOf} object under the same key name. Nothing reads it, so it
  // never showed, but it was still the old shape (tools/lint-citation-schema
  // only looked at ex.source, not ex.cadenceOverride.source).
  { id: "prt.cadenceOverride", oldField: "source", field: "source", oldShape: "object",
    owners: (d) => asArr(d.prt && d.prt.drills).flatMap((dr, i) => asArr(dr && dr.exercises).flatMap((ex, j) =>
      (ex && isObj(ex.cadenceOverride) && ex.cadenceOverride.source !== undefined ? [{ owner: ex.cadenceOverride, path: ["prt", "drills", i, "exercises", j, "cadenceOverride"] }] : []))) },
];
