/* ==== js/pwa.js ==== */
/* GUIDON — pwa.js : installability, offline caching and storage durability (G.pwa)

   This module is what turns the hosted build from "a web page you can bookmark"
   into an installed application. It does four separate jobs:

     1. Registers the service worker, and runs a real update flow — a new build
        is never swapped in under a Soldier mid-drill; they are told and they
        choose when to reload.
     2. Captures beforeinstallprompt so the app can offer its own Install
        button instead of hoping the user finds a browser menu.
     3. Requests persistent storage. This is the part that actually matters:
        §42 of the masterfile documents that iOS evicts a site's IndexedDB after
        ~7 days without a visit, and until now the app only WARNED about it.
        navigator.storage.persist() is the API that mitigates it, and installing
        to the Home Screen is what makes the browser grant it.
     4. Reports honest state — installed / installable / offline-ready — rather
        than claiming capability it has not verified.

   Exposed loudly on G per the project's standing rule: a module that needs
   something from here reads G.pwa, and never guards with a silent typeof check.

   Degrades to nothing on file:// (no service workers, no install) without
   throwing, so the single-file build is unaffected.
*/
window.G = window.G || {};
(function () {
  "use strict";

  const util = G.util, el = util.el;

  const state = {
    deferredPrompt: null,   // the captured beforeinstallprompt event
    installed: false,       // running in an installed window right now
    swActive: false,
    swWaiting: null,        // a newer worker sitting in the wings
    // Upgrade-roadmap first wave, item 7: registerSW()'s own catch below
    // used to only console.warn a real registration failure, with nothing
    // recorded anywhere G could read back. Diagnostics' "Service worker
    // freshness" check asks navigator.serviceWorker.getRegistration() for
    // itself, which returns undefined/null for BOTH "never even tried" and
    // "tried and failed" - so a genuine failure (a broken CSP, an
    // unreachable sw.js, a corrupted cache) was reported as a clean PASS
    // ("No service worker registered yet.") instead of the FAIL it is.
    swRegFailed: null,      // null = not yet attempted; string = the error that occurred
    persisted: null,        // null = not yet asked
    estimate: null,
  };

  const isFile = location.protocol === "file:";
  /* Native shells (Tauri desktop, Capacitor Android) already ship every asset
     locally and manage their own update channel, so service-worker caching and
     the browser install prompt are both meaningless there. Detected rather than
     assumed, and exposed so the UI can tell the truth about what it is.

     Deliberately broader than G.native.isNative() (src/native.js), which
     checks Capacitor specifically - that file gates Capacitor-only plugin
     calls (status bar, back button, native file save) that don't exist on
     Tauri, so it can't use this OR-of-both-platforms check. This one
     answers "is this installed at all, regardless of which shell" for
     PWA-chrome/install-prompt decisions that apply the same way to both
     platforms. Two intentionally different questions living in two files
     for two different reasons, not an accidental duplicate (task #251) -
     see G.native.isNative()'s own comment for the mirror of this note. */
  const isNative = !!(window.__TAURI_INTERNALS__ || window.__TAURI__ || window.Capacitor);
  const listeners = [];
  const notify = () => listeners.forEach((fn) => { try { fn(state); } catch (e) {} });

  /* ---------------------------------------------------------------- display */

  function detectDisplayMode() {
    let mode = "browser";
    ["standalone", "minimal-ui", "fullscreen", "window-controls-overlay"].forEach((m) => {
      if (window.matchMedia && window.matchMedia("(display-mode: " + m + ")").matches) mode = m;
    });
    // iOS reports installed apps through a non-standard flag, not display-mode.
    if (window.navigator.standalone === true) mode = "standalone";
    if (isNative) mode = "native";
    state.installed = mode !== "browser";
    document.documentElement.setAttribute("data-display-mode", mode);
    return mode;
  }

  /* ------------------------------------------------------- service worker */

  function registerSW() {
    if (isFile) return;                               // SW requires http/https
    if (isNative) return;                             // assets are already local
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("sw.js").then((reg) => {
      state.swRegFailed = false;
      if (reg.waiting && navigator.serviceWorker.controller) {
        state.swWaiting = reg.waiting;
        announceUpdate();
      }
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          // "installed" + an existing controller means this is an UPDATE, not
          // a first install. Only an update deserves a prompt.
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            state.swWaiting = nw;
            announceUpdate();
            notify();
          }
        });
      });
      navigator.serviceWorker.ready.then(() => { state.swActive = true; notify(); });
    }).catch((e) => {
      state.swRegFailed = (e && e.message) ? e.message : String(e);
      notify();
      console.warn("SW registration failed:", e);
    });

    // Reload ONLY when an update replaces an existing controller — never on the
    // first claim. On a first visit the worker installs, activates and calls
    // clients.claim() a second or two after load, which fires controllerchange;
    // reloading there restarted the page underneath a brand-new user right as
    // they were tapping an onboarding card. (Found when a UX screenshot script
    // died with "execution context destroyed" at exactly that moment.)
    let hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) { hadController = true; return; }   // first claim: no reload
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  function announceUpdate() {
    if (util.toast) util.toast("A newer version of GUIDON is ready — open Share & Install to load it.", 5000);
  }

  function applyUpdate() {
    if (!state.swWaiting) return false;
    state.swWaiting.postMessage({ type: "SKIP_WAITING" });
    return true; // controllerchange handler reloads
  }

  /* ------------------------------------------------------------- storage */

  async function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) { state.persisted = null; return null; }
    try {
      if (navigator.storage.persisted) {
        const already = await navigator.storage.persisted();
        if (already) { state.persisted = true; notify(); return true; }
      }
      const granted = await navigator.storage.persist();
      state.persisted = granted;
      notify();
      return granted;
    } catch (e) { state.persisted = null; return null; }
  }

  async function readEstimate() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try { state.estimate = await navigator.storage.estimate(); notify(); return state.estimate; }
    catch (e) { return null; }
  }

  /* ------------------------------------------------------------- install */

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();               // suppress the browser's own mini-infobar
    state.deferredPrompt = e;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    state.deferredPrompt = null;
    state.installed = true;
    if (util.toast) util.toast("GUIDON installed. Open it from your home screen or Start menu.", 4000);
    notify();
    // An installed app is the case the browser will actually grant persistence for.
    requestPersistence();
  });

  async function promptInstall() {
    if (!state.deferredPrompt) return { outcome: "unavailable" };
    const e = state.deferredPrompt;
    state.deferredPrompt = null;
    notify();
    try {
      e.prompt();
      const choice = await e.userChoice;
      return choice || { outcome: "unknown" };
    } catch (err) { return { outcome: "error", error: String(err) }; }
  }

  /* ---------------------------------------------------------------- panel */

  function fmtBytes(n) {
    if (!n && n !== 0) return "—";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v : v.toFixed(1)) + " " + u[i];
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
           (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  /* Builds the live install/offline panel injected at the top of Share & Install. */
  function buildPanel() {
    const p = el("div.panel", { style: "margin-bottom:10px;border-left:3px solid var(--amber)" });
    p.appendChild(el("div.eyebrow", { text: "Install this app" }));

    if (isNative) {
      p.appendChild(el("p", { text:
        "GUIDON is running as an installed desktop application. Everything is stored on this computer, nothing is fetched, and it works with no network connection at all." }));
    } else if (state.installed) {
      p.appendChild(el("p", { text:
        "GUIDON is running as an installed app on this device. It opens from your home screen or Start menu, keeps its own window, and works with no signal." }));
    } else if (isFile) {
      p.appendChild(el("p", { text:
        "This copy is open directly from a file, which already works offline — but it cannot be installed. Host it, or use the Windows installer, to get an app icon and its own window." }));
    } else if (state.deferredPrompt) {
      p.appendChild(el("p", { text:
        "This browser can install GUIDON as a real app: its own icon, its own window, no browser bars, and durable offline storage." }));
      const btn = el("button.btn.primary", { type: "button", text: "⭳ Install GUIDON" });
      btn.addEventListener("click", async () => {
        const r = await promptInstall();
        if (r.outcome === "accepted") util.toast && util.toast("Installing…");
        else if (r.outcome === "dismissed") util.toast && util.toast("Install dismissed — you can install later from this panel.");
        refresh();
      });
      p.appendChild(btn);
    } else if (isIOS()) {
      p.appendChild(el("p", { text:
        "On iPhone and iPad, installing is done from Safari's Share menu — the steps are in the panel below. Do it before you start studying, not after: it is what makes your stored progress durable." }));
    } else {
      p.appendChild(el("p.hint", { text:
        "No install prompt is available in this browser right now. That usually means GUIDON is already installed, the page is not served over HTTPS, or this browser installs from its own menu instead (look for “Install” or “Add to Home screen”)." }));
    }

    /* Honest status readout — reports what was actually verified. */
    const rows = [
      ["Offline ready", isNative
        ? "Yes — every file is installed locally with the application."
        : state.swActive
          ? "Yes — the app is cached on this device and opens with no signal."
          : (isFile ? "Yes — running from a local file." : "Not yet — reload once while online to finish caching.")],
      ["Storage durability", state.persisted === true
        ? "Granted — the browser has been asked not to evict your study data."
        : state.persisted === false
          ? "Not granted. Installing the app to your home screen is what usually earns it."
          : "Unknown — this browser does not report storage durability."],
    ];
    if (state.estimate && state.estimate.usage != null) {
      rows.push(["Stored on this device", fmtBytes(state.estimate.usage) +
        (state.estimate.quota ? " of about " + fmtBytes(state.estimate.quota) + " available" : "")]);
    }
    rows.forEach(([k, v]) => {
      p.appendChild(el("div.ob-plan-cat", { text: k, style: "margin-top:8px" }));
      p.appendChild(el("div.hint", { text: v }));
    });

    if (state.swWaiting) {
      const up = el("div", { style: "margin-top:10px" });
      up.appendChild(el("div.ob-plan-cat", { text: "Update available" }));
      up.appendChild(el("div.hint", { text: "A newer build has been downloaded. Reloading takes a second and keeps all your saved progress." }));
      const ub = el("button.btn.sm", { type: "button", text: "↻ Reload into the new version", style: "margin-top:6px" });
      ub.addEventListener("click", () => { applyUpdate(); });
      up.appendChild(ub);
      p.appendChild(up);
    }
    return p;
  }

  let mountedHost = null;
  function refresh() {
    if (!mountedHost || !mountedHost.isConnected) return;
    const old = mountedHost.querySelector(":scope > .pwa-panel-wrap");
    if (!old) return;
    util.clear(old);
    old.appendChild(buildPanel());
  }

  /* Decorate the existing Share & Install view rather than rewriting it, so the
     researched hosting/iOS guidance already there stays exactly as written. */
  function decorateShare() {
    if (!G.share || typeof G.share.render !== "function" || G.share.__pwaWrapped) return;
    const orig = G.share.render;
    G.share.render = async function (mount) {
      await orig.call(this, mount);
      try {
        const wrap = el("div.pwa-panel-wrap");
        wrap.appendChild(buildPanel());
        // sits directly under the "Share & Install" heading
        const title = mount.querySelector(".section-title");
        if (title && title.nextSibling) mount.insertBefore(wrap, title.nextSibling);
        else mount.appendChild(wrap);
        mountedHost = mount;
        readEstimate().then(refresh);
      } catch (e) { console.warn("pwa panel:", e); }
    };
    G.share.__pwaWrapped = true;
  }

  /* ----------------------------------------------------------------- boot */

  detectDisplayMode();
  ["standalone", "minimal-ui", "fullscreen"].forEach((m) => {
    const mq = window.matchMedia && window.matchMedia("(display-mode: " + m + ")");
    if (mq && mq.addEventListener) mq.addEventListener("change", () => { detectDisplayMode(); refresh(); });
  });

  registerSW();
  decorateShare();

  // Ask for durable storage on boot. Chrome grants it silently for installed or
  // sufficiently-engaged sites; Firefox prompts; Safari ignores it. Harmless
  // everywhere, and it is the only real mitigation for the 7-day eviction.
  requestPersistence();
  readEstimate();

  G.pwa = {
    state,
    promptInstall,
    applyUpdate,
    requestPersistence,
    readEstimate,
    detectDisplayMode,
    // Exposed so other modules showing a byte figure (e.g. a Data & Storage
    // dashboard) reuse the exact same B/KB/MB/GB formatting instead of a
    // second, possibly-diverging copy.
    fmtBytes,
    onChange: (fn) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    isInstalled: () => state.installed,
    isInstallable: () => !!state.deferredPrompt,
    // Tauri desktop or Capacitor Android, detected above - exposed so other
    // modules (share.js's "Share & Install" panel) can tell whether they're
    // running inside an already-installed native shell instead of assuming
    // every visit is a browser tab that might still need hosting/PWA-install
    // instructions.
    isNative: () => isNative,
  };
})();
// END pwa.js
