/**
 * Diagnostics (#/selftest, G.selftest): the generic route sweep only loads
 * the view once and never clicks "Run automated checks", ticks a manual
 * item, copies the report, or clears ticks - so none of its actual
 * interactive behavior had coverage. This exercises the automated-check
 * run (results render, summary updates, known-good checks actually pass),
 * manual-tick persistence, the real clipboard copy-report round trip, and
 * Clear manual ticks' confirm-gated reset.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(500);

const heading = await page.evaluate(() => /Diagnostics/.test(document.body.textContent || ""));
heading ? ok("Diagnostics view renders") : bad("Diagnostics heading not found");

const initialSummary = await page.evaluate(() => (document.querySelector(".stat .k") || {}).textContent || "");
initialSummary === "Not yet run" ? ok("Automated summary starts 'Not yet run'") : bad("unexpected initial summary: " + initialSummary);

// ---- run the real automated checks ----
await page.locator("button", { hasText: /Run automated checks/ }).click();
await page.waitForTimeout(1200);

const resultCards = await page.evaluate(() => document.querySelectorAll(".panel .card").length);
resultCards >= 10 ? ok("Automated run renders a result card per check (" + resultCards + " cards)") : bad("too few result cards: " + resultCards);

const summaryAfter = await page.evaluate(() => ({
  k: (document.querySelector(".stat .k") || {}).textContent,
  v: (document.querySelector(".stat .v") || {}).textContent,
}));
/passing|failing/.test(summaryAfter.k || "") ? ok("Summary updates after the run (" + summaryAfter.k + ", " + summaryAfter.v + ")") : bad("summary did not update: " + JSON.stringify(summaryAfter));

const moduleCheckOk = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".panel .card"));
  const c = cards.find((x) => /Module integrity/.test(x.textContent));
  return c ? /^✓/.test(c.querySelector(".ob-plan-cat")?.textContent || "") : null;
});
moduleCheckOk === true ? ok("'Module integrity' check reports pass (✓) in this real browser run") : bad("Module integrity check result: " + moduleCheckOk);

const storageCheckOk = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".panel .card"));
  const c = cards.find((x) => /Storage round-trip/.test(x.textContent));
  return c ? /^✓/.test(c.querySelector(".ob-plan-cat")?.textContent || "") : null;
});
storageCheckOk === true ? ok("'Storage round-trip' check reports pass (✓) - a real IndexedDB write/read actually happened") : bad("Storage round-trip check result: " + storageCheckOk);

const runBtnRelabeled = await page.evaluate(() => (document.querySelector("button.btn.primary.sm") || {}).textContent || "");
/Run again/.test(runBtnRelabeled) ? ok("Run button relabels to 'Run again' after completion") : bad("run button text after run: " + runBtnRelabeled);

// ---- Copy report: real clipboard round trip - BEFORE any re-render, since
// lastRun is deliberately in-memory-only per render() call (automated
// results are documented as "not stored"), so this has to happen while the
// same render() pass that ran the checks is still live.
await page.locator("button", { hasText: /Copy report/ }).click();
await page.waitForTimeout(300);
const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
/GUIDON SELF-TEST REPORT/.test(clipboardText) ? ok("Copy report writes a real report to the clipboard") : bad("clipboard content missing report header: " + (clipboardText || "").slice(0, 100));
/AUTOMATED/.test(clipboardText) && /MANUAL/.test(clipboardText) ? ok("Clipboard report includes both AUTOMATED and MANUAL sections") : bad("clipboard report missing expected sections");
new RegExp("Run at .* on view #/selftest").test(clipboardText) ? ok("Clipboard report reflects the automated run that actually happened this session") : bad("clipboard report does not reference the completed run: " + clipboardText.slice(0, 300));

// ---- manual tick persists across a re-render ----
const firstManualCb = page.locator('.panel input[type="checkbox"]').first();
await firstManualCb.check();
await page.waitForTimeout(300);
const mstatAfterCheck = await page.evaluate(() => (document.querySelectorAll(".stat .v")[1] || {}).textContent || "");
/^1 \//.test(mstatAfterCheck) ? ok("Manual-confirmed count updates to 1 after ticking one item") : bad("manual stat after tick: " + mstatAfterCheck);

// Force a fresh render() (not a full page reload) to confirm the tick
// actually persisted to kv, not just to in-memory `saved` for this render pass.
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(500);
const firstCbCheckedAfterRerender = await page.locator('.panel input[type="checkbox"]').first().isChecked();
firstCbCheckedAfterRerender ? ok("Manual tick survives a full re-render of the view (persisted via G.db, not just in-memory)") : bad("manual tick did not persist across a re-render");

// ---- Clear manual ticks: confirm-gated, actually resets ----
await page.locator("button", { hasText: /Clear manual ticks/ }).click();
await page.waitForTimeout(300);
const confirmVisible = await page.locator(".gm-box", { hasText: /Clear manual ticks/ }).count();
confirmVisible ? ok("Clear manual ticks is gated behind a real confirm dialog") : bad("confirm dialog for Clear manual ticks did not appear");
await page.locator(".gm-box button", { hasText: /^Clear$/ }).click();
await page.waitForTimeout(400);
const mstatAfterClear = await page.evaluate(() => (document.querySelectorAll(".stat .v")[1] || {}).textContent || "");
/^0 \//.test(mstatAfterClear) ? ok("Manual-confirmed count resets to 0 after confirming Clear manual ticks") : bad("manual stat after clear: " + mstatAfterClear);
const cbAfterClear = await page.locator('.panel input[type="checkbox"]').first().isChecked();
!cbAfterClear ? ok("The previously-ticked checkbox is unchecked after clearing") : bad("checkbox still checked after Clear manual ticks");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSELFTEST: all passed");
process.exit(fails ? 1 : 0);
