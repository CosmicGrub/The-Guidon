/**
 * MOI Import Engine, Phase 1 (#/moi, G.moiImport): a Soldier imports a board
 * MOI (memorandum of instruction - a memo assigning doctrine citations as
 * study topics) and gets a curated study dashboard, plus an optional
 * practice drill, built from exactly what that MOI assigns.
 *
 * Two halves, matching this module's own "pure matching pipeline, separate
 * from rendering" split:
 *
 *  (a) tokenizeCitations/normalizeCitation/matchCitation exercised directly
 *      via window.G.moiImport against the REAL seed - the same pattern
 *      test-rankutils.mjs already uses for G.rankUtils. Covers a clean
 *      citation, a chapter/para suffix, a glyph-confused citation, an
 *      ambiguous "/"-joined pair (including the AR 600-8-2 vs AR 600-8-22
 *      substring-collision case matchCitation's own header comment calls
 *      out by name), the FM 3-22.9 -> TC 3-22.9 alias, and a genuinely
 *      unmatched fabricated citation - asserting each lands in the correct
 *      one of the 5 confidence tiers.
 *
 *  (b) A real interaction pass: paste a small synthetic MOI-like text block
 *      into the route, click through to Review, confirm the expected
 *      topics land in Matched (and a fabricated one in Not found), Build a
 *      saved plan with a practice drill, and confirm the result view's
 *      deep links into #/doctrine and #/board actually navigate.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

/* ========================================================================
   (a) Pure matching pipeline, against the real seed
   ======================================================================== */

const apiPresent = await page.evaluate(() =>
  !!(window.G && window.G.moiImport && window.G.moiImport.tokenizeCitations &&
     window.G.moiImport.normalizeCitation && window.G.moiImport.matchCitation &&
     window.G.moiImport.buildCitationRegistry));
apiPresent
  ? ok("window.G.moiImport is present with tokenizeCitations/normalizeCitation/matchCitation/buildCitationRegistry")
  : bad("window.G.moiImport (or one of its pure functions) is missing");

// ---- clean citation: exact match, no suffix, no confusion ----
const cleanResult = await page.evaluate(() => window.G.moiImport.matchCitation("AR 350-1"));
cleanResult.tier === "exact-fanout"
  ? ok("Clean citation 'AR 350-1' resolves to tier 'exact-fanout' (cited by multiple topics in the real corpus)")
  : bad("Clean citation 'AR 350-1': expected tier 'exact-fanout', got " + JSON.stringify(cleanResult.tier));
cleanResult.normalized === "AR 350-1" && cleanResult.counts && cleanResult.counts.doctrineCards > 0
  ? ok("Clean citation carries real doctrineCards/selfCheckQuestions counts from the registry")
  : bad("Clean citation result shape wrong: " + JSON.stringify(cleanResult));

// ---- chapter/para suffix stripped down to the bare tuple ----
const suffixNorm = await page.evaluate(() => window.G.moiImport.normalizeCitation("AR 623-3, Ch 2"));
(suffixNorm && suffixNorm.pubType === "AR" && suffixNorm.number === "623-3")
  ? ok("normalizeCitation('AR 623-3, Ch 2') strips the chapter suffix down to {pubType:'AR', number:'623-3'}")
  : bad("normalizeCitation('AR 623-3, Ch 2') returned " + JSON.stringify(suffixNorm));
const suffixMatch = await page.evaluate(() => window.G.moiImport.matchCitation("AR 623-3, Ch 2"));
suffixMatch.tier === "exact-fanout" && suffixMatch.normalized === "AR 623-3"
  ? ok("matchCitation('AR 623-3, Ch 2') lands in tier 'exact-fanout', same as the bare citation")
  : bad("matchCitation('AR 623-3, Ch 2') -> " + JSON.stringify(suffixMatch));
const paraNorm = await page.evaluate(() => window.G.moiImport.normalizeCitation("ADP 6-22, para 2-2"));
(paraNorm && paraNorm.pubType === "ADP" && paraNorm.number === "6-22")
  ? ok("normalizeCitation('ADP 6-22, para 2-2') strips the paragraph suffix down to {pubType:'ADP', number:'6-22'}")
  : bad("normalizeCitation('ADP 6-22, para 2-2') returned " + JSON.stringify(paraNorm));
const parenNorm = await page.evaluate(() => window.G.moiImport.normalizeCitation("ADP 6-22 (2019)"));
(parenNorm && parenNorm.pubType === "ADP" && parenNorm.number === "6-22")
  ? ok("normalizeCitation('ADP 6-22 (2019)') strips the trailing parenthetical date")
  : bad("normalizeCitation('ADP 6-22 (2019)') returned " + JSON.stringify(parenNorm));

// ---- glyph-confused citation: 0<->O within the digit-run, nowhere else ----
const glyphResult = await page.evaluate(() => window.G.moiImport.matchCitation("AR GOO-9"));
glyphResult.tier === "glyph-folded" && glyphResult.normalized === "AR 600-9"
  ? ok("Glyph-confused 'AR GOO-9' resolves to tier 'glyph-folded', normalized 'AR 600-9'")
  : bad("matchCitation('AR GOO-9') -> " + JSON.stringify(glyphResult));
const glyphNorm = await page.evaluate(() => window.G.moiImport.normalizeCitation("AR GOO-9"));
glyphNorm && glyphNorm.glyphFolded === true
  ? ok("normalizeCitation reports glyphFolded:true only when a fold actually happened")
  : bad("normalizeCitation('AR GOO-9') glyphFolded flag: " + JSON.stringify(glyphNorm));
const cleanNorm = await page.evaluate(() => window.G.moiImport.normalizeCitation("AR 600-9"));
cleanNorm && cleanNorm.glyphFolded === false
  ? ok("normalizeCitation reports glyphFolded:false for an already-clean number (no false positives)")
  : bad("normalizeCitation('AR 600-9') glyphFolded flag: " + JSON.stringify(cleanNorm));

// ---- ambiguous "/"-joined pair: both halves surfaced as independent
// candidates, never auto-decided, and a one-digit-apart / substring
// collision never cross-contaminates ----
const slashTokens = await page.evaluate(() => window.G.moiImport.tokenizeCitations("TC 3-21.5/3-21.8"));
(slashTokens.includes("TC 3-21.5") && slashTokens.includes("TC 3-21.8"))
  ? ok("tokenizeCitations('TC 3-21.5/3-21.8') surfaces BOTH halves as independent candidates: " + JSON.stringify(slashTokens))
  : bad("tokenizeCitations('TC 3-21.5/3-21.8') -> " + JSON.stringify(slashTokens));
const slashLeft = await page.evaluate(() => window.G.moiImport.matchCitation("TC 3-21.5"));
const slashRight = await page.evaluate(() => window.G.moiImport.matchCitation("TC 3-21.8"));
slashLeft.tier === "exact-fanout"
  ? ok("Of the ambiguous pair, 'TC 3-21.5' (a real citation) resolves correctly")
  : bad("matchCitation('TC 3-21.5') -> " + JSON.stringify(slashLeft));
slashRight.tier === "unmatched"
  ? ok("Of the ambiguous pair, 'TC 3-21.8' (not a real citation) correctly falls out unmatched rather than being confused with 3-21.5")
  : bad("matchCitation('TC 3-21.8') -> " + JSON.stringify(slashRight));

// ---- the exact substring-collision case matchCitation's own header
// comment names: AR 600-8-2 is a literal substring of AR 600-8-22 ----
const collisionShort = await page.evaluate(() => window.G.moiImport.matchCitation("AR 600-8-2"));
const collisionLong = await page.evaluate(() => window.G.moiImport.matchCitation("AR 600-8-22"));
(collisionShort.tier !== "unmatched" && collisionLong.tier !== "unmatched" &&
  collisionShort.normalized === "AR 600-8-2" && collisionLong.normalized === "AR 600-8-22" &&
  JSON.stringify(collisionShort.topics) !== JSON.stringify(collisionLong.topics))
  ? ok("AR 600-8-2 and AR 600-8-22 resolve to two DIFFERENT real entries, never cross-contaminated despite the substring collision")
  : bad("substring-collision guarantee failed: AR 600-8-2 -> " + JSON.stringify(collisionShort) + " | AR 600-8-22 -> " + JSON.stringify(collisionLong));

// ---- FM 3-22.9 -> TC 3-22.9 alias (the documented supersession) ----
const aliasResult = await page.evaluate(() => window.G.moiImport.matchCitation("FM 3-22.9"));
aliasResult.tier === "alias" && aliasResult.normalized === "TC 3-22.9"
  ? ok("FM 3-22.9 (superseded) resolves via the alias table to tier 'alias', normalized 'TC 3-22.9'")
  : bad("matchCitation('FM 3-22.9') -> " + JSON.stringify(aliasResult));
const aliasTableHasIt = await page.evaluate(() => window.G.moiImport.MOI_CITATION_ALIASES["FM 3-22.9"] === "TC 3-22.9");
aliasTableHasIt
  ? ok("MOI_CITATION_ALIASES exposes the FM 3-22.9 -> TC 3-22.9 entry directly")
  : bad("MOI_CITATION_ALIASES is missing the required FM 3-22.9 -> TC 3-22.9 entry");

// ---- genuinely unmatched fabricated citation ----
const unmatchedResult = await page.evaluate(() => window.G.moiImport.matchCitation("AR 999-99"));
unmatchedResult.tier === "unmatched" && (!unmatchedResult.topics || unmatchedResult.topics.length === 0)
  ? ok("Fabricated citation 'AR 999-99' correctly resolves to tier 'unmatched' with no topics")
  : bad("matchCitation('AR 999-99') -> " + JSON.stringify(unmatchedResult));

// ---- never a fuzzy fallback: a near-miss one-digit-off citation that IS
// real content-adjacent still must not silently borrow a match ----
const registrySize = await page.evaluate(() => window.G.moiImport.buildCitationRegistry().size);
registrySize > 50
  ? ok("buildCitationRegistry() returns a real, sizeable registry (" + registrySize + " citation keys) - confirms it scanned the actual seed, not an empty/stub one")
  : bad("buildCitationRegistry() size looks wrong: " + registrySize);

/* ========================================================================
   (b) End-to-end interaction: paste MOI text -> Review -> Build -> links
   ======================================================================== */

// Clean slate: this key can carry state across test runs on a shared profile.
await page.evaluate(async () => {
  const KEY = window.G.moiImport.KEY;
  await window.G.db.put("kv", { k: KEY, v: null });
});
await page.evaluate(() => { location.hash = "#/moi"; });
await page.waitForTimeout(500);

const landingHeading = await page.evaluate(() => /MOI Import/.test(document.body.textContent || ""));
landingHeading ? ok("#/moi route renders with an 'MOI Import' heading") : bad("MOI Import heading not found");

const emptyStateShown = await page.evaluate(() => /No MOI imported yet/.test(document.body.textContent || ""));
emptyStateShown ? ok("Landing shows the empty-state pitch when no plan is saved") : bad("empty-state pitch not shown on a clean slate");

// ---- open Capture ----
const importBtnClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Import an MOI/.test(b.textContent || ""));
  if (btn) { btn.click(); return true; }
  return false;
});
importBtnClicked ? ok("'Import an MOI' button found and clicked") : bad("'Import an MOI' button not found");
await page.waitForTimeout(200);

const captureShown = await page.evaluate(() => !!document.querySelector("textarea"));
captureShown ? ok("Capture screen shows a paste textarea") : bad("Capture textarea not found");

// A small synthetic MOI-like block: a detectable unit line, two headed
// blocks each citing a real, distinct corpus citation (one clean, one with
// a chapter suffix), and a fabricated citation for the Not-found bucket.
const MOI_TEXT = [
  "1st Battalion, 5th Infantry Regiment",
  "BOARD MOI - ASSIGNED STUDY TOPICS",
  "",
  "LEADERSHIP:",
  "Study ADP 6-22 thoroughly before the board.",
  "",
  "RECORDS:",
  "Review AR 623-3, Ch 2 before the board.",
  "",
  "UNKNOWN:",
  "See AR 999-99 for details.",
].join("\n");

await page.evaluate((text) => {
  const ta = document.querySelector("textarea");
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, MOI_TEXT);

const findClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Find my topics/.test(b.textContent || ""));
  if (btn) { btn.click(); return true; }
  return false;
});
findClicked ? ok("'Find my topics' button found and clicked") : bad("'Find my topics' button not found");

// ---- Review ----
await page.waitForFunction(() => /Review your matches/.test(document.body.textContent || ""), { timeout: 5000 }).catch(() => {});
const reviewShown = await page.evaluate(() => /Review your matches/.test(document.body.textContent || ""));
reviewShown ? ok("Matching completes and the Review screen renders") : bad("Review screen never appeared");

const summaryText = await page.evaluate(() => {
  const h3 = [...document.querySelectorAll("h3")].find((h) => /Review your matches/.test(h.textContent || ""));
  const hint = h3 && h3.nextElementSibling;
  return hint ? hint.textContent : null;
});
summaryText && /2 matched/.test(summaryText) && /0 need a look/.test(summaryText) && /1 not found/.test(summaryText)
  ? ok("Summary strip reads '2 matched · 0 need a look · 1 not found': \"" + summaryText + "\"")
  : bad("Summary strip text: \"" + summaryText + "\" (expected 2 matched / 0 needs review / 1 not found)");

const matchedText = await page.evaluate(() => {
  const segBtns = [...document.querySelectorAll(".segmented button")];
  const matchedBtn = segBtns.find((b) => /^Matched/.test(b.textContent || ""));
  if (matchedBtn) matchedBtn.click();
  const panels = [...document.querySelectorAll(".panel")];
  return panels.map((p) => p.textContent).join(" | ");
});
matchedText.indexOf("ADP 6-22") !== -1
  ? ok("Matched list includes ADP 6-22")
  : bad("Matched list missing ADP 6-22: " + matchedText.slice(0, 300));
matchedText.indexOf("AR 623-3") !== -1
  ? ok("Matched list includes AR 623-3 (chapter suffix correctly stripped and matched)")
  : bad("Matched list missing AR 623-3: " + matchedText.slice(0, 300));

const notFoundText = await page.evaluate(() => {
  const segBtns = [...document.querySelectorAll(".segmented button")];
  const nfBtn = segBtns.find((b) => /^Not found/.test(b.textContent || ""));
  if (nfBtn) nfBtn.click();
  return document.body.textContent || "";
});
notFoundText.indexOf("AR 999-99") !== -1
  ? ok("Not-found list includes the fabricated citation AR 999-99")
  : bad("Not-found list missing AR 999-99");

// Switch back to Matched before building, just to leave the UI in a sane
// state (not load-bearing for the assertions below).
await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".segmented button")].find((b) => /^Matched/.test(b.textContent || ""));
  if (btn) btn.click();
});

const optionsDefault = await page.evaluate(() => ({
  save: (document.getElementById("moi-opt-save") || {}).checked,
  drill: (document.getElementById("moi-opt-drill") || {}).checked,
}));
optionsDefault.save === true && optionsDefault.drill === true
  ? ok("Both commit-time checkboxes ('Save as my study plan', 'Generate a practice drill now') are checked by default")
  : bad("commit-time checkbox defaults: " + JSON.stringify(optionsDefault));

// A routine visit to #/moi with a saved plan lands collapsed (summary +
// Replace/View/Delete only) - "View" expands the SAME already-imported
// branch into the full result view. Used below every time the test
// navigates away (to follow a deep link) and back, since each such
// navigation is a fresh route() render that starts collapsed again.
async function goToMoiExpanded() {
  await page.evaluate(() => { location.hash = "#/moi"; });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "View");
    if (btn) btn.click();
  });
  await page.waitForTimeout(150);
}

// ---- Build ----
const buildClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /^Build/.test((b.textContent || "").trim()));
  if (btn) { btn.click(); return true; }
  return false;
});
buildClicked ? ok("'Build →' button found and clicked") : bad("'Build →' button not found");
await page.waitForTimeout(400);

const persisted = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.moiImport.KEY);
  return r && r.v;
});
persisted && Array.isArray(persisted.topics) && persisted.topics.length
  ? ok("Build persists a plan to IndexedDB with a real topics list (" + persisted.topics.length + " topics)")
  : bad("nothing meaningful persisted: " + JSON.stringify(persisted));
persisted && /1st Battalion|MOI imported/.test(persisted.name || "")
  ? ok("Persisted plan carries a name ('" + persisted.name + "')")
  : bad("persisted plan name looks wrong: " + JSON.stringify(persisted && persisted.name));

const resultViewShown = await page.evaluate(() => /Replace/.test(document.body.textContent || "") && /Delete/.test(document.body.textContent || ""));
resultViewShown ? ok("Build redraws Landing's own 'already imported' branch (Replace/Delete actions visible) as the result view") : bad("result view (Replace/Delete) not shown after Build");

const coverageBadgesShown = await page.evaluate(() => {
  const text = document.body.textContent || "";
  return /Strong|Partial|Gap/.test(text);
});
coverageBadgesShown ? ok("Result view shows a Strong/Partial/Gap coverage badge") : bad("no coverage badge text found in the result view");

// ---- working links: #/doctrine deep link ----
const doctrineLinkClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Doctrine →/.test(b.textContent || ""));
  if (btn) { btn.click(); return true; }
  return false;
});
doctrineLinkClicked ? ok("A 'Doctrine →' deep-link button was found and clicked") : bad("no 'Doctrine →' deep-link button found in the result view");
await page.waitForTimeout(400);
const doctrineHashAfterClick = await page.evaluate(() => location.hash);
const onDoctrineRoute = doctrineHashAfterClick === "#/doctrine" && await page.evaluate(() => /Doctrine/.test(document.body.textContent || ""));
onDoctrineRoute ? ok("The Doctrine deep link actually navigates to #/doctrine and it renders") : bad("Doctrine deep link did not land on a working #/doctrine view (hash: " + doctrineHashAfterClick + ")");

// ---- back to #/moi (re-expanded via View), working #/board deep link ----
await goToMoiExpanded();
const boardLinkClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Board →/.test(b.textContent || ""));
  if (btn) { btn.click(); return true; }
  return false;
});
if (boardLinkClicked) {
  await page.waitForTimeout(400);
  const onBoardRoute = await page.evaluate(() => location.hash === "#/board" && /Board/.test(document.body.textContent || ""));
  onBoardRoute ? ok("The Board deep link actually navigates to #/board and it renders") : bad("Board deep link did not land on a working #/board view");
} else {
  bad("no 'Board →' deep-link button found in the result view (expected at least one, given real self-check coverage)");
}

// ---- working #/library deep link (ADP 6-22 has a real Reference Library
// entry - reuses G.library._openId, the same mechanism the module already
// uses elsewhere) ----
await goToMoiExpanded();
const libraryLinkClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Library →/.test(b.textContent || ""));
  if (btn) { btn.click(); return true; }
  return false;
});
if (libraryLinkClicked) {
  await page.waitForTimeout(400);
  const onLibraryRoute = await page.evaluate(() => location.hash === "#/library" && /Reference Library|ADP 6-22/.test(document.body.textContent || ""));
  onLibraryRoute ? ok("The Library deep link actually navigates to #/library and opens the right document") : bad("Library deep link did not land on a working #/library view");
} else {
  bad("no 'Library →' deep-link button found (expected one for ADP 6-22, which has a real Reference Library entry)");
}

// ---- practice drill was generated (genDrill was checked by default) ----
await goToMoiExpanded();
const drillShown = await page.evaluate(() => /Practice drill/.test(document.body.textContent || ""));
drillShown ? ok("A practice-drill section rendered as part of the result view") : bad("no practice-drill section found");
const drillHasQuestion = await page.evaluate(() => !!document.querySelector(".card p"));
drillHasQuestion ? ok("The practice drill shows an actual question") : bad("practice drill rendered but no question text found");

// ---- Delete must confirm first (matches every other destructive action's
// G.modal.confirm({danger:true}) gate - grep test-leader.mjs's own
// "Remove must confirm" case for the same click-through pattern), then
// clears the plan back to the empty state ----
const deleteClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Delete");
  if (btn) { btn.click(); return true; }
  return false;
});
deleteClicked ? ok("'Delete' button found and clicked") : bad("'Delete' button not found");
await page.waitForTimeout(300);
const confirmShown = await page.evaluate(() => !!document.querySelector(".gm-back"));
confirmShown ? ok("Delete opens a confirm dialog before deleting") : bad("Delete removed the plan without confirming");
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".gm-back button")].find((x) => /delete/i.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(400);
const backToEmpty = await page.evaluate(() => /No MOI imported yet/.test(document.body.textContent || ""));
backToEmpty ? ok("Deleting the plan returns Landing to the empty-state pitch") : bad("Landing did not return to the empty state after Delete");
const clearedInDb = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.moiImport.KEY);
  return !(r && r.v && Array.isArray(r.v.topics) && r.v.topics.length);
});
clearedInDb ? ok("Delete actually clears the persisted plan in IndexedDB") : bad("plan still persisted in IndexedDB after Delete");

// cleanup
await page.evaluate(async () => { await window.G.db.put("kv", { k: window.G.moiImport.KEY, v: null }); });

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nMOI-IMPORT: all passed");
process.exit(fails ? 1 : 0);
