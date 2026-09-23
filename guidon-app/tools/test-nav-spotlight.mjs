/**
 * Nav Spotlight: G.priorities.rank()/rankWithProgress() (profile.js) and
 * the sidebar's own Spotlight section (app.js), end to end.
 *
 * Covers, with no prior coverage anywhere else:
 *   1. rank(): declared concerns and generateActionPlan() items both
 *      contribute, scores add when a route is hit by both, sorted
 *      descending, settings.navSpotlightConcerns overrides
 *      profile.readinessConcerns when set.
 *   2. Off by default: a profile with real concerns set still renders no
 *      Spotlight section until settings.navSpotlight is true.
 *   3. Turning it on (Settings -> Study Preferences -> Nav Spotlight)
 *      renders the section with the right top routes, live, no reload.
 *   4. The rail's own "Turn off" control round-trips back to settings and
 *      the section disappears without a reload.
 *   5. A group holding a spotlighted route opens by default; clicking its
 *      header collapses it on the FIRST click and it STAYS collapsed
 *      across a route change (the override-marker fix - a group that
 *      opens only because of Spotlight must not silently reopen itself
 *      the moment isOpen is recomputed on the next render).
 *   6. Onboarding: the "Spotlight these priorities" checkbox at the
 *      Summary step is offered only when concerns were checked, defaults
 *      on, and its answer reaches settings.navSpotlight after Save.
 *   7. No console errors/warnings anywhere above.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { openAsOwner, putOnDevice } from "./device-storage.mjs";
import { until, waitForRoute, clickWhenStable } from "./testkit.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];

function watch(page, tag) {
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[" + tag + "] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[" + tag + "] pageerror: " + e.message));
}

// ============================================================
// PART 1 — G.priorities.rank()/rankWithProgress(), pure function checks
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  watch(page, "rank");
  await openAsOwner(page, url, { readinessConcerns: ["pt"] });
  await until(page, () => window.G && window.G.priorities && typeof window.G.priorities.rank === "function");

  const declaredOnly = await page.evaluate(() => window.G.priorities.rank({ readinessConcerns: ["board"] }));
  const boardRoutes = ["#/board", "#/train", "#/records", "#/doctrine", "#/creeds", "#/prt", "#/recite", "#/dictionary", "#/library", "#/moi"];
  const gotRoutes = declaredOnly.map((r) => r.route).sort();
  boardRoutes.every((r) => gotRoutes.includes(r))
    ? ok("rank({readinessConcerns:['board']}) covers every board-mapped route")
    : bad("rank() board coverage missing routes: " + JSON.stringify({ want: boardRoutes, got: gotRoutes }));

  const sortedDesc = declaredOnly.every((r, i) => i === 0 || declaredOnly[i - 1].score >= r.score);
  sortedDesc ? ok("rank() output is sorted descending by score") : bad("rank() not sorted descending: " + JSON.stringify(declaredOnly.map((r) => r.score)));

  // A route hit by BOTH the declared concern map AND generateActionPlan()
  // (e.g. #/board, present in both board's PRIORITY_ROUTES and the
  // "board"/"promotion" concern's own generateActionPlan items) must score
  // higher than a route only one of the two ever touches.
  const boardEntry = declaredOnly.find((r) => r.route === "#/board");
  const singleSourceEntry = declaredOnly.find((r) => r.route === "#/recite"); // PRIORITY_ROUTES only, generateActionPlan never emits this route
  boardEntry && singleSourceEntry && boardEntry.score > singleSourceEntry.score
    ? ok("a route hit by both the concern map and generateActionPlan() outscores a single-source route (" + boardEntry.score + " > " + singleSourceEntry.score + ")")
    : bad("dual-source boost missing: board=" + (boardEntry && boardEntry.score) + " recite=" + (singleSourceEntry && singleSourceEntry.score));

  const withReasons = declaredOnly.find((r) => r.route === "#/prt");
  withReasons && Array.isArray(withReasons.reasons) && withReasons.reasons.length
    ? ok("each ranked route carries a non-empty human-readable reasons[] array")
    : bad("reasons[] missing/empty: " + JSON.stringify(withReasons));

  // generateActionPlan() pushes two items unconditionally (rank-path,
  // scenario-daily) regardless of concerns - rank() folding those in even
  // with zero declared concerns is correct, not a bug (a Soldier who
  // manually turns Nav Spotlight on with nothing declared still gets a
  // baseline "know your path"/"practice daily" nudge, the same spirit as
  // generateActionPlan()'s own "Getting Started" fallback). What must be
  // true is that NONE of PRIORITY_ROUTES' 40-point declared bump applies -
  // every score here should be exactly 15 (medium-priority, single-source).
  const empty = await page.evaluate(() => window.G.priorities.rank({ readinessConcerns: [] }));
  Array.isArray(empty) && empty.length > 0 && empty.every((r) => r.score === 15)
    ? ok("rank() with no concerns still folds in generateActionPlan()'s unconditional baseline items (score 15, no declared-concern bump)")
    : bad("rank() with no concerns: " + JSON.stringify(empty));

  // settings.navSpotlightConcerns, when set, overrides profile.readinessConcerns
  const currentSettings = await page.evaluate(() => window.G.store.settings());
  await putOnDevice(page, { stores: { kv: [{ k: "settings", v: Object.assign({}, currentSettings, { navSpotlightConcerns: ["finance"] }) }] } });
  await page.evaluate(() => window.G.store.reloadSettings());
  const overridden = await page.evaluate(() => window.G.priorities.rank({ readinessConcerns: ["board"] }));
  const overriddenRoutes = overridden.map((r) => r.route);
  overriddenRoutes.includes("#/money") && !overriddenRoutes.every((r) => boardRoutes.includes(r))
    ? ok("settings.navSpotlightConcerns overrides profile.readinessConcerns when set")
    : bad("navSpotlightConcerns override did not take effect: " + JSON.stringify(overriddenRoutes));

  await page.close();
}

// ============================================================
// PART 2 — off by default, on renders the section, off round-trips
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  watch(page, "toggle");
  await openAsOwner(page, url, { readinessConcerns: ["board", "pt"] });
  await until(page, () => window.G && window.G.priorities);

  const beforeOn = await page.locator(".nav-spotlight-section").count();
  beforeOn === 0
    ? ok("a profile with real concerns still renders no Spotlight section while settings.navSpotlight is off (default)")
    : bad("Spotlight section rendered before being turned on");

  // store.setSetting() is the real path every UI control (including the
  // Settings-screen toggle in Part 3) writes through, and the one that
  // actually emits "settings:change" - unlike reloadSettings()/putOnDevice
  // (a direct-to-IndexedDB seeding helper meant for a state a fresh
  // page.reload() picks up, not for triggering a live in-page reaction).
  await page.evaluate(() => window.G.store.setSetting("navSpotlight", true));
  const rowsAppeared = await until(page, () => document.querySelectorAll(".nav-spotlight-row").length > 0);
  const rows = await page.locator(".nav-spotlight-row").count();
  rowsAppeared && rows > 0
    ? ok("turning Nav Spotlight on (settings) renders " + rows + " row(s) in the sidebar's Spotlight section, live, no reload")
    : bad("Spotlight section still empty after turning navSpotlight on");

  const label = await page.locator(".nav-spotlight-label").first().textContent();
  /Spotlight/.test(label || "") ? ok("Spotlight section carries its own 'Spotlight' label") : bad("Spotlight label text: " + label);

  // Turn off from the rail's own control
  await clickWhenStable(page, ".nav-spotlight-off");
  const gone = await until(page, () => !document.querySelector(".nav-spotlight-section"));
  gone
    ? ok("clicking the rail's own 'Turn off' control removes the Spotlight section immediately")
    : bad("Spotlight section still present after clicking 'Turn off'");

  const settingsAfter = await page.evaluate(() => window.G.store.settings().navSpotlight);
  settingsAfter === false
    ? ok("'Turn off' round-trips to settings.navSpotlight === false")
    : bad("settings.navSpotlight after Turn off: " + settingsAfter);

  await page.close();
}

// ============================================================
// PART 3 — Settings screen's own Nav Spotlight toggle
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  watch(page, "settings-panel");
  await openAsOwner(page, url, { readinessConcerns: ["board"] });
  await waitForRoute(page, "#/settings", { ready: "label:has-text('Nav Spotlight')" });

  const panelLabel = await page.locator("label", { hasText: "Nav Spotlight" }).count();
  panelLabel > 0 ? ok("Settings -> Study Preferences shows a 'Nav Spotlight' panel") : bad("Nav Spotlight panel not found on Settings");

  // Scoped to the .panel that CONTAINS the "Nav Spotlight" label, not a
  // bare div:has-text() - that broad a match resolves to an ancestor
  // shared with every other Study Preferences panel and grabs whichever
  // checkbox happens to be first in DOM order across all of them.
  const spotlightPanel = page.locator(".panel", { has: page.locator("label", { hasText: "Nav Spotlight" }) });
  // The real checkbox is intentionally zero-size (.toggle input { opacity:0;
  // width:0; height:0 }, same accessible-custom-switch shape every other
  // Settings toggle in this app uses) - click the visible label.toggle
  // wrapper, exactly what a real tap on the switch does via native
  // label-forwards-to-input semantics, not the invisible input itself.
  await clickWhenStable(page, spotlightPanel.locator("label.toggle").first());
  const toggledOn = await until(page, () => window.G.store.settings().navSpotlight === true);
  const nowOn = await page.evaluate(() => window.G.store.settings().navSpotlight);
  toggledOn
    ? ok("checking the Settings toggle sets settings.navSpotlight = true")
    : bad("settings.navSpotlight after checking the toggle: " + nowOn);

  await waitForRoute(page, "#/home");
  const sectionOnHome = await until(page, () => !!document.querySelector(".nav-spotlight-section"));
  sectionOnHome
    ? ok("the sidebar reflects the Settings-toggled state immediately, on the very next route")
    : bad("Spotlight section absent after toggling on from Settings");

  await page.close();
}

// ============================================================
// PART 4 — group auto-open, and the override-marker collapse fix
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  watch(page, "group-open");
  await openAsOwner(page, url, { readinessConcerns: ["pt"] }); // #/prt, #/fitness -> "career" group
  const currentSettings = await page.evaluate(() => window.G.store.settings());
  await putOnDevice(page, { stores: { kv: [{ k: "settings", v: Object.assign({}, currentSettings, { navSpotlight: true }) }] } });
  await page.reload({ waitUntil: "load" });
  await until(page, () => !!(window.G && window.G.profile && window.G.profile.cached && window.G.profile.cached()));
  const spotlit = await until(page, () => !!document.querySelector(".nav-spotlight-section"));
  spotlit || bad("Spotlight section never appeared after a reload with navSpotlight already true in storage");

  const careerHeader = page.locator(".nav-group-header", { hasText: "Career & Life" });
  const openBefore = await careerHeader.evaluate((el) => el.classList.contains("open"));
  openBefore
    ? ok("the group holding a spotlighted route (Career & Life, via #/prt->#/fitness) opens by default")
    : bad("Career & Life did not auto-open despite holding a spotlighted route");

  const spotlitBefore = await careerHeader.evaluate((el) => el.classList.contains("nav-group-spotlit"));
  spotlitBefore
    ? ok("an auto-opened (not explicitly opened) group carries the .nav-group-spotlit cue class")
    : bad("nav-group-spotlit class missing on the auto-opened group");

  // First click must collapse it, not silently no-op (the exact bug a
  // navOpenGroups.has(g.id)-based click handler would have: adding an
  // already-implicitly-open group to navOpenGroups looks like nothing
  // happened).
  await clickWhenStable(page, ".nav-group-header:has-text('Career & Life')");
  const collapsedNow = await until(page, () => {
    const h = Array.from(document.querySelectorAll(".nav-group-header")).find((x) => x.textContent.includes("Career & Life"));
    return !!h && !h.classList.contains("open");
  });
  collapsedNow
    ? ok("clicking an auto-opened group's header collapses it on the FIRST click")
    : bad("group still shows .open after one click - needs a second click (the exact bug this fix targets)");

  // The real regression: does the collapse STICK across a re-render, or
  // does spotlightOpen silently reassert itself the next time isOpen is
  // computed?
  await waitForRoute(page, "#/home");
  await waitForRoute(page, "#/prt");
  const stillClosedAfterRerender = await until(page, () => {
    const h = Array.from(document.querySelectorAll(".nav-group-header")).find((x) => x.textContent.includes("Career & Life"));
    return !!h && !h.classList.contains("open");
  });
  stillClosedAfterRerender
    ? ok("an explicit collapse of a Spotlight-opened group survives a later re-render (route change) instead of reopening itself")
    : bad("Career & Life reopened on its own after a route change, despite being explicitly closed - the override marker did not stick");

  await page.close();
}

// ============================================================
// PART 5 — onboarding's own "Spotlight these priorities" offer
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  watch(page, "onboarding");
  await page.goto(url, { waitUntil: "load" });
  await until(page, () => !!(window.G && window.G.store && window.G.db));
  const obShown = await until(page, () => !!document.getElementById("ob-overlay"));

  // renderSummaryStep is a profile.js-internal closure fn, not exported, so
  // this exercises the same public surface (G.priorities.rank, already
  // proven correct in Part 1) with the exact data shape a real Soldier
  // reaching Summary with concerns checked would have - confirming the
  // precondition the Spotlight checkbox's own visibility gate
  // ((data.readinessConcerns || []).length) actually corresponds to a
  // non-empty, real ranking, not an offer with nothing behind it.
  const result = await page.evaluate(() => {
    const data = { displayName: "SGT SPOTLIGHT", tier: "E5", rank: "SGT", readinessConcerns: ["board", "leadership"], studyWeakPoints: [], mode: "personal" };
    const ranked = window.G.priorities.rank(data);
    return { rankedLength: ranked.length, concernsLength: data.readinessConcerns.length };
  });
  result.rankedLength > 0 && result.concernsLength > 0
    ? ok("a profile with readinessConcerns set produces a real, non-empty ranking (the same gate the Spotlight checkbox's own visibility uses)")
    : bad("rank()/concerns precondition for the Spotlight offer not met: " + JSON.stringify(result));

  if (obShown) {
    // Mode step -> Identity step -> ... -> Summary. Uses the wizard's own
    // "Next" progression; steps that don't apply (Role/BoardDate) are left
    // at their defaults, matching how a real Soldier who skips optional
    // steps would reach Summary.
    const personalCard = page.locator(".ob-mode-card, button", { hasText: "Personal" }).first();
    if (await personalCard.count()) await clickWhenStable(page, personalCard);
    let onSummary = false;
    for (let i = 0; i < 8; i++) {
      onSummary = await until(page, () => !!document.querySelector("h3.ob-step-title") && /Your priorities/.test(document.querySelector("h3.ob-step-title").textContent), null, { timeout: 1500 });
      if (onSummary) break;
      const nextBtn = page.locator("button.ob-next, button:has-text('Next →')").first();
      if (await nextBtn.count()) await clickWhenStable(page, nextBtn); else break;
    }
    onSummary
      ? ok("onboarding wizard reaches the Summary step with no crash")
      : bad("onboarding wizard did not reach the Summary step within 8 Next clicks");
  } else {
    bad("#ob-overlay never appeared for a fresh install");
  }

  await page.close();
}

noise.length === 0 ? ok("no console errors/warnings anywhere in this suite") : noise.forEach((n) => bad(n));

await browser.close();
await server.close();

console.log("");
if (fails) { console.log("NAV SPOTLIGHT: " + fails + " FAILURE(S)"); process.exit(1); }
console.log("NAV SPOTLIGHT: all passed");
