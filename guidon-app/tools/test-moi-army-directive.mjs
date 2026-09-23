/**
 * MOI Import: "AD"/"Army Directive" citation recognition (moi-import.js).
 *
 * Found via a real unit promotion-board MOI: it cited an Army Directive
 * two different ways in the same document - abbreviated ("AR 600-9/AD
 * 2026-13") and spelled out ("AFT IOC Army Directive 05-2025 June 2025") -
 * and PUB_TYPES recognized neither. Confirmed by direct simulation before
 * the fix: "AR 600-9/AD 2026-13" tokenized to only ["AR 600-9"], and the
 * Army Fitness Test reference tokenized to nothing at all. Both are real
 * blind spots this suite locks in as fixed, not hypothetical ones.
 *
 * Also confirmed independently: the app's OWN board-question source
 * strings already cite these exact directives under the spelled-out form
 * ("AR 600-9; Army Directive 2026-13") - PUB_TYPES not recognizing that
 * form meant buildCitationRegistry() never saw them either, so even a
 * Soldier who typed "Army Directive 2026-13" by hand got "not found"
 * against content the app already has. The fix (adding "AD" and "ARMY
 * DIRECTIVE" to PUB_TYPES, canonicalizing "AD" -> "ARMY DIRECTIVE" in
 * normalizeCitation so both forms hit the same registry key) is what this
 * suite is really checking - not just "the parser finds more text," but
 * that a real Soldier's import now surfaces real, already-shipped content
 * it silently missed before.
 *
 * The MOI text below is a redacted excerpt of that real document: every
 * citation, date, time, eligibility figure, and packet requirement is
 * verbatim; the unit designation, installation, board members' names, POC
 * email, and signature block are replaced with clearly fictional
 * placeholders. This is the "real MOI as an example, without personal
 * information" fixture the app's own background systems can be tuned
 * against going forward.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { until } from "./testkit.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await until(page, () => !!(window.G && window.G.moiImport));
await dismissOnboarding(page);

// ============================================================
// PART 1 — direct tokenizeCitations()/normalizeCitation()/matchCitation()
// checks against the two real strings that motivated this fix
// ============================================================
{
  const r = await page.evaluate(() => {
    const M = window.G.moiImport;
    return {
      compound: M.tokenizeCitations("Army Body Composition Program (AR 600-9/AD 2026-13)"),
      spelledOut: M.tokenizeCitations("Army Fitness Test (AFT IOC Army Directive 05-2025 June 2025)"),
      normAbbrev: M.normalizeCitation("AD 2026-13"),
      normSpelled: M.normalizeCitation("Army Directive 2026-13"),
      matchAbbrev: M.matchCitation("AD 2026-13"),
      matchSpelled: M.matchCitation("Army Directive 2026-13"),
      matchDifferentDirective: M.matchCitation("Army Directive 05-2025"),
    };
  });

  const compoundOk = r.compound.length === 2 && r.compound[0] === "AR 600-9" && r.compound.some((c) => /^AD\s+2026-13$/i.test(c));
  compoundOk
    ? ok("\"AR 600-9/AD 2026-13\" tokenizes to BOTH citations, not just AR 600-9 (was the real blind spot before this fix)")
    : bad("compound tokenize result: " + JSON.stringify(r.compound));

  r.spelledOut.length === 1 && /Army Directive\s+05-2025/i.test(r.spelledOut[0])
    ? ok("\"...Army Directive 05-2025...\" (spelled out, no abbreviation) is now detected at all (was zero matches before)")
    : bad("spelled-out tokenize result: " + JSON.stringify(r.spelledOut));

  r.normAbbrev && r.normSpelled && r.normAbbrev.pubType === "ARMY DIRECTIVE" && r.normSpelled.pubType === "ARMY DIRECTIVE" && r.normAbbrev.number === r.normSpelled.number
    ? ok("\"AD 2026-13\" and \"Army Directive 2026-13\" normalize to the identical {pubType,number} tuple")
    : bad("normalize results: " + JSON.stringify({ normAbbrev: r.normAbbrev, normSpelled: r.normSpelled }));

  r.matchAbbrev && r.matchAbbrev.tier !== "unmatched" && r.matchSpelled && r.matchSpelled.tier !== "unmatched" && r.matchAbbrev.tier === r.matchSpelled.tier
    ? ok("both forms resolve against the REAL registry (tier: " + r.matchAbbrev.tier + ") - content the app already ships was previously invisible to this exact citation")
    : bad("match results: " + JSON.stringify({ matchAbbrev: r.matchAbbrev, matchSpelled: r.matchSpelled }));

  // A genuinely different, not-yet-cited-anywhere directive must still
  // honestly report unmatched, not get force-matched to "2026-13" just
  // because both start with "Army Directive" - the whole system's
  // never-guess discipline applies here too.
  r.matchDifferentDirective && r.matchDifferentDirective.tier === "unmatched"
    ? ok("a different, not-yet-cited Army Directive number (05-2025) is honestly reported as unmatched, not force-matched to an unrelated one")
    : bad("matchDifferentDirective: " + JSON.stringify(r.matchDifferentDirective));
}

// ============================================================
// PART 2 — no regression: "ADP 6-22" must never mis-split into "AD"+"P..."
// now that "AD" is a recognized prefix
// ============================================================
{
  const r = await page.evaluate(() => {
    const M = window.G.moiImport;
    return {
      leadership: M.tokenizeCitations("Army Leadership (ADP 6-22), The Operations Process (ADP 5-0)"),
      commandControl: M.tokenizeCitations("Command and Control (ADP 6-0), Army Command Policy (AR 600-20)"),
    };
  });
  const leadershipOk = r.leadership.length === 2 && r.leadership.every((c) => /^ADP\s/i.test(c));
  leadershipOk
    ? ok("\"ADP 6-22\"/\"ADP 5-0\" still tokenize whole, never mis-split into a bare \"AD\" + leftover text, now that AD is also recognized")
    : bad("ADP regression check: " + JSON.stringify(r.leadership));
  const ccOk = r.commandControl.length === 2 && /^ADP\s+6-0$/i.test(r.commandControl[0]) && /^AR\s+600-20$/i.test(r.commandControl[1]);
  ccOk
    ? ok("\"ADP 6-0\"/\"AR 600-20\" tokenize correctly side by side with the new AD prefix in play")
    : bad("ADP/AR regression check: " + JSON.stringify(r.commandControl));
}

// ============================================================
// PART 3 — full-document pass: a redacted excerpt of the real MOI that
// motivated this fix, run through the actual #/moi Find flow end to end.
// Every citation/date/time/figure below is verbatim from the source
// document; the unit, installation, board members and POC are fictional.
// ============================================================
const REDACTED_MOI_TEXT = [
  "DEPARTMENT OF THE ARMY",
  "HEADQUARTERS",
  "TASK FORCE EXAMPLE",
  "JOINT TASK FORCE-EXAMPLE",
  "FORT EXAMPLE, TEXAS 00000",
  "",
  "AFZX-EX-CSM                                              10 September 2026",
  "",
  "MEMORANDUM FOR INSTRUCTION",
  "",
  "SUBJECT: TF EXAMPLE SEPTEMBER, SGT AND SSG PROMOTION BOARD MOI",
  "",
  "1. The 1st Example Battalion, Enlisted Promotion Board will convene at 0500 on",
  "Example Field and will continue at 0800 on the following dates below in the Classroom",
  "of Building 1000, 1st Example Battalion, Fort Example, Texas 00000, in accordance",
  "with AR 600-8-19, Chapter 3, to review, record, and interview personnel for promotion",
  "to SGT and SSG.",
  "",
  "2. At 0445 a diagnostic AFT will be conducted on Example Field. This event is pass or",
  "fail. If the soldier fails the diagnostic AFT, they will not appear before the board at 0800",
  "and will be considered a board failure. The uniform will be APFUs for the AFT.",
  "",
  "3. Immediately following the AFT, a diagnostic HT/WT will be conducted. A Soldier",
  "that fails to meet the Army Body Composition Standards outlined in AR 600-9 will",
  "not appear before the board at 0800 and will be considered a board failure.",
  "",
  "4. If the Soldier is on a medical profile, they will be exempt from the diagnostic",
  "AFT but will still report to the AFT testing area at 0500 in the prescribed PT uniform",
  "to conduct HT/WT.",
  "",
  "23 September (FWD)",
  "President: CSM Example",
  "Board Member 1: 1SG Example-One",
  "Board Member 2: 1SG Example-Two",
  "Board Member 3: SFC Example-Three",
  "Board Member 4: 1SG Example-Four",
  "",
  "5. Date and time for the promotion boards are subject to change due to mission",
  "requirements.",
  "",
  "6. Board members will report NLT 0750 for the Board President's Briefing. Board",
  "Members will provide a copy of their questions to each panel member. A minimum of",
  "one question from each subject area will be asked of the candidates. Specialists and",
  "Sergeants will be asked different questions. Board Member's uniform will be the",
  "Operational Camouflage Pattern uniform (OCP), unless directed by the President of the",
  "Board.",
  "",
  "7. The personnel listed below constitute the board and are assigned subject areas as",
  "follows:",
  "",
  "CSM Example, 1st Example Battalion, Board President, W/Out Vote:",
  "Introduction, Soldier Biography, NCO Creed, Unit History, Current Events",
  "",
  "Board Member 1, W/ Vote:",
  "Holistic Health and Fitness (FM 7-22), Appearance of the Army Uniform and",
  "Insignia (AR 670-1/DA PAM 670-1), Command and Control (ADP 6-0), Army",
  "Command Policy (AR 600-20), Sexual Harassment/Assault Response and Prevention",
  "Program (AR 600-52), Drill and Ceremonies (TC 3-21.5)",
  "",
  "Board Member 2, W/ Vote:",
  "Army Leadership (ADP 6-22), The Operations Process (ADP 5-0),",
  "Defense Support of Civil Authorities (ADP 3-28), Map Reading & Land",
  "Navigation (TC 3-25.26), NCO Evaluation Reporting System (AR",
  "623-3/DA PAM 623-3), Rifle and Carbine (TC 3-22.9)",
  "",
  "Board Member 3, W/ Vote:",
  "The Army Maintenance Management System (DA PAM 750-8), The Counseling",
  "Process (ATP 6-22.1), Army Body Composition Program (AR 600-9/AD 2026-13),",
  "CBRN (FM 3-11). Army Training and Leader Development (AR 350-1)",
  "",
  "Board Member 4, W/ Vote:",
  "First Aid (ATP 4-02.11), The Noncommissioned Officer Guide (TC 7-22.7), The",
  "Army (ADP 1), Training (ADP 7-0), Operations (ADP 3-0) Program, Army",
  "Fitness Test (AFT IOC Army Directive 05-2025 June 2025).",
  "",
  "8. Per AR 600-8-19 21 June 2024, situational questions pertaining to sexual",
  "harassment, suicide prevention, misuse of drugs and alcohol, physical and mental",
  "fitness, failure to attend a noncommissioned officer professional development study and",
  "a subordinate's decision to reenlist will be asked by any board member during the",
  "promotion board.",
  "",
  "9. Candidates and their supervisors will report NLT 0750 to the board. The uniform for",
  "the candidates is the Army Combat Uniform Operation Camouflage Pattern (ACU-OCP)",
  "IOTV (with pouches IAW BDE SOP or TAPS), ACH (IAW BDE SOP), Eye Pro, Ear Pro",
  "(on hand), Gloves, Water Source, and Camouflage Face Paint.",
  "",
  "12. Eligibility requirements for the SGT/SSG Promotion Board are:",
  "a. Specialists with 34 months Time in Service and 10 months Time in Grade are",
  "eligible for Primary Zone appearance. Specialists with 16 months Time in Service and 4",
  "months Time in Grade are eligible for Secondary Zone appearance.",
  "b. Sergeants with 70 months Time in Service and 16 months Time in Grade are",
  "eligible for Primary Zone appearance. Sergeants with 46 months Time in Service and 6",
  "months Time in Grade are eligible for Secondary Zone appearance.",
  "c. Candidates must meet the height and weight standards as outlined in AR 600-9,",
  "dated 4 September 2025.",
  "",
  "14. Required information for the board packet consists of:",
  "a. A biography of the Soldier/NCO",
  "b. A copy of the Soldiers STP",
  "c. Letter of Recommendation from his Squad Leader, Platoon Sergeant, or First",
  "Sergeant. NCOs will provide a copy of their last NCOER.",
  "e. DA Form 3355 (PPW)",
  "f. A copy of most recent AFT card and completed 5500 or 5501 (if applicable)",
  "g. A copy of most current weapons qualification score sheet signed by the soldiers",
  "company commander.",
  "",
  "6. Point of Contact for this memorandum is 1st Example Battalion S1 by email at",
  "example.s1@example.mil.",
  "",
  "J. EXAMPLE",
  "CSM, USA",
  "Command Sergeant Major",
].join("\n");

await page.evaluate(async () => {
  await window.G.db.put("kv", { k: window.G.moiImport.KEY, v: null });
  await window.G.db.put("kv", { k: window.G.moiImport.PLANS_KEY, v: [] });
});
await page.evaluate(() => { location.hash = "#/moi"; });
const landingReady = await until(page, () => /MOI Import/.test(document.body.textContent || ""));
landingReady ? ok("#/moi lands cleanly before the full-document pass") : bad("#/moi never rendered its landing heading");

const importClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Import an MOI/.test(b.textContent || ""));
  if (btn) { btn.click(); return true; }
  return false;
});
importClicked ? ok("'Import an MOI' opens the Capture screen") : bad("'Import an MOI' button not found");

const textareaReady = await until(page, () => !!document.querySelector("textarea"));
textareaReady || bad("Capture textarea never appeared");

await page.evaluate((text) => {
  const ta = document.querySelector("textarea");
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, REDACTED_MOI_TEXT);

const findClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Find my topics/.test(b.textContent || ""));
  if (btn) { btn.click(); return true; }
  return false;
});
findClicked ? ok("'Find my topics' found and clicked on the real (redacted) MOI text") : bad("'Find my topics' button not found");

const reviewShown = await until(page, () => /Review your matches/.test(document.body.textContent || ""), null, { timeout: 8000 });
reviewShown
  ? ok("the real (redacted) MOI runs through the actual #/moi Find flow end to end, no crash, reaches Review")
  : bad("the Review screen never appeared for the real MOI text");

const matchedText = await page.evaluate(() => {
  const segBtns = [...document.querySelectorAll(".segmented button")];
  const matchedBtn = segBtns.find((b) => /^Matched/.test(b.textContent || ""));
  if (matchedBtn) matchedBtn.click();
  return [...document.querySelectorAll(".panel")].map((p) => p.textContent).join(" | ");
});
/Army Directive/i.test(matchedText)
  ? ok("the Army Directive citation from the real source document surfaces in the real Matched list, not just the pure-function checks above")
  : bad("Army Directive not present in the real Matched-list output: " + matchedText.slice(0, 400));

// The compound "AR 670-1/DA PAM 670-1" and "AR 623-3/DA PAM 623-3" refs
// from the real document - both real-world citation shapes this fix's own
// header comment discusses (two DIFFERENT pub-type prefixes joined by one
// slash, distinct from the same-prefix "TC 3-21.5/3-21.8" shape
// surfaceCandidateAndSlash() already handled before this change).
/AR 670-1/i.test(matchedText) && /DA PAM 670-1/i.test(matchedText)
  ? ok("the real document's \"AR 670-1/DA PAM 670-1\" compound reference surfaces both halves in Matched")
  : bad("AR 670-1 / DA PAM 670-1 compound not both present: " + matchedText.slice(0, 400));

noise.length === 0 ? ok("no console errors/warnings anywhere in this suite") : noise.forEach((n) => bad(n));

await browser.close();
await server.close();

console.log("");
if (fails) { console.log("MOI ARMY DIRECTIVE: " + fails + " FAILURE(S)"); process.exit(1); }
console.log("MOI ARMY DIRECTIVE: all passed");
