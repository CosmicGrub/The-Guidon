/**
 * Off-device unit tests for native.js's (src/native.js, global G.native)
 * PURE color/luminance functions, plus a regression test for the "false
 * coverage" fix to Diagnostics' (selftest.js) "Status bar theming" check.
 *
 * native.js's own header says "Only does anything inside a Capacitor build.
 * In a browser... every function here is a no-op" — true for the STATEFUL
 * parts (applySystemBars, watchTheme, the back-button wiring), but
 * parseColor()/toHex()/luminance()/token() are pure functions with no
 * platform dependency at all. They were already exposed for exactly this
 * purpose (`G.native._debug`, "exposed for the on-device test harness" per
 * native.js's own comment) but nothing actually exercised them off-device
 * until this suite (task #238) — meaning a real regression in the bar-colour
 * decision logic could ship and no automated run (which is 100% web/CI,
 * never a real Android device) would ever catch it.
 *
 * The second half of this file is a regression test for the companion fix:
 * Diagnostics' "Status bar theming" automated check used to unconditionally
 * return {ok:true} on any non-native run (i.e. every single automated run)
 * without touching any real logic — a false-coverage trap where the check
 * always shows green regardless of whether the underlying decision logic is
 * broken. The fix makes it actually call G.native._debug's pure functions
 * off-device and fail if they misbehave; this test proves that by breaking
 * parseColor() and confirming the Diagnostics check now genuinely fails.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

// native.js is injected only into web/index.html by build.mjs (packaging
// content, alongside pdf-defer.js/notify.js/pwa.js) - NOT into
// dist/guidon-standalone.html, which only gets src/app-modules/*.js. So
// G.native (and _debug) simply does not exist on the standalone build; this
// suite must run against the web/ build, same as tools/test-selftest.mjs.
const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await browser.newPage();
const noise = [];
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") noise.push("console.error: " + m.text()); });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
// web/index.html boots into onboarding on a fresh profile - skip through it
// via the Guest Session card, same pattern as tools/test-selftest.mjs.
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);
await page.waitForFunction(() => window.G && window.G.native && window.G.native._debug);

// 0) Sanity: we're in the normal (non-native) web context this whole file
//    is about — G.native.isNative() must be false here, or the "off-device"
//    framing below is meaningless.
const platform = await page.evaluate(() => ({ isNative: window.G.native.isNative(), hasDebug: !!window.G.native._debug }));
!platform.isNative
  ? ok("running in the normal (non-native) web context — G.native.isNative() is false, as expected off-device")
  : bad("unexpectedly running in a native context; this suite's whole premise assumes web");
platform.hasDebug
  ? ok("G.native._debug is exposed with the pure functions this suite tests")
  : bad("G.native._debug missing — cannot test off-device");

// 1) parseColor(): #rgb, #rrggbb, rgb(), rgba(), and invalid input.
const parseColorCases = await page.evaluate(() => {
  const p = window.G.native._debug.parseColor;
  return {
    shortHex: p("#f0a"),
    longHex: p("#ff00aa"),
    rgbFn: p("rgb(255, 0, 170)"),
    rgbaFn: p("rgba(255, 0, 170, 0.5)"),
    upperHex: p("#FF00AA"),
    whitespace: p("  #ff00aa  "),
    invalid: p("not-a-color"),
    empty: p(""),
    nullish: p(null),
  };
});
JSON.stringify(parseColorCases.shortHex) === JSON.stringify([255, 0, 170])
  ? ok("parseColor() expands 3-digit hex (#f0a) to the correct [r,g,b]")
  : bad("shortHex: " + JSON.stringify(parseColorCases.shortHex));
JSON.stringify(parseColorCases.longHex) === JSON.stringify([255, 0, 170])
  ? ok("parseColor() parses 6-digit hex (#ff00aa) correctly")
  : bad("longHex: " + JSON.stringify(parseColorCases.longHex));
JSON.stringify(parseColorCases.rgbFn) === JSON.stringify([255, 0, 170])
  ? ok("parseColor() parses rgb() function notation correctly")
  : bad("rgbFn: " + JSON.stringify(parseColorCases.rgbFn));
JSON.stringify(parseColorCases.rgbaFn) === JSON.stringify([255, 0, 170])
  ? ok("parseColor() parses rgba() function notation correctly (alpha channel ignored, not needed for bar colour)")
  : bad("rgbaFn: " + JSON.stringify(parseColorCases.rgbaFn));
JSON.stringify(parseColorCases.upperHex) === JSON.stringify([255, 0, 170])
  ? ok("parseColor() is case-insensitive on hex digits")
  : bad("upperHex: " + JSON.stringify(parseColorCases.upperHex));
JSON.stringify(parseColorCases.whitespace) === JSON.stringify([255, 0, 170])
  ? ok("parseColor() tolerates surrounding whitespace (a real getComputedStyle() habit)")
  : bad("whitespace: " + JSON.stringify(parseColorCases.whitespace));
parseColorCases.invalid === null && parseColorCases.empty === null && parseColorCases.nullish === null
  ? ok("parseColor() returns null for unparseable/empty/null input, rather than throwing or returning garbage")
  : bad("invalid inputs did not all return null: " + JSON.stringify({ i: parseColorCases.invalid, e: parseColorCases.empty, n: parseColorCases.nullish }));

// 2) toHex(): round-trips with parseColor, and clamps out-of-range components.
const toHexCases = await page.evaluate(() => {
  const d = window.G.native._debug;
  return {
    roundTrip: d.toHex(d.parseColor("#ff00aa")),
    black: d.toHex([0, 0, 0]),
    white: d.toHex([255, 255, 255]),
    clampHigh: d.toHex([300, -20, 128]),
    rounds: d.toHex([127.6, 127.4, 0]),
  };
});
toHexCases.roundTrip.toLowerCase() === "#ff00aa"
  ? ok("toHex(parseColor(x)) round-trips back to the original hex string")
  : bad("round-trip: " + toHexCases.roundTrip);
toHexCases.black === "#000000" && toHexCases.white === "#ffffff"
  ? ok("toHex() renders pure black/white correctly")
  : bad("black/white: " + JSON.stringify(toHexCases));
toHexCases.clampHigh === "#ff0080"
  ? ok("toHex() clamps out-of-range components into 0-255 before hex-encoding (300→255=ff, -20→0=00)")
  : bad("clampHigh: " + toHexCases.clampHigh + " (expected #ff0080)");
toHexCases.rounds === "#807f00"
  ? ok("toHex() rounds fractional components to the nearest integer (127.6→128=0x80, 127.4→127=0x7f)")
  : bad("rounds: " + toHexCases.rounds + " (expected #807f00)");

// 3) luminance(): WCAG relative luminance — known reference values.
const lumCases = await page.evaluate(() => {
  const lum = window.G.native._debug.luminance;
  return { black: lum([0, 0, 0]), white: lum([255, 255, 255]), midGray: lum([128, 128, 128]) };
});
lumCases.black === 0
  ? ok("luminance([0,0,0]) is exactly 0 (pure black)")
  : bad("black luminance: " + lumCases.black);
Math.abs(lumCases.white - 1) < 0.0001
  ? ok("luminance([255,255,255]) is ~1 (pure white)")
  : bad("white luminance: " + lumCases.white);
lumCases.midGray > 0.15 && lumCases.midGray < 0.3
  ? ok("luminance([128,128,128]) falls in the expected mid-gray band (WCAG luminance is perceptually nonlinear, not literally 0.5) — got " + lumCases.midGray.toFixed(3))
  : bad("midGray luminance out of expected band: " + lumCases.midGray);
// The exact 0.5 threshold applySystemBars() uses to decide LIGHT vs DARK icon style.
const thresholdCheck = await page.evaluate(() => {
  const d = window.G.native._debug;
  return {
    darkBg: d.luminance(d.parseColor("#0a0e12")) > 0.5,   // GUIDON's own default dark --bg fallback
    lightBg: d.luminance(d.parseColor("#f5f5f0")) > 0.5,  // a representative light theme background
  };
});
thresholdCheck.darkBg === false && thresholdCheck.lightBg === true
  ? ok("the light/dark decision threshold (luminance > 0.5) correctly classifies a dark and a light background")
  : bad("threshold misclassified: " + JSON.stringify(thresholdCheck));

// 4) token(): resolves a real CSS custom property from the live document,
//    and falls back when the property is missing/empty.
const tokenCases = await page.evaluate(() => {
  const d = window.G.native._debug;
  document.documentElement.style.setProperty("--__unit_test_token", "#123456");
  const resolved = d.token("--__unit_test_token", "#fallback");
  document.documentElement.style.removeProperty("--__unit_test_token");
  const fellBack = d.token("--__nonexistent_token_xyz", "#fallback");
  const realBg = d.token("--bg", "#fallback");
  return { resolved, fellBack, realBg };
});
tokenCases.resolved === "#123456"
  ? ok("token() resolves a real CSS custom property set on <html>")
  : bad("resolved: " + tokenCases.resolved);
tokenCases.fellBack === "#fallback"
  ? ok("token() returns the fallback when the custom property doesn't exist")
  : bad("fellBack: " + tokenCases.fellBack);
tokenCases.realBg && tokenCases.realBg !== "#fallback"
  ? ok("token('--bg', ...) resolves the app's real theme background token (" + tokenCases.realBg + ")")
  : bad("real --bg token did not resolve: " + JSON.stringify(tokenCases.realBg));

// 5) Regression test for the false-coverage fix: Diagnostics' "Status bar
//    theming" check must now genuinely FAIL off-device if the underlying
//    decision logic breaks, not unconditionally pass. Monkey-patch
//    parseColor() to return garbage and confirm the check reports failure.
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(300);

// Real card structure per selftest.js's render(): each result is a
// `.card` whose `.ob-plan-cat` reads "✓ <name>" or "✕ <name>" and whose
// (first) `.hint` holds the detail text.
async function statusBarCardText() {
  return page.evaluate(() => {
    const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
    const cat = cats.find((n) => /status bar theming/i.test(n.textContent || ""));
    if (!cat) return null;
    const card = cat.closest(".card");
    return card ? card.textContent : null;
  });
}

const runBtn = page.locator("button", { hasText: /Run automated checks/ });
const runAgainBtn = page.locator("button", { hasText: /Run again/ });
let trapClosed = { ranBaseline: false, ranBroken: false };

if (await runBtn.count()) {
  await runBtn.click();
  await page.waitForTimeout(400);
  trapClosed.ranBaseline = true;
  trapClosed.baselineText = await statusBarCardText();

  // Break parseColor() so the check's own logic, if it's really exercising
  // that function, must fail.
  await page.evaluate(() => {
    const dbg = window.G.native._debug;
    window.__origParseColor = dbg.parseColor;
    dbg.parseColor = () => ["not", "a", "number"]; // invalid triple -> validRgb should be false
  });
  await runAgainBtn.click();
  await page.waitForTimeout(400);
  trapClosed.ranBroken = true;
  trapClosed.brokenText = await statusBarCardText();

  await page.evaluate(() => { window.G.native._debug.parseColor = window.__origParseColor; delete window.__origParseColor; });
} else {
  bad("could not find the 'Run automated checks' button on #/selftest");
}

if (!trapClosed.ranBaseline || !trapClosed.ranBroken) {
  bad("could not drive both runs of the Diagnostics automated-check suite: " + JSON.stringify(trapClosed));
} else {
  const baselinePassed = trapClosed.baselineText && trapClosed.baselineText.indexOf("✓") !== -1;
  const brokenFailed = trapClosed.brokenText && trapClosed.brokenText.indexOf("✕") !== -1;
  baselinePassed
    ? ok("baseline (unbroken) run: 'Status bar theming' passes off-device with real --bg data")
    : bad("baseline run unexpectedly failed or card not found: " + trapClosed.baselineText);
  brokenFailed
    ? ok("with parseColor() deliberately broken, 'Status bar theming' now correctly FAILS off-device (the false-coverage trap is closed — task #238)")
    : bad("'Status bar theming' still passed (or card not found) even with parseColor() broken — the false-coverage trap is NOT closed: " + trapClosed.brokenText);
}

noise.length === 0
  ? ok("no unexpected console errors/page errors")
  : bad(`${noise.length} unexpected console/page error(s); first: ${noise[0]}`);

await browser.close();
await server.close();
console.log("\n" + (fails ? `NATIVE UNIT: ${fails} FAILURE(S)` : "NATIVE UNIT: all passed"));
process.exit(fails ? 1 : 0);
