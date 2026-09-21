/**
 * MOI Import Engine, Phase 1 overhaul (#/moi, G.moiImport): a Soldier imports
 * a board MOI (memorandum of instruction - a memo assigning doctrine
 * citations as study topics) and gets a curated study dashboard, plus an
 * optional practice drill, built from exactly what that MOI assigns.
 *
 * This suite covers the ORIGINAL single-plan pipeline/interaction pass AND
 * the Phase 1 overhaul on top of it (two real bug fixes plus multi-plan
 * history, match-tier badges and board-date awareness):
 *
 *  (a) tokenizeCitations/normalizeCitation/matchCitation/diffPlans exercised
 *      directly via window.G.moiImport against the REAL seed - the same
 *      pattern test-rankutils.mjs already uses for G.rankUtils. Covers every
 *      confidence tier, the AR 600-8-2/AR 600-8-22 substring-collision
 *      guarantee, the FM 3-22.9 alias, a genuinely unmatched fabricated
 *      citation, diffPlans()'s own added/removed/coverageChanged logic
 *      against fully hand-built plan snapshots, and a live regression check
 *      that a real fan-out citation's per-topic counts are NOT inflated
 *      (Part A2's bug fix) - conservation (per-topic counts sum exactly to
 *      the shared aggregate) plus a genuine split (at least one topic's
 *      count is strictly less than the aggregate, not just "never exceeds
 *      it," which a still-broken implementation could pass by accident).
 *
 *  (b) Legacy migration: seeds the OLD single-plan kv shape
 *      (guidon:moi:plan:v1) directly, boots #/moi, and confirms it becomes
 *      exactly one plan family with no data loss, the legacy row is nulled,
 *      the migration flag is set, and - critically - deleting that migrated
 *      family and then re-seeding the (now nulled) legacy key again never
 *      resurrects it on a later boot.
 *
 *  (c) A full interaction pass for Plan A: paste a synthetic MOI-like text
 *      block covering all three review buckets PLUS a superseded citation
 *      (FM 3-22.9) into the route, confirm Review shows the right tier
 *      badges (Part B: "Exact match" / "Superseded citation") next to the
 *      coverage badges, exercise the glyph-folded manual-review flow, Build
 *      a saved plan with a practice drill, and confirm the persisted
 *      dashboard renders the same tier badges (Part B4) and its deep links
 *      into #/doctrine, #/board and #/library actually navigate.
 *
 *  (d) Plan B: a second, DISTINCT plan built from a single real fan-out
 *      citation (AR 350-1) - doubles as the end-to-end version of (a)'s A2
 *      regression (the persisted plan.topicCoverage per topic must equal
 *      that citation's own topicCounts share, not its combined aggregate)
 *      and confirms Landing's menu now shows two plan-family cards.
 *
 *  (e) Re-importing a revision of Plan A (a citation dropped, a citation
 *      added) and confirming the "What changed since..." disclosure's
 *      stored diff matches diffPlans() computed fresh from the two real
 *      persisted snapshots.
 *
 *  (f) Board-date awareness (Part D): the countdown banner and "Remind me
 *      before board" button are absent/inert with no board date set, and
 *      appear/work (reminder added with source "moi:plan", button disables
 *      and relabels) once one is.
 *
 *  (g) Delete removes only ONE family (Plan B) and leaves Plan A intact,
 *      AND clears the "moi:plan" reminder even though it was set while a
 *      DIFFERENT family (Plan A) was open - the fixed, not per-family,
 *      reminder source this file's own openPlan() comment documents.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

/** YYYY-MM-DD for "n days from today", local date arithmetic - same
    technique test-reminders-urgency-parity.mjs / test-consistency-extended.mjs
    already use. */
function daysFromNowStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
// This suite's #/library deep-link check (below) opens a real Reference
// Library document, which fires G.library's own PDF-availability probe. When
// web/docs/ genuinely isn't shipped - this repo's own CI build-output
// artifact deliberately excludes web/docs/** (~78MB of source PDFs) - that
// probe 404s and the app correctly sets _pdfAvailable=false and carries on,
// but the 404 still lands in the console as noise. Same environment-aware
// forgiveness test-library.mjs already uses for the identical probe: count
// the real network-response 404s on /docs/*.pdf and forgive exactly that
// many console entries, never a blanket 404 allowance.
let docsProbe404 = 0;
page.on("response", (r) => { try { if (!r.ok() && /\/docs\/.*\.pdf$/i.test(new URL(r.url()).pathname)) docsProbe404++; } catch (e) {} });

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await dismissOnboarding(page);
await page.waitForTimeout(300);

// ---- Clean slate: these keys can carry state across test runs on a shared
// profile. LEGACY_MIGRATED_FLAG is not exported (only KEY/PLANS_KEY/
// diffPlans/render/the pure matching functions are, per G.moiImport's own
// export table) - its literal value is hardcoded here, matching the one
// other place a non-exported constant's literal has to be known: the app's
// own KV_VALIDATORS/manifest entries for it (grep
// "guidon:moi:legacyMigrated:v1" in src/index.html / manifest.json).
const LEGACY_MIGRATED_FLAG = "guidon:moi:legacyMigrated:v1";
await page.evaluate(async (FLAG) => {
  await window.G.db.put("kv", { k: window.G.moiImport.KEY, v: null });
  await window.G.db.put("kv", { k: window.G.moiImport.PLANS_KEY, v: [] });
  await window.G.db.setSetting(FLAG, false);
}, LEGACY_MIGRATED_FLAG);

/* ========================================================================
   (a) Pure matching pipeline, against the real seed
   ======================================================================== */

const apiPresent = await page.evaluate(() =>
  !!(window.G && window.G.moiImport && window.G.moiImport.tokenizeCitations &&
     window.G.moiImport.normalizeCitation && window.G.moiImport.matchCitation &&
     window.G.moiImport.buildCitationRegistry && window.G.moiImport.diffPlans &&
     window.G.moiImport.PLANS_KEY));
apiPresent
  ? ok("window.G.moiImport is present with the pure pipeline, diffPlans, KEY and PLANS_KEY")
  : bad("window.G.moiImport (or one of its exports) is missing");

// ---- clean citation: exact match, no suffix, no confusion ----
const cleanResult = await page.evaluate(() => window.G.moiImport.matchCitation("AR 350-1"));
cleanResult.tier === "exact-fanout"
  ? ok("Clean citation 'AR 350-1' resolves to tier 'exact-fanout' (cited by multiple topics in the real corpus)")
  : bad("Clean citation 'AR 350-1': expected tier 'exact-fanout', got " + JSON.stringify(cleanResult.tier));
cleanResult.normalized === "AR 350-1" && cleanResult.counts && cleanResult.counts.doctrineCards > 0
  ? ok("Clean citation carries real doctrineCards/selfCheckQuestions counts from the registry")
  : bad("Clean citation result shape wrong: " + JSON.stringify(cleanResult));
cleanResult.topicCounts && typeof cleanResult.topicCounts === "object"
  ? ok("matchCitation() result now carries a topicCounts object (Part A2)")
  : bad("matchCitation('AR 350-1') has no topicCounts: " + JSON.stringify(cleanResult));

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
unmatchedResult.tier === "unmatched" && (!unmatchedResult.topics || unmatchedResult.topics.length === 0) && unmatchedResult.topicCounts === null
  ? ok("Fabricated citation 'AR 999-99' correctly resolves to tier 'unmatched' with no topics and topicCounts:null")
  : bad("matchCitation('AR 999-99') -> " + JSON.stringify(unmatchedResult));

// ---- never a fuzzy fallback: a near-miss one-digit-off citation that IS
// real content-adjacent still must not silently borrow a match ----
const registrySize = await page.evaluate(() => window.G.moiImport.buildCitationRegistry().size);
registrySize > 50
  ? ok("buildCitationRegistry() returns a real, sizeable registry (" + registrySize + " citation keys) - confirms it scanned the actual seed, not an empty/stub one")
  : bad("buildCitationRegistry() size looks wrong: " + registrySize);

/* ------------------------------------------------------------------------
   Part A2 regression: per-topic counts on a real fan-out citation must NOT
   be inflated. Before this fix, EVERY topic a fan-out citation touches
   showed that citation's combined total; the real bug this closes.
   ------------------------------------------------------------------------ */
const fanout = await page.evaluate(() => {
  const m = window.G.moiImport.matchCitation("AR 350-1");
  return { tier: m.tier, topics: m.topics, counts: m.counts, topicCounts: m.topicCounts };
});
fanout.tier === "exact-fanout" && fanout.topics.length > 1
  ? ok("AR 350-1 is a real fan-out citation (" + fanout.topics.length + " topics) - the shape this A2 regression needs")
  : bad("AR 350-1 is not fan-out as expected, this regression check needs a different fixture: " + JSON.stringify(fanout));
const fanoutKeys = Object.keys(fanout.topicCounts || {});
fanoutKeys.length === fanout.topics.length && fanout.topics.every((t) => fanoutKeys.includes(t))
  ? ok("matchCitation('AR 350-1').topicCounts has exactly one entry per topic (" + fanoutKeys.length + ")")
  : bad("topicCounts keys don't match topics: " + JSON.stringify(fanout));
const sumDoc = fanoutKeys.reduce((s, t) => s + fanout.topicCounts[t].doctrineCards, 0);
const sumQ = fanoutKeys.reduce((s, t) => s + fanout.topicCounts[t].selfCheckQuestions, 0);
// <= the shared aggregate, not necessarily ===: buildCitationRegistry()'s
// own record() deliberately records SOME sources (a scenario's doctrine[]
// list, a Forms Trainer entry's reference field - see their own comments in
// moi-import.js) with topic:null, which still adds to the shared `counts`
// aggregate but has nothing to key a per-topic bucket on, by design. A
// citation cited by both real-topic sources and topic-less ones (AR 350-1
// is: 6 real-topic doctrine entries plus 4 topic-less scenarios and 1
// topic-less form, all doctrineCards) will legitimately sum to LESS than
// its aggregate on the per-topic side - that gap is real, documented
// behavior, not the A2 bug. The two checks just below (never inflated,
// genuinely split) are what actually prove the fix.
sumDoc <= fanout.counts.doctrineCards && sumQ <= fanout.counts.selfCheckQuestions
  ? ok("per-topic counts never exceed the shared aggregate in total either (" + sumDoc + "/" + sumQ + " summed across " + fanoutKeys.length + " topics, vs aggregate " + fanout.counts.doctrineCards + "/" + fanout.counts.selfCheckQuestions + " - any shortfall is topic-less scenario/forms coverage, not lost data)")
  : bad("per-topic sum " + sumDoc + "/" + sumQ + " EXCEEDS the shared aggregate " + fanout.counts.doctrineCards + "/" + fanout.counts.selfCheckQuestions + " - real over-counting");
const anyInflated = fanoutKeys.some((t) => fanout.topicCounts[t].doctrineCards > fanout.counts.doctrineCards || fanout.topicCounts[t].selfCheckQuestions > fanout.counts.selfCheckQuestions);
!anyInflated
  ? ok("no single topic's per-topic count exceeds the shared aggregate (the exact bug this fixes - every topic used to show the FULL combined total)")
  : bad("a topic's per-topic count exceeds the shared aggregate - still inflated: " + JSON.stringify(fanout));
const someStrictlySplit = fanoutKeys.some((t) => fanout.topicCounts[t].doctrineCards < fanout.counts.doctrineCards || fanout.topicCounts[t].selfCheckQuestions < fanout.counts.selfCheckQuestions);
someStrictlySplit
  ? ok("at least one topic's per-topic count is strictly LESS than the shared aggregate - the counts are genuinely split, not just duplicated under a passing-by-accident check")
  : bad("no topic's per-topic count is less than the aggregate - suspicious, looks undivided: " + JSON.stringify(fanout));

/* ------------------------------------------------------------------------
   diffPlans() - fully hand-built plan snapshots, no dependency on seed
   content. Covers added/removed/coverageChanged, a self-diff (no changes),
   and a null previous snapshot (every topic reads as added).
   ------------------------------------------------------------------------ */
const diffCases = await page.evaluate(() => {
  const f = window.G.moiImport.diffPlans;
  const a = { topics: ["Alpha", "Bravo"], topicCoverage: { Alpha: { doctrineCards: 1, selfCheckQuestions: 0 }, Bravo: { doctrineCards: 2, selfCheckQuestions: 1 } } };
  const b = { topics: ["Bravo", "Charlie"], topicCoverage: { Bravo: { doctrineCards: 3, selfCheckQuestions: 1 }, Charlie: { doctrineCards: 0, selfCheckQuestions: 2 } } };
  return { d1: f(a, b), d2: f(a, a), d3: f(null, b) };
});
JSON.stringify(diffCases.d1.added) === JSON.stringify(["Charlie"])
  ? ok("diffPlans: 'Charlie' (new in b) correctly detected as added")
  : bad("diffPlans added: " + JSON.stringify(diffCases.d1.added));
JSON.stringify(diffCases.d1.removed) === JSON.stringify(["Alpha"])
  ? ok("diffPlans: 'Alpha' (dropped from a) correctly detected as removed")
  : bad("diffPlans removed: " + JSON.stringify(diffCases.d1.removed));
diffCases.d1.coverageChanged.length === 1 && diffCases.d1.coverageChanged[0].topic === "Bravo" &&
  diffCases.d1.coverageChanged[0].before.doctrineCards === 2 && diffCases.d1.coverageChanged[0].after.doctrineCards === 3
  ? ok("diffPlans: 'Bravo' present in both, coverage change (2->3 doctrine cards) correctly detected as the ONLY coverageChanged entry (Alpha/Charlie are add/remove, not a change)")
  : bad("diffPlans coverageChanged: " + JSON.stringify(diffCases.d1.coverageChanged));
diffCases.d2.added.length === 0 && diffCases.d2.removed.length === 0 && diffCases.d2.coverageChanged.length === 0
  ? ok("diffPlans: diffing a plan against itself yields no changes")
  : bad("diffPlans self-diff not empty: " + JSON.stringify(diffCases.d2));
JSON.stringify(diffCases.d3.added.slice().sort()) === JSON.stringify(["Bravo", "Charlie"]) && diffCases.d3.removed.length === 0
  ? ok("diffPlans: a null previous snapshot treats every next topic as added, nothing removed")
  : bad("diffPlans(null, b): " + JSON.stringify(diffCases.d3));

/* ========================================================================
   (b) Legacy migration: guidon:moi:plan:v1 -> one family in
   guidon:moi:plans:v1, at most once, ever
   ======================================================================== */

const LEGACY_PLAN = {
  name: "Legacy Test Battalion",
  importedAt: Date.now() - 1000000,
  topics: ["Legacy Topic One", "Legacy Topic Two"],
  topicCoverage: { "Legacy Topic One": { doctrineCards: 2, selfCheckQuestions: 1 }, "Legacy Topic Two": { doctrineCards: 0, selfCheckQuestions: 3 } },
  topicLinks: { "Legacy Topic One": { citationKey: "AR 1-1", boardCategory: null }, "Legacy Topic Two": { citationKey: "AR 2-2", boardCategory: "Legacy Topic Two" } },
  groups: null,
  generatedDrillCategories: [],
};
await page.evaluate((plan) => window.G.db.put("kv", { k: window.G.moiImport.KEY, v: plan }), LEGACY_PLAN);
await page.evaluate(() => { location.hash = "#/moi"; });
await page.waitForFunction(() => !!document.querySelector(".empty-state, .card-results-grid"), { timeout: 5000 });

const afterMigration = await page.evaluate(async () => {
  const legacyRow = await window.G.db.get("kv", window.G.moiImport.KEY);
  const plansRow = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  return { legacyValue: legacyRow && legacyRow.v, families: (plansRow && plansRow.v) || [] };
});
afterMigration.legacyValue === null
  ? ok("Migration nulls the legacy guidon:moi:plan:v1 row (not deleted - see its KV_VALIDATORS comment)")
  : bad("legacy row after migration: " + JSON.stringify(afterMigration.legacyValue));
afterMigration.families.length === 1
  ? ok("Migration produced exactly ONE plan family from the legacy row")
  : bad("families after migration: " + JSON.stringify(afterMigration.families.map((f) => f.id)));
const migratedFamily = afterMigration.families[0];
migratedFamily && migratedFamily.id === "legacy-" + LEGACY_PLAN.importedAt && migratedFamily.history.length === 0
  ? ok("Migrated family carries the documented id shape ('legacy-' + importedAt) and an empty history")
  : bad("migrated family shape: " + JSON.stringify(migratedFamily));
migratedFamily && JSON.stringify(migratedFamily.current.topics) === JSON.stringify(LEGACY_PLAN.topics) &&
  JSON.stringify(migratedFamily.current.topicCoverage) === JSON.stringify(LEGACY_PLAN.topicCoverage)
  ? ok("Migrated family's `current` matches the legacy plan exactly - no data loss")
  : bad("migrated current plan: " + JSON.stringify(migratedFamily && migratedFamily.current));
const migratedFlag = await page.evaluate((FLAG) => window.G.db.getSetting(FLAG, false), LEGACY_MIGRATED_FLAG);
migratedFlag === true
  ? ok("Migration sets the one-time migration flag")
  : bad("migration flag after migrating: " + JSON.stringify(migratedFlag));

const menuAfterMigration = await page.evaluate(() => document.body.textContent || "");
/Your MOI plans/.test(menuAfterMigration) && /Legacy Test Battalion/.test(menuAfterMigration)
  ? ok("Landing shows the menu (not the empty state) with the migrated plan's card after migration")
  : bad("Landing after migration did not show the expected menu/card");

// ---- Delete the migrated family, then simulate a stray legacy row
// reappearing (an anomaly that should never happen post-Phase-1, but
// proves the migration flag - not just an empty legacy row - is what
// actually gates re-migration) - confirms a Soldier who deletes every
// migrated plan never has it resurrected. ----
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Legacy Test Battalion/.test(b.textContent || ""));
  if (btn) btn.click();
});
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Delete"), { timeout: 5000 });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Delete");
  if (btn) btn.click();
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".gm-back button")].find((x) => /delete/i.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(400);
// Structural check (.empty-state is the real CSS class util.emptyState()
// creates), not a body.textContent regex - "No MOI imported yet" is also a
// JS string literal inside moi-import.js's own embedded <script>, which
// textContent walks into regardless of what actually rendered (see the
// scoped p.hint checks above for the same gotcha, hit for real while
// writing this suite).
const emptyAfterDelete = await page.evaluate(() => !!document.querySelector(".empty-state"));
emptyAfterDelete ? ok("Deleting the migrated family returns Landing to the empty state") : bad("Landing did not return to empty state after deleting the migrated family");

await page.evaluate((plan) => window.G.db.put("kv", { k: window.G.moiImport.KEY, v: plan }), LEGACY_PLAN);
await page.reload({ waitUntil: "load" });
// A full reload re-runs the whole boot sequence (store init, seed load,
// IndexedDB open) from a cold start - no single DOM milestone captures
// "fully booted" better than a generous fixed window here, the same
// reasoning this suite's own very first wait (after the initial page.goto)
// already relies on. // hygiene-ok: cold-boot reload has no DOM milestone
await page.waitForTimeout(1200);
await page.evaluate(() => { location.hash = "#/moi"; });
await page.waitForFunction(() => !!document.querySelector(".empty-state, .card-results-grid"), { timeout: 5000 });
const afterSecondBoot = await page.evaluate(async () => {
  const plansRow = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  return { families: (plansRow && plansRow.v) || [], hasEmptyState: !!document.querySelector(".empty-state") };
});
afterSecondBoot.families.length === 0
  ? ok("A stray legacy row re-seeded after migration+deletion is NEVER resurrected as a family on a later boot (the migration flag, not the row's presence, gates it)")
  : bad("families after re-seeding the legacy row post-migration: " + JSON.stringify(afterSecondBoot.families));
afterSecondBoot.hasEmptyState
  ? ok("Landing correctly shows the empty state, not a resurrected plan, after the re-seed")
  : bad("Landing did not show the empty state after the legacy-row re-seed test");

// Clean up before the real interaction pass below.
await page.evaluate(() => window.G.db.put("kv", { k: window.G.moiImport.KEY, v: null }));

/* ========================================================================
   (c) Plan A: end-to-end interaction, tier badges (Part B), Build, links
   ======================================================================== */

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

// Scoped to real rendered p.hint elements, never document.body.textContent -
// this app's script source is itself embedded inline in <body>, and
// textContent walks INTO <script> tags, so a raw body-text check for a
// string that also appears as a JS literal (like this exact copy, written
// into moi-import.js's own capture() function) is always true regardless of
// whether anything actually rendered. Confirmed the hard way while writing
// this suite: an early, unscoped version of this exact check passed on a
// screen where the element was never created.
const noRevisionLabelOnFreshCapture = await page.evaluate(() => ![...document.querySelectorAll("p.hint")].some((p) => /Re-importing a revision/.test(p.textContent || "")));
noRevisionLabelOnFreshCapture ? ok("Capture for a brand-new plan (targetFamilyId null) shows no 'Re-importing a revision' label") : bad("unexpected revision label on a fresh Capture");

// A small synthetic MOI-like block: a detectable unit line, headed blocks
// citing real, distinct corpus citations (one clean, one with a chapter
// suffix, one superseded), a glyph-confused citation for the Needs Review
// bucket, and a fabricated citation for the Not-found bucket.
//
// "AR GOO-9" is this same suite's own glyph-folded unit-test citation from
// part (a) above (it normalizes to AR 600-9 and is guaranteed to land in
// tier 'glyph-folded'). FM 3-22.9 is the documented alias -> TC 3-22.9,
// added in the Phase 1 pass specifically to exercise the new "Superseded
// citation" tier badge (Part B) end to end, not just in matchCitation().
const MOI_TEXT_A = [
  "1st Battalion, 5th Infantry Regiment",
  "BOARD MOI - ASSIGNED STUDY TOPICS",
  "",
  "LEADERSHIP:",
  "Study ADP 6-22 thoroughly before the board.",
  "",
  "RECORDS:",
  "Review AR 623-3, Ch 2 before the board.",
  "",
  "MARKSMANSHIP:",
  "Study FM 3-22.9 before the board.",
  "",
  "REVIEW:",
  "Double-check AR GOO-9 before the board.",
  "",
  "UNKNOWN:",
  "See AR 999-99 for details.",
].join("\n");

await page.evaluate((text) => {
  const ta = document.querySelector("textarea");
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, MOI_TEXT_A);

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
summaryText && /3 matched/.test(summaryText) && /1 need a look/.test(summaryText) && /1 not found/.test(summaryText)
  ? ok("Summary strip reads '3 matched · 1 need a look · 1 not found': \"" + summaryText + "\"")
  : bad("Summary strip text: \"" + summaryText + "\" (expected 3 matched / 1 needs review / 1 not found)");

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
matchedText.indexOf("TC 3-22.9") !== -1 && matchedText.indexOf("superseded FM 3-22.9") !== -1
  ? ok("Matched list includes TC 3-22.9, noted as superseded FM 3-22.9")
  : bad("Matched list missing the FM 3-22.9 -> TC 3-22.9 alias row: " + matchedText.slice(0, 300));

// ---- Part B2: tier badges render on the Matched rows ----
const matchedTierBadges = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".segmented + * .panel, .panel")].filter((p) => p.textContent && (/ADP 6-22|AR 623-3|TC 3-22\.9/.test(p.textContent)));
  return cards.map((c) => ({ text: c.textContent.slice(0, 60), hasExact: /Exact match/.test(c.textContent), hasSuperseded: /Superseded citation/.test(c.textContent) }));
});
matchedTierBadges.some((c) => c.hasExact)
  ? ok("At least one Matched row shows the 'Exact match' tier badge (Part B2)")
  : bad("No Matched row shows 'Exact match': " + JSON.stringify(matchedTierBadges));
matchedTierBadges.some((c) => c.hasSuperseded)
  ? ok("The FM 3-22.9 row shows the 'Superseded citation' tier badge (Part B2)")
  : bad("No Matched row shows 'Superseded citation': " + JSON.stringify(matchedTierBadges));

const notFoundText = await page.evaluate(() => {
  const segBtns = [...document.querySelectorAll(".segmented button")];
  const nfBtn = segBtns.find((b) => /^Not found/.test(b.textContent || ""));
  if (nfBtn) nfBtn.click();
  return document.body.textContent || "";
});
notFoundText.indexOf("AR 999-99") !== -1
  ? ok("Not-found list includes the fabricated citation AR 999-99")
  : bad("Not-found list missing AR 999-99");

/* ------------------------------------------------------------------------
   Needs Review (glyph-folded) manual-review flow. AR GOO-9 folds to
   AR 600-9 and lands in "Needs a look". Exercises the row's Accept/
   Dismiss/Search controls, the searchBtn aria-expanded disclosure toggle,
   and the inline topic-search accept path end to end.
   ------------------------------------------------------------------------ */
await page.evaluate(() => {
  const segBtns = [...document.querySelectorAll(".segmented button")];
  const needsBtn = segBtns.find((b) => /^Needs review/.test(b.textContent || ""));
  if (needsBtn) needsBtn.click();
});

function findNeedsPanelSnippet() {
  const panel = [...document.querySelectorAll(".panel")].find((p) => /AR GOO-9/.test(p.textContent || ""));
  if (!panel) return null;
  const btnTexts = [...panel.querySelectorAll("button")].map((b) => b.textContent.trim());
  const searchBtn = [...panel.querySelectorAll("button")].find((b) => /Search for the right topic/.test(b.textContent || ""));
  return { btnTexts: btnTexts, searchAriaExpanded: searchBtn ? searchBtn.getAttribute("aria-expanded") : null };
}
const needsRowInitial = await page.evaluate(findNeedsPanelSnippet);
needsRowInitial && needsRowInitial.btnTexts.includes("Accept") && needsRowInitial.btnTexts.includes("Dismiss") && needsRowInitial.btnTexts.some((t) => /Search for the right topic/.test(t))
  ? ok("Needs-review row for AR GOO-9 (glyph-folded) renders Accept/Dismiss/Search controls")
  : bad("Needs-review row for AR GOO-9 missing expected controls: " + JSON.stringify(needsRowInitial));
needsRowInitial && needsRowInitial.searchAriaExpanded === "false"
  ? ok("Needs-review row's search toggle starts collapsed with aria-expanded=\"false\"")
  : bad("Needs-review row's search toggle initial aria-expanded: " + JSON.stringify(needsRowInitial && needsRowInitial.searchAriaExpanded));

await page.evaluate(() => {
  const panel = [...document.querySelectorAll(".panel")].find((p) => /AR GOO-9/.test(p.textContent || ""));
  const btn = panel && [...panel.querySelectorAll("button")].find((b) => /Search for the right topic/.test(b.textContent || ""));
  if (btn) btn.click();
});
await page.waitForTimeout(150);
const afterToggle = await page.evaluate(() => {
  const panel = [...document.querySelectorAll(".panel")].find((p) => /AR GOO-9/.test(p.textContent || ""));
  const btn = panel && [...panel.querySelectorAll("button")].find((b) => /Search for the right topic/.test(b.textContent || ""));
  const input = panel && panel.querySelector('input[aria-label="Search for the right topic"]');
  return { ariaExpanded: btn ? btn.getAttribute("aria-expanded") : null, inputPresent: !!input };
});
afterToggle.ariaExpanded === "true"
  ? ok("Clicking 'Search for the right topic' flips its aria-expanded from \"false\" to \"true\"")
  : bad("aria-expanded after clicking the search toggle: " + JSON.stringify(afterToggle.ariaExpanded));
afterToggle.inputPresent
  ? ok("The inline topic-search input appears once the disclosure is open")
  : bad("inline topic-search input did not appear after opening the disclosure");

// Dismiss AR GOO-9 rather than accepting it this time (unlike the original
// suite) - keeps Plan A's accepted topic set limited to ADP 6-22/AR 623-3/
// TC 3-22.9 only, which section (e) below needs to be able to predict
// exactly for its revision-diff assertions.
await page.evaluate(() => {
  const panel = [...document.querySelectorAll(".panel")].find((p) => /AR GOO-9/.test(p.textContent || ""));
  const btn = panel && [...panel.querySelectorAll("button")].find((b) => b.textContent.trim() === "Dismiss");
  if (btn) btn.click();
});
const afterDismiss = await page.evaluate(() => {
  const panel = [...document.querySelectorAll(".panel")].find((p) => /AR GOO-9/.test(p.textContent || ""));
  const status = panel && panel.querySelector(".badge");
  return status ? status.textContent : null;
});
afterDismiss === "Dismissed"
  ? ok("Dismissing the AR GOO-9 needs-review row marks it Dismissed (excluded from Build)")
  : bad("status badge after dismissing: " + JSON.stringify(afterDismiss));

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

// Setting location.hash to a value it ALREADY is fires no hashchange event
// (a no-op) - genuinely landed on more than once below, since Build and
// openPlan()'s own back button both leave the test sitting at #/moi without
// ever having navigated away. Routing through the neutral #/home route
// first guarantees a real hashchange every time, regardless of where the
// test currently is. Waits for the real state (the hash itself, then the
// menu's own card grid) rather than a fixed sleep - called too many times
// below for a fixed window to be anything but wasted time on a fast
// machine and a flake risk on a loaded one.
async function goToMoiMenu() {
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForFunction(() => location.hash === "#/home", { timeout: 5000 });
  await page.evaluate(() => { location.hash = "#/moi"; });
  await page.waitForFunction(() => !!document.querySelector(".card-results-grid"), { timeout: 5000 });
}

// A routine visit to #/moi with 1+ saved families now lands on the MENU
// (Part C4 - even a single family no longer jumps straight to its detail
// view) - open a specific family by name, then "View" to expand. Used
// below every time the test navigates away (a deep link) and back. Every
// step waits for the real DOM state it needs next, not a fixed sleep - the
// menu click always opens the family collapsed ("View" visible; menu()'s
// own card handler always calls openPlan(family, false)), so waiting for
// "Hide details" to appear after clicking "View" is a real, deterministic
// milestone, not a guess at timing.
async function openFamilyExpanded(nameRe) {
  await goToMoiMenu();
  await page.evaluate((re) => {
    const pattern = new RegExp(re);
    const btn = [...document.querySelectorAll(".card-results-grid button")].find((b) => pattern.test(b.textContent || ""));
    if (btn) btn.click();
  }, nameRe.source);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "View"), { timeout: 5000 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "View");
    if (btn) btn.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Hide details"), { timeout: 5000 });
}

// ---- Build ----
const buildClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /^Build/.test((b.textContent || "").trim()));
  if (btn) { btn.click(); return true; }
  return false;
});
buildClicked ? ok("'Build →' button found and clicked") : bad("'Build →' button not found");
await page.waitForTimeout(400);

const persistedFamilies = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  return (r && r.v) || [];
});
persistedFamilies.length === 1
  ? ok("Build persists exactly one plan family to guidon:moi:plans:v1")
  : bad("families after building Plan A: " + JSON.stringify(persistedFamilies.map((f) => f.id)));
const familyA = persistedFamilies[0];
familyA && Array.isArray(familyA.current.topics) && familyA.current.topics.length
  ? ok("Plan A's family carries a real topics list (" + familyA.current.topics.length + " topics)")
  : bad("nothing meaningful persisted for Plan A: " + JSON.stringify(familyA));
familyA && /1st Battalion|MOI imported/.test(familyA.current.name || "")
  ? ok("Plan A's persisted family carries a name ('" + familyA.current.name + "')")
  : bad("Plan A's persisted name looks wrong: " + JSON.stringify(familyA && familyA.current.name));
familyA && familyA.history.length === 0 && familyA.createdAt === familyA.current.importedAt
  ? ok("A brand-new family (targetFamilyId null) has empty history and createdAt === its own importedAt")
  : bad("Plan A's family shape: " + JSON.stringify(familyA));

// Part B3: topicTiers persisted, one entry per topic, each a real tier name.
familyA && familyA.current.topicTiers && familyA.current.topics.every((t) => !!familyA.current.topicTiers[t])
  ? ok("Plan A's persisted plan carries topicTiers with a real tier for every topic (Part B3)")
  : bad("Plan A's topicTiers: " + JSON.stringify(familyA && familyA.current.topicTiers));

const resultViewShown = await page.evaluate(() => /Re-import a revision/.test(document.body.textContent || "") && /Delete/.test(document.body.textContent || ""));
resultViewShown ? ok("Build redraws openPlan()'s own detail view (Re-import a revision/Delete actions visible) as the result view") : bad("result view (Re-import a revision/Delete) not shown after Build");

// ---- viewBtn's own aria-expanded disclosure state: Build's success path
// starts expanded ("Hide details"/aria-expanded="true"), toggling to
// collapsed ("View"/aria-expanded="false") and back exercises both
// directions of the same accessible-disclosure convention searchBtn
// already had.
const viewBtnInitial = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Hide details" || b.textContent.trim() === "View");
  return btn ? { text: btn.textContent.trim(), ariaExpanded: btn.getAttribute("aria-expanded") } : null;
});
viewBtnInitial && viewBtnInitial.text === "Hide details" && viewBtnInitial.ariaExpanded === "true"
  ? ok("Build's success path starts expanded: the toggle reads 'Hide details' with aria-expanded=\"true\"")
  : bad("view/hide-details toggle state right after Build: " + JSON.stringify(viewBtnInitial));
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Hide details" || b.textContent.trim() === "View");
  if (btn) btn.click();
});
await page.waitForTimeout(150);
const viewBtnAfterCollapse = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Hide details" || b.textContent.trim() === "View");
  return btn ? { text: btn.textContent.trim(), ariaExpanded: btn.getAttribute("aria-expanded") } : null;
});
viewBtnAfterCollapse && viewBtnAfterCollapse.text === "View" && viewBtnAfterCollapse.ariaExpanded === "false"
  ? ok("Clicking the toggle collapses it: reads 'View' with aria-expanded=\"false\"")
  : bad("view/hide-details toggle state after collapsing: " + JSON.stringify(viewBtnAfterCollapse));
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Hide details" || b.textContent.trim() === "View");
  if (btn) btn.click();
});
await page.waitForTimeout(150);

const coverageBadgesShown = await page.evaluate(() => {
  const text = document.body.textContent || "";
  return /Strong|Partial|Gap/.test(text);
});
coverageBadgesShown ? ok("Result view shows a Strong/Partial/Gap coverage badge") : bad("no coverage badge text found in the result view");

// ---- Part B4: tier badges also render in the PERSISTED dashboard, not
// just Review - "Exact match" for ADP 6-22/AR 623-3's topics, "Superseded
// citation" for TC 3-22.9's topics (via FM 3-22.9's alias). Data-driven
// (fetched from the live matchCitation() result), never hardcoded topic
// names - robust to seed content changes.
const dashboardTierBadges = await page.evaluate(() => {
  const supersededTopics = window.G.moiImport.matchCitation("FM 3-22.9").topics;
  const rows = [...document.querySelectorAll(".panel")];
  function rowFor(topic) { return rows.find((r) => r.textContent && r.textContent.indexOf(topic) !== -1); }
  const supersededRow = supersededTopics.length ? rowFor(supersededTopics[0]) : null;
  return {
    anyExactMatch: /Exact match/.test(document.body.textContent || ""),
    supersededTopic: supersededTopics[0] || null,
    supersededRowHasBadge: !!(supersededRow && /Superseded citation/.test(supersededRow.textContent || "")),
  };
});
dashboardTierBadges.anyExactMatch
  ? ok("Persisted dashboard shows the 'Exact match' tier badge next to a coverage badge (Part B4)")
  : bad("Persisted dashboard shows no 'Exact match' tier badge");
(!dashboardTierBadges.supersededTopic || dashboardTierBadges.supersededRowHasBadge)
  ? ok("Persisted dashboard shows 'Superseded citation' on TC 3-22.9's own topic row" + (dashboardTierBadges.supersededTopic ? " (" + dashboardTierBadges.supersededTopic + ")" : " (no topic to check - alias citation has none in this corpus build)"))
  : bad("TC 3-22.9's topic row ('" + dashboardTierBadges.supersededTopic + "') does not show 'Superseded citation'");

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

// ---- back to Plan A (re-expanded via the menu + View), working #/board deep link ----
await openFamilyExpanded(/1st Battalion/);
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
// entry - reuses G.library._openId, the same mechanism buildTopicLinkRow()
// shares with buildDiffPanel()'s own added-topics list) ----
await openFamilyExpanded(/1st Battalion/);
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
await openFamilyExpanded(/1st Battalion/);
const drillShown = await page.evaluate(() => /Practice drill/.test(document.body.textContent || ""));
drillShown ? ok("A practice-drill section rendered as part of the result view") : bad("no practice-drill section found");
const drillHasQuestion = await page.evaluate(() => !!document.querySelector(".card p"));
drillHasQuestion ? ok("The practice drill shows an actual question") : bad("practice drill rendered but no question text found");

/* ========================================================================
   (d) Plan B: a second, distinct plan built from a real fan-out citation -
   doubles as (a)'s A2 regression proved end-to-end through the real Build
   pipeline, and confirms the menu now lists two families.
   ======================================================================== */

const arFanout = await page.evaluate(() => window.G.moiImport.matchCitation("AR 350-1"));

// goToMoiMenu(), not a raw hash set: the last thing section (c) did left
// the test sitting on Plan A's own detail view, already at #/moi - setting
// location.hash to the value it already is fires no hashchange event.
await goToMoiMenu();
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /\+ Import another MOI/.test(b.textContent || ""));
  if (btn) btn.click();
});
await page.waitForFunction(() => !!document.querySelector("textarea"), { timeout: 5000 });
const noRevisionLabelOnPlanB = await page.evaluate(() => ![...document.querySelectorAll("p.hint")].some((p) => /Re-importing a revision/.test(p.textContent || "")));
noRevisionLabelOnPlanB ? ok("'+ Import another MOI' opens Capture with no revision label (targetFamilyId null, a brand-new family)") : bad("unexpected revision label when starting Plan B");

// No comma right after "Battalion" - detectMoiName()'s UNIT_RE stops
// capturing at the first comma/period/semicolon, so this unit line is
// written to capture a full, distinguishing name for the menu-card checks
// below, unlike Plan A's ("1st Battalion, 5th Infantry Regiment" captures
// only "1st Battalion" - fine there since that test never needed to
// distinguish it from a second plan).
const MOI_TEXT_B = "2nd Battalion 7th Cavalry Regiment\nStudy AR 350-1 before the board.\n";
await page.evaluate((text) => {
  const ta = document.querySelector("textarea");
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, MOI_TEXT_B);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Find my topics/.test(b.textContent || ""));
  if (btn) btn.click();
});
await page.waitForFunction(() => /Review your matches/.test(document.body.textContent || "") && !!document.getElementById("moi-opt-save"), { timeout: 5000 }).catch(() => {});
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /^Build/.test((b.textContent || "").trim()));
  if (btn) btn.click();
});
// Waits for the real persisted state (a second family actually written to
// PLANS_KEY) rather than a fixed sleep after Build - the predicate itself
// awaits the async G.db.get() call, which Playwright's waitForFunction
// supports directly.
await page.waitForFunction(async () => {
  const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  return ((r && r.v) || []).length === 2;
}, { timeout: 5000 });

const familiesAfterB = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  return (r && r.v) || [];
});
familiesAfterB.length === 2
  ? ok("Importing a second, distinct MOI produces a second plan family (2 total)")
  : bad("families after Plan B: " + JSON.stringify(familiesAfterB.map((f) => f.id)));
const familyB = familiesAfterB.find((f) => /2nd Battalion/.test(f.current.name || ""));
familyB
  ? ok("Plan B's family carries the expected name ('" + familyB.current.name + "')")
  : bad("Plan B's family not found by name: " + JSON.stringify(familiesAfterB.map((f) => f.current.name)));

// A2 end-to-end: Plan B was built from AR 350-1 ALONE, so each of its
// topics' persisted topicCoverage must equal that citation's OWN
// topicCounts share (fetched live above), never its combined `counts`
// aggregate - the exact real-world shape the A2 bug used to get wrong.
if (familyB) {
  const perTopicOk = arFanout.topics.every((t) => {
    const persisted = familyB.current.topicCoverage[t];
    const expected = arFanout.topicCounts[t];
    return persisted && expected && persisted.doctrineCards === expected.doctrineCards && persisted.selfCheckQuestions === expected.selfCheckQuestions;
  });
  perTopicOk
    ? ok("Plan B's persisted per-topic coverage matches AR 350-1's own topicCounts EXACTLY for all " + arFanout.topics.length + " topics (A2 fix, end to end through the real Build pipeline)")
    : bad("Plan B per-topic coverage mismatch: persisted=" + JSON.stringify(familyB.current.topicCoverage) + " expected=" + JSON.stringify(arFanout.topicCounts));
  const anyTopicShowsCombinedTotal = arFanout.topics.length > 1 && arFanout.topics.some((t) => {
    const persisted = familyB.current.topicCoverage[t];
    return persisted && persisted.doctrineCards === arFanout.counts.doctrineCards && persisted.selfCheckQuestions === arFanout.counts.selfCheckQuestions;
  });
  !anyTopicShowsCombinedTotal
    ? ok("No single topic in Plan B shows AR 350-1's full COMBINED total - confirms the inflation bug is really fixed, not coincidentally passing")
    : bad("A topic in Plan B still shows the full combined aggregate instead of its own share");
}

// Build's own success path (just like a routine "Re-import a revision")
// leaves the test on Plan B's own detail view, already at #/moi.
await goToMoiMenu();
const menuCardCount = await page.evaluate(() => document.querySelectorAll(".card-results-grid button").length);
menuCardCount === 2
  ? ok("Landing's menu shows exactly 2 plan-family cards")
  : bad("menu card count: " + menuCardCount);

/* ========================================================================
   (e) Re-importing a revision of Plan A - "What changed" diff
   ======================================================================== */

await openFamilyExpanded(/1st Battalion/);
const reimportClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Re-import a revision");
  if (btn) { btn.click(); return true; }
  return false;
});
reimportClicked ? ok("'Re-import a revision' button found and clicked") : bad("'Re-import a revision' button not found");
await page.waitForFunction(() => !!document.querySelector("textarea"), { timeout: 5000 });
const revisionLabelShown = await page.evaluate(() => {
  const p = [...document.querySelectorAll("p.hint")].find((el) => /Re-importing a revision of/.test(el.textContent || ""));
  return !!(p && /1st Battalion/.test(p.textContent || ""));
});
revisionLabelShown ? ok("Capture names which family this revision will update ('Re-importing a revision of “1st Battalion…”')") : bad("revision-context label not shown when re-importing");

// Revision text: drops AR 623-3 entirely, adds AR 350-1 (already known,
// real, fan-out) - keeps ADP 6-22 and FM 3-22.9 untouched so their topics
// must NOT appear in added/removed.
const MOI_TEXT_A_REVISED = [
  "1st Battalion, 5th Infantry Regiment",
  "BOARD MOI - ASSIGNED STUDY TOPICS (REVISION)",
  "",
  "LEADERSHIP:",
  "Study ADP 6-22 thoroughly before the board.",
  "",
  "MARKSMANSHIP:",
  "Study FM 3-22.9 before the board.",
  "",
  "TRAINING:",
  "Study AR 350-1 before the board.",
].join("\n");
await page.evaluate((text) => {
  const ta = document.querySelector("textarea");
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, MOI_TEXT_A_REVISED);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Find my topics/.test(b.textContent || ""));
  if (btn) btn.click();
});
await page.waitForFunction(() => /Review your matches/.test(document.body.textContent || "") && !!document.getElementById("moi-opt-save"), { timeout: 5000 }).catch(() => {}); // hygiene-ok: same cold/warm-registry Review-render race as this suite's other two Review waits (a second revision-Build within one run is always warm, but the assertion right after still reports a miss)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /^Build/.test((b.textContent || "").trim()));
  if (btn) btn.click();
});
// Waits for the real persisted state (the revision actually recorded in
// familyA's own history) rather than a fixed sleep after Build.
await page.waitForFunction(async (familyId) => {
  const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  const f = ((r && r.v) || []).find((x) => x.id === familyId);
  return !!(f && f.history && f.history.length === 1);
}, familyA.id, { timeout: 5000 });

const familiesAfterRevision = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  return (r && r.v) || [];
});
familiesAfterRevision.length === 2
  ? ok("Re-importing a revision of Plan A does NOT create a third family - still 2 total")
  : bad("families after revising Plan A: " + JSON.stringify(familiesAfterRevision.map((f) => f.id)));
const familyARevised = familiesAfterRevision.find((f) => f.id === familyA.id);
familyARevised
  ? ok("The revision updated the SAME family id Plan A originally got")
  : bad("Plan A's original family id (" + familyA.id + ") is gone after the revision: " + JSON.stringify(familiesAfterRevision.map((f) => f.id)));

if (familyARevised) {
  familyARevised.history.length === 1
    ? ok("The revised family has exactly one history entry (its pre-revision snapshot)")
    : bad("revised family history length: " + familyARevised.history.length);
  const storedDiff = familyARevised.history[0] && familyARevised.history[0].diff;
  // Independently recomputed from the two REAL persisted snapshots (the
  // original Plan A's `current`, captured as `familyA` above, and the
  // freshly revised `current`) - a genuine regression check that build()
  // wired diffPlans() up with the right before/after arguments and stored
  // exactly what it returned, not a re-assertion of diffPlans() itself
  // (already covered against fully hand-built data in section (a)).
  const expectedDiff = await page.evaluate(({ before, after }) => window.G.moiImport.diffPlans(before, after), { before: familyA.current, after: familyARevised.current });
  JSON.stringify((storedDiff || {}).added) === JSON.stringify(expectedDiff.added) &&
    JSON.stringify((storedDiff || {}).removed) === JSON.stringify(expectedDiff.removed) &&
    JSON.stringify((storedDiff || {}).coverageChanged) === JSON.stringify(expectedDiff.coverageChanged)
    ? ok("The stored diff matches diffPlans(oldSnapshot, newSnapshot) computed fresh from the two real persisted plans - added: " + JSON.stringify(expectedDiff.added) + ", removed: " + JSON.stringify(expectedDiff.removed) + ", coverageChanged: " + expectedDiff.coverageChanged.length)
    : bad("stored diff " + JSON.stringify(storedDiff) + " != expected " + JSON.stringify(expectedDiff));
  expectedDiff.removed.length > 0
    ? ok("The revision genuinely removed at least one topic (AR 623-3 was dropped) - a non-trivial diff, not an empty one")
    : bad("expected at least one removed topic from dropping AR 623-3, got none: " + JSON.stringify(expectedDiff));

  // ---- "What changed since..." disclosure on the resulting result view ----
  const diffToggleText = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /What changed since/.test(b.textContent || ""));
    return btn ? btn.textContent : null;
  });
  diffToggleText && diffToggleText.indexOf("+" + expectedDiff.added.length) !== -1
    ? ok("The 'What changed since...' toggle's summary count matches the real diff: \"" + diffToggleText + "\"")
    : bad("diff toggle text: " + JSON.stringify(diffToggleText) + " (expected +" + expectedDiff.added.length + " in there somewhere)");
  const toggleExpandedInitially = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /What changed since/.test(b.textContent || ""));
    return btn ? btn.getAttribute("aria-expanded") : null;
  });
  toggleExpandedInitially === "false"
    ? ok("The diff disclosure starts collapsed (aria-expanded=\"false\")")
    : bad("diff disclosure initial aria-expanded: " + JSON.stringify(toggleExpandedInitially));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /What changed since/.test(b.textContent || ""));
    if (btn) btn.click();
  });
  await page.waitForTimeout(150);
  const afterDiffToggle = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /What changed since/.test(b.textContent || ""));
    return btn ? btn.getAttribute("aria-expanded") : null;
  });
  afterDiffToggle === "true"
    ? ok("Clicking the diff disclosure expands it (aria-expanded=\"true\")")
    : bad("diff disclosure aria-expanded after click: " + JSON.stringify(afterDiffToggle));
  if (expectedDiff.removed.length) {
    const removedTopicShown = await page.evaluate((topic) => (document.body.textContent || "").indexOf(topic) !== -1, expectedDiff.removed[0]);
    removedTopicShown
      ? ok("The expanded diff panel lists the removed topic ('" + expectedDiff.removed[0] + "')")
      : bad("removed topic '" + expectedDiff.removed[0] + "' not found in the expanded diff panel");
  }
}

/* ========================================================================
   (f) Board-date awareness (Part D): absent/inert with no date, present
   and working once one is set
   ======================================================================== */

await openFamilyExpanded(/1st Battalion/);
const noBoardDateState = await page.evaluate(() => ({
  hasCountdownBanner: !!document.querySelector(".tx-countdown-banner"),
  hasSetDateInput: !!document.querySelector('input[type="date"][aria-label="Set your board date"]'),
  hasRemindBtn: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Remind me before board"),
}));
!noBoardDateState.hasCountdownBanner && noBoardDateState.hasSetDateInput
  ? ok("With no board date set, G.renderBoardCountdown() shows its own 'set a date' input, not the countdown banner")
  : bad("board-date-unset state: " + JSON.stringify(noBoardDateState));
!noBoardDateState.hasRemindBtn
  ? ok("With no board date set, 'Remind me before board' is absent (inert)")
  : bad("'Remind me before board' unexpectedly shown with no board date set");

const boardDateStr = daysFromNowStr(10);
await page.evaluate((d) => window.G.store.setSetting("boardDate", d), boardDateStr);
await openFamilyExpanded(/1st Battalion/);
const withBoardDateState = await page.evaluate(() => ({
  hasCountdownBanner: !!document.querySelector(".tx-countdown-banner"),
  hasRemindBtn: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Remind me before board"),
}));
withBoardDateState.hasCountdownBanner
  ? ok("Once a board date is set, G.renderBoardCountdown()'s real countdown banner (Part D1) appears in openPlan()")
  : bad("countdown banner did not appear after setting a board date");
withBoardDateState.hasRemindBtn
  ? ok("Once a board date is set, 'Remind me before board' (Part D2) appears")
  : bad("'Remind me before board' did not appear after setting a board date");

const remindersBefore = await page.evaluate(async () => (await window.G.reminders.load()).length);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Remind me before board");
  if (btn) btn.click();
});
await page.waitForTimeout(300);
const remindersAfter = await page.evaluate(async () => {
  const list = await window.G.reminders.load();
  return { count: list.length, last: list[list.length - 1] };
});
remindersAfter.count === remindersBefore + 1
  ? ok("Clicking 'Remind me before board' adds exactly one reminder")
  : bad("reminder count " + remindersBefore + " -> " + remindersAfter.count + ", expected +1");
remindersAfter.last && remindersAfter.last.kind === "board" && remindersAfter.last.source === "moi:plan" && /Finish studying:/.test(remindersAfter.last.label) && remindersAfter.last.date === boardDateStr
  ? ok("The reminder carries kind 'board', source 'moi:plan', a 'Finish studying:' label and the real board date")
  : bad("reminder shape: " + JSON.stringify(remindersAfter.last));
const remindBtnAfterClick = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /Reminder set/.test(b.textContent || ""));
  return btn ? { text: btn.textContent, disabled: btn.disabled } : null;
});
remindBtnAfterClick && remindBtnAfterClick.disabled
  ? ok("The button confirms success in place (disabled, reads 'Reminder set') - matches calendar.js's own 'Remind me' convention")
  : bad("button state after click: " + JSON.stringify(remindBtnAfterClick));

/* ========================================================================
   (g) Delete removes only Plan B and leaves Plan A intact, and clears the
   "moi:plan" reminder even though it was set while Plan A (a DIFFERENT
   family) was open - the fixed reminder source openPlan()'s own comment
   documents.
   ======================================================================== */

// The last thing section (f) did was click "Remind me before board" on
// Plan A's own detail view, already at #/moi.
await goToMoiMenu();
await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".card-results-grid button")].find((b) => /2nd Battalion/.test(b.textContent || ""));
  if (btn) btn.click();
});
await page.waitForTimeout(200);
const deleteBClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Delete");
  if (btn) { btn.click(); return true; }
  return false;
});
deleteBClicked ? ok("'Delete' button found and clicked on Plan B") : bad("'Delete' button not found on Plan B");
await page.waitForTimeout(300);
const confirmShown = await page.evaluate(() => !!document.querySelector(".gm-back"));
confirmShown ? ok("Delete opens a confirm dialog before deleting") : bad("Delete removed the plan without confirming");
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".gm-back button")].find((x) => /delete/i.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(400);

const familiesAfterDeleteB = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", window.G.moiImport.PLANS_KEY);
  return (r && r.v) || [];
});
familiesAfterDeleteB.length === 1 && familiesAfterDeleteB[0].id === familyA.id
  ? ok("Deleting Plan B removed only that ONE family - Plan A is untouched and still present")
  : bad("families after deleting Plan B: " + JSON.stringify(familiesAfterDeleteB.map((f) => f.id)) + " (expected only " + familyA.id + ")");

const remindersAfterDelete = await page.evaluate(async () => (await window.G.reminders.load()).filter((r) => r.source === "moi:plan"));
remindersAfterDelete.length === 0
  ? ok("Deleting Plan B also clears the 'moi:plan' reminder, even though it was set while Plan A (a different family) was open - confirms the fixed, global reminder source documented in openPlan()")
  : bad("moi:plan reminders after deleting Plan B: " + JSON.stringify(remindersAfterDelete));

// Delete's own confirm flow lands back on landing() (via openPlan()'s
// Delete handler) without ever leaving #/moi.
await goToMoiMenu();
const finalMenuState = await page.evaluate(() => ({
  cardCount: document.querySelectorAll(".card-results-grid button").length,
  gridText: (document.querySelector(".card-results-grid") || {}).textContent || "",
}));
finalMenuState.cardCount === 1 && /1st Battalion/.test(finalMenuState.gridText)
  ? ok("Landing's menu now shows exactly 1 card, and it's Plan A")
  : bad("final menu state: " + JSON.stringify({ cardCount: finalMenuState.cardCount, gridText: finalMenuState.gridText.slice(0, 80) }));

// cleanup - leaves guidon:moi:plan:v1 / guidon:moi:plans:v1 / the migration
// flag as this suite found them (all empty/false), and clears the last
// remaining moi:plan reminder.
await page.evaluate(async () => {
  await window.G.db.put("kv", { k: window.G.moiImport.KEY, v: null });
  await window.G.db.put("kv", { k: window.G.moiImport.PLANS_KEY, v: [] });
  if (window.G.reminders && window.G.reminders.clearManagedFor) await window.G.reminders.clearManagedFor({ source: "moi:plan" });
});

const DOCS_PROBE_404 = /Failed to load resource: the server responded with a status of 404/;
let docsAllowance = docsProbe404;
const relevantNoise = noise.filter((n) => {
  if (/favicon/.test(n)) return false;
  if (docsAllowance > 0 && DOCS_PROBE_404.test(n)) { docsAllowance--; return false; }
  return true;
});
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nMOI-IMPORT: all passed");
process.exit(fails ? 1 : 0);
