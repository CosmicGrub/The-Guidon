/**
 * Regression test for a real onboarding/biometric-lock race: util.modalTrap's
 * close() (src/index.html, near util._pushModalInert/_popModalInert) used to
 * ALWAYS wait for either a "transitionend" event on its backdrop element or a
 * fixed 400ms fallback timer before calling finishClose() - the function that
 * actually removes #app's `inert` attribute (util._popModalInert) - on the
 * assumption every backdrop animates its own close via CSS keyed off the
 * .modaltrap-open class (true for .gm-back/.cpdf-backdrop/.nav-drawer-back).
 *
 * #ob-overlay (onboarding's first-boot overlay) and #bio-lock-overlay declare
 * NO such CSS transition at all, so "transitionend" could never fire for
 * them - every close of an .ob-overlay-backed modal was blocked on the full
 * 400ms fallback for zero visual benefit (nothing was ever animating).
 * Worse: onboarding's own completion callback (app.start()'s
 * G.profile.renderOnboarding(overlay, (profile) => { overlay.remove(); ... })
 * call) removes the overlay element itself, synchronously, independent of
 * modalTrap's own deferred close - so the overlay's DOM removal (what
 * tools/dismiss-onboarding.mjs's ~50 callers wait on) raced roughly 400ms
 * AHEAD of #app's `inert` attribute actually clearing. Measured directly on
 * an unpatched build: #ob-overlay detached from the DOM while #app.inert was
 * still true, and stayed true for another ~376ms - a real window where the
 * ENTIRE app was unfocusable/unclickable for every Soldier (not just tests),
 * with the onboarding overlay already visually gone.
 *
 * The fix: close() now checks the backdrop's own computed transition-duration
 * (declared unconditionally on the base class, e.g. .gm-back's own
 * `transition: opacity ...`, so it reads correctly whether or not
 * .modaltrap-open is present yet) before deciding whether there is anything
 * to actually wait for. When there isn't (as for .ob-overlay), finishClose()
 * - and therefore _popModalInert() - runs immediately, in the same tick as
 * the caller's own overlay removal, eliminating the race entirely. Animated
 * backdrops (.gm-back, .cpdf-backdrop, .nav-drawer-back) are unaffected -
 * they still wait for their real CSS transition (or its 400ms safety-net
 * fallback) exactly as before.
 *
 * This suite reproduces the exact repro from the original bug report
 * (dismissOnboarding() resolving while #app is still real-inert, which
 * silently no-ops Playwright's .fill()/.focus()/.pressSequentially() on
 * anything inside #app - no error, no console noise, just a value that never
 * changes) and asserts BOTH the DOM-level signal (#app.inert) and a genuine
 * end-to-end interaction (typing into a real #app input) work the instant
 * dismissOnboarding()/a biometric unlock resolves, with no extra wait bolted
 * onto either test or app code.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { seedOwnerProfile, putOnDevice } from "./device-storage.mjs";
import { until } from "./testkit.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

// ─────────────────────────────────────────────────────────────────────────
// 1) First-boot onboarding overlay (#ob-overlay): #app must not be inert,
//    and a real element inside #app must accept synchronous interaction,
//    the instant dismissOnboarding() resolves - no waitForTimeout, no
//    waitForFunction polling for inert to clear (the whole point of the fix
//    is that no such extra wait should ever be necessary again).
// ─────────────────────────────────────────────────────────────────────────
{
  const page = await (await browser.newContext()).newPage();
  const noise = [];
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") noise.push("console.error: " + m.text()); });

  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page, { mode: "guest" });

  const appInert = await page.evaluate(() => !!(document.getElementById("app") || {}).inert);
  !appInert
    ? ok("#app is not inert the instant dismissOnboarding() resolves (no post-dismiss race)")
    : bad("#app is still inert immediately after dismissOnboarding() resolved");

  const overlayGone = (await page.locator("#ob-overlay").count()) === 0;
  overlayGone
    ? ok("#ob-overlay is genuinely detached (not just visually hidden) after dismissal")
    : bad("#ob-overlay is still attached after dismissOnboarding() resolved");

  // The real repro from the bug report: a raw Playwright .fill() on a
  // live #app input silently no-ops when #app is inert - no thrown error,
  // no console noise, the value just never changes. #/search's own input
  // is a convenient, always-present target.
  await page.evaluate(() => { location.hash = "#/search"; });
  const searchInput = page.locator('input[type="search"]').first();
  await searchInput.waitFor({ state: "visible", timeout: 5000 });
  await searchInput.fill("promotion points");
  const typedValue = await searchInput.inputValue();
  typedValue === "promotion points"
    ? ok("a real .fill() on a live #app input lands immediately post-dismissal (the exact repro from the bug report)")
    : bad(".fill() silently no-op'd right after dismissal - typed value was: " + JSON.stringify(typedValue));

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/page errors (section 1)") : bad("console noise (section 1): " + relevantNoise.slice(0, 5).join(" | "));

  await page.close();
}

// ─────────────────────────────────────────────────────────────────────────
// 2) Biometric-lock overlay (#bio-lock-overlay) shares the exact same
//    .ob-overlay-as-modalTrap-backdrop shape - same fix, same assertion.
// ─────────────────────────────────────────────────────────────────────────
{
  const context = await browser.newContext();
  const page = await context.newPage();
  const noise = [];
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") noise.push("console.error: " + m.text()); });

  // Auth mode starts "cancel" so the overlay's own auto-fired first attempt
  // (buildOverlay() calls attempt() the instant it mounts) fails and leaves
  // the overlay up long enough to observe/interact with - an always-succeed
  // mock closes it (now near-instantly, post-fix) before waitFor("attached")
  // can ever catch it, same idiom test-biometric-lock.mjs itself uses.
  await context.addInitScript(() => {
    window.__bioAuthResult = "cancel";
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        BiometricAuthNative: {
          checkBiometry: async () => ({ isAvailable: true, code: "", reason: "" }),
          internalAuthenticate: async () => {
            if (window.__bioAuthResult === "success") return;
            const err = new Error("mock cancel");
            err.code = "userCancel";
            throw err;
          },
        },
        App: { addListener: async () => ({ remove: () => {} }) },
      },
    };
  });

  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page, { mode: "guest" });
  await seedOwnerProfile(page);
  await putOnDevice(page, { stores: { kv: [{ k: "settings", v: { biometricLock: true } }] } });
  await page.reload({ waitUntil: "load" });

  const overlayAppeared = await until(page, () => !!document.getElementById("bio-lock-overlay"), null, { timeout: 5000 });
  overlayAppeared
    ? ok("biometric lock overlay appears on cold launch (setup sanity check)")
    : bad("biometric lock overlay never appeared - cannot exercise its close race");

  if (overlayAppeared) {
    await page.evaluate(() => { window.__bioAuthResult = "success"; });
    await page.getByRole("button", { name: /Unlock with biometrics/ }).click();
    await until(page, () => !document.getElementById("bio-lock-overlay"), null, { timeout: 3000 });

    const appInert = await page.evaluate(() => !!(document.getElementById("app") || {}).inert);
    !appInert
      ? ok("#app is not inert the instant the biometric-lock overlay detaches")
      : bad("#app is still inert immediately after a successful biometric unlock");
  }

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/page errors (section 2)") : bad("console noise (section 2): " + relevantNoise.slice(0, 5).join(" | "));

  await page.close();
}

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nMODAL-INERT CLOSE RACE: all passed");
process.exit(fails ? 1 : 0);
