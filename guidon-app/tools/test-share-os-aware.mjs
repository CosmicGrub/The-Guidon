/**
 * "Get the app for this device" panel, the "Study solo or with others?"
 * fork, and the "Someone on a different device wants GUIDON too" QR block
 * (guidon-app/src/index.html's share.js module) - added 2026-09-08 for the
 * QR-code distribution path. Covers all three visitor contexts (iOS,
 * Android, desktop browser) plus the native Android/Tauri Share screen,
 * using the same addInitScript-stubbed-shell technique already proven in
 * test-study-rooms-shell-gate.mjs, since G.pwa's isNative/isShell are
 * captured ONCE at module-load time (post-load stubbing does not work).
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

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

async function newPage(opts) {
  const ctx = await browser.newContext(opts || {});
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  return page;
}
async function gotoShare(page) {
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = "#/share"; });
  await page.waitForTimeout(500);
}
async function panelState(page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll(".view .panel")];
    const eyebrows = panels.map((p) => p.querySelector(".eyebrow")?.textContent);
    const rec = panels.find((p) => p.querySelector(".eyebrow")?.textContent === "Get the app for this device");
    const fork = panels.find((p) => p.querySelector(".eyebrow")?.textContent === "What do you want to do right now?");
    const qr = document.querySelector('.view img[alt^="QR code"]');
    const ios = panels.find((p) => p.querySelector(".eyebrow")?.textContent?.includes("iPhone / iPad"));
    const android = panels.find((p) => p.querySelector(".eyebrow")?.textContent === "Android");
    return {
      eyebrows,
      recText: rec?.querySelector("p")?.textContent,
      recLinkHref: rec?.querySelector("a.btn")?.getAttribute("href"),
      forkFound: !!fork,
      forkButtons: fork ? [...fork.querySelectorAll("button")].map((b) => b.textContent) : null,
      forkHintVisible: !!fork?.querySelector(".hint"),
      qrFound: !!qr, qrComplete: qr?.complete, qrNaturalWidth: qr?.naturalWidth,
      iosHasToggle: !!ios?.querySelector("button.btn.sm.ghost"),
      androidHasToggle: !!android?.querySelector("button.btn.sm.ghost"),
    };
  });
}

// ============================================================
// CASE 1 — iOS visitor
// ============================================================
{
  const page = await newPage({ userAgent: IOS_UA, viewport: { width: 390, height: 844 } });
  await gotoShare(page);
  const s = await panelState(page);
  /on an iPhone or iPad/.test(s.recText || "") ? ok("iOS: recommendation panel identifies iOS and points at Home Screen steps") : bad("iOS: recText = " + s.recText);
  s.iosHasToggle === false ? ok("iOS: iPhone/iPad steps panel is expanded by default (no toggle)") : bad("iOS: iPhone panel unexpectedly collapsed");
  s.androidHasToggle === true ? ok("iOS: Android steps panel is collapsed by default (has a toggle)") : bad("iOS: Android panel unexpectedly expanded");
  s.forkFound && JSON.stringify(s.forkButtons) === JSON.stringify(["Study solo", "Study with others"]) ? ok("iOS: solo/group fork renders both buttons") : bad("iOS: fork buttons = " + JSON.stringify(s.forkButtons));
  s.forkHintVisible ? ok("iOS: fork shows the “needs the installed app” hint (isShell() is false here)") : bad("iOS: fork hint missing");
  s.qrFound && s.qrComplete && s.qrNaturalWidth === 900 ? ok("iOS: install QR image renders, fully loaded, real 900px image") : bad("iOS: qr state = " + JSON.stringify(s));

  // Click "Study with others" - must NOT navigate, must toast.
  await page.click('button:has-text("Study with others")');
  await page.waitForTimeout(250);
  const [hash, toast] = await page.evaluate(() => [location.hash, document.getElementById("toast")?.textContent || ""]);
  hash === "#/share" ? ok("iOS: clicking “Study with others” does not navigate") : bad("iOS: navigated to " + hash);
  /needs the GUIDON app/.test(toast) ? ok("iOS: clicking “Study with others” shows the shared NEEDS_SHELL_TEXT toast") : bad("iOS: toast = " + JSON.stringify(toast));

  await page.close();
}

// ============================================================
// CASE 2 — Android browser visitor (not the installed app)
// ============================================================
{
  const page = await newPage({ userAgent: ANDROID_UA, viewport: { width: 412, height: 915 } });
  await gotoShare(page);
  const s = await panelState(page);
  /You're on Android/.test(s.recText || "") ? ok("Android: recommendation panel identifies Android") : bad("Android: recText = " + s.recText);
  s.recLinkHref === "https://github.com/CosmicGrub/The-Guidon/releases/latest/download/GUIDON-android.apk"
    ? ok("Android: download button links to the stable release permalink")
    : bad("Android: recLinkHref = " + s.recLinkHref);
  s.androidHasToggle === false ? ok("Android: Android steps panel expanded by default") : bad("Android: Android panel unexpectedly collapsed");
  s.iosHasToggle === true ? ok("Android: iPhone/iPad steps panel collapsed by default") : bad("Android: iPhone panel unexpectedly expanded");

  await page.click('button:has-text("Study with others")');
  await page.waitForTimeout(250);
  const hash = await page.evaluate(() => location.hash);
  hash === "#/share" ? ok("Android (browser, no shell): clicking “Study with others” does not navigate") : bad("Android: navigated to " + hash);
  await page.close();
}

// ============================================================
// CASE 3 — plain desktop browser visitor
// ============================================================
{
  const page = await newPage({ viewport: { width: 1280, height: 900 } });
  await gotoShare(page);
  const s = await panelState(page);
  /You're on a computer/.test(s.recText || "") ? ok("Desktop: recommendation panel identifies desktop") : bad("Desktop: recText = " + s.recText);
  s.recLinkHref === "https://github.com/CosmicGrub/The-Guidon/releases/latest/download/GUIDON-windows-setup.exe"
    ? ok("Desktop: download button links to the stable Windows release permalink")
    : bad("Desktop: recLinkHref = " + s.recLinkHref);
  s.iosHasToggle === false && s.androidHasToggle === false
    ? ok("Desktop: BOTH iPhone/iPad and Android steps panels are expanded by default (“list them all”)")
    : bad("Desktop: toggle state = " + JSON.stringify({ ios: s.iosHasToggle, android: s.androidHasToggle }));

  await page.close();
}

// ============================================================
// CASE 4 — simulated Tauri desktop shell: render() must delegate to
// renderNative() entirely, same as the Android case below - there is no
// reachable path where the solo/group fork's own "isShell() true" branch
// ever actually fires (render() early-returns via renderNative() the
// moment G.pwa.isNative() - which IS G.caps.isShell() - is true, before
// the fork panel is ever built), so that branch in share.js's onclick is
// deliberately defensive/future-proofing, not something this suite can
// exercise by clicking a button that doesn't exist in this context. What
// IS real and worth asserting: the dispatch to renderNative() itself,
// which nothing had covered for Tauri specifically before this (Case 5
// below only ever exercised the Android side of that same dispatch).
// ============================================================
{
  const page = await newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => { window.__TAURI_INTERNALS__ = {}; });
  await gotoShare(page);
  const state = await page.evaluate(() => {
    const panels = [...document.querySelectorAll(".view .panel")];
    return {
      isNative: window.G.pwa.isNative(),
      nativeOkFound: !!panels.find((p) => p.querySelector(".eyebrow")?.textContent === "You're running the installed app"),
      forkFound: !!panels.find((p) => p.querySelector(".eyebrow")?.textContent === "What do you want to do right now?"),
    };
  });
  state.isNative === true ? ok("Simulated Tauri shell: G.pwa.isNative() is true") : bad("Simulated Tauri: isNative() = " + state.isNative);
  state.nativeOkFound ? ok("Simulated Tauri shell: render() delegates to renderNative() (the installed-app branch renders)") : bad("Simulated Tauri: native branch not rendered");
  state.forkFound === false ? ok("Simulated Tauri shell: the solo/group fork does NOT render here (confirms its isShell()-true branch is unreachable, not silently broken)") : bad("Simulated Tauri: fork panel unexpectedly rendered alongside renderNative()");
  await page.close();
}

// ============================================================
// CASE 5 — simulated native Android shell: renderNative()'s QR block
// ============================================================
{
  const page = await newPage({ viewport: { width: 412, height: 915 } });
  await page.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} };
  });
  await gotoShare(page);
  const state = await page.evaluate(() => {
    const panels = [...document.querySelectorAll(".view .panel")];
    const nativeOk = panels.find((p) => p.querySelector(".eyebrow")?.textContent === "You're running the installed app");
    const other = panels.find((p) => p.querySelector(".eyebrow")?.textContent === "Someone on a different device wants GUIDON too");
    const qr = document.querySelector('.view img[alt^="QR code"]');
    return {
      isNative: window.G.pwa.isNative(),
      nativeOkFound: !!nativeOk,
      otherHint: other?.querySelector(".hint")?.textContent,
      qrFound: !!qr, qrComplete: qr?.complete,
    };
  });
  state.isNative === true ? ok("Simulated native Android: G.pwa.isNative() is true") : bad("Simulated native Android: isNative() = " + state.isNative);
  state.nativeOkFound ? ok("Simulated native Android: renders the “installed app” branch (renderNative)") : bad("Simulated native Android: native branch not rendered");
  /Not Android/.test(state.otherHint || "") ? ok("Simulated native Android: “different device” hint correctly says “Not Android”") : bad("Simulated native Android: otherHint = " + state.otherHint);
  state.qrFound && state.qrComplete ? ok("Simulated native Android: install QR renders on the native Share screen too") : bad("Simulated native Android: qr state = " + JSON.stringify(state));
  await page.close();
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings across all 5 contexts") : bad("console noise: " + relevantNoise.slice(0, 8).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSHARE OS-AWARE: all passed");
process.exit(fails ? 1 : 0);
