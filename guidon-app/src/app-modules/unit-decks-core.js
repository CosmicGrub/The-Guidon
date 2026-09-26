/* GUIDON - Unit decks, the pure half (G.unitPack)
   ROADMAP "Later" / AUDIT-2026-09.md section 6 item M: "per-unit content packs
   ... with My unit as the on-device half".

   WHAT A UNIT DECK IS. A unit (a leader, the S3, an NCOIC) writes a small study
   deck about its OWN unit - standing SOP facts, local policies, unit history,
   local promotion-board study material - and hands it to Soldiers as a file.
   Each Soldier imports it on their own device and studies it next to the
   shipped bank, as an extra deck they can switch off or remove.

   THIS FILE is everything about a deck that does not need a page: the file
   format, its hard limits, the strict closed schema that checks it, the
   sensitive-text screening that can refuse it, the way a unit's free-text
   citation becomes the same structured `source` array the shipped bank uses,
   and the row that is kept on the device. It touches no DOM and no storage, so
   the SAME code runs in the app (unit-decks.js), in the authoring command
   (tools/make-unit-pack.mjs, which loads this file in a node:vm sandbox) and in
   the tests. There is one validator, not a copy per caller.

   WHAT A UNIT DECK IS NOT (each of these is a rule the validator enforces, not
   a hope):
     - DATA ONLY. A closed schema: any key it does not list is refused. No
       code, no HTML fields, no images, no URLs that are fetched. A string that
       happens to contain angle brackets is just text, and every screen draws
       it as a text node (tools/test-unit-decks.mjs proves no innerHTML path).
     - NOT Army doctrine. It never enters the shipped bank, the bank
       fingerprint, the content manifest, the handheld (ESP32) export or a
       Study Room. Its card ids are namespaced ("unit:<deck>:<card>") so review
       history can never collide with a shipped card, and every place a card
       appears says "Unit deck: <name>".
     - GIVES NO PLACE FOR RECITATION TEXT. A song or creed is usually somebody's
       copyrighted work and the project rule is that the app ships none. The
       format has no field for words to recite: a deck may only SUGGEST titles
       ("Unit song", "Unit motto"), which show up as empty "add yours" prompts
       under My unit, where the Soldier types their own. (That closes the
       recitation lane, not a card's own text: a question, answer or key point
       is free text up to its cap, and the author is asked not to put such
       words there. Nothing in the schema can tell a song from a sentence.)
     - NEVER accepts anything the sensitive-text check finds. Import is refused
       as a whole, naming the card and the field, on ANY finding (classification
       markings, CUI banners, SSN / DoD ID numbers, UIC labels, phone numbers,
       email addresses, future-date-place-activity sentences) and on a
       roster-like list of names - read per field, per card's key points and
       across the deck's short answers. The check reads a folded copy of the
       text (fullwidth and compatibility forms, dash variants and the most
       common look-alike letters folded to plain ones; the folded copy is only
       looked at, never stored) and the format refuses invisible characters
       outright, so the usual ways of hiding a marking or number do not work.
       What it cannot do is judge meaning, or catch every look-alike letter.
       That check is a prevention aid, never a clearance: a clean result does
       not mean a deck is releasable.
     - IS HELD TO THE SAME RULES ON THE WAY BACK IN. A deck row that arrives in a
       restored backup, or is already on the device, goes through validateRow(),
       which repeats the schema, the size cap AND this screen, so a hand-built
       row cannot get around the import check. validate() and validateRow() are
       written to accept exactly the same decks: whatever an import accepts is
       a row the app keeps (tools/test-unit-pack-format.mjs proves the round trip).

   The citation in `source` is the unit's own words. On import it is put
   through a PORT of the conservative parser the bank uses (tools/citation-
   parse.mjs + renderCitation in tools/cite-schema.mjs). A page cannot import a
   node module, so this is a twin, exactly like G.util.citeText is a twin of
   renderCitation; tools/test-unit-decks.mjs runs BOTH parsers over the real
   bank's citations and a fuzzed corpus and fails on any disagreement. It never
   invents an edition or a paragraph, and "Battalion SOP 2026" becomes one
   named entry, not a fake publication.
*/
(function () {
  "use strict";
  var G = window.G = window.G || {};

  var FORMAT = "guidon-unit-pack";
  var FORMAT_VERSION = 1;
  var ROW_SCHEMA = 1;
  var ROW_PREFIX = "unit-deck:";      // one kv row per deck; the same string is the backup family and the manifest key
  var ID_PREFIX = "unit:";            // a card's review-history id: unit:<deckId>:<cardId>
  var CATEGORY_PREFIX = "Unit: ";     // what Board Drill / Quiz show as the category

  // Hard caps. Small on purpose: a deck is a study aid, not a document store, and
  // every one of these is echoed in docs/unit-packs.md and proved by a planted
  // defect in tools/test-unit-decks.mjs.
  var LIMITS = {
    cards: 200, categories: 30, decks: 10,
    deckIdMin: 3, deckIdMax: 40, cardIdMax: 30,
    name: 60, unit: 60, packVersion: 20, category: 40,
    question: 300, answer: 1200, keyPoints: 8, keyPoint: 200, source: 200,
    sourceEntries: 8,                  // separate references a card's source may be split into (see validate())
    reciteTitles: 8, reciteTitle: 60,
    bytes: 262144,                     // 256 KiB of JSON text, measured in UTF-8 bytes
    rowBytes: 393216                   // the SAVED row of a deck: a little larger than the file (each citation becomes a small object)
  };

  var TOP_KEYS = ["format", "formatVersion", "id", "name", "unit", "packVersion", "packDate", "cards", "reciteTitles"];
  var CARD_KEYS = ["id", "category", "q", "a", "keyPoints", "source"];
  var ROW_KEYS = ["schema", "id", "name", "unit", "packVersion", "packDate", "importedAt", "enabled", "cards", "reciteTitles"];
  var SRC_KEYS = ["pub", "edition", "para", "quoteKind", "editionFirst", "paraSep", "sepAfter"];

  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  var ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
  // Control, direction-override and INVISIBLE characters have no place in study text: they add nothing
  // a Soldier can see, and they are how a marking or a number is hidden from a check ("SEC" + a
  // zero-width space + "RET"). The second form lets a multi-line answer keep its tabs and line breaks.
  // Invisible = soft hyphen, Arabic letter mark, Mongolian free variation selectors and vowel separator,
  // zero-width space / joiners / direction marks (U+200B-U+200F), word joiner and the invisible operators
  // (U+2060-U+2064, U+206A-U+206F), Hangul fillers, variation selectors, interlinear annotation marks, the
  // object replacement character, and Unicode "tag" characters (U+E0000-U+E01EF, as surrogate pairs).
  var INVISIBLE_CLASS = "\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u2060-\u2064\u206A-\u206F\u3164\uFE00-\uFE0F\uFFA0\uFFF9-\uFFFC";
  var INVISIBLE_PAIR = "\uDB40[\uDC00-\uDDEF]";
  var BAD_SINGLE = new RegExp("[\u0000-\u001F\u007F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF\uFFFE\uFFFF" + INVISIBLE_CLASS + "]|" + INVISIBLE_PAIR);
  var BAD_MULTI = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF\uFFFE\uFFFF" + INVISIBLE_CLASS + "]|" + INVISIBLE_PAIR);

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  // A lookup table keyed by text an author controls ("constructor", "__proto__", "toString"): no prototype at all,
  // so no such word can collide with an inherited name.
  function dict() { return Object.create(null); }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  // Bytes of a string as UTF-8 (TextEncoder is not in every sandbox this file runs in).
  function utf8Bytes(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  // No lookbehind: the engine floor includes WebKit 16.2, which has none.
  function hasLoneSurrogate(s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) { var d = s.charCodeAt(i + 1); if (d >= 0xDC00 && d <= 0xDFFF) { i++; continue; } return true; }
      if (c >= 0xDC00 && c <= 0xDFFF) return true;
    }
    return false;
  }
  // A key name comes from a file we do not trust: shown as text, but kept short and printable.
  function safeKey(k) {
    var s = String(k).replace(/[\u0000-\u001F\u007F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, "?");
    return s.length > 40 ? s.slice(0, 40) + "..." : s;
  }
  function isRealDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
    var days = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= days[mo - 1];
  }

  /* =====================================================================
     Citations: a port of tools/citation-parse.mjs and renderCitation()
     (tools/cite-schema.mjs). Keep them in step; test-unit-decks.mjs compares
     the two over the real bank and a fuzz corpus.
     ===================================================================== */
  var VALID_SEP_AFTER = ["; ", " / ", " \u00b7 ", ", "];
  var DEFAULT_SEP_AFTER = "; ";
  var DEFAULT_PARA_SEP = ", ";

  function renderCitation(source) {
    if (typeof source === "string") return source;
    if (!Array.isArray(source)) return "";
    var out = "";
    source.forEach(function (e, i) {
      if (!e || typeof e !== "object") return;
      var pub = String(e.pub == null ? "" : e.pub);
      var edition = e.edition ? " (" + e.edition + ")" : "";
      var para = e.para ? (typeof e.paraSep === "string" ? e.paraSep : DEFAULT_PARA_SEP) + e.para : "";
      out += e.editionFirst === true ? pub + edition + para : pub + para + edition;
      if (i < source.length - 1) out += (typeof e.sepAfter === "string" ? e.sepAfter : DEFAULT_SEP_AFTER);
    });
    return out;
  }

  var PUB_PREFIX = "DA PAM|DA Pam|USAREC PAM|USAREC Pam|TB MED|AR|FM|ADP|ADRP|ATP|ATTP|TC|TM|STP|TB|SB|GTA|CTA|JP|DoDI|DODI|DoDD|DODD|DoDM|DODM|AFI|MCO|ALARACT|MILPER";
  var DESIGNATORS = [
    new RegExp("^(?:" + PUB_PREFIX + ")\\s?\\d[\\w.\\-/]*"),
    /^\d+ U\.?S\.?C\.?(?: §? ?\d+| Ch\. \d+| Chapter \d+)?/,
    /^\d+ CFR (?:Part )?\d+/,
    /^EO \d{4,}/,
    /^UCMJ(?: (?:Art\.|Articles?) [\dA-Za-z-]+)?/,
    /^MRE \d+/,
    /^(?:DA|DD)(?: Form)? \d{3,}[\w-]*/,
    /^Army Directive \d{4}-\d+/
  ];
  function designatorLength(s) {
    for (var i = 0; i < DESIGNATORS.length; i++) {
      var m = DESIGNATORS[i].exec(s);
      if (m) return m[0].replace(/[.,;]+$/, "").length;
    }
    return 0;
  }
  function startsWithDesignator(s) { return designatorLength(s) > 0; }

  var LOCATOR = /^(?:paras?|chapters?|chs?|appendix|appendices|appx|tables?|figures?|figs?|sections?|secs?|preface|annex|enclosure|arts?|articles?|step|MOS)\b\.?/i;
  var PROSE = /pending-source|confidence:|not a (?:publication|numbered)|this pack|this PR\b/i;
  var EDITION = /^(?:(?:\d{1,2} )?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{4}|\d{4}(?:-\d{2}(?:-\d{2})?)?)$/;

  function regulationsOfText(source) {
    var src = String(source || "");
    if (!src.trim()) return [];
    var canon = src
      .replace(/\bDA\s*Pam\b/gi, "DA PAM")
      .replace(/\bUSAREC\s*Pam\b/gi, "USAREC PAM")
      .replace(/\bDOD([IDM])\b/g, function (m, x) { return "DoD" + x; })
      .replace(/\bDoD\s*FMR\b/gi, "DoD FMR")
      .replace(/\bExecutive\s+Order\s+(\d+)/gi, "EO $1")
      .replace(/\bManual\s+for\s+Courts-?Martial\b/gi, "MCM")
      .replace(/\bTitle\s+(\d+)\b(?!\s*U)/gi, "$1 USC");
    var PUB = /\b(DA PAM|USAREC PAM|TB MED|AR|FM|ADP|ADRP|ATP|ATTP|TC|TM|STP|TB|SB|GTA|CTA|JP|DoDI|DoDD|DoDM|AFI|MCO|ALARACT|MILPER)\s*(\d[\w.\-/]*)/g;
    var RULES = [
      [PUB, function (m) { return m[1] + " " + m[2].replace(/[.,;/-]+$/, ""); }],
      [/\b(\d+)\s*U\.?S\.?C\.?\s*(?:Ch(?:apter)?\.?\s*(\d+)|§?\s*(\d+))?/g, function (m) { return m[1] + " USC" + (m[2] ? " Ch. " + m[2] : m[3] ? " " + m[3] : ""); }],
      [/\b(\d+)\s*CFR\s*(?:Part\s*)?(\d+)/g, function (m) { return m[1] + " CFR " + m[2]; }],
      [/\bUCMJ(?:[\s,]*Art(?:icles?|\.)?\s*(\d+[a-z]?(?:-\d+)?))?/g, function (m) { return "UCMJ" + (m[1] ? " Art. " + m[1] : ""); }],
      [/\bMCM\b/g, function () { return "MCM"; }],
      [/\bMRE\s+(\d+)/g, function (m) { return "MRE " + m[1]; }],
      [/\bEO\s+(\d{4,})/g, function (m) { return "EO " + m[1]; }],
      [/\b(DA|DD)\s*(?:Form\s*)?(\d{3,}[\w-]*)/g, function (m) { return m[1] + " Form " + m[2]; }],
      [/\bDoD FMR(?:\s*Vol(?:ume)?\.?\s*([\w]+))?/g, function (m) { return "DoD FMR" + (m[1] ? " Vol " + m[1] : ""); }],
      [/\bGeneva\s+Conventions?\b/gi, function () { return "Geneva Conventions"; }],
      [/\bHague\s+(?:Conventions?|Regulations?)\b/gi, function () { return "Hague Regulations"; }],
      [/\bStafford\s+Act\b/gi, function () { return "Stafford Act"; }],
      [/\bPosse\s+Comitatus\s+Act\b/gi, function () { return "Posse Comitatus Act"; }],
      [/\bNational\s+Response\s+Framework\b/gi, function () { return "National Response Framework"; }],
      [/\bSCRA\b/g, function () { return "SCRA"; }],
      [/\bJTR\b/g, function () { return "JTR"; }],
      [/\bUSCENTCOM\s+GO-?1\b/gi, function () { return "USCENTCOM GO-1"; }]
    ];
    var hits = [];
    RULES.forEach(function (rule) {
      var re = rule[0], fmt = rule[1], m;
      re.lastIndex = 0;
      while ((m = re.exec(canon)) !== null) {
        if (m.index === re.lastIndex) re.lastIndex++;
        hits.push({ i: m.index, id: fmt(m).replace(/\s+/g, " ").trim() });
      }
    });
    hits.sort(function (a, b) { return a.i - b.i; });
    var out = [];
    hits.forEach(function (h) { if (h.id && out.indexOf(h.id) === -1) out.push(h.id); });
    return out;
  }

  function splitTopLevel(s) {
    var segs = [], depth = 0, inQuote = false, start = 0, sep = "";
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '"') { inQuote = !inQuote; continue; }
      if (inQuote) continue;
      if (c === "(") { depth++; continue; }
      if (c === ")") { depth--; if (depth < 0) return null; continue; }
      if (depth > 0) continue;
      var found = "";
      if (s.slice(i, i + 2) === "; ") found = "; ";
      else if (s.slice(i, i + 3) === " / ") found = " / ";
      else if (s.slice(i, i + 2) === ", " && startsWithDesignator(s.slice(i + 2)) && i > start) found = ", ";
      if (found) {
        segs.push({ text: s.slice(start, i), sep: sep });
        sep = found; start = i + found.length; i += found.length - 1;
      }
    }
    if (depth !== 0 || inQuote) return null;
    segs.push({ text: s.slice(start), sep: sep });
    return segs;
  }

  function parseSegment(seg) {
    function whole(cls) { return { entry: { pub: seg, edition: "", para: "" }, publication: cls === "whole-pub", cls: cls }; }
    var n = designatorLength(seg);
    if (!n) return whole("residue");
    var pub = seg.slice(0, n);
    var rest = seg.slice(n), edition = "", para = "";
    var paren = /^ \(([^()]+)\)/.exec(rest);
    if (paren && EDITION.test(paren[1])) { edition = paren[1]; rest = rest.slice(paren[0].length); }
    if (rest !== "") {
      if (rest.slice(0, 2) === ", " && LOCATOR.test(rest.slice(2))) para = rest.slice(2);
      else return whole("whole-pub");
    }
    var entry = { pub: pub, edition: edition, para: para };
    if (edition && para) entry.editionFirst = true;
    var same = JSON.stringify(regulationsOfText(pub)) === JSON.stringify(regulationsOfText(seg));
    if (renderCitation([entry]) !== seg || !same) return whole("whole-pub");
    return { entry: entry, publication: true, cls: "canonical" };
  }

  function parseSource(text) {
    var s = String(text == null ? "" : text);
    function keepWhole() {
      return { entries: [{ pub: s, edition: "", para: "" }], publication: [startsWithDesignator(s)], cls: [startsWithDesignator(s) ? "whole-pub" : "residue"] };
    }
    if (!s.trim() || s !== s.trim() || /\s{2,}/.test(s)) return keepWhole();
    if (PROSE.test(s)) return keepWhole();
    var segs = splitTopLevel(s);
    if (!segs) return keepWhole();
    var merged = [];
    segs.forEach(function (g) {
      var prev = merged[merged.length - 1];
      var gPub = startsWithDesignator(g.text);
      if (prev && LOCATOR.test(g.text) && !gPub) prev.text += g.sep + g.text;
      else if (prev && !gPub && !startsWithDesignator(prev.text)) prev.text += g.sep + g.text;
      else merged.push({ text: g.text, sep: g.sep });
    });
    var entries = [], publication = [], cls = [];
    merged.forEach(function (g, i) {
      if (!g.text) return;
      var r = parseSegment(g.text);
      var e = r.entry;
      if (i > 0 && g.sep && g.sep !== "; " && entries.length) entries[entries.length - 1].sepAfter = g.sep;
      entries.push(e); publication.push(r.publication); cls.push(r.cls);
    });
    if (!entries.length || renderCitation(entries) !== s) return keepWhole();
    return { entries: entries, publication: publication, cls: cls };
  }

  // The structured array for a unit card. quoteKind is ALWAYS "paraphrase": nothing here
  // can verify that a unit's card quotes anything, so it never claims "verbatim".
  function cite(text) {
    var r = parseSource(text);
    if (!r.entries.length || !String(text).trim()) throw new Error("cite(): the source text is empty");
    return r.entries.map(function (e) {
      var out = { pub: e.pub, edition: e.edition, para: e.para, quoteKind: "paraphrase" };
      if (e.editionFirst) out.editionFirst = true;
      if (e.sepAfter) out.sepAfter = e.sepAfter;
      return out;
    });
  }
  // Board Drill's regulation chips: only entries that open with a real publication
  // designator count, so "Battalion SOP 2026" can never make a chip.
  function regulationsOfEntries(entries) {
    var out = [];
    (entries || []).forEach(function (e) {
      if (!e || !startsWithDesignator(String(e.pub || ""))) return;
      regulationsOfText(e.pub).forEach(function (id) { if (out.indexOf(id) === -1) out.push(id); });
    });
    return out;
  }

  /* =====================================================================
     The closed schema. Every message is written for the leader who made the
     deck, and names the card and the field.
     ===================================================================== */
  function err(path, code, message) { return { path: path, code: code, message: message }; }
  var MAX_ERRORS = 60;

  function cardLabel(i, c) {
    return "Card " + (i + 1) + (isObj(c) && typeof c.id === "string" && SLUG_RE.test(c.id) && c.id.length <= LIMITS.cardIdMax ? " (" + c.id + ")" : "");
  }
  // One text field. `label` reads as the start of a sentence ("Card 3 (sop-003): the answer").
  function checkText(errors, path, label, value, o) {
    if (typeof value !== "string") { errors.push(value === undefined ? err(path, "missing", label + " is missing.") : err(path, "wrong-type", label + " must be text.")); return null; }
    var t = value.trim();
    if (t.length < 1) { errors.push(err(path, "empty", label + " is empty.")); return null; }
    if (t.length > o.max) { errors.push(err(path, "too-long", label + " is longer than " + num(o.max) + " characters (it has " + num(t.length) + ").")); return null; }
    if ((o.multiline ? BAD_MULTI : BAD_SINGLE).test(value) || hasLoneSurrogate(value)) {
      errors.push(err(path, "bad-characters", label + " has a hidden or unusual character (a control code, a zero-width or text-direction mark" + (o.multiline ? "" : ", or a line break or tab") + "). Retype it as plain text."));
      return null;
    }
    return t;
  }
  function unknownKeys(errors, path, obj, allowed, what) {
    Object.keys(obj).forEach(function (k) {
      if (allowed.indexOf(k) === -1) errors.push(err(path ? path + "." + k : k, "unknown-key", what + " has a field GUIDON does not know (\"" + safeKey(k) + "\"). A unit deck may only use: " + allowed.join(", ") + "."));
    });
  }
  function checkSlug(errors, path, label, value, min, max) {
    if (typeof value !== "string") { errors.push(value === undefined ? err(path, "missing", label + " is missing.") : err(path, "wrong-type", label + " must be text.")); return; }
    if (value.length < min || value.length > max || !SLUG_RE.test(value)) {
      errors.push(err(path, "bad-id", label + " must be " + min + " to " + max + " characters of lower-case letters, digits and single dashes (like \"sop-2026\")."));
    }
  }

  function validate(pack) {
    var errors = [], cut = false;
    function full() { return errors.length >= MAX_ERRORS; }
    if (!isObj(pack)) return { ok: false, errors: [err("", "not-a-deck", "This is not a GUIDON unit deck. A deck is one JSON object.")], truncated: false };
    if (pack.format !== FORMAT) return { ok: false, errors: [err("format", "wrong-format", "This is not a GUIDON unit deck (its \"format\" is not \"" + FORMAT + "\").")], truncated: false };
    var ver = pack.formatVersion;
    if (typeof ver === "number" && isFinite(ver) && Math.floor(ver) === ver && ver > FORMAT_VERSION) {
      // A newer format may add fields this copy cannot judge, so nothing else is checked.
      return { ok: false, newer: true, errors: [err("formatVersion", "newer-version", "This deck was saved in a newer deck format (version " + num(ver) + ") than this copy of GUIDON understands (version " + FORMAT_VERSION + "). Update GUIDON, or ask your unit to save the deck again in the older format.")], truncated: false };
    }
    if (ver !== FORMAT_VERSION) errors.push(err("formatVersion", "bad-version", "The deck's format version must be the number " + FORMAT_VERSION + "."));
    unknownKeys(errors, "", pack, TOP_KEYS, "The deck");

    checkSlug(errors, "id", "The deck id", pack.id, LIMITS.deckIdMin, LIMITS.deckIdMax);
    checkText(errors, "name", "The deck name", pack.name, { max: LIMITS.name });
    if (hasOwn(pack, "unit")) checkText(errors, "unit", "The unit label", pack.unit, { max: LIMITS.unit });
    if (typeof pack.packVersion !== "string" || !VERSION_RE.test(pack.packVersion) || pack.packVersion.length > LIMITS.packVersion) {
      errors.push(err("packVersion", "bad-version-label", "The deck's version label must be 1 to " + LIMITS.packVersion + " letters, digits, dots or dashes (like \"2026.09\")."));
    }
    if (typeof pack.packDate !== "string" || !isRealDate(pack.packDate)) errors.push(err("packDate", "bad-date", "The deck's date must be a real calendar date written year-month-day (like 2026-09-26)."));

    if (hasOwn(pack, "reciteTitles")) {
      var rt = pack.reciteTitles;
      if (!Array.isArray(rt)) errors.push(err("reciteTitles", "wrong-type", "The list of suggested titles must be a list of short titles."));
      else if (rt.length > LIMITS.reciteTitles) errors.push(err("reciteTitles", "too-many", "The list of suggested titles has " + rt.length + " entries; the most allowed is " + LIMITS.reciteTitles + "."));
      else {
        var seenT = dict();
        rt.forEach(function (t, i) {
          var tt = checkText(errors, "reciteTitles[" + i + "]", "Suggested title " + (i + 1), t, { max: LIMITS.reciteTitle });
          if (tt) { var lk = tt.toLowerCase(); if (seenT[lk]) errors.push(err("reciteTitles[" + i + "]", "duplicate", "Suggested title " + (i + 1) + " repeats an earlier one (\"" + tt + "\").")); seenT[lk] = true; }
        });
      }
    }

    var cards = pack.cards;
    if (!Array.isArray(cards)) errors.push(err("cards", "wrong-type", "The deck needs a list of cards."));
    else if (cards.length < 1) errors.push(err("cards", "empty", "The deck has no cards."));
    else if (cards.length > LIMITS.cards) errors.push(err("cards", "too-many", "The deck has " + num(cards.length) + " cards; the most allowed is " + LIMITS.cards + ". Split it into two decks."));
    else {
      var ids = dict(), qs = dict(), cats = dict(), catCount = 0;
      for (var i = 0; i < cards.length; i++) {
        if (full()) { cut = true; break; }
        var c = cards[i], base = "cards[" + i + "]", lab = cardLabel(i, c);
        if (!isObj(c)) { errors.push(err(base, "wrong-type", lab + " must be an object with a question and an answer.")); continue; }
        unknownKeys(errors, base, c, CARD_KEYS, lab);
        checkSlug(errors, base + ".id", lab + ": the card id", c.id, 1, LIMITS.cardIdMax);
        if (typeof c.id === "string") { if (ids[c.id]) errors.push(err(base + ".id", "duplicate", lab + ": the card id \"" + c.id + "\" is used by an earlier card too.")); ids[c.id] = true; }
        var cat = checkText(errors, base + ".category", lab + ": the category", c.category, { max: LIMITS.category });
        // Counted exactly as typed (after trimming): Board Drill lists "Local SOP" and "local sop" as two categories, so the cap counts two.
        if (cat && !cats[cat]) { cats[cat] = true; catCount++; }
        var q = checkText(errors, base + ".q", lab + ": the question", c.q, { max: LIMITS.question });
        if (q) { var qk = q.toLowerCase().replace(/\s+/g, " "); if (qs[qk]) errors.push(err(base + ".q", "duplicate", lab + ": the question is the same as an earlier card's.")); qs[qk] = true; }
        checkText(errors, base + ".a", lab + ": the answer", c.a, { max: LIMITS.answer, multiline: true });
        if (hasOwn(c, "keyPoints")) {
          if (!Array.isArray(c.keyPoints)) errors.push(err(base + ".keyPoints", "wrong-type", lab + ": the key points must be a list."));
          else if (c.keyPoints.length > LIMITS.keyPoints) errors.push(err(base + ".keyPoints", "too-many", lab + ": has " + c.keyPoints.length + " key points; the most allowed is " + LIMITS.keyPoints + "."));
          else c.keyPoints.forEach(function (k, j) { checkText(errors, base + ".keyPoints[" + j + "]", lab + ": key point " + (j + 1), k, { max: LIMITS.keyPoint }); });
        }
        if (hasOwn(c, "source")) {
          var st = checkText(errors, base + ".source", lab + ": the source", c.source, { max: LIMITS.source });
          // The saved row keeps at most LIMITS.sourceEntries entries per card (validateRow), so a source that
          // would split into more is refused HERE, in plain words, instead of being saved and then vanishing at the next start.
          if (st !== null) {
            var pieces = parseSource(st).entries.length;
            if (pieces > LIMITS.sourceEntries) errors.push(err(base + ".source", "too-many-sources", lab + ": the source lists " + pieces + " separate references; the most GUIDON keeps on one card is " + LIMITS.sourceEntries + ". Shorten it to the ones that matter."));
          }
        }
      }
      if (catCount > LIMITS.categories) errors.push(err("cards", "too-many-categories", "The deck uses " + catCount + " different categories; the most allowed is " + LIMITS.categories + "."));
    }
    var size = 0;
    try { size = utf8Bytes(JSON.stringify(pack)); } catch (e) { size = 0; }
    if (size > LIMITS.bytes) errors.push(err("", "too-big", "The deck is " + num(Math.round(size / 1024)) + " KB; the most allowed is " + (LIMITS.bytes / 1024) + " KB."));
    // The very last rule, and the one that makes the two checks agree: build the row this deck would be saved as
    // and hold it to the row's own size cap (validateRow does the same to whatever is already on a device).
    if (errors.length === 0) {
      try {
        var rowSize = utf8Bytes(JSON.stringify(toDeck(pack, { importedAt: "2000-01-01T00:00:00.000Z" })));
        if (rowSize > LIMITS.rowBytes) errors.push(err("", "too-big", "Once saved on the device the deck would be " + num(Math.round(rowSize / 1024)) + " KB; the most GUIDON keeps is " + (LIMITS.rowBytes / 1024) + " KB. Split it into two decks."));
      } catch (e) {
        errors.push(err("", "not-a-deck", "This deck could not be read all the way through. Check it and try again."));
      }
    }
    return { ok: errors.length === 0, errors: errors.slice(0, MAX_ERRORS), truncated: cut || errors.length > MAX_ERRORS };
  }

  // Text -> a checked pack. Everything before the schema: size, byte-order mark, JSON.
  function parse(text) {
    if (typeof text !== "string") return { ok: false, errors: [err("", "not-text", "That is not text GUIDON can read.")] };
    if (utf8Bytes(text) > LIMITS.bytes) return { ok: false, errors: [err("", "too-big", "That is bigger than the " + (LIMITS.bytes / 1024) + " KB a unit deck may be.")] };
    var t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    if (!t.trim()) return { ok: false, errors: [err("", "empty", "There is nothing there. Choose a deck file or paste the deck text.")] };
    var obj;
    try { obj = JSON.parse(t); }
    catch (e) { return { ok: false, errors: [err("", "not-json", "That is not a readable unit deck (it is not valid JSON). If you copied it, check that all of it came across.")] }; }
    var v = validate(obj);
    return v.ok ? { ok: true, errors: [], pack: obj } : { ok: false, errors: v.errors, truncated: v.truncated, newer: !!v.newer };
  }

  /* =====================================================================
     Sensitive-text screening. Fail closed: with no screen available, no deck.
     ===================================================================== */
  var RANKS = "PVT|PV2|PFC|SPC|CPL|SGT|SSG|SFC|MSG|1SG|SGM|CSM|2LT|1LT|CPT|MAJ|LTC|COL|BG|MG|LTG|GEN|WO1|CW[2-5]|CDT";
  var RANK_NAME_RE = new RegExp("(?:^|[\\s,;(])(?:" + RANKS + ")\\.?[ \\t]+([A-Z][A-Za-z'\u2019-]{1,})", "g");
  var RANK_WORDS = /^(?:Private|Specialist|Corporal|Sergeant|Staff|First|Class|Lieutenant|Captain|Major|Colonel|General|Command|Warrant|Officer|Chief|Master|Second|Brigadier|Cadet|Candidate|Academy|Course|Board|Promotable|Leader|Leaders|NCO|NCOs|Soldier|Soldiers|Promotion|Program|Rank|Ranks|Grade|Pay|Insignia|Board)$/;
  var LAST_FIRST_RE = /^[ \t]*(?:[-*\u2022\d.)]+[ \t]+)?[A-Z][A-Za-z'\u2019-]+,[ \t]+[A-Z][a-z]+(?:[ \t]+[A-Z]\.?)?[ \t]*$/;
  // How many lines of `text` look like a person: a rank then a capitalised word, or "Surname, Given".
  function rosterCounts(text) {
    var lines = String(text).split(/\r\n|\r|\n/);
    var rankLines = 0, lastFirst = 0, pairs = 0, m;
    lines.forEach(function (ln) {
      var hit = 0;
      RANK_NAME_RE.lastIndex = 0;
      while ((m = RANK_NAME_RE.exec(ln)) !== null) { if (!RANK_WORDS.test(m[1])) hit++; }
      if (hit) { rankLines++; pairs += hit; }
      if (LAST_FIRST_RE.test(ln)) lastFirst++;
    });
    return { rankLines: rankLines, pairs: pairs, lastFirst: lastFirst };
  }
  // A short, honest check for a list of people. It is not a name detector and it does not
  // replace the person authoring the deck. This is the bar for ONE piece of text (an answer, or one
  // card's key points read together): three lines of it, or four names in it.
  function rosterLike(text) {
    var c = rosterCounts(text);
    return c.rankLines >= 3 || c.pairs >= 4 || c.lastFirst >= 3;
  }
  // The same idea across the WHOLE deck: a roster spread one name to a card. Higher on purpose - a unit-history deck may
  // honestly name a few commanders in its short answers - so it takes six such lines before the deck counts as a list.
  var WIDE_LINES = 6, SHORT_LINE = 60;
  function rosterLikeWide(text) {
    var c = rosterCounts(text);
    return c.rankLines >= WIDE_LINES || c.lastFirst >= WIDE_LINES;
  }

  // What the check reads is a FOLDED copy of each field, never the field itself: compatibility forms (fullwidth digits and
  // letters, mathematical alphabets, ligatures) fold to plain ones, dash variants become "-", combining marks are dropped and
  // the most common look-alike letters from other alphabets (Cyrillic and Greek capitals that print like Latin ones) become
  // the Latin letter. It is looked at and thrown away: what is stored and shown is always what was typed. Invisible characters
  // never get this far (the schema refuses them). NOT covered: a look-alike letter that is not in the table below.
  var COMBINING_RE = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;
  var DASHES_RE = /[\u2010-\u2015\u2212\uFE58\uFE63]/g;
  var LOOKALIKE = {
    "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041A": "K", "\u041C": "M", "\u041D": "H", "\u041E": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0425": "X", "\u0423": "Y", "\u0405": "S", "\u0406": "I", "\u0408": "J",
    "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x", "\u0443": "y", "\u0455": "s", "\u0456": "i", "\u0458": "j", "\u04BB": "h", "\u0501": "d",
    "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I", "\u039A": "K", "\u039C": "M", "\u039D": "N", "\u039F": "O", "\u03A1": "P", "\u03A4": "T", "\u03A5": "Y", "\u03A7": "X",
    "\u03BF": "o", "\u03BD": "v", "\u03B9": "i"
  };
  var LOOKALIKE_RE = /[\u0405\u0406\u0408\u0410\u0412\u0415\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0423\u0425\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0455\u0456\u0458\u04BB\u0501\u0391\u0392\u0395\u0396\u0397\u0399\u039A\u039C\u039D\u039F\u03A1\u03A4\u03A5\u03A7\u03BF\u03BD\u03B9]/g;
  function fold(s) {
    var t = String(s);
    // NFKD, not NFKC: letters and their accents are pulled apart first, so a mark laid on a letter cannot glue itself to it and hide it.
    try { if (typeof t.normalize === "function") t = t.normalize("NFKD"); } catch (e) { /* an engine with no normalize reads the text as typed */ }
    return t.replace(COMBINING_RE, "").replace(DASHES_RE, "-").replace(LOOKALIKE_RE, function (c) { return LOOKALIKE[c]; });
  }
  // Exactly what toDeck() keeps of a text field, so the check on a deck's file and the check on its saved row read the same words.
  function norm(s) { return String(s).replace(/\r\n?/g, "\n").trim(); }

  // Everything the screen reads, in one place: the single fields, each card's key points read together, the deck's short
  // lines read together, and the places where one field of a card ends and the next begins (a number cut in two).
  function screenParts(pack) {
    var fields = [], blocks = [], wide = [], seams = [];
    function add(where, text, kind) {
      if (typeof text !== "string") return null;
      var t = norm(text);
      if (!t) return null;
      var f = { where: where, text: t, kind: kind || "text" };
      fields.push(f);
      return f;
    }
    add("The deck id", pack.id);
    add("The deck name", pack.name);
    add("The unit label", pack.unit);
    add("The deck's version label", pack.packVersion);
    (Array.isArray(pack.reciteTitles) ? pack.reciteTitles : []).forEach(function (t, i) { add("Suggested title " + (i + 1), t); });
    (Array.isArray(pack.cards) ? pack.cards : []).forEach(function (c, i) {
      if (!isObj(c)) return;
      var lab = cardLabel(i, c), seq = [];
      function part(name, text, kind) { var f = add(lab + ", " + name, text, kind); if (f) { f.name = name; seq.push(f); } return f; }
      add(lab + ", id", c.id);
      part("category", c.category);
      part("question", c.q, "prose");
      var a = part("answer", c.a, "prose");
      if (a && a.text.indexOf("\n") === -1 && a.text.length <= SHORT_LINE) wide.push(a.text);
      var kps = [];
      (Array.isArray(c.keyPoints) ? c.keyPoints : []).forEach(function (k, j) {
        var f = part("key point " + (j + 1), k, "prose");
        if (f) { kps.push(f.text); if (f.text.length <= SHORT_LINE && f.text.indexOf("\n") === -1) wide.push(f.text); }
      });
      if (kps.length > 1) blocks.push({ where: lab + ", key points", text: kps.join("\n") });
      part("source", c.source);
      // A field that STARTS with a digit or a dash may be the second half of a number begun earlier in the same card: the
      // field right before it always is tried, and any earlier field that ENDS with a digit or a dash.
      for (var k = 1; k < seq.length; k++) {
        if (!/^[0-9\-]/.test(seq[k].text)) continue;
        for (var m = 0; m < k; m++) {
          if (m !== k - 1 && !/[0-9\-]$/.test(seq[m].text)) continue;
          seams.push({ where: lab + ", where the " + seq[m].name + " runs into the " + seq[k].name, a: seq[m].text, b: seq[k].text });
        }
      }
    });
    return { fields: fields, blocks: blocks, wide: wide, seams: seams };
  }

  // An excerpt is context around one finding; it must never repeat a whole identifier that belongs to
  // ANOTHER finding (a Social Security number sitting next to a phone number, say).
  function maskExcerpt(t) {
    return String(t)
      .replace(/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(\d{4})\b/g, "\u2022\u2022\u2022-\u2022\u2022-$1")
      .replace(/\b\d{5,}(\d{4})\b/g, function (m, tail) { return new Array(m.length - 3).join("\u2022") + tail; });
  }
  var MAX_FINDINGS = 50;
  var SEAM_CODES = ["ssn", "dod-id", "phone"], SEAM_CHARS = 24;
  function countByCode(findings) { var o = dict(); (findings || []).forEach(function (f) { o[f.code] = (o[f.code] || 0) + 1; }); return o; }
  function screen(pack, opts) {
    opts = opts || {};
    var guard = G.opsecGuard;
    if (!guard || typeof guard.screen !== "function") {
      return { ok: false, unavailable: true, total: 0, findings: [], message: "GUIDON's sensitive-text check is not available, so this deck was not added." };
    }
    var findings = [], total = 0;
    var gopts = opts.now != null ? { now: opts.now } : undefined;
    function push(f) { total++; if (findings.length < MAX_FINDINGS) findings.push(f); }
    var parts = screenParts(pack || {});
    parts.fields.forEach(function (fld) {
      var text = fold(fld.text);
      var r = guard.screen(text, gopts);
      (r.findings || []).forEach(function (f) {
        push({ where: fld.where, line: f.line, code: f.code, severity: f.severity, looksLike: f.looksLike || "something sensitive", excerpt: maskExcerpt(f.excerpt || "") });
      });
      if (fld.kind === "prose" && rosterLike(text)) push({ where: fld.where, line: 1, code: "roster-like", severity: "stop", looksLike: "a list of people's names (a roster)", excerpt: "" });
    });
    // One card's key points, read together: a list of names is a list whether it sits in one answer or in the key points.
    parts.blocks.forEach(function (b) {
      if (rosterLike(fold(b.text))) push({ where: b.where, line: 1, code: "roster-like", severity: "stop", looksLike: "a list of people's names (a roster)", excerpt: "" });
    });
    // A roster spread one name to a card: the deck's short answers and key points, read as one list.
    if (parts.wide.length >= WIDE_LINES && rosterLikeWide(fold(parts.wide.join("\n")))) {
      push({ where: "The deck's short answers and key points, read together", line: 1, code: "roster-like", severity: "stop", looksLike: "a list of people's names (a roster) spread across several cards", excerpt: "" });
    }
    // An identifier cut in two (an SSN ending one field and starting the next): only what the JOIN makes appear counts, so
    // ordinary numbers that merely sit next to each other never do.
    parts.seams.forEach(function (s) {
      var tail = s.a.slice(-SEAM_CHARS), head = s.b.slice(0, SEAM_CHARS);
      var joined = guard.screen(fold(tail + head), gopts);
      var jc = countByCode((joined.findings || []).filter(function (f) { return SEAM_CODES.indexOf(f.code) !== -1; }));
      var codes = Object.keys(jc);
      if (!codes.length) return;
      var tc = countByCode(guard.screen(fold(tail), gopts).findings), hc = countByCode(guard.screen(fold(head), gopts).findings);
      codes.forEach(function (code) {
        if (jc[code] <= (tc[code] || 0) + (hc[code] || 0)) return;
        var f = (joined.findings || []).filter(function (x) { return x.code === code; })[0];
        push({ where: s.where, line: 1, code: code, severity: f.severity, looksLike: f.looksLike || "something sensitive", excerpt: maskExcerpt(f.excerpt || "") });
      });
    });
    return { ok: total === 0, total: total, findings: findings, truncated: total > findings.length };
  }

  function describeFinding(f) {
    return f.where + (f.line > 1 ? ", line " + f.line : "") + ": this looks like " + f.looksLike + (f.excerpt ? " (\u201c" + f.excerpt + "\u201d)" : "") + ".";
  }

  /* =====================================================================
     A checked pack -> the row kept on the device, and the cards Soldiers study
     ===================================================================== */
  function trimNl(s) { return String(s).replace(/\r\n?/g, "\n").trim(); }

  function toDeck(pack, o) {
    o = o || {};
    var cards = pack.cards.map(function (c) {
      var card = {
        id: c.id, category: c.category.trim(), q: c.q.trim(), a: trimNl(c.a),
        keyPoints: (c.keyPoints || []).map(function (k) { return k.trim(); })
      };
      if (typeof c.source === "string" && c.source.trim()) card.source = cite(c.source.trim());
      return card;
    });
    var deck = {
      schema: ROW_SCHEMA, id: pack.id, name: pack.name.trim(), unit: hasOwn(pack, "unit") ? pack.unit.trim() : "",
      packVersion: pack.packVersion, packDate: pack.packDate,
      importedAt: o.importedAt || new Date().toISOString(),
      enabled: o.enabled !== false,
      cards: cards,
      reciteTitles: (pack.reciteTitles || []).map(function (t) { return t.trim(); })
    };
    return deck;
  }

  function unitCardId(deckId, cardId) { return ID_PREFIX + deckId + ":" + cardId; }
  function isUnitId(id) { return typeof id === "string" && id.indexOf(ID_PREFIX) === 0; }

  // What Board Drill, Quiz, Rapid Fire and search work with. No pillar, tier, MOS or
  // difficulty: a unit deck is not part of the six pillars and is not levelled by GUIDON.
  function cardsOf(deck) {
    var meta = { id: deck.id, name: deck.name, unit: deck.unit || "" };
    return deck.cards.map(function (c) {
      var card = {
        id: unitCardId(deck.id, c.id),
        category: CATEGORY_PREFIX + c.category,
        q: c.q, a: c.a, keyPoints: c.keyPoints.slice(),
        regs: regulationsOfEntries(c.source),
        unitDeck: meta, unitCardId: c.id, unitCategory: c.category
      };
      if (c.source) card.source = c.source.map(function (e) { var x = {}; Object.keys(e).forEach(function (k) { x[k] = e[k]; }); return x; });
      return card;
    });
  }

  function summarize(pack) {
    var cats = dict(), order = [];
    pack.cards.forEach(function (c) {
      var k = c.category.trim();
      if (!cats[k]) { cats[k] = 0; order.push(k); }
      cats[k]++;
    });
    return {
      id: pack.id, name: pack.name.trim(), unit: hasOwn(pack, "unit") ? pack.unit.trim() : "",
      packVersion: pack.packVersion, packDate: pack.packDate,
      cards: pack.cards.length, withSource: pack.cards.filter(function (c) { return typeof c.source === "string" && c.source.trim(); }).length,
      categories: order.map(function (k) { return { name: k, count: cats[k] }; }),
      samples: pack.cards.slice(0, 3).map(function (c) { return { category: c.category.trim(), q: c.q.trim(), a: trimNl(c.a), source: typeof c.source === "string" ? c.source.trim() : "" }; }),
      reciteTitles: (pack.reciteTitles || []).map(function (t) { return t.trim(); })
    };
  }

  /* The row check. It is the ONE definition of "a deck row on this device is sound":
     the backup restore, Diagnostics and the app's own boot read all use it. */
  function validateRow(row) {
    var errors = [];
    var bytes = 0;
    try { bytes = utf8Bytes(JSON.stringify(row)); } catch (e) { return { ok: false, errors: [err("", "not-a-deck", "A saved unit deck must be plain data.")] }; }
    if (bytes > LIMITS.rowBytes) return { ok: false, errors: [err("", "too-big", "The saved deck is " + num(Math.round(bytes / 1024)) + " KB; the most GUIDON keeps is " + (LIMITS.rowBytes / 1024) + " KB.")] };
    if (!isObj(row)) return { ok: false, errors: [err("", "not-a-deck", "A saved unit deck must be an object.")] };
    unknownKeys(errors, "", row, ROW_KEYS, "The saved deck");
    if (row.schema !== ROW_SCHEMA) errors.push(err("schema", "bad-schema", "The saved deck has an unknown row version."));
    checkSlug(errors, "id", "The deck id", row.id, LIMITS.deckIdMin, LIMITS.deckIdMax);
    checkText(errors, "name", "The deck name", row.name, { max: LIMITS.name });
    if (typeof row.unit !== "string" || row.unit.length > LIMITS.unit || BAD_SINGLE.test(row.unit) || hasLoneSurrogate(row.unit)) errors.push(err("unit", "bad-unit", "The unit label is not valid text."));
    if (typeof row.packVersion !== "string" || !VERSION_RE.test(row.packVersion) || row.packVersion.length > LIMITS.packVersion) errors.push(err("packVersion", "bad-version-label", "The version label is not valid."));
    if (typeof row.packDate !== "string" || !isRealDate(row.packDate)) errors.push(err("packDate", "bad-date", "The date is not valid."));
    if (typeof row.importedAt !== "string" || !ISO_TS_RE.test(row.importedAt)) errors.push(err("importedAt", "bad-timestamp", "The added-on time is not valid."));
    if (typeof row.enabled !== "boolean") errors.push(err("enabled", "wrong-type", "The on/off setting must be true or false."));
    if (!Array.isArray(row.reciteTitles) || row.reciteTitles.length > LIMITS.reciteTitles) errors.push(err("reciteTitles", "wrong-type", "The suggested titles are not a valid list."));
    else row.reciteTitles.forEach(function (t, i) { checkText(errors, "reciteTitles[" + i + "]", "Suggested title " + (i + 1), t, { max: LIMITS.reciteTitle }); });
    if (!Array.isArray(row.cards) || row.cards.length < 1 || row.cards.length > LIMITS.cards) errors.push(err("cards", "wrong-type", "The saved deck's cards are not a valid list."));
    else {
      var ids = dict();
      for (var i = 0; i < row.cards.length && errors.length < MAX_ERRORS; i++) {
        var c = row.cards[i], base = "cards[" + i + "]", lab = cardLabel(i, c);
        if (!isObj(c)) { errors.push(err(base, "wrong-type", lab + " must be an object.")); continue; }
        unknownKeys(errors, base, c, CARD_KEYS, lab);
        checkSlug(errors, base + ".id", lab + ": the card id", c.id, 1, LIMITS.cardIdMax);
        if (typeof c.id === "string") { if (ids[c.id]) errors.push(err(base + ".id", "duplicate", lab + ": repeated card id.")); ids[c.id] = true; }
        checkText(errors, base + ".category", lab + ": the category", c.category, { max: LIMITS.category });
        checkText(errors, base + ".q", lab + ": the question", c.q, { max: LIMITS.question });
        checkText(errors, base + ".a", lab + ": the answer", c.a, { max: LIMITS.answer, multiline: true });
        if (!Array.isArray(c.keyPoints) || c.keyPoints.length > LIMITS.keyPoints) errors.push(err(base + ".keyPoints", "wrong-type", lab + ": the key points are not a valid list."));
        else c.keyPoints.forEach(function (k, j) { checkText(errors, base + ".keyPoints[" + j + "]", lab + ": key point " + (j + 1), k, { max: LIMITS.keyPoint }); });
        if (hasOwn(c, "source")) validateSourceEntries(errors, base + ".source", lab, c.source);
      }
    }
    // A structurally sound row still goes through the sensitive-text screen: a row that came in with a restored backup, or
    // sat on the device, never went past the import check, and every study tool trusts what is in it.
    if (errors.length === 0) {
      var scr = screenRow(row);
      if (!scr.ok) errors.push(err("", "sensitive-text", scr.unavailable ? "A saved unit deck was left out because GUIDON's sensitive-text check is not available." : "A saved unit deck was left out because its text looks like something that does not belong in a study deck. " + describeFinding(scr.findings[0])));
    }
    return { ok: errors.length === 0, errors: errors.slice(0, MAX_ERRORS) };
  }
  // The screen, run on a saved row: the row's words in the shape screen() reads (a citation list rendered back to the text it was made from).
  function screenRow(row, opts) {
    return screen({
      id: row.id, name: row.name, unit: row.unit, packVersion: row.packVersion, reciteTitles: row.reciteTitles,
      cards: (row.cards || []).map(function (c) {
        return { id: c.id, category: c.category, q: c.q, a: c.a, keyPoints: c.keyPoints, source: Array.isArray(c.source) ? renderCitation(c.source) : undefined };
      })
    }, opts);
  }
  function validateSourceEntries(errors, path, lab, src) {
    if (!Array.isArray(src) || src.length < 1 || src.length > LIMITS.sourceEntries) { errors.push(err(path, "wrong-type", lab + ": the source is not a valid citation list.")); return; }
    src.forEach(function (e, i) {
      var p = path + "[" + i + "]";
      if (!isObj(e)) { errors.push(err(p, "wrong-type", lab + ": a source entry must be an object.")); return; }
      unknownKeys(errors, p, e, SRC_KEYS, lab + ": a source entry");
      if (typeof e.pub !== "string" || !e.pub.trim() || e.pub.length > LIMITS.source || BAD_SINGLE.test(e.pub)) errors.push(err(p + ".pub", "bad-pub", lab + ": a source entry has no valid name."));
      if (typeof e.edition !== "string" || e.edition.length > 40 || BAD_SINGLE.test(e.edition)) errors.push(err(p + ".edition", "bad-edition", lab + ": a source entry has a bad edition."));
      if (typeof e.para !== "string" || e.para.length > LIMITS.source || BAD_SINGLE.test(e.para)) errors.push(err(p + ".para", "bad-para", lab + ": a source entry has a bad location."));
      if (e.quoteKind !== "paraphrase") errors.push(err(p + ".quoteKind", "bad-quote-kind", lab + ": a unit deck's source is never marked as a word-for-word quote."));
      if (hasOwn(e, "editionFirst") && e.editionFirst !== true) errors.push(err(p + ".editionFirst", "wrong-type", lab + ": a source entry has a bad flag."));
      if (hasOwn(e, "paraSep") && [", ", " ", " \u2014 "].indexOf(e.paraSep) === -1) errors.push(err(p + ".paraSep", "wrong-type", lab + ": a source entry has a bad separator."));
      if (hasOwn(e, "sepAfter") && VALID_SEP_AFTER.indexOf(e.sepAfter) === -1) errors.push(err(p + ".sepAfter", "wrong-type", lab + ": a source entry has a bad separator."));
    });
  }
  function validRow(row) { return validateRow(row).ok; }

  function rowKey(id) { return ROW_PREFIX + id; }

  G.unitPack = {
    FORMAT: FORMAT, FORMAT_VERSION: FORMAT_VERSION, ROW_SCHEMA: ROW_SCHEMA, ROW_PREFIX: ROW_PREFIX, ID_PREFIX: ID_PREFIX, CATEGORY_PREFIX: CATEGORY_PREFIX,
    LIMITS: LIMITS, TOP_KEYS: TOP_KEYS.slice(), CARD_KEYS: CARD_KEYS.slice(),
    validate: validate, parse: parse, screen: screen, describeFinding: describeFinding,
    summarize: summarize, toDeck: toDeck, cardsOf: cardsOf,
    validateRow: validateRow, validRow: validRow, screenRow: screenRow, rowKey: rowKey,
    unitCardId: unitCardId, isUnitId: isUnitId,
    cite: cite, parseSource: parseSource, renderCitation: renderCitation, regulationsOfEntries: regulationsOfEntries,
    rosterLike: rosterLike, utf8Bytes: utf8Bytes
  };
})();
