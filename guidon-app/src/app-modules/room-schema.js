/* ==== js/room-schema.js ==== */
/* GUIDON - room-schema.js : the ONE source of the study-room wire protocol
   (G.roomSchema). Collective roadmap P3a (desktop roadmap Q1-Q13 + the
   pairings review, locked 2026-09-04).

   Everything that puts a frame on the wire or takes one off it reads THIS
   object and nothing else: the room module (src/app-modules/studygroup.js,
   both host and peer sides), the fake transport in tools/room-harness.mjs,
   the test-process relay, the room server (tools/room-server.mjs), the
   Node-side host/peer stand-ins (tools/room-node-host.mjs), the guest
   page (dist/guest.html, built from src/guest.html) and every suite. There is no second list of message types, no
   second frame shape and no second protocol version anywhere - a change
   here IS the protocol change, and tools/test-room-core.mjs pins the
   locked allowlist so it cannot drift by accident.

   The frame (envelope) is exactly these six keys, no more, no fewer:

     { v: 1, t: "<type>", room: "<ALPHA-BRAVO-42>", seq: <int>, from: "<8 base32>", body: { ... } }

   TYPES (the allowlist, Q-locked): hello, admit, welcome, snapshot, intent,
   reject, kick, ping, pong, bye, end. Unknown t -> ignored by every
   receiver. A v mismatch on a hello -> reject "update GUIDON on one
   device" (VERSION_MISMATCH_TEXT below is the sentence every fork shows).
   INTENT_KINDS: ready, buzz (reserved, not built in P3), score, answer,
   advance-request. There is NO grade intent and no `grade` key is ever
   accepted anywhere in a frame - validate() walks the whole frame for one
   (rule 8: nothing derived from another person is ever written, and no
   frame ever carries a spaced-repetition grade in either direction).

   Per-type body keys are closed sets too (BODY_KEYS): an unknown key in a
   body is a reject, exactly like an extra top-level key - the wire carries
   what this file names and nothing else.

   Protocol compatibility is NOT build identity (P3b, X6): two builds with
   different shas but the same PROTOCOL_VERSION must interoperate, so the
   version stays the integer above, while a hello ALSO carries the stamped
   build sha and app version as informational fields (hello.build,
   hello.app - display only, never trusted, never persisted) so the skew
   message (skewText) can name both sides around the one locked sentence.
   welcome.hold tells a seated peer the host's seat-hold window in seconds
   so its network-lost panel names the real number.

   A frame never names its destination (the envelope above is closed), so a
   SOCKET carries the relay envelope wireEncode(frame, to) =
   {"to": <fingerprint | "*" | null>, "f": <frame>} - peers send to null
   (the relay routes to the host), the host names a fingerprint or "*".
   ENDPOINTS / wsUrl / joinUrl name the room server's paths once.

   Size: a whole serialized frame must be under MAX_FRAME_BYTES (4096) -
   the full-state snapshot for 8 seats is designed to fit with room to
   spare (tools/test-room-core.mjs measures it at 20 seats).

   Runs in the app as a classic <script> (tools/build.mjs splices every
   src/app-modules/*.js into BOTH builds) and in Node: the root is
   `window` in a page and `globalThis` otherwise, so a tool can simply
   `import "../src/app-modules/room-schema.js"` and read globalThis.G
   .roomSchema. No import/export syntax, no DOM, no timers - pure data and
   pure functions. */
(function (root) {
  "use strict";
  root.G = root.G || {};

  var PROTOCOL_VERSION = 1;
  var TYPES = ["hello", "admit", "welcome", "snapshot", "intent", "reject", "kick", "ping", "pong", "bye", "end"];
  var INTENT_KINDS = ["ready", "buzz", "score", "answer", "advance-request"];
  var ENVELOPE_KEYS = ["v", "t", "room", "seq", "from", "body"];
  /* Closed key sets per body. hello.resume is the seat-hold token handed
     out in welcome; hello.rank is optional display only. */
  var BODY_KEYS = {
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
  var REQUIRED_BODY_KEYS = {
    hello: ["name", "bankSig"], admit: ["pending"], welcome: ["seatNo", "token", "snapshot"], snapshot: ["snapshot"],
    intent: ["kind"], reject: ["reason"], kick: ["seatNo"], ping: ["n"], pong: ["n"], bye: [], end: [],
  };
  /* The public snapshot (host-authoritative full state). seats[] entries
     carry SEAT_KEYS only - never a token, never anything a device stores. */
  var SNAPSHOT_KEYS = ["phase", "mode", "seq", "room", "hostSeat", "cardId", "cardText", "turnSeat", "lock", "deadline", "round", "seats", "bankSig", "deck"];
  var SEAT_KEYS = ["seatNo", "name", "fp", "score", "online", "ready", "done"];
  var PHASES = ["lobby", "play", "recap", "ended"];
  var MODES = ["relay", "board"];
  var MAX_FRAME_BYTES = 4096;
  var MAX_NAME = 24;
  var MAX_SEATS = 20;
  var MAX_SCORE = 999;
  var MAX_TOKEN = 48;
  var MAX_REASON = 160;
  var MAX_TEXT = 1500;
  var MAX_ID = 40;
  var MAX_BUILD = 40;
  var MAX_APP = 24;
  var MAX_WIRE_BYTES = MAX_FRAME_BYTES + 64;
  var ENDPOINTS = { ws: "/ws", join: "/j/", guest: "/" };
  var VERSION_MISMATCH_TEXT = "update GUIDON on one device";
  var NATO = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL", "INDIA", "JULIET", "KILO", "LIMA", "MIKE",
    "NOVEMBER", "OSCAR", "PAPA", "QUEBEC", "ROMEO", "SIERRA", "TANGO", "UNIFORM", "VICTOR", "WHISKEY", "XRAY", "YANKEE", "ZULU"];
  var FP_RE = /^[A-Z2-7]{8}$/;
  var ROOM_RE = /^([A-Z]+)-([A-Z]+)-([0-9]{2})$/;

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function isInt(x, min, max) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x && x >= min && x <= max; }
  function isStr(x, max) { return typeof x === "string" && x.length <= max; }
  function isFingerprint(s) { return typeof s === "string" && FP_RE.test(s); }
  function isRoomCode(s) {
    if (typeof s !== "string") return false;
    var m = ROOM_RE.exec(s);
    return !!m && NATO.indexOf(m[1]) !== -1 && NATO.indexOf(m[2]) !== -1;
  }
  function byteLength(s) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(s).length;
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
    }
    return n;
  }
  /* True when a key named `key` exists anywhere in the value tree. */
  function hasKeyDeep(v, key, depth) {
    if (depth > 12 || !v || typeof v !== "object") return false;
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) if (hasKeyDeep(v[i], key, depth + 1)) return true; return false; }
    for (var k in v) { if (k === key) return true; if (hasKeyDeep(v[k], key, depth + 1)) return true; }
    return false;
  }
  function onlyKeys(obj, allowed) {
    for (var k in obj) if (allowed.indexOf(k) === -1) return k;
    return null;
  }

  function validateSeat(s) {
    if (!isObj(s)) return "seat";
    var extra = onlyKeys(s, SEAT_KEYS);
    if (extra) return "seat-key:" + extra;
    if (!isInt(s.seatNo, 1, 9999)) return "seat-no";
    if (!isStr(s.name, MAX_NAME)) return "seat-name";
    if (!isFingerprint(s.fp)) return "seat-fp";
    if (!isInt(s.score, 0, 1e9)) return "seat-score";
    if (typeof s.online !== "boolean") return "seat-online";
    if ("ready" in s && typeof s.ready !== "boolean") return "seat-ready";
    if ("done" in s && typeof s.done !== "boolean") return "seat-done";
    return null;
  }
  function validateSnapshot(s) {
    if (!isObj(s)) return "snapshot";
    var extra = onlyKeys(s, SNAPSHOT_KEYS);
    if (extra) return "snapshot-key:" + extra;
    if (PHASES.indexOf(s.phase) === -1) return "snapshot-phase";
    if (MODES.indexOf(s.mode) === -1) return "snapshot-mode";
    if (!isInt(s.seq, 0, 1e12)) return "snapshot-seq";
    if (!isRoomCode(s.room)) return "snapshot-room";
    if (!isInt(s.hostSeat, 1, 9999)) return "snapshot-host";
    if (s.cardId != null && !isStr(s.cardId, MAX_ID)) return "snapshot-card";
    if (s.cardText != null) {
      if (!isObj(s.cardText)) return "snapshot-text";
      var tx = onlyKeys(s.cardText, ["q", "a", "category"]);
      if (tx) return "snapshot-text-key:" + tx;
      if (!isStr(s.cardText.q, MAX_TEXT) || !isStr(s.cardText.a, MAX_TEXT)) return "snapshot-text-size";
      if ("category" in s.cardText && !isStr(s.cardText.category, 80)) return "snapshot-text-cat";
    }
    if (s.turnSeat != null && !isInt(s.turnSeat, 1, 9999)) return "snapshot-turn";
    if (s.lock != null) {
      if (!isObj(s.lock)) return "snapshot-lock";
      var lk = onlyKeys(s.lock, ["kind", "scored", "advance"]);
      if (lk) return "snapshot-lock-key:" + lk;
      if (!isStr(s.lock.kind, 20)) return "snapshot-lock-kind";
      if ("scored" in s.lock) {
        if (!Array.isArray(s.lock.scored) || s.lock.scored.length > MAX_SEATS) return "snapshot-lock-scored";
        for (var i = 0; i < s.lock.scored.length; i++) if (!isInt(s.lock.scored[i], 1, 9999)) return "snapshot-lock-scored";
      }
      if ("advance" in s.lock && typeof s.lock.advance !== "boolean") return "snapshot-lock-advance";
    }
    if (s.deadline != null && !isInt(s.deadline, 0, 1e14)) return "snapshot-deadline";
    if (s.round != null) {
      if (!isObj(s.round)) return "snapshot-round";
      var rk = onlyKeys(s.round, ["idx", "total"]);
      if (rk) return "snapshot-round-key:" + rk;
      if (!isInt(s.round.idx, 0, 9999) || !isInt(s.round.total, 0, 9999)) return "snapshot-round-n";
    }
    if (s.deck != null) {
      if (!isObj(s.deck)) return "snapshot-deck";
      var dk = onlyKeys(s.deck, ["category", "timerSec"]);
      if (dk) return "snapshot-deck-key:" + dk;
      if (s.deck.category != null && !isStr(s.deck.category, 80)) return "snapshot-deck-cat";
      if (s.deck.timerSec != null && !isInt(s.deck.timerSec, 1, 3600)) return "snapshot-deck-timer";
    }
    if (!Array.isArray(s.seats) || s.seats.length > MAX_SEATS) return "snapshot-seats";
    for (var j = 0; j < s.seats.length; j++) { var e = validateSeat(s.seats[j]); if (e) return e; }
    if ("bankSig" in s && !isStr(s.bankSig, 48)) return "snapshot-sig";
    return null;
  }

  function validateBody(t, b) {
    if (!isObj(b)) return "body";
    var extra = onlyKeys(b, BODY_KEYS[t]);
    if (extra) return "body-key:" + extra;
    var req = REQUIRED_BODY_KEYS[t];
    for (var i = 0; i < req.length; i++) if (!(req[i] in b)) return "body-missing:" + req[i];
    switch (t) {
      case "hello":
        if (!isStr(b.name, MAX_NAME) || !b.name.length) return "name";
        if (!isStr(b.bankSig, 48)) return "bankSig";
        if ("resume" in b && !isStr(b.resume, MAX_TOKEN)) return "resume";
        if ("rank" in b && !isStr(b.rank, 8)) return "rank";
        if ("build" in b && !isStr(b.build, MAX_BUILD)) return "build";
        if ("app" in b && !isStr(b.app, MAX_APP)) return "app";
        return null;
      case "admit":
        if (typeof b.pending !== "boolean") return "pending";
        if ("atBoundary" in b && typeof b.atBoundary !== "boolean") return "atBoundary";
        return null;
      case "welcome":
        if (!isInt(b.seatNo, 1, 9999)) return "seatNo";
        if (!isStr(b.token, MAX_TOKEN) || !b.token.length) return "token";
        if ("hold" in b && !isInt(b.hold, 1, 3600)) return "hold";
        return validateSnapshot(b.snapshot);
      case "snapshot":
        return validateSnapshot(b.snapshot);
      case "intent":
        if (INTENT_KINDS.indexOf(b.kind) === -1) return "kind";
        if ("value" in b && !isInt(b.value, 0, MAX_SCORE)) return "value";
        if (b.kind === "score" && !("value" in b)) return "body-missing:value";
        if ("cardId" in b && !isStr(b.cardId, MAX_ID)) return "cardId";
        return null;
      case "reject":
        return isStr(b.reason, MAX_REASON) ? null : "reason";
      case "kick":
        if (!isInt(b.seatNo, 1, 9999)) return "seatNo";
        if ("reason" in b && !isStr(b.reason, MAX_REASON)) return "reason";
        return null;
      case "ping": case "pong":
        return isInt(b.n, 0, 1e12) ? null : "n";
      case "bye":
        return null;
      case "end":
        if ("reason" in b && !isStr(b.reason, MAX_REASON)) return "reason";
        return null;
    }
    return "type";
  }

  /** validate(frame) -> { ok, reason }. reason "version" is the one the
      host answers with a reject frame; every other reason is silent. */
  function validate(frame) {
    if (!isObj(frame)) return { ok: false, reason: "frame" };
    for (var i = 0; i < ENVELOPE_KEYS.length; i++) if (!(ENVELOPE_KEYS[i] in frame)) return { ok: false, reason: "missing:" + ENVELOPE_KEYS[i] };
    var extra = onlyKeys(frame, ENVELOPE_KEYS);
    if (extra) return { ok: false, reason: "extra:" + extra };
    if (frame.v !== PROTOCOL_VERSION) return { ok: false, reason: "version" };
    if (TYPES.indexOf(frame.t) === -1) return { ok: false, reason: "type" };
    if (!isRoomCode(frame.room)) return { ok: false, reason: "room" };
    if (!isInt(frame.seq, 0, 1e12)) return { ok: false, reason: "seq" };
    if (!isFingerprint(frame.from)) return { ok: false, reason: "from" };
    if (hasKeyDeep(frame, "grade", 0)) return { ok: false, reason: "grade" };
    var b = validateBody(frame.t, frame.body);
    if (b) return { ok: false, reason: b };
    var json;
    try { json = JSON.stringify(frame); } catch (e) { return { ok: false, reason: "json" }; }
    if (typeof json !== "string" || byteLength(json) >= MAX_FRAME_BYTES) return { ok: false, reason: "size" };
    return { ok: true, reason: "" };
  }

  /** bankSig(seed): what "the same question bank" means on the wire -
      card count + the seed's board version. Two devices with equal sigs
      exchange card ids only; a differing sig makes the host inline the
      card text. Accepts the whole GUIDON_SEED or its board object. */
  function bankSig(seed) {
    var board = seed && seed.board ? seed.board : seed;
    var qs = board && Array.isArray(board.questions) ? board.questions : [];
    var ver = board && board.version != null ? String(board.version) : "0";
    return "bank:" + qs.length + ":" + ver.replace(/[^0-9A-Za-z.-]/g, "");
  }

  /** roomCode(rand): two NATO words + two digits, e.g. "ALPHA-BRAVO-42".
      rand is an optional () -> [0,1) so a suite can seed it. */
  function roomCode(rand) {
    var r = typeof rand === "function" ? rand : Math.random;
    var a = NATO[Math.floor(r() * NATO.length)];
    var b = NATO[Math.floor(r() * NATO.length)];
    var n = Math.floor(r() * 100);
    return a + "-" + b + "-" + (n < 10 ? "0" + n : String(n));
  }

  /** The relay envelope a SOCKET carries (see the header). wireDecode
      returns { to, frame } or null; the frame itself is NOT validated here -
      the receiver calls validate() so a v-mismatch hello still reaches the
      host, which alone answers with the reject sentence. */
  function wireEncode(frame, to) { return JSON.stringify({ to: to == null ? null : String(to), f: frame }); }
  function wireDecode(text) {
    if (typeof text !== "string" || byteLength(text) > MAX_WIRE_BYTES) return null;
    var o;
    try { o = JSON.parse(text); } catch (e) { return null; }
    if (!isObj(o) || !("f" in o) || onlyKeys(o, ["to", "f"])) return null;
    if (o.to != null && (typeof o.to !== "string" || (o.to !== "*" && !isFingerprint(o.to)))) return null;
    return { to: o.to == null ? null : o.to, frame: o.f };
  }
  /** ws://<host:port>/ws?room=<code>&role=host|peer - the room server's socket. */
  function wsUrl(hostPort, room, role) {
    return "ws://" + hostPort + ENDPOINTS.ws + "?room=" + encodeURIComponent(String(room || "")) + "&role=" + (role === "host" ? "host" : "peer");
  }
  /** <origin>/j/<code> - the join link a host shows; the room server serves the guest page there. */
  function joinUrl(origin, room) { return String(origin || "").replace(/[/]+$/, "") + ENDPOINTS.join + String(room || ""); }
  /** "GUIDON 1.5.0 build abc1234 (protocol 1)" from { app, build, v }. */
  function buildLabel(x) {
    x = x || {};
    var sha = x.build ? String(x.build).slice(0, 7) : "?";
    return "GUIDON " + (x.app ? String(x.app) : "?") + " build " + sha + " (protocol " + (x.v == null ? "?" : String(x.v)) + ")";
  }
  /** The skew message every fork shows the host: the locked sentence first, then both sides. */
  function skewText(theirs, mine) {
    return VERSION_MISMATCH_TEXT + " - joiner: " + buildLabel(theirs) + "; this device: " + buildLabel(mine) + ".";
  }

  var schema = {
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    TYPES: TYPES, INTENT_KINDS: INTENT_KINDS, ENVELOPE_KEYS: ENVELOPE_KEYS, BODY_KEYS: BODY_KEYS,
    SNAPSHOT_KEYS: SNAPSHOT_KEYS, SEAT_KEYS: SEAT_KEYS, PHASES: PHASES, MODES: MODES,
    MAX_FRAME_BYTES: MAX_FRAME_BYTES, MAX_NAME: MAX_NAME, MAX_SEATS: MAX_SEATS, MAX_SCORE: MAX_SCORE, MAX_TEXT: MAX_TEXT,
    /* Exported for tools/gen-room-schema-rs.mjs, which emits the Rust host's
       src-tauri/src/room_schema_gen.rs from THIS object (never a typed copy). */
    REQUIRED_BODY_KEYS: REQUIRED_BODY_KEYS, MAX_TOKEN: MAX_TOKEN, MAX_REASON: MAX_REASON, MAX_ID: MAX_ID,
    VERSION_MISMATCH_TEXT: VERSION_MISMATCH_TEXT, NATO: NATO, ENDPOINTS: ENDPOINTS, MAX_WIRE_BYTES: MAX_WIRE_BYTES, MAX_BUILD: MAX_BUILD, MAX_APP: MAX_APP,
    wireEncode: wireEncode, wireDecode: wireDecode, wsUrl: wsUrl, joinUrl: joinUrl, buildLabel: buildLabel, skewText: skewText,
    validate: validate, validateSnapshot: validateSnapshot, bankSig: bankSig, roomCode: roomCode,
    isRoomCode: isRoomCode, isFingerprint: isFingerprint, byteLength: byteLength, hasKeyDeep: hasKeyDeep,
  };
  root.G.roomSchema = schema;
  if (typeof module === "object" && module && module.exports) module.exports = schema;
})(typeof window !== "undefined" ? window : globalThis);
// END room-schema.js
