/**
 * External-link handling on native Android (`<a target="_blank">` taps).
 *
 * Split from test-android.mjs for the same reason as test-android-back.mjs:
 * this needs a real, physical-style `adb shell input tap` and a real
 * `adb dumpsys window` focus check, not just JavaScript in the WebView - the
 * bug it guards against was invisible from JS alone (window.open()/
 * target=_blank taps don't throw or reject; they just silently do nothing).
 *
 * The bug: Capacitor's default Android WebView shell implements no
 * WebChromeClient.onCreateWindow() and leaves WebSettings.setSupportMultipleWindows()
 * at its default (false) - so every `<a target="_blank">` link in the app,
 * including the Veterans & Military Crisis Line chat link on the Health &
 * Resilience screen's crisis banner, was a confirmed no-op on real hardware:
 * no browser, no share sheet, no error, mCurrentFocus stayed on GUIDON's own
 * MainActivity. Fixed in MainActivity.java by handing new-window requests to
 * a throwaway WebView that forwards the target URL to a real external
 * Activity via ACTION_VIEW.
 *
 * What this does and doesn't prove: it is an end-to-end behavioral check
 * ("does tapping this link open a real external app"), not proof that
 * MainActivity's onCreateWindow specifically is what fired. On this
 * project's own test hardware, Capacitor's unrelated shouldOverrideUrlLoading
 * -> launchIntent fallback was independently observed producing the same
 * passing result even with onCreateWindow reverted (a target=_blank tap
 * that finds no multi-window support can fall back to a top-level
 * navigation, which that fallback then catches) - run this suite 6/6
 * against a deliberately-reverted build to be sure before trusting it as a
 * regression guard, and it still passed every time. It is kept anyway,
 * for what it still legitimately guards: the actual user-facing outcome on
 * a safety-critical link, on real hardware, on every run of the full
 * battery - not nothing, even though it can't attribute *why* by itself.
 *
 * Covers two independent real links (the crisis line chat link on #/health,
 * and the first external resource on #/resources) rather than one, since the
 * fix is a single native code path shared by every target="_blank" link in
 * the app - two call sites is enough to show the fix is general, not
 * something that happens to work for one hand-picked element.
 *
 * `adb shell input tap`, not a CDP-dispatched Input.dispatchMouseEvent, is
 * what actually taps the link - found the hard way, not assumed: a CDP tap
 * IS enough to satisfy Chromium's own onCreateWindow/isUserGesture check
 * (same as Puppeteer's .click()), but Android's OS-level background-
 * activity-launch gating - the thing that decides whether one app is
 * allowed to bring another to the foreground - tracks *its own* "recent
 * user interaction" signal off real input-dispatcher events, which a
 * CDP-injected event never passes through. A CDP tap on this exact link
 * silently produced a false pass (GUIDON merely lost focus to a doze/
 * NotificationShade transition, not to a real browser) until a real device
 * tap surfaced the difference - console.log(mCurrentFocus) showing
 * `com.brave.browser/...ChromeTabbedActivity` after a real tap, and
 * `app.guidon.trainer/.MainActivity` unchanged after a CDP one, same link,
 * same code, same run. CDP is still used to read layout (getBoundingClientRect,
 * devicePixelRatio) and to drive the in-app tab switch beforehand, since
 * neither of those needs OS-level gesture credentials - only the final tap
 * on the target=_blank link itself does.
 *
 * Usage: node tools/test-android-external-links.mjs
 * Requires a running device/emulator with a debug build of the app installed.
 */
import { execFileSync } from "node:child_process";
import { attachToPage } from "./cdp.mjs";

const ADB = process.env.ADB || "C:/Users/Obliv/android-sdk/platform-tools/adb.exe";
const PKG = "app.guidon.trainer";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const adb = (...a) => execFileSync(ADB, a, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attachForward() {
  const pid = adb("shell", "pidof", PKG).trim();
  if (!pid) return null;
  try { adb("forward", "--remove-all"); } catch (e) {}
  adb("forward", "tcp:9222", `localabstract:webview_devtools_remote_${pid}`);
  return pid;
}

function guidonFocused() {
  const dump = adb("shell", "dumpsys", "window");
  // Same signal test-android-back.mjs already trusts for this exact
  // question (see its own header comment on why device evidence beats
  // reasoning about a platform). mCurrentFocus's window name is either
  // "pkg/component" for a real app window or a bare system-window name
  // for a transient one - either way, "does it mention guidon" is the
  // reliable part; the package name below is best-effort, for readable
  // test output only.
  const line = dump.split("\n").find((l) => l.includes("mCurrentFocus=")) || "";
  const m = /Window\{[^}]*\s([\w.]+)(?:\/[\w.]+)?\}/.exec(line);
  return { pkg: m ? m[1] : null, isGuidon: /guidon/i.test(line) };
}

// Keep the screen awake for the duration of the run (device-plugged-in-for-
// adb "stay on while charging" toggle) - a doze/lock transition mid-test
// showed up as GUIDON merely losing focus to the lock screen, a false pass
// for "an external app opened" if left unguarded against.
adb("shell", "svc", "power", "stayon", "true");
adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
try { adb("shell", "wm", "dismiss-keyguard"); } catch (e) {}

// Fresh start so the app (not some leftover browser tab) owns focus going in.
adb("shell", "am", "force-stop", PKG);
adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
await sleep(8000);
await attachForward();

async function tapLinkAndCheck(hash, { tabText, selector }, label) {
  const p = await attachToPage("http://127.0.0.1:9222");
  await p.evaluate((h) => { location.hash = h; }, hash);
  await p.sleep(800);
  if (tabText) {
    // resilience.js defaults its #/health tab-set to "domains", not "Get
    // Support" - the crisis banner only renders once that tab is active.
    // This is a pure in-app UI switch, not the tap under test, so a plain
    // .click() (not a real device tap) is fine here.
    const switched = await p.evaluate((txt) => {
      const btn = Array.from(document.querySelectorAll(".tabbar button")).find((b) => b.textContent.trim() === txt);
      if (!btn) return false;
      btn.click();
      return true;
    }, tabText);
    if (!switched) { bad(`${label}: tab "${tabText}" not found`); p.close(); return; }
    await p.sleep(500);
  }
  // Resolve the link's on-screen CSS-pixel center, then scale by
  // devicePixelRatio to the physical-pixel coordinates `input tap` expects.
  // The WebView is edge-to-edge (MainActivity's setDecorFitsSystemWindows(false)),
  // so no separate status-bar-offset term is needed.
  const box = await p.evaluate((sel) => {
    const a = document.querySelector(sel);
    if (!a) return null;
    a.scrollIntoView({ block: "center" });
    const r = a.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: Math.round((r.left + r.width / 2) * dpr), y: Math.round((r.top + r.height / 2) * dpr), href: a.href };
  }, selector);
  p.close();
  if (!box) { bad(`${label}: selector not found in DOM (${selector})`); return; }
  console.log(`  ...  ${label}: tapping "${box.href}" at physical (${box.x}, ${box.y})`);
  adb("shell", "input", "tap", String(box.x), String(box.y));
  await sleep(2500);
  const f = guidonFocused();
  !f.isGuidon
    ? ok(`${label}: tap opened an external app (focus moved to ${f.pkg || "unknown"})`)
    : bad(`${label}: tap did nothing - GUIDON still has focus`);
  // Return to GUIDON for the next check, whether this one passed or not.
  adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
  await sleep(2000);
  await attachForward();
}

await tapLinkAndCheck(
  "#/health",
  { tabText: "Get Support", selector: 'a.res-crisis-tel[href^="http"]' },
  "Veterans & Military Crisis Line chat link"
);
await tapLinkAndCheck(
  "#/resources",
  { selector: 'a.res-url[href^="http"]' },
  "first external Resources link"
);

try { adb("shell", "svc", "power", "stayon", "false"); } catch (e) {}

console.log("\n" + (fails ? `ANDROID EXTERNAL LINKS: ${fails} FAILURE(S)` : "ANDROID EXTERNAL LINKS: all passed"));
process.exit(fails ? 1 : 0);
