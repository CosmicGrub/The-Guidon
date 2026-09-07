/**
 * "What's new" release-notes panel (G.whatsNew, src/index.html): shown to a
 * persistent (Personal Account) profile on the FIRST boot after a real
 * version change - never on the first boot this mechanism has ever observed
 * for a given profile at all, never to a Guest/Kiosk session (session-only,
 * nothing persistent to compare against), and never a second time for a
 * version already seen.
 *
 * DESIGN NOTE (round 2 of this file): the first version of this feature
 * treated "no guidon:whatsnew:v1 record at all" as "show the panel," on the
 * theory that a real Soldier's profile from before this feature shipped
 * would look exactly like that. It shipped, and immediately broke a wide,
 * unrelated swath of CI (currency-career, career-leader-grid, several
 * others) - because "seed a profile directly via db.put, then reload" is
 * an established, widely-used pattern across this whole test suite (see
 * seedPersonalProfile() below, the same shape test-biometric-lock.mjs's own
 * helper uses), and EVERY one of those tests now unexpectedly had this
 * panel pop open on its very next reload. There is no reliable way to tell
 * "a real pre-existing Soldier's profile" apart from "a profile a test (or
 * a future import/migration tool) just seeded directly" from inside the
 * app - they are structurally identical. The fix, and the behavior this
 * file actually tests: "no record" is now always seeded SILENTLY, never
 * shown - only a stored, OLDER version than the one currently running
 * shows the panel. The one accepted cost is that a real Soldier updating
 * from a pre-1.6.0 build straight into 1.6.0 won't retroactively see 1.6.0's
 * own notes (the feature that shows them didn't exist yet on their old
 * build) - every update from here forward works exactly as intended.
 *
 * This file proves the actual boot-time TRIGGER logic, not the copy itself
 * (tools/lint-patterns.mjs check (h) already guards that the current
 * version has a real, non-empty entry):
 *   1) A profile with NO guidon:whatsnew:v1 record at all does NOT see the
 *      panel - it is seeded silently instead.
 *   2) That same profile, once seeded, still does not show it on a further
 *      reload for the same version (not a "changed my mind" flake).
 *   3) A profile whose stored lastSeenVersion is an OLDER version DOES see
 *      the panel - a real, per-version trigger.
 *   4) Dismissing it ("Got it") persists lastSeenVersion, and a further
 *      reload does NOT show it again for the same version.
 *   5) A Guest session never sees it, even forced into a stored state that
 *      would trigger it for a Personal profile.
 *   6) Escape closes it the same way every other modal in the app does,
 *      and it never leaves a console error behind.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push("console: " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

async function seedPersonalProfile() {
  await page.evaluate(async () => {
    await window.G.db.put("kv", { k: "guidon:profile:v1", v: {
      onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
      displayName: "SGT TESTFIRE", lastName: "TESTFIRE", anonymous: false,
      studyWeakPoints: [], readinessConcerns: [], actionPlan: [], promoPoints: {},
    } });
  });
}
async function setWhatsNewSeen(version) {
  await page.evaluate(async (v) => {
    if (v === null) { await window.G.db.put("kv", { k: "guidon:whatsnew:v1", v: null }); return; }
    await window.G.db.put("kv", { k: "guidon:whatsnew:v1", v: { lastSeenVersion: v } });
  }, version);
}
async function panelState() {
  return page.evaluate(() => {
    const back = document.querySelector('.gm-box[aria-label="What\'s new"]');
    if (!back) return { present: false };
    return {
      present: true,
      title: (back.querySelector("h3") || {}).textContent || null,
      highlightCount: back.querySelectorAll("li").length,
      eyebrow: (back.querySelector(".eyebrow") || {}).textContent || null,
    };
  });
}
async function currentVersion() {
  return page.evaluate(() => window.GUIDON_APP_VERSION);
}
async function seenVersionStored() {
  return page.evaluate(async () => {
    const r = await window.G.db.get("kv", "guidon:whatsnew:v1");
    return r && r.v ? r.v.lastSeenVersion : null;
  });
}

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page, { mode: "guest" });
const V = await currentVersion();
V ? ok("app booted on a real version stamp: " + V) : bad("window.GUIDON_APP_VERSION is empty/undefined");

// ============================================================
// 1) A profile with NO whatsnew record at all does NOT see the panel - it
//    is seeded silently (this is the exact shape every test in this whole
//    suite that seeds a profile directly hits on its first post-seed
//    reload, so this must never show).
// ============================================================
await seedPersonalProfile();
await setWhatsNewSeen(null);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
let st = await panelState();
!st.present ? ok("(1) a profile with no stored whatsnew record does not see the panel - it is seeded silently") : bad("(1) panel appeared for a profile with no prior record: " + JSON.stringify(st));
const seededSilently = await seenVersionStored();
seededSilently === V ? ok("(1) that silent seed recorded lastSeenVersion = " + V) : bad("(1) lastSeenVersion after the silent seed: " + JSON.stringify(seededSilently));

// ============================================================
// 2) The same profile, now seeded, stays quiet on a further reload for the
//    same version.
// ============================================================
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
st = await panelState();
!st.present ? ok("(2) the now-seeded profile stays quiet on a further reload for the same version") : bad("(2) panel appeared on a reload where nothing changed: " + JSON.stringify(st));

// ============================================================
// 3) A stored OLDER version DOES trigger it - a real, per-version change,
//    not a one-time-ever flag.
// ============================================================
await setWhatsNewSeen("0.0.1");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
st = await panelState();
st.present ? ok('(3) a profile whose stored version is older than the current build sees the panel: "' + st.title + '"') : bad("(3) panel did not appear for a real version change (stored 0.0.1, current " + V + ")");
st.present && st.highlightCount > 0 ? ok("(3) the panel lists " + st.highlightCount + " real highlight(s), not an empty list") : bad("(3) panel highlight count: " + (st.highlightCount || 0));
st.present && st.eyebrow && st.eyebrow.indexOf("What's new") !== -1 ? ok("(3) the panel identifies itself as \"What's new\": " + JSON.stringify(st.eyebrow)) : bad("(3) eyebrow text: " + JSON.stringify(st.eyebrow));

// ============================================================
// 4) Dismissing it persists lastSeenVersion; a further reload stays quiet.
// ============================================================
await page.click('.gm-box[aria-label="What\'s new"] button');
await page.waitForTimeout(500);
st = await panelState();
!st.present ? ok('(4) "Got it" closes the panel') : bad("(4) panel still present after clicking Got it");
const seenAfterDismiss = await seenVersionStored();
seenAfterDismiss === V ? ok("(4) dismissing it recorded lastSeenVersion = " + V) : bad("(4) lastSeenVersion after dismiss: " + JSON.stringify(seenAfterDismiss));
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
st = await panelState();
!st.present ? ok("(4) a further reload for the SAME version does not show the panel again") : bad("(4) panel reappeared after being dismissed: " + JSON.stringify(st));

// ============================================================
// 5) A Guest session never sees it, even forced into a stored state that
//    would trigger it for a Personal profile.
// ============================================================
await page.evaluate(async () => { await window.G.db.put("kv", { k: "guidon:profile:v1", v: null }); });
await setWhatsNewSeen("0.0.1");
await page.reload({ waitUntil: "load" });
await dismissOnboarding(page, { mode: "guest" });
await page.waitForTimeout(500);
st = await panelState();
!st.present ? ok("(5) a Guest session never shows the panel, even with a stored version that would trigger it for a Personal profile") : bad("(5) panel appeared for a Guest session: " + JSON.stringify(st));

// ============================================================
// 6) Escape closes it, same as every other modal; no console errors.
// ============================================================
await seedPersonalProfile();
await setWhatsNewSeen("0.0.1");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
st = await panelState();
if (st.present) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  st = await panelState();
  !st.present ? ok("(6) Escape closes the panel, matching every other modal in the app") : bad("(6) panel still present after Escape");
} else {
  bad("(6) could not reach a shown-panel state to test Escape");
}

noise.length === 0 ? ok("no console errors/warnings across the whole run") : bad("console noise: " + JSON.stringify(noise));

await browser.close();
await server.close();

console.log("\n" + (fails ? `WHAT'S NEW: ${fails} FAILURE(S)` : "WHAT'S NEW: all passed"));
process.exit(fails ? 1 : 0);
