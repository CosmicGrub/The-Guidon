/**
 * Room server TLS listener (room-tls-and-discovery-pitch.md Section 1.3.1):
 * tools/room-server.mjs gains a SECOND, TLS-wrapped listener next to its
 * existing plaintext one - same Rooms map, same relay logic, reused not
 * duplicated, using createSelfSignedIdentity() from tools/room-tls.mjs.
 * Written BEFORE the listener is wired in - its first run is the RED
 * baseline (see docs/design/room-tls-and-discovery-pitch.md Section 1.3.1).
 *
 *   (1) startRoomServer() exposes a second port (srv.tlsPort) and the
 *       minted identity (srv.identity.fp / .spkiSha256); /health reports
 *       the same fp + tls port (the pitch doc's literal "/health" hook,
 *       which already exists in this file for the plaintext side)
 *   (2) a REAL client - node:tls, rejectUnauthorized:false, exactly the
 *       pattern tools/room-tls.mjs's own --selftest proves and the Rust
 *       spike (src-tauri/spikes/room_tls_spike) mirrors - connects to the
 *       TLS port, computes SHA-256(SPKI) from the peer certificate and
 *       compares it to srv.identity.spkiSha256 BEFORE proceeding
 *   (3) a real hello/welcome round trip over that pinned TLS connection:
 *       a peer's hello reaches a host connected on the SAME TLS listener,
 *       the host's addressed welcome reaches the peer - the identical
 *       relay behavior test-room-server.mjs already proves over plaintext,
 *       now proven over wss:// too (never a second implementation to trust)
 *   (4) the negative case, mirrored from the Rust spike's own negative-case
 *       discipline: a client that computes the RIGHT hash but compares it
 *       against a WRONG expected pin destroys the socket before ever
 *       sending the WS upgrade request - and the server's own connection
 *       count proves no relay session was ever established for it
 *
 * Usage: node tools/test-room-server-tls.mjs   (exit code = FAIL count)
 */
import { connect as tlsConnect } from "node:tls";
import { createHash, X509Certificate } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { startRoomServer } from "./room-server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, limit = 5000, step = 30) {
  const t0 = Date.now();
  for (;;) {
    let value = null;
    try { value = await pred(); } catch (e) { value = null; }
    if (value) return { hit: true, ms: Date.now() - t0, value };
    if (Date.now() - t0 >= limit) return { hit: false, ms: Date.now() - t0, value };
    await sleep(step);
  }
}
const WATCHDOG_MS = 60000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nROOM SERVER TLS: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

await import(pathToFileURL(resolve("src/app-modules/room-schema.js")).href);
const S = globalThis.G.roomSchema;
const GUEST = resolve("dist/guest.html");
const ROOM = "ALPHA-BRAVO-42";
const V = S.PROTOCOL_VERSION;
const mk = (from, t, body, extra) => Object.assign({ v: V, t, room: ROOM, seq: 0, from, body }, extra || {});

/* spkiSha256Of: the SAME "hash the peer cert's SPKI DER" step room-tls.mjs's
   own --selftest performs and documents as the ACTUAL pinning comparison a
   real joiner must do (the short base32 fp is for humans to read aloud
   only - see room-tls-and-discovery-pitch.md Section 1.4). */
function spkiSha256Of(peerCert) {
  if (!peerCert || !peerCert.raw) return null;
  return createHash("sha256").update(new X509Certificate(peerCert.raw).publicKey.export({ type: "spki", format: "der" })).digest("hex");
}

/* A minimal RFC 6455 client over an already-open duplex stream (works for
   both a plain net.Socket and a tls.TLSSocket - the whole point of this
   stage is that the transport differs, the application layer does not).
   Mirrors the raw-socket masking/parsing already proven in
   tools/test-room-server.mjs's own section (2) and (6). */
function wsHandshake(sock, room, role) {
  const key = Buffer.from(String(Math.random()).slice(2, 18).padEnd(16, "0")).toString("base64");
  const req = "GET " + S.ENDPOINTS.ws + "?room=" + room + "&role=" + role + " HTTP/1.1\r\n" +
    "Host: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\nUser-Agent: tls-probe/1\r\n\r\n";
  sock.write(req);
  return until(() => { const s = (sock._rxBuf || Buffer.alloc(0)).toString("latin1"); const i = s.indexOf("\r\n\r\n"); return i >= 0 ? { head: s.slice(0, i), tailLen: Buffer.byteLength(s.slice(0, i + 4), "latin1") } : null; });
}
function maskedFrame(op, payload) {
  const p = Buffer.from(payload);
  const mask = Buffer.from([0x5a, 0x11, 0x9c, 0x03]);
  let header;
  if (p.length < 126) header = Buffer.from([0x80 | op, 0x80 | p.length]);
  else { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 0x80 | 126; header.writeUInt16BE(p.length, 2); }
  const masked = Buffer.alloc(p.length);
  for (let i = 0; i < p.length; i++) masked[i] = p[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}
function drainTextFrames(sock) {
  // pulls any complete UNMASKED server text frames out of sock._rxBuf
  // (opcode 0x1, 7-bit or 16-bit length - this test's frames are small);
  // ping (0x9) frames are skipped (answered) so a stray heartbeat never
  // wedges the parse.
  const out = [];
  let buf = sock._rxBuf || Buffer.alloc(0);
  for (;;) {
    if (buf.length < 2) break;
    const op = buf[0] & 0x0f;
    let len = buf[1] & 0x7f, off = 2;
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
    if (buf.length < off + len) break;
    const payload = buf.subarray(off, off + len);
    if (op === 0x1) out.push(payload.toString("utf8"));
    else if (op === 0x9) sock.write(maskedFrame(0xA, payload)); // answer server pings
    buf = buf.subarray(off + len);
  }
  sock._rxBuf = buf;
  return out;
}
function attachReader(sock) {
  sock._rxBuf = Buffer.alloc(0);
  sock.on("data", (d) => { sock._rxBuf = sock._rxBuf.length ? Buffer.concat([sock._rxBuf, d]) : d; });
}

/**
 * tlsPeer(port, room, role, expectedSpkiSha256) - the realistic joiner-side
 * check: open a TLS socket with rejectUnauthorized:false (there is no CA
 * for a LAN room, per the pitch doc's whole trust model), compute the
 * SPKI hash from the certificate actually presented, and compare it to
 * the pin BEFORE doing anything else. A mismatch destroys the socket
 * immediately - this is the negative case case (4) asserts on.
 */
function tlsPeer(port, room, role, expectedSpkiSha256) {
  return new Promise((resolvePeer) => {
    const sock = tlsConnect({ host: "127.0.0.1", port, rejectUnauthorized: false }, () => {
      const actual = spkiSha256Of(sock.getPeerCertificate());
      const pinOk = !!actual && actual === expectedSpkiSha256;
      if (!pinOk) {
        sock.destroy();
        return resolvePeer({ pinOk, actual, handshook: false, sock, send: null, recv: null });
      }
      attachReader(sock);
      resolvePeer({
        pinOk, actual, handshook: null, sock,
        async handshake() {
          const hs = await wsHandshake(sock, room, role);
          this.handshook = hs.hit && /^HTTP\/1\.1 101/.test(hs.value.head);
          if (this.handshook) sock._rxBuf = sock._rxBuf.subarray(hs.value.tailLen);
          return this.handshook;
        },
        send(frame, to) { sock.write(maskedFrame(0x1, S.wireEncode(frame, to == null ? null : to))); },
        async recvFrame(matchFn, limit) { return until(() => drainTextFrames(sock).map((t) => S.wireDecode(t)).find((d) => d && d.frame && matchFn(d.frame)) || (drainTextFrames.last), limit); },
      });
    });
    sock.on("error", () => {});
  });
}
// recvFrame above needs frames retained across polls (drainTextFrames removes
// them from the buffer); keep a running inbox per socket instead.
function makeInbox(peer) {
  const inbox = [];
  const iv = setInterval(() => { for (const t of drainTextFrames(peer.sock)) { const d = S.wireDecode(t); if (d && d.frame) inbox.push(d.frame); } }, 20);
  iv.unref();
  return { inbox, stop: () => clearInterval(iv) };
}

console.log("test-room-server-tls: room-tls-and-discovery-pitch.md Section 1 - a second, TLS-wrapped listener alongside the existing plaintext one\n");
let srv = null;
try {
  srv = await startRoomServer({ loopback: true, port: 0, guest: GUEST, quiet: true });

  /* ---------------- (1) the server exposes a TLS port + identity ---------------- */
  (typeof srv.tlsPort === "number" && srv.tlsPort > 0) ? ok("(1) srv.tlsPort is a bound port: " + srv.tlsPort) : bad("(1) srv.tlsPort: " + JSON.stringify(srv.tlsPort));
  (srv.identity && typeof srv.identity.fp === "string" && /^[A-Z2-7]{8}$/.test(srv.identity.fp)) ? ok("(1) srv.identity.fp is a valid G.roomSchema fingerprint (8-char base32, SAME formula the JS side uses): " + (srv.identity && srv.identity.fp)) : bad("(1) srv.identity.fp: " + JSON.stringify(srv.identity && srv.identity.fp));
  (srv.identity && /^[0-9a-f]{64}$/.test(srv.identity.spkiSha256)) ? ok("(1) srv.identity.spkiSha256 is a full 64-hex SHA-256: " + (srv.identity && srv.identity.spkiSha256)) : bad("(1) srv.identity.spkiSha256: " + JSON.stringify(srv.identity && srv.identity.spkiSha256));

  const health = await (await fetch("http://127.0.0.1:" + srv.port + "/health")).json().catch((e) => ({ error: String(e) }));
  (health.tls && health.tls.port === srv.tlsPort && health.tls.fp === srv.identity.fp) ? ok("(1) /health reports the SAME tls port + fp: " + JSON.stringify(health.tls)) : bad("(1) /health.tls: " + JSON.stringify(health.tls));

  /* ---------------- (2)+(3) a pinned client, a real hello/welcome round trip ---------------- */
  const pin = srv.identity.spkiSha256;
  const host = await tlsPeer(srv.tlsPort, ROOM, "host", pin);
  const peer = await tlsPeer(srv.tlsPort, ROOM, "peer", pin);
  (host.pinOk && peer.pinOk) ? ok("(2) both clients computed SHA-256(SPKI) from the presented cert and it matched srv.identity.spkiSha256") : bad("(2) pin check: host=" + JSON.stringify({ pinOk: host.pinOk, actual: host.actual }) + " peer=" + JSON.stringify({ pinOk: peer.pinOk, actual: peer.actual }));

  const hostUp = await host.handshake();
  const peerUp = await peer.handshake();
  (hostUp && peerUp) ? ok("(2) both clients completed the RFC 6455 upgrade over the TLS socket (101 Switching Protocols)") : bad("(2) ws handshake over TLS: host=" + hostUp + " peer=" + peerUp);

  const hostBox = makeInbox(host);
  const peerBox = makeInbox(peer);
  const HOSTFP = "TLSHOSTA", PEERFP = "TLSPEERA"; // valid G.roomSchema fingerprints: 8 chars, [A-Z2-7] only
  host.send(mk(HOSTFP, "ping", { n: 0 }), "*"); // host speaks first so the relay learns its fp, same rule as the plaintext suite
  peer.send(mk(PEERFP, "hello", { name: "P", bankSig: "b" }));
  const gotHello = await until(() => hostBox.inbox.find((f) => f.t === "hello" && f.from === PEERFP) ? true : null);
  gotHello.hit ? ok("(3) the peer's hello reached the host over the TLS listener in " + gotHello.ms + " ms") : bad("(3) hello never reached the host over TLS: " + JSON.stringify(hostBox.inbox));

  const snap = { phase: "lobby", mode: "relay", seq: 1, room: ROOM, hostSeat: 1, cardId: null, cardText: null, turnSeat: null, lock: null, deadline: null, round: { idx: 0, total: 0 }, seats: [{ seatNo: 1, name: "H", fp: HOSTFP, score: 0, online: true, ready: true }], bankSig: "b" };
  host.send(mk(HOSTFP, "welcome", { seatNo: 2, token: "tok-tls", snapshot: snap }), PEERFP);
  const gotWelcome = await until(() => peerBox.inbox.find((f) => f.t === "welcome" && f.body && f.body.token === "tok-tls") ? true : null);
  gotWelcome.hit ? ok("(3) the host's addressed welcome reached the peer over the SAME TLS socket in " + gotWelcome.ms + " ms (real hello->welcome round trip, not just an open socket)") : bad("(3) welcome never reached the peer over TLS: " + JSON.stringify(peerBox.inbox));
  hostBox.stop(); peerBox.stop();
  host.sock.destroy(); peer.sock.destroy();
  await until(() => srv.stats().connections === 0 ? true : null, 3000); // let both teardowns land before taking the (4) baseline

  /* ---------------- (4) a WRONG pin is rejected ---------------- */
  const before = srv.stats().connections;
  const wrongPin = pin.slice(0, 60) + (pin[60] === "0" ? "1" : "0") + pin.slice(61); // one hex digit flipped: same length, guaranteed different
  const attacker = await tlsPeer(srv.tlsPort, ROOM, "peer", wrongPin);
  (!attacker.pinOk && attacker.handshook === false) ? ok("(4) a wrong pin is detected immediately: pinOk=false, socket destroyed before any WS upgrade was attempted") : bad("(4) wrong-pin client: " + JSON.stringify({ pinOk: attacker.pinOk, handshook: attacker.handshook }));
  await sleep(200);
  const after = srv.stats().connections;
  after === before ? ok("(4) the server's own connection count is unchanged (" + before + " -> " + after + "): no relay session was ever established for the mismatched-pin socket") : bad("(4) server connections rose from " + before + " to " + after + " despite the client aborting on a pin mismatch");
} catch (e) {
  bad("suite error: " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join(" ") : e));
} finally {
  if (srv) await srv.close().catch(() => {});
}
console.log("\n" + (fails ? `ROOM SERVER TLS: ${fails} FAILURE(S)` : "ROOM SERVER TLS: all passed"));
process.exit(fails ? 1 : 0);
