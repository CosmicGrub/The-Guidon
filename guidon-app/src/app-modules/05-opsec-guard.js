/* ==== js/05-opsec-guard.js ==== */
/* GUIDON — local-only sensitive-input check. FINDINGS ONLY.

   WHY findings-only: the first version of this guard both decided AND
   rewrote. Its Social Security pattern matched "600-20 2020", so an MOI
   line such as "AR 600-20 2020" reached the citation parser as
   "AR [SSN REDACTED]" and the assigned regulation silently vanished from the
   Soldier's study plan. Its marking patterns were case-insensitive English
   words, so the app's own CUI study cards and the standard AR 380-5 board
   question were stopped with an incident-reporting instruction, while real
   marking syntax such as "(S//NF)" or "UNCLASSIFIED//FOUO" passed.

   So this module now only REPORTS. screen() returns located findings and
   never changes, trims or deletes a single character of what the Soldier
   typed or pasted - callers always parse the ORIGINAL text and decide, with
   the Soldier, what happens next. Every rule keys on marking SYNTAX (banner
   lines, "//" control strings, portion marks at the start of a portion) or
   on a labelled / unmistakably shaped identifier, never on an ordinary word.

   This is a prevention aid, not a classification authority. A clean result
   never means text is releasable, unclassified or safe to distribute.
*/
window.G = window.G || {};
(function () {
  "use strict";

  const ACK_KEY = "guidon:opsec-ack:v1";
  const REFERENCES = ["AR 530-1", "AR 25-2", "DoDI 5200.48", "AR 360-1"];
  const DISCLAIMER =
    "GUIDON is an unofficial, independent study aid and is not endorsed by the Department of Defense, the U.S. Army, or any government agency. " +
    "Its built-in curriculum is limited to publicly released, unclassified sources and synthetic examples. Do not enter classified information, Controlled Unclassified Information (CUI), real operational orders or rosters, sensitive personal data, or information your organization has not authorized for storage on this device. " +
    "Input screening is a safety aid — it is not a declassification, CUI determination, public-release determination, legal opinion, or authorization to use GUIDON on a government network. " +
    "References: " + REFERENCES.join(", ") + ".";

  /* Severity is advice to the caller, not an action taken here:
       stop  - real marking syntax. Callers do not read or save the text.
       check - worth a deliberate look (a Social Security or DoD ID number, a
               sentence stating a classification, a future date + place for a
               unit activity). Callers ask the Soldier before going on.
       note  - routine contact details every real MOI carries (a POC phone,
               an email, a labelled UIC). Callers mention it and carry on. */
  const STOP = "stop", CHECK = "check", NOTE = "note";

  const LEVEL = "TOP SECRET|SECRET|CONFIDENTIAL";
  const MON = "(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUNE?|JULY?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)";
  const MON3 = "(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)";
  const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  /* ---- marking syntax (all case-SENSITIVE: real markings are upper-case,
     and "a restricted report is confidential" is just English) ---- */
  // "(S//NF)", "(U//FOUO)", "(CUI//SP-PRVCY)": a "//" inside a portion mark is unmistakable anywhere.
  const PORTION_CONTROL_RE = /\((?:TS|S|C|U|CUI)\/\/[A-Z][A-Z0-9 ,\/-]*\)/g;
  // "SECRET//NOFORN", "CUI // SP-PRVCY", "UNCLASSIFIED//FOUO", "TS//SCI": the "//" separator IS the syntax.
  // (A single "/" - "TS/SCI clearance", "CUI/FOUO is unclassified" - is ordinary prose and is not matched.)
  const CONTROL_RE = new RegExp("\\b(?:" + LEVEL + "|UNCLASSIFIED|CONTROLLED|CUI|TS|S|C|U)[ \\t]*\\/\\/[ \\t]*[A-Z][A-Z0-9,\\/-]*(?:[ \\t]+[A-Z][A-Z0-9,\\/-]*){0,5}", "g");
  // A line that is nothing but the marking: the banner at the top/bottom of a page.
  const BANNER_LINE_RE = new RegExp("^[ \\t]*(?:" + LEVEL + "|CUI|FOUO|FOR OFFICIAL USE ONLY)[ \\t\\r]*$", "gm");
  // A PDF page read as one long line: the same level opens AND closes it (header + footer banner).
  const PAGE_BANNER_RE = new RegExp("^[ \\t]*(" + LEVEL + ")\\b[^\\n]{60,}\\b\\1[ \\t\\r]*$", "gm");
  // "CLASSIFICATION: SECRET" / "Overall classification: TOP SECRET".
  const LABEL_RE = new RegExp("\\b(?:OVERALL[ \\t]+|Overall[ \\t]+)?(?:CLASSIFICATION|Classification|classification)[ \\t]*:[ \\t]*(?:" + LEVEL + ")\\b", "g");
  // The CUI designation block on a marked document's first page.
  const CUI_BLOCK_RE = /^[ \t]*CUI Categor(?:y(?:\(ies\))?|ies)[ \t]*:/gm;
  // "(S) The unit..." - a simple portion mark only counts where a portion STARTS (a new line, optionally
  // after "1." / "a." / "(1)" / a bullet, or right after a sentence ends). Mid-sentence "(S)" / "(C)" /
  // "(CUI)" is how ordinary text abbreviates ("equipment on hand (S)", "Controlled Unclassified Information (CUI)").
  const PORTION_MARK = "\\((?:TS|S|C|CUI|" + LEVEL + ")\\)";
  const NOT_A_YEAR = "(?![ \\t]+(?:19|20)\\d{2}\\b)"; // "(C) 2024 ..." is a copyright line
  const PORTION_LINE_RE = new RegExp("(^|\\n)([ \\t]*(?:(?:\\d{1,2}|[A-Za-z])[.)][ \\t]+|\\(\\d{1,2}\\)[ \\t]+|[-*\\u2022][ \\t]+)?)(" + PORTION_MARK + ")" + NOT_A_YEAR + "(?=[ \\t]+\\S)", "g");
  const PORTION_SENTENCE_RE = new RegExp("([.:;!?][ \\t]+(?:(?:\\d{1,2}|[a-z])[.)][ \\t]+)?)(" + PORTION_MARK + ")" + NOT_A_YEAR + "(?=[ \\t]+[A-Z0-9])", "g");
  // A lettered list or mnemonic ("(M) Massive hemorrhage / (A) Airway / ... (C) Circulation", SALUTE's
  // "(S) Size") uses letters no portion mark ever does. When one is present, a bare "(S)" / "(C)" is a list label.
  const LETTER_LIST_RE = /(?:^|\n|[.:;,][ \t]+)[ \t]*\([ABD-RTV-Z]\)[ \t]+\S/;
  // "This annex is classified SECRET." - a sentence, not marking syntax, so it is a check, never a stop.
  const STATEMENT_RE = new RegExp("\\b(?:is|are|was|were|remains|marked|classified|classified as)[ \\t]+(?:" + LEVEL + ")(?=[ \\t]*(?:[.;!?)]|$))", "gm");

  /* ---- identifiers ---- */
  // Hyphenated NNN-NN-NNNN only. The old pattern allowed a space or nothing between groups, which is
  // exactly the shape of a regulation number followed by its year ("600-20 2020", "385-10 2023").
  const SSN_RE = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;
  const SSN_LABELLED_RE = /\b(?:SSN|SSAN|Social\s+Security\s+(?:number|no\.?|#))[ \t]*[:#-]?[ \t]*((?!000|666|9\d\d)\d{3}[- ]?\d{2}[- ]?\d{4})\b/gi;
  const DOD_ID_RE = /\b(?:DOD\s*ID|DODID|EDIPI)\s*(?:NO\.?|NUMBER|#|:|-)?\s*(\d{10})\b/gi;
  // Label any case, code upper-case only: with /i on the code, "the UIC system" read "system" as a UIC.
  const UIC_RE = /\b(?:[Uu][Ii][Cc]|[Uu]nit\s+[Ii]dentification\s+[Cc]ode|UNIT\s+IDENTIFICATION\s+CODE)[ \t]*(?:#|:|-)?[ \t]*([A-Z0-9]{6})\b/g;
  const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  // One separator used consistently: "635-200 2021" (a regulation and its year) mixes two and is not a phone number.
  const PHONE_RE = /(?:\+?1[ .-]?)?(?:\(\d{3}\)[ ]?\d{3}[ .-]\d{4}|(\d{3})([ .-])\d{3}\2\d{4})\b/g;
  const TOLL_FREE_RE = /^(?:\+?1[ .-]?)?\(?(?:800|833|844|855|866|877|888)\)?/; // published hotlines, never a person's number
  // A number that directly follows a publication or form type is a citation, whatever its shape.
  const PUB_BEFORE_RE = /\b(?:AR|DA\s+PAM|PAM|FM|TC|TM|TB|ATP|ADP|ADRP|ATTP|STP|GTA|CTA|NSN|(?:DA|DD|SF|OF)\s+FORM|FORM)\s*$/i;

  /* ---- future date + place + unit activity ---- */
  const ISO_DATE_RE = /\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/g;
  const US_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/g;
  const LONG_DATE_RE = new RegExp("\\b(" + MON + ")\\.?[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?,?[ \\t]+(20\\d{2})\\b", "gi");
  const ARMY_DATE_RE = new RegExp("\\b(\\d{1,2})[ \\t]*(" + MON + ")\\.?[ \\t]*(20\\d{2}|\\d{2})\\b", "gi");
  const DTG_RE = new RegExp("\\b(\\d{2})\\d{4}[A-Z]?[ \\t]?(" + MON3 + ")[ \\t]?(20\\d{2}|\\d{2})\\b", "g");
  const OPS_RE = /\b(?:deploy(?:s|ed|ing|ment|ments)?|redeploy\w*|movement|convoy|line of departure|live[- ]fire|training area|assembly area|range|grid|MGRS|coordinates?)\b/i;
  const OPS_ABBR_RE = /\b(?:SP [Tt]ime|SP TIME|LD [Tt]ime|LD TIME|PZ|LZ|DZ|OBJ|TAA|FTX)\b/;
  // A preposition (any case) then a CAPITALISED name. The old pattern carried /i, so "[A-Z]" matched
  // lower-case too and "in the", "to fill", "at all" all counted as a location.
  const NOT_A_PLACE = "(?!(?:AR|FM|TC|TM|ADP|ADRP|ATP|STP|DA|DD|PAM|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[a-z]*\\b)";
  const PLACE_RE = new RegExp("\\b(?:[Aa][Tt]|[Ii][Nn]|[Nn][Ee][Aa][Rr]|[Tt][Oo]|[Ff][Rr][Oo][Mm]|[Vv][Ii][Cc](?:inity|INITY)?(?:[ \\t]+(?:of|OF))?)[ \\t]+(?:(?:the|THE)[ \\t]+)?" + NOT_A_PLACE + "[A-Z][A-Za-z0-9.'-]*");
  const NAMED_PLACE_RE = /\b(?:Fort|FORT|Ft\.?|FT\.?|Camp|CAMP|FOB|COP|Range|RANGE|OBJ|Objective|OBJECTIVE|PZ|LZ|DZ|TAA)[ \t]+[A-Z0-9][A-Za-z0-9-]*/;
  const MGRS_RE = /\b\d{1,2}[C-HJ-NP-X][ \t]?[A-HJ-NP-Z]{2}[ \t]?\d{2,5}[ \t]?\d{2,5}\b/;
  const ABBREV_BEFORE_DOT_RE = /\b(?:Ft|Mt|St|No|Bldg|Rm|Co|Bn|Bde|Div|Vic|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$/i;

  const MAX_PER_CODE = 20; // a pasted roster could carry hundreds of phone numbers; the Soldier needs the pattern, not a wall

  /* What a finding looks like, in words a Soldier would use. Callers build their own sentences around it. */
  const LOOKS_LIKE = {
    "portion-marking": "a classification or handling marking",
    "control-marking": "a classification or handling marking",
    "banner-marking": "a classification or handling marking",
    "page-banner-marking": "a classification or handling marking",
    "classification-label": "a classification or handling marking",
    "cui-designation": "a CUI handling block",
    "classification-statement": "a sentence saying the text is classified",
    "ssn": "a Social Security number",
    "dod-id": "a DoD ID number",
    "uic": "a unit identification code",
    "email": "an email address",
    "phone": "a phone number",
    "future-operation-location": "a future date and place for a unit activity",
  };

  function scan(re, text, fn) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) { fn(m); if (m.index === re.lastIndex) re.lastIndex++; }
  }

  function validDate(y, mo, d) {
    if (!(mo >= 0 && mo <= 11 && d >= 1 && d <= 31)) return null;
    const dt = new Date(y, mo, d);
    return (dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d) ? dt : null;
  }
  function fullYear(s) { return s.length === 2 ? 2000 + Number(s) : Number(s); }
  function monthOf(s) { return MONTH_INDEX[String(s).slice(0, 3).toLowerCase()]; }

  // Every calendar date the text names, in the formats Soldiers actually write: ISO, M/D/YYYY,
  // "Month D, YYYY", the Army's "DD MON YY(YY)" and a date-time group.
  function findDates(text) {
    const out = [];
    function add(m, dt) { if (dt && !out.some((o) => m.index < o.end && m.index + m[0].length > o.start)) out.push({ start: m.index, end: m.index + m[0].length, date: dt }); }
    scan(DTG_RE, text, (m) => add(m, validDate(fullYear(m[3]), monthOf(m[2]), Number(m[1]))));
    scan(ISO_DATE_RE, text, (m) => add(m, validDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
    scan(US_DATE_RE, text, (m) => add(m, validDate(fullYear(m[3]), Number(m[1]) - 1, Number(m[2]))));
    scan(LONG_DATE_RE, text, (m) => add(m, validDate(Number(m[3]), monthOf(m[1]), Number(m[2]))));
    scan(ARMY_DATE_RE, text, (m) => {
      // "3 may 30 Soldiers": an all-lower-case month with a two-digit "year" is the verb, not a date.
      if (m[3].length === 2 && m[2] === m[2].toLowerCase()) return;
      add(m, validDate(fullYear(m[3]), monthOf(m[2]), Number(m[1])));
    });
    return out;
  }

  // The sentence (or line) a match sits in. The date, the place and the activity have to share one:
  // "The board convenes January 14, 2027 in the conference room. Topics: grid coordinates." is a board
  // date followed by a study topic, not a movement.
  function sentenceAround(text, start, end) {
    function abbrev(i) { return ABBREV_BEFORE_DOT_RE.test(text.slice(Math.max(0, i - 6), i)); }
    let s = start, e = end;
    while (s > 0) {
      const ch = text[s - 1];
      if (ch === "\n" || ch === ";") break;
      if ((ch === "." || ch === "!" || ch === "?") && /\s/.test(text[s] || "") && !(ch === "." && abbrev(s - 1))) break;
      s--;
    }
    while (e < text.length) {
      const ch = text[e];
      if (ch === "\n" || ch === ";") break;
      if ((ch === "." || ch === "!" || ch === "?") && (e + 1 >= text.length || /\s/.test(text[e + 1])) && !(ch === "." && abbrev(e))) { e++; break; }
      e++;
    }
    return { start: s, end: e, text: text.slice(s, e) };
  }

  function screen(input, options) {
    options = options || {};
    const text = String(input == null ? "" : input);
    const findings = [];
    const perCode = {};
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
    function lineOf(offset) { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; } return lo + 1; }

    function excerptOf(start, end, mask) {
      // Context stays inside the finding's own line: the notice says "Line 3", so the quote must be line 3.
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = text.indexOf("\n", end); if (lineEnd === -1) lineEnd = text.length;
      const from = Math.max(lineStart, start - 28), to = Math.min(lineEnd, end + 28);
      let hit = text.slice(start, end);
      // Display-only: the notice should locate a Social Security / DoD ID number without repeating it in full.
      if (mask) { let keep = 4; hit = hit.split("").reverse().map((c) => (/\d/.test(c) ? (keep-- > 0 ? c : "•") : c)).reverse().join(""); }
      const s = (from > lineStart ? "…" : "") + text.slice(from, start) + hit + text.slice(end, to) + (to < lineEnd ? "…" : "");
      return s.replace(/\s+/g, " ").trim();
    }
    function add(code, severity, start, end, opts) {
      opts = opts || {};
      // One finding per stretch of text: "(S//NF)" is a portion mark, not also a "//" control string.
      if (findings.some((f) => start < f.end && end > f.start)) return;
      perCode[code] = (perCode[code] || 0) + 1;
      if (perCode[code] > MAX_PER_CODE) return;
      findings.push({ code: code, severity: severity, looksLike: LOOKS_LIKE[code], start: start, end: end, line: lineOf(start),
        excerpt: opts.excerpt != null ? opts.excerpt : excerptOf(start, end, !!opts.mask) });
    }
    function afterPubType(offset) { return PUB_BEFORE_RE.test(text.slice(Math.max(0, offset - 12), offset)); }

    /* marking syntax */
    scan(PORTION_CONTROL_RE, text, (m) => add("portion-marking", STOP, m.index, m.index + m[0].length));
    scan(CONTROL_RE, text, (m) => add("control-marking", STOP, m.index, m.index + m[0].replace(/[ \t]+$/, "").length));
    scan(BANNER_LINE_RE, text, (m) => { const lead = m[0].length - m[0].replace(/^[ \t]+/, "").length; add("banner-marking", STOP, m.index + lead, m.index + m[0].replace(/[ \t\r]+$/, "").length); });
    scan(PAGE_BANNER_RE, text, (m) => { const lead = m[0].length - m[0].replace(/^[ \t]+/, "").length; add("page-banner-marking", STOP, m.index + lead, m.index + lead + m[1].length); });
    scan(LABEL_RE, text, (m) => add("classification-label", STOP, m.index, m.index + m[0].length));
    scan(CUI_BLOCK_RE, text, (m) => add("cui-designation", STOP, m.index, m.index + m[0].length));
    const letteredList = LETTER_LIST_RE.test(text);
    function portion(m) {
      const mark = m[m.length - 1], at = m.index + m[0].length - mark.length;
      if (letteredList && /^\([SC]\)$/.test(mark)) return;
      add("portion-marking", STOP, at, at + mark.length);
    }
    scan(PORTION_LINE_RE, text, portion);
    scan(PORTION_SENTENCE_RE, text, portion);
    scan(STATEMENT_RE, text, (m) => add("classification-statement", CHECK, m.index, m.index + m[0].length));

    /* identifiers */
    scan(SSN_LABELLED_RE, text, (m) => { const at = m.index + m[0].length - m[1].length; add("ssn", CHECK, at, at + m[1].length, { mask: true }); });
    scan(SSN_RE, text, (m) => { if (!afterPubType(m.index)) add("ssn", CHECK, m.index, m.index + m[0].length, { mask: true }); });
    scan(DOD_ID_RE, text, (m) => { const at = m.index + m[0].length - m[1].length; add("dod-id", CHECK, at, at + m[1].length, { mask: true }); });
    scan(UIC_RE, text, (m) => {
      // Army UICs start with "W"; anything else must at least carry a digit, so "UIC FORMAT" is not a code.
      if (!/^W/.test(m[1]) && !/\d/.test(m[1])) return;
      const at = m.index + m[0].length - m[1].length; add("uic", NOTE, at, at + m[1].length);
    });
    scan(EMAIL_RE, text, (m) => add("email", NOTE, m.index, m.index + m[0].length));
    scan(PHONE_RE, text, (m) => {
      const before = text[m.index - 1] || "";
      if (/[\d-]/.test(before)) return;            // the tail of a longer number (a stock number, a serial)
      if (afterPubType(m.index)) return;           // "AR 635-200-..." is a citation
      if (TOLL_FREE_RE.test(m[0])) return;         // a published hotline
      add("phone", NOTE, m.index, m.index + m[0].length);
    });

    /* a date that has not happened yet + a named place + a unit activity, all in one sentence */
    const now = options.now != null ? new Date(options.now) : new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // the real clock, never a hard-coded year
    findDates(text).forEach((d) => {
      if (d.date < today) return;
      const sent = sentenceAround(text, d.start, d.end);
      if (!(OPS_RE.test(sent.text) || OPS_ABBR_RE.test(sent.text))) return;
      if (!(PLACE_RE.test(sent.text) || NAMED_PLACE_RE.test(sent.text) || MGRS_RE.test(sent.text))) return;
      let ex = sent.text.replace(/\s+/g, " ").trim();
      if (ex.length > 160) ex = excerptOf(d.start, d.end, false);
      add("future-operation-location", CHECK, d.start, d.end, { excerpt: ex });
    });

    findings.sort((a, b) => a.start - b.start);
    const has = (sev) => findings.some((f) => f.severity === sev);
    return {
      text: text,                 // exactly what came in - this module never edits it
      findings: findings,
      stop: has(STOP),
      check: has(CHECK),
      note: has(NOTE),
      clean: findings.length === 0,
    };
  }

  // "a phone number and an email address" / "2 phone numbers" - for a caller's one-line summary.
  function listWhat(findings) {
    const seen = [], out = [];
    (findings || []).forEach((f) => { if (seen.indexOf(f.looksLike) === -1) { seen.push(f.looksLike); out.push(f.looksLike); } });
    if (out.length <= 1) return out.join("");
    return out.slice(0, -1).join(", ") + " and " + out[out.length - 1];
  }

  function showDisclaimerOnce() {
    // Browser automation exercises app behavior through synthetic clicks; a delayed
    // acknowledgement modal would steal those clicks and turn unrelated suites flaky.
    // The guard API remains fully testable, while real interactive launches still see it.
    if (typeof navigator !== "undefined" && navigator.webdriver === true) return;
    // Kept through G.db.local like every other small on-device flag: a Guest
    // or Kiosk session's "I understand" is not remembered for the next
    // person who opens the app on this device.
    const acknowledged = G.db.local.get(ACK_KEY) === "accepted";
    if (acknowledged || !G.modal || typeof G.modal.confirm !== "function") return;
    setTimeout(async function () {
      try {
        // Without a title the dialog's heading (and its accessible name) fell back to the generic "Confirm".
        const ok = await G.modal.confirm(DISCLAIMER, { title: "Before you start", okText: "I understand", cancelText: "Not yet" });
        if (ok) G.db.local.set(ACK_KEY, "accepted");
      } catch (e) {}
    }, 250);
  }

  G.opsecGuard = {
    ACK_KEY: ACK_KEY,
    REFERENCES: REFERENCES.slice(),
    DISCLAIMER: DISCLAIMER,
    SEVERITY: { STOP: STOP, CHECK: CHECK, NOTE: NOTE },
    screen: screen,
    listWhat: listWhat,
    showDisclaimerOnce: showDisclaimerOnce,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showDisclaimerOnce, { once: true });
  else showDisclaimerOnce();
})();
