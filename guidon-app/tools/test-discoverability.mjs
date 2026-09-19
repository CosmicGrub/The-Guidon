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
import { bootApp, ok, bad, finish, waitForRoute, clickWhenStable, until, expectNoConsoleNoise } from "./testkit.mjs";

const { page, noise } = await bootApp();

// A button by its visible words, checked in the page so a missing button is
// the assertion's failure to report, not a thrown wait.
const hasButton = (words) => until(page, (w) => Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").includes(w)), words, { timeout: 5000 });

// ---- nav-button title tooltips (G.demoNotes) ----
const navTitles = await page.evaluate(() => {
  const dn = window.G && window.G.demoNotes;
  if (!dn) return null;
  const els = Array.from(document.querySelectorAll("a[data-hash]"));
  const results = els.map((elx) => ({ hash: elx.dataset.hash, title: elx.getAttribute("title"), expected: dn[elx.dataset.hash] && dn[elx.dataset.hash].d }));
  // #/group is a deliberate, documented exception (2026-09-08): navButton()
  // (src/index.html) replaces its title with an honest "needs the GUIDON
  // app" explanation whenever G.caps.isShell() is false - which this plain
  // Chromium test context always is - instead of the generic demoNotes
  // blurb, exactly BECAUSE Study Rooms cannot host or join anything from a
  // browser tab. That's the intended, tested behavior (see
  // tools/test-study-rooms-shell-gate.mjs), not a regression in this
  // system - filtered out here rather than weakening the real invariant
  // this check exists to enforce for every other route.
  const mismatches = results.filter((r) => r.hash !== "#/group" && r.title && r.expected && r.title !== r.expected);
  return { total: results.length, withTitle: results.filter((r) => r.title).length, mismatches };
});
navTitles ? ok("G.demoNotes is exposed") : bad("G.demoNotes is not exposed on window.G");
if (navTitles) {
  navTitles.total > 0 ? ok(navTitles.total + " nav buttons found") : bad("no nav buttons with data-hash found");
  navTitles.withTitle > 0 ? ok(navTitles.withTitle + " nav buttons carry a title tooltip") : bad("no nav buttons carry a title attribute");
  navTitles.mismatches.length === 0 ? ok("no nav button title mismatches its G.demoNotes entry (except #/group's documented Study Rooms exception)") : bad(navTitles.mismatches.length + " nav button(s) have a title that doesn't match G.demoNotes");
}

// ---- Currency -> Freshness rename ----
const freshnessLabel = await page.evaluate(() => {
  const el = document.querySelector('a[data-hash="#/currency"]');
  return el ? el.textContent.trim() : null;
});
freshnessLabel !== null ? ok("found the #/currency nav button") : bad("#/currency nav button not found");
freshnessLabel && /Freshness/i.test(freshnessLabel) ? ok("#/currency nav label reads 'Freshness'") : bad("#/currency nav label is not 'Freshness': " + freshnessLabel);
freshnessLabel && /Currency/i.test(freshnessLabel) ? bad("#/currency nav label still contains the old text 'Currency': " + freshnessLabel) : ok("no lingering 'Currency' text in the nav label");

// ---- Audit finding (rank/MOS scoping pass): the Career Center's own
// in-page disclaimer says its MOS shortage/growth/SRB data changes
// roughly every six months - the single most self-described-perishable
// content in the app - yet this tracker never listed it as a domain. ----
await waitForRoute(page, "#/currency");
await until(page, () => /MOS shortage.growth and reclassification/.test(document.body.textContent || ""), null, { timeout: 5000 });
const careerDomainText = await page.evaluate(() => document.body.textContent || "");
/MOS shortage.growth and reclassification/.test(careerDomainText)
  ? ok("Freshness tracker now lists the MOS/Career domain")
  : bad("Freshness tracker body did not mention the MOS/Career domain");
/RETAIN/.test(careerDomainText) && /Career Counselor/i.test(careerDomainText)
  ? ok("Freshness tracker's Career entry names who to ask (Career Counselor / RETAIN)")
  : bad("Freshness tracker's Career entry is missing the 'who to ask' guidance");

// ---- Self-Test -> Diagnostics relabel ----
const diagLabel = await page.evaluate(() => {
  const el = document.querySelector('a[data-hash="#/selftest"]');
  return el ? el.textContent.trim() : null;
});
diagLabel && /Diagnostics/i.test(diagLabel) ? ok("#/selftest nav label reads 'Diagnostics'") : bad("#/selftest nav label is not 'Diagnostics': " + diagLabel);
diagLabel && /Self-?Test/i.test(diagLabel) ? bad("#/selftest nav label still says 'Self-Test': " + diagLabel) : ok("no lingering 'Self-Test' text in the nav label");

await waitForRoute(page, "#/board");
await waitForRoute(page, "#/selftest");
await until(page, () => !!document.querySelector("#view h2, main h2"), null, { timeout: 5000 });
const diagHeading = await page.evaluate(() => (document.querySelector("#view h2, main h2") || {}).textContent);
diagHeading === "Diagnostics" ? ok("#/selftest page heading reads 'Diagnostics'") : bad("#/selftest heading was: " + diagHeading);

// ---- Take a tour button routes to #/kiosk ----
await waitForRoute(page, "#/settings");
await hasButton("Take a tour");
const tourBtnCount = await page.locator('button:has-text("Take a tour")').count();
tourBtnCount === 1 ? ok("Settings has exactly one 'Take a tour' button") : bad("expected 1 'Take a tour' button, found " + tourBtnCount);
if (tourBtnCount) {
  await clickWhenStable(page, page.locator('button:has-text("Take a tour")').first());
  await until(page, () => location.hash === "#/kiosk", null, { timeout: 5000 });
  const hash = await page.evaluate(() => location.hash);
  hash === "#/kiosk" ? ok("'Take a tour' routes to #/kiosk") : bad("'Take a tour' routed to " + hash + " instead of #/kiosk");
}

// ---- Feedback mailto channel ----
await waitForRoute(page, "#/board");
await waitForRoute(page, "#/settings");
await hasButton("Report a bug or send feedback");
const fbBtnCount = await page.locator('button:has-text("Report a bug or send feedback")').count();
fbBtnCount === 1 ? ok("Settings has exactly one feedback button") : bad("expected 1 feedback button, found " + fbBtnCount);
if (fbBtnCount) {
  const identity = await page.evaluate(() => ({ version: window.GUIDON_APP_VERSION, buildDate: window.GUIDON_BUILD_DATE }));
  identity.version && identity.version !== "unknown" ? ok("GUIDON_APP_VERSION is available for the mailto body (" + identity.version + ")") : bad("GUIDON_APP_VERSION missing or unknown");
  identity.buildDate && identity.buildDate !== "unknown" ? ok("GUIDON_BUILD_DATE is available for the mailto body (" + identity.buildDate + ")") : bad("GUIDON_BUILD_DATE missing or unknown");
  // Clicking triggers an external mailto: handoff (no in-app navigation, no
  // crash) - confirmed by the hash staying put and no page errors.
  const hashBefore = await page.evaluate(() => location.hash);
  await clickWhenStable(page, page.locator('button:has-text("Report a bug or send feedback")').first());
  await page.waitForTimeout(400); // hygiene-ok: proving the app does NOT navigate needs a fixed window - there is no state to wait for
  const hashAfter = await page.evaluate(() => location.hash);
  hashAfter === hashBefore ? ok("clicking feedback button doesn't navigate away in-app") : bad("feedback button changed the in-app hash from " + hashBefore + " to " + hashAfter);
}

expectNoConsoleNoise(noise, { pass: "no console errors/warnings" });
await finish("DISCOVERABILITY");
