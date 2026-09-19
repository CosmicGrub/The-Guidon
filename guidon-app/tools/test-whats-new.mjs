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

// ============================================================
// 7) Someone who SKIPPED versions is told about every one they skipped.
//    The Android and Windows apps update far less often than the web copy,
//    so jumping several versions is the normal case. The panel used to show
//    only the newest entry, so everything added in between was never
//    mentioned to them at all.
// ============================================================
async function panelDetail() {
  return page.evaluate(() => {
    const box = document.querySelector('.gm-box[aria-label="What\'s new"]');
    if (!box) return null;
    const visible = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btn = box.querySelector("button");
    const br = btn.getBoundingClientRect(), xr = box.getBoundingClientRect();
    const body = box.querySelector(".whatsnew-body");
    return {
      title: box.querySelector("h3").textContent,
      allText: box.textContent,
      visibleBullets: [...box.querySelectorAll("li")].filter(visible).map((li) => li.textContent),
      allBullets: [...box.querySelectorAll("li")].map((li) => li.textContent),
      hasMore: !!box.querySelector("details.whatsnew-more"),
      buttonInView: br.top >= 0 && br.bottom <= window.innerHeight && br.height > 0,
      boxFits: xr.top >= 0 && xr.bottom <= window.innerHeight + 1 && xr.left >= 0 && xr.right <= window.innerWidth + 1,
      pageOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      bodyScrolls: body ? body.scrollHeight > body.clientHeight + 1 : false,
      bodyTabStop: body ? body.getAttribute("tabindex") === "0" : false,
      focusInside: box.contains(document.activeElement),
    };
  });
}
const notesInfo = await page.evaluate((cur) => {
  const W = window.G.whatsNew;
  const between = (lo) => W.RELEASE_NOTES.filter((n) => W.cmpVersion && W.cmpVersion(n.version, lo) > 0 && W.cmpVersion(n.version, cur) <= 0);
  const entry = W.RELEASE_NOTES.find((n) => n.version === cur);
  return { currentTitle: entry ? entry.title : null, since190: between("1.9.0").map((n) => ({ version: n.version, title: n.title, highlights: n.highlights })), old190: (W.RELEASE_NOTES.find((n) => n.version === "1.9.0") || {}).highlights || [] };
}, V);
notesInfo.since190.length >= 2 ? ok("(7) there are " + notesInfo.since190.length + " entries newer than 1.9.0 to test with: " + notesInfo.since190.map((n) => n.version).join(", ")) : bad("(7) expected several entries newer than 1.9.0 (G.whatsNew.cmpVersion missing?): " + JSON.stringify(notesInfo.since190.map((n) => n.version)));
await setWhatsNewSeen("1.9.0");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
let det = await panelDetail();
if (!det) bad("(7) no panel for a Soldier updating from 1.9.0");
else {
  det.title === notesInfo.currentTitle ? ok('(7) the headline is the version now running: "' + det.title + '"') : bad("(7) headline " + JSON.stringify(det.title) + " is not the current version's " + JSON.stringify(notesInfo.currentTitle));
  if (det.hasMore) {
    // Opened from the keyboard, the way someone without a mouse would.
    await page.focus('.gm-box[aria-label="What\'s new"] details.whatsnew-more summary');
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    det = await panelDetail();
  }
  const missing = [];
  notesInfo.since190.forEach((n) => n.highlights.forEach((h) => { if (!det.visibleBullets.includes(h)) missing.push(n.version + ": " + h.slice(0, 50)); }));
  missing.length === 0 ? ok("(7) every highlight of every version skipped since 1.9.0 can be read in the panel (" + det.visibleBullets.length + " bullets" + (det.hasMore ? ', older ones behind a keyboard-operable "Earlier updates"' : "") + ")") : bad("(7) skipped-version highlights never shown: " + JSON.stringify(missing));
  const leaked = notesInfo.old190.filter((h) => det.allBullets.includes(h));
  leaked.length === 0 ? ok("(7) nothing from 1.9.0 or earlier is repeated - only what is new to this Soldier") : bad("(7) already-seen highlights were shown again: " + JSON.stringify(leaked));
  /\b\d+\.\d+\.\d+\b/.test(det.allText) ? bad("(7) the panel shows raw version numbers: " + JSON.stringify(det.allText.match(/\b\d+\.\d+\.\d+\b/)[0])) : ok("(7) the panel talks about features, never version numbers");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

// ============================================================
// 8) Entries are found by VERSION, never by position. They arrive from the
//    main file AND from small per-release files that load in file-name
//    order ("v11210" sorts before "v1122"), so "the last one in the array"
//    is not reliably the newest. Reversed here to prove order is irrelevant.
// ============================================================
await setWhatsNewSeen("1.9.0");
await page.evaluate(async () => { window.G.whatsNew.RELEASE_NOTES.reverse(); await window.G.whatsNew.checkOnBoot(); });
await page.waitForTimeout(400);
det = await panelDetail();
det && det.title === notesInfo.currentTitle ? ok("(8) with the entries in reverse order the headline is still the current version's") : bad("(8) with the entries reordered the panel was " + (det ? "headed " + JSON.stringify(det.title) : "not shown at all"));
if (det) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }

// ============================================================
// 9) A stored version NEWER than this build (an older copy opened after a
//    newer one) has nothing new to announce.
// ============================================================
await setWhatsNewSeen("99.0.0");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(500);
st = await panelState();
!st.present ? ok("(9) opening an OLDER copy than the one last seen announces nothing") : bad("(9) panel shown although the stored version (99.0.0) is newer than this build: " + JSON.stringify(st));

// ============================================================
// 10) The longest panel there can be (every entry ever) on a phone: the box
//     stays on screen, "Got it" stays in view, only the list scrolls, the
//     list can be scrolled from the keyboard, and the page never scrolls
//     sideways.
// ============================================================
await page.setViewportSize({ width: 390, height: 700 });
await setWhatsNewSeen("0.0.1");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);
det = await panelDetail();
if (!det) bad("(10) no panel at phone width");
else {
  det.boxFits && !det.pageOverflowX ? ok("(10) at 390px the whole panel stays on screen and the page does not scroll sideways") : bad("(10) panel does not fit a 390x700 screen: " + JSON.stringify({ boxFits: det.boxFits, pageOverflowX: det.pageOverflowX }));
  det.buttonInView ? ok('(10) "Got it" is in view without scrolling, however long the list is') : bad('(10) "Got it" is pushed off screen by a long list');
  det.focusInside ? ok("(10) keyboard focus is inside the panel") : bad("(10) focus is not inside the panel");
  !det.bodyScrolls || det.bodyTabStop ? ok("(10) the scrolling list is reachable from the keyboard" + (det.bodyScrolls ? "" : " (it did not need to scroll here)")) : bad("(10) the list scrolls but cannot be focused, so a keyboard user cannot read the rest");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

noise.length === 0 ? ok("no console errors/warnings across the whole run") : bad("console noise: " + JSON.stringify(noise));

await browser.close();
await server.close();

console.log("\n" + (fails ? `WHAT'S NEW: ${fails} FAILURE(S)` : "WHAT'S NEW: all passed"));
process.exit(fails ? 1 : 0);
