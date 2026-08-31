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
 *
 * Roadmap audit round 4, "Test coverage gaps for previously-fixed bug
 * classes" bucket: added coverage for the other two live-getter DOMAINS
 * entries, Fitness and Assignments, which share ONE parser (monthYearStamp())
 * distinct from financeAsOfStamp()/careerAsOfStamp() above - and, since that
 * shared parser's own malformed-stamp/selfheal-dedup fallback path had zero
 * coverage anywhere (not even for Career/Finance's dedicated functions),
 * added a case for it too (Part 5).
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

// ============================================================================
// Roadmap audit round 4, "Test coverage gaps for previously-fixed bug
// classes" bucket: Fitness and Assignments are the other two DOMAINS entries
// with a live `get asOf()` accessor - but unlike Career/Finance above,
// neither derives through its own dedicated stamp function. Both share ONE
// parser, monthYearStamp() (currency.js), which reads G.fitness.AS_OF /
// G.assignments.AS_OF ("Month YYYY" prose each module already displays as
// its own in-page disclaimer) and converts it to the bare YYYY-MM ageOf()
// expects - and, on a parse failure, falls back to null ("unknown" in the
// UI) and logs via G.selfheal exactly once per moduleName, same dedup-flag
// shape as financeAsOfStamp()/careerAsOfStamp() above. Until now nothing
// exercised either domain's own card, nor the shared parser's fallback path
// at all - not even for Career/Finance's own dedicated functions.
// ============================================================================
async function checkMonthYearDomain(linkHash, shortLabel, moduleName) {
  const state = await page.evaluate(({ linkHash, moduleName }) => {
    const D = window.G.currency.DOMAINS;
    const entry = D.find((d) => d.link === linkHash);
    if (!entry) return { found: false };
    const desc = Object.getOwnPropertyDescriptor(entry, "asOf");
    return {
      found: true,
      isGetter: !!(desc && typeof desc.get === "function"),
      asOfValue: entry.asOf,
      realAsOf: window.G[moduleName] && window.G[moduleName].AS_OF,
    };
  }, { linkHash, moduleName });
  state.found
    ? ok("DOMAINS has an entry linking to " + linkHash + " (" + shortLabel + ")")
    : bad("no DOMAINS entry links to " + linkHash);
  if (state.found) {
    state.isGetter
      ? ok("the " + shortLabel + " domain's asOf is a live `get` accessor reading G." + moduleName + ".AS_OF via the shared monthYearStamp() parser")
      : bad("the " + shortLabel + " domain's asOf is a plain value, not derived live");
    /^\d{4}-\d{2}$/.test(state.asOfValue)
      ? ok("the derived asOf resolves to a bare YYYY-MM stamp (" + state.asOfValue + "), parseable by ageOf(), from the real \"" + state.realAsOf + "\" source string")
      : bad("the derived asOf did not resolve to a bare YYYY-MM: " + JSON.stringify(state.asOfValue));
  }

  const rendered = await page.evaluate((shortLabel) => {
    // Match against the button's OWN trimmed text, not the whole card's
    // concatenated textContent - Fitness's card also carries a "Read the
    // source" library cross-link button immediately after "Open Fitness"
    // with no separating whitespace in textContent ("...Open FitnessRead
    // the source..."), so a trailing \b word-boundary regex against the
    // full card text silently never matches (s->R is a word-to-word
    // transition, not a boundary) for any domain that also has a
    // libraryId, even though the button itself is right there.
    const cards = [...document.querySelectorAll(".card-results-grid .panel")];
    const card = cards.find((c) => [...c.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Open " + shortLabel));
    if (!card) return { found: false };
    const v = card.querySelector(".k + .v, span.v");
    return { found: true, ageText: v ? v.textContent : null };
  }, shortLabel);
  rendered.found
    ? ok("the Freshness screen renders a card with an 'Open " + shortLabel + "' button")
    : bad("no card with an 'Open " + shortLabel + "' button found");
  if (rendered.found) {
    (/unknown/i.test(rendered.ageText || "") || rendered.ageText === "—")
      ? bad("the " + shortLabel + " card's age reads unknown/em-dash even though AS_OF is a real \"Month YYYY\" stamp: " + JSON.stringify(rendered.ageText))
      : ok("the " + shortLabel + " card shows a real computed age, not the 'unknown' fallback: " + JSON.stringify(rendered.ageText));
  }
}
await checkMonthYearDomain("#/fitness", "Fitness", "fitness");
await checkMonthYearDomain("#/assignments", "Assignments", "assignments");

// ============================================================================
// Part 5: the shared parser's malformed-stamp fallback. monthYearStamp()
// only accepts a literal "Month YYYY" string - if G.fitness.AS_OF ever
// stops matching that shape (a typo, a reformat), the Fitness domain must
// fall back to "unknown" (not throw, not silently compute a wrong age) AND
// log via G.selfheal exactly ONCE per session, even though #/currency's own
// render() reads d.asOf multiple times per call (once per sort comparison,
// again for display - see monthYearStamp()'s own comment) and even across
// TWO separate renders here.
// ============================================================================
await page.evaluate(() => { window.G.fitness.AS_OF = "not a real month-year stamp"; });
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/currency"; });
await page.waitForTimeout(500);
const malformed1 = await page.evaluate(() => {
  // Same button-text match as checkMonthYearDomain() above, not a regex
  // against the whole card's textContent - see that function's own comment.
  const cards = [...document.querySelectorAll(".card-results-grid .panel")];
  const card = cards.find((c) => [...c.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Open Fitness"));
  const v = card ? card.querySelector(".k + .v, span.v") : null;
  return { ageText: v ? v.textContent : null, cardText: card ? card.textContent : null };
});
(malformed1.ageText === "—" && /unknown/i.test(malformed1.cardText || ""))
  ? ok("a malformed Fitness AS_OF ('not a real month-year stamp') falls back to the '—'/unknown card instead of throwing or showing a wrong age")
  : bad("malformed Fitness AS_OF did not fall back to unknown: " + JSON.stringify(malformed1));

// Re-render a SECOND time with the same malformed value still in place - the
// per-moduleName dedup flag (_monthYearWarned.fitness) must still have
// logged only once total, from the first render's several reads, not once
// per render and not once per read.
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/currency"; });
await page.waitForTimeout(500);

const selfhealEntries = await page.evaluate(async () => {
  const list = (await window.G.selfheal.recent(50)) || [];
  return list.filter((e) => e.kind === "currency-derive-fail" && e.key === "fitness");
});
selfhealEntries.length === 1
  ? ok("G.selfheal.log fired exactly ONCE for the malformed Fitness stamp, even though it was read multiple times within one render and again across a second, separate render")
  : bad("expected exactly 1 selfheal entry for currency-derive-fail/fitness, got " + selfhealEntries.length + ": " + JSON.stringify(selfhealEntries));

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `CURRENCY/FINANCE: ${fails} FAILURE(S)` : "CURRENCY/FINANCE: all passed"));
process.exit(fails ? 1 : 0);
