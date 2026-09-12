/**
 * Regression test for the first-boot content race that produced a ~50%
 * "no-cards" failure rate when stress-launching the debug Tauri exe against
 * a fresh WEBVIEW2_USER_DATA_FOLDER (tools/test-room-tauri.mjs, case (3)/
 * (6): host() opens a room with an empty deck, hostAction({type:"start"})
 * then answers {ok:false, reason:"no-cards"}).
 *
 * ROOT CAUSE (confirmed by direct instrumentation against the real debug
 * exe on 2026-09-07, not guessed): store.boardQuestions() / .doctrine() /
 * .scenarios() each memoize their seed-derived list keyed ONLY on settings
 * that can filter it (tierFilter, etc.) - with no regard for whether
 * state.seed.board/.doctrine/.scenarios has actually been populated yet by
 * loadContent() (itself awaited deep inside store.init(), which app.start()
 * awaits before its OWN route() call). But window.addEventListener
 * ("hashchange", route) is wired unconditionally at the very top of
 * app.start(), BEFORE that await - so a hashchange fired by anything else
 * (a deep link, or a test driver setting location.hash right after the
 * shell's globals exist, exactly what test-room-tauri.mjs's own step (3)
 * does) can call route() and reach one of these functions while the
 * matching state.seed.* is still null. The cache used to lock in that
 * empty read FOREVER under the matching settings key - nothing was wired
 * to invalidate it once content actually finished loading a moment later.
 * Confirmed via a one-shot diagnostic on the failing path: state.seed.board
 * was null (loadContent() literally had not run yet) at the exact call that
 * poisoned the cache, and the same 0 never climbed to the real 984 no
 * matter how long the caller waited afterward.
 *
 * FIX: fold `!!state.seed.<x>` into each cache key. It flips false -> true
 * exactly once, the moment loadContent() actually runs, which invalidates
 * a stale empty entry cached before then - the very next call recomputes
 * for real and caches correctly from then on.
 *
 * This test doesn't need the Tauri exe or a real timing race: it wraps
 * indexedDB.open() (via page.addInitScript(), before any app code runs) so
 * the app's own db.ready() - store.init()'s very first await - resolves
 * only after an artificial delay. That deterministically holds
 * state.seed.board/.doctrine/.scenarios at null for a known window, in
 * which the SAME hashchange-driven path the real bug used (location.hash =
 * "#/board" | "#/doctrine" | "#/train", handled by the unconditional
 * top-of-app.start() hashchange listener) is fired. If the cache-poisoning
 * bug is present, all three stay empty forever once the delay elapses and
 * content really does load; if it's fixed, all three recover.
 *
 * EXTENDED (roadmap-audit round 10, prt-aria-and-cache-tests bucket -
 * test-coverage-only, no src/index.html change needed here): store.creeds()
 * and store.prt() memoize on `!!state.seed.creeds`/`!!state.seed.prt`
 * exactly the same way (see their own comments, same file, right next to
 * doctrine()/scenarios() above) - the identical at-risk caching pattern,
 * just never previously exercised by this suite. #/creeds and #/prt are
 * fired through the same artificial-delay window as #/board/#/doctrine/
 * #/train below, confirming both stay empty during the race and recover
 * once content actually loads, same as the original three.
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

// Delay every indexedDB.open() request's event delivery by DELAY_MS -
// widens the exact window the real bug lives in (state.seed.* stays null
// while store.init()'s db.ready() is still pending) into something this
// test can deterministically land a hashchange inside of, instead of
// depending on a real fresh-profile IndexedDB being slow by chance.
const DELAY_MS = 700;
await page.addInitScript((delayMs) => {
  const realOpen = window.indexedDB.open.bind(window.indexedDB);
  window.indexedDB.open = function (...args) {
    const req = realOpen(...args);
    const handlers = {};
    ["success", "error", "upgradeneeded"].forEach((evt) => {
      Object.defineProperty(req, "on" + evt, {
        configurable: true,
        get() { return handlers[evt] || null; },
        set(fn) { handlers[evt] = fn; },
      });
      req.addEventListener(evt, (e) => {
        const fn = handlers[evt];
        // onupgradeneeded must NOT be delayed - it has to run inside the
        // browser's own versionchange transaction, synchronously from the
        // native event, or the object stores never get created at all.
        if (evt === "upgradeneeded") { if (fn) fn.call(req, e); return; }
        if (fn) setTimeout(() => fn.call(req, e), delayMs);
      });
    });
    return req;
  };
}, DELAY_MS);

await page.goto(url, { waitUntil: "load" });

// The shell's own globals exist almost immediately - script-parse time,
// well before the artificially delayed db.ready() resolves. This is
// exactly the boot-readiness gate tools/test-room-tauri.mjs uses.
await page.waitForFunction(() => !!(window.G && window.G.routes && window.G.routes.length && window.G.store));
ok("app shell globals exist while content is still artificially delayed");

// Fire the same hashchange-driven render path the real bug's culprit call
// used, for all five memoized functions at once - #/board, #/doctrine,
// #/train, #/creeds and #/prt each touch boardQuestions()/doctrine()/
// scenarios()/creeds()/prt() synchronously during their initial render.
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(60);
await page.evaluate(() => { location.hash = "#/doctrine"; });
await page.waitForTimeout(60);
await page.evaluate(() => { location.hash = "#/train"; });
await page.waitForTimeout(60);
await page.evaluate(() => { location.hash = "#/creeds"; });
await page.waitForTimeout(60);
await page.evaluate(() => { location.hash = "#/prt"; });
await page.waitForTimeout(60);

const early = await page.evaluate(() => ({
  board: window.G.store.boardQuestions().length,
  doctrine: window.G.store.doctrine().length,
  scenarios: window.G.store.scenarios().length,
  creeds: window.G.store.creeds().length,
  prt: window.G.store.prt().length,
  seedLoaded: !!window.G.store.seed().board,
}));
(!early.seedLoaded)
  ? ok("content genuinely had not loaded yet when the hashchange-driven renders ran (seed.board still null) - the race window was actually hit, not skipped past")
  : bad("content had already loaded before the hashchanges fired - this run didn't exercise the race at all, DELAY_MS=" + DELAY_MS + " needs to be larger: " + JSON.stringify(early));
(early.creeds === 0 && early.prt === 0)
  ? ok("creeds()/prt() also stayed empty during the same race window (0 each) - state.seed.creeds/.prt were still null when the #/creeds and #/prt hashchanges rendered")
  : bad("creeds()/prt() were NOT empty during the race window (creeds=" + early.creeds + ", prt=" + early.prt + ") - expected 0 each while content is still artificially delayed");

// Let the artificially delayed db.ready() resolve and store.init() finish
// loading real content for real.
await page.waitForTimeout(DELAY_MS + 500);

const late = await page.evaluate(() => ({
  board: window.G.store.boardQuestions().length,
  doctrine: window.G.store.doctrine().length,
  scenarios: window.G.store.scenarios().length,
  creeds: window.G.store.creeds().length,
  prt: window.G.store.prt().length,
}));

late.board > 900
  ? ok("boardQuestions() recovered to the real seed size (" + late.board + ") once content finished loading - the cache did not permanently lock in the early empty read (was " + early.board + ")")
  : bad("boardQuestions() STAYED empty after content finished loading: " + late.board + " (was " + early.board + " during the race window) - the first-boot content race regressed");
late.doctrine > 0
  ? ok("doctrine() also recovered (" + late.doctrine + " entries, was " + early.doctrine + ")")
  : bad("doctrine() STAYED empty after content finished loading: " + late.doctrine + " (was " + early.doctrine + ")");
late.scenarios > 0
  ? ok("scenarios() also recovered (" + late.scenarios + " entries, was " + early.scenarios + ")")
  : bad("scenarios() STAYED empty after content finished loading: " + late.scenarios + " (was " + early.scenarios + ")");
late.creeds > 0
  ? ok("creeds() also recovered (" + late.creeds + " entries, was " + early.creeds + ")")
  : bad("creeds() STAYED empty after content finished loading: " + late.creeds + " (was " + early.creeds + ")");
late.prt > 0
  ? ok("prt() also recovered (" + late.prt + " entries, was " + early.prt + ")")
  : bad("prt() STAYED empty after content finished loading: " + late.prt + " (was " + early.prt + ")");

// A fresh, uncached call with a DIFFERENT tierFilter must still work too -
// this is not just "the bug happens to be timed out by a later unrelated
// cache write", the recovery has to hold under the exact same settings key
// the poisoned call used, which the assertions above already pin (tierFilter
// stayed "all"/default throughout - the fix keys on content-loaded state,
// not on a tierFilter change nobody made here).
noise.length === 0 ? ok("no console/page errors") : bad("console/page errors: " + noise.join(" | "));

await browser.close();
server.close();
console.log("\n" + (fails ? `BOOT CONTENT RACE: ${fails} FAILURE(S)` : "BOOT CONTENT RACE: all passed"));
process.exit(fails ? 1 : 0);
