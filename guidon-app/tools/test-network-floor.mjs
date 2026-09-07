#!/usr/bin/env node
/**
 * The networking-capabilities FLOOR (room-tls-and-discovery-pitch.md
 * Section 3, "The networking-capabilities floor"): a second, deliberately
 * DESTRUCTIVE measurement lane next to G.caps's cheap existence probes
 * (src/app-modules/caps.js's webSocket/rtcDataChannel rows answer "does the
 * constructor exist", nothing else). This tool answers the real question,
 * per fork: does a REAL hello->welcome round trip actually complete over
 * this fork's own transport, today, on this machine/device?
 *
 *   node tools/test-network-floor.mjs --fork web
 *   node tools/test-network-floor.mjs --fork pwa
 *   node tools/test-network-floor.mjs --fork tauri  [--exe <guidon.exe>]
 *   node tools/test-network-floor.mjs --fork android [--adb-device <serial>]
 *                                     [--exe <guidon.exe>] [--package <id>]
 *
 * Every fork does a REAL round trip, never a synthetic stand-in for the
 * thing being measured:
 *   web / pwa   a real Node room-server.mjs (loopback, plaintext) hosts;
 *               the REAL app reducer runs the host side too
 *               (tools/room-node-host.mjs's nodeHost - the exact code
 *               G.studyGroup runs, not a second implementation), so only
 *               the JOINER side is the thing under test; a real Playwright
 *               Chromium loads the real built web/ page and calls the
 *               real window.__GUIDON_ROOM_WEB__.joinAt() - the same
 *               function a Soldier's tap on "Join" calls. "pwa" is the
 *               identical page with matchMedia patched (addInitScript,
 *               BEFORE any app script runs) to report display-mode:
 *               standalone, so G.caps.fork() genuinely computes "pwa"
 *               through its own real logic - there is no way to make a
 *               headless browser an installed PWA any other way; this is
 *               a deliberate, documented substitution for one unmeasurable
 *               signal (display-mode), not a synthetic network round trip.
 *   tauri       the REAL debug exe (src-tauri/target/debug/guidon.exe),
 *               driven over WebView2 CDP exactly like tools/test-room-
 *               tauri.mjs: G.studyGroup.host() opens the REAL Rust
 *               listener (src-tauri/src/room.rs); a real tools/room-node-
 *               host.mjs nodePeer (the real reducer, over a real
 *               WebSocket) joins it as a peer.
 *   android     the hardest one, and the one with no synthetic substitute
 *               at all (room-tls-and-discovery-pitch.md Section 3): the
 *               SAME real Tauri exe hosts a REAL room and mints a REAL
 *               per-room TLS identity (tlsPort + identity.spkiSha256 on
 *               RoomInfo); tools/probe-android-ws.mjs's own adb/CDP
 *               technique attaches to the REAL shipped app's WebView on a
 *               REAL device; the Settings -> Study groups toggle and the
 *               Join panel are driven exactly as a Soldier would use them
 *               (a real DOM click on the aria-labelled checkbox, real
 *               input events on the join-code/name fields, a real click on
 *               the Join button) - never a backdoor store.setSetting()/
 *               joinAt() call on that device, unlike the desktop forks
 *               above where driving the seam directly is the established,
 *               proven pattern (tools/test-room-tauri.mjs). This is the
 *               one measurement `RoomTlsPlugin.kt`'s native pinned-TLS
 *               client (registered in MainActivity 2026-09-06) and
 *               room-web.js's native-transport routing actually get
 *               exercised end to end, on real hardware, by an automated
 *               tool - not just by hand once.
 *
 * Every run collects ONE guidon-netfloor/1 record and writes it to
 * artifacts/net-floor/<fork>-<device>.json (device defaults per fork below;
 * --device overrides). tools/lint-network-floor.mjs is the gate that reads
 * these back; this tool only ever produces evidence, it never judges it -
 * same division of labour as the collectors under artifacts/caps/ and
 * tools/caps-matrix.mjs.
 *
 * A precondition that cannot be met (no debug exe, no adb device) is a
 * SKIP, exit 0, NO FILE WRITTEN - never a fabricated measurement (the
 * pitch doc's own rule: "gate on staleness/absence, never fabricate a
 * CI-only Android measurement"). A precondition that IS met but the round
 * trip then fails writes a REAL ok:false record - that is genuine evidence
 * of a regression, not a reason to suppress the file.
 *
 * Exit code: 0 on a completed measurement (ok:true or ok:false - either is
 * a real answer) or a graceful skip; 1 only on a tool-level error (a
 * precondition check itself throwing, a file-write failure, bad args).
 */
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { attachToPage } from "./cdp.mjs";
import { serve } from "./server.mjs";
import { nodeHost, nodePeer } from "./room-node-host.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const OUT_DIR = resolve(APP, "artifacts", "net-floor");

await import(pathToFileURL(resolve(APP, "src/app-modules/room-schema.js")).href);
const S = globalThis.G.roomSchema;
const ROOM = "XRAY-ZULU-99"; // a fixed room code (must be 2 real NATO words + 2 digits - G.roomSchema.isRoomCode()) for this tool's own traffic

const args = process.argv.slice(2);
const val = (flag, d) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const FORK = val("--fork", null);
const DEVICE_OVERRIDE = val("--device", null);
const OUT_OVERRIDE = val("--out", null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, limit = 8000, step = 50) {
  const t0 = Date.now();
  for (;;) {
    let value = null;
    try { value = await pred(); } catch (e) { value = null; }
    if (value) return { hit: true, ms: Date.now() - t0, value };
    if (Date.now() - t0 >= limit) return { hit: false, ms: Date.now() - t0, value };
    await sleep(step);
  }
}

if (!FORK || !["web", "pwa", "tauri", "android"].includes(FORK)) {
  console.log("usage: node tools/test-network-floor.mjs --fork <web|pwa|tauri|android> [--device <name>] [--out <file>]");
  console.log("  tauri:   [--exe <guidon.exe>]  (default src-tauri/target/debug/guidon.exe, env GUIDON_EXE)");
  console.log("  android: [--adb-device <serial>] [--package <id>] [--exe <guidon.exe> for the host side]");
  process.exit(FORK ? 1 : 2);
}

/* ------------------------------------------------------------- reporting */
console.log("test-network-floor: real hello->welcome round trip, fork=" + FORK + "\n");
const say = (m) => console.log("  " + m);

async function writeRecord(fork, device, rec) {
  await mkdir(OUT_DIR, { recursive: true });
  const file = OUT_OVERRIDE ? resolve(OUT_OVERRIDE) : join(OUT_DIR, fork + "-" + device + ".json");
  const full = {
    schema: "guidon-netfloor/1",
    fork, device,
    collector: "tools/test-network-floor.mjs",
    collectedAt: new Date().toISOString(),
    room: ROOM,
    ok: !!rec.ok,
    ms: rec.ms || null,
    detail: rec.detail || {},
    note: rec.note || "",
  };
  await writeFile(file, JSON.stringify(full, null, 2) + "\n", "utf8");
  say((full.ok ? "OK   " : "FAIL ") + "wrote " + file);
  return { file, full };
}

function skip(reason) {
  console.log("  SKIP  " + reason);
  console.log("\nNETWORK-FLOOR: SKIPPED (" + FORK + ") - no file written");
  process.exit(0);
}
function toolError(e) {
  console.error("  ERROR " + (e && e.stack ? e.stack.split("\n").slice(0, 6).join(" ") : e));
  console.log("\nNETWORK-FLOOR: TOOL ERROR (" + FORK + ")");
  process.exit(1);
}

/* -------------------------------------------------- web / pwa (shared) */
async function runWebOrPwa(pwaMode) {
  const GUEST = resolve(APP, "dist", "guest.html");
  let srv = null, host = null, browser = null, server = null;
  const t0 = Date.now();
  try {
    srv = await (await import("./room-server.mjs")).startRoomServer({ loopback: true, port: 0, guest: GUEST, quiet: true });
    say("real Node room server listening on 127.0.0.1:" + srv.port + " (loopback, plaintext)");
    host = nodeHost({ wsBase: "127.0.0.1:" + srv.port, room: ROOM, fp: "NETFLHST", name: "NET-FLOOR-HOST" });
    await host.ready;
    say("real G.studyGroup host reducer (tools/room-node-host.mjs nodeHost) connected as the room's host");

    const served = await serve("web");
    server = served.server;
    browser = await chromium.launch();
    const context = await browser.newContext();
    if (pwaMode) {
      // The ONE unmeasurable signal in headless Chromium: display-mode.
      // Patched BEFORE any app script runs so G.caps.fork()'s real
      // isInstalledPwa() check (matchMedia("(display-mode: standalone)"))
      // computes "pwa" through its own real logic, not a hard-coded value.
      await context.addInitScript(() => {
        const real = window.matchMedia ? window.matchMedia.bind(window) : null;
        window.matchMedia = (q) => {
          if (typeof q === "string" && /display-mode:\s*standalone/.test(q)) {
            return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
          }
          return real ? real(q) : { matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
        };
      });
    }
    const page = await context.newPage();
    const noise = [];
    page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") noise.push("console: " + m.text()); });
    await page.goto(served.url + "#/home", { waitUntil: "load" });
    const booted = await until(() => page.evaluate(() => !!(window.G && window.G.routes && window.G.routes.length && window.G.studyGroup && window.G.store && window.__GUIDON_ROOM_WEB__)), 20000, 100);
    if (!booted.hit) return { ok: false, detail: { reason: "app shell did not boot within 20s" } };
    const forkVal = await page.evaluate(() => window.G.caps ? window.G.caps.fork() : null);
    say("page booted after " + booted.ms + " ms; G.caps.fork() = " + JSON.stringify(forkVal));

    await page.evaluate(async () => { await window.G.store.setSetting("studyGroups", true); });
    const joinUrl = S.joinUrl("http://127.0.0.1:" + srv.port, ROOM);
    const joinName = "NET-FLOOR-PEER";
    const tJoin = Date.now();
    const joinResult = await page.evaluate(([u, n]) => window.__GUIDON_ROOM_WEB__.joinAt(u, n), [joinUrl, joinName]);
    if (!joinResult || joinResult.ok !== true) return { ok: false, detail: { reason: "joinAt() refused", joinResult, forkVal } };

    const helloWait = await until(() => host.pending().find((p) => p.name === joinName) || null, 8000);
    if (!helloWait.hit) return { ok: false, detail: { reason: "hello never reached the real host reducer", forkVal, pending: host.pending() } };
    const fp = helloWait.value.fp;
    const helloMs = Date.now() - tJoin;
    host.act({ type: "admit", fp });
    const seated = await until(() => page.evaluate(() => { const s = window.G.studyGroup.state(); return s && s.joinState === "seated" ? s.self.seatNo : null; }), 8000);
    if (!seated.hit) return { ok: false, detail: { reason: "welcome never reached the page (not seated)", forkVal, helloMs } };
    const welcomeMs = Date.now() - tJoin - helloMs;
    await page.evaluate(() => { try { window.G.studyGroup.leave(); } catch (e) {} });
    return {
      ok: noise.length === 0,
      ms: { helloMs, welcomeMs, totalMs: Date.now() - t0 },
      detail: { forkVal, seatNo: seated.value, transport: "ws:// loopback (room-server.mjs)", pageNoise: noise.slice(0, 5) },
      note: pwaMode ? "display-mode:standalone simulated via addInitScript (matchMedia); the network round trip itself is real (Node room-server.mjs + a real Playwright page)." : "",
    };
  } finally {
    if (host) host.close();
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((res) => server.close(res));
    if (srv) await srv.close().catch(() => {});
  }
}

/* ----------------------------------------------------- tauri host helper */
function alive(pid) {
  try {
    const out = execFileSync("tasklist.exe", ["/FI", "PID eq " + pid, "/NH"], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] });
    return new RegExp("\\b" + pid + "\\b").test(out);
  } catch (e) { return false; }
}
function guidonRunning() {
  try {
    const out = execFileSync("tasklist.exe", ["/FI", "IMAGENAME eq guidon.exe", "/NH"], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] });
    return /guidon\.exe/i.test(out);
  } catch (e) { return false; }
}
function closeMainWindow(pid) {
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$p = Get-Process -Id " + pid + " -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() }"],
      { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {}
}
async function shutdownExe(child, dataDir) {
  if (!child) return;
  if (alive(child.pid)) {
    closeMainWindow(child.pid);
    for (let i = 0; i < 16 && alive(child.pid); i++) await sleep(500);
    if (alive(child.pid)) { try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 15000 }); } catch (e) {} }
  }
  if (dataDir) {
    for (let i = 0; i < 10; i++) { await sleep(300); try { await rm(dataDir, { recursive: true, force: true }); } catch (e) {} try { await stat(dataDir); } catch (e) { break; } }
  }
}
async function cdpUp(base) {
  try { const r = await fetch(base + "/json/version", { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}

/**
 * launchTauriHost(cdpPort) - the REAL debug exe, GUIDON_ROOM_TEST=1, a
 * throwaway WebView2 profile (real IndexedDB never opened), Study groups
 * flipped on, a real board room hosted (mirrors tools/test-room-tauri.mjs's
 * own proven (0)/(1)/(3) sections exactly - never a second implementation
 * of "how to boot and host with this exe"). Returns null (with a `skip`
 * reason) on any unmet precondition; otherwise { page, child, dataDir, RI }.
 */
async function launchTauriHost(cdpPort) {
  const EXE = val("--exe", process.env.GUIDON_EXE || join(APP, "src-tauri", "target", "debug", "guidon.exe"));
  const st = await stat(EXE).catch(() => null);
  if (!st || !st.isFile()) return { skip: EXE + " does not exist - build it with `npm run build` then `npx tauri build --debug --no-bundle` (two separate commands)" };
  if (guidonRunning()) return { skip: "a guidon.exe is already running - close it and rerun" };
  const base = "http://127.0.0.1:" + cdpPort;
  if (await cdpUp(base)) return { skip: base + " already answers /json/version - another debug session owns the port" };

  const dataDir = await mkdtemp(join(tmpdir(), "guidon-net-floor-"));
  const child = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=" + cdpPort, WEBVIEW2_USER_DATA_FOLDER: dataDir, GUIDON_ROOM_TEST: "1" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child.stdout.on("data", () => {}); child.stderr.on("data", () => {});
  say("launched " + EXE + " pid " + child.pid + " (throwaway profile " + dataDir + ")");

  const up = await until(() => cdpUp(base), 30000, 300);
  if (!up.hit) { await shutdownExe(child, dataDir); return { skip: base + " never answered /json/version within 30s" }; }
  const target = await until(async () => { const list = await (await fetch(base + "/json/list")).json(); return list.find((t) => t.type === "page" && t.url && t.url !== "about:blank") || null; }, 30000, 300);
  if (!target.hit) { await shutdownExe(child, dataDir); return { skip: "no app page target within 30s" }; }
  const page = await attachToPage(base, (t) => t.url === target.value.url);
  const booted = await until(() => page.evaluate(() => !!(window.G && window.G.routes && window.G.routes.length && window.G.studyGroup && window.G.store)), 30000, 250);
  if (!booted.hit) { await shutdownExe(child, dataDir); return { skip: "app shell did not boot within 30s" }; }
  say("attached over CDP; app shell booted after " + booted.ms + " ms");

  await page.evaluate(async () => { location.hash = "#/group"; await window.G.store.setSetting("studyGroups", true); });
  await until(() => page.evaluate(() => !!(window.G.studyGroup.available() && window.__GUIDON_ROOM__ && window.__GUIDON_ROOM__.attached())), 5000);
  const hosted = await page.evaluate(() => window.G.studyGroup.host({ mode: "board", name: "NETFLOOR-HOST", count: 2, category: "All" }));
  if (!hosted || !hosted.ok) { await shutdownExe(child, dataDir); return { skip: "G.studyGroup.host() refused: " + JSON.stringify(hosted) }; }
  const riWait = await until(() => page.evaluate(() => window.__GUIDON_ROOM__.info()), 10000, 100);
  const RI = riWait.value;
  if (!riWait.hit || !RI || typeof RI.port !== "number") { await shutdownExe(child, dataDir); return { skip: "no RoomInfo from room_start" }; }
  say("real Rust room listener: " + JSON.stringify({ ip: RI.ip, port: RI.port, tlsPort: RI.tlsPort, fp: RI.identity && RI.identity.fp }));
  return { page, child, dataDir, RI, room: hosted.room };
}

/* --------------------------------------------------------------- tauri */
async function runTauri() {
  const device = DEVICE_OVERRIDE || "desktop";
  const CDP_PORT = Number(process.env.GUIDON_CDP_PORT || 9224);
  const t0 = Date.now();
  const h = await launchTauriHost(CDP_PORT);
  if (h.skip) return skip("(tauri) " + h.skip);
  const { page, child, dataDir, RI, room } = h;
  let peer = null;
  try {
    const wsBase = RI.ip + ":" + RI.port;
    peer = nodePeer({ wsBase, room, fp: "NFLRPEER", name: "NET-FLOOR-PEER" });
    await peer.ready;
    const tHello = Date.now();
    peer.hello();
    const pendingHit = await until(async () => (await page.evaluate(() => window.G.studyGroup.state().pending)).find((p) => p.fp === "NFLRPEER") ? true : null, 8000);
    if (!pendingHit.hit) return await writeRecord("tauri", device, { ok: false, detail: { reason: "hello never reached the real Rust listener's host page", RI: { ip: RI.ip, port: RI.port, tlsPort: RI.tlsPort } } });
    const helloMs = Date.now() - tHello;
    await page.evaluate(() => window.G.studyGroup.hostAction({ type: "admit", fp: "NFLRPEER" }));
    const seated = await until(() => { const s = peer.state(); return s.joinState === "seated" ? s.self.seatNo : null; }, 8000);
    if (!seated.hit) return await writeRecord("tauri", device, { ok: false, detail: { reason: "welcome never reached the real nodePeer joiner", helloMs } });
    const welcomeMs = Date.now() - tHello - helloMs;
    return await writeRecord("tauri", device, {
      ok: true,
      ms: { helloMs, welcomeMs, totalMs: Date.now() - t0 },
      detail: { transport: "ws:// (src-tauri/src/room.rs, plaintext listener)", roomIp: RI.ip, roomPort: RI.port, tlsPort: RI.tlsPort, seatNo: seated.value },
    });
  } finally {
    if (peer) peer.close();
    try { await page.evaluate(() => { try { window.G.studyGroup.leave(); } catch (e) {} }); } catch (e) {}
    try { page.close(); } catch (e) {}
    await shutdownExe(child, dataDir);
  }
}

/* -------------------------------------------------------------- android */
const ADB = process.env.ADB || "adb";
function adb(deviceSerial, argv, opts) {
  const full = deviceSerial ? ["-s", deviceSerial, ...argv] : argv;
  return execFileSync(ADB, full, { encoding: "utf8", timeout: 15000, ...opts });
}
async function pickAdbDevice(explicit) {
  if (explicit) return explicit;
  if (process.env.GUIDON_ANDROID_DEVICE) return process.env.GUIDON_ANDROID_DEVICE;
  let out;
  try { out = execFileSync(ADB, ["devices"], { encoding: "utf8", timeout: 10000 }); } catch (e) { return null; }
  const lines = out.split(/\r?\n/).slice(1).map((l) => l.trim()).filter((l) => l && /\bdevice$/.test(l));
  if (lines.length !== 1) return null;
  return lines[0].split(/\s+/)[0];
}
async function androidPackagePid(serial, pkg) {
  let out;
  try { out = adb(serial, ["shell", "ps", "-A"]); } catch (e) { return null; }
  const line = out.split(/\r?\n/).find((l) => l.trim().endsWith(" " + pkg) || l.trim().endsWith("\t" + pkg));
  if (!line) return null;
  const cols = line.trim().split(/\s+/);
  return cols.length >= 2 ? cols[1] : null;
}
async function androidWebviewSocket(serial, pid) {
  let out;
  try { out = adb(serial, ["shell", "cat", "/proc/net/unix"]); } catch (e) { return null; }
  const lines = out.split(/\r?\n/).filter((l) => l.includes("webview_devtools_remote_"));
  const mine = lines.find((l) => l.includes("webview_devtools_remote_" + pid));
  const line = mine || lines[0];
  if (!line) return null;
  const m = /(webview_devtools_remote_\d+)/.exec(line);
  return m ? m[1] : null;
}

async function runAndroid() {
  const serial = await pickAdbDevice(val("--adb-device", null));
  if (!serial) return skip("(android) no single adb device found (set --adb-device or GUIDON_ANDROID_DEVICE; `adb devices` must show exactly one)");
  const device = DEVICE_OVERRIDE || serial.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const PKG = val("--package", process.env.GUIDON_ANDROID_PACKAGE || "app.guidon.trainer");

  let pid = await androidPackagePid(serial, PKG);
  if (!pid) {
    say("(android) " + PKG + " is not running on " + serial + " - launching it");
    try { adb(serial, ["shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1"]); } catch (e) { return skip("(android) could not launch " + PKG + " on " + serial + ": " + e.message); }
    const started = await until(async () => androidPackagePid(serial, PKG), 15000, 500);
    if (!started.hit) return skip("(android) " + PKG + " did not appear in `ps -A` within 15s of launching it");
    pid = started.value;
    await sleep(1500); // let the WebView actually attach before we go looking for its devtools socket
  }
  say("(android) " + PKG + " running as pid " + pid + " on " + serial);
  const sockName = await androidWebviewSocket(serial, pid);
  if (!sockName) return skip("(android) no webview_devtools_remote_* socket found for pid " + pid + " on " + serial + " (is WebView debugging enabled? see docs/spike/P0-RUN-SHEET.md)");
  const CDP_PORT_PHONE = Number(process.env.GUIDON_CDP_PORT_ANDROID || 9333);
  try { adb(serial, ["forward", "tcp:" + CDP_PORT_PHONE, "localabstract:" + sockName]); } catch (e) { return skip("(android) adb forward failed: " + e.message); }
  say("(android) adb forward tcp:" + CDP_PORT_PHONE + " -> localabstract:" + sockName);

  const CDP_PORT_HOST = Number(process.env.GUIDON_CDP_PORT || 9224);
  const h = await launchTauriHost(CDP_PORT_HOST);
  if (h.skip) { try { adb(serial, ["forward", "--remove", "tcp:" + CDP_PORT_PHONE]); } catch (e) {} return skip("(android, host side) " + h.skip); }
  const { page: hostPage, child, dataDir, RI, room } = h;

  let phone = null, toggledOn = false;
  const t0 = Date.now();
  try {
    phone = await attachToPage("http://127.0.0.1:" + CDP_PORT_PHONE, () => true);
    const phoneConsole = [];
    phone.onEvent((m) => {
      if (m.method === "Runtime.consoleAPICalled") phoneConsole.push((m.params.type || "log") + ": " + (m.params.args || []).map((a) => (a.value != null ? String(a.value) : a.description || "")).join(" "));
      if (m.method === "Log.entryAdded") phoneConsole.push((m.params.entry.level || "log") + ": " + m.params.entry.text);
    });
    const ident = await phone.evaluate(() => ({ fork: window.G && window.G.caps ? window.G.caps.fork() : null, tauri: !!window.__TAURI_INTERNALS__, capacitor: !!window.Capacitor, ua: navigator.userAgent, origin: location.origin, roomTlsPlugin: !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RoomTls) }));
    say("(android) attached to the real shipped WebView: fork=" + ident.fork + " capacitor=" + ident.capacitor + " origin=" + ident.origin + " RoomTls plugin present=" + ident.roomTlsPlugin);

    const before = await phone.evaluate(() => !!(window.G.store.settings() || {}).studyGroups);
    if (!before) {
      say("(android) Study groups is off in Settings - turning it on via the real toggle");
      await phone.evaluate(() => { location.hash = "#/settings"; });
      const toggle = await until(() => phone.evaluate(() => !!document.querySelector('input[aria-label="Study groups (LAN rooms)"]')), 5000);
      if (!toggle.hit) throw new Error("Settings -> Study groups toggle never rendered");
      await phone.evaluate(() => document.querySelector('input[aria-label="Study groups (LAN rooms)"]').click());
      const on = await until(() => phone.evaluate(() => !!(window.G.store.settings() || {}).studyGroups), 5000);
      if (!on.hit) throw new Error("clicking the Study groups toggle did not turn the setting on");
      toggledOn = true;
      say("(android) Study groups turned ON via a real click on the aria-labelled checkbox");
    } else {
      say("(android) Study groups was already on - leaving it as found");
    }

    const secureJoinUrl = (RI && typeof RI.tlsPort === "number" && RI.identity && RI.identity.spkiSha256)
      ? S.joinUrl("https://" + RI.ip + ":" + RI.tlsPort, room, RI.identity.spkiSha256) : null;
    if (!secureJoinUrl) throw new Error("the Tauri host has no tlsPort/identity on its RoomInfo - cannot build a secure join link: " + JSON.stringify(RI));
    say("(android) secure join link: " + secureJoinUrl);

    const joinName = "NET-FLOOR-ANDROID";
    await phone.evaluate(() => { location.hash = "#/group"; });
    const panel = await until(() => phone.evaluate(() => !!(document.querySelector(".sg-join-code") && document.querySelector(".sg-join-name") && document.querySelector(".sg-join"))), 5000);
    if (!panel.hit) throw new Error("the Join a room panel never rendered on the device");

    const tJoin = Date.now();
    await phone.evaluate((url) => {
      const el = document.querySelector(".sg-join-code");
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      proto.call(el, url);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, secureJoinUrl);
    await phone.evaluate((name) => {
      const el = document.querySelector(".sg-join-name");
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      proto.call(el, name);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, joinName);
    await phone.evaluate(() => document.querySelector(".sg-join").click());
    say("(android) real DOM interaction: pasted the secure link + name, clicked Join");

    const pendingHit = await until(async () => (await hostPage.evaluate(() => window.G.studyGroup.state().pending)).find((p) => p.name === joinName) || null, 15000);
    if (!pendingHit.hit) {
      const phoneState = await phone.evaluate(() => { try { return window.G.studyGroup.state(); } catch (e) { return { error: String(e) }; } });
      const roomTlsEvents = await phone.evaluate(() => { try { return window.__GUIDON_ROOM_WEB__ && window.__GUIDON_ROOM_WEB__._lastNativeEvents ? window.__GUIDON_ROOM_WEB__._lastNativeEvents() : "n/a"; } catch (e) { return String(e); } });
      return await writeRecord("android", device, { ok: false, detail: { reason: "hello never reached the real Rust TLS listener's host page (native pinned-TLS round trip did not complete)", secureJoinUrl, ident, phoneState, roomTlsEvents, phoneConsole: phoneConsole.slice(-40) } });
    }
    const helloMs = Date.now() - tJoin;
    const fp = pendingHit.value.fp;
    say("(android) hello ARRIVED at the host over the real pinned wss:// listener in " + helloMs + " ms (fp " + fp + ")");
    await hostPage.evaluate((fp) => window.G.studyGroup.hostAction({ type: "admit", fp }), fp);
    const seated = await until(() => phone.evaluate(() => { const s = window.G.studyGroup.state(); return s && s.joinState === "seated" ? s.self.seatNo : null; }), 10000);
    if (!seated.hit) return await writeRecord("android", device, { ok: false, detail: { reason: "host admitted, but welcome never reached the real device (not seated)", secureJoinUrl, helloMs } });
    const welcomeMs = Date.now() - tJoin - helloMs;
    say("(android) welcome ARRIVED back on the real Fold5 over the SAME pinned connection in " + welcomeMs + " ms - seat " + seated.value);

    return await writeRecord("android", device, {
      ok: true,
      ms: { helloMs, welcomeMs, totalMs: Date.now() - t0 },
      detail: { transport: "wss:// pinned self-signed TLS (RoomTlsPlugin.kt native client, src-tauri room.rs TLS listener)", secureJoinUrl, seatNo: seated.value, package: PKG, adbDevice: serial, pageIdent: ident },
    });
  } catch (e) {
    return await writeRecord("android", device, { ok: false, detail: { reason: "exception: " + (e && e.message ? e.message : String(e)) } });
  } finally {
    try { if (phone) await phone.evaluate(() => { try { window.G.studyGroup.leave(); } catch (e) {} }); } catch (e) {}
    if (toggledOn) {
      try {
        await phone.evaluate(() => { location.hash = "#/settings"; });
        await sleep(300);
        await phone.evaluate(() => document.querySelector('input[aria-label="Study groups (LAN rooms)"]').click());
        say("(android) Study groups turned back OFF (it was off before this run)");
      } catch (e) { say("(android) WARNING: could not turn Study groups back off - please check the device: " + (e && e.message)); }
    }
    try { if (phone) phone.close(); } catch (e) {}
    try { await hostPage.evaluate(() => { try { window.G.studyGroup.leave(); } catch (e) {} }); } catch (e) {}
    try { hostPage.close(); } catch (e) {}
    await shutdownExe(child, dataDir);
    try { adb(serial, ["forward", "--remove", "tcp:" + CDP_PORT_PHONE]); } catch (e) {}
  }
}

/* ----------------------------------------------------------------- main */
try {
  if (FORK === "web") await writeRecord("web", DEVICE_OVERRIDE || "chromium", await runWebOrPwa(false));
  else if (FORK === "pwa") await writeRecord("pwa", DEVICE_OVERRIDE || "chromium-pwa", await runWebOrPwa(true));
  else if (FORK === "tauri") await runTauri();
  else if (FORK === "android") await runAndroid();
} catch (e) { toolError(e); }

console.log("\nNETWORK-FLOOR: done (" + FORK + ")");
process.exit(0);
