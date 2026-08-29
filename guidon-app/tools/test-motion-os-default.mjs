/**
 * OS-level prefers-reduced-motion wired to the app's own motion setting -
 * "Reading the Cards" Roadmap Tier 6c, item D.
 *
 * The global CSS `@media (prefers-reduced-motion: reduce)` rule only zeroed
 * transition/animation duration - it never set the app's own `.reduce-
 * motion`/`data-motion="minimal"` state, which was driven solely by a
 * persisted Settings toggle (theme.applyMotion()). A person with OS-level
 * reduced motion who never touched Settings still got the full 3D flip.
 *
 * Fix: on app init, if matchMedia('(prefers-reduced-motion: reduce)')
 * matches AND the person has never explicitly set a motion preference
 * (DEFAULT_SETTINGS.motionUserSet, a new flag - see its own comment in
 * src/index.html), default the app's motion to minimal/reduce-motion. An
 * explicit choice (via Settings -> Appearance -> Motion, or the legacy
 * "Reduce motion" checkbox) sets motionUserSet true and is never
 * overridden, even one that contradicts OS reduce-motion. A settings row
 * that already existed before this flag shipped is backfilled
 * motionUserSet:true (not DEFAULT_SETTINGS's own false), so an existing
 * installation's prior behavior is never re-litigated by this new logic.
 *
 * This suite uses Playwright's `reducedMotion: "reduce"` context option
 * (real matchMedia emulation, not a stub) throughout.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootGuest(page) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(1100);
}

/* ---- (1) Fresh install, OS reduce-motion ON, never touched Settings -
   the app's own motion state should default to minimal, live, WITHOUT
   ever persisting that as the stored `motion` value. ---- */
{
  const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await bootGuest(page);

  const state = await page.evaluate(() => ({
    dataMotion: document.documentElement.getAttribute("data-motion"),
    reduceMotionClass: document.documentElement.classList.contains("reduce-motion"),
    storedMotion: window.G.store.settings().motion,
    motionUserSet: window.G.store.settings().motionUserSet,
  }));
  state.dataMotion === "minimal"
    ? ok("fresh install + OS reduce-motion: data-motion defaults to 'minimal' with zero Settings interaction")
    : bad(`fresh install + OS reduce-motion: data-motion is "${state.dataMotion}", expected "minimal"`);
  state.reduceMotionClass
    ? ok("fresh install + OS reduce-motion: html.reduce-motion class is present")
    : bad("fresh install + OS reduce-motion: html.reduce-motion class is missing");
  state.storedMotion === "rich"
    ? ok(`the OS-default override is LIVE-ONLY, not persisted - the real stored \`motion\` setting is still "${state.storedMotion}" (DEFAULT_SETTINGS' own default)`)
    : bad(`the OS-default override was incorrectly persisted to storage - stored motion is "${state.storedMotion}", expected it to remain "rich"`);
  state.motionUserSet === false
    ? ok("motionUserSet correctly stays false for a genuinely fresh, never-touched install")
    : bad(`motionUserSet is ${state.motionUserSet}, expected false for a fresh install`);

  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("fresh-install case: no console errors/warnings") : bad("fresh-install console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- (2) OS reduce-motion OFF entirely (sanity): the app should behave
   exactly as before this fix - motion stays at its normal default, no
   accidental universal override. ---- */
{
  const page = await (await browser.newContext({ reducedMotion: "no-preference" })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await bootGuest(page);
  const dataMotion = await page.evaluate(() => document.documentElement.getAttribute("data-motion"));
  dataMotion === "rich"
    ? ok("OS reduce-motion OFF: data-motion stays at the normal 'rich' default (no accidental universal override)")
    : bad(`OS reduce-motion OFF: data-motion is "${dataMotion}", expected "rich"`);
  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("OS-off sanity: no console errors/warnings") : bad("OS-off sanity console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- (3) An explicit user choice (even one that CONTRADICTS OS
   reduce-motion) must survive a reload untouched - the whole point of
   motionUserSet. Sets motion to "rich" via the app's own real
   theme.set("motion", ...) API (same convention test-settings-toggles.mjs
   already uses: "set via the app's own real API" rather than clicking
   every UI control), matching what the Appearance -> Motion picker itself
   calls. ---- */
{
  const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await bootGuest(page);
  // Precondition: before any explicit choice, OS reduce-motion still wins.
  const before = await page.evaluate(() => document.documentElement.getAttribute("data-motion"));
  before === "minimal"
    ? ok("explicit-choice precondition: starts at 'minimal' (OS default, motionUserSet not yet set)")
    : bad(`explicit-choice precondition: expected 'minimal' before the explicit choice, got "${before}"`);

  // The person explicitly (re-)selects Rich in Settings -> Appearance ->
  // Motion, despite their OS having reduce-motion on.
  await page.evaluate(() => window.G.theme.set("motion", "rich"));
  await page.waitForTimeout(400); // debounced settings save
  const afterChoice = await page.evaluate(() => ({
    dataMotion: document.documentElement.getAttribute("data-motion"),
    motionUserSet: window.G.store.settings().motionUserSet,
  }));
  afterChoice.dataMotion === "rich"
    ? ok("choosing Rich explicitly immediately applies 'rich', overriding the OS-default 'minimal' that was showing")
    : bad(`after explicitly choosing Rich, data-motion is "${afterChoice.dataMotion}", expected "rich"`);
  afterChoice.motionUserSet === true
    ? ok("choosing a motion option via theme.set() sets motionUserSet true")
    : bad(`motionUserSet is ${afterChoice.motionUserSet} after an explicit theme.set(\"motion\",...) call, expected true`);

  // The real test: reload (a fresh app.start() boot) with OS reduce-motion
  // STILL on - the explicit "rich" choice must stick, not get overridden.
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1100);
  const afterReload = await page.evaluate(() => document.documentElement.getAttribute("data-motion"));
  afterReload === "rich"
    ? ok("after a fresh reload with OS reduce-motion still ON, the explicit 'rich' choice is respected (NOT silently overridden to minimal)")
    : bad(`after reload, data-motion is "${afterReload}", expected "rich" (an explicit user choice was overridden)`);

  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("explicit-choice case: no console errors/warnings") : bad("explicit-choice console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- (4) Backward compatibility: a settings row that already existed
   BEFORE motionUserSet shipped (simulated here via a direct low-level
   window.G.db.setSetting("settings", {...}) write - the same raw DB
   access test-schema-migration.mjs already uses for this kind of
   before-the-fact-schema simulation - deliberately omitting the
   motionUserSet key) must NOT be newly eligible for the OS-default
   override on its next boot, even though its `motion` value is the
   ordinary "rich" default and this "install" never technically made an
   explicit choice in this fake scenario. This is the deliberate,
   documented tradeoff: an existing installation's established behavior
   is never second-guessed by this new logic. ---- */
{
  const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await bootGuest(page);

  // Seed a minimal "legacy" settings row directly at the DB layer -
  // bypassing store.setSetting (which merges into the already-fully-keyed
  // in-memory state.settings) so the written record genuinely lacks
  // motionUserSet, the same way a real pre-existing row would.
  await page.evaluate(() => window.G.db.setSetting("settings", { theme: "field-manual", motion: "rich", reduceMotion: false, lightMode: false }));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1100);

  const afterReload = await page.evaluate(() => ({
    dataMotion: document.documentElement.getAttribute("data-motion"),
    motionUserSet: window.G.store.settings().motionUserSet,
    storedMotion: window.G.store.settings().motion,
  }));
  afterReload.motionUserSet === true
    ? ok("a pre-existing settings row missing motionUserSet is backfilled to true on load (not DEFAULT_SETTINGS' own false)")
    : bad(`motionUserSet after loading a legacy settings row is ${afterReload.motionUserSet}, expected true (backfilled)`);
  afterReload.dataMotion === "rich"
    ? ok("a pre-existing (simulated) installation's motion setting is NOT overridden by the new OS-default logic, even with OS reduce-motion on")
    : bad(`a pre-existing settings row's data-motion is "${afterReload.dataMotion}" after reload, expected "rich" (should not have been re-litigated)`);
  afterReload.storedMotion === "rich"
    ? ok("the stored motion value for the legacy row is untouched (\"rich\")")
    : bad(`stored motion for the legacy row is "${afterReload.storedMotion}", expected "rich"`);

  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("legacy-row case: no console errors/warnings") : bad("legacy-row console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `MOTION OS DEFAULT: ${fails} FAILURE(S)` : "MOTION OS DEFAULT: all passed"));
process.exit(fails ? 1 : 0);
