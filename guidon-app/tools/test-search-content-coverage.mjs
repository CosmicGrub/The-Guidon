/**
 * Global Search content-coverage pass (views.search / runSearch(), src/
 * index.html): three things shipped together and none had any test
 * coverage before this file.
 *
 *   1. A new "dictionary" hit type indexing G.dictionary/store.acronyms()'s
 *      ~3,641 terms - the single largest dataset in the app, previously
 *      completely absent from Global Search (only a generic "#/dictionary"
 *      screen chip, never a per-term hit).
 *   2. Real record-level indexing for four of the eight routes
 *      UNINDEXED_DOMAIN_HASHES used to list as having none at all: Forms
 *      (store.forms().forms, 34 DA/DD forms - the highest-value gap, since
 *      a Soldier typing a form number got nothing before this), Counsel
 *      (store.counsel().skills), Develop (store.idp().goalTemplates), and
 *      Health (store.resilience().skills + .resources). Forms additionally
 *      deep-links: clicking a Forms hit opens that exact form's own detail
 *      view (forms.js now consumes G.nav.seed("forms", id)), not just the
 *      bare catalog.
 *   3. Real relevance ranking (hitScore()): each type's group is sorted by
 *      score - title match > sub match > body match, exact/whole-word >
 *      substring - before the existing MAX_PER slice/cap, so a query that
 *      exactly names a record no longer loses to 7 other records that
 *      merely mention it, if the cap happens to have room for only 8.
 *
 * test-search-empty-domains.mjs already covers UNINDEXED_DOMAIN_HASHES
 * shrinking to 4 and Forms/Counsel/Develop/Health no longer appearing
 * there; this file covers the hit types themselves.
 *
 * No fixed sleeps (new-suite hygiene rule, tools/lint-test-hygiene.mjs): a
 * search filter CHIP's click handler reads the input's CURRENT value and
 * calls runSearch() synchronously (it does not wait on the 120ms debounce
 * the raw "input" event alone would) - so searchAndFilter() below sets the
 * query, clicks the chip, and reads the rendered result inside ONE
 * page.evaluate(), with no render ever caught mid-flight and nothing to
 * sleep out. Post-click navigation is confirmed with until() (same pattern
 * test-search-screens.mjs already uses), never a fixed wait.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { until, waitForRoute } from "./testkit.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);
// Same real inert/focus race test-search-screens.mjs already documents and
// waits out (dismissOnboarding can resolve while #app is still inert,
// silently blocking .fill()/.focus()) - unrelated to this suite's own
// feature, shared by every suite that types into #/search right after boot.
await until(page, () => !(document.getElementById("app") || {}).inert, undefined, { timeout: 3000 });

async function openSearch() {
  await waitForRoute(page, "#/search", { ready: 'input[type="search"]' });
}

async function searchAndFilter(query, chipLabel) {
  return page.evaluate(({ query, chipLabel }) => {
    const inp = document.querySelector('input[type="search"]');
    inp.focus();
    inp.value = query;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    const chip = [...document.querySelectorAll(".search-chip")].find((b) => b.textContent.includes(chipLabel));
    if (!chip) return { chipFound: false, count: 0, titles: [], subs: [], badges: [], moreText: "" };
    chip.click();
    const cards = [...document.querySelectorAll(".search-hit")];
    return {
      chipFound: true,
      count: cards.length,
      titles: cards.map((c) => c.querySelector(".search-hit-title")?.textContent || ""),
      subs: cards.map((c) => c.querySelector(".search-hit-sub")?.textContent || ""),
      badges: cards.map((c) => c.querySelector(".search-badge")?.textContent || ""),
      moreText: (document.querySelector(".search-more") || {}).textContent || "",
    };
  }, { query, chipLabel });
}

async function clickHitAndCheckHash(idx, expectedHash) {
  await page.locator(".search-hit").nth(idx).click();
  return until(page, (h) => location.hash === h, expectedHash, { timeout: 3000 });
}

/* ============ 1. Dictionary hit type ============ */
await openSearch();
const ncoerSnap = await searchAndFilter("NCOER", "Dictionary");
ncoerSnap.chipFound ? ok('the "Dictionary" filter chip is rendered and clickable') : bad('no "Dictionary" filter chip found');
ncoerSnap.count === 1 && ncoerSnap.titles[0] === "NCOER"
  ? ok('Dictionary-filtered query "NCOER" renders exactly one hit titled "NCOER"')
  : bad(`expected exactly one hit titled "NCOER", got count=${ncoerSnap.count} titles=${JSON.stringify(ncoerSnap.titles)}`);
/noncommissioned officer evaluation report/i.test(ncoerSnap.subs[0] || "")
  ? ok(`the hit's sub line is the real definition ("${ncoerSnap.subs[0]}")`)
  : bad(`unexpected sub line for the NCOER dictionary hit: "${ncoerSnap.subs[0]}"`);
ncoerSnap.badges[0] === "🔤"
  ? ok("the hit's badge icon matches TYPE_ICON.dictionary")
  : bad(`badge icon "${ncoerSnap.badges[0]}" does not match the expected dictionary icon`);

const dictNavOk = await clickHitAndCheckHash(0, "#/dictionary");
dictNavOk
  ? ok("clicking a dictionary search hit navigates to #/dictionary")
  : bad("clicking a dictionary search hit did not navigate to #/dictionary (got " + (await page.evaluate(() => location.hash)) + ")");

/* ============ 2. Relevance ranking ============ */
// "mos" (against the real seed) matches 9 dictionary terms: exactly ONE
// whose acronym IS "MOS" (Military Occupational Specialty - an exact
// title-field match) and 8 others (CFT, CMOS, IMAAC, MOSC, NARAC, NOAA,
// ROWPU, IoT) that merely mention "mos" somewhere in their own acronym or
// definition text (a substring/whole-word match, never exact). Verified
// against this exact build before writing this test. Filtered to the
// Dictionary type alone (MAX_PER=40, well above 9) so the cap can't be
// the thing deciding which 9 survive - this purely tests sort order.
await openSearch();
const mosSnap = await searchAndFilter("mos", "Dictionary");
mosSnap.count === 9
  ? ok(`Dictionary-filtered query "mos" renders the expected 9 hits`)
  : bad(`expected 9 dictionary hits for "mos", got ${mosSnap.count}: ${JSON.stringify(mosSnap.titles)}`);
mosSnap.titles[0] === "MOS"
  ? ok(`the exact-acronym match ("MOS") ranks FIRST among ${mosSnap.count} hits, ahead of 8 records that only mention "mos" in passing (real relevance ranking, not seed/insertion order) - order: ${mosSnap.titles.join(", ")}`)
  : bad(`ranking is wrong: expected "MOS" first, got order ${JSON.stringify(mosSnap.titles)}`);

/* ============ 3. Dictionary respects the existing MAX_PER cap ============ */
// "army" (against the real seed) matches well over 40 dictionary terms -
// Dictionary reuses the SAME MAX_PER convention every other type already
// has (40 when filtered to a single type), it doesn't get an unbounded
// render just because the underlying dataset (3,641 terms) is much bigger
// than any other type's.
await openSearch();
const armySnap = await searchAndFilter("army", "Dictionary");
armySnap.count === 40
  ? ok(`Dictionary caps a broad query ("army") at the same MAX_PER=40 every other single-type filter uses (rendered exactly ${armySnap.count} cards)`)
  : bad(`expected exactly 40 capped dictionary cards for "army", got ${armySnap.count}`);
/more — use type filter/i.test(armySnap.moreText)
  ? ok(`the "+N more" overflow message renders past the cap ("${armySnap.moreText}")`)
  : bad(`no "+N more" overflow message rendered for a query well past the cap: "${armySnap.moreText}"`);

/* ============ 4. Forms hit type + deep link to the specific form ============ */
// "4856" (against the real seed) matches exactly one of the 34 forms: DA
// Form 4856 (Developmental Counseling Form). It ALSO matches Dictionary's
// own "DA 4856" acronym entry (real, useful cross-domain overlap, not a
// bug - same "counsel" overlap pattern test-search-screens.mjs already
// documents for Forms/Counsel), so this filters to the "Forms" chip
// rather than assuming the first .search-hit-title anywhere is the Forms
// one.
await openSearch();
const formsSnap = await searchAndFilter("4856", "Forms");
formsSnap.chipFound ? ok('the "Forms" filter chip is rendered and clickable') : bad('no "Forms" filter chip found');
formsSnap.count === 1 && /^DA Form 4856/.test(formsSnap.titles[0] || "")
  ? ok(`Forms-filtered query "4856" renders exactly one hit ("${formsSnap.titles[0]}")`)
  : bad(`expected exactly one "DA Form 4856..." hit, got count=${formsSnap.count} titles=${JSON.stringify(formsSnap.titles)}`);
formsSnap.badges[0] === "📄"
  ? ok("the hit's badge icon matches TYPE_ICON.forms")
  : bad(`badge icon "${formsSnap.badges[0]}" does not match the expected forms icon`);

const formsNavOk = await clickHitAndCheckHash(0, "#/forms");
formsNavOk
  ? ok("clicking the Forms search hit navigates to #/forms")
  : bad("clicking the Forms search hit did not navigate to #/forms (got " + (await page.evaluate(() => location.hash)) + ")");
// openForm()'s own heading is `f.form + "  —  " + f.title` inside
// .forms-view .section-title (src/index.html) - a plain div, not an h2 -
// so its text proves this landed DIRECTLY on DA Form 4856's own detail
// view (the Global Search -> forms.js G.nav.seed("forms", ...) deep link),
// not just the bare #/forms catalog a plain hash match alone would allow.
const formsLanded = await until(page, () => {
  const h = document.querySelector(".forms-view .section-title");
  return !!h && /DA Form 4856/.test(h.textContent || "") && /Developmental Counseling/i.test(h.textContent || "");
}, undefined, { timeout: 3000 });
formsLanded
  ? ok('landed DIRECTLY on DA Form 4856\'s own detail view, not the bare catalog - the Global Search -> forms.js deep link works')
  : bad("did not land on DA Form 4856's own detail view - heading was: " + JSON.stringify(await page.evaluate(() => (document.querySelector(".forms-view .section-title") || {}).textContent || null)));

/* ============ 5. Counsel / Develop / Health hit types ============ */
// Each checked by filtering to its own type chip (robust to the query
// text also matching OTHER domains - "active listening"/"crisis line" are
// real English phrases, not guaranteed globally unique) rather than
// requiring a globally-unique query.
const domainChecks = [
  { chip: "Counseling", query: "active listening", expectTitle: "Qualities of an effective counselor", route: "#/counsel" },
  { chip: "IDP / Development", query: "blc", expectTitle: "Complete Basic Leader Course (BLC)", route: "#/develop" },
  { chip: "Health & Resilience", query: "crisis line", expectTitle: "Veterans Crisis Line", route: "#/health" },
];
for (const dc of domainChecks) {
  await openSearch();
  const snap = await searchAndFilter(dc.query, dc.chip);
  if (!snap.chipFound) { bad(`no "${dc.chip}" filter chip found`); continue; }
  const idx = snap.titles.indexOf(dc.expectTitle);
  idx >= 0
    ? ok(`"${dc.chip}" filtered query "${dc.query}" includes the expected real hit ("${dc.expectTitle}")`)
    : bad(`"${dc.chip}" filtered query "${dc.query}" (${snap.count} hit(s): ${JSON.stringify(snap.titles)}) did not include "${dc.expectTitle}"`);
  if (idx >= 0) {
    const navOk = await clickHitAndCheckHash(idx, dc.route);
    navOk
      ? ok(`clicking the "${dc.expectTitle}" hit navigates to ${dc.route}`)
      : bad(`clicking the "${dc.expectTitle}" hit did not navigate to ${dc.route} (got ${await page.evaluate(() => location.hash)})`);
  }
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSEARCH CONTENT COVERAGE: all passed");
process.exit(fails ? 1 : 0);
