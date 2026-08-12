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
}

await browser.close();
server.close();
console.log("\n" + (fails ? `FINANCE: ${fails} FAILURE(S)` : "FINANCE: all passed"));
process.exit(fails ? 1 : 0);
