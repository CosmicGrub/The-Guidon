#!/usr/bin/env node
/**
 * GUIDON room server (collective P3b, X5): the throwaway LAN host for the
 * 8-9 September spike and the stand-in for the Rust and Kotlin hosts in
 * suites. Node 26 built-ins ONLY - node:http plus a minimal RFC 6455
 * WebSocket server (handshake, text frames incl. fragmentation, client
 * masking, ping/pong, close handshake, 16/64-bit lengths). No `ws`, no
 * runtime dependency of any kind: `pkg install nodejs` in Termux on the
 * Fold, copy this file and dist/guest.html, run.
 *
 *   node tools/room-server.mjs [--port 8787] [--loopback] [--host 0.0.0.0]
 *                              [--guest dist/guest.html] [--evidence file.json]
 *                              [--label "what this run was"] [--quiet]
 *
 * HTTP:  GET /            dist/guest.html, byte for byte (the guest page)
 *        GET /j/<code>    the same bytes (the join link a host shows)
 *        GET /health      JSON { ok, rooms, connections, protocol, ... }
 * WS:    /ws?room=<ALPHA-BRAVO-42>&role=host|peer  (G.roomSchema.wsUrl)
 *
 * Relay rules (per room, per G.roomSchema - src/app-modules/room-schema.js
 * is imported, never copied):
 *   - every socket message is the relay envelope wireDecode(text) =
 *     { to, frame }; the frame must pass validate(), EXCEPT a v-mismatch
 *     hello, which is relayed so the host alone answers with the locked
 *     reject sentence; everything else invalid is dropped and counted
 *   - a socket is bound to the `from` of its first frame; a later frame
 *     with another `from` is a spoof and is dropped; a NEW socket claiming
 *     a fingerprint already bound in the room replaces the old socket
 *     (a phone reconnecting after a drop keeps its fingerprint), which is
 *     closed 4001 "replaced"
 *   - peer frames go to the room's host socket (the `to` is ignored); host
 *     frames go to the named fingerprint or, with "*", to every bound peer
 *   - a socket the server has already told to close (4001 replaced, 4002
 *     refused host, any protocol error) relays nothing more, and only the
 *     room's CURRENT host socket may address peers (dropped closing /
 *     not-host) - a refused host must not get a 1 s window to inject
 *     end/kick frames before its TCP socket is destroyed
 *   - one host per room: a second role=host socket while the first is
 *     alive is closed 4002; a peer in a room with no host gets nothing
 *     (dropped no-host); when the host socket closes, every peer is closed
 *     4000 "host-left"
 *   - the relayed text is the ORIGINAL text, byte for byte
 *   - liveness of the SOCKET (not the seat - that is the app's heartbeat):
 *     a socket silent for --ping-ms (15 s) gets an RFC 6455 ping; after
 *     --miss-limit (3) unanswered pings in a row it is closed 4003
 *     "no-pong", so /health never counts a silently dead socket for long
 *
 * Binds 0.0.0.0 by default because loopback probes answer the wrong
 * question for a LAN room; --loopback is for suites that must stay local.
 * --evidence writes a guidon-probe/1 JSON record of every connection
 * (remote address, UA, path, role, first-frame time, frame counts, close
 * code) - the format docs/evidence/README.md describes. Nothing about any
 * connection is kept anywhere else.
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(resolve(HERE, "../src/app-modules/room-schema.js")).href);
const S = globalThis.G.roomSchema;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_PAYLOAD = 1 << 20; // a wire message is < 4.2 KB; anything near 1 MB is hostile

/* ------------------------------------------------------------ frames */
function encodeFrame(op, payload) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload == null ? "" : String(payload));
  let header;
  if (p.length < 126) { header = Buffer.alloc(2); header[1] = p.length; }
  else if (p.length < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(p.length, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(p.length), 2); }
  header[0] = 0x80 | op;
  return Buffer.concat([header, p]);
}
function closePayload(code, reason) {
  const r = Buffer.from(String(reason || "")).subarray(0, 120);
  const b = Buffer.alloc(2 + r.length);
  b.writeUInt16BE(code, 0);
  r.copy(b, 2);
  return b;
}

export async function startRoomServer(opts = {}) {
  const host = opts.loopback ? "127.0.0.1" : (opts.host || "0.0.0.0");
  const port = opts.port == null ? 8787 : Number(opts.port);
  const guestPath = resolve(opts.guest || resolve(HERE, "../dist/guest.html"));
  const guestBytes = await readFile(guestPath).catch(() => null);
  const quiet = !!opts.quiet;
  const say = (m) => { if (!quiet) console.log("[room-server] " + m); };
  const rooms = new Map();   // code -> { code, host, peers: Map(fp -> conn), sockets: Set }
  const conns = new Set();
  const startedAt = Date.now();
  const stats = { connections: 0, framesIn: 0, framesOut: 0, dropped: 0, droppedBy: {}, closed: 0, heartbeatClosed: 0 };
  /* Server-side liveness (K6): the app's own heartbeat drops a SEAT when a
     phone goes silent, but a TCP socket whose peer vanished without a FIN
     (battery, walked out of range) stays "open" here for the kernel's
     keepalive window and /health overcounts it. Every socket that has been
     silent for pingMs gets an RFC 6455 PING; the pong (or any inbound
     frame) resets the count; missLimit unanswered pings in a row close it
     4003 "no-pong" (the close handshake and the 1 s destroy timer take it
     out of conns whether or not the peer is still there). Node's and every
     browser's WebSocket client answers pings on its own, so a live peer
     never sees this. */
  const pingMs = Math.max(50, Number(opts.pingMs) || 15000);
  const missLimit = Math.max(1, Number(opts.missLimit) || 3);
  const evidence = { schema: "guidon-probe/1", kind: "room-server", at: new Date(startedAt).toISOString(), label: String(opts.label || "room-server"), startedAt: new Date(startedAt).toISOString(), node: process.version, bind: { host, port: null }, guest: { path: guestPath, bytes: guestBytes ? guestBytes.length : null }, connections: [] };
  let nextId = 1;
  let evTimer = null;

  function drop(conn, reason) {
    stats.dropped++;
    stats.droppedBy[reason] = (stats.droppedBy[reason] || 0) + 1;
    if (conn) conn.rec.frames.dropped++;
  }
  function heartbeat() {
    const now = Date.now();
    for (const conn of [...conns]) {
      if (conn.dead || conn.closeSent) continue;
      if (now - conn.lastIn < pingMs) continue;
      if (conn.missed >= missLimit) {
        stats.heartbeatClosed++;
        conn.rec.heartbeatMissed = conn.missed;
        say("no-pong #" + conn.id + " " + conn.role + " " + conn.room + ": " + conn.missed + " pings unanswered, closing 4003");
        closeConn(conn, 4003, "no-pong");
        continue;
      }
      conn.missed++;
      send(conn, 0x9, "hb");
    }
  }
  function scheduleEvidence() {
    if (!opts.evidence) return;
    if (evTimer) return;
    evTimer = setTimeout(() => { evTimer = null; writeEvidence(); }, 200);
  }
  async function writeEvidence() {
    if (!opts.evidence) return;
    evidence.writtenAt = new Date().toISOString();
    evidence.stats = { ...stats, uptimeMs: Date.now() - startedAt };
    try { await writeFile(opts.evidence, JSON.stringify(evidence, null, 2) + "\n", "utf8"); } catch (e) { say("evidence write failed: " + e.message); }
  }
  function roomOf(code) {
    let r = rooms.get(code);
    if (!r) { r = { code, host: null, peers: new Map(), sockets: new Set(), createdAt: Date.now() }; rooms.set(code, r); }
    return r;
  }
  function send(conn, op, payload) {
    if (conn.dead) return false;
    try { conn.sock.write(encodeFrame(op, payload)); return true; } catch (e) { return false; }
  }
  function closeConn(conn, code, reason) {
    if (conn.dead) return;
    if (!conn.closeSent) { conn.closeSent = true; conn.rec.closeCode = conn.rec.closeCode == null ? code : conn.rec.closeCode; send(conn, 0x8, closePayload(code, reason)); }
    if (conn.closeTimer) return;
    conn.closeTimer = setTimeout(() => { try { conn.sock.destroy(); } catch (e) {} }, 1000);
  }
  function detach(conn) {
    if (conn.dead) return;
    conn.dead = true;
    conns.delete(conn);
    stats.closed++;
    conn.rec.closedAt = Date.now();
    if (conn.closeTimer) clearTimeout(conn.closeTimer);
    const room = rooms.get(conn.room);
    if (room) {
      room.sockets.delete(conn);
      if (conn.fp && room.peers.get(conn.fp) === conn) room.peers.delete(conn.fp);
      if (room.host === conn) {
        room.host = null;
        for (const p of [...room.sockets]) if (p !== conn) closeConn(p, 4000, "host-left");
      }
      if (!room.sockets.size) rooms.delete(conn.room);
    }
    say("close #" + conn.id + " " + conn.role + " " + conn.room + " code " + conn.rec.closeCode);
    scheduleEvidence();
  }
  function onText(conn, text) {
    stats.framesIn++;
    conn.rec.frames.in++;
    if (conn.closeSent) return drop(conn, "closing");
    if (conn.rec.firstFrameAt == null) { conn.rec.firstFrameAt = Date.now(); conn.rec.firstFrameMs = conn.rec.firstFrameAt - conn.rec.openedAt; scheduleEvidence(); }
    if (Buffer.byteLength(text, "utf8") > S.MAX_WIRE_BYTES) return drop(conn, "oversize");
    const d = S.wireDecode(text);
    if (!d || !d.frame || typeof d.frame !== "object") return drop(conn, "unparseable");
    const frame = d.frame;
    if (!S.isFingerprint(frame.from)) return drop(conn, "from");
    const v = S.validate(frame);
    if (!v.ok && !(v.reason === "version" && frame.t === "hello")) return drop(conn, "invalid");
    if (frame.room !== conn.room) return drop(conn, "room");
    const room = roomOf(conn.room);
    if (conn.fp == null) {
      const prev = conn.role === "host" ? (room.host && room.host !== conn && room.host.fp === frame.from ? room.host : null) : room.peers.get(frame.from);
      if (prev && prev !== conn && !prev.dead) closeConn(prev, 4001, "replaced");
      conn.fp = frame.from;
      conn.rec.fp = frame.from;
      if (conn.role !== "host") room.peers.set(frame.from, conn);
    } else if (conn.fp !== frame.from) {
      return drop(conn, "spoof");
    }
    const targets = [];
    if (conn.role !== "host") {
      if (!room.host || room.host.dead) return drop(conn, "no-host");
      targets.push(room.host);
    } else if (room.host !== conn) {
      return drop(conn, "not-host");
    } else if (d.to === "*") {
      for (const p of room.peers.values()) if (!p.dead) targets.push(p);
    } else if (d.to) {
      const p = room.peers.get(d.to);
      if (!p || p.dead) return drop(conn, "unknown-to");
      targets.push(p);
    } else {
      return drop(conn, "unknown-to");
    }
    const payload = Buffer.from(text, "utf8");
    for (const t of targets) { if (send(t, 0x1, payload)) { stats.framesOut++; t.rec.frames.out++; } }
  }
  function onFrame(conn, op, fin, payload, rsv) {
    if (rsv) return closeConn(conn, 1002, "rsv");
    if (op >= 0x8) {
      if (!fin || payload.length > 125) return closeConn(conn, 1002, "control");
      if (op === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        conn.rec.closeCode = code;
        if (!conn.closeSent) { conn.closeSent = true; send(conn, 0x8, payload.length >= 2 ? payload.subarray(0, 2) : closePayload(1000, "")); }
        try { conn.sock.end(); } catch (e) {}
        return;
      }
      if (op === 0x9) { send(conn, 0xA, payload); return; }
      conn.missed = 0; // pong: the peer is alive (the SEAT's liveness stays the application heartbeat)
      return;
    }
    if (op === 0x2) return closeConn(conn, 1003, "binary");
    if (op === 0x1) {
      if (fin) return onText(conn, payload.toString("utf8"));
      conn.frag = [payload];
      return;
    }
    if (op === 0x0) {
      if (!conn.frag) return closeConn(conn, 1002, "continuation");
      conn.frag.push(payload);
      const total = conn.frag.reduce((n, b) => n + b.length, 0);
      if (total > MAX_PAYLOAD) return closeConn(conn, 1009, "too big");
      if (fin) { const whole = Buffer.concat(conn.frag); conn.frag = null; onText(conn, whole.toString("utf8")); }
      return;
    }
    closeConn(conn, 1002, "opcode");
  }
  function parse(conn) {
    let buf = conn.buf;
    for (;;) {
      if (buf.length < 2) break;
      const b0 = buf[0], b1 = buf[1];
      const fin = !!(b0 & 0x80), rsv = b0 & 0x70, op = b0 & 0x0f, masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) break; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX_PAYLOAD)) { closeConn(conn, 1009, "too big"); buf = Buffer.alloc(0); break; } len = Number(big); off = 10; }
      if (!masked) { closeConn(conn, 1002, "unmasked"); buf = Buffer.alloc(0); break; }
      if (len > MAX_PAYLOAD) { closeConn(conn, 1009, "too big"); buf = Buffer.alloc(0); break; }
      if (buf.length < off + 4 + len) break;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      onFrame(conn, op, fin, payload, rsv);
      if (conn.dead) { buf = Buffer.alloc(0); break; }
    }
    conn.buf = buf;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://x");
    const p = url.pathname;
    const isGuest = p === "/" || p === "/guest.html" || p === S.ENDPOINTS.join.replace(/\/$/, "") || p.startsWith(S.ENDPOINTS.join);
    if ((req.method === "GET" || req.method === "HEAD") && isGuest) {
      if (!guestBytes) { res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); return res.end("dist/guest.html is missing - run `npm run build` in guidon-app first (looked at " + guestPath + ")\n"); }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": guestBytes.length, "cache-control": "no-store", "x-guidon-fork": "guest" });
      return req.method === "HEAD" ? res.end() : res.end(guestBytes);
    }
    if (req.method === "GET" && p === "/health") {
      const body = JSON.stringify({ ok: true, rooms: rooms.size, connections: conns.size, protocol: S.PROTOCOL_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000), bind: { host, port: server.address() ? server.address().port : port }, guestBytes: guestBytes ? guestBytes.length : null, heartbeat: { pingMs, missLimit }, stats });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      return res.end(body);
    }
    if (p === S.ENDPOINTS.ws) { res.writeHead(426, { "content-type": "text/plain", "sec-websocket-version": "13" }); return res.end("upgrade required\n"); }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("404\n");
  });

  server.on("upgrade", (req, sock, head) => {
    const url = new URL(req.url || "/", "http://x");
    const h = (n) => String(req.headers[n] || "");
    const refuse = (code, text, extra) => { sock.write("HTTP/1.1 " + code + " " + text + "\r\nConnection: close\r\nContent-Type: text/plain\r\n" + (extra || "") + "\r\n" + text + "\n"); sock.destroy(); };
    if (url.pathname !== S.ENDPOINTS.ws) return refuse(404, "Not Found");
    if (!/websocket/i.test(h("upgrade")) || !/upgrade/i.test(h("connection"))) return refuse(400, "Bad Request");
    if (h("sec-websocket-version") !== "13") return refuse(426, "Upgrade Required", "Sec-WebSocket-Version: 13\r\n");
    const key = h("sec-websocket-key");
    if (!key) return refuse(400, "Bad Request");
    const roomCode = String(url.searchParams.get("room") || "").toUpperCase();
    if (!S.isRoomCode(roomCode)) return refuse(400, "Bad Request");
    const role = url.searchParams.get("role") === "host" ? "host" : "peer";
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
    const rec = { id: nextId++, remote: (sock.remoteAddress || "?") + ":" + (sock.remotePort || "?"), ua: h("user-agent"), path: req.url, room: roomCode, role, fp: null, openedAt: Date.now(), firstFrameAt: null, firstFrameMs: null, closedAt: null, closeCode: null, frames: { in: 0, out: 0, dropped: 0 } };
    const conn = { id: rec.id, sock, room: roomCode, role, fp: null, buf: Buffer.alloc(0), frag: null, dead: false, closeSent: false, closeTimer: null, rec, lastIn: Date.now(), missed: 0 };
    conns.add(conn);
    stats.connections++;
    evidence.connections.push(rec);
    const room = roomOf(roomCode);
    room.sockets.add(conn);
    if (role === "host") {
      if (room.host && !room.host.dead) { say("refuse #" + conn.id + ": " + roomCode + " already has a host"); closeConn(conn, 4002, "room already has a host"); }
      else room.host = conn;
    }
    say("open #" + conn.id + " " + role + " " + roomCode + " from " + rec.remote + " ua " + rec.ua.slice(0, 60));
    scheduleEvidence();
    sock.setNoDelay(true);
    sock.on("data", (d) => { if (conn.dead) return; conn.lastIn = Date.now(); conn.missed = 0; conn.buf = conn.buf.length ? Buffer.concat([conn.buf, d]) : d; if (conn.buf.length > MAX_PAYLOAD * 2) return closeConn(conn, 1009, "too big"); parse(conn); });
    sock.on("close", () => detach(conn));
    sock.on("error", () => detach(conn));
    if (head && head.length) { conn.buf = Buffer.from(head); parse(conn); }
  });

  await new Promise((res, rej) => { server.once("error", rej); server.listen(port, host, () => { server.off("error", rej); res(); }); });
  const bound = server.address().port;
  evidence.bind.port = bound;
  const hbTimer = setInterval(heartbeat, pingMs);
  hbTimer.unref();
  say("listening on " + host + ":" + bound + (guestBytes ? " serving " + guestPath + " (" + guestBytes.length + " bytes)" : " - NO guest page (dist/guest.html missing)"));
  if (host === "0.0.0.0") for (const a of lanAddresses()) say("join link on " + a.name + ": " + S.joinUrl("http://" + a.address + ":" + bound, "ALPHA-BRAVO-42").replace("ALPHA-BRAVO-42", "<code>"));
  scheduleEvidence();

  return {
    port: bound, host, server, evidencePath: opts.evidence || null,
    stats: () => ({ ...stats, droppedBy: { ...stats.droppedBy }, rooms: rooms.size, connections: conns.size }),
    rooms: () => [...rooms.values()].map((r) => ({ code: r.code, host: !!(r.host && !r.host.dead), peers: [...r.peers.keys()] })),
    heartbeat: { pingMs, missLimit },
    async close() {
      clearInterval(hbTimer);
      for (const c of [...conns]) closeConn(c, 1001, "server closing");
      await new Promise((r) => setTimeout(r, 50));
      for (const c of [...conns]) { try { c.sock.destroy(); } catch (e) {} detach(c); }
      await new Promise((r) => server.close(() => r()));
      if (evTimer) { clearTimeout(evTimer); evTimer = null; }
      await writeEvidence();
    },
  };
}

function lanAddresses() {
  const out = [];
  try {
    const ifs = networkInterfaces();
    for (const name of Object.keys(ifs)) for (const a of ifs[name] || []) if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address });
  } catch (e) {}
  return out;
}

/* ------------------------------------------------------------ CLI */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const opts = { port: val("--port") != null ? Number(val("--port")) : 8787, loopback: args.includes("--loopback"), host: val("--host"), guest: val("--guest"), evidence: val("--evidence"), label: val("--label"), quiet: args.includes("--quiet"), pingMs: val("--ping-ms"), missLimit: val("--miss-limit") };
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node tools/room-server.mjs [--port 8787] [--loopback] [--host 0.0.0.0] [--guest dist/guest.html] [--evidence out.json] [--label text] [--quiet] [--ping-ms 15000] [--miss-limit 3]");
    process.exit(0);
  }
  const srv = await startRoomServer(opts);
  const stop = async () => { console.log("[room-server] stopping"); await srv.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  if (opts.evidence) console.log("[room-server] evidence -> " + opts.evidence + " (guidon-probe/1, rewritten on every connection change and at exit)");
}
