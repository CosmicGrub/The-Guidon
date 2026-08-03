/**
 * Is the 3.26 MB GUIDON_SEED cheaper to parse as JSON.parse('...') than as a
 * JavaScript object literal?
 *
 * Every previous session deferred the seed work as "needs its own dedicated
 * session", because the obvious approach - making the seed load asynchronously -
 * touches all 34 modules that read store.* and risks a study app's correctness
 * for roughly 200ms.
 *
 * This tests a different lever entirely. V8 parses JSON with a dedicated parser
 * that is materially faster than the full JavaScript parser for the same data,
 * and swapping one for the other is a build-time transform with no
 * architectural change and no async anywhere. If the win is real, it is a much
 * better trade than the refactor everyone kept deferring.
 *
 * Measures both under CPU throttling, median of several cold loads.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { join } from "node:path";

const SRC = "web/index.html";
const TMP = "dist/_seedperf";
const RUNS = 5;
const THROTTLE = [1, 4, 6];

const html = await readFile(SRC, "utf8");

/* Locate the seed assignment inside its script block. */
const START = 'window.GUIDON_SEED = ';
const i = html.indexOf(START);
if (i < 0) throw new Error("seed assignment not found");
const objStart = i + START.length;
// The literal ends at the ";\n" that closes the statement; find it by matching
// braces rather than guessing, so nested content cannot fool it.
let depth = 0, inStr = false, esc = false, objEnd = -1;
for (let p = objStart; p < html.length; p++) {
  const c = html[p];
  if (esc) { esc = false; continue; }
  if (c === "\\") { esc = true; continue; }
  if (inStr) { if (c === '"') inStr = false; continue; }
  if (c === '"') { inStr = true; continue; }
  if (c === "{") depth++;
  else if (c === "}") { depth--; if (depth === 0) { objEnd = p + 1; break; } }
}
if (objEnd < 0) throw new Error("could not brace-match the seed literal");
const literal = html.slice(objStart, objEnd);
console.log(`  seed literal: ${(literal.length / 1048576).toFixed(2)} MB`);

/* It must be strict JSON for this to be a legal swap. Prove it, do not assume. */
let parsed;
try { parsed = JSON.parse(literal); }
catch (e) { console.log("  seed is NOT strict JSON: " + e.message); process.exit(3); }
console.log("  seed is strict JSON — swap is legal. Top-level keys: " + Object.keys(parsed).length);

/* Single-quoted JS string so the JSON's own double quotes need no escaping;
   only backslash, single quote and line terminators do. */
const jsonText = JSON.stringify(parsed);
// Let JSON.stringify build the JS string literal. Hand-rolled escaping got this
// wrong twice and produced a variant that measured 37% faster because it had
// silently stopped booting - which is exactly the kind of result that looks
// like a win. JSON.stringify escapes quotes, backslashes and control chars
// correctly, and since ES2019 U+2028/U+2029 are legal in JS string literals.
const asStringLiteral = JSON.stringify(jsonText);

const variantJson = html.slice(0, objStart) + "JSON.parse(" + asStringLiteral + ")" + html.slice(objEnd);

await rm(TMP, { recursive: true, force: true });
for (const [name, body] of Object.entries({ literal: html, jsonParse: variantJson })) {
  const dir = join(TMP, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), body);
  await cp("web/icons", join(dir, "icons"), { recursive: true });
  await cp("web/assets", join(dir, "assets"), { recursive: true });
  await cp("web/manifest.webmanifest", join(dir, "manifest.webmanifest"));
  console.log(`  variant ${name.padEnd(10)} ${(Buffer.byteLength(body) / 1048576).toFixed(2)} MB`);
}

const { server, url } = await serve(TMP);
const browser = await chromium.launch();

async function measure(variant, rate) {
  const samples = [];
  for (let n = 0; n < RUNS; n++) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    if (rate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await page.goto(url + variant + "/index.html", { waitUntil: "load" });
    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return { dcl: Math.round(nav.domContentLoadedEventEnd || 0),
               fcp: Math.round(fcp ? fcp.startTime : 0),
               seedOk: !!(window.GUIDON_SEED && window.G && window.G.routes) };
    });
    samples.push(t);
    await ctx.close();
  }
  const med = (k) => { const v = samples.map(s => s[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  return { dcl: med("dcl"), fcp: med("fcp"), ok: samples.every(s => s.seedOk) };
}

console.log(`\n  median of ${RUNS} cold loads, 412x915\n`);
console.log("  throttle  variant      FCP      DCL   booted");
for (const rate of THROTTLE) {
  const a = await measure("literal", rate);
  const b = await measure("jsonParse", rate);
  console.log(`  ${String(rate + "x").padEnd(9)} literal   ${String(a.fcp).padStart(5)}ms ${String(a.dcl).padStart(6)}ms   ${a.ok}`);
  console.log(`  ${String("").padEnd(9)} jsonParse ${String(b.fcp).padStart(5)}ms ${String(b.dcl).padStart(6)}ms   ${b.ok}`);
  const delta = a.dcl - b.dcl;
  const pct = a.dcl ? Math.round((delta / a.dcl) * 100) : 0;
  console.log(`  ${String("").padEnd(9)} => JSON.parse ${delta >= 0 ? "saves" : "COSTS"} ${Math.abs(delta)}ms DCL (${pct}%)\n`);
}

await browser.close();
server.close();
await rm(TMP, { recursive: true, force: true });
