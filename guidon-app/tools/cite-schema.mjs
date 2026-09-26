/**
 * cite-schema: the ONE Node-side definition of GUIDON's structured citation
 * shape (ROADMAP.md item F) - what a citation entry is, how one is turned
 * back into the text a Soldier reads, which seed records carry Wave 3
 * citations, and how a legacy free-text citation string is parsed.
 *
 * WHY A SHARED FILE: every tool that touches a citation needs the same facts
 * and used to be at risk of each keeping its own copy -
 * tools/lint-citation-schema.mjs (the CI gate), tools/citation-parse.mjs
 * (Wave 2's board-card parser, ctx.cite and the regulation ids),
 * tools/migrate-board-citations.mjs and tools/migrate-citations-wave3.mjs
 * (the re-runnable seed migrations) and the two suites that prove the page
 * renders what the data says (tools/test-board-citations.mjs and
 * tools/test-section-citations.mjs). renderCitation() below IS THE ONLY
 * RENDERER ON THE NODE SIDE. The page has one twin of it, G.util.citeText in
 * src/index.html (a page cannot import a Node module); both suites assert, in
 * the real page, that the two agree on every record in the bank.
 * G.board.sourceText is not a third copy - it hands its card's `source` to
 * G.util.citeText.
 *
 * THE SHAPE (Wave 1's four fields, plus three optional PRESENTATION keys):
 *
 *   source: [ { pub, edition, para, quoteKind, editionFirst?, paraSep?, sepAfter? }, ... ]
 *
 *   pub        the publication (or, for text this parser could not confidently
 *              classify, the whole original wording - see parseLegacyCitation)
 *   edition    "2019", "15 Apr 2026" ... ("" = not stated; never guessed)
 *   para       where in the publication ("para 4-6b", "Ch 6" ...; "" = not stated)
 *   quoteKind  "verbatim" | "paraphrase" | "synthesis"
 *
 *   sepAfter     OPTIONAL. The text between this entry and the NEXT one when a
 *                record cites more than one publication. Default "; ". Present
 *                only where the original wording used something else (" / ",
 *                " · ", ", ") so migrating a record does not change a single
 *                character a Soldier sees. New content never needs it.
 *   paraSep      OPTIONAL. The text between pub and para. Default ", ". Same
 *                reason (the original said "AR 600-20 Ch.7", no comma).
 *   editionFirst OPTIONAL, true only. When an entry has BOTH an edition and a
 *                para, the edition normally follows the para ("AR 600-20, Ch 6
 *                (15 Apr 2026)" - the order Wave 1's AAR line has always used).
 *                editionFirst puts it straight after the publication instead
 *                ("AR 710-2 (1 Jul 2024), paras 4-3 and 6-5"), which is how the
 *                board cards that cite both were written. It changes nothing
 *                when only one of the two is present.
 *
 * Board cards (Wave 2) and every Wave 3 collection use this same shape and
 * this same renderer. (An earlier draft of Wave 2 spelled the joiner `sep`,
 * held on the entry AFTER the joiner; it is `sepAfter`, on the entry BEFORE
 * it, so there is exactly one way to write it.)
 *
 * A record with no citation simply has no `source` key (an empty array is a
 * lint failure - "no source" and "a source with nothing in it" must not both
 * be spellable).
 *
 * TWO CONVENTIONS FOR `para` (read this before writing or reading one):
 *   - Wave 1 collections (doctrine.entries, prt.drills, scenarios' doctrine
 *     refs, creeds) store a BARE paragraph number: "3-3", "1-34a", "4-6b".
 *     Their readers add the words themselves ("ATP 7-22.02, para 3-3" on the
 *     PRT screen), and the doctrine card footer prints the bare number.
 *   - Wave 2 (board cards) and Wave 3 (every WAVE3 collection below) store the
 *     WORDED locator exactly as a Soldier reads it: "para 1-49", "Ch 6",
 *     "Table B-1". Zero visible change was the rule for those waves, and
 *     their text already said "para" or "Ch".
 *   The renderer bridges the two so a Wave 1 array handed to it can never
 *   print "ATP 7-22.02, 3-3": a `para` that starts with a digit and whose
 *   entry sets no `paraSep` of its own is a bare number, and is worded
 *   ("ATP 7-22.02, para 3-3"). A worded locator starts with a letter and is
 *   untouched, and so is any entry with a paraSep - which is why this changes
 *   the text of NO existing Wave 2 or Wave 3 record (no such record has a bare
 *   number with the default joiner; test-section-citations.mjs proves it over
 *   the whole bank, and the twin in src/index.html is held to the same rule).
 *   New content in Waves 2 and 3 still writes the worded form.
 *   The single renderer (renderCitation here, G.util.citeText in the page) is
 *   what Waves 2 and 3 read through. Wave 1's own readers (the PRT screen, the
 *   doctrine footer, the creeds card, the scenario AAR line) still format their
 *   citation inline; they were not rewired.
 *
 * `quoteKind` ON THE BOARD, AND HOW "verbatim" GOT THERE. The card-level flag
 * `verbatim` was folded into quoteKind in Wave 2 (see lint-citation-schema.mjs):
 *     verbatim: false  -> "paraphrase"
 *     verbatim absent  -> "verbatim"
 *     verbatim: true   -> "verbatim"  (no card in the bank ever had it)
 *   Of the 1,347 board cards the bank held at that fold, 198 said
 *   verbatim:false (now "paraphrase") and 1,149 had NO flag at all - so those
 *   1,149 read "verbatim" only because the flag was ABSENT, never because
 *   anyone checked the quotation against the publication. The rule kept the
 *   card back reading exactly as it always had; it is NOT a verified-quotation
 *   claim, and a future rights gate or superseded-publication check must not
 *   treat it as one. The one place that default was demonstrably wrong is
 *   fixed: a card marked sourceStatus "pending-source" is now cited
 *   "paraphrase" (its own citation says the wording is unverified), and
 *   lint-citation-schema.mjs check (j) fails any pending source that claims
 *   "verbatim". Promoting a card to a checked verbatim quotation is a content
 *   decision made card by card, never inferred from a missing field.
 */

export const VALID_QUOTE_KIND = ["verbatim", "paraphrase", "synthesis"];
export const DEFAULT_SEP_AFTER = "; ";
export const DEFAULT_PARA_SEP = ", ";
/** The joiners a record actually uses between two publications. The lint holds
 *  `sepAfter` to this list so a typo cannot ship as punctuation. */
export const VALID_SEP_AFTER = ["; ", " / ", " · ", ", "];

/** The joiner plus locator for one entry: ", " + para by default, the entry's
 *  own paraSep when it has one, and "para " added for a bare paragraph number
 *  (see "TWO CONVENTIONS FOR `para`" in this file's header). "" when no para. */
export function paraText(e) {
  if (!e || !e.para) return "";
  const p = String(e.para);
  if (typeof e.paraSep === "string") return e.paraSep + p;
  return DEFAULT_PARA_SEP + (BARE_PARA.test(p) ? "para " : "") + p;
}
/** A `para` that starts with a digit is a bare paragraph number ("3-3"), the Wave 1 convention. */
export const BARE_PARA = /^\d/;

/** The text a Soldier reads for a `source` value. Twin of G.util.citeText in
 *  src/index.html - keep the two in step (test-section-citations.mjs and
 *  test-board-citations.mjs check, over every record in the bank).
 *    entry -> pub + para + " (edition)"     (paraSep, ", " by default, before the para;
 *                                             a bare number gets "para " - see paraText)
 *             pub + " (edition)" + para     when editionFirst
 *    join  -> each entry's sepAfter ("; " unless it says otherwise) */
export function renderCitation(source) {
  if (typeof source === "string") return source; // defensive: a hand-built legacy string renders as itself
  if (!Array.isArray(source)) return "";
  let out = "";
  source.forEach((e, i) => {
    if (!e || typeof e !== "object") return;
    const pub = String(e.pub == null ? "" : e.pub);
    const edition = e.edition ? " (" + e.edition + ")" : "";
    const para = paraText(e);
    out += e.editionFirst === true ? pub + edition + para : pub + para + edition;
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
