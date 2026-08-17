/**
 * Upgrade-roadmap first wave, item 1: Guest and Kiosk sessions are
 * documented in profile.js as deliberately in-memory-only ("nothing is
 * saved" is meant literally - finishGuest()/finishKiosk() never call
 * loadProfile() and never write to IndexedDB) - but before this fix that
 * promise was only honored by callers remembering to check first. Two real
 * call sites didn't: the Profile view's "Regenerate plan" button and the
 * promotion-points quick-estimate calculator's debounced autosave both
 * called saveProfile() unconditionally. A third, more severe gap found
 * while fixing the first two: "Switch account or mode" and "Delete
 * profile" (both reachable from an active Kiosk session too - the
 * surrounding gate only excludes "guest", not "kiosk") called
 * deleteProfile() unconditionally, which would silently erase whatever
 * REAL personal profile happened to already be saved in IndexedDB on that
 * device, even though the active Kiosk/Guest session never read it in the
 * first place. This drives both a real Guest and a real Kiosk session
 * through the actual UI and confirms neither can write OR delete the
 * profile row in storage.
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

// ======================================================================
// Part 1: Guest session - "Regenerate plan" and the promo-points slider
// must never write guidon:profile:v1 to IndexedDB.
// ======================================================================
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await page.locator(".ob-mode-card", { hasText: /guest session/i }).click();
await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
await page.waitForTimeout(400);

const rowBeforeGuest = await page.evaluate(async () => window.G.db.get("kv", "guidon:profile:v1"));
rowBeforeGuest === undefined ? ok("Guest session starts with no guidon:profile:v1 row in storage") : bad("unexpected pre-existing profile row: " + JSON.stringify(rowBeforeGuest));

await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(500);

const regenBtn = page.locator("button", { hasText: /Regenerate plan/ });
(await regenBtn.count()) > 0 ? ok("'Regenerate plan' is reachable from a Guest session (has a starter plan)") : bad("'Regenerate plan' button not found in Guest session");
if (await regenBtn.count()) {
  await regenBtn.click();
  await page.waitForTimeout(300);
}
const rowAfterRegenGuest = await page.evaluate(async () => window.G.db.get("kv", "guidon:profile:v1"));
rowAfterRegenGuest === undefined ? ok("Clicking 'Regenerate plan' in a Guest session still writes nothing to storage") : bad("Regenerate plan wrote a profile row during a Guest session: " + JSON.stringify(rowAfterRegenGuest));

const rangeInput = page.locator("input.promo-range").first();
if (await rangeInput.count()) {
  await rangeInput.evaluate((el) => { el.value = String(Math.min(20, Number(el.max) || 20)); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(500); // clears the 300ms debounce
  const rowAfterSlider = await page.evaluate(async () => window.G.db.get("kv", "guidon:profile:v1"));
  rowAfterSlider === undefined ? ok("Dragging the promo-points quick-estimate slider in a Guest session still writes nothing to storage") : bad("promo-points autosave wrote a profile row during a Guest session: " + JSON.stringify(rowAfterSlider));
} else {
  bad("promo-points quick-estimate slider (input.promo-range) not found on the Guest Profile view");
}

// ======================================================================
// Part 2: Kiosk session - same "Regenerate plan" guard, PLUS the more
// severe deleteProfile() case: a real profile already sitting in storage
// (simulating a prior device owner) must survive "Switch account or mode"
// clicked from inside an active Kiosk session.
// ======================================================================
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await page.locator(".ob-mode-card", { hasText: /Kiosk/i }).click();
await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
await page.waitForTimeout(400);

await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(500);
const kioskRegenBtn = page.locator("button", { hasText: /Regenerate plan/ });
(await kioskRegenBtn.count()) > 0 ? ok("'Regenerate plan' is reachable from a Kiosk session too") : bad("'Regenerate plan' button not found in Kiosk session");
if (await kioskRegenBtn.count()) {
  await kioskRegenBtn.click();
  await page.waitForTimeout(300);
}
const rowAfterRegenKiosk = await page.evaluate(async () => window.G.db.get("kv", "guidon:profile:v1"));
rowAfterRegenKiosk === undefined ? ok("Clicking 'Regenerate plan' in a Kiosk session still writes nothing to storage") : bad("Regenerate plan wrote a profile row during a Kiosk session: " + JSON.stringify(rowAfterRegenKiosk));

// Simulate a real profile already saved on this device from BEFORE this
// Kiosk session started (a shared/public device a Soldier used earlier).
// This is a raw db.put, not saveProfile() - representing storage state the
// active Kiosk _cache never read and has no relationship to.
const MARKER = "QA-KIOSK-GUARD-" + Date.now();
await page.evaluate((marker) => window.G.db.put("kv", { k: "guidon:profile:v1", v: {
  onboardingComplete: true, mode: "personal", tier: "E6", rank: "SSG", lastName: marker,
} }), MARKER);
const seeded = await page.evaluate(async () => window.G.db.get("kv", "guidon:profile:v1"));
seeded && seeded.v && seeded.v.lastName === MARKER ? ok("A real personal profile was seeded into storage while the Kiosk session stayed active") : bad("seed failed: " + JSON.stringify(seeded));

const switchBtn = page.locator("button", { hasText: /Switch account or mode/ });
(await switchBtn.count()) > 0 ? ok("'Switch account or mode' is reachable from inside the active Kiosk session") : bad("'Switch account or mode' button not found in Kiosk session");
await Promise.all([
  page.waitForEvent("load", { timeout: 10000 }),
  (async () => {
    await switchBtn.click();
    await page.waitForTimeout(200);
    await page.locator(".gm-box button", { hasText: /Switch/ }).click();
  })(),
]);
await page.waitForTimeout(300);
const rowAfterSwitch = await page.evaluate(async () => window.G.db.get("kv", "guidon:profile:v1"));
(rowAfterSwitch && rowAfterSwitch.v && rowAfterSwitch.v.lastName === MARKER)
  ? ok("The real profile row survives 'Switch account or mode' clicked from an active Kiosk session (deleteProfile() correctly skipped)")
  : bad("the seeded real profile row was deleted/altered by a Kiosk session's Switch button: " + JSON.stringify(rowAfterSwitch));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nPROFILE GUEST GUARD: all passed");
process.exit(fails ? 1 : 0);
