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
 * tools/lint-prt-sources.mjs and tools/test-prt.mjs). Cross-referencing those
 * exercise names against ATP 7-22.02 found them accurate (a character-for-
 * character match against "pd"'s own already-verified seed entry corroborates
 * the same source/author for the rest), so the fix was not to delete them -
 * it was to stop presenting them at the SAME confidence as PD. prtDrill() now
 * tags every block whose ID is not "pd" with the identical "(content
 * pending)" wording PT Planner already uses for the same drill IDs.
 *
 * If this suite were deleted, a future edit could silently re-desync the two
 * modules again - e.g. adding an eighth drill to PT_PENDING_DRILLS without
 * teaching prtDrill() about it, or marking a block "verified" here that PT
 * Planner still calls pending - and nothing else in the suite would catch it,
 * because PT Planner and #/drills are rendered by two different modules that
 * never call into each other.
 *
 *   (a) prtDrill()'s own exported data (G.drills._PRT / _PRT_UNVERIFIED_IDS)
 *       agrees with PT Planner's (G.ptPlanner.PENDING_DRILLS): the drill IDs
 *       marked unverified here are EXACTLY the ones PT Planner calls pending,
 *       and "pd" (the one drill with a real seed.prt.drills record) is in
 *       neither pending set.
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
  const planner = window.G.ptPlanner || {};
  return {
    hasPrtData: Array.isArray(drills._PRT_UNVERIFIED_IDS) && !!drills._PRT,
    unverifiedHere: (drills._PRT_UNVERIFIED_IDS || []).slice().sort(),
    pendingInPlanner: Object.keys(planner.PENDING_DRILLS || {}).sort(),
    blockIdsStrength: ((drills._PRT && drills._PRT.strength && drills._PRT.strength.blocks) || []).map((b) => b.id),
    blockIdsEndurance: ((drills._PRT && drills._PRT.endurance && drills._PRT.endurance.blocks) || []).map((b) => b.id),
  };
});
check(model.hasPrtData, "#/drills exports G.drills._PRT and _PRT_UNVERIFIED_IDS for cross-checking",
  () => "G.drills did not export the expected PRT test hooks: " + JSON.stringify(Object.keys(window)));
check(model.unverifiedHere.length > 0 && JSON.stringify(model.unverifiedHere) === JSON.stringify(model.pendingInPlanner),
  `#/drills' unverified drill IDs exactly match PT Planner's PENDING_DRILLS keys (${JSON.stringify(model.unverifiedHere)})`,
  () => "mismatch: #/drills unverified=" + JSON.stringify(model.unverifiedHere) + " vs PT Planner pending=" + JSON.stringify(model.pendingInPlanner));
check(model.blockIdsStrength.includes("pd") && model.blockIdsEndurance.includes("pd") && !model.unverifiedHere.includes("pd"),
  "\"pd\" (the one drill with a real seed.prt.drills record) is in both sessions and in neither module's pending/unverified set",
  () => "pd placement: strength=" + JSON.stringify(model.blockIdsStrength) + " endurance=" + JSON.stringify(model.blockIdsEndurance) + " unverified=" + JSON.stringify(model.unverifiedHere));
check(model.blockIdsStrength.filter((id) => id !== "pd").every((id) => model.unverifiedHere.includes(id)) &&
  model.blockIdsEndurance.filter((id) => id !== "pd").every((id) => model.unverifiedHere.includes(id)),
  "every non-PD block in both sessions carries a drill ID in the unverified set",
  () => "a non-PD block's ID is missing from the unverified set: strength=" + JSON.stringify(model.blockIdsStrength) + " endurance=" + JSON.stringify(model.blockIdsEndurance) + " unverified=" + JSON.stringify(model.unverifiedHere));

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

const strengthLabels = await blockLabels();
const pdLabel = strengthLabels.find((t) => /Preparation Drill \(PD\)/.test(t));
check(!!pdLabel && !/content pending/.test(pdLabel), `Strength session's Preparation Drill (PD) block is not tagged pending: "${pdLabel}"`,
  () => "PD block label: " + JSON.stringify(pdLabel) + " in " + JSON.stringify(strengthLabels));
const strengthOthers = strengthLabels.filter((t) => !/Preparation Drill \(PD\)/.test(t));
check(strengthOthers.length > 0 && strengthOthers.every((t) => /\(content pending\)$/.test(t)),
  `Strength session's other blocks are all tagged "(content pending)": ${JSON.stringify(strengthOthers)}`,
  () => "strength blocks missing the pending tag: " + JSON.stringify(strengthOthers));

await selectSession("Endurance");
const enduranceLabels = await blockLabels();
const pdLabel2 = enduranceLabels.find((t) => /Preparation Drill \(PD\)/.test(t));
check(!!pdLabel2 && !/content pending/.test(pdLabel2), `Endurance session's Preparation Drill (PD) block is not tagged pending: "${pdLabel2}"`,
  () => "PD block label: " + JSON.stringify(pdLabel2) + " in " + JSON.stringify(enduranceLabels));
const enduranceOthers = enduranceLabels.filter((t) => !/Preparation Drill \(PD\)/.test(t));
check(enduranceOthers.length > 0 && enduranceOthers.every((t) => /\(content pending\)$/.test(t)),
  `Endurance session's other blocks are all tagged "(content pending)": ${JSON.stringify(enduranceOthers)}`,
  () => "endurance blocks missing the pending tag: " + JSON.stringify(enduranceOthers));

/* ========================================================================
   (c) The explanatory hint is actually on screen and says why.
   ======================================================================== */
const panelText = await page.evaluate(() => (document.querySelector(".panel") || {}).textContent || "");
check(/verified word-for-word/i.test(panelText) && /content pending/i.test(panelText) && /ATP 7-22\.02/.test(panelText),
  "the panel explains the verified/pending distinction in plain words",
  () => "panel text did not explain the distinction: " + panelText.slice(0, 400));

/* ========================================================================
   (d) PD's exercise names here still match the seed's own verified record,
   ground truth read live so this stays correct if the transcription changes.
   ======================================================================== */
await selectSession("Strength");
const pdCheck = await page.evaluate(() => {
  const shown = ((window.G.drills._PRT.strength.blocks.find((b) => b.id === "pd") || {}).items || []);
  const seedDrill = ((window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.drills) || []).find((d) => d.id === "pd");
  const seedNames = seedDrill ? seedDrill.exercises.slice().sort((a, b) => a.order - b.order).map((e) => e.name) : null;
  return { shown, seedNames, allVerified: seedDrill ? seedDrill.exercises.every((e) => e.sourceStatus === "verified") : false };
});
check(Array.isArray(pdCheck.seedNames) && pdCheck.seedNames.length > 0 && pdCheck.allVerified,
  `the seed's "pd" drill has ${pdCheck.seedNames && pdCheck.seedNames.length} exercises, all sourceStatus:"verified"`,
  () => "seed pd drill missing/unverified: " + JSON.stringify(pdCheck));
check(pdCheck.shown.length === (pdCheck.seedNames || []).length &&
  pdCheck.shown.every((name, i) => name.toLowerCase() === (pdCheck.seedNames[i] || "").toLowerCase()),
  "the PD block shown here matches the seed's verified exercise names, in the same fixed order (case aside)",
  () => "PD names here: " + JSON.stringify(pdCheck.shown) + " vs seed's verified names: " + JSON.stringify(pdCheck.seedNames));

expectNoConsoleNoise(noise);
await finish("DRILLS PRT SOURCING");
