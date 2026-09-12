/**
 * Nav overhaul Milestone 3: platform-flavor CSS for the phone-portrait
 * dock's own active-icon treatment (docs/design/nav-adaptive-rail.md
 * §4.5/§6 - iOS detection method chosen by the user: plain UA sniffing,
 * reusing G.pwa.isIOS()/isAndroid() (src/pwa.js), the SAME predicate
 * already proven out for #/share's own OS-aware download panel, rather
 * than a second, slightly-different detection written just for this).
 *
 * Covers, with no prior coverage anywhere else:
 *   1. A real iPhone UA -> data-nav-flavor="ios"; the dock gets a real
 *      backdrop-filter blur and a translucent background; the active
 *      icon is tint-only (no pill background at all).
 *   2. The specific "harder" gap §6 named: an iPad running iPadOS 13+,
 *      which masquerades as desktop Safari by default (a plain macOS UA,
 *      navigator.platform "MacIntel" + multi-touch) - isIOS()'s own
 *      fallback branch exists for exactly this, still resolves to "ios".
 *   3. A real Android UA -> data-nav-flavor="android"; the dock gets a
 *      solid elevated box-shadow (no blur) and the active icon becomes a
 *      real stadium-shaped pill (border-radius: 999px), not the shared
 *      subtle rounding every other tier uses.
 *   4. A plain desktop UA -> data-nav-flavor="desktop"; no shadow, no
 *      pill, no blur - byte-identical to Milestone 2's own baseline.
 *   5. The flavor CSS is scoped to the EXACT phone-portrait dock
 *      breakpoint only - the SAME device (Android UA) at a >=600px
 *      viewport renders the compact/labeled rail with zero flavor
 *      styling, confirming this doesn't leak into tiers that were never
 *      "a dock" in the OS sense to begin with.
 *   6. The boot-order bug found live while building this milestone:
 *      computeNavFlavor() depends on G.pwa, a module loaded by a LATER
 *      <script> tag than src/index.html's own main script - calling it
 *      eagerly at parse time silently read G.pwa before it existed and
 *      always fell through to "desktop". Regression-guarded here by
 *      simply asserting the iOS/Android cases above actually flip away
 *      from "desktop" at all, rather than only checking the CSS.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

// Same real device fingerprints tools/test-share-os-aware.mjs already uses
// for this exact isIOS()/isAndroid() pair - not invented fresh here.
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];

async function newPage(opts) {
  const page = await (await browser.newContext(opts || {})).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(`[${JSON.stringify(opts)}] ` + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push(`[${JSON.stringify(opts)}] pageerror: ` + e.message));
  return page;
}

async function readNavState(page) {
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const nav = document.querySelector(".nav");
    const active = document.querySelector(".nav :is(button, a).active");
    const cs = nav ? getComputedStyle(nav) : null;
    const acs = active ? getComputedStyle(active) : null;
    return {
      flavor: document.documentElement.getAttribute("data-nav-flavor"),
      navBoxShadow: cs ? cs.boxShadow : null,
      navBackdropFilter: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
      activeBorderRadius: acs ? acs.borderRadius : null,
      activeBackground: acs ? acs.backgroundColor : null,
    };
  });
}

// ============================================================
// PART 1 — real iPhone UA
// ============================================================
{
  const page = await newPage({ userAgent: IOS_UA, viewport: { width: 390, height: 844 } });
  const s = await readNavState(page);
  s.flavor === "ios" ? ok("real iPhone UA: data-nav-flavor=\"ios\"") : bad("iPhone UA flavor: " + s.flavor);
  s.navBackdropFilter && s.navBackdropFilter.indexOf("blur") !== -1
    ? ok(`iOS dock gets a real backdrop-filter blur (${s.navBackdropFilter})`)
    : bad("iOS dock backdrop-filter: " + s.navBackdropFilter);
  s.navBoxShadow === "none" ? ok("iOS dock has no box-shadow (translucency comes from the blur, not elevation)") : bad("iOS dock box-shadow: " + s.navBoxShadow);
  /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(s.activeBackground)
    ? ok(`iOS active icon is tint-only - no pill background at all (${s.activeBackground})`)
    : bad("iOS active icon background: " + s.activeBackground);
  await page.close();
}

// ============================================================
// PART 2 — the harder gap named in §6: an iPad on iPadOS 13+ masquerading
// as desktop Safari (plain macOS UA + navigator.platform/maxTouchPoints
// override) - isIOS()'s own fallback branch, not the primary UA regex.
// ============================================================
{
  const page = await newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
  });
  const s = await readNavState(page);
  s.flavor === "ios"
    ? ok("iPadOS masquerading as desktop Safari (MacIntel + multi-touch, no iPad/iPhone in the UA at all) still resolves to \"ios\"")
    : bad("masquerading-iPad flavor: " + s.flavor);
  await page.close();
}

// ============================================================
// PART 3 — real Android UA
// ============================================================
{
  const page = await newPage({ userAgent: ANDROID_UA, viewport: { width: 390, height: 844 } });
  const s = await readNavState(page);
  s.flavor === "android" ? ok("real Android UA: data-nav-flavor=\"android\"") : bad("Android UA flavor: " + s.flavor);
  s.navBoxShadow !== "none" ? ok(`Android dock gets a solid elevated box-shadow (${s.navBoxShadow})`) : bad("Android dock box-shadow: " + s.navBoxShadow);
  s.navBackdropFilter === "none" ? ok("Android dock has no blur - stays fully opaque, unlike iOS") : bad("Android dock backdrop-filter: " + s.navBackdropFilter);
  s.activeBorderRadius === "999px"
    ? ok("Android active icon is a real stadium-shaped pill (border-radius: 999px), not the shared subtle rounding")
    : bad("Android active icon border-radius: " + s.activeBorderRadius);
  await page.close();
}

// ============================================================
// PART 4 — plain desktop UA: byte-identical to Milestone 2's own baseline
// ============================================================
{
  const page = await newPage({ viewport: { width: 390, height: 844 } });
  const s = await readNavState(page);
  s.flavor === "desktop" ? ok("plain desktop UA: data-nav-flavor=\"desktop\"") : bad("desktop UA flavor: " + s.flavor);
  s.navBoxShadow === "none" ? ok("desktop dock has no box-shadow") : bad("desktop dock box-shadow: " + s.navBoxShadow);
  s.navBackdropFilter === "none" ? ok("desktop dock has no blur") : bad("desktop dock backdrop-filter: " + s.navBackdropFilter);
  s.activeBorderRadius !== "999px"
    ? ok(`desktop active icon keeps the shared subtle rounding, not a pill (${s.activeBorderRadius})`)
    : bad("desktop active icon unexpectedly got a pill: " + s.activeBorderRadius);
  await page.close();
}

// ============================================================
// PART 5 — flavor CSS is scoped to the exact phone-portrait dock
// breakpoint only; the SAME Android device at a >=600px viewport renders
// with zero flavor styling (the compact/labeled rail was never "a dock").
// ============================================================
{
  const compact = await newPage({ userAgent: ANDROID_UA, viewport: { width: 700, height: 900 } });
  const sCompact = await readNavState(compact);
  sCompact.flavor === "android" && sCompact.navBoxShadow === "none" && sCompact.activeBorderRadius !== "999px"
    ? ok("Android UA at 700px (compact rail): flavor is still recorded, but no dock-only styling leaks in")
    : bad("Android UA at 700px: " + JSON.stringify(sCompact));
  await compact.close();

  const labeled = await newPage({ userAgent: ANDROID_UA, viewport: { width: 1280, height: 900 } });
  const sLabeled = await readNavState(labeled);
  sLabeled.flavor === "android" && sLabeled.navBoxShadow === "none" && sLabeled.activeBorderRadius !== "999px"
    ? ok("Android UA at 1280px (labeled rail): flavor is still recorded, but no dock-only styling leaks in")
    : bad("Android UA at 1280px: " + JSON.stringify(sLabeled));
  await labeled.close();
}

noise.length === 0 ? ok("no console errors/warnings across all UA/viewport passes") : bad(noise.length + " console msg(s); first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `NAV PLATFORM FLAVOR: ${fails} FAILURE(S)` : "NAV PLATFORM FLAVOR: all passed"));
process.exit(fails ? 1 : 0);
