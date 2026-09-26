/**
 * Doctrine accuracy pin: the Army Body Composition Program (waist-to-height
 * ratio, Army Directive 2026-13) and Blended Retirement System continuation
 * pay window (ALARACT 100/2025, 37 USC 356).
 *
 * WHY THIS EXISTS: GUIDON_ROADMAP section 5 flagged two content claims that an
 * earlier accuracy pass deliberately did NOT auto-correct because they sat
 * near or past that auditor's knowledge cutoff:
 *   1. doc-abcp-1 / doc-abcp-2: a 7 July 2026 waist-to-height ratio (WHtR)
 *      standard of 0.550 that replaced the height/weight screening and tape
 *      test entirely.
 *   2. the BRS overview entry: the continuation pay window moved from 8-12
 *      to 7-12 years of service "as of 1 Jan 2026".
 * Both were independently re-read from primary sources on 2026-09-25 and
 * CONFIRMED (Army Directive 2026-13, SECARMY, dated 1 July 2026, on
 * armypubs.army.mil; the Army's ABCP FAQ on army.mil, which lists 7 July 2026
 * as the effective date; ALARACT 100/2025, R 071630Z NOV 25, paras 3, 4.A.2,
 * 4.A.3; 37 USC 356(a)). Reading them also found the app repeating the claim
 * around a few details the sources contradict, and this suite pins the
 * corrected facts so they cannot drift back:
 *   - doc-abcp-1 still taught monthly weigh-ins and "measurable progress on a
 *     set timeline" (AD 2026-13 para 5b(6) rescinded both), and doc-abcp-1/2
 *     cited AR 600-9 and AD 2026-13 as edition "2026" (AR 600-9 is dated 16
 *     July 2019 and has not been rewritten);
 *   - two board cards said "effective 1 Jul 2026" beside cards saying 7 Jul;
 *   - the DA Form 5500 worksheet said "WHtR <= 0.550" passes, but the
 *     directive's standard is "less than and not equal to 0.55" (.550 fails);
 *   - two Flag cards still called an ABCP flag transferable (para 5b(3));
 *   - the Programs lesson and Counseling Trainer taught the rescinded monthly
 *     progress rule; the Board Prep packet checklist named the rescinded DA
 *     Form 5501; the reference library showed AR 600-9 with no currency note.
 * A second review (2026-09-26) found three more statements that no cited
 * source supports, and this suite pins their fixes too:
 *   - doc-abcp-1 said "Entry is not punitive by itself". AD 2026-13, AR 600-9
 *     (16 July 2019; the word "punitive" does not appear in it) and the Army's
 *     ABCP FAQ do not say it, so it is gone (what they DO say - the Soldier is
 *     flagged, enrolled, and stays enrolled until a measurement meets the
 *     standard - stays, with the paragraphs). The FAQ source entries now name
 *     the page and question they were read from.
 *   - "the Army's 2025 continuation pay window was 8-12 years" was not in any
 *     cited source (ALARACT 100/2025 is CY26/CY27). It is in the ASA(M&RA)
 *     memorandum "BRS Continuation Pay - Calendar Years 2024/2025", para 4.a(2),
 *     read as the copy hosted on kansastag.gov; that source is now cited
 *     wherever the earlier window is stated.
 *   - prom-2 / sc-care-5 said Flag code K "is now non-transferable"; para 5b(3)
 *     says it "remains non-transferable" and rescinds the AR 600-8-2 ABCP
 *     transfer provisions.
 *
 * Pure-node: it reads the ASSEMBLED bank (seed + every content pack, through
 * tools/assemble-bank.mjs, the same engine the build uses), not a browser, so
 * there is nothing to race. Each predicate is also run against a planted
 * defect to prove it can actually fail.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleBank } from "./assemble-bank.mjs";
import { check, finish } from "./testkit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const { data } = assembleBank();

const D = data.doctrine.entries, B = data.board.questions;
const doc = (id) => D.find((e) => e.id === id);
const card = (id) => B.find((q) => q.id === id);
const all = (o) => JSON.stringify(o);

// Every string in the assembled bank, with the path it lives at.
const strings = [];
(function walk(node, p) {
  if (typeof node === "string") { strings.push({ p, s: node }); return; }
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, p + "[" + i + "]")); return; }
  if (node && typeof node === "object") { const id = node.id ? "{" + node.id + "}" : ""; for (const k of Object.keys(node)) walk(node[k], p + id + "." + k); }
})(data, "");
const hits = (re) => strings.filter((x) => re.test(x.s)).map((x) => x.p);

/* ====================== CLAIM 1: ABCP / WHtR / AD 2026-13 ====================== */

// Predicates take the entry so the "verify the verifier" block below can hand them a planted defect.
const abcpBodyOk = (e, needs, bans) => needs.every((n) => e.body.includes(n)) && !bans.some((b) => e.body.includes(b));
const NEEDS_1 = ["Army Directive 2026-13", "dated 1 July 2026", "7 July 2026", "0.550 or higher", "at least twice per calendar year", "no AFT score exempts", "tape test", "180-day", "rescinded the old progression requirements"];
const NEEDS_2 = ["Army Directive 2026-13", "dated 1 July 2026", "7 July 2026", "at least twice per calendar year", ".549 passes and .550 fails", "DA Form 5500", "DA Form 5501 is rescinded", "no age or sex adjustment", "different team", "at least 7 days"];
const BANS = ["monthly weigh-ins", "measurable progress", "set timeline", "trained personnel following exact protocol", "privately and with dignity", "Failure to make progress"];

const a1 = doc("doc-abcp-1"), a2 = doc("doc-abcp-2");
check(!!a1 && !!a2, "both ABCP doctrine entries (doc-abcp-1, doc-abcp-2) are present", "doc-abcp-1 or doc-abcp-2 missing from the assembled bank");
check(a1 && a2 && a1.topic === "Army Body Composition Program" && a2.topic === "Army Body Composition Program", "both sit under the topic Army Body Composition Program");
check(a1 && abcpBodyOk(a1, NEEDS_1, BANS), "doc-abcp-1 states the directive facts (dated 1 Jul, effective 7 Jul, 0.550, twice a year, no AFT exemption, tape test, 180-day hold) and none of the rescinded ones (monthly weigh-ins, progress on a timeline)", () => "doc-abcp-1 body: " + (a1 && a1.body));
check(a2 && abcpBodyOk(a2, NEEDS_2, BANS), "doc-abcp-2 states the measurement facts (navel/height, .549 passes and .550 fails, twice a year, 7-day AFT gap, confirmation by a different team, DA 5500 not 5501) and drops the unsourced 'trained personnel'/'privately and with dignity' claims", () => "doc-abcp-2 body: " + (a2 && a2.body));
// CONFIRMED against the primary text, so they stay "verified" (an in_transition tag would also let the Settings toggle hide the
// Soldier's own body composition standard). Only a claim that could NOT be verified is downgraded to in_transition.
check(a1 && a2 && a1.confidence === "verified" && a2.confidence === "verified", "both stay confidence 'verified': the claim was confirmed against Army Directive 2026-13 itself", () => "confidence: " + (a1 && a1.confidence) + " / " + (a2 && a2.confidence));

const srcOk = (e) => {
  const ad = (e.source || []).find((s) => s.pub === "Army Directive 2026-13");
  const ar = (e.source || []).find((s) => s.pub === "AR 600-9");
  return !!ad && ad.edition === "1 July 2026" && !!ar && /16 July 2019/.test(ar.edition) && !(e.source || []).some((s) => s.edition === "2026");
};
check(a1 && a2 && srcOk(a1) && srcOk(a2), "both cite Army Directive 2026-13 as 1 July 2026 and AR 600-9 as 16 July 2019 (as amended) - no invented \"2026\" edition", () => "sources: " + all([a1 && a1.source, a2 && a2.source]));

// The unsourced "not punitive" claim. Neither AD 2026-13, AR 600-9 (2019) nor the Army's FAQ says it, so doc-abcp-1 must not.
const PUNITIVE = /\b(not|isn't|non-?)\s*punitive\b/i;
check(a1 && !PUNITIVE.test(a1.body) && !a1.keyPoints.some((k) => PUNITIVE.test(k)),
  "doc-abcp-1 no longer says entry is 'not punitive' (no cited source says it - AD 2026-13, AR 600-9 and the ABCP FAQ do not)", () => "doc-abcp-1 still says it: " + (a1 && [a1.body, ...a1.keyPoints].filter((t) => PUNITIVE.test(t)).join(" | ")));
check(a1 && /stays enrolled until a later measurement meets the standard/.test(a1.body) && a1.keyPoints.some((k) => /flagged and enrolled, and stays enrolled until a later measurement meets the standard \(AD 2026-13, paras 5a\(5\) and 5b\(6\)\)/.test(k)),
  "...and what the sources DO say stays, with its paragraphs: flagged and enrolled (5a(5)), stays enrolled until a later measurement meets the standard, removed as soon as it is met (5b(6))", () => "doc-abcp-1: " + (a1 && all([a1.body, a1.keyPoints])));
const faqOf = (e) => (e.source || []).find((x) => /ABCP FAQ/.test(x.pub));
check(a1 && a2 && faqOf(a1) && faqOf(a2) && faqOf(a1).para.trim() && faqOf(a2).para.trim() && /satisfactory progress/.test(faqOf(a1).para) && /How is the Waist to Height Ratio \(WHtR\) measured/.test(faqOf(a2).para),
  "the 'Army ABCP FAQ' source entries in doc-abcp-1/2 name the page and question they were read from (not a blank para)", () => "faq paras: " + all([a1 && faqOf(a1), a2 && faqOf(a2)]));
check(PUNITIVE.test("Entry is not punitive by itself: the Soldier stays enrolled") && PUNITIVE.test("Entry itself is not punitive") && PUNITIVE.test("a non-punitive path") && !PUNITIVE.test("stays enrolled until a later measurement meets the standard"), "verifier check: the 'not punitive' pattern matches the old wording and lets the corrected wording through");

const d3 = doc("doc-abcp-3");
check(d3 && !d3.source.some((s) => s.pub === "AR 600-9" && s.edition === "2023") && !/correlates with higher (attrition|long-term)/.test(all(d3)), "doc-abcp-3 no longer cites a nonexistent 2023 AR 600-9 or claims a leadership style 'correlates with' attrition (board card abcp-8 says no such study was found)");

// The dates. AD 2026-13 is dated 1 Jul 2026 ("Effective immediately"); the Army's ABCP FAQ and army.mil release give 7 Jul 2026.
check(hits(/2026-13[^.]{0,60}effective 1 Jul(y)? 2026|effective 1 Jul(y)? 2026[^.]{0,40}2026-13|\(effective 1 July 2026\)/i).length === 0,
  "no card says Army Directive 2026-13 was 'effective 1 Jul 2026' (it was dated 1 Jul; the Army lists 7 Jul as the effective date)", () => "still says effective 1 Jul: " + hits(/2026-13[^.]{0,60}effective 1 Jul(y)? 2026|effective 1 Jul(y)? 2026[^.]{0,40}2026-13|\(effective 1 July 2026\)/i).join(", "));
// The directive text establishes a date (1 Jul 2026), not a signature date or a named signer: no card may say it was "signed".
const SIGNED_AD = /2026-13[^.;]{0,40}\bsigned\b|\bsigned\b[^.;]{0,60}(1 Jul(y)? 2026|Directive 2026-13)|Driscoll/i;
check(hits(SIGNED_AD).length === 0,
  "no card says Army Directive 2026-13 was 'signed' on a date or names a signer (the text establishes it as dated 1 Jul 2026, nothing more)", () => "still says signed: " + hits(SIGNED_AD).join(", "));
check(hits(/early January 2027|running from the directive's effective date/).length === 0,
  "no card invents a start or end date for the 180-day assessment (the directive gives none)", () => hits(/early January 2027|running from the directive's effective date/).join(", "));

// The threshold: 0.55 itself FAILS.
const da5500 = (data.forms.forms || []).find((f) => f.id === "da5500");
const stdLabel = da5500 && da5500.sections[0].fields.find((f) => f.id === "standard").label;
check(!!stdLabel && /below 0\.550/.test(stdLabel) && !/≤/.test(stdLabel), "DA Form 5500 worksheet says a Soldier is within standard only BELOW 0.550 (directive: 'less than and not equal to 0.55')", () => "label: " + stdLabel);
check(hits(/≤ ?0\.55|<= ?0\.55|0\.55 or (less|lower|under)/).length === 0, "nothing in the bank says a WHtR of 0.55 or less passes", () => hits(/≤ ?0\.55|<= ?0\.55|0\.55 or (less|lower|under)/).join(", "));
check(/less than and not equal to 0\.55/.test(card("abcp-1").boardAnswer) && /less than and not equal to 0\.55/.test(card("abcp-2").boardAnswer), "abcp-1 and abcp-2 still quote the directive's 'less than and not equal to 0.55'");
check(/at least twice per calendar year/.test(card("ar6009-2").boardAnswer) && /minimum of 7 days|at least a 7-day gap|at least 7 days/.test(all(card("ar6009-2").keyPoints)), "ar6009-2 pins twice per calendar year and the 7-day AFT/CFT gap");
check(!/typically at AFT testing/.test(all(card("acft-007"))) && /at least 7 days between the AFT or CFT/.test(card("acft-007").boardAnswer), "acft-007 no longer says WHtR is 'typically at AFT testing' (the directive requires a 7-day gap) and covers the Guard and Reserve too");

// The rescinded monthly progress rule, wherever it was still taught as current.
const lesson = data.curriculum.courses.find((c) => c.id === "c-prt").lessons.find((l) => l.id === "l-abcp-process");
check(!!lesson && !/must show satisfactory progress|track their progress|a real deadline/.test(all(lesson.tiers)) && /WHtR standard/.test(lesson.knowledgeCheck.explanation) && /WHtR/.test(lesson.knowledgeCheck.options[1]),
  "the Programs lesson 'ABCP - From Flag to Compliance' no longer teaches monthly 'satisfactory progress' as current, and its knowledge check now answers with the WHtR standard", () => all(lesson));
check(!/monthly progress assessments/.test(all(card("ar6009-11"))), "ar6009-11 no longer lists 'monthly progress assessments' as part of ABCP");
const cb = data.counsel_bullets.byCategory["Fitness / ABCP"];
check(!/3 to 8 pounds|reweighed monthly|monthly weigh-in|body-fat standard/.test(all(cb)) && /WHtR/.test(all(cb.keyPoints)), "Counseling Trainer 'Fitness / ABCP' bullets use the WHtR standard, not the 3-8 pounds a month / monthly weigh-in rule");
const legacy = ["ex-overweightncoes", "ex-overweightinitial", "ex-overweightmonthly"].map((id) => data.counsel.examples.find((x) => x.id === id));
check(legacy.every((x) => x && /^CURRENCY NOTE \(July 2026\)/.test(x.purpose) && /Army Directive 2026-13/.test(x.purpose)), "the three legacy overweight counseling templates open with a currency note pointing at Army Directive 2026-13", () => legacy.map((x) => x && x.purpose.slice(0, 60)).join(" | "));

// Flag code K.
check(/non-transferable/.test(all(card("prom-2").keyPoints)) && /para 5b\(3\)/.test(all(card("prom-2"))) && !/ACFT failure \(code J\) and ABCP noncompliance \(code K\)/.test(all(card("prom-2"))), "prom-2 no longer calls an ABCP flag transferable (AD 2026-13 para 5b(3))");
check(/an ABCP flag \(code K\) remains non-transferable/.test(all(card("sc-care-5").keyPoints)), "sc-care-5 no longer lists ABCP among transferable flags");
// The directive's own word is "remains" (para 5b(3): "Flag code K ... remains non-transferable"), never "is now".
const NOW_NT = /\bnow non-?transferable\b|\bis non-transferable since\b/i;
check(hits(NOW_NT).filter((p) => /ABCP|code K/i.test(strings.find((x) => x.p === p).s)).length === 0,
  "no card says an ABCP flag 'is now' non-transferable (AD 2026-13 para 5b(3) says code K 'remains non-transferable')", () => "still says now: " + hits(NOW_NT).join(", "));
check(/Flag code K remains non-transferable and rescinds all ABCP transfer provisions in AR 600-8-2/.test(card("prom-2").boardAnswer) && /Flag code K remains non-transferable and rescinds all ABCP transfer provisions in AR 600-8-2/.test(card("prom-2").a) && /code K remains non-transferable/.test(all(card("prom-2").keyPoints)),
  "prom-2 (answer, board answer and key points) carries the directive's word: code K 'remains' non-transferable, and the AR 600-8-2 transfer provisions are rescinded");
check(NOW_NT.test("so Flag code K is now non-transferable.") && !NOW_NT.test("says Flag code K remains non-transferable"), "verifier check: the 'is now non-transferable' pattern matches the old wording and lets 'remains' through");

// DA Form 5501 is rescinded (para 5a(8)) - the packet checklist must not ask for it.
const recordsSrc = readFileSync(path.join(APP, "src/app-modules/records.js"), "utf8");
check(!/5500\/5501 attached/.test(recordsSrc) && /with DA Form 5500 attached if I'm on a body-composition program/.test(recordsSrc), "the Board Prep packet checklist item asks for DA Form 5500 only (DA Form 5501 is rescinded)");

// Dictionary + library note.
const whtr = data.acronyms.terms.find((t) => t.a === "WHtR");
check(!!whtr && /Army Directive 2026-13/.test(whtr.d) && /0\.55/.test(whtr.d), "the dictionary's WHtR term names Army Directive 2026-13 and the 0.55 line, not just 'the AR 600-9 standard'", () => whtr && whtr.d);
const libSrc = readFileSync(path.join(APP, "src/app-modules/library.js"), "utf8");
const at = libSrc.indexOf('\\"id\\":\\"ar-600-9\\"');
check(at > 0 && /Army Directive 2026-13/.test(libSrc.slice(at, at + 700)), "the Reference Library card for AR 600-9 carries a note that Army Directive 2026-13 now controls");
const genSrc = readFileSync(path.join(HERE, "build-library-data.mjs"), "utf8");
check(/id: "ar-600-9"[^}]*Army Directive 2026-13/.test(genSrc), "tools/build-library-data.mjs carries the same AR 600-9 note, so a library regenerate does not drop it");

/* ====================== CLAIM 2: BRS continuation pay window ====================== */

// The four places the window is stated: the BRS doctrine entry, the Junior Soldier money lesson (body + professional tier) and the Money tab's component card.
const jsfL4 = data.curriculum.courses.find((c) => c.id === "course-junior-soldier").lessons.find((l) => l.id === "jsf-l4");
const cpComp = data.finance.brs.components.find((c) => /continuation pay/i.test(c.name));
const cpText = [
  { p: "doc-brs body", s: (doc("doc-brs-blended-retirement-system-overview") || {}).body || "" },
  { p: "jsf-l4 body", s: jsfL4.body }, { p: "jsf-l4 professional", s: jsfL4.tiers.professional },
  { p: "finance.brs continuation pay", s: (cpComp || {}).d || "" },
];
check(!!cpComp && cpText.every((x) => /continuation pay/i.test(x.s) || x.p.startsWith("finance")), "the continuation pay window is stated in the BRS doctrine entry, the Junior Soldier lesson (2 places) and the Money tab", () => "places: " + cpText.map((x) => x.p).join(", "));
const cpOk = (s) => /7[–-]12 years of service/.test(s) && /(old|was) 8[–-]12/.test(s) && /1 Jan 2026/.test(s) && /in the Army|Army's/.test(s);
check(cpText.length > 0 && cpText.every((x) => cpOk(x.s)), "every place says: Army, 7-12 years of service from 1 Jan 2026, up from the old 8-12", () => cpText.filter((x) => !cpOk(x.s)).map((x) => x.p).join(", "));
check(cpText.some((x) => /7[–-]10/.test(x.s)) && !cpText.some((x) => /CY2027/.test(x.s) && !/7-10/.test(x.s)), "the 2027 narrowing to 7-10 years is stated wherever 2027 is mentioned");
const brs = doc("doc-brs-blended-retirement-system-overview");
check(!!brs && brs.source.some((s) => s.pub === "ALARACT 100/2025" && /paras 3, 4\.A\.2, 4\.A\.3/.test(s.para)) && brs.source.some((s) => s.pub === "37 USC 356"), "the BRS doctrine entry cites ALARACT 100/2025 (paras 3, 4.A.2, 4.A.3) and 37 USC 356, not just a 2023 DoD guide", () => all(brs && brs.source));
const jsf = data.curriculum.courses.find((c) => c.id === "course-junior-soldier").lessons.find((l) => l.id === "jsf-l4");
check(/ALARACT 100\/2025/.test(jsf.citation) && /ALARACT 100\/2025/.test(jsf.body), "the Junior Soldier money lesson cites ALARACT 100/2025 for the window");
const idxSrc = readFileSync(path.join(APP, "src/index.html"), "utf8");
check(/In the Army, the Blended Retirement System window opens at 7 years of service starting 1 January 2026/.test(idxSrc) && /Continuation Pay: ALARACT 100\/2025/.test(idxSrc), "the Channels 'Changed in 2026' panel says it is the Army's window and cites ALARACT 100/2025 (its old source line covered other items)");
const curSrc = readFileSync(path.join(APP, "src/app-modules/currency.js"), "utf8");
check(/7 years of service on 1 Jan 2026 \(ALARACT 100\/2025\)/.test(curSrc), "the Channels currency tracker cites ALARACT 100/2025 for the window");

const cp1 = card("brs-cp-1"), cp2 = card("brs-cp-2"), cp3 = card("brs-cp-3");
check(!!cp1 && !!cp2 && !!cp3, "the three continuation pay board cards (brs-cp-1..3) ship with the facts (standing rule: sourced content ships with board cards)");
check(cp1 && /7 and no more than 12/.test(cp1.a) && /ALARACT 100\/2025/.test(cp1.source) && /37 USC 356/.test(cp1.source), "brs-cp-1 pins 7-12 years in 2026 and cites ALARACT 100/2025 + 37 USC 356");
check(cp2 && /7 and no more than 10/.test(cp2.a) && /4\.A\.3/.test(cp2.source), "brs-cp-2 pins 7-10 years in 2027 (ALARACT para 4.A.3)");
check(cp3 && /four years/.test(cp3.a) && /2\.5 times/.test(cp3.a) && /para 5/.test(all(cp3.keyPoints)) && /not less than 3 additional years/.test(all(cp3.keyPoints)), "brs-cp-3 pins the four-year Army obligation (federal floor is 3) and 2.5 times basic pay");

// The Army's EARLIER window (8-12 in 2025) is not in ALARACT 100/2025 (CY26/CY27). It is in the ASA(M&RA) CY24/CY25 memorandum
// (SAMR 637-1) para 4.a(2), so every place that states it cites that memorandum - and none claims it came from ALARACT 100/2025.
const memoSrc = (brs.source || []).find((x) => /^ASA\(M&RA\) memorandum, Blended Retirement System Continuation Pay, Calendar Years 2024\/2025/.test(x.pub));
check(!!memoSrc && /SAMR 637-1/.test(memoSrc.pub) && /paras 3 and 4a\(2\)/.test(memoSrc.para) && /expires 31 December 2025/.test(memoSrc.edition),
  "the BRS doctrine entry cites the ASA(M&RA) CY24/CY25 continuation pay memorandum (SAMR 637-1, paras 3 and 4a(2), expires 31 December 2025) for the earlier 8-12 window", () => "doc-brs sources: " + all(brs && brs.source));
check(!!memoSrc && !/ALARACT 029\/2025|S1Net|armyng/i.test(all(brs.source)), "...and cites nothing it did not read (no ALARACT 029/2025, no S1Net message, no armyng.com reproduction)", () => all(brs && brs.source));
check(/ASA\(M&RA\) memorandum, BRS Continuation Pay CY24\/CY25 Implementation Guidance \(SAMR 637-1\), paras 3 and 4\.a\(2\)/.test(cp1.source) && /CY24\/CY25 continuation pay memorandum, para 4\.a\(2\)/.test(all(cp1.keyPoints)),
  "brs-cp-1 cites the CY24/CY25 memorandum for the 2025 window in its source line and in the key point that states it", () => cp1.source + " | " + all(cp1.keyPoints));
check(/ASA\(M&RA\) CY24\/CY25 continuation pay memorandum \(the earlier 8-12 window, para 4a\(2\)\)/.test(jsf.citation), "the Junior Soldier money lesson's citation names the CY24/CY25 memorandum for the earlier window", () => jsf.citation);
check(/the Army's 2024\/2025 continuation pay memorandum for the earlier window/.test(idxSrc), "the Channels 'Changed in 2026' sources line names the Army's 2024/2025 continuation pay memorandum for the earlier window");
check(/Army continuation pay windows from ALARACT 100\/2025 \(2026 and 2027\) and the Army's 2024\/2025 continuation pay memorandum \(the earlier 8–12 window\)/.test(data.finance.asOf), "the Money tab's 'current as of' line names both sources of the continuation pay windows", () => data.finance.asOf);

/* ====================== verify the verifiers ====================== */
// Each predicate above must actually FAIL on the defect it exists to catch.
const planted = (e, extra) => ({ ...e, body: e.body + " " + extra });
check(a1 && !abcpBodyOk(planted(a1, "Soldiers must show progress with monthly weigh-ins."), NEEDS_1, BANS), "verifier check: doc-abcp-1 with 'monthly weigh-ins' put back is rejected");
check(a2 && !abcpBodyOk({ ...a2, body: a2.body.replace(".549 passes and .550 fails", ".550 passes") }, NEEDS_2, BANS), "verifier check: doc-abcp-2 without the '.550 fails' rule is rejected");
check(!srcOk({ source: [{ pub: "AR 600-9", edition: "2026" }, { pub: "Army Directive 2026-13", edition: "2026" }] }), "verifier check: the old edition \"2026\" citation is rejected");
check(!cpOk("Continuation pay opens at 7-12 years of service as of 1 Jan 2026."), "verifier check: a continuation pay line that drops 'the old 8-12' is rejected");
check(SIGNED_AD.test("Army Directive 2026-13 (signed by the Secretary of the Army on 1 Jul 2026)") && SIGNED_AD.test("ordered by Army Directive 2026-13 (signed by SECARMY Dan Driscoll, 1 Jul 2026)") && !SIGNED_AD.test("Army Directive 2026-13 (issued by the Secretary of the Army, dated 1 Jul 2026)"), "verifier check: the 'signed' pattern matches both old phrasings and lets the corrected 'dated' wording through");
check(/≤ ?0\.55/.test("Within Standard? (WHtR ≤ 0.550)") && /2026-13[^.]{0,60}effective 1 Jul(y)? 2026/i.test("Army Directive 2026-13 (1 Jul 2026), effective 1 Jul 2026"), "verifier check: the '<= 0.550' and 'effective 1 Jul' patterns do match the old wording");

await finish("DOCTRINE ABCP + BRS ACCURACY");
