/**
 * Android hardware/gesture Back button behaviour.
 *
 * Split from test-android.mjs because it needs real key events via adb, not
 * just JavaScript in the WebView — and because the bug it guards against was
 * invisible from JS alone.
 *
 * The bug: with @capacitor/app installed, Android Back delivered
 * `{canGoBack:false}` to the web layer even with history.length at 33, and
 * Capacitor took no default action. Back did NOTHING — it neither navigated nor
 * exited. `canGoBack` tracks WebView document navigation; GUIDON is a hash
 * router, so it is the wrong signal. src/native.js tracks its own depth.
 *
 * Usage: node tools/test-android-back.mjs
 * Requires a running device/emulator with the app installed.
 */
import { execFileSync } from "node:child_process";
import { attachToPage } from "./cdp.mjs";

const ADB = process.env.ADB || "C:/Users/Obliv/AppData/Local/Android/Sdk/platform-tools/adb.exe";
const PKG = "app.guidon.trainer";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const adb = (...a) => execFileSync(ADB, a, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function state() {
  const p = await attachToPage("http://127.0.0.1:9222");
  const s = await p.evaluate(() => ({
    hash: location.hash,
    depth: window.G && window.G.native ? window.G.native.navDepth() : null,
    wired: window.G && window.G.native ? window.G.native.state.backWired : null,
    modalOpen: !!document.querySelector(".gm-back"),
  }));
  p.close();
  return s;
}

async function attachForward() {
  const pid = adb("shell", "pidof", PKG).trim();
  if (!pid) return null;
  try { adb("forward", "--remove-all"); } catch (e) {}
  adb("forward", "tcp:9222", `localabstract:webview_devtools_remote_${pid}`);
  return pid;
}

// Fresh start so navigation depth begins from a known baseline.
adb("shell", "am", "force-stop", PKG);
adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
await sleep(14000);
await attachForward();

let s = await state();
s.wired ? ok("back button listener registered") : bad("back button not wired");

// Build a known navigation stack.
const p = await attachToPage("http://127.0.0.1:9222");
await p.evaluate(() => { location.hash = "#/board"; });
await p.sleep(600);
await p.evaluate(() => { location.hash = "#/progress"; });
await p.sleep(600);
p.close();

s = await state();
s.hash === "#/progress" && s.depth === 2
  ? ok(`stack built: ${s.hash} at depth ${s.depth}`)
  : bad(`unexpected setup state ${JSON.stringify(s)}`);

adb("shell", "input", "keyevent", "KEYCODE_BACK");
await sleep(2000);
s = await state();
s.hash === "#/board" && s.depth === 1
  ? ok("Back navigates: #/progress -> #/board (depth 1)")
  : bad(`Back did not navigate, got ${JSON.stringify(s)}`);

adb("shell", "input", "keyevent", "KEYCODE_BACK");
await sleep(2000);
s = await state();
s.hash === "#/home" && s.depth === 0
  ? ok("Back navigates: #/board -> #/home (depth 0)")
  : bad(`Back did not reach root, got ${JSON.stringify(s)}`);

// At the root, Back must leave the app rather than dead-end.
adb("shell", "input", "keyevent", "KEYCODE_BACK");
await sleep(3000);
const focus = adb("shell", "dumpsys", "window");
const guidonFocused = /mCurrentFocus[^\n]*guidon/i.test(focus);
!guidonFocused
  ? ok("Back at root exits the app (launcher regains focus)")
  : bad("Back at root did nothing - app still focused");

console.log("\n" + (fails ? `ANDROID BACK: ${fails} FAILURE(S)` : "ANDROID BACK: all passed"));
process.exit(fails ? 1 : 0);
