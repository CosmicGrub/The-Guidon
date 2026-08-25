/**
 * Engineering Systems pitch ("Career live-getter"): currency.js's DOMAINS
 * array (js/currency.js, rendered at #/currency) carried a Career/MOS entry
 * whose `asOf` was a hardcoded literal ("2026") — the one domain in the file
 * that wasn't a real live signal, even though the Career tab's own
 * disclaimer says its IN/OUT-call data "changes roughly every 6 months via
 * MILPER message." Money/Finance already solved this shape with a `get`
 * accessor (financeAsOfStamp()) reading G.store.finance().asOf live; this
 * mirrors that exact pattern for Career via a new careerAsOfStamp(), reading
 * data.career.fy26Snapshot.sourceMilper.effectiveDate through G.store.career()
 * - the same accessor career.js's own data() uses.
 *
 * Separately, the #/career route's own statusBadge() had a second, unrelated
 * copy of the same problem: a hardcoded "FY26 SHORTAGE / GROWTH" label with
 * no year variable at all. That now derives its year from the same
 * sourceMilper.effectiveDate field, so the freshness tracker and the live
 * route can never disagree with each other - Part 3 below proves that by
 * moving the source date forward a MOS's badge visibly changes with it.
 *
 * Part 1 confirms the new card renders with a real, non-"unknown" age
 * derived from the actual seeded sourceMilper.effectiveDate. Part 2 mutates
 * window.GUIDON_SEED.career.fy26Snapshot.sourceMilper.effectiveDate in place
 * (same object state.seed.career points at - a direct reference, not a
 * clone; see loadContent() in index.html) to a stale stamp, re-renders
 * #/currency, and confirms the card's own age/status/border-color move to
 * match. Part 3 does the same mutation and confirms the #/career route's
 * own shortage/growth badge picks up the new year too.
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
await page.evaluate(() => { location.hash = "#/currency"; });
await page.waitForTimeout(700);

// ============================================================================
// Part 0: the module itself - DOMAINS has a Career entry pointing at
// #/career, and its asOf is a live getter (not a plain string literal), so
// it cannot silently drift from the real data the way a hand-typed date
// could.
// ============================================================================
const domainState = await page.evaluate(() => {
  const D = window.G && window.G.currency && window.G.currency.DOMAINS;
  if (!Array.isArray(D)) return null;
  const entry = D.find((d) => d.link === "#/career");
  if (!entry) return { found: false };
  const desc = Object.getOwnPropertyDescriptor(entry, "asOf");
  return {
    found: true,
    area: entry.area,
    short: entry.short,
    isGetter: !!(desc && typeof desc.get === "function"),
    asOfValue: entry.asOf,
    realEffectiveDate: (window.G.store && window.G.store.career && window.G.store.career().fy26Snapshot
      && window.G.store.career().fy26Snapshot.sourceMilper
      && window.G.store.career().fy26Snapshot.sourceMilper.effectiveDate) || null,
  };
});

domainState && domainState.found
  ? ok("currency.js's DOMAINS array has an entry linking to #/career (the Career/MOS tab)")
  : bad("no DOMAINS entry links to #/career: " + JSON.stringify(domainState));
if (domainState && domainState.found) {
  domainState.isGetter
    ? ok("the Career domain's asOf is a live `get` accessor, not a static literal, so it can't drift from the real data")
    : bad("the Career domain's asOf is a plain value, not derived live from G.store.career()");
  (typeof domainState.asOfValue === "string" && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(domainState.asOfValue))
    ? ok("the derived asOf resolves to a parseable YYYY[-MM[-DD]] stamp (" + domainState.asOfValue + "), parseable by ageOf()")
    : bad("the derived asOf did not resolve to a parseable stamp: " + JSON.stringify(domainState.asOfValue));
  (domainState.realEffectiveDate && domainState.asOfValue === domainState.realEffectiveDate)
    ? ok("the derived stamp (" + domainState.asOfValue + ") exactly matches G.store.career().fy26Snapshot.sourceMilper.effectiveDate, confirming it was read live, not invented")
    : bad("the derived stamp does not match the real sourceMilper.effectiveDate: derived=" + JSON.stringify(domainState.asOfValue) + " real=" + JSON.stringify(domainState.realEffectiveDate));
}

// ============================================================================
// Part 1: the rendered #/currency screen shows a card for Career with a real
// computed age (not the "unknown"/grey fallback used when a stamp can't be
// parsed), matching the app's own seeded sourceMilper.effectiveDate.
// ============================================================================
const rendered1 = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card-results-grid .panel")];
  const card = cards.find((c) => /Open Career\b/.test(c.textContent || ""));
  if (!card) return { found: false, cardCount: cards.length };
  const v = card.querySelector(".k + .v, span.v");
  return {
    found: true,
    text: card.textContent || "",
    ageText: v ? v.textContent : null,
    borderColor: card.style.borderLeft || getComputedStyle(card).borderLeftColor,
  };
});

rendered1.found
  ? ok("the Freshness (#/currency) screen renders a card with an 'Open Career' button")
  : bad("no card with an 'Open Career' button found on #/currency: " + JSON.stringify(rendered1));
if (rendered1.found) {
  /unknown/i.test(rendered1.ageText || "") || rendered1.ageText === "—"
    ? bad("the Career card's age reads as unknown/em-dash even though sourceMilper.effectiveDate is seeded with a real date: " + JSON.stringify(rendered1.ageText))
    : ok("the Career card shows a real computed age, not the 'unknown' fallback: " + JSON.stringify(rendered1.ageText));
  /months? old|this month/i.test(rendered1.text)
    ? ok("the card body reports an age in months, same shape as every other domain card")
    : bad("the card body did not contain the expected 'N months old' / 'this month' age text");
}

// ============================================================================
// Part 2: mutate the SEED's career.fy26Snapshot.sourceMilper.effectiveDate to
// a stale date (window.GUIDON_SEED and state.seed.career are the same object
// per loadContent() in index.html - a direct reference, not a clone) and
// confirm the Freshness screen's Career card moves to reflect it on the next
// render - proving this reads the live field instead of a value captured
// once at module load.
// ============================================================================
await page.evaluate(() => {
  window.GUIDON_SEED.career.fy26Snapshot.sourceMilper.effectiveDate = "2019-01-01";
});
// Force a fresh render() call - re-entering the same hash does not re-run
// the router in this SPA, so navigate away and back (same technique used
// throughout tools/test-*.mjs for this app's hash router).
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = "#/currency"; });
await page.waitForTimeout(500);

const rendered2 = await page.evaluate(() => {
  const D = window.G.currency.DOMAINS;
  const entry = D.find((d) => d.link === "#/career");
  const cards = [...document.querySelectorAll(".card-results-grid .panel")];
  const card = cards.find((c) => /Open Career\b/.test(c.textContent || ""));
  return {
    liveAsOf: entry ? entry.asOf : null,
    ageText: card ? (card.querySelector("span.v") || {}).textContent : null,
    cardText: card ? card.textContent : null,
    borderColor: card ? card.style.borderLeft : null,
  };
});

rendered2.liveAsOf === "2019-01-01"
  ? ok("after mutating window.GUIDON_SEED.career.fy26Snapshot.sourceMilper.effectiveDate to 2019-01-01, the live getter now returns \"2019-01-01\"")
  : bad("the live asOf getter did not pick up the mutated seed value: " + JSON.stringify(rendered2.liveAsOf));
/verify before you rely on it/i.test(rendered2.cardText || "")
  ? ok("the re-rendered Career card now shows the red 'verify before you rely on it' status for a many-years-stale stamp")
  : bad("the re-rendered Career card did not flip to the red/verify status after the seed went stale: " + JSON.stringify(rendered2.cardText));
(rendered2.borderColor && /red/.test(rendered2.borderColor))
  ? ok("the card's left border switched to var(--red), matching every other stale domain card's styling")
  : bad("the card's border color did not switch to red: " + JSON.stringify(rendered2.borderColor));
(rendered1.ageText !== rendered2.ageText)
  ? ok("the displayed age text changed between the two renders (" + JSON.stringify(rendered1.ageText) + " -> " + JSON.stringify(rendered2.ageText) + "), confirming this is computed live, not cached")
  : bad("the displayed age text did not change after the underlying data changed");

// ============================================================================
// Part 3: the #/career route's own shortage/growth badge label derives its
// year from the same sourceMilper.effectiveDate field, not a hardcoded
// "FY26" - so it can never disagree with the freshness tracker above. Move
// the source date forward into a distinctly different fiscal year and
// confirm a shortage-status MOS's badge text changes with it.
// ============================================================================
await page.evaluate(() => {
  window.GUIDON_SEED.career.fy26Snapshot.sourceMilper.effectiveDate = "2031-05-01";
});
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = "#/career"; });
await page.waitForTimeout(500);
const mosInput = page.locator('input[aria-label="MOS code"]');
await mosInput.fill("13F");
await page.waitForTimeout(350);
const careerText = await page.evaluate(() => document.body.textContent || "");

/FY31 SHORTAGE \/ GROWTH/.test(careerText)
  ? ok("after moving sourceMilper.effectiveDate to 2031, 13F's shortage badge now reads 'FY31 SHORTAGE / GROWTH' instead of the old hardcoded 'FY26'")
  : bad("the #/career shortage badge did not follow the mutated sourceMilper.effectiveDate to FY31: " + JSON.stringify(careerText.slice(0, 400)));
/FY26 SHORTAGE \/ GROWTH/.test(careerText)
  ? bad("the #/career shortage badge still shows the stale hardcoded 'FY26' label after the source date moved to 2031")
  : ok("the stale hardcoded 'FY26' label is gone once the real source date moves");

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `CURRENCY/CAREER: ${fails} FAILURE(S)` : "CURRENCY/CAREER: all passed"));
process.exit(fails ? 1 : 0);
