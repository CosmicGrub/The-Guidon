/**
 * Baseline interaction coverage for 11 routes that previously had ZERO
 * interaction coverage: #/counsel, #/blc, #/alc, #/slc, #/drills, #/channels,
 * #/fitness, #/assignments, #/transition, #/risk, #/share.
 *
 * The full-sweep suites (test-a11y-tree.mjs, test-contrast-full.mjs,
 * test-responsive.mjs, test-discoverability.mjs) already prove every route
 * renders with a clean console across every viewport/theme. That is
 * necessary but says nothing about whether the actual feature inside each
 * route works: a checkbox that doesn't persist, a select that doesn't drive
 * a computed result, a button that doesn't navigate. This file exists to
 * click/fill/select something REAL on each of the 11 routes and assert a
 * REAL resulting state change - a DOM value, a computed output, or (where
 * the module persists at all) the actual IndexedDB row via G.db, the same
 * way test-idp.mjs/test-records.mjs/test-reminders.mjs do for their routes.
 *
 * Every assertion below was written AFTER reading the real module source in
 * src/index.html (or src/app-modules/*.js) for that route - selectors,
 * labels, storage keys and computed logic are all taken from the real code,
 * not guessed. See the comment above each block for the exact source lines
 * that justify the assertion.
 *
 * One real finding surfaced while reading the source, and has since been
 * fixed: #/drills loads a kv row ("guidon:drills:v1") at the top of render()
 * using the exact same "load into `saved`, key checkbox state off saved['c'+
 * i]" pattern BLC/ALC/SLC use, but drills.js used to never read `saved`
 * again anywhere, and neither of its checklists (Conduct Individual
 * Training, the 1009S brief rubric) wrote back to it - unlike its BLC/ALC/
 * SLC siblings, which persist for real, Drills' checklist state was purely
 * in-memory and reset on every re-render. drills.js now wires both
 * checklists into the same read-modify-write pattern (saved["cit"+n] /
 * saved["brf"+n], then G.db.put("kv", {k: KEY, v: saved}) on each change),
 * so the block below asserts real persistence across a route re-render, the
 * same way selfCheckTest() does for BLC/ALC/SLC.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const context = await browser.newContext();
// Needed for the #/share "Copy link" round trip near the end of this file.
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
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

async function goto(hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(500);
}

/* ------------------------------------------------------------------------
 * Shared helper for BLC/ALC/SLC's "Readiness self-check" checklist.
 * Confirmed by source (src/index.html) that all three modules are built
 * from the SAME pattern: a SELF_CHECK array of strings, a single kv row
 * (KEY) holding {"c0": true, "c1": true, ...}, a checkbox per item whose
 * change handler does `saved["c"+i] = box.checked` then `G.db.put("kv",
 * {k: KEY, v: saved})`, and one `.stat .v` progress readout ("N / total").
 * This is a DIFFERENT component from Records Readiness (#/records, its own
 * VALID_IDS-guarded checklist already covered by test-records.mjs) - same
 * shape, separate implementation, separate storage key per module.
 * ------------------------------------------------------------------------ */
async function selfCheckTest(hash, headingText, kvKey, total) {
  console.log(`\n-- ${hash}: Readiness self-check (kv "${kvKey}") --`);
  await page.evaluate((k) => window.G.db.put("kv", { k, v: {} }), kvKey);
  await goto(hash);

  const heading = await page.evaluate((h) => (document.querySelector("h2") || {}).textContent === h, headingText);
  heading ? ok(`${hash} view renders ("${headingText}")`) : bad(`${hash} h2 text mismatch, expected "${headingText}"`);

  const initial = await page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
  initial === `0 / ${total}` ? ok(`self-check starts at '0 / ${total}'`) : bad(`initial self-check progress: "${initial}"`);

  const firstBox = page.locator('input[type="checkbox"]').first();
  await firstBox.check();
  await page.waitForTimeout(200);

  const afterOne = await page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
  afterOne === `1 / ${total}` ? ok(`checking the first item updates progress to '1 / ${total}'`) : bad(`progress after one check: "${afterOne}"`);

  const persisted = await page.evaluate(async (k) => {
    const r = await window.G.db.get("kv", k);
    return !!(r && r.v && r.v.c0 === true);
  }, kvKey);
  persisted ? ok(`the check persists to kv "${kvKey}" (c0: true)`) : bad(`self-check item did NOT persist to kv "${kvKey}"`);

  // Survives a fresh re-render (not just retained in the live DOM node).
  await goto("#/home");
  await goto(hash);
  const survived = await page.locator('input[type="checkbox"]').first().isChecked();
  survived ? ok("checked state survives a full re-render of the view") : bad("checkbox did not survive re-render");
  const progressAfterRerender = await page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
  progressAfterRerender === `1 / ${total}` ? ok("progress count is correct after re-render") : bad(`progress after re-render: "${progressAfterRerender}"`);

  // cleanup so this route's state doesn't bleed into anything else
  await page.evaluate((k) => window.G.db.put("kv", { k, v: {} }), kvKey);
}

/* ========================================================================
 * #/counsel (G.counsel, src/index.html ~11384-11650)
 * Four tabs: Skills library (default) | Role-play drills | Examples |
 * Plan of action. The POA builder (renderPOA, ~11487-11517) is the one
 * piece of this route with real state: each field's `input` event sets
 * poa[f.id] and calls persistPOA(), which does
 * `G.db.setSetting("counsel:poa", poa)` (~11517) - a single kv row keyed
 * "counsel:poa" holding the whole POA object. The first field is
 * poaFields[0] = {id:"soldier_name", type:"text"} (confirmed from the
 * embedded GUIDON_SEED.counsel.poaFields), so `.counsel-poa input[type=text]`
 * .first() reliably targets it. Tests: switching to the POA tab, filling
 * that field, confirming the exact persisted value, then Clear wiping it
 * back out (both on screen and in storage).
 * ======================================================================== */
console.log("\n-- #/counsel: Plan of action tab - fill/persist/clear round trip --");
await page.evaluate(() => window.G.db.setSetting("counsel:poa", {}));
await goto("#/counsel");
const counselHeading = await page.evaluate(() => /Counseling Trainer/.test((document.querySelector("h2") || {}).textContent || ""));
counselHeading ? ok("#/counsel view renders") : bad("#/counsel heading not found");

await page.locator("button", { hasText: /^Plan of action$/ }).click();
await page.waitForTimeout(300);
const poaTabActive = await page.evaluate(() =>
  [...document.querySelectorAll('button[role="tab"]')].some((b) => /^Plan of action$/.test(b.textContent || "") && b.getAttribute("aria-selected") === "true"));
poaTabActive ? ok("clicking 'Plan of action' activates that tab (aria-selected)") : bad("Plan of action tab did not become active");

const soldierNameInput = page.locator(".counsel-poa input[type=text]").first();
await soldierNameInput.fill("Carter, T. J. / SPC / 11B");
await page.waitForTimeout(500);

const poaPersisted = await page.evaluate(async () => {
  const v = await window.G.db.getSetting("counsel:poa", null);
  return v && v.soldier_name;
});
poaPersisted === "Carter, T. J. / SPC / 11B"
  ? ok("typing in the POA soldier_name field persists it to kv \"counsel:poa\"")
  : bad("counsel:poa.soldier_name after typing: " + JSON.stringify(poaPersisted));

// Clear wipes every field, both on screen and in the persisted object.
await page.locator("button", { hasText: /^Clear$/ }).click();
await page.waitForTimeout(500);
const clearedOnScreen = await page.locator(".counsel-poa input[type=text]").first().inputValue();
clearedOnScreen === "" ? ok("Clear empties the field on screen") : bad("field value after Clear: " + JSON.stringify(clearedOnScreen));
const clearedPersisted = await page.evaluate(async () => {
  const v = await window.G.db.getSetting("counsel:poa", null);
  return v && v.soldier_name;
});
clearedPersisted === "" ? ok("Clear persists the emptied value to kv \"counsel:poa\"") : bad("counsel:poa.soldier_name after Clear: " + JSON.stringify(clearedPersisted));

/* ========================================================================
 * #/blc, #/alc, #/slc (G.blc/G.alc/G.slc)
 * See selfCheckTest's doc comment above for the shared pattern. Real KEY
 * and SELF_CHECK.length confirmed from source:
 *   BLC: KEY "guidon:blc:checks:v1", SELF_CHECK.length === 12 (~14640-14655)
 *   ALC: KEY "guidon:alc:checks:v1", SELF_CHECK.length === 12 (~14853-14868)
 *   SLC: KEY "guidon:slc:checks:v1", SELF_CHECK.length === 10 (~15064-15077)
 * SLC's actual <h2> text is "SLC & Senior NCO Path" - the nav label
 * ("SLC & Beyond") is different text, confirmed by reading the render().
 * ======================================================================== */
await selfCheckTest("#/blc", "BLC Prep", "guidon:blc:checks:v1", 12);
await selfCheckTest("#/alc", "ALC Prep", "guidon:alc:checks:v1", 12);
await selfCheckTest("#/slc", "SLC & Senior NCO Path", "guidon:slc:checks:v1", 10);

/* ========================================================================
 * #/drills (G.drills, src/index.html ~15169-15600)
 * Two persisted checklists now share the kv row "guidon:drills:v1", the
 * same read-modify-write pattern selfCheckTest() exercises above for
 * BLC/ALC/SLC: Conduct Individual Training (citDrill(), 25 steps, keyed
 * saved["cit"+n], tally "N / 25", ~15492-15511) and the 1009S brief rubric
 * (briefDrill(), 17 items with point values from BRIEF_RUBRIC - the first
 * two are both 5 points - keyed saved["brf"+n], tally "N / 100",
 * ~15423-15440). Each checkbox's change handler updates `saved`, awaits
 * G.db.put("kv", {k: KEY, v: saved}), then updates the live tally.
 * ======================================================================== */
const DRILLS_KEY = "guidon:drills:v1";
console.log(`\n-- #/drills: Conduct Individual Training checklist (kv "${DRILLS_KEY}") --`);
await page.evaluate((k) => window.G.db.put("kv", { k, v: {} }), DRILLS_KEY);
await goto("#/drills");
const drillsHeading = await page.evaluate(() => (document.querySelector("h2") || {}).textContent === "NCOPDS Drills");
drillsHeading ? ok("#/drills view renders") : bad("#/drills h2 mismatch");

await page.locator("button", { hasText: /Conduct Individual Training/ }).click();
await page.waitForTimeout(300);
const citInitial = await page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
citInitial === "0 / 25" ? ok("CIT checklist starts at '0 / 25'") : bad("CIT initial tally: " + JSON.stringify(citInitial));

await page.locator('input[type="checkbox"]').nth(0).check();
await page.locator('input[type="checkbox"]').nth(1).check();
await page.waitForTimeout(200);
const citAfterTwo = await page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
citAfterTwo === "2 / 25" ? ok("checking two steps updates the tally to '2 / 25'") : bad("CIT tally after 2 checks: " + JSON.stringify(citAfterTwo));

await page.locator('input[type="checkbox"]').nth(0).uncheck();
await page.waitForTimeout(200);
const citAfterUncheck = await page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
citAfterUncheck === "1 / 25" ? ok("unchecking one step decrements the tally to '1 / 25'") : bad("CIT tally after uncheck: " + JSON.stringify(citAfterUncheck));

const citPersisted = await page.evaluate(async (k) => {
  const r = await window.G.db.get("kv", k);
  return !!(r && r.v && r.v.cit0 === false && r.v.cit1 === true);
}, DRILLS_KEY);
citPersisted
  ? ok(`CIT checkbox state persists to kv "${DRILLS_KEY}" (cit0: false, cit1: true)`)
  : bad(`CIT checklist did NOT persist to kv "${DRILLS_KEY}"`);

// Survives a fresh re-render (not just retained in the live DOM node): leave
// the route entirely, come back, and reopen the same drill.
await goto("#/home");
await goto("#/drills");
await page.locator("button", { hasText: /Conduct Individual Training/ }).click();
await page.waitForTimeout(300);
const citAfterRerender = await page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
citAfterRerender === "1 / 25"
  ? ok("CIT tally survives leaving and re-entering the route ('1 / 25')")
  : bad("CIT tally after re-render: " + JSON.stringify(citAfterRerender));
const citBoxesAfterRerender = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
  return [!!(boxes[0] && boxes[0].checked), !!(boxes[1] && boxes[1].checked)];
});
citBoxesAfterRerender[0] === false && citBoxesAfterRerender[1] === true
  ? ok("CIT checkbox checked-state survives re-render (step 1 unchecked, step 2 checked)")
  : bad("CIT checkbox states after re-render: " + JSON.stringify(citBoxesAfterRerender));

console.log(`\n-- #/drills: 1009S brief rubric checklist (kv "${DRILLS_KEY}") --`);
await page.locator("button", { hasText: /All drills/ }).click();
await page.waitForTimeout(200);
await page.locator("button", { hasText: /Information brief rehearsal/ }).click();
await page.waitForTimeout(300);
const brfInitial = await page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
brfInitial === "0 / 100" ? ok("Brief rubric starts at '0 / 100'") : bad("Brief rubric initial tally: " + JSON.stringify(brfInitial));

await page.locator('input[type="checkbox"]').nth(0).check();
await page.waitForTimeout(200);
const brfAfterOne = await page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
brfAfterOne === "5 / 100" ? ok("checking the first rubric item (5 points) updates the tally to '5 / 100'") : bad("Brief rubric tally after one check: " + JSON.stringify(brfAfterOne));

const brfPersisted = await page.evaluate(async (k) => {
  const r = await window.G.db.get("kv", k);
  return !!(r && r.v && r.v.brf0 === true);
}, DRILLS_KEY);
brfPersisted
  ? ok(`brief rubric checkbox persists to kv "${DRILLS_KEY}" (brf0: true)`)
  : bad(`brief rubric item did NOT persist to kv "${DRILLS_KEY}"`);

await goto("#/home");
await goto("#/drills");
await page.locator("button", { hasText: /Information brief rehearsal/ }).click();
await page.waitForTimeout(300);
const brfAfterRerender = await page.evaluate(() => (document.querySelector(".stat .v") || {}).textContent || "");
brfAfterRerender === "5 / 100"
  ? ok("Brief rubric tally survives leaving and re-entering the route ('5 / 100')")
  : bad("Brief rubric tally after re-render: " + JSON.stringify(brfAfterRerender));
const brfBoxChecked = await page.locator('input[type="checkbox"]').first().isChecked();
brfBoxChecked ? ok("brief rubric checkbox checked-state survives re-render") : bad("brief rubric checkbox did not survive re-render");

// cleanup so this route's state doesn't bleed into anything else
await page.evaluate((k) => window.G.db.put("kv", { k, v: {} }), DRILLS_KEY);

/* ========================================================================
 * #/channels (G.channels, src/index.html ~15602-15757)
 * Pure reference content; its only real interactivity is the "Related"
 * button row (~15716-15724), each of which does `location.hash = h` on
 * click. "MOS Career Center" -> "#/career" is chosen because #/career is
 * not one of the 11 routes under test elsewhere in this file, so this
 * assertion can't collide with another block's state.
 * ======================================================================== */
console.log("\n-- #/channels: Related nav button performs a real route change --");
await goto("#/channels");
const channelsHeading = await page.evaluate(() => (document.querySelector("h2") || {}).textContent === "Channels");
channelsHeading ? ok("#/channels view renders") : bad("#/channels h2 mismatch");

await page.locator("button", { hasText: /^MOS Career Center$/ }).click();
await page.waitForTimeout(400);
const wentToCareer = await page.evaluate(() => location.hash === "#/career" && (document.querySelector("h2") || {}).textContent === "MOS Career Center");
wentToCareer ? ok("clicking 'MOS Career Center' on #/channels navigates to #/career and renders it") : bad("navigation from #/channels' related button failed");

/* ========================================================================
 * #/fitness (G.fitness, src/app-modules/fitness.js)
 * Pure reference content; the one interactive element is the "Calculate it
 * in the PPW" button (~line 79-81 of fitness.js) which does
 * `location.hash = "#/board"`. Confirms the button performs a real
 * cross-module navigation, not just a no-op.
 * ======================================================================== */
console.log("\n-- #/fitness: 'Calculate it in the PPW' button navigates to #/board --");
await goto("#/fitness");
const fitnessHeading = await page.evaluate(() => (document.querySelector("h2") || {}).textContent === "Fitness Tests of Record");
fitnessHeading ? ok("#/fitness view renders") : bad("#/fitness h2 mismatch");

await page.locator("button", { hasText: /^Calculate it in the PPW$/ }).click();
await page.waitForTimeout(400);
const wentToBoard = await page.evaluate(() => location.hash === "#/board" && (document.querySelector("h2") || {}).textContent === "Board Prep");
wentToBoard ? ok("clicking 'Calculate it in the PPW' navigates to #/board and renders 'Board Prep'") : bad("navigation from #/fitness's PPW button failed");

/* ========================================================================
 * #/assignments (G.assignments, src/app-modules/assignments.js)
 * Pure reference content; the "Related" button row (~lines 72-80) does
 * `location.hash = pair[1]` on click. "Records Readiness" -> "#/records" is
 * used since #/records has its own real checklist (covered by
 * test-records.mjs) whose heading text this can independently confirm.
 * ======================================================================== */
console.log("\n-- #/assignments: Related nav button navigates to #/records --");
await goto("#/assignments");
const assignHeading = await page.evaluate(() => (document.querySelector("h2") || {}).textContent === "Assignments & Marketplace");
assignHeading ? ok("#/assignments view renders") : bad("#/assignments h2 mismatch");

await page.locator("button", { hasText: /^Records Readiness$/ }).click();
await page.waitForTimeout(400);
const wentToRecords = await page.evaluate(() => location.hash === "#/records" && /Records Readiness/.test(document.body.textContent || ""));
wentToRecords ? ok("clicking 'Records Readiness' on #/assignments navigates to #/records and renders it") : bad("navigation from #/assignments' related button failed");

/* ========================================================================
 * #/transition (G.transition, src/index.html ~18598-19084)
 * Real computed value: renderTimeline() (~18684-18737) reads
 * G.store.settings().etsDate and, if set, computes
 * `daysOut = Math.round((ets - today) / 86400000)` and a text "zone" purely
 * from that number (>180 planning / >90 BDD / >60 hard-deadline / >0 final
 * sprint / else post-ETS). This sets etsDate 45 days out via
 * G.store.setSetting (the store-level setter renderTimeline actually reads
 * - NOT G.db.setSetting, which only writes a bare kv row the cached
 * G.store.settings() would never see) and asserts the exact computed
 * "45 days until ETS" / "Final sprint - act daily" text. Also confirms a
 * real tab click (DD-214) swaps content, from data verified present in the
 * embedded seed (19 dd214.keyBlocks).
 * ======================================================================== */
console.log("\n-- #/transition: ETS countdown is a real computed value; DD-214 tab switches content --");
const etsIso = await page.evaluate(async () => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 45);
  const pad = (n) => String(n).padStart(2, "0");
  const iso = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  await window.G.store.setSetting("etsDate", iso);
  return iso;
});
await goto("#/transition");
const transitionHeading = await page.evaluate(() => /Transition/.test((document.querySelector("h2") || {}).textContent || ""));
transitionHeading ? ok("#/transition view renders") : bad("#/transition heading not found");

const banner = await page.evaluate(() => ({
  days: (document.querySelector(".tx-countdown-days") || {}).textContent || "",
  label: (document.querySelector(".tx-countdown-label") || {}).textContent || "",
  zone: (document.querySelector(".tx-countdown-zone") || {}).textContent || "",
}));
banner.days === "45" ? ok(`countdown banner computes 45 days out from etsDate=${etsIso}`) : bad("countdown days text: " + JSON.stringify(banner.days));
banner.label === " days until ETS" ? ok("countdown banner label reads 'days until ETS' for a future date") : bad("countdown label text: " + JSON.stringify(banner.label));
banner.zone === "Final sprint — act daily" ? ok("countdown zone text correctly computed as 'Final sprint — act daily' for 45 days out") : bad("countdown zone text: " + JSON.stringify(banner.zone));

await page.locator('button[role="tab"]', { hasText: /^DD-214$/ }).click();
await page.waitForTimeout(300);
const dd214Active = await page.evaluate(() => {
  const activeTabText = (document.querySelector("button.tab.active") || {}).textContent;
  const hasBlocks = /Key blocks to verify/.test(document.body.textContent || "");
  return activeTabText === "DD-214" && hasBlocks;
});
dd214Active ? ok("clicking the 'DD-214' tab activates it and swaps content to 'Key blocks to verify'") : bad("DD-214 tab click did not switch content as expected");

// cleanup
await page.evaluate(() => window.G.store.setSetting("etsDate", ""));

/* ========================================================================
 * #/risk (G.risk, src/index.html ~10203-10563)
 * Real computed value: recompute() (~10479-10490) derives a Risk Level band
 * from riskBand(valueIdx, highestLikelihoodIdx) = a simple sum-then-bucket
 * (score<=2 Low, <=5 Medium, else High). Setting Resource Value Rating to
 * "Very High" (index 4) and the "Insider Threat" aggressor's likelihood to
 * "Very High" (index 4) gives score=8, which the module's own riskBand()
 * buckets as High - asserted against the literal "RISK LEVEL: HIGH" text
 * the module renders. "Save worksheet" (~10531-10538) persists the whole
 * model plus the computed band to kv "risk:all" (STORE_KEY, ~10242), which
 * this confirms by reading it back through G.db.
 * ======================================================================== */
console.log("\n-- #/risk: worksheet inputs drive a real computed Risk Level, and Save persists it --");
await page.evaluate(() => window.G.db.put("kv", { k: "risk:all", v: [] }));
await goto("#/risk");
const riskHeading = await page.evaluate(() => (document.querySelector("h2") || {}).textContent === "Risk Management");
riskHeading ? ok("#/risk view renders") : bad("#/risk h2 mismatch");

await page.fill('input[aria-label="Inspected Resource"]', "Test Arms Room");
await page.locator('select[aria-label="Resource Value Rating"]').selectOption("4");
await page.locator('select[aria-label="Aggressor likelihood — Insider Threat"]').selectOption("4");
await page.waitForTimeout(300);

const computed = await page.evaluate(() => (document.querySelector('[aria-label="Computed risk level"]') || {}).textContent || "");
/RISK LEVEL: HIGH/.test(computed) ? ok("Very High value + Very High likelihood computes and displays 'RISK LEVEL: HIGH'") : bad("computed risk output: " + JSON.stringify(computed));
/Insider Threat/.test(computed) ? ok("the highest-rated aggressor group (Insider Threat) is named in the output") : bad("Insider Threat not named in computed output");

await page.locator("button", { hasText: /^Save worksheet$/ }).click();
await page.waitForTimeout(500);
const savedWorksheets = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "risk:all");
  return (r && r.v) || [];
});
const savedEntry = savedWorksheets.find((w) => w.resource === "Test Arms Room");
savedEntry ? ok("Save worksheet persists a real entry to kv \"risk:all\"") : bad("no risk:all entry found for 'Test Arms Room'; got: " + JSON.stringify(savedWorksheets));
savedEntry && savedEntry.risk === "High" ? ok("the persisted entry's risk band matches the computed 'High'") : bad("persisted risk band: " + JSON.stringify(savedEntry && savedEntry.risk));

// cleanup
await page.evaluate(() => window.G.db.put("kv", { k: "risk:all", v: [] }));

/* ========================================================================
 * #/share (G.share, src/index.html ~16174-16312)
 * Served over http:// (not file://) with G.pwa.isNative() false in a plain
 * browser context, so the browser branch renders (~16201-16220): a "Copy
 * link" button whose click handler does
 * `navigator.clipboard.writeText(url)` where url = location.href split on
 * "#" (~16202, 16212-16215), then a real util.toast() call. Both the actual
 * clipboard contents and the toast text are verified, the same real
 * clipboard round-trip pattern test-selftest.mjs already uses for its own
 * "Copy report" button.
 * ======================================================================== */
console.log("\n-- #/share: 'Copy link' writes the real app URL to the clipboard --");
await goto("#/share");
const shareHeading = await page.evaluate(() => (document.querySelector("h2") || {}).textContent === "Share & Install");
shareHeading ? ok("#/share view renders") : bad("#/share h2 mismatch");

const expectedUrl = await page.evaluate(() => location.href.split("#")[0]);
const shownUrl = await page.evaluate(() => {
  const eyebrow = [...document.querySelectorAll(".eyebrow")].find((e) => /This app's address/.test(e.textContent || ""));
  return eyebrow && eyebrow.parentElement ? (eyebrow.parentElement.querySelector("p") || {}).textContent : null;
});
shownUrl === expectedUrl ? ok("the displayed app address matches the real page URL") : bad("displayed address " + JSON.stringify(shownUrl) + " !== " + JSON.stringify(expectedUrl));

await page.locator("button", { hasText: /Copy link/ }).click();
await page.waitForTimeout(300);
const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
clipboardText === expectedUrl ? ok("clicking 'Copy link' writes the real app URL to the clipboard") : bad("clipboard content " + JSON.stringify(clipboardText) + " !== " + JSON.stringify(expectedUrl));

const toastText = await page.evaluate(() => (document.getElementById("toast") || {}).textContent || "");
/Link copied/.test(toastText) ? ok("Copy link shows a real 'Link copied' toast") : bad("toast text after Copy link: " + JSON.stringify(toastText));

/* ------------------------------------------------------------------------ */

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/page errors across all 11 routes") : bad(`${relevantNoise.length} console/page error(s); first: ${relevantNoise[0]}`);

await browser.close();
await server.close();

console.log("\n" + (fails ? `BASELINE COVERAGE: ${fails} FAILURE(S)` : "BASELINE COVERAGE: all passed"));
process.exit(fails ? 1 : 0);
