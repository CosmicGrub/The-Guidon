/**
 * In-app room JOINING (collective roadmap P4b, 2026-09-05): src/room-web.js,
 * the plain-WebSocket JOIN transport at G.studyGroup's ONE seam. Before this
 * module existed, tapping "Join a room" in the main app did nothing useful
 * on ANY fork - src/room-tauri.js is host-only, and every other fork had no
 * transport at all - which is the root cause behind "why does it turn into
 * a webpage": dist/guest.html was the only page that could ever open a
 * socket. Written BEFORE src/room-web.js existed; its first run against that
 * tree is the RED baseline (see the header of each section below for what
 * RED looked like, measured 2026-09-05 by reverting the three source edits
 * and rerunning this exact file).
 *
 *   (1) parse(): the URL/bare-code parser, unit-tested directly in Node - a
 *       full join link, one with a trailing slash, one with extra query
 *       params, a bare code, and garbage. No browser needed.
 *   (2) the queue-before-open hazard, isolated: a frame handed to the
 *       transport's send() the instant the WebSocket is constructed
 *       (readyState 0, CONNECTING - exactly when G.studyGroup.join() calls
 *       sendHello()) still reaches a real server once the socket opens.
 *   (3) ONE Chromium, the FULL app (web/index.html, not the guest page),
 *       Settings -> Study groups on:
 *     (3a) a bare room code with no attached transport yet refuses
 *          IMMEDIATELY with a specific reason - never a silent hang;
 *     (3b) a pasted full join link (to a real room-server.mjs + a Node
 *          host, tools/room-node-host.mjs - the same stand-in
 *          tools/test-guest-page.mjs uses for the Rust/Kotlin hosts) is
 *          admitted, reaches "seated", and a live message round-trips both
 *          ways: the peer's Ready intent tallies on the host (peer->host),
 *          the host's board start puts a card on the peer's screen
 *          (host->peer), the peer's answer intent locks scoring on the
 *          host (peer->host), and the reveal comes back down to the peer's
 *          own screen (host->peer);
 *     (3c) the room server going away shows "network-lost" with a working
 *          "Try to reconnect" button, and reconnecting against a FRESH
 *          server on the same address (a different Node host entirely)
 *          re-seats the peer - proving send() itself reopens a fresh
 *          socket to the same stored target, with zero change to
 *          studygroup.js's reconnect().
 *
 * Usage: node tools/test-room-web.mjs   (exit code = FAIL count)
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startRoomServer } from "./room-server.mjs";
import { nodeHost } from "./room-node-host.mjs";
import { serve } from "./server.mjs";
import { openRoom, close as closeRoom } from "./room-harness.mjs";

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
const WATCHDOG_MS = 150000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nROOM WEB: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

console.log("test-room-web: src/room-web.js - the in-app plain-WebSocket JOIN transport\n");

/* ---------------------------------------------------------------------
   (1) parse(): unit tests, no browser. Loaded the same way every Node
   tool loads a src/ module - see tools/room-node-host.mjs's own header.
   --------------------------------------------------------------------- */
let RW = null;
try {
  await import(pathToFileURL(resolve("src/app-modules/room-schema.js")).href);
  await import(pathToFileURL(resolve("src/room-web.js")).href);
  RW = globalThis.__GUIDON_ROOM_WEB__;
  RW && typeof RW.parse === "function" && typeof RW.joinAt === "function"
    ? ok("(1) src/room-web.js loads in Node and exposes window.__GUIDON_ROOM_WEB__.{parse, joinAt}")
    : bad("(1) src/room-web.js did not expose the expected surface: " + JSON.stringify(RW));
} catch (e) {
  bad("(1) src/room-web.js does not exist or failed to load - RED: " + (e && e.message ? e.message : e));
}

if (RW) {
  const cases = [
    { in: "http://192.168.1.5:8787/j/ALPHA-BRAVO-42", want: { kind: "url", hostPort: "192.168.1.5:8787", room: "ALPHA-BRAVO-42" }, label: "a full join link" },
    { in: "http://192.168.1.5:8787/j/ALPHA-BRAVO-42/", want: { kind: "url", hostPort: "192.168.1.5:8787", room: "ALPHA-BRAVO-42" }, label: "a join link with a trailing slash" },
    { in: "http://192.168.1.5:8787/j/alpha-bravo-42?ref=sms&x=1", want: { kind: "url", hostPort: "192.168.1.5:8787", room: "ALPHA-BRAVO-42" }, label: "a join link with extra query params (and lowercase)" },
    { in: "192.168.1.5:8787/j/ALPHA-BRAVO-42", want: { kind: "url", hostPort: "192.168.1.5:8787", room: "ALPHA-BRAVO-42" }, label: "a join link with no scheme at all" },
    { in: "  alpha-bravo-42  ", want: { kind: "code", room: "ALPHA-BRAVO-42" }, label: "a bare code (padded, lowercase)" },
    { in: "ALPHA-BRAVO-42", want: { kind: "code", room: "ALPHA-BRAVO-42" }, label: "a bare code" },
    { in: "", want: { kind: "invalid" }, label: "empty input" },
    { in: "not a code at all", want: { kind: "invalid" }, label: "garbage" },
    { in: "http://192.168.1.5:8787/", want: { kind: "invalid" }, label: "a URL with no /j/<code> path and not itself a bare code" },
  ];
  for (const c of cases) {
    const got = RW.parse(c.in);
    const eq = got.kind === c.want.kind && got.room === c.want.room && got.hostPort === c.want.hostPort;
    eq ? ok(`(1) parse(${JSON.stringify(c.in)}) [${c.label}] -> ${JSON.stringify(got)}`) : bad(`(1) parse(${JSON.stringify(c.in)}) [${c.label}] -> ${JSON.stringify(got)}, expected ${JSON.stringify(c.want)}`);
  }

  /* -------------------------------------------------------------------
     (1b) secure-link routing signal (room-tls-and-discovery-pitch.md
     Section 1.3.6, 2026-09-06): the THREE states parse() must distinguish
     for a URL-kind target - secure:false/pin:null (plain, unchanged), the
     complete secure:true/pin:<hex> case, and secure:true/pin:null for a
     secure link missing its pin or carrying a malformed one. Also proves
     an http:// link never gets a pin read even if one is stapled onto it
     (a pin only ever means something once isSecureOrigin() is already
     true), and that a schemeless paste of an otherwise-secure link is
     treated as plain http:// (never upgraded to https:// by guessing).
     ------------------------------------------------------------------- */
  const S = globalThis.G.roomSchema;
  const REAL_PIN = "ab".repeat(32); // 64 lowercase hex chars, isSpkiPin-shaped
  const secureCases = [
    { in: S.joinUrl("https://192.168.1.5:8443", "ALPHA-BRAVO-42", REAL_PIN), want: { secure: true, pin: REAL_PIN }, label: "a secure link with a valid pin" },
    { in: "https://192.168.1.5:8443/j/ALPHA-BRAVO-42", want: { secure: true, pin: null }, label: "a secure link with NO pin fragment at all" },
    { in: "https://192.168.1.5:8443/j/ALPHA-BRAVO-42#pin=deadbeef", want: { secure: true, pin: null }, label: "a secure link with a malformed pin (too short)" },
    { in: "https://192.168.1.5:8443/j/ALPHA-BRAVO-42#pin=" + "ZZ".repeat(32), want: { secure: true, pin: null }, label: "a secure link with a malformed pin (right length, non-hex)" },
    { in: S.joinUrl("http://192.168.1.5:8787", "ALPHA-BRAVO-42", REAL_PIN), want: { secure: false, pin: null }, label: "a PLAIN link that happens to carry a #pin fragment - not secure, pin ignored" },
    { in: "192.168.1.5:8443/j/ALPHA-BRAVO-42#pin=" + REAL_PIN, want: { secure: false, pin: null }, label: "a secure-looking link pasted with NO scheme - treated as plain http:// (never upgraded by guessing)" },
  ];
  for (const c of secureCases) {
    const got = RW.parse(c.in);
    const eq = got.kind === "url" && got.secure === c.want.secure && got.pin === c.want.pin;
    eq ? ok(`(1b) parse(${JSON.stringify(c.in)}) [${c.label}] -> secure:${got.secure} pin:${got.pin ? got.pin.slice(0, 8) + "..." : got.pin}`) : bad(`(1b) parse(${JSON.stringify(c.in)}) [${c.label}] -> ${JSON.stringify(got)}, expected secure:${c.want.secure} pin:${c.want.pin}`);
  }
}

/* ---------------------------------------------------------------------
   (2) the queue-before-open hazard, isolated: a real WebSocket server
   (tools/room-server.mjs, loopback), a transport built directly from
   RW._makeTransport, and a send() call made in the SAME synchronous turn
   the socket is constructed - readyState is 0 (CONNECTING), never 1
   (OPEN), at that instant. If send() required OPEN before queuing this
   frame would be lost forever; RED for this section (before room-web.js
   existed, or with the readyState guard reverted to an unconditional
   sock.send()) is "a frame the server never saw" or a thrown
   INVALID_STATE_ERR, not a FAIL line about a wrong value.
   --------------------------------------------------------------------- */
let qsrv = null;
if (RW) {
  try {
    await import(pathToFileURL(resolve("src/app-modules/room-schema.js")).href);
    const S = globalThis.G.roomSchema;
    qsrv = await startRoomServer({ loopback: true, port: 0, quiet: true });
    const wsBase = "127.0.0.1:" + qsrv.port;
    const ROOM = S.roomCode();
    const t = RW._makeTransport(wsBase, ROOM);
    const before = qsrv.stats().framesIn;
    const sentWhileQueued = t.send({ v: S.PROTOCOL_VERSION, t: "hello", room: ROOM, seq: 0, from: "AAAAAAAA", body: { name: "Q", bankSig: "b" } }, null);
    sentWhileQueued ? ok("(2) send() accepted a frame the instant the socket was constructed (queued, not sent yet)") : bad("(2) send() returned false for the very first frame - the queue path itself failed");
    const arrived = await until(() => qsrv.stats().framesIn > before ? true : null, 5000);
    arrived.hit ? ok("(2) the queued frame reached the real server once the socket opened (" + arrived.ms + " ms) - the queue-before-open fix holds") : bad("(2) the queued frame never reached the server: framesIn stayed at " + qsrv.stats().framesIn);
    t.onended();
  } catch (e) {
    bad("(2) section error: " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" ") : e));
  }
}

/* ---------------------------------------------------------------------
   (3) ONE Chromium, the full app, Settings -> Study groups on.
   --------------------------------------------------------------------- */
const { server: appServer, url: appUrl } = await serve("web");
let srv = null, host = null;
try {
  const room1 = await openRoom(appUrl, 1, { hash: "#/group", studyGroups: true });
  const P = room1.pages[0];
  const present = await P.evaluate(() => ({ sg: !!(window.G && G.studyGroup), rw: !!window.__GUIDON_ROOM_WEB__ }));
  present.sg && present.rw ? ok("(3) the full app page carries both G.studyGroup and window.__GUIDON_ROOM_WEB__") : bad("(3) present: " + JSON.stringify(present));
  if (!present.rw) throw new Error("window.__GUIDON_ROOM_WEB__ is absent - RED (src/room-web.js is not spliced into web/index.html)");

  /* ---------------- (3a) bare code, nothing attached yet: immediate, specific refusal ---------------- */
  {
    await P.fill(".sg-join-code", "ALPHA-BRAVO-42");
    await P.fill(".sg-join-name", "PEER-ONE");
    await P.click(".sg-join");
    const msg = await until(() => P.evaluate(() => { const m = document.querySelector(".sg-msg"); return m ? m.textContent : null; }), 3000);
    msg.hit && /no room connection is attached/i.test(msg.value)
      ? ok("(3a) a bare code with no transport attached yet refuses IMMEDIATELY (" + msg.ms + " ms): " + JSON.stringify(msg.value))
      : bad("(3a) bare-code refusal: " + JSON.stringify(msg.value) + " (RED before this fix: either the OLD wrong-shaped reason from calling join({room:<url-or-code>}) unconditionally, or - with a transport already attached from an earlier test - an indefinite hang on \"Reaching the host...\", not a message at all)");
    const stillIdle = await P.evaluate(() => !!(window.G.studyGroup.state() === null));
    stillIdle ? ok("(3a) the refused join left no room state behind") : bad("(3a) state after the refused join: " + JSON.stringify(await P.evaluate(() => G.studyGroup.state())));
  }

  /* ---------------- (3b) a real room-server + Node host; join by pasted link ---------------- */
  const ids = ["rwq1"];
  const cards = { rwq1: { q: "State the NCO Support Channel's purpose in one line.", a: "It parallels the chain of command for standards, training and Soldier welfare.", category: "Leadership" } };
  srv = await startRoomServer({ loopback: true, port: 0, quiet: true });
  const wsBase = "127.0.0.1:" + srv.port;
  host = nodeHost({ wsBase, mode: "board", ids, cards, category: "Leadership", name: "NODE-HOST", pingMs: 1000, missLimit: 3, holdMs: 8000 });
  const ROOM = await host.ready;
  ok("(3b) a real room-server.mjs + Node host (the app's own pure core over a real socket, the Rust/Kotlin stand-in) opened board room " + ROOM + " on " + wsBase);

  await import(pathToFileURL(resolve("src/app-modules/room-schema.js")).href);
  const S = globalThis.G.roomSchema;
  const joinLink = S.joinUrl("http://" + wsBase, ROOM);
  await P.fill(".sg-join-code", joinLink);
  await P.fill(".sg-join-name", "PEER-ONE");
  await P.click(".sg-join");
  const pending = await until(() => host.pending().find((p) => p.name === "PEER-ONE") || null);
  pending.hit ? ok("(3b) the pasted join link (" + joinLink + ") reached the Node host as a pending hello (" + pending.ms + " ms, fp " + pending.value.fp + ")") : bad("(3b) the app's hello never reached the host: pending " + JSON.stringify(host.pending()));
  const fp = pending.value ? pending.value.fp : null;
  host.act({ type: "admit", fp });
  const seated = await until(() => P.evaluate(() => { const s = G.studyGroup.session(); return s && s.status === "seated" ? s.seatNo : null; }));
  seated.hit && seated.value === 2 ? ok("(3b) admitted: the app is seat 2 (" + seated.ms + " ms)") : bad("(3b) seated: " + JSON.stringify(seated));
  const roomCodeShown = await until(() => P.evaluate((code) => { const el2 = document.querySelector(".sg-room-code"); return el2 && el2.textContent.trim() === code ? true : null; }, ROOM));
  roomCodeShown.hit ? ok("(3b) the room screen renders the joined room's code") : bad("(3b) room code on screen: " + JSON.stringify(await P.evaluate(() => (document.querySelector(".sg-room-code") || {}).textContent)));

  /* round trip 1: peer -> host (Ready intent tallies on the host) */
  await P.click(".sg-ready");
  const readyOnHost = await until(() => { const s = host.seats().find((x) => x.seatNo === 2); return s && s.ready ? true : null; });
  readyOnHost.hit ? ok("(3b) round trip peer->host: the Ready intent tallied on the Node host (" + readyOnHost.ms + " ms)") : bad("(3b) host seats after Ready: " + JSON.stringify(host.seats()));

  /* round trip 2: host -> peer (starting the board puts the card on screen) */
  host.act({ type: "start" });
  const cardShown = await until(() => P.evaluate((q) => { const el2 = document.querySelector(".sg-q"); return el2 && el2.textContent.trim() === q ? true : null; }, cards.rwq1.q));
  cardShown.hit ? ok("(3b) round trip host->peer: the board's card text rendered on the app's own screen (" + cardShown.ms + " ms): \"" + cards.rwq1.q.slice(0, 40) + "...\"") : bad("(3b) card on screen: " + JSON.stringify(await P.evaluate(() => (document.querySelector(".sg-q") || {}).textContent)));

  /* round trip 3: peer -> host (the candidate's own answer intent locks scoring) */
  await P.click("button.sg-answer");
  const lockedOnHost = await until(() => host.state().lock && host.state().lock.kind === "scoring" ? true : null);
  lockedOnHost.hit ? ok("(3b) round trip peer->host: the answer intent locked scoring on the Node host (" + lockedOnHost.ms + " ms)") : bad("(3b) host lock after answer: " + JSON.stringify(host.state().lock));

  /* round trip 4: host -> peer (the reveal comes back down to the same screen) */
  const revealed = await until(() => P.evaluate((a) => { const el2 = document.querySelector(".sg-a"); return el2 && el2.textContent.trim() === a ? true : null; }, cards.rwq1.a));
  revealed.hit ? ok("(3b) round trip host->peer: the doctrinal answer reveal reached the app's own screen (" + revealed.ms + " ms) - a live message has now round-tripped in both directions over src/room-web.js") : bad("(3b) reveal on screen: " + JSON.stringify(await P.evaluate(() => (document.querySelector(".sg-a") || {}).textContent)));

  /* ---------------- (3c) the server drops; network-lost; reconnect against a fresh server ---------------- */
  await srv.close();
  const netLost = await until(() => P.evaluate(() => !!document.querySelector(".sg-terminal[data-kind=network-lost]")), 10000);
  netLost.hit ? ok("(3c) the room server going away shows the network-lost terminal (" + netLost.ms + " ms)") : bad("(3c) no network-lost terminal after the server closed");
  host.close();

  const srv2 = await startRoomServer({ loopback: true, port: srv.port, quiet: true }).catch(async (e) => {
    // the OS may briefly hold the port after close(); a short retry loop, not a fixed sleep
    for (let i = 0; i < 10; i++) { await sleep(300); try { return await startRoomServer({ loopback: true, port: srv.port, quiet: true }); } catch (e2) {} }
    throw e;
  });
  const host2 = nodeHost({ wsBase, room: ROOM, mode: "board", ids, cards, category: "Leadership", name: "NODE-HOST-2", pingMs: 1000, missLimit: 3, holdMs: 8000 });
  await host2.ready;
  ok("(3c) a FRESH room-server + a DIFFERENT Node host reopened the same room code " + ROOM + " on the same address " + wsBase);
  await until(() => P.evaluate(() => !!document.querySelector("button.sg-reconnect")), 5000);
  await P.click("button.sg-reconnect");
  const pending2 = await until(() => host2.pending().find((p) => p.name === "PEER-ONE") || null, 10000);
  pending2.hit ? ok("(3c) \"Try to reconnect\" reopened a fresh WebSocket to the SAME stored target with zero change to reconnect() itself (" + pending2.ms + " ms)") : bad("(3c) reconnect never reached the fresh host: pending " + JSON.stringify(host2.pending()));
  const fp2 = pending2.value ? pending2.value.fp : null;
  host2.act({ type: "admit", fp: fp2 });
  const seated2 = await until(() => P.evaluate(() => { const s = G.studyGroup.session(); return s && s.status === "seated" ? true : null; }));
  seated2.hit ? ok("(3c) re-seated on the fresh host after reconnecting (" + seated2.ms + " ms)") : bad("(3c) not re-seated: " + JSON.stringify(await P.evaluate(() => G.studyGroup.session())));
  await P.evaluate(() => G.studyGroup.leave());
  host2.close();
  await srv2.close();

  /* ---------------- (3d/e/f) secure-link routing + honest refusal (Section 1.3.6) ----------------
     A raw WebSocket constructor spy proves the honest-refusal path NEVER
     attempts one (the doc's own rule: no doomed wss:// attempt, no silent
     ws:// downgrade); a stub window.Capacitor.Plugins.RoomTls proves the
     valid-pin path routes through connect() instead. */
  await P.evaluate(() => {
    window.__wsCallCount = 0;
    window.__RealWS = window.WebSocket;
    window.WebSocket = function (...a) { window.__wsCallCount++; return new window.__RealWS(...a); };
    window.WebSocket.prototype = window.__RealWS.prototype;
  });
  const SECURE_PIN = "ab".repeat(32);

  /* (3d) secure link, NO native capability (plain browser tab - this test's own page never had window.Capacitor) */
  {
    await P.evaluate(() => { try { delete window.Capacitor; } catch (e) { window.Capacitor = undefined; } });
    const link = S.joinUrl("https://198.51.100.5:9443", "CHARLIE-DELTA-01", SECURE_PIN);
    const r = await P.evaluate((l) => window.__GUIDON_ROOM_WEB__.joinAt(l, "PEER-SECURE"), link);
    const wsCount = await P.evaluate(() => window.__wsCallCount);
    (!r.ok && /secure/i.test(r.reason) && /native|Android|GUIDON app/i.test(r.reason) && wsCount === 0)
      ? ok("(3d) a secure join link with NO native TLS capability refuses immediately, no WebSocket ever attempted: \"" + r.reason + "\"")
      : bad("(3d) secure link, no native capability: " + JSON.stringify(r) + " wsCount=" + wsCount);
  }

  /* (3e) native capability present, but the pin is missing/malformed */
  {
    await P.evaluate(() => {
      window.Capacitor = { Plugins: { RoomTls: {
        connect: () => Promise.resolve({ id: "should-not-be-called" }),
        send: () => {}, close: () => {}, addListener: () => {},
      } } };
    });
    const badLink = "https://198.51.100.5:9443/j/ECHO-FOXTROT-02"; // no #pin fragment at all
    const r = await P.evaluate((l) => window.__GUIDON_ROOM_WEB__.joinAt(l, "PEER-SECURE"), badLink);
    const wsCount = await P.evaluate(() => window.__wsCallCount);
    (!r.ok && /pin/i.test(r.reason) && wsCount === 0)
      ? ok("(3e) a secure join link with a missing/malformed pin refuses even WITH native capability present, never dials: \"" + r.reason + "\"")
      : bad("(3e) secure link, native present but bad pin: " + JSON.stringify(r) + " wsCount=" + wsCount);
  }

  /* (3f) native capability present AND a valid pin: routes through RoomTls.connect(), never a raw WebSocket */
  {
    await P.evaluate(() => {
      window.__connectCalls = [];
      window.Capacitor = { Plugins: { RoomTls: {
        connect: (args) => { window.__connectCalls.push(args); return Promise.resolve({ id: "fake-native-1" }); },
        send: () => {}, close: () => {}, addListener: () => {},
      } } };
    });
    const link = S.joinUrl("https://198.51.100.5:9443", "GOLF-HOTEL-03", SECURE_PIN);
    const r = await P.evaluate((l) => window.__GUIDON_ROOM_WEB__.joinAt(l, "PEER-SECURE-2"), link);
    const calls = await P.evaluate(() => window.__connectCalls);
    const wsCount = await P.evaluate(() => window.__wsCallCount);
    (r && r.ok && calls.length === 1 && calls[0].pin === SECURE_PIN && calls[0].url === "wss://198.51.100.5:9443/ws?room=GOLF-HOTEL-03&role=peer" && wsCount === 0)
      ? ok("(3f) a valid secure join link with native capability present routes through RoomTls.connect(" + JSON.stringify(calls[0]) + "), never a raw WebSocket")
      : bad("(3f) secure link routing: r=" + JSON.stringify(r) + " calls=" + JSON.stringify(calls) + " wsCount=" + wsCount);
    await P.evaluate(() => G.studyGroup.leave());
  }

  await P.evaluate(() => { window.WebSocket = window.__RealWS; delete window.__RealWS; try { delete window.Capacitor; } catch (e) { window.Capacitor = undefined; } });

  const total = room1.noise.reduce((n, a) => n + a.length, 0);
  total === 0 ? ok("zero page errors / console errors on the app page") : bad("noise: " + room1.noise.map((a) => a.slice(0, 3)).flat().join(" | "));
} catch (e) {
  bad("suite error: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
} finally {
  if (host) try { host.close(); } catch (e) {}
  if (srv) await srv.close().catch(() => {});
  if (qsrv) await qsrv.close().catch(() => {});
  await closeRoom().catch(() => {});
  await new Promise((r) => appServer.close(r));
}
console.log("\n" + (fails ? `ROOM WEB: ${fails} FAILURE(S)` : "ROOM WEB: all passed"));
process.exit(fails ? 1 : 0);
