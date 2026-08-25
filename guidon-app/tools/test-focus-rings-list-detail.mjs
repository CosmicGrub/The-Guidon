/**
 * Roadmap Tier 6 "Supporting" - regression coverage for the .list-detail-row
 * focus-visible ring (src/index.html, `.list-detail-row:focus-visible {
 * outline: 3px solid var(--amber); outline-offset: 2px; }`).
 *
 * This rule already ships and already works on all four list-detail routes -
 * Board Drill's catList, Doctrine's entryList, Search's entryList, and Squad
 * Roster's rosterList (src/app-modules/leader.js) - confirmed live before
 * writing this file. The gap this test closes is pure coverage: nothing
 * asserted the ring existed, so a future refactor (e.g. a CSS consolidation
 * pass that renames `.list-detail-row:focus-visible` or drops its
 * outline-offset) could silently regress it with no test catching it.
 *
 * Focus technique: reuses the exact `row.focus()` pattern
 * tools/test-list-nav-tier2d.mjs already relies on for these same rows,
 * rather than inventing a new one. That reuse is backed by two things
 * checked empirically (not assumed) before writing this file, against a
 * real headless Chromium instance:
 *   - a script-triggered `.focus()` call on one of these <button> rows DOES
 *     set the browser's real :focus-visible flag (Chromium's own heuristic
 *     treats programmatic focus as keyboard-like), confirmed here via
 *     `row.matches(":focus-visible")` rather than trusting that by
 *     assumption - a plain .focus() call does NOT reliably set
 *     :focus-visible in every browser/context, so this is checked, not
 *     assumed.
 *   - it is NOT a vacuous check: a genuine real-mouse `page.mouse.click()`
 *     directly on the same row correctly comes back with
 *     :focus-visible === false in the same environment, proving this
 *     technique is actually distinguishing keyboard-like focus from
 *     pointer-like focus rather than always reporting true.
 * A real `page.keyboard.press("Tab")` walk was also verified to land on
 * the same true/false outcomes, but was NOT used as the primary mechanism
 * here: the number of Tabs needed to reach the first row differs per route
 * (nav sidebar depth, per-page controls) and would make this test brittle
 * to unrelated Tab-order changes elsewhere in the app - exactly the kind
 * of false regression this file exists to avoid, not introduce.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootTo(hash, viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(1000);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(1000);
  return { page, noise };
}

// >=1024px so .list-detail actually renders as the side-by-side grid split
// (below that it's display:block stacked - see test-search-list-detail.mjs's
// own 1023/1024 breakpoint check) - the focus ring exists either way, but
// the roadmap item specifically targets the split-layout row shape.
const VIEWPORT = { width: 1440, height: 900 };
const AMBER_RGB = "rgb(75, 83, 32)"; // the default guest-session theme's --amber token (#4b5320)

async function assertRingOnFirstRow(page, selector, routeLabel) {
  const rowCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, selector);
  if (rowCount < 1) {
    bad(`${routeLabel}: 0 rows matched "${selector}" - nothing to focus`);
    return;
  }
  ok(`${routeLabel}: ${rowCount} row(s) rendered (${selector})`);

  const result = await page.evaluate((sel) => {
    const row = document.querySelector(sel);
    row.focus();
    const cs = getComputedStyle(row);
    return {
      focusVisible: row.matches(":focus-visible"),
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
      rowText: row.querySelector(".ldr-name")?.textContent || "",
    };
  }, selector);

  result.focusVisible
    ? ok(`${routeLabel}: focusing the first row ("${result.rowText}") sets real :focus-visible state`)
    : bad(`${routeLabel}: row.focus() did not set :focus-visible - this test's own technique assumption broke, or the row lost its native focusability`);

  result.outlineWidth === "3px"
    ? ok(`${routeLabel}: focus-visible outline-width is 3px`)
    : bad(`${routeLabel}: expected outline-width 3px, got "${result.outlineWidth}"`);

  result.outlineStyle === "solid"
    ? ok(`${routeLabel}: focus-visible outline-style is solid`)
    : bad(`${routeLabel}: expected outline-style solid, got "${result.outlineStyle}"`);

  result.outlineColor === AMBER_RGB
    ? ok(`${routeLabel}: focus-visible outline-color resolves to the real --amber token (${AMBER_RGB})`)
    : bad(`${routeLabel}: expected outline-color ${AMBER_RGB}, got "${result.outlineColor}"`);

  result.outlineOffset === "2px"
    ? ok(`${routeLabel}: focus-visible outline-offset is 2px`)
    : bad(`${routeLabel}: expected outline-offset 2px, got "${result.outlineOffset}"`);
}

function reportNoise(noise, routeLabel) {
  const relevant = noise.filter((n) => !/favicon/.test(n));
  relevant.length === 0
    ? ok(`${routeLabel}: no console errors/warnings`)
    : bad(`${routeLabel}: console noise: ` + relevant.slice(0, 5).join(" | "));
}

/* ================= Board Drill's catList (#/board) ================= */
// Deliberately NOT seeding due cards: refreshCatList() (src/index.html)
// builds one row per CATEGORY from the app's own shipped `categories` list
// (plus "All"), unconditionally - the "N due" badge is the only thing that
// depends on due cards, not row existence. Verified directly against the
// refreshCatList() source before writing this (categories.forEach(...) with
// no due-count gate on whether a row gets created at all) rather than
// assumed from the roadmap note that first scoped this test.
{
  const { page, noise } = await bootTo("#/board", VIEWPORT);
  await page.waitForFunction(
    () => document.querySelectorAll(".drill-layout .list-detail-list .list-detail-row").length > 0,
    { timeout: 5000 }
  ).catch(() => {});
  await assertRingOnFirstRow(page, ".drill-layout .list-detail-list .list-detail-row", "Board Drill catList (#/board)");
  reportNoise(noise, "Board Drill catList (#/board)");
  await page.close();
}

/* ================= Doctrine's entryList (#/doctrine) ================= */
{
  const { page, noise } = await bootTo("#/doctrine", VIEWPORT);
  await assertRingOnFirstRow(page, ".list-detail-list .list-detail-row", "Doctrine entryList (#/doctrine)");
  reportNoise(noise, "Doctrine entryList (#/doctrine)");
  await page.close();
}

/* ================= Search's entryList, real query (#/search) ================= */
{
  const { page, noise } = await bootTo("#/search", VIEWPORT);
  await page.evaluate(() => {
    const inp = document.querySelector('input[type="search"]');
    inp.focus();
    inp.value = "leader";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(600);
  await assertRingOnFirstRow(page, ".list-detail-list .list-detail-row", "Search entryList (#/search)");
  reportNoise(noise, "Search entryList (#/search)");
  await page.close();
}

/* ================= Squad Roster's rosterList (#/leader) ================= */
// Seed one real roster entry first - rosterList (src/app-modules/leader.js)
// renders one row per entry in `roster`, which starts empty, so an
// unseeded page has 0 rows to focus.
{
  const { page, noise } = await bootTo("#/leader", VIEWPORT);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /add soldier/i.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(600);
  await assertRingOnFirstRow(page, ".list-detail-list .list-detail-row", "Squad Roster rosterList (#/leader)");
  reportNoise(noise, "Squad Roster rosterList (#/leader)");
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `FOCUS RINGS (LIST-DETAIL): ${fails} FAILURE(S)` : "FOCUS RINGS (LIST-DETAIL): all passed"));
process.exit(fails ? 1 : 0);
