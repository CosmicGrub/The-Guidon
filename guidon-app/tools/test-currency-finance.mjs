/**
 * Roadmap Tier 3 (quick wins): register G.finance in the currency/freshness
 * tracker. currency.js's DOMAINS array (js/currency.js, rendered at
 * #/currency) already tracked 9 policy areas - Board Prep, Fitness,
 * Channels, BLC Prep, Assignments, Career, ETS/Transition, Terms, Doctrine -
 * but nothing tracked the separate #/money route (G.finance): BRS & TSP, TSP
 * Funds, Budget, Predatory Lending, ETS Finance, VA Compensation, Credit &
 * Debt and Salary Negotiation, all behind one tab bar sharing one asOf
 * stamp (window.GUIDON_SEED.finance.asOf). "ETS/Transition" tracks the
 * SEPARATE #/transition route's own timeline, not this.
 *
 * Fixed by adding a 10th DOMAINS entry whose `asOf` is a `get` accessor
 * (financeAsOfStamp()) that reads G.store.finance().asOf live - the same
 * accessor finance.js's own data() uses - and pulls the leading year out of
 * its prose ("TSP/BRS rules current as of 2026 (...); VA compensation rates
 * current as of 2026 (...)") rather than a second hand-typed date that could
 * drift from the real field.
 *
 * Part 1 confirms the new card renders with a real, non-"unknown" age
 * derived from the actual seeded asOf text. Part 2 mutates
 * window.GUIDON_SEED.finance.asOf in place (same object state.seed.finance
 * points at - a direct reference, not a clone; see loadContent() in
 * index.html) to a stamp 3 years stale, re-renders #/currency, and confirms
 * the card's own age/status/border-color move to match - proving the
 * tracker reads the real field live rather than a value captured once.
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
// Part 0: the module itself - DOMAINS has a Finance/Money entry pointing at
// #/money, and its asOf is a live getter (not a plain string literal), so it
// cannot silently drift from the real data the way a hand-typed date could.
// ============================================================================
const domainState = await page.evaluate(() => {
  const D = window.G && window.G.currency && window.G.currency.DOMAINS;
  if (!Array.isArray(D)) return null;
  const entry = D.find((d) => d.link === "#/money");
  if (!entry) return { found: false };
  const desc = Object.getOwnPropertyDescriptor(entry, "asOf");
  return {
    found: true,
    area: entry.area,
    short: entry.short,
    isGetter: !!(desc && typeof desc.get === "function"),
    asOfValue: entry.asOf,
    realFinanceAsOf: (window.G.store && window.G.store.finance && window.G.store.finance().asOf) || null,
  };
});

domainState && domainState.found
  ? ok("currency.js's DOMAINS array now has an entry linking to #/money (the Finance/Money tab)")
  : bad("no DOMAINS entry links to #/money - Finance was not registered: " + JSON.stringify(domainState));
if (domainState && domainState.found) {
  domainState.isGetter
    ? ok("the Money domain's asOf is a live `get` accessor, not a static literal, so it can't drift from the real data")
    : bad("the Money domain's asOf is a plain value, not derived live from G.store.finance().asOf");
  (typeof domainState.asOfValue === "string" && /^\d{4}$/.test(domainState.asOfValue))
    ? ok("the derived asOf resolves to a bare 4-digit year (" + domainState.asOfValue + "), parseable by ageOf()")
    : bad("the derived asOf did not resolve to a bare year: " + JSON.stringify(domainState.asOfValue));
  (domainState.realFinanceAsOf && domainState.asOfValue && domainState.realFinanceAsOf.indexOf(domainState.asOfValue) !== -1)
    ? ok("the derived year (" + domainState.asOfValue + ") actually appears in G.store.finance().asOf's real text, confirming it was extracted, not invented")
    : bad("the derived year does not appear inside the real finance.asOf text: derived=" + JSON.stringify(domainState.asOfValue) + " real=" + JSON.stringify(domainState.realFinanceAsOf));
}

// ============================================================================
// Part 1: the rendered #/currency screen shows a card for Money with a real
// computed age (not the "unknown"/grey fallback used when a stamp can't be
// parsed), matching the app's own seeded finance.asOf year.
// ============================================================================
const rendered1 = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card-results-grid .panel")];
  const card = cards.find((c) => /Open Money\b/.test(c.textContent || ""));
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
  ? ok("the Freshness (#/currency) screen renders a card with an 'Open Money' button")
  : bad("no card with an 'Open Money' button found on #/currency: " + JSON.stringify(rendered1));
if (rendered1.found) {
  /unknown/i.test(rendered1.ageText || "") || rendered1.ageText === "—"
    ? bad("the Money card's age reads as unknown/em-dash even though finance.asOf is seeded with a real year: " + JSON.stringify(rendered1.ageText))
    : ok("the Money card shows a real computed age, not the 'unknown' fallback: " + JSON.stringify(rendered1.ageText));
  /months? old|this month/i.test(rendered1.text)
    ? ok("the card body reports an age in months, same shape as every other domain card")
    : bad("the card body did not contain the expected 'N months old' / 'this month' age text");
}

// ============================================================================
// Part 2: mutate the SEED's finance.asOf to a stale year (window.GUIDON_SEED
// and state.seed.finance are the same object per loadContent() in
// index.html - a direct reference, not a clone) and confirm the Freshness
// screen's Money card moves to reflect it on the next render - proving this
// reads the live field instead of a value captured once at module load.
// ============================================================================
await page.evaluate(() => {
  window.GUIDON_SEED.finance.asOf = "TSP/BRS rules current as of 2019 (stale test stamp)";
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
  const entry = D.find((d) => d.link === "#/money");
  const cards = [...document.querySelectorAll(".card-results-grid .panel")];
  const card = cards.find((c) => /Open Money\b/.test(c.textContent || ""));
  return {
    liveAsOf: entry ? entry.asOf : null,
    ageText: card ? (card.querySelector("span.v") || {}).textContent : null,
    cardText: card ? card.textContent : null,
    borderColor: card ? card.style.borderLeft : null,
  };
});

rendered2.liveAsOf === "2019"
  ? ok("after mutating window.GUIDON_SEED.finance.asOf to a 2019 stamp, the live getter now returns \"2019\"")
  : bad("the live asOf getter did not pick up the mutated seed value: " + JSON.stringify(rendered2.liveAsOf));
/verify before you rely on it/i.test(rendered2.cardText || "")
  ? ok("the re-rendered Money card now shows the red 'verify before you rely on it' status for a ~7-year-stale stamp")
  : bad("the re-rendered Money card did not flip to the red/verify status after the seed went stale: " + JSON.stringify(rendered2.cardText));
(rendered2.borderColor && /red/.test(rendered2.borderColor))
  ? ok("the card's left border switched to var(--red), matching every other stale domain card's styling")
  : bad("the card's border color did not switch to red: " + JSON.stringify(rendered2.borderColor));
(rendered1.ageText !== rendered2.ageText)
  ? ok("the displayed age text changed between the two renders (" + JSON.stringify(rendered1.ageText) + " -> " + JSON.stringify(rendered2.ageText) + "), confirming this is computed live, not cached")
  : bad("the displayed age text did not change after the underlying data changed");

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `CURRENCY/FINANCE: ${fails} FAILURE(S)` : "CURRENCY/FINANCE: all passed"));
process.exit(fails ? 1 : 0);
