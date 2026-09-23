/**
 * AFT Event Score Calculator (#/fitness's new panel, G.aftScoring): the
 * per-event calculator that turns raw performance (deadlift lbs, HRP reps,
 * SDC/PLK/2MR times) into real event scores and a 0-500 aggregate against
 * the official "Army Fitness Test Score Tables" (Approved 15 May 2025 /
 * Effective 1 June 2025) - not an approximation of it.
 *
 * Mirrors test-ppw.mjs's own real-storage/real-calculation verification
 * pattern: drive the actual UI with known raw inputs, and assert the EXACT
 * points the real published table specifies for that raw value at that age
 * band/sex/standard. Each expected number below was independently checked
 * against the raw table text in tools/aft-source-tables/*.txt (not just
 * against this module's own output) - fixed, known-correct numbers, not
 * "whatever the code currently returns". See tools/gen-aft-tables.mjs for
 * how the table itself is regenerated from source if the Army revises it.
 *
 * House rules (tools/lint-test-hygiene.mjs holds this new suite to all of
 * them): no fixed sleeps (waitForRoute/until/untilAsync/clickWhenStable
 * wait for real state), no swallowed waits (until()/untilAsync() return
 * true/false and the assertion after reports the miss), one browser
 * (bootApp() once), a real profile so storage persistence can be checked
 * (a Guest session saves nothing).
 */
import { bootApp, check, finish, waitForRoute, until, untilAsync, clickWhenStable, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

const PPW_KEY = "guidon:ppw:v1";

const boot = await bootApp({ profile: PERSONAL_PROFILE });
const { page, noise } = boot;

const MDL_LABEL = "3-Rep Max Deadlift", HRP_LABEL = "Hand-Release Push-up";
await waitForRoute(page, "#/fitness", { ready: 'input[aria-label="' + MDL_LABEL + '"]' });

check((await page.locator(".eyebrow", { hasText: /^AFT Event Score Calculator$/ }).count()) > 0,
  "AFT Event Score Calculator panel renders on #/fitness",
  "AFT Event Score Calculator heading not found on #/fitness");

async function setSelect(label, value) {
  await page.locator('select[aria-label="' + label + '"]').selectOption(value);
}
async function setInput(label, value) {
  const loc = page.locator('input[aria-label="' + label + '"]');
  await loc.fill(String(value));
  await loc.dispatchEvent("input");
}
async function setTime(shortLabel, min, sec) {
  await setInput(shortLabel + " minutes", min);
  await setInput(shortLabel + " seconds", sec);
}
/** Waits for the on-screen aggregate line to read exactly `expected`, then
 *  makes the assertion itself - the one signal that a full redraw (all 5
 *  event scores + status text) has actually completed, so every check that
 *  reads the DOM right after this call sees settled state, not a partial
 *  redraw. `label` distinguishes the PASS/FAIL line between combos. */
async function checkAggregate(expected, label) {
  const reached = await until(page, (want) => {
    const p = Array.from(document.querySelectorAll("p")).find((x) => /^Aggregate:/.test(x.textContent || ""));
    return !!p && p.textContent.trim() === "Aggregate: " + want + " / 500";
  }, expected);
  return check(reached, label + ": aggregate reaches exactly " + expected + " / 500",
    async () => label + " aggregate text seen: " + (await page.locator("p", { hasText: /^Aggregate:/ }).first().textContent()).trim());
}
async function eventScores() {
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll(".stat").forEach((el) => {
      const k = el.querySelector(".k"), v = el.querySelector(".v");
      if (k && v && /^(MDL|HRP|SDC|PLK|2MR)$/.test(k.textContent)) out[k.textContent] = v.textContent;
    });
    return out;
  });
}

/* ---- Combo A: 17-21 band (index 0), Male, General standard ----
 * MDL 300 lbs -> 92 pts | HRP 43 reps -> 87 pts | SDC 2:00 -> 73 pts |
 * PLK 2:30 -> 78 pts | 2MR 18:00 -> 74 pts | aggregate 404.
 * Independently checked against tools/aft-source-tables/*.txt:
 *   mdl.txt row "92 300 ..." (band0 M column = 300)
 *   hrp.txt row "87 43 ..." (band0 M column = 43)
 *   tmr.txt row "74 18:00 ..." (band0 M column = 18:00) */
await setSelect("Age band", "0");
await setSelect("Sex (general standard only)", "male");
await setSelect("Standard", "general");
await setInput(MDL_LABEL, 300);
await setInput(HRP_LABEL, 43);
await setTime("Sprint-Drag-Carry", 2, 0);
await setTime("Plank", 2, 30);
await setTime("2-Mile Run", 18, 0);

await checkAggregate(404, "Combo A");

const scoresA = await eventScores();
check(scoresA.MDL === "92 pts", "Combo A: MDL @300lbs (17-21 male) scores exactly 92 pts, the real table's value", "Combo A MDL: " + scoresA.MDL);
check(scoresA.HRP === "87 pts", "Combo A: HRP @43 reps (17-21 male) scores exactly 87 pts", "Combo A HRP: " + scoresA.HRP);
check(scoresA.SDC === "73 pts", "Combo A: SDC @2:00 (17-21 male) scores exactly 73 pts", "Combo A SDC: " + scoresA.SDC);
check(scoresA.PLK === "78 pts", "Combo A: PLK @2:30 (17-21 male) scores exactly 78 pts", "Combo A PLK: " + scoresA.PLK);
check(scoresA["2MR"] === "74 pts", "Combo A: 2MR @18:00 (17-21 male) scores exactly 74 pts", "Combo A 2MR: " + scoresA["2MR"]);

const statusA = (await page.locator("p.hint", { hasText: /standard/ }).first().textContent()).trim();
check(/General standard met/.test(statusA), "Combo A: 404 >= 300 correctly reads as General standard met", "Combo A status text: " + statusA);

/* ---- Combo B: 32-36 band (index 3), Female, General standard ----
 * MDL 150 lbs -> 79 | HRP 20 reps -> 76 | SDC 2:30 -> 83 | PLK 2:00 -> 74 |
 * 2MR 22:00 -> 64 | aggregate 376. mdl.txt row "79 ... 150 ..." band3 = 150. */
await setSelect("Age band", "3");
await setSelect("Sex (general standard only)", "female");
await setInput(MDL_LABEL, 150);
await setInput(HRP_LABEL, 20);
await setTime("Sprint-Drag-Carry", 2, 30);
await setTime("Plank", 2, 0);
await setTime("2-Mile Run", 22, 0);

await checkAggregate(376, "Combo B");

const scoresB = await eventScores();
check(scoresB.MDL === "79 pts", "Combo B: MDL @150lbs (32-36 female) scores exactly 79 pts", "Combo B MDL: " + scoresB.MDL);
check(scoresB.HRP === "76 pts", "Combo B: HRP @20 reps (32-36 female) scores exactly 76 pts", "Combo B HRP: " + scoresB.HRP);
check(scoresB.SDC === "83 pts", "Combo B: SDC @2:30 (32-36 female) scores exactly 83 pts", "Combo B SDC: " + scoresB.SDC);
check(scoresB.PLK === "74 pts", "Combo B: PLK @2:00 (32-36 female) scores exactly 74 pts", "Combo B PLK: " + scoresB.PLK);
check(scoresB["2MR"] === "64 pts", "Combo B: 2MR @22:00 (32-36 female) scores exactly 64 pts", "Combo B 2MR: " + scoresB["2MR"]);

/* ---- Combat standard is sex-neutral: same raw inputs as Combo A but
 * Standard=combat and Sex=female should still score the MALE column (92),
 * not a separate (nonexistent) female-combat table. ---- */
await setSelect("Age band", "0");
await setSelect("Sex (general standard only)", "female");
await setSelect("Standard", "combat");
await setInput(MDL_LABEL, 300);
await setInput(HRP_LABEL, 43);
await setTime("Sprint-Drag-Carry", 2, 0);
await setTime("Plank", 2, 30);
await setTime("2-Mile Run", 18, 0);

await checkAggregate(404, "Combat standard");
const scoresCombat = await eventScores();
check(scoresCombat.MDL === "92 pts",
  "Combat standard is sex-neutral: a female Soldier under Combat scores the same 92 pts on MDL @300lbs a male Soldier does under General - the shared M|C column, not a missing female-combat table",
  "Combat-standard female MDL @300lbs: " + scoresCombat.MDL + " (expected 92, the sex-neutral column's value)");

const statusCombat = (await page.locator("p.hint", { hasText: /standard/ }).first().textContent()).trim();
check(/Combat standard met/.test(statusCombat), "Combat standard's 350 minimum is evaluated correctly: 404 total reads as met", "Combat standard status text: " + statusCombat);

/* ---- Below-60 auto-fail flag ---- */
await setInput(MDL_LABEL, 0);
const failFlagSeen = await until(page, () => !!Array.from(document.querySelectorAll("p.hint")).find((x) => /Automatic test failure/.test(x.textContent || "")));
check(failFlagSeen, "A 0 on one event correctly shows the automatic-test-failure flag (below 60 on any single event fails regardless of the total)", "automatic-test-failure flag never appeared after zeroing MDL");

/* ---- Persistence: leave #/fitness entirely, come back, inputs survive ---- */
await setSelect("Age band", "0");
await setSelect("Sex (general standard only)", "male");
await setSelect("Standard", "general");
await setInput(MDL_LABEL, 300);
const persisted = await untilAsync(page, async () => {
  const row = await window.G.db.get("kv", "guidon:aft-calc:v1");
  return !!(row && row.v && row.v.mdl === 300);
});
check(persisted, "the 300 lbs MDL entry reaches guidon:aft-calc:v1 (debounced save landed)", "guidon:aft-calc:v1 never showed mdl:300");

await waitForRoute(page, "#/home");
await waitForRoute(page, "#/fitness", { ready: 'input[aria-label="' + MDL_LABEL + '"]' });
const mdlAfterReturn = await page.locator('input[aria-label="' + MDL_LABEL + '"]').inputValue();
check(mdlAfterReturn === "300", "Calculator inputs survive leaving and re-entering #/fitness (persisted to IndexedDB, not just in-memory)", "MDL value after re-render: " + mdlAfterReturn);

/* ---- "Send this aggregate to the PPW" writes into the real PPW kv row
 * and navigates to #/board - one connected flow rather than two screens. ---- */
const preSend = await page.evaluate((k) => window.G.db.get("kv", k), PPW_KEY);
check(!preSend || !preSend.v || preSend.v.aftScore == null, "sanity: guidon:ppw:v1 has no aftScore before sending", "guidon:ppw:v1 already had an aftScore before the send: " + JSON.stringify(preSend));

await setInput(HRP_LABEL, 43);
await setTime("Sprint-Drag-Carry", 2, 0);
await setTime("Plank", 2, 30);
await setTime("2-Mile Run", 18, 0);
await checkAggregate(404, "Pre-send");

await clickWhenStable(page, page.locator("button", { hasText: /^Send this aggregate to the PPW$/ }));
// waitForRoute() throws its own descriptive error if the hash never becomes
// #/board within budget - reaching the next line already proves the
// "Send this aggregate to the PPW" button did navigate there.
await waitForRoute(page, "#/board");

const ppwRow = await page.evaluate((k) => window.G.db.get("kv", k), PPW_KEY);
check(!!(ppwRow && ppwRow.v && ppwRow.v.aftScore === 404),
  "the exact 404 aggregate was merged into guidon:ppw:v1's aftScore field - the PPW worksheet now has it without the Soldier retyping it",
  "guidon:ppw:v1 after send: " + JSON.stringify(ppwRow));

// Open the actual PPW screen (Full PPW) and confirm the AFT input field
// itself shows 404 - the send only sets aftScore, and this confirms the
// existing PPW UI reads it the same way it always has.
await clickWhenStable(page, page.locator("button", { hasText: /^Points$/ }));
await clickWhenStable(page, page.locator("button", { hasText: /^Full PPW$/ }));
const AFT_FIELD = 'input[aria-label="AFT — record aggregate score"]';
const ppwFieldReady = await until(page, (sel) => !!document.querySelector(sel), AFT_FIELD);
check(ppwFieldReady, "PPW's own AFT record aggregate score field appears on Full PPW", "PPW's AFT field never appeared");
if (ppwFieldReady) {
  const val = await page.locator(AFT_FIELD).inputValue();
  check(val === "404", "the PPW worksheet's own AFT field shows 404, read straight from the same kv row the calculator wrote", "PPW AFT field value: " + val);
}

expectNoConsoleNoise(noise);

await finish("AFT event scoring");
