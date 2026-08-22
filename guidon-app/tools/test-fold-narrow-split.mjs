/**
 * Tier 2 of the intuitivism pass (2026-08-22, explicitly requested by the
 * user as the one Tier 2 refinement worth doing): UA-Client-Hints splits a
 * Z Fold5 back out of the >=800px labeled 208px rail, which it otherwise
 * shares with a Tab S9 FE in portrait - the two land within 18px of each
 * other and pure CSS width can't tell them apart on its own.
 *
 * The user-facing contract, all at the SAME 823px viewport width (Tab S9 FE
 * portrait's real measured width - deliberately not a Fold width, since the
 * whole point is that width alone is ambiguous here):
 *   - a recognized Fold model (SM-F9xx prefix) gets the compact 96px rail
 *   - a future Fold model sharing that prefix (Fold6/7/8) still matches -
 *     the plan's own stated risk ("silently stops matching on a Fold6")
 *     for the exact-model-string approach it warned against
 *   - a non-Fold model (Tab S9 FE itself) keeps the labeled 208px rail -
 *     today's shipped default, unchanged
 *   - no userAgentData at all (older WebView, non-Chromium, iOS) ALSO
 *     keeps the labeled 208px rail - the graceful-degradation path the
 *     plan required ("zero signal on iOS" must never mean "broken on iOS")
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function railWidthFor(model, { hasUAData = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 823, height: 1300 } });
  const page = await ctx.newPage();
  // Installed before any page script runs, so the app's own boot-time
  // detection (which fires immediately, before renderNav()) sees this
  // exact mock - not a real device, but the same shape the real API has.
  await page.addInitScript(({ m, has }) => {
    if (!has) return; // simulate a browser/WebView with no userAgentData at all
    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: { getHighEntropyValues: async () => ({ model: m }) },
    });
  }, { m: model, has: hasUAData });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => {
    const app = document.querySelector("#app");
    const cs = getComputedStyle(app);
    return {
      railWidth: Math.round(parseFloat(cs.gridTemplateColumns.split(" ")[0])),
      hasFoldClass: document.documentElement.classList.contains("device-fold-narrow"),
    };
  });
  await ctx.close();
  return info;
}

const fold5 = await railWidthFor("SM-F946U");
fold5.hasFoldClass ? ok("SM-F946U (real Z Fold5 model): device-fold-narrow class applied") : bad("class not applied for SM-F946U");
fold5.railWidth === 96 ? ok(`SM-F946U gets the compact 96px rail at 823px width (got ${fold5.railWidth}px)`) : bad(`SM-F946U rail width: ${fold5.railWidth}px, expected 96px`);

const futureFold = await railWidthFor("SM-F966U");
futureFold.hasFoldClass ? ok("SM-F966U (hypothetical future Fold, same SM-F9xx prefix): class still applied - the prefix match generalizes") : bad("prefix match failed for a hypothetical future Fold model");
futureFold.railWidth === 96 ? ok(`SM-F966U also gets the compact rail (got ${futureFold.railWidth}px)`) : bad(`SM-F966U rail width: ${futureFold.railWidth}px, expected 96px`);

const tabS9 = await railWidthFor("SM-X518U");
tabS9.hasFoldClass ? bad("SM-X518U (Tab S9 FE, non-Fold) incorrectly got the fold class") : ok("SM-X518U (Tab S9 FE): no fold class - not a Fold-prefix model");
tabS9.railWidth === 208 ? ok(`SM-X518U keeps the labeled 208px rail, unchanged (got ${tabS9.railWidth}px)`) : bad(`SM-X518U rail width: ${tabS9.railWidth}px, expected 208px`);

const noApi = await railWidthFor(null, { hasUAData: false });
noApi.hasFoldClass ? bad("no userAgentData at all incorrectly got the fold class") : ok("no userAgentData (older WebView/non-Chromium/iOS): no fold class");
noApi.railWidth === 208 ? ok(`no userAgentData still gets the labeled 208px rail - graceful degradation to the shipped default (got ${noApi.railWidth}px)`) : bad(`no-API rail width: ${noApi.railWidth}px, expected 208px`);

const zFlip = await railWidthFor("SM-F721U"); // Z Flip - SM-F7xx, deliberately NOT SM-F9xx
zFlip.hasFoldClass ? bad("SM-F721U (Z Flip, SM-F7xx) incorrectly matched the Fold-only SM-F9xx pattern") : ok("SM-F721U (Z Flip): correctly does NOT match - the pattern is Fold-specific (F9xx), not any Samsung fold-form-factor device");

console.log(fails === 0 ? "\nFOLD-NARROW SPLIT: all passed" : `\nFOLD-NARROW SPLIT: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
