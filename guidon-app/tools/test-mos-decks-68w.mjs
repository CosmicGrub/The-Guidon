/**
 * The 68W MOS deck (src/app-modules/08-mos-deck-68w-content.js +
 * 09-mos-deck-68w-scenarios.js) - GUIDON's SECOND MOS deck, and the first
 * real proof that 00-mos-decks-core.js's "92A is the reference pattern, not
 * a one-off" design actually holds for a deck it was never built alongside.
 *
 * tools/test-mos-decks.mjs already proves the GENERIC mechanism (opt-in,
 * Readiness panel, onboarding's own MOS field, opt-out) end to end using
 * 92A as its example, and this suite deliberately does not re-derive that
 * same generic proof a second time. What ONLY exists once a second deck
 * ships, and so can ONLY be tested here:
 *   (1) the 68W deck itself is real, correctly labeled and reachable through
 *       the same data-driven catalog 92A uses - no 68W-specific code
 *       anywhere in Settings/Readiness/onboarding, exactly as the standing
 *       rule requires;
 *   (2) two MOS decks stay ISOLATED from each other - opting into 68W must
 *       not leak 92A content into the pool, or vice versa (a real risk the
 *       shared `mosOptIn` array and the shared `.mos` tag on every board
 *       card/scenario both create, and nothing before this deck existed
 *       could ever have caught a bug in);
 *   (3) two MOS decks can be ACTIVE AT ONCE without double-counting or
 *       clobbering each other's Readiness row - profile.mos="68W" (the
 *       onboarding path) plus an explicit Settings opt-in to 92A (the
 *       opt-in path), together, in the same session.
 *
 * House rules (tools/lint-test-hygiene.mjs holds this suite to all of them,
 * same as every other suite): no fixed sleeps - waitForRoute(..., { ready }),
 * until(), clickWhenStable() from tools/testkit.mjs; no swallowed waits; no
 * literal deck sizes - every expected count is read from the running app
 * (G.mosDecks.available(), G.store.boardQuestions()/scenarios()), never
 * typed here, so a future third MOS deck cannot break this suite either.
 */
import { bootApp, ok, bad, check, finish, waitForRoute, clickWhenStable, until, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

const clickCheckbox = (locator) => locator.evaluate((el) => el.click());
const rowValueText = (page, selector) => page.evaluate((sel) => {
  const row = document.querySelector(sel);
  return row ? (row.querySelector(".stat .v") || {}).textContent : null;
}, selector);
const MOS_68W_ROW = '.readiness-mos-deck-row[data-mos="68W"]';
const MOS_92A_ROW = '.readiness-mos-deck-row[data-mos="92A"]';
const taggedCounts = (page) => page.evaluate(() => ({
  mos68w: G.store.boardQuestions().filter((q) => Array.isArray(q.mos) && q.mos.some((m) => G.mosDecks.normalize(m) === "68W")).length,
  mos92a: G.store.boardQuestions().filter((q) => Array.isArray(q.mos) && q.mos.some((m) => G.mosDecks.normalize(m) === "92A")).length,
  sc68w: G.store.scenarios().filter((sc) => Array.isArray(sc.mos) && sc.mos.some((m) => G.mosDecks.normalize(m) === "68W")).length,
  sc92a: G.store.scenarios().filter((sc) => Array.isArray(sc.mos) && sc.mos.some((m) => G.mosDecks.normalize(m) === "92A")).length,
}));

const boot = await bootApp({ viewport: { width: 390, height: 844 } });
const { page, noise } = boot;

/* ---- (1) the deck itself: real, data-driven, correctly labeled ---- */
const decks = await page.evaluate(() => (window.G && G.mosDecks && G.mosDecks.available) ? G.mosDecks.available() : null);
const deck68w = decks && decks.find((d) => d.code === "68W");
check(!!deck68w, "G.mosDecks.available() includes a 68W deck", () => "G.mosDecks.available() = " + JSON.stringify(decks));
const label68w = deck68w ? deck68w.label : null;
check(!!label68w && /combat medic/i.test(label68w) && /health care specialist/i.test(label68w),
  `the 68W deck's label names both "Combat Medic" and "Health Care Specialist" (matches career.mos's own catalog title): "${label68w}"`,
  () => "label = " + JSON.stringify(label68w));
check(decks.length > 1, `at least two MOS decks are registered now (${decks.length}) - GUIDON's first second-deck ship`, () => "decks = " + JSON.stringify(decks));

/* ---- (1b) default state: nothing opted in, no profile.mos -> zero 68W content, same hidden-by-default promise 92A's own suite proves ---- */
const before = await taggedCounts(page);
check(before.mos68w === 0, "default state: zero 68W-tagged board cards in the pool", () => before.mos68w + " 68W cards still visible with nothing opted in");
check(before.sc68w === 0, "...and zero 68W-tagged scenarios", () => before.sc68w + " 68W scenarios still visible with nothing opted in");

/* ---- (2) Settings shows a 68W checkbox that is independent of 92A's ---- */
await waitForRoute(page, "#/settings", { ready: page.locator("label", { hasText: "MOS Decks" }) });
const cb68w = page.locator(`input[aria-label="Study ${label68w} content"]`);
const cb68wCount = await cb68w.count();
check(cb68wCount === 1, `Settings shows exactly one checkbox for "${label68w}"`, () => cb68wCount + " checkboxes matched");
check(!(await cb68w.isChecked()), "the 68W checkbox starts unchecked (off by default)", "the 68W checkbox was already checked before this suite touched it");

await clickCheckbox(cb68w);
await until(page, () => (window.G.mosDecks.optedIn() || []).indexOf("68W") !== -1);
const optedInAfter = await page.evaluate(() => G.mosDecks.optedIn());
check(optedInAfter.indexOf("68W") !== -1, 'checking the box calls G.mosDecks.setOptedIn("68W", true)', () => "optedIn() = " + JSON.stringify(optedInAfter));
check(optedInAfter.indexOf("92A") === -1, "...and does NOT also opt into 92A - the two decks' opt-in state is independent", () => "optedIn() = " + JSON.stringify(optedInAfter));

/* ---- (2b) opting into 68W surfaces 68W content and ONLY 68W content - proves deck isolation, the one thing no pre-existing suite could ever have tested with a single deck ---- */
await waitForRoute(page, "#/board", { ready: ".qz-front .qz-prompt" });
const afterOptIn = await taggedCounts(page);
check(afterOptIn.mos68w > 0, `opting into 68W surfaces 68W-tagged board cards (${afterOptIn.mos68w})`, "still zero 68W cards after opting in");
check(afterOptIn.sc68w > 0, `...and 68W-tagged scenarios (${afterOptIn.sc68w})`, "still zero 68W scenarios after opting in");
check(afterOptIn.mos92a === 0, "...while 92A stays completely hidden - opting into one MOS deck never leaks another", () => afterOptIn.mos92a + " 92A cards visible after opting into 68W only");
check(afterOptIn.sc92a === 0, "...and no 92A scenarios leak in either", () => afterOptIn.sc92a + " 92A scenarios visible after opting into 68W only");

/* ---- Readiness panel: a row for 68W, with real, non-zero numbers ---- */
await page.evaluate(() => { G.board._openReadiness && G.board._openReadiness(); });
await until(page, () => !!document.querySelector(".readiness-mos-decks"));
const readiness68w = await page.evaluate((sel) => {
  const row = document.querySelector(sel);
  return row ? { mosAttr: row.getAttribute("data-mos"), text: (row.querySelector(".stat .v") || {}).textContent } : null;
}, MOS_68W_ROW);
check(!!readiness68w, "\"MOS Deck Readiness\" shows a row for 68W once it is active", "no .readiness-mos-deck-row[data-mos=\"68W\"] found after opting in");
const cardsMatch68w = readiness68w && readiness68w.text && readiness68w.text.match(/(\d+)\/(\d+) cards/);
check(!!cardsMatch68w && Number(cardsMatch68w[2]) > 0, "the 68W row shows a real, non-zero card count", () => "row text = " + JSON.stringify(readiness68w && readiness68w.text));
check(!(await page.locator(MOS_92A_ROW).count()), "...and no 92A row appears alongside it - 92A was never activated in this session", () => "92A row unexpectedly present");

/* ---- "Study <68W label>..." opens a deck of exactly the 68W-tagged cards ---- */
const expected68wPool = await page.evaluate(() =>
  G.store.boardQuestions().filter((q) => Array.isArray(q.mos) && q.mos.some((m) => G.mosDecks.normalize(m) === "68W")).length);
await clickWhenStable(page, page.locator(MOS_68W_ROW + " button", { hasText: "Study" }));
await until(page, () => !!document.querySelector(".qz-front .qz-prompt"));
const studyDeckSize68w = await page.evaluate(() => {
  const s = Array.from(document.querySelectorAll(".stat")).find((x) => /This session/.test(x.textContent));
  const t = s ? (s.querySelector(".v") || {}).textContent : "";
  const m = t && t.match(/Card \d+\/(\d+)/);
  return m ? Number(m[1]) : null;
});
check(expected68wPool > 0, "there really are 68W-tagged cards to study (sanity check on the count this test compares against)", () => "expected68wPool = " + expected68wPool);
check(studyDeckSize68w === expected68wPool,
  `"Study ${label68w}" opens a Board Drill queue of exactly the ${expected68wPool} 68W-tagged cards, nothing else`,
  () => `deck shows ${studyDeckSize68w} cards, expected exactly ${expected68wPool}`);
const banner68w = await page.evaluate((label) => (document.body.textContent || "").includes("Studying: " + label), label68w);
check(banner68w, "a visible banner names the active 68W filter", "no \"Studying: <label>\" banner found after clicking Study 68W...");

/* ---- opting back out hides 68W content again ---- */
await waitForRoute(page, "#/settings", { ready: page.locator("label", { hasText: "MOS Decks" }) });
const cb68wAgain = page.locator(`input[aria-label="Study ${label68w} content"]`);
check(await cb68wAgain.isChecked(), "the 68W checkbox is still checked after navigating away and back", "the 68W checkbox lost its checked state across a navigation");
await clickCheckbox(cb68wAgain);
await until(page, () => (window.G.mosDecks.optedIn() || []).indexOf("68W") === -1);
await waitForRoute(page, "#/board", { ready: ".qz-front .qz-prompt" });
const afterOptOut = await taggedCounts(page);
check(afterOptOut.mos68w === 0, "unchecking the box hides 68W-tagged board cards again", () => afterOptOut.mos68w + " 68W cards still visible after opting out");
check(afterOptOut.sc68w === 0, "...and 68W-tagged scenarios again", () => afterOptOut.sc68w + " 68W scenarios still visible after opting out");

/* ---- (1c) onboarding's own (optional) MOS field surfaces 68W on its own, same as 92A's suite proves for 92A ---- */
const onboarded68w = await boot.openSession({ profile: Object.assign({}, PERSONAL_PROFILE, { mos: "68W" }), noise });
const onboardedResult = await onboarded68w.page.evaluate(() => ({
  optedIn: G.mosDecks.optedIn(),
  mos68w: G.store.boardQuestions().filter((q) => Array.isArray(q.mos) && q.mos.some((m) => G.mosDecks.normalize(m) === "68W")).length,
}));
check(Array.isArray(onboardedResult.optedIn) && onboardedResult.optedIn.length === 0,
  "a fresh session with profile.mos=\"68W\" never touches Settings' opt-in",
  () => "optedIn() = " + JSON.stringify(onboardedResult.optedIn));
check(onboardedResult.mos68w > 0,
  `entering "68W" as your MOS during onboarding is enough on its own to see 68W board content (${onboardedResult.mos68w} cards, no Settings checkbox needed)`,
  "profile.mos=\"68W\" alone did not surface any 68W-tagged board cards");
await onboarded68w.context.close();

/* ---- (3) two decks active at once: profile.mos="68W" (onboarding path) PLUS an explicit Settings opt-in to 92A (opt-in path), together, in one session ---- */
const both = await boot.openSession({ profile: Object.assign({}, PERSONAL_PROFILE, { mos: "68W" }), noise });
await waitForRoute(both.page, "#/settings", { ready: both.page.locator("label", { hasText: "MOS Decks" }) });
const deck92aOnBoth = (await both.page.evaluate(() => G.mosDecks.available())).find((d) => d.code === "92A");
const cb92aOnBoth = both.page.locator(`input[aria-label="Study ${deck92aOnBoth.label} content"]`);
await clickCheckbox(cb92aOnBoth);
await until(both.page, () => (window.G.mosDecks.optedIn() || []).indexOf("92A") !== -1);

await waitForRoute(both.page, "#/board", { ready: ".qz-front .qz-prompt" });
const bothCounts = await taggedCounts(both.page);
check(bothCounts.mos68w > 0 && bothCounts.mos92a > 0,
  `both decks contribute board cards to the same session at once (68W: ${bothCounts.mos68w}, 92A: ${bothCounts.mos92a}) - profile.mos and Settings opt-in are two independent ORs into the same pool, not a single slot`,
  () => "bothCounts = " + JSON.stringify(bothCounts));

await both.page.evaluate(() => { G.board._openReadiness && G.board._openReadiness(); });
await until(both.page, () => !!document.querySelector(".readiness-mos-decks"));
const bothRows = await both.page.evaluate(() => Array.from(document.querySelectorAll(".readiness-mos-deck-row")).map((r) => r.getAttribute("data-mos")).sort());
check(bothRows.length === 2 && bothRows.includes("68W") && bothRows.includes("92A"),
  "the Readiness panel shows one row per active deck (both 68W and 92A), never merged or overwriting each other",
  () => "rows = " + JSON.stringify(bothRows));
const row68wBoth = await rowValueText(both.page, MOS_68W_ROW);
const row92aBoth = await rowValueText(both.page, MOS_92A_ROW);
check(!!row68wBoth && !!row92aBoth && row68wBoth !== row92aBoth,
  "each deck's Readiness row reports its own distinct numbers, neither one double-counting or echoing the other",
  () => `68W row: ${JSON.stringify(row68wBoth)}; 92A row: ${JSON.stringify(row92aBoth)}`);
await both.context.close();

expectNoConsoleNoise(noise);
await finish("MOS DECKS - 68W");
