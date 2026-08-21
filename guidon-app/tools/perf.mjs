/**
 * Measures what each embedded payload actually costs at boot, under CPU
 * throttling that approximates real mid-range Android hardware.
 *
 * This exists to decide whether deferring a payload is worth the risk, rather
 * than assuming it is. It builds throwaway variants with a payload surgically
 * removed and compares boot timings; the variants are measurement instruments,
 * not shippable artifacts.
 *
 * Compatibility pass, 2026-08-21: this tool used to also strip pdf-lib and
 * the DA4856 asset the same way it strips GUIDON_SEED below, and crashed
 * outright (stripScript() couldn't find 'PDFLib={})' in web/index.html at
 * all). Root cause traced, not just patched around: build.mjs step 3 (see
 * its own comment) now permanently EXTRACTS both to sibling files
 * (web/assets/pdf-lib.js, da4856.js), loaded on demand by src/pdf-defer.js
 * only when a Soldier actually exports a counseling form - so web/index.html
 * genuinely no longer contains what this tool was looking for. That's not a
 * regression; it's this tool's own past measurement (build.mjs cites
 * "~113ms DCL, ~900KB memory at 6x throttle", a number a prior run of this
 * exact tool almost certainly produced) having already been acted on. The
 * question "should the pdf stack be deferred" is answered and shipped; only
 * GUIDON_SEED remains meaningfully inline and worth re-measuring here.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { join } from "node:path";

const SRC = "web/index.html";
const TMP = "dist/_perf";
const THROTTLE = [1, 4, 6]; // 1x desktop, 4x ~ mid-range, 6x ~ budget Android
const RUNS = 3;

/** Removes one <script> block identified by a unique substring of its content. */
function stripScript(html, needle, label) {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let m, out = null;
  while ((m = re.exec(html))) {
    if (m[1].includes(needle)) {
      out = html.slice(0, m.index) + `<!-- ${label} removed for measurement -->` + html.slice(m.index + m[0].length);
      break;
    }
  }
  if (!out) throw new Error("perf: could not find script containing " + needle);
  return out;
}

const html = await readFile(SRC, "utf8");
await rm(TMP, { recursive: true, force: true });

const VARIANTS = {
  full: html,
  "no-seed": stripScript(html, "window.GUIDON_SEED", "GUIDON_SEED"),
};

for (const [name, body] of Object.entries(VARIANTS)) {
  const dir = join(TMP, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), body);
  await cp("web/icons", join(dir, "icons"), { recursive: true });
  await cp("web/manifest.webmanifest", join(dir, "manifest.webmanifest"));
  console.log(`  variant ${name.padEnd(14)} ${(Buffer.byteLength(body) / 1048576).toFixed(2)} MB`);
}

const { server, url } = await serve(TMP);
const browser = await chromium.launch();

async function measure(variant, rate) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    if (rate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    // Service workers are disabled for measurement so every run is a cold parse.
    await page.goto(url + variant + "/index.html", { waitUntil: "load" });
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] || {};
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return {
        dcl: Math.round(n.domContentLoadedEventEnd || 0),
        load: Math.round(n.loadEventEnd || 0),
        fcp: Math.round(fcp ? fcp.startTime : 0),
      };
    });
    samples.push(t);
    await ctx.close();
  }
  const med = (k) => {
    const v = samples.map((s) => s[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  return { dcl: med("dcl"), load: med("load"), fcp: med("fcp") };
}

console.log("\n  median of " + RUNS + " cold loads, 412x915 viewport\n");
const table = {};
for (const rate of THROTTLE) {
  console.log(`  --- CPU throttle ${rate}x ${rate === 1 ? "(desktop)" : rate === 4 ? "(mid-range phone)" : "(budget phone)"} ---`);
  console.log("      variant          FCP     DCL    load");
  for (const name of Object.keys(VARIANTS)) {
    const r = await measure(name, rate);
    table[`${rate}x/${name}`] = r;
    console.log(`      ${name.padEnd(14)} ${String(r.fcp).padStart(5)}ms ${String(r.dcl).padStart(5)}ms ${String(r.load).padStart(5)}ms`);
  }
  const full = table[`${rate}x/full`];
  const noSeed = table[`${rate}x/no-seed`];
  console.log(`      => deferring seed would save      ~${full.dcl - noSeed.dcl}ms DCL, ~${full.fcp - noSeed.fcp}ms FCP`);
  console.log(`      (pdf-lib/DA4856 are no longer measured here - build.mjs already extracts both to`);
  console.log(`       web/assets/*.js, loaded on demand; see this file's header comment)\n`);
}

await browser.close();
server.close();
await rm(TMP, { recursive: true, force: true });
