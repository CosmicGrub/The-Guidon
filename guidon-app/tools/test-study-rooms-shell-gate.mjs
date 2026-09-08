/**
 * Study Rooms needs a native TLS listener/connector to host or join a
 * secure room (see src/room-web.js's SECURE_NO_NATIVE_TEXT and
 * nativeTlsPlugin()) - Tauri on PC and the Capacitor plugin on Android both
 * provide one; a plain browser tab never can. That is the ONLY way GUIDON
 * ever runs on iOS (no Capacitor build ships for it - see caps.js's
 * SHIPS.ios), so navButton() (src/index.html) grey out the "Study group" nav
 * entry with an honest reason whenever G.caps.isShell() is false, instead of
 * leaving a Soldier to tap in and hit a dead end.
 *
 * The one thing this test exists to prove beyond doubt: Android and PC are
 * completely untouched by this. It isn't enough to reason from the code that
 * G.caps.isShell() is true on both - this test actually SIMULATES a
 * Capacitor shell and a Tauri shell (stubbing the exact globals G.caps.js
 * itself reads) and asserts the gate provably does not fire in either case,
 * alongside the real un-stubbed browser-tab case where it must.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];

async function openGroupNavState(page) {
  return page.evaluate(() => {
    const a = document.querySelector('.nav a[data-hash="#/group"]');
    if (!a) return null;
    const ico = a.querySelector(".ico svg");
    return {
      exists: true,
      hasShellOnlyClass: a.classList.contains("nav-shell-only"),
      ariaDisabled: a.getAttribute("aria-disabled"),
      ariaLabel: a.getAttribute("aria-label"),
      title: a.getAttribute("title"),
      iconIsGi: !!ico && ico.classList.contains("gi"),
      // The icon geometry itself doesn't carry a name in the DOM - compare
      // outerHTML against a freshly-drawn reference icon instead, so this
      // asserts the SPECIFIC icon swapped in, not just "some svg exists".
      iconOuterHTML: ico ? ico.outerHTML : null,
    };
  });
}

async function referenceIconHTML(page, name) {
  return page.evaluate((n) => window.G.icons.el(n, 18).outerHTML, name);
}

async function clickAndCheckNav(page, beforeHash) {
  await page.locator('.nav a[data-hash="#/group"]').click({ force: true });
  await page.waitForTimeout(300);
  return page.evaluate(() => location.hash);
}

// ============================================================
// CASE 1 — real browser tab, no shell (the actual iOS/PWA situation)
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[browser] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[browser] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(500);

  const isShell = await page.evaluate(() => window.G.caps.isShell());
  isShell === false
    ? ok("sanity: G.caps.isShell() is false in a plain browser tab (proves this IS the condition being gated on)")
    : bad("sanity: G.caps.isShell() was true in a plain browser tab - " + isShell);

  // Open the "Board Prep" group (where #/group lives) if collapsed.
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(400);

  const state = await openGroupNavState(page);
  const lockRef = await referenceIconHTML(page, "lock");

  state && state.exists ? ok("#/group nav entry exists in the DOM") : bad("#/group nav entry not found in a plain browser tab");
  state && state.hasShellOnlyClass
    ? ok('#/group nav entry carries the "nav-shell-only" class in a plain browser tab')
    : bad('#/group nav entry missing "nav-shell-only" in a plain browser tab: ' + JSON.stringify(state));
  state && state.ariaDisabled === "true"
    ? ok('#/group nav entry has aria-disabled="true" in a plain browser tab')
    : bad("#/group nav entry aria-disabled in a plain browser tab: " + (state && state.ariaDisabled));
  state && /needs the GUIDON app/.test(state.ariaLabel || "")
    ? ok("#/group nav entry's aria-label explains the limitation in a plain browser tab")
    : bad("#/group nav entry aria-label in a plain browser tab: " + (state && state.ariaLabel));
  state && /secure connection/.test(state.title || "")
    ? ok("#/group nav entry's title tooltip explains the limitation in a plain browser tab")
    : bad("#/group nav entry title in a plain browser tab: " + (state && state.title));
  state && state.iconIsGi && state.iconOuterHTML === lockRef
    ? ok("#/group nav entry renders the real lock icon (not the users icon, not a fallback glyph) in a plain browser tab")
    : bad("#/group nav entry icon in a plain browser tab did not match the lock icon: " + JSON.stringify({ got: state && state.iconOuterHTML, expected: lockRef }));

  const beforeHash = await page.evaluate(() => location.hash);
  const afterHash = await clickAndCheckNav(page, beforeHash);
  const toastText = await page.evaluate(() => document.getElementById("toast")?.textContent || "");
  afterHash === beforeHash
    ? ok("clicking the greyed #/group nav entry does NOT navigate in a plain browser tab (stayed on " + beforeHash + ")")
    : bad("clicking the greyed #/group nav entry navigated anyway: " + beforeHash + " -> " + afterHash);
  /needs the GUIDON app/.test(toastText)
    ? ok('clicking the greyed #/group nav entry shows the explanatory toast: "' + toastText + '"')
    : bad("toast text after clicking the greyed #/group nav entry: " + JSON.stringify(toastText));

  await page.close();
}

// ============================================================
// CASE 2 — simulated Capacitor (Android) shell: must be COMPLETELY untouched
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[android-sim] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[android-sim] pageerror: " + e.message));
  // Stub the exact global G.caps.js's isShell()/isCapacitor() read
  // (window.Capacitor with isNativePlatform()/getPlatform(), plus a Plugins
  // bag so RoomTls-style plugin checks elsewhere don't throw) - installed
  // BEFORE any page script runs, so caps.js's own module-load-time reads see
  // it exactly as a real Capacitor Android build would.
  await page.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: {},
    };
  });
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(500);

  const isShell = await page.evaluate(() => window.G.caps.isShell());
  isShell === true
    ? ok("simulated Capacitor/Android shell: G.caps.isShell() reports true")
    : bad("simulated Capacitor/Android shell: G.caps.isShell() reported " + isShell + " (stub not taking effect)");

  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(400);
  // <412px width uses the flat mobile bar + "More" drawer, not the inline
  // sidebar - #/group only ever sits in the "Board Prep" group, reached via
  // the drawer at this width.
  const moreBtn = page.locator(".nav-more-btn");
  if (await moreBtn.count()) { await moreBtn.click(); await page.waitForTimeout(300); }

  const state = await page.evaluate(() => {
    const a = document.querySelector('a[data-hash="#/group"]');
    if (!a) return null;
    const ico = a.querySelector(".ico svg");
    return { exists: true, hasShellOnlyClass: a.classList.contains("nav-shell-only"), ariaDisabled: a.getAttribute("aria-disabled"), iconOuterHTML: ico ? ico.outerHTML : null };
  });
  const usersRef = await referenceIconHTML(page, "users");

  state && state.exists ? ok("simulated Android: #/group nav entry exists") : bad("simulated Android: #/group nav entry not found");
  state && state.hasShellOnlyClass === false
    ? ok('simulated Android: #/group nav entry does NOT carry "nav-shell-only" - completely untouched')
    : bad('simulated Android: #/group nav entry INCORRECTLY carries "nav-shell-only": ' + JSON.stringify(state));
  state && state.ariaDisabled == null
    ? ok("simulated Android: #/group nav entry has no aria-disabled attribute")
    : bad("simulated Android: #/group nav entry aria-disabled: " + (state && state.ariaDisabled));
  state && state.iconOuterHTML === usersRef
    ? ok("simulated Android: #/group nav entry renders the ordinary users icon, not the lock icon")
    : bad("simulated Android: #/group nav entry icon did not match the users icon: " + JSON.stringify({ got: state && state.iconOuterHTML, expected: usersRef }));

  // A real click must navigate normally here - this is the strongest
  // possible proof "Android untouched" actually means the feature still
  // works, not just that a CSS class is absent.
  const beforeHash = await page.evaluate(() => location.hash);
  const link = page.locator('a[data-hash="#/group"]').first();
  await link.click();
  await page.waitForTimeout(400);
  const afterHash = await page.evaluate(() => location.hash);
  afterHash === "#/group"
    ? ok("simulated Android: clicking #/group DOES navigate there normally (was " + beforeHash + ")")
    : bad("simulated Android: clicking #/group navigated to " + afterHash + ", expected #/group");

  await page.close();
}

// ============================================================
// CASE 3 — simulated Tauri (PC desktop) shell: must also be untouched
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[tauri-sim] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[tauri-sim] pageerror: " + e.message));
  await page.addInitScript(() => { window.__TAURI_INTERNALS__ = {}; });
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(500);

  const isShell = await page.evaluate(() => window.G.caps.isShell());
  isShell === true
    ? ok("simulated Tauri/PC shell: G.caps.isShell() reports true")
    : bad("simulated Tauri/PC shell: G.caps.isShell() reported " + isShell + " (stub not taking effect)");

  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(400);

  const state = await openGroupNavState(page);
  state && state.hasShellOnlyClass === false
    ? ok('simulated Tauri/PC: #/group nav entry does NOT carry "nav-shell-only" - completely untouched')
    : bad('simulated Tauri/PC: #/group nav entry INCORRECTLY carries "nav-shell-only": ' + JSON.stringify(state));
  state && state.ariaDisabled == null
    ? ok("simulated Tauri/PC: #/group nav entry has no aria-disabled attribute")
    : bad("simulated Tauri/PC: #/group nav entry aria-disabled: " + (state && state.ariaDisabled));

  const afterHash = await clickAndCheckNav(page, "#/board");
  afterHash === "#/group"
    ? ok("simulated Tauri/PC: clicking #/group DOES navigate there normally")
    : bad("simulated Tauri/PC: clicking #/group navigated to " + afterHash + ", expected #/group");

  await page.close();
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings across all three contexts") : bad("console noise: " + relevantNoise.slice(0, 8).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSTUDY ROOMS SHELL GATE: all passed");
process.exit(fails ? 1 : 0);
