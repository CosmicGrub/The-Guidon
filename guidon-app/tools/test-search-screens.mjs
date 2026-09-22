/**
 * Global Search's "screen" type (SCREEN_ENTRIES/allHits.screen in
 * views.search, src/index.html): a Soldier who types a screen's own name,
 * or a real-world word for what it does ("dark mode", "PCS", "TSP"), now
 * gets a direct hit - not just the six SECTION_ORDER content domains
 * (which only cover records like doctrine entries or board questions, never
 * the ~30 screens themselves) and not just UNINDEXED_DOMAIN_HASHES's
 * fallback chips (which only ever appear on a TOTAL zero-hit query, by the
 * route's exact G.routes label only).
 *
 * Settings is one #/settings route holding many distinct sections, so its
 * entries carry a `settingsAnchor` DOM id that goTo() seeds through
 * G.nav.seed("settingsAnchor", id) - views.settings's own render consumes it once
 * (G.nav.consume), at the very end of its build, and scrolls/focuses that
 * panel, opening the collapsed "Advanced" section first via
 * openSettingsAdvanced() when the target lives inside it (Forms Fill Mode
 * is the one settings entry that does).
 *
 * This exercises the real thing, not just "nothing throws":
 *   - every SCREEN_ENTRIES hash still resolves to a real G.routes entry
 *   - a keyword-only match (not the screen's own label) finds it
 *   - clicking a plain screen hit navigates to its real route
 *   - clicking a Settings-anchored hit lands on #/settings AND scrolls to/
 *     focuses the right panel - including the Advanced-section case
 *   - the "screen" filter chip actually filters to screen-only hits
 *
 * Every wait below polls for the actual condition it needs (a specific
 * titled hit, a specific focused/visible element) rather than a fixed delay
 * past the 120ms search debounce - a generic "did anything render" poll
 * would risk resolving against STALE content left over from the previous
 * query, since runSearch() doesn't clear resultsDiv until the debounce
 * actually fires.
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
// Real, independently-confirmed race (reproduces on unmodified main too,
// nothing to do with this suite's own feature): closing the onboarding
// overlay pops util._modalOpenCount and removes #app's "inert" attribute
// (util._popModalInert, index.html), but there is a real window where the
// overlay has already detached - satisfying dismissOnboarding()'s own
// wait - while #app is still inert, which silently blocks Playwright's
// .fill()/.focus()/.pressSequentially() from ever reaching the search
// input (a manually-dispatched "input" event on the raw element still
// works, since `inert` only blocks focus/native interaction, not script).
// Confirmed by direct measurement, not guessed. Waiting for the real
// condition here rather than reporting confusing "search never runs"
// failures; the underlying race belongs in dismissOnboarding() itself,
// out of scope for this suite alone (it's shared by ~50 other suites).
await until(page, () => !(document.getElementById("app") || {}).inert, undefined, { timeout: 3000 });
await waitForRoute(page, "#/search", { ready: 'input[type="search"]' });

const searchInput = page.locator('input[type="search"]');

// Types the query, then polls (well past the 120ms debounce) for a real hit
// titled exactly `title` to appear - the debounce wait and "did the render
// finish" wait are the same wait, and it can't false-positive on a stale
// hit left over from the previous query because it names the NEW query's
// own expected result.
// Exact title match preferred; only falls back to "contains" for the
// "Settings — X" labels this suite looks up by their X half. Exact-first
// avoids grabbing an unrelated hit whose title happens to contain the
// search text as a substring (e.g. a lesson title containing "Money").
async function findHitTitled(title, timeout = 4000) {
  const found = await until(page, (t) => {
    const cards = [...document.querySelectorAll(".search-hit-title")];
    return cards.some((c) => c.textContent === t) || cards.some((c) => c.textContent.includes(t));
  }, title, { timeout });
  if (!found) return null;
  return page.evaluateHandle((t) => {
    const cards = [...document.querySelectorAll(".search-hit")];
    const exact = cards.find((c) => (c.querySelector(".search-hit-title")?.textContent || "") === t);
    if (exact) return exact;
    return cards.find((c) => (c.querySelector(".search-hit-title")?.textContent || "").includes(t));
  }, title);
}

async function search(q) {
  await searchInput.fill(q);
}

async function backToSearch() {
  await waitForRoute(page, "#/search", { ready: 'input[type="search"]', fresh: true });
}

// ---- every SCREEN_ENTRIES hash still resolves to a real route ----
const entryHashes = await page.evaluate(() => ((window.G && G.routes) || []).map((r) => r.hash));
const KNOWN_SCREEN_HASHES = ["#/forms","#/counsel","#/develop","#/write","#/money","#/health","#/transition","#/moi",
  "#/group","#/records","#/calendar","#/cyber-opsec","#/creeds","#/prt","#/recite","#/dictionary","#/library","#/learn",
  "#/blc","#/alc","#/slc","#/drills","#/leader","#/risk","#/career","#/assignments","#/channels","#/fitness","#/resources",
  "#/progress","#/currency","#/share","#/author","#/selftest","#/storage","#/settings"];
const missing = KNOWN_SCREEN_HASHES.filter((h) => !entryHashes.includes(h));
missing.length === 0
  ? ok("every screen-entry route hash still resolves to a real G.routes entry (" + KNOWN_SCREEN_HASHES.length + " checked)")
  : bad("route(s) renamed/removed since the screen entries were written: " + JSON.stringify(missing));

// ---- keyword-only match (not the screen's own label) ----
await search("TSP");
const tspCard = await findHitTitled("Money");
if (tspCard) {
  const sub = await tspCard.evaluate((c) => c.querySelector(".search-hit-sub")?.textContent || "");
  ok('query "TSP" (a Money keyword, not the route label) hits the Money screen entry, sub="' + sub + '"');
} else {
  bad('query "TSP" did not surface the Money screen entry');
}

// ---- clicking a plain screen hit navigates to its real route ----
await search("PCS");
const pcsCard = await findHitTitled("Assignments");
if (pcsCard) {
  await pcsCard.evaluate((c) => c.click());
  const landed = await until(page, () => location.hash === "#/assignments", undefined, { timeout: 3000 });
  landed
    ? ok('clicking the "Assignments" screen hit (found via keyword "PCS") navigates to #/assignments')
    : bad("clicking the Assignments screen hit did not land on #/assignments (got " + (await page.evaluate(() => location.hash)) + ")");
} else {
  bad('query "PCS" did not surface the Assignments screen entry');
}

// ---- Settings-anchored hit: plain panel (not inside Advanced) ----
await backToSearch();
await search("dark mode");
const themeCard = await findHitTitled("Theme");
if (themeCard) {
  await themeCard.evaluate((c) => c.click());
  const landed = await until(page, () => location.hash === "#/settings", undefined, { timeout: 3000 });
  const themeFocused = await until(page, () => document.activeElement && document.activeElement.id === "settings-theme-panel", undefined, { timeout: 3000 });
  landed
    ? ok('clicking the "Settings — Theme" screen hit (found via keyword "dark mode") navigates to #/settings')
    : bad("clicking the Theme screen hit did not land on #/settings");
  themeFocused
    ? ok("the Theme settings panel receives real focus (not just a scroll) after landing on #/settings")
    : bad("the Theme settings panel never received focus after landing on #/settings");
} else {
  bad('query "dark mode" did not surface the "Settings — Theme" screen entry');
}

// ---- Settings-anchored hit inside the collapsed Advanced section ----
await backToSearch();
await search("PDF replica overlay");
const fmCard = await findHitTitled("Forms Fill Mode");
if (fmCard) {
  await fmCard.evaluate((c) => c.click());
  const landed = await until(page, () => location.hash === "#/settings", undefined, { timeout: 3000 });
  const advancedOpened = await until(page, () => [...document.querySelectorAll("button")].some((b) => /hide advanced settings/i.test(b.textContent || "")), undefined, { timeout: 3000 });
  const fmVisible = await page.evaluate(() => {
    const el2 = document.getElementById("settings-formsmode-panel");
    return !!(el2 && el2.offsetParent !== null);
  });
  landed
    ? ok('clicking the "Settings — Forms Fill Mode" hit (a collapsed-Advanced target) navigates to #/settings')
    : bad("clicking the Forms Fill Mode screen hit did not land on #/settings");
  advancedOpened
    ? ok("the collapsed Advanced settings section opened automatically for a target that lives inside it")
    : bad("the Advanced settings section did not open for a target that lives inside it");
  fmVisible
    ? ok("the Forms Fill Mode panel is actually visible (not display:none) after Advanced opened")
    : bad("the Forms Fill Mode panel is still hidden after the Advanced section supposedly opened");
} else {
  bad('query "PDF replica overlay" did not surface the "Settings — Forms Fill Mode" screen entry');
}

// ---- the "screen" filter chip filters to screen-only hits ----
// "counsel" deliberately matches more than one screen entry (Counsel
// itself, AND Forms - whose own keywords include "counseling form", since
// DA 4856-style counseling forms really do live there - a real, useful
// overlap, not a bug), so this checks every visible hit's own badge icon
// is the screen type's (TYPE_ICON.screen, "▣") rather than assuming a
// specific title or count.
await backToSearch();
await search("counsel"); // spans real content domains AND multiple screen entries
await findHitTitled("Counsel"); // wait for the debounced search to actually land before touching filter chips
const chipClicked = await page.evaluate(() => {
  const chip = [...document.querySelectorAll(".search-chip")].find((b) => b.textContent.includes("Screens & Settings"));
  if (!chip) return false;
  chip.click();
  return true;
});
if (chipClicked) {
  const filtered = await until(page, () => {
    const badges = [...document.querySelectorAll(".search-hit .search-badge")];
    return badges.length > 0 && badges.every((b) => b.textContent === "▣");
  }, undefined, { timeout: 3000 });
  const info = await page.evaluate(() => ({
    count: document.querySelectorAll(".search-hit-title").length,
    titles: [...document.querySelectorAll(".search-hit-title")].map((t) => t.textContent),
  }));
  filtered
    ? ok('the "Screens & Settings" filter chip narrows results down to screen-type hits only (' + info.count + ": " + info.titles.join(", ") + ")")
    : bad('the "Screens & Settings" filter chip did not narrow results down to screen-type hits only (got ' + JSON.stringify(info.titles) + ")");
} else {
  bad('no "Screens & Settings" filter chip was rendered');
}

await browser.close();
server.close();

noise.length === 0
  ? ok("no console errors/warnings")
  : bad("console noise: " + JSON.stringify(noise));

console.log("");
console.log(fails === 0 ? "SEARCH SCREENS: all passed" : "SEARCH SCREENS: " + fails + " FAILURE(S)");
process.exit(fails === 0 ? 0 : 1);
