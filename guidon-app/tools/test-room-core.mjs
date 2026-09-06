/**
 * Study-room core (collective P3a): the wire schema and the host-
 * authoritative reducer, Node only - no browser, no build. Written BEFORE
 * the modules exist (verifier first): its first run is the RED baseline
 * the modules have to turn green.
 *
 * What is proved:
 *   (a) src/app-modules/room-schema.js loads in Node through the same
 *       globalThis.G guard the app uses (ONE module, no parallel list) and
 *       exposes the protocol constants; validate() accepts a minimal valid
 *       frame of every allowed type and rejects: an unknown type, an
 *       unknown intent kind, a v mismatch, an extra top-level key, a
 *       missing envelope key, an unknown body key, a `grade` key anywhere
 *       in the frame, a malformed room code / fingerprint, and a frame at
 *       or over 4096 bytes.
 *   (b) a property test over the reducer at N=20 seats with a seeded PRNG:
 *       random join / admit / start / leave / late-join / reconnect /
 *       advance / score / kick / tick sequences interleaved with hostile
 *       frames. After EVERY step: seq is monotonic, exactly one host seat,
 *       seat numbers and fingerprints unique, no negative score, every
 *       snapshot frame < 4096 bytes and valid, every effect frame passes
 *       validate, and every frame that carried a grade key or an unknown
 *       type was rejected with the state object untouched.
 *   (c) the peer-side reducer: welcome seats it, an older snapshot is
 *       ignored, a newer one applied, ping answers pong, bye from the host
 *       is the host-left terminal, and nothing applies after a terminal.
 *   (d) cardText rides inline ONLY when a seated peer's bankSig differs.
 *
 * Usage: node tools/test-room-core.mjs   (exit code = number of FAIL lines)
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);

console.log("test-room-core: schema + reducer (Node only)\n");

/* ---------------------------------------------------------------- load */
let schema = null, sg = null;
for (const f of ["src/app-modules/room-schema.js", "src/app-modules/studygroup.js"]) {
  try { await import(pathToFileURL(resolve(f)).href); }
  catch (e) { bad(`load ${f}: ${e.message.split("\n")[0]}`); }
}
schema = globalThis.G && globalThis.G.roomSchema;
sg = globalThis.G && globalThis.G.studyGroup;
if (!schema) bad("G.roomSchema is not defined after loading src/app-modules/room-schema.js");
if (!sg) bad("G.studyGroup is not defined after loading src/app-modules/studygroup.js");
if (!schema || !sg) finish();

const need = ["PROTOCOL_VERSION", "TYPES", "INTENT_KINDS", "ENVELOPE_KEYS", "MAX_FRAME_BYTES", "MAX_SEATS", "NATO", "VERSION_MISMATCH_TEXT", "validate", "bankSig", "roomCode", "isRoomCode", "isFingerprint"];
{
  const missing = need.filter((k) => !(k in schema));
  missing.length === 0 ? ok("G.roomSchema exposes " + need.join(", ")) : bad("G.roomSchema lacks: " + missing.join(", "));
  const pure = ["initHost", "initPeer", "reduce", "act", "snapshotOf", "snapshotFrames", "DEFAULTS"];
  const miss2 = pure.filter((k) => !(k in sg));
  miss2.length === 0 ? ok("G.studyGroup exposes the pure core " + pure.join(", ")) : bad("G.studyGroup lacks: " + miss2.join(", "));
  if (missing.length || miss2.length) finish();
}

const V = schema.PROTOCOL_VERSION;
const ROOM = "ALPHA-BRAVO-42";
const bytes = (o) => Buffer.byteLength(JSON.stringify(o), "utf8");

/* ------------------------------------------------------------ (a) schema */
{
  const expectTypes = ["hello", "admit", "welcome", "snapshot", "intent", "reject", "kick", "ping", "pong", "bye", "end"];
  const t = schema.TYPES.slice().sort().join(",") === expectTypes.slice().sort().join(",");
  t ? ok("(a) TYPES is exactly the locked allowlist: " + expectTypes.join(" ")) : bad("(a) TYPES = " + JSON.stringify(schema.TYPES));
  schema.TYPES.indexOf("grade") === -1 && schema.INTENT_KINDS.indexOf("grade") === -1 ? ok("(a) no grade type and no grade intent kind exist") : bad("(a) a grade type/kind exists");
  const kinds = ["ready", "buzz", "score", "answer", "advance-request"];
  schema.INTENT_KINDS.slice().sort().join(",") === kinds.slice().sort().join(",") ? ok("(a) INTENT_KINDS = " + kinds.join(" ")) : bad("(a) INTENT_KINDS = " + JSON.stringify(schema.INTENT_KINDS));
  schema.ENVELOPE_KEYS.slice().sort().join(",") === "body,from,room,seq,t,v" ? ok("(a) envelope keys are exactly v,t,room,seq,from,body") : bad("(a) ENVELOPE_KEYS = " + JSON.stringify(schema.ENVELOPE_KEYS));
  /* The closed key sets are pinned EXACTLY (design: room-schema.js header,
     "the wire carries what this file names and nothing else"). A key added
     to any of these lists is a wire change: it must fail here first. A
     sorted join is compared, so order changes are free and a missing or
     extra key is not. */
  const sortedJoin = (a) => (Array.isArray(a) ? a.slice().sort().join(",") : "<not an array>");
  const EXPECT_BODY_KEYS = {
    hello: ["name", "bankSig", "resume", "rank", "build", "app"],
    admit: ["pending", "atBoundary"],
    welcome: ["seatNo", "token", "snapshot", "hold"],
    snapshot: ["snapshot"],
    intent: ["kind", "value", "cardId"],
    reject: ["reason"],
    kick: ["seatNo", "reason"],
    ping: ["n"],
    pong: ["n"],
    bye: [],
    end: ["reason"],
  };
  const EXPECT_SNAPSHOT_KEYS = ["phase", "mode", "seq", "room", "hostSeat", "cardId", "cardText", "turnSeat", "lock", "deadline", "round", "seats", "bankSig", "deck"];
  const EXPECT_SEAT_KEYS = ["seatNo", "name", "fp", "score", "online", "ready", "done"];
  {
    const bk = schema.BODY_KEYS || {};
    const typesWithBodies = Object.keys(bk).slice().sort().join(",");
    const expectTypesWithBodies = Object.keys(EXPECT_BODY_KEYS).slice().sort().join(",");
    typesWithBodies === expectTypesWithBodies ? ok("(a) BODY_KEYS names exactly the " + Object.keys(EXPECT_BODY_KEYS).length + " frame types (one closed set each)") : bad("(a) BODY_KEYS types = " + typesWithBodies + ", expected " + expectTypesWithBodies);
    const wrong = Object.keys(EXPECT_BODY_KEYS).filter((t) => sortedJoin(bk[t]) !== sortedJoin(EXPECT_BODY_KEYS[t]));
    wrong.length === 0 ? ok("(a) BODY_KEYS per type is pinned exactly: " + Object.keys(EXPECT_BODY_KEYS).map((t) => t + "[" + EXPECT_BODY_KEYS[t].join(" ") + "]").join(" ")) : bad("(a) BODY_KEYS differ for " + wrong.map((t) => t + "=" + JSON.stringify(bk[t])).join("; "));
    sortedJoin(schema.SNAPSHOT_KEYS) === sortedJoin(EXPECT_SNAPSHOT_KEYS) ? ok("(a) SNAPSHOT_KEYS is pinned exactly: " + EXPECT_SNAPSHOT_KEYS.join(" ")) : bad("(a) SNAPSHOT_KEYS = " + JSON.stringify(schema.SNAPSHOT_KEYS));
    sortedJoin(schema.SEAT_KEYS) === sortedJoin(EXPECT_SEAT_KEYS) ? ok("(a) SEAT_KEYS is pinned exactly: " + EXPECT_SEAT_KEYS.join(" ")) : bad("(a) SEAT_KEYS = " + JSON.stringify(schema.SEAT_KEYS));
    /* Rule 8 at the key-set level: no seat and no snapshot ever carries a
       token or a grade, and no body list names a grade key. */
    const leaks = [].concat(
      (schema.SEAT_KEYS || []).filter((k) => /token|grade/i.test(k)).map((k) => "SEAT_KEYS." + k),
      (schema.SNAPSHOT_KEYS || []).filter((k) => /token|grade/i.test(k)).map((k) => "SNAPSHOT_KEYS." + k),
      Object.keys(bk).flatMap((t) => (bk[t] || []).filter((k) => /grade/i.test(k)).map((k) => "BODY_KEYS." + t + "." + k)));
    leaks.length === 0 ? ok("(a) no key set names a token (outside welcome/hello.resume) or a grade") : bad("(a) leaking keys: " + leaks.join(", "));
  }
  schema.NATO.length === 26 ? ok("(a) NATO alphabet has 26 words") : bad("(a) NATO has " + schema.NATO.length);
  schema.MAX_FRAME_BYTES === 4096 ? ok("(a) MAX_FRAME_BYTES = 4096") : bad("(a) MAX_FRAME_BYTES = " + schema.MAX_FRAME_BYTES);
  schema.MAX_SEATS >= 20 ? ok("(a) MAX_SEATS >= 20 (" + schema.MAX_SEATS + ")") : bad("(a) MAX_SEATS = " + schema.MAX_SEATS);
  schema.isRoomCode(ROOM) && !schema.isRoomCode("alpha-bravo-42") && !schema.isRoomCode("ALPHA-ZZZZ-42") && !schema.isRoomCode("ALPHA-BRAVO-4")
    ? ok("(a) isRoomCode accepts two NATO words + two digits and nothing else") : bad("(a) isRoomCode shape wrong");
  let rc = 0, okc = 0; const rnd = mulberry32(3);
  for (let i = 0; i < 200; i++) { rc++; if (schema.isRoomCode(schema.roomCode(rnd))) okc++; }
  okc === rc ? ok("(a) roomCode() produced 200/200 valid codes") : bad("(a) roomCode() valid " + okc + "/" + rc);
  schema.isFingerprint("ABCDEFGH") && schema.isFingerprint("A2345677") && !schema.isFingerprint("abcdefgh") && !schema.isFingerprint("ABCDEFG1") && !schema.isFingerprint("ABCDEFG8") && !schema.isFingerprint("ABCDEFGHI")
    ? ok("(a) isFingerprint: 8 base32 (A-Z, 2-7) chars only") : bad("(a) isFingerprint shape wrong");
  const sig = schema.bankSig({ board: { version: "0.1.0", questions: new Array(984) } });
  typeof sig === "string" && /984/.test(sig) && /0\.1\.0/.test(sig) && schema.bankSig({ board: { version: "0.1.0", questions: new Array(983) } }) !== sig
    ? ok("(a) bankSig(seed) derives from count + seed version: " + sig) : bad("(a) bankSig = " + JSON.stringify(sig));
  // Agnosticism audit, 6 Sep 2026: board.version alone is a hand-typed
  // literal that never changes on a real content edit (it stayed "0.1.0"
  // across real corpus rewrites this session), so two boards with the SAME
  // count and version but different QUESTION TEXT used to produce an
  // identical bankSig - the exact silent-drift case this signature exists
  // to catch. tools/build.mjs now stamps a real content hash onto the
  // built seed as board.contentHash; bankSig must prefer it over version
  // whenever it's present, and only fall back to version for an unbuilt/
  // synthetic seed (never a real served build, which always carries one).
  const hashA = schema.bankSig({ board: { version: "0.1.0", contentHash: "aaaa1111", questions: new Array(984) } });
  const hashB = schema.bankSig({ board: { version: "0.1.0", contentHash: "bbbb2222", questions: new Array(984) } });
  hashA !== hashB && /aaaa1111/.test(hashA) && /bbbb2222/.test(hashB) && !/0\.1\.0/.test(hashA)
    ? ok("(a) bankSig prefers a real contentHash over the frozen version literal, so same-id content edits are detected: " + hashA + " vs " + hashB)
    : bad("(a) bankSig contentHash precedence: " + JSON.stringify({ hashA, hashB }));

  const snap = { phase: "lobby", mode: "relay", seq: 1, room: ROOM, hostSeat: 1, cardId: null, cardText: null, turnSeat: null, lock: null, deadline: null, round: { idx: 0, total: 0 }, seats: [{ seatNo: 1, name: "HOST", fp: "HOSTHOST", score: 0, online: true, ready: true }], bankSig: sig };
  const bodies = {
    hello: { name: "SGT SNUFFY", bankSig: sig },
    admit: { pending: true },
    welcome: { seatNo: 2, token: "abc", snapshot: snap },
    snapshot: { snapshot: snap },
    intent: { kind: "score", value: 2, cardId: "bq1" },
    reject: { reason: "nope" },
    kick: { seatNo: 2 },
    ping: { n: 1 }, pong: { n: 1 }, bye: {}, end: { reason: "done" },
  };
  const mk = (t, body, extra) => Object.assign({ v: V, t, room: ROOM, seq: 0, from: "ABCDEFGH", body }, extra || {});
  let allOk = true;
  for (const t of schema.TYPES) { const r = schema.validate(mk(t, bodies[t])); if (!r.ok) { allOk = false; bad(`(a) minimal valid ${t} frame rejected: ${r.reason}`); } }
  if (allOk) ok("(a) a minimal valid frame of every allowed type validates");
  for (const k of schema.INTENT_KINDS) {
    const r = schema.validate(mk("intent", k === "score" ? { kind: k, value: 1 } : { kind: k }));
    if (!r.ok) { allOk = false; bad(`(a) intent kind ${k} rejected: ${r.reason}`); }
  }
  const rejects = [
    ["unknown type", mk("grade", { value: 1 })],
    ["unknown intent kind", mk("intent", { kind: "grade", value: 1 })],
    ["v mismatch", mk("hello", bodies.hello, { v: V + 1 })],
    ["extra top-level key", mk("ping", { n: 1 }, { to: "x" })],
    ["missing envelope key", (() => { const f = mk("ping", { n: 1 }); delete f.room; return f; })()],
    ["unknown body key", mk("ping", { n: 1, grade: 2 })],
    ["grade key nested in a snapshot", mk("snapshot", { snapshot: Object.assign({}, snap, { seats: [{ seatNo: 1, name: "H", fp: "HOSTHOST", score: 0, online: true, grade: 2 }] }) })],
    ["grade key nested in welcome body", mk("welcome", { seatNo: 2, token: "t", snapshot: Object.assign({}, snap, { grade: 1 }) })],
    ["bad room code", mk("ping", { n: 1 }, { room: "alpha-bravo-42" })],
    ["bad fingerprint", mk("ping", { n: 1 }, { from: "abc" })],
    ["negative score", mk("intent", { kind: "score", value: -1 })],
    ["non-integer seq", mk("ping", { n: 1 }, { seq: 1.5 })],
    ["name over 24 chars", mk("hello", { name: "X".repeat(25), bankSig: sig })],
    ["oversize frame (>= 4096 bytes)", mk("reject", { reason: "y".repeat(4200) })],
    ["null frame", null],
    ["array frame", []],
    ["string body", mk("bye", "x")],
    // Agnosticism audit, 6 Sep 2026 (F8): cardText.kind is a new optional
    // discriminator - an unrecognized kind must still reject, the same as
    // any other closed-allowlist field on the wire.
    ["cardText with an unrecognized kind", mk("snapshot", { snapshot: Object.assign({}, snap, { cardId: "q1", cardText: { q: "Q", a: "A", kind: "image" } }) })],
  ];
  let rj = true;
  for (const [label, f] of rejects) {
    const r = schema.validate(f);
    if (r.ok) { rj = false; bad(`(a) validate ACCEPTED ${label}`); }
  }
  if (rj) ok("(a) validate rejects all " + rejects.length + " hostile shapes (unknown type/kind, v mismatch, extra/missing/unknown keys, grade anywhere, bad room/fp, negative score, oversize)");
  const vr = schema.validate(mk("hello", bodies.hello, { v: V + 1 }));
  vr.reason === "version" ? ok("(a) v mismatch is reported with reason \"version\" so the host can answer with the reject sentence") : bad("(a) v mismatch reason = " + vr.reason);

  // Agnosticism audit, 6 Sep 2026 (F8): the discriminator is additive, not
  // a breaking change - both an explicit "text" kind and no kind field at
  // all (an older peer's frame, or any frame built before this fix) must
  // still validate cleanly.
  const withKind = schema.validate(mk("snapshot", { snapshot: Object.assign({}, snap, { cardId: "q1", cardText: { q: "Q", a: "A", kind: "text" } }) }));
  const withoutKind = schema.validate(mk("snapshot", { snapshot: Object.assign({}, snap, { cardId: "q1", cardText: { q: "Q", a: "A" } }) }));
  withKind.ok && withoutKind.ok
    ? ok("(a) cardText.kind accepts an explicit \"text\" and tolerates absence (backward compatible)")
    : bad("(a) cardText.kind acceptance: " + JSON.stringify({ withKind, withoutKind }));
}

/* ------------------------------------------------------- (b) property */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function fpFrom(rnd) { let s = ""; for (let i = 0; i < 8; i++) s += B32[Math.floor(rnd() * 32)]; return s; }

{
  const SEED = Number(process.env.ROOM_SEED || 20260904);
  const ROUNDS = Number(process.env.ROOM_ROUNDS || 60);
  const STEPS = Number(process.env.ROOM_STEPS || 400);
  const N = 20;
  let violations = 0, stepsRun = 0, hostile = 0, hostileRejected = 0, accepted = 0, maxSnapBytes = 0, maxSeats = 0, reconnects = 0, lateJoins = 0, expired = 0, inlineText = 0;
  const viol = (m) => { violations++; if (violations <= 12) bad("(b) " + m); };
  const HOST_FP = "HOSTHOST";
  const ids = []; for (let i = 1; i <= 40; i++) ids.push("bq" + i);
  const cards = {}; ids.forEach((id, i) => { cards[id] = { id, category: "Cat " + (i % 3), q: "Question " + i + " ".repeat(50), a: "Answer " + i + " ".repeat(80) }; });

  for (let round = 0; round < ROUNDS; round++) {
    const rnd = mulberry32(SEED + round);
    let now = 1000000;
    let tokenN = 0;
    const ctx = { now: () => now, token: () => "tok" + round + "-" + (++tokenN) + "-" + Math.floor(rnd() * 1e6) };
    const mode = rnd() < 0.5 ? "relay" : "board";
    const sig = "bank:40:0.1.0";
    let state = sg.initHost({ room: ROOM, mode, self: { fp: HOST_FP, name: "HOST" }, bankSig: sig, deck: { category: "Cat 0", ids: ids.slice(0, 6), timerSec: 30, count: 6 }, cards, now });
    const peers = [];
    for (let i = 0; i < N + 6; i++) peers.push({ fp: fpFrom(rnd), name: "P" + i + " " + fpFrom(rnd).slice(0, 4), token: null, sig: rnd() < 0.15 ? "bank:39:0.1.0" : sig });
    let lastSeq = state.seq;
    const mk = (peer, t, body, extra) => Object.assign({ v: V, t, room: ROOM, seq: 0, from: peer.fp, body }, extra || {});
    const check = (label, prev, res, frameWasHostile) => {
      stepsRun++;
      const s = res.state;
      if (s.seq < lastSeq) viol(`${label}: seq went backwards ${lastSeq} -> ${s.seq}`);
      lastSeq = s.seq;
      const hosts = s.seats.filter((x) => x.fp === HOST_FP);
      if (hosts.length !== 1 || hosts[0].seatNo !== s.hostSeat) viol(`${label}: host seats = ${hosts.length}`);
      const nos = new Set(), fps = new Set();
      for (const x of s.seats) {
        if (nos.has(x.seatNo)) viol(`${label}: duplicate seatNo ${x.seatNo}`); nos.add(x.seatNo);
        if (fps.has(x.fp)) viol(`${label}: duplicate fp ${x.fp}`); fps.add(x.fp);
        if (!(x.score >= 0)) viol(`${label}: negative/NaN score on seat ${x.seatNo}: ${x.score}`);
        if (typeof x.token !== "string" || !x.token) viol(`${label}: seat ${x.seatNo} has no token`);
      }
      if (s.seats.length > schema.MAX_SEATS) viol(`${label}: ${s.seats.length} seats > MAX_SEATS`);
      maxSeats = Math.max(maxSeats, s.seats.length);
      for (const e of res.effects || []) {
        const r = schema.validate(e.frame);
        if (!r.ok) viol(`${label}: effect ${e.frame && e.frame.t} to ${e.to} fails validate: ${r.reason}`);
        const b = bytes(e.frame);
        if (b >= schema.MAX_FRAME_BYTES) viol(`${label}: effect ${e.frame.t} is ${b} bytes`);
        if (e.frame.t === "welcome" || e.frame.t === "snapshot") {
          const snap = e.frame.body.snapshot;
          if (snap.seats.some((x) => "token" in x)) viol(`${label}: a token leaked into a broadcast snapshot`);
          if (snap.cardText) inlineText++;
        }
      }
      const frames = sg.snapshotFrames(s);
      for (const e of frames) {
        const r = schema.validate(e.frame);
        if (!r.ok) viol(`${label}: snapshotFrames() frame fails validate: ${r.reason}`);
        const b = bytes(e.frame);
        maxSnapBytes = Math.max(maxSnapBytes, b);
        if (b >= schema.MAX_FRAME_BYTES) viol(`${label}: snapshot frame ${b} bytes (limit ${schema.MAX_FRAME_BYTES})`);
      }
      if (frameWasHostile) {
        hostile++;
        if (res.accepted) viol(`${label}: hostile frame was ACCEPTED`);
        else if (res.state !== prev) viol(`${label}: hostile frame changed the state object`);
        else hostileRejected++;
      }
      if (res.accepted) accepted++;
    };
    const seated = () => state.seats.filter((x) => x.fp !== HOST_FP);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    /* Fill phase: N-1 peers hello + admit in the lobby so every round starts
       at the full N seats (the snapshot size is measured there), then the
       random walk below churns the room. */
    for (let i = 0; i < N - 1; i++) {
      const p = peers[i];
      let res = sg.reduce(state, mk(p, "hello", { name: p.name, bankSig: p.sig }), ctx);
      check("fill hello " + i, state, res, false); state = res.state;
      res = sg.act(state, { type: "admit", fp: p.fp }, ctx);
      for (const e of res.effects) if (e.frame.t === "welcome" && e.to === p.fp) p.token = e.frame.body.token;
      check("fill admit " + i, state, res, false); state = res.state;
    }
    if (state.seats.length !== N) viol(`fill phase reached ${state.seats.length} seats, not ${N}`);
    for (let step = 0; step < STEPS; step++) {
      const r = rnd();
      const prev = state;
      let res, label, hostileFrame = false;
      if (r < 0.14) {
        const p = pick(peers);
        label = "hello " + p.fp;
        res = sg.reduce(state, mk(p, "hello", { name: p.name, bankSig: p.sig }), ctx);
        for (const e of res.effects) if (e.frame.t === "welcome" && e.to === p.fp) p.token = e.frame.body.token;
      } else if (r < 0.19) {
        hostileFrame = true;
        const p = pick(peers);
        const kind = Math.floor(rnd() * 6);
        const f = kind === 0 ? mk(p, "grade", { value: 1 })
          : kind === 1 ? mk(p, "intent", { kind: "score", value: 1, grade: 2 })
          : kind === 2 ? mk(p, "intent", { kind: "grade" })
          : kind === 3 ? mk(p, "ping", { n: 1 }, { grade: 1 })
          : kind === 4 ? mk(p, "hello", { name: p.name, bankSig: p.sig }, { v: V + 1 })
          : mk(p, "snapshot", { snapshot: { grade: 1 } });
        label = "hostile#" + kind;
        res = sg.reduce(state, f, ctx);
        if (kind === 4) {
          const rej = res.effects.find((e) => e.frame.t === "reject" && e.to === p.fp);
          if (!rej || rej.frame.body.reason !== schema.VERSION_MISMATCH_TEXT) viol(`${label}: v mismatch did not produce reject "${schema.VERSION_MISMATCH_TEXT}"`);
        }
      } else if (r < 0.30) {
        const pend = state.pending || [];
        if (pend.length) {
          const p = pick(pend);
          label = "admit " + p.fp;
          res = sg.act(state, { type: "admit", fp: p.fp }, ctx);
          if (state.phase === "play") lateJoins++;
          for (const e of res.effects) if (e.frame.t === "welcome") { const pp = peers.find((x) => x.fp === e.to); if (pp) pp.token = e.frame.body.token; }
        } else { label = "admit none"; res = sg.act(state, { type: "admit", fp: "NOPE" }, ctx); }
      } else if (r < 0.36) {
        label = "start"; res = sg.act(state, { type: "start" }, ctx);
      } else if (r < 0.58) {
        const p = pick(peers);
        const kinds = ["ready", "score", "answer", "advance-request", "buzz"];
        const k = pick(kinds);
        const body = k === "score" ? { kind: k, value: Math.floor(rnd() * 4), cardId: state.cardId || undefined } : { kind: k };
        if (body.cardId === undefined) delete body.cardId;
        label = "intent " + k + " from " + p.fp;
        res = sg.reduce(state, mk(p, "intent", body), ctx);
      } else if (r < 0.64) {
        const s = seated();
        if (s.length) { const x = pick(s); label = "bye " + x.fp; res = sg.reduce(state, mk({ fp: x.fp }, "bye", {}), ctx); }
        else { label = "bye none"; res = sg.reduce(state, mk(pick(peers), "bye", {}), ctx); }
      } else if (r < 0.72) {
        const held = peers.filter((p) => p.token && state.seats.some((x) => x.token === p.token));
        if (held.length) {
          const p = pick(held);
          label = "reconnect " + p.fp;
          res = sg.reduce(state, mk(p, "hello", { name: p.name, bankSig: p.sig, resume: p.token }), ctx);
          const w = res.effects.find((e) => e.frame.t === "welcome" && e.to === p.fp);
          if (!w) viol(`${label}: resume with a valid token got no welcome`);
          else { reconnects++; if (w.frame.body.token !== p.token) viol(`${label}: resume handed out a different token`); }
        } else { label = "reconnect bad token"; res = sg.reduce(state, mk(pick(peers), "hello", { name: "X", bankSig: sig, resume: "bogus" }), ctx); }
      } else if (r < 0.82) {
        const dt = Math.floor(rnd() * 40000);
        now += dt;
        label = "tick +" + dt;
        const before = state.seats.length;
        res = sg.act(state, { type: "tick" }, ctx);
        if (res.state.seats.length < before) expired += before - res.state.seats.length;
      } else if (r < 0.90) {
        label = "advance"; res = sg.act(state, { type: "advance" }, ctx);
      } else if (r < 0.94) {
        const s = seated();
        if (s.length) { const x = pick(s); label = "kick " + x.seatNo; res = sg.act(state, { type: "kick", seatNo: x.seatNo }, ctx); }
        else { label = "kick none"; res = sg.act(state, { type: "kick", seatNo: 99 }, ctx); }
      } else if (r < 0.96) {
        hostileFrame = true;
        label = "extra top-level key";
        res = sg.reduce(state, mk(pick(peers), "ping", { n: 1 }, { to: "x" }), ctx);
      } else if (r < 0.98) {
        const p = pick(peers); label = "ping from " + p.fp;
        res = sg.reduce(state, mk(p, "ping", { n: step }), ctx);
        if (state.seats.some((x) => x.fp === p.fp && x.online) && !res.effects.some((e) => e.frame.t === "pong" && e.to === p.fp)) viol(`${label}: seated peer's ping got no pong`);
      } else {
        const p = pick(peers); label = "pong from " + p.fp;
        res = sg.reduce(state, mk(p, "pong", { n: step }), ctx);
      }
      if (!res || !res.state) { viol(label + ": reducer returned nothing"); break; }
      check(label, prev, res, hostileFrame);
      state = res.state;
      if (state.phase === "ended") break;
    }
    if (round === 0) info(`round 0 (${mode}): ended at seq ${state.seq}, phase ${state.phase}, ${state.seats.length} seats, ${(state.pending || []).length} pending`);
  }
  violations === 0
    ? ok(`(b) ${ROUNDS} rounds x <=${STEPS} steps (${stepsRun} steps, seed ${SEED}): seq monotonic, one host, unique seats/fps, no negative scores, every effect valid; max seats ${maxSeats}, max snapshot ${maxSnapBytes} bytes (< ${schema.MAX_FRAME_BYTES})`)
    : bad(`(b) ${violations} invariant violation(s) over ${stepsRun} steps (first 12 listed above)`);
  hostile > 0 && hostileRejected === hostile ? ok(`(b) all ${hostile} hostile frames (grade key / unknown type / v mismatch / extra key) rejected with the state object untouched`) : bad(`(b) hostile frames: ${hostileRejected}/${hostile} rejected`);
  reconnects > 0 ? ok(`(b) ${reconnects} resume-token reconnects re-seated with the same token`) : bad("(b) no reconnect ever exercised");
  lateJoins > 0 ? ok(`(b) ${lateJoins} admits during play (seated at the next boundary)`) : bad("(b) no late join exercised");
  expired > 0 ? ok(`(b) ${expired} held seats expired after the hold window on tick`) : bad("(b) no seat hold ever expired");
  maxSeats >= N ? ok(`(b) the room reached ${maxSeats} seats (N=${N})`) : bad(`(b) the room never reached ${N} seats (max ${maxSeats})`);
  inlineText > 0 ? ok(`(d) cardText rode inline in ${inlineText} snapshot(s) while a seated peer's bankSig differed`) : bad("(d) cardText never went inline although some peers had a different bankSig");
  accepted > 0 ? info(`(b) ${accepted} accepted operations`) : bad("(b) nothing was ever accepted");
}

/* (d) precise: inline only when a seat's bankSig differs. */
{
  const now = 5000;
  const ctx = { now: () => now, token: () => "t" + Math.random() };
  const ids = ["bq1", "bq2"];
  const cards = { bq1: { id: "bq1", category: "C", q: "Q1", a: "A1" }, bq2: { id: "bq2", category: "C", q: "Q2", a: "A2" } };
  let st = sg.initHost({ room: ROOM, mode: "board", self: { fp: "HOSTHOST", name: "H" }, bankSig: "bank:2:1", deck: { category: "C", ids, timerSec: null, count: 2 }, cards, now });
  const mk = (fp, t, body) => ({ v: V, t, room: ROOM, seq: 0, from: fp, body });
  st = sg.reduce(st, mk("AAAAAAAA", "hello", { name: "same", bankSig: "bank:2:1" }), ctx).state;
  st = sg.act(st, { type: "admit", fp: "AAAAAAAA" }, ctx).state;
  st = sg.act(st, { type: "start" }, ctx).state;
  const s1 = sg.snapshotOf(st);
  s1.cardId === "bq1" && s1.cardText == null ? ok("(d) same bankSig on every seat: card id only, no inline text") : bad("(d) same-sig snapshot: " + JSON.stringify({ cardId: s1.cardId, cardText: s1.cardText }));
  st = sg.reduce(st, mk("BBBBBBBB", "hello", { name: "other", bankSig: "bank:1:1" }), ctx).state;
  st = sg.act(st, { type: "admit", fp: "BBBBBBBB" }, ctx).state;
  st = sg.act(st, { type: "advance" }, ctx).state;
  const s2 = sg.snapshotOf(st);
  s2.cardId === "bq2" && s2.cardText && s2.cardText.q === "Q2" ? ok("(d) a seated peer with a different bankSig: the card text rides inline with the id") : bad("(d) differing-sig snapshot: " + JSON.stringify({ cardId: s2.cardId, cardText: s2.cardText }));
}

/* ------------------------------------------------------------ (c) peer */
{
  const now = 9000;
  const ctx = { now: () => now, token: () => "x" };
  let st = sg.initPeer({ self: { fp: "PEERPEER", name: "P" }, bankSig: "b", room: ROOM, now });
  const mk = (t, body, extra) => Object.assign({ v: V, t, room: ROOM, seq: 3, from: "HOSTHOST", body }, extra || {});
  const snap = (seq) => ({ phase: "play", mode: "relay", seq, room: ROOM, hostSeat: 1, cardId: null, cardText: null, turnSeat: 2, lock: null, deadline: null, round: { idx: 0, total: 0 }, seats: [{ seatNo: 1, name: "H", fp: "HOSTHOST", score: 0, online: true, ready: true }, { seatNo: 2, name: "P", fp: "PEERPEER", score: 0, online: true, ready: false }], bankSig: "b" });
  let r = sg.reduce(st, mk("snapshot", { snapshot: snap(5) }), ctx);
  !r.accepted && r.state === st ? ok("(c) a snapshot before welcome is ignored (an unadmitted peer never applies one)") : bad("(c) unadmitted peer applied a snapshot");
  r = sg.reduce(st, mk("admit", { pending: true }), ctx);
  r.accepted && r.state.joinState === "pending" ? ok("(c) admit{pending} puts the peer in the pending state") : bad("(c) admit ack: " + JSON.stringify({ accepted: r.accepted, joinState: r.state.joinState }));
  st = r.state;
  r = sg.reduce(st, mk("welcome", { seatNo: 2, token: "tok-2", snapshot: snap(5) }), ctx);
  st = r.state;
  st.self.seatNo === 2 && st.self.token === "tok-2" && st.seq === 5 && st.joinState === "seated" ? ok("(c) welcome seats the peer (seat 2, token kept, seq 5)") : bad("(c) after welcome: " + JSON.stringify({ seatNo: st.self.seatNo, token: st.self.token, seq: st.seq, joinState: st.joinState }));
  r = sg.reduce(st, mk("snapshot", { snapshot: snap(4) }), ctx);
  !r.accepted && r.state.seq === 5 ? ok("(c) an older snapshot (seq 4 < 5) is ignored") : bad("(c) older snapshot applied: seq " + r.state.seq);
  r = sg.reduce(st, mk("snapshot", { snapshot: snap(7) }), ctx);
  r.accepted && r.state.seq === 7 ? ok("(c) a newer snapshot (seq 7) is applied") : bad("(c) newer snapshot: " + JSON.stringify({ accepted: r.accepted, seq: r.state.seq }));
  st = r.state;
  r = sg.reduce(st, mk("ping", { n: 4 }), ctx);
  r.effects.some((e) => e.frame.t === "pong" && e.frame.body.n === 4) ? ok("(c) ping answers pong with the same n") : bad("(c) ping effects: " + JSON.stringify(r.effects));
  r = sg.reduce(st, mk("snapshot", { snapshot: snap(9) }, { from: "STRANGER" }), ctx);
  !r.accepted ? ok("(c) a snapshot from a fingerprint other than the host's is ignored") : bad("(c) stranger snapshot applied");
  r = sg.reduce(st, mk("intent", { kind: "score", value: 1, grade: 3 }), ctx);
  !r.accepted && r.state === st ? ok("(c) a frame with a grade key is rejected on the peer side too") : bad("(c) peer accepted a grade key");
  r = sg.reduce(st, mk("bye", {}), ctx);
  r.state.terminal && r.state.terminal.kind === "host-left" ? ok("(c) bye from the host is the host-left terminal state") : bad("(c) after bye: " + JSON.stringify(r.state.terminal));
  st = r.state;
  r = sg.reduce(st, mk("snapshot", { snapshot: snap(11) }), ctx);
  !r.accepted && r.state.seq === 7 ? ok("(c) nothing applies after a terminal state (snapshot seq 11 ignored)") : bad("(c) post-terminal snapshot applied");
  let st2 = sg.initPeer({ self: { fp: "PEERPEER", name: "P" }, bankSig: "b", room: ROOM, now });
  r = sg.reduce(st2, mk("reject", { reason: schema.VERSION_MISMATCH_TEXT }), ctx);
  r.state.terminal && r.state.terminal.kind === "rejected" && r.state.terminal.reason === schema.VERSION_MISMATCH_TEXT ? ok("(c) reject carries its reason into the rejected terminal state") : bad("(c) reject: " + JSON.stringify(r.state.terminal));
  st2 = sg.initPeer({ self: { fp: "PEERPEER", name: "P" }, bankSig: "b", room: ROOM, now });
  st2 = sg.reduce(st2, mk("welcome", { seatNo: 2, token: "t", snapshot: snap(1) }), ctx).state;
  const lateNow = now + sg.DEFAULTS.pingMs * sg.DEFAULTS.missLimit + 1;
  r = sg.act(st2, { type: "tick" }, { now: () => lateNow, token: () => "x" });
  r.state.terminal && r.state.terminal.kind === "network-lost" ? ok(`(c) ${sg.DEFAULTS.missLimit} missed pings (${sg.DEFAULTS.pingMs} ms each) is the network-lost terminal`) : bad("(c) missed pings: " + JSON.stringify(r.state.terminal));
  sg.DEFAULTS.holdMs === 60000 ? ok("(c) DEFAULTS.holdMs is 60 s (seat hold)") : bad("(c) DEFAULTS.holdMs = " + sg.DEFAULTS.holdMs);
}

/* (e) the seat hold is a WINDOW, measured against the host's configured
   holdMs with a controlled clock: a seat that misses its pings is kept
   (offline) for the whole window, a resume 1 ms before the window closes
   re-seats it with the same token, and a seat still offline 1 ms after the
   window closes is dropped. Added by the P3a verification pass: the
   original suites let a holdMs of 0 through because every reconnect they
   exercised landed inside a single tick. */
{
  const HOLD = 8000, PINGMS = 1000, MISS = 3;
  let t = 100000;
  const ctx = { now: () => t, token: () => "hold-tok" };
  const mk = (t2, body) => ({ v: V, t: t2, room: ROOM, seq: 0, from: "HELDPEER", body });
  let st = sg.initHost({ room: ROOM, mode: "relay", self: { fp: "HOSTHOST", name: "H" }, bankSig: "b", deck: { ids: [], count: 0 }, cards: {}, now: t, holdMs: HOLD, pingMs: PINGMS, missLimit: MISS });
  st.cfg.holdMs === HOLD ? ok(`(e) initHost({ holdMs: ${HOLD} }) is applied to cfg.holdMs`) : bad("(e) cfg.holdMs = " + st.cfg.holdMs + " (asked for " + HOLD + ")");
  st = sg.reduce(st, mk("hello", { name: "P", bankSig: "b" }), ctx).state;
  const adm = sg.act(st, { type: "admit", fp: "HELDPEER" }, ctx); st = adm.state;
  const tok = (adm.effects.find((e) => e.frame.t === "welcome") || { frame: { body: {} } }).frame.body.token;
  t += PINGMS * MISS + 1;
  st = sg.act(st, { type: "tick" }, ctx).state;
  const held = st.seats.find((x) => x.fp === "HELDPEER");
  held && !held.online && held.offlineAt === t ? ok(`(e) ${MISS} missed pings: the seat is marked offline and KEPT (offlineAt stamped)`) : bad("(e) after the miss window: " + JSON.stringify(held));
  t += HOLD - 1;
  st = sg.act(st, { type: "tick" }, ctx).state;
  const still = st.seats.find((x) => x.fp === "HELDPEER");
  still && !still.online ? ok(`(e) ${HOLD - 1} ms into the hold the seat is still held`) : bad("(e) the seat was dropped INSIDE the hold window (holdMs " + st.cfg.holdMs + "): " + JSON.stringify(still));
  const back = sg.reduce(st, mk("hello", { name: "P", bankSig: "b", resume: tok }), ctx);
  const w = back.effects.find((e) => e.frame.t === "welcome");
  w && w.frame.body.token === tok && back.state.seats.find((x) => x.fp === "HELDPEER").online ? ok("(e) a resume 1 ms before the window closes re-seats the SAME seat with the SAME token") : bad("(e) resume at hold-1 ms: " + JSON.stringify({ reason: back.reason, welcome: !!w }));
  st = back.state;
  t += PINGMS * MISS + 1;
  st = sg.act(st, { type: "tick" }, ctx).state;
  t += HOLD + 1;
  st = sg.act(st, { type: "tick" }, ctx).state;
  !st.seats.some((x) => x.fp === "HELDPEER") ? ok(`(e) still offline ${HOLD + 1} ms after going offline: the seat is dropped`) : bad("(e) the seat survived past the hold window");
  const late = sg.reduce(st, mk("hello", { name: "P", bankSig: "b", resume: tok }), ctx);
  !late.effects.some((e) => e.frame.t === "welcome") && late.state.pending.some((p) => p.fp === "HELDPEER") ? ok("(e) a resume after the window closed is a fresh join (pending, no welcome)") : bad("(e) post-window resume: " + JSON.stringify({ reason: late.reason, effects: late.effects.map((e) => e.frame.t) }));
}

finish();

function finish() {
  console.log("\n" + (fails ? `ROOM CORE: ${fails} FAILURE(S)` : "ROOM CORE: all passed"));
  process.exit(fails ? 1 : 0);
}
