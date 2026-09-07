/**
 * Capability collector for the INSTALLED desktop app (collective P2):
 * launches %LOCALAPPDATA%/GUIDON/guidon.exe with WebView2's documented
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223,
 * attaches to its page target with tools/cdp.mjs (page-level CDP, the same
 * client the Android collector uses), opens #/selftest?probe=1, captures the
 * app's GUIDON_CAPS console sentinel and writes
 *   artifacts/caps/webview2-desktop.json
 * then closes the app cleanly (CloseMainWindow, i.e. WM_CLOSE; taskkill only
 * if it is still alive 8 s later, and that is reported).
 *
 * This was a documented-but-unexercised claim until 2026-09-04: nothing had
 * ever confirmed the env var opens the port on the shipped exe. Every step
 * prints what it observed, and every failure names the step, so a "no" is
 * as useful as a "yes".
 *
 * The exe embeds the web/ it was BUILT with. When that page predates
 * src/app-modules/caps.js (no G.caps), the registry source is injected over
 * CDP and run there - same probes, same ids - and the file says so
 * (note + injected:true) with whatever sha that page carries (none, for a
 * pre-P2 build): tools/caps-matrix.mjs then refuses it on the sha rule, which
 * is the correct verdict for a page that is not this tree. Rebuild the
 * desktop app (npm run desktop:build) and rerun for accepted evidence.
 *
 * Usage: node tools/caps-webview2.mjs            (npm run caps:webview2)
 *   env  GUIDON_EXE   path to guidon.exe (default %LOCALAPPDATA%/GUIDON/guidon.exe)
 *        GUIDON_CDP_PORT  debug port (default 9223)
 * Exit: 0 file written - 1 the port never opened / no sentinel - 2 setup error
 */
import { spawn, execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachToPage } from "./cdp.mjs";
import { probeViaCdp, writeProbe, parseSentinel } from "./caps-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const EXE = process.env.GUIDON_EXE || join(process.env.LOCALAPPDATA || "", "GUIDON", "guidon.exe");
const PORT = Number(process.env.GUIDON_CDP_PORT || 9223);
const BASE = "http://127.0.0.1:" + PORT;
const ENV_VAR = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
const ENV_VAL = "--remote-debugging-port=" + PORT;

const say = (m) => console.log("  " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function portOpen() {
  try {
    const r = await fetch(BASE + "/json/version", { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

function closeMainWindow(pid) {
  // WM_CLOSE via .NET's Process.CloseMainWindow - the same thing the X button
  // sends, so Tauri's own close handling runs. Never throws.
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$p = Get-Process -Id " + pid + " -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow(); 'sent' } else { 'gone' }"],
      { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch (e) { return false; }
}

function alive(pid) {
  try {
    const out = execFileSync("tasklist.exe", ["/FI", "PID eq " + pid, "/NH"], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] });
    return new RegExp("\\b" + pid + "\\b").test(out);
  } catch (e) { return false; }
}

async function main() {
  console.log("caps-webview2: capability probe of the installed desktop exe over WebView2 CDP\n");
  const st = await stat(EXE).catch(() => null);
  if (!st || !st.isFile()) { console.error("  SETUP  exe not found: " + EXE + " (set GUIDON_EXE)"); process.exit(2); }
  say("exe:  " + EXE + " (" + (st.size / 1048576).toFixed(1) + " MB, modified " + st.mtime.toISOString().slice(0, 10) + ")");
  say("env:  " + ENV_VAR + "=" + ENV_VAL);

  if (await portOpen()) {
    console.error("  SETUP  " + BASE + " already answers /json/version before launch - another debug session owns the port; close it and rerun");
    process.exit(2);
  }

  const child = spawn(EXE, [], {
    env: { ...process.env, [ENV_VAR]: ENV_VAL },
    detached: true, stdio: "ignore", windowsHide: false,
  });
  child.unref();
  childPid = child.pid;
  let exited = false;
  child.on("exit", () => { exited = true; });
  say("launched pid " + child.pid);

  // Observation 1: does the env var open the port on THIS exe?
  let version = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !exited) {
    version = await portOpen();
    if (version) break;
    await sleep(500);
  }
  if (!version) {
    console.error("  FAIL  " + BASE + "/json/version never answered within 30 s of launch" + (exited ? " (the exe exited on its own)" : "") +
      " - " + ENV_VAR + "=" + ENV_VAL + " did NOT open a remote-debugging port on this exe (WebView2 honours the variable only when the host app does not set its own additionalBrowserArguments; check src-tauri/tauri.conf.json and the WebView2 runtime version)");
    await shutdown(child.pid);
    process.exit(1);
  }
  say("port: open after " + (Date.now() - t0) + " ms - " + (version.Browser || "?") + " / " + (version["User-Agent"] || "").slice(0, 80));

  // Observation 1b: the port opens BEFORE the app page exists - measured
  // 2026-09-04: 514 ms after launch the only target was about:blank, and a
  // registry injected there was gone the moment the real page navigated in.
  // Wait for a page target that is not about:blank, then for the app shell.
  let list = [], appTarget = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 30000 && !exited) {
    try { list = await (await fetch(BASE + "/json/list", { signal: AbortSignal.timeout(1500) })).json(); } catch (e) { list = []; }
    appTarget = list.find((t) => t.type === "page" && t.url && t.url !== "about:blank");
    if (appTarget) break;
    await sleep(500);
  }
  say("targets: " + (list.map((t) => t.type + " " + t.url).join(" ; ") || "(none)") + " (" + (Date.now() - t1) + " ms after the port opened)");
  if (!appTarget) {
    console.error("  FAIL  no page target other than about:blank within 30 s - the app never navigated to its page");
    await shutdown(child.pid);
    process.exit(1);
  }
  const page = await attachToPage(BASE, (t) => t.url === appTarget.url);
  say("attached: " + page.target.url);
  const t2 = Date.now();
  let booted = false;
  while (Date.now() - t2 < 30000) {
    booted = await page.evaluate(() => !!(window.G && window.G.routes && window.G.routes.length)).catch(() => false);
    if (booted) break;
    await sleep(500);
  }
  say("app shell: " + (booted ? "booted (G.routes present) after " + (Date.now() - t2) + " ms" : "NOT booted within 30 s - probing anyway"));

  const ident = await page.evaluate(() => ({
    version: window.GUIDON_APP_VERSION || null, built: window.GUIDON_BUILD_DATE || null,
    sha: window.GUIDON_BUILD_SHA || null, fork: window.GUIDON_FORK === undefined ? null : window.GUIDON_FORK,
    hasCaps: !!(window.G && window.G.caps && typeof window.G.caps.run === "function"),
    tauri: !!(window.__TAURI_INTERNALS__ || window.__TAURI__), origin: location.origin, ua: navigator.userAgent,
  }));
  say("page: GUIDON " + ident.version + " built " + ident.built + ", sha " + (ident.sha ? ident.sha.slice(0, 7) : "none") + ", GUIDON_FORK " + JSON.stringify(ident.fork) +
      ", __TAURI_INTERNALS__ " + ident.tauri + ", origin " + ident.origin);
  say("ua:   " + ident.ua);

  let injected = false;
  if (!ident.hasCaps) {
    // The shipped page predates caps.js: run the SAME registry source there.
    const src = await readFile(join(APP, "src", "app-modules", "caps.js"), "utf8");
    await page.send("Runtime.evaluate", { expression: src, returnByValue: true });
    const now = await page.evaluate(() => !!(window.G && window.G.caps && typeof window.G.caps.run === "function"));
    if (!now) { console.error("  FAIL  G.caps absent and injecting src/app-modules/caps.js did not define it"); await shutdown(child.pid); process.exit(1); }
    injected = true;
    say("G.caps: absent in the shipped page (built before caps.js) - registry injected over CDP for this measurement");
  } else say("G.caps: present in the shipped page");

  // Observation 2: the sentinel. A pre-P2 page has no probe path in its
  // Diagnostics render, so after the hash attempt fall back to asking the
  // (injected or shipped) registry directly - same probes, same payload.
  let payload = await probeViaCdp(page, { timeoutMs: injected ? 3000 : 10000 });
  let via = "sentinel";
  if (!payload) {
    const text = await page.evaluate(async () => { await window.G.caps.run(); return "GUIDON_CAPS " + window.G.caps.json(); });
    payload = parseSentinel(text);
    via = "direct G.caps.json() (no sentinel: the shipped Diagnostics predates the probe path)";
  }
  if (!payload) { console.error("  FAIL  no capability payload obtainable from the page"); await shutdown(child.pid); process.exit(1); }
  const n = Object.keys(payload.caps || {}).length;
  const supported = Object.values(payload.caps || {}).filter(Boolean).length;
  const file = await writeProbe({
    engine: "webview2", device: "desktop", collector: "tools/caps-webview2.mjs", payload,
    note: "installed exe " + EXE + " (GUIDON " + ident.version + " built " + ident.built + "), WebView2 " + (version.Browser || "?") +
          "; obtained via " + via + (injected ? "; registry INJECTED (page predates caps.js)" : ""),
  });
  say("probe: fork " + payload.fork + ", " + payload.engine + " " + payload.engineVersion + ", " + supported + "/" + n + " supported, via " + via);
  say("wrote " + file);

  page.close();
  await shutdown(child.pid);
  console.log("\nCAPS-WEBVIEW2: file written" + (injected ? " (registry injected; caps-matrix will refuse it on the sha rule until the desktop app is rebuilt from this tree)" : ""));
  process.exit(0);
}

async function shutdown(pid) {
  if (!alive(pid)) { say("close: pid " + pid + " already gone"); return; }
  const sent = closeMainWindow(pid);
  say("close: CloseMainWindow (WM_CLOSE) " + (sent ? "sent" : "could not be sent"));
  for (let i = 0; i < 16; i++) { await sleep(500); if (!alive(pid)) { say("close: exited cleanly after " + ((i + 1) * 500) + " ms"); return; } }
  try {
    execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
    say("close: still alive after 8 s - taskkill /F used as the last resort");
  } catch (e) { say("close: taskkill failed: " + (e && e.message)); }
}

// The exe must never outlive a failed run (the first exercise left one
// behind when an evaluate threw): any escape from main() still closes it.
let childPid = null;
main().catch(async (e) => {
  console.error("  ERROR " + (e && e.stack || e));
  if (childPid) await shutdown(childPid);
  process.exit(2);
});
