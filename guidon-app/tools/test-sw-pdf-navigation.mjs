/**
 * A real service worker must not answer a PDF navigation with the app's own page
 *
 * WHY THIS SUITE EXISTS: on the hosted PWA (the iPhone path) the service worker
 * answered EVERY navigation with the cached index.html. The Reference Library's
 * "Original PDF" view is an <iframe src="docs/*.pdf"> - a navigation - so a
 * Soldier who tapped it got GUIDON itself, nested inside GUIDON, where the
 * regulation should have been (and the "Open in a new tab" link showed the app
 * too). Nothing caught it: test-library.mjs only reads the iframe's src
 * attribute, and in CI the docs folder is stripped from the shared artifact so
 * that branch never even runs.
 *
 * So this suite serves a copy of the real web/ build with ONE tiny PDF added in
 * place of the 119 MB of real ones, waits for the real service worker to take
 * control of the page (a page with no worker in charge proves nothing), and
 * asserts what a Soldier would get:
 *   - the answer the worker hands the Original PDF frame (and the "Open in a
 *     new tab" link) IS the PDF - checked on the response the page received
 *     from the worker, not on how a given browser chooses to draw a PDF: the
 *     headless browser CI uses has no PDF viewer at all, so a real PDF and an
 *     empty frame look alike there, while the content type does not lie;
 *   - the frame does not hold a second copy of the app;
 *   - the PDF is saved on the first open, so it opens again with no signal;
 *   - the app's own address still opens instantly and offline, including the
 *     "?source=pwa" form an installed icon uses (the honest path must not break);
 *   - any OTHER page that is not saved gets a plain sentence, not a nested app;
 *   - a ranged request (a PDF viewer or a video asking for a slice) is answered 206 with just
 *     the slice, and that slice is NOT saved as if it were the whole file;
 *   - the worker's save rule, run directly against stand-in answers: only a whole, plain 200
 *     is kept (a browser's own cache refuses a 206 anyway, so the real-worker case above cannot
 *     tell the rule is there - an answer such as 203 or 204, which a browser WOULD keep, can).
 */
import { mkdtempSync, cpSync, writeFileSync, mkdirSync, rmSync, readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp, check, finish, waitForBoot, waitForRoute, clickWhenStable, until, untilAsync, expectNoConsoleNoise } from "./testkit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..", "web");

// ---- an overlay of the real build: everything but docs/, plus one tiny PDF ----
const overlay = mkdtempSync(path.join(os.tmpdir(), "guidon-swpdf-"));
for (const name of readdirSync(WEB)) {
  if (name === "docs") continue;
  cpSync(path.join(WEB, name), path.join(overlay, name), { recursive: true });
}
mkdirSync(path.join(overlay, "docs"));
const PDF_PATH = "docs/ADP_6-0_Mission_Command.pdf"; // DOCS[0], the file the Library's own probe looks for
const MINI_PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
writeFileSync(path.join(overlay, PDF_PATH), MINI_PDF);
// A larger file nobody opens, only asked for in slices (500 bytes: slice 0-99 is a real partial answer).
const RANGE_PATH = "docs/RANGE_TEST.pdf";
writeFileSync(path.join(overlay, RANGE_PATH), MINI_PDF + "%" + "x".repeat(500 - MINI_PDF.length - 1));

try {
  const boot = await bootApp({ dir: overlay, viewport: { width: 390, height: 844 } });
  const { page, context, noise } = boot;
  const base = page.url().replace(/[#?].*$/, ""); // http://127.0.0.1:<port>/

  // ---- a real worker must be in charge before anything below means anything ----
  const controlled = await until(page, () => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
  check(controlled, "a real service worker is controlling the page", "no service worker took control of the page");

  // The answer the WORKER gave the page for the PDF (there is one per navigation).
  const workerAnswerForPdf = () => context.waitForEvent("response", {
    predicate: (r) => r.url().endsWith("/" + PDF_PATH) && r.fromServiceWorker(),
  });

  // ---- 1. through the real UI: Library -> ADP 6-0 -> Original PDF ----
  await waitForRoute(page, "#/library", { ready: ".card.click[role=button]" });
  const pdfOffered = await page.evaluate(() => window.G.library._pdfAvailable);
  check(pdfOffered === true, "the Library offers the Original PDF tab (the overlay serves the PDF)", "_pdfAvailable was " + pdfOffered);
  await clickWhenStable(page, page.locator(".card.click", { hasText: "ADP 6-0" }));
  const frameAnswer = workerAnswerForPdf();
  await clickWhenStable(page, page.locator("button.tab", { hasText: "Original PDF" }));
  const inFrame = await frameAnswer;
  const frameType = String(inFrame.headers()["content-type"] || "");
  check(inFrame.status() === 200 && /^application\/pdf/i.test(frameType),
    "the Original PDF frame is answered with the PDF itself (application/pdf)",
    () => "the frame was answered with " + inFrame.status() + " " + frameType + " - the app's own page, not the document");

  // A browser with a PDF viewer hands the frame to it (cross-origin, reads as "not the app");
  // one without leaves it blank. Either way it must never hold a second copy of the app.
  const framed = await page.evaluate(() => {
    const f = document.querySelector("#library-stage iframe");
    if (!f) return { present: false };
    try {
      const d = f.contentDocument;
      return { present: true, isApp: !!(d && (d.getElementById("route") || d.getElementById("app"))), title: d ? d.title : "" };
    } catch (e) { return { present: true, isApp: false, title: "" }; }
  });
  check(framed.present && !framed.isApp && !/GUIDON/i.test(framed.title),
    "the Original PDF frame does not hold a second copy of the app", () => "the frame held the app: " + JSON.stringify(framed));

  // ---- 2. "Open in a new tab" reaches the PDF, not the app ----
  const tabAnswer = workerAnswerForPdf();
  await clickWhenStable(page, page.locator("#library-stage a", { hasText: "Open in a new tab" }));
  const inTab = await tabAnswer;
  const tabType = String(inTab.headers()["content-type"] || "");
  check(inTab.status() === 200 && /^application\/pdf/i.test(tabType),
    "'Open in a new tab' is answered with the PDF itself (application/pdf)",
    () => "the new tab was answered with " + inTab.status() + " " + tabType);
  for (const p of context.pages()) if (p !== page) await p.close();

  // ---- 3. the PDF was saved on that first open, so it opens with no signal ----
  const saved = await untilAsync(page, async () => {
    const r = await caches.match("docs/ADP_6-0_Mission_Command.pdf", { ignoreSearch: true });
    return !!r && r.headers.get("content-type") === "application/pdf";
  });
  check(saved, "the PDF itself (application/pdf) was saved on the first open", "the PDF was not saved for offline use");

  // ---- 3b. a slice is not the file: a ranged request is answered 206 and is never saved ----
  const ranged = await page.evaluate(async (u) => {
    const r = await fetch(u, { headers: { Range: "bytes=0-99" } });
    const b = await r.arrayBuffer();
    return { status: r.status, len: b.byteLength, range: r.headers.get("content-range") };
  }, RANGE_PATH);
  check(ranged.status === 206 && ranged.len === 100 && /^bytes 0-99\/500$/.test(ranged.range || ""), "a ranged request through the worker is answered 206 with exactly the 100 bytes asked for", () => JSON.stringify(ranged));
  const rangedSaved = await page.evaluate(async (u) => !!(await caches.match(u, { ignoreSearch: true })), RANGE_PATH);
  check(!rangedSaved, "...and that partial answer was NOT saved (a half file must never stand in for the real one offline)", "the 206 slice was saved in the worker's cache");
  const whole = await page.evaluate(async (u) => { const r = await fetch(u); const b = await r.arrayBuffer(); return { status: r.status, len: b.byteLength }; }, RANGE_PATH);
  const wholeSaved = await untilAsync(page, async (u) => !!(await caches.match(u, { ignoreSearch: true })), RANGE_PATH);
  check(whole.status === 200 && whole.len === 500 && wholeSaved, "honest path: the same file fetched whole is answered 200 and IS saved", () => JSON.stringify({ whole, wholeSaved }));

  // ---- 3c. the save rule itself, run directly. The browser's own cache refuses a 206 whatever the worker does, so
  // the case above holds with the rule removed; a success that is not a whole 200 (203, 204) or an answer that is
  // not from this origin (type "cors"/"opaque") is the case only the rule stops. ----
  {
    const kept = new Map(), handlers = {};
    let next = null;
    const sandbox = {
      self: { addEventListener: (t, f) => { handlers[t] = f; }, location: new URL("http://app.test/sw.js"), clients: { claim: async () => {} }, skipWaiting() {} },
      caches: { match: async (r) => kept.get(typeof r === "string" ? r : r.url), open: async () => ({ put: async (r, res) => { kept.set(r.url, res); }, addAll: async () => {} }), keys: async () => [], delete: async () => true },
      fetch: async () => next, URL, JSON, Request, Response, Promise, console,
    };
    vm.runInNewContext(readFileSync(path.join(overlay, "sw.js"), "utf8"), sandbox, { filename: "sw.js" });
    const answer = (status, type = "basic") => ({ status, type, ok: status >= 200 && status < 300, clone() { return answer(status, type); } });
    const ask = async (label, res) => {
      kept.clear(); next = res;
      const req = new Request("http://app.test/docs/" + label + ".pdf");
      let given = null;
      handlers.fetch({ request: req, respondWith: (p) => { given = p; } });
      const out = await given;
      return { passedThrough: out === res, saved: kept.has(req.url) };
    };
    const whole = await ask("whole", answer(200));
    check(whole.passedThrough && whole.saved, "the worker's rule: a whole, plain 200 is handed on and saved", () => JSON.stringify(whole));
    for (const [label, res] of [["a 206 slice", answer(206)], ["a 203", answer(203)], ["a 204 with no content", answer(204)], ["a 200 from another origin (cors)", answer(200, "cors")], ["an opaque answer", answer(0, "opaque")]]) {
      const r = await ask(label.replace(/\W+/g, "-"), res);
      check(r.passedThrough && !r.saved, "the worker's rule: " + label + " is handed on to the page but NOT saved", () => JSON.stringify(r));
    }
  }

  // ---- 4. the honest path: the app's own address still opens, offline, in every form ----
  await context.setOffline(true);
  for (const [label, target] of [
    ["the plain address", base],
    ["index.html spelled out", base + "index.html"],
    ["the installed-icon form (?source=pwa)", base + "?source=pwa"],
  ]) {
    await page.goto(target, { waitUntil: "load" });
    await waitForBoot(page);
    const isShell = await page.evaluate(() => !!document.getElementById("route"));
    check(isShell, label + " opens the app with no signal", "the app did not open at " + target + " while offline");
  }

  // ---- 5. a page that is NOT saved says so in plain words, never a nested app ----
  const resp = await page.goto(base + "docs/ADP_6-22_Army_Leadership_and_the_Profession.pdf", { waitUntil: "load" }).catch(() => null);
  const shown = await page.evaluate(() => ({ app: !!document.getElementById("route"), text: (document.body && document.body.innerText) || "" }));
  const said = shown.text + " " + (resp ? await resp.text().catch(() => "") : "");
  check(!shown.app, "an unsaved document offline does not open the app inside itself", "the unsaved document opened the app");
  check(/not saved on this device/i.test(said) && /connect/i.test(said),
    "an unsaved document offline says so in plain words and how to fix it", () => "the page said: " + JSON.stringify(said.slice(0, 200)));
  // The promise is true only as far as it goes: every saved document is dropped when GUIDON next updates (the new
  // worker's activate deletes each older guidon-* cache), so "it will open without a signal after that" - forever - was not.
  check(/it will open without a signal until GUIDON next updates\./.test(said) && !/without a signal after that/i.test(said),
    "...and says how long that lasts: \"until GUIDON next updates\", not a forever it cannot keep", () => "the page said: " + JSON.stringify(said.slice(0, 300)));
  await context.setOffline(false);

  // The browser logs its own line for a document it could not fetch while offline;
  // nothing else is expected (a nested app used to add its own registration errors here).
  expectNoConsoleNoise(noise, { ignore: [/Failed to load resource/i, /net::ERR_INTERNET_DISCONNECTED/i] });
} finally {
  try { rmSync(overlay, { recursive: true, force: true }); } catch (e) { /* temp folder; the OS clears it eventually */ }
}
await finish("SW PDF NAVIGATION");
