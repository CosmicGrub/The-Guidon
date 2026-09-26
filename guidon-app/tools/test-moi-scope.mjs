/**
 * MOI Scope (ROADMAP 3g phase 2, MOI Import Phase 2): the real design
 * question Phase 1's multi-plan rewrite raised (PR #210, merged) - with more
 * than one saved MOI plan FAMILY now possible (a Soldier prepping for two
 * boards, or keeping an old board's plan around), which family's topics
 * should narrow #/board and #/doctrine? Resolved as PER-FAMILY OPT-IN, never
 * a single global switch: each saved family gets its own "In Scope" toggle,
 * OFF by default (the same hidden-by-default precedent G.mosDecks already
 * set for MOS Decks - 00-mos-decks-core.js), and the active filter is the
 * UNION of every family currently opted in (G.moiImport.activeFocusSet(),
 * src/app-modules/moi-import.js).
 *
 * WHY THIS SUITE EXISTS: without it, a regression that quietly replaced the
 * union with "last toggle wins" (or dropped filtering to always-off, or
 * always-on) would ship undetected - test-moi-import.mjs never opts anything
 * "In Scope" and would keep passing either way. This is the one place the
 * per-family union, the honest narrowed-pool banner, and Settings' mirrored
 * toggle list staying in sync with the in-route ones are all proven together
 * against the real running app.
 *
 * Every expected pool size is computed from the RUNNING app's own real
 * corpus (never a literal count) via two REAL citations the live matching
 * pipeline (G.moiImport.tokenizeCitations/matchCitation) resolves at test
 * time, picked so their topics/board categories are genuinely DISJOINT - see
 * pickDisjointFixtures() below. That is what lets this suite assert the
 * union is exactly expA + expB (not just ">= max(expA, expB)") without ever
 * hardcoding a citation, topic or category name that a future content change
 * could silently invalidate.
 *
 * House rules (tools/lint-test-hygiene.mjs holds this suite to all of them):
 *   - no fixed sleeps: waitForRoute(page, hash, { ready }), until(page, fn),
 *     clickWhenStable / a real DOM click() wait for the STATE instead;
 *   - no swallowed waits: until() returns true/false - assert on what follows;
 *   - no literal deck/pool sizes: every expected count is read from the
 *     running app;
 *   - one browser: bootApp() once;
 *   - drive the real screen (the plan card's own toggle, the opened family's
 *     own toggle, Settings' mirrored checkbox), never stub the thing under
 *     test.
 */
import { bootApp, check, finish, waitForRoute, until, expectNoConsoleNoise, waitForBoot, PERSONAL_PROFILE } from "./testkit.mjs";

// Not exported by G.moiImport (only KEY/PLANS_KEY/diffPlans/render/the pure
// matching functions/the Part E scope API are - see its own export table) -
// same hardcoded-literal convention test-moi-import.mjs already uses for
// this exact constant.
const LEGACY_MIGRATED_FLAG = "guidon:moi:legacyMigrated:v1";

// The Settings/plan-card checkbox is visually hidden behind this app's
// custom "switch" look (a styled <span class="track"> sibling carries the
// visible control) - same idiom as MOS Decks' own toggle. A Playwright
// locator.click() refuses it as "attached but not visible"; test-mos-decks.mjs
// hits the same thing and works around it with a real DOM .click() from
// inside the page, which does not require visibility.
const clickCheckbox = (locator) => locator.evaluate((el) => el.click());

// A REAL, PERSISTED profile, not the default "guest" - this suite reloads
// the page mid-run (after seeding the two plan-family fixtures directly
// into kv, so app.start()'s own boot-time cache warm sees them - see
// store.init()'s own comment in index.html), and a Guest/Kiosk session
// deliberately saves NOTHING durable (this app's own "Guest sessions save
// nothing" storage-layer rule), so the welcome screen would reopen on that
// reload and every route below it would be unreachable.
const boot = await bootApp({ viewport: { width: 390, height: 844 }, profile: PERSONAL_PROFILE });
const { page, noise } = boot;

/* ------------------------------------------------------------------------
   Clean slate - same convention test-moi-import.mjs uses: these keys can
   carry state across test runs on a shared profile.
   ------------------------------------------------------------------------ */
await page.evaluate(async (FLAG) => {
  await window.G.db.put("kv", { k: window.G.moiImport.KEY, v: null });
  await window.G.db.put("kv", { k: window.G.moiImport.PLANS_KEY, v: [] });
  await window.G.db.setSetting(FLAG, false);
  await window.G.store.setSetting("moiScopeFamilies", []);
}, LEGACY_MIGRATED_FLAG);

/* ------------------------------------------------------------------------
   Build two REAL, genuinely DISJOINT plan-family fixtures from the live
   matching pipeline against the current corpus - never hand-typed topic or
   category names. Mirrors exactly what build() (moi-import.js) persists for
   an accepted citation, without driving the whole capture/review/build
   wizard (already fully covered by test-moi-import.mjs) - this suite's job
   is the scope FILTER layered on top of two already-saved plans.
   ------------------------------------------------------------------------ */
const fixtures = await page.evaluate(() => {
  const board = window.G.store.boardQuestions();
  const doctrineList = window.G.store.doctrine("");
  const M = window.G.moiImport;

  // Every real citation cited by at least one board question's own source,
  // with real doctrine AND self-check coverage and at least one real board
  // category - the exact shape build() needs to populate topicLinks[t]
  // .boardCategory for every one of its topics (see activeFocusSet()'s own
  // comment on why that field, not generatedDrillCategories).
  const seen = new Map();
  for (const q of board) {
    for (const raw of M.tokenizeCitations(window.G.board.sourceText(q))) {
      const m = M.matchCitation(raw);
      if (m.tier === "unmatched") continue;
      if (!m.counts || !(m.counts.doctrineCards > 0) || !(m.counts.selfCheckQuestions > 0)) continue;
      if (!m.boardCategories || !m.boardCategories.length) continue;
      if (!m.topics || !m.topics.length) continue;
      seen.set(m.normalized, m);
    }
  }
  const entries = Array.from(seen.values());

  // A genuinely disjoint pair: no shared topic, no shared board category
  // (build() always assigns topicLinks[t].boardCategory = m.boardCategories[0]
  // for every topic under one citation, so comparing just index 0 is what
  // the persisted family objects actually carry).
  let mA = null, mB = null;
  outer:
  for (let i = 0; i < entries.length; i++) {
    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue;
      const a = entries[i], b = entries[j];
      const topicOverlap = a.topics.some((t) => b.topics.includes(t));
      const catOverlap = a.boardCategories[0] === b.boardCategories[0];
      if (!topicOverlap && !catOverlap) { mA = a; mB = b; break outer; }
    }
  }

  function familyFromMatch(id, name, m) {
    if (!m) return null;
    const topics = m.topics.slice();
    const topicCoverage = {}, topicLinks = {}, topicTiers = {};
    topics.forEach((t) => {
      const c = (m.topicCounts && m.topicCounts[t]) || m.counts;
      topicCoverage[t] = { doctrineCards: c.doctrineCards, selfCheckQuestions: c.selfCheckQuestions };
      topicLinks[t] = { citationKey: m.normalized, boardCategory: m.boardCategories[0] };
      topicTiers[t] = m.tier;
    });
    return {
      id, createdAt: Date.now(),
      current: { name, importedAt: Date.now(), topics, topicCoverage, topicLinks, topicTiers, groups: null, generatedDrillCategories: [] },
      history: [],
    };
  }
  const famA = familyFromMatch("moi-scope-fixture-a", "Board A Study Plan", mA);
  const famB = familyFromMatch("moi-scope-fixture-b", "Board B Study Plan", mB);

  function pools(fam) {
    if (!fam) return null;
    const cats = new Set(Object.values(fam.current.topicLinks).map((l) => l.boardCategory).filter(Boolean));
    const topics = new Set(fam.current.topics);
    return {
      board: board.filter((q) => cats.has(q.category)).length,
      doctrine: doctrineList.filter((d) => topics.has(d.topic)).length,
    };
  }
  const expA = pools(famA), expB = pools(famB);
  let expUnion = null;
  if (famA && famB) {
    const cats = new Set([].concat(
      Object.values(famA.current.topicLinks).map((l) => l.boardCategory),
      Object.values(famB.current.topicLinks).map((l) => l.boardCategory)
    ).filter(Boolean));
    const topics = new Set(famA.current.topics.concat(famB.current.topics));
    expUnion = {
      board: board.filter((q) => cats.has(q.category)).length,
      doctrine: doctrineList.filter((d) => topics.has(d.topic)).length,
    };
  }
  return { famA, famB, expA, expB, expUnion, totalBoard: board.length, totalDoctrine: doctrineList.length, candidateCount: entries.length, plansKey: M.PLANS_KEY };
});

check(!!(fixtures.famA && fixtures.famB), "found two genuinely disjoint real citations to build plan-family fixtures from",
  () => `only ${fixtures.candidateCount} qualifying candidate citation(s) in the live corpus - could not find a disjoint pair`);
check(fixtures.expA && fixtures.expA.board > 0 && fixtures.expA.board < fixtures.totalBoard,
  `family A's fixture narrows the board pool to a real, smaller-than-full count (${fixtures.expA && fixtures.expA.board}/${fixtures.totalBoard})`,
  () => "fixture A pools: " + JSON.stringify(fixtures.expA));
check(fixtures.expB && fixtures.expB.board > 0 && fixtures.expB.board < fixtures.totalBoard,
  `family B's fixture narrows the board pool to a real, smaller-than-full count (${fixtures.expB && fixtures.expB.board}/${fixtures.totalBoard})`,
  () => "fixture B pools: " + JSON.stringify(fixtures.expB));
check(fixtures.expUnion && fixtures.expUnion.board === fixtures.expA.board + fixtures.expB.board,
  `the two fixtures' board pools are genuinely disjoint - union (${fixtures.expUnion && fixtures.expUnion.board}) equals the exact sum of A (${fixtures.expA.board}) + B (${fixtures.expB.board})`,
  () => JSON.stringify(fixtures.expUnion));
check(fixtures.expUnion && fixtures.expUnion.doctrine === fixtures.expA.doctrine + fixtures.expB.doctrine,
  `...and the same for the doctrine pools (${fixtures.expUnion && fixtures.expUnion.doctrine} = ${fixtures.expA.doctrine} + ${fixtures.expB.doctrine})`,
  () => JSON.stringify(fixtures.expUnion));

const famAName = fixtures.famA.current.name;
const famBName = fixtures.famB.current.name;
const cbSelA = `input[aria-label="Narrow Board Drill and Doctrine to ${famAName}'s topics"]`;
const cbSelB = `input[aria-label="Narrow Board Drill and Doctrine to ${famBName}'s topics"]`;

/* ------------------------------------------------------------------------
   Seed both families and reload - a cold, full boot from a device that
   already has two saved plans, nothing opted in yet.
   ------------------------------------------------------------------------ */
await page.evaluate(async ({ famA, famB, plansKey }) => {
  await window.G.db.put("kv", { k: plansKey, v: [famA, famB] });
}, { famA: fixtures.famA, famB: fixtures.famB, plansKey: fixtures.plansKey });
await page.reload({ waitUntil: "load" });
await waitForBoot(page);
check((await page.locator("#ob-overlay").count()) === 0, "the welcome screen does not reopen on reload (the earlier guest/onboarding dismissal survived)", "the welcome screen reopened after reload");

/* ------------------------------------------------------------------------
   (1) Baseline: two saved families, nothing opted in - the pool is
   unfiltered, and G.moiImport's cache was warmed AT BOOT (store.init()),
   even though #/moi has not rendered yet this session.
   ------------------------------------------------------------------------ */
const baseline = await page.evaluate(() => ({
  optedIn: window.G.store.settings().moiScopeFamilies || [],
  boardLen: window.G.store.boardQuestions().length,
  doctrineLen: window.G.store.doctrine("").length,
  cachedFamiliesLen: (window.G.moiImport.cachedFamilies() || []).length,
}));
check(Array.isArray(baseline.optedIn) && baseline.optedIn.length === 0, "moiScopeFamilies starts empty - off by default for every saved family", () => JSON.stringify(baseline.optedIn));
check(baseline.boardLen === fixtures.totalBoard, `with nothing opted in, the board pool is the full, unfiltered corpus (${fixtures.totalBoard})`, () => `got ${baseline.boardLen}`);
check(baseline.doctrineLen === fixtures.totalDoctrine, `...and so is the doctrine pool (${fixtures.totalDoctrine})`, () => `got ${baseline.doctrineLen}`);
check(baseline.cachedFamiliesLen === 2, "G.moiImport.cachedFamilies() already holds both saved families right after boot - the cache was warmed by store.init(), not left cold until #/moi first renders", () => `cachedFamilies() returned ${baseline.cachedFamiliesLen} familie(s)`);

/* ------------------------------------------------------------------------
   (2) Opting family A in from its own card on #/moi narrows the pool to
   exactly its own topics/categories.
   ------------------------------------------------------------------------ */
await waitForRoute(page, "#/moi", { ready: ".card-results-grid" });
const cardCbA = page.locator(cbSelA);
const cardCbACount = await cardCbA.count();
check(cardCbACount === 1, `#/moi's plan menu shows exactly one In Scope checkbox for "${famAName}"`, () => cardCbACount + " matched");
check(!(await cardCbA.isChecked()), "the card's checkbox starts unchecked (off by default)", "the checkbox was already checked before this suite touched it");
await clickCheckbox(cardCbA);
await until(page, (id) => (window.G.moiImport.inScopeIds() || []).indexOf(id) !== -1, fixtures.famA.id);
const optedInAfterCardClick = await page.evaluate(() => window.G.moiImport.inScopeIds());
check(optedInAfterCardClick.indexOf(fixtures.famA.id) !== -1, "checking the card's box calls G.moiImport.setInScope(familyId, true)", () => JSON.stringify(optedInAfterCardClick));

await waitForRoute(page, "#/board", { ready: ".qz-front .qz-prompt" });
const boardAfterA = await page.evaluate(() => window.G.store.boardQuestions().length);
check(boardAfterA === fixtures.expA.board, `#/board's pool narrows to exactly family A's ${fixtures.expA.board} board-category-matched cards`, () => `got ${boardAfterA}`);
const bannerA = await page.evaluate(() => { const b = document.querySelector(".moi-scope-banner"); return b ? b.textContent : null; });
check(!!(bannerA && bannerA.includes(famAName)), "a visible, honest banner names the active MOI scope on #/board", () => "banner text: " + JSON.stringify(bannerA));

await waitForRoute(page, "#/doctrine", { ready: "input[aria-label=\"Search doctrine\"]" });
const doctrineAfterA = await page.evaluate(() => window.G.store.doctrine("").length);
check(doctrineAfterA === fixtures.expA.doctrine, `#/doctrine's pool narrows to exactly family A's ${fixtures.expA.doctrine} topic-matched entries`, () => `got ${doctrineAfterA}`);
const bannerADoc = await page.evaluate(() => { const b = document.querySelector(".moi-scope-banner"); return b ? b.textContent : null; });
check(!!(bannerADoc && bannerADoc.includes(famAName)), "...and the same honest banner appears on #/doctrine", () => "banner text: " + JSON.stringify(bannerADoc));

/* ------------------------------------------------------------------------
   (3) Settings' mirrored list is in sync with the in-route toggle, and
   opting family B in from THERE expands the pool to the union (not a
   replacement).
   ------------------------------------------------------------------------ */
await waitForRoute(page, "#/settings", { ready: page.locator("label", { hasText: "MOI Plans" }) });
const settingsCbA = page.locator(cbSelA);
check(await settingsCbA.isChecked(), "Settings' own mirrored checkbox for family A already shows checked - it stays in sync with the card toggle, no separate action needed", "Settings' checkbox for family A was not checked after opting in from the card");
const settingsCbB = page.locator(cbSelB);
const settingsCbBCount = await settingsCbB.count();
check(settingsCbBCount === 1, `Settings lists exactly one checkbox for the second saved family ("${famBName}")`, () => settingsCbBCount + " matched");
check(!(await settingsCbB.isChecked()), "family B's checkbox starts unchecked", "family B's checkbox was already checked");
await clickCheckbox(settingsCbB);
await until(page, (id) => (window.G.moiImport.inScopeIds() || []).indexOf(id) !== -1, fixtures.famB.id);

await waitForRoute(page, "#/board", { ready: ".qz-front .qz-prompt" });
const boardUnion = await page.evaluate(() => window.G.store.boardQuestions().length);
check(boardUnion === fixtures.expUnion.board, `opting a SECOND family in from Settings EXPANDS #/board's pool to the union (${fixtures.expUnion.board}), not a replacement`, () => `got ${boardUnion} (family A alone was ${fixtures.expA.board}, family B alone would be ${fixtures.expB.board})`);
const bannerUnion = await page.evaluate(() => { const b = document.querySelector(".moi-scope-banner"); return b ? b.textContent : null; });
check(!!(bannerUnion && bannerUnion.includes(famAName) && bannerUnion.includes(famBName)), "the banner now names BOTH opted-in plans", () => "banner text: " + JSON.stringify(bannerUnion));

await waitForRoute(page, "#/doctrine", { ready: "input[aria-label=\"Search doctrine\"]" });
const doctrineUnion = await page.evaluate(() => window.G.store.doctrine("").length);
check(doctrineUnion === fixtures.expUnion.doctrine, `...and #/doctrine's pool expands to the union too (${fixtures.expUnion.doctrine})`, () => `got ${doctrineUnion}`);

/* ------------------------------------------------------------------------
   (4) The opened family's own detail view (openPlan) carries the identical
   toggle, in sync with the card and Settings.
   ------------------------------------------------------------------------ */
await waitForRoute(page, "#/moi", { ready: ".card-results-grid" });
await page.evaluate((name) => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(name));
  if (btn) btn.click();
}, famAName);
await until(page, () => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Delete"));
const detailCbA = page.locator(cbSelA);
const detailCbACount = await detailCbA.count();
check(detailCbACount === 1, "opening family A's own detail view (openPlan) shows its In Scope toggle too", () => detailCbACount + " matched");
check(await detailCbA.isChecked(), "...already checked, in sync with the card/Settings toggle for the same family", "the detail view's toggle disagreed with the card/Settings state");

/* ------------------------------------------------------------------------
   (5) Opting every family back out (this time from the detail view, and
   the plan menu) restores the full corpus and removes the banner.
   ------------------------------------------------------------------------ */
await clickCheckbox(detailCbA);
await until(page, (id) => (window.G.moiImport.inScopeIds() || []).indexOf(id) === -1, fixtures.famA.id);

// Still hash "#/moi" (the toggle's own handler redraws openPlan() in
// place, same route, same hash) - { fresh: true } leaves for another
// screen and back so the route is genuinely rebuilt from scratch and
// lands back on the plan menu (landing()'s own families.length branch),
// not left showing the detail view's own stale DOM.
await waitForRoute(page, "#/moi", { ready: ".card-results-grid", fresh: true });
const cardCbB = page.locator(cbSelB);
check(await cardCbB.isChecked(), "family B's card toggle still shows checked (opted in from Settings earlier)", "family B's card toggle lost its checked state");
await clickCheckbox(cardCbB);
await until(page, (id) => (window.G.moiImport.inScopeIds() || []).indexOf(id) === -1, fixtures.famB.id);
const optedInAfterBothOff = await page.evaluate(() => window.G.moiImport.inScopeIds());
check(Array.isArray(optedInAfterBothOff) && optedInAfterBothOff.length === 0, "unchecking both families' toggles leaves moiScopeFamilies empty again", () => JSON.stringify(optedInAfterBothOff));

await waitForRoute(page, "#/board", { ready: ".qz-front .qz-prompt" });
const boardRestored = await page.evaluate(() => window.G.store.boardQuestions().length);
check(boardRestored === fixtures.totalBoard, `opting every family back out restores the full ${fixtures.totalBoard}-card board corpus`, () => `got ${boardRestored}`);
const bannerGoneBoard = await page.evaluate(() => !document.querySelector(".moi-scope-banner"));
check(bannerGoneBoard, "the narrowed-pool banner disappears from #/board once every family is opted out", "the .moi-scope-banner is still present with nothing opted in");

await waitForRoute(page, "#/doctrine", { ready: "input[aria-label=\"Search doctrine\"]" });
const doctrineRestored = await page.evaluate(() => window.G.store.doctrine("").length);
check(doctrineRestored === fixtures.totalDoctrine, `...and the full ${fixtures.totalDoctrine}-entry doctrine corpus`, () => `got ${doctrineRestored}`);
const bannerGoneDoc = await page.evaluate(() => !document.querySelector(".moi-scope-banner"));
check(bannerGoneDoc, "...and the banner disappears from #/doctrine too", "the .moi-scope-banner is still present on #/doctrine with nothing opted in");

/* ------------------------------------------------------------------------
   (6) Independence from MOS Decks' own opt-in filter (a real risk: two
   filters sharing store.boardQuestions()'s cache-key idiom could silently
   interfere with each other's invalidation).
   ------------------------------------------------------------------------ */
const mosUnaffected = await page.evaluate(() => ({
  mosOptedIn: (window.G.mosDecks && window.G.mosDecks.optedIn) ? window.G.mosDecks.optedIn() : null,
  boardLen: window.G.store.boardQuestions().length,
}));
check(Array.isArray(mosUnaffected.mosOptedIn) && mosUnaffected.mosOptedIn.length === 0, "toggling MOI Scope opt-ins never touched G.mosDecks' own opt-in array", () => JSON.stringify(mosUnaffected.mosOptedIn));
check(mosUnaffected.boardLen === fixtures.totalBoard, "the board pool is still the full corpus after every MOI Scope toggle exercised above - the two independent opt-in filters did not leave a stray narrowing behind", () => `got ${mosUnaffected.boardLen}`);

expectNoConsoleNoise(noise);
await finish("MOI SCOPE");
