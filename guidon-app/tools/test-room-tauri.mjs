/**
 * Rust room host (collective P4, R-ROOM): the desktop app's OWN LAN listener
 * (src-tauri/src/room.rs) behind the transport seam in src/room-tauri.js.
 * One Node process drives the DEBUG exe over WebView2 CDP (the exe is not a
 * browser) and ONE Chromium plays the phone that has nothing installed.
 * Written BEFORE room.rs exists - its first run is the RED baseline
 * ("Command room_start not found").
 *
 *   (0) precondition: src-tauri/target/debug/guidon.exe exists (else SKIP
 *       aloud, exit 0 - ci.yml's runners never build it), no guidon.exe is
 *       already running (single-instance would raise it and exit), the CDP
 *       port is free
 *   (1) launch with GUIDON_ROOM_TEST=1 in a throwaway WebView2 profile
 *       (WEBVIEW2_USER_DATA_FOLDER - the real IndexedDB is never opened),
 *       attach over CDP, wait for the app shell
 *   (2) the commands exist and REFUSE while Settings -> Study groups is off
 *       (defense in depth: the page passes the setting; false -> reject) -
 *       except room_stop, which the page calls AFTER turning the setting
 *       off (8b) and which therefore answers {stopped:false} with no room
 *   (3) flipping the setting on attaches src/room-tauri.js at the seam;
 *       G.studyGroup.host() starts the Rust listener: RoomInfo {ip, port,
 *       url, reachable} (the X10 self-probe), the #/group screen shows the
 *       join link the seam produced
 *   (4) HTTP on the listener: GET / and /j/<code> are dist/guest.html byte
 *       for byte (embedded at compile time), /health JSON, 404, /ws 426
 *   (5) RFC 6455 on a raw socket, the same probes tools/test-room-server.mjs
 *       runs against the Node reference: exact Sec-WebSocket-Accept, masked
 *       ping -> pong, close echo + TCP end, unmasked frame -> 1002, bad
 *       version -> 426
 *   (6) relay: a Node candidate (tools/room-node-host.mjs nodePeer, seat 2)
 *       and the Chromium guest page (seat 3) join over /ws, the host page
 *       admits each by hand, the board starts, the guest's Mock Board Live
 *       score intent (value 2) is tallied on the host page; G.netLedger on
 *       the host page carries one "ws-in" entry per accepted socket
 *   (7) validation on the wire: grade key / oversize / unparseable / wrong
 *       room / hostless room / a role=host socket / the 9th peer - dropped
 *       and counted by reason (room_stats), never reaching the page
 *   (8) leave(): bye reaches the guest (host-left), every socket is closed
 *       4000 "host-left", the port closes, keep-awake is released
 *   (8b) Settings -> Study groups OFF while hosting: the page leaves and the
 *       listener port closes (room_stop is not gated by the setting that
 *       just went off - measured stuck-bound on the verify pass 2026-09-05)
 *   (9) WM_CLOSE (CloseMainWindow) ends the process cleanly
 *   (10) X10 negative: a SECOND launch with GUIDON_ROOM_LAN_IP=192.0.2.1
 *       (TEST-NET-1, nothing answers; honoured under GUIDON_ROOM_TEST=1
 *       only) -> RoomInfo.reachable=false -> the host screen says "host
 *       from a phone instead" next to the join link; leave() clears it
 *
 * Usage: node tools/test-room-tauri.mjs   (exit code = FAIL count)
 *   env GUIDON_EXE       path to guidon.exe (default src-tauri/target/debug/guidon.exe)
 *       GUIDON_CDP_PORT  WebView2 remote-debugging port (default 9223)
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { connect } from "node:net";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { attachToPage } from "./cdp.mjs";
import { nodePeer } from "./room-node-host.mjs";
import { launchEngine, closeEngines } from "./xeng-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const EXE = process.env.GUIDON_EXE || join(APP, "src-tauri", "target", "debug", "guidon.exe");
const PORT = Number(process.env.GUIDON_CDP_PORT || 9223);
const CDP = "http://127.0.0.1:" + PORT;
// This suite is heavier than a normal suite - it launches BOTH a native exe
// (with its own WebView2 process) AND a second full browser engine
// (xeng-harness, for the phone side), while run-parallel.mjs's scheduler
// counts it as one slot the same as every single-Chromium suite. Reproduced
// 2026-09-05/06: standalone, window.G boots in well under 30s every time;
// clustered with several other browser-heavy suites at GUIDON_TEST_CONCURRENCY
// 6+, CDP itself still answers fast (the exe process is alive and its I/O
// thread is responsive) but the page's own ~13 MB inline-script bootstrap -
// competing for the same CPU cores as five-plus other Chromiums - has
// intermittently not finished by 30s. Not a hang (it does finish; a rerun
// alone always finishes well inside 30s) and not this suite's own bug - a
// real environmental contention window this scheduler doesn't account for.
// Widen the boot budget specifically when GUIDON_TEST_CONCURRENCY signals a
// shared run, so a solo run keeps its tight 30s feedback loop.
const CONCURRENT_RUN = Number(process.env.GUIDON_TEST_CONCURRENCY || "") > 1 || !!process.env.CI;
const BOOT_TIMEOUT_MS = Number(process.env.GUIDON_ROOM_BOOT_TIMEOUT_MS) || (CONCURRENT_RUN ? 90000 : 30000);

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);
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
// Two full launches each budget up to BOOT_TIMEOUT_MS for the boot check
// alone (see its comment); the watchdog must clear both plus the relay/
// validation/HTTP/WS work in between with real headroom, not just barely.
const WATCHDOG_MS = 240000 + (CONCURRENT_RUN ? 2 * (BOOT_TIMEOUT_MS - 30000) : 0);
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nROOM TAURI: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

await import(pathToFileURL(resolve(APP, "src/app-modules/room-schema.js")).href);
const S = globalThis.G.roomSchema;
const V = S.PROTOCOL_VERSION;
const GUEST = resolve(APP, "dist/guest.html");

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
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$p = Get-Process -Id " + pid + " -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow(); 'sent' } else { 'gone' }"],
      { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim();
  } catch (e) { return "error"; }
}
async function cdpUp() {
  try { const r = await fetch(CDP + "/json/version", { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
function wsClient(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const closed = new Promise((res) => ws.addEventListener("close", (ev) => res({ code: ev.code, reason: ev.reason, wasClean: ev.wasClean }), { once: true }));
  ws.addEventListener("message", (ev) => inbox.push({ t: Date.now(), text: String(ev.data), decoded: S.wireDecode(String(ev.data)) }));
  const opened = new Promise((res, rej) => { ws.addEventListener("open", () => res(true), { once: true }); ws.addEventListener("error", () => rej(new Error("open failed " + url)), { once: true }); });
  return { ws, inbox, closed, opened, send: (frame, to) => ws.send(S.wireEncode(frame, to == null ? null : to)), raw: (text) => ws.send(text) };
}
const mk = (room, from, t, body, extra) => Object.assign({ v: V, t, room, seq: 0, from, body }, extra || {});

console.log("test-room-tauri: the Rust LAN listener inside the debug exe, driven over WebView2 CDP, one Chromium as the phone\n");

/* ---------------- (0) preconditions ---------------- */
const st = await stat(EXE).catch(() => null);
if (!st || !st.isFile()) {
  info("(0) SKIP: " + EXE + " does not exist - build it with `npm run build && npx tauri build --debug --no-bundle` (ci.yml runners never do; desktop.yml's smoke does)");
  console.log("\nROOM TAURI: SKIPPED (no debug exe)");
  process.exit(0);
}
info("(0) exe " + EXE + " (" + (st.size / 1048576).toFixed(1) + " MB, modified " + st.mtime.toISOString());
if (guidonRunning()) { bad("(0) a guidon.exe is already running - single-instance would raise it and this launch would exit; close it and rerun"); finish(); }
if (await cdpUp()) { bad("(0) " + CDP + " already answers /json/version - another debug session owns the port"); finish(); }
const guestBytes = await readFile(GUEST).catch(() => null);
guestBytes ? ok("(0) dist/guest.html exists (" + guestBytes.length + " bytes) - the bytes the Rust host must embed") : bad("(0) dist/guest.html missing - run npm run build");

let child = null, dataDir = null, page = null, exitInfo = null;
const stderrLines = [];
try {
  /* ---------------- (1) launch + attach ---------------- */
  dataDir = await mkdtemp(join(tmpdir(), "guidon-room-tauri-"));
  child = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=" + PORT, WEBVIEW2_USER_DATA_FOLDER: dataDir, GUIDON_ROOM_TEST: "1" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child.stderr.on("data", (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) stderrLines.push(l.trim()); });
  child.stdout.on("data", () => {});
  const exited = new Promise((res) => child.on("exit", (code, signal) => { exitInfo = { code, signal, at: Date.now() }; res(exitInfo); }));
  info("(1) launched pid " + child.pid + " with GUIDON_ROOM_TEST=1, WEBVIEW2_USER_DATA_FOLDER=" + dataDir);
  // Agnosticism audit, 6 Sep 2026 (sleep-baseline rule, D1): these two waits
  // sat right next to the boot check below and never got the same
  // concurrency-aware scaling when BOOT_TIMEOUT_MS was introduced earlier
  // this session, on the theory that this specific reproduction's
  // bottleneck was the in-page JS boot, not CDP/process startup (CDP
  // answered in 636ms even under the contention that broke the boot
  // check). That's a real distinction for THIS measured case, not a
  // principled reason to leave these two unscaled for every future,
  // possibly-worse-contended run - the standing rule is scale every wait
  // in the file the same way once one of them is found to need it.
  const up = await until(cdpUp, BOOT_TIMEOUT_MS, 300);
  if (!up.hit) { bad("(1) " + CDP + "/json/version never answered within " + BOOT_TIMEOUT_MS + " ms" + (exitInfo ? " (the exe exited " + JSON.stringify(exitInfo) + ")" : "")); throw new Error("no CDP"); }
  ok("(1) WebView2 remote debugging answered after " + up.ms + " ms: " + (up.value.Browser || "?"));
  const target = await until(async () => { const list = await (await fetch(CDP + "/json/list", { signal: AbortSignal.timeout(1500) })).json(); return list.find((t) => t.type === "page" && t.url && t.url !== "about:blank") || null; }, BOOT_TIMEOUT_MS, 300);
  if (!target.hit) { bad("(1) no app page target within " + BOOT_TIMEOUT_MS + " ms"); throw new Error("no page"); }
  page = await attachToPage(CDP, (t) => t.url === target.value.url);
  const booted = await until(() => page.evaluate(() => !!(window.G && window.G.routes && window.G.routes.length && window.G.studyGroup && window.G.roomSchema && window.G.store)), BOOT_TIMEOUT_MS, 250);
  // Every other until() above bails out immediately on a miss (its very next
  // line assumes success). This one used to fall through instead, so a boot
  // timeout under contention (see BOOT_TIMEOUT_MS's comment) produced a
  // second, unrelated-looking crash right below - window.G.caps read off an
  // undefined window.G - that buried the real, accurate diagnosis under a
  // confusing "suite error: TypeError ... reading 'caps'". Bail here too.
  if (!booted.hit) { bad("(1) app shell not booted within " + BOOT_TIMEOUT_MS + " ms"); throw new Error("app shell not booted"); }
  ok("(1) attached to " + page.target.url + "; app shell booted (G.routes, G.studyGroup, G.roomSchema) after " + booted.ms + " ms");
  const ident = await page.evaluate(() => ({ fork: window.G.caps && window.G.caps.fork ? window.G.caps.fork() : null, sha: window.GUIDON_BUILD_SHA || null, app: window.GUIDON_APP_VERSION || null, tauri: !!window.__TAURI_INTERNALS__, origin: location.origin, adapter: !!window.__GUIDON_ROOM__ }));
  ident.fork === "tauri" && ident.tauri ? ok("(1) the page is the tauri fork (G.caps.fork() = tauri, __TAURI_INTERNALS__ present, origin " + ident.origin + ", sha " + (ident.sha ? ident.sha.slice(0, 7) : "none") + ")") : bad("(1) page identity: " + JSON.stringify(ident));
  ident.adapter ? ok("(1) src/room-tauri.js is in the embedded web/ (window.__GUIDON_ROOM__ present)") : bad("(1) window.__GUIDON_ROOM__ is absent - room-tauri.js is not injected into the web/ this exe embeds (rebuild: npm run build && npx tauri build --debug --no-bundle)");

  /* ---------------- (2) the commands refuse while the setting is off ---------------- */
  const off = await page.evaluate(async () => {
    const T = window.__TAURI_INTERNALS__;
    const one = async (cmd, args) => { try { return { ok: true, value: await T.invoke(cmd, args) }; } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; } };
    return {
      start: await one("room_start", { port: null, code: "ALPHA-BRAVO-42", studyGroups: false, fork: "tauri" }),
      send: await one("room_send", { to: null, frame: {}, studyGroups: false, fork: "tauri" }),
      stop: await one("room_stop", { studyGroups: false, fork: "tauri" }),
      stats: await one("room_stats", { studyGroups: false, fork: "tauri" }),
      forkOff: await one("room_start", { port: null, code: "ALPHA-BRAVO-42", studyGroups: true, fork: "web" }),
      stopFork: await one("room_stop", { studyGroups: true, fork: "web" }),
      setting: !!((window.G.store.settings() || {}).studyGroups),
    };
  });
  const missing = Object.entries(off).filter(([k, v]) => k !== "setting" && v && v.ok === false && /not found|not allowed/i.test(v.error)).map(([k, v]) => k + ": " + v.error);
  missing.length === 0 ? ok("(2) room_start / room_send / room_stop / room_stats all exist as app commands (no ACL, no capability file)") : bad("(2) command(s) missing or ACL-gated: " + missing.join(" | "));
  off.setting === false && !off.start.ok && /off/i.test(off.start.error || "") ? ok("(2) room_start REFUSES while settings.studyGroups is false: " + JSON.stringify(off.start.error)) : bad("(2) room_start with studyGroups:false -> " + JSON.stringify(off.start));
  !off.send.ok && !off.stats.ok ? ok("(2) room_send / room_stats refuse too (" + JSON.stringify([off.send.error, off.stats.error]) + ")") : bad("(2) a command answered with the setting off: " + JSON.stringify({ send: off.send, stats: off.stats }));
  off.stop.ok && off.stop.value && off.stop.value.stopped === false ? ok("(2) room_stop is NOT gated by the setting (the page turns it off BEFORE it asks to stop - see 8b); with no room open it answers " + JSON.stringify(off.stop.value)) : bad("(2) room_stop with the setting off -> " + JSON.stringify(off.stop));
  !off.stopFork.ok && /fork/i.test(off.stopFork.error || "") ? ok("(2) room_stop still refuses a fork other than tauri: " + JSON.stringify(off.stopFork.error)) : bad("(2) room_stop with fork:web -> " + JSON.stringify(off.stopFork));
  !off.forkOff.ok && /fork/i.test(off.forkOff.error || "") ? ok("(2) room_start REFUSES a fork other than tauri even with the setting on: " + JSON.stringify(off.forkOff.error)) : bad("(2) room_start with fork:web -> " + JSON.stringify(off.forkOff));
  const noListener = await until(() => page.evaluate(() => window.__GUIDON_ROOM__ ? (window.__GUIDON_ROOM__.info() === null ? true : null) : null), 500, 100);
  noListener.hit ? ok("(2) no listener is running before the setting is on (adapter info() is null)") : bad("(2) adapter info() before any room: " + JSON.stringify(noListener.value));

  /* ---------------- (3) setting on -> attached -> host ---------------- */
  await page.evaluate(async () => { location.hash = "#/group"; await window.G.store.setSetting("studyGroups", true); });
  const attached = await until(() => page.evaluate(() => !!(window.G.studyGroup.available() && window.__GUIDON_ROOM__ && window.__GUIDON_ROOM__.attached())), 5000);
  attached.hit ? ok("(3) settings.studyGroups on -> src/room-tauri.js attached itself at the seam (" + attached.ms + " ms)") : bad("(3) adapter did not attach after the setting went on");
  const ledger0 = await page.evaluate(() => window.G.netLedger.list());
  ledger0.length === 1 && /tauri/.test(ledger0[0].kind) ? ok("(3) attach() recorded the seam in G.netLedger: " + JSON.stringify(ledger0[0])) : bad("(3) ledger after attach: " + JSON.stringify(ledger0));
  const hosted = await page.evaluate(() => window.G.studyGroup.host({ mode: "board", name: "DESK-HOST", count: 2, category: "All" }));
  hosted && hosted.ok && S.isRoomCode(hosted.room) ? ok("(3) G.studyGroup.host() opened board room " + hosted.room + " (fp " + hosted.fp + ", identity " + hosted.identity + ")") : bad("(3) host(): " + JSON.stringify(hosted));
  const ROOM = hosted.room;
  const infoGot = await until(() => page.evaluate(() => window.__GUIDON_ROOM__.info()), 10000, 100);
  const RI = infoGot.value;
  infoGot.hit && RI && typeof RI.port === "number" && RI.port > 0 && typeof RI.ip === "string" ? ok("(3) room_start -> RoomInfo " + JSON.stringify(RI) + " after " + infoGot.ms + " ms") : bad("(3) no RoomInfo from room_start: " + JSON.stringify(infoGot.value) + " last error " + JSON.stringify(await page.evaluate(() => window.__GUIDON_ROOM__.lastError())));
  if (!RI) throw new Error("no RoomInfo - RED");
  RI.url === S.joinUrl("http://" + RI.ip + ":" + RI.port, ROOM) ? ok("(3) RoomInfo.url is G.roomSchema.joinUrl(origin, room): " + RI.url) : bad("(3) RoomInfo.url " + RI.url + " != " + S.joinUrl("http://" + RI.ip + ":" + RI.port, ROOM));
  RI.ip !== "127.0.0.1" && RI.ip !== "0.0.0.0" ? ok("(3) the advertised address is a LAN address, not loopback: " + RI.ip) : info("(3) advertised address is " + RI.ip + " (no LAN route on this machine - joiners on another device could not use it)");
  typeof RI.reachable === "boolean" ? info("(3) X10 self-probe: a second socket connecting to " + RI.ip + ":" + RI.port + " -> reachable=" + RI.reachable + (RI.reachable ? "" : " (the host screen must say: host from a phone instead)")) : bad("(3) RoomInfo.reachable is not a boolean: " + JSON.stringify(RI.reachable));
  const screen = await until(() => page.evaluate(() => { const u = document.querySelector(".sg-join-url"); const n = document.querySelector(".sg-transport-notice"); return u ? { url: u.textContent.trim(), notice: n ? n.textContent : "" } : null; }), 5000);
  screen.hit && screen.value.url === RI.url ? ok("(3) the #/group host screen shows the join link the seam produced: " + screen.value.url) : bad("(3) host screen join link: " + JSON.stringify(screen.value));
  if (RI.reachable === false) (screen.value && /host from a phone instead/i.test(screen.value.notice)) ? ok("(3) reachable=false -> the host screen says \"host from a phone instead\": " + JSON.stringify(screen.value.notice)) : bad("(3) reachable=false but no \"host from a phone instead\" notice: " + JSON.stringify(screen.value));
  else (screen.value && !/host from a phone instead/i.test(screen.value.notice || "")) ? ok("(3) reachable=true -> no firewall notice on the host screen") : bad("(3) reachable=true but a notice is shown: " + JSON.stringify(screen.value));
  const statsA = await page.evaluate(() => window.__GUIDON_ROOM__.stats());
  statsA && statsA.keepAwake === true ? ok("(3) keep-awake (X13) is held while the room is open: room_stats.keepAwake=true" + (statsA.keepAwakeMode ? " (" + statsA.keepAwakeMode + ")" : "")) : bad("(3) room_stats.keepAwake while open: " + JSON.stringify(statsA));

  /* ---------------- (4) HTTP ---------------- */
  const base = "http://127.0.0.1:" + RI.port;
  const wsBase = "127.0.0.1:" + RI.port;
  {
    const r = await fetch(base + "/");
    const b = Buffer.from(await r.arrayBuffer());
    r.status === 200 && /text\/html/.test(r.headers.get("content-type") || "") && guestBytes && b.equals(guestBytes) ? ok("(4) GET / is dist/guest.html byte for byte (" + b.length + " bytes, " + r.headers.get("content-type") + ", x-guidon-fork " + r.headers.get("x-guidon-fork") + ")") : bad("(4) GET /: status " + r.status + ", " + b.length + " bytes");
    const r2 = await fetch(base + S.ENDPOINTS.join + ROOM);
    const b2 = Buffer.from(await r2.arrayBuffer());
    r2.status === 200 && guestBytes && b2.equals(guestBytes) ? ok("(4) GET " + S.ENDPOINTS.join + ROOM + " is the same bytes (the join page IS the guest page)") : bad("(4) GET /j/<code>: status " + r2.status + ", " + b2.length + " bytes");
    const r3 = await fetch(base + "/health");
    const j = await r3.json().catch(() => null);
    r3.status === 200 && j && j.ok === true && j.protocol === V && typeof j.connections === "number" && j.room === ROOM ? ok("(4) GET /health -> " + JSON.stringify(j)) : bad("(4) /health: " + r3.status + " " + JSON.stringify(j));
    const r4 = await fetch(base + "/nope");
    r4.status === 404 ? ok("(4) GET /nope -> 404") : bad("(4) /nope -> " + r4.status);
    const r5 = await fetch(base + "/../Cargo.toml");
    r5.status === 404 ? ok("(4) path traversal is not a file (404)") : bad("(4) /../Cargo.toml -> " + r5.status);
    const r6 = await fetch(base + S.ENDPOINTS.ws);
    r6.status === 426 ? ok("(4) plain GET /ws -> 426 upgrade required") : bad("(4) GET /ws -> " + r6.status);
  }

  /* ---------------- (5) RFC 6455 on a raw socket ---------------- */
  {
    const key = Buffer.from("0123456789abcdef").toString("base64");
    const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    const sock = connect({ host: "127.0.0.1", port: RI.port });
    const chunks = [];
    sock.on("data", (d) => chunks.push(d));
    sock.on("error", () => {});
    const ended = new Promise((res) => sock.on("close", () => res(true)));
    await new Promise((res, rej) => { sock.on("connect", res); sock.on("error", rej); });
    sock.write("GET " + S.ENDPOINTS.ws + "?room=" + ROOM + "&role=peer HTTP/1.1\r\nHost: 127.0.0.1:" + RI.port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\nUser-Agent: raw-probe/1\r\n\r\n");
    const hs = await until(() => { const s = Buffer.concat(chunks).toString("latin1"); return s.includes("\r\n\r\n") ? s : null; });
    hs.hit && /^HTTP\/1\.1 101/.test(hs.value) && hs.value.includes("Sec-WebSocket-Accept: " + accept) ? ok("(5) 101 Switching Protocols with the exact Sec-WebSocket-Accept (" + accept + ")") : bad("(5) handshake: " + JSON.stringify(hs.value && hs.value.slice(0, 200)));
    const hsLen = Buffer.concat(chunks).indexOf("\r\n\r\n") + 4;
    const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
    const masked = (op, payload) => { const p = Buffer.from(payload); const out = Buffer.alloc(2 + 4 + p.length); out[0] = 0x80 | op; out[1] = 0x80 | p.length; mask.copy(out, 2); for (let i = 0; i < p.length; i++) out[6 + i] = p[i] ^ mask[i % 4]; return out; };
    sock.write(masked(0x9, "hi"));
    const pong = await until(() => { const b = Buffer.concat(chunks).subarray(hsLen); return b.length >= 4 && b[0] === 0x8a && b[1] === 2 && b.subarray(2, 4).toString() === "hi" ? true : null; });
    pong.hit ? ok("(5) a masked client PING is answered by an unmasked PONG carrying the same payload") : bad("(5) no pong: " + Buffer.concat(chunks).subarray(hsLen).toString("hex"));
    const before = Buffer.concat(chunks).length;
    sock.write(masked(0x8, Buffer.from([0x03, 0xe8])));
    const closeEcho = await until(() => { const b = Buffer.concat(chunks).subarray(before); return b.length >= 2 && b[0] === 0x88 ? b : null; });
    closeEcho.hit ? ok("(5) a masked CLOSE (1000) is echoed with a CLOSE frame") : bad("(5) no close echo");
    const fin = await Promise.race([ended.then(() => true), sleep(3000).then(() => false)]);
    fin ? ok("(5) the listener ended the TCP connection after the close handshake") : bad("(5) socket still open 3 s after close");
    sock.destroy();
    const sock2 = connect({ host: "127.0.0.1", port: RI.port });
    const c2 = [];
    sock2.on("data", (d) => c2.push(d));
    sock2.on("error", () => {});
    const ended2 = new Promise((res) => sock2.on("close", () => res(true)));
    await new Promise((res, rej) => { sock2.on("connect", res); sock2.on("error", rej); });
    sock2.write("GET " + S.ENDPOINTS.ws + "?room=" + ROOM + "&role=peer HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n");
    await until(() => Buffer.concat(c2).toString("latin1").includes("\r\n\r\n") ? true : null);
    sock2.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    const closed2 = await Promise.race([ended2.then(() => true), sleep(3000).then(() => false)]);
    const body2 = Buffer.concat(c2);
    const at = body2.indexOf("\r\n\r\n") + 4;
    const code2 = body2.length >= at + 4 && body2[at] === 0x88 ? body2.readUInt16BE(at + 2) : null;
    closed2 && code2 === 1002 ? ok("(5) an UNMASKED client frame is a protocol error: closed with 1002") : bad("(5) unmasked frame: closed=" + closed2 + " code=" + code2);
    sock2.destroy();
    const sock3 = connect({ host: "127.0.0.1", port: RI.port });
    const c3 = [];
    sock3.on("data", (d) => c3.push(d));
    sock3.on("error", () => {});
    await new Promise((res, rej) => { sock3.on("connect", res); sock3.on("error", rej); });
    sock3.write("GET " + S.ENDPOINTS.ws + "?room=" + ROOM + "&role=peer HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 8\r\n\r\n");
    const bad3 = await until(() => { const s = Buffer.concat(c3).toString("latin1"); const m = /^HTTP\/1\.1 (\d{3})/.exec(s); return m ? { status: Number(m[1]), text: s } : null; });
    sock3.destroy();
    bad3.hit && bad3.value.status === 426 && /Sec-WebSocket-Version: 13/.test(bad3.value.text) ? ok("(5) a bad Sec-WebSocket-Version is refused with 426 + Sec-WebSocket-Version: 13") : bad("(5) bad version -> " + JSON.stringify(bad3.value && bad3.value.text.slice(0, 120)));
  }

  /* ---------------- (6) relay: Node candidate + Chromium guest ---------------- */
  const hostState = () => page.evaluate(() => { const s = window.G.studyGroup.state(); return s ? { phase: s.phase, seats: s.seats.map((x) => ({ seatNo: x.seatNo, name: x.name, fp: x.fp, score: x.score, online: x.online, ready: x.ready })), pending: s.pending.map((p) => ({ fp: p.fp, name: p.name })), scores: s.scores, turnSeat: s.turnSeat, lock: s.lock, round: s.round } : null; });
  /* the two raw-socket probes above were accepted sockets too and are in
     the ledger already (measured: 2 entries before this point); the relay
     assertions count from here */
  const ledgerBase = await page.evaluate(() => window.G.netLedger.list().filter((e) => e.kind === "ws-in").length);
  const cand = nodePeer({ wsBase, room: ROOM, fp: "CANDCAND", name: "CANDIDATE" });
  await cand.ready;
  cand.hello();
  const candPending = await until(async () => (await hostState()).pending.some((p) => p.fp === "CANDCAND") ? true : null);
  candPending.hit ? ok("(6) the Node candidate's hello reached the HOST PAGE through the Rust listener (" + candPending.ms + " ms)") : bad("(6) candidate hello never reached the page: " + JSON.stringify(await hostState()));
  const ledger1 = await page.evaluate(() => window.G.netLedger.list());
  ledger1.some((e) => e.kind === "ws-in" && /^127\.0\.0\.1:\d+$/.test(e.peer)) ? ok("(6) the accepted socket is in G.netLedger as ws-in with the peer address: " + JSON.stringify(ledger1.filter((e) => e.kind === "ws-in"))) : bad("(6) ledger after the candidate connected: " + JSON.stringify(ledger1));
  await page.evaluate(() => window.G.studyGroup.hostAction({ type: "admit", fp: "CANDCAND" }));
  const candSeated = await until(() => { const s = cand.state(); return s.joinState === "seated" ? s.self.seatNo : null; });
  candSeated.hit && candSeated.value === 2 ? ok("(6) admitted: the candidate is seat 2 (welcome relayed back through the listener, " + candSeated.ms + " ms)") : bad("(6) candidate seat: " + JSON.stringify(candSeated));

  const browser = await launchEngine("chromium");
  const gp = await (await browser.newContext()).newPage();
  const noise = [];
  gp.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  gp.on("console", (m) => { if (m.type() === "error") noise.push("console: " + m.text()); });
  await gp.goto(base + S.ENDPOINTS.join + ROOM, { waitUntil: "load" });
  const boot = await gp.evaluate(() => ({ fork: window.GUIDON_FORK, code: (document.querySelector(".gp-code") || { value: "" }).value, core: !!(window.G && window.G.roomCore) }));
  boot.fork === "guest" && boot.core && boot.code === ROOM ? ok("(6) Chromium loaded the guest page FROM THE RUST HOST: fork guest, code pre-filled " + boot.code) : bad("(6) guest boot: " + JSON.stringify(boot));
  await gp.fill(".gp-name", "PHONE-GUEST");
  await gp.click(".gp-join");
  const guestPending = await until(async () => (await hostState()).pending.find((p) => p.name === "PHONE-GUEST") || null);
  guestPending.hit ? ok("(6) the guest page's hello reached the host page (" + guestPending.ms + " ms, fp " + guestPending.value.fp + ")") : bad("(6) guest hello never arrived: " + JSON.stringify(await hostState()));
  const gfp = guestPending.value ? guestPending.value.fp : null;
  await page.evaluate((fp) => window.G.studyGroup.hostAction({ type: "admit", fp }), gfp);
  const seated = await until(() => gp.evaluate(() => { const s = window.__guestState && window.__guestState(); return s && s.joinState === "seated" ? s.self.seatNo : null; }));
  seated.hit && seated.value === 3 ? ok("(6) admitted: the guest is seat 3 (" + seated.ms + " ms)") : bad("(6) guest seat: " + JSON.stringify(seated));
  const roster = await until(() => gp.evaluate(() => document.querySelectorAll(".gp-seat").length === 3 ? 3 : null));
  roster.hit ? ok("(6) the guest renders the 3-seat roster (snapshot relayed)") : bad("(6) roster rows: " + JSON.stringify(roster.value));
  await gp.click(".gp-ready");
  cand.intent({ kind: "ready" });
  const readyAll = await until(async () => (await hostState()).seats.filter((s) => s.ready).length === 3 ? true : null);
  readyAll.hit ? ok("(6) both ready intents tallied on the host page") : bad("(6) ready: " + JSON.stringify(await hostState()));
  const started = await page.evaluate(() => window.G.studyGroup.hostAction({ type: "start" }));
  started && started.ok ? ok("(6) host started the board") : bad("(6) start: " + JSON.stringify(started));
  const card = await until(() => gp.evaluate(() => { const q = document.querySelector(".gp-q"); return q && q.textContent.trim().length > 5 ? q.textContent.trim() : null; }));
  card.hit ? ok("(6) card 1 rendered on the guest: \"" + card.value.slice(0, 60) + "\"") : bad("(6) no card on the guest");
  cand.intent({ kind: "answer" });
  const scoreBtns = await until(() => gp.evaluate(() => document.querySelectorAll(".gp-score").length === 3 ? 3 : null));
  scoreBtns.hit ? ok("(6) the candidate's answer intent -> three score buttons on the guest") : bad("(6) score buttons: " + JSON.stringify(scoreBtns.value));
  await gp.click('.gp-score[data-value="2"]');
  const tallied = await until(async () => { const per = ((await hostState()).scores || {})["0"] || {}; return per["3"] === 2 ? per : null; });
  tallied.hit ? ok("(6) the guest's Mock Board Live score intent (value 2) is tallied on the HOST PAGE for seat 3: " + JSON.stringify(tallied.value) + " (" + tallied.ms + " ms)") : bad("(6) host scores: " + JSON.stringify((await hostState()).scores));
  const candScore = (await hostState()).seats.find((s) => s.seatNo === 2).score;
  candScore === 2 ? ok("(6) the candidate's seat shows the awarded 2 points") : bad("(6) candidate score " + candScore);
  const ledger2 = await page.evaluate(() => window.G.netLedger.list().filter((e) => e.kind === "ws-in").length);
  ledger2 === ledgerBase + 2 ? ok("(6) G.netLedger holds one ws-in entry per accepted socket: " + ledgerBase + " raw probes + candidate + guest = " + ledger2) : bad("(6) ws-in ledger entries: " + ledger2 + " (expected " + (ledgerBase + 2) + ")");
  const peerEvents = await page.evaluate(() => window.__GUIDON_ROOM__.peers());
  peerEvents && peerEvents.open >= 2 ? ok("(6) room:peer events reached the page: " + JSON.stringify(peerEvents)) : bad("(6) room:peer counters: " + JSON.stringify(peerEvents));

  /* ---------------- (7) validation on the wire ---------------- */
  {
    const s0 = await page.evaluate(() => window.__GUIDON_ROOM__.stats());
    const raw = wsClient(S.wsUrl(wsBase, ROOM, "peer"));
    await raw.opened;
    const rcv0 = (await hostState()).pending.length;
    /* bind the socket to RAWPEERA with one valid ping first (the page
       ignores a ping from an unknown fingerprint), so RAWPEERB below is a
       spoof and the v-mismatch hello at the end carries the bound fp */
    raw.send(mk(ROOM, "RAWPEERA", "ping", { n: 0 }));
    raw.send(mk(ROOM, "RAWPEERA", "intent", { kind: "score", value: 1, grade: 2 }));
    raw.send(mk(ROOM, "RAWPEERA", "ping", { n: 1 }, { room: "ZULU-ZULU-00" }));
    raw.send(mk(ROOM, "RAWPEERB", "ping", { n: 2 }));
    const oversizeText = S.wireEncode(mk(ROOM, "RAWPEERA", "ping", { n: 3 }), null);
    const padded = oversizeText + " ".repeat(S.MAX_WIRE_BYTES + 200 - Buffer.byteLength(oversizeText, "utf8"));
    raw.raw(padded);
    raw.raw("{not json");
    raw.send(mk(ROOM, "RAWPEERA", "hello", { name: "OLD", bankSig: "b" }, { v: V + 1 }));
    const skew = await until(() => page.evaluate(() => window.G.studyGroup.counters().ignored.version >= 1 ? true : null), 4000);
    skew.hit ? ok("(7) a v-mismatch hello IS relayed to the page (counted ignored:version; only the host answers \"" + S.VERSION_MISMATCH_TEXT + "\")") : bad("(7) v-mismatch hello was not relayed: " + JSON.stringify(await page.evaluate(() => window.G.studyGroup.counters())));
    const rejectBack = await until(() => raw.inbox.find((m) => m.decoded && m.decoded.frame.t === "reject") ? true : null, 4000);
    rejectBack.hit ? ok("(7) the host page's reject frame came back down to the raw socket through room_send") : bad("(7) no reject reached the raw socket: " + JSON.stringify(raw.inbox.map((m) => m.text.slice(0, 60))));
    await sleep(300);
    const s1 = await page.evaluate(() => window.__GUIDON_ROOM__.stats());
    const d = (k) => ((s1.droppedBy || {})[k] || 0) - ((s0.droppedBy || {})[k] || 0);
    d("invalid") >= 1 && d("room") >= 1 && d("spoof") >= 1 && d("oversize") === 1 && d("unparseable") === 1 ? ok("(7) grade key / wrong room / spoofed fingerprint / oversize / unparseable: dropped and counted by reason " + JSON.stringify(s1.droppedBy)) : bad("(7) droppedBy delta: invalid " + d("invalid") + " room " + d("room") + " spoof " + d("spoof") + " oversize " + d("oversize") + " unparseable " + d("unparseable") + " (" + JSON.stringify(s1.droppedBy) + ")");
    (await hostState()).pending.length === rcv0 ? ok("(7) none of the bad frames reached the page (pending unchanged)") : bad("(7) pending grew: " + JSON.stringify((await hostState()).pending));
    raw.ws.close(1000, "done");
    const hostless = wsClient(S.wsUrl(wsBase, "ZULU-YANKEE-99", "peer"));
    await hostless.opened;
    hostless.send(mk("ZULU-YANKEE-99", "PEERCCCC", "hello", { name: "C", bankSig: "b" }));
    const noHost = await until(() => page.evaluate(async () => ((await window.__GUIDON_ROOM__.stats()).droppedBy || {})["no-host"] >= 1 ? true : null), 3000);
    noHost.hit ? ok("(7) a peer in another room code gets nothing (dropped no-host, as the Node reference does)") : bad("(7) hostless room: " + JSON.stringify(await page.evaluate(() => window.__GUIDON_ROOM__.stats())));
    hostless.ws.close();
    const asHost = wsClient(S.wsUrl(wsBase, ROOM, "host"));
    const h2 = await Promise.race([asHost.closed, sleep(3000).then(() => null)]);
    h2 && h2.code === 4002 ? ok("(7) a role=host socket is closed 4002 \"" + h2.reason + "\" (the page IS the host)") : bad("(7) role=host socket: " + JSON.stringify(h2));
    /* the seat cap: 2 peers are bound (candidate + guest); bind 6 more with hellos, the 9th is refused */
    const extra = [];
    for (let i = 0; i < 6; i++) { const c = wsClient(S.wsUrl(wsBase, ROOM, "peer")); await c.opened; c.send(mk(ROOM, "EXTRA" + String.fromCharCode(65 + i) + "AA", "hello", { name: "X" + i, bankSig: "b" })); extra.push(c); }
    const eight = await until(async () => (await hostState()).pending.length >= 6 ? true : null);
    eight.hit ? ok("(7) 8 bound peer sockets (2 seated + 6 pending) - the hotspot cap exactly") : bad("(7) pending after 6 extra hellos: " + JSON.stringify((await hostState()).pending.length));
    const ninth = wsClient(S.wsUrl(wsBase, ROOM, "peer"));
    await ninth.opened;
    ninth.send(mk(ROOM, "NINTHNIN", "hello", { name: "NINE", bankSig: "b" }));
    const refused = await Promise.race([ninth.closed, sleep(3000).then(() => null)]);
    refused && refused.code === 4004 ? ok("(7) the 9th peer is refused: closed 4004 \"" + refused.reason + "\" (seat cap " + 8 + ")") : bad("(7) ninth peer: " + JSON.stringify(refused));
    const pend9 = (await hostState()).pending.some((p) => p.fp === "NINTHNIN");
    !pend9 ? ok("(7) the refused peer's hello never reached the page") : bad("(7) the 9th hello reached the page");
    for (const c of extra) c.ws.close(1000, "done");
    await sleep(300);
    const s2 = await page.evaluate(() => window.__GUIDON_ROOM__.stats());
    info("(7) listener stats: " + JSON.stringify(s2));
  }

  /* ---------------- (8) leave -> stop ---------------- */
  {
    const closedPromise = new Promise((res) => cand.ws.addEventListener("close", (ev) => res({ code: ev.code, reason: ev.reason }), { once: true }));
    await page.evaluate(() => window.G.studyGroup.leave());
    const hostLeft = await until(() => gp.evaluate(() => !!document.querySelector(".gp-terminal[data-kind=host-left]")), 6000);
    hostLeft.hit ? ok("(8) leave(): bye reached the guest page (host-left terminal, " + hostLeft.ms + " ms)") : bad("(8) guest never saw host-left");
    const candClosed = await Promise.race([closedPromise, sleep(5000).then(() => null)]);
    candClosed && candClosed.code === 4000 ? ok("(8) room_stop closed the candidate's socket 4000 \"" + candClosed.reason + "\"") : bad("(8) candidate close: " + JSON.stringify(candClosed));
    const gone = await until(() => page.evaluate(() => window.__GUIDON_ROOM__.info() === null ? true : null), 5000);
    gone.hit ? ok("(8) adapter info() is null after stop") : bad("(8) info() after stop: " + JSON.stringify(gone.value));
    const portClosed = await until(async () => { try { await fetch(base + "/health", { signal: AbortSignal.timeout(800) }); return null; } catch (e) { return true; } }, 5000, 200);
    portClosed.hit ? ok("(8) the listener port is closed (" + base + " refuses)") : bad("(8) " + base + "/health still answers after stop");
    const statsZ = await page.evaluate(() => window.__GUIDON_ROOM__.stats());
    statsZ && statsZ.keepAwake === false ? ok("(8) keep-awake released after stop (room_stats.keepAwake=false)") : bad("(8) keepAwake after stop: " + JSON.stringify(statsZ));
    noise.length === 0 ? ok("(8) zero page errors / console errors on the guest page") : bad("(8) guest noise: " + noise.slice(0, 3).join(" | "));
    cand.close();
    await closeEngines();
  }

  /* ---------------- (8b) the setting goes OFF while hosting ---------------- */
  {
    const again = await page.evaluate(() => window.G.studyGroup.host({ mode: "board", name: "DESK-HOST", count: 2, category: "All" }));
    const ri2 = await until(() => page.evaluate(() => window.__GUIDON_ROOM__.info()), 10000, 100);
    again && again.ok && ri2.hit ? ok("(8b) a second room opened: " + ri2.value.url) : bad("(8b) second host(): " + JSON.stringify(again) + " info " + JSON.stringify(ri2.value));
    const base2 = "http://127.0.0.1:" + (ri2.value ? ri2.value.port : 0);
    await page.evaluate(async () => { await window.G.store.setSetting("studyGroups", false); });
    const left = await until(() => page.evaluate(() => window.G.studyGroup.state() === null && window.__GUIDON_ROOM__.info() === null ? true : null), 5000);
    left.hit ? ok("(8b) Settings -> Study groups OFF while hosting -> the page left the room (state null, adapter info null)") : bad("(8b) after the setting went off: " + JSON.stringify(await page.evaluate(() => ({ state: !!window.G.studyGroup.state(), info: window.__GUIDON_ROOM__.info() }))));
    const closed2 = await until(async () => { try { await fetch(base2 + "/health", { signal: AbortSignal.timeout(800) }); return null; } catch (e) { return true; } }, 5000, 200);
    closed2.hit ? ok("(8b) the listener port closed with the setting (room_stop is not gated by the setting it turns off)") : bad("(8b) " + base2 + "/health STILL answers after Settings -> Study groups went off: the listener stays bound and keep-awake held (last adapter error: " + JSON.stringify(await page.evaluate(() => window.__GUIDON_ROOM__.lastError())) + ")");
  }

  /* ---------------- (9) WM_CLOSE ---------------- */
  page.close();
  page = null;
  const sent = closeMainWindow(child.pid);
  const t0 = Date.now();
  const ex = await Promise.race([exited, sleep(8000).then(() => null)]);
  ex ? ok("(9) CloseMainWindow (WM_CLOSE, " + sent + ") -> the exe exited in " + (Date.now() - t0) + " ms with code " + ex.code) : bad("(9) the exe is still alive 8 s after WM_CLOSE (" + sent + ")");

  /* ---------------- (10) X10 negative: the advertised address does not answer ---------------- */
  {
    /* the first exe has exited: remove ITS throwaway profile now (the
       finally block only knows the second one), retrying while WebView2's
       child processes let go of the files */
    await rmProfile(dataDir);
    const dataDir2 = await mkdtemp(join(tmpdir(), "guidon-room-tauri-x10-"));
    const child2 = spawn(EXE, [], {
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=" + PORT, WEBVIEW2_USER_DATA_FOLDER: dataDir2, GUIDON_ROOM_TEST: "1", GUIDON_ROOM_LAN_IP: "192.0.2.1" },
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    child2.stderr.on("data", (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) stderrLines.push(l.trim()); });
    child2.stdout.on("data", () => {});
    const exited2 = new Promise((res) => child2.on("exit", (code, signal) => res({ code, signal })));
    child = child2; dataDir = dataDir2;
    info("(10) second launch pid " + child2.pid + " with GUIDON_ROOM_LAN_IP=192.0.2.1 (TEST-NET-1: the X10 probe must fail)");
    // Same sleep-baseline scaling as the first launch's up/target waits above.
    const up2 = await until(cdpUp, BOOT_TIMEOUT_MS, 300);
    if (!up2.hit) { bad("(10) second launch: " + CDP + "/json/version never answered within " + BOOT_TIMEOUT_MS + " ms"); throw new Error("no CDP"); }
    const t2 = await until(async () => { const list = await (await fetch(CDP + "/json/list", { signal: AbortSignal.timeout(1500) })).json(); return list.find((t) => t.type === "page" && t.url && t.url !== "about:blank") || null; }, BOOT_TIMEOUT_MS, 300);
    if (!t2.hit) { bad("(10) no app page target within " + BOOT_TIMEOUT_MS + " ms"); throw new Error("no page"); }
    page = await attachToPage(CDP, (t) => t.url === t2.value.url);
    const booted2 = await until(() => page.evaluate(() => !!(window.G && window.G.routes && window.G.routes.length && window.G.studyGroup && window.G.store && window.__GUIDON_ROOM__)), BOOT_TIMEOUT_MS, 250);
    // Same class of bug as (1)'s boot check, and worse here: the result used
    // to be discarded outright (not even a bad() on a miss), so the very
    // next line's window.G.store access threw straight through to the
    // catch-all "suite error" with no clue which of the ten sections it
    // came from.
    if (!booted2.hit) { bad("(10) second launch: app shell not booted within " + BOOT_TIMEOUT_MS + " ms"); throw new Error("app shell not booted (second launch)"); }
    await page.evaluate(async () => { location.hash = "#/group"; await window.G.store.setSetting("studyGroups", true); });
    await until(() => page.evaluate(() => window.__GUIDON_ROOM__.attached() ? true : null), 5000);
    const h3 = await page.evaluate(() => window.G.studyGroup.host({ mode: "board", name: "DESK-HOST", count: 2, category: "All" }));
    const ri3 = await until(() => page.evaluate(() => window.__GUIDON_ROOM__.info()), 10000, 100);
    ri3.hit && ri3.value.ip === "192.0.2.1" && ri3.value.reachable === false ? ok("(10) RoomInfo " + JSON.stringify(ri3.value) + " after " + ri3.ms + " ms - the X10 probe of 192.0.2.1 said reachable=false") : bad("(10) RoomInfo with an unreachable advertised address: " + JSON.stringify(ri3.value) + " host() " + JSON.stringify(h3) + " lastError " + JSON.stringify(await page.evaluate(() => window.__GUIDON_ROOM__.lastError())));
    const scr3 = await until(() => page.evaluate(() => { const n = document.querySelector(".sg-transport-notice"); const u = document.querySelector(".sg-join-url"); return n ? { notice: n.textContent, url: u ? u.textContent.trim() : null } : null; }), 5000);
    scr3.hit && /host from a phone instead/i.test(scr3.value.notice) ? ok("(10) the host screen says \"host from a phone instead\": " + JSON.stringify(scr3.value.notice)) : bad("(10) no \"host from a phone instead\" notice on the host screen: " + JSON.stringify(scr3.value));
    scr3.hit && ri3.value && scr3.value.url === ri3.value.url ? ok("(10) the join link is still shown next to the notice: " + scr3.value.url) : bad("(10) join link next to the notice: " + JSON.stringify(scr3.value));
    await page.evaluate(() => window.G.studyGroup.leave());
    const cleared = await until(() => page.evaluate(() => window.__GUIDON_ROOM__.info() === null && !document.querySelector(".sg-transport-notice") ? true : null), 5000);
    cleared.hit ? ok("(10) leave() clears the notice and the adapter's info") : bad("(10) after leave(): notice " + JSON.stringify(await page.evaluate(() => (document.querySelector(".sg-transport-notice") || { textContent: null }).textContent)));
    page.close();
    page = null;
    const sent2 = closeMainWindow(child2.pid);
    const t3 = Date.now();
    const ex2 = await Promise.race([exited2, sleep(8000).then(() => null)]);
    ex2 ? ok("(10) the second exe exited in " + (Date.now() - t3) + " ms with code " + ex2.code + " (WM_CLOSE, " + sent2 + ")") : bad("(10) the second exe is still alive 8 s after WM_CLOSE (" + sent2 + ")");
  }
} catch (e) {
  bad("suite error: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
} finally {
  await closeEngines().catch(() => {});
  if (page) { try { page.close(); } catch (e) {} }
  if (child && alive(child.pid)) {
    closeMainWindow(child.pid);
    for (let i = 0; i < 16 && alive(child.pid); i++) await sleep(500);
    if (alive(child.pid)) { try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 15000 }); info("cleanup: taskkill /F used as the last resort"); } catch (e) {} }
  }
  const roomLines = stderrLines.filter((l) => /GUIDON room/.test(l));
  if (roomLines.length) info("exe stderr (" + roomLines.length + " room lines): " + roomLines.slice(0, 12).join(" | "));
  if (dataDir) await rmProfile(dataDir);
}
finish();

/* WebView2's helper processes release the profile a moment after the exe
   exits; one early rm used to leave the folder behind (measured: 4 leaked
   profiles over 4 runs on the verify pass). */
async function rmProfile(dir) {
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    try { await rm(dir, { recursive: true, force: true }); } catch (e) {}
    try { await stat(dir); } catch (e) { return true; }
  }
  info("cleanup: " + dir + " is still held after 3 s - left for the OS temp cleaner");
  return false;
}

function finish() {
  console.log("\n" + (fails ? `ROOM TAURI: ${fails} FAILURE(S)` : "ROOM TAURI: all passed"));
  process.exit(fails ? 1 : 0);
}
