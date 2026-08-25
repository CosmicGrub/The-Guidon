/**
 * The web/PWA build has no CSP of its own baked in (no <meta> tag, no header
 * from tools/server.mjs) - some self-hosters apply one anyway, and a CSP that
 * silently blocks an inline handler, a blob download or an embedded font
 * would break the app in ways that "it built" does not catch. This serves
 * the real bundle under a plausible strict policy and fails on any violation.
 *
 * NOT the Tauri desktop shell's policy - src-tauri/tauri.conf.json ships with
 * no security.csp at all. Tauri v2 auto-injects a per-load nonce into any
 * style-src it's given, and once a nonce is present CSP2+ browsers ignore
 * 'unsafe-inline' in that directive entirely (correct CSP-spec behavior, not
 * a Tauri bug) - confirmed via a real compiled build + WebView2 devtools:
 * every one of GUIDON's ~460 JS-applied inline style="" attributes was
 * silently blocked, breaking nearly all dynamic styling. There is no
 * documented way to opt style-src out of that injection while keeping the
 * rest of a custom policy, so the desktop build ships without a CSP rather
 * than a broken one - it only ever loads its own bundled local assets
 * (verified zero external requests), so the real-world exposure is low.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { declaredRoutes } from "./declared-routes.mjs";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = join("web", normalize(p).replace(/^(\.\.[/\\])+/, ""));
  const st = await stat(f).catch(() => null);
  if (!st || !st.isFile()) { res.writeHead(404); return res.end("404"); }
  const body = await readFile(f);
  res.writeHead(200, {
    "content-type": MIME[extname(f).toLowerCase()] || "application/octet-stream",
    "content-security-policy": CSP,
  });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const DECLARED = await declaredRoutes("web/index.html");

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const violations = [];
const noise = [];
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy|Refused to/i.test(t)) violations.push(t);
  else if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + t);
});
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

// src/app-modules/library.js's render() does a one-time same-origin HEAD probe
// against DOCS[0].pdfAsset (docs/<first reference doc>.pdf) to detect whether
// web/docs/*.pdf actually shipped with this build - true for a real web/Android
// build, false for the standalone single-file build. This route sweep below
// renders every route including #/library, which triggers that probe. It is
// only ever missing here because .github/workflows/ci.yml's build-artifact
// upload deliberately excludes guidon-app/web/docs/** (~78MB, not worth
// re-uploading/downloading for all 14 test-matrix jobs) - a real build.mjs run
// (local, Android, a genuine deploy) always writes web/docs/ alongside
// web/index.html together, so this never happens outside that one CI artifact
// trim. A same-origin fetch() against a URL that genuinely 404s logs Chromium's
// own "Failed to load resource" line to the console as an unavoidable
// network-layer side effect - no try/catch in app code can suppress it, and
// the message text itself never includes the URL (see the response listener
// below, which is what actually confirms *which* 404 this is). Counting real
// docs/*.pdf 404 responses and spending exactly that many off the noise list
// keeps this check honest: any OTHER unexplained 404/console error still fails.
let docsProbe404 = 0;
page.on("response", (r) => {
  if (!r.ok() && /\/docs\/.*\.pdf$/i.test(new URL(r.url()).pathname)) docsProbe404++;
});

console.log("  policy: " + CSP + "\n");
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(800);

// Also catch violations the browser reports via the DOM event rather than console.
await page.evaluate(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) =>
    window.__csp.push(e.violatedDirective + " <- " + (e.blockedURI || "inline")));
});

const boot = await page.evaluate(() => ({
  routes: window.G && window.G.routes ? window.G.routes.length : 0,
  app: !!document.querySelector("#app"),
}));
boot.app && boot.routes === DECLARED.count
  ? ok(`app boots under CSP (all ${boot.routes} declared routes)`)
  : bad(`app did not boot under CSP: ${JSON.stringify(boot)} (expected ${DECLARED.count} routes)`);

// Walk every route: an inline handler blocked by CSP shows up as a dead view.
const routes = await page.evaluate(() => window.G.routes.map((r) => r.hash));
for (const r of routes) {
  await page.evaluate((h) => { location.hash = h; }, r);
  await page.waitForTimeout(80);
}
const rendered = await page.evaluate(() => document.querySelector("#view, main") ?
  (document.querySelector("#view, main").textContent || "").length : 0);
rendered > 100 ? ok("all routes render content under CSP") : bad("view empty after route sweep: " + rendered);

// The PDF stack is injected as a dynamic <script src> - exactly the kind of
// thing a strict script-src blocks.
const pdf = await page.evaluate(async () => {
  try {
    await window.G.pdfAssets.ensure();
    const b = await window.G.pdf456.fill({ name: "CSP, Test", rank: "SGT" });
    const u = b instanceof Uint8Array ? b : new Uint8Array(b);
    return { head: String.fromCharCode(...u.slice(0, 5)), len: u.length };
  } catch (e) { return { error: String(e && e.message || e) }; }
});
pdf.head === "%PDF-" ? ok(`deferred PDF asset loads and generates under CSP (${pdf.len.toLocaleString()} bytes)`)
                     : bad("PDF generation blocked under CSP: " + (pdf.error || JSON.stringify(pdf)));

// Blob URL creation + object URL download path (used by backup export).
const blob = await page.evaluate(() => {
  try {
    const b = new Blob([JSON.stringify({ probe: true })], { type: "application/json" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = "probe.json";
    document.body.appendChild(a);
    const okUrl = u.startsWith("blob:");
    URL.revokeObjectURL(u); a.remove();
    return okUrl;
  } catch (e) { return String(e); }
});
blob === true ? ok("blob: download path works under CSP (backup export)") : bad("blob path blocked: " + blob);

// IndexedDB under CSP
const idb = await page.evaluate(() => new Promise((res) => {
  const rq = indexedDB.open("guidon-csp-probe", 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore("t");
  rq.onsuccess = () => { rq.result.close(); indexedDB.deleteDatabase("guidon-csp-probe"); res(true); };
  rq.onerror = () => res(false);
  setTimeout(() => res(false), 4000);
}));
idb ? ok("IndexedDB works under CSP") : bad("IndexedDB blocked under CSP");

const domViolations = await page.evaluate(() => window.__csp || []);
const all = violations.concat(domViolations);
all.length === 0 ? ok("zero CSP violations") : bad(`${all.length} CSP violations; first: ${all[0]}`);

const KNOWN = [/Removing XFA form data as pdf-lib does not support/];
const DOCS_PROBE_404 = /Failed to load resource: the server responded with a status of 404/;
let docsAllowance = docsProbe404;
const unexpected = noise.filter((n) => {
  if (KNOWN.some((k) => k.test(n))) return false;
  if (docsAllowance > 0 && DOCS_PROBE_404.test(n)) { docsAllowance--; return false; }
  return true;
});
unexpected.length === 0 ? ok("no unexpected console output") : bad(unexpected.length + " msgs; first: " + unexpected[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `CSP TEST: ${fails} FAILURE(S)` : "CSP TEST: all passed"));
process.exit(fails ? 1 : 0);
