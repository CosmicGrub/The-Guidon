/**
 * The standalone build's whole promise is "hand someone this one file and it
 * works, with no server and no network". This proves that from a real file://
 * origin rather than assuming it.
 */
import { chromium } from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { declaredRoutes } from "./declared-routes.mjs";

const file = resolve("dist/guidon-standalone.html");
const url = pathToFileURL(file).href;

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const DECLARED = await declaredRoutes("dist/guidon-standalone.html");

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

// Any request that is not the file itself would break the offline promise.
const requests = [];
page.on("request", (r) => { if (r.url() !== url && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) requests.push(r.url()); });

console.log("  loading " + url + "\n");
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(900);

const boot = await page.evaluate(() => ({
  routes: window.G && window.G.routes ? window.G.routes.length : 0,
  app: !!document.querySelector("#app"),
  // Everything must be inline in this build - nothing deferred to siblings.
  pdflib: !!(window.PDFLib || window.pdfLib),
  b64: !!window.GUIDON_DA4856_B64,
  singlefile: window.GUIDON_SINGLEFILE === true,
  favicon: (document.querySelector('link[rel="icon"]') || {}).href || "",
}));

boot.app ? ok("app shell rendered") : bad("no #app element");
boot.routes === DECLARED.count
  ? ok(`all ${boot.routes} declared routes registered`)
  : bad(`${DECLARED.count} routes declared in the build, ${boot.routes} registered at runtime`);
boot.singlefile ? ok("GUIDON_SINGLEFILE flag intact") : bad("single-file flag lost");
boot.pdflib ? ok("pdf-lib inline (NOT deferred in standalone - correct)") : bad("pdf-lib missing from standalone build");
boot.b64 ? ok("DA 4856 asset inline") : bad("DA4856 missing from standalone build");
boot.favicon.startsWith("data:image/svg+xml") ? ok("favicon is an inline data URI (no sibling file needed)") : bad("favicon not inline: " + boot.favicon.slice(0, 60));

// Navigate every route from file:// - this is where a path assumption would show.
const routes = await page.evaluate(() => window.G.routes.map((r) => r.hash));
let overflow = 0;
for (const r of routes) {
  await page.evaluate((h) => { location.hash = h; }, r);
  await page.waitForTimeout(90);
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (o > 1) { overflow++; bad(`overflow at ${r}: ${o}px`); }
}
if (!overflow) ok(`navigated all ${routes.length} routes from file:// with no overflow`);

// Generate a PDF entirely offline from a local file.
const pdf = await page.evaluate(async () => {
  try {
    const b = await window.G.pdf456.fill({ name: "Standalone, Test", rank: "SGT" });
    const u = b instanceof Uint8Array ? b : new Uint8Array(b);
    return { len: u.length, head: String.fromCharCode(...u.slice(0, 5)) };
  } catch (e) { return { error: String(e && e.message || e) }; }
});
pdf.head === "%PDF-" ? ok(`DA 4856 export works from file:// (${pdf.len.toLocaleString()} bytes)`)
                     : bad("PDF export from file:// failed: " + (pdf.error || JSON.stringify(pdf)));

// IndexedDB must work from file:// or saved progress silently vanishes.
const idb = await page.evaluate(() => new Promise((res) => {
  try {
    const rq = indexedDB.open("guidon-file-probe", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("t");
    rq.onsuccess = () => { rq.result.close(); indexedDB.deleteDatabase("guidon-file-probe"); res(true); };
    rq.onerror = () => res(false);
    setTimeout(() => res(false), 4000);
  } catch (e) { res(false); }
}));
idb ? ok("IndexedDB available from file:// (progress will persist)")
    : bad("IndexedDB blocked from file:// - saved progress would be lost");

requests.length === 0 ? ok("zero external requests (no sibling files, no network)")
                      : bad("requested external resources: " + requests.slice(0, 4).join(", "));

const KNOWN = [/Removing XFA form data as pdf-lib does not support/];
const unexpected = noise.filter((n) => !KNOWN.some((k) => k.test(n)));
unexpected.length === 0 ? ok("no unexpected console output") : bad(unexpected.length + " console msgs; first: " + unexpected[0]);

await browser.close();
console.log("\n" + (fails ? `STANDALONE: ${fails} FAILURE(S)` : "STANDALONE: all passed"));
process.exit(fails ? 1 : 0);
