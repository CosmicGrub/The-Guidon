#!/usr/bin/env node
/**
 * Superseded-publication gate: tools/lint-pub-supersession.mjs, proved against
 * stand-in banks, stand-in copies of the two files it reads, and the real bank.
 *
 * WHY THIS SUITE EXISTS. Audit 2026-10, item 10: 26 board cards, 3 doctrine
 * entries, a scenario and a whole First Aid course taught TC 4-02.1 as current
 * doctrine after the bundled ATP 4-02.11 had replaced it (its cover says
 * "supersedes TC 4-02.1, dated 21 January 2016"), and no gate could see it. The
 * gate reads the supersession table that MOI Import already owns
 * (MOI_CITATION_ALIASES in src/app-modules/moi-import.js - there is no second
 * list) and enforces only the rows the bundled Library itself proves. Deleting
 * this file would let the following ship unnoticed:
 *   - a card, doctrine entry, scenario reference or course lesson that names a
 *     replaced publication as a current source again (the structured `pub` and the
 *     prose cite at the end of an answer alike);
 *   - the gate quietly turning itself off - a renamed table constant, a row
 *     removed, or a Library whose cover page no longer proves the replacement;
 *   - the opposite mistake, a gate that fires on things that are fine: a sentence
 *     that SAYS the publication was superseded, a different manual whose number
 *     merely starts the same (ATP 4-02.1 is Army Medical Logistics, not TC 4-02.1),
 *     a row nobody has proved (FM 6-22 - the bundled ADP 6-22 still cites it as
 *     the current leader-development manual) or a table row for a publication the
 *     Library does not hold;
 *   - the relabel itself coming undone: the 19 First Aid cards back under a
 *     category named after the old manual, a card that reads as a word-for-word
 *     quotation of a manual it only paraphrases, a leaked reviewer note on a card,
 *     or MOI Import no longer sending an old TC 4-02.1 citation to ATP 4-02.11.
 *
 * Every check below can fail: the planted banks fail the lint, the honest
 * controls beside each one pass, and the real-bank checks read the live data.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleBank } from "./assemble-bank.mjs";
import { readSeed, writeSeed } from "./seed-io.mjs";
import { quoteKindOf } from "./citation-parse.mjs";
import {
  readAliasTable, readLibraryDocs, coverEvidence, designatorRegex, unmarkedMentions, loadSupersessions,
  MOI_PATH, LIBRARY_PATH,
} from "./lint-pub-supersession.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const LINT = path.join(HERE, "lint-pub-supersession.mjs");

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(typeof fail === "function" ? fail() : (fail === undefined ? pass : fail)));
const J = (v) => JSON.stringify(v);

console.log("lint-pub-supersession: the gate reads MOI_CITATION_ALIASES, enforces only what the bundled Library proves, and the First Aid relabel holds\n");

/* =====================================================================
   1. The table and the proof, read from the REAL files
   ===================================================================== */
console.log("1. the table and the proof");
const moiSrc = readFileSync(MOI_PATH, "utf8");
const libSrc = readFileSync(LIBRARY_PATH, "utf8");
const table = readAliasTable(moiSrc);
const docs = readLibraryDocs(libSrc);
check(table["TC 4-02.1"] === "ATP 4-02.11", "MOI_CITATION_ALIASES (read from moi-import.js) holds TC 4-02.1 -> ATP 4-02.11", () => "table: " + J(table));
check(table["FM 3-22.9"] === "TC 3-22.9" && Object.keys(table).length >= 5, "...beside the rows it already had (FM 3-22.9 -> TC 3-22.9 ...), none lost", () => "table: " + J(table));
const sup = loadSupersessions();
const enforcedKeys = sup.enforced.map((r) => r.oldKey).sort();
check(J(enforcedKeys) === J(["FM 3-22.9", "TC 4-02.1"]), "exactly the two rows the Library proves are enforced: TC 4-02.1 and FM 3-22.9", () => "enforced: " + J(enforcedKeys));
const tcEv = coverEvidence(docs, "TC 4-02.1", "ATP 4-02.11");
check(tcEv.proven && /21 January 2016/.test(tcEv.quote), "the proof for TC 4-02.1 is ATP 4-02.11's own cover page ('supersedes TC 4-02.1, dated 21 January 2016')", () => "evidence: " + J(tcEv.quote || tcEv.why));
const rifleEv = coverEvidence(docs, "FM 3-22.9", "TC 3-22.9");
check(rifleEv.proven && /12 August 2008/.test(rifleEv.quote), "...and for FM 3-22.9, TC 3-22.9's cover ('supersedes FM 3-22.9, 12 August 2008')", () => "evidence: " + J(rifleEv.quote || rifleEv.why));
const unproven = sup.notEnforced.map((r) => r.oldKey).sort();
check(J(unproven) === J(["AR 600-8-1", "FM 3-23.35", "FM 6-22"]), "FM 6-22, FM 3-23.35 and AR 600-8-1 are NOT enforced - the Library cannot prove them (and for FM 6-22 it points the other way)", () => "not enforced: " + J(unproven));
check((() => { try { readAliasTable("const nothing = 1;"); return false; } catch (e) { return /could not find/.test(e.message); } })(), "a moi-import.js with no such table makes the reader throw (the gate fails loudly rather than switching itself off)");

/* =====================================================================
   2. A designator is whole, and a marked sentence is not a teaching
   ===================================================================== */
console.log("\n2. matching rules");
const hits = (text, d = "TC 4-02.1") => unmarkedMentions(text, d).length;
check(hits("Per TC 4-02.1, para 3-9: stop the bleeding.") === 1, "'Per TC 4-02.1, para 3-9: ...' is a teaching (1 unmarked mention)");
check(hits("(TC 4-02.1.)") === 1 && hits("TC 4-02.1") === 1 && hits("tc 4‑02.1") === 1, "...at a sentence end, alone, in lower case and with a non-breaking hyphen too");
check(hits("ATP 4-02.1 (Oct 2015), Army Medical Logistics") === 0, "honest: ATP 4-02.1 (Army Medical Logistics) is a different manual and is not TC 4-02.1");
check(hits("TC 4-02.11 and TC 4-02.1-2 and TC 4-02.1.5") === 0, "honest: a longer number (TC 4-02.11, 4-02.1-2, 4-02.1.5) is not TC 4-02.1");
check(hits("ATP 4-02.11, which superseded TC 4-02.1 in March 2026.") === 0, "honest: 'which superseded TC 4-02.1 in March 2026' marks the change");
check(hits("The older, superseded FM 3-22.9 said trigger squeeze.", "FM 3-22.9") === 0 && hits("TC 4-02.1 was replaced by ATP 4-02.11.") === 0 && hits("Formerly TC 4-02.1.") === 0 && hits("TC 4-02.1 (rescinded)") === 0, "honest: formerly / replaced / rescinded / older in the same sentence all mark the change");
check(hits("It was superseded. Per TC 4-02.1, apply it.") === 1, "...but a marker in the NEXT sentence does not excuse a teaching sentence");
check(hits("Source: TCCC / TC 4-02.1\nsuperseded notes live here") === 1, "...nor does a marker on the next line");
check(hits("CTC 4-02.1 and xTC 4-02.1") === 0 && hits("see TC 4-02.1") === 1, "honest: the pub type is a whole word (CTC 4-02.1 is not TC 4-02.1), while a plain 'see TC 4-02.1' still counts");
// Words that ordinary medical prose uses ("prior to", "previous", "replace the dressing", "older", "no longer") say nothing about a
// publication changing: a teaching sentence that happens to contain one is still a teaching.
check(hits("Per TC 4-02.1: apply the tourniquet prior to moving the casualty.") === 1 && hits("Per TC 4-02.1, replace the saturated dressing.") === 1 && hits("Per TC 4-02.1, treat the previous severe bleeding first.") === 1 && hits("Per TC 4-02.1, an older casualty may no longer be able to self-aid.") === 1,
  "a teaching sentence is not excused by everyday words (prior to, replace the dressing, previous bleeding, older, no longer): each is 1 unmarked mention");
// A comma, not a semicolon: "; " ends a sentence, so a semicolon would put the marker in another sentence at ANY reach and the
// distance rule (MARKER_REACH) would never be exercised. With commas the marker and the designator share one sentence.
const farText = "Per TC 4-02.1 stop the bleeding, tighten the windlass until it stops, secure the strap, note the time, move the casualty, and this was formerly done another way";
check(farText.indexOf("formerly") - "Per TC 4-02.1".length > 60 && !/[.;!?]\s/.test(farText) && hits(farText) === 1,
  "...and a change word in the SAME sentence but more than 60 characters from the designator does not excuse it either (the distance rule, not the sentence splitter)", () => "hits=" + hits(farText) + " gap=" + (farText.indexOf("formerly") - "Per TC 4-02.1".length));
check(hits("Per TC 4-02.1 stop the bleeding, formerly done another way") === 0, "...while the same marker within 60 characters does (the upper bound is tested from both sides)");
// The change words that ordinary medical prose also uses never excuse a teaching sentence, however close they sit; only a status
// change OF THE PUBLICATION does (strict word, status predicate on the designator, naming phrase, or a change word beside ANOTHER designator).
check(hits("Per TC 4-02.1 a wet dressing is replaced with a dry one.") === 1 && hits("Per TC 4-02.1, a second tourniquet replaces the first only after two hours.") === 1 && hits("Per TC 4-02.1 the strap used to be tightened by twisting the rod.") === 1 && hits("Per TC 4-02.1 the form was renamed on the card.") === 1 && hits("Per TC 4-02.1, replaced items must be documented.") === 1 && hits("Per TC 4-02.1, obsolete dressings are discarded.") === 1 && hits("TC 4-02.1 is not outdated, so apply it.") === 1 && hits("Per TC 4-02.1, the card is replaced with DD Form 1380 at handoff.") === 1,
  "a teaching is not excused by 'replaced with', 'replaces', 'used to be', 'renamed', 'replaced items', 'obsolete dressings', a negated 'not outdated', or a swap of forms: each is 1 unmarked mention");
check(hits("The older name was TC 4-02.1.") === 0 && hits("Study guides may still say TC 4-02.1 (the older name), which is the old manual.") === 0 && hits("TC 4-02.1 is no longer used; use ATP 4-02.11.") === 0 && hits("TC 4-02.1 has been replaced.") === 0 && hits("ATP 4-02.11, replacing TC 4-02.1, covers casualty response.") === 0 && hits("TC 4-02.1 is outdated.") === 0 && hits("The old TC 4-02.1 First Aid manual is gone.") === 0 && hits("TC 4-02.1, retired in 2026, is not the source anymore.") === 0 && hits("TC 4-02.1 is out of date.") === 0 && hits("TC 4-02.1 was renamed ATP 4-02.11.") === 0 && hits("ATP 4-02.11 is the replacement for TC 4-02.1.") === 0,
  "honest history phrased the ordinary way is not refused: the older name, is no longer used, has been replaced, replacing, is outdated, the old, retired in 2026, out of date, renamed ATP 4-02.11, the replacement for");
check(hits("Per ATP 4-02.1, Class VIII was replaced by the supply system.") === 0 && hits("Per TC 4-02.2, field sanitation applies.") === 0 && hits("Per FM 4-02.1 the old doctrine applied.") === 0 && hits("Per TC 4-02.11, prior to moving the casualty, check the airway.") === 0 && hits("Per TC 4-02.1-2, prior to moving the casualty, check the airway.") === 0,
  "similarly numbered manuals (ATP 4-02.1, TC 4-02.2, FM 4-02.1, TC 4-02.11, TC 4-02.1-2) are not TC 4-02.1, whatever words surround them");
check(hits("ATP 4-02.11, which replaces TC 4-02.1, covers casualty response.") === 0 && hits("TC 4-02.1 is no longer current.") === 0 && hits("TC 4-02.1 was rescinded.") === 0 && hits("TC 4-02.1 (retired)") === 0 && hits("The supersession of TC 4-02.1 is in the cover.") === 0 && hits("TC 4-02.1 has been replaced with ATP 4-02.11.") === 0,
  "honest: a change word right beside the designator (replaces, no longer current, rescinded, (retired), supersession, replaced with) still marks it");
check(designatorRegex("TC 4-02.1").test("see TC 4-02.1") && !designatorRegex("TC 4-02.1").test("ATP 4-02.1"), "designatorRegex('TC 4-02.1') matches the designator and not ATP 4-02.1");

// Round 3: the edges a third review found. Each stale case is a sentence that still TEACHES from the old manual; each honest case is history.
check(hits("Per TC 4-02.1, stop the bleeding; the manual was superseded in March 2026.") === 1 && hits("It was superseded; per TC 4-02.1, apply it.") === 1 && hits("Per TC 4-02.1, stop the bleeding, the manual was superseded in March 2026.") === 0,
  "a semicolon ends a sentence: a marker after one, or before one, does not excuse the teaching beside it (the same words after a comma do)");
check(hits("Per TC\u200b 4-02.1, apply it.") === 1 && hits("Per TC 4\u00ad-02.1, apply it.") === 1 && hits("Per T\u200dC 4-02.\u20601, apply it.") === 1 && hits("TC\u200b 4-02.1 was superseded by ATP 4-02.11.") === 0,
  "a zero-width character or soft hyphen inside the designator cannot hide it (and cannot make an honest sentence fail)");
check(hits("Per TC 4-02.1, the prior version of the card is filled out first.") === 1 && hits("Per TC 4-02.1, the old edition of the sling is used for fractures.") === 1 && hits("Per TC 4-02.1, the original manual placement of the rod is kept.") === 1,
  "a naming phrase that is about something else is not about the publication: 'the prior version of the card', 'the old edition of the sling', 'the original manual placement' do not excuse a teaching");
check(hits("Repeat the previous TC 4-02.1 step until bleeding stops.") === 1 && hits("As in the earlier TC 4-02.1 paragraph, tighten the windlass.") === 1 && hits("Use the prior TC 4-02.1 card.") === 1,
  "'previous', 'earlier' and 'prior' right before a designator used as an adjective ('the previous TC 4-02.1 step') do not excuse a teaching");
check(hits("The previous TC 4-02.1.") === 0 && hits("The earlier TC 4-02.1, published in 2016, is gone.") === 0 && hits("The previous edition of the manual, TC 4-02.1, is gone.") === 0 && hits("The older edition of the TC 4-02.1 manual is gone.") === 0,
  "...while honest uses still pass: 'the previous TC 4-02.1.', 'the earlier TC 4-02.1, published in 2016,', 'the previous edition of the manual', 'the older edition of the TC 4-02.1 manual'");
check(hits("TC 4-02.1, para. 3-9, was superseded by ATP 4-02.11.") === 0 && hits("TC 4-02.1 (U.S. Army, 2016) was superseded in 2026.") === 0 && hits("TC 4-02.1 No. 2 was superseded by ATP 4-02.11.") === 0 && hits("TC 4-02.1 (p. 31) was superseded.") === 0,
  "an abbreviation's period does not end a sentence: 'para. 3-9', 'U.S. Army', 'No. 2' and 'p. 31' inside honest history no longer make it fail");
check(hits("It is not superseded. No. Per TC 4-02.1, apply it.") === 1 && hits("Per TC 4-02.1 stop the bleeding, see p. 31. Formerly it was done differently.") === 1,
  "...but a period that is not an abbreviation's (\"No.\" with no number, \"p. 31.\" at a sentence end) still ends the sentence");
check(hits("TC 4-02.1\nwas superseded by ATP 4-02.11") === 0 && hits("TC 4-02.1\nhas been replaced.") === 0,
  "a status predicate right after the designator is read across a line break ('TC 4-02.1' newline 'was superseded by ...')");
check(hits("Source: TCCC / TC 4-02.1\nsuperseded notes live here") === 1 && hits("Sources:\n- TC 4-02.1\n- replaced items") === 1 && hits("Per TC 4-02.1, apply the tourniquet\nformerly done differently") === 1,
  "...but a line break still ends a sentence otherwise: a marker on the next line, or on the next list line, does not excuse a teaching");

/* =====================================================================
   3. The real bank passes, and the relabel holds
   ===================================================================== */
console.log("\n3. the real bank");
const run = (extra = []) => { const r = spawnSync(process.execPath, [LINT, ...extra], { encoding: "utf8", cwd: APP }); return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const real = run();
check(real.status === 0 && /LINT-PUB-SUPERSESSION: all passed/.test(real.out), "the lint passes on the real bank", () => "exit " + real.status + "\n" + real.out);
check(/NOTE  FM 6-22 -> ADP 6-22 is NOT enforced/.test(real.out) && /NOTE  FM 3-23\.35/.test(real.out) && /NOTE  AR 600-8-1/.test(real.out), "...and says which table rows it is not enforcing, and why", () => real.out);

const bank = assembleBank().data;
const board = bank.board.questions, byId = new Map(board.map((q) => [q.id, q]));
const firstAid = board.filter((q) => /^tc4021-\d+$/.test(q.id));
check(firstAid.length === 19 && firstAid.every((q) => q.category === "ATP 4-02.11"), "the 19 tc4021-* cards keep their ids (saved study progress is keyed by id) and sit in the category 'ATP 4-02.11'", () => J(firstAid.map((q) => [q.id, q.category])));
check(!board.some((q) => q.category === "TC 4-02.1"), "no board card is left in a category named after the replaced manual");
check(firstAid.every((q) => q.source[0].pub === "ATP 4-02.11" && q.source.every((e) => e.pub === "ATP 4-02.11" || e.pub === "ATP 4-02.2")), "each of the 19 cites ATP 4-02.11 first (tc4021-9 also names ATP 4-02.2, whose Table C-1 its Line 1 and Line 5 text comes from); whether a card prints as a quotation is decided by what its By-the-Book text IS, checked mechanically below", () => J(firstAid.map((q) => [q.id, q.source.map((e) => e.pub)])));
const stillOld = [];
for (const q of firstAid) for (const f of ["q", "a", "boardAnswer", "concept"]) if (/\bTC 4-02\.1\b/.test(q[f] || "")) stillOld.push(q.id + "." + f);
check(stillOld.length === 0 && firstAid.every((q) => /ATP 4-02\.11/.test(q.concept) || /ATP 4-02\.11/.test(q.boardAnswer)), "...and their wording says ATP 4-02.11 too, not just the structured field", () => J(stillOld));
const legacy = ["bq-tccc-02", "bq-tccc-03", "tccc-004", "tccc-005", "tccc-006", "tccc-10"].map((id) => byId.get(id));
check(legacy.every((q) => q && quoteKindOf(q.source) === "paraphrase" && q.source.some((e) => e.pub === "ATP 4-02.11" || /ATP 4-02\.11/.test(e.pub))), "the six older First Aid cards cite ATP 4-02.11 and read 'Study-guide answer', not as a word-for-word quotation of it", () => J(legacy.map((q) => q && [q.id, quoteKindOf(q.source)])));

/* The six older cards were relabelled from TC 4-02.1 to ATP 4-02.11 without being re-read against it, and two of them said the
   OPPOSITE of the bundled text (the tourniquet card put the time on the casualty's forehead and 2-3 inches above the wound in
   Care Under Fire; the tension pneumothorax card named the 4th/5th space for the side site). They are pinned to what the
   Library's own ATP 4-02.11 says: each fact below is first proved to be in that text, then required in the card. */
const atpText = (docs.find((d) => d.citation === "ATP 4-02.11") || { pages: [] }).pages.join(" ").replace(/\s+/g, " ");
const inAtp = (re) => re.test(atpText);
const allText = (q) => [q.a, q.acceptableAnswer, q.boardAnswer, ...(q.keyPoints || [])].join(" | ");
const [m02, m03, p004, p005, p006, p10] = legacy;
check(atpText.length > 100000 && inAtp(/Do not document the TQ application time until the TFC phase/) && inAtp(/during TFC, all TQs should be deliberate, placed two to three inches above the wound directly on the skin/) && inAtp(/Documenting the time of TQ placement on both the TQ itself and the DD Form 1380 during TFC, rather than CUF/),
  "fixture: the bundled ATP 4-02.11 says what the tourniquet card is pinned to (hasty high-and-tight and no time-marking in Care Under Fire; 2-3 inches on the skin and time on the tourniquet and DD Form 1380 in Tactical Field Care)", () => "the Library text no longer carries these sentences - re-read the card against the new edition");
const cuf5 = (p005.boardAnswer.match(/Care Under Fire:(.*?)Tactical Field Care:/s) || [])[1] || "", tfc5 = (p005.boardAnswer.match(/Tactical Field Care:(.*)$/s) || [])[1] || "";
check(/high and tight/.test(cuf5) && /Do not document the time until Tactical Field Care/.test(cuf5) && !/two to three inches|2-3 inches/.test(cuf5), "tccc-005 keeps Care Under Fire apart from Tactical Field Care: in CUF a hasty tourniquet high and tight, no time marked, and no \"2-3 inches\"", () => J(cuf5));
check(/two to three inches above the wound, directly on the skin/.test(tfc5) && /time on the tourniquet itself and on DD Form 1380/.test(tfc5), "...and 2-3 inches on the skin, with the time on the tourniquet and DD Form 1380, belongs to Tactical Field Care", () => J(tfc5));
check([m02, m03, p005, p10].every((q) => !/forehead|SOFTT|within about 60 seconds|up to 2 hours has minimal risk/i.test(allText(q))), "no card still sends the time to the casualty's forehead, names SOFTT-W, or promises a life saved \"within about 60 seconds\" (none is in the bundled text)", () => J([m02, m03, p005, p10].filter((q) => /forehead|SOFTT|within about 60 seconds|up to 2 hours has minimal risk/i.test(allText(q))).map((q) => q.id)));
check(!/2-3 inches[^.|]*write time on patient|write the time on the patient/i.test(allText(m02)) && !/Never remove in the field|forehead, hand, or tourniquet/i.test(allText(m03)) && /DD Form 1380/.test(m03.boardAnswer) && /hasty tourniquet/.test(m03.boardAnswer), "bq-tccc-02 and bq-tccc-03 no longer teach one placement and time-marking rule for both phases", () => J({ m02: m02.keyPoints, m03: m03.keyPoints }));
check(inAtp(/Anterior axillary line in the fifth intercostal space/) && inAtp(/Second, intercostal space in the mid-clavicular line/) && inAtp(/second-leading cause of preventable deaths/),
  "fixture: the bundled text gives the two needle-decompression sites as the 2nd space mid-clavicular and the FIFTH space anterior axillary", () => "the Library no longer carries the site sentences");
check(/fifth intercostal space on the anterior axillary line/.test(p004.boardAnswer) && /5th ICS anterior axillary/.test(p004.keyPoints.join(" ")) && !/4th\/5th|4th intercostal/i.test(allText(p004)), "tccc-004 names the FIFTH intercostal space on the anterior axillary line (it said 4th/5th)", () => J(allText(p004)));
check(!/chest tube|SpO2|hypotension|breath sounds|ATP 4-02\.84|14-gauge, 3\.25/i.test(allText(p004)), "...and no longer claims what the bundled text does not say (a chest tube, SpO2, hypotension, breath sounds, a gauge and length, or ATP 4-02.84 TCCC guidance)", () => J(allText(p004).match(/chest tube|SpO2|hypotension|breath sounds|ATP 4-02\.84|14-gauge, 3\.25/i)));
check(inAtp(/should not be used to describe the tactical evacuation care phase/) && !/TACEVAC|Role 2|standing orders/.test(allText(p006)) && /Tactical Evacuation Care/.test(p006.boardAnswer), "tccc-006 does not call the third phase TACEVAC (ATP 4-02.11 para 3-57 says not to), name Role 2 or cite standing orders", () => J(allText(p006).match(/TACEVAC|Role 2|standing orders/g)));
check(inAtp(/Airway and other issues are not treated until the TFC phase/) && !/1 May 2026|burning vehicles or buildings/.test(allText(p10)) && /Airway and other problems are not treated until the Tactical Field Care phase/.test(p10.boardAnswer), "tccc-10 no longer attributes an edition date the bundle cannot confirm, and says airway waits for Tactical Field Care in the manual's terms", () => J(allText(p10).match(/1 May 2026|burning vehicles or buildings/)));

/* ---- Round 2: the rest of what the relabelled records teach. The six cards above were not the only records relabelled without a re-read:
   the 19 First Aid cards, the First Aid course, doc-tccc and three more doctrine entries were too, and a second review found them teaching
   what the bundled text does not say (a tourniquet rule with no phase, 'tracheal deviation' as the first sign, 'TACEVAC' as the phase name).
   Every fact pinned below is first PROVEN to be in the Library's own ATP 4-02.11, then required in the field that teaches it - field by field
   (a, acceptableAnswer, keyPoints, boardAnswer, tiers, check, explanation) - so restoring one wrong sentence anywhere fails a named check. ---- */
const PROOF = {
  "hasty tourniquet is high and tight in Care Under Fire (4-39)": /A hasty TQ is implemented as .high and tight. on the wounded extremity or when the bleeding source is ambiguous during the CUF phase/,
  "deliberate tourniquet is 2-3 inches on the skin in Tactical Field Care (4-39)": /during TFC, all TQs should be deliberate, placed two to three inches above the wound directly on the skin, not over clothing/,
  "no tourniquet time in Care Under Fire (4-41)": /Do not document the TQ application time until the TFC phase/,
  "time on the tourniquet and DD Form 1380 in Tactical Field Care (4-63)": /Documenting the time of TQ placement on both the TQ itself and the DD Form 1380 during TFC, rather than CUF/,
  "tourniquet THEN cover (4-9)": /a hasty TQ is applied .high and tight. on the injured extremity and then cover should be acquired/,
  "the order in Care Under Fire is mission-variable (3-38)": /The order of actions during CUF is mission-variable dependent/,
  "airway waits for Tactical Field Care (4-7)": /Airway and other issues are not treated until the TFC phase/,
  "a tourniquet is the only medical intervention in Care Under Fire (4-7)": /During CUF a TQ is the only medical intervention available to stop life-threatening bleeding from an extremity injury/,
  "after the hasty tourniquet, priority shifts to cover (2-12)": /Once a casualty has been treated with a hasty TQ, if the tactical situation allows, priority shifts to getting them to cover/,
  "immediate movement for a burning vehicle (2-10)": /Immediate movement may be necessary in certain safety-critical situations, such as a burning vehicle or enemy fire/,
  "a second tourniquet goes beside the first, higher (4-62)": /apply a second deliberate TQ adjacent to the original, positioned higher on the limb/,
  "under two hours, limb loss after six (4-40)": /optimal safe duration being less than two hours.{1,200}limb loss after six hours/,
  "M is the top priority (3-95)": /Massive Bleeding or hemorrhaging \(the top priority\)/,
  "go back to M (4-3)": /if at any time massive bleeding is not controlled, go back to M/,
  "tension pneumothorax late signs (6-31)": /Late signs, which may appear as the condition worsens, include: . Swollen neck veins\. . Tracheal deviation/,
  "tension pneumothorax early signs (6-31)": /Early signs include: . Increasing difficulty breathing over time\. . Shortness of breath\. . Confusion, lightheadedness, or agitation from low oxygen\. . Bluish discoloration around the mouth and lips\. . Rapid pulse/,
  "NDC sites (6-36)": /Second, intercostal space in the mid-clavicular line\. . If the needle is used at the second intercostal space, ensure the site selection is outside the nipple line\. . Anterior axillary line in the fifth intercostal space/,
  "never an NDC through a chest seal (6-35)": /DO NOT put an NDC through a chest seal! Use an alternate site instead/,
  "try the alternate NDC site (6-35)": /a second NDC should be attempted at the alternate recommended site/,
  "vented chest seal preferred (6-42)": /A CoTCCC vented commercial chest seal is the preferred type of chest seal/,
  "the phase is named Tactical Evacuation Care (3-56)": /Tactical evacuation care is the third phase of care in tactical combat casualty care\. Care provided during transportation from the battlefield to a medical treatment facility/,
  "TACEVAC is not the phase name (3-57)": /the term .TACEVAC. should not be used to describe the tactical evacuation care phase of TCCC/,
  "only medical priority in Care Under Fire is massive extremity bleeding (3-37)": /the only medical priority is addressing massive extremity bleeding due to the ongoing threat/,
  "a casualty can bleed to death in as little as three minutes (4-2)": /can result in death in as little as three minutes if bleeding is allowed to continue/,
  "bleeding stops within one minute, secured within three (4-62)": /Bleeding cessation is expected within one minute, with full TQ securing achieved within three minutes/,
  "junctional hemostatic dressing waits for Tactical Field Care (4-2)": /treatment with a hemostatic dressing is not performed until the casualty transitions to TFC/,
  "every Service member should be trained in tourniquet use (3-50)": /all Service members with access to a first aid kit should be trained in TQ use/,
  "IV or IO access is a combat medic procedure (1-74)": /EMT procedures performed by combat medics encompass critical interventions such as airway management, establishing intravenous or intraosseous access/,
  "a CLS can perform needle chest decompression (3-67)": /the CLS can provide immediate lifesaving care, such as controlling severe bleeding and performing needle chest decompressions for tension pneumothorax/,
  "a CLS treats the most common causes of death (1-11)": /treats the most common causes of death on the battlefield, which are massive hemorrhage, airway and\/or respiratory problems/,
  "at least one CLS per squad, crew or team (1-11)": /A minimum of one individual per squad, crew, team, or equivalent-sized unit should be trained/,
  "CLS skills are recertified every 12 months (3-20)": /CLS skills are perishable and must be recertified every 12 months/,
  "cold stops blood clotting properly (8-5)": /cold temperatures can prevent blood from clotting properly/,
  "eight signs of shock (7-6)": /The signs and symptoms of shock include: . Mental confusion\. . Weak or absent radial pulse\. . Rapid breathing\. . Nausea\. . Sweaty, cool, or clammy skin\. . Excessive thirst\. . Pale or gray skin\. . Previous severe bleeding/,
  "not ALERT: no weapons or communications equipment (15-5)": /If the casualty is not ALERT, indicating decreased mental status, the casualty should not have weapons or communications equipment/,
  "recovery position is on the side (6-28)": /in the recovery position \(on the casualty.s side\)/,
  "lines 1-5 within 25 seconds (3-62)": /Line numbers 1 through 5 must be transmitted within 25 seconds during the initial/,
  "the completed DD Form 1380 is the '10th line' MIST report (9-2)": /Often referred to as the 10th line in the 9-line MEDEVAC request, the completed DD Form 1380 serves as the MIST report/,
  "the CWMP holds pain medicine and an antibiotic (9-5)": /The CWMP contains drugs for mild to moderate pain \(Meloxicam and Acetaminophen\) and an antibiotic specific for penetrating wounds \(Moxifloxacin\)/,
  "the cold injuries it names (17-38)": /Nonfreezing cold injuries are chilblain and snow blindness\. Trench foot occurs when tissues are exposed to temperatures from 32/,
  // Round 3: the facts the previously unpinned corrections rest on.
  "Rule of Nines: pubic area 1 percent, buttocks 1 percent (12-4)": /Pubic area . 1 percent\. . Buttocks . 1 percent/,
  "MARCH-PAWS: pain, wounds, antibiotics, splinting (3-95)": /pain, wounds, antibiotics, and splinting \(PAWS\)/,
  "PAWS is addressed after the MARCH portion (3-96)": /The second portion of the MARCH-PAWS casualty assessment is PAWS, which is addressed after the MARCH portion/,
  "heat exhaustion prevention (17-12)": /Practice proper fluid replacement.{1,160}Wear lightweight and loose-fitting clothing, use sunscreen, and take regular breaks in cool areas/,
  "fire superiority is the best medicine; casualty care is secondary (3-72)": /Fire superiority is paramount on the battlefield, serving as the best medicine.{1,300}providing casualty care becomes a secondary consideration/,
  "the Tier 2 CLS uses deliberate tourniquets in Tactical Field Care (4-58)": /during TFC the Tier 2 CLS treats any massive bleeding, from an extremity, with deliberate TQs/,
  "the CLS reassesses tourniquets from Care Under Fire; a hasty one may need adjustment (4-61)": /The CLS conducts reassessment of TQs applied during CUF to ensure their efficacy\. TQs hastily applied .high and tight. may need adjustment/,
  "tourniquets are removed only by medical personnel at a higher role of care (4-40)": /TQs should never be removed except by medical personnel at a higher role of care/,
  "open chest wounds are sealed immediately (6-22)": /All open or sucking chest wounds are treated by immediately applying a vented chest seal to cover the defect/,
  "the seal goes on right after the casualty exhales (6-27)": /Instruct the casualty to fully exhale and then immediately place the vent of the chest seal directly over the first wound encountered/,
};
// ATP 4-02.2 (12 July 2019) is in the Library too: tc4021-9 takes its Line 1 and Line 5 text from Table C-1.
const a22Text = ((docs.find((d) => d.citation === "ATP 4-02.2") || { pages: [] }).pages.join(" ")).replace(/\s+/g, " ");
const PROOF22 = {
  "Line 1: grid coordinates sent by secure communication (Table C-1)": /Grid coordinates of the pickup site should be sent by secure communication/,
  "Line 1 reason: so the evacuation vehicle knows where to pick up the patient (Table C-1)": /Required so evacuation vehicle knows where to pick up the patient\/casualty/,
  "Line 5: L+# litter, A+# ambulatory (sitting) (Table C-1)": /L\+# of patients.Litter A\+# of patients.Ambulatory \(sitting\)/,
  "Line 5 reason: the right number of vehicles, configured for those patients (Table C-1)": /Required so that the appropriate number of evacuation vehicles may be dispatched to the pickup site\. They should be configured to carry the patients requiring evacuation/,
};
const proof22Miss = Object.entries(PROOF22).filter(([, re]) => !re.test(a22Text)).map(([k]) => k);
check(a22Text.length > 50000 && proof22Miss.length === 0, "fixture: the bundled ATP 4-02.2 carries the Table C-1 sentences tc4021-9 rests on (" + Object.keys(PROOF22).length + ")", () => "not in the Library text any more:\n  " + proof22Miss.join("\n  "));
const proofMiss = Object.entries(PROOF).filter(([, re]) => !re.test(atpText)).map(([k]) => k);
check(proofMiss.length === 0, `fixture: the bundled ATP 4-02.11 carries every sentence the field-by-field pins rest on (${Object.keys(PROOF).length})`, () => "not in the Library text any more - re-read the records against the new edition:\n  " + proofMiss.join("\n  "));
const NOT_IN_BUNDLE = ["SOFTT", "Hextend", "Blizzard", "Cushing", "Hyfin", "QuikClot", "HemCon", "NREMT", "standing orders", "golden hour", "frostnip", "flutter valve", "coagulopathy", "Glasgow", "absent breath sounds", "hypotension", "surgical cricothyrotomy"];
const inBundle = NOT_IN_BUNDLE.filter((w) => new RegExp(w, "i").test(atpText));
check(inBundle.length === 0, "fixture: none of the terms the second review found taught as ATP 4-02.11 content is in the bundled text (so none belongs in a record that cites it)", () => "now in the Library text: " + inBundle.join(", "));

/* ---- Round 3: the heading a card prints is decided by what its By-the-Book text IS ----
   "By the Book (verbatim doctrine)" is printed for a card whose source says verbatim, and the app's own comment (index.html, G.board.PARAPHRASE_LABEL)
   reserves it for text actually quoted from the publication. Round 2 pinned all 19 First Aid cards "verbatim" by rule, and three of them (tc4021-1,
   -8, -9) and the four 68W scope cards quote nothing: their By-the-Book text is the study guide's own prose. So the rule is mechanical and runs in
   BOTH directions over every board card that cites ATP 4-02.11 (and the 68W scope cards): a card marked verbatim must show a quotation - at least
   half of its By-the-Book text between quotation marks - and every quoted fragment must be found in the bundled text; a card whose text is not such
   a quotation must be marked paraphrase. A fragment may run across a page break (the running footer is cut off and up to 80 letters of running
   heading after the break are skipped) and may differ from the page in hyphenation, spacing and punctuation only. ---- */
const alnum = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
const stripFooter = (p) => p.replace(/23 March 2026\s+ATP 4-02\.11\s+\d{1,3}\s*$/s, " ").replace(/\d{1,3}\s+ATP 4-02\.11\s+23 March 2026\s*$/s, " ");
const atpDoc = docs.find((d) => d.citation === "ATP 4-02.11");
const atpStream = atpDoc.pages.map((p) => alnum(stripFooter(p))).join("|");
const PAGE_GAP = "(?:\\|[a-z0-9]{0,80})?";
const fragmentInBundle = (frag) => { const a = alnum(frag); return a.length < 8 || new RegExp(a.split("").join(PAGE_GAP)).test(atpStream); };
const quotedFragments = (shown) => [...shown.matchAll(/["\u201c]([^"\u201c\u201d]+)["\u201d]/g)].map((m) => m[1]);
const quotePieces = (frag) => frag.split(/\.\.\.|\u2026|\[[^\]]*\]/);
const judgeLabel = (q) => {
  const body = String(q.boardAnswer || q.a || "").replace(/\s*\((?:ATP|TC)[^()]*\)\.?\s*$/, "");
  const frags = quotedFragments(body);
  const share = frags.reduce((n, x) => n + x.length, 0) / Math.max(1, body.length);
  const isQuotation = frags.length >= 1 && share >= 0.5;
  return { isQuotation, share: Math.round(100 * share), frags: frags.length, missing: isQuotation ? frags.filter((x) => !quotePieces(x).every(fragmentInBundle)) : [] };
};
const labelOf = (q) => ((q.source || []).some((e) => e.quoteKind === "verbatim") ? "verbatim" : "paraphrase");
const labelled = board.filter((q) => (q.source || []).some((e) => /^ATP 4-02\.11/.test(e.pub)) || /^68w-scope-/.test(q.id));
const wrongLabel = [];
for (const q of labelled) {
  const j = judgeLabel(q), kind = labelOf(q);
  if (kind === "verbatim" && !j.isQuotation) wrongLabel.push(q.id + ": marked verbatim but its By-the-Book text is not a quotation (" + j.frags + " quoted fragment(s), " + j.share + "% of the text)");
  if (kind === "verbatim" && j.missing.length) wrongLabel.push(q.id + ": marked verbatim but a quoted fragment is not in the bundled text: " + J(j.missing[0].slice(0, 90)));
}
const verbatimN = labelled.filter((q) => labelOf(q) === "verbatim").length;
check(wrongLabel.length === 0 && verbatimN >= 10, "every board card that cites ATP 4-02.11 (and the 68W scope cards) prints as a quotation only when its By-the-Book text is one: " + verbatimN + " verbatim cards each quote the bundled text, and the " + (labelled.length - verbatimN) + " others are labelled paraphrase", () => wrongLabel.join("\n    "));
check(["tc4021-1", "tc4021-8", "tc4021-9", "68w-scope-01", "68w-scope-02", "68w-scope-03", "68w-scope-04"].every((id) => labelOf(byId.get(id)) === "paraphrase" && !judgeLabel(byId.get(id)).isQuotation),
  "...and the seven cards that quote nothing (tc4021-1, -8, -9 and 68w-scope-01 to -04) read 'Study-guide answer', not 'By the Book (verbatim doctrine)'", () => J(["tc4021-1", "tc4021-8", "tc4021-9", "68w-scope-01", "68w-scope-02", "68w-scope-03", "68w-scope-04"].map((id) => [id, labelOf(byId.get(id))])));
// The judge itself, on stand-in cards: an honest quotation passes, an altered one is caught, prose with a small quote in it is not a quotation.
{
  const real = "Tactical field care is the second phase of care in tactical combat casualty care. Care provided once the threat has been neutralized, the scene is safe, or the casualty has moved or been moved out of the immediate threat situation.";
  const stand = (text) => ({ id: "stand-in", a: text, source: [{ pub: "ATP 4-02.11", quoteKind: "verbatim" }] });
  const honest = judgeLabel(stand('"' + real + '" (ATP 4-02.11, para 3-51.)'));
  const altered = judgeLabel(stand('"' + real.replace("second phase", "third phase") + '" (ATP 4-02.11, para 3-51.)'));
  const prose = judgeLabel(stand("Tactical field care starts when the threat is gone, which the manual calls the 'second phase of care' and which is when you can finally slow down and do a full assessment and treatment (ATP 4-02.11, para 3-51.)"));
  const none = judgeLabel(stand("Massive hemorrhage is the most frequent cause of preventable death on the battlefield. (ATP 4-02.11, para 4-1.)"));
  check(honest.isQuotation && honest.missing.length === 0, "the label check accepts an honest quotation (control)", () => J(honest));
  check(altered.isQuotation && altered.missing.length === 1, "...catches a quotation with one word changed ('third phase'): its fragment is not in the bundled text", () => J(altered));
  check(!prose.isQuotation && !none.isQuotation, "...and does not take prose with a small quoted phrase, or prose with no quotation, for a quotation", () => J([prose, none]));
}

/* ---- Round 3: every 'para X ... p. N' citation is checked against the manual's own printed page footers ---- */
const printedOf = (p) => { const a = /23 March 2026\s+ATP 4-02\.11\s+(\d{1,3})\s*$/s.exec(p) || /(\d{1,3})\s+ATP 4-02\.11\s+23 March 2026\s*$/s.exec(p); return a ? Number(a[1]) : null; };
const paraStart = new Map(), paraOrder = [];
atpDoc.pages.forEach((p, i) => { for (const m of p.matchAll(/(?:^|\n)\s*(\d{1,2}-\d{1,3})\.\s/g)) if (!paraStart.has(m[1])) { paraStart.set(m[1], { page: printedOf(p), i }); paraOrder.push(m[1]); } });
const paraSpan = (para) => {
  const st = paraStart.get(para); if (!st || st.page == null) return null;
  const nx = paraStart.get(paraOrder[paraOrder.indexOf(para) + 1]);
  return { lo: st.page, hi: nx && nx.page != null ? Math.max(st.page, nx.page) : st.page };
};
const pageCite = /paras?\.?\s*(\d{1,2}-\d{1,3}[^()]{0,80}?),\s*pp?\.\s*(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?/g;
const badPages = [];
let pageCites = 0;
for (const q of board) {
  if (!(q.source || []).some((e) => /^ATP 4-02\.11/.test(e.pub))) continue;
  for (const [field, text] of [["a", q.a], ["acceptableAnswer", q.acceptableAnswer], ["boardAnswer", q.boardAnswer], ...(q.keyPoints || []).map((k, i) => ["keyPoints[" + i + "]", k])]) {
    if (typeof text !== "string") continue;
    for (const m of text.matchAll(pageCite)) {
      pageCites++;
      const spans = (m[1].replace(/(?:Table|Figure)\s+\d{1,2}-\d{1,3}/g, "").match(/\d{1,2}-\d{1,3}/g) || []).map(paraSpan);
      const claimedLo = Number(m[2]), claimedHi = m[3] ? Number(m[3]) : claimedLo;
      if (spans.some((x) => !x)) { badPages.push(q.id + "." + field + ": " + J(m[0].slice(0, 60)) + " - a paragraph that is not in the bundled text"); continue; }
      const lo = Math.min(...spans.map((x) => x.lo)), hi = Math.max(...spans.map((x) => x.hi));
      if (claimedHi < lo || claimedLo > hi) badPages.push(q.id + "." + field + ": " + J(m[0].slice(0, 60)) + " claims p. " + claimedLo + (claimedHi !== claimedLo ? "-" + claimedHi : "") + " but the manual prints it on p. " + lo + (hi !== lo ? "-" + hi : ""));
    }
  }
}
check(pageCites >= 40 && badPages.length === 0, "every 'para X, p. N' citation on a card that cites ATP 4-02.11 names a page the paragraph is really printed on (" + pageCites + " citations read from the manual's own page footers; tc4021-3 and -14 said 111 for para 11-30, tc4021-11 said 77 for 5-16, tc4021-16 said 44 for 3-51)", () => badPages.join("\n    "));
{
  const probe = (txt) => { const m = [...txt.matchAll(pageCite)][0]; if (!m) return "unread"; const sp = (m[1].match(/\d{1,2}-\d{1,3}/g) || []).map(paraSpan); const lo = Math.min(...sp.map((x) => x.lo)), hi = Math.max(...sp.map((x) => x.hi)); const cl = Number(m[2]), ch = m[3] ? Number(m[3]) : cl; return ch < lo || cl > hi ? "wrong" : "right"; };
  check(probe("(ATP 4-02.11, para 11-30, p. 112.)") === "right" && probe("(ATP 4-02.11, para 11-30, p. 111.)") === "wrong" && probe("(ATP 4-02.11, para 3-51, p. 33)") === "right" && probe("(ATP 4-02.11, para 3-51, p. 44)") === "wrong",
    "...and the page check itself tells a right page from a wrong one (control: para 11-30 is on p. 112, para 3-51 on p. 33)", () => J([probe("(ATP 4-02.11, para 11-30, p. 112.)"), probe("(ATP 4-02.11, para 11-30, p. 111.)"), probe("(ATP 4-02.11, para 3-51, p. 33)"), probe("(ATP 4-02.11, para 3-51, p. 44)")]));
}

const fieldOf = (rec, f) => { const m = /^keyPoints\[(\d+)\]$/.exec(f); return String(m ? (rec.keyPoints || [])[Number(m[1])] : rec[f] ?? ""); };
const pin = (label, rec, list) => {
  const miss = [];
  for (const [f, re, mustNot] of list) { const t = fieldOf(rec, f); if (mustNot ? re.test(t) : !re.test(t)) miss.push((mustNot ? "must NOT match " : "must match ") + f + "  " + re + "\n      field: " + t.slice(0, 220)); }
  check(miss.length === 0, `${label}: ${list.length} fields pinned to the bundled text`, () => miss.join("\n    "));
};
const lesson = (cid, lid) => bank.curriculum.courses.find((c) => c.id === cid).lessons.find((l) => l.id === lid);
const lt = (l) => ({ ...l.tiers, "check.q": l.check.q, "check.a": l.check.a, explanation: (l.knowledgeCheck || {}).explanation, options: ((l.knowledgeCheck || {}).options || []).join(" | ") });

pin("bq-tccc-02 (MARCH)", m02, [
  ["keyPoints[0]", /hasty tourniquet "high and tight" in Care Under Fire, a deliberate one 2-3 inches above the wound in Tactical Field Care/],
  ["keyPoints[1]", /recovery position for an unconscious casualty/], ["keyPoints[2]", /needle decompression for tension pneumothorax/],
  ["a", /Massive bleeding always comes first/], ["acceptableAnswer", /then PAWS \(pain, wounds, antibiotics, splinting\)/],
  ["boardAnswer", /Massive bleeding \(the top priority\)/], ["boardAnswer", /you go back to M/], ["boardAnswer", /followed by PAWS: pain, wounds, antibiotics and splinting/],
]);
pin("bq-tccc-03 (when to apply a tourniquet)", m03, [
  ["acceptableAnswer", /In Care Under Fire put it on high and tight over the uniform; in Tactical Field Care recheck it, and put any new tourniquet 2-3 inches above the wound on bare skin and write the time on the tourniquet and DD Form 1380/],
  ["acceptableAnswer", /even under fire/i, true],
  ["boardAnswer", /In Care Under Fire, put a hasty tourniquet on "high and tight" over the uniform, tighten until the bleeding stops, and move to cover; do not stop to record the time yet/],
  ["boardAnswer", /In Tactical Field Care, recheck the hasty tourniquet, which may need adjusting; a tourniquet put on in this phase is a deliberate one, placed two to three inches above the wound directly on the skin, and the time is written on the tourniquet and on DD Form 1380\. If bleeding continues, add a second tourniquet next to the first, higher on the limb; do not take the first one off\./],
  ["boardAnswer", /place a deliberate tourniquet two to three inches/, true],
  ["keyPoints[1]", /Care Under Fire: a hasty tourniquet HIGH and TIGHT over the uniform — no time-marking yet/], ["keyPoints[2]", /Tactical Field Care: recheck the hasty tourniquet; any new tourniquet is a deliberate one, 2-3 inches above the wound, directly on the skin/],
  ["keyPoints[4]", /Write the time on the tourniquet and on DD Form 1380 in Tactical Field Care/], ["keyPoints[5]", /Only medical personnel at a higher role of care remove it/],
]);
pin("tccc-004 (tension pneumothorax)", p004, [
  ["a", /second intercostal space in the mid-clavicular line, or at the fifth intercostal space on the anterior axillary line/],
  ["acceptableAnswer", /Early signs: worsening difficulty breathing, rapid pulse, bluish lips; late signs: swollen neck veins and tracheal deviation/], ["acceptableAnswer", /2nd intercostal space \(mid-clavicular line\) or the 5th \(anterior axillary line\)/],
  ["boardAnswer", /Early signs: increasing difficulty breathing, shortness of breath, confusion or agitation, bluish color around the mouth and lips, and a rapid pulse\. Late signs: swollen neck veins and tracheal deviation/],
  ["boardAnswer", /second intercostal space in the mid-clavicular line \(outside the nipple line\) or at the fifth intercostal space on the anterior axillary line — never through a chest seal/],
  ["boardAnswer", /If the first NDC does not help, try the other site/], ["boardAnswer", /A vented chest seal is the preferred seal/],
  ["keyPoints[2]", /Never put the needle through a chest seal; if the first try fails, use the other site/], ["keyPoints[3]", /Tracheal deviation and swollen neck veins are late signs/],
]);
pin("tccc-005 (tourniquet)", p005, [
  ["a", /In Care Under Fire, put a hasty tourniquet on "high and tight" over the uniform, tighten until the bleeding stops, and move to cover — don't stop to record the time yet\. In Tactical Field Care, reassess the hasty tourniquet \(it may need adjusting\); a tourniquet put on in this phase is a deliberate one, two to three inches above the wound directly on the skin, and if bleeding continues a second goes next to the first, higher on the limb\. Write the time on the tourniquet and on DD Form 1380\. Only medical personnel at a higher role of care remove a tourniquet\./],
  ["a", /reassess it and (?:place|use) a deliberate/, true],
  ["acceptableAnswer", /Care Under Fire: a hasty tourniquet high and tight over the clothing, tighten until the bleeding stops, move to cover, no time-marking yet\. Tactical Field Care: recheck the hasty tourniquet; any tourniquet put on now is a deliberate one 2-3 inches above the wound on bare skin, a second goes next to the first if bleeding continues, and the time is written on the tourniquet and DD Form 1380/],
  ["boardAnswer", /Tactical Field Care: reassess the hasty tourniquet, which may need adjusting; a tourniquet put on in this phase is a deliberate one, placed two to three inches above the wound, directly on the skin and not over clothing\./], ["boardAnswer", /the first one stays on/],
  ["keyPoints[2]", /recheck the hasty tourniquet; a tourniquet put on now is deliberate — 2-3 inches above the wound, directly on the skin/],
  ["boardAnswer", /add a second tourniquet next to the first, higher on the limb/], ["boardAnswer", /under two hours.{1,80}limb loss is possible after six hours/],
  ["keyPoints[1]", /Do not record the time in Care Under Fire — wait for Tactical Field Care/], ["keyPoints[4]", /never over a joint or a bulky pocket/],
]);
pin("tccc-006 (three phases)", { ...p006, cufA: (p006.a.match(/\(1\)(.*?)\(2\)/s) || [])[1] || "", cufB: (p006.boardAnswer.match(/\(1\)(.*?)\(2\)/s) || [])[1] || "" }, [
  ["cufA", /airway/i, true], ["cufB", /airway/i, true], ["cufA", /only medical priority/], ["cufB", /only medical priority/],
  ["a", /\(1\) Care Under Fire — very limited care while the threat is active: return fire, move to cover, and stop massive limb bleeding with a tourniquet \(the only medical priority\)/],
  ["a", /\(3\) Tactical Evacuation Care — care during the move to a higher level of care/], ["acceptableAnswer", /Care Under Fire \(return fire, tourniquet only\)/],
  ["boardAnswer", /\(1\) Care Under Fire \(CUF\) — the threat is still active, so care is very limited: suppress the enemy and gain fire superiority, move the casualty to cover, and treat massive extremity bleeding with a hasty tourniquet, the only medical priority\. \(2\)/],
  ["boardAnswer", /\(3\) Tactical Evacuation Care — care during the move from the battlefield to a medical treatment facility/],
  ["keyPoints[1]", /Care Under Fire: fire superiority, move to cover, tourniquet only/], ["keyPoints[3]", /Tactical Evacuation Care: keep monitoring and treating/],
  ["boardAnswer", /TACEVAC/, true], ["keyPoints[0]", /TACEVAC/, true],
]);
pin("tccc-10 (Care Under Fire)", p10, [
  ["a", /summarised from paras 2-10, 2-12, 3-37 to 3-40, 3-72 to 3-75 and 4-7 to 4-9 \(the manual does not give these as one numbered list, and para 3-38 says the order of actions depends on the mission and the tactical situation\)/],
  ["boardAnswer", /put on a hasty tourniquet "high and tight" and then get to cover; if the threat is suppressed, massive bleeding is addressed before the casualty is moved/],
  ["boardAnswer", /Airway and other problems are not treated until the Tactical Field Care phase/], ["boardAnswer", /such as a burning vehicle \(para 2-10\)/],
  ["boardAnswer", /before starting any treatment|Move or drag the casualty to cover/i, true],
  ["acceptableAnswer", /and then getting to cover; the order of those steps depends on the mission and the situation/], ["acceptableAnswer", /before starting any treatment/, true],
  ["keyPoints[2]", /hasty tourniquet "high and tight" and then cover is acquired \(para 4-9\)/], ["keyPoints[2]", /mission-variable \(para 3-38\)/],
  ["keyPoints[2]", /before starting any treatment/, true], ["keyPoints[3]", /only medical intervention in this phase is the tourniquet/], ["keyPoints[4]", /wait for the Tactical Field Care phase/],
]);

/* the other First Aid cards: one corrected fact each */
const fa = (n) => byId.get("tc4021-" + n);
pin("tc4021-3 (AVPU)", fa(3), [["keyPoints[1]", /should not have weapons or communications equipment \(para 15-5, note\)/], ["keyPoints[2]", /monitor unstable casualties' level of consciousness using the AVPU indicators \(para 11-34\)/], ["keyPoints[3]", /Document any AVPU assessment/], ["keyPoints[2]", /Glasgow/i, true]]);
pin("tc4021-4 (shock)", fa(4), [["acceptableAnswer", /lists eight signs and symptoms of shock/], ["acceptableAnswer", /nine|2016|superseded/i, true], ["keyPoints[0]", /The list has 8 items/]]);
pin("tc4021-7 (CPR)", fa(7), [["acceptableAnswer", /30:2\) when you are working alone\. With two rescuers the ratio can be 30:2, or continuous compressions/], ["keyPoints[1]", /with two rescuers it can be 30:2 or continuous compressions/]]);
pin("tc4021-9 (9-line)", fa(9), [["keyPoints[0]", /sent as grid coordinates by secure communication.{1,120}ATP 4-02\.2, Table C-1/], ["keyPoints[0]", /the evacuation vehicle needs it to know where to pick up the casualty \(ATP 4-02\.2, Table C-1\)/], ["keyPoints[0]", /without delay or exposing it/, true], ["keyPoints[1]", /L for litter, A for ambulatory.{1,200}ATP 4-02\.2, Table C-1/], ["keyPoints[1]", /so the right number of evacuation vehicles, set up to carry those patients, can be sent \(ATP 4-02\.2, Table C-1\)/], ["keyPoints[3]", /It is not officially part of the NATO and U\.S\. standard request/]]);
check(fa(9).source.length === 2 && fa(9).source[1].pub === "ATP 4-02.2" && fa(9).source[1].para === "Table C-1", "tc4021-9's structured source names ATP 4-02.2, Table C-1 beside ATP 4-02.11 (its Line 1 and Line 5 text comes from there)", () => J(fa(9).source));
pin("tc4021-2 (MARCH-PAWS)", fa(2), [["keyPoints[1]", /PAWS \(Pain, Antibiotics, Wounds, Splinting\) is deliberately deferred until all MARCH life threats are addressed/], ["keyPoints[1]", /mechanism/i, true]]);
pin("tc4021-5 (chest seal)", fa(5), [["keyPoints[1]", /right after the casualty fully exhales \(paras 6-22, 6-27\)/], ["keyPoints[1]", /6-19|don't wait/, true]]);
pin("tc4021-10 (burns)", fa(10), [["keyPoints[3]", /pubic area 1%, buttocks 1%/], ["keyPoints[3]", /groin/i, true]]);
pin("tc4021-13 (heat exhaustion)", fa(13), [["keyPoints[4]", /proper fluid replacement, lightweight and loose-fitting clothing, sunscreen, and regular breaks in cool areas \(para 17-12\)/], ["keyPoints[4]", /acclimati/i, true]]);
{
  const ied = bank.scenarios.scenarios.find((x) => x.id === "sc-tccc-ied-strike");
  const n1 = ied.nodes.n1.choices[0].feedback, n3 = ied.nodes.n3.prompt;
  check(/address the threat first \(fire superiority is the best medicine\), then stop life-threatening limb bleeding and get to cover in whatever order the mission and the situation allow \(paras 3-38, 3-72, 4-9\)/.test(n1) && !/get to cover, then treat/.test(n1),
    "sc-tccc-ied-strike's first choice says the threat comes first and the rest depends on the mission (paras 3-38, 3-72, 4-9), not 'cover, then bleeding'", () => J(n1));
  check(/^The tourniquet goes on high and tight and cinches down; the bleeding visibly slows\./.test(n3) && !/two fingers/i.test(n3),
    "...and its tourniquet goes on 'high and tight' (the hasty rule, para 4-39); the 'two fingers above the wound' the manual never says is gone", () => J(n3));
}
check(/signs of shock such as pale, cool, clammy skin, confusion, a weak or missing radial pulse, and rapid breathing/.test(lesson("c-firstaid", "l-circ-hypo").knowledgeCheck.explanation) && !/weak, rapid pulse/.test(lesson("c-firstaid", "l-circ-hypo").knowledgeCheck.explanation),
  "l-circ-hypo's quiz explanation lists the signs of shock the manual lists (para 7-6) and no longer says 'a weak, rapid pulse'", () => J(lesson("c-firstaid", "l-circ-hypo").knowledgeCheck.explanation));
pin("tc4021-11 (airway)", fa(11), [["keyPoints[1]", /safest first approach when a neck injury is suspected.{1,120}paras 5-18, 5-20/], ["keyPoints[3]", /roll them onto their back \(para 5-17\); an unconscious casualty who is breathing is placed in the recovery position \(para 5-23\)/], ["keyPoints[3]", /roll onto the back into the recovery position/, true]]);
pin("tc4021-15 (rescue breathing)", fa(15), [["keyPoints[1]", /injured, obstructed or inaccessible/], ["keyPoints[1]", /clenched/, true], ["keyPoints[4]", /lists four main methods \(para 6-50\)/]]);
pin("tc4021-16 (Tactical Field Care)", fa(16), [["keyPoints[0]", /Tactical Evacuation Care \(para 3-36, p\. 31\)\. Para 3-57 asks that the abbreviation 'TACEVAC' not be used as the name of that phase/], ["keyPoints[0]", /Tactical Evacuation Care \(TACEVAC\)/, true]]);
pin("tc4021-19 (MEDEVAC vs CASEVAC)", fa(19), [["keyPoints[4]", /report M030, IAW FM 6-99/], ["keyPoints[4]", /DD Form\/report M030/, true]]);

/* the First Aid course: Care Under Fire apart from Tactical Field Care in every tier, and the CLS role as the manual gives it */
const tq = lt(lesson("c-firstaid", "l-tourniquet"));
pin("c-firstaid l-tourniquet", tq, [
  ["layman", /Under fire you put it on fast, high up on the limb/],
  ["beginner", /Under fire \(Care Under Fire\), put a hasty tourniquet on "high and tight" over the uniform, tighten until the bleeding stops, and move to cover — don't stop to record the time yet\. Once you're safer \(Tactical Field Care\), the tourniquet is rechecked — the manual gives that to the Combat Lifesaver \(Tier 2\) — because a hasty one may need adjusting\. A tourniquet put on in this phase is a deliberate one, 2 to 3 inches above the wound directly on the skin and never over a joint; if bleeding continues, a second goes next to the first, higher on the limb\. Write the time on the tourniquet and on DD Form 1380, and leave it on: only medical personnel at a higher role of care remove it/],
  ["beginner", /reassess it and use a deliberate tourniquet/, true],
  ["intermediate", /high and tight, over the uniform if you have to, and tighten until the bleeding stops \(the manual's goal is under one minute\)/], ["intermediate", /a tourniquet you put on now is a deliberate one, 2 to 3 inches above the wound on bare skin/], ["intermediate", /add a second one next to the first, higher on the limb; leave the first one on/],
  ["professional", /the application time is not documented until Tactical Field Care/], ["professional", /two to three inches above the wound directly on the skin, not over clothing/], ["professional", /a hasty one may need adjusting \(paras 4-39, 4-61\), and any tourniquet put on in this phase is deliberate/], ["professional", /the first stays on \(paras 4-39, 4-60 to 4-63\)\. Para 4-58 gives deliberate tourniquets in Tactical Field Care to Tier 2, the Combat Lifesaver/], ["professional", /under two hours.{1,120}six hours/],
  ["check.q", /Where does a tourniquet go in Care Under Fire, and where in Tactical Field Care\?/], ["check.a", /Care Under Fire: a hasty tourniquet high and tight over the uniform, with no time written yet\. Tactical Field Care: recheck it, and any tourniquet put on now is a deliberate one 2 to 3 inches above the wound on bare skin, with the time on the tourniquet and on DD Form 1380/],
  ["explanation", /next to the first, higher on the limb/],
  ["beginner", /high and tight — 2 to 3 inches above the wound/, true], ["professional", /2 to 3 inches above the wound, never over a joint, tightening the windlass/, true], ["check.a", /^2 to 3 inches above the wound; never directly over a joint\.$/, true],
]);
pin("c-firstaid l-cls-role", lt(lesson("c-firstaid", "l-cls-role")), [
  ["intermediate", /Every Soldier gets basic self-aid and buddy aid training, including stopping life-threatening bleeding and using a tourniquet/], ["intermediate", /performing needle chest decompression for a tension pneumothorax/],
  ["intermediate", /IV or IO access is listed among the combat medic's procedures, not the CLS's/], ["intermediate", /CLS adds skills like tourniquet use|IV\/IO access under a medical officer/, true],
]);
pin("c-firstaid l-march-overview", lt(lesson("c-firstaid", "l-march-overview")), [["professional", /extremity hemorrhage is the most frequent cause of preventable battlefield death.{1,120}go back to M \(paras 4-1, 4-3\)/], ["options", /most frequent cause of preventable battlefield death/], ["professional", /kills faster/, true], ["options", /kills faster/, true], ["explanation", /kills faster/, true]]);
pin("c-firstaid l-airway-resp and l-circ-hypo", { ...Object.fromEntries(Object.entries(lt(lesson("c-firstaid", "l-airway-resp"))).map(([k, v]) => ["ar." + k, v])), ...Object.fromEntries(Object.entries(lt(lesson("c-firstaid", "l-circ-hypo"))).map(([k, v]) => ["ch." + k, v])) }, [["ar.professional", /vented is preferred/], ["ar.intermediate", /suspect a tension pneumothorax/], ["ch.professional", /cold can stop blood clotting properly/], ["ch.professional", /coagulopathy|traumatic brain injury/, true], ["ch.beginner", /weak, rapid pulse/, true]]);
pin("c-firstaid l-9line-medevac", { ...lt(lesson("c-firstaid", "l-9line-medevac")), src: lesson("c-firstaid", "l-9line-medevac").source.map((s) => s.pub).join("|") }, [["professional", /laid out in ATP 4-02\.2, Table C-1/], ["professional", /Lines 1 through 5 are transmitted within 25 seconds of initial contact/], ["intermediate", /within 25 seconds of first contact/], ["check.a", /Lines 1 through 5, within 25 seconds/], ["src", /^ATP 4-02\.11\|ATP 4-02\.2$/]]);
pin("c-warfight l-firstaid", lt(lesson("c-warfight", "l-firstaid")), [["professional", /a hasty tourniquet "high and tight" in Care Under Fire, a deliberate one 2 to 3 inches above the wound in Tactical Field Care/], ["check.a", /most frequent cause of preventable battlefield death/], ["check.a", /kills fastest/, true]]);

/* doc-tccc and the other relabelled doctrine entries */
const dOf = (id) => bank.doctrine.entries.find((e) => e.id === id);
const dt = dOf("doc-tccc");
const dtText = [dt.body, dt.boardAnswer, ...dt.keyPoints].join("\n");
pin("doc-tccc", { ...dt, all: dtText }, [
  ["body", /3\. Tactical Evacuation Care: Care during the move from the battlefield to a medical treatment facility/], ["body", /asks that the word "TACEVAC" not be used as the name of this phase, para 3-57/],
  ["body", /bleed to death in as little as three minutes.{1,80}stop the bleeding in about a minute/], ["body", /packed with a hemostatic dressing in TFC, not in CUF/],
  ["body", /early signs are increasing difficulty breathing, shortness of breath, confusion or agitation, bluish lips and a rapid pulse; swollen neck veins and tracheal deviation are late signs/],
  ["body", /second intercostal space in the mid-clavicular line \(outside the nipple line\) or at the fifth intercostal space on the anterior axillary line — never through a chest seal\. If the first needle does not help, try the other site/],
  ["body", /Combat Wound Medication Pack \(CWMP\) for mild to moderate pain/], ["body", /a vented chest seal is preferred/i],
  ["keyPoints[3]", /records what was done in Care Under Fire and Tactical Field Care/],
  ["all", /SOFTT|Hextend|Blizzard|Cushing|Hyfin|QuikClot|HemCon|within 2 minutes|absent breath sounds|hypotension|cricothyrotomy|Start IVs|Tactical Evacuation Care \(TACEVAC\)|completed during TACEVAC/i, true],
]);
const am3 = dOf("doc-armymed-3"), mf4 = dOf("doc-medfa-4"), mf3 = dOf("doc-medfa-3");
pin("doc-armymed-3, doc-medfa-3 and doc-medfa-4", { am: am3.body + " | " + am3.keyPoints.join(" | "), amBody: am3.body, amKey: am3.keyPoints.join(" | "), mf3: mf3.body, mf4: mf4.body + " | " + mf4.keyPoints.join(" | ") }, [["amBody", /CLS skills must be recertified every 12 months/], ["amKey", /skills are recertified every 12 months/], ["amBody", /24 months/, true], ["amKey", /24 months/, true], ["am", /IV access|golden hour|typically maintain/i, true], ["mf3", /basic combat lifesaver skills/, true], ["mf4", /chilblains, trench foot/], ["mf4", /frostnip/i, true]]);

/* across every record that cites ATP 4-02.11: no term the second review found unsupported, and 'TACEVAC' only where the text says the manual asks us not to use it */
const atpRecords = [];
for (const section of Object.keys(bank)) {
  const walk = (v, owner) => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, owner)); return; }
    if (v && typeof v === "object") { const own = !owner && typeof v.id === "string" ? v : owner; for (const k of Object.keys(v)) walk(v[k], own); return; }
    if (typeof v === "string" && owner) atpRecords.push([section + ":" + owner.id, v]);
  };
  walk(bank[section], null);
}
const citing = new Set(atpRecords.filter(([, v]) => /ATP 4-02\.11/.test(v)).map(([k]) => k));
const bannedHits = atpRecords.filter(([k, v]) => citing.has(k) && new RegExp(NOT_IN_BUNDLE.join("|"), "i").test(v)).map(([k, v]) => k + ": " + (v.match(new RegExp(NOT_IN_BUNDLE.join("|"), "i")) || [""])[0]);
check(citing.size >= 30 && bannedHits.length === 0, `none of the ${citing.size} records that cite ATP 4-02.11 teaches a term the bundled text does not contain (${NOT_IN_BUNDLE.slice(0, 6).join(", ")} ...)`, () => bannedHits.slice(0, 8).join("\n"));
const tacevacHits = atpRecords.filter(([, v]) => /TACEVAC/.test(v)).filter(([, v]) => !/(?:asks? that|not be used)/.test(v)).map(([k, v]) => k + ": " + v.slice(Math.max(0, v.search(/TACEVAC/) - 40), v.search(/TACEVAC/) + 40));
check(tacevacHits.length === 0, "'TACEVAC' is used nowhere in the bank except in a sentence that says ATP 4-02.11 (para 3-57) asks us not to use it as the phase name", () => tacevacHits.join("\n"));
// Dictionary and glossary rows have no id, so the walk above never saw them (the 68W glossary row for TACEVAC could be put back to "the official
// name of the phase" and nothing failed). Walk every string in the bank, and for a row (an object) read the whole row: the key and the definition.
const tacevacLoose = [];
(function walkAll(v, parent, trail) {
  if (Array.isArray(v)) { v.forEach((x, i) => walkAll(x, v, trail + "[" + i + "]")); return; }
  if (v && typeof v === "object") { for (const k of Object.keys(v)) walkAll(v[k], v, trail + "." + k); return; }
  if (typeof v === "string" && /TACEVAC/.test(v)) {
    const context = parent && !Array.isArray(parent) ? Object.values(parent).filter((x) => typeof x === "string").join(" | ") : v;
    if (!/(?:asks? that|not be used)/.test(context)) tacevacLoose.push(trail + ": " + v.slice(0, 90));
  }
})(bank, null, "bank");
const tacevacTerm = bank.acronyms.terms.find((t) => t.a === "TACEVAC");
check(tacevacLoose.length === 0 && tacevacTerm && /asks that "TACEVAC" not be used as the name of that phase/.test(tacevacTerm.d) && !/official name/i.test(tacevacTerm.d),
  "'TACEVAC' is also used nowhere in a dictionary or glossary row except in the 68W glossary row that says ATP 4-02.11 (para 3-57) asks us not to use it as the phase name", () => tacevacLoose.concat([J(tacevacTerm)]).join("\n    "));
const htmlNoSeed = readFileSync(path.join(APP, "src", "index.html"), "utf8").replace(readSeed(path.join(APP, "src", "index.html")).raw, "");
check(!/TACEVAC/.test(htmlNoSeed), "...nor in the app's own code (the First Aid route hint no longer names the phase 'TACEVAC')", () => htmlNoSeed.match(/.{0,60}TACEVAC.{0,40}/)[0]);

check(!/FLAG FOR REVIEWER/.test(JSON.stringify(bank)), "no 'FLAG FOR REVIEWER' note is left anywhere in the bank (tc4021-8 carried one as its first key point, where a Soldier reads it)");
const ace = byId.get("tc4021-8");
check(ace && /Acknowledge, Care, and Escort/.test(ace.keyPoints[0]) && /para 20-38/.test(ace.keyPoints[0]), "tc4021-8's first key point now states the mnemonic, with its paragraph", () => J(ace && ace.keyPoints[0]));
const sixtyEight = byId.get("68w-scope-02");
check(sixtyEight && sixtyEight.source.map((e) => e.pub).join("|") === "ATP 4-02.11|ATP 4-02.84 (Combat Lifesaver Program)", "68w-scope-02 (68W pack) no longer lists TC 4-02.1, and keeps ATP 4-02.84 (an SME call, not this change)", () => J(sixtyEight && sixtyEight.source));
const docById = new Map(bank.doctrine.entries.map((d) => [d.id, d]));
check(["doc-armymed-3", "doc-medfa-3", "doc-medfa-4"].every((id) => { const e = docById.get(id).source.find((s) => s.pub === "ATP 4-02.11"); return e && e.edition === "2026-03" && !docById.get(id).source.some((s) => s.pub === "TC 4-02.1"); }), "doc-armymed-3, doc-medfa-3 and doc-medfa-4 cite ATP 4-02.11 (edition 2026-03), not 'TC 4-02.1, 2020'", () => J(["doc-armymed-3", "doc-medfa-3", "doc-medfa-4"].map((id) => docById.get(id).source)));
check(docById.get("doc-armymed-3").source.some((s) => s.pub === "ATP 4-02.84"), "...doc-armymed-3 keeps its second source, ATP 4-02.84 (untouched - needs an SME check)");
check(/which superseded TC 4-02\.1 in March 2026/.test(docById.get("doc-tccc").boardAnswer), "doc-tccc's own sentence 'which superseded TC 4-02.1 in March 2026' is still there (the change is marked, so the gate leaves it)");
const scen = bank.scenarios.scenarios.find((s) => s.id === "sc-68w-scope-of-practice");
check(scen && scen.doctrine.every((d) => d.pub !== "TC 4-02.1") && scen.doctrine.some((d) => d.pub === "ATP 4-02.11" && d.edition === "2026-03" && /paras 1-11, 3-14 to 3-18/.test(d.para)), "sc-68w-scope-of-practice cites ATP 4-02.11 (2026-03) for the Combat Lifesaver paragraphs it can name", () => J(scen && scen.doctrine));
const course = bank.curriculum.courses.find((c) => c.id === "c-firstaid");
const lessonsOld = course.lessons.filter((l) => (l.source || []).some((s) => s.pub === "TC 4-02.1") || /TC 4-02\.1\b/.test(JSON.stringify(l)));
check(course.source.every((s) => s.pub === "ATP 4-02.11") && course.lessons.length > 0 && lessonsOld.length === 0 && course.lessons.every((l) => l.source.some((s) => s.pub === "ATP 4-02.11")), "the First Aid course (its own source and every lesson) cites ATP 4-02.11 - the audit had missed the curriculum", () => J(lessonsOld.map((l) => l.id)));
const wf = bank.curriculum.courses.find((c) => c.id === "c-warfight").lessons.find((l) => l.id === "l-firstaid");
check(wf.source.every((s) => s.pub === "ATP 4-02.11"), "...and so does the War-fighting course's First Aid lesson", () => J(wf.source));
const adp9 = byId.get("adp-9");
check(adp9 && adp9.source.some((e) => e.pub === "FM 6-22"), "honest path unchanged: adp-9 (the card ABOUT FM 6-22, the current leader-development manual) still cites FM 6-22 and the real lint still passes", () => J(adp9 && adp9.source));

/* =====================================================================
   4. The gate against planted banks
   ===================================================================== */
console.log("\n4. the gate - planted banks");
const scratch = mkdtempSync(path.join(tmpdir(), "guidon-pub-supersession-"));
try {
  const SEED = path.join(scratch, "index.html");
  copyFileSync(path.join(APP, "src", "index.html"), SEED);
  const base = readSeed(SEED).data;
  const src = (pub, kind = "verbatim") => [{ pub, edition: "", para: "", quoteKind: kind }];
  const card = (id, source, text = "Answer.") => ({ id, category: "Army Values", q: "Question " + id + "?", a: text, boardAnswer: text, keyPoints: [text], difficulty: "basic", source });
  const docEntry = (id, source) => ({ id, title: "T " + id, topic: "Medical / First Aid", tier: ["E4"], body: "Body.", boardAnswer: "Body.", confidence: "verified", keyPoints: ["Body."], source });
  const scenario = (id, doctrine) => ({ id, title: "S " + id, tier: ["E4"], competency: ["Leads"], difficulty: "Basic", doctrine, defaultMode: "course", renderModes: ["course"], start: "n1", nodes: { n1: { prompt: "p", end: true, outcome: "o" } } });
  const course2 = (id, lessonSource) => ({ id, title: "C " + id, source: src("ATP 4-02.11", "paraphrase"), tier: ["E4"], lessons: [{ id: id + "-l1", title: "L", source: lessonSource, tiers: { layman: "x", beginner: "x", intermediate: "x", professional: "x" } }] });
  const plant = ({ board = [], doctrine = [], scenarios = [], courses = [] }, extraArgs = []) => {
    copyFileSync(path.join(APP, "src", "index.html"), SEED);
    const d = readSeed(SEED).data;
    d.board.questions.push(...board); d.doctrine.entries.push(...doctrine); d.scenarios.scenarios.push(...scenarios); d.curriculum.courses.push(...courses);
    writeSeed(d, SEED);
    return run(["--seed", SEED, ...extraArgs]);
  };
  const failsOn = (name, r, ...needles) => check(r.status === 1 && needles.every((n) => (typeof n === "string" ? r.out.includes(n) : n.test(r.out))), `the lint FAILS on ${name}, naming it`, () => `exit ${r.status}\n${r.out.slice(-1800)}`);
  const passes = (name, r) => check(r.status === 0 && /all passed/.test(r.out), `honest control passes: ${name}`, () => `exit ${r.status}\n${r.out.slice(-1800)}`);

  passes("a planted bank with no offending record (the lint is not simply always failing)", plant({ board: [card("plant-ok", src("ATP 4-02.11"), "Per ATP 4-02.11, para 1-1: stop the bleeding.")] }));
  failsOn("a board card that teaches TC 4-02.1 as a verbatim source", plant({ board: [card("plant-tc", src("TC 4-02.1"), "Per TC 4-02.1, para 1-1: stop the bleeding.")] }), "board:plant-tc", "TC 4-02.1", "reads as a verbatim quotation", "ATP 4-02.11");
  failsOn("a card that teaches TC 4-02.1 in a sentence that also says \"prior to\"", plant({ board: [card("plant-prior", src("ATP 4-02.11"), "Per TC 4-02.1: apply the tourniquet prior to moving the casualty.")] }), "board:plant-prior", "TC 4-02.1");
  failsOn("a card that teaches TC 4-02.1 in a sentence that also says \"replace the dressing\"", plant({ board: [card("plant-replace", src("ATP 4-02.11"), "Per TC 4-02.1, replace the saturated dressing.")] }), "board:plant-replace", "TC 4-02.1");
  failsOn("a card whose structured source is relabeled but whose prose cite is not", plant({ board: [card("plant-prose", src("ATP 4-02.11"), "Stop the bleeding. (TC 4-02.1, para 1-1.)")] }), "board:plant-prose", "(TC 4-02.1, para 1-1.)");
  passes("a card that SAYS the manual was superseded (the change is marked)", plant({ board: [card("plant-marked", src("ATP 4-02.11"), "Stop the bleeding. ATP 4-02.11 superseded TC 4-02.1 in March 2026.")] }));
  failsOn("a paraphrase card that still cites TC 4-02.1 (the gate does not wait for the word verbatim)", plant({ board: [card("plant-para", src("TC 4-02.1", "paraphrase"))] }), "board:plant-para");
  failsOn("a doctrine entry whose source is TC 4-02.1", plant({ doctrine: [docEntry("plant-doc", src("TC 4-02.1", "paraphrase"))] }), "doctrine:plant-doc");
  failsOn("a scenario whose doctrine reference is TC 4-02.1", plant({ scenarios: [scenario("plant-sc", [{ pub: "TC 4-02.1", edition: "2020", para: "x", quoteKind: "paraphrase" }])] }), "scenarios:plant-sc");
  failsOn("a course lesson whose source is TC 4-02.1 (a section the first audit missed)", plant({ courses: [course2("plant-course", src("TC 4-02.1", "paraphrase"))] }), "curriculum:plant-course-l1");
  failsOn("FM 3-22.9, the other proven row, taught as a source", plant({ board: [card("plant-fm", src("FM 3-22.9"))] }), "board:plant-fm", "FM 3-22.9", "TC 3-22.9");
  passes("a card that cites ATP 4-02.1 (Army Medical Logistics) - a different manual", plant({ board: [card("plant-medlog", src("ATP 4-02.1 (Oct 2015), Army Medical Logistics"), "Class VIII is managed per ATP 4-02.1.")] }));
  passes("a card that cites FM 6-22 (not proven superseded; the bundled ADP 6-22 still cites it as current)", plant({ board: [card("plant-fm622", src("FM 6-22"), "Developing Leaders, FM 6-22, covers leader development.")] }));
  passes("a card that cites a longer number (TC 4-02.11) that is nothing to do with TC 4-02.1", plant({ board: [card("plant-longer", src("TC 4-02.11"), "Per TC 4-02.11, para 1-1.")] }));

  /* ---- the table is the single source: edit the table, the gate follows ---- */
  const moiStandIn = path.join(scratch, "moi-import.js");
  const libStandIn = path.join(scratch, "library.js");
  const offender = { board: [card("plant-tc2", src("TC 4-02.1"), "Per TC 4-02.1, para 1-1.")] };

  writeFileSync(moiStandIn, moiSrc.replace(/\n\s*"TC 4-02\.1": "ATP 4-02\.11",[^\n]*/, ""), "utf8");
  check(!/"TC 4-02\.1": "ATP 4-02\.11"/.test(readFileSync(moiStandIn, "utf8")), "fixture sanity: the stand-in moi-import.js has the TC 4-02.1 row removed");
  passes("with the TC 4-02.1 row removed from the table, a TC 4-02.1 card is no longer gated (the table IS the switch)", plant(offender, ["--moi", moiStandIn]));

  writeFileSync(moiStandIn, moiSrc.replace(/(\n\s*"TC 4-02\.1": "ATP 4-02\.11",[^\n]*)/, '$1\n    "TC 9-99": "ATP 9-99",   // a row nobody has proved'), "utf8");
  const bogus = plant({ board: [card("plant-bogus", src("TC 9-99"), "Per TC 9-99.")] }, ["--moi", moiStandIn]);
  check(bogus.status === 0 && /NOTE  TC 9-99 -> ATP 9-99 is NOT enforced: ATP 9-99 is not in the bundled Library/.test(bogus.out), "a new table row for a publication the Library does not hold is reported as not enforced and fails nothing (no gate without proof)", () => bogus.out);

  writeFileSync(moiStandIn, moiSrc.replace("const MOI_CITATION_ALIASES = {", "const SOMETHING_ELSE = {"), "utf8");
  const renamed = run(["--moi", moiStandIn]);
  check(renamed.status === 1 && /could not set the gate up: could not find `const MOI_CITATION_ALIASES/.test(renamed.out), "a renamed table constant FAILS the lint loudly instead of silently enforcing nothing", () => renamed.out);

  /* ---- the proof is mechanical: take the sentence off ATP 4-02.11's cover and the row stops being enforced ---- */
  const libDocs = readLibraryDocs(libSrc);
  const atp = libDocs.find((d) => d.citation === "ATP 4-02.11");
  atp.pages = atp.pages.map((p) => p.replace(/This publication supersedes TC 4-02\.1, dated 21 January 2016\./g, "").replace(/supersedes TC 4-02\.1/g, "mentions an older manual"));
  writeFileSync(libStandIn, libSrc.replace(/const DOCS = JSON\.parse\(("(?:[^"\\]|\\.)*")\);/, () => "const DOCS = JSON.parse(" + JSON.stringify(JSON.stringify(libDocs)) + ");"), "utf8");
  check(!coverEvidence(readLibraryDocs(readFileSync(libStandIn, "utf8")), "TC 4-02.1", "ATP 4-02.11").proven, "fixture sanity: with the sentence taken off its cover, the Library no longer proves TC 4-02.1 -> ATP 4-02.11");
  const noProof = plant(offender, ["--library", libStandIn]);
  check(noProof.status === 0 && /NOTE  TC 4-02\.1 -> ATP 4-02\.11 is NOT enforced: ATP 4-02\.11's cover/.test(noProof.out), "...and a TC 4-02.1 card then passes, with the NOTE naming why the row is not enforced (the evidence is read from the Library, not assumed)", () => noProof.out);
  const withProof = plant(offender);
  check(withProof.status === 1, "control: the same planted card against the real Library fails (the proof is what turned the gate on)", () => withProof.out);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nPUB SUPERSESSION: all passed" : `\nPUB SUPERSESSION: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
