// GUIDON R11 self-test probe.
//
// Injected by src-tauri/src/main.rs as a webview initialization script ONLY
// when the process started with GUIDON_SELFTEST_OUT set; a normal launch never
// sees this file. It runs at document start, before the page's own scripts,
// so it polls until the app has published its route table and theme registry
// and then hands one report to the Rust side through the raw IPC surface
// (window.__TAURI_INTERNALS__.invoke - tauri 2.11.5 scripts/core.js defines
// invoke(cmd, payload, options) on that object; no @tauri-apps/api needed).
// The Rust command merges it with window facts and writes the JSON file.
(function () {
  var started = Date.now();
  function ready() {
    var G = window.G;
    return !!(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === "function" &&
      G && Array.isArray(G.routes) && G.theme && Array.isArray(G.theme.THEMES));
  }
  function fork() {
    var G = window.G;
    try {
      if (G.caps && typeof G.caps.fork === "function") { return G.caps.fork(); }
    } catch (e) {}
    return (typeof window.GUIDON_FORK === "string") ? window.GUIDON_FORK : null;
  }
  function report() {
    var G = window.G;
    var payload = {
      routes: G.routes.length,
      themes: G.theme.THEMES.length,
      hash: String(location.hash || ""),
      fork: fork(),
      buildSha: (typeof window.GUIDON_BUILD_SHA === "string") ? window.GUIDON_BUILD_SHA : null,
      readyMs: Date.now() - started
    };
    window.__TAURI_INTERNALS__.invoke("selftest_report", { report: payload }).catch(function (e) {
      try { console.error("GUIDON selftest_report rejected: " + e); } catch (_) {}
    });
  }
  var timer = setInterval(function () {
    if (ready()) { clearInterval(timer); report(); }
  }, 50);
})();
