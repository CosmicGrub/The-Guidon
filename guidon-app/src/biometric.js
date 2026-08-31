/* ==== js/biometric.js ==== */
/* GUIDON — biometric.js : opt-in biometric unlock for Personal Account (G.biometric)

   Only does anything inside a Capacitor Android build; a no-op everywhere else
   (web, Tauri, file://) so this file is safe to load anywhere, same convention
   as native.js/notify.js.

   Thin wrapper over @aparajita/capacitor-biometric-auth's native bridge
   (Cap.Plugins.BiometricAuthNative — real AndroidX BiometricPrompt underneath;
   deliberately NOT WebAuthn, which is designed around a relying-party server
   this app doesn't have and never will). Talks directly to the plugin's
   registered native methods (checkBiometry/internalAuthenticate), the same
   "poke Cap.Plugins.<Name> directly, guarded by isNative" convention
   native.js/notify.js already use for their own plugins (StatusBar/App,
   LocalNotifications) — the npm package's own JS/TS wrapper is never
   imported into this build (grep build.mjs: no @capacitor/* or
   @aparajita/* package is ever require()'d or import'd into src/*.js). The
   npm dependency exists solely so `cap sync android` wires its real Kotlin
   module (androidx.biometric.BiometricPrompt underneath — see
   android/build.gradle after a sync) into the Gradle build; nothing here
   needs its bundled JS at all.

   Off by default (settings.biometricLock — store.js's DEFAULT_SETTINGS,
   src/index.html). Nothing in this file ever prompts on its own — every
   call is made from an explicit call site: Settings' own toggle (a
   proof-of-enrollment check before it's allowed to turn on) or
   G.biometricGate's own launch/resume gate (index.html, near
   G.kioskBadge), once that toggle is already on. Never on plain route
   navigation.
*/
window.G = window.G || {};
(function () {
  "use strict";

  const Cap = window.Capacitor;
  const isNative = !!(Cap && (Cap.isNativePlatform ? Cap.isNativePlatform() : Cap.isNative));

  function plugin() {
    return (Cap && Cap.Plugins && Cap.Plugins.BiometricAuthNative) || null;
  }

  function supported() {
    return isNative && !!plugin();
  }

  // Real device capability right now: hardware present AND at least one
  // credential actually enrolled — supported() above only means the plugin
  // itself is wired in, not that biometrics are usable on this device.
  // Never throws; a failure just reports "unavailable" like a real negative
  // answer would.
  async function checkAvailability() {
    const p = plugin();
    if (!p) return { available: false, code: "unsupported", reason: "" };
    try {
      const r = await p.checkBiometry();
      return { available: !!(r && r.isAvailable), code: (r && r.code) || "", reason: (r && r.reason) || "" };
    } catch (e) {
      return { available: false, code: "unsupported", reason: (e && e.message) || "" };
    }
  }

  // The one and only place this file ever presents the OS biometric prompt.
  // Resolves { ok:true } on success, or { ok:false, code, message } on any
  // failure/cancel/lockout — never throws. `code` is one of the native
  // bridge's own BiometryErrorType strings (userCancel, systemCancel,
  // appCancel, authenticationFailed, biometryLockout, biometryNotAvailable,
  // biometryNotEnrolled, noDeviceCredential, passcodeNotSet), read straight
  // off the rejected CapacitorException's own `.code`.
  async function authenticate(reason) {
    const p = plugin();
    if (!p) return { ok: false, code: "unsupported" };
    try {
      await p.internalAuthenticate({ reason: reason || "Unlock your GUIDON Personal Account" });
      return { ok: true };
    } catch (e) {
      return { ok: false, code: (e && e.code) || "unknown", message: e && e.message };
    }
  }

  // Re-checks the gate every time the app returns to the foreground — the
  // real "someone else could be holding this phone now" moment this feature
  // exists for, not on every hashchange/redraw. G.biometricGate (index.html)
  // owns what happens next (whether the gate actually applies, showing the
  // lock overlay, fail-open on unavailable hardware); this file only reports
  // the native OS signal, guarded the same isNative way every other native
  // call in this file already is.
  if (isNative) {
    const App = (Cap && Cap.Plugins && Cap.Plugins.App) || null;
    if (App && App.addListener) {
      App.addListener("appStateChange", (state) => {
        if (state && state.isActive && G.biometricGate) G.biometricGate.onResume();
      });
    }
  }

  // Roadmap audit round 5, "Native Android: Security & Shortcut Wiring"
  // bucket: G.biometricGate re-arms the lock on the NEXT resume, but nothing
  // ever ran at the moment the app was BACKGROUNDED — Android's task
  // switcher takes a live bitmap snapshot of the window's current content
  // the instant it backgrounds, before any biometric overlay exists for
  // that session. A Soldier with biometric lock on who is sitting on a
  // sensitive Personal Account screen and hits Home/Recents got a
  // full-resolution OS-level screenshot of that exact screen sitting in the
  // app-switcher thumbnail, fully bypassing the lock (and the same window
  // content is what the OS screenshot action would capture, too). Fix:
  // MainActivity now exposes a tiny custom JS bridge (WebView
  // addJavascriptInterface, not a full Capacitor plugin — this is a single
  // boolean toggle, not a real platform API surface) that flips
  // WindowManager.LayoutParams.FLAG_SECURE on the Activity's own window,
  // which blanks both screenshots and the recents-thumbnail for the whole
  // window. G.biometricGate (index.html) is the sole caller — it already
  // owns "does the lock apply right now" via its own applies() check, so
  // this file only forwards that yes/no straight to the native side, same
  // division of labor as the rest of this wrapper. No-op (silently) on
  // web/Tauri/file:// and on any native build old enough not to have run
  // `cap sync` since this shipped, so this is always safe to call.
  function setSecureScreen(secure) {
    try {
      if (isNative && window.AndroidSecureScreen && window.AndroidSecureScreen.setSecure) {
        window.AndroidSecureScreen.setSecure(!!secure);
      }
    } catch (e) {}
  }

  G.biometric = { supported, checkAvailability, authenticate, setSecureScreen };
})();
// END biometric.js
