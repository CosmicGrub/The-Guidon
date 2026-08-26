/* ==== js/pdfjs-defer.js ==== */
/* GUIDON — pdfjs-defer.js : on-demand loading of the DA 4856 PDF PREVIEW stack (G.pdfjsAssets)

   Mirrors pdf-defer.js exactly, for a second, independent pair of vendored
   assets: pdfjs-dist 3.11.174's "legacy" classic-script build (pdfjs.js /
   pdfjs-worker.js — see build.mjs's extraction step and index.html's own
   vendoring comment for the full "why this version, why no real Worker,
   why a known CVE was deliberately accepted with an isEvalSupported:false
   mitigation" rationale). This is the PDF.js rasterizer that renders an
   already-filled DA 4856 to <canvas> for the on-demand "Preview" button in
   js/counselpdf.js — a completely separate concern from pdf-defer.js's
   pdf-lib pair, which FILLS the form. Kept as its own file/global (rather
   than folded into pdf-defer.js) because the two stacks load independently:
   Preview needs both (fill, then render); Generate/Print need only the
   pdf-lib pair and must not pay for pdfjs's ~1.5 MB at all.

   Only present in the bundled (installable) build, same as pdf-defer.js —
   the standalone single-file build keeps pdfjsLib/pdfjsWorker inline like
   every other vendored asset, parsed eagerly at boot. "One file you can
   hand someone" stays true; there's no sibling file to lazy-load there.

   Why this exists, with the same measured-not-hunched standard pdf-defer.js
   sets: the legacy pdfjs-dist build (pdf.min.js + pdf.worker.min.js) is
   ~1.5 MB combined, and is used by exactly one button (DA 4856's on-demand
   "Preview") that most users never click. Deferring it costs nothing on the
   feature — the Preview button already shows its own loading spinner while
   this loads, and the button remains visible and clickable at boot either
   way (ensure() is only awaited once actually clicked).

   Safe because openPdfPreview() (counselpdf.js) already reads
   window.pdfjsLib lazily, at click time, never at module-definition time —
   this module only has to make that load real and awaitable.
*/
window.G = window.G || {};
(function () {
  "use strict";

  const ASSETS = ["assets/pdfjs.js", "assets/pdfjs-worker.js"];
  let loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-guidon-asset="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === "1") return resolve();
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("failed: " + src)));
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = false; // order doesn't functionally matter here (each sets its own global), kept for consistency with pdf-defer.js
      s.dataset.guidonAsset = src;
      s.addEventListener("load", () => { s.dataset.loaded = "1"; resolve(); });
      s.addEventListener("error", () => reject(new Error("failed to load " + src)));
      document.head.appendChild(s);
    });
  }

  /** Loads the pdfjs preview stack once; concurrent callers share the same promise. */
  function ensure() {
    if (window.pdfjsLib && window.pdfjsWorker) return Promise.resolve(true);
    if (loading) return loading;
    loading = (async () => {
      for (const a of ASSETS) await loadScript(a);
      if (!window.pdfjsLib || !window.pdfjsWorker) {
        loading = null;
        throw new Error("PDF preview assets loaded but globals missing");
      }
      return true;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  /** True once the stack is actually parsed and resident. */
  function loaded() {
    return !!(window.pdfjsLib && window.pdfjsWorker);
  }

  G.pdfjsAssets = { ensure, loaded, ASSETS };

  /* Deliberately NOT pre-warmed on idle, same reasoning as pdf-defer.js: the
     Preview button's own spinner already covers the load time, and warming
     would put the ~1.5 MB parse cost back onto every user regardless of
     whether they ever click Preview. */
})();
// END pdfjs-defer.js
