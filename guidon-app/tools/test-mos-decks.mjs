/**
 * ROADMAP 3g item G: MOS decks are a first-class, OPT-IN lane - hidden by
 * default, not shown-to-everyone-and-narrowed the way MOS-tagged content
 * worked before this round. G.mosDecks (src/app-modules/00-mos-decks-core.js)
 * is the one place "which MOS decks exist" and "is this one active for this
 * Soldier" are decided; store.boardQuestions(), store.scenarios() and the
 * Readiness tab's new "MOS Deck Readiness" panel all read through it.
 *
 * WHY THIS SUITE EXISTS: without it, a regression that quietly reverted the
 * lane back to "visible by default" (the behavior for every prior release)
 * would ship undetected - every OTHER suite boots with no MOS on its
 * profile and would keep passing either way, because 92A content that
 * happens to still be visible just looks like more board content. This is
 * the one place "off means off" is proven end to end: the runtime pool, the
 * Readiness tab, and the real Settings checkbox that is the only door in.
 *
 * Started with tools/new-suite.mjs mos-decks. House rules
 * (tools/lint-test-hygiene.mjs holds this suite to all of them):
 *   - no fixed sleeps: waitForRoute(page, hash, { ready }), until(page, fn),
 *     clickWhenStable(page, target) wait for the STATE instead;
 *   - no swallowed waits: until() returns true/false - assert on what follows;
 *   - no literal deck sizes: every expected count is read from the running
 *     app (G.mosDecks.available(), G.store.boardQuestions()/scenarios()),
 *     never typed here, so a future second MOS deck cannot break this suite;
 *   - one browser: bootApp() once;
 *   - drive the real screen (Settings' own checkbox, Board Drill's own
 *     Readiness tab), never stub the thing under test.
 */
import { bootApp, ok, bad, check, finish, waitForRoute, until, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

// The Settings checkbox itself is visually hidden behind this app's custom
// "switch" look (a styled <span class="track"> sibling carries the visible
// control) - same idiom as every other Settings toggle (Study groups, Show
// community, ...). A Playwright locator.click() refuses it as "attached but
// not visible"; tools/test-privacy.mjs's own Study-groups toggle check hits
// the same thing and works around it with a real DOM .click() from inside
// the page, which does not require visibility. locator.evaluate() does that
// against the already-resolved element instead of re-querying by selector.
const clickCheckbox = (locator) => locator.evaluate((el) => el.click());

const boot = await bootApp({ viewport: { width: 390, height: 844 } });
const { page, noise } = boot;

/* ---- (e) the six universal pillars are untouched by this change ---- */
const pillars = await page.evaluate(() => (window.G && G.board && G.board.PILLARS) || []);
check(pillars.length === 6, "G.board.PILLARS still has exactly six universal pillars", () => "PILLARS = " + JSON.stringify(pillars));

/* ---- (d) the MOS deck catalog is genuinely data-driven, not a hardcoded list ---- */
const decks = await page.evaluate(() => (window.G && G.mosDecks && G.mosDecks.available) ? G.mosDecks.available() : null);
check(Array.isArray(decks), "G.mosDecks.available() exists and returns an array", () => "G.mosDecks.available() returned " + JSON.stringify(decks));
check(!!decks && decks.length === 1 && decks[0].code === "92A",
  "exactly one MOS deck is registered today (92A) - every consumer (Settings, Readiness, the board filter) reads this catalog rather than naming a MOS itself",
  () => "G.mosDecks.available() = " + JSON.stringify(decks));
const deckLabel = decks && decks[0] ? decks[0].label : null;

/* ---- (a) default state: no opt-in, no matching profile.mos -> everything hidden ---- */
const before = await page.evaluate(() => ({
  mosCards: G.store.boardQuestions().filter((q) => Array.isArray(q.mos) && q.mos.length).length,
  mosScenarios: G.store.scenarios().filter((sc) => Array.isArray(sc.mos) && sc.mos.length).length,
  optedIn: G.mosDecks.optedIn(),
}));
check(before.mosCards === 0, "default state: zero MOS-tagged board cards in the pool (no profile.mos, nothing opted in)", () => before.mosCards + " MOS-tagged cards still visible");
check(before.mosScenarios === 0, "...and zero MOS-tagged scenarios", () => before.mosScenarios + " MOS-tagged scenarios still visible");
check(Array.isArray(before.optedIn) && before.optedIn.length === 0, "G.mosDecks.optedIn() starts empty", () => "optedIn() = " + JSON.stringify(before.optedIn));

await waitForRoute(page, "#/board", { ready: ".qz-front .qz-prompt" });
await page.evaluate(() => { G.board._openReadiness && G.board._openReadiness(); });
await until(page, () => !!document.querySelector(".readiness-pillars"));
const readinessBefore = await page.evaluate(() => !!document.querySelector(".readiness-mos-decks"));
check(!readinessBefore, "no \"MOS Deck Readiness\" panel renders when nothing is active", "the .readiness-mos-decks panel rendered with nothing opted in and no matching MOS");

/* ---- (b) opting in via the real Settings checkbox makes 92A visible ---- */
await waitForRoute(page, "#/settings", { ready: page.locator("label", { hasText: "MOS Decks" }) });
const checkbox = page.locator(`input[aria-label="Study ${deckLabel} content"]`);
const checkboxCount = await checkbox.count();
check(checkboxCount === 1, `Settings shows exactly one checkbox for "${deckLabel}"`, () => checkboxCount + " checkboxes matched");
check(!(await checkbox.isChecked()), "the checkbox starts unchecked (off by default)", "the checkbox was already checked before this suite touched it");
await clickCheckbox(checkbox);
await until(page, () => (window.G.mosDecks.optedIn() || []).indexOf("92A") !== -1);
const optedInAfterClick = await page.evaluate(() => G.mosDecks.optedIn());
check(optedInAfterClick.indexOf("92A") !== -1, "checking the box calls G.mosDecks.setOptedIn(\"92A\", true)", () => "optedIn() = " + JSON.stringify(optedInAfterClick));

await waitForRoute(page, "#/board", { ready: ".qz-front .qz-prompt" });
const afterOptIn = await page.evaluate(() => ({
  mosCards: G.store.boardQuestions().filter((q) => Array.isArray(q.mos) && q.mos.length).length,
  mosScenarios: G.store.scenarios().filter((sc) => Array.isArray(sc.mos) && sc.mos.length).length,
}));
check(afterOptIn.mosCards > 0, `opting in makes MOS-tagged board cards appear in the pool (${afterOptIn.mosCards})`, "still zero MOS cards after opting in");
check(afterOptIn.mosScenarios > 0, `...and MOS-tagged scenarios (${afterOptIn.mosScenarios})`, "still zero MOS scenarios after opting in");

await page.evaluate(() => { G.board._openReadiness && G.board._openReadiness(); });
await until(page, () => !!document.querySelector(".readiness-mos-decks"));
const readinessAfter = await page.evaluate(() => {
  const panel = document.querySelector(".readiness-mos-decks");
  const row = panel ? panel.querySelector(".readiness-mos-deck-row") : null;
  return {
    hasPanel: !!panel,
    mosAttr: row ? row.getAttribute("data-mos") : null,
    text: row ? row.querySelector(".stat .v").textContent : null,
  };
});
check(readinessAfter.hasPanel, "\"MOS Deck Readiness\" panel renders once 92A is active", "the .readiness-mos-decks panel did not render after opting in");
check(readinessAfter.mosAttr === "92A", "the panel's row is for the 92A deck", () => "row data-mos = " + JSON.stringify(readinessAfter.mosAttr));
const cardsMatch = readinessAfter.text && readinessAfter.text.match(/(\d+)\/(\d+) cards/);
check(!!cardsMatch && Number(cardsMatch[2]) > 0, "the row shows a real, non-zero card count", () => "row text = " + JSON.stringify(readinessAfter.text));

/* ---- (c) toggling back off removes both again ---- */
await waitForRoute(page, "#/settings", { ready: page.locator("label", { hasText: "MOS Decks" }) });
const checkbox2 = page.locator(`input[aria-label="Study ${deckLabel} content"]`);
check(await checkbox2.isChecked(), "the checkbox is still checked after navigating away and back", "the checkbox lost its checked state across a navigation");
await clickCheckbox(checkbox2);
await until(page, () => (window.G.mosDecks.optedIn() || []).indexOf("92A") === -1);
const optedInAfterUncheck = await page.evaluate(() => G.mosDecks.optedIn());
check(optedInAfterUncheck.indexOf("92A") === -1, "unchecking the box calls G.mosDecks.setOptedIn(\"92A\", false)", () => "optedIn() = " + JSON.stringify(optedInAfterUncheck));

await waitForRoute(page, "#/board", { ready: ".qz-front .qz-prompt" });
const afterOptOut = await page.evaluate(() => ({
  mosCards: G.store.boardQuestions().filter((q) => Array.isArray(q.mos) && q.mos.length).length,
  mosScenarios: G.store.scenarios().filter((sc) => Array.isArray(sc.mos) && sc.mos.length).length,
}));
check(afterOptOut.mosCards === 0, "unchecking the box hides MOS-tagged board cards again", () => afterOptOut.mosCards + " MOS cards still visible after opting out");
check(afterOptOut.mosScenarios === 0, "...and MOS-tagged scenarios again", () => afterOptOut.mosScenarios + " MOS scenarios still visible after opting out");

await page.evaluate(() => { G.board._openReadiness && G.board._openReadiness(); });
await until(page, () => !!document.querySelector(".readiness-pillars"));
const readinessFinal = await page.evaluate(() => !!document.querySelector(".readiness-mos-decks"));
check(!readinessFinal, "the \"MOS Deck Readiness\" panel disappears again after opting out", "the .readiness-mos-decks panel is still present after opting out");

/* ---- (f) onboarding's own (optional) MOS field is sufficient on its own ---- */
// Product refinement: onboarding's "Your role" step lets a Soldier type
// their own MOS into the SAME free-text profile.mos field
// store.boardQuestions()/scenarios() prefix-match against (src/index.html,
// renderRoleStep()'s mosInp). G.mosDecks.activeCodes() ORs that match with
// Settings' opt-in (see its own comment) - a Soldier who already told
// onboarding "92A" must never ALSO need to flip the Settings checkbox. A
// FRESH session (its own storage, seeded with a profile carrying mos: "92A"
// the way onboarding's own save would produce, with mosOptIn never touched)
// proves the profile-match half works completely on its own.
const onboarded = await boot.openSession({ profile: Object.assign({}, PERSONAL_PROFILE, { mos: "92A" }), noise });
const onboardedResult = await onboarded.page.evaluate(() => ({
  optedIn: G.mosDecks.optedIn(),
  mosCards: G.store.boardQuestions().filter((q) => Array.isArray(q.mos) && q.mos.length).length,
}));
check(Array.isArray(onboardedResult.optedIn) && onboardedResult.optedIn.length === 0,
  "a fresh session with profile.mos=\"92A\" never touches Settings' opt-in",
  () => "optedIn() = " + JSON.stringify(onboardedResult.optedIn));
check(onboardedResult.mosCards > 0,
  `entering "92A" as your MOS during onboarding is enough on its own to see 92A board content (${onboardedResult.mosCards} cards, no Settings checkbox needed)`,
  "profile.mos=\"92A\" alone did not surface any MOS-tagged board cards");

expectNoConsoleNoise(noise);
await finish("MOS DECKS");
