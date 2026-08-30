/**
 * Roadmap-week audit finding: the Reference Library (#/library,
 * src/app-modules/library.js) is a real in-app document reader for 15 Army
 * publications - its own full-text search (searchDoc) with a TOC-exclusion
 * filter, a "Jump to section" navigator built from build-time-extracted
 * headings, and an "Original PDF" tab - but every existing test that even
 * mentions #/library only sweeps it as part of a full-route "renders without
 * throwing" pass. Nothing ever types into the search bar, clicks a "Jump to
 * section" entry, or opens the Original PDF tab.
 *
 * Demonstrated empirically before writing this test: breaking searchDoc() to
 * always report zero hits still passed test-csp.mjs and test-selftest.mjs
 * 100% clean. This file closes that gap by driving the real UI (library.js
 * exposes no internal functions to call directly - G.library is only
 * { render, DOCS, _pdfAvailable, _openId } - so every assertion below goes
 * through the same search box / result rows / TOC toggle a Soldier would
 * actually touch).
 *
 * Fixture doc: ADP 6-0 (id "adp-6-0", 88 pages, TOC pages [2,3] 0-indexed).
 * "warfighting function" is a real phrase from this doc that appears on both
 * TOC pages AND 24 real content pages - a single query that exercises the
 * TOC-exclusion logic (proving it actually filters, not just that search
 * "works" on a query with no TOC overlap to filter).
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
await page.waitForTimeout(400);

await page.evaluate(() => { location.hash = "#/library"; });
await page.waitForTimeout(500);

// ==================== 1) Document list ====================
const docCount = await page.evaluate(() => window.G.library.DOCS.length);
const cards = page.locator(".card.click[role=button]");
(await cards.count()) === docCount
  ? ok("Reference Library lists all " + docCount + " documents")
  : bad("expected " + docCount + " document cards, found " + (await cards.count()));

// ==================== 2) Open ADP 6-0, "Read in GUIDON" tab ====================
await page.locator(".card.click", { hasText: "ADP 6-0" }).click();
await page.waitForTimeout(300);
const heading = await page.locator(".section-title h2").first().textContent();
heading && heading.trim() === "ADP 6-0" ? ok("Detail view opens the clicked document (ADP 6-0)") : bad("detail heading: " + heading);

const readTab = page.locator("button.tab", { hasText: "Read in GUIDON" });
(await readTab.getAttribute("aria-selected")) === "true" ? ok("'Read in GUIDON' tab is active by default") : bad("Read in GUIDON tab not marked selected");

const pageBlocks = page.locator(".lib-page");
const pageCount = await pageBlocks.count();
pageCount === 88 ? ok("all 88 pages rendered as continuous-scroll blocks") : bad("expected 88 .lib-page blocks, found " + pageCount);
const firstMeta = await pageBlocks.first().locator(".meta").textContent();
firstMeta && firstMeta.trim() === "Page 1 / 88" ? ok("first page block is labeled 'Page 1 / 88'") : bad("first page meta: " + firstMeta);

// ==================== 3) In-document search + TOC exclusion ====================
const searchInput = page.locator('input[type="search"]');
await searchInput.fill("warfighting function");
await page.waitForTimeout(400); // search is itself debounced 150ms

const resultsHint = await page.locator(".search-box + div p.hint").first().textContent().catch(() => "");
/24 matches/.test(resultsHint || "")
  ? ok("search returns the expected real hit count (24 matches)")
  : bad("search result count: " + JSON.stringify(resultsHint));

const badges = await page.locator(".ldr-badge").allTextContents();
const excludedTocBadgesPresent = badges.some((b) => b === "p. 3" || b === "p. 4");
(!excludedTocBadgesPresent && badges.length === 24)
  ? ok("TOC pages (p. 3, p. 4) are excluded from search results even though the raw phrase appears there too")
  : bad("TOC-exclusion failed: badges=" + JSON.stringify(badges));

// Clicking a result jumps the continuous scroller to that exact page (via
// jumpToPage -> target.classList.add("list-detail-jumped"), removed after
// 1600ms) - the first real hit for this query is page index 4 (0-based).
await page.locator(".list-detail-row").first().click();
await page.waitForTimeout(50);
const jumped = await page.evaluate(() => {
  const el = document.querySelector('.lib-page[data-page="4"]');
  return el ? el.classList.contains("list-detail-jumped") : null;
});
jumped === true
  ? ok("clicking a search result jumps the scroller to the correct page (data-page=4)")
  : bad("expected .lib-page[data-page=4] to carry list-detail-jumped right after click, got " + jumped);

// ==================== 4) "Jump to section" (TOC navigator) ====================
await searchInput.fill("");
await page.waitForTimeout(300);
const tocToggle = page.locator("button", { hasText: /^Jump to section/ });
await tocToggle.click();
await page.waitForTimeout(150);
// "Army Operations" is a real chapter heading in ADP 6-0's own extracted TOC
// whose first non-TOC occurrence is page index 11 (0-based) - a different
// page than the search test above, so this exercises a distinct code path
// (searchDoc() called internally on the label, not on typed input) landing
// on its own target.
await page.locator(".list-detail-row", { hasText: "Army Operations" }).click();
await page.waitForTimeout(50);
const jumpedToc = await page.evaluate(() => {
  const el = document.querySelector('.lib-page[data-page="11"]');
  return el ? el.classList.contains("list-detail-jumped") : null;
});
jumpedToc === true
  ? ok("clicking a 'Jump to section' entry jumps the scroller to that section's real page (data-page=11)")
  : bad("expected .lib-page[data-page=11] to carry list-detail-jumped after TOC-entry click, got " + jumpedToc);

// ==================== 5) "Original PDF" tab ====================
const pdfTab = page.locator("button.tab", { hasText: "Original PDF" });
(await pdfTab.count()) ? ok("'Original PDF' tab is offered (this doc has a real pdfAsset)") : bad("Original PDF tab missing");
await pdfTab.click();
await page.waitForTimeout(300);
(await pdfTab.getAttribute("aria-selected")) === "true" ? ok("'Original PDF' tab becomes active on click") : bad("Original PDF tab not marked selected after click");
const iframeSrc = await page.locator("#library-stage iframe").getAttribute("src").catch(() => null);
iframeSrc && /docs\/.*\.pdf$/i.test(iframeSrc)
  ? ok("Original PDF tab renders a real PDF viewer pointed at the doc's own file (" + iframeSrc + ")")
  : bad("Original PDF iframe src: " + iframeSrc);
const openNewTab = await page.locator("#library-stage a", { hasText: "Open in a new tab" }).count();
openNewTab ? ok("Original PDF tab offers an 'Open in a new tab' fallback link") : bad("missing 'Open in a new tab' link");

// Switching back to "Read in GUIDON" restores the reader (activeMode is
// remembered across tab switches, not reset).
await readTab.click();
await page.waitForTimeout(300);
(await page.locator(".lib-page").count()) === 88 ? ok("switching back to 'Read in GUIDON' restores the full document") : bad("page blocks missing after switching back");

// ==================== 6) Back to the document list ====================
await page.locator("button", { hasText: /Reference Library/ }).click();
await page.waitForTimeout(300);
(await page.locator(".card.click[role=button]").count()) === docCount
  ? ok("'← Reference Library' returns to the full document list")
  : bad("document list did not restore after navigating back");

// Chromium's own built-in PDF viewer (not app code - the app never requests
// anything under docs/) tries to register a scoped service worker at
// "docs/sw.js" the moment a real PDF renders inline in an <iframe>, purely
// as a side effect of its native viewer chrome. That path doesn't exist
// (the app's real sw.js lives at the site root, not under docs/), so it
// always 404s here - unavoidable from app code, same class of unsuppressible
// network-layer noise test-csp.mjs's own KNOWN/docsAllowance list documents
// for a different PDF-related 404.
const KNOWN = [/bad HTTP response code \(404\).*fetching the script/i, /SW registration failed.*docs\/sw\.js/i];
const relevantNoise = noise.filter((n) => !/favicon/.test(n) && !KNOWN.some((k) => k.test(n)));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nLIBRARY: all passed");
process.exit(fails ? 1 : 0);
