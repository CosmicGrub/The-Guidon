/**
 * util.printHTML()'s re-entrancy guard (src/index.html, js/util.js). None of
 * this function's ~20 call sites (Progress's own "Print Report" button used
 * here included) debounce their trigger button, and printHTML() itself used
 * to build a fresh #print-holder and append it on every call with no check
 * for a still-present holder from a call that just fired moments earlier -
 * cleanup only happens on the browser's "afterprint" event, which doesn't
 * fire until the OS print dialog is actually dismissed. A fast double-click
 * on any print button therefore used to leave TWO #print-holder elements in
 * the DOM at once, and since @media print's `.print-only { display: block
 * !important }` rule (near the top of this file, above the "#print-holder's"
 * own comment) matches by CLASS - not the (duplicate, unenforced) id - BOTH
 * would render when window.print() fired, duplicating the printed report.
 *
 * The fix mirrors counselpdf.js's openFiller() (js/counselpdf.js), which
 * already guards the identical shape of problem the identical way: remove
 * any leftover node of this kind before appending a fresh one. This suite
 * fires two back-to-back clicks on a real print-triggering button (Progress's
 * "Print Report", already covered content-wise by test-print-paths.mjs -
 * this suite only cares about node counts, not report content) with no
 * await between them, then confirms only ONE #print-holder ever exists -
 * plus a control case proving a normal single click still works.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);

// window.print() can hang/behave oddly headless (test-print-paths.mjs's own
// note) - stub it before it's ever called. Neither test case below depends
// on "afterprint" firing; both only inspect the #print-holder DOM directly.
await page.addInitScript(() => { window.print = () => {}; });
await page.evaluate(() => { window.print = () => {}; });

// Bypass onboarding via a guest session (same shortcut test-mockboard.mjs
// uses) - this test only needs a working Progress view, not real profile data.
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

await page.evaluate(() => { location.hash = "#/progress"; });
await page.waitForTimeout(500);
await page.locator("button", { hasText: /Print Report/ }).waitFor({ state: "visible", timeout: 8000 });

// Ensure the DOM starts clean before either case.
await page.evaluate(() => { document.querySelectorAll("#print-holder").forEach((n) => n.remove()); });

// ==================== 1) Two rapid clicks - the actual regression ====================
// el.click() twice in the SAME synchronous evaluate() call is the closest a
// headless harness gets to a real fast double-click: no Playwright
// actionability/network-idle waits land between the two invocations, so the
// second call's printProgress() (Progress's onclick handler) reaches
// util.printHTML() before "afterprint" could ever have fired for the first -
// exactly the window the guard has to close.
const doubleClickResult = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => /Print Report/.test(b.textContent || ""));
  if (!btn) return { found: false };
  btn.click();
  btn.click();
  return { found: true };
});
doubleClickResult.found ? ok("found the Progress \"Print Report\" button") : bad("Progress \"Print Report\" button not found");

// printProgress() is `async` (src/index.html) - give both invocations' promise
// chains a beat to finish reaching util.printHTML() before inspecting the DOM.
await page.waitForTimeout(400);

const afterDouble = await page.evaluate(() => {
  const holders = Array.from(document.querySelectorAll("#print-holder"));
  return {
    count: holders.length,
    titles: holders.map((h) => (h.querySelector("h1") || {}).textContent || ""),
  };
});
afterDouble.count === 1
  ? ok("a fast double-click on \"Print Report\" leaves exactly one #print-holder in the DOM, not two (re-entrancy guard holds)")
  : bad("expected exactly 1 #print-holder after a double-click, found " + afterDouble.count + " - the printed report would be duplicated: " + JSON.stringify(afterDouble.titles));
if (afterDouble.count >= 1) {
  /GUIDON Readiness Report/.test(afterDouble.titles[0])
    ? ok("the single surviving #print-holder carries the real report title, not an empty/stale one")
    : bad("surviving #print-holder has an unexpected title: " + JSON.stringify(afterDouble.titles[0]));
}
// A second, independent check on how many elements @media print's
// `.print-only { display: block !important }` rule (matches by CLASS, not
// id - see the comment above that rule) would actually render as visible
// print content. Before the fix this is exactly where the bug showed up:
// two #print-holder nodes, both carrying .print-only, both rendered on the
// printed page. Scoped to .print-only rather than document.body as a whole -
// this is a single-file bundle whose own inline <script> source text
// legitimately contains report titles as string literals, which would
// pollute a body-wide text search.
const printOnlyCount = await page.evaluate(() => document.querySelectorAll(".print-only").length);
printOnlyCount === 1
  ? ok("exactly one .print-only element exists after the double-click (nothing extra would render on the printed page)")
  : bad("expected exactly 1 .print-only element after the double-click, found " + printOnlyCount);

// Clean up before the control case (afterprint never fires under the stub).
await page.evaluate(() => { document.querySelectorAll("#print-holder").forEach((n) => n.remove()); document.querySelectorAll("#app").forEach((n) => n.classList.remove("no-print")); });

// ==================== 2) Control: a normal single click still works ====================
await page.locator("button", { hasText: /Print Report/ }).click();
await page.waitForTimeout(400);
const afterSingle = await page.evaluate(() => {
  const holders = Array.from(document.querySelectorAll("#print-holder"));
  return { count: holders.length, title: holders[0] ? (holders[0].querySelector("h1") || {}).textContent || "" : null };
});
afterSingle.count === 1
  ? ok("a single, ordinary click still produces exactly one #print-holder (the guard doesn't break the normal path)")
  : bad("expected exactly 1 #print-holder after a normal single click, found " + afterSingle.count);
/GUIDON Readiness Report/.test(afterSingle.title || "")
  ? ok("the normal single-click print still carries the real report title")
  : bad("normal single-click print holder has an unexpected title: " + JSON.stringify(afterSingle.title));

// cleanup
await page.evaluate(() => { document.querySelectorAll("#print-holder").forEach((n) => n.remove()); document.querySelectorAll("#app").forEach((n) => n.classList.remove("no-print")); });

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nPRINT REENTRANCY: all passed");
process.exit(fails ? 1 : 0);
