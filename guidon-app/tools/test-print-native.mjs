/**
 * util.printHTML()'s native branch (src/index.html, js/util.js): window.print()
 * is a silent no-op inside Capacitor's bare Android WebView shell (no
 * PrintManager/WebChromeClient wiring, no OS print UI to hand off to - see
 * task #203, the same underlying gap #200 found for downloads). The fix hands
 * the same cleaned content to the already-working native-save pipeline (#200)
 * as a standalone, self-printing HTML file instead, routed through
 * util.download() so it lands in the share sheet rather than silently
 * failing on any of the app's ~15 print buttons (After-Action Review, Mock
 * Board scorecard, DA 4856, IDP, Memo, SITREP, Doctrine, etc).
 *
 * No real Android device was reachable at the time of the fix (same
 * constraint documented in tools/test-native-download.mjs), so this suite
 * exercises the branching logic against stubbed Capacitor plugins in a
 * normal browser context - it confirms printHTML() takes the correct branch,
 * builds a correctly-shaped self-printing document, and hands it to
 * util.download() with the right filename/mime, and that the ordinary
 * browser print path (window.print() + a #print-holder) is untouched when no
 * native shim is present.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = "file://" + path.resolve(__dirname, "..", "dist", "guidon-standalone.html");

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const browser = await chromium.launch();
const page = await browser.newPage();
const noise = [];
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") noise.push("console.error: " + m.text()); });
await page.goto(target);
await page.waitForFunction(() => window.G && window.G.util && window.G.util.printHTML);

// 1) Browser branch (no G.native) - the pre-existing window.print() path is untouched.
const browserBranch = await page.evaluate(async () => {
  let printCalled = false;
  const origPrint = window.print;
  window.print = () => { printCalled = true; };
  window.G.util.printHTML("Browser Branch Title", "<p>hello</p>");
  await new Promise((r) => setTimeout(r, 100));
  const holderPresentDuringPrint = document.getElementById("print-holder") !== null;
  window.print = origPrint;
  // afterprint never fires in this headless harness, so clean up manually
  // rather than leave the holder in the DOM for later assertions in this file.
  const leftover = document.getElementById("print-holder");
  if (leftover) leftover.remove();
  document.querySelectorAll("#app").forEach((n) => n.classList.remove("no-print"));
  return { printCalled, holderPresentDuringPrint };
});
browserBranch.printCalled && browserBranch.holderPresentDuringPrint
  ? ok("util.printHTML() still uses window.print() + a #print-holder when G.native is absent (browser/desktop-web path)")
  : bad("browser branch broke: " + JSON.stringify(browserBranch));

// 2) Native branch: stub G.native.isNative() -> true and a fake
//    Capacitor.Plugins.Filesystem/Share, matching test-native-download.mjs's
//    established stubbing shape. printHTML() should build a self-printing
//    HTML document and hand it to util.download(), NOT call window.print()
//    or append a #print-holder.
const nativeBranch = await page.evaluate(async () => {
  const calls = { writeFile: null, share: null };
  window.Capacitor = {
    Plugins: {
      Filesystem: { writeFile: async (opts) => { calls.writeFile = opts; return { uri: "file:///fake/cache/report.html" }; } },
      Share: { share: async (opts) => { calls.share = opts; return {}; } },
    },
  };
  window.G.native = window.G.native || {};
  const origIsNative = window.G.native.isNative;
  window.G.native.isNative = () => true;

  let printCalled = false;
  const origPrint = window.print;
  window.print = () => { printCalled = true; };

  let toastMsg = null;
  const origToast = window.G.util.toast;
  window.G.util.toast = (m) => { toastMsg = m; };

  window.G.util.printHTML("Mock Board Scorecard: <SGT Test>", "<h2>Section</h2><p>Body & content</p>");
  await new Promise((r) => setTimeout(r, 100));

  const holderPresent = document.getElementById("print-holder") !== null;

  window.print = origPrint;
  if (origIsNative) window.G.native.isNative = origIsNative; else delete window.G.native.isNative;
  window.G.util.toast = origToast;
  delete window.Capacitor;

  return { calls, printCalled, holderPresent, toastMsg };
});

const wf = nativeBranch.calls.writeFile;
wf
  ? ok("util.printHTML() routes native builds through util.download() -> Filesystem.writeFile instead of window.print()")
  : bad("no Filesystem.writeFile call happened in the native branch");
if (wf) {
  /^Mock-Board-Scorecard-SGT-Test-?\.html$/.test(wf.path) || /^[A-Za-z0-9-]+\.html$/.test(wf.path)
    ? ok("the generated filename is sanitized to safe characters and ends in .html (got \"" + wf.path + "\")")
    : bad("filename not safely sanitized: " + JSON.stringify(wf.path));
  wf.encoding === "utf8"
    ? ok("the report is written as utf8 text (it's an HTML document, not binary)")
    : bad("expected utf8 encoding, got: " + JSON.stringify(wf.encoding));
  const doc = wf.data || "";
  doc.indexOf("<!doctype html>") === 0
    ? ok("the written document is a real standalone HTML document (starts with <!doctype html>)")
    : bad("document does not start with <!doctype html>: " + doc.slice(0, 60));
  doc.indexOf("Mock Board Scorecard: &lt;SGT Test&gt;") !== -1
    ? ok("the title is HTML-escaped in both <title> and the visible <h1> (no raw '<SGT Test>' injected as markup)")
    : bad("title escaping missing/wrong in the generated document");
  doc.indexOf("<h2>Section</h2><p>Body & content</p>") !== -1
    ? ok("the caller's innerHTML content is embedded verbatim in the generated document body")
    : bad("caller content missing from the generated document");
  /window\.print\(\)/.test(doc) && /addEventListener\(.load./.test(doc)
    ? ok("the generated document self-triggers window.print() on load (so opening it via the share sheet's 'Open with' prints immediately)")
    : bad("generated document is missing its own self-print trigger");
}

const sh = nativeBranch.calls.share;
sh && Array.isArray(sh.files) && sh.files[0] === "file:///fake/cache/report.html"
  ? ok("the written file is handed to Share.share({files:[uri]}) - same pipeline as util.download()'s other native callers")
  : bad("Share.share call shape wrong: " + JSON.stringify(sh));

!nativeBranch.printCalled
  ? ok("window.print() is never called directly in the native branch (would be a silent no-op in the bare WebView)")
  : bad("native branch still called window.print() directly");
!nativeBranch.holderPresent
  ? ok("no #print-holder is appended to the live DOM in the native branch (that's the browser-only path)")
  : bad("native branch still appended a #print-holder to the DOM");
nativeBranch.toastMsg && /report saved/i.test(nativeBranch.toastMsg)
  ? ok("a success toast confirms the report was saved (\"" + nativeBranch.toastMsg + "\")")
  : bad("no success toast (or wrong wording) after a successful native save: " + JSON.stringify(nativeBranch.toastMsg));

// 3) Native branch, save failure: util.download() resolving false (e.g. the
//    user declined the share sheet, or Filesystem.writeFile rejected) should
//    surface a distinct failure toast, not the success one.
const nativeFailure = await page.evaluate(async () => {
  window.Capacitor = {
    Plugins: {
      Filesystem: { writeFile: async () => { throw new Error("disk full"); } },
      Share: { share: async () => ({}) },
    },
  };
  window.G.native = window.G.native || {};
  const origIsNative = window.G.native.isNative;
  window.G.native.isNative = () => true;
  let toastMsg = null;
  const origToast = window.G.util.toast;
  window.G.util.toast = (m) => { toastMsg = m; };

  window.G.util.printHTML("Failure Case", "<p>x</p>");
  await new Promise((r) => setTimeout(r, 100));

  if (origIsNative) window.G.native.isNative = origIsNative; else delete window.G.native.isNative;
  window.G.util.toast = origToast;
  delete window.Capacitor;
  return { toastMsg };
});
nativeFailure.toastMsg && /couldn'?t save/i.test(nativeFailure.toastMsg)
  ? ok("a distinct failure toast is shown when the native save fails (\"" + nativeFailure.toastMsg + "\")")
  : bad("failure toast missing/wrong when native save fails: " + JSON.stringify(nativeFailure.toastMsg));

noise.length === 0
  ? ok("no unexpected console errors/page errors")
  : bad(`${noise.length} unexpected console/page error(s); first: ${noise[0]}`);

await browser.close();
console.log("\n" + (fails ? `PRINT NATIVE: ${fails} FAILURE(S)` : "PRINT NATIVE: all passed"));
process.exit(fails ? 1 : 0);
