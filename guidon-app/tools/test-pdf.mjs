/**
 * Functional test for the deferred DA 4856 PDF stack.
 *
 * Deferring a payload is only safe if the feature it powers still works, so
 * this generates a real PDF and inspects the bytes rather than checking that a
 * button exists.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(600);

// 1. The heavy globals must NOT be resident at boot - that is the whole point.
const atBoot = await page.evaluate(() => ({
  pdflib: !!(window.PDFLib || window.pdfLib),
  b64: !!window.GUIDON_DA4856_B64,
  shimPresent: !!(window.G && window.G.pdfAssets),
  available: window.G && window.G.pdf456 ? window.G.pdf456.available() : null,
}));
!atBoot.pdflib ? ok("pdf-lib NOT parsed at boot (deferred)") : bad("pdf-lib was parsed at boot - deferral not working");
!atBoot.b64 ? ok("DA4856 asset NOT parsed at boot (deferred)") : bad("DA4856 parsed at boot");
atBoot.shimPresent ? ok("G.pdfAssets shim present") : bad("G.pdfAssets missing");
atBoot.available === true ? ok("G.pdf456.available() still reports true (UI gate intact)") : bad("available() = " + atBoot.available + " - the export UI would be hidden");

// 2. On-demand load resolves and populates the globals.
const afterEnsure = await page.evaluate(async () => {
  const t = performance.now();
  await window.G.pdfAssets.ensure();
  return {
    ms: Math.round(performance.now() - t),
    pdflib: !!(window.PDFLib || window.pdfLib),
    // The asset file carries TWO forms: the original and the Mar-2023 revision.
    // Both must survive extraction.
    b64len: (window.GUIDON_DA4856_B64 || "").length,
    mar2023len: (window.GUIDON_DA4856_MAR2023_B64 || "").length,
  };
});
afterEnsure.pdflib ? ok(`ensure() loaded pdf-lib in ${afterEnsure.ms}ms`) : bad("ensure() did not provide PDFLib");
afterEnsure.b64len > 50000 ? ok(`DA4856 base64 resident (${afterEnsure.b64len.toLocaleString()} chars)`) : bad("DA4856 asset short/missing: " + afterEnsure.b64len);
afterEnsure.mar2023len > 50000 ? ok(`DA4856 Mar-2023 revision resident (${afterEnsure.mar2023len.toLocaleString()} chars)`) : bad("Mar-2023 form missing: " + afterEnsure.mar2023len);

// 3. Generate an actual PDF through the public API and inspect the bytes.
const gen = await page.evaluate(async () => {
  try {
    const bytes = await window.G.pdf456.fill({
      name: "Rivera, John A.", rank: "SPC", date: "2026-07-26",
      org: "A Co, 1-8 IN", title: "SSG Diaz / Squad Leader",
      purpose: "Initial counseling", keyPoints: "Standards and expectations",
      plan: "Weekly follow-up", leader: "Provide resources and feedback",
    });
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return { len: u8.length, head: String.fromCharCode(...u8.slice(0, 5)),
             tail: String.fromCharCode(...u8.slice(-8)) };
  } catch (e) { return { error: String(e && e.message || e) }; }
});
if (gen.error) bad("fill() threw: " + gen.error);
else {
  gen.head === "%PDF-" ? ok(`generated a real PDF (${gen.len.toLocaleString()} bytes, header %PDF-)`)
                       : bad("output is not a PDF, header=" + JSON.stringify(gen.head));
  gen.len > 20000 ? ok("PDF size is plausible for the DA 4856 form") : bad("PDF suspiciously small: " + gen.len);
  /%%EOF/.test(gen.tail) ? ok("PDF terminates with %%EOF") : bad("no %%EOF trailer, got " + JSON.stringify(gen.tail));
}

// 4. A second call must reuse the loaded stack, not re-inject scripts.
const second = await page.evaluate(async () => {
  await window.G.pdfAssets.ensure();
  return document.querySelectorAll('script[data-guidon-asset]').length;
});
second === 2 ? ok("repeat ensure() did not duplicate script tags") : bad("expected 2 asset scripts, found " + second);

// 5. Offline: the precached assets must still satisfy an export with no network.
await page.waitForTimeout(2500); // let the SW finish precaching
const offCtx = await browser.newContext();
const offPage = await offCtx.newPage();
await offPage.goto(url, { waitUntil: "load" });
await offPage.waitForTimeout(3000);
await offCtx.setOffline(true);
await offPage.reload({ waitUntil: "load" }).catch(() => {});
await offPage.waitForTimeout(500);
const offline = await offPage.evaluate(async () => {
  try {
    await window.G.pdfAssets.ensure();
    const b = await window.G.pdf456.fill({ name: "Offline, Test", rank: "SGT" });
    const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
    return { ok: true, len: u8.length, head: String.fromCharCode(...u8.slice(0, 5)) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
offline.ok && offline.head === "%PDF-"
  ? ok(`OFFLINE DA 4856 export works (${offline.len.toLocaleString()} bytes) - precache holds`)
  : bad("offline export failed: " + (offline.error || JSON.stringify(offline)));
await offCtx.close();

/* Known, pre-existing, and verified against the UNMODIFIED build: vendored
   pdf-lib logs this whenever it loads the real DA 4856, which is an XFA/AcroForm
   hybrid. The original build emits the identical warning and produces an
   equally valid PDF, so it is not a regression from deferral. Everything else
   must still be silent. */
const KNOWN = [/Removing XFA form data as pdf-lib does not support/];
const unexpected = noise.filter((n) => !KNOWN.some((k) => k.test(n)));
unexpected.length === 0
  ? ok(`no unexpected console output (${noise.length} known pdf-lib XFA notice${noise.length === 1 ? "" : "s"} allowed)`)
  : bad(unexpected.length + " unexpected console msgs; first: " + unexpected[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `PDF TEST: ${fails} FAILURE(S)` : "PDF TEST: all passed"));
process.exit(fails ? 1 : 0);
