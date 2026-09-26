/**
 * citation-parse: the ONE conservative parser that turns a free-text board
 * citation ("AR 600-9, para 3-9c; DA PAM 600-25") into the structured
 * `source: [{ pub, edition, para, quoteKind }]` array ROADMAP item F defines,
 * and the ONE renderer that turns the array back into the exact same text.
 *
 * WHO CALLS IT (Wave 2, board.questions):
 *   - tools/content-pack-engine.mjs  ctx.cite(text, quoteKind): a content
 *     pack keeps writing a readable string; the assembled bank only ever
 *     holds the array this returns.
 *   - tools/migrate-board-citations.mjs: the one-time, scripted move of the
 *     static seed's 997 cards.
 *   - tools/lint-citation-schema.mjs, tools/test-board-citations.mjs: the
 *     gate and the proof.
 *   The browser has its own two tiny functions (G.board.sourceText /
 *   G.board.regulationsOf in src/index.html): a page cannot import a Node
 *   module, so tools/test-board-citations.mjs runs BOTH over every card in
 *   the assembled bank and fails on any disagreement.
 *
 * THE DESIGN RULE (why an entry can stay whole): zero visible change. The
 * rendered text of a card's `source` must be byte-for-byte the string the
 * card carried before. So the parser only ever produces a split it can
 * render back EXACTLY (it proves that itself, per entry, before trusting
 * it), and anything it cannot classify with confidence stays WHOLE - one
 * entry whose `pub` is the untouched text - rather than risk a manufactured
 * publication, edition or paragraph. Never invent an edition or a paragraph:
 * `edition` and `para` are "" unless the text itself said so in a shape the
 * renderer reproduces.
 *
 * THE SHAPE (one array entry per publication cited; the schema and THE
 * renderer live in tools/cite-schema.mjs, shared with Wave 3):
 *   { pub, edition, para, quoteKind, editionFirst?, sepAfter? }
 *   pub        the publication as written ("AR 600-9", "DA Pam 623-3",
 *              "37 USC 403") or, for a source that is not a publication
 *              ("Creeds", "VA.gov", "Local promotion-board MOI"), that named
 *              source exactly as written.
 *   edition    "" or a real vintage the text gave in parentheses
 *              ("1 Jul 2024", "Mar 2025", "2020").
 *   para       "" or the locator the text gave after a comma ("para 3-9c",
 *              "Ch 2", "MOS 92A"). Only text that opens with a locator word
 *              (para / chapter / table / appendix / ...) is ever a `para`.
 *   quoteKind  verbatim | paraphrase | synthesis (see the lint header for
 *              how the old `verbatim` boolean folds into it).
 *   sepAfter   all but the last entry, presentation only: the literal joiner
 *              that sat between this citation and the next in the original
 *              text when it was not the default "; " (" / " or ", "). It is
 *              what keeps "AR 623-3 / DA PAM 623-3" reading as before.
 *   editionFirst  presentation only, set when an entry has BOTH an edition
 *              and a para: every board citation that carries both wrote the
 *              edition straight after the publication ("AR 710-2 (1 Jul 2024),
 *              paras 4-3 and 6-5"), which is not the schema's default order.
 *
 * RENDER: renderCitation() in tools/cite-schema.mjs - the one renderer.
 *
 * Only tools/cite-schema.mjs is imported. Pure functions, no file or network access.
 */
import { VALID_QUOTE_KIND, renderCitation } from "./cite-schema.mjs";

/* ---------------------------------------------------------------------
   Publication designators. A segment "starts a citation" when it opens with
   one of these. The list is the same allowlist idea Wave 1 used: a segment
   the parser cannot place stays whole.
   --------------------------------------------------------------------- */
const PUB_PREFIX = "DA PAM|DA Pam|USAREC PAM|USAREC Pam|TB MED|AR|FM|ADP|ADRP|ATP|ATTP|TC|TM|STP|TB|SB|GTA|CTA|JP|DoDI|DODI|DoDD|DODD|DoDM|DODM|AFI|MCO|ALARACT|MILPER";
const DESIGNATORS = [
  // AR 600-9, DA PAM 600-25, ATP 6-22.1, ALARACT 100/2025, STP 21-1-SMCT, TB MED 507 ...
  new RegExp("^(?:" + PUB_PREFIX + ")\\s?\\d[\\w.\\-/]*"),
  // 37 USC 403 / 37 USC § 403 / 38 USC Ch. 33 / 10 USC Chapter 47 / 50 U.S.C. § 3937 / 37 USC 356(a)(1) is NOT taken whole
  /^\d+ U\.?S\.?C\.?(?: §? ?\d+| Ch\. \d+| Chapter \d+)?/,
  // 32 CFR 199 / 32 CFR Part 2002 / 38 CFR Part 9
  /^\d+ CFR (?:Part )?\d+/,
  // EO 10631
  /^EO \d{4,}/,
  // UCMJ Art. 86 / UCMJ Article 15 / UCMJ Articles 85-86 / UCMJ
  /^UCMJ(?: (?:Art\.|Articles?) [\dA-Za-z-]+)?/,
  // MRE 313
  /^MRE \d+/,
  // DA Form 3356 / DD Form 2977 / DD 2977
  /^(?:DA|DD)(?: Form)? \d{3,}[\w-]*/,
  // Army Directive 2025-06
  /^Army Directive \d{4}-\d+/,
];
/** Length of the publication designator at the start of `s`, or 0. */
export function designatorLength(s) {
  for (const re of DESIGNATORS) {
    const m = re.exec(s);
    if (m) return m[0].replace(/[.,;]+$/, "").length;
  }
  return 0;
}
/** True when `s` opens with a publication designator. */
export const startsWithDesignator = (s) => designatorLength(s) > 0;

/* A locator: text that names WHERE in a publication ("para 3-9c", "Ch 2",
   "Table 16-1", "MOS 92A"). Only text opening with one of these words is
   ever stored as `para`. */
const LOCATOR = /^(?:paras?|chapters?|chs?|appendix|appendices|appx|tables?|figures?|figs?|sections?|secs?|preface|annex|enclosure|arts?|articles?|step|MOS)\b\.?/i;
/* Wording that marks a source as a note ABOUT the source rather than a
   citation: the whole string stays one entry, never split at its semicolons. */
const PROSE = /pending-source|confidence:|not a (?:publication|numbered)|this pack|this PR\b/i;
/* A real vintage in parentheses: "1 Jul 2024", "Mar 2025", "2020", "2026-03". */
const EDITION = /^(?:(?:\d{1,2} )?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{4}|\d{4}(?:-\d{2}(?:-\d{2})?)?)$/;

/* ---------------------------------------------------------------------
   Regulation ids (Board Drill's "filter by regulation" chips).
   legacyRegulationsOf is a VERBATIM copy of the pre-Wave-2
   G.board.regulationsOf(string) body in src/index.html: the frozen oracle
   the migration is proved against, and the check that a split never hides a
   regulation inside a `para`. regulationsOfEntries is what the new runtime
   derives: the same rules, run on each entry's `pub`, merged in order.
   --------------------------------------------------------------------- */
export function legacyRegulationsOf(source) {
  const src = String(source || "");
  if (!src.trim()) return [];
  const canon = src
    .replace(/\bDA\s*Pam\b/gi, "DA PAM")
    .replace(/\bUSAREC\s*Pam\b/gi, "USAREC PAM")
    .replace(/\bDOD([IDM])\b/g, (m, x) => "DoD" + x)
    .replace(/\bDoD\s*FMR\b/gi, "DoD FMR")
    .replace(/\bExecutive\s+Order\s+(\d+)/gi, "EO $1")
    .replace(/\bManual\s+for\s+Courts-?Martial\b/gi, "MCM")
    .replace(/\bTitle\s+(\d+)\b(?!\s*U)/gi, "$1 USC");
  const PUB = /\b(DA PAM|USAREC PAM|TB MED|AR|FM|ADP|ADRP|ATP|ATTP|TC|TM|STP|TB|SB|GTA|CTA|JP|DoDI|DoDD|DoDM|AFI|MCO|ALARACT|MILPER)\s*(\d[\w.\-/]*)/g;
  const RULES = [
    [PUB, (m) => m[1] + " " + m[2].replace(/[.,;/-]+$/, "")],
    [/\b(\d+)\s*U\.?S\.?C\.?\s*(?:Ch(?:apter)?\.?\s*(\d+)|§?\s*(\d+))?/g, (m) => m[1] + " USC" + (m[2] ? " Ch. " + m[2] : m[3] ? " " + m[3] : "")],
    [/\b(\d+)\s*CFR\s*(?:Part\s*)?(\d+)/g, (m) => m[1] + " CFR " + m[2]],
    [/\bUCMJ(?:[\s,]*Art(?:icles?|\.)?\s*(\d+[a-z]?(?:-\d+)?))?/g, (m) => "UCMJ" + (m[1] ? " Art. " + m[1] : "")],
    [/\bMCM\b/g, () => "MCM"],
    [/\bMRE\s+(\d+)/g, (m) => "MRE " + m[1]],
    [/\bEO\s+(\d{4,})/g, (m) => "EO " + m[1]],
    [/\b(DA|DD)\s*(?:Form\s*)?(\d{3,}[\w-]*)/g, (m) => m[1] + " Form " + m[2]],
    [/\bDoD FMR(?:\s*Vol(?:ume)?\.?\s*([\w]+))?/g, (m) => "DoD FMR" + (m[1] ? " Vol " + m[1] : "")],
    [/\bGeneva\s+Conventions?\b/gi, () => "Geneva Conventions"],
    [/\bHague\s+(?:Conventions?|Regulations?)\b/gi, () => "Hague Regulations"],
    [/\bStafford\s+Act\b/gi, () => "Stafford Act"],
    [/\bPosse\s+Comitatus\s+Act\b/gi, () => "Posse Comitatus Act"],
    [/\bNational\s+Response\s+Framework\b/gi, () => "National Response Framework"],
    [/\bSCRA\b/g, () => "SCRA"],
    [/\bJTR\b/g, () => "JTR"],
    [/\bUSCENTCOM\s+GO-?1\b/gi, () => "USCENTCOM GO-1"],
  ];
  const hits = [];
  for (const [re, fmt] of RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(canon)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      hits.push({ i: m.index, id: fmt(m).replace(/\s+/g, " ").trim() });
    }
  }
  hits.sort((a, b) => a.i - b.i);
  const out = [];
  for (const h of hits) if (h.id && !out.includes(h.id)) out.push(h.id);
  return out;
}

/** The regulation ids a structured source yields: the rules run over each
 *  entry's `pub`, merged in entry order, distinct. */
export function regulationsOfEntries(entries) {
  const out = [];
  for (const e of entries || []) for (const id of legacyRegulationsOf(e && e.pub)) if (!out.includes(id)) out.push(id);
  return out;
}

/* ---------------------------------------------------------------------
   Parse. (Rendering is renderCitation() in tools/cite-schema.mjs: a parse is
   only trusted when that one renderer gives back the exact original text.)
   --------------------------------------------------------------------- */
/** Split `s` at every top-level separator (outside parentheses and quotes):
 *  "; ", " / ", and ", " when a new publication designator follows.
 *  Returns null when the parentheses or quotes do not balance (the caller
 *  then keeps the whole string whole). */
function splitTopLevel(s) {
  const segs = [];
  let depth = 0, inQuote = false, start = 0, sep = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (inQuote) continue;
    if (c === "(") { depth++; continue; }
    if (c === ")") { depth--; if (depth < 0) return null; continue; }
    if (depth > 0) continue;
    let found = "";
    if (s.startsWith("; ", i)) found = "; ";
    else if (s.startsWith(" / ", i)) found = " / ";
    else if (s.startsWith(", ", i) && startsWithDesignator(s.slice(i + 2)) && i > start) found = ", ";
    if (found) {
      segs.push({ text: s.slice(start, i), sep });
      sep = found; start = i + found.length; i += found.length - 1;
    }
  }
  if (depth !== 0 || inQuote) return null;
  segs.push({ text: s.slice(start), sep });
  return segs;
}

/** Parse ONE segment into a structured entry (never throws).
 *  cls: "canonical" (a designator plus, at most, a real edition and locator),
 *       "whole-pub" (opens with a designator but the rest is not a shape the
 *       renderer reproduces - kept whole), "residue" (not a publication). */
function parseSegment(seg) {
  const whole = (cls) => ({ entry: { pub: seg, edition: "", para: "" }, publication: cls === "whole-pub", cls });
  const n = designatorLength(seg);
  if (!n) return whole("residue");
  const pub = seg.slice(0, n);
  let rest = seg.slice(n), edition = "", para = "";
  const paren = /^ \(([^()]+)\)/.exec(rest);
  if (paren && EDITION.test(paren[1])) { edition = paren[1]; rest = rest.slice(paren[0].length); }
  if (rest !== "") {
    if (rest.startsWith(", ") && LOCATOR.test(rest.slice(2))) para = rest.slice(2);
    else return whole("whole-pub");
  }
  const entry = { pub, edition, para };
  // The text wrote the edition straight after the publication, ahead of the
  // locator: say so, or the shared renderer would move it behind the locator.
  if (edition && para) entry.editionFirst = true;
  // Never trade exactness or a regulation chip for structure: the entry must
  // render back to this exact text, and running the regulation rules on the
  // `pub` alone must find every regulation the whole segment names.
  const same = JSON.stringify(legacyRegulationsOf(pub)) === JSON.stringify(legacyRegulationsOf(seg));
  if (renderCitation([entry]) !== seg || !same) return whole("whole-pub");
  return { entry, publication: true, cls: "canonical" };
}

/**
 * parseSource(text) -> { entries: [{pub, edition, para, editionFirst?, sepAfter?}], publication: [bool], cls: [string] }
 *   entries      one per citation, WITHOUT quoteKind (the caller stamps it)
 *   publication  per entry: did it open with a real publication designator?
 *   cls          per entry: "canonical" | "whole-pub" | "residue" (see parseSegment)
 * Guarantee: renderCitation(entries) === text, or the whole text is ONE entry.
 */
export function parseSource(text) {
  const s = String(text == null ? "" : text);
  const keepWhole = () => ({ entries: [{ pub: s, edition: "", para: "" }], publication: [startsWithDesignator(s)], cls: [startsWithDesignator(s) ? "whole-pub" : "residue"] });
  if (!s.trim() || s !== s.trim() || /\s{2,}/.test(s)) return keepWhole();
  // A source that carries its own note ("pending-source: ...", "not a
  // publication", "this pack cites directly") is one self-contained
  // statement - splitting the prose at a semicolon would manufacture entries.
  if (PROSE.test(s)) return keepWhole();
  const segs = splitTopLevel(s);
  if (!segs) return keepWhole();
  // Two joins the parser refuses to treat as a boundary:
  //  - a segment that opens with a locator word is a continuation of the
  //    citation before it ("ADP 6-22, Ch 9 (...); Ch 10 (...)"), not a new one;
  //  - a boundary is only trusted when a real publication designator stands
  //    next to it. Two neighbours that are both non-publications ("Geneva
  //    Conventions / Hague Regulations", "DFAS / myPay") stay ONE entry:
  //    nothing here can tell a compound from a name that merely has a slash.
  const merged = [];
  for (const g of segs) {
    const prev = merged[merged.length - 1];
    const gPub = startsWithDesignator(g.text);
    if (prev && LOCATOR.test(g.text) && !gPub) prev.text += g.sep + g.text;
    else if (prev && !gPub && !startsWithDesignator(prev.text)) prev.text += g.sep + g.text;
    else merged.push({ text: g.text, sep: g.sep });
  }
  const entries = [], publication = [], cls = [];
  merged.forEach((g, i) => {
    if (!g.text) return;
    const r = parseSegment(g.text);
    const e = r.entry;
    // g.sep is what sat IN FRONT of this segment; the schema keeps a non-default
    // joiner on the entry BEFORE it (sepAfter), so it is handed back one step.
    if (i > 0 && g.sep && g.sep !== "; " && entries.length) entries[entries.length - 1].sepAfter = g.sep;
    entries.push(e); publication.push(r.publication); cls.push(r.cls);
  });
  if (!entries.length || renderCitation(entries) !== s) return keepWhole();
  return { entries, publication, cls };
}

/**
 * cite(text, quoteKind) -> the structured array for a board card.
 *   quoteKind is REQUIRED (verbatim | paraphrase | synthesis) - a pack author
 *   must decide whether the card's By-the-Book text is a quotation. Every
 *   entry carries it, except an entry that is not a publication at all
 *   ("unit SOP", "VA.gov") sitting NEXT TO a real publication: that one is
 *   "paraphrase", because a quotation claim is only ever made for a
 *   publication. (A card citing nothing but such sources keeps the card's
 *   own kind, so the heading Soldiers see does not change.)
 */
export function cite(text, quoteKind) {
  if (!VALID_QUOTE_KIND.includes(quoteKind)) throw new Error(`cite(): quoteKind must be one of ${VALID_QUOTE_KIND.join(", ")} (got ${JSON.stringify(quoteKind)}) - decide whether this card's answer is a quotation from the cited publication`);
  const r = parseSource(text);
  if (!r.entries.length || !String(text).trim()) throw new Error("cite(): the source text is empty - every card cites something");
  const anyPub = r.publication.some(Boolean);
  return r.entries.map((e, i) => {
    const kind = quoteKind === "verbatim" && anyPub && !r.publication[i] ? "paraphrase" : quoteKind;
    const out = { pub: e.pub, edition: e.edition, para: e.para, quoteKind: kind };
    if (e.editionFirst) out.editionFirst = true;
    if (e.sepAfter) out.sepAfter = e.sepAfter;
    return out;
  });
}

/** The card-level kind the heading logic reads. "verbatim" when ANY entry is
 *  a verbatim quotation (that is the old `verbatim !== false`); otherwise the
 *  first entry's kind. A plain string (own recite card) is "verbatim", which
 *  is what the UI has always shown for a card without `verbatim:false`. */
export function quoteKindOf(source) {
  if (!Array.isArray(source) || !source.length) return "verbatim";
  if (source.some((e) => e && e.quoteKind === "verbatim")) return "verbatim";
  return (source[0] && source[0].quoteKind) || "paraphrase";
}
