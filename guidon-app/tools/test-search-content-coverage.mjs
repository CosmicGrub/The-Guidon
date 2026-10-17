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
// "mos" (against the real seed) matches 10 dictionary terms: exactly ONE
// whose acronym IS "MOS" (Military Occupational Specialty - an exact
// title-field match) and 9 others (CFT, CMOS, IMAAC, MOSC, NARAC, NOAA,
// NREMT, ROWPU, IoT) that merely mention "mos" somewhere in their own
// acronym or definition text (a substring/whole-word match, never exact -
// e.g. IoT's own definition mentions "thermostats", NREMT's mentions
// "MOS-qualified"). Verified against this exact build before writing this
// test. Filtered to the Dictionary type alone (MAX_PER=40, well above 10)
// so the cap can't be the thing deciding which 10 survive - this purely
// tests sort order.
await openSearch();
const mosSnap = await searchAndFilter("mos", "Dictionary");
mosSnap.count === 10
  ? ok(`Dictionary-filtered query "mos" renders the expected 10 hits`)
  : bad(`expected 10 dictionary hits for "mos", got ${mosSnap.count}: ${JSON.stringify(mosSnap.titles)}`);
mosSnap.titles[0] === "MOS"
  ? ok(`the exact-acronym match ("MOS") ranks FIRST among ${mosSnap.count} hits, ahead of 9 records that only mention "mos" in passing (real relevance ranking, not seed/insertion order) - order: ${mosSnap.titles.join(", ")}`)
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

/* ============ 3b. Ranking is cheap, and short acronyms still rank ============ */
// The sort used to call hitScore() from inside its comparator, so a hit was
// scored once per COMPARISON (and each score builds a pattern per field), not
// once: a broad query ("le" matches about two thousand records) did about a
// hundred thousand pattern builds and froze typing on a budget phone. Each hit
// is now scored ONCE and the sort reads the saved score.
//
// Asserted on the WORK done, not on wall-clock time (a timing check flakes on a
// busy runner): the page's pattern tests are counted across one synchronous
// search. A hit is tested at most three times (title, sub line, body), so the
// total cannot pass three per hit unless a hit is being scored more than once.
// The count, the search and the restore all happen inside one evaluate, so the
// 120 ms typing delay's own later run can never land inside the window.
await openSearch();
const work = await page.evaluate(() => {
  const RealRe = window.RegExp, realTest = RegExp.prototype.test;
  let built = 0, tested = 0;
  window.RegExp = new Proxy(RealRe, { construct(target, args) { built++; return new target(...args); } });
  RegExp.prototype.test = function (s) { tested++; return realTest.call(this, s); };
  try {
    const inp = document.querySelector('input[type="search"]');
    inp.focus();
    inp.value = "le";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll(".search-chip")].find((b) => b.textContent.includes("All")).click();
  } finally { window.RegExp = RealRe; RegExp.prototype.test = realTest; }
  return { built, tested, hits: Number(((document.querySelector(".search-count") || {}).textContent || "").replace(/[^0-9]/g, "")) };
});
work.hits > 1000
  ? ok(`the broad query "le" is broad enough to matter (${work.hits} results)`)
  : bad(`expected the broad query "le" to match well over a thousand records, got ${work.hits}`);
work.tested <= 3 * work.hits + 100
  ? ok(`ranking a broad query scores each hit once (${work.tested} pattern tests for ${work.hits} hits, at most three per hit)`)
  : bad(`ranking a broad query ran ${work.tested} pattern tests for ${work.hits} hits - a hit is being scored more than once`);
work.built <= 50
  ? ok(`the ranking pattern is built once per search, not once per hit (${work.built} patterns built for ${work.hits} hits)`)
  : bad(`ranking a broad query built ${work.built} patterns for ${work.hits} hits - a pattern is being rebuilt per hit`);
// A 2-letter acronym must still be ranked: the exact acronym first, whole words
// before substrings. (A "skip ranking under 3 characters" shortcut would put
// "PT" among hundreds of records that merely contain the letters.)
await openSearch();
const ptSnap = await searchAndFilter("pt", "Dictionary");
ptSnap.titles[0] === "PT"
  ? ok('a 2-letter acronym is still ranked: "PT" comes first among its ' + ptSnap.count + " Dictionary cards")
  : bad('expected "PT" first for the 2-letter query "pt", got ' + JSON.stringify(ptSnap.titles.slice(0, 5)));

/* ============ 3c. Several-word queries ============ */
// Search used to treat "request leave" as ONE phrase, so any query whose words
// were not side by side in a record got "No results" - which reads as "GUIDON
// does not have this". Now a record matches when it holds the whole phrase OR
// every word of it (a word of 4 letters or fewer must start a word, so "da" is
// "data" but not "update"). A one-word query is untouched, and a record that
// held the phrase still holds it. Every claim below is checked on the live
// bank, in the direction that finds MORE and the directions that must not.
async function snapshot(query, chipLabel) {
  return page.evaluate(({ query, chipLabel }) => {
    const inp = document.querySelector('input[type="search"]');
    inp.focus();
    inp.value = query;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll(".search-chip")].find((b) => b.textContent.includes(chipLabel)).click();
    const empty = document.querySelector(".search-empty");
    return {
      total: Number(((document.querySelector(".search-count") || {}).textContent || "0").replace(/[^0-9]/g, "")),
      empty: !!empty,
      cards: [...document.querySelectorAll(".search-hit")].map((c) => ({
        title: (c.querySelector(".search-hit-title") || {}).textContent || "",
        marks: [...c.querySelectorAll(".search-hit-title mark")].map((m) => m.textContent.toLowerCase()),
      })),
    };
  }, { query, chipLabel });
}

// (a) Real bank: "request leave" finds DA Form 31 (Request and Authority for
// Leave), which the phrase never matched, and both words are marked.
await openSearch();
const reqLeave = await snapshot("request leave", "Forms");
const form31 = reqLeave.cards.find((c) => /^DA Form 31 —/.test(c.title));
form31
  ? ok('"request leave" finds DA Form 31 - "' + form31.title + '" - though the words are not side by side')
  : bad('"request leave" did not find DA Form 31, got ' + JSON.stringify(reqLeave.cards.map((c) => c.title)));
form31 && form31.marks.includes("request") && form31.marks.includes("leave")
  ? ok("each word of a several-word query is marked in the hit's title: " + JSON.stringify(form31.marks))
  : bad("the words of the query were not both marked: " + JSON.stringify(form31 && form31.marks));
const reqLeaveAll = await snapshot("request leave", "All");
reqLeaveAll.total >= 1 && !reqLeaveAll.empty
  ? ok('"request leave" is no longer "No results" (' + reqLeaveAll.total + " results across every type)")
  : bad('"request leave" still returned no results');

// (b) The count is derived from the loaded bank by an INDEPENDENT reading of the
// rule (a pattern per word, written here, not the page's own matcher):
// "evacuation medical" is not a phrase in any Dictionary term, but every word of
// it is in several. The page must show exactly those terms.
const derived = await page.evaluate(() => {
  const q = "evacuation medical", words = q.split(" ");
  const terms = G.store.acronyms().terms;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let phrase = 0, every = 0;
  terms.forEach((t) => {
    const hay = (t.a + " " + t.d).toLowerCase();
    const p = hay.includes(q);
    const all = words.every((w) => w.length > 4 ? hay.includes(w) : new RegExp("(^|[^a-z0-9])" + esc(w)).test(hay));
    if (p) phrase++;
    if (p || all) every++;
  });
  return { phrase, every };
});
const evacSnap = await snapshot("evacuation medical", "Dictionary");
derived.every > derived.phrase && derived.every > 0
  ? ok(`the bank has ${derived.every} Dictionary terms with both words and ${derived.phrase} with them side by side - the case is real`)
  : bad("the live bank no longer separates the phrase from the words for this query: " + JSON.stringify(derived));
evacSnap.total === derived.every && evacSnap.cards.length === Math.min(derived.every, 40)
  ? ok(`the Dictionary shows exactly the ${derived.every} terms the bank holds both words of (${evacSnap.cards.length} cards)`)
  : bad(`expected ${derived.every} Dictionary terms for "evacuation medical", the page showed ${evacSnap.total} (${evacSnap.cards.length} cards)`);

// (c) Short words start a word: "da 31" finds DA Form 31 first among Forms and
// stays a small list instead of every record that contains the letters "da".
await openSearch();
const da31 = await snapshot("da 31", "Forms");
/^DA Form 31 —/.test((da31.cards[0] || {}).title || "")
  ? ok('"da 31" puts DA Form 31 first among Forms: "' + da31.cards[0].title + '"')
  : bad('"da 31" did not put DA Form 31 first among Forms: ' + JSON.stringify(da31.cards.slice(0, 3).map((c) => c.title)));
const da31All = await snapshot("da 31", "All");
da31All.total >= 1 && da31All.total <= 60
  ? ok('"da 31" stays a small list (' + da31All.total + " results, not every record that contains the letters)")
  : bad('"da 31" returned ' + da31All.total + " results - the short-word rule is not holding it down");
// A phrase still behaves exactly as it did: "DA Form 31" is a phrase in its own title.
const phraseForm = await snapshot("DA Form 31", "Forms");
/^DA Form 31 —/.test((phraseForm.cards[0] || {}).title || "")
  ? ok('a whole phrase still ranks as before: "DA Form 31" puts DA Form 31 first')
  : bad('"DA Form 31" no longer puts DA Form 31 first: ' + JSON.stringify(phraseForm.cards.slice(0, 3).map((c) => c.title)));

// (d) Controlled records: the rules, one at a time, on board questions whose
// text the test sets (in memory only, undone after - nothing is saved). Nonsense
// words so no real record can interfere.
const controlled = await page.evaluate(() => {
  const bank = G.store.boardQuestions();
  const arr = bank.questions || bank;
  const saved = arr.slice(0, 7).map((r) => ({ r, q: r.q, a: r.a, category: r.category }));
  const set = (i, q) => { arr[i].q = q; arr[i].a = "zz"; arr[i].category = "zz"; delete arr[i]._hay; };
  // Seed order puts the SCATTERED record before the one with the phrase, so a
  // phrase-first result cannot be the seed order showing through.
  set(0, "zzbeta then something else entirely zzalpha");     // both words, apart
  set(1, "zzalpha zzbeta together as a phrase");             // the phrase
  set(2, "zzcc update the zzdd");                            // "da" only INSIDE a word
  set(3, "zzcc data the zzdd");                              // "da" starts a word
  set(4, "zzee only the first word");                        // one of two words
  set(5, "zzee zzff zzgg");                                  // every word of the query, with another word between
  set(6, "zzhh somethingwordy");                             // a LONG word may sit inside a word
  function run(query) {
    const inp = document.querySelector('input[type="search"]');
    inp.focus();
    inp.value = query;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll(".search-chip")].find((b) => b.textContent.includes("Board")).click();
    return [...document.querySelectorAll(".search-hit-title")].map((t) => t.textContent);
  }
  const out = {
    phraseAndWords: run("zzalpha zzbeta"),
    shortWord: run("zzdd da"),
    missingWord: run("zzee zzqq"),
    allWords: run("zzee zzgg"),
    longWord: run("zzhh ngword"),
  };
  saved.forEach((s) => { s.r.q = s.q; s.r.a = s.a; s.r.category = s.category; delete s.r._hay; });
  return out;
});
controlled.phraseAndWords.length === 2 && controlled.phraseAndWords[0].startsWith("zzalpha zzbeta together")
  ? ok("the record holding the whole phrase ranks ahead of the one with the words apart, though it comes later in the bank")
  : bad("expected the phrase record first of two, got " + JSON.stringify(controlled.phraseAndWords));
controlled.shortWord.length === 1 && controlled.shortWord[0].startsWith("zzcc data")
  ? ok('a short word starts a word: "da" matches "data" and not the middle of "update"')
  : bad('expected only the "data" record for "zzdd da", got ' + JSON.stringify(controlled.shortWord));
controlled.missingWord.length === 0
  ? ok("every word is required: a record with only one of the two words is not a hit")
  : bad("a record with only one of the words was returned: " + JSON.stringify(controlled.missingWord));
controlled.allWords.length === 1 && controlled.allWords[0].startsWith("zzee zzff")
  ? ok("a record holding every word is found when the words are apart")
  : bad("expected the record holding both words, got " + JSON.stringify(controlled.allWords));
controlled.longWord.length === 1 && controlled.longWord[0].startsWith("zzhh somethingwordy")
  ? ok("a word of five letters or more may sit inside a word (the rule a single word always had)")
  : bad('expected the "somethingwordy" record for "zzhh ngword", got ' + JSON.stringify(controlled.longWord));
await openSearch();

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
