/**
 * Legal package (GUIDON_COMMAND_LEGAL_PACKAGE.md), paragraph 4 and the audit
 * matrix: what the sensitive-text check (src/app-modules/05-opsec-guard.js)
 * recognizes, what it deliberately does NOT recognize, and that it only ever
 * reports. Pure node: the real module runs in a sandbox, no browser.
 *
 * WHY THIS SUITE EXISTS. tools/test-opsec-guard.mjs proves the check through
 * the real page against a table of representative rows. The package goes
 * further: it LISTS every recognized shape ("an upper-case banner line
 * consisting only of TOP SECRET, SECRET, CONFIDENTIAL, CUI, FOUO, or FOR
 * OFFICIAL USE ONLY", "(TS), (S), (C), (CUI), or a spelled-out level ... at the
 * start of a line, list item, or sentence" ...) and states what is not
 * recognized. A reader takes each list literally, so each item is tried here,
 * one at a time, and so is each thing the package says is not detected.
 *
 * Every assertion is tagged with the claim it stands behind - [LP-030] is
 * claim LP-030 in tools/legal-package-claims.json - and
 * tools/verify-legal-package.mjs --run refuses a claim whose tag never printed
 * a PASS. Rename a claim's wording in the package and the map, not the tag.
 *
 * No dates are written into the assertions: every date comes from the real
 * clock, so nothing here expires.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { finish } from "./testkit.mjs";
import { check, tag, list } from "./legal-package-kit.mjs";

const APP = fileURLToPath(new URL("../", import.meta.url));
// LP_GUARD_FILE points the suite at a scratch copy of the module, so the suite itself can be shown to FAIL
// against a planted defect (tools/test-legal-package-verifier.mjs does exactly that). Unset, it is the real file.
const GUARD_FILE = process.env.LP_GUARD_FILE || APP + "src/app-modules/05-opsec-guard.js";

/* ---- the real module, in a sandbox ---- */
const G = {};
const windowMock = { G };
windowMock.window = windowMock;
const sandbox = {
  window: windowMock, G, console,
  document: { readyState: "loading", addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  navigator: { webdriver: true },
  setTimeout() { return 0; }, clearTimeout() {},
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(GUARD_FILE, "utf8"), sandbox, { filename: "05-opsec-guard.js" });
const guard = G.opsecGuard;

const seen = []; // every input ever screened: "never edits" is judged over ALL of them
function scr(text, options) {
  const r = guard.screen(text, options);
  seen.push({ text, r });
  return r;
}
const codes = (text, options) => scr(text, options).findings.map((f) => f.code + ":" + f.severity).join(",");
const stops = (text) => scr(text).findings.filter((f) => f.severity === "stop").map((f) => f.code);
/** Which of `samples` is NOT read as `want` (a code) and severity - the failing ones, for a useful message. */
function notRead(samples, want, severity) {
  return samples.filter((s) => { const f = scr(s).findings; return !(f.length >= 1 && f.every((x) => x.code === want && x.severity === severity)); });
}

/* ---- dates from the real clock ---- */
const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const p2 = (n) => String(n).padStart(2, "0");
const at = (days) => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + days); };
const forms = (d) => {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  return { "ISO": `${y}-${p2(m + 1)}-${p2(day)}`, "M/D/YYYY": `${m + 1}/${day}/${y}`, "Month D, YYYY": `${MONTHS[m]} ${day}, ${y}`,
    "Army DD MON YYYY": `${day} ${MON3[m]} ${y}`, "Army DD MON YY": `${day} ${MON3[m]} ${String(y).slice(2)}`, "date-time group": `${p2(day)}0600Z${MON3[m]}${String(y).slice(2)}` };
};

/* ======================================================================
   The module as shipped
   ====================================================================== */
{
  const keys = Object.keys(guard).sort();
  const api = ["ACK_KEY", "DISCLAIMER", "REFERENCES", "SEVERITY", "listWhat", "screen", "showDisclaimerOnce"];
  const rewriting = keys.filter((k) => /sanit|redact|scrub|mask|censor|strip|clean|rewrite/i.test(k));
  const shape = Object.keys(guard.screen("plain study text")).sort();
  check(rewriting.length === 0 && keys.join() === api.join() && shape.join() === ["check", "clean", "findings", "note", "stop", "text"].join(),
    tag("LP-027", "LP-124") + " the check exports only screen() and its helpers - no sanitize / redact / clean-up function - and a result carries the ORIGINAL text, the findings and three flags, never a second, altered copy",
    () => "exports " + keys.join(",") + "; result keys " + shape.join(","));
}

/* ======================================================================
   4a. Marking syntax - every recognized form, one at a time
   ====================================================================== */
const BANNER_WORDS = ["TOP SECRET", "SECRET", "CONFIDENTIAL", "CUI", "FOUO", "FOR OFFICIAL USE ONLY"];
{
  const alone = notRead(BANNER_WORDS, "banner-marking", "stop");
  const inPage = BANNER_WORDS.filter((w) => { const r = scr(`Unit training schedule\n${w}\nMore text follows.`); return !(r.findings.length === 1 && r.findings[0].code === "banner-marking" && r.findings[0].line === 2 && r.stop); });
  const padded = notRead(BANNER_WORDS.map((w) => `   ${w}   `), "banner-marking", "stop");
  check(alone.length === 0 && inPage.length === 0 && padded.length === 0,
    tag("LP-030", "LP-171", "LP-121") + " each of the six banner words - TOP SECRET, SECRET, CONFIDENTIAL, CUI, FOUO, FOR OFFICIAL USE ONLY - alone on a line is a stop finding, on its own line in a page (line 2) and with spaces around it",
    () => "not read as a banner: alone " + list(alone) + "; in a page " + list(inPage) + "; padded " + list(padded));
  const notBanners = ["SECRET operational annex handling is covered in AR 380-5.", "CUI is unclassified information that requires safeguarding.", "The FOUO caveat was retired in 2010.", "FOR OFFICIAL USE ONLY items need a cover sheet."];
  const wrongly = notBanners.filter((s) => stops(s).length);
  check(wrongly.length === 0, tag("LP-030") + " a banner word is a banner only when it is the whole line - the same words inside a sentence are not", () => "stopped: " + list(wrongly));
}
{
  const samples = ["SECRET//NOFORN", "CUI//SP-PRVCY", "UNCLASSIFIED//FOUO", "TS//SCI", "TOP SECRET//SI//NOFORN", "CUI // SP-PRVCY", "UNCLASSIFIED//FOR OFFICIAL USE ONLY", "Header reads SECRET//NOFORN on every page.", "CONFIDENTIAL//REL TO USA"];
  const miss = notRead(samples, "control-marking", "stop");
  check(miss.length === 0, tag("LP-031", "LP-171", "LP-121") + " an upper-case control string joined by // is a stop finding: SECRET//NOFORN, CUI//SP-PRVCY, UNCLASSIFIED//FOUO, TS//SCI and their neighbours, alone or in a line", () => "not read as a control string: " + list(miss));
}
{
  const start = ["TS", "S", "C", "CUI", "SECRET", "TOP SECRET", "CONFIDENTIAL"].map((m) => `(${m}) The company departs the assembly area.`);
  const listItem = ["1. (S) The company occupies the position.", "a. (C) The platoon moves.", "(1) (TS) The plan follows.", "- (CUI) The roster is attached.", "• (S) The unit reports."];
  const afterSentence = ["Situation follows. (S) Enemy forces are template only.", "Mission: (C) Secure the objective."];
  const withSlashes = ["(S//NF) The unit will depart.", "(U//FOUO) Distribution list", "SUBJECT: (U//FOUO) Distribution list", "(CUI//SP-PRVCY) The roster is attached.", "(TS//SCI) Annex B."];
  const missA = notRead(start, "portion-marking", "stop");
  const missB = notRead(listItem, "portion-marking", "stop");
  const missC = notRead(afterSentence, "portion-marking", "stop");
  const missD = notRead(withSlashes, "portion-marking", "stop");
  check(missA.length + missB.length + missC.length + missD.length === 0,
    tag("LP-032", "LP-171", "LP-121") + " a parenthesized portion mark - (TS), (S), (C), (CUI) or a spelled-out level - is a stop finding at the start of a line, of a numbered/lettered/bulleted list item and of a sentence; and any portion mark containing // such as (S//NF) or (U//FOUO) anywhere",
    () => "not read: line start " + list(missA) + "; list item " + list(missB) + "; sentence " + list(afterSentence.filter((s) => missC.includes(s))) + "; with // " + list(missD));
  const midSentence = ["equipment on hand (S) and readiness (C) are reported separately.", "Controlled Unclassified Information (CUI) is governed by 32 CFR Part 2002.", "Section 402(b)(1)(C) provides that the rate may not decrease.", "The ratings are personnel (P), equipment on hand (S), equipment readiness (R), and training (T)."];
  const wrongly = midSentence.filter((s) => stops(s).length);
  check(wrongly.length === 0, tag("LP-032", "LP-036") + " the same letters in parentheses in the middle of a sentence (an acronym, a statute subsection, a readiness rating) are not a portion mark", () => "stopped: " + list(wrongly));
  // Any mark containing // is unmistakable, wherever it stands and whatever else the text holds.
  const lettered = "(A) Alpha item\n(B) Bravo item\n";
  const slashMisses = withSlashes.concat(withSlashes.map((s) => lettered + s)).filter((s) => !stops(s).length);
  check(slashMisses.length === 0, tag("LP-194") + " any portion mark containing // - (S//NF), (U//FOUO), (CUI//SP-PRVCY), (TS//SCI) - is a stop finding anywhere in a line, alone or in a text that also holds lettered list items", () => "not stopped: " + list(slashMisses));
  // LP-032 - (S) and (C) are the two portion marks that are ALSO the first letters of common lettered mnemonics (SALUTE's "(S) Size", MARCH's
  // "(C) Circulation"), so a bare one is read as a list label - but only when it really is one label of a lettered list (the rule is in
  // src/app-modules/05-opsec-guard.js: a run of three or more consecutive lettered items, at least two with letters no portion mark uses, every item
  // label-shaped, and the mark's own letter once). It used to be enough for the text to hold "(A) ..." anywhere, so a real marked document with
  // lettered subparagraphs passed on its (S) and (C) marks.
  const marks = ["(S) The unit departs the area.", "(C) The unit departs the area."];
  const alone = marks.filter((s) => !stops(s).length);
  const passesWithList = marks.map((s) => lettered + s).filter((s) => !stops(s).length);
  const stillStopped = ["(TS) The unit departs the area.", "(CUI) The roster is attached.", "(SECRET) annex", "(TOP SECRET) annex"].map((s) => lettered + s).filter((s) => !stops(s).length);
  const realDoc = "(A) Purpose\n(B) Scope\n(S) The battalion occupies the assembly area.\n(C) The company moves at first light.\n(S) Enemy activity is expected.";
  const docStops = stops(realDoc).length;
  check(alone.length === 0 && passesWithList.length === 0 && stillStopped.length === 0 && docStops === 3,
    tag("LP-032") + " a bare (S) or (C) portion mark at the start of a line stops the import on its own AND when the text also contains lettered list items such as '(A) ...' / '(B) ...'; (TS), (CUI) and spelled-out levels still stop it in the same text; a marked document with lettered subparagraphs is stopped on each of its three (S)/(C) marks",
    () => "unstopped alone: " + list(alone) + "; unstopped after a lettered list: " + list(passesWithList) + "; others unstopped: " + list(stillStopped) + "; marks stopped in the sample document: " + docStops + " of 3");
  // The two mnemonics the exemption exists for - and the other forms real study text writes them in - are still not stopped.
  const mnemonics = {
    "SALUTE, one item per line": "(S) Size\n(A) Activity\n(L) Location\n(U) Unit\n(T) Time\n(E) Equipment",
    "MARCH, one item per line": "(M) Massive hemorrhage\n(A) Airway\n(R) Respiration\n(C) Circulation\n(H) Hypothermia",
    "SALUTE on one line": "SALUTE: (S) Size, (A) Activity, (L) Location, (U) Unit, (T) Time, (E) Equipment",
    "SALUTE, numbered": "1. (S) Size\n2. (A) Activity\n3. (L) Location\n4. (U) Unit\n5. (T) Time\n6. (E) Equipment",
    "SALUTE, Windows line ends": "(S) Size\r\n(A) Activity\r\n(L) Location\r\n(U) Unit\r\n(T) Time\r\n(E) Equipment",
    "SALUTE, a blank line between items": "(S) Size\n\n(A) Activity\n\n(L) Location\n\n(U) Unit\n\n(T) Time\n\n(E) Equipment",
    "MARCH with an intro and a closing line": "Use the mnemonic below.\n(M) Massive hemorrhage\n(A) Airway\n(R) Respiration\n(C) Circulation\n(H) Hypothermia\nThen reassess.",
    "MARCH, an explanation on each line": "(M) Massive hemorrhage: control it\n(A) Airway: open the airway\n(R) Respiration: decompress the chest\n(C) Circulation: check for shock.\n(H) Hypothermia: prevent heat loss.",
    "SMEAC": "(S) Situation\n(M) Mission\n(E) Execution\n(A) Administration and logistics\n(C) Command and signal",
    "OCOKA": "(O) Observation and fields of fire\n(C) Cover and concealment\n(O) Obstacles\n(K) Key terrain\n(A) Avenues of approach",
    "BAMCIS": "(B) Begin planning\n(A) Arrange reconnaissance\n(M) Make reconnaissance\n(C) Complete the plan\n(I) Issue the order\n(S) Supervise",
  };
  const wronglyStopped = Object.keys(mnemonics).filter((k) => stops(mnemonics[k]).length);
  check(wronglyStopped.length === 0, tag("LP-032") + " the mnemonics that use (S) and (C) as list labels - SALUTE, MARCH, SMEAC, OCOKA, BAMCIS, in " + Object.keys(mnemonics).length + " layouts (one per line, on one line, numbered, Windows line ends, blank lines between, with an explanation on each line) - are not read as portion marks", () => "wrongly stopped: " + list(wronglyStopped));
  // Not a list label: a run too short, a repeated mark, a sentence in the run, or a list with a marked sentence after it.
  const notLists = {
    "two items only": "(A) Alpha\n(S) Size",
    "the mark repeated": "(A) Alpha\n(B) Bravo\n(S) Charlie\n(S) Delta",
    "a sentence among the items": "(A) Alpha item\n(B) Bravo item\n(C) Circulation and hemorrhage control checks are made by the medic",
    "a list, then a marked sentence": mnemonics["SALUTE, one item per line"] + "\n\n(S) The enemy element departs at dawn.",
    "a lettered run far from the mark": "(S) Size\n(A) Activity\n\n\nOther text\n\n(L) Location",
  };
  const notStopped = Object.keys(notLists).filter((k) => !stops(notLists[k]).length);
  check(notStopped.length === 0, tag("LP-032") + " a bare (S) or (C) is NOT taken for a list label when the run is too short, the mark repeats, an item is a sentence, or a marked sentence follows a real list", () => "not stopped: " + list(notStopped));
  // What the rule still does not catch, said out loud so the claim's gap stays true: a marked line that is itself label-shaped (six words or fewer,
  // no closing punctuation) inside a run of three or more lettered items with two non-mark letters. Real marked text rarely looks like that;
  // if this starts failing the rule got stricter - update the gap in claim LP-032.
  const gap = ["(A) Alpha\n(B) Bravo\n(S) Charlie", "(A) Alpha\n(B) Bravo\n(C) Situation: The unit departs."];
  const nowStopped = gap.filter((s) => stops(s).length);
  check(nowStopped.length === 0, tag("LP-032") + " the documented remaining gap is real: a label-shaped bare (S)/(C) inside a run of three lettered items (two of them non-mark letters) is still read as a list label", () => "now stopped (update claim LP-032's gap): " + list(nowStopped));
}
{
  const labels = ["CLASSIFICATION: SECRET", "CLASSIFICATION: TOP SECRET", "Classification: CONFIDENTIAL", "Overall classification: TOP SECRET", "OVERALL CLASSIFICATION: SECRET"];
  const miss = notRead(labels, "classification-label", "stop");
  const unrecognized = ["CLASSIFICATION: secret", "Classification: Secret", "CLASSIFICATION SECRET"];
  const wrongly = unrecognized.filter((s) => stops(s).length);
  check(miss.length === 0 && wrongly.length === 0, tag("LP-033", "LP-036") + " a CLASSIFICATION: <level> label with an upper-case level is a stop finding; the same label with a lower- or mixed-case level, or with no colon, is not", () => "not read: " + list(miss) + "; wrongly read: " + list(wrongly));
}
{
  const blocks = ["CUI Category: PRVCY", "Controlled by: G-1\nCUI Category: PRVCY\nLDC: FEDCON", "CUI Categories: PRVCY, PRIVILEGE", "CUI Category(ies): PRVCY"];
  const miss = notRead(blocks, "cui-designation", "stop");
  check(miss.length === 0, tag("LP-034", "LP-121") + " a CUI Category: designation line is a stop finding", () => "not read: " + list(miss));
}
{
  const long = (lv) => `${lv} HEADQUARTERS 1ST BATTALION 5TH INFANTRY OPERATION ORDER 26-01 Task organization follows and continues on this page ${lv}`;
  const banners = ["TOP SECRET", "SECRET", "CONFIDENTIAL"].map(long);
  const miss = notRead(banners, "page-banner-marking", "stop");
  const notOne = [`SECRET ${"word ".repeat(20)}CONFIDENTIAL`, "SECRET short line SECRET", `the ${"word ".repeat(20)} SECRET`];
  const wrongly = notOne.filter((s) => stops(s).length);
  check(miss.length === 0 && wrongly.length === 0, tag("LP-035", "LP-171") + " one long line that opens and closes with the same classification level (a page whose header and footer banners were read as one line) is a stop finding; a short line, or one that ends on a different level, is not", () => "not read: " + list(miss) + "; wrongly read: " + list(wrongly));
}

/* ---- what is NOT recognized ---- */
{
  const caseVariants = (w) => [w.toLowerCase(), w.split(" ").map((x) => x[0] + x.slice(1).toLowerCase()).join(" ")];
  const words = ["TOP SECRET", "SECRET", "CONFIDENTIAL", "CUI", "FOUO", "FOR OFFICIAL USE ONLY", "UNCLASSIFIED", "TS"];
  const frames = [(w) => w, (w) => `${w}//NOFORN`, (w) => `(${w}) The company moves.`, (w) => `1. (${w}) The company moves.`, (w) => `Situation follows. (${w}) Enemy forces.`,
    (w) => `${w} // SP-PRVCY`, (w) => `${w}//SI//NOFORN`, (w) => `(${w}//NF) The unit departs.`];
  const wrongly = [];
  for (const w of words) for (const v of caseVariants(w)) for (const f of frames) { const s = f(v); if (stops(s).length) wrongly.push(s); }
  check(wrongly.length === 0, tag("LP-036", "LP-128") + " lower- and mixed-case wording is never a marking: " + words.length * 2 * frames.length + " combinations (every banner, control-string and portion-mark shape, with each marking word in lower case and Title Case) produce no stop finding", () => "wrongly stopped: " + list(wrongly));
}
{
  const midSentence = ["A restricted report is confidential and does not trigger an investigation.", "SECRET material must be transmitted through SIPR.", "The three classification levels are Top Secret, Secret, and Confidential.", "See the CUI marking guide before you save the file.", "A 35F requires a Top Secret clearance and a 92A requires a Secret clearance.", "TS clearance and SCI access are separate."];
  const wrongly = midSentence.filter((s) => scr(s).findings.some((f) => f.severity === "stop"));
  check(wrongly.length === 0, tag("LP-036", "LP-037") + " a marking word used in the middle of a sentence, with no //, is never a marking", () => "stopped: " + list(wrongly));
}
{
  const otherShapes = ["SECRET-NOFORN", "SECRET/NOFORN", "SECRET NOFORN", "SECRET - NOFORN", "SECRET.NOFORN", "S/NF", "TS/SCI", "CUI/SP-PRVCY", "CUI/FOUO", "[SECRET]", "<SECRET>", "{TS}", "(S/NF) The unit departs.", "SECRET: NOFORN", "-- SECRET --", "//SECRET", "SECRET//", "//"];
  const wrongly = otherShapes.filter((s) => scr(s).findings.some((f) => f.severity === "stop"));
  check(wrongly.length === 0, tag("LP-036", "LP-127") + " a marking that does not follow the listed shapes (hyphen, single slash, space, colon, brackets, a dangling //) is not recognized", () => "stopped: " + list(wrongly));
}
{
  const study = ["What are the three levels of classified information? Top Secret, Secret, and Confidential (AR 380-5).", "Is CUI classified information? No. CUI is unclassified information that requires safeguarding (AR 25-2).",
    "Controlled Unclassified Information (CUI) is governed by 32 CFR Part 2002 and AR 25-2.", "Communications with a chaplain are confidential and privileged.", "NOFORN means not releasable to foreign nationals.", "A restricted report is confidential (AR 600-52)."];
  const wrongly = study.filter((s) => scr(s).findings.length);
  check(wrongly.length === 0, tag("LP-037") + " ordinary study text about markings - including the package's own two examples - produces no finding at all", () => "reported: " + list(wrongly));
}
{
  const unmarkedOrOdd = ["This roster is CUI.", "The attached roster contains controlled unclassified information.", "CUI - SP-PRVCY", "CUI - PRVCY", "Cui//sp-prvcy", "(CUI - PRVCY) The roster is attached.", "Dissemination: FEDCON", "Category: PRVCY", "Distribution: limited", "Handle via privacy channels only"];
  const wrongly = unmarkedOrOdd.filter((s) => scr(s).findings.length);
  check(wrongly.length === 0, tag("LP-128", "LP-127") + " unmarked, mixed-case and unusually marked CUI produces no finding - the check does not detect it", () => "reported: " + list(wrongly));
  const fixtures = JSON.parse(readFileSync(APP + "tools/fixtures/opsec-guard-cases.json", "utf8")).cases;
  const stopCodes = new Set(); fixtures.forEach((c) => { if (c.severity === "stop") c.expect.forEach((x) => stopCodes.add(x)); });
  const SHAPES = ["banner-marking", "control-marking", "portion-marking", "page-banner-marking", "classification-label", "cui-designation"];
  check([...stopCodes].every((c) => SHAPES.includes(c)) && SHAPES.every((c) => stopCodes.has(c)),
    tag("LP-127") + " the only things that stop an import are the six marking shapes paragraph 4a lists (banner line, control string, portion mark, classification label, CUI designation block, page banner), and every one of them is exercised: " + [...stopCodes].sort().join(", "),
    () => "stop codes in the fixture table: " + [...stopCodes].join(","));
}

/* ======================================================================
   4b. Items that warrant a deliberate look
   ====================================================================== */
{
  const ssn = ["SSN 123-45-6789", "Doe, John 123-45-6789 SGT", "SSN: 123456789", "SSN 123 45 6789", "Social Security number 123-45-6789", "SSAN: 123-45-6789"];
  const miss = notRead(ssn, "ssn", "check");
  const not = ["123456789", "AR 600-20 2020", "600-20 2020", "TM 9-1005-319-10", "NSN 1005-01-231-0973", "ZIP 40122-5408"];
  const wrongly = not.filter((s) => scr(s).findings.length);
  const masked = scr("SSN 123-45-6789").findings[0];
  check(miss.length === 0 && wrongly.length === 0 && masked && !/123-45/.test(masked.excerpt) && /6789/.test(masked.excerpt),
    tag("LP-039", "LP-173", "LP-177") + " a Social Security number - written NNN-NN-NNNN, or following an SSN label - is a check finding whose excerpt shows only the last four digits; an unlabelled nine-digit run, a regulation with its year and a stock number are not one",
    () => "not read: " + list(miss) + "; wrongly read: " + list(wrongly) + "; excerpt " + JSON.stringify(masked && masked.excerpt));
}
{
  const ids = ["DoD ID: 1234567890", "DODID 1234567890", "EDIPI 1234567890", "DoD ID number 1234567890", "EDIPI: 1234567890"];
  const miss = notRead(ids, "dod-id", "check");
  const not = ["1234567890", "DA Form 4856, block 3: 1234567890.", "Call 1234567890 now"];
  const wrongly = not.filter((s) => scr(s).findings.some((f) => f.code === "dod-id"));
  check(miss.length === 0 && wrongly.length === 0, tag("LP-040", "LP-173") + " a ten-digit number following a DoD ID / EDIPI label is a check finding; the same ten digits with no label are not", () => "not read: " + list(miss) + "; wrongly read: " + list(wrongly));
}
{
  const s = ["This document is SECRET.", "The annex is classified TOP SECRET.", "This memo is marked CONFIDENTIAL.", "The overlay remains SECRET."];
  const miss = notRead(s, "classification-statement", "check");
  const not = ["A restricted report is confidential.", "The document is unclassified.", "This is a Secret."];
  const wrongly = not.filter((x) => scr(x).findings.length);
  check(miss.length === 0 && wrongly.length === 0, tag("LP-041") + " a sentence stating that the text is classified (\"This document is SECRET.\") is a check finding", () => "not read: " + list(miss) + "; wrongly read: " + list(wrongly));
}
{
  const f = forms(at(200));
  const tomorrow = forms(at(1));
  const sentence = (d) => `Convoy movement to Fort Example training area on ${d}, SP time 0600.`;
  const missFar = Object.entries(f).filter(([, d]) => codes(sentence(d)) !== "future-operation-location:check").map(([k]) => k);
  const missSoon = Object.entries(tomorrow).filter(([, d]) => codes(sentence(d)) !== "future-operation-location:check").map(([k]) => k);
  const past = forms(at(-40));
  const wrongPast = Object.entries(past).filter(([, d]) => codes(sentence(d)) !== "").map(([k]) => k);
  check(missFar.length === 0 && missSoon.length === 0,
    tag("LP-043", "LP-178") + " a date that has not yet passed is read in all six forms - ISO, M/D/YYYY, Month D, YYYY, Army DD MON YYYY, Army DD MON YY and date-time group - a long way off and tomorrow alike",
    () => "not read as future: far " + missFar.join(", ") + "; tomorrow " + missSoon.join(", "));
  check(wrongPast.length === 0, tag("LP-043", "LP-179") + " the same sentence with a date that has already passed produces no finding, in all six forms", () => "wrongly flagged (past): " + wrongPast.join(", "));
  const today = forms(at(0));
  const yesterday = forms(at(-1));
  check(codes(sentence(today["Army DD MON YYYY"])) === "future-operation-location:check" && codes(sentence(yesterday["Army DD MON YYYY"])) === "",
    tag("LP-043") + " 'not yet passed' is judged against the device clock: today's date is still flagged and yesterday's is not (no year is written into the rule)", () => "today " + codes(sentence(today["Army DD MON YYYY"])) + ", yesterday " + codes(sentence(yesterday["Army DD MON YYYY"])));
}
{
  const d = forms(at(120))["Army DD MON YYYY"];
  const activityWords = ["movement", "convoy", "deployment", "range", "deploying", "live-fire", "assembly area", "training area", "line of departure"];
  const withActivity = activityWords.map((w) => `The ${w} to Fort Example is set for ${d}.`);
  const missA = withActivity.filter((s) => codes(s) !== "future-operation-location:check");
  const withGrid = `Deployment ${p2(at(120).getDate())}0600Z${MON3[at(120).getMonth()]}${String(at(120).getFullYear()).slice(2)} to OBJ LION grid 18S UJ 12345 67890`;
  const noPlace = [`Deployment movement is planned for ${d}.`, `The convoy leaves on ${d}.`];
  const noActivity = [`The board convenes at Fort Example on ${d}.`, `Study session at Building 410 on ${d}.`, `The ceremony is at Fort Example on ${d}.`];
  const missB = noPlace.concat(noActivity).filter((s) => codes(s) !== "");
  check(missA.length === 0 && codes(withGrid) === "future-operation-location:check" && missB.length === 0,
    tag("LP-042", "LP-096", "LP-178") + " it takes all three in one sentence: a future date, a named place or map grid, and a unit-activity word (movement, convoy, deployment, range, and similar) - two of the three is no finding",
    () => "activity sentences not read: " + list(missA) + "; grid sentence: " + codes(withGrid) + "; wrongly read: " + list(missB));
  const twoSentences = `The board convenes ${d} in the battalion conference room. Topics: land navigation grid coordinates and M4 range.`;
  check(codes(twoSentences) === "", tag("LP-042") + " the three must share one sentence: a board date followed by a study topic in the next sentence is not a movement", () => "read as: " + codes(twoSentences));
}

/* ======================================================================
   4c. Routine contact details
   ====================================================================== */
{
  const phones = ["POC: 270-555-0101", "Call (270) 555-0101 with questions.", "DSN 312.555.0142 for the duty desk"];
  const emails = ["Questions to jane.doe@army.mil.", "POC: jane.doe@example.com"];
  const uics = ["UIC W1ABCD", "UIC: WH8AA0", "Unit Identification Code W1ABCD"];
  const missP = notRead(phones, "phone", "note"), missE = notRead(emails, "email", "note"), missU = notRead(uics, "uic", "note");
  const tollFree = ["DoD Safe Helpline: 877-995-5247.", "Call 1-800-555-0100 for support.", "(888) 555-0123 is the hotline."];
  const wrongly = tollFree.filter((s) => scr(s).findings.length);
  const unlabelled = ["The UIC system identifies each unit.", "UIC format is six characters.", "W1ABCD"];
  const wronglyU = unlabelled.filter((s) => scr(s).findings.some((f) => f.code === "uic"));
  check(missP.length + missE.length + missU.length === 0 && wrongly.length === 0 && wronglyU.length === 0,
    tag("LP-047", "LP-173") + " a telephone number, an email address and a six-character code after a UIC label are note findings (never a stop or a question); a toll-free line and the words 'UIC system' are not",
    () => "phone " + list(missP) + "; email " + list(missE) + "; uic " + list(missU) + "; toll-free wrongly read " + list(wrongly) + "; uic wrongly read " + list(wronglyU));
}

/* ======================================================================
   Not detected on their own
   ====================================================================== */
{
  const samples = ["1234567890", "0012345678", "W1ABCD", "WH8AA0", "SGT John A. Smith", "Doe, John", "PVT Jane Q. Public of Alpha Company", "123 Main Street, Springfield, KY 42101", "Fort Campbell, KY 42223-5000", "18S UJ 12345 67890", "123456 654321", "Plot the eight-digit grid 1234 5678 on the map sheet."];
  const wrongly = samples.filter((s) => scr(s).findings.length);
  check(wrongly.length === 0, tag("LP-051") + " unlabelled ten-digit numbers, unlabelled unit codes, names, addresses and grid coordinates on their own produce no finding", () => "reported: " + list(wrongly));
}

/* ======================================================================
   Findings only: what and where, and never an edit
   ====================================================================== */
{
  const sample = ["Study ADP 6-22.", "Line two is fine.", "SSN 123-45-6789", "(S//NF) The unit departs.", "POC 270-555-0101"];
  const lf = scr(sample.join("\n")), crlf = scr(sample.join("\r\n"));
  const lines = (r) => r.findings.map((f) => f.code + "@" + f.line).join(",");
  const everyFinding = seen.flatMap((s) => s.r.findings);
  const shapeOk = everyFinding.every((f) => Number.isInteger(f.line) && f.line >= 1 && typeof f.excerpt === "string" && f.excerpt.length > 0 && f.excerpt.length <= 200 && typeof f.looksLike === "string" && f.looksLike.length > 0 && f.severity);
  check(lines(lf) === "ssn@3,portion-marking@4,phone@5" && lines(crlf) === lines(lf) && shapeOk && everyFinding.length > 100,
    tag("LP-025") + " every finding says what it saw and where: a line number (right, with LF and with CRLF line ends: " + lines(lf) + ") and a short excerpt (at most 200 characters) - checked over all " + everyFinding.length + " findings this suite produced",
    () => "lines LF " + lines(lf) + " / CRLF " + lines(crlf) + "; every finding well formed: " + shapeOk + "; findings: " + everyFinding.length);
}
{
  const before = seen.length;
  const edge = ["", "  leading and trailing  ", "tabs\tand\r\nCRLF\r\n", "Unicode — é 😀", "SECRET//NOFORN\n(S//NF) x\nSSN 123-45-6789\nUIC W1ABCD\njane@army.mil", `Line one\n${"x".repeat(5000)}\nSSN 123-45-6789`];
  for (const e of edge) scr(e);
  scr(null); scr(undefined);
  const changed = seen.filter((s) => s.text != null && s.r.text !== s.text);
  check(changed.length === 0 && seen[before + edge.length].r.text === "" && seen[before + edge.length + 1].r.text === "",
    tag("LP-026", "LP-124", "LP-176") + " the text comes back character for character, every time: none of the " + seen.length + " inputs this suite screened - findings or not, LF or CRLF, empty, padded, accented, 5,000 characters on a line - was edited, trimmed, redacted or deleted",
    () => "changed: " + list(changed.map((s) => s.text)));
  const before2 = JSON.stringify(scr("SECRET//NOFORN and SSN 123-45-6789"));
  check(JSON.stringify(scr("SECRET//NOFORN and SSN 123-45-6789")) === before2, tag("LP-026") + " the check is a pure function of its text: the same input gives the same answer twice", "two runs disagreed");
}

await finish("LEGAL PACKAGE GUARD");
