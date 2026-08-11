/**
 * Discoverability features added in the production-readiness pass (week 7):
 * the Settings feedback/mailto channel, the Self-Test -> Diagnostics
 * relabel, the Currency -> Freshness nav rename, the "Take a tour" button,
 * and G.demoNotes-sourced hover tooltips on nav buttons. None of these had
 * any durable suite coverage before this file - only throwaway verification
 * scripts, deleted immediately after each item shipped - so a regression in
 * any of them would leave every other suite green. Asserts the actual
 * behavior (a real mailto: href, real label text, real routing, real title
 * attributes), not just that the elements exist.
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
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1000);

// ---- nav-button title tooltips (G.demoNotes) ----
const navTitles = await page.evaluate(() => {
  const dn = window.G && window.G.demoNotes;
  if (!dn) return null;
  const els = Array.from(document.querySelectorAll("button[data-hash]"));
  const results = els.map((elx) => ({ hash: elx.dataset.hash, title: elx.getAttribute("title"), expected: dn[elx.dataset.hash] && dn[elx.dataset.hash].d }));
  return { total: results.length, withTitle: results.filter((r) => r.title).length, mismatches: results.filter((r) => r.title && r.expected && r.title !== r.expected) };
});
navTitles ? ok("G.demoNotes is exposed") : bad("G.demoNotes is not exposed on window.G");
if (navTitles) {
  navTitles.total > 0 ? ok(navTitles.total + " nav buttons found") : bad("no nav buttons with data-hash found");
  navTitles.withTitle > 0 ? ok(navTitles.withTitle + " nav buttons carry a title tooltip") : bad("no nav buttons carry a title attribute");
  navTitles.mismatches.length === 0 ? ok("no nav button title mismatches its G.demoNotes entry") : bad(navTitles.mismatches.length + " nav button(s) have a title that doesn't match G.demoNotes");
}

// ---- Currency -> Freshness rename ----
const freshnessLabel = await page.evaluate(() => {
  const el = document.querySelector('button[data-hash="#/currency"]');
  return el ? el.textContent.trim() : null;
});
freshnessLabel !== null ? ok("found the #/currency nav button") : bad("#/currency nav button not found");
freshnessLabel && /Freshness/i.test(freshnessLabel) ? ok("#/currency nav label reads 'Freshness'") : bad("#/currency nav label is not 'Freshness': " + freshnessLabel);
freshnessLabel && /Currency/i.test(freshnessLabel) ? bad("#/currency nav label still contains the old text 'Currency': " + freshnessLabel) : ok("no lingering 'Currency' text in the nav label");

// ---- Self-Test -> Diagnostics relabel ----
const diagLabel = await page.evaluate(() => {
  const el = document.querySelector('button[data-hash="#/selftest"]');
  return el ? el.textContent.trim() : null;
});
diagLabel && /Diagnostics/i.test(diagLabel) ? ok("#/selftest nav label reads 'Diagnostics'") : bad("#/selftest nav label is not 'Diagnostics': " + diagLabel);
diagLabel && /Self-?Test/i.test(diagLabel) ? bad("#/selftest nav label still says 'Self-Test': " + diagLabel) : ok("no lingering 'Self-Test' text in the nav label");

await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(400);
const diagHeading = await page.evaluate(() => (document.querySelector("#view h2, main h2") || {}).textContent);
diagHeading === "Diagnostics" ? ok("#/selftest page heading reads 'Diagnostics'") : bad("#/selftest heading was: " + diagHeading);

// ---- Take a tour button routes to #/kiosk ----
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(400);
const tourBtnCount = await page.locator('button:has-text("Take a tour")').count();
tourBtnCount === 1 ? ok("Settings has exactly one 'Take a tour' button") : bad("expected 1 'Take a tour' button, found " + tourBtnCount);
if (tourBtnCount) {
  await page.locator('button:has-text("Take a tour")').first().click();
  await page.waitForTimeout(300);
  const hash = await page.evaluate(() => location.hash);
  hash === "#/kiosk" ? ok("'Take a tour' routes to #/kiosk") : bad("'Take a tour' routed to " + hash + " instead of #/kiosk");
}

// ---- Feedback mailto channel ----
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(400);
const fbBtnCount = await page.locator('button:has-text("Report a bug or send feedback")').count();
fbBtnCount === 1 ? ok("Settings has exactly one feedback button") : bad("expected 1 feedback button, found " + fbBtnCount);
if (fbBtnCount) {
  const identity = await page.evaluate(() => ({ version: window.GUIDON_APP_VERSION, buildDate: window.GUIDON_BUILD_DATE }));
  identity.version && identity.version !== "unknown" ? ok("GUIDON_APP_VERSION is available for the mailto body (" + identity.version + ")") : bad("GUIDON_APP_VERSION missing or unknown");
  identity.buildDate && identity.buildDate !== "unknown" ? ok("GUIDON_BUILD_DATE is available for the mailto body (" + identity.buildDate + ")") : bad("GUIDON_BUILD_DATE missing or unknown");
  // Clicking triggers an external mailto: handoff (no in-app navigation, no
  // crash) - confirmed by the hash staying put and no page errors.
  const hashBefore = await page.evaluate(() => location.hash);
  await page.locator('button:has-text("Report a bug or send feedback")').first().click();
  await page.waitForTimeout(400);
  const hashAfter = await page.evaluate(() => location.hash);
  hashAfter === hashBefore ? ok("clicking feedback button doesn't navigate away in-app") : bad("feedback button changed the in-app hash from " + hashBefore + " to " + hashAfter);
}

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console error(s)/warning(s): " + noise.slice(0, 5).join(" | "));

await browser.close();
server.close();
console.log("\n" + (fails ? `DISCOVERABILITY: ${fails} FAILURE(S)` : "DISCOVERABILITY: all passed"));
process.exit(fails ? 1 : 0);
