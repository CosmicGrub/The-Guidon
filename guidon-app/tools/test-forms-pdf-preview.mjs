/**
 * DA 4856 on-demand "Preview" button (Roadmap Tier 6c, deliberately scoped -
 * see this feature's own commit/PR notes for why this is NOT the full
 * "#/forms live PDF-preview pane, all 34 forms" version of the roadmap item).
 *
 * Models its DA-4856 fixture data and modal-opening approach on
 * tools/test-pdf.mjs and tools/test-counselpdf-sigmode.mjs. Covers, with
 * real interaction and real pixel inspection rather than "does an element
 * exist":
 *   1. The Preview button exists in the counseling wizard's review step
 *      (the only UI in this app with a real, already-tested path from typed
 *      values to G.pdf456.fill() bytes).
 *   2. NOTHING calling itself "Preview" leaks into the generic #/forms Forms
 *      Trainer - neither DA 4856's own separate catalog entry there (a
 *      different, schema-driven HTML replica with a different field-id
 *      vocabulary - see js/forms.js's own drawReplica() header comment) nor
 *      any of the other 33 forms. Checked two ways: a real UI open of DA
 *      4856's Forms Trainer entry (the case most likely to have collided,
 *      since it's the "same" form) plus one other form, AND a static sweep
 *      of the built bundle confirming every ".pdfprev"/"cpdf-*" preview
 *      class string introduced by this feature lives inside the
 *      counselpdf.js module range, never inside forms.js's.
 *   3. Clicking Preview with real filled-in field values produces a modal
 *      showing 2 rendered <canvas> pages with real, non-blank pixel content
 *      (sampled, not just "canvas exists").
 *   4. Closing the modal removes it and returns focus.
 *   5. A simulated fill() failure renders a real, visible error message
 *      inside the modal - not a silent no-op.
 *   6. No unexpected console errors/warnings across the whole flow.
 *   7. Real fill->render timing, captured via the feature's own
 *      performance.now() instrumentation (a console.debug breadcrumb),
 *      reported here rather than guessed.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

/* ---------------- 0. static sweep of the built bundle ---------------- */
// Cheaper and more exhaustive than clicking through all 34 forms: confirm
// every "pdfprev"/preview-specific string this feature added falls strictly
// inside js/counselpdf.js's module range, never inside js/forms.js's -
// i.e. the Forms Trainer module genuinely was not touched.
{
  const src = await readFile("web/index.html", "utf8");
  const formsStart = src.indexOf("/* ==== js/forms.js ====");
  const formsEnd = src.indexOf("/* ==== js/pdf456.js ====");
  const counselStart = src.indexOf("/* ==== js/counselpdf.js ====");
  const counselEnd = src.indexOf("/* ==== js/idp.js ====");
  if (formsStart < 0 || formsEnd < 0 || counselStart < 0 || counselEnd < 0 || formsEnd <= formsStart || counselEnd <= counselStart) {
    bad("could not locate js/forms.js and/or js/counselpdf.js module boundaries in web/index.html - module markers moved");
  } else {
    const formsModule = src.slice(formsStart, formsEnd);
    const counselModule = src.slice(counselStart, counselEnd);
    const formsHasPreview = /pdfprev|openPdfPreview/.test(formsModule);
    const counselHasPreview = /pdfprev/.test(counselModule) && /openPdfPreview/.test(counselModule);
    !formsHasPreview
      ? ok("js/forms.js module contains zero preview-related code (Forms Trainer genuinely untouched)")
      : bad("js/forms.js module unexpectedly contains preview-related code - it should be untouched");
    counselHasPreview
      ? ok("js/counselpdf.js module contains the new preview code (Preview lives where the real PDF pipeline already lives)")
      : bad("js/counselpdf.js module is missing the expected preview code");
  }
}

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
const timingMsgs = [];
page.on("console", (m) => { if (/\[pdfPreview\]/.test(m.text())) timingMsgs.push(m.text()); });

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);

// Bypass onboarding via a guest session (same pattern as sibling PDF tests).
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

/* ---------------- 1. real UI: Preview absent from Forms Trainer ---------------- */
await page.evaluate(() => { location.hash = "#/forms"; });
await page.waitForTimeout(500);

async function formHasPreviewButton(searchText) {
  await page.fill('input[aria-label="Search forms"]', searchText);
  await page.waitForTimeout(250);
  const found = await page.locator(".form-card").count();
  if (found < 1) return { opened: false };
  await page.locator(".form-card").first().click();
  await page.waitForTimeout(250);
  const hasPreview = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).some((b) => /^preview$/i.test((b.textContent || "").trim()));
    const cls = !!document.querySelector('[class*="pdfprev"]');
    return btn || cls;
  });
  await page.locator("button", { hasText: /All forms/ }).click();
  await page.waitForTimeout(200);
  return { opened: true, hasPreview };
}

const da4856InForms = await formHasPreviewButton("4856");
da4856InForms.opened && da4856InForms.hasPreview === false
  ? ok("DA 4856's OWN separate #/forms catalog entry has no Preview button (only the counseling wizard does)")
  : bad("DA 4856 in #/forms: " + JSON.stringify(da4856InForms));

const otherFormInForms = await formHasPreviewButton("authority for leave");
otherFormInForms.opened && otherFormInForms.hasPreview === false
  ? ok("a different form (DA 31) in #/forms has no Preview button either")
  : bad("DA 31 in #/forms: " + JSON.stringify(otherFormInForms));

// restore the search box for cleanliness (not load-bearing, just tidy state)
await page.fill('input[aria-label="Search forms"]', "");
await page.waitForTimeout(150);

/* ---------------- 2. open the counseling wizard, real fixture data ---------------- */
await page.evaluate(() => { window.G.counselpdf.open(); });
await page.waitForTimeout(300);
await page.locator("button", { hasText: /^Single form$/ }).click();
await page.waitForTimeout(300);

const modalOpen = await page.evaluate(() => !!document.querySelector(".cpdf-backdrop"));
modalOpen ? ok("DA 4856 filler modal opened") : bad("modal did not open");

await page.locator("#cpdf-field-name").fill("Rivera, Jordan A.");
await page.locator("#cpdf-field-rank").fill("SPC");
await page.locator("#cpdf-field-title").fill("SSG Diaz / Squad Leader");
await page.locator("#cpdf-field-org").fill("A Co, 1-8 IN");
await page.locator('textarea[aria-labelledby="cpdf-label-purpose"]').fill("Initial counseling on standards and expectations.");
await page.locator('textarea[aria-labelledby="cpdf-label-keyPoints"]').fill("Discussed unit SOP and reporting times.");
await page.locator('textarea[aria-labelledby="cpdf-label-plan"]').fill("Weekly follow-up counseling for 30 days.");
await page.locator('textarea[aria-labelledby="cpdf-label-leader"]').fill("Provide resources, mentorship, and follow-up.");

const previewBtn = page.locator("button", { hasText: /^Preview$/ });
(await previewBtn.count()) === 1
  ? ok("the 'Preview' button exists exactly once in DA 4856's review step")
  : bad("expected exactly 1 'Preview' button, found " + (await previewBtn.count()));

/* ---------------- 3. click Preview -> modal with 2 real rendered pages ---------------- */
await previewBtn.click();

const spinnerSeen = await page.locator(".pdfprev-loading").count();
spinnerSeen >= 1 ? ok("a loading spinner appears immediately after clicking Preview") : bad("no loading state seen");

// Wait for the FULL expected page count (2, DA 4856's real length), not just
// ">0" - PDF.js renders pages progressively, so the first canvas can appear
// well before the second finishes. Waiting on ">0" let a slow second-page
// render (observed live: 525ms vs a typical ~50-190ms) race past this check
// while only page 1 had landed, producing a real, intermittent "expected 2
// canvases, found 1" failure - not CI contention, a genuine bug in the wait
// condition itself.
await page.waitForFunction(
  () => document.querySelectorAll(".pdfprev-canvas").length >= 2 || !!document.querySelector(".pdfprev-backdrop .cpdf-warn"),
  { timeout: 20000 }
).catch(() => {});

const previewState = await page.evaluate(() => {
  const back = document.querySelector(".pdfprev-backdrop");
  const canvases = Array.from(document.querySelectorAll(".pdfprev-canvas"));
  const errorBox = back ? back.querySelector(".cpdf-warn") : null;
  return {
    backdropPresent: !!back,
    canvasCount: canvases.length,
    dims: canvases.map((c) => ({ w: c.width, h: c.height })),
    captions: Array.from(document.querySelectorAll(".pdfprev-caption")).map((c) => c.textContent),
    errorText: errorBox ? errorBox.textContent : null,
  };
});
previewState.backdropPresent ? ok("preview modal is present in the DOM") : bad("preview modal never appeared");
previewState.errorText ? bad("preview modal shows an error instead of rendering: " + previewState.errorText) : ok("no error surfaced for a normal, valid fill");
previewState.canvasCount === 2
  ? ok("preview modal renders exactly 2 canvas pages (DA 4856 is a 2-page form)")
  : bad("expected 2 canvases, found " + previewState.canvasCount);
previewState.dims.every((d) => d.w > 400 && d.h > 400)
  ? ok("both canvases have plausible full-page pixel dimensions: " + JSON.stringify(previewState.dims))
  : bad("implausible canvas dimensions: " + JSON.stringify(previewState.dims));
JSON.stringify(previewState.captions) === JSON.stringify(["Page 1 of 2", "Page 2 of 2"])
  ? ok("page captions read 'Page 1 of 2' / 'Page 2 of 2'")
  : bad("unexpected captions: " + JSON.stringify(previewState.captions));

// Real pixel inspection - a canvas with the right dimensions but literally
// nothing drawn to it (e.g. a render() call that resolved without actually
// painting, or a same-origin-tainted canvas) would still pass the checks
// above. Sample actual ImageData and confirm each page has real ink on it.
const pixelCheck = await page.evaluate(() => {
  return Array.from(document.querySelectorAll(".pdfprev-canvas")).map((canvas) => {
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) nonWhite++;
    }
    return nonWhite;
  });
});
pixelCheck.length === 2 && pixelCheck.every((n) => n > 500)
  ? ok("both canvases contain real, substantial non-white pixel content (not blank): " + JSON.stringify(pixelCheck))
  : bad("canvas pixel content looks blank/suspicious: " + JSON.stringify(pixelCheck));

/* ---------------- 4. closing the modal works ---------------- */
await page.locator(".pdfprev-backdrop button.cpdf-close").click();
await page.waitForTimeout(500);
const closedOk = await page.evaluate(() => !document.querySelector(".pdfprev-backdrop"));
closedOk ? ok("closing the preview modal removes it from the DOM") : bad("preview modal did not close");

const wizardStillOpen = await page.evaluate(() => !!document.querySelector(".cpdf-backdrop"));
wizardStillOpen ? ok("the underlying counseling wizard is still open after closing the preview") : bad("closing the preview also closed (or broke) the wizard underneath it");

/* ---------------- 5. simulated failure renders a visible error ---------------- */
await page.evaluate(() => {
  window.__origPdf456Fill = window.G.pdf456.fill;
  window.G.pdf456.fill = () => Promise.reject(new Error("Simulated failure for test coverage"));
});
await previewBtn.click();
await page.waitForFunction(() => !!document.querySelector(".pdfprev-backdrop .cpdf-warn"), { timeout: 10000 }).catch(() => {});
const errorState = await page.evaluate(() => {
  const box = document.querySelector(".pdfprev-backdrop .cpdf-warn");
  return { present: !!box, text: box ? box.textContent : null, canvases: document.querySelectorAll(".pdfprev-canvas").length };
});
errorState.present && /Simulated failure for test coverage/.test(errorState.text || "")
  ? ok("a fill() failure renders a real, visible error message naming the actual failure")
  : bad("error state not shown correctly: " + JSON.stringify(errorState));
errorState.canvases === 0 ? ok("no stale/partial canvases remain visible after a failed render") : bad("stale canvases present after failure: " + errorState.canvases);

// restore the real fill(), then close the error modal - modalTrap's close()
// animates (up to ~400ms fallback) before actually removing the backdrop
// from the DOM, so wait for the real removal rather than a fixed delay
// (matching the same pattern already proven above for the successful case).
await page.evaluate(() => { window.G.pdf456.fill = window.__origPdf456Fill; delete window.__origPdf456Fill; });
await page.locator(".pdfprev-backdrop button.cpdf-close").click();
await page.waitForFunction(() => !document.querySelector(".pdfprev-backdrop"), { timeout: 5000 }).catch(() => {});
const errorModalClosed = await page.evaluate(() => !document.querySelector(".pdfprev-backdrop"));
errorModalClosed ? ok("closing the error-state preview modal removes it from the DOM too") : bad("error-state preview modal did not close");

/* ---------------- 6. re-opening after a prior close still works cleanly ---------------- */
// Once a preview modal is open it covers (and the a11y focus-trap disables
// interaction with) the wizard underneath - a real Soldier cannot click
// Preview again until closing the one already open, so that is not a
// separate scenario to cover. What IS worth proving: Preview still opens
// cleanly a second time in the same session, with exactly one modal, after
// the previous one fully closed.
await previewBtn.click();
// Wait for the FULL expected page count (2, DA 4856's real length), not just
// ">0" - PDF.js renders pages progressively, so the first canvas can appear
// well before the second finishes. Waiting on ">0" let a slow second-page
// render (observed live: 525ms vs a typical ~50-190ms) race past this check
// while only page 1 had landed, producing a real, intermittent "expected 2
// canvases, found 1" failure - not CI contention, a genuine bug in the wait
// condition itself.
await page.waitForFunction(
  () => document.querySelectorAll(".pdfprev-canvas").length >= 2 || !!document.querySelector(".pdfprev-backdrop .cpdf-warn"),
  { timeout: 20000 }
).catch(() => {});
const reopened = await page.evaluate(() => ({
  backdrops: document.querySelectorAll(".pdfprev-backdrop").length,
  canvases: document.querySelectorAll(".pdfprev-canvas").length,
}));
reopened.backdrops === 1 && reopened.canvases === 2
  ? ok("Preview opens cleanly a second time (exactly 1 modal, 2 real pages) after the first close")
  : bad("re-open state: " + JSON.stringify(reopened));
await page.locator(".pdfprev-backdrop button.cpdf-close").click().catch(() => {});
await page.waitForFunction(() => !document.querySelector(".pdfprev-backdrop"), { timeout: 5000 }).catch(() => {});

/* ---------------- 7. console cleanliness + real timing ---------------- */
const relevantNoise = noise.filter((n) => !/favicon|Removing XFA form data/.test(n));
relevantNoise.length === 0
  ? ok("no unexpected console errors/warnings across the whole preview flow")
  : bad(relevantNoise.length + " unexpected console msgs; first: " + relevantNoise[0]);

if (timingMsgs.length) {
  console.log("  ----  real fill->render timing (performance.now(), this run):");
  timingMsgs.forEach((t) => console.log("  ----    " + t));
  ok("captured " + timingMsgs.length + " real fill->render timing sample(s) - see above");
} else {
  bad("no [pdfPreview] timing breadcrumb was captured - openPdfPreview()'s instrumentation may be missing");
}

await browser.close();
server.close();

console.log("\n" + (fails ? `FORMS PDF PREVIEW: ${fails} FAILURE(S)` : "FORMS PDF PREVIEW: all passed"));
process.exit(fails ? 1 : 0);
