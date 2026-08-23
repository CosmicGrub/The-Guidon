/**
 * Regression test for wiring assertUnsigned() into generateFillable() as an
 * active gate.
 *
 * assertUnsigned() was defined and exported on G.pdf456 ("defense in depth"
 * against a signed field leaking onto a generated fillable PDF) but
 * generateFillable() never called it — fill() then download() ran straight
 * through regardless of what assertUnsigned() would have said. This proves
 * three things with a real PDF, not a mock:
 *   1. assertUnsigned() itself correctly tells clean from tampered templates
 *      (a template missing one of the four SIG fields — the shape a real
 *      digital signature leaves after flattening — must read as "not
 *      unsigned"; the untouched original must still read as "unsigned").
 *   2. fill() alone (what generateFillable() used to call, unguarded) does
 *      NOT block a tampered template — nor does a same-shape "old"
 *      generateFillable() built from only the public API (fill + download,
 *      no assertUnsigned check) — i.e. this exact input WOULD have silently
 *      passed before the fix.
 *   3. The real, current G.pdf456.generateFillable() now throws on that same
 *      tampered template instead of downloading it, while still succeeding
 *      normally on the real, untouched one.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(600);

const VALS = {
  name: "Rivera, John A.", rank: "SPC", date: "2026-07-26",
  org: "A Co, 1-8 IN", title: "SSG Diaz / Squad Leader",
  purpose: "Initial counseling", keyPoints: "Standards and expectations",
  plan: "Weekly follow-up", leader: "Provide resources and feedback",
};

// Build a tampered ("signed-shaped") template: a real pdf-lib AcroForm that
// is missing one of the four SIG field names — the shape a real digital
// signature leaves behind (signing tools typically consume/flatten the
// interactive field once the cryptographic signature is embedded). Built
// from scratch with PDFDocument.create()/createTextField() rather than by
// mutating the actual DA 4856 template's real /Sig-typed field, because the
// vendored pdf-lib's own removeField() throws on that field (it tries to
// look up a normal AcroForm text-field appearance stream that a true /Sig
// field never has — exactly the "pdf-lib can't set /Sig text" constraint
// assertUnsigned()'s own comment already documents). A from-scratch AcroForm
// with a subset of the real SIG names is still a real PDF exercising the
// exact same doc.getForm().getFields() name list assertUnsigned() reads;
// only its origin differs. Also probes assertUnsigned() directly on both the
// clean and tampered bytes, and reconstructs the pre-fix (unguarded)
// generateFillable() shape purely from public G.pdf456/G.util entry points,
// so nothing here depends on this module's private closures.
const setup = await page.evaluate(async (vals) => {
  await window.G.pdfAssets.ensure();
  const L = window.PDFLib || window.pdfLib;
  function b64ToBytes(b64) {
    const bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function bytesToB64(bytes) {
    let bin = ""; const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(bin);
  }
  const origB64 = window.GUIDON_DA4856_B64;
  const SIG = window.G.pdf456.SIG;

  async function buildDoc(names) {
    const doc = await L.PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const form = doc.getForm();
    names.forEach((n, i) => {
      form.createTextField(n).addToPage(page, { x: 10, y: 10 + i * 20, width: 120, height: 15 });
    });
    return bytesToB64(await doc.save());
  }
  const cleanConstructedB64 = await buildDoc(SIG); // all 4 SIG fields present
  const tamperedB64 = await buildDoc(SIG.slice(1)); // missing SIG[0]

  const cleanVerdict = await window.G.pdf456.assertUnsigned(b64ToBytes(origB64));
  const cleanConstructedVerdict = await window.G.pdf456.assertUnsigned(b64ToBytes(cleanConstructedB64));
  const tamperedVerdict = await window.G.pdf456.assertUnsigned(b64ToBytes(tamperedB64));

  // The exact pre-fix generateFillable() shape (fill() then download(), no
  // assertUnsigned gate) — rebuilt from public API only, since fill()/
  // download() themselves are private to the pdf456.js closure.
  async function oldGenerateFillable(v) {
    const bytes = await window.G.pdf456.fill(v || {});
    bytes.saved = await window.G.util.downloadBinary(
      window.G.pdf456.makeName(v || {}, "fillable"), bytes, "application/pdf");
    return bytes;
  }

  window.GUIDON_DA4856_B64 = tamperedB64;
  let fillOnTamperedOk = false, fillThenAssert = null;
  try {
    const b = await window.G.pdf456.fill(vals);
    fillOnTamperedOk = true;
    fillThenAssert = await window.G.pdf456.assertUnsigned(b);
  } catch (e) { fillOnTamperedOk = "threw: " + (e && e.message); }

  let oldPassed = false, oldError = null;
  try {
    const r = await oldGenerateFillable(vals);
    oldPassed = !!(r && r.saved);
  } catch (e) { oldError = String(e && e.message || e); }

  let newBlocked = false, newError = null;
  try {
    await window.G.pdf456.generateFillable(vals);
  } catch (e) { newBlocked = true; newError = String(e && e.message || e); }

  // Restore the real template and confirm the gate does not false-positive
  // block a legitimate export.
  window.GUIDON_DA4856_B64 = origB64;
  let happyPath = null;
  try {
    const r = await window.G.pdf456.generateFillable(vals);
    happyPath = { saved: !!(r && r.saved), failedFields: (r && r.failedFields) || [] };
  } catch (e) { happyPath = { error: String(e && e.message || e) }; }

  return {
    cleanConstructedB64Len: cleanConstructedB64.length, tamperedB64Len: tamperedB64.length,
    cleanVerdict, cleanConstructedVerdict, tamperedVerdict,
    fillOnTamperedOk, fillThenAssert,
    oldPassed, oldError,
    newBlocked, newError,
    happyPath,
  };
}, VALS);

setup.tamperedB64Len < setup.cleanConstructedB64Len
  ? ok(`the tampered (3-of-4 SIG fields) template is smaller than the constructed 4-of-4 one (${setup.cleanConstructedB64Len} -> ${setup.tamperedB64Len} b64 chars)`)
  : bad(`tampered template is not smaller than the 4-of-4 one (${setup.cleanConstructedB64Len} vs ${setup.tamperedB64Len}) — the built fixture may be wrong`);

setup.cleanVerdict === true
  ? ok("assertUnsigned() reports true on the real, untouched DA 4856 template")
  : bad("assertUnsigned() should be true on the clean template, got " + setup.cleanVerdict);

setup.cleanConstructedVerdict === true
  ? ok("assertUnsigned() reports true on a from-scratch AcroForm carrying all 4 SIG field names")
  : bad("assertUnsigned() should be true on the 4-of-4 constructed template, got " + setup.cleanConstructedVerdict);

setup.tamperedVerdict === false
  ? ok("assertUnsigned() reports false on a template missing a SIG field (the 'signed/flattened' shape)")
  : bad("assertUnsigned() should be false on the tampered template, got " + setup.tamperedVerdict);

setup.fillOnTamperedOk === true
  ? ok("fill() itself does not block a tampered template (confirms the gate has to live in generateFillable(), not fill())")
  : bad("fill() on the tampered template behaved unexpectedly: " + JSON.stringify(setup.fillOnTamperedOk));

setup.fillThenAssert === false
  ? ok("assertUnsigned() still says false after fill() has run over the tampered template")
  : bad("assertUnsigned() after fill() should still be false, got " + setup.fillThenAssert);

setup.oldPassed === true
  ? ok("REGRESSION PROOF: the pre-fix generateFillable() shape (fill()+download(), no assertUnsigned check) DOES silently save the tampered PDF")
  : bad("expected the unguarded old-shape generateFillable() to succeed (proving the prior gap was real); got oldPassed=" + setup.oldPassed + " oldError=" + setup.oldError);

setup.newBlocked === true && /signature field check failed/i.test(setup.newError || "")
  ? ok(`FIX PROOF: the real, current generateFillable() now throws on the same tampered template ("${setup.newError}")`)
  : bad("expected current generateFillable() to throw a signature-check error on the tampered template; newBlocked=" + setup.newBlocked + " newError=" + setup.newError);

setup.happyPath && setup.happyPath.saved === true && setup.happyPath.failedFields.length === 0
  ? ok("generateFillable() still succeeds normally on the real, untouched template (no false-positive block)")
  : bad("generateFillable() on the real template should succeed cleanly, got " + JSON.stringify(setup.happyPath));

const KNOWN = [/Removing XFA form data as pdf-lib does not support/];
const unexpected = noise.filter((n) => !KNOWN.some((k) => k.test(n)));
unexpected.length === 0
  ? ok(`no unexpected console output (${noise.length} known pdf-lib XFA notice${noise.length === 1 ? "" : "s"} allowed)`)
  : bad(unexpected.length + " unexpected console msgs; first: " + unexpected[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `PDF SIGNATURE GUARD TEST: ${fails} FAILURE(S)` : "PDF SIGNATURE GUARD TEST: all passed"));
process.exit(fails ? 1 : 0);
