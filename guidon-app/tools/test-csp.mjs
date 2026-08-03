/**
 * The Tauri desktop shell injects a Content-Security-Policy that the browser
 * builds never run under. A CSP that silently blocks an inline handler, a blob
 * download or an embedded font would break the desktop app in ways that
 * "it compiled" does not catch.
 *
 * This serves the real bundle with the exact policy from tauri.conf.json and
 * fails on any violation.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { declaredRoutes } from "./declared-routes.mjs";

/* Kept byte-identical to app.security.csp in src-tauri/tauri.conf.json. */
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
const unexpected = noise.filter((n) => !KNOWN.some((k) => k.test(n)));
unexpected.length === 0 ? ok("no unexpected console output") : bad(unexpected.length + " msgs; first: " + unexpected[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `CSP TEST: ${fails} FAILURE(S)` : "CSP TEST: all passed"));
process.exit(fails ? 1 : 0);
