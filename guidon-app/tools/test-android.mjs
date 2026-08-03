/**
 * Runs the real checks against the APK's WebView on a live Android device or
 * emulator, over the DevTools bridge. Requires:
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *
 * "It compiled and the process is alive" is not evidence the app works. This
 * evaluates JavaScript inside the actual shipped WebView.
 */
/* Playwright's connectOverCDP needs browser-level endpoints that Android
   WebView does not implement, so this talks to the page target directly. */
import { attachToPage } from "./cdp.mjs";
import { declaredRoutes } from "./declared-routes.mjs";

const DECLARED = await declaredRoutes("web/index.html");

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const page = await attachToPage("http://127.0.0.1:9222");

/* Capture console error AND warning, per this project's standing rule — an
   error-only filter once hid a ReferenceError for two full sessions. */
const noise = [];
page.onEvent((msg) => {
  const p = msg.params || {};
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(p.type))
    noise.push(p.type + ": " + (p.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
  if (msg.method === "Runtime.exceptionThrown")
    noise.push("pageerror: " + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
  if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(p.entry?.level))
    noise.push(p.entry.level + ": " + p.entry.text);
});

const ua = await page.evaluate(() => navigator.userAgent);
console.log("  WebView: " + (ua.match(/Chrome\/[\d.]+/) || ["?"])[0]);
console.log("  URL: " + page.target.url + "\n");

const boot = await page.evaluate(() => ({
  routes: window.G && window.G.routes ? window.G.routes.length : 0,
  app: !!document.querySelector("#app"),
  capacitor: !!window.Capacitor,
  displayMode: document.documentElement.getAttribute("data-display-mode"),
  pwaModule: !!(window.G && window.G.pwa),
  pdfShim: !!(window.G && window.G.pdfAssets),
  pdflibAtBoot: !!(window.PDFLib || window.pdfLib),
}));

boot.app ? ok("app shell rendered in the Android WebView") : bad("no #app element");
boot.routes === DECLARED.count
  ? ok(`all ${boot.routes} declared routes registered`)
  : bad(`${DECLARED.count} declared, ${boot.routes} registered`);
boot.capacitor ? ok("Capacitor bridge present") : bad("window.Capacitor missing");
boot.pwaModule ? ok("G.pwa module loaded") : bad("G.pwa missing");
boot.displayMode === "native"
  ? ok('display-mode detected as "native" (installed-app affordances active)')
  : bad('expected data-display-mode="native", got ' + JSON.stringify(boot.displayMode));
boot.pdfShim ? ok("G.pdfAssets deferral shim present") : bad("G.pdfAssets missing");
!boot.pdflibAtBoot ? ok("pdf-lib deferred (not parsed at boot on Android)") : bad("pdf-lib parsed at boot");

/* The open question: does the service worker register inside Capacitor's
   https://localhost origin? It must not - assets already ship in the APK. */
const sw = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return { supported: false };
  const regs = await navigator.serviceWorker.getRegistrations();
  return { supported: true, count: regs.length, scopes: regs.map((r) => r.scope) };
});
if (!sw.supported) ok("service workers unsupported in this WebView (nothing to skip)");
else if (sw.count === 0) ok("no service worker registered on Android (correct - APK assets are already local)");
else bad(`service worker registered on Android: ${sw.scopes.join(", ")} - native detection failed`);

/* ---- native shell integration (G.native) ---- */
const nat = await page.evaluate(() => {
  const n = window.G && window.G.native;
  return n ? {
    present: true,
    isNative: n.isNative(),
    platform: n.platform(),
    attr: document.documentElement.getAttribute("data-native-platform"),
    applied: n.state.applied,
    barColor: n.state.lastBarColor,
    backPolicy: n.backButtonPolicy(),
  } : { present: false };
});
nat.present ? ok("G.native module loaded") : bad("G.native missing");
nat.isNative ? ok(`native platform detected: ${nat.platform}`) : bad("isNative() false on Android");
nat.attr === "android" ? ok('data-native-platform="android" set') : bad("data-native-platform = " + nat.attr);
nat.applied > 0 ? ok(`system bars themed (${nat.applied} apply, colour ${nat.barColor})`) : bad("status bar never themed");
console.log("  back button: " + nat.backPolicy);

/* Switching to a dark theme must repaint the system bars to match. A fixed bar
   colour under 24 themes is the tell that gives a wrapped web page away. */
/* Assert the actual invariant - "the bar colour equals the current --bg" - and
   poll for it rather than sleeping a fixed time. A fixed wait raced with app
   initialisation re-asserting the stored theme and produced a false failure. */
const themed = await page.evaluate(async () => {
  const bg = () => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const settle = async (want) => {
    for (let i = 0; i < 40; i++) {                       // up to ~4s
      if (window.G.native.state.lastBarColor === want) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  const before = { bg: bg(), bar: window.G.native.state.lastBarColor };

  document.documentElement.setAttribute("data-theme", "night-vision");
  document.documentElement.classList.remove("light");
  const darkBg = bg();
  const darkOk = await settle(darkBg);

  document.documentElement.setAttribute("data-theme", "field-manual");
  document.documentElement.classList.add("light");
  const lightBg = bg();
  const lightOk = await settle(lightBg);

  return { before, darkBg, darkOk, lightBg, lightOk, changed: darkBg !== lightBg };
});
if (!themed.changed) bad(`--bg did not differ between themes (${themed.darkBg} vs ${themed.lightBg}) - test setup wrong`);
else if (themed.darkOk && themed.lightOk)
  ok(`system bars track the theme: ${themed.lightBg} (light) <-> ${themed.darkBg} (dark)`);
else bad(`bar colour did not converge on --bg (${JSON.stringify(themed)})`);

/* Storage must work or study progress silently vanishes. */
const idb = await page.evaluate(() => new Promise((res) => {
  try {
    const rq = indexedDB.open("guidon-android-probe", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("t");
    rq.onsuccess = () => { rq.result.close(); indexedDB.deleteDatabase("guidon-android-probe"); res(true); };
    rq.onerror = () => res(false);
    setTimeout(() => res(false), 5000);
  } catch (e) { res(false); }
}));
idb ? ok("IndexedDB works (progress persists)") : bad("IndexedDB blocked on Android");

/* Route sweep at the device's real viewport. */
const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: devicePixelRatio }));
console.log(`  viewport: ${vp.w}x${vp.h} @${vp.dpr}x`);
const routes = await page.evaluate(() => window.G.routes.map((r) => r.hash));
let overflow = 0;
for (const r of routes) {
  await page.evaluate((h) => { location.hash = h; }, r);
  await page.sleep(140);
  const o = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - window.innerWidth,
    wide: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().width > window.innerWidth + 1).length,
  }));
  if (o.doc > 1 || o.wide > 0) { overflow++; bad(`overflow at ${r}: doc=${o.doc} wide=${o.wide}`); }
}
if (!overflow) ok(`no horizontal overflow across all ${routes.length} sections at ${vp.w}px`);

/* The deferred PDF stack must load from APK assets and produce a real form. */
const pdf = await page.evaluate(async () => {
  try {
    await window.G.pdfAssets.ensure();
    const b = await window.G.pdf456.fill({ name: "Android, Test", rank: "SGT", date: "2026-07-26" });
    const u = b instanceof Uint8Array ? b : new Uint8Array(b);
    return { head: String.fromCharCode(...u.slice(0, 5)), len: u.length };
  } catch (e) { return { error: String(e && e.message || e) }; }
});
pdf.head === "%PDF-"
  ? ok(`DA 4856 export works on Android (${pdf.len.toLocaleString()} bytes, deferred assets loaded from APK)`)
  : bad("PDF export failed on Android: " + (pdf.error || JSON.stringify(pdf)));

await page.evaluate(() => { location.hash = "#/home"; });
await page.sleep(300);

const KNOWN = [/Removing XFA form data as pdf-lib does not support/];
const unexpected = noise.filter((n) => !KNOWN.some((k) => k.test(n)));
unexpected.length === 0
  ? ok("no unexpected console output on Android")
  : bad(`${unexpected.length} console msgs; first: ${unexpected[0]}`);

page.close();
console.log("\n" + (fails ? `ANDROID: ${fails} FAILURE(S)` : "ANDROID: all passed"));
process.exit(fails ? 1 : 0);
