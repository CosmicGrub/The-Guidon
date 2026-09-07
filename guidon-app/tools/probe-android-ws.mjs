#!/usr/bin/env node
/**
 * P0 spike probe (collective P3b, X1 step 1): from the APK's own page, over
 * adb-forwarded CDP (tools/cdp.mjs), attempt `new WebSocket("ws://<NON-
 * loopback IP>:<port>/ws?...")` and report EXACTLY what the WebView said -
 * the open, or the close code / reason / console line (the mixed-content
 * block from an https://localhost origin is the question this answers).
 *
 *   node tools/probe-android-ws.mjs --ip 192.168.43.1 [--port 8787]
 *        [--room ALPHA-BRAVO-42] [--cdp http://127.0.0.1:9222]
 *        [--label "allowMixedContent=false"] [--out docs/evidence/<file>.json]
 *
 *   node tools/probe-android-ws.mjs --chromium --ip 192.0.2.1 [--port 8787]
 *        Dry run with no phone: launches Playwright Chromium, serves web/
 *        on 127.0.0.1 and runs the identical in-page probe from that page
 *        (an http:// origin, so no mixed-content block - the point is that
 *        the tool runs end to end before 09-08). 192.0.2.1 is TEST-NET-1:
 *        never routable, so the expected result is a timeout or an
 *        immediate close 1006.
 *
 *   node tools/probe-android-ws.mjs --ip <lan-ip> --secure --pin <64-hex>
 *        [--tls-port 8788] [--room ...] [--cdp ...] [--out ...]
 *        room-tls-and-discovery-pitch.md Section 1/3: the pinned wss://
 *        path a plain `new WebSocket("wss://...")` can never take from
 *        ANY JS context (there is no JS-reachable hook to accept an
 *        unknown self-signed cert - see the pitch doc's own opening
 *        paragraph). This mode does NOT touch the WebSocket constructor
 *        at all: it drives window.Capacitor.Plugins.RoomTls (the native
 *        pinned-TLS client, android/.../RoomTlsPlugin.kt) the same way
 *        src/room-web.js's makeNativeTransport() does - connect({url,
 *        pin}) -> a roomTlsEvent stream of open/message/close/error - and
 *        reports exactly what the plugin said. `result: "no-native-
 *        plugin"` means this build has no RoomTlsPlugin registered (see
 *        `page.roomTlsPlugin` in the output); `--chromium` is refused for
 *        this mode (no window.Capacitor in a bare browser tab, so it
 *        would only ever prove the negative). This is a CONNECTIVITY
 *        check (does the pinned socket open) - it does not send a hello
 *        or exercise the app's own reducer; tools/test-network-floor.mjs
 *        --fork android is the full real hello->welcome round trip
 *        through the actual Settings/Join UI, built on the same adb/CDP
 *        attach technique this file established.
 *
 * Output: one guidon-probe/1 JSON object (stdout, and --out when given):
 *   { schema, kind: "android-ws", at, label, target: { ip, port, room,
 *     url, secure, pin, tlsPort }, transport, page: { origin, ua, secure,
 *     fork, app, sha, roomTlsPlugin }, result: { result: open|closed|
 *     throw|timeout|no-native-plugin, ms, code, reason, wasClean, error },
 *     console: [ ...lines the page logged during the attempt ] }
 * Nothing is sent to the target but the handshake itself (plain
 * WebSocket, or the native plugin's TLS connect); the socket is closed
 * the moment it opens either way.
 */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const val = (flag, d) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const IP = val("--ip", null);
const PORT = Number(val("--port", 8787));
const ROOM = String(val("--room", "ALPHA-BRAVO-42")).toUpperCase();
const CDP = val("--cdp", "http://127.0.0.1:9222");
const LABEL = val("--label", "");
const OUT = val("--out", null);
const DRY = args.includes("--chromium");
/* room-tls-and-discovery-pitch.md Section 1/3: the pinned wss:// path via
   the native RoomTlsPlugin - a genuinely different transport from the raw
   WebSocket probe above, never reachable from plain JS (see this file's
   own header). --tls-port defaults to --port + 1, matching room-server.mjs
   and src-tauri/src/room.rs's shared "plaintext port + 1" convention. */
const SECURE = args.includes("--secure");
const PIN = val("--pin", null);
const TLS_PORT = Number(val("--tls-port", PORT + 1));
if (!IP || args.includes("--help")) {
  console.log("usage: node tools/probe-android-ws.mjs --ip <non-loopback IP> [--port 8787] [--room ALPHA-BRAVO-42] [--cdp http://127.0.0.1:9222] [--label text] [--out file.json] [--chromium]");
  console.log("       node tools/probe-android-ws.mjs --ip <non-loopback IP> --secure --pin <64-hex spkiSha256> [--tls-port 8788] ...");
  process.exit(IP ? 0 : 2);
}
if (/^(127\.|localhost$|::1$|0\.0\.0\.0$)/.test(IP)) { console.error("probe-android-ws: " + IP + " is loopback - loopback answers the wrong question; give a LAN or hotspot IP"); process.exit(2); }
if (SECURE && !/^[0-9a-f]{64}$/.test(String(PIN))) { console.error("probe-android-ws: --secure requires --pin <64 lowercase hex chars> (the full SHA-256(SPKI), e.g. from RoomInfo.identity.spkiSha256 - never the truncated fp)"); process.exit(2); }
if (SECURE && DRY) { console.error("probe-android-ws: --secure + --chromium makes no sense - a bare browser tab has no window.Capacitor.Plugins.RoomTls, so this would only ever prove the (expected) negative"); process.exit(2); }

await import(pathToFileURL(resolve("src/app-modules/room-schema.js")).href);
const S = globalThis.G.roomSchema;
const url = SECURE ? S.wsUrl(IP + ":" + TLS_PORT, ROOM, "peer", true) : S.wsUrl(IP + ":" + PORT, ROOM, "peer");

/* The in-page probe. Runs unchanged in the APK's WebView (over CDP) and in
   Playwright Chromium (dry run). */
const PROBE = `(async (url, limitMs) => {
  const t0 = performance.now();
  const page = { origin: location.origin, ua: navigator.userAgent, secure: window.isSecureContext, fork: window.GUIDON_FORK || null, app: window.GUIDON_APP_VERSION || null, sha: window.GUIDON_BUILD_SHA || null };
  return new Promise((res) => {
    let done = false;
    const fin = (o) => { if (done) return; done = true; res({ page, result: Object.assign({ url, ms: Math.round(performance.now() - t0) }, o) }); };
    let ws;
    try { ws = new WebSocket(url); }
    catch (e) { return fin({ result: "throw", error: String(e && e.message || e), name: e && e.name }); }
    ws.onopen = () => { fin({ result: "open" }); try { ws.close(1000, "probe"); } catch (e) {} };
    ws.onerror = () => {};
    ws.onclose = (ev) => fin({ result: "closed", code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
    setTimeout(() => { fin({ result: "timeout" }); try { ws.close(); } catch (e) {} }, limitMs);
  });
})`;
/* The --secure sibling: the SAME open/closed/timeout/throw shape, over
   window.Capacitor.Plugins.RoomTls (connect/send/close + the roomTlsEvent
   stream - the exact surface src/room-web.js's makeNativeTransport() uses,
   see this file's own header) instead of `new WebSocket(url)`. A missing
   plugin (a build that predates its registration, or any non-Android
   fork) is its own named result, "no-native-plugin", never confused with
   a real closed/timeout from an actual connection attempt. */
const PROBE_SECURE = `(async (url, pin, limitMs) => {
  const t0 = performance.now();
  const page = { origin: location.origin, ua: navigator.userAgent, secure: window.isSecureContext, fork: window.GUIDON_FORK || null, app: window.GUIDON_APP_VERSION || null, sha: window.GUIDON_BUILD_SHA || null, roomTlsPlugin: !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RoomTls) };
  const plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RoomTls;
  if (!plugin) return { page, result: { url, ms: Math.round(performance.now() - t0), result: "no-native-plugin" } };
  return new Promise((res) => {
    let done = false, id = null;
    const fin = (o) => { if (done) return; done = true; try { if (id != null) plugin.close({ id }); } catch (e) {} res({ page, result: Object.assign({ url, ms: Math.round(performance.now() - t0) }, o) }); };
    try {
      plugin.addListener("roomTlsEvent", (ev) => {
        if (id != null && ev && ev.id !== id) return;
        if (ev.type === "open") fin({ result: "open" });
        else if (ev.type === "close") fin({ result: "closed" });
        else if (ev.type === "error") fin({ result: "error" });
      });
    } catch (e) { return fin({ result: "throw", error: String(e && e.message || e), name: e && e.name }); }
    plugin.connect({ url, pin }).then((r) => { id = r && r.id; }).catch((e) => fin({ result: "throw", error: String(e && e.message || e), name: e && e.name }));
    setTimeout(() => fin({ result: "timeout" }), limitMs);
  });
})`;
const LIMIT_MS = 8000;
const probeCall = (a) => (SECURE ? PROBE_SECURE : PROBE) + "(" + a.map((x) => JSON.stringify(x)).join(",") + ")";
const PROBE_ARGS = SECURE ? [url, PIN, LIMIT_MS] : [url, LIMIT_MS];

async function viaCdp() {
  const { attachToPage } = await import("./cdp.mjs");
  const cdp = await attachToPage(CDP, (t) => /guidon|localhost|index\.html/i.test(t.url) || true);
  const consoleLines = [];
  cdp.onEvent((m) => {
    if (m.method === "Runtime.consoleAPICalled") consoleLines.push((m.params.type || "log") + ": " + (m.params.args || []).map((a) => a.value != null ? String(a.value) : a.description || "").join(" "));
    if (m.method === "Log.entryAdded") consoleLines.push((m.params.entry.level || "log") + ": " + m.params.entry.text + (m.params.entry.url ? " (" + m.params.entry.url + ")" : ""));
  });
  const r = await cdp.evaluate(probeCall(PROBE_ARGS));
  await cdp.sleep(300);
  cdp.close();
  return { target: cdp.target.url, ...r, console: consoleLines };
}

async function viaChromium() {
  const { chromium } = await import("playwright");
  const { serve } = await import("./server.mjs");
  const { server, url: base } = await serve("web");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleLines = [];
  page.on("console", (m) => consoleLines.push(m.type() + ": " + m.text()));
  page.on("pageerror", (e) => consoleLines.push("pageerror: " + e.message));
  await page.goto(base + "#/home", { waitUntil: "load" });
  await page.waitForTimeout(500);
  const r = await page.evaluate(probeCall(PROBE_ARGS));
  await browser.close();
  await new Promise((res) => server.close(res));
  return { target: base, ...r, console: consoleLines };
}

let r;
try { r = DRY ? await viaChromium() : await viaCdp(); }
catch (e) {
  r = { page: null, result: { url, result: "tool-error", error: String(e && e.message || e) }, console: [] };
  if (!DRY) r.result.hint = "no CDP at " + CDP + "? adb forward tcp:9222 localabstract:webview_devtools_remote_<pid> first (see docs/spike/P0-RUN-SHEET.md step 1)";
}
const record = {
  schema: "guidon-probe/1", kind: "android-ws", at: new Date().toISOString(),
  label: LABEL || (DRY ? "dry-run (laptop Chromium, http origin)" : (SECURE ? "apk (native pinned-TLS, RoomTlsPlugin)" : "apk")),
  target: SECURE ? { ip: IP, port: TLS_PORT, room: ROOM, url, secure: true, pin: PIN } : { ip: IP, port: PORT, room: ROOM, url, secure: false },
  transport: DRY ? "playwright-chromium" : (SECURE ? "cdp " + CDP + " (window.Capacitor.Plugins.RoomTls)" : "cdp " + CDP),
  page: r.page, result: r.result, console: r.console || [],
};
const text = JSON.stringify(record, null, 2) + "\n";
process.stdout.write(text);
if (OUT) { await writeFile(OUT, text, "utf8"); console.error("probe-android-ws: wrote " + OUT); }
process.exit(record.result && record.result.result === "tool-error" ? 1 : 0);
