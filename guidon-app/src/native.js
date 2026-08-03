/* ==== js/native.js ==== */
/* GUIDON — native.js : Android shell integration (G.native)

   Only does anything inside a Capacitor build. In a browser, on the desktop app,
   or from file://, every function here is a no-op — no errors, no console noise.

   Two jobs, both about the app not looking like a wrapped web page:

     1. The system status and navigation bars follow the active GUIDON theme.
        The app has 24 themes, 5 of them light. A fixed bar colour is wrong for
        at least 19 of them, and a light theme under a dark bar (or vice versa)
        reads instantly as "web page in a shell". The bar colour is read from the
        app's own --bg token, and the icon contrast is computed from that colour's
        relative luminance rather than guessed per-theme.

     2. Reports what the Android hardware/gesture Back button actually does, so
        the behaviour can be verified on a device instead of assumed. Capacitor's
        default (pop WebView history, exit at the root) is correct for a hash
        router, so it is deliberately NOT overridden here — see the note below.
*/
window.G = window.G || {};
(function () {
  "use strict";

  const Cap = window.Capacitor;
  const isNative = !!(Cap && (Cap.isNativePlatform ? Cap.isNativePlatform() : Cap.isNative));
  const state = { platform: isNative ? (Cap.getPlatform ? Cap.getPlatform() : "unknown") : "web",
                  lastBarColor: null, applied: 0 };

  function plugin(name) {
    return (Cap && Cap.Plugins && Cap.Plugins[name]) || null;
  }

  /* ------------------------------------------------------------- colour */

  /** Resolves a CSS custom property to a concrete rgb() value. */
  function token(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  /** Accepts #rgb, #rrggbb, rgb()/rgba(); returns [r,g,b] 0-255 or null. */
  function parseColor(c) {
    if (!c) return null;
    c = String(c).trim();
    let m = c.match(/^#([0-9a-f]{3})$/i);
    if (m) return m[1].split("").map((x) => parseInt(x + x, 16));
    m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    m = c.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }

  function toHex(rgb) {
    return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }

  /** WCAG relative luminance — the same maths the app's contrast work uses. */
  function luminance(rgb) {
    const s = rgb.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  }

  /* --------------------------------------------------------- status bar */

  async function applySystemBars() {
    const sb = plugin("StatusBar");
    if (!sb) return null;

    const raw = token("--bg", "#0a0e12");
    const rgb = parseColor(raw) || [10, 14, 18];
    const hex = toHex(rgb);
    const light = luminance(rgb) > 0.5; // light background needs dark icons

    try {
      await sb.setOverlaysWebView({ overlay: false });
      await sb.setBackgroundColor({ color: hex });
      // Capacitor: Style.Light means DARK content for a LIGHT background.
      await sb.setStyle({ style: light ? "LIGHT" : "DARK" });
      state.lastBarColor = hex;
      state.applied++;
      return { color: hex, style: light ? "LIGHT" : "DARK" };
    } catch (e) {
      console.warn("native: status bar:", e && e.message);
      return null;
    }
  }

  /* Re-apply whenever the theme changes. The app swaps data-theme on <html>,
     and light themes additionally toggle the `light` class, so watch both. */
  function watchTheme() {
    if (!isNative) return;
    let t = null;
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      // Settle past the app's colour transitions before sampling --bg, for the
      // same reason the a11y sweeps do: sampling mid-transition reads a colour
      // that is not the final one.
      t = setTimeout(applySystemBars, 260);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  }

  /* ------------------------------------------------------- back button */

  /* Measured on a device, not assumed: with the App plugin present, Android's
     Back delivered `{canGoBack:false}` to the web layer even with
     history.length at 33, and Capacitor performed no default action. The result
     was a Back button that did NOTHING — it neither navigated nor exited, which
     on Android reads as a broken app.
     `canGoBack` reflects WebView document navigation, and GUIDON is a hash
     router, so it is the wrong signal here. We track our own depth instead. */

  let depth = 0;
  let counting = false;   // ignore the boot-time hash the router sets itself
  let goingBack = false;

  window.addEventListener("hashchange", () => {
    if (!counting) return;
    if (goingBack) { goingBack = false; depth = Math.max(0, depth - 1); }
    else depth += 1;
    state.navDepth = depth;
  });

  /* The app's own start() assigns an initial hash. Counting that as a step
     would make the first Back land on a hash-less URL, which start() would
     immediately re-route — a Back button that never exits. Baseline after boot. */
  function beginCounting() {
    if (counting) return;
    counting = true;
    depth = 0;
    state.navDepth = 0;
  }

  /* Immersive mode for fullscreen study: hide the status bar entirely while
     the drill's theater mode is active, restore the themed bars on exit.
     Best-effort — a web/desktop runtime simply has no StatusBar plugin. */
  async function setImmersive(on) {
    const sb = plugin("StatusBar");
    if (!sb) return false;
    try {
      if (on) { await sb.hide(); }
      else { await sb.show(); await applySystemBars(); }
      return true;
    } catch (e) { return false; }
  }

  /** Closes a themed dialog or the fullscreen study overlay, top layer first. */
  function closeTopLayer() {
    // Fullscreen study is above everything except dialogs; Back should peel
    // it off before it starts navigating history.
    if (document.documentElement.classList.contains("qz-theater")) {
      try { if (G.board && G.board.exitTheater) { G.board.exitTheater(); return true; } } catch (e) {}
      document.documentElement.classList.remove("qz-theater");
      return true;
    }
    if (!document.querySelector(".gm-back")) return false;
    // G.modal listens for Escape on document in the capture phase. Reusing that
    // path keeps one tested close routine instead of poking at its internals.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    return true;
  }

  function handleBack() {
    if (closeTopLayer()) return;
    if (depth > 0) { goingBack = true; history.back(); return; }
    const App = plugin("App");
    if (App && App.exitApp) App.exitApp();
  }

  async function wireBackButton() {
    const App = plugin("App");
    if (!App || !App.addListener) return false;
    try {
      await App.addListener("backButton", handleBack);
      return true;
    } catch (e) {
      console.warn("native: back button:", e && e.message);
      return false;
    }
  }

  function backButtonPolicy() {
    return "guidon: close dialog -> history.back() while depth>0 -> exitApp";
  }

  /* ----------------------------------------------------------------- boot */

  if (isNative) {
    document.documentElement.setAttribute("data-native-platform", state.platform);
    applySystemBars();
    watchTheme();
    wireBackButton().then((wired) => { state.backWired = wired; });
    // Long enough for the router's initial hash to land, short enough that a
    // real navigation in the first second is still counted.
    setTimeout(beginCounting, 1200);
  }

  G.native = {
    state,
    isNative: () => isNative,
    platform: () => state.platform,
    applySystemBars,
    setImmersive,
    backButtonPolicy,
    handleBack,
    navDepth: () => depth,
    // exposed for the on-device test harness
    _debug: { token, parseColor, luminance, toHex, beginCounting },
  };
})();
// END native.js
