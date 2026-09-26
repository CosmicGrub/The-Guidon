/**
 * Unit decks end to end in the real app: import, study, search, readiness, off, remove
 *
 * WHY THIS SUITE EXISTS: TODO - say what would ship broken, and go unnoticed,
 * if this file were deleted. Then make every assertion below able to FAIL:
 * run it once against the broken behaviour and watch it go red.
 *
 * Started with tools/new-suite.mjs unit-decks. The house rules it starts you
 * with (tools/lint-test-hygiene.mjs holds a new suite to all of them):
 *   - no fixed sleeps: waitForRoute(page, hash, { ready }), until(page, fn),
 *     clickWhenStable(page, target) wait for the STATE instead;
 *   - no swallowed waits: until() returns true/false - assert on what follows;
 *   - no literal deck sizes: liveCount(page, { category | kind }) reads the
 *     running app, so a content change cannot break this suite;
 *   - one browser: bootApp() once; boot.openSession({ viewport, profile }) for
 *     a second viewport, profile or the standalone build (dir: "dist");
 *   - drive the real screen, never stub the thing under test, and end with
 *     the zero-console-noise check.
 */
import { bootApp, ok, bad, check, finish, waitForRoute, clickWhenStable, until, liveCount, expectNoConsoleNoise } from "./testkit.mjs";

// Phone width by default: if it fits here it fits everywhere (344px is the
// narrowest screen this app supports - use it when layout is the point).
const boot = await bootApp({ viewport: { width: 390, height: 844 } });
const { page, noise } = boot;

// Deck sizes come from the running app, never from a number typed here.
const cards = await liveCount(page, { kind: "board" });
check(cards > 0, `the app is serving its question bank (${cards} cards)`, "the question bank is empty");

// Go somewhere and wait for the thing you are about to touch - not for time.
await waitForRoute(page, "#/home", { ready: "#route h1, #route h2" });
const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(sideways <= 0, "nothing scrolls sideways at this width", () => "the page is " + sideways + "px too wide");

// TODO(unit-decks): the real assertions. The usual shape of one step:
//   await clickWhenStable(page, page.locator("button", { hasText: /^Start$/ }));
//   await until(page, () => !!document.querySelector("[data-started]"));
//   check(await page.evaluate(() => ...), "what a Soldier would notice", () => "what was there instead");
bad("TODO: tools/test-unit-decks.mjs was scaffolded by tools/new-suite.mjs and has not been written yet");

expectNoConsoleNoise(noise);
await finish("UNIT DECKS");
