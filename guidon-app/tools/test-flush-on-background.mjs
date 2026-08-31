/**
 * util.onFlush / _flushAllPending (src/index.html, "Flush-on-background
 * registry"): ~7 modules register a debounced-save flush callback here
 * (settings, ppw, promoPoints, drills:essay, writing:bulletHistory,
 * writing:drafts, finance:salNeg) specifically so a debounced write isn't
 * lost if a tab is backgrounded or killed before its own setTimeout ever
 * gets to fire - but until now nothing actually exercised the flush path
 * itself. Every existing persistence test in this repo proves persistence
 * the OTHER way (fill a field, wait out the real debounce timer, THEN
 * reload - see test-ppw.mjs's own combat-zone-months check) which can
 * never catch a regression in the flush registry itself, because the
 * debounce timer always had plenty of time to fire on its own regardless
 * of whether the flush path worked.
 *
 * This drives the PPW registrant (util.onFlush("ppw", ...)) specifically:
 * fills the "Months of combat-zone service" field (a real Full PPW
 * worksheet field, 300ms debounce, guidon:ppw:v1), IMMEDIATELY stubs
 * document.visibilityState to "hidden" and dispatches a real
 * "visibilitychange" event (the same stubbing technique test-notify-
 * status.mjs already established - visibilityState is normally a read-only
 * accessor tied to the real OS/browser chrome, not something you can just
 * assign), waits only long enough for the flush callback's own async
 * G.db.put() to resolve - well UNDER the 300ms debounce window, so the
 * field's natural setTimeout never gets a chance to fire on its own -
 * then reloads and confirms the value survived. If the flush registry ever
 * silently stopped invoking a registrant's callback, or PPW's own
 * util.onFlush("ppw", ...) registration broke, this is the only test in
 * the suite that would notice; every other persistence test would keep
 * passing right through that regression, since they all give the debounce
 * timer time to fire on its own anyway.
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

async function dismissOnboarding() {
  const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guestCard.count()) {
    await guestCard.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await dismissOnboarding();

async function gotoFullPPW() {
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: /^Points$/ }).click();
  await page.waitForTimeout(300);
  await page.locator("button", { hasText: /^Full PPW$/ }).click();
  await page.waitForTimeout(300);
}
await gotoFullPPW();

const CZ_MONTHS = "9";
const czInput = page.locator('input[aria-label="Months of combat-zone service"]');
await czInput.waitFor({ state: "visible", timeout: 5000 });
await czInput.fill(CZ_MONTHS);
// Fires the "input" listener (num() in the PPW render), which calls
// persistPPWDebounced() - that only starts a 300ms setTimeout, it does NOT
// write to IndexedDB yet.
await czInput.dispatchEvent("input");

// Simulate the tab backgrounding (Android's kill signal comes after this,
// not before - see the flush registry's own header comment) WITHOUT
// waiting for the 300ms debounce to elapse on its own first.
// document.visibilityState is normally read-only/tied to the real OS -
// override the property descriptor and dispatch the event by hand, the
// same technique test-notify-status.mjs already established for this
// exact API.
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
// Only long enough for the flush callback's own async G.db.put() to
// resolve - well under the 300ms debounce window, so the field's natural
// setTimeout never gets a chance to fire on its own before we reload and
// tear down this whole JS context (and its still-pending timer) out from
// under it.
await page.waitForTimeout(150);

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1000);
// A reload re-runs onboarding for a guest session (the profile is
// in-memory only, unlike guidon:ppw:v1 itself, which is real IndexedDB and
// survives) - dismiss it again, same as the very first page load above,
// before touching the Points/Full PPW view underneath it (same idiom
// test-ppw.mjs's own persistence check and test-settings-toggles.mjs both
// already establish).
await dismissOnboarding();
await gotoFullPPW();

const czAfterFlushReload = await page.locator('input[aria-label="Months of combat-zone service"]').inputValue();
czAfterFlushReload === CZ_MONTHS
  ? ok("visibilitychange->hidden flushed the in-flight debounced PPW save before its 300ms timer ever got a chance to fire on its own, and the value survived a reload (" + CZ_MONTHS + ")")
  : bad("combat-zone months after flush+reload: expected " + CZ_MONTHS + ", got " + JSON.stringify(czAfterFlushReload));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nFLUSH-ON-BACKGROUND: all passed");
process.exit(fails ? 1 : 0);
