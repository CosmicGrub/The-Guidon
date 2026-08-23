/**
 * G.nav.seed()/consume() (util.js): the shared cross-view handoff registry
 * that replaced three independently-named one-shot globals - G.views._pending,
 * G.resources._searchSeed, G.career._searchSeed - all previously set directly
 * by views.search's own goTo() right before a hash change, and each read-
 * and-cleared once by its target view's own render (views.train's own
 * "honor a recommendation launch" block / G.resources.render / G.career's
 * render). G.engine._pending (a fourth, differently-shaped one-shot global
 * feeding a DIFFERENT consumption path inside views.train) was deliberately
 * left alone - see G.nav's own header comment in util.js for why.
 *
 * No existing test ever clicked a real Global Search hit through to its
 * target view: test-search-views.mjs covers Doctrine/Dictionary/Resources'
 * OWN search boxes, and test-search-list-detail.mjs covers #/search's
 * jump-index and Escape behavior, but neither follows a .search-hit card's
 * click handler across the actual hash change. So the handoff itself - not
 * just the search results feeding it - had zero interactive coverage before
 * this file, independent of the G.nav migration.
 *
 * Exercises:
 *   0. G.nav.seed()/consume() directly - a bare unit-level proof that
 *      consume() both returns the seeded value AND clears it (a second
 *      consume() of the same target returns null).
 *   1. a scenario hit -> #/train, via G.nav's "train" slot -> Train launches
 *      the scenario immediately (G.engine.run, same real player screen a
 *      direct list-card click reaches in test-train.mjs).
 *   2. a resource hit -> #/resources, via G.nav's "resources" slot -> the
 *      search box is pre-filled with the real resource name and its own
 *      result card renders.
 *   3. a career/MOS hit -> #/career, via G.nav's "career" slot -> the MOS
 *      input is pre-filled (uppercased) and that MOS's own result card
 *      renders with its real code + title.
 * Plus: the old one-shot globals G.nav replaced are actually gone (not just
 * unused alongside a new mechanism), and each seed is truly one-shot - a
 * fresh, unrelated re-render of the same target view after consumption does
 * not replay it.
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

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

// ---- 0. G.nav.seed/consume, directly, no UI involved ----
const unit = await page.evaluate(() => {
  G.nav.seed("__test_target__", "hello");
  const first = G.nav.consume("__test_target__");
  const second = G.nav.consume("__test_target__");
  return { first, second };
});
unit.first === "hello" && unit.second === null
  ? ok("G.nav.consume() returns the seeded value once, then null on a second call for the same target")
  : bad("G.nav unit check: " + JSON.stringify(unit));

// ---- old one-shot globals are actually gone, not just superseded ----
const oldGlobals = await page.evaluate(() => ({
  hasNav: !!(window.G && window.G.nav),
  seedFn: typeof (window.G && window.G.nav && window.G.nav.seed),
  consumeFn: typeof (window.G && window.G.nav && window.G.nav.consume),
  viewsPending: window.G && window.G.views ? window.G.views._pending : "n/a",
  resourcesSeed: window.G && window.G.resources ? window.G.resources._searchSeed : "n/a",
  careerSeed: window.G && window.G.career ? window.G.career._searchSeed : "n/a",
}));
(oldGlobals.hasNav && oldGlobals.seedFn === "function" && oldGlobals.consumeFn === "function")
  ? ok("G.nav.seed/consume exist as the shared cross-view handoff helper")
  : bad("G.nav shape: " + JSON.stringify(oldGlobals));
(oldGlobals.viewsPending === undefined && oldGlobals.resourcesSeed === undefined && oldGlobals.careerSeed === undefined)
  ? ok("the old globals it replaced (views._pending / resources._searchSeed / career._searchSeed) are gone, not left dangling unused")
  : bad("stale old one-shot globals still present: " + JSON.stringify(oldGlobals));

// Real known values pulled straight from the store, so the search queries
// below are guaranteed a real hit instead of guessing a keyword against the
// (enormous, single-line) embedded seed data. Each is the FIRST entry in its
// own list, so - since every matching loop below pushes hits in original
// list order and each of these matches its own exact name/title/code - it
// is always allHits[type][0], i.e. the first .search-hit card rendered,
// regardless of how many other entries also happen to match the substring.
const known = await page.evaluate(() => {
  const sc = (G.store.scenarios ? G.store.scenarios() : [])[0];
  const res = G.store.resources ? G.store.resources() : { categories: [] };
  let resItem = null;
  for (const c of (res.categories || [])) { if (c.items && c.items.length) { resItem = c.items[0]; break; } }
  const car = G.store.career ? G.store.career() : { mos: [] };
  const mos = (car.mos || [])[0];
  return {
    scenarioTitle: sc && sc.title,
    resourceName: resItem && resItem.name,
    mosCode: mos && mos.code, mosTitle: mos && mos.title,
  };
});
(known.scenarioTitle && known.resourceName && known.mosCode && known.mosTitle)
  ? ok("fetched a real scenario/resource/MOS from the store to search for")
  : bad("could not fetch known seed values from store: " + JSON.stringify(known));

async function searchAndFilter(query, chipRegex) {
  await page.evaluate(() => { location.hash = "#/search"; });
  await page.waitForTimeout(400);
  await page.fill('input[aria-label="Global search"]', query);
  await page.waitForTimeout(300); // past the 120ms debounce
  await page.locator(".search-chip", { hasText: chipRegex }).first().click();
  await page.waitForTimeout(200);
}

// ---- 1. scenario hit -> #/train via G.nav's "train" slot ----
await searchAndFilter(known.scenarioTitle, /Scenarios/);
const scenarioHits = await page.locator(".search-hit").count();
scenarioHits > 0
  ? ok(`searching the real scenario title "${known.scenarioTitle}" produced ${scenarioHits} hit(s)`)
  : bad("no scenario hits for a known real scenario title - fixture assumption broken");
if (scenarioHits > 0) {
  await page.locator(".search-hit").first().click();
  await page.waitForTimeout(600);
  const trainState = await page.evaluate(() => ({
    hash: location.hash,
    h2: document.querySelector(".engine-head h2")?.textContent || "",
    navConsumeAgain: G.nav.consume("train"),
  }));
  trainState.hash === "#/train" && trainState.h2 === known.scenarioTitle
    ? ok(`clicking the scenario hit lands on #/train with the scenario already launched ("${trainState.h2}")`)
    : bad("state after clicking scenario hit: " + JSON.stringify(trainState));
  trainState.navConsumeAgain === null
    ? ok('Train\'s own render already consumed the "train" seed - a second G.nav.consume("train") returns null')
    : bad('G.nav.consume("train") after Train rendered: ' + JSON.stringify(trainState.navConsumeAgain));

  // One-shot: a later, unrelated re-render of Train must NOT replay the
  // stale seed (it was deleted, not merely read past) - back to the list.
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = "#/train"; });
  await page.waitForTimeout(400);
  const revisit = await page.evaluate(() => ({
    listCards: document.querySelectorAll(".grid .card.click").length,
    playerVisible: document.querySelector(".engine-head") ? true : false,
  }));
  revisit.listCards > 0 && !revisit.playerVisible
    ? ok("revisiting #/train afterward shows the plain scenario list, not a replayed launch - the seed was truly one-shot")
    : bad("Train state on a later, unrelated revisit: " + JSON.stringify(revisit));
}

// ---- 2. resource hit -> #/resources via G.nav's "resources" slot ----
await searchAndFilter(known.resourceName, /Resources/);
const resourceHits = await page.locator(".search-hit").count();
resourceHits > 0
  ? ok(`searching the real resource name "${known.resourceName}" produced ${resourceHits} hit(s)`)
  : bad("no resource hits for a known real resource name - fixture assumption broken");
if (resourceHits > 0) {
  await page.locator(".search-hit").first().click();
  await page.waitForTimeout(400);
  const resState = await page.evaluate(() => ({
    hash: location.hash,
    inputValue: document.querySelector('input[aria-label="Search resources"]')?.value || "",
    firstCardName: document.querySelector(".res-card .res-name")?.textContent || "",
    navConsumeAgain: G.nav.consume("resources"),
  }));
  resState.hash === "#/resources" && resState.inputValue === known.resourceName
    ? ok(`clicking the resource hit lands on #/resources with the search box pre-filled ("${resState.inputValue}")`)
    : bad("state after clicking resource hit: " + JSON.stringify(resState));
  resState.firstCardName.includes(known.resourceName)
    ? ok("the seeded resource's own card is shown in the (pre-filtered) results")
    : bad("first resource card after seeding: " + JSON.stringify(resState.firstCardName));
  resState.navConsumeAgain === null
    ? ok('Resources\' own render already consumed the "resources" seed - a second consume() returns null')
    : bad('G.nav.consume("resources") after Resources rendered: ' + JSON.stringify(resState.navConsumeAgain));
}

// ---- 3. career/MOS hit -> #/career via G.nav's "career" slot ----
await searchAndFilter(known.mosCode, /MOS\/Career/);
const careerHits = await page.locator(".search-hit").count();
careerHits > 0
  ? ok(`searching the real MOS code "${known.mosCode}" produced ${careerHits} hit(s)`)
  : bad("no career hits for a known real MOS code - fixture assumption broken");
if (careerHits > 0) {
  await page.locator(".search-hit").first().click();
  await page.waitForTimeout(400);
  const careerState = await page.evaluate(() => ({
    hash: location.hash,
    inputValue: document.querySelector('input[aria-label="MOS code"]')?.value || "",
    h3: document.querySelector(".panel h3")?.textContent || "",
    navConsumeAgain: G.nav.consume("career"),
  }));
  careerState.hash === "#/career" && careerState.inputValue === known.mosCode.toUpperCase()
    ? ok(`clicking the career/MOS hit lands on #/career with the MOS input pre-filled ("${careerState.inputValue}")`)
    : bad("state after clicking career hit: " + JSON.stringify(careerState));
  careerState.h3 === known.mosCode + " — " + known.mosTitle
    ? ok(`the seeded MOS's own result card renders ("${careerState.h3}")`)
    : bad("career result card h3 after seeding: " + JSON.stringify(careerState.h3));
  careerState.navConsumeAgain === null
    ? ok('Career\'s own render already consumed the "career" seed - a second consume() returns null')
    : bad('G.nav.consume("career") after Career rendered: ' + JSON.stringify(careerState.navConsumeAgain));
}

noise.length === 0 ? ok("no console errors") : bad("console noise: " + noise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nNAV SEED: all passed");
process.exit(fails ? 1 : 0);
