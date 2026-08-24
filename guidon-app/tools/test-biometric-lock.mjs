/**
 * Opt-in biometric unlock for Personal Account: src/biometric.js (G.biometric,
 * the thin Cap.Plugins.BiometricAuthNative bridge) + G.biometricGate
 * (src/index.html, near G.kioskBadge — the actual launch/resume gate and
 * lock overlay) + the "Biometric lock" Settings toggle (views.settings,
 * right after the Notifications panel).
 *
 * Mocking convention matches test-notify-status.mjs/test-haptics-capacitor.mjs
 * (this suite's established pattern for stubbing a Capacitor plugin): assign a
 * fake `window.Capacitor = { Plugins: { <Name>: { <method>: spy } } }`. Unlike
 * the Haptics suite (a post-load page.evaluate() stub is fine there — nothing
 * reads window.Capacitor before the action under test fires), biometric.js's
 * own `isNative` is a plain module-scope const resolved ONCE when the script
 * itself first runs, exactly like notify.js's — so this needs
 * context.addInitScript() (runs ahead of every page script, every
 * navigation) the same way test-notify-status.mjs does, not a later
 * page.evaluate().
 *
 * G.biometric/G.biometricGate only ship in the web/ bundle (build.mjs injects
 * biometric.js there, not into dist/guidon-standalone.html — same fact
 * test-native-unit.mjs's/test-notify-status.mjs's own headers document), so
 * this suite runs against web/ like those two do.
 *
 * Coverage:
 *   0) Sanity — the mock lands before biometric.js's own isNative check.
 *   1) Settings toggle defaults OFF for a fresh Personal profile.
 *   2) Turning the toggle on requires a real (mocked) proof-of-enrollment
 *      prompt to succeed first — unavailable hardware and a failed/cancelled
 *      prompt both leave it off, with an honest status message; a real
 *      success turns it on and persists it. Turning it back off needs no
 *      prompt at all (same as Notifications' own "no permission needed to
 *      turn off" asymmetry).
 *   3) With it on, cold launch (a real reload) actually gates: the profile
 *      greeting/route never render until a mocked auth succeeds; a
 *      cancelled/failed attempt holds the gate and lets the Soldier retry
 *      (never a lockout); a successful one lets them straight through.
 *   4) The SAME gate re-arms on the native "appStateChange" resume signal —
 *      not on plain route navigation.
 *   5) Fail-open: hardware/enrollment unavailable while the setting is on
 *      does not lock anyone out — the gate is skipped, once, with a toast.
 *   6) The non-native (plain web, no window.Capacitor at all) fallback path:
 *      G.biometric is absent, the Settings panel doesn't render, the gate
 *      never engages even if biometricLock=true is already stored, and
 *      nothing throws.
 *   7) Guest and Kiosk sessions are completely unaffected even with
 *      biometricLock=true stored and biometrics mocked as available.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

// ─────────────────────────────────────────────────────────────────────────
// Sections 0-5, 7: a native context with a mocked BiometricAuthNative +
// App plugin. window.__bioAvailable/__bioAuthResult drive the mock's
// answers; both mirror into localStorage so they survive a real reload
// (addInitScript reruns fresh on every navigation, same reasoning
// test-notify-status.mjs documents for its own __mockPerm).
// ─────────────────────────────────────────────────────────────────────────
const context = await browser.newContext();
const page = await context.newPage();
const noise = [];
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") noise.push("console.error: " + m.text()); });

await context.addInitScript(() => {
  window.__bioAvailable = JSON.parse(localStorage.getItem("__test_bioAvailable") || "true");
  window.__bioAuthResult = localStorage.getItem("__test_bioAuthResult") || "success"; // success | cancel | lockout | fail
  window.__bioAuthCalls = 0;
  window.__appStateListeners = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      BiometricAuthNative: {
        checkBiometry: async () => (
          window.__bioAvailable
            ? { isAvailable: true, code: "", reason: "" }
            : { isAvailable: false, code: "biometryNotEnrolled", reason: "No biometrics enrolled" }
        ),
        internalAuthenticate: async () => {
          window.__bioAuthCalls++;
          const mode = window.__bioAuthResult;
          if (mode === "success") return;
          const codeMap = { cancel: "userCancel", lockout: "biometryLockout", fail: "authenticationFailed" };
          const err = new Error("mock biometry failure: " + mode);
          err.code = codeMap[mode] || "authenticationFailed";
          throw err;
        },
      },
      App: {
        addListener: async (type, handler) => {
          window.__appStateListeners.push({ type, handler });
          return { remove: () => {} };
        },
      },
    },
  };
});

function setBioAvailable(v) {
  return page.evaluate((val) => { window.__bioAvailable = val; localStorage.setItem("__test_bioAvailable", JSON.stringify(val)); }, v);
}
function setBioAuthResult(mode) {
  return page.evaluate((m) => { window.__bioAuthResult = m; localStorage.setItem("__test_bioAuthResult", m); }, mode);
}
function fireAppStateChange(isActive) {
  return page.evaluate((active) => {
    (window.__appStateListeners || []).filter((l) => l.type === "appStateChange").forEach((l) => l.handler({ isActive: active }));
  }, isActive);
}
async function dismissOnboardingVia(mode) {
  await page.waitForTimeout(700);
  const card = page.locator(".ob-mode-card", { hasText: mode === "kiosk" ? /kiosk/i : /guest session/i }).first();
  await card.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await card.count()) {
    await card.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}
/** Wipes any stored profile so the next load/reload needs onboarding again. */
async function clearStoredProfile() {
  await page.evaluate(async () => { try { await window.G.db.put("kv", { k: "guidon:profile:v1", v: null }); } catch (e) {} });
}
async function seedPersonalProfile() {
  await page.evaluate(async () => {
    await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
      onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
      displayName: "SGT TESTFIRE", lastName: "TESTFIRE", anonymous: false,
      studyWeakPoints: [], readinessConcerns: [], actionPlan: [], promoPoints: {},
    } });
  });
}
async function setBiometricLockSetting(v) {
  await page.evaluate(async (val) => {
    const s = await window.G.db.get("kv", "settings");
    const sv = Object.assign({}, s && s.v, { biometricLock: val });
    await window.G.db.put("kv", { k: "settings", v: sv });
  }, v);
}

// ============================================================
// 0) Sanity
// ============================================================
await page.goto(url, { waitUntil: "load" });
await dismissOnboardingVia("guest");

const boot = await page.evaluate(() => ({
  hasBiometric: !!(window.G && window.G.biometric),
  supported: !!(window.G && window.G.biometric && window.G.biometric.supported()),
  hasGate: !!(window.G && window.G.biometricGate),
}));
boot.hasBiometric ? ok("G.biometric loaded in the web/ build") : bad("G.biometric missing");
boot.supported
  ? ok("G.biometric.supported() is true under the mocked native Capacitor shell (proves addInitScript landed before biometric.js's own module-scope isNative check ran)")
  : bad("G.biometric.supported() is false — the Capacitor mock did not take effect before biometric.js ran");
boot.hasGate ? ok("G.biometricGate is exposed (index.html)") : bad("G.biometricGate missing");

// ============================================================
// 1) Settings toggle defaults OFF for a fresh, real Personal profile.
// ============================================================
await seedPersonalProfile();
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(500);

const bioCheckbox = page.getByRole("checkbox", { name: "Biometric lock for Personal Account", exact: true });
(await bioCheckbox.count()) > 0
  ? ok("the Biometric lock panel renders when G.biometric.supported() is true")
  : bad("Biometric lock checkbox not found on #/settings");
(await bioCheckbox.isChecked()) === false
  ? ok("checkbox starts unchecked (fresh profile — biometricLock defaults off)")
  : bad("checkbox unexpectedly started checked");

const storedBefore = await page.evaluate(async () => { const r = await window.G.db.get("kv", "settings"); return r && r.v && r.v.biometricLock; });
(storedBefore === false || storedBefore === undefined)
  ? ok("settings.biometricLock is falsy in storage before any toggle interaction")
  : bad("settings.biometricLock unexpectedly stored as: " + storedBefore);

// Same native-click idiom test-settings-toggles.mjs uses for a CSS-hidden
// checkbox behind a styled <label class="toggle">.
async function clickBioCheckbox() { await bioCheckbox.evaluate((elx) => elx.click()); }
async function bioStatusText() {
  return page.evaluate(() => {
    const cb = document.querySelector('input[aria-label="Biometric lock for Personal Account"]');
    const panel = cb ? cb.closest(".panel") : null;
    // bioStatus is appended to the panel LAST (after the static description
    // paragraph, which lives nested one level down inside the switch row's
    // own <div> — not a sibling of bioStatus, so a plain "p.hint:last-of-type"
    // selector matches that static description instead). The panel's own
    // last direct child is unambiguously bioStatus.
    const p = panel ? panel.lastElementChild : null;
    return p ? p.textContent : null;
  });
}

// ============================================================
// 2a) Turning it ON while hardware/enrollment is unavailable: stays off,
//     no authenticate() call, honest message.
// ============================================================
await setBioAvailable(false);
await clickBioCheckbox();
await page.waitForTimeout(300);
(await bioCheckbox.isChecked()) === false
  ? ok("toggle stays OFF when checkAvailability() reports no usable biometrics")
  : bad("toggle turned on despite unavailable biometrics");
let authCallsAfterUnavailable = await page.evaluate(() => window.__bioAuthCalls);
authCallsAfterUnavailable === 0
  ? ok("no authenticate() prompt was even attempted when hardware/enrollment is unavailable")
  : bad("authenticate() was called " + authCallsAfterUnavailable + " time(s) despite unavailable biometrics");
(await bioStatusText() || "").match(/enroll one in your device/i)
  ? ok("unavailable case shows an honest, actionable status message")
  : bad("unexpected status message for the unavailable case: " + JSON.stringify(await bioStatusText()));
const storedAfterUnavailable = await page.evaluate(async () => { const r = await window.G.db.get("kv", "settings"); return r && r.v && r.v.biometricLock; });
!storedAfterUnavailable
  ? ok("settings.biometricLock was never written to storage for the unavailable attempt")
  : bad("settings.biometricLock was unexpectedly persisted: " + storedAfterUnavailable);

// ============================================================
// 2b) Turning it ON with hardware available but the proof-of-enrollment
//     prompt cancelled: stays off, honest message, nothing persisted.
// ============================================================
await setBioAvailable(true);
await setBioAuthResult("cancel");
await clickBioCheckbox();
await page.waitForTimeout(300);
(await bioCheckbox.isChecked()) === false
  ? ok("toggle stays OFF when the proof-of-enrollment prompt is cancelled")
  : bad("toggle turned on despite a cancelled proof prompt");
(await bioStatusText() || "").match(/didn't succeed/i)
  ? ok("cancelled-proof case shows an honest status message")
  : bad("unexpected status message for the cancelled-proof case: " + JSON.stringify(await bioStatusText()));

// ============================================================
// 2c) Turning it ON with a real successful (mocked) proof prompt: turns on
//     and persists.
// ============================================================
await setBioAuthResult("success");
await clickBioCheckbox();
await page.waitForTimeout(300);
(await bioCheckbox.isChecked()) === true
  ? ok("toggle turns ON after a real successful proof-of-enrollment prompt")
  : bad("toggle did not turn on after a successful proof prompt");
(await bioStatusText() || "").match(/GUIDON will ask for your fingerprint or face/i)
  ? ok("on-state status message matches the app's honest-copy conventions (mirrors the Notifications panel)")
  : bad("unexpected status message for the on case: " + JSON.stringify(await bioStatusText()));
const storedOn = await page.evaluate(async () => { const r = await window.G.db.get("kv", "settings"); return r && r.v && r.v.biometricLock; });
storedOn === true
  ? ok("settings.biometricLock === true is persisted to real IndexedDB")
  : bad("settings.biometricLock was not persisted as true: " + storedOn);

// ============================================================
// 2d) Turning it back OFF needs no prompt at all (same "no permission
//     needed to turn off" asymmetry Notifications already has).
// ============================================================
const callsBeforeOff = await page.evaluate(() => window.__bioAuthCalls);
await clickBioCheckbox();
await page.waitForTimeout(300);
(await bioCheckbox.isChecked()) === false
  ? ok("toggle turns back OFF")
  : bad("toggle did not turn off");
const callsAfterOff = await page.evaluate(() => window.__bioAuthCalls);
callsAfterOff === callsBeforeOff
  ? ok("turning the toggle off prompts no biometric check at all")
  : bad("turning off unexpectedly triggered " + (callsAfterOff - callsBeforeOff) + " more authenticate() call(s)");
const storedOff = await page.evaluate(async () => { const r = await window.G.db.get("kv", "settings"); return r && r.v && r.v.biometricLock; });
storedOff === false
  ? ok("settings.biometricLock === false is persisted after turning off")
  : bad("settings.biometricLock was not persisted as false: " + storedOff);

// ============================================================
// 3) THE ACTUAL GATE — a real cold launch (reload) with the toggle on.
// ============================================================
await setBiometricLockSetting(true);
await setBioAuthResult("cancel");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(900);

const lockOverlay = page.locator("#bio-lock-overlay");
(await lockOverlay.count()) > 0
  ? ok("cold launch with biometricLock=true + a completed Personal profile shows the lock overlay")
  : bad("lock overlay did not appear on cold launch with biometric lock on");

const nameLeakedWhileLocked = await page.evaluate(() => !!document.getElementById("topbar-username") && document.getElementById("topbar-username").textContent);
!nameLeakedWhileLocked
  ? ok("the Soldier's real display name is not written to the topbar while the gate is still locked")
  : bad("display name leaked into the topbar before unlock: " + JSON.stringify(nameLeakedWhileLocked));

// 3a) A cancelled attempt (auto-fired on overlay mount) holds the gate.
await page.waitForTimeout(400);
(await lockOverlay.count()) > 0
  ? ok("a cancelled biometric attempt HOLDS the gate — overlay is still present")
  : bad("overlay disappeared after a cancelled attempt (should have stayed locked)");
const cancelStatus = await page.evaluate(() => { const p = document.querySelector("#bio-lock-overlay .hint"); return p ? p.textContent : null; });
(cancelStatus || "").match(/cancelled/i)
  ? ok('lock screen shows a real "Cancelled" status and offers a retry, not a dead end')
  : bad("unexpected lock-screen status after cancel: " + JSON.stringify(cancelStatus));

// 3b) Retry with a genuinely successful mocked auth lets the Soldier through.
// #bio-lock-overlay's own modalTrap close() has no CSS transition to key off
// (unlike .gm-back), so it always falls back to its fixed ~400ms timer —
// waitFor(detached) rides that out instead of guessing a matching timeout.
await setBioAuthResult("success");
await page.getByRole("button", { name: /Unlock with biometrics/ }).click();
await lockOverlay.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
(await lockOverlay.count()) === 0
  ? ok("a successful biometric attempt removes the lock overlay and lets the Soldier through")
  : bad("lock overlay is still present after a successful (mocked) authenticate() call");
const nameAfterUnlock = await page.evaluate(() => { const el2 = document.getElementById("topbar-username"); return el2 ? el2.textContent : null; });
nameAfterUnlock === "SGT TESTFIRE"
  ? ok("the real profile greeting renders only AFTER a successful unlock")
  : bad("profile greeting after unlock was: " + JSON.stringify(nameAfterUnlock));

// ============================================================
// 4) Resume gate — the SAME lock re-arms on a real "appStateChange" resume
//    signal, not on plain route navigation.
// ============================================================
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(300);
(await lockOverlay.count()) === 0
  ? ok("plain route navigation (#/board) does NOT re-trigger the gate")
  : bad("navigating routes unexpectedly re-locked the app");

await setBioAuthResult("cancel");
await fireAppStateChange(true);
await page.waitForTimeout(400);
(await lockOverlay.count()) > 0
  ? ok("a native appStateChange resume (isActive:true) DOES re-arm the gate")
  : bad("resume (appStateChange isActive:true) did not re-show the lock overlay");

await setBioAuthResult("success");
await page.getByRole("button", { name: /Unlock with biometrics/ }).click();
await lockOverlay.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
(await lockOverlay.count()) === 0
  ? ok("resuming through a successful (mocked) auth removes the overlay again")
  : bad("overlay persisted after a successful resume-time auth");

// "Can't unlock? Turn off biometric lock" — deliberately confirmed, never a
// bare one-tap bypass, but still a real way out (never a true lockout).
await setBioAuthResult("fail");
await fireAppStateChange(true);
await page.waitForTimeout(400);
(await lockOverlay.count()) > 0 ? ok("gate re-armed once more for the 'turn off from the lock screen' check") : bad("gate did not re-arm for the turn-off check");
await page.getByRole("button", { name: /Can't unlock\? Turn off biometric lock/ }).click();
await page.waitForTimeout(300);
const offConfirmBox = page.locator(".gm-box", { hasText: /You won't be asked for biometrics/ });
(await offConfirmBox.count()) > 0
  ? ok('"Turn off biometric lock" from the lock screen asks for a real confirmation first, not a bare bypass')
  : bad("turning off biometric lock from the lock screen skipped confirmation");
await page.locator(".gm-box button", { hasText: /Turn off/ }).click();
// Two sequential animated closes chain here — the confirm dialog's own
// (.gm-back, ~220ms CSS transition) THEN the lock overlay's (no transition
// defined for #bio-lock-overlay, so it always rides its ~400ms fallback
// timer) — waitFor(detached) rides out both instead of guessing a sum.
await lockOverlay.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
(await lockOverlay.count()) === 0
  ? ok("confirming 'Turn off' from the lock screen actually unlocks — never a permanent lockout with a failed/cancelled prompt")
  : bad("confirming turn-off did not remove the lock overlay");
const settingAfterEmergencyOff = await page.evaluate(async () => { const r = await window.G.db.get("kv", "settings"); return r && r.v && r.v.biometricLock; });
settingAfterEmergencyOff === false
  ? ok("turning off from the lock screen also persists biometricLock=false (Settings' own toggle reflects it next visit)")
  : bad("biometricLock was not actually turned off in storage: " + settingAfterEmergencyOff);

// ============================================================
// 5) Fail-open — hardware/enrollment unavailable while the setting is on
//    must not lock the Soldier out.
// ============================================================
await setBiometricLockSetting(true);
await setBioAvailable(false);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(900);

(await lockOverlay.count()) === 0
  ? ok("fail-open: biometricLock=true but unavailable biometrics does NOT show the lock overlay")
  : bad("Soldier was locked out despite unavailable biometrics (should fail open)");
const homeRenderedFailOpen = await page.evaluate(() => !!document.getElementById("topbar-username") && document.getElementById("topbar-username").textContent);
homeRenderedFailOpen === "SGT TESTFIRE"
  ? ok("fail-open: the real profile still renders normally, the Soldier is not locked out of their own data")
  : bad("fail-open path did not render the real profile: " + JSON.stringify(homeRenderedFailOpen));
const toastAfterFailOpen = await page.evaluate(() => { const t = document.getElementById("toast"); return t ? { text: t.textContent, shown: t.classList.contains("show") } : null; });
toastAfterFailOpen && toastAfterFailOpen.shown && /let you in without prompting/i.test(toastAfterFailOpen.text)
  ? ok('fail-open is disclosed via a one-time toast, not silent: "' + toastAfterFailOpen.text + '"')
  : bad("fail-open toast missing or unexpected: " + JSON.stringify(toastAfterFailOpen));
const selfhealAfterFailOpen = await page.evaluate(async () => { const r = await window.G.selfheal.recent(5); return r.find((x) => x.kind === "biometric-fail-open"); });
selfhealAfterFailOpen
  ? ok("fail-open is also logged to the self-heal audit trail (Diagnostics)")
  : bad("no biometric-fail-open entry found in the self-heal log");

await setBioAvailable(true);
await setBiometricLockSetting(false);

// ============================================================
// 6) Guest and Kiosk sessions are completely unaffected, even with
//    biometricLock=true stored device-wide and biometrics mocked available.
// ============================================================
await setBiometricLockSetting(true);
await setBioAvailable(true);
await setBioAuthResult("success");
await clearStoredProfile();
await page.reload({ waitUntil: "load" });
await dismissOnboardingVia("guest");

const guestApplies = await page.evaluate(async () => window.G.biometricGate.applies());
guestApplies === false
  ? ok("G.biometricGate.applies() is false for an active Guest session, even with biometricLock=true stored")
  : bad("biometric gate reports applying to a Guest session");
(await page.locator("#bio-lock-overlay").count()) === 0
  ? ok("no lock overlay ever appeared for the Guest session")
  : bad("a lock overlay appeared during a Guest session");
await fireAppStateChange(true);
await page.waitForTimeout(300);
(await page.locator("#bio-lock-overlay").count()) === 0
  ? ok("a resume signal during a Guest session still does not show the lock overlay")
  : bad("resume during a Guest session incorrectly showed the lock overlay");

await clearStoredProfile();
await page.reload({ waitUntil: "load" });
await dismissOnboardingVia("kiosk");
await page.waitForTimeout(300);

const kioskApplies = await page.evaluate(async () => window.G.biometricGate.applies());
kioskApplies === false
  ? ok("G.biometricGate.applies() is false for an active Kiosk session, even with biometricLock=true stored")
  : bad("biometric gate reports applying to a Kiosk session");
(await page.locator("#bio-lock-overlay").count()) === 0
  ? ok("no lock overlay ever appeared for the Kiosk session")
  : bad("a lock overlay appeared during a Kiosk session");
await fireAppStateChange(true);
await page.waitForTimeout(300);
(await page.locator("#bio-lock-overlay").count()) === 0
  ? ok("a resume signal during a Kiosk session still does not show the lock overlay")
  : bad("resume during a Kiosk session incorrectly showed the lock overlay");

await context.close();

// ─────────────────────────────────────────────────────────────────────────
// 7) Non-native (plain web) fallback path: no window.Capacitor at all — the
//    normal, real environment for this Playwright suite itself, and for the
//    installable PWA/desktop builds.
// ─────────────────────────────────────────────────────────────────────────
const webContext = await browser.newContext();
const webPage = await webContext.newPage();
const webNoise = [];
webPage.on("pageerror", (e) => webNoise.push("pageerror: " + e.message));
webPage.on("console", (m) => { if (m.type() === "error") webNoise.push("console.error: " + m.text()); });

await webPage.goto(url, { waitUntil: "load" });
await webPage.waitForTimeout(700);
const webGuestCard = webPage.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await webGuestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await webGuestCard.count()) {
  await webGuestCard.click();
  await webPage.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await webPage.waitForTimeout(300);

const webBoot = await webPage.evaluate(() => ({
  hasCapacitor: !!window.Capacitor,
  supported: !!(window.G && window.G.biometric && window.G.biometric.supported()),
}));
!webBoot.hasCapacitor ? ok("plain web context genuinely has no window.Capacitor") : bad("unexpected window.Capacitor present in the plain web context");
webBoot.supported === false ? ok("G.biometric.supported() is false with no native shell present") : bad("G.biometric.supported() unexpectedly true with no native shell");

// Even if biometricLock were somehow already true in storage (e.g. a device
// that later opened this same profile in a browser without biometrics), the
// gate must still resolve instantly and never lock anyone out on web.
await webPage.evaluate(async () => {
  await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
    onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
    displayName: "SGT WEBTEST", lastName: "WEBTEST", anonymous: false,
    studyWeakPoints: [], readinessConcerns: [], actionPlan: [], promoPoints: {},
  } });
  const s = await window.G.db.get("kv", "settings");
  const sv = Object.assign({}, s && s.v, { biometricLock: true });
  await window.G.db.put("kv", { k: "settings", v: sv });
});
await webPage.reload({ waitUntil: "load" });
await webPage.waitForTimeout(900);

(await webPage.locator("#bio-lock-overlay").count()) === 0
  ? ok("web fallback: biometricLock=true stored still never shows a lock overlay with no native shell")
  : bad("web fallback incorrectly showed a lock overlay with no Capacitor present");
const webName = await webPage.evaluate(() => { const el2 = document.getElementById("topbar-username"); return el2 ? el2.textContent : null; });
webName === "SGT WEBTEST"
  ? ok("web fallback: the real profile renders normally — the Soldier is never locked out on a non-native build")
  : bad("web fallback did not render the real profile: " + JSON.stringify(webName));

await webPage.evaluate(() => { location.hash = "#/settings"; });
await webPage.waitForTimeout(500);
(await webPage.locator('input[aria-label="Biometric lock for Personal Account"]').count()) === 0
  ? ok("web fallback: the Biometric lock panel does not render at all (matches the Notifications panel's own web-hidden convention)")
  : bad("Biometric lock panel unexpectedly rendered on a non-native build");

const relevantNoise = [...noise, ...webNoise].filter((n) => !/favicon/i.test(n));
relevantNoise.length === 0
  ? ok("no unexpected console errors/page errors across either context")
  : bad(`${relevantNoise.length} unexpected console/page error(s); first: ${relevantNoise[0]}`);

await webContext.close();
await browser.close();
await server.close();

console.log("\n" + (fails ? `BIOMETRIC LOCK: ${fails} FAILURE(S)` : "BIOMETRIC LOCK: all passed"));
process.exit(fails ? 1 : 0);
