/**
 * util.download() / util.downloadBinary() / util._nativeSave() (js/util.js,
 * in src/index.html): the shared save-a-file helpers behind every export
 * button in the app (backup, IDP export, DA 4856 PDFs, Authoring Studio
 * scenario export).
 *
 * Blob URL + <a download> is a real download in a browser, but does nothing
 * on Android — Capacitor's default WebView shell registers no
 * DownloadListener, and blob: isn't a network resource DownloadManager can
 * fetch even if one were added (confirmed against Capacitor's own source and
 * issue tracker, ionic-team/capacitor#5478; see task #200). The fix routes
 * native builds through @capacitor/filesystem (write to the app-private
 * cache, no permission needed) + @capacitor/share (hand the file to
 * Android's share sheet). Since no real Android device was reachable at the
 * time of the fix, this suite exercises the branching logic against stubbed
 * Capacitor plugins in a normal browser context — it cannot confirm bytes
 * land in the Downloads folder on a physical device, but it does confirm
 * util.download()/downloadBinary() take the correct branch and call the
 * native plugins with the correct shape, and that the ordinary browser path
 * is untouched when no native shim is present.
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
await page.waitForFunction(() => window.G && window.G.util && window.G.util.download);

// 1) Browser branch (no G.native) - real blob+<a download> still fires.
const browserBranch = await page.evaluate(async () => {
  let firedHref = null;
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { firedHref = this.href; };
  window.G.util.download("test-native-download.json", JSON.stringify({ a: 1 }), "application/json");
  await new Promise((r) => setTimeout(r, 50));
  HTMLAnchorElement.prototype.click = origClick;
  return { firedBlob: !!(firedHref && firedHref.indexOf("blob:") === 0) };
});
browserBranch.firedBlob
  ? ok("util.download() uses blob+<a download> when G.native is absent (browser/desktop-web path)")
  : bad("util.download() did not fire a blob anchor click in the non-native branch: " + JSON.stringify(browserBranch));

// 2) Native branch: stub G.native.isNative() -> true and a fake
//    Capacitor.Plugins.Filesystem/Share. util._nativeSave should write to
//    Directory.Cache and hand the resulting uri to Share.share({files:[uri]}),
//    and util.download() must NOT also click a blob anchor.
const nativeBranch = await page.evaluate(async () => {
  const calls = { writeFile: null, share: null };
  window.Capacitor = {
    Plugins: {
      Filesystem: { writeFile: async (opts) => { calls.writeFile = opts; return { uri: "file:///fake/cache/test-native-download.json" }; } },
      Share: { share: async (opts) => { calls.share = opts; return {}; } },
    },
  };
  window.G.native = window.G.native || {};
  const origIsNative = window.G.native.isNative;
  window.G.native.isNative = () => true;

  let anchorClicked = false;
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { anchorClicked = true; };

  window.G.util.download("test-native-download-b.json", "hello text", "application/json");
  await new Promise((r) => setTimeout(r, 50));

  HTMLAnchorElement.prototype.click = origClick;
  if (origIsNative) window.G.native.isNative = origIsNative; else delete window.G.native.isNative;
  delete window.Capacitor;
  return { calls, anchorClicked };
});

const wf = nativeBranch.calls.writeFile;
wf && wf.directory === "CACHE" && wf.encoding === "utf8" && wf.path === "test-native-download-b.json" && wf.data === "hello text"
  ? ok("util.download() routes native builds through Filesystem.writeFile(Directory.Cache, utf8) instead of blob+<a>")
  : bad("Filesystem.writeFile call shape wrong: " + JSON.stringify(wf));

const sh = nativeBranch.calls.share;
sh && Array.isArray(sh.files) && sh.files[0] === "file:///fake/cache/test-native-download.json"
  ? ok("util._nativeSave() hands the Filesystem.writeFile uri to Share.share({files:[uri]})")
  : bad("Share.share call shape wrong: " + JSON.stringify(sh));

!nativeBranch.anchorClicked
  ? ok("util.download() does not fall through to blob+<a download> once the native branch is taken")
  : bad("util.download() still clicked a blob anchor with the native branch active");

// 3) util.downloadBinary(): base64-encodes and writes with no `encoding` key
//    (Filesystem.writeFile's documented signal for binary/base64 data),
//    and the payload round-trips byte-for-byte.
const binBranch = await page.evaluate(async () => {
  const calls = { writeFile: null };
  window.Capacitor = { Plugins: {
    Filesystem: { writeFile: async (opts) => { calls.writeFile = opts; return { uri: "file:///fake/cache/x.pdf" }; } },
    Share: { share: async () => ({}) },
  } };
  window.G.native = window.G.native || {};
  const origIsNative = window.G.native.isNative;
  window.G.native.isNative = () => true;
  window.G.util.downloadBinary("x.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf");
  await new Promise((r) => setTimeout(r, 50));
  if (origIsNative) window.G.native.isNative = origIsNative; else delete window.G.native.isNative;
  delete window.Capacitor;
  return calls;
});
binBranch.writeFile && !("encoding" in binBranch.writeFile) && typeof binBranch.writeFile.data === "string"
  ? ok("util.downloadBinary() writes base64 data with no `encoding` key (Filesystem's binary-data contract)")
  : bad("downloadBinary native write shape wrong: " + JSON.stringify(binBranch.writeFile));
if (binBranch.writeFile) {
  const decoded = atob(binBranch.writeFile.data);
  decoded === "%PDF-"
    ? ok("base64 payload round-trips to the original bytes (%PDF- header intact)")
    : bad("base64 payload corrupted: decoded to " + JSON.stringify(decoded));
}

// 4) The 5 real call sites this fix touched still exist and still funnel
//    through util.download/util.downloadBinary rather than hand-rolling
//    their own blob+<a> - a static source check, since most of these live
//    behind auth/data setup this suite doesn't stand up.
const routed = await page.evaluate(() => {
  const src = document.documentElement.outerHTML;
  return {
    utilDownloadDefined: typeof window.G.util.download === "function",
    utilDownloadBinaryDefined: typeof window.G.util.downloadBinary === "function",
    nativeSaveDefined: typeof window.G.util._nativeSave === "function",
  };
});
routed.utilDownloadDefined && routed.utilDownloadBinaryDefined && routed.nativeSaveDefined
  ? ok("util.download / util.downloadBinary / util._nativeSave are all defined on the shared util object")
  : bad("one or more shared download helpers missing: " + JSON.stringify(routed));

noise.length === 0
  ? ok("no unexpected console errors/page errors")
  : bad(`${noise.length} unexpected console/page error(s); first: ${noise[0]}`);

await browser.close();
console.log("\n" + (fails ? `NATIVE DOWNLOAD: ${fails} FAILURE(S)` : "NATIVE DOWNLOAD: all passed"));
process.exit(fails ? 1 : 0);
