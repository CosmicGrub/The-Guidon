/**
 * PRT session builder (#/drills -> "PRT session builder") vs PT Planner's own
 * verified/pending PRT model - content-integrity regression.
 *
 * WHY THIS SUITE EXISTS: a roadmap-audit finding (2026-09-20) flagged that
 * #/drills' prtDrill() (src/index.html "drills.js") prints specific PRT
 * exercise names for the SSD/CD1/CD2/HSD/MMD1/MMD2/RD blocks under a plain
 * "ATP 7-22.02" citation, while app-modules/pt-planner.js's own
 * PRT_PENDING_DRILLS map calls those exact same drill IDs "explicit
 * placeholders, never fabricated doctrine" because they have no
 * window.GUIDON_SEED.prt.drills record with a verified, per-exercise
 * ATP 7-22.02 citation (unlike "pd", which does - see
 * tools/lint-prt-sources.mjs and tools/test-prt.mjs). Checking every
 * exercise name word for word against the actual bundled source
 * (docs-source/ATP_7-22.02_Holistic_Health_and_Fitness_Drills_and_Exercises.pdf,
 * not memory) found them substantially accurate but caught three real
 * misses - CD2's "Half jacks"/"8-count push-up" and MMD1/MMD2's plural
 * "Verticals"/"Laterals"/"Crossovers", each fixed to the source's singular
 * exercise names - so the fix here was not to delete the content, it was to
 * (1) correct what was actually wrong and (2) stop presenting what remains
 * unverified movement/starting-position text at the SAME confidence as PD.
 * prtDrill() now tags every block whose ID is not "pd" with the identical
 * "(content pending)" wording PT Planner already uses for the same drill IDs.
 *
 * If this suite were deleted, a future edit could silently re-desync the two
 * modules again - e.g. adding an eighth drill to PT_PENDING_DRILLS without
 * teaching prtDrill() about it, or marking a block "verified" here that PT
 * Planner still calls pending - and nothing else in the suite would catch it,
 * because PT Planner and #/drills are rendered by two different modules that
 * never call into each other.
 *
 *   (a) prtDrill()'s own exported data (G.drills._PRT / _PRT_UNVERIFIED_IDS)
 *       agrees with PT Planner's ACTUALLY RESOLVED pending state - not with
 *       app-modules/pt-planner.js's PRT_PENDING_DRILLS map, which is only a
 *       fallback LABEL table. prtDrillLabel() there resolves pending by
 *       checking whether window.GUIDON_SEED.prt.drills has a record for the
 *       ID at all; PRT_PENDING_DRILLS never gates that decision, so a block
 *       ID's presence there says nothing about whether the planner would
 *       actually call it pending once the seed grows (e.g. an "rd" record
 *       lands in seed.prt.drills without PRT_PENDING_DRILLS ever losing its
 *       "rd" key). This suite derives the expected set the same way
 *       prtDrillLabel() does - straight from seed.prt.drills' own IDs - so it
 *       keeps failing correctly if that ever happens instead of staying
 *       green while #/drills silently falls out of step.
 *   (b) The real screen: opening each session (Strength, Endurance) and
 *       reading the actual block labels shows "(content pending)" on every
 *       non-PD block and on NO block for Preparation Drill (PD).
 *   (c) The explanatory hint above the segmented control actually explains
 *       the distinction (mentions "verified" and "content pending").
 *   (d) Preparation Drill (PD)'s ten exercise names here still match, in
 *       fixed order, window.GUIDON_SEED.prt.drills' own verified "pd" record
 *       - ground truth read live from the seed, not a copy hard-coded in
 *       this suite, so it stays correct if the transcription is ever
 *       revised - proving the ONE block presented as fully sourced actually
 *       is.
 *   (e) The three real misses a source cross-check caught (CD2's "Half
 *       jack"/"8-count T push-up", MMD1's "Vertical"/"Lateral", MMD2's
 *       "Crossover") render as the source's real singular names, not the
 *       wrong plural/incomplete ones this screen previously showed.
 *
 * UPDATE (src/app-modules/12-prt-drills-expansion.js): CD1 and CD2 now
 * carry real, verified seed.prt.drills records too (the same bar "pd"
 * already cleared), so they graduate out of the "(content pending)" set
 * the same way "pd" already had - (a)/(b) below now assert that
 * explicitly for cd1/cd2 too, and (d) checks their shown items against
 * their own seed record's real exercise names/order, the same "ground
 * truth read live from the seed" discipline (d) already applied to PD.
 * The old CD2-specific hardcoded-string check in (e) is now folded into
 * that stronger, ground-truth (d) check instead of comparing against a
 * copy of BLOCK_ITEMS.cd2 that no longer exists (CD2's items now come
 * live from the seed, not that static table).
 */
import { bootApp, ok, bad, check, finish, waitForRoute, clickWhenStable, until, expectNoConsoleNoise } from "./testkit.mjs";

const boot = await bootApp({ viewport: { width: 390, height: 844 } });
const { page, noise } = boot;

/* ========================================================================
   (a) The two modules' pending/unverified sets agree, read from their own
   exported APIs - not re-derived or hard-coded here.
   ======================================================================== */
await waitForRoute(page, "#/drills", { ready: ".card-results-grid" });

const model = await page.evaluate(() => {
  const drills = window.G.drills || {};
  // The SAME check prtDrillLabel() (app-modules/pt-planner.js) makes: a
  // block's drill ID is only NOT pending when seed.prt.drills actually
  // carries a record for it. PRT_PENDING_DRILLS is a fallback label map for
  // whatever prtDrillLabel() decides is pending this way - never itself the
  // decision - so the expected set here is derived from the seed's real IDs,
  // not from that map.
  const seedDrillIds = ((window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.drills) || []).map((d) => d.id);
  return {
    hasPrtData: Array.isArray(drills._PRT_UNVERIFIED_IDS) && !!drills._PRT,
    unverifiedHere: (drills._PRT_UNVERIFIED_IDS || []).slice().sort(),
    seedDrillIds: seedDrillIds.slice().sort(),
    blockIdsStrength: ((drills._PRT && drills._PRT.strength && drills._PRT.strength.blocks) || []).map((b) => b.id),
    blockIdsEndurance: ((drills._PRT && drills._PRT.endurance && drills._PRT.endurance.blocks) || []).map((b) => b.id),
  };
});
const allBlockIds = Array.from(new Set([...model.blockIdsStrength, ...model.blockIdsEndurance])).sort();
// prtDrillLabel()'s real branch, replicated: pending iff the seed has no
// record for this ID - never mind what PRT_PENDING_DRILLS happens to list.
const resolvedPending = allBlockIds.filter((id) => !model.seedDrillIds.includes(id)).sort();
check(model.hasPrtData, "#/drills exports G.drills._PRT and _PRT_UNVERIFIED_IDS for cross-checking",
  () => "G.drills did not export the expected PRT test hooks: " + JSON.stringify(Object.keys(window)));
check(model.unverifiedHere.length > 0 && JSON.stringify(model.unverifiedHere) === JSON.stringify(resolvedPending),
  `#/drills' unverified drill IDs exactly match the planner's actually-resolved pending set - every block ID absent from seed.prt.drills (${JSON.stringify(model.unverifiedHere)})`,
  () => "mismatch: #/drills unverified=" + JSON.stringify(model.unverifiedHere) + " vs resolved-pending (block IDs absent from seed.prt.drills, seed IDs=" + JSON.stringify(model.seedDrillIds) + ")=" + JSON.stringify(resolvedPending));
check(model.blockIdsStrength.includes("pd") && model.blockIdsEndurance.includes("pd") && !model.unverifiedHere.includes("pd") && model.seedDrillIds.includes("pd"),
  "\"pd\" (a drill with a real seed.prt.drills record) is in both sessions, in the seed, and in neither module's pending/unverified set",
  () => "pd placement: strength=" + JSON.stringify(model.blockIdsStrength) + " endurance=" + JSON.stringify(model.blockIdsEndurance) + " unverified=" + JSON.stringify(model.unverifiedHere) + " seed=" + JSON.stringify(model.seedDrillIds));
// CD1/CD2 (src/app-modules/12-prt-drills-expansion.js) now clear the same
// bar "pd" already does: a real seed.prt.drills record, so they too must
// be absent from the unverified set, same check as pd's above.
["cd1", "cd2"].forEach((id) => {
  check(model.blockIdsStrength.includes(id) && !model.unverifiedHere.includes(id) && model.seedDrillIds.includes(id),
    `"${id}" (now a drill with a real seed.prt.drills record) is in the Strength session, in the seed, and not in the unverified set`,
    () => `${id} placement: strength=` + JSON.stringify(model.blockIdsStrength) + " unverified=" + JSON.stringify(model.unverifiedHere) + " seed=" + JSON.stringify(model.seedDrillIds));
});
const VERIFIED_IDS = ["pd", "cd1", "cd2"];
check(model.blockIdsStrength.filter((id) => !VERIFIED_IDS.includes(id)).every((id) => model.unverifiedHere.includes(id)) &&
  model.blockIdsEndurance.filter((id) => !VERIFIED_IDS.includes(id)).every((id) => model.unverifiedHere.includes(id)),
  "every still-unverified block (ssd/rd in Strength, hsd/mmd1/mmd2/rd in Endurance) carries a drill ID in the unverified set",
  () => "an unverified block's ID is missing from the unverified set: strength=" + JSON.stringify(model.blockIdsStrength) + " endurance=" + JSON.stringify(model.blockIdsEndurance) + " unverified=" + JSON.stringify(model.unverifiedHere));

/* ========================================================================
   (b) The real screen: block labels on both sessions, driven by real clicks.
   ======================================================================== */
await clickWhenStable(page, page.locator("button", { hasText: /PRT session builder/ }));
await until(page, () => !!document.querySelector(".ob-plan-label"));

async function blockLabels() {
  // Scoped to the PRT builder's own block list - the wider Leadership
  // Drills view also uses .ob-plan-label for its bibliography's category
  // headers ("Promotion", "Drill, fitness and standards", ...), which a bare
  // document-wide query would pick up too.
  return page.evaluate(() => Array.from(document.querySelectorAll("[data-prt-drill-blocks] .ob-plan-label")).map((n) => n.textContent));
}
async function selectSession(labelSubstring) {
  await clickWhenStable(page, page.locator(".segmented button", { hasText: labelSubstring }));
  await until(page, () => !!document.querySelector(".ob-plan-label"));
}
// The exercise <ul> immediately following a block's .ob-plan-label - same
// scoping as blockLabels(), plus pairing each label with its own list.
async function blockItems(labelSubstring) {
  return page.evaluate((sub) => {
    const labels = Array.from(document.querySelectorAll("[data-prt-drill-blocks] .ob-plan-label"));
    const label = labels.find((n) => n.textContent.includes(sub));
    const ul = label && label.nextElementSibling;
    return ul ? Array.from(ul.querySelectorAll("li")).map((li) => li.textContent) : null;
  }, labelSubstring);
}

const strengthLabels = await blockLabels();
const pdLabel = strengthLabels.find((t) => /Preparation Drill \(PD\)/.test(t));
check(!!pdLabel && !/content pending/.test(pdLabel), `Strength session's Preparation Drill (PD) block is not tagged pending: "${pdLabel}"`,
  () => "PD block label: " + JSON.stringify(pdLabel) + " in " + JSON.stringify(strengthLabels));
// CD1/CD2 now carry a real seed.prt.drills record too (src/app-modules/
// 12-prt-drills-expansion.js) - same "not tagged pending" bar as PD's own
// check above, applied to both of Strength's newly-verified blocks.
["Conditioning Drill 1", "Conditioning Drill 2"].forEach((name) => {
  const label = strengthLabels.find((t) => t.startsWith(name));
  check(!!label && !/content pending/.test(label), `Strength session's ${name} block is not tagged pending: "${label}"`,
    () => name + " block label: " + JSON.stringify(label) + " in " + JSON.stringify(strengthLabels));
});
// Still-unverified Strength blocks (SSD, RD) keep the tag.
const strengthStillPending = strengthLabels.filter((t) => !/Preparation Drill \(PD\)/.test(t) && !/Conditioning Drill (1|2)/.test(t));
check(strengthStillPending.length > 0 && strengthStillPending.every((t) => /\(content pending\)$/.test(t)),
  `Strength session's remaining blocks (SSD, RD) are all still tagged "(content pending)": ${JSON.stringify(strengthStillPending)}`,
  () => "strength blocks missing the pending tag: " + JSON.stringify(strengthStillPending));

await selectSession("Endurance");
const enduranceLabels = await blockLabels();
const pdLabel2 = enduranceLabels.find((t) => /Preparation Drill \(PD\)/.test(t));
check(!!pdLabel2 && !/content pending/.test(pdLabel2), `Endurance session's Preparation Drill (PD) block is not tagged pending: "${pdLabel2}"`,
  () => "PD block label: " + JSON.stringify(pdLabel2) + " in " + JSON.stringify(enduranceLabels));
const enduranceOthers = enduranceLabels.filter((t) => !/Preparation Drill \(PD\)/.test(t));
check(enduranceOthers.length > 0 && enduranceOthers.every((t) => /\(content pending\)$/.test(t)),
  `Endurance session's other blocks (HSD, MMD1, MMD2, RD - none of which shipped a seed.prt.drills record in this pass) are all tagged "(content pending)": ${JSON.stringify(enduranceOthers)}`,
  () => "endurance blocks missing the pending tag: " + JSON.stringify(enduranceOthers));

/* ========================================================================
   (c) The explanatory hint is actually on screen and says why.
   ======================================================================== */
const panelText = await page.evaluate(() => (document.querySelector(".panel") || {}).textContent || "");
check(/verified word-for-word/i.test(panelText) && /content pending/i.test(panelText) && /ATP 7-22\.02/.test(panelText),
  "the panel explains the verified/pending distinction in plain words",
  () => "panel text did not explain the distinction: " + panelText.slice(0, 400));

/* ========================================================================
   (d) PD/CD1/CD2's exercise names here still match each one's own seed
   record, ground truth read live so this stays correct if the
   transcription ever changes - the same check, generalized from PD alone
   (its original shape) to every block id with a real seed.prt.drills
   record after src/app-modules/12-prt-drills-expansion.js.
   ======================================================================== */
await selectSession("Strength");
async function checkAgainstSeed(sessionKey, drillId, label) {
  const result = await page.evaluate(({ sessionKey, drillId }) => {
    const shown = ((window.G.drills._PRT[sessionKey] && window.G.drills._PRT[sessionKey].blocks.find((b) => b.id === drillId)) || {}).items || [];
    const seedDrill = ((window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.drills) || []).find((d) => d.id === drillId);
    const seedNames = seedDrill ? seedDrill.exercises.slice().sort((a, b) => a.order - b.order).map((e) => e.name) : null;
    return { shown, seedNames, allVerified: seedDrill ? seedDrill.exercises.every((e) => e.sourceStatus === "verified") : false };
  }, { sessionKey, drillId });
  check(Array.isArray(result.seedNames) && result.seedNames.length > 0 && result.allVerified,
    `the seed's "${drillId}" drill has ${result.seedNames && result.seedNames.length} exercises, all sourceStatus:"verified"`,
    () => `seed ${drillId} drill missing/unverified: ` + JSON.stringify(result));
  check(result.shown.length === (result.seedNames || []).length &&
    result.shown.every((name, i) => name.toLowerCase() === (result.seedNames[i] || "").toLowerCase()),
    `the ${label} block shown here matches the seed's verified exercise names, in the same fixed order (case aside)`,
    () => `${label} names here: ` + JSON.stringify(result.shown) + " vs seed's verified names: " + JSON.stringify(result.seedNames));
}
await checkAgainstSeed("strength", "pd", "PD");
await checkAgainstSeed("strength", "cd1", "CD1");
await checkAgainstSeed("strength", "cd2", "CD2");

/* ========================================================================
   (e) Two real misses a source cross-check caught (MMD1/MMD2's plural
   exercise names, still static BLOCK_ITEMS today) render as the source's
   real singular names, not the wrong plural ones this screen used to show.
   CD2's own equivalent check (its old "Half jacks"/"8-count push-up" fix)
   is superseded by (d) above, which now reads CD2's items live from its own
   seed.prt.drills record instead of comparing against the static
   BLOCK_ITEMS.cd2 table that no longer exists.
   ======================================================================== */
await selectSession("Endurance");
const mmd1Items = await blockItems("Military Movement Drill 1");
check(Array.isArray(mmd1Items) && mmd1Items.includes("Vertical") && mmd1Items.includes("Lateral") &&
  !mmd1Items.includes("Verticals") && !mmd1Items.includes("Laterals"),
  `MMD1 shows the source's singular exercise names ("Vertical", "Lateral"): ${JSON.stringify(mmd1Items)}`,
  () => "MMD1 items: " + JSON.stringify(mmd1Items));
const mmd2Items = await blockItems("Military Movement Drill 2");
check(Array.isArray(mmd2Items) && mmd2Items.includes("Crossover") && !mmd2Items.includes("Crossovers"),
  `MMD2 shows the source's singular exercise name ("Crossover"): ${JSON.stringify(mmd2Items)}`,
  () => "MMD2 items: " + JSON.stringify(mmd2Items));

expectNoConsoleNoise(noise);
await finish("DRILLS PRT SOURCING");
