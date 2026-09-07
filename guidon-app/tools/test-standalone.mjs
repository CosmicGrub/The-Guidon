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
// "No server, ever" promise, P1 (desktop roadmap, locked decision Q1): this
// audit is scoped to OUTSIDE A STUDY SESSION (study groups at their default,
// off). The standalone file's own promise stays absolute - no server, no
// network, no install - but it shares src/index.html with the forks that
// will get LAN rooms, so P4 must teach this audit to allow ONLY the room's
// ws:// origin while a session is open (studyGroups on + a G.netLedger
// entry naming that peer) in the same change that adds the socket, and
// keep failing on everything else.
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
  // Collective P2: the fork marker is stamped by tools/build.mjs per output
  // (not by src/index.html, which is shared by every fork) - "standalone"
  // here, "web" in web/index.html (tools/verify.mjs asserts that one).
  fork: window.GUIDON_FORK,
  runtimeFork: window.G && window.G.caps && window.G.caps.fork ? window.G.caps.fork() : null,
  favicon: (document.querySelector('link[rel="icon"]') || {}).href || "",
}));

boot.app ? ok("app shell rendered") : bad("no #app element");
boot.fork === "standalone" ? ok('GUIDON_FORK === "standalone" (stamped by the build)') : bad("GUIDON_FORK = " + JSON.stringify(boot.fork) + ' (expected "standalone")');
boot.runtimeFork === "standalone" ? ok('G.caps.fork() derives "standalone" from the marker') : bad("G.caps.fork() = " + JSON.stringify(boot.runtimeFork));
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

// Collective P3: the room module (src/app-modules/studygroup.js) ships in
// this file too, and here it must be INERT: the kill switch is off by
// default, #/group renders its off-state panel, host()/join() refuse with
// the Settings-off sentence, no transport is attached, and the connection
// ledger stays empty. (Proven RED first against a copy of this run with
// the switch forced on: the .sg-off panel is gone and the switch reads
// true; host()/join() then fall through to the "no transport" refusal.)
await page.evaluate(() => { location.hash = "#/"; });
await page.waitForTimeout(120);
await page.evaluate(() => { location.hash = "#/group"; });
await page.waitForTimeout(400);
const room = await page.evaluate(async () => {
  const out = { offPanel: !!document.querySelector(".sg-off"), sw: null, available: null, host: null, join: null, transport: typeof window.__roomTransport, ledger: null };
  try { out.sw = window.G.store.settings().studyGroups; } catch (e) { out.sw = "err:" + e.message; }
  try { out.available = window.G.studyGroup.available(); } catch (e) { out.available = "err:" + e.message; }
  try { out.host = await window.G.studyGroup.host({ mode: "relay", name: "STANDALONE" }); } catch (e) { out.host = { err: e.message }; }
  try { out.join = await window.G.studyGroup.join({ room: "ALPHA-BRAVO-42", name: "STANDALONE" }); } catch (e) { out.join = { err: e.message }; }
  try { out.ledger = window.G.netLedger.list(); } catch (e) { out.ledger = "err:" + e.message; }
  return out;
});
room.offPanel ? ok("#/group renders the off-state panel (.sg-off) in the standalone file") : bad("#/group: no .sg-off panel in the standalone file");
room.sw === false && room.available === false ? ok("studyGroups is off by default here (settings.studyGroups === false, G.studyGroup.available() === false)") : bad("studyGroups switch: " + JSON.stringify({ sw: room.sw, available: room.available }));
room.host && room.host.ok === false && /off in Settings/.test(room.host.reason || "") ? ok("G.studyGroup.host() refuses: " + JSON.stringify(room.host.reason)) : bad("host() answered " + JSON.stringify(room.host));
room.join && room.join.ok === false && /off in Settings/.test(room.join.reason || "") ? ok("G.studyGroup.join() refuses: " + JSON.stringify(room.join.reason)) : bad("join() answered " + JSON.stringify(room.join));
room.transport === "undefined" ? ok("no room transport is attached to the standalone page (window.__roomTransport is undefined)") : bad("a room transport exists in the standalone file: " + room.transport);
Array.isArray(room.ledger) && room.ledger.length === 0 ? ok("G.netLedger.list() is empty: the standalone file opened no connection") : bad("G.netLedger.list() = " + JSON.stringify(room.ledger));

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
