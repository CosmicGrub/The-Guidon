/**
 * Unit decks never reach the bank, the fingerprint, the manifest, the handheld export or Study Rooms
 *
 * WHY THIS SUITE EXISTS: TODO - say what would ship broken, and go unnoticed,
 * if this file were deleted. Then make every assertion below able to FAIL:
 * run it once against the broken behaviour and watch it go red.
 *
 * Started with tools/new-suite.mjs unit-decks-isolation. The house rules it starts you
 * with (tools/lint-test-hygiene.mjs holds a new suite to all of them):
 *   - no fixed sleeps: waitForRoute(page, hash, { ready }), until(page, fn),
 *     clickWhenStable(page, target) wait for the STATE instead;
 *   - no swallowed waits: until() returns true/false - assert on what follows;
 *   - no literal deck sizes: liveCount(page, { category | kind }) reads the
 *     running app, so a content change cannot break this suite;
 *   - this one is pure node: no browser is launched (cheapest kind of suite);
 *   - drive the real screen, never stub the thing under test, and end with
 *     the zero-console-noise check.
 */
import { ok, bad, check, finish } from "./testkit.mjs";

// A verifier (a lint, a build step) must also be shown to FAIL: point it at a
// temp copy with one planted defect, the way tools/test-hygiene-ratchet.mjs does.

// TODO(unit-decks-isolation): the real assertions.
//   check(actual === expected, "what is true when this works", () => "what was there instead: " + actual);
bad("TODO: tools/test-unit-decks-isolation.mjs was scaffolded by tools/new-suite.mjs and has not been written yet");

await finish("UNIT DECKS ISOLATION");
