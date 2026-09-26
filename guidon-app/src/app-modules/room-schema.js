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
   reject, kick, ping, pong, bye, end, offer. Unknown t -> ignored by every
   receiver. A v mismatch on a hello -> reject "update GUIDON on one
   device" (VERSION_MISMATCH_TEXT below is the sentence every fork shows).

   "offer" is the one type added after the lock (hand-off model, Sep 2026):
   the host puts ONE hand-off payload in front of every seated device - a PT
   plan or a Team Training session. It is ADDITIVE, so PROTOCOL_VERSION
   stays 1: a build that predates it meets an unknown t, ignores and counts
   the frame exactly as the rule above says, and every other frame it
   exchanges with a newer build is unchanged. Only a host sends one; a peer
   that sends one is ignored. See "THE HAND-OFF MODEL" below.

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
  var TYPES = ["hello", "admit", "welcome", "snapshot", "intent", "reject", "kick", "ping", "pong", "bye", "end", "offer"];
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
    offer: ["offer"],
  };
  var REQUIRED_BODY_KEYS = {
    hello: ["name", "bankSig"], admit: ["pending"], welcome: ["seatNo", "token", "snapshot"], snapshot: ["snapshot"],
    intent: ["kind"], reject: ["reason"], kick: ["seatNo"], ping: ["n"], pong: ["n"], bye: [], end: [], offer: ["offer"],
  };
  /* The public snapshot (host-authoritative full state). seats[] entries
     carry SEAT_KEYS only - never a token, never anything a device stores. */
  var SNAPSHOT_KEYS = ["phase", "mode", "seq", "room", "hostSeat", "cardId", "cardText", "turnSeat", "lock", "deadline", "round", "seats", "bankSig", "deck"];
  var SEAT_KEYS = ["seatNo", "name", "fp", "score", "online", "ready", "done"];
  var PHASES = ["lobby", "play", "recap", "ended"];
  var MODES = ["relay", "board"];
  /* cardText.kind allowlist (agnosticism audit F8, 6 Sep 2026): "text" is
     the only kind that has ever existed - a future richer kind (image-
     based, multi-part) is referenced by id against a pre-shared asset,
     never inlined raw (a 4 KB frame has no room for it), and gets added
     here one at a time alongside the receiver logic that understands it. */
  var CARD_TEXT_KINDS = ["text"];
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
  /* The hand-off payload's own closed envelope and its caps (see "THE
     HAND-OFF MODEL"). MAX_OFFER_BYTES leaves the rest of the frame - the
     envelope, the body key, the fingerprints - well inside MAX_FRAME_BYTES
     (measured, not assumed: tools/test-room-handoff-core.mjs builds the
     largest legal offer and validates the whole frame). */
  var OFFER_KEYS = ["oid", "kind", "ver", "title", "data"];
  var OFFER_REQUIRED_KEYS = ["oid", "kind", "ver", "data"];
  var MAX_OFFER_BYTES = 3072;
  var MAX_OFFER_TITLE = 40;
  var MAX_OFFER_DEPTH = 6;
  var MAX_OFFER_VER = 99;
  /* Key NAMES that can never appear anywhere inside an offer (compared
     after folding case, spacing and punctuation away, at any depth - see
     keyIsForbidden(); a key with a non-ASCII character is refused outright):
     the personal things a payload must never carry - who someone is, what
     they scored, what they wrote. No payload kind uses any of them as a
     field name, so a hit is never a false positive; it is a forged or
     careless sender, and the whole offer is refused. The Rust host reads
     this exact list (generated). */
  var OFFER_FORBIDDEN_KEYS = ["profile", "name", "displayname", "firstname", "lastname", "callsign", "rank", "grade", "mos", "progress",
    "attempts", "attempt", "notes", "note", "results", "result", "score", "scores", "history", "streak", "roster",
    "email", "phone", "ssn", "dodid", "edipi", "uic", "token", "fp", "resume"];
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

  /* ================================================================ */
  /*                      THE HAND-OFF MODEL                           */
  /* ================================================================ */
  /* ONE generic, versioned payload for everything a room can put in front
     of a device, instead of one bespoke shape per feature:

       { oid, kind, ver, title?, data }

     oid    a per-offer id the host mints (A-Z 2-7, 4-12 chars); a device
            that has already met an oid never asks about it twice.
     kind   what it is. Three kinds are known to this build (HANDOFF below):
              deck          a study deck - the room's own deck, carried in the
                            snapshot's deck field as it always has been
                            (carrier "snapshot"); it is the model's "deck"
                            payload data, validated by the SAME rule, so a deck
                            behaves exactly as before and nothing about it is
                            an offer
              pt-plan       a weekly PT plan (the shape behind PT Planner's
                            prt:plan:v1, minus everything that is a person's)
              team-session an ordered Team Training session
            Any other kind, or a newer ver of a known kind, is NOT an error on
            the wire (a relay of an older build must not be able to block a
            newer one): it reaches the receiver, which says so in plain words
            and applies nothing (classify(), MESSAGES).
     ver    the payload's own version, an integer. A build understands every
            ver up to the one in HANDOFF and refuses a higher one by name.
     title  an optional short label, plain text.
     data   the kind's own STRUCTURE - closed key sets, every string capped.

     What a payload can NEVER carry: anything about a person. The model
     enforces it three ways. (1) validateOffer() refuses, at every hop (the
     page, the Node server, the Rust host), an offer that nests a key named
     for a personal thing (OFFER_FORBIDDEN_KEYS: profile, rank, name, mos,
     progress, attempts, notes, results ... - whatever the case, spacing or
     punctuation, and any non-ASCII spelling) at any depth. It is the
     secondary net: the load-bearing rule is (2). (2) each kind's
     data has a CLOSED key set, so a stray key is refused even when it is not
     on that list. (3) the builders on the sending side copy fields out by
     name; they never pass a stored record through. Size is capped
     (MAX_OFFER_BYTES for the payload, so the whole frame stays under
     MAX_FRAME_BYTES) and so is nesting (MAX_OFFER_DEPTH).

     sanitize() is the receiving side's other half: every string in the
     payload is stripped of control and direction-changing characters,
     whitespace-collapsed and length-checked, then passed through the
     caller's screen function (the app hands it G.opsecGuard.screen) - one
     finding of any kind and the whole offer is refused. A payload nobody
     could screen is refused too: with no screen function, sanitize() fails
     closed. Nothing here touches a device: this file has no storage and no
     DOM, so it is also what the guest page carries. */
  function lowerAscii(s) { return String(s).replace(/[A-Z]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 32); }); }
  function tooDeep(v, limit, d) {
    if (!v || typeof v !== "object") return false;
    if (d > limit) return true;
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) if (tooDeep(v[i], limit, d + 1)) return true; return false; }
    for (var k in v) if (tooDeep(v[k], limit, d + 1)) return true;
    return false;
  }
  /* Is this object KEY one a payload may never carry? Two rules, both simple
     enough to be identical in the Rust host (room.rs key_is_forbidden):
       1. the key, folded - every character that is not an ASCII letter or
          digit dropped, the rest lower-cased - is on OFFER_FORBIDDEN_KEYS. So
          "Name", "name " (a trailing space), "na me", "na_me" and "n-a-m-e"
          all read as "name";
       2. the key holds any non-ASCII character at all. A field name is a
          protocol identifier, never a word in a person's language, so this
          refuses at once the spellings a fold would have to guess at: a
          zero-width or direction character laced through "name", a
          full-width or math-alphabet "name" (what NFKC would fold to ASCII),
          a look-alike letter from another script.
     No payload kind names a field with either shape, so a hit is a forged or
     careless sender and is never a false alarm. */
  function foldKey(k) { return lowerAscii(String(k).replace(/[^A-Za-z0-9]/g, "")); }
  function keyIsForbidden(k) { return /[^\x00-\x7f]/.test(k) || OFFER_FORBIDDEN_KEYS.indexOf(foldKey(k)) !== -1; }
  function hasForbiddenKey(v) {
    if (!v || typeof v !== "object") return false;
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) if (hasForbiddenKey(v[i])) return true; return false; }
    for (var k in v) { if (keyIsForbidden(k)) return true; if (hasForbiddenKey(v[k])) return true; }
    return false;
  }
  var OID_RE = /^[A-Z2-7]{4,12}$/;
  var KIND_RE = /^[a-z][a-z0-9-]{1,23}$/;
  /** The kind-blind rules every hop applies (the JS validate() and the Rust
      host's validate() agree on these rule for rule): a reason string, or null. */
  function validateOffer(o) {
    if (!isObj(o)) return "offer";
    var extra = onlyKeys(o, OFFER_KEYS);
    if (extra) return "offer-key:" + extra;
    for (var i = 0; i < OFFER_REQUIRED_KEYS.length; i++) if (!(OFFER_REQUIRED_KEYS[i] in o)) return "offer-missing:" + OFFER_REQUIRED_KEYS[i];
    if (typeof o.oid !== "string" || !OID_RE.test(o.oid)) return "offer-oid";
    if (typeof o.kind !== "string" || !KIND_RE.test(o.kind)) return "offer-kind";
    if (!isInt(o.ver, 1, MAX_OFFER_VER)) return "offer-ver";
    if ("title" in o && !isStr(o.title, MAX_OFFER_TITLE)) return "offer-title";
    if (!isObj(o.data)) return "offer-data";
    if (tooDeep(o, MAX_OFFER_DEPTH, 1)) return "offer-depth";
    if (hasForbiddenKey(o)) return "offer-personal";
    var json;
    try { json = JSON.stringify(o); } catch (e) { return "offer-json"; }
    if (typeof json !== "string" || byteLength(json) > MAX_OFFER_BYTES) return "offer-size";
    return null;
  }

  /* ---- each kind's own data rules: a reason suffix, or null ---- */
  var EFFORTS = ["recovery", "moderate", "hard"];
  var PT_SESSION_TYPES = ["drill", "session"];
  var PT_MAX_SESSIONS = 6, PT_MAX_BLOCKS = 12, PT_MAX_DATES = 8, PT_LABEL = 80, TEAM_MAX_STEPS = 10;
  var PT_ENTRY_RE = /^[a-z][a-z0-9-]{0,23}$/;
  var PT_REF_RE = /^[a-z0-9]{1,6}$/;
  var PT_BLOCK_RE = /^[A-Za-z0-9._-]{1,40}$/;
  var PT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TEAM_EXERCISE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

  /* deck: what the snapshot's deck field has always been. The snapshot
     validator below calls this, so the room's deck and a deck payload can
     never disagree about what a legal deck is. */
  function deckProblem(d) {
    if (!isObj(d)) return "obj";
    var dk = onlyKeys(d, ["category", "timerSec"]);
    if (dk) return "key:" + dk;
    if (d.category != null && !isStr(d.category, 80)) return "cat";
    if (d.timerSec != null && !isInt(d.timerSec, 1, 3600)) return "timer";
    return null;
  }
  /** The model's deck data from any object carrying a category and a timer. */
  function deckData(x) {
    return { category: x && x.category != null ? x.category : null, timerSec: x && x.timerSec != null ? x.timerSec : null };
  }

  /* pt-plan: seven day entries (Sunday first), the custom sessions those
     days point at, and up to PT_MAX_DATES one-date changes. An entry is a
     built-in session type by id ({id:"strength"}), an ad hoc named day
     ({id:"custom", label, effort}) or one of the payload's own sessions
     ({id:"session", ref}). Session ids are LOCAL to the payload: the
     receiver mints its own, it never adopts one from the wire. */
  function ptEntryProblem(e, refs) {
    if (!isObj(e)) return "entry";
    var extra = onlyKeys(e, ["id", "label", "effort", "ref"]);
    if (extra) return "entry-key:" + extra;
    if (typeof e.id !== "string" || !PT_ENTRY_RE.test(e.id)) return "entry-id";
    if (e.id === "custom") {
      if (!isStr(e.label, PT_LABEL) || !e.label.length) return "entry-label";
      if (EFFORTS.indexOf(e.effort) === -1) return "entry-effort";
      if ("ref" in e) return "entry-key:ref";
    } else if (e.id === "session") {
      if (typeof e.ref !== "string" || refs.indexOf(e.ref) === -1) return "entry-ref";
      if ("label" in e) return "entry-key:label";
      if ("effort" in e) return "entry-key:effort";
    } else if ("label" in e || "effort" in e || "ref" in e) {
      return "entry-key:" + ("label" in e ? "label" : "effort" in e ? "effort" : "ref");
    }
    return null;
  }
  function ptPlanProblem(d) {
    if (!isObj(d)) return "data";
    var extra = onlyKeys(d, ["tpl", "days", "sessions", "dates"]);
    if (extra) return "key:" + extra;
    if ("tpl" in d && !isStr(d.tpl, 24)) return "tpl";
    if (!Array.isArray(d.days) || d.days.length !== 7) return "days";
    var refs = [], i, p;
    if ("sessions" in d) {
      if (!Array.isArray(d.sessions) || d.sessions.length > PT_MAX_SESSIONS) return "sessions";
      for (i = 0; i < d.sessions.length; i++) {
        var s = d.sessions[i];
        if (!isObj(s)) return "session";
        var sk = onlyKeys(s, ["key", "label", "effort", "type", "blocks"]);
        if (sk) return "session-key:" + sk;
        if (typeof s.key !== "string" || !PT_REF_RE.test(s.key) || refs.indexOf(s.key) !== -1) return "session-key";
        if (!isStr(s.label, PT_LABEL) || !s.label.length) return "session-label";
        if (EFFORTS.indexOf(s.effort) === -1) return "session-effort";
        if (PT_SESSION_TYPES.indexOf(s.type) === -1) return "session-type";
        if (!Array.isArray(s.blocks) || !s.blocks.length || s.blocks.length > PT_MAX_BLOCKS) return "session-blocks";
        for (var b = 0; b < s.blocks.length; b++) if (typeof s.blocks[b] !== "string" || !PT_BLOCK_RE.test(s.blocks[b])) return "session-block";
        refs.push(s.key);
      }
    }
    for (i = 0; i < d.days.length; i++) { p = ptEntryProblem(d.days[i], refs); if (p) return "day-" + p; }
    if ("dates" in d) {
      if (!Array.isArray(d.dates) || d.dates.length > PT_MAX_DATES) return "dates";
      for (i = 0; i < d.dates.length; i++) {
        var x = d.dates[i];
        if (!isObj(x)) return "date";
        var xk = onlyKeys(x, ["date", "entry"]);
        if (xk) return "date-key:" + xk;
        if (typeof x.date !== "string" || !PT_DATE_RE.test(x.date)) return "date-day";
        p = ptEntryProblem(x.entry, refs);
        if (p) return "date-" + p;
      }
    }
    return null;
  }

  /* team-session: an ordered list of Team Training exercise ids. Which ids
     exist is the RECEIVER's catalog, never this file's: an id this build
     has not heard of is only "not on this device" to the receiver. */
  function teamSessionProblem(d) {
    if (!isObj(d)) return "data";
    var extra = onlyKeys(d, ["steps"]);
    if (extra) return "key:" + extra;
    if (!Array.isArray(d.steps) || !d.steps.length || d.steps.length > TEAM_MAX_STEPS) return "steps";
    for (var i = 0; i < d.steps.length; i++) if (typeof d.steps[i] !== "string" || !TEAM_EXERCISE_RE.test(d.steps[i])) return "step";
    return null;
  }

  /* The kinds this build understands. carrier: where the payload travels -
     "offer" (an offer frame, and the receiving device must confirm before
     anything is added) or "snapshot" (the room's own deck, applied to the
     room and nothing else, never saved). */
  var HANDOFF = {
    "deck": { ver: 1, carrier: "snapshot", label: "a study deck", problem: deckProblem },
    "pt-plan": { ver: 1, carrier: "offer", label: "a PT plan", problem: ptPlanProblem },
    "team-session": { ver: 1, carrier: "offer", label: "a Team Training session", problem: teamSessionProblem },
  };
  function kindOf(name) { return typeof name === "string" && Object.prototype.hasOwnProperty.call(HANDOFF, name) ? HANDOFF[name] : null; }
  function kindsInfo() {
    var out = {};
    for (var k in HANDOFF) out[k] = { ver: HANDOFF[k].ver, carrier: HANDOFF[k].carrier, label: HANDOFF[k].label };
    return out;
  }
  /** What a device says about a kind it may not know - a fixed phrase, never
      the sender's own words. */
  function labelOf(name) {
    var K = kindOf(name);
    return K && K.carrier === "offer" ? K.label : "something this version of GUIDON can't open";
  }
  /* Plain words, one place: every screen that has to say "no" says it with
     these (the guest page and the app both). None of them names a field, an
     id or a code. */
  var HANDOFF_MESSAGES = {
    unsupportedKind: "The host shared something this version of GUIDON doesn't know how to open, so nothing was added. Update GUIDON on this device, then ask the host to share it again.",
    newerVersion: "The host shared this from a newer GUIDON than the one on this device, so nothing was added. Update GUIDON on this device, then ask the host to share it again.",
    refused: "The host shared something GUIDON couldn't accept, so it was ignored and nothing was added.",
    noGuard: "GUIDON couldn't check what the host shared, so nothing was added.",
    tooBig: "That is too big to send through a room. Nothing was sent.",
    personal: "That contained a personal detail, which a room never carries. Nothing was sent.",
    cannotShare: "GUIDON can't share that kind of item through a room. Nothing was sent.",
    invalid: "GUIDON couldn't put that together to send, so nothing was sent.",
    guardOut: "One of the names looks like it holds something sensitive, so nothing was sent. Change it and try again.",
  };

  /** classify(offer) -> { status, reason }. status: "ok" (this build can
      read it), "unsupported-kind", "newer-version" (both: safe to hold as a
      note, never applied) or "invalid" (fails a rule - dropped). */
  function classify(offer) {
    var g = validateOffer(offer);
    if (g) return { status: "invalid", reason: g };
    var K = kindOf(offer.kind);
    if (!K || K.carrier !== "offer") return { status: "unsupported-kind", reason: "kind" };
    if (offer.ver > K.ver) return { status: "newer-version", reason: "ver" };
    var p = K.problem(offer.data);
    if (p) return { status: "invalid", reason: offer.kind + "-" + p };
    return { status: "ok", reason: "" };
  }

  /* Control, zero-width, line-separator and direction-override characters
     become spaces; runs of whitespace collapse; the ends are trimmed. This one
     function cleans on BOTH sides: make() cleans the title a host sends and
     sanitize() cleans everything a device receives. */
  var CLEAN_RE = (function () {
    /* code point ranges, written as numbers so no unusual character ever
       sits in this file's source: C0/C1 controls, soft hyphen, the Arabic
       letter mark (U+061C, a direction mark like the ones next to it),
       zero-width and direction marks, line/paragraph separators, direction
       overrides and isolates, the invisible-operator block, BOM, interlinear
       annotation */
    var ranges = [[0, 31], [127, 159], [173, 173], [1564, 1564], [8203, 8207], [8232, 8233], [8234, 8238], [8288, 8303], [65279, 65279], [65529, 65531]];
    var body = "";
    for (var i = 0; i < ranges.length; i++) body += String.fromCharCode(ranges[i][0]) + (ranges[i][1] > ranges[i][0] ? "-" + String.fromCharCode(ranges[i][1]) : "");
    /* Unicode "tag" characters, U+E0000-U+E007F: invisible, and used to hide
       text inside text. They sit outside the 16-bit range, so they are matched
       as the surrogate pair every one of them is (high U+DB40, then a low
       surrogate U+DC00-U+DC7F) - written as escapes, for the same reason. */
    return new RegExp("[" + body + "]|\\udb40[\\udc00-\\udc7f]", "g");
  })();
  function cleanText(s) {
    return String(s).replace(CLEAN_RE, " ").replace(/\s+/g, " ").trim();
  }
  function cleanDeep(v) {
    if (typeof v === "string") return cleanText(v);
    if (Array.isArray(v)) return v.map(cleanDeep);
    if (isObj(v)) { var o = {}; for (var k in v) o[k] = cleanDeep(v[k]); return o; }
    return v;
  }
  function stringsOf(v, out) {
    if (typeof v === "string") { if (v.length) out.push(v); }
    else if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) stringsOf(v[i], out); }
    else if (isObj(v)) { for (var k in v) stringsOf(v[k], out); }
    return out;
  }
  /** combinedLines(kind, data) -> the lines a screen reads as ONE line, where
      two strings that are harmless on their own can add up to something that
      is not. Screening each string separately (stringsOf) cannot see that:
      a PT plan's changed date is one string ("2026-10-01") and its name is
      another ("Live-fire at Range 4"), and it is the pair - a future date, a
      place and a unit activity in one line - that the sensitive-text check
      exists to stop. So every changed date is also checked as the line the
      preview shows for it: "<date>: <name>". Other kinds have no such line
      (a Team Training session is a title and exercise ids the receiver's own
      catalog names); the receiving screen also checks whatever its own
      preview draws, line by line. */
  function combinedLines(kind, data) {
    var out = [];
    if (kind !== "pt-plan" || !isObj(data) || !Array.isArray(data.dates)) return out;
    var byKey = Object.create(null), i;
    if (Array.isArray(data.sessions)) for (i = 0; i < data.sessions.length; i++) { var s = data.sessions[i]; if (isObj(s) && typeof s.key === "string") byKey[s.key] = s; }
    for (i = 0; i < data.dates.length; i++) {
      var x = data.dates[i];
      if (!isObj(x) || typeof x.date !== "string" || !isObj(x.entry)) continue;
      var e = x.entry, name = "";
      if (e.id === "custom" && typeof e.label === "string") name = e.label;
      else if (e.id === "session" && typeof e.ref === "string" && byKey[e.ref] && typeof byKey[e.ref].label === "string") name = byKey[e.ref].label;
      if (name) out.push(x.date + ": " + name);
    }
    return out;
  }

  /** make(kind, title, data) -> { ok, offer } | { ok:false, reason, message }.
      The sending side's one door: builds the offer object (no oid - the host
      mints that when it sends), refuses a kind that does not travel as an
      offer, and runs every rule the receiving side will run, so a host can
      never send what a device would have to refuse. */
  function make(kind, title, data) {
    var K = kindOf(kind);
    if (!K || K.carrier !== "offer") return { ok: false, reason: "kind", message: HANDOFF_MESSAGES.cannotShare };
    var offer = { oid: "AAAAAAAA", kind: kind, ver: K.ver, data: data };
    if (title != null && String(title) !== "") {
      var t = cleanText(title).slice(0, MAX_OFFER_TITLE);
      if (t) offer.title = t;
    }
    var g = validateOffer(offer);
    if (g) return { ok: false, reason: g, message: g === "offer-size" ? HANDOFF_MESSAGES.tooBig : g === "offer-personal" ? HANDOFF_MESSAGES.personal : HANDOFF_MESSAGES.invalid };
    var p = K.problem(data);
    if (p) return { ok: false, reason: kind + "-" + p, message: HANDOFF_MESSAGES.invalid };
    delete offer.oid;
    return { ok: true, offer: offer };
  }

  /** sanitize(offer, { screen }) -> { ok, offer } | { ok:false, reason,
      message, found }. `screen(text)` returns { findings: [...] } (the app
      passes G.opsecGuard.screen); any finding on any string refuses the
      whole offer, and no screen function at all refuses it too. */
  function sanitize(offer, opts) {
    opts = opts || {};
    if (typeof opts.screen !== "function") return { ok: false, reason: "no-guard", message: HANDOFF_MESSAGES.noGuard, found: [] };
    var out = cleanDeep(offer);
    var again = classify(out);
    if (again.status !== "ok") return { ok: false, reason: "clean:" + again.reason, message: HANDOFF_MESSAGES.refused, found: [] };
    var all = stringsOf(out, []).concat(combinedLines(out.kind, out.data));
    for (var i = 0; i < all.length; i++) {
      var r = null;
      try { r = opts.screen(all[i]); } catch (e) { return { ok: false, reason: "no-guard", message: HANDOFF_MESSAGES.noGuard, found: [] }; }
      if (r && r.findings && r.findings.length) return { ok: false, reason: "guard", message: HANDOFF_MESSAGES.refused, found: r.findings };
    }
    return { ok: true, offer: out };
  }

  /** receive(offer, { screen }) -> { status, ok, offer?, message } - what a
      device does with an offer before it shows anyone a word of it. Only
      status "ok" ever carries data on. */
  function receive(offer, opts) {
    var c = classify(offer);
    if (c.status === "unsupported-kind") return { status: c.status, ok: false, message: HANDOFF_MESSAGES.unsupportedKind };
    if (c.status === "newer-version") return { status: c.status, ok: false, message: HANDOFF_MESSAGES.newerVersion };
    if (c.status !== "ok") return { status: "invalid", ok: false, message: HANDOFF_MESSAGES.refused };
    var s = sanitize(offer, opts);
    if (!s.ok) return { status: s.reason === "no-guard" ? "no-guard" : "refused", ok: false, message: s.message, found: s.found };
    return { status: "ok", ok: true, offer: s.offer, message: "" };
  }

  var handoff = {
    KINDS: kindsInfo(), MESSAGES: HANDOFF_MESSAGES,
    MAX_BYTES: MAX_OFFER_BYTES, MAX_TITLE: MAX_OFFER_TITLE, MAX_DEPTH: MAX_OFFER_DEPTH, MAX_VER: MAX_OFFER_VER, FORBIDDEN_KEYS: OFFER_FORBIDDEN_KEYS,
    LIMITS: { ptSessions: PT_MAX_SESSIONS, ptBlocks: PT_MAX_BLOCKS, ptDates: PT_MAX_DATES, ptLabel: PT_LABEL, teamSteps: TEAM_MAX_STEPS },
    kindOf: function (name) { var K = kindOf(name); return K ? { ver: K.ver, carrier: K.carrier, label: K.label } : null; },
    labelOf: labelOf, validateOffer: validateOffer, classify: classify, make: make, sanitize: sanitize, receive: receive,
    cleanText: cleanText, deckData: deckData, deckProblem: deckProblem, hasForbiddenKey: hasForbiddenKey, combinedLines: combinedLines,
  };

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
      // Agnosticism audit, 6 Sep 2026 (F8): cardText used to be a closed
      // {q, a, category} object with no type discriminator - any future
      // richer card kind (image-based, multi-part) would have been a hard
      // rejection on every unupdated peer, not an extensible branch.
      // "kind" is optional (absent means "text", the only kind that has
      // ever existed on the wire) so this is not itself a breaking change;
      // CARD_TEXT_KINDS is the allowlist a future kind gets added to, one
      // at a time, alongside the receiver logic that knows what to do with
      // it - never a bare string accepted on faith.
      var tx = onlyKeys(s.cardText, ["q", "a", "category", "kind"]);
      if (tx) return "snapshot-text-key:" + tx;
      if ("kind" in s.cardText && CARD_TEXT_KINDS.indexOf(s.cardText.kind) === -1) return "snapshot-text-kind";
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
      /* The deck is the hand-off model's "deck" payload data: one rule
         (deckProblem, above), the reasons this field has always given. */
      var dp = deckProblem(s.deck);
      if (dp) return dp === "obj" ? "snapshot-deck" : "snapshot-deck-" + dp;
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
      case "offer":
        /* Kind-blind on purpose: a relay must not be able to block a kind it
           has not heard of. What each kind's data may hold is classify()'s
           job, at the receiver. */
        return validateOffer(b.offer);
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
      card count + a real content hash of board.questions, stamped at
      build time (tools/build.mjs's seedAsJsonParse -> board.contentHash).
      Two devices with equal sigs exchange card ids only; a differing sig
      makes the host inline the card text. Accepts the whole GUIDON_SEED or
      its board object.

      Agnosticism audit, 6 Sep 2026: this used to be count + board.version,
      a hand-typed literal that stays frozen across real content edits (it
      was still "0.1.0" after real corpus rewrites this session) - so a
      same-id, edited-wording change was invisible to every device, and
      nothing ever inlined corrective text for a peer running stale
      wording. contentHash is deterministic and covers only the field this
      signature is about; falls back to board.version (then "0") only for
      an un-built seed a test harness constructs by hand, never for a real
      served build. */
  function bankSig(seed) {
    var board = seed && seed.board ? seed.board : seed;
    var qs = board && Array.isArray(board.questions) ? board.questions : [];
    var mark = board && board.contentHash ? String(board.contentHash)
      : board && board.version != null ? String(board.version) : "0";
    return "bank:" + qs.length + ":" + mark.replace(/[^0-9A-Za-z.-]/g, "");
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
  /** ws://<host:port>/ws?room=<code>&role=host|peer - the room server's socket.
      SPIKE SCAFFOLD (TLS design, 2026-09-06): a 4th, optional `secure` arg
      switches the scheme to wss:// with NO other change - callers that never
      pass it (every caller today) get byte-for-byte the same string as
      before. This is a TRANSPORT choice, not a wire-protocol one: the frames
      wsUrl's socket carries are identical either way, so this does NOT touch
      PROTOCOL_VERSION (see the design writeup for why a transport switch and
      a wire-shape change are different kinds of "version"). Which scheme to
      ask for is decided by the caller from the JOIN LINK's own scheme
      (isSecureOrigin below) - never guessed. */
  function wsUrl(hostPort, room, role, secure) {
    return (secure ? "wss://" : "ws://") + hostPort + ENDPOINTS.ws + "?room=" + encodeURIComponent(String(room || "")) + "&role=" + (role === "host" ? "host" : "peer");
  }
  /** <origin>/j/<code>[#pin=<64-hex>] - the join link a host shows; the room
      server serves the guest page there. `origin` already carries its own
      scheme (http:// or, once a host is TLS-capable, https://) - joinUrl
      never adds or assumes one.

      `pin` (optional, 4th arg): the room's full SHA-256(SPKI) hex (64
      chars) - the ACTUAL pinning comparison a secure joiner's native
      transport must make, never the truncated 8-char `fp` a human reads
      aloud (see room-tls-and-discovery-pitch.md Section 1.4: the two are
      not interchangeable). Carried as a URL FRAGMENT, deliberately:
      fragments are never sent in an HTTP request (so a joiner's own pin
      never reaches the network, even by accident, before the TLS
      handshake it is meant to verify has even happened), and a fragment
      survives being pasted into any UI text field exactly like the rest of
      the link does. Omitting `pin` (every caller before this session's TLS
      work, and every plaintext-only host today) produces byte-for-byte the
      same string as before - this is additive, not a breaking change to
      the link shape. See pinFromUrl() below for the joiner-side read. */
  function joinUrl(origin, room, pin) {
    var base = String(origin || "").replace(/[/]+$/, "") + ENDPOINTS.join + String(room || "");
    return pin ? base + "#pin=" + String(pin) : base;
  }
  /** True when a join link's origin is https:// - the ONE signal a joiner
      uses to decide "dial wss:// and this room has a TLS identity to pin
      against" vs. "dial ws:// as today, nothing to pin." Never throws. */
  function isSecureOrigin(origin) {
    try { return new URL(String(origin || "")).protocol === "https:"; } catch (e) { return false; }
  }
  var SPKI_PIN_RE = /^[0-9a-f]{64}$/;
  /** True for a well-formed full SHA-256(SPKI) pin - lowercase hex, exactly
      64 chars (matching every producer of one: tools/room-tls.mjs,
      src-tauri/src/room_tls.rs, and studygroup.js's own makeIdentity() all
      emit createHash("sha256")/hex()-shaped lowercase hex). */
  function isSpkiPin(s) { return typeof s === "string" && SPKI_PIN_RE.test(s); }
  /** Extracts a well-formed pin from a join link's own #pin=<hex> fragment
      (see joinUrl() above), or null - a link with no fragment, a malformed
      one, or an unparseable URL are all indistinguishable "no pin here"
      cases to the caller (room-web.js's parse()): a secure (https://)
      target with no valid pin is an incomplete/corrupted link, never a
      reason to guess or fall back to an insecure connection. Never throws. */
  function pinFromUrl(url) {
    try {
      var hash = new URL(String(url || "")).hash || "";
      var m = /^#pin=([0-9a-f]{64})$/.exec(hash);
      return m && isSpkiPin(m[1]) ? m[1] : null;
    } catch (e) { return null; }
  }
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
    SNAPSHOT_KEYS: SNAPSHOT_KEYS, SEAT_KEYS: SEAT_KEYS, PHASES: PHASES, MODES: MODES, CARD_TEXT_KINDS: CARD_TEXT_KINDS,
    MAX_FRAME_BYTES: MAX_FRAME_BYTES, MAX_NAME: MAX_NAME, MAX_SEATS: MAX_SEATS, MAX_SCORE: MAX_SCORE, MAX_TEXT: MAX_TEXT,
    /* Exported for tools/gen-room-schema-rs.mjs, which emits the Rust host's
       src-tauri/src/room_schema_gen.rs from THIS object (never a typed copy). */
    REQUIRED_BODY_KEYS: REQUIRED_BODY_KEYS, MAX_TOKEN: MAX_TOKEN, MAX_REASON: MAX_REASON, MAX_ID: MAX_ID,
    VERSION_MISMATCH_TEXT: VERSION_MISMATCH_TEXT, NATO: NATO, ENDPOINTS: ENDPOINTS, MAX_WIRE_BYTES: MAX_WIRE_BYTES, MAX_BUILD: MAX_BUILD, MAX_APP: MAX_APP,
    wireEncode: wireEncode, wireDecode: wireDecode, wsUrl: wsUrl, joinUrl: joinUrl, isSecureOrigin: isSecureOrigin, isSpkiPin: isSpkiPin, pinFromUrl: pinFromUrl, buildLabel: buildLabel, skewText: skewText,
    validate: validate, validateSnapshot: validateSnapshot, bankSig: bankSig, roomCode: roomCode,
    isRoomCode: isRoomCode, isFingerprint: isFingerprint, byteLength: byteLength, hasKeyDeep: hasKeyDeep,
    /* The hand-off model (see THE HAND-OFF MODEL above). The constants are
       also exported flat for tools/gen-room-schema-rs.mjs. */
    handoff: handoff,
    OFFER_KEYS: OFFER_KEYS, OFFER_REQUIRED_KEYS: OFFER_REQUIRED_KEYS, MAX_OFFER_BYTES: MAX_OFFER_BYTES, MAX_OFFER_TITLE: MAX_OFFER_TITLE,
    MAX_OFFER_DEPTH: MAX_OFFER_DEPTH, MAX_OFFER_VER: MAX_OFFER_VER, OFFER_FORBIDDEN_KEYS: OFFER_FORBIDDEN_KEYS,
  };
  root.G.roomSchema = schema;
  if (typeof module === "object" && module && module.exports) module.exports = schema;
})(typeof window !== "undefined" ? window : globalThis);
// END room-schema.js
