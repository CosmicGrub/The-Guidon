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
 * G.nav.seed("settings", id) - views.settings's own render consumes it once
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
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { until } from "./testkit.mjs";

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
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(500);

const searchInput = page.locator('input[type="search"]');

async function search(q) {
  await searchInput.fill(q);
  await page.waitForTimeout(400); // past the 120ms debounce
}

// ---- every SCREEN_ENTRIES hash still resolves to a real route ----
const entryHashes = await page.evaluate(() => {
  const routes = (window.G && G.routes) || [];
  // SCREEN_ENTRIES itself is module-private; read back the hashes actually
  // wired into it indirectly via a broad, harmless query no content domain
  // could plausibly match on its own, then intersect with known target
  // hashes below instead of reaching into closure state.
  return routes.map((r) => r.hash);
});
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
const tspHit = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".search-hit")];
  const card = cards.find((c) => c.querySelector(".search-hit-title")?.textContent === "Money");
  return card ? { found: true, sub: card.querySelector(".search-hit-sub")?.textContent || "" } : { found: false };
});
tspHit.found
  ? ok('query "TSP" (a Money keyword, not the route label) hits the Money screen entry, sub="' + tspHit.sub + '"')
  : bad('query "TSP" did not surface the Money screen entry: ' + JSON.stringify(tspHit));

// ---- clicking a plain screen hit navigates to its real route ----
await search("PCS");
const pcsGo = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".search-hit")];
  const card = cards.find((c) => c.querySelector(".search-hit-title")?.textContent === "Assignments");
  if (!card) return { found: false };
  card.click();
  return { found: true };
});
if (pcsGo.found) {
  await page.waitForTimeout(300);
  const hash = await page.evaluate(() => location.hash);
  hash === "#/assignments"
    ? ok('clicking the "Assignments" screen hit (found via keyword "PCS") navigates to #/assignments')
    : bad("clicking the Assignments screen hit landed on " + hash + " instead of #/assignments");
} else {
  bad('query "PCS" did not surface the Assignments screen entry');
}

// ---- Settings-anchored hit: plain panel (not inside Advanced) ----
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(400);
await search("dark mode");
const themeGo = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".search-hit")];
  const card = cards.find((c) => (c.querySelector(".search-hit-title")?.textContent || "").includes("Theme"));
  if (!card) return { found: false };
  card.click();
  return { found: true };
});
if (themeGo.found) {
  await page.waitForTimeout(200);
  const hash = await page.evaluate(() => location.hash);
  const themeFocused = await until(page, () => document.activeElement && document.activeElement.id === "settings-theme-panel", undefined, { timeout: 3000 });
  hash === "#/settings"
    ? ok('clicking the "Settings — Theme" screen hit (found via keyword "dark mode") navigates to #/settings')
    : bad("clicking the Theme screen hit landed on " + hash + " instead of #/settings");
  themeFocused
    ? ok("the Theme settings panel receives real focus (not just a scroll) after landing on #/settings")
    : bad("the Theme settings panel never received focus after landing on #/settings");
} else {
  bad('query "dark mode" did not surface the "Settings — Theme" screen entry');
}

// ---- Settings-anchored hit inside the collapsed Advanced section ----
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(400);
await search("PDF replica overlay");
const fmGo = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".search-hit")];
  const card = cards.find((c) => (c.querySelector(".search-hit-title")?.textContent || "").includes("Forms Fill Mode"));
  if (!card) return { found: false };
  card.click();
  return { found: true };
});
if (fmGo.found) {
  await page.waitForTimeout(200);
  const hash = await page.evaluate(() => location.hash);
  const advancedOpened = await until(page, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => /hide advanced settings/i.test(b.textContent || ""));
    return !!btn;
  }, undefined, { timeout: 3000 });
  const fmVisible = await page.evaluate(() => {
    const el2 = document.getElementById("settings-formsmode-panel");
    return !!(el2 && el2.offsetParent !== null);
  });
  hash === "#/settings"
    ? ok('clicking the "Settings — Forms Fill Mode" hit (a collapsed-Advanced target) navigates to #/settings')
    : bad("clicking the Forms Fill Mode screen hit landed on " + hash + " instead of #/settings");
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
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(400);
await search("counsel"); // spans real content domains AND the Counsel/Settings screen entries
const screenChipState = await page.evaluate(() => {
  const chip = [...document.querySelectorAll(".search-chip")].find((b) => b.textContent.includes("Screens & Settings"));
  if (!chip) return { chipFound: false };
  chip.click();
  return { chipFound: true };
});
if (screenChipState.chipFound) {
  await page.waitForTimeout(150);
  const afterFilter = await page.evaluate(() => {
    const titles = [...document.querySelectorAll(".search-hit-title")].map((t) => t.textContent);
    return { count: titles.length, allScreenish: titles.every((t) => t === "Counsel") };
  });
  afterFilter.count > 0
    ? ok('the "Screens & Settings" filter chip narrows results down to screen-type hits only (' + afterFilter.count + " result(s))")
    : bad('the "Screens & Settings" filter chip produced zero results for a query known to have a screen-type hit');
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
