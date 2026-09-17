/* ==== js/05-opsec-guard.js ==== */
/* GUIDON — local-only OPSEC / sensitive-input guard.

   This is a PREVENTION aid, not a classification authority. It never claims
   that redacted material is releasable, unclassified, or safe to distribute.
   Marked classified/CUI-looking input is blocked from GUIDON persistence and
   the user is told to stop and follow organizational reporting/handling rules.
   Direct identifiers can be redacted locally. Aggregation-risk patterns are
   flagged for removal/review rather than "sanitized" into a false safe state.
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

  const BLOCK_PATTERNS = [
    { code: "classified-marking", label: "classification marking", re: /(^|[\s\[/])(TOP\s+SECRET|SECRET|CONFIDENTIAL)(?=$|[\s\]\\/:;,-])/i },
    { code: "cui-marking", label: "CUI marking", re: /\bCONTROLLED\s+UNCLASSIFIED\s+INFORMATION\b|(^|[\s\[/])CUI(?:\/[\/A-Z0-9_-]+)?(?=$|[\s\]\\:;,-])/i },
    { code: "dissemination-control", label: "controlled dissemination marking", re: /\b(NOFORN|REL\s+TO|FEDCON)\b/i },
  ];

  const SSN_RE = /\b(?!000|666|9\d\d)\d{3}[- ]?\d{2}[- ]?\d{4}\b/g;
  const DOD_ID_RE = /\b(?:DOD\s*ID|DODID|EDIPI)\s*(?:NO\.?|NUMBER|#|:|-)?\s*(\d{10})\b/gi;
  const UIC_RE = /\b(?:UIC|UNIT\s+IDENTIFICATION\s+CODE)\s*(?:#|:|-)?\s*([A-Z0-9]{6})\b/gi;
  const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const PHONE_RE = /(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}\b/g;
  const FUTURE_YEAR_RE = /\b(?:20(?:2[7-9]|[3-9]\d))[-/]\d{1,2}[-/]\d{1,2}\b|\b(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+\d{1,2}(?:ST|ND|RD|TH)?(?:,)?\s+20(?:2[7-9]|[3-9]\d)\b/i;
  const OPS_CONTEXT_RE = /\b(DEPLOY(?:MENT|ING)?|MOVEMENT|CONVOY|SP\s+TIME|LD\s+TIME|LINE\s+OF\s+DEPARTURE|LIVE[- ]FIRE|TRAINING\s+AREA|RANGE|ASSEMBLY\s+AREA|MGRS|GRID|COORDINATE|PZ|LZ|OBJ(?:ECTIVE)?)\b/i;
  const LOCATION_CONTEXT_RE = /\b(?:AT|IN|NEAR|TO)\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){0,4}\b/;

  function finding(code, label, detail) { return { code: code, label: label, detail: detail || "" }; }

  function sanitizeInput(input, options) {
    options = options || {};
    const original = String(input == null ? "" : input);
    const blocks = [];
    const redactions = [];
    const flags = [];

    BLOCK_PATTERNS.forEach(function (p) {
      if (p.re.test(original)) blocks.push(finding(p.code, p.label, "Do not place marked material in GUIDON."));
    });

    // A blocking marking is never rewritten into a false "safe" document.
    if (blocks.length) {
      return { text: original, blocked: true, redactions: redactions, flags: flags, reasons: blocks, changed: false, requiresReview: true };
    }

    let text = original;
    function redact(re, replacement, code, label) {
      let count = 0;
      text = text.replace(re, function () { count++; return replacement; });
      if (count) redactions.push(finding(code, label, String(count) + " occurrence" + (count === 1 ? "" : "s") + " redacted locally."));
    }

    redact(SSN_RE, "[SSN REDACTED]", "ssn", "Social Security number");
    text = text.replace(DOD_ID_RE, function () {
      redactions.push(finding("dod-id", "DoD ID/EDIPI", "DoD ID/EDIPI redacted locally."));
      return "DoD ID [IDENTIFIER REDACTED]";
    });
    text = text.replace(UIC_RE, function () {
      redactions.push(finding("uic", "Unit Identification Code", "UIC redacted locally."));
      return "UIC [UNIT REDACTED]";
    });
    if (options.redactContact !== false) {
      redact(EMAIL_RE, "[EMAIL REDACTED]", "email", "email address");
      redact(PHONE_RE, "[PHONE REDACTED]", "phone", "phone number");
    }

    // Aggregation is context-dependent. Refuse to certify it by regex. If a
    // future date appears with operational/location context, require the user
    // to remove or fictionalize it before this text can be persisted.
    if (FUTURE_YEAR_RE.test(original) && OPS_CONTEXT_RE.test(original) && LOCATION_CONTEXT_RE.test(original)) {
      flags.push(finding("future-operation-location", "future operational date + location", "Remove or replace the real date/location with a synthetic training value before continuing."));
    }

    return {
      text: text,
      blocked: false,
      redactions: redactions,
      flags: flags,
      reasons: [],
      changed: text !== original,
      requiresReview: flags.length > 0,
    };
  }

  function decisionMessage(result) {
    if (!result) return "Input could not be screened.";
    if (result.blocked) return "GUIDON stopped this import because it contains a sensitive/control marking. Do not continue here. Follow your organization’s handling and incident-reporting procedures.";
    if (result.requiresReview) return "GUIDON found an aggregation-risk pattern. Remove or fictionalize the flagged operational date/location before continuing.";
    if (result.redactions && result.redactions.length) return "GUIDON locally redacted direct identifiers before use. Review the result; redaction does not make a document releasable.";
    return "No configured sensitive-input pattern was detected. This is not a classification or public-release determination.";
  }

  async function screenForPersistence(input, options) {
    const r = sanitizeInput(input, options);
    if (r.blocked || r.requiresReview) return r;
    return r;
  }

  function showDisclaimerOnce() {
    let acknowledged = false;
    try { acknowledged = localStorage.getItem(ACK_KEY) === "accepted"; } catch (e) {}
    if (acknowledged || !G.modal || typeof G.modal.confirm !== "function") return;
    setTimeout(async function () {
      try {
        const ok = await G.modal.confirm(DISCLAIMER, { okText: "I understand", cancelText: "Not yet" });
        if (ok) try { localStorage.setItem(ACK_KEY, "accepted"); } catch (e) {}
      } catch (e) {}
    }, 250);
  }

  G.util = G.util || {};
  G.util.sanitizeInput = sanitizeInput;
  G.opsecGuard = {
    ACK_KEY: ACK_KEY,
    REFERENCES: REFERENCES.slice(),
    DISCLAIMER: DISCLAIMER,
    sanitizeInput: sanitizeInput,
    screenForPersistence: screenForPersistence,
    decisionMessage: decisionMessage,
    showDisclaimerOnce: showDisclaimerOnce,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showDisclaimerOnce, { once: true });
  else showDisclaimerOnce();
})();
