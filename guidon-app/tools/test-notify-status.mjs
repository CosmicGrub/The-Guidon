/**
 * Settings' Notifications panel (views.settings in src/index.html) vs.
 * notify.js's G.notify.checkPermission()/getPendingCount() (src/notify.js).
 *
 * The toggle's checkbox only ever reflected s.notifyReminders - a LOCAL,
 * app-side boolean the toggle itself writes on change - and never once
 * called G.notify.checkPermission(), which already existed and already
 * talks to the real Capacitor LocalNotifications plugin. That meant the
 * toggle could read checked/"on" for as long as the Soldier left it that
 * way, even after the OS permission was revoked entirely OUTSIDE the app
 * (Android's own per-app notification setting, flippable from system
 * settings with zero signal back to GUIDON) - with nothing anywhere in the
 * UI to say so. This suite proves the fix: the panel now surfaces a live,
 * independent status line (checkPermission() + getPendingCount(), refreshed
 * on mount AND on visibilitychange) that can disagree with the checkbox and
 * say so, and that the document-level visibilitychange listener behind that
 * self-cleans instead of leaking one more per Settings visit forever (the
 * same idiom renderOnboarding's own document keydown listener uses - grep
 * "wrap.isConnected" in src/index.html for that precedent).
 *
 * notify.js's `isNative` is a plain module-scope const, resolved ONCE when
 * the script itself first runs (`const isNative = !!(Cap && ...)`), not
 * re-checked per call - so window.Capacitor has to exist BEFORE that script
 * executes, not merely before G.notify.supported() is read. Playwright's
 * addInitScript() runs ahead of every page script on every navigation
 * (including the real reload later in this file), which a post-load
 * page.evaluate() stub (fine for native.js/util.js elsewhere in this repo,
 * per test-native-download.mjs) cannot give here.
 *
 * G.notify only ships in the web/ bundle (build.mjs injects notify.js there,
 * not into dist/guidon-standalone.html - same fact test-native-unit.mjs's
 * own header documents), so this suite runs against web/ like that one does.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const noise = [];
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") noise.push("console.error: " + m.text()); });

// A fake Capacitor native shell with a fake LocalNotifications plugin.
// window.__mockPerm drives checkPermissions()/requestPermissions() so the
// test can flip "the OS permission" without ever touching the real toggle -
// exactly modelling a Soldier revoking it from Android's system settings,
// completely outside GUIDON. window.__mockScheduled is the plugin's own
// "OS notification queue", mutated only by schedule()/cancel(), so
// getPending() (-> G.notify.getPendingCount()) reports what's REALLY been
// scheduled, not what any app-side flag claims. Both are mirrored into
// localStorage (which, unlike a plain JS global, survives a real reload) so
// section 3 below can prove the on-mount check works after a genuine
// navigation, not just via the in-page visibilitychange event - addInitScript
// itself reruns on every new document, including that reload, so anything
// living only in a JS variable would silently reset back to the "granted"
// default right along with it.
await context.addInitScript(() => {
  window.__mockPerm = localStorage.getItem("__test_mockPerm") || "granted";
  window.__mockScheduled = JSON.parse(localStorage.getItem("__test_mockScheduled") || "[]");
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LocalNotifications: {
        checkPermissions: async () => ({ display: window.__mockPerm }),
        requestPermissions: async () => ({ display: window.__mockPerm }),
        schedule: async (opts) => {
          (opts.notifications || []).forEach((n) => {
            window.__mockScheduled = window.__mockScheduled.filter((x) => x.id !== n.id);
            window.__mockScheduled.push(n);
          });
          localStorage.setItem("__test_mockScheduled", JSON.stringify(window.__mockScheduled));
          return {};
        },
        cancel: async (opts) => {
          const ids = (opts.notifications || []).map((n) => n.id);
          window.__mockScheduled = window.__mockScheduled.filter((x) => !ids.includes(x.id));
          localStorage.setItem("__test_mockScheduled", JSON.stringify(window.__mockScheduled));
          return {};
        },
        getPending: async () => ({ notifications: window.__mockScheduled }),
      },
    },
  };
});

async function dismissOnboarding() {
  await page.waitForTimeout(700);
  const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guestCard.count()) {
    await guestCard.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

await page.goto(url, { waitUntil: "load" });
await dismissOnboarding();

// 0) Sanity: the mock actually landed before notify.js's own module-scope
//    isNative check ran, and G.notify picked up the new export.
const boot = await page.evaluate(() => ({
  hasNotify: !!(window.G && window.G.notify),
  supported: !!(window.G && window.G.notify && window.G.notify.supported()),
  hasGetPendingCount: !!(window.G && window.G.notify && typeof window.G.notify.getPendingCount === "function"),
}));
boot.hasNotify ? ok("G.notify loaded in the web/ build") : bad("G.notify missing");
boot.supported
  ? ok("G.notify.supported() is true under the mocked native Capacitor shell (proves addInitScript landed before notify.js's own module-scope isNative check ran)")
  : bad("G.notify.supported() is false - the Capacitor mock did not take effect before notify.js ran");
boot.hasGetPendingCount
  ? ok("G.notify.getPendingCount() is exported (the fix's second half - live scheduled-count status)")
  : bad("G.notify.getPendingCount is missing");

// Seed one real, future-dated reminder through the same G.reminders.add()
// the Reminders editor's own "Add reminder" button uses, so syncAll() (fired
// by turning the toggle on, below) has something real to actually schedule -
// this is what lets getPendingCount() report a genuine, non-zero count
// rather than a synthetic one.
const seeded = await page.evaluate(async () => {
  const updated = await window.G.reminders.add({ kind: "board", label: "Board date", date: "2027-01-15", note: "" });
  return Array.isArray(updated) ? updated.length : -1;
});
seeded === 1 ? ok("seeded one real reminder via G.reminders.add() for a genuine scheduled-count check") : bad("seeding a reminder failed: " + seeded);

await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(500);

const notifPanel = page.locator(".notify-live-status");
(await notifPanel.count()) > 0
  ? ok("the Notifications panel (and its live-status line) renders when G.notify.supported() is true")
  : bad("Notifications panel / .notify-live-status not found on #/settings");

const notifCheckbox = page.getByRole("checkbox", { name: "Reminder notifications", exact: true });
(await notifCheckbox.isChecked()) === false
  ? ok("checkbox starts unchecked (fresh guest profile - notifyReminders defaults off)")
  : bad("checkbox unexpectedly started checked");

async function liveStatus() {
  return page.evaluate(() => {
    const el = document.querySelector(".notify-live-status");
    return el ? { text: el.textContent, warn: el.classList.contains("warn") } : null;
  });
}

const before = await liveStatus();
before && /0 reminders currently scheduled/.test(before.text) && !before.warn
  ? ok(`before turning the toggle on: live status reports 0 scheduled, no warning (${JSON.stringify(before.text)})`)
  : bad("unexpected pre-toggle live status: " + JSON.stringify(before));

// ============================================================
// 1) Turn the toggle ON with the OS permission genuinely granted (mocked).
//    The real fix's plumbing (requestPermission -> setSetting -> syncAll)
//    is untouched; this just proves the NEW live-status line agrees with a
//    healthy state, so the later "revoked" case below is a real contrast,
//    not the only state this line can ever show.
// ============================================================
// Same native-click idiom test-settings-toggles.mjs uses for this exact
// kind of CSS-hidden checkbox-behind-a-styled-toggle control.
await notifCheckbox.evaluate((elx) => elx.click());
await page.waitForTimeout(400);

(await notifCheckbox.isChecked()) === true
  ? ok("toggle is checked after turning it on with a granted (mocked) permission")
  : bad("toggle did not end up checked after a granted permission");

const scheduledCount = await page.evaluate(() => window.__mockScheduled.length);
scheduledCount === 1
  ? ok("turning the toggle on really scheduled the seeded reminder against the mocked LocalNotifications plugin (syncAll -> schedule())")
  : bad("expected 1 scheduled notification in the mock plugin, found " + scheduledCount);

const onStatus = await liveStatus();
onStatus && /OS permission granted/.test(onStatus.text) && /1 reminder currently scheduled/.test(onStatus.text) && !onStatus.warn
  ? ok(`live status with a real granted permission: "${onStatus.text}" (no warning styling)`)
  : bad("live status after turning on did not match the granted+1-scheduled case: " + JSON.stringify(onStatus));

// ============================================================
// 2) THE ACTUAL BUG: OS permission gets revoked entirely OUTSIDE the app
//    (never through G.notify.requestPermission() - this only flips the
//    mock's own checkPermissions()/requestPermissions() answer, exactly
//    like a Soldier backing out to Android's system settings and turning
//    GUIDON's notification permission off there). The checkbox itself has
//    no way to know this happened; only the live-status line's own
//    checkPermission() call can catch it.
// ============================================================
await page.evaluate(() => { window.__mockPerm = "denied"; localStorage.setItem("__test_mockPerm", "denied"); });

// Simulate the app backgrounding (Soldier switches to system settings) and
// re-foregrounding (Soldier switches back) while still sitting on this
// exact screen - the concrete real-world moment this whole fix targets.
// document.visibilityState is normally read-only/tied to the real OS - the
// standard test technique is to override the property descriptor and fire
// the event by hand, which is exactly what real browsers do internally.
async function fireVisibility(state) {
  await page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { value: s, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  await page.waitForTimeout(150);
}
await fireVisibility("hidden");
await fireVisibility("visible");

const stillChecked = await notifCheckbox.isChecked();
const revokedStatus = await liveStatus();

stillChecked
  ? ok("checkbox itself is UNCHANGED (still checked) after the OS-level revoke - it's still the Soldier's stored on/off intent, not the live truth")
  : bad("checkbox unexpectedly flipped on its own after an OS-level permission revoke");

revokedStatus && revokedStatus.warn
  ? ok("live status switches to its warning style once checkPermission() reports the permission is no longer granted")
  : bad("live status did not switch to a warning style after the OS-level revoke: " + JSON.stringify(revokedStatus));
revokedStatus && /not granted/i.test(revokedStatus.text) && /denied/.test(revokedStatus.text) && /revoked/i.test(revokedStatus.text)
  ? ok(`live status names the real revoked state distinctly from "on": "${revokedStatus.text}"`)
  : bad("live status text did not clearly describe the revoked permission: " + JSON.stringify(revokedStatus));
revokedStatus && /1 reminder currently scheduled/.test(revokedStatus.text)
  ? ok("live status still reports the real scheduled count (1) alongside the revoked-permission warning")
  : bad("live status lost the scheduled-count line once permission was revoked: " + JSON.stringify(revokedStatus));

// A poll-free assertion that the toggle-on state genuinely disagrees with
// the live status now - the whole point of the fix (checked/"on" no longer
// silently implies "notifications will actually fire").
stillChecked && revokedStatus && revokedStatus.warn
  ? ok('the checkbox ("on") and the live status ("revoked") now visibly DISAGREE, exactly the gap the fix closes - previously both would have silently agreed on "on"')
  : bad("checkbox/live-status did not end up in the expected disagreeing state");

// ============================================================
// 3) The refresh survives a real reload too (on-mount, not only
//    visibilitychange) - settings persist in real IndexedDB across reload
//    even for a guest profile (unlike the in-memory profile itself), so the
//    toggle should still read checked and the live status should still show
//    revoked immediately, with no visibilitychange needed at all.
// ============================================================
await page.reload({ waitUntil: "load" });
await dismissOnboarding();
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(500);

const afterReloadChecked = await page.getByRole("checkbox", { name: "Reminder notifications", exact: true }).isChecked();
const afterReloadStatus = await liveStatus();
afterReloadChecked
  ? ok("notifyReminders=true survives a real reload (real IndexedDB, unlike the guest profile itself)")
  : bad("checkbox lost its 'on' state after reload: " + afterReloadChecked);
afterReloadStatus && afterReloadStatus.warn && /not granted/i.test(afterReloadStatus.text)
  ? ok("a fresh mount (reload, no visibilitychange involved) ALSO shows the revoked state immediately - the on-mount check works standalone")
  : bad("on-mount check did not show the revoked state after reload: " + JSON.stringify(afterReloadStatus));

// ============================================================
// 4) Turning the toggle back OFF still works with the permission revoked
//    (no permission needed to turn OFF), cancels the real schedule, and the
//    live status' scheduled count and warning both clear with it.
// ============================================================
await page.getByRole("checkbox", { name: "Reminder notifications", exact: true }).evaluate((elx) => elx.click());
await page.waitForTimeout(400);
const afterOffScheduled = await page.evaluate(() => window.__mockScheduled.length);
const afterOffStatus = await liveStatus();
afterOffScheduled === 0
  ? ok("turning the toggle off cancels the real scheduled notification in the mock plugin (cancelAll -> cancel())")
  : bad("expected 0 scheduled after turning off, found " + afterOffScheduled);
afterOffStatus && !afterOffStatus.warn && /0 reminders currently scheduled/.test(afterOffStatus.text)
  ? ok(`live status clears back to a clean "off" state: "${afterOffStatus.text}"`)
  : bad("live status did not clear after turning the toggle off: " + JSON.stringify(afterOffStatus));

// ============================================================
// 5) The document-level visibilitychange listener self-cleans instead of
//    stacking one more every time Settings is visited (this view has no
//    route-teardown hook - see the comment above onNotifVisible in
//    src/index.html). Spy on add/removeEventListener("visibilitychange", ...)
//    to prove it actually unregisters once its panel leaves the DOM, the
//    same "next stray event notices it's detached and cleans itself up"
//    idiom renderOnboarding's own document keydown listener already uses.
// ============================================================
await page.evaluate(() => {
  window.__vcAdd = 0; window.__vcRemove = 0;
  const origAdd = document.addEventListener.bind(document);
  const origRemove = document.removeEventListener.bind(document);
  document.addEventListener = function (type, fn, opts) {
    if (type === "visibilitychange") window.__vcAdd++;
    return origAdd(type, fn, opts);
  };
  document.removeEventListener = function (type, fn, opts) {
    if (type === "visibilitychange") window.__vcRemove++;
    return origRemove(type, fn, opts);
  };
});

// Re-mount the Notifications panel (fresh visit -> registers a fresh listener).
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(400);
const addAfterMount = await page.evaluate(() => window.__vcAdd);
addAfterMount >= 1
  ? ok(`mounting the Notifications panel registered a visibilitychange listener (count=${addAfterMount})`)
  : bad("no visibilitychange listener was registered when the panel mounted");

// Navigate away - the panel's <div class="panel"> detaches from the DOM,
// but nothing has told the listener that yet.
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
const removeBeforeEvent = await page.evaluate(() => window.__vcRemove);

// The next stray visibilitychange anywhere in the app is what actually
// triggers the self-clean, per onNotifVisible's own isConnected check.
await fireVisibility("hidden");
await fireVisibility("visible");
const removeAfterEvent = await page.evaluate(() => window.__vcRemove);

removeAfterEvent > removeBeforeEvent
  ? ok(`the detached panel's visibilitychange listener unregistered itself on the next visibilitychange event (removeEventListener count ${removeBeforeEvent} -> ${removeAfterEvent})`)
  : bad(`listener did not self-clean after navigating away (removeEventListener count stayed at ${removeBeforeEvent})`);

const relevantNoise = noise.filter((n) => !/favicon/i.test(n));
relevantNoise.length === 0
  ? ok("no unexpected console errors/page errors")
  : bad(`${relevantNoise.length} unexpected console/page error(s); first: ${relevantNoise[0]}`);

await browser.close();
await server.close();
console.log("\n" + (fails ? `NOTIFY STATUS: ${fails} FAILURE(S)` : "NOTIFY STATUS: all passed"));
process.exit(fails ? 1 : 0);
