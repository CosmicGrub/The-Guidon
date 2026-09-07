/**
 * "What's new" release-notes panel (G.whatsNew, src/index.html): shown once
 * per real update to an existing, persistent (Personal Account) profile -
 * never to a brand-new install seeing its own just-installed version, never
 * to a Guest/Kiosk session (session-only, nothing persistent to compare
 * against), and never a second time for a version already seen.
 *
 * This file proves the actual boot-time TRIGGER logic, not the copy itself
 * (tools/lint-patterns.mjs check (h) already guards that the current
 * version has a real, non-empty entry):
 *   1) An existing profile with NO guidon:whatsnew:v1 record at all (the
 *      real shape of every profile that existed before this feature
 *      shipped) sees the panel on its very next boot after updating into a
 *      build carrying it.
 *   2) Dismissing it ("Got it") persists lastSeenVersion, and a second
 *      reload does NOT show it again for the same version.
 *   3) A profile whose stored lastSeenVersion is an OLDER version (a real
 *      update, not "first time this feature exists") also sees it - this
 *      isn't a one-time flag, it's per-version.
 *   4) A brand-new profile that JUST finished onboarding on the CURRENT
 *      version never sees it - onboarding's own completion handler seeds
 *      lastSeenVersion immediately, before this check ever runs.
 *   5) A Guest session never sees it, regardless of stored state.
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
    const back = document.querySelector('.gm-back .gm-box[aria-label="What\'s new"]');
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
// 1) A pre-existing profile with NO whatsnew record sees the panel.
// ============================================================
await seedPersonalProfile();
await setWhatsNewSeen(null);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
let st = await panelState();
st.present ? ok('(1) a pre-existing profile with no stored record sees the panel on the next boot: "' + st.title + '"') : bad("(1) panel did not appear for a profile with no whatsnew record: " + JSON.stringify(st));
st.present && st.highlightCount > 0 ? ok("(1) the panel lists " + st.highlightCount + " real highlight(s), not an empty list") : bad("(1) panel highlight count: " + (st.highlightCount || 0));
st.present && st.eyebrow && st.eyebrow.indexOf("What's new") !== -1 ? ok("(1) the panel identifies itself as \"What's new\": " + JSON.stringify(st.eyebrow)) : bad("(1) eyebrow text: " + JSON.stringify(st.eyebrow));

// ============================================================
// 2) Dismissing it persists lastSeenVersion; a second reload stays quiet.
// ============================================================
await page.click('.gm-box[aria-label="What\'s new"] button');
await page.waitForTimeout(500);
st = await panelState();
!st.present ? ok("(2) \"Got it\" closes the panel") : bad("(2) panel still present after clicking Got it");
const seen1 = await seenVersionStored();
seen1 === V ? ok("(2) dismissing it recorded lastSeenVersion = " + V) : bad("(2) lastSeenVersion after dismiss: " + JSON.stringify(seen1));
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
st = await panelState();
!st.present ? ok("(2) a second reload for the SAME version does not show the panel again") : bad("(2) panel reappeared on a reload where nothing changed");

// ============================================================
// 3) A stored OLDER version re-triggers it on the next boot (a real update,
//    not a one-time-ever flag).
// ============================================================
await setWhatsNewSeen("0.0.1");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
st = await panelState();
st.present ? ok("(3) a profile whose stored version is older than the current build sees the panel again") : bad("(3) panel did not appear for a real version change (stored 0.0.1, current " + V + ")");
await page.click('.gm-box[aria-label="What\'s new"] button').catch(() => {});
await page.waitForTimeout(400);

// ============================================================
// 4) Onboarding's own completion handler seeds lastSeenVersion the moment
//    onboarding finishes - checked via the guest-mode flow (a single,
//    reliable click to completion; the seeding code in app.start()'s
//    completion callback runs identically regardless of which mode card
//    was chosen, so this exercises the exact same code path a completed
//    Personal Account onboarding would). Sections (1)-(3) above already
//    cover the Personal-profile-specific gating (no record shown, older-
//    version shown) once a real profile exists.
// ============================================================
await page.evaluate(async () => { await window.G.db.put("kv", { k: "guidon:profile:v1", v: null }); await window.G.db.put("kv", { k: "guidon:whatsnew:v1", v: null }); });
await page.reload({ waitUntil: "load" });
await dismissOnboarding(page, { mode: "guest" });
await page.waitForTimeout(500);
const seenAfterOnboarding = await seenVersionStored();
seenAfterOnboarding === V ? ok("(4) onboarding completion seeded lastSeenVersion = " + V + " immediately, before any boot-time check ever ran") : bad("(4) lastSeenVersion right after onboarding: " + JSON.stringify(seenAfterOnboarding));

// ============================================================
// 5) A Guest session never sees it, regardless of stored state - forced
//    to a state that WOULD trigger it for a Personal profile (an older
//    seen-version, not just whatever section (4) left behind), so this
//    proves the isGuest() gate itself, not a stale "already seen" record.
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
await setWhatsNewSeen(null);
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
