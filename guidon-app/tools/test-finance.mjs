/**
 * Unit tests for G.finance's two pure calculators (BRS & TSP tab):
 * fvContributions() (compound-growth projector) and matchDollars() (BRS
 * match calculator). Both are exposed on window.G.finance specifically to
 * be testable in isolation, same pattern as G.pointsMath (see
 * test-points.mjs) - but neither had a dedicated test before this.
 *
 * matchDollars() is checked against the documented BRS match formula
 * (dollar-for-dollar on the first 3%, 50c per dollar on the next 2%, capped
 * at 4%, plus the 1% automatic) with hand-computed dollar values at a fixed
 * $3,000 basic pay. fvContributions() is checked against a standard
 * compound-interest constant (1.01^12 = 1.126825030...) plus the input
 * clamps called out in the source comments (negative rate floored at 0% so
 * Math.pow can't sign-flip, negative monthly/basicPay floored at $0, yourPct
 * capped at the input's declared 60% max - all of which only matter because
 * <input type=number> min/max never stops a typed-in out-of-range value from
 * reaching these functions).
 *
 * Also covers the upper-bound half of that same clamp on fvContributions()'s
 * annualRatePct: it used to floor at 0% (Math.max(0, ...)) with no matching
 * Math.min ceiling, so a large typed "assumed annual return %" pushed
 * Math.pow(1+r, n) past Number.MAX_VALUE and the projector's headline dollar
 * figure silently rendered "$∞" instead of a number - the same class of
 * unguarded-input bug matchDollars() already defends against on yourPct. The
 * fix clamps annualRatePct to the projector's own declared max=15 the same
 * shape matchDollars() uses (Math.min(N, Math.max(0, ...))). Checked both at
 * the pure-function level and by actually typing an oversized rate into the
 * live "Assumed annual return %" field on #/money and reading the rendered
 * headline - not just re-deriving the math from source.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(600);

const exposed = await page.evaluate(() => !!(window.G && window.G.finance && window.G.finance.fvContributions && window.G.finance.matchDollars));
if (!exposed) { bad("G.finance.fvContributions / matchDollars not exposed - cannot verify"); }
else {
  ok("G.finance.fvContributions and G.finance.matchDollars exposed");

  // ---- matchDollars: BRS match formula, hand-computed against $3,000 basic pay ----
  const matchCases = [
    { pct: 0,  want: { yours: 0,   auto: 30, match: 0,   govTotal: 30,  allTotal: 30,  capturedFull: false } },
    { pct: 3,  want: { yours: 90,  auto: 30, match: 90,  govTotal: 120, allTotal: 210, capturedFull: false } },
    { pct: 4,  want: { yours: 120, auto: 30, match: 105, govTotal: 135, allTotal: 255, capturedFull: false } },
    { pct: 5,  want: { yours: 150, auto: 30, match: 120, govTotal: 150, allTotal: 300, capturedFull: true  } },
    { pct: 10, want: { yours: 300, auto: 30, match: 120, govTotal: 150, allTotal: 450, capturedFull: true  } },
  ];
  const matchGot = await page.evaluate((cases) => cases.map((c) => window.G.finance.matchDollars(3000, c.pct)), matchCases);
  const matchBad = [];
  matchCases.forEach((c, i) => {
    for (const k of Object.keys(c.want)) {
      if (matchGot[i][k] !== c.want[k]) matchBad.push(`pct=${c.pct} ${k}: expected ${c.want[k]}, got ${matchGot[i][k]}`);
    }
  });
  matchBad.length === 0
    ? ok(`matchDollars: all ${matchCases.length} BRS match tiers correct ($3,000 basic pay)`)
    : bad(`matchDollars mismatches: ${matchBad.join("; ")}`);

  // ---- matchDollars: input clamping (documented in the source comments) ----
  const clamp = await page.evaluate(() => ({
    overMaxPct: window.G.finance.matchDollars(3000, 9999),  // input declares max=60, uncapped without the clamp
    negBasicPay: window.G.finance.matchDollars(-1000, 5),
    negPct: window.G.finance.matchDollars(3000, -5),
  }));
  clamp.overMaxPct.yours === 1800 && clamp.overMaxPct.match === 120
    ? ok("matchDollars clamps yourPct to the 60% input max (9999% -> 60%)")
    : bad("matchDollars at pct=9999: " + JSON.stringify(clamp.overMaxPct));
  clamp.negBasicPay.yours === 0 && clamp.negBasicPay.allTotal === 0
    ? ok("matchDollars floors a negative basic pay at $0")
    : bad("matchDollars at basicPay=-1000: " + JSON.stringify(clamp.negBasicPay));
  clamp.negPct.yours === 0 && clamp.negPct.match === 0
    ? ok("matchDollars floors a negative contribution % at 0%")
    : bad("matchDollars at pct=-5: " + JSON.stringify(clamp.negPct));

  // ---- fvContributions: exact compound-growth value against a standard constant ----
  // 1.01^12 = 1.126825030... (nominal 12%/yr compounded monthly -> 12.6825% effective)
  const fv1 = await page.evaluate(() => window.G.finance.fvContributions(1000, 1, 12));
  (fv1.future === 12683 && fv1.contributed === 12000 && fv1.growth === 683)
    ? ok("fvContributions($1,000/mo, 1yr, 12%): matches the textbook compound-interest constant")
    : bad("fvContributions(1000,1,12) = " + JSON.stringify(fv1));

  // ---- fvContributions: 0% rate is simple, non-compounding addition ----
  const fv0 = await page.evaluate(() => window.G.finance.fvContributions(200, 10, 0));
  (fv0.future === 24000 && fv0.contributed === 24000 && fv0.growth === 0)
    ? ok("fvContributions at 0% rate: future equals contributed exactly, zero growth")
    : bad("fvContributions(200,10,0) = " + JSON.stringify(fv0));

  // ---- fvContributions: zero-year horizon contributes and grows nothing ----
  const fvZero = await page.evaluate(() => window.G.finance.fvContributions(500, 0, 7));
  (fvZero.future === 0 && fvZero.contributed === 0 && fvZero.growth === 0)
    ? ok("fvContributions at a zero-year horizon returns all zeros")
    : bad("fvContributions(500,0,7) = " + JSON.stringify(fvZero));

  // ---- fvContributions: negative rate floored at 0% (the documented risk in the source) ----
  const fvNegRate = await page.evaluate(() => window.G.finance.fvContributions(300, 5, -50));
  (fvNegRate.future === 18000 && fvNegRate.growth === 0)
    ? ok("fvContributions floors a negative rate at 0% (no sign-flipped Math.pow blowup)")
    : bad("fvContributions(300,5,-50) = " + JSON.stringify(fvNegRate));

  // ---- fvContributions: rate clamped to the input's declared 15% max (the fix under test) ----
  // Before the fix, annualRatePct only had a Math.max(0, ...) floor and no
  // matching Math.min ceiling, so 999999% at 20yr overflows Math.pow(1+r,n)
  // straight to Infinity (future/growth both Infinity, not just "big"). A
  // clamped 999999% must come out byte-identical to a clamped 15% - proving
  // the ceiling actually engages rather than merely capping the display.
  const fvOverRate = await page.evaluate(() => window.G.finance.fvContributions(500, 20, 999999));
  const fvAtCeiling = await page.evaluate(() => window.G.finance.fvContributions(500, 20, 15));
  (Number.isFinite(fvOverRate.future) && fvOverRate.future === fvAtCeiling.future && fvOverRate.growth === fvAtCeiling.growth)
    ? ok(`fvContributions clamps annualRatePct to the 15% input max (999999% -> 15%, future=${fvOverRate.future})`)
    : bad("fvContributions(500,20,999999) = " + JSON.stringify(fvOverRate) + ", expected to match the 15% clamp " + JSON.stringify(fvAtCeiling));

  // ---- fvContributions: negative monthly contribution floored at $0 ----
  const fvNegMonthly = await page.evaluate(() => window.G.finance.fvContributions(-100, 5, 7));
  (fvNegMonthly.future === 0 && fvNegMonthly.contributed === 0 && fvNegMonthly.growth === 0)
    ? ok("fvContributions floors a negative monthly contribution at $0")
    : bad("fvContributions(-100,5,7) = " + JSON.stringify(fvNegMonthly));

  // ---- fvContributions: growth increases monotonically with rate ----
  const monotonic = await page.evaluate(() => ({
    a: window.G.finance.fvContributions(300, 20, 4).growth,
    b: window.G.finance.fvContributions(300, 20, 8).growth,
  }));
  monotonic.b > monotonic.a
    ? ok("fvContributions: growth increases with a higher assumed rate (8% > 4% over 20yr)")
    : bad("growth at 8% (" + monotonic.b + ") not greater than growth at 4% (" + monotonic.a + ")");

  // ---- fvContributions: the live "Compound-growth projector" headline can't render $∞ ----
  // Reproduces the actual reported symptom end-to-end: type an oversized
  // rate into the real #/money "Assumed annual return %" field (not just
  // call the calculator function) and read what the headline dollar figure
  // actually renders. Against the pre-fix code this reads literally "$∞" -
  // (Infinity).toLocaleString("en-US") === "∞" - because money(r.future)
  // formats whatever fvContributions() hands back with no finite-check of
  // its own (unlike the bar-segment width just below it, which already had
  // an explicit Number.isFinite guard - see the fin-bar code and its
  // comment in index.html).
  const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guestCard.count()) {
    await guestCard.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = "#/money"; });
  await page.waitForTimeout(600);

  const rIn = page.locator(".fin-calc-row input").nth(4); // 5th input on the BRS & TSP tab: "Assumed annual return %"
  const rLabelOk = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".fin-calc-row")];
    const row = rows[4];
    return !!row && /Assumed annual return/.test(row.querySelector("label").textContent || "");
  });
  rLabelOk
    ? ok("located the live 'Assumed annual return %' input (5th .fin-calc-row on #/money)")
    : bad("the 5th .fin-calc-row on #/money was not the 'Assumed annual return %' field - selector needs updating");

  await rIn.fill("999999");
  await page.waitForTimeout(300); // past the 60ms reproj() debounce
  const headline = await page.evaluate(() => (document.querySelector(".fin-proj-num") || {}).textContent || "");
  const [mVal, yVal] = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".fin-calc-row")];
    return [Number(rows[2].querySelector("input").value), Number(rows[3].querySelector("input").value)];
  });
  const expected = await page.evaluate((args) => {
    const r = window.G.finance.fvContributions(args[0], args[1], 15);
    return "$" + r.future.toLocaleString("en-US");
  }, [mVal, yVal]);
  (!/[∞]|Infinity|NaN/.test(headline) && headline === expected)
    ? ok(`projector headline survives a 999999% typed rate: renders ${headline} (the 15%-clamped value), not "$∞"`)
    : bad(`projector headline at rate=999999% was "${headline}", expected "${expected}" and no ∞/Infinity/NaN`);
}

await browser.close();
server.close();
console.log("\n" + (fails ? `FINANCE: ${fails} FAILURE(S)` : "FINANCE: all passed"));
process.exit(fails ? 1 : 0);
