/* ==== js/pdf-defer.js ==== */
/* GUIDON — pdf-defer.js : on-demand loading of the DA 4856 PDF stack (G.pdfAssets)

   Only present in the bundled (installable) build. The standalone single-file
   build keeps everything inline, because "one file you can hand someone" is a
   promise this project keeps.

   Why this exists, with measured numbers rather than a hunch:
     pdf-lib (525 KB of minified JS) and the embedded DA 4856 form (371 KB of
     base64) are parsed at every boot, by every user, on every device — but they
     are only ever USED by someone exporting a counseling form. Measured on a 6x
     CPU-throttled profile (tools/perf.mjs), removing them cuts DomContentLoaded
     from ~744 ms to ~631 ms and frees ~900 KB of parsed memory permanently.

   The feature is not degraded. Both files are precached by the service worker,
   so exporting a DA 4856 still works with no signal — the only difference is
   that the parse happens the first time you actually ask for a form.

   Safe because G.pdf456 already read both globals lazily, inside functions, at
   call time — never at module-definition time. This module only has to make the
   UI gate honest and await the load before the two entry points do their work.
*/
window.G = window.G || {};
(function () {
  "use strict";

  const ASSETS = ["assets/pdf-lib.js", "assets/da4856.js"];
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
      s.async = false; // preserve order: pdf-lib before anything that uses it
      s.dataset.guidonAsset = src;
      s.addEventListener("load", () => { s.dataset.loaded = "1"; resolve(); });
      s.addEventListener("error", () => reject(new Error("failed to load " + src)));
      document.head.appendChild(s);
    });
  }

  /** Loads the PDF stack once; concurrent callers share the same promise. */
  function ensure() {
    if (window.GUIDON_DA4856_B64 && (window.PDFLib || window.pdfLib)) return Promise.resolve(true);
    if (loading) return loading;
    loading = (async () => {
      for (const a of ASSETS) await loadScript(a);
      if (!(window.PDFLib || window.pdfLib) || !window.GUIDON_DA4856_B64) {
        loading = null;
        throw new Error("PDF assets loaded but globals missing");
      }
      return true;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  /** True once the stack is actually parsed and resident. */
  function loaded() {
    return !!(window.GUIDON_DA4856_B64 && (window.PDFLib || window.pdfLib));
  }

  G.pdfAssets = { ensure, loaded, ASSETS };

  /* ---- make G.pdf456 deferral-aware ------------------------------------ */
  if (G.pdf456) {
    const origAvailable = G.pdf456.available;
    const origFill = G.pdf456.fill;
    const origGenerate = G.pdf456.generateFillable;

    // The UI gate must report what the feature CAN do, not what happens to be
    // parsed this instant. Returning false here would hide a working feature.
    G.pdf456.available = function () {
      return loaded() || true;
    };
    // Kept for anything that needs the strict, pre-deferral meaning.
    G.pdf456.residentNow = origAvailable;

    if (typeof origFill === "function") {
      G.pdf456.fill = async function (vals) {
        await ensure();
        return origFill.call(this, vals);
      };
    }
    if (typeof origGenerate === "function") {
      G.pdf456.generateFillable = async function (vals) {
        await ensure();
        // origGenerate calls the module-internal fill(), which reads the globals
        // lazily — by now they are resident, so this is the unmodified path.
        return origGenerate.call(this, vals);
      };
    }
  }

  /* Deliberately NOT pre-warmed on idle. Warming would move the parse off the
     boot path but put the memory back for every user, and the ~113 ms load is
     invisible next to generating the PDF itself. The service worker precaches
     both files, so the on-demand path works with no signal. */
})();
// END pdf-defer.js
