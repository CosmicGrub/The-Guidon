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
 * Output: one guidon-probe/1 JSON object (stdout, and --out when given):
 *   { schema, kind: "android-ws", at, label, target: { ip, port, url },
 *     page: { origin, ua, secure, fork, app, sha }, result: { result:
 *     open|closed|throw|timeout, ms, code, reason, wasClean, error },
 *     console: [ ...lines the page logged during the attempt ] }
 * Nothing is sent to the target but the WebSocket handshake itself; the
 * socket is closed the moment it opens.
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
if (!IP || args.includes("--help")) {
  console.log("usage: node tools/probe-android-ws.mjs --ip <non-loopback IP> [--port 8787] [--room ALPHA-BRAVO-42] [--cdp http://127.0.0.1:9222] [--label text] [--out file.json] [--chromium]");
  process.exit(IP ? 0 : 2);
}
if (/^(127\.|localhost$|::1$|0\.0\.0\.0$)/.test(IP)) { console.error("probe-android-ws: " + IP + " is loopback - loopback answers the wrong question; give a LAN or hotspot IP"); process.exit(2); }

await import(pathToFileURL(resolve("src/app-modules/room-schema.js")).href);
const S = globalThis.G.roomSchema;
const url = S.wsUrl(IP + ":" + PORT, ROOM, "peer");

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
const LIMIT_MS = 8000;

async function viaCdp() {
  const { attachToPage } = await import("./cdp.mjs");
  const cdp = await attachToPage(CDP, (t) => /guidon|localhost|index\.html/i.test(t.url) || true);
  const consoleLines = [];
  cdp.onEvent((m) => {
    if (m.method === "Runtime.consoleAPICalled") consoleLines.push((m.params.type || "log") + ": " + (m.params.args || []).map((a) => a.value != null ? String(a.value) : a.description || "").join(" "));
    if (m.method === "Log.entryAdded") consoleLines.push((m.params.entry.level || "log") + ": " + m.params.entry.text + (m.params.entry.url ? " (" + m.params.entry.url + ")" : ""));
  });
  const r = await cdp.evaluate(PROBE + "(" + JSON.stringify(url) + "," + LIMIT_MS + ")");
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
  const r = await page.evaluate("(" + PROBE + ")(" + JSON.stringify(url) + "," + LIMIT_MS + ")");
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
  schema: "guidon-probe/1", kind: "android-ws", at: new Date().toISOString(), label: LABEL || (DRY ? "dry-run (laptop Chromium, http origin)" : "apk"),
  target: { ip: IP, port: PORT, room: ROOM, url }, transport: DRY ? "playwright-chromium" : "cdp " + CDP,
  page: r.page, result: r.result, console: r.console || [],
};
const text = JSON.stringify(record, null, 2) + "\n";
process.stdout.write(text);
if (OUT) { await writeFile(OUT, text, "utf8"); console.error("probe-android-ws: wrote " + OUT); }
process.exit(record.result && record.result.result === "tool-error" ? 1 : 0);
