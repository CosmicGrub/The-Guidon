/**
 * Doctrine, Dictionary, and Resources search-and-filter (#/doctrine,
 * #/dictionary, #/resources): the generic route sweep only loads each view
 * once and never types into its search box or clicks a filter chip, so none
 * of the actual filtering, the debounce, or the specific empty-state
 * messaging fixed in past weeks (#78/#80/#81/#83/#116/#117) had real
 * interactive coverage. This exercises a real search + real chip filter +
 * both together + the debounce actually debouncing + each view's own
 * echo-the-query empty-state text on all three.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

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
await dismissOnboarding(page);
await page.waitForTimeout(300);

// ==================== Doctrine ====================
await page.evaluate(() => { location.hash = "#/doctrine"; });
await page.waitForTimeout(500);
const docSearch = page.locator('input[aria-label="Search doctrine"]');
await docSearch.fill("counseling");
await page.waitForTimeout(250); // past the 120ms debounce
const docCountAfterSearch = await page.evaluate(() => (document.querySelector(".search-count") || {}).textContent || "");
/\d+ entr(y|ies)/.test(docCountAfterSearch) ? ok("Doctrine search narrows results with a real count (" + docCountAfterSearch + ")") : bad("Doctrine search count text: " + docCountAfterSearch);

await docSearch.fill("zzzzznonexistentqueryxyz");
await page.waitForTimeout(250);
const docEmptyText = await page.evaluate(() => (document.querySelector(".empty") || {}).textContent || "");
/No entries match/.test(docEmptyText) ? ok("Doctrine empty state renders for a query with zero hits") : bad("Doctrine empty state text: " + docEmptyText);

await docSearch.fill("");
await page.waitForTimeout(250);
const docChip = page.locator(".search-chip").nth(1);
const docChipLabel = (await docChip.textContent()) || "";
await docChip.click();
await page.waitForTimeout(150);
const docCountAfterChip = await page.evaluate(() => (document.querySelector(".search-count") || {}).textContent || "");
const docChipActive = await docChip.evaluate((el) => el.classList.contains("active"));
docChipActive ? ok("Doctrine topic chip (" + docChipLabel.trim() + ") activates on click") : bad("Doctrine topic chip did not activate");
/\d+ entr(y|ies)/.test(docCountAfterChip) ? ok("Doctrine chip filter narrows results with a real count") : bad("Doctrine chip filter count text: " + docCountAfterChip);

// debounce: rapid keystrokes (all dispatched synchronously, well inside the
// 120ms window) should only trigger ONE draw(), not one per keystroke.
const docDrawCount = await page.evaluate(() => {
  return new Promise((resolve) => {
    const input = document.querySelector('input[aria-label="Search doctrine"]');
    const results = document.querySelector(".search-count").closest(".search-header").parentElement;
    let count = 0;
    const obs = new MutationObserver(() => { count++; });
    obs.observe(results, { childList: true });
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    "leader".split("").forEach((ch, i) => {
      setter.call(input, input.value + ch);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    setTimeout(() => { obs.disconnect(); resolve(count); }, 400);
  });
});
docDrawCount <= 2 ? ok("Doctrine search debounces rapid typing (" + docDrawCount + " re-render(s) for 6 synchronous keystrokes, not 6)") : bad("Doctrine search re-rendered " + docDrawCount + " times for 6 rapid keystrokes - debounce not effective");

// ==================== Dictionary ====================
await page.evaluate(() => { location.hash = "#/dictionary"; });
await page.waitForTimeout(500);
const dictSearch = page.locator('input[aria-label="Search dictionary"]');
await dictSearch.fill("NCOER");
await page.waitForTimeout(250);
const dictMeta = await page.evaluate(() => (document.querySelector(".meta") || {}).textContent || "");
/Showing \d+ of \d+/.test(dictMeta) ? ok("Dictionary search shows a real 'Showing N of M' count (" + dictMeta + ")") : bad("Dictionary meta text: " + dictMeta);
const dictExactHit = await page.evaluate(() => !!document.querySelector(".dict-exact"));
dictExactHit ? ok("Dictionary search surfaces the exact-acronym match first (NCOER)") : bad("Dictionary did not surface an exact match for NCOER");

await dictSearch.fill("zzzzznonexistentqueryxyz");
await page.waitForTimeout(250);
const dictEmptyText = await page.evaluate(() => (document.querySelector(".empty") || {}).textContent || "");
(/No terms match/.test(dictEmptyText) && dictEmptyText.includes("zzzzznonexistentqueryxyz"))
  ? ok("Dictionary empty state echoes the actual search text (#81)")
  : bad("Dictionary empty state text: " + dictEmptyText);

// ==================== Resources ====================
await page.evaluate(() => { location.hash = "#/resources"; });
await page.waitForTimeout(500);
const resSearch = page.locator('input[aria-label="Search resources"]');
await resSearch.fill("mental health");
await page.waitForTimeout(250);
const resMeta = await page.evaluate(() => (document.querySelector(".meta") || {}).textContent || "");
/Showing \d+ of \d+ match/.test(resMeta) ? ok("Resources search shows a real 'Showing N of M matches' count (" + resMeta + ")") : bad("Resources meta text: " + resMeta);

await resSearch.fill("");
await page.waitForTimeout(200);
const resChip = page.locator(".search-chip").nth(1);
const resChipLabel = ((await resChip.textContent()) || "").trim();
await resChip.click();
await page.waitForTimeout(150);
const resChipActive = await resChip.evaluate((el) => el.classList.contains("active"));
resChipActive ? ok("Resources category chip (" + resChipLabel + ") activates on click") : bad("Resources category chip did not activate");

await resSearch.fill("zzzzznonexistentqueryxyz");
await page.waitForTimeout(250);
const resEmptyText = await page.evaluate(() => (document.querySelector(".empty") || {}).textContent || "");
(/No .*resources match/.test(resEmptyText) && resEmptyText.includes("zzzzznonexistentqueryxyz"))
  ? ok("Resources empty state echoes both the search text AND the active category (#117)")
  : bad("Resources empty state text: " + resEmptyText);

// clear the chip filter and confirm results return
await page.locator(".search-chip").first().click();
await resSearch.fill("");
await page.waitForTimeout(250);
const resCountAfterClear = await page.evaluate(() => (document.querySelector(".meta") || {}).textContent || "");
/Showing \d+ of \d+ resources/.test(resCountAfterClear) ? ok("Clearing search + chip filter returns to the full resource list") : bad("Resources count after clearing filters: " + resCountAfterClear);

// ==================== Global Search: creed & PRT hit types ====================
// Global Search's Creeds & Identities / Physical Readiness Training hit types
// (docs/design/content-education-roadmap.md Milestone 1 wiring, src/index.html
// ~33661-33686) were indexed and filter-chip-wired from day one, but had zero
// content until Milestone 3 and zero interactive test coverage even after:
// the generic route sweep only loads #/search once and never types a query,
// and test-search-dist-bar.mjs's SECTION_ORDER predates Milestone 3 and still
// only lists the original six domains. This exercises a real creed hit and a
// real PRT hit end to end - the card renders, its filter chip actually
// toggles activeFilter (not just visually), clicking the card navigates to
// the domain's own view, and the distribution bar shows a segment for the
// type. "Ranger Creed" and "Bend and Reach" were verified against the live
// seed to each span exactly two domains (a Board Question plus the creed/prt
// hit) at 1+1 results - real cross-domain queries the distribution bar
// actually has something proportional to show, not queries that happen to
// hit only one domain (which renders no bar at all - see
// test-search-dist-bar.mjs's own single-domain case).
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(500);
const gsInput = page.locator('input[aria-label="Global search"]');

// ---- creed ----
await gsInput.fill("Ranger Creed");
await page.waitForTimeout(250);
const creedBarSegs = await page.evaluate(() => [...document.querySelectorAll(".search-dist-seg")].map((s) => s.title));
creedBarSegs.some((t) => /Creeds & Identities/.test(t))
  ? ok("Global Search distribution bar shows a Creeds & Identities segment for a query spanning creed + board (" + creedBarSegs.join(" | ") + ")")
  : bad("no Creeds & Identities segment in distribution bar: " + JSON.stringify(creedBarSegs));

const creedChip = page.locator(".search-chip", { hasText: "Creeds & Identities" });
await creedChip.click();
await page.waitForTimeout(150);
const creedChipActive = await creedChip.evaluate((el) => el.classList.contains("active") && el.getAttribute("aria-pressed") === "true");
creedChipActive ? ok("Creeds & Identities filter chip activates (class + aria-pressed) on click") : bad("Creeds & Identities chip did not activate");

const creedFiltered = await page.evaluate(() => ({
  hits: document.querySelectorAll(".search-hit").length,
  sections: document.querySelectorAll(".search-section").length,
  title: (document.querySelector(".search-hit-title") || {}).textContent || "",
}));
(creedFiltered.hits === 1 && creedFiltered.sections === 1)
  ? ok("Creeds & Identities chip filters results down to the creed hit only (1 result)")
  : bad("after Creeds & Identities filter: " + creedFiltered.hits + " hit(s) in " + creedFiltered.sections + " section(s)");
/Ranger Creed/i.test(creedFiltered.title)
  ? ok('a creed-typed result renders for "Ranger Creed" (title: "' + creedFiltered.title + '")')
  : bad("unexpected creed hit title: " + creedFiltered.title);

await page.locator(".search-hit").first().click();
await page.waitForTimeout(150);
const creedNavHash = await page.evaluate(() => location.hash);
creedNavHash === "#/creeds" ? ok("clicking a creed search hit navigates to #/creeds") : bad("clicking a creed search hit navigated to " + creedNavHash + ", expected #/creeds");

// ---- prt ----
// Fresh mount of #/search resets activeFilter back to "all" (it's a local
// closure variable re-initialized every render), so no manual reset needed.
await page.evaluate(() => { location.hash = "#/search"; });
await page.waitForTimeout(500);
const gsInput2 = page.locator('input[aria-label="Global search"]');
await gsInput2.fill("Bend and Reach");
await page.waitForTimeout(250);
const prtBarSegs = await page.evaluate(() => [...document.querySelectorAll(".search-dist-seg")].map((s) => s.title));
prtBarSegs.some((t) => /Physical Readiness/.test(t))
  ? ok("Global Search distribution bar shows a Physical Readiness segment for a query spanning prt + board (" + prtBarSegs.join(" | ") + ")")
  : bad("no Physical Readiness segment in distribution bar: " + JSON.stringify(prtBarSegs));

const prtChip = page.locator(".search-chip", { hasText: "Physical Readiness" });
await prtChip.click();
await page.waitForTimeout(150);
const prtChipActive = await prtChip.evaluate((el) => el.classList.contains("active") && el.getAttribute("aria-pressed") === "true");
prtChipActive ? ok("Physical Readiness filter chip activates (class + aria-pressed) on click") : bad("Physical Readiness chip did not activate");

const prtFiltered = await page.evaluate(() => ({
  hits: document.querySelectorAll(".search-hit").length,
  sections: document.querySelectorAll(".search-section").length,
  title: (document.querySelector(".search-hit-title") || {}).textContent || "",
}));
(prtFiltered.hits === 1 && prtFiltered.sections === 1)
  ? ok("Physical Readiness chip filters results down to the prt hit only (1 result)")
  : bad("after Physical Readiness filter: " + prtFiltered.hits + " hit(s) in " + prtFiltered.sections + " section(s)");
/Bend and Reach/i.test(prtFiltered.title)
  ? ok('a prt-typed result renders for "Bend and Reach" (title: "' + prtFiltered.title + '")')
  : bad("unexpected prt hit title: " + prtFiltered.title);

await page.locator(".search-hit").first().click();
await page.waitForTimeout(150);
const prtNavHash = await page.evaluate(() => location.hash);
prtNavHash === "#/prt" ? ok("clicking a prt search hit navigates to #/prt") : bad("clicking a prt search hit navigated to " + prtNavHash + ", expected #/prt");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSEARCH VIEWS: all passed");
process.exit(fails ? 1 : 0);
