/**
 * PC/desktop intuitivism pass, Tier 1 (structural changes) - 2026-08-22.
 * Covers everything from that tier NOT already exercised by an existing
 * suite (onboarding's focus-trap and width tier are covered by
 * test-onboarding.mjs and don't need duplicating here):
 *
 *   (a) the 960px .main/.view content cap generalized to 1200px at the
 *       app's own >=1360px tier, for every route except Board Drill
 *       (which stays unbounded via its own higher-specificity override)
 *   (b) Search's separate, real layout bug - .main rendered at an
 *       uncentered ~804px even with rules identical to every working
 *       route - fixed with an explicit width instead of relying on
 *       default (and here, unreliable) grid-item stretch
 *   (e) Board Drill's icon-only rail re-expanding back to the normal
 *       labeled one at the measured >=1500px threshold, not staying
 *       icon-only unconditionally past every desktop tier
 *   (f) the nav accordion defaulting one more group (Board Prep) open on
 *       a genuine first-ever desktop visit, without touching a returning
 *       user's own persisted choices
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootTo(hash, viewport, { clearStorage = true } = {}) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(800);
  const guest = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  if (await guest.count()) { await guest.click(); await page.waitForTimeout(800); }
  if (hash) { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(800); }
  return { page, noise };
}

/* ---- (a) General cap-lift: Home/Train/Doctrine at >=1360px ---- */
{
  const { page, noise } = await bootTo("#/home", { width: 1920, height: 1080 });
  const homeMainWidth = await page.evaluate(() => Math.round(document.querySelector(".main").getBoundingClientRect().width));
  homeMainWidth === 1200
    ? ok(`at 1920px, #/home's .main uses the new 1200px cap (was 960px) - got ${homeMainWidth}px`)
    : bad(`#/home's .main width at 1920px: ${homeMainWidth}px, expected 1200px`);

  await page.evaluate(() => { location.hash = "#/train"; });
  await page.waitForTimeout(800);
  const trainCols = await page.evaluate(() => {
    const grid = document.querySelector(".grid");
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
  });
  trainCols >= 4
    ? ok(`at 1920px, Train's scenario grid reflows to ${trainCols} columns (was frozen at 3) - unlocked for free by the cap-lift, no grid changes of its own`)
    : bad(`Train's grid shows ${trainCols} columns at 1920px, expected >=4`);

  await page.evaluate(() => { location.hash = "#/doctrine"; });
  await page.waitForTimeout(800);
  const doctrineDetailWidth = await page.evaluate(() => {
    const ld = document.querySelector(".list-detail");
    if (!ld) return null;
    const cols = getComputedStyle(ld).gridTemplateColumns.split(" ").filter(Boolean);
    return cols.length ? Math.round(parseFloat(cols[cols.length - 1])) : null;
  });
  doctrineDetailWidth !== null && doctrineDetailWidth > 700
    ? ok(`at 1920px, Doctrine's reading pane is ${doctrineDetailWidth}px wide (was 574px before the cap-lift)`)
    : bad(`Doctrine's reading-pane column is ${doctrineDetailWidth}px at 1920px, expected >700px`);

  // Below the gate: unchanged 960px, not a partial/broken in-between state.
  await page.close();
  const { page: narrowPage, noise: narrowNoise } = await bootTo("#/home", { width: 1359, height: 900 });
  const narrowMainWidth = await narrowPage.evaluate(() => Math.round(document.querySelector(".main").getBoundingClientRect().width));
  narrowMainWidth === 960
    ? ok(`at 1359px (just below the gate), #/home's .main stays at the original 960px cap`)
    : bad(`#/home's .main width at 1359px: ${narrowMainWidth}px, expected 960px (unchanged below the gate)`);
  const allNoise = noise.concat(narrowNoise).filter((n) => !/favicon/.test(n));
  allNoise.length === 0 ? ok("no console errors/warnings (cap-lift checks)") : bad("console noise: " + allNoise.slice(0, 5).join(" | "));
  await narrowPage.close();
}

/* ---- Board Drill stays unbounded, unaffected by the general cap ---- */
{
  const { page } = await bootTo("#/board", { width: 1920, height: 1080 });
  const row = page.locator(".list-detail-row").first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(800); }
  const boardMainWidth = await page.evaluate(() => Math.round(document.querySelector(".main").getBoundingClientRect().width));
  boardMainWidth > 1200
    ? ok(`Board Drill's .main stays unbounded (${boardMainWidth}px, > the 1200px general cap) - its own higher-specificity override still wins`)
    : bad(`Board Drill's .main is only ${boardMainWidth}px at 1920px - the general cap may have overridden its own unbounded rule`);
  await page.close();
}

/* ---- (b) Search's own separate width bug ---- */
{
  const { page, noise } = await bootTo("#/search", { width: 1920, height: 1080 });
  const info = await page.evaluate(() => {
    const main = document.querySelector(".main");
    const rect = main.getBoundingClientRect();
    const app = document.querySelector("#app");
    const railWidth = parseFloat(getComputedStyle(app).gridTemplateColumns.split(" ")[0]);
    const gridAreaWidth = innerWidth - railWidth;
    const marginLeft = rect.left - railWidth;
    const marginRight = innerWidth - rect.right;
    return { width: Math.round(rect.width), centeredInGridArea: Math.abs(marginLeft - marginRight) < 3, marginLeft: Math.round(marginLeft), marginRight: Math.round(marginRight) };
  });
  info.width === 1200
    ? ok(`Search's .main is ${info.width}px wide at 1920px (was ~804px, uncentered and content-shrunk)`)
    : bad(`Search's .main width: ${info.width}px, expected 1200px`);
  info.centeredInGridArea
    ? ok(`Search's .main is correctly centered within its grid area (${info.marginLeft}px / ${info.marginRight}px margins)`)
    : bad(`Search's .main is not centered within its grid area (margins: ${info.marginLeft}px / ${info.marginRight}px)`);
  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (Search width fix)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- (e) Board Drill's rail re-expansion at the measured 1500px gate ---- */
{
  const { page: below } = await bootTo("#/board", { width: 1499, height: 900 });
  const belowCols = await below.evaluate(() => getComputedStyle(document.querySelector("#app")).gridTemplateColumns);
  belowCols.startsWith("96px")
    ? ok(`at 1499px (just below the gate), Board Drill's rail stays icon-only (96px) - got "${belowCols}"`)
    : bad(`Board Drill's rail at 1499px: "${belowCols}", expected to start with "96px"`);
  const belowOverflow = await below.evaluate(() => {
    const dl = document.querySelector(".drill-layout"); const v = document.querySelector(".view");
    return dl && v ? dl.getBoundingClientRect().right > v.getBoundingClientRect().right + 1 : null;
  });
  belowOverflow === false
    ? ok("at 1499px, the icon-only rail still leaves .drill-layout fitting cleanly, no overflow")
    : bad(`at 1499px, .drill-layout overflow check: ${belowOverflow}`);
  await below.close();

  const { page: at, noise: atNoise } = await bootTo("#/board", { width: 1500, height: 900 });
  const atCols = await at.evaluate(() => getComputedStyle(document.querySelector("#app")).gridTemplateColumns);
  atCols.startsWith("232px")
    ? ok(`at exactly 1500px, Board Drill's rail restores to the normal labeled width (232px) - got "${atCols}"`)
    : bad(`Board Drill's rail at 1500px: "${atCols}", expected to start with "232px"`);
  const atOverflow = await at.evaluate(() => {
    const dl = document.querySelector(".drill-layout"); const v = document.querySelector(".view");
    return dl && v ? dl.getBoundingClientRect().right > v.getBoundingClientRect().right + 1 : null;
  });
  atOverflow === false
    ? ok("at 1500px with the labeled rail restored, .drill-layout still fits cleanly, no overflow")
    : bad(`at 1500px, .drill-layout overflow check: ${atOverflow}`);
  const navLabelVisible = await at.evaluate(() => {
    const btn = [...document.querySelectorAll(".nav :is(button, a)")].find((b) => /home/i.test(b.textContent || ""));
    return btn ? getComputedStyle(btn).fontSize !== "0px" : null;
  });
  navLabelVisible
    ? ok("at 1500px, nav labels are visible again (font-size restored from 0), not still suppressed")
    : bad("nav button labels are still suppressed (font-size:0) at 1500px");
  const relevantNoise = atNoise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (rail re-expansion)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await at.close();
}

/* ---- (f) Nav default-open: Board Prep opens on a genuine first-ever
   desktop visit, but never overrides a returning user's own persisted
   (even fully-empty) choice ---- */
{
  const { page: first, noise: firstNoise } = await bootTo(null, { width: 1440, height: 900 });
  const firstVisitOpen = await first.evaluate(() => {
    const header = [...document.querySelectorAll(".nav-group-header")].find((h) => /board prep/i.test(h.textContent || ""));
    return header ? header.classList.contains("open") : null;
  });
  firstVisitOpen === true
    ? ok("on a genuine first-ever desktop visit (>=1200px), the Board Prep nav group defaults open")
    : bad(`Board Prep's open state on first visit: ${firstVisitOpen}, expected true`);

  // A returning user who explicitly closed it: their choice must stick,
  // not get silently re-opened by this default on their next visit.
  await first.evaluate(() => {
    const header = [...document.querySelectorAll(".nav-group-header")].find((h) => /board prep/i.test(h.textContent || ""));
    if (header && header.classList.contains("open")) header.click();
  });
  await first.waitForTimeout(200);
  await first.reload();
  await first.waitForTimeout(800);
  const afterExplicitCloseAndReload = await first.evaluate(() => {
    const header = [...document.querySelectorAll(".nav-group-header")].find((h) => /board prep/i.test(h.textContent || ""));
    return header ? header.classList.contains("open") : null;
  });
  afterExplicitCloseAndReload === false
    ? ok("a returning user who explicitly closed Board Prep keeps it closed on reload - the first-visit default never re-opens an explicit choice")
    : bad(`Board Prep's open state after explicit close + reload: ${afterExplicitCloseAndReload}, expected false (the user's own choice must stick)`);
  const relevantNoise = firstNoise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (nav default-open)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await first.close();
}

/* ---- Below 1200px: nav default-open must not apply - unchanged mobile/tablet behavior ---- */
{
  const { page, noise } = await bootTo(null, { width: 1199, height: 900 });
  const open = await page.evaluate(() => {
    const header = [...document.querySelectorAll(".nav-group-header")].find((h) => /board prep/i.test(h.textContent || ""));
    return header ? header.classList.contains("open") : null;
  });
  open === false
    ? ok("below 1200px, Board Prep stays closed by default on first visit - unchanged mobile/tablet behavior")
    : bad(`Board Prep's open state at 1199px on first visit: ${open}, expected false`);
  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (below-gate nav default)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `INTUITIVISM PC TIER 1: ${fails} FAILURE(S)` : "INTUITIVISM PC TIER 1: all passed"));
process.exit(fails ? 1 : 0);
