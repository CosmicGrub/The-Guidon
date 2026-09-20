/**
 * PT Planner's shared PRT session model (sessions/pendingDrills) stays
 * correct when window.GUIDON_SEED is absent and content arrives via
 * loadContent()'s fetched-content path instead of the embedded one.
 *
 * WHY THIS SUITE EXISTS: ROADMAP 3g item I unified PT Planner's PRT
 * session/drill model with #/prt by moving the sessions/pendingDrills
 * DEFAULTS out of pt-planner.js's own module-load-time seed mutation
 * (PRT_SESSION_DEFS/PRT_PENDING_DRILLS + ensurePrtSessionModel()) and into
 * core's own seed normalization (src/index.html's loadContent()). A PR
 * review on that change correctly flagged that pt-planner.js's
 * prtSession()/prtDrillLabel() still read window.GUIDON_SEED.prt directly -
 * which core's normalization only guarantees on the EMBEDDED-seed boot path
 * (the `if (window.GUIDON_SEED) { ... }` branch of loadContent(), the one
 * every build target ships today). loadContent() has a second, documented
 * "fetched content" path (no window.GUIDON_SEED at all - state.seed.<key>
 * is populated straight from a fetched data/<key>.json, or that key's own
 * defaultSeedFor() default when the fetch fails) that never touches
 * window.GUIDON_SEED at all. On that path G.ptPlanner._session()/
 * _sessionSummary() would silently go empty even though G.store.prtMeta() -
 * the mode-agnostic reader #/prt's own prtHub already uses, since it reads
 * state.seed.prt, not the global - still returns real data.
 *
 * FIX under test: G.store.prtMeta() itself now guarantees the
 * drills/sessions/pendingDrills shape (falling back to the same
 * DEFAULT_PRT_SESSIONS/DEFAULT_PRT_PENDING_DRILLS core seed-normalization
 * uses whenever state.seed.prt is missing them, whatever path put it
 * there), and pt-planner.js's prtSession()/prtDrillLabel() now read THROUGH
 * it instead of the raw global - one source of truth for both consumers.
 *
 * No build target ships the fetched-content path today (loadContent()'s own
 * comment says so - "no build target currently ships that way"), so this
 * suite manufactures it: an init script makes `window.GUIDON_SEED` stay
 * undefined for the life of the page (the embedded seed's own
 * `window.GUIDON_SEED = ...` is a plain property assignment, not a
 * `const`/`let`, so a property override installed via addInitScript runs
 * first and simply swallows it). With no embedded seed, loadContent() takes
 * its fetch branch. `data/prt.json` is mocked (via page.route) to return
 * this repo's OWN real, committed drills[] (read live from src/index.html
 * with the same tools/seed-io.mjs reader lint-prt-sources.mjs uses, never a
 * fixture) with no sessions/pendingDrills baked in - because those were
 * NEVER part of any authored data file, only ever injected at runtime -
 * which is exactly the shape a real future multi-file deployment would
 * produce for prt.json today. Every OTHER data/*.json 404s (none of that
 * content matters to this suite) and loadContent() falls through to each of
 * those keys' own committed defaults, same as it always would. Run once
 * against the pre-fix code (pt-planner.js reading window.GUIDON_SEED.prt
 * directly): G.ptPlanner._session("strength") came back null,
 * _sessionSummary() came back "", and PT Planner's week view rendered no
 * "Session blocks:" line for Monday at all - confirmed red before writing
 * the fix this suite now guards.
 */
import { bootApp, check, finish, waitForRoute, until, expectNoConsoleNoise } from "./testkit.mjs";
import { readSeed } from "./seed-io.mjs";

const { data: committedSeed } = readSeed("src/index.html");
const realPrtDrills = (committedSeed.prt && committedSeed.prt.drills) || [];
if (!realPrtDrills.length) throw new Error("test-prt-session-fetched-seed: the committed seed has no prt.drills to mock data/prt.json with - has the seed changed shape?");

const boot = await bootApp({
  viewport: { width: 390, height: 844 },
  beforeLoad: async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "GUIDON_SEED", {
        configurable: true,
        get() { return undefined; },
        set() { /* swallow: simulate a build with no embedded seed at all */ },
      });
    });
    // A realistic fetched-content path: prt.json exists and carries the same
    // real drills[] the embedded seed ships, but - like every prt.json this
    // app has ever shipped - no sessions/pendingDrills, since those were
    // only ever added at runtime before this fix.
    await page.route("**/data/prt.json", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ drills: realPrtDrills }),
    }));
  },
});
const { page, noise } = boot;

const started = await until(page, () => !!(window.G && window.G.store && window.G.ptPlanner));
check(started, "the app finished starting with the seed override in place", "G.store/G.ptPlanner never appeared");

const seedState = await page.evaluate(() => ({
  hasEmbeddedSeed: !!window.GUIDON_SEED,
  prtMeta: window.G.store.prtMeta(),
}));
check(!seedState.hasEmbeddedSeed,
  "window.GUIDON_SEED stayed absent for the whole boot - this suite is really exercising the fetched-content path, not the embedded one",
  () => "window.GUIDON_SEED was present: " + JSON.stringify(seedState.hasEmbeddedSeed));

const meta = seedState.prtMeta || {};
const strengthSession = (meta.sessions || []).find((s) => s && s.id === "strength");
const strengthDrillIds = strengthSession && strengthSession.blocks ? strengthSession.blocks.map((b) => b.drillId) : null;
check(JSON.stringify(strengthDrillIds) === JSON.stringify(["pd", "ssd", "cd1", "cd2", "rd"]),
  "G.store.prtMeta() still returns the canonical Strength session block list on the fetched-content path",
  () => "prtMeta().sessions: " + JSON.stringify(meta.sessions));
check(!!meta.pendingDrills && Object.keys(meta.pendingDrills).length === 7,
  "...and the 7 not-yet-authored pending-drill labels",
  () => "prtMeta().pendingDrills: " + JSON.stringify(meta.pendingDrills));

const apiResult = await page.evaluate(() => ({
  session: window.G.ptPlanner._session("strength"),
  summary: window.G.ptPlanner._sessionSummary("strength"),
}));
check(!!apiResult.session && Array.isArray(apiResult.session.blocks) && apiResult.session.blocks.length === 5,
  'G.ptPlanner._session("strength") returns the real session, not null, on the fetched-content path',
  () => '_session("strength"): ' + JSON.stringify(apiResult.session));
check(/Preparation Drill/.test(apiResult.summary) && /content pending/.test(apiResult.summary),
  "...and _sessionSummary() names the real PD exercise plus the honest \"(content pending)\" labels for the rest",
  () => '_sessionSummary("strength"): ' + JSON.stringify(apiResult.summary));

// Drive the real screen too, not just the internal API: PT Planner's default
// "balanced" template puts the Strength session on Monday.
await waitForRoute(page, "#/pt-plan", { ready: '[data-pt-day="mon"]' });
const uiSummary = await page.locator('[data-pt-session-blocks="strength"]').first().textContent().catch(() => "");
check(/Preparation Drill/.test(uiSummary) && /content pending/.test(uiSummary),
  "PT Planner's week view renders Monday's real Strength session blocks from the shared model instead of an empty summary",
  () => "rendered session-blocks text: " + JSON.stringify(uiSummary));

// The 15 other fetch failures (every data/*.json besides the mocked
// prt.json - none of that content matters to this suite) are the whole
// point of this suite, not noise to hide - loadContent()'s own
// console.error("No content for", key, e) is exactly what should fire here.
expectNoConsoleNoise(noise, {
  ignore: [/404 \(Not Found\)/, /No content for \S+ Error: HTTP 404/],
  pass: "no console noise beyond the deliberately-provoked data/*.json 404s",
});

await finish("PRT SESSION FETCHED SEED");
