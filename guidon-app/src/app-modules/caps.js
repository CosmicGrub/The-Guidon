/* ==== js/caps.js ==== */
/* GUIDON - caps.js : platform-capability registry (G.caps)

   Collective roadmap P2 (parity design, section 5). ONE registry of what
   this runtime can do, read by everything that used to guess separately:

     - the Diagnostics AUTO check "Platform capabilities" (src/index.html,
       id "caps") renders run() and offers Copy JSON;
     - the console sentinel `GUIDON_CAPS <json>` (emitSentinel(), once per
       page) is what every collector reads - tools/verify.mjs (Chromium),
       tools/verify-ios-webkit.mjs (Playwright WebKit, engine only),
       tools/test-android.mjs (the shipped WebView over CDP),
       tools/caps-webview2.mjs (the installed desktop exe over CDP) and
       tools/ios-simulator-run.sh (the Simulator's console) - and
       tools/caps-matrix.mjs merges their files into docs/generated/;
     - tools/test-caps.mjs proves the shape; tools/caps-matrix.mjs loads
       THIS file to know the ids, the per-fork expectations, the
       required-for-ships set and the ships map. There is no second list.

   Add a capability HERE and nowhere else: one entry in REGISTRY below.

   Every probe is NON-DESTRUCTIVE: typeof / CSS.supports / presence checks
   only. No probe requests a permission, opens a socket, vibrates, prompts,
   writes storage or creates media. A probe returns a boolean, or a short
   string naming WHICH implementation answered ("navigator.share" vs
   "Capacitor.Share") or a value worth recording (origin). A probe never
   throws - run() wraps each one and records "error:<message>" if it does.

   Fork (which build is running) is derived here too, from the marker
   tools/build.mjs stamps per output (window.GUIDON_FORK: "standalone" in
   dist/guidon-standalone.html, "web" in web/index.html - the shared
   src/index.html has no marker) plus the shell globals:
     standalone | tauri | android | ios | pwa | web
   native.js/notify.js/biometric.js keep their deliberately NARROWER
   "Capacitor only" question (isCapacitor()) and pwa.js its BROADER "any
   shell, Tauri or Capacitor" one (isShell()) - both expressions now live
   here, unchanged, so the two questions stay two questions with one home.
*/
window.G = window.G || {};
(function () {
  "use strict";

  /* ------------------------------------------------------------ helpers */

  function cap() { return window.Capacitor || null; }
  function plugin(name) {
    const Cap = cap();
    return !!(Cap && Cap.Plugins && Cap.Plugins[name]);
  }
  function cssSupports(a, b) {
    try {
      if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
      return b === undefined ? !!CSS.supports(a) : !!CSS.supports(a, b);
    } catch (e) { return false; }
  }
  function fn(v) { return typeof v === "function"; }

  /* The two shell predicates that used to be computed in four files. Kept
     as the exact expressions they were (see the header). */
  function isCapacitor() {
    const Cap = cap();
    return !!(Cap && (Cap.isNativePlatform ? Cap.isNativePlatform() : Cap.isNative));
  }
  function isShell() {
    return !!(window.__TAURI_INTERNALS__ || window.__TAURI__ || window.Capacitor);
  }
  function isTauri() {
    return !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
  }
  function isInstalledPwa() {
    try {
      if (window.navigator.standalone === true) return true; // iOS home-screen flag
      if (!window.matchMedia) return false;
      return ["standalone", "minimal-ui", "fullscreen", "window-controls-overlay"]
        .some((m) => window.matchMedia("(display-mode: " + m + ")").matches);
    } catch (e) { return false; }
  }

  /** standalone | tauri | android | ios | pwa | web */
  function fork() {
    if (window.GUIDON_FORK === "standalone") return "standalone";
    if (isTauri()) return "tauri";
    if (isCapacitor()) {
      const Cap = cap();
      const p = Cap && fn(Cap.getPlatform) ? String(Cap.getPlatform()) : "";
      if (p === "android" || p === "ios") return p;
      return "capacitor"; // an unexpected Capacitor platform: recorded, never guessed at
    }
    if (isInstalledPwa()) return "pwa";
    return "web";
  }

  /** { engine: chromium|webkit|gecko|unknown, version, webview } from the UA. */
  function engine() {
    const ua = String(navigator.userAgent || "");
    let m;
    if ((m = /Firefox\/(\d+)/.exec(ua))) return { engine: "gecko", version: +m[1], webview: false };
    if ((m = /(?:Chrome|CriOS|Chromium)\/(\d+)/.exec(ua))) return { engine: "chromium", version: +m[1], webview: /; wv\)/.test(ua) || /Edg\//.test(ua) && isTauri() };
    if (/AppleWebKit\//.test(ua)) { m = /Version\/(\d+)/.exec(ua); return { engine: "webkit", version: m ? +m[1] : null, webview: isCapacitor() }; }
    return { engine: "unknown", version: null, webview: false };
  }

  /* Emulator/Simulator heuristic. The collectors that KNOW (ios-simulator-
     run.sh) overwrite this with true; a real device is never marked virtual
     by this heuristic alone. */
  function isVirtual() {
    const ua = String(navigator.userAgent || "");
    return /sdk_gphone|Android SDK built for|google_sdk|Emulator/i.test(ua);
  }

  /* ----------------------------------------------------------- registry */

  /* expects: what each fork is EXPECTED to answer - true/false, a string
     pattern for value probes, or null where the honest answer is "engine
     and OS dependent, measure it". Informational: caps-matrix.mjs reports
     a mismatch, it never gates on expects. The gate is `required`.
     One value per fork in SHIPS plus `guest` (tools/test-caps.mjs asserts
     it): guest is a browser on a plain http:// LAN origin that opened a
     room link without installing anything - no secure context, so no Web
     Crypto, no share, no wake lock, no navigator.storage, no service worker
     (BroadcastChannel and WebSocket are not gated; measured 2026-09-04 on
     Chromium 151 at http://192.168.1.132 through this registry's sentinel). The network rows (webSocket,
     rtcDataChannel, webCrypto, broadcastChannel, secureContext) carry the
     P2 pairings research: ios is "probable" (a string, never true) until a
     device probe file exists; standalone (file://, origin "null") is
     "unknown" where nothing measured it yet; "n/a" means the fork never
     takes that path. */
  const T = true, F = false, N = null;
  function ex(web, pwa, tauri, android, ios, standalone, guest) {
    return { web: web, pwa: pwa, tauri: tauri, android: android, ios: ios, standalone: standalone, guest: guest };
  }
  /* The engine floor tools/build.mjs stamps from tools/engine-floor.json
     (collective Q11) - read, never re-typed here. "unstamped" only in the
     raw src/index.html, which no build ships. */
  function floorText() {
    const fl = window.GUIDON_ENGINE_FLOOR;
    if (!fl || typeof fl !== "object") return "engine floor unstamped";
    return "Engine floor Q11: Chromium " + fl.chromium + " / WebKit " + fl.webkit + " / Gecko " + fl.gecko + " (window.GUIDON_ENGINE_FLOOR, from tools/engine-floor.json).";
  }

  const REGISTRY = [
    { id: "indexeddb", group: "storage", required: true,
      probe: () => typeof indexedDB !== "undefined" && indexedDB !== null,
      expects: ex(T, T, T, T, T, T, T),
      degrade: "Nothing persists: grades, board dates and settings are lost on reload. The app cannot ship without it." },
    { id: "storagePersist", group: "storage", required: false,
      probe: () => !!(navigator.storage && fn(navigator.storage.persist)),
      expects: ex(T, T, T, T, N, T, F),
      degrade: "The browser may evict IndexedDB after ~7 days idle (iOS); Diagnostics' Storage durability check reports it, Share & Install mitigates it." },
    { id: "share", group: "io", required: false,
      probe: () => fn(navigator.share) ? "navigator.share" : plugin("Share") ? "Capacitor.Share" : false,
      expects: ex(N, N, F, T, T, F, F),
      degrade: "Share buttons fall back to copy-to-clipboard or a plain download." },
    { id: "download", group: "io", required: true,
      probe: () => typeof Blob !== "undefined" && ("download" in document.createElement("a")) && !!(window.URL && fn(URL.createObjectURL)),
      expects: ex(T, T, T, T, T, T, T),
      degrade: "Backups, PDFs and self-heal logs cannot be saved as files (Android/iOS route through Filesystem+Share instead, see util.download)." },
    { id: "print", group: "io", required: true,
      probe: () => fn(window.print),
      expects: ex(T, T, T, T, T, T, T),
      degrade: "Readiness summary and DA 4856 flatten-and-print are unavailable (Android uses the native print path, see test-print-native)." },
    { id: "haptics", group: "device", required: false,
      probe: () => plugin("Haptics") ? "Capacitor.Haptics" : fn(navigator.vibrate) ? "navigator.vibrate" : false,
      expects: ex(N, N, F, "Capacitor.Haptics", "Capacitor.Haptics", N, N),
      degrade: "Board-drill grade feedback is visual only." },
    { id: "notifications", group: "device", required: false,
      probe: () => plugin("LocalNotifications") ? "LocalNotifications" : (typeof Notification !== "undefined") ? "Notification" : false,
      expects: ex(N, N, N, "LocalNotifications", "LocalNotifications", N, N),
      degrade: "Reminder alerts only show inside the app; nothing fires while it is closed." },
    { id: "biometric", group: "device", required: false,
      probe: () => plugin("BiometricAuthNative"),
      expects: ex(F, F, F, T, T, F, F),
      degrade: "Personal Account biometric lock is not offered (Settings hides the toggle)." },
    { id: "fullscreen", group: "display", required: false,
      probe: () => { const d = document.documentElement; return fn(d.requestFullscreen) || fn(d.webkitRequestFullscreen); },
      expects: ex(T, T, T, T, N, T, T),
      degrade: "Board-drill theater mode uses a fixed overlay instead of true fullscreen (iPhone WKWebView)." },
    { id: "broadcastChannel", group: "platform", required: false,
      probe: () => typeof BroadcastChannel !== "undefined",
      expects: ex(T, T, T, T, T, "unknown", T),
      degrade: "Two windows of the same origin do not sync (src/xwin.js is inert); each window still works alone." },
    { id: "webCrypto", group: "platform", required: false,
      probe: () => !!(window.crypto && window.crypto.subtle),
      expects: ex(T, T, T, T, T, T, F),
      degrade: "Unused today; a future room key exchange (P3/P4) needs it. Absent on plain http:// origins." },
    { id: "webSocket", group: "network", required: false,
      probe: () => typeof WebSocket !== "undefined",
      expects: ex(T, T, T, T, "probable", T, T),
      degrade: "EXISTENCE ONLY - this probe is `typeof WebSocket !== \"undefined\"`; true wherever the constructor is defined, which is every engine this app ships on. It proves nothing about whether a connection from THIS origin can actually open - see tools/test-network-floor.mjs (artifacts/net-floor/*.json) for the real hello->welcome round-trip measurement that answers that question, per fork. Study groups (LAN rooms, P3/P4) cannot connect; everything else is offline by design. The API existing is not a LAN room: page JS on any https:// origin (a hosted web or pwa page, android's https://localhost WebView) opening ws:// to a LAN IP is blocked as mixed content, so rooms from those origins need a native socket (the Capacitor side) or a wss:// endpoint; the plain http:// guest page and http://tauri.localhost are not blocked." },
    { id: "rtcDataChannel", group: "network", required: false,
      probe: () => typeof RTCPeerConnection !== "undefined",
      expects: ex(T, T, T, T, "probable", "unknown", "n/a"),
      degrade: "EXISTENCE ONLY - this probe is `typeof RTCPeerConnection !== \"undefined\"`; true wherever the constructor is defined. It proves nothing about whether a real peer connection can actually be established from this origin - unused today, so nothing measures it yet (contrast tools/test-network-floor.mjs, which does measure webSocket's real floor). Peer-to-peer rooms (P4 option) unavailable; a LAN WebSocket room still works." },
    { id: "getUserMedia", group: "device", required: false,
      probe: () => !!(navigator.mediaDevices && fn(navigator.mediaDevices.getUserMedia)),
      expects: ex(T, T, T, T, T, N, F),
      degrade: "Unused today; recorded so a future camera/mic feature has a measured floor." },
    { id: "wakeLock", group: "device", required: false,
      probe: () => !!(navigator.wakeLock && fn(navigator.wakeLock.request)),
      expects: ex(T, T, T, T, T, T, F),
      degrade: "The screen may dim during a long drill; nothing else changes." },
    { id: "colorMix", group: "css", required: true,
      probe: () => cssSupports("color", "color-mix(in srgb, red 50%, blue)"),
      expects: ex(T, T, T, T, T, T, T),
      degrade: "The five --ink-* text tokens (src/index.html) resolve to nothing: accent-coloured text renders in the build-generated static fallback colour. " + floorText() },
    { id: "containerQueries", group: "css", required: false,
      probe: () => cssSupports("container-type", "inline-size"),
      expects: ex(T, T, T, T, T, T, T),
      degrade: "Unused today (0 container-type rules); recorded for the engine floor." },
    { id: "hasSelector", group: "css", required: false,
      probe: () => cssSupports("selector(:has(a))"),
      expects: ex(T, T, T, T, T, T, T),
      degrade: "Unused today (0 :has() rules); recorded for the engine floor." },
    { id: "dialog", group: "platform", required: false,
      probe: () => typeof HTMLDialogElement !== "undefined",
      expects: ex(T, T, T, T, T, T, T),
      degrade: "G.modal draws its own overlay and never depends on <dialog>; recorded for the engine floor." },
    { id: "viewTransitions", group: "display", required: false,
      probe: () => fn(document.startViewTransition),
      expects: ex(T, T, T, T, N, T, T),
      degrade: "Route changes cut instead of cross-fading; unused today." },
    { id: "speechSynthesis", group: "device", required: false,
      probe: () => !!window.speechSynthesis,
      expects: ex(T, T, T, T, T, T, T),
      degrade: "Unused today; recorded so a read-aloud drill option has a measured floor." },
    { id: "serviceWorker", group: "platform", required: false,
      probe: () => "serviceWorker" in navigator,
      expects: ex(T, T, N, T, T, N, F),
      degrade: "No offline precache for the hosted build; native shells never register one (assets ship locally), the standalone file needs none." },
    { id: "secureContext", group: "platform", required: false,
      probe: () => !!window.isSecureContext,
      expects: ex(T, T, T, T, T, T, F),
      degrade: "Web Crypto, storage persistence and share are gated on it; a plain http:// host loses them (localhost and file:// count as secure)." },
    { id: "origin", group: "platform", required: false,
      probe: () => String(location.origin),
      expects: ex("http(s)://<host>", "https://<host>", "http://tauri.localhost", "https://localhost", "capacitor://localhost", "null", "http://<lan-ip>:<port>"),
      degrade: "Recorded value, not a capability: \"null\" is the file:// standalone origin, so same-origin features (BroadcastChannel sync) are off there." },
  ];

  const IDS = REGISTRY.map((c) => c.id);
  (function assertUnique() {
    const seen = {};
    for (const id of IDS) { if (seen[id]) throw new Error("caps.js: duplicate capability id " + id); seen[id] = 1; }
  })();

  /* Which forks SHIP today (collective roadmap): ios is still on its
     Simulator-only track. caps-matrix.mjs gates `required` capabilities on
     probe files whose fork is marked true here. */
  const SHIPS = { web: true, pwa: true, tauri: true, android: true, standalone: true, ios: false };

  /* ---------------------------------------------------------------- run */

  let last = null;
  let sentinelDone = false;

  function probeAll() {
    const caps = {};
    for (const c of REGISTRY) {
      try {
        const v = c.probe();
        caps[c.id] = (typeof v === "boolean" || typeof v === "string") ? v : !!v;
      } catch (e) { caps[c.id] = "error:" + ((e && e.message) || String(e)); }
    }
    const eng = engine();
    last = {
      schema: 1,
      fork: fork(),
      build: window.GUIDON_FORK || null,
      engine: eng.engine,
      engineVersion: eng.version,
      webview: eng.webview,
      ua: String(navigator.userAgent || ""),
      sha: window.GUIDON_BUILD_SHA || null,
      dirty: window.GUIDON_BUILD_DIRTY === true,
      version: window.GUIDON_APP_VERSION || null,
      builtAt: window.GUIDON_BUILD_DATE || null,
      isVirtual: isVirtual(),
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      at: new Date().toISOString(),
      caps: caps,
    };
    return last;
  }

  /** Promise<{fork, engine, ua, sha, builtAt, isVirtual, caps, ...}> */
  function run() {
    return Promise.resolve().then(probeAll);
  }

  /** JSON of the last run (runs the probes first if nothing ran yet). */
  function json() {
    return JSON.stringify(last || probeAll());
  }

  /* True when a collector asked for the console sentinel: #/selftest opened
     with ?probe=1, or the build/test flag window.GUIDON_CAPS_PROBE === true. */
  function probeRequested() {
    if (window.GUIDON_CAPS_PROBE === true) return true;
    const h = String(location.hash || "");
    return h.indexOf("selftest") !== -1 && /[?&]probe=1(?:&|$)/.test(h);
  }

  /* Prints `GUIDON_CAPS <json>` exactly once per page lifetime, whatever
     path asked (the Diagnostics render on a probe visit, or its check run).
     Returns true when it printed. Callers gate on probeRequested(). */
  function emitSentinel() {
    if (sentinelDone) return false;
    sentinelDone = true;
    console.log("GUIDON_CAPS " + json());
    return true;
  }

  /* Build/test flag path: a build stamped with window.GUIDON_CAPS_PROBE =
     true (GUIDON_CAPS_PROBE=1 npm run build - web/ only, see build.mjs) or
     a harness that sets it before load prints the sentinel once the page
     has loaded, whatever route it booted to. This is the only path that
     works where nobody can type a hash - the iOS Simulator, where
     tools/ios-simulator-run.sh reads it off `simctl launch --console-pty`.
     The Diagnostics render/check paths share the once-per-page guard. */
  if (window.GUIDON_CAPS_PROBE === true) {
    const boot = () => { run().then(emitSentinel).catch(() => {}); };
    if (document.readyState === "complete") setTimeout(boot, 0);
    else window.addEventListener("load", () => setTimeout(boot, 0), { once: true });
  }

  G.caps = {
    list: () => REGISTRY.slice(),
    ids: () => IDS.slice(),
    ships: SHIPS,
    run: run,
    json: json,
    last: () => last,
    fork: fork,
    engine: engine,
    isCapacitor: isCapacitor,
    isShell: isShell,
    isTauri: isTauri,
    probeRequested: probeRequested,
    emitSentinel: emitSentinel,
  };
})();
// END caps.js
