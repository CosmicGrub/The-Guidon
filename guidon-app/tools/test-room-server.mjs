/**
 * Room server (collective P3b, X5): tools/room-server.mjs is the throwaway
 * LAN host for the 8-9 September spike and the stand-in for the Rust and
 * Kotlin hosts in suites. Node 26 built-ins only (node:http + a minimal
 * RFC 6455 server). Written BEFORE the server exists - its first run is the
 * RED baseline.
 *
 *   (1) starts on --loopback with an ephemeral port; serves dist/guest.html
 *       byte-for-byte at / and /j/<code>, JSON at /health, 404 elsewhere
 *   (2) RFC 6455 on a raw TCP socket: the 101 handshake computes the exact
 *       Sec-WebSocket-Accept, a masked client ping is answered by a pong
 *       with the same payload, a masked close is echoed and the socket ends
 *   (3) relay through Node's built-in WebSocket client: a peer's hello
 *       reaches the host socket, a host frame addressed to one fingerprint
 *       reaches ONLY that peer, "*" reaches every peer; invalid frames
 *       (grade key, wrong room, spoofed fingerprint, oversize) are dropped
 *       and counted; a v-mismatch hello is relayed so the HOST can answer
 *       with the locked reject sentence; a peer in a hostless room gets
 *       nothing
 *   (4) close: the host socket closing closes every peer with 4000
 *       "host-left"; the evidence file is a guidon-probe/1 record naming
 *       every connection (remote address, UA, first-frame time)
 *   (5) Chromium client (one browser): the served guest page opens a socket
 *       to location.host, handshakes and relays a 3 KB valid frame both
 *       ways; then, with Chromium CLOSED, the same on Playwright WebKit -
 *       launched through tools/xeng-harness.mjs, never here; skipped aloud
 *       when WebKit is not installed (ci.yml installs Chromium only)
 *
 * Usage: node tools/test-room-server.mjs   (exit code = FAIL count)
 */
import { createHash } from "node:crypto";
import { connect } from "node:net";
import { readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { startRoomServer } from "./room-server.mjs";
import { launchEngine, closeEngines, webkitAvailable } from "./xeng-harness.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, limit = 6000, step = 40) {
  const t0 = Date.now();
  for (;;) {
    let value = null;
    try { value = await pred(); } catch (e) { value = null; }
    if (value) return { hit: true, ms: Date.now() - t0, value };
    if (Date.now() - t0 >= limit) return { hit: false, ms: Date.now() - t0, value };
    await sleep(step);
  }
}
const WATCHDOG_MS = 180000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nROOM SERVER: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

await import(pathToFileURL(resolve("src/app-modules/room-schema.js")).href);
const S = globalThis.G.roomSchema;
const GUEST = resolve("dist/guest.html");
const ROOM = "ALPHA-BRAVO-42";
const V = S.PROTOCOL_VERSION;
const mk = (from, t, body, extra) => Object.assign({ v: V, t, room: ROOM, seq: 0, from, body }, extra || {});
const evidenceFile = join(tmpdir(), "guidon-room-server-evidence-" + process.pid + ".json");

function wsClient(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const closed = new Promise((res) => ws.addEventListener("close", (ev) => res({ code: ev.code, reason: ev.reason, wasClean: ev.wasClean }), { once: true }));
  ws.addEventListener("message", (ev) => inbox.push({ t: Date.now(), text: String(ev.data), decoded: S.wireDecode(String(ev.data)) }));
  const opened = new Promise((res, rej) => { ws.addEventListener("open", () => res(true), { once: true }); ws.addEventListener("error", () => rej(new Error("open failed " + url)), { once: true }); });
  return { ws, inbox, closed, opened, send: (frame, to) => ws.send(S.wireEncode(frame, to == null ? null : to)), raw: (text) => ws.send(text) };
}

console.log("test-room-server: Node built-ins only, Node clients, then Chromium, then WebKit (one browser at a time)\n");
let srv = null;
try {
  const guestBytes = await readFile(GUEST).catch(() => null);
  guestBytes ? ok("dist/guest.html exists (" + guestBytes.length + " bytes)") : bad("dist/guest.html missing - run npm run build");
  srv = await startRoomServer({ loopback: true, port: 0, guest: GUEST, evidence: evidenceFile, quiet: true });
  srv.port > 0 && srv.host === "127.0.0.1" ? ok("(1) started on 127.0.0.1:" + srv.port + " (--loopback; the default bind is 0.0.0.0)") : bad("(1) start: " + JSON.stringify({ port: srv.port, host: srv.host }));
  const base = "http://127.0.0.1:" + srv.port;
  const wsBase = "127.0.0.1:" + srv.port;

  /* ---------------- (1) HTTP ---------------- */
  {
    const r = await fetch(base + "/");
    const b = Buffer.from(await r.arrayBuffer());
    r.status === 200 && /text\/html/.test(r.headers.get("content-type") || "") && guestBytes && b.equals(guestBytes) ? ok("(1) GET / is dist/guest.html byte for byte (" + b.length + " bytes, " + r.headers.get("content-type") + ")") : bad("(1) GET /: status " + r.status + ", " + b.length + " bytes");
    const r2 = await fetch(base + S.ENDPOINTS.join + ROOM);
    const b2 = Buffer.from(await r2.arrayBuffer());
    r2.status === 200 && guestBytes && b2.equals(guestBytes) ? ok("(1) GET " + S.ENDPOINTS.join + ROOM + " is the same bytes (the join page IS the guest page)") : bad("(1) GET /j/<code>: status " + r2.status + ", " + b2.length + " bytes");
    const r3 = await fetch(base + "/health");
    const j = await r3.json().catch(() => null);
    r3.status === 200 && j && typeof j.rooms === "number" && typeof j.connections === "number" && j.protocol === V ? ok("(1) GET /health -> " + JSON.stringify(j)) : bad("(1) /health: " + r3.status + " " + JSON.stringify(j));
    const r4 = await fetch(base + "/nope");
    r4.status === 404 ? ok("(1) GET /nope -> 404") : bad("(1) /nope -> " + r4.status);
    const r5 = await fetch(base + "/../package.json");
    r5.status === 404 ? ok("(1) path traversal is not a file (404)") : bad("(1) /../package.json -> " + r5.status);
  }

  /* ---------------- (2) RFC 6455 on a raw socket ---------------- */
  {
    const key = Buffer.from("0123456789abcdef").toString("base64");
    const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    const sock = connect({ host: "127.0.0.1", port: srv.port });
    const chunks = [];
    sock.on("data", (d) => chunks.push(d));
    const ended = new Promise((res) => sock.on("close", () => res(true)));
    await new Promise((res, rej) => { sock.on("connect", res); sock.on("error", rej); });
    sock.write("GET " + S.ENDPOINTS.ws + "?room=" + ROOM + "&role=peer HTTP/1.1\r\nHost: 127.0.0.1:" + srv.port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\nUser-Agent: raw-probe/1\r\n\r\n");
    const hs = await until(() => { const s = Buffer.concat(chunks).toString("latin1"); return s.includes("\r\n\r\n") ? s : null; });
    hs.hit && /^HTTP\/1\.1 101/.test(hs.value) && hs.value.includes("Sec-WebSocket-Accept: " + accept) ? ok("(2) 101 Switching Protocols with the exact Sec-WebSocket-Accept (" + accept + ")") : bad("(2) handshake: " + JSON.stringify(hs.value && hs.value.slice(0, 200)));
    const hsLen = Buffer.concat(chunks).indexOf("\r\n\r\n") + 4;
    const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
    const masked = (op, payload) => { const p = Buffer.from(payload); const out = Buffer.alloc(2 + 4 + p.length); out[0] = 0x80 | op; out[1] = 0x80 | p.length; mask.copy(out, 2); for (let i = 0; i < p.length; i++) out[6 + i] = p[i] ^ mask[i % 4]; return out; };
    sock.write(masked(0x9, "hi"));
    const pong = await until(() => { const b = Buffer.concat(chunks).subarray(hsLen); return b.length >= 4 && b[0] === 0x8a && b[1] === 2 && b.subarray(2, 4).toString() === "hi" ? true : null; });
    pong.hit ? ok("(2) a masked client PING is answered by an unmasked PONG carrying the same payload") : bad("(2) no pong: " + Buffer.concat(chunks).subarray(hsLen).toString("hex"));
    const before = Buffer.concat(chunks).length;
    sock.write(masked(0x8, Buffer.from([0x03, 0xe8])));
    const closeEcho = await until(() => { const b = Buffer.concat(chunks).subarray(before); return b.length >= 2 && b[0] === 0x88 ? b : null; });
    closeEcho.hit ? ok("(2) a masked CLOSE (1000) is echoed with a CLOSE frame") : bad("(2) no close echo");
    const fin = await Promise.race([ended.then(() => true), sleep(3000).then(() => false)]);
    fin ? ok("(2) the server ended the TCP connection after the close handshake") : bad("(2) socket still open 3 s after close");
    sock.destroy();
    /* an unmasked client frame is a protocol error: RFC 6455 5.1 - the server must close 1002 */
    const sock2 = connect({ host: "127.0.0.1", port: srv.port });
    const c2 = [];
    sock2.on("data", (d) => c2.push(d));
    const ended2 = new Promise((res) => sock2.on("close", () => res(true)));
    await new Promise((res, rej) => { sock2.on("connect", res); sock2.on("error", rej); });
    sock2.write("GET " + S.ENDPOINTS.ws + "?room=" + ROOM + "&role=peer HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n");
    await until(() => Buffer.concat(c2).toString("latin1").includes("\r\n\r\n") ? true : null);
    sock2.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    const closed2 = await Promise.race([ended2.then(() => true), sleep(3000).then(() => false)]);
    const body2 = Buffer.concat(c2);
    const at = body2.indexOf("\r\n\r\n") + 4;
    const code2 = body2.length >= at + 4 && body2[at] === 0x88 ? body2.readUInt16BE(at + 2) : null;
    closed2 && code2 === 1002 ? ok("(2) an UNMASKED client frame is a protocol error: closed with 1002") : bad("(2) unmasked frame: closed=" + closed2 + " code=" + code2);
    sock2.destroy();
    /* Node's fetch refuses to send Upgrade headers, so the bad-version handshake goes over a raw socket too. */
    const sock3 = connect({ host: "127.0.0.1", port: srv.port });
    const c3 = [];
    sock3.on("data", (d) => c3.push(d));
    await new Promise((res, rej) => { sock3.on("connect", res); sock3.on("error", rej); });
    sock3.write("GET " + S.ENDPOINTS.ws + "?room=" + ROOM + "&role=peer HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 8\r\n\r\n");
    const bad3 = await until(() => { const s = Buffer.concat(c3).toString("latin1"); const m = /^HTTP\/1\.1 (\d{3})/.exec(s); return m ? { status: Number(m[1]), text: s } : null; });
    sock3.destroy();
    bad3.hit && bad3.value.status === 426 && /Sec-WebSocket-Version: 13/.test(bad3.value.text) ? ok("(2) a bad Sec-WebSocket-Version is refused with 426 + Sec-WebSocket-Version: 13") : bad("(2) bad version -> " + JSON.stringify(bad3.value && bad3.value.text.slice(0, 120)));
  }

  /* ---------------- (2b) M9: mid-handshake disconnect ----------------
     A client that opens the TCP socket, sends a PARTIAL Upgrade request
     (headers with no terminating blank line - deliberately incomplete, so
     Node's http parser is still waiting for more) and then abruptly
     destroys the socket before ever completing it. handleUpgrade() in
     tools/room-server.mjs only calls conns.add() (the Set that srv.stats()
     .connections reports the live size of) AFTER it has written the 101
     response, which itself only happens once Node's own request parser has
     seen a COMPLETE request - so a socket that never finishes the request
     should never be counted, and its abrupt end should surface as an
     ordinary socket close, not an exception anywhere in this process.
     This suite only reaches the plain (Node http) listener raw-socket-style
     (as (2) above does) - the TLS listener has its own dedicated suite
     (tools/test-room-server-tls.mjs) and there is no Tauri/Rust listener in
     this file to reach, so only the plain listener is exercised here. */
  {
    const before = srv.stats().connections;
    let uncaught = null;
    const onUncaught = (e) => { uncaught = uncaught || e; };
    const onRejection = (e) => { uncaught = uncaught || e; };
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onRejection);
    const key4 = Buffer.from("mid-handshake-key").toString("base64");
    const sock4 = connect({ host: "127.0.0.1", port: srv.port });
    await new Promise((res, rej) => { sock4.on("connect", res); sock4.on("error", rej); });
    sock4.on("error", () => {}); // destroy() below can raise ECONNRESET locally; not the exception under test
    sock4.write("GET " + S.ENDPOINTS.ws + "?room=" + ROOM + "&role=peer HTTP/1.1\r\nHost: 127.0.0.1:" + srv.port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key4 + "\r\nSec-WebSocket-Version: 13\r\n");
    await sleep(150); // give the server a moment to (not) act on the incomplete request
    sock4.destroy();
    const settled = await until(() => srv.stats().connections === before ? true : null, 3000);
    process.removeListener("uncaughtException", onUncaught);
    process.removeListener("unhandledRejection", onRejection);
    !uncaught ? ok("(2b) a mid-handshake disconnect (partial Upgrade request, no terminating blank line, socket destroyed) raised no unhandled exception") : bad("(2b) mid-handshake disconnect threw: " + (uncaught && uncaught.stack ? uncaught.stack.split("\n").slice(0, 3).join(" ") : String(uncaught)));
    settled.hit ? ok("(2b) srv.stats().connections returned to " + before + " shortly after the half-open socket was destroyed (no leaked counted slot)") : bad("(2b) srv.stats().connections stuck at " + srv.stats().connections + " (before " + before + ") - the half-open connection leaked a counted slot");
  }

  /* ---------------- (3) relay ---------------- */
  {
    const HOST = "NODEHOST", A = "PEERAAAA", B = "PEERBBBB";
    const host = wsClient("ws://" + wsBase + S.ENDPOINTS.ws + "?room=" + ROOM + "&role=host");
    await host.opened;
    const pa = wsClient(S.wsUrl(wsBase, ROOM, "peer")), pb = wsClient(S.wsUrl(wsBase, ROOM, "peer"));
    await Promise.all([pa.opened, pb.opened]);
    ok("(3) host + 2 peers connected through Node's built-in WebSocket client (" + S.wsUrl(wsBase, ROOM, "peer") + ")");
    /* the host must speak first so the relay knows its fp; a host frame to "*" is fine before any peer spoke */
    host.send(mk(HOST, "ping", { n: 0 }), "*");
    pa.send(mk(A, "hello", { name: "A", bankSig: "b" }));
    const gotHello = await until(() => host.inbox.find((m) => m.decoded && m.decoded.frame.t === "hello" && m.decoded.frame.from === A) ? true : null);
    gotHello.hit ? ok("(3) a peer's hello reached the host socket in " + gotHello.ms + " ms") : bad("(3) hello never reached the host: " + JSON.stringify(host.inbox.map((m) => m.text.slice(0, 60))));
    pb.send(mk(B, "hello", { name: "B", bankSig: "b" }));
    await until(() => host.inbox.filter((m) => m.decoded && m.decoded.frame.t === "hello").length === 2 ? true : null);
    const snap = { phase: "lobby", mode: "relay", seq: 1, room: ROOM, hostSeat: 1, cardId: null, cardText: null, turnSeat: null, lock: null, deadline: null, round: { idx: 0, total: 0 }, seats: [{ seatNo: 1, name: "H", fp: HOST, score: 0, online: true, ready: true }], bankSig: "b" };
    host.send(mk(HOST, "welcome", { seatNo: 2, token: "tok-a", snapshot: snap }), A);
    const wa = await until(() => pa.inbox.find((m) => m.decoded && m.decoded.frame.t === "welcome") ? true : null);
    await sleep(250);
    const wb = pb.inbox.filter((m) => m.decoded && m.decoded.frame.t === "welcome").length;
    wa.hit && wb === 0 ? ok("(3) a host frame addressed to A's fingerprint reached A only (B saw no welcome, no token leak)") : bad("(3) addressed welcome: A " + wa.hit + " B " + wb);
    host.send(mk(HOST, "ping", { n: 7 }), "*");
    const star = await until(() => pa.inbox.some((m) => m.decoded && m.decoded.frame.t === "ping" && m.decoded.frame.body.n === 7) && pb.inbox.some((m) => m.decoded && m.decoded.frame.t === "ping" && m.decoded.frame.body.n === 7) ? true : null);
    star.hit ? ok("(3) a host frame to \"*\" reached every peer in the room") : bad("(3) broadcast ping missed a peer");
    const s0 = srv.stats();
    const hostBefore = host.inbox.length;
    pb.send(mk(B, "intent", { kind: "score", value: 1, grade: 2 }));
    pb.send(mk(B, "ping", { n: 1 }, { room: "ZULU-ZULU-00" }));
    pb.send(mk(A, "ping", { n: 2 }));
    /* Oversize probe: a WELL-FORMED ping (it decodes and validates once the
       padding is trimmed - proven right here) padded with trailing spaces
       past MAX_WIRE_BYTES, so size is the ONLY thing wrong with it and the
       server's drop reason has to be "oversize" (asserted below by name).
       Measured 2026-09-05: the earlier "x".repeat(...) probe was not JSON,
       so the server dropped it as "unparseable" and this suite stayed green
       with the server's size check deleted - a probe that cannot tell the
       two rules apart proves neither. */
    const oversizeText = S.wireEncode(mk(B, "ping", { n: 3 }), null);
    const padded = oversizeText + " ".repeat(S.MAX_WIRE_BYTES + 200 - Buffer.byteLength(oversizeText, "utf8"));
    const paddedBytes = Buffer.byteLength(padded, "utf8");
    const trimmedDecoded = S.wireDecode(padded.trimEnd());
    const trimmedValid = !!(trimmedDecoded && trimmedDecoded.frame && S.validate(trimmedDecoded.frame).ok);
    trimmedValid && paddedBytes > S.MAX_WIRE_BYTES ? ok("(3) oversize probe is a valid ping once trimmed (" + paddedBytes + " bytes > MAX_WIRE_BYTES " + S.MAX_WIRE_BYTES + "): size is its only defect") : bad("(3) oversize probe is not well-formed apart from size: trimmed decodes+validates=" + trimmedValid + ", " + paddedBytes + " bytes");
    pb.raw(padded);
    pb.raw("{not json");
    pb.send(mk(B, "hello", { name: "OLD", bankSig: "b" }, { v: V + 1 }));
    const relayedSkew = await until(() => host.inbox.slice(hostBefore).find((m) => m.decoded && m.decoded.frame.t === "hello" && m.decoded.frame.v === V + 1) ? true : null);
    relayedSkew.hit ? ok("(3) a v-mismatch hello IS relayed to the host (only the host may answer \"" + S.VERSION_MISMATCH_TEXT + "\")") : bad("(3) v-mismatch hello was not relayed");
    await sleep(300);
    const others = host.inbox.slice(hostBefore).filter((m) => !(m.decoded && m.decoded.frame.t === "hello" && m.decoded.frame.v === V + 1));
    const s1 = srv.stats();
    others.length === 0 ? ok("(3) grade key / wrong room / spoofed fingerprint / oversize / unparseable: none reached the host") : bad("(3) " + others.length + " bad frame(s) reached the host: " + others.map((m) => m.text.slice(0, 80)).join(" | "));
    const dropped = s1.dropped - s0.dropped;
    dropped >= 5 ? ok("(3) the server counted " + dropped + " dropped frame(s) (reasons " + JSON.stringify(s1.droppedBy) + ")") : bad("(3) dropped count " + dropped + " " + JSON.stringify(s1));
    const oversizeDrops = ((s1.droppedBy || {}).oversize || 0) - ((s0.droppedBy || {}).oversize || 0);
    oversizeDrops === 1 ? ok("(3) the padded ping was dropped by the server's own size rule: droppedBy.oversize +1 (not merely unparseable)") : bad("(3) droppedBy.oversize rose by " + oversizeDrops + " (droppedBy " + JSON.stringify(s1.droppedBy) + ") - the server's size rule did not fire on a well-formed oversize frame");
    const pc = wsClient(S.wsUrl(wsBase, "ZULU-YANKEE-99", "peer"));
    await pc.opened;
    pc.send(mk("PEERCCCC", "hello", { name: "C", bankSig: "b" }, { room: "ZULU-YANKEE-99" }));
    await sleep(250);
    const s2 = srv.stats();
    s2.droppedBy && s2.droppedBy["no-host"] >= 1 ? ok("(3) a peer in a hostless room gets nothing (dropped no-host)") : bad("(3) hostless room: " + JSON.stringify(s2.droppedBy));
    pc.ws.close();
    /* a second host for the same room is refused while the first is alive */
    const host2 = wsClient(S.wsUrl(wsBase, ROOM, "host"));
    const h2 = await Promise.race([host2.closed, sleep(3000).then(() => null)]);
    h2 && h2.code === 4002 ? ok("(3) a second host socket for a live room is closed with 4002 \"" + h2.reason + "\"") : bad("(3) second host: " + JSON.stringify(h2));

    /* ---------------- (4) close ---------------- */
    pa.ws.close(1000, "bye");
    const paClosed = await pa.closed;
    paClosed.code === 1000 ? ok("(4) a peer close(1000) completes cleanly (code " + paClosed.code + ")") : bad("(4) peer close: " + JSON.stringify(paClosed));
    host.ws.close(1000, "host done");
    const pbClosed = await Promise.race([pb.closed, sleep(4000).then(() => null)]);
    pbClosed && pbClosed.code === 4000 && /host/i.test(pbClosed.reason) ? ok("(4) the host socket closing closed the remaining peer with 4000 \"" + pbClosed.reason + "\"") : bad("(4) peer after host close: " + JSON.stringify(pbClosed));
    await sleep(300);
    const ev = JSON.parse(await readFile(evidenceFile, "utf8").catch(() => "null"));
    const conns = ev && Array.isArray(ev.connections) ? ev.connections : [];
    ev && ev.schema === "guidon-probe/1" && ev.kind === "room-server" && conns.length >= 6 && conns.every((c) => typeof c.remote === "string" && "ua" in c && "firstFrameMs" in c && typeof c.openedAt === "number")
      ? ok("(4) --evidence wrote a guidon-probe/1 record: " + conns.length + " connections, each with remote/ua/openedAt/firstFrameMs (e.g. " + JSON.stringify({ remote: conns[0].remote, ua: conns[0].ua, firstFrameMs: conns[0].firstFrameMs, role: conns[0].role }) + ")")
      : bad("(4) evidence: " + JSON.stringify(ev).slice(0, 300));
    const rawConn = conns.find((c) => c.ua === "raw-probe/1");
    rawConn ? ok("(4) the raw-socket probe is in the evidence by its UA with role " + rawConn.role + ", close " + rawConn.closeCode) : bad("(4) raw probe missing from evidence");
  }

  /* ---------------- (5) browser clients, one engine at a time ---------------- */
  const bigWelcome = (room) => {
    const seats = [];
    for (let i = 1; i <= 20; i++) seats.push({ seatNo: i, name: "SEAT-" + i, fp: "SEAT" + String(i).padStart(4, "A").replace(/[^A-Z2-7]/g, "A"), score: i, online: true, ready: true, done: false });
    const snap = { phase: "play", mode: "board", seq: 3, room, hostSeat: 1, cardId: "bq1", cardText: { q: "Q".repeat(600), a: "A".repeat(600), category: "Creeds" }, turnSeat: 2, lock: null, deadline: null, round: { idx: 0, total: 3 }, seats, bankSig: "b", deck: { category: "Creeds", timerSec: null } };
    return { v: V, t: "welcome", room, seq: 3, from: "NODEHOST", body: { seatNo: 21, token: "tok-browser", snapshot: snap } };
  };
  for (const engine of ["chromium", "webkit"]) {
    if (engine === "webkit" && !webkitAvailable()) { info("(5) SKIP webkit: Playwright WebKit is not installed here (npx playwright install webkit); ci.yml installs Chromium only"); continue; }
    /* the host must answer the hello asynchronously: start the answerer before the page runs */
    const browser = await launchEngine(engine);
    const page = await (await browser.newContext()).newPage();
    const noise = [];
    page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") noise.push("console: " + m.text()); });
    const ROOMB = engine === "chromium" ? "GOLF-HOTEL-07" : "INDIA-JULIET-08";
    const host = wsClient(S.wsUrl(wsBase, ROOMB, "host"));
    await host.opened;
    host.send({ v: V, t: "ping", room: ROOMB, seq: 0, from: "NODEHOST", body: { n: 0 } }, "*");
    const answerer = setInterval(() => { const h = host.inbox.find((m) => m.decoded && m.decoded.frame.t === "hello" && m.decoded.frame.from === "BROWSERA" && !m.answered); if (h) { h.answered = true; host.send(bigWelcome(ROOMB), "BROWSERA"); } }, 20);
    await page.goto(base + S.ENDPOINTS.join + ROOMB, { waitUntil: "load" });
    const ua = await page.evaluate(() => navigator.userAgent);
    const res = await page.evaluate(async (o) => {
      const S = window.G.roomSchema;
      const t0 = performance.now();
      const ws = new WebSocket(S.wsUrl(location.host, o.room, "peer"));
      const inbox = [];
      ws.onmessage = (ev) => inbox.push(String(ev.data));
      const opened = await new Promise((res) => { ws.onopen = () => res(true); ws.onerror = () => res(false); setTimeout(() => res(false), 5000); });
      const openMs = Math.round(performance.now() - t0);
      if (!opened) return { opened, openMs };
      ws.send(S.wireEncode({ v: S.PROTOCOL_VERSION, t: "hello", room: o.room, seq: 0, from: o.fp, body: { name: "BROWSER", bankSig: "guest" } }, null));
      const t1 = performance.now();
      const got = await new Promise((res) => { const iv = setInterval(() => { const w = inbox.map((x) => S.wireDecode(x)).find((d) => d && d.frame.t === "welcome"); if (w) { clearInterval(iv); res(w); } }, 20); setTimeout(() => { clearInterval(iv); res(null); }, 6000); });
      const rtt = Math.round(performance.now() - t1);
      const closed = new Promise((res) => { ws.onclose = (ev) => res({ code: ev.code, reason: ev.reason, wasClean: ev.wasClean }); });
      ws.close(1000, "done");
      const closeInfo = await Promise.race([closed, new Promise((res) => setTimeout(() => res(null), 3000))]);
      return { opened, openMs, rtt, welcomeBytes: got ? JSON.stringify(got.frame).length : 0, valid: got ? S.validate(got.frame).ok : false, seatNo: got ? got.frame.body.seatNo : null, closeInfo, secure: window.isSecureContext, fork: window.GUIDON_FORK };
    }, { room: ROOMB, fp: "BROWSERA" }).catch((e) => ({ error: String(e && e.message || e) }));
    clearInterval(answerer);
    info("(5) " + engine + " UA: " + ua);
    res.opened ? ok("(5) " + engine + ": WebSocket to location.host handshook in " + res.openMs + " ms") : bad("(5) " + engine + ": open failed " + JSON.stringify(res));
    res.welcomeBytes > 2500 && res.valid && res.seatNo === 21 ? ok("(5) " + engine + ": hello up, a " + res.welcomeBytes + "-byte valid welcome (16-bit length frame) down, round trip " + res.rtt + " ms") : bad("(5) " + engine + ": relay round trip " + JSON.stringify(res));
    res.closeInfo && res.closeInfo.code === 1000 && res.closeInfo.wasClean ? ok("(5) " + engine + ": close(1000) completed cleanly (wasClean)") : bad("(5) " + engine + ": close " + JSON.stringify(res.closeInfo));
    res.fork === "guest" ? ok("(5) " + engine + ": the served page is the guest fork (window.GUIDON_FORK)") : bad("(5) " + engine + ": GUIDON_FORK = " + JSON.stringify(res.fork));
    noise.length === 0 ? ok("(5) " + engine + ": zero page errors / console errors") : bad("(5) " + engine + ": noise " + noise.slice(0, 3).join(" | "));
    host.ws.close(1000, "done");
    await closeEngines();
    info("(5) " + engine + " closed before the next engine launches (one browser at a time)");
  }

  const st = srv.stats();
  info("server stats: " + JSON.stringify(st));

  /* ---------------- (6) server-side heartbeat (K6) ---------------- */
  /* A second loopback server with a 120 ms ping and the default miss
     limit of 3. A raw socket that handshakes and then never answers a
     ping must be pinged, closed 4003 "no-pong" after the third miss and
     leave /health.connections at 0; a raw socket that DOES answer stays
     open across the same window. Node's WebSocket client answers pings
     itself, so it is the control that a live peer is never touched. */
  {
    const hb = await startRoomServer({ loopback: true, port: 0, guest: GUEST, quiet: true, pingMs: 120 });
    try {
      hb.heartbeat && hb.heartbeat.pingMs === 120 && hb.heartbeat.missLimit === 3 ? ok("(6) heartbeat server up on 127.0.0.1:" + hb.port + " pingMs=120 missLimit=3") : bad("(6) heartbeat opts: " + JSON.stringify(hb.heartbeat));
      const hj = await (await fetch("http://127.0.0.1:" + hb.port + "/health")).json();
      hj.heartbeat && hj.heartbeat.pingMs === 120 && hj.heartbeat.missLimit === 3 ? ok("(6) /health reports the heartbeat settings " + JSON.stringify(hj.heartbeat)) : bad("(6) /health heartbeat: " + JSON.stringify(hj.heartbeat));
      const key = Buffer.from("fedcba9876543210").toString("base64");
      const mask = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d]);
      const masked = (op, payload) => { const p = Buffer.from(payload); const out = Buffer.alloc(2 + 4 + p.length); out[0] = 0x80 | op; out[1] = 0x80 | p.length; mask.copy(out, 2); for (let i = 0; i < p.length; i++) out[6 + i] = p[i] ^ mask[i % 4]; return out; };
      const rawSock = (answerPings) => {
        const sock = connect({ host: "127.0.0.1", port: hb.port });
        const chunks = [];
        const st = { sock, chunks, pings: 0, closeCode: null, closeReason: null, closed: false, hsLen: -1 };
        const scan = () => {
          const all = Buffer.concat(chunks);
          if (st.hsLen < 0) { const i = all.indexOf("\r\n\r\n"); if (i < 0) return; st.hsLen = i + 4; }
          let off = st.hsLen;
          st.pings = 0;
          while (off + 2 <= all.length) {
            const op = all[off] & 0x0f, len = all[off + 1] & 0x7f;
            if (off + 2 + len > all.length) break;
            if (op === 0x9) st.pings++;
            if (op === 0x8 && len >= 2) { st.closeCode = all.readUInt16BE(off + 2); st.closeReason = all.subarray(off + 4, off + 2 + len).toString(); }
            off += 2 + len;
          }
        };
        sock.on("data", (d) => {
          chunks.push(d);
          const before = st.pings;
          scan();
          if (answerPings && st.pings > before) for (let i = before; i < st.pings; i++) sock.write(masked(0xA, "hb"));
        });
        sock.on("close", () => { st.closed = true; });
        sock.on("error", () => {});
        st.ready = new Promise((res, rej) => { sock.on("connect", res); sock.on("error", rej); }).then(() => {
          sock.write("GET " + S.ENDPOINTS.ws + "?room=" + ROOM + "&role=peer HTTP/1.1\r\nHost: 127.0.0.1:" + hb.port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\nUser-Agent: raw-heartbeat/1\r\n\r\n");
          return until(() => (scan(), st.hsLen > 0 ? true : null));
        });
        return st;
      };
      const mute = rawSock(false);
      const live = rawSock(true);
      await mute.ready; await live.ready;
      const two = await until(async () => { const j = await (await fetch("http://127.0.0.1:" + hb.port + "/health")).json(); return j.connections === 2 ? j : null; });
      two.hit ? ok("(6) two raw sockets handshook: /health.connections = 2") : bad("(6) /health.connections after two handshakes: " + JSON.stringify(two.value));
      const t0 = Date.now();
      const closed = await until(() => (mute.closeCode != null ? mute.closeCode : null), 4000);
      const muteMs = Date.now() - t0;
      closed.hit && closed.value === 4003 && mute.closeReason === "no-pong" ? ok("(6) the socket that never answers is closed 4003 \"no-pong\" after " + mute.pings + " pings, " + muteMs + " ms (3 misses at 120 ms)") : bad("(6) mute socket: close " + JSON.stringify({ code: mute.closeCode, reason: mute.closeReason, pings: mute.pings, ms: muteMs }));
      mute.pings === 3 ? ok("(6) exactly 3 pings were sent before the close (one per interval of silence)") : bad("(6) pings before close: " + mute.pings);
      const ended = await until(() => mute.closed ? true : null, 3000);
      ended.hit ? ok("(6) the server ended the dead socket's TCP connection (" + ended.ms + " ms after the close frame)") : bad("(6) mute socket still open 3 s after 4003");
      const one = await until(async () => { const j = await (await fetch("http://127.0.0.1:" + hb.port + "/health")).json(); return j.connections === 1 ? j : null; });
      one.hit && one.value.stats.heartbeatClosed === 1 ? ok("(6) /health.connections dropped to 1 and stats.heartbeatClosed = 1") : bad("(6) /health after the drop: " + JSON.stringify(one.value));
      !live.closed && live.closeCode == null && live.pings >= 3 ? ok("(6) the socket that answers pongs is still open after " + live.pings + " pings (a live peer is never touched)") : bad("(6) live socket: " + JSON.stringify({ closed: live.closed, code: live.closeCode, pings: live.pings }));
      const node = wsClient("ws://127.0.0.1:" + hb.port + S.ENDPOINTS.ws + "?room=" + ROOM + "&role=host");
      await node.opened;
      await sleep(120 * 5);
      node.ws.readyState === 1 ? ok("(6) Node's WebSocket client (auto-pong) stays open across 5 intervals") : bad("(6) Node client readyState " + node.ws.readyState);
      node.ws.close(1000, "done");
      await node.closed;
      live.sock.destroy();
    } finally {
      await hb.close();
    }
  }
} catch (e) {
  bad("suite error: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
} finally {
  await closeEngines().catch(() => {});
  if (srv) await srv.close().catch(() => {});
  await rm(evidenceFile, { force: true }).catch(() => {});
}
console.log("\n" + (fails ? `ROOM SERVER: ${fails} FAILURE(S)` : "ROOM SERVER: all passed"));
process.exit(fails ? 1 : 0);
