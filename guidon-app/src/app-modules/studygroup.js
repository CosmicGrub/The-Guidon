/* ==== js/studygroup.js ==== */
/* GUIDON - studygroup.js : LAN study rooms, host-authoritative (G.studyGroup)
   Collective roadmap P3a. Locked design: desktop roadmap Q1-Q13, the
   review and the pairings research (2026-09-04); the wire protocol lives
   in ONE place, src/app-modules/room-schema.js (G.roomSchema), and this
   module validates every frame it sends and every frame it receives
   against it - an invalid inbound frame is ignored and counted, never
   reduced.

   Shape (all of it in this file):
     - a PURE core - initHost(), initPeer(), reduce(state, frame, ctx),
       act(state, action, ctx), snapshotOf(), snapshotFrames() - with no
       DOM, no timers and no randomness of its own (ctx supplies now() and
       token()), so tools/test-room-core.mjs drives it in Node at 20 seats
       with a seeded PRNG;
     - the runtime around ONE transport seam (attach({ send, onmessage,
       open, close })): host()/join()/leave()/reconnect()/sendIntent()/
       hostAction(), ping/pong heartbeat with a configurable interval and
       a 3-miss timeout, a 60 s seat hold with a resume token, coalesced
       snapshot broadcasts and coalesced re-renders;
     - the #/group screens: host/join, the lobby with admit-EACH (there is
       no admit-all and none will be built - ruled 2026-09-04), the
       phonetic room code, the two play modes of this phase, the terminal
       states (host left, network lost, rejected, kicked, ended) and the
       kill-switch-off panel ("Pass the device").

   Modes in this phase:
     relay  Rapid-Fire Team relay: each seat plays a Party round in turn on
            its own device through the SAME beginRound engine Rapid Fire's
            own tab runs (G.board.rapidFireEngine(), src/index.html), sends
            ONE score intent with its correct count, the host tallies and
            passes the turn in seat order. Writes nothing anywhere.
     board  Mock Board Live: the candidate seat answers aloud and taps "I've
            answered"; the board-member seats send score intents on the
            seed's own cfg.answerScale; the host advances the cards. The
            candidate's OWN self-score goes through G.board
            .noteExternalResult exactly as the solo Mock Board does - the
            only write a room ever causes, on the candidate's device only.

   PRIVACY IS THE SPINE (rule 8): receipt never writes any store; nothing
   derived from another person is written; no `grade` intent exists and a
   frame carrying a grade key anywhere is rejected by the schema; nothing
   that identifies this device across sessions is ever sent - identity v1
   is a per-session ephemeral ECDSA P-256 key (or 128 random bits where
   crypto.subtle is absent), fingerprint 8 base32 chars, never persisted;
   the seat-hold resume token lives in memory only. The kill switch
   (settings.studyGroups, default false) gates every entry point:
   attach(), host(), join(), reconnect(), sendIntent() and even inbound
   delivery are no-ops while it is off, and G.netLedger.record() is called
   in attach() - the ONLY place a connection can be opened.

   This file is spliced into every build (tools/build.mjs). It must load
   with no transport and with the switch off, and it does: nothing here
   runs at load beyond defining the object. */
(function (root) {
  "use strict";
  root.G = root.G || {};
  var G = root.G;

  /* ==== GUEST-CORE BEGIN ==== */
  /* tools/build.mjs copies everything between the BEGIN and END markers
     verbatim into dist/guest.html (wrapped in its own IIFE and exposed as
     G.roomCore): the defaults, the helpers and the PURE CORE. Nothing in
     this block may touch the DOM, timers, the Web Crypto key API or any
     storage - the guest page is an insecure context that stores nothing,
     and the build asserts the block is free of those names. The RUNTIME starts
     after the END marker. */
  var DEFAULTS = { pingMs: 5000, missLimit: 3, holdMs: 60000, pendingMs: 300000, renderMs: 100, snapshotMs: 50 };
  var HOTSPOT_CAP = 8;
  /* Single source of truth for "Study Rooms needs a native shell" (2026-09-08)
     - a plain browser tab has no way to host a LAN listener or complete a
     pinned TLS handshake (see room-web.js's own nativeTlsPlugin()/
     SECURE_NO_NATIVE_TEXT for the secure-join-specific case this is the
     feature-level generalization of), so this is the ONLY way GUIDON ever
     runs on iOS. Read by src/index.html's navButton() (the greyed-out nav
     entry) and share.js's "Study solo or with others?" fork, so the exact
     same sentence appears everywhere this limitation is explained rather
     than three independently-typed copies drifting apart over time. */
  var NEEDS_SHELL_TEXT = "Study Rooms needs the GUIDON app on Android or a PC — it can't run in a browser tab.";
  var HELD_SEAT_TEXT = "That seat is held for its own resume token. Reconnect from the device that holds it, or wait for the hold to end.";
  var B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function schema() { return G.roomSchema; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function nowOf(ctx) { return ctx && typeof ctx.now === "function" ? ctx.now() : Date.now(); }
  function tokenOf(ctx) { return ctx && typeof ctx.token === "function" ? String(ctx.token()) : randomToken(); }
  function base32(bytes) {
    var bits = 0, val = 0, out = "";
    for (var i = 0; i < bytes.length; i++) {
      val = ((val << 8) | bytes[i]) >>> 0; bits += 8;
      while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    return out;
  }
  function randomBytes(n) {
    var b = new Uint8Array(n);
    var c = root.crypto;
    if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
    else for (var i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  }
  function randomToken() { return base32(randomBytes(15)); }
  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) : s; }

  /* ================================================================ */
  /*                            PURE CORE                              */
  /* ================================================================ */

  function result(state, o) {
    return { state: state, accepted: !!o.accepted, changed: !!o.changed, bump: !!o.bump, render: o.render !== undefined ? !!o.render : !!o.changed, reason: o.reason || "", effects: o.effects || [], skew: o.skew || null };
  }
  function ignored(state, reason, effects, skew) { return result(state, { accepted: false, reason: reason, effects: effects || [], skew: skew || null }); }
  /* The informational build fields of a hello (display only, never trusted
     for anything else, never persisted) - read defensively because a
     v-mismatch frame failed validate() before its body was checked. */
  function skewOf(frame) {
    var b = frame && typeof frame === "object" && frame.body && typeof frame.body === "object" ? frame.body : {};
    return { build: typeof b.build === "string" ? clip(b.build, 40) : "", app: typeof b.app === "string" ? clip(b.app, 24) : "", v: frame && typeof frame.v === "number" ? frame.v : null };
  }
  function welcomeBody(s, seat) {
    return { seatNo: seat.seatNo, token: seat.token, snapshot: snapshotOf(s), hold: Math.max(1, Math.min(3600, Math.round((s.cfg && s.cfg.holdMs ? s.cfg.holdMs : DEFAULTS.holdMs) / 1000))) };
  }
  function frameOf(state, t, body) {
    return { v: schema().PROTOCOL_VERSION, t: t, room: state.room, seq: state.seq, from: state.self.fp, body: body };
  }
  function pubSeat(x) {
    return { seatNo: x.seatNo, name: x.name, fp: x.fp, score: x.score, online: !!x.online, ready: !!x.ready, done: !!x.done };
  }
  function snapshotOf(s) {
    return {
      phase: s.phase, mode: s.mode, seq: s.seq, room: s.room, hostSeat: s.hostSeat,
      cardId: s.cardId == null ? null : s.cardId, cardText: s.cardText == null ? null : s.cardText,
      turnSeat: s.turnSeat == null ? null : s.turnSeat, lock: s.lock == null ? null : s.lock, deadline: s.deadline == null ? null : s.deadline,
      round: { idx: s.round ? s.round.idx : 0, total: s.round ? s.round.total : 0 },
      seats: s.seats.map(pubSeat), bankSig: s.bankSig,
      deck: { category: s.deck && s.deck.category != null ? s.deck.category : null, timerSec: s.deck && s.deck.timerSec != null ? s.deck.timerSec : null },
    };
  }
  /** Every online seated peer gets the full snapshot; nobody else gets anything. */
  function snapshotFrames(s) {
    if (!s || s.role !== "host") return [];
    var snap = snapshotOf(s), out = [];
    for (var i = 0; i < s.seats.length; i++) {
      var x = s.seats[i];
      if (x.fp === s.self.fp || !x.online) continue;
      out.push({ to: x.fp, frame: frameOf(s, "snapshot", { snapshot: snap }) });
    }
    return out;
  }

  function initHost(o) {
    var now = o.now != null ? o.now : Date.now();
    var deck = o.deck || {};
    var ids = Array.isArray(deck.ids) ? deck.ids.slice() : [];
    var cards = {};
    if (o.cards) for (var i = 0; i < ids.length; i++) if (o.cards[ids[i]]) { var c = o.cards[ids[i]]; cards[ids[i]] = { q: clip(c.q, schema().MAX_TEXT), a: clip(c.a, schema().MAX_TEXT), category: clip(c.category, 80) }; }
    var mode = o.mode === "board" ? "board" : "relay";
    var st = {
      role: "host", phase: "lobby", mode: mode, seq: 0, room: o.room, hostSeat: 1,
      self: { fp: o.self.fp, name: clip(o.self.name || "HOST", schema().MAX_NAME), rank: o.self.rank || "", seatNo: 1, token: tokenOf(o) },
      bankSig: o.bankSig || "", deck: { category: deck.category == null ? null : deck.category, timerSec: deck.timerSec == null ? null : deck.timerSec, ids: ids, count: ids.length },
      cards: cards, cardId: null, cardText: null, turnSeat: null, lock: null, deadline: null,
      round: { idx: 0, total: mode === "board" ? ids.length : 0 },
      seats: [], pending: [], admitted: [], scores: {}, nextSeat: 2,
      cfg: { pingMs: o.pingMs || DEFAULTS.pingMs, missLimit: o.missLimit || DEFAULTS.missLimit, holdMs: o.holdMs || DEFAULTS.holdMs, pendingMs: o.pendingMs || DEFAULTS.pendingMs },
      terminal: null, createdAt: now,
    };
    st.seats.push({ seatNo: 1, name: st.self.name, fp: st.self.fp, score: 0, online: true, ready: true, done: false, token: st.self.token, bankSig: st.bankSig, rank: st.self.rank, lastSeen: now, offlineAt: null });
    return st;
  }
  function initPeer(o) {
    var now = o.now != null ? o.now : Date.now();
    return {
      role: "peer", room: o.room, self: { fp: o.self.fp, name: clip(o.self.name || "GUEST", schema().MAX_NAME), rank: o.self.rank || "", seatNo: null, token: null },
      bankSig: o.bankSig || "", joinState: "hello", hostFp: null, seq: 0, phase: "lobby", mode: null, hostSeat: 1,
      cardId: null, cardText: null, turnSeat: null, lock: null, deadline: null, round: { idx: 0, total: 0 }, seats: [], deck: { category: null, timerSec: null }, hostSig: null,
      cfg: { pingMs: o.pingMs || DEFAULTS.pingMs, missLimit: o.missLimit || DEFAULTS.missLimit },
      lastSeen: now, terminal: null, createdAt: now,
    };
  }

  /* ------------------------------------------------------- host helpers */
  function seatByFp(s, fp) { for (var i = 0; i < s.seats.length; i++) if (s.seats[i].fp === fp) return s.seats[i]; return null; }
  function seatByNo(s, n) { for (var i = 0; i < s.seats.length; i++) if (s.seats[i].seatNo === n) return s.seats[i]; return null; }
  function refreshCardText(s) {
    s.cardText = null;
    if (s.cardId == null) return;
    var differs = false;
    for (var i = 0; i < s.seats.length; i++) if (s.seats[i].fp !== s.self.fp && s.seats[i].bankSig !== s.bankSig) differs = true;
    if (!differs || !s.cards[s.cardId]) return;
    /* Inline text must leave the whole frame under MAX_FRAME_BYTES with
       every seat listed (measured, not assumed): shrink the answer, then
       the question, until a welcome-sized frame fits; give up (id only)
       below 40 chars each - that peer then shows the update-one-device line. */
    var S = schema(), limit = S.MAX_FRAME_BYTES - 220;
    var text = clone(s.cards[s.cardId]);
    // Agnosticism audit, 6 Sep 2026 (F8): stamp the discriminator even
    // though it's optional on the wire (an older peer without this fix
    // just never reads it) - every NEW frame should say what it is rather
    // than relying on absence-means-text forever.
    text.kind = "text";
    for (var guard = 0; guard < 60; guard++) {
      s.cardText = text;
      if (S.byteLength(JSON.stringify(snapshotOf(s))) <= limit) return;
      if (text.a.length > 40) text.a = text.a.slice(0, Math.max(40, Math.floor(text.a.length * 0.8)));
      else if (text.q.length > 40) text.q = text.q.slice(0, Math.max(40, Math.floor(text.q.length * 0.8)));
      else break;
    }
    s.cardText = null;
  }
  function setCard(s) {
    var idx = s.round.idx;
    s.cardId = s.deck.ids[idx] != null ? s.deck.ids[idx] : null;
    s.lock = null;
    refreshCardText(s);
  }
  function seatNow(s, entry, ctx, effects) {
    var seat = { seatNo: s.nextSeat++, name: entry.name, fp: entry.fp, score: 0, online: true, ready: false, done: false, token: tokenOf(ctx), bankSig: entry.bankSig || "", rank: entry.rank || "", lastSeen: nowOf(ctx), offlineAt: null };
    s.seats.push(seat);
    s.seq++;
    refreshCardText(s);
    effects.push({ to: seat.fp, frame: frameOf(s, "welcome", welcomeBody(s, seat)) });
    return seat;
  }
  function seatAdmitted(s, ctx, effects) {
    var list = s.admitted; s.admitted = [];
    for (var i = 0; i < list.length; i++) {
      if (s.seats.length >= schema().MAX_SEATS) { effects.push({ to: list[i].fp, frame: frameOf(s, "reject", { reason: "Room is full." }) }); continue; }
      seatNow(s, list[i], ctx, effects);
    }
  }
  function advanceTurn(s) {
    var cur = s.turnSeat == null ? 0 : s.turnSeat;
    var sorted = s.seats.slice().sort(function (a, b) { return a.seatNo - b.seatNo; });
    var next = null;
    for (var i = 0; i < sorted.length; i++) if (sorted[i].seatNo > cur && sorted[i].online && !sorted[i].done) { next = sorted[i]; break; }
    if (!next) for (var j = 0; j < sorted.length; j++) if (sorted[j].online && !sorted[j].done) { next = sorted[j]; break; }
    if (next) s.turnSeat = next.seatNo;
    else { s.phase = "recap"; s.turnSeat = null; }
  }
  function recomputeBoardScore(s) {
    var cand = seatByNo(s, s.turnSeat);
    if (!cand) return;
    var total = 0;
    for (var idx in s.scores) { var per = s.scores[idx]; for (var seatNo in per) total += per[seatNo]; }
    cand.score = total;
  }
  function removeSeat(s, seatNo) {
    var seat = seatByNo(s, seatNo);
    if (!seat) return false;
    s.seats = s.seats.filter(function (x) { return x.seatNo !== seatNo; });
    if (s.phase === "play") {
      if (s.mode === "relay" && s.turnSeat === seatNo) advanceTurn(s);
      if (s.mode === "board" && s.turnSeat === seatNo) { s.phase = "recap"; s.turnSeat = null; s.lock = null; }
    }
    refreshCardText(s);
    return true;
  }
  function boundary(s, ctx, effects) { seatAdmitted(s, ctx, effects); }

  /* ----------------------------------------------------------- reduce */
  function reduceHost(state, frame, ctx) {
    var S = schema();
    var v = S.validate(frame);
    var effects = [];
    if (!v.ok) {
      if (v.reason === "version" && frame && typeof frame === "object" && frame.t === "hello" && S.isFingerprint(frame.from) && !state.terminal) {
        effects.push({ to: frame.from, frame: frameOf(state, "reject", { reason: S.VERSION_MISMATCH_TEXT }) });
        return ignored(state, v.reason, effects, skewOf(frame));
      }
      return ignored(state, v.reason, effects);
    }
    if (state.terminal || state.phase === "ended") return ignored(state, "ended");
    if (frame.room !== state.room) {
      if (frame.t === "hello") effects.push({ to: frame.from, frame: frameOf(state, "reject", { reason: "That code is not this room. Check the two words and the digits." }) });
      return ignored(state, "room", effects);
    }
    if (frame.from === state.self.fp && frame.t !== "intent") return ignored(state, "self");
    var now = nowOf(ctx), s, seat, b = frame.body, i;
    switch (frame.t) {
      case "hello": {
        s = clone(state);
        if (b.resume) {
          seat = null;
          for (i = 0; i < s.seats.length; i++) if (s.seats[i].token === b.resume && s.seats[i].fp !== s.self.fp) seat = s.seats[i];
          if (seat) {
            var wasOffline = !seat.online;
            seat.online = true; seat.offlineAt = null; seat.lastSeen = now; seat.fp = frame.from; seat.name = b.name; seat.bankSig = b.bankSig; seat.rank = b.rank || "";
            s.pending = s.pending.filter(function (p) { return p.fp !== frame.from; });
            s.seq++;
            refreshCardText(s);
            effects.push({ to: seat.fp, frame: frameOf(s, "welcome", welcomeBody(s, seat)) });
            return result(s, { accepted: true, changed: true, bump: true, reason: wasOffline ? "resumed" : "rehello", effects: effects });
          }
        }
        seat = seatByFp(s, frame.from);
        if (seat && seat.fp !== s.self.fp) {
          /* A seat is bound to its resume token, never to the fingerprint
             alone (X6): a hello from a seated fingerprint that does not
             carry the seat's token is a stranger who saw a snapshot, or a
             stale page - it gets a reject, no welcome, and the seat stays
             exactly as it was. */
          effects.push({ to: frame.from, frame: frameOf(state, "reject", { reason: HELD_SEAT_TEXT }) });
          return ignored(state, "token-required", effects);
        }
        for (i = 0; i < s.admitted.length; i++) if (s.admitted[i].fp === frame.from) {
          s.admitted[i].name = b.name; s.admitted[i].at = now;
          effects.push({ to: frame.from, frame: frameOf(s, "admit", { pending: true, atBoundary: true }) });
          return result(s, { accepted: true, changed: true, effects: effects });
        }
        if (s.seats.length + s.admitted.length >= S.MAX_SEATS) {
          effects.push({ to: frame.from, frame: frameOf(s, "reject", { reason: "Room is full." }) });
          return ignored(state, "full", effects);
        }
        var entry = null;
        for (i = 0; i < s.pending.length; i++) if (s.pending[i].fp === frame.from) entry = s.pending[i];
        if (!entry) { entry = { fp: frame.from }; s.pending.push(entry); }
        entry.name = b.name; entry.bankSig = b.bankSig; entry.rank = b.rank || ""; entry.at = now;
        effects.push({ to: frame.from, frame: frameOf(s, "admit", { pending: true }) });
        return result(s, { accepted: true, changed: true, effects: effects });
      }
      case "intent": {
        seat = seatByFp(state, frame.from);
        if (!seat || !seat.online) return ignored(state, "not-seated");
        var kind = b.kind;
        if (kind === "buzz") return ignored(state, "reserved");
        if (kind === "ready") {
          if (state.phase !== "lobby" || seat.ready) return ignored(state, "phase");
          s = clone(state); seatByFp(s, frame.from).ready = true; s.seq++;
          return result(s, { accepted: true, changed: true, bump: true });
        }
        if (state.phase !== "play") return ignored(state, "phase");
        if (kind === "score") {
          if (state.mode === "relay") {
            if (state.turnSeat !== seat.seatNo || seat.done) return ignored(state, "turn");
            s = clone(state); seat = seatByFp(s, frame.from);
            seat.score = b.value; seat.done = true; s.seq++;
            advanceTurn(s);
            boundary(s, ctx, effects);
            return result(s, { accepted: true, changed: true, bump: true, effects: effects });
          }
          if (!state.lock || state.lock.kind !== "scoring" || state.turnSeat === seat.seatNo) return ignored(state, "lock");
          if (b.value > (state.scaleMax == null ? 2 : state.scaleMax)) return ignored(state, "value");
          s = clone(state);
          var key = String(s.round.idx);
          s.scores[key] = s.scores[key] || {};
          s.scores[key][String(seat.seatNo)] = b.value;
          var scored = Object.keys(s.scores[key]).map(Number).sort(function (a, c) { return a - c; });
          s.lock.scored = scored;
          recomputeBoardScore(s);
          s.seq++;
          return result(s, { accepted: true, changed: true, bump: true });
        }
        if (kind === "answer") {
          if (state.mode !== "board" || state.turnSeat !== seat.seatNo || state.lock) return ignored(state, "lock");
          s = clone(state); s.lock = { kind: "scoring", scored: [] }; s.seq++;
          return result(s, { accepted: true, changed: true, bump: true });
        }
        if (kind === "advance-request") {
          if (state.mode !== "board" || state.turnSeat !== seat.seatNo || !state.lock || state.lock.advance) return ignored(state, "lock");
          s = clone(state); s.lock.advance = true; s.seq++;
          return result(s, { accepted: true, changed: true, bump: true });
        }
        return ignored(state, "kind");
      }
      case "bye": {
        seat = seatByFp(state, frame.from);
        if (seat) {
          if (!seat.online) return ignored(state, "offline");
          s = clone(state); seat = seatByFp(s, frame.from);
          seat.online = false; seat.offlineAt = now; s.seq++;
          return result(s, { accepted: true, changed: true, bump: true });
        }
        var np = state.pending.filter(function (p) { return p.fp !== frame.from; });
        var na = state.admitted.filter(function (p) { return p.fp !== frame.from; });
        if (np.length === state.pending.length && na.length === state.admitted.length) return ignored(state, "unknown");
        s = clone(state); s.pending = np; s.admitted = na;
        return result(s, { accepted: true, changed: true });
      }
      case "ping": {
        seat = seatByFp(state, frame.from);
        var known = seat || state.pending.some(function (p) { return p.fp === frame.from; }) || state.admitted.some(function (p) { return p.fp === frame.from; });
        if (!known) return ignored(state, "unknown");
        effects.push({ to: frame.from, frame: frameOf(state, "pong", { n: b.n }) });
        return result(state, { accepted: true, effects: effects });
      }
      case "pong": {
        seat = seatByFp(state, frame.from);
        if (!seat) {
          var waitingFor = state.pending.some(function (p) { return p.fp === frame.from; }) || state.admitted.some(function (p) { return p.fp === frame.from; });
          if (!waitingFor) return ignored(state, "unknown");
          return result(state, { accepted: true });
        }
        s = clone(state); seatByFp(s, frame.from).lastSeen = now;
        return result(s, { accepted: true, changed: true, render: false });
      }
      default:
        return ignored(state, "role");
    }
  }

  function actHost(state, action, ctx) {
    var S = schema();
    if (!action || typeof action !== "object") return ignored(state, "action");
    if (state.terminal || state.phase === "ended") return ignored(state, "ended");
    var now = nowOf(ctx), effects = [], s, i, seat;
    switch (action.type) {
      case "admit": {
        var entry = null;
        for (i = 0; i < state.pending.length; i++) if (state.pending[i].fp === action.fp) entry = state.pending[i];
        if (!entry) return ignored(state, "not-pending");
        s = clone(state);
        s.pending = s.pending.filter(function (p) { return p.fp !== action.fp; });
        if (s.seats.length + s.admitted.length >= S.MAX_SEATS) {
          effects.push({ to: entry.fp, frame: frameOf(s, "reject", { reason: "Room is full." }) });
          return result(s, { accepted: false, changed: true, reason: "full", effects: effects });
        }
        if (s.phase === "play") {
          s.admitted.push({ fp: entry.fp, name: entry.name, bankSig: entry.bankSig, rank: entry.rank, at: now });
          effects.push({ to: entry.fp, frame: frameOf(s, "admit", { pending: true, atBoundary: true }) });
          return result(s, { accepted: true, changed: true, effects: effects });
        }
        seatNow(s, entry, ctx, effects);
        return result(s, { accepted: true, changed: true, bump: true, effects: effects });
      }
      case "start": {
        if (state.phase !== "lobby") return ignored(state, "phase");
        var others = state.seats.filter(function (x) { return x.fp !== state.self.fp && x.online; });
        if (!others.length) return ignored(state, "need-a-seat");
        if (state.mode === "board" && !state.deck.ids.length) return ignored(state, "no-cards");
        s = clone(state);
        s.phase = "play";
        for (i = 0; i < s.seats.length; i++) { s.seats[i].done = false; s.seats[i].score = 0; }
        s.round.idx = 0;
        if (s.mode === "relay") { s.turnSeat = null; advanceTurn(s); s.cardId = null; s.cardText = null; s.lock = null; }
        else { var cand = others.slice().sort(function (a, b) { return a.seatNo - b.seatNo; })[0]; s.turnSeat = cand.seatNo; s.scores = {}; setCard(s); }
        s.seq++;
        return result(s, { accepted: true, changed: true, bump: true });
      }
      case "advance": case "skip": {
        if (state.phase !== "play") return ignored(state, "phase");
        s = clone(state);
        if (s.mode === "relay") {
          seat = seatByNo(s, s.turnSeat);
          if (seat) seat.done = true;
          advanceTurn(s);
        } else {
          s.round.idx++;
          if (s.round.idx >= s.round.total) { s.phase = "recap"; s.cardId = null; s.cardText = null; s.lock = null; }
          else setCard(s);
        }
        boundary(s, ctx, effects);
        s.seq++;
        return result(s, { accepted: true, changed: true, bump: true, effects: effects });
      }
      case "kick": {
        seat = seatByNo(state, action.seatNo);
        if (!seat || seat.fp === state.self.fp) return ignored(state, "seat");
        s = clone(state);
        removeSeat(s, action.seatNo);
        effects.push({ to: seat.fp, frame: frameOf(s, "kick", { seatNo: action.seatNo, reason: clip(action.reason || "Removed by the host.", 160) }) });
        s.seq++;
        return result(s, { accepted: true, changed: true, bump: true, effects: effects });
      }
      case "end": {
        s = clone(state);
        s.phase = "ended"; s.terminal = { kind: "ended", reason: clip(action.reason || "", 160) }; s.lock = null; s.seq++;
        var body = s.terminal.reason ? { reason: s.terminal.reason } : {};
        for (i = 0; i < s.seats.length; i++) if (s.seats[i].fp !== s.self.fp && s.seats[i].online) effects.push({ to: s.seats[i].fp, frame: frameOf(s, "end", body) });
        var waiting = s.pending.concat(s.admitted);
        for (i = 0; i < waiting.length; i++) effects.push({ to: waiting[i].fp, frame: frameOf(s, "end", body) });
        return result(s, { accepted: true, changed: true, effects: effects });
      }
      case "tick": {
        var timeout = state.cfg.pingMs * state.cfg.missLimit, changed = false, bump = false;
        s = clone(state);
        for (i = 0; i < s.seats.length; i++) {
          seat = s.seats[i];
          if (seat.fp === s.self.fp) continue;
          if (seat.online && now - seat.lastSeen > timeout) { seat.online = false; seat.offlineAt = now; changed = true; bump = true; }
        }
        var expired = s.seats.filter(function (x) { return x.fp !== s.self.fp && !x.online && x.offlineAt != null && now - x.offlineAt > s.cfg.holdMs; });
        for (i = 0; i < expired.length; i++) { removeSeat(s, expired[i].seatNo); changed = true; bump = true; }
        var np = s.pending.filter(function (p) { return now - p.at <= s.cfg.pendingMs; });
        var na = s.admitted.filter(function (p) { return now - p.at <= s.cfg.pendingMs; });
        if (np.length !== s.pending.length || na.length !== s.admitted.length) { s.pending = np; s.admitted = na; changed = true; }
        if (bump) { if (s.mode === "relay" && s.phase === "play" && s.turnSeat != null && !seatByNo(s, s.turnSeat)) advanceTurn(s); s.seq++; }
        if (!changed) return result(state, { accepted: true });
        return result(s, { accepted: true, changed: true, bump: bump });
      }
      default:
        return ignored(state, "action");
    }
  }

  function applySnapshot(s, snap) {
    s.seq = snap.seq; s.phase = snap.phase; s.mode = snap.mode; s.hostSeat = snap.hostSeat;
    s.cardId = snap.cardId == null ? null : snap.cardId; s.cardText = snap.cardText == null ? null : clone(snap.cardText);
    s.turnSeat = snap.turnSeat == null ? null : snap.turnSeat; s.lock = snap.lock == null ? null : clone(snap.lock); s.deadline = snap.deadline == null ? null : snap.deadline;
    s.round = snap.round ? clone(snap.round) : { idx: 0, total: 0 };
    s.seats = clone(snap.seats); s.hostSig = snap.bankSig == null ? null : snap.bankSig;
    s.deck = snap.deck ? clone(snap.deck) : { category: null, timerSec: null };
  }
  function reducePeer(state, frame, ctx) {
    var S = schema();
    var v = S.validate(frame);
    if (!v.ok) return ignored(state, v.reason);
    if (state.terminal) return ignored(state, "terminal");
    if (frame.t !== "reject" && frame.room !== state.room) return ignored(state, "room");
    if (state.hostFp && frame.from !== state.hostFp) return ignored(state, "not-host");
    var now = nowOf(ctx), s, b = frame.body, effects = [];
    switch (frame.t) {
      case "admit":
        s = clone(state); s.hostFp = frame.from; s.joinState = b.atBoundary ? "admitted" : "pending"; s.lastSeen = now;
        return result(s, { accepted: true, changed: true });
      case "welcome":
        s = clone(state); s.hostFp = frame.from; s.self.seatNo = b.seatNo; s.self.token = b.token; s.lastSeen = now;
        if (b.hold != null) s.holdMs = b.hold * 1000;
        /* 'apply only if seq is newer' holds for welcome too: a delayed
           re-hello welcome must not roll a seated peer's seq back. */
        if (state.joinState !== "seated" || b.snapshot.seq >= state.seq) applySnapshot(s, b.snapshot);
        s.joinState = "seated";
        return result(s, { accepted: true, changed: true });
      case "snapshot":
        if (state.joinState !== "seated") return ignored(state, "unadmitted");
        if (b.snapshot.seq <= state.seq) return ignored(state, "stale");
        s = clone(state); applySnapshot(s, b.snapshot); s.lastSeen = now;
        return result(s, { accepted: true, changed: true });
      case "reject":
        if (state.joinState === "seated") return ignored(state, "seated");
        s = clone(state); s.terminal = { kind: "rejected", reason: b.reason }; s.joinState = "hello";
        return result(s, { accepted: true, changed: true });
      case "kick":
        s = clone(state); s.terminal = { kind: "kicked", reason: b.reason || "Removed by the host." };
        return result(s, { accepted: true, changed: true });
      case "end":
        s = clone(state); s.phase = "ended"; s.terminal = { kind: "ended", reason: b.reason || "" };
        return result(s, { accepted: true, changed: true });
      case "bye":
        s = clone(state); s.terminal = { kind: "host-left", reason: "" };
        return result(s, { accepted: true, changed: true });
      case "ping":
        s = clone(state); s.lastSeen = now; if (!s.hostFp) s.hostFp = frame.from;
        effects.push({ to: frame.from, frame: frameOf(s, "pong", { n: b.n }) });
        return result(s, { accepted: true, changed: true, render: false, effects: effects });
      case "pong":
        s = clone(state); s.lastSeen = now;
        return result(s, { accepted: true, changed: true, render: false });
      default:
        return ignored(state, "role");
    }
  }
  function actPeer(state, action, ctx) {
    if (!action || typeof action !== "object") return ignored(state, "action");
    if (state.terminal) return ignored(state, "terminal");
    var now = nowOf(ctx), s;
    if (action.type === "tick") {
      if (now - state.lastSeen > state.cfg.pingMs * state.cfg.missLimit) {
        s = clone(state); s.terminal = { kind: "network-lost", reason: state.hostFp ? "No answer from the host." : "No host answered." };
        return result(s, { accepted: true, changed: true });
      }
      return result(state, { accepted: true });
    }
    return ignored(state, "action");
  }

  function reduce(state, frame, ctx) {
    if (!state) return ignored(state, "no-room");
    return state.role === "host" ? reduceHost(state, frame, ctx) : reducePeer(state, frame, ctx);
  }
  function act(state, action, ctx) {
    if (!state) return ignored(state, "no-room");
    return state.role === "host" ? actHost(state, action, ctx) : actPeer(state, action, ctx);
  }
  /* ==== GUEST-CORE END ==== */

  /* ================================================================ */
  /*                             RUNTIME                               */
  /* ================================================================ */

  var rt = {
    transport: null, state: null, identity: null, timers: [], mount: null, view: null, stage: null, header: null,
    counters: { received: 0, accepted: 0, ignored: {}, sent: 0, dropped: 0, renders: 0 },
    renderTimer: null, lastRender: 0, snapTimer: null, snapDirty: false, lastSnap: 0, pingN: 0,
    engineActive: false, selfScored: {}, myScores: {}, msg: "", ui: {
      mode: "relay", category: "All", count: 5, timerSec: 60, code: "", hotspot: "other",
      // Seat-name defaults (Chris, 2026-09-06): a study room can put a name in
      // front of a stranger on the same Wi-Fi/hotspot in a way a private
      // on-device profile never does, so these start from a call sign, not
      // G.profile's displayName(). null means "never spun or typed this
      // session" - drawIdle() fills it with a fresh spin on that first look
      // only, then reuses whatever is here (typed or spun) across any later
      // re-render (e.g. a mode toggle) so nothing gets clobbered. Host and
      // Join are independent fields with independent no-repeat guards.
      hostName: null, hostLastSpin: "", joinName: null, joinLastSpin: "",
    },
    byId: null, clock: null, skew: null, wakeLock: null,
  };
  var util = function () { return G.util; };
  var el = function (a, b, c) { return G.util.el(a, b, c); };

  function available() {
    try { return !!(G.store && typeof G.store.settings === "function" && G.store.settings().studyGroups === true); }
    catch (e) { return false; }
  }
  function ctxNow() { return { now: function () { return Date.now(); }, token: randomToken }; }
  /* The ladder's clock only (timers and the reducer keep Date.now()):
     a suite walks the 60 s ladder through _setClock. */
  function clockNow() { return rt.clock ? rt.clock() : Date.now(); }
  /* What THIS build is, for the hello's informational fields and the
     skew message - the stamps tools/build.mjs writes, never anything
     that identifies the device. */
  function localBuild() {
    return { build: typeof root.GUIDON_BUILD_SHA === "string" ? root.GUIDON_BUILD_SHA : "", app: typeof root.GUIDON_APP_VERSION === "string" ? root.GUIDON_APP_VERSION : "", v: schema().PROTOCOL_VERSION };
  }
  function holdMsOf(st) {
    if (!st) return DEFAULTS.holdMs;
    if (st.role === "host") return st.cfg && st.cfg.holdMs ? st.cfg.holdMs : DEFAULTS.holdMs;
    return st.holdMs || DEFAULTS.holdMs;
  }
  function countIgnored(reason) { rt.counters.ignored[reason] = (rt.counters.ignored[reason] || 0) + 1; }

  async function makeIdentity() {
    var c = root.crypto;
    try {
      if (c && c.subtle && typeof c.subtle.generateKey === "function") {
        var kp = await c.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
        var raw = await c.subtle.exportKey("raw", kp.publicKey);
        var dg = await c.subtle.digest("SHA-256", raw);
        return { fp: base32(new Uint8Array(dg).slice(0, 5)), kind: "ecdsa-p256", key: kp };
      }
    } catch (e) { /* fall through to the random token */ }
    return { fp: base32(randomBytes(16).slice(0, 5)), kind: "random128", key: null };
  }
  /* room-tls-and-discovery-pitch.md Section 1.1/1.3.6: when the attached
     transport already has a native, TLS-pinned identity (room-tauri.js's
     fp() getter, wired to rt.info.identity.fp - the same SPKI-derived
     value the "Secure join link" QR/text already pins to), host() should
     read THAT fp instead of minting a second, unrelated one via
     makeIdentity() - the whole point of the doc's channel-binding design
     is that the fp a human compares IS the TLS pin, not a coincidentally
     similar-looking but cryptographically unrelated JS keypair's own
     digest. Peers are unaffected (per the doc's own carve-out), so only
     host() calls this. */
  function nativeIdentityFp() {
    var t = rt.transport;
    try { if (t && typeof t.fp === "function") { var v = t.fp(); if (v) return String(v); } } catch (e) {}
    return null;
  }
  function displayName() {
    try { var p = G.profile && G.profile.cached ? G.profile.cached() : null; if (p && p.displayName) return String(p.displayName); } catch (e) {}
    return "GUEST";
  }
  /* Reads the ONE shared call-sign list off G.profile.CALLSIGNS (src/
     index.html's profile.js module - see the comment there) rather than a
     copy kept in this file. Replicates the onboarding dice's own no-repeat
     guard exactly: pick differs from `avoid` within up to 12 tries, same as
     the wizard's spin. Never touches anything device-identifying (no
     navigator.userAgent, no device/model string) - it only ever returns one
     of the curated CALLSIGNS entries, or "GUEST" if that list is somehow
     unavailable. */
  function spinCallsign(avoid) {
    var list = (G.profile && G.profile.CALLSIGNS) || [];
    if (!list.length) return "GUEST";
    var pick = avoid, guard = 0;
    while (pick === avoid && guard++ < 12) pick = list[Math.floor(Math.random() * list.length)];
    return pick;
  }
  function bankSigLocal() {
    try { return schema().bankSig(G.store.seed()); } catch (e) { return ""; }
  }
  function cardIndex() {
    if (rt.byId) return rt.byId;
    var m = {};
    try { var qs = (G.store.seed().board || {}).questions || []; for (var i = 0; i < qs.length; i++) m[qs[i].id] = qs[i]; } catch (e) {}
    rt.byId = m;
    return m;
  }
  function categories() {
    try { var qs = G.store.boardQuestions(); var seen = {}, out = []; for (var i = 0; i < qs.length; i++) if (!seen[qs[i].category]) { seen[qs[i].category] = 1; out.push(qs[i].category); } return out; } catch (e) { return []; }
  }
  function poolFor(category) {
    var all = [];
    try { all = G.store.boardQuestions(); } catch (e) {}
    if (!category || category === "All") return all;
    var f = all.filter(function (q) { return q.category === category; });
    return f.length ? f : all;
  }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function answerScale() {
    try { var sc = util().asArray(G.store.mockboard().answerScale); if (sc.length) return sc; } catch (e) {}
    return [{ id: "nailed", label: "Nailed it", points: 2 }, { id: "partial", label: "Partial", points: 1 }, { id: "missed", label: "Missed", points: 0 }];
  }
  function scaleMax() { var m = 0, sc = answerScale(); for (var i = 0; i < sc.length; i++) m = Math.max(m, sc[i].points || 0); return m || 2; }

  /* ------------------------------------------------------ transport */
  function attach(t) {
    if (!available()) return { ok: false, reason: "Study groups are off in Settings." };
    if (!t || typeof t.send !== "function" || typeof t.onmessage !== "function") return { ok: false, reason: "A transport needs send(frame, to) and onmessage(handler)." };
    /* previous is handed back so a caller that swaps the seam's transport
       (src/room-web.js does, for the lifetime of one join) can restore
       whatever was attached before it, later, through this SAME attach() -
       nothing here keeps that reference itself, and a caller that never
       reads it (every caller before room-web.js) changes nothing. */
    var previous = rt.transport;
    rt.transport = t;
    t.onmessage(deliver);
    if (typeof t.onclose === "function") t.onclose(function () { onTransportClosed(t); });
    if (typeof t.open === "function") { try { t.open(); } catch (e) {} }
    try { if (G.netLedger && G.netLedger.record) G.netLedger.record({ kind: String(t.kind || "seam"), peer: String(t.peer || "unknown"), at: Date.now() }); } catch (e) {}
    return { ok: true, previous: previous };
  }
  function onTransportClosed(t) {
    if (rt.transport !== t || !rt.state) return;
    if (rt.state.role === "peer" && !rt.state.terminal) {
      var prev = rt.state;
      rt.state = clone(rt.state);
      rt.state.terminal = { kind: "network-lost", reason: "The connection closed." };
      announceStateTransition(prev, rt.state);
      stopTimers();
      scheduleRender();
    }
  }
  /* Accessibility audit finding (H5): drawWaiting()/rosterTable()/
     drawTerminal() only ever rewrite DOM text on a join/leave/admit/kick/
     host-left/turn transition - with no aria-live region anywhere in this
     file and no util().announce() call for any of it (the only two
     announce() calls that existed were for the cosmetic call-sign dice
     spin). A blind/low-vision user gets no indication anything changed
     until they manually re-navigate the panel. Hooked at apply()/
     onTransportClosed() - the two places rt.state is actually REPLACED
     with a new value from a real state transition - rather than inside
     draw(), which re-renders the SAME state repeatedly and would announce
     on every redundant redraw, not just on a real change. Diffs prev vs
     next explicitly (never re-announces something already true) and only
     covers the specific transitions the audit named: admitted/seated,
     terminal reasons, your-turn, and seat join/online-offline - not every
     conceivable field change (e.g. per-card score ticks), which would be
     noisy rather than useful for a live multi-round session. */
  function announceStateTransition(prev, next) {
    if (!next) return;
    try {
      if (!util().announce) return;
      if (next.role === "peer" && (!prev || prev.joinState !== next.joinState)) {
        if (next.joinState === "pending") util().announce("Reaching the host. Waiting to be admitted.");
        else if (next.joinState === "admitted") util().announce("Admitted to the room. Waiting for the next card.");
        else if (next.joinState === "seated") util().announce("Seated in the room.");
      }
      var prevKind = prev && prev.terminal ? prev.terminal.kind : null;
      var nextKind = next.terminal ? next.terminal.kind : null;
      if (nextKind && nextKind !== prevKind) {
        var msg = nextKind === "host-left" ? "The host left the room."
          : nextKind === "network-lost" ? "Connection to the host was lost."
          : nextKind === "kicked" ? "You were removed from the room."
          : nextKind === "rejected" ? "The host turned down your request to join."
          : "The session has ended.";
        util().announce(msg);
      }
      if (next.phase === "play" && next.self && next.turnSeat === next.self.seatNo && (!prev || prev.turnSeat !== next.turnSeat)) {
        util().announce("Your turn.");
      }
      if (next.seats && next.self) {
        var prevMap = {};
        (prev && prev.seats ? prev.seats : []).forEach(function (s) { prevMap[s.seatNo] = s; });
        next.seats.forEach(function (s) {
          if (s.fp === next.self.fp) return; // don't announce the local user's own seat to themselves
          var p = prevMap[s.seatNo];
          if (!p) { util().announce(s.name + " joined the room."); return; }
          if (!!p.online !== !!s.online) util().announce(s.name + (s.online ? " reconnected." : " went offline."));
        });
      }
    } catch (e) {}
  }
  /* Optional seam hooks a transport MAY implement (src/room-tauri.js does;
     the harness transports do not): hostStart(room) when this device
     opens a room - the Rust listener needs the code before it binds -
     hostStop() when it leaves, notice() for one line the host screen
     shows under the join link (X10: "host from a phone instead"). Every
     call is guarded: a transport without the hook changes nothing. */
  /* Returns (and lets a caller await) hostStart()'s own promise - needed by
     host()'s nativeIdentityFp() check below, which otherwise reads
     rt.transport.fp() before room-tauri.js's room_start response has ever
     arrived to populate rt.info.identity (a real, measured bug in this
     session's own first pass at H7: the fire-and-forget version of this
     call meant nativeIdentityFp() always saw null and silently, always
     fell back to makeIdentity() - caught by test-room-tauri.mjs reporting
     "identity ecdsa-p256" against a REAL Tauri exe instead of the expected
     "native-tls"). A transport with no hostStart (room-web.js, every
     harness fake) still resolves this immediately via the guarded
     try/catch below, so awaiting it changes nothing for those forks. */
  function transportHostStart(room) { var t = rt.transport; try { if (t && typeof t.hostStart === "function") return t.hostStart(room); } catch (e) {} }
  function transportHostStop() { var t = rt.transport; try { if (t && typeof t.hostStop === "function") t.hostStop(); } catch (e) {} }
  function transportNotice() { var t = rt.transport; try { if (t && typeof t.notice === "function") return String(t.notice() || ""); } catch (e) {} return ""; }
  /* onended: the room is over for THIS transport - leave(), or a peer
     terminal other than network-lost (see apply()) - and it may want to
     close itself and/or hand the seam back to whatever was attached
     before it (src/room-web.js does both: it stashed the previous
     transport at attach() time and restores it here). Every other
     transport today (room-tauri.js's host adapter, every harness fake)
     has no onended, so calling this changes nothing for them - the same
     guarantee every other optional hook on this seam gives. */
  function transportOnEnded() { var t = rt.transport; try { if (t && typeof t.onended === "function") t.onended(); } catch (e) {} }
  function send(frame, to) {
    if (!rt.transport) return false;
    var v = schema().validate(frame);
    if (!v.ok) { rt.counters.dropped++; countIgnored("out:" + v.reason); return false; }
    try { rt.transport.send(frame, to == null ? null : to); rt.counters.sent++; return true; }
    catch (e) { rt.counters.dropped++; return false; }
  }
  function deliver(frame) {
    rt.counters.received++;
    if (!available()) { countIgnored("off"); return; }
    if (!rt.state) { countIgnored("no-room"); return; }
    apply(reduce(rt.state, frame, ctxNow()));
  }
  function apply(res) {
    if (!res) return;
    /* Captured BEFORE rt.state is replaced: transportOnEnded() fires once,
       the instant a PEER's terminal is newly reached - except
       network-lost, which keeps this same transport alive for "Try to
       reconnect" (reconnect() reuses the seam's CURRENT transport and
       never re-attaches one). */
    var wasTerminal = !!(rt.state && (rt.state.terminal || rt.state.phase === "ended"));
    var prevState = rt.state;
    rt.state = res.state;
    announceStateTransition(prevState, rt.state);
    if (res.accepted) rt.counters.accepted++; else countIgnored(res.reason || "?");
    if (res.skew) { rt.skew = res.skew; rt.msg = schema().skewText(res.skew, localBuild()); scheduleRender(); }
    for (var i = 0; i < res.effects.length; i++) send(res.effects[i].frame, res.effects[i].to);
    if (res.bump && rt.state && rt.state.role === "host") markSnapshot();
    if (res.render) scheduleRender();
    if (rt.state && (rt.state.terminal || rt.state.phase === "ended")) {
      stopTimers(); if (rt.snapTimer) { clearTimeout(rt.snapTimer); rt.snapTimer = null; } rt.snapDirty = false;
      if (!wasTerminal && rt.state.role === "peer" && (!rt.state.terminal || rt.state.terminal.kind !== "network-lost")) transportOnEnded();
    }
  }
  /* Both coalescers are LEADING-edge throttles: when the last flush/draw is
     older than the window the work happens right now, synchronously, inside
     the frame that caused it; only calls inside the window wait for a
     trailing timer. Measured in tools/test-room-session.mjs: a trailing-only
     timer left the host DOM behind its state for hundreds of ms under a
     stream of inbound frames (and a phone throttles background timers far
     harder), so inbound activity itself now drives the flushes - a 900-
     intent burst still yields one snapshot per 50 ms and one draw per
     100 ms, never one per frame. */
  function markSnapshot() {
    rt.snapDirty = true;
    var since = Date.now() - rt.lastSnap;
    if (since >= DEFAULTS.snapshotMs) { flushSnapshots(); return; }
    if (rt.snapTimer) return;
    rt.snapTimer = setTimeout(flushSnapshots, DEFAULTS.snapshotMs - since);
  }
  function flushSnapshots() {
    if (rt.snapTimer) { clearTimeout(rt.snapTimer); rt.snapTimer = null; }
    if (!rt.snapDirty || !rt.state || rt.state.role !== "host") { rt.snapDirty = false; return; }
    rt.snapDirty = false; rt.lastSnap = Date.now();
    var frames = snapshotFrames(rt.state);
    for (var i = 0; i < frames.length; i++) send(frames[i].frame, frames[i].to);
  }
  function startTimers() {
    stopTimers();
    var s = rt.state; if (!s) return;
    var pingMs = s.cfg.pingMs;
    if (s.role === "host") {
      rt.timers.push(setInterval(function () {
        var st = rt.state; if (!st || st.role !== "host" || st.terminal) return;
        var n = ++rt.pingN, i;
        for (i = 0; i < st.seats.length; i++) if (st.seats[i].fp !== st.self.fp && st.seats[i].online) send(frameOf(st, "ping", { n: n }), st.seats[i].fp);
        var waiting = st.pending.concat(st.admitted);
        for (i = 0; i < waiting.length; i++) send(frameOf(st, "ping", { n: n }), waiting[i].fp);
      }, pingMs));
      /* The lobby's no-joiners ladder moves with the clock, not with frames. */
      rt.timers.push(setInterval(function () {
        var st = rt.state; if (st && st.role === "host" && st.phase === "lobby" && !st.terminal) scheduleRender();
      }, 5000));
    }
    rt.timers.push(setInterval(function () {
      if (!rt.state || rt.state.terminal) return;
      apply(act(rt.state, { type: "tick" }, ctxNow()));
    }, Math.max(200, Math.floor(pingMs / 2))));
  }
  function stopTimers() { for (var i = 0; i < rt.timers.length; i++) clearInterval(rt.timers[i]); rt.timers = []; }
  function scheduleRender() {
    var since = Date.now() - rt.lastRender;
    if (since >= DEFAULTS.renderMs) {
      if (rt.renderTimer) { clearTimeout(rt.renderTimer); rt.renderTimer = null; }
      draw();
      return;
    }
    if (rt.renderTimer) return;
    rt.renderTimer = setTimeout(function () { rt.renderTimer = null; draw(); }, DEFAULTS.renderMs - since);
  }

  /* ------------------------------------------------------ entry points */
  /* Agnosticism audit, 6 Sep 2026 (device-agnostic): G.caps.js has probed
     for navigator.wakeLock since P2, but nothing ever CALLED request() -
     the Windows/Tauri host already holds a real OS-level keep-awake
     (src-tauri/src/room.rs, SetThreadExecutionState), so the gap was
     specifically the browser guest page, Android, iOS, and the peer role
     generally, all of which rely only on the ping/pong heartbeat's fixed
     5000ms x 3-missed-ping liveness window - a screen that sleeps mid-
     session can silently violate that with no warning. Requesting one
     more time on visibilitychange is required by the API itself: the OS
     releases a screen wake lock the instant the document goes hidden
     (tab-switch, phone locked with the app still "open"), and there is no
     event for "please hold it anyway" - only re-request once visible
     again, which is exactly this session's own recurring lesson (measure
     the real end-state, do not assume one request lasts the whole room). */
  async function requestWakeLock() {
    try {
      if (!(root.navigator && root.navigator.wakeLock && typeof root.navigator.wakeLock.request === "function")) return;
      if (rt.wakeLock) return;
      rt.wakeLock = await root.navigator.wakeLock.request("screen"); // floor-ok: the typeof check just above already returned on an engine without the API
      rt.wakeLock.addEventListener("release", function () { rt.wakeLock = null; });
    } catch (e) { rt.wakeLock = null; }
  }
  function releaseWakeLock() {
    try { if (rt.wakeLock) rt.wakeLock.release(); } catch (e) {}
    rt.wakeLock = null;
  }
  try {
    if (root.document && root.document.addEventListener) {
      root.document.addEventListener("visibilitychange", function () {
        if (root.document.visibilityState === "visible" && rt.state && !rt.state.terminal) requestWakeLock();
      });
    }
  } catch (e) {}

  async function host(opts) {
    opts = opts || {};
    if (!available()) return { ok: false, reason: "Study groups are off in Settings." };
    if (!rt.transport) return { ok: false, reason: "No room connection is attached on this build yet." };
    if (rt.state) leave();
    // Room code minted first (not inline inside initHost() below, as this
    // used to be) so it can be handed to transportHostStart() before any
    // local room state exists - awaiting that call is what makes
    // nativeIdentityFp() below actually see a populated identity, instead
    // of racing ahead of room-tauri.js's own room_start response.
    var room = schema().roomCode();
    await transportHostStart(room);
    var nativeFp = nativeIdentityFp();
    rt.identity = nativeFp ? { fp: nativeFp, kind: "native-tls", key: null } : await makeIdentity();
    var mode = opts.mode === "board" ? "board" : "relay";
    var category = opts.category == null ? "All" : opts.category;
    var pool = poolFor(category);
    var ids = [], cards = {};
    if (mode === "board") {
      var picked = shuffle(pool).slice(0, Math.max(1, Math.min(Number(opts.count) || 5, pool.length)));
      for (var i = 0; i < picked.length; i++) { ids.push(picked[i].id); cards[picked[i].id] = { q: picked[i].q, a: picked[i].a, category: picked[i].category }; }
    }
    var timerSec = opts.timerSec === undefined ? 60 : (opts.timerSec == null ? null : Number(opts.timerSec) || null);
    var st = initHost({
      room: room, mode: mode, self: { fp: rt.identity.fp, name: clip(opts.name || displayName(), schema().MAX_NAME), rank: opts.rank || "" },
      bankSig: bankSigLocal(), deck: { category: category === "All" ? null : category, timerSec: timerSec, ids: ids }, cards: cards, now: Date.now(),
      pingMs: opts.pingMs, missLimit: opts.missLimit, holdMs: opts.holdMs, pendingMs: opts.pendingMs, token: randomToken,
    });
    st.scaleMax = scaleMax();
    rt.state = st; rt.selfScored = {}; rt.myScores = {}; rt.msg = "";
    startTimers();
    scheduleRender();
    requestWakeLock();
    return { ok: true, room: st.room, fp: st.self.fp, identity: rt.identity.kind };
  }
  async function join(opts) {
    opts = opts || {};
    if (!available()) return { ok: false, reason: "Study groups are off in Settings." };
    if (!rt.transport) return { ok: false, reason: "No room connection is attached on this build yet." };
    var room = String(opts.room || "").trim().toUpperCase().replace(/\s+/g, "-");
    if (!schema().isRoomCode(room)) return { ok: false, reason: "A room code is two phonetic words and two digits, like ALPHA-BRAVO-42." };
    if (rt.state) leave();
    rt.identity = await makeIdentity();
    var st = initPeer({ room: room, self: { fp: rt.identity.fp, name: clip(opts.name || displayName(), schema().MAX_NAME), rank: opts.rank || "" }, bankSig: bankSigLocal(), now: Date.now(), pingMs: opts.pingMs, missLimit: opts.missLimit });
    rt.state = st; rt.selfScored = {}; rt.myScores = {}; rt.msg = "";
    sendHello(null);
    startTimers();
    scheduleRender();
    requestWakeLock();
    return { ok: true, fp: st.self.fp, identity: rt.identity.kind };
  }
  function sendHello(resume) {
    var st = rt.state;
    var body = { name: st.self.name, bankSig: st.bankSig };
    var lb = localBuild();
    if (lb.build) body.build = clip(lb.build, schema().MAX_BUILD);
    if (lb.app) body.app = clip(lb.app, schema().MAX_APP);
    if (resume) body.resume = resume;
    if (st.self.rank) body.rank = clip(st.self.rank, 8);
    return send(frameOf(st, "hello", body), st.hostFp || null);
  }
  function reconnect() {
    if (!available()) return { ok: false, reason: "Study groups are off in Settings." };
    if (!rt.transport) return { ok: false, reason: "No room connection is attached." };
    var st = rt.state;
    if (!st || st.role !== "peer") return { ok: false, reason: "Not in a room as a joiner." };
    if (st.terminal && st.terminal.kind !== "network-lost") return { ok: false, reason: "This room is over." };
    rt.state = clone(st);
    rt.state.terminal = null; rt.state.lastSeen = Date.now();
    if (!rt.state.self.token) rt.state.joinState = "hello";
    var sent = sendHello(rt.state.self.token || null);
    startTimers();
    scheduleRender();
    requestWakeLock();
    return { ok: sent, reason: sent ? "" : "Could not send." };
  }
  function leave() {
    var st = rt.state;
    if (rt.snapTimer) { clearTimeout(rt.snapTimer); rt.snapTimer = null; rt.snapDirty = false; }
    if (st && !st.terminal) {
      if (st.role === "host") {
        var i;
        for (i = 0; i < st.seats.length; i++) if (st.seats[i].fp !== st.self.fp && st.seats[i].online) send(frameOf(st, "bye", {}), st.seats[i].fp);
        var waiting = st.pending.concat(st.admitted);
        for (i = 0; i < waiting.length; i++) send(frameOf(st, "bye", {}), waiting[i].fp);
      } else if (st.hostFp || st.joinState !== "hello") {
        send(frameOf(st, "bye", {}), st.hostFp || null);
      }
    }
    stopTimers();
    endEngine();
    if (st && st.role === "host") transportHostStop();
    transportOnEnded();
    releaseWakeLock();
    rt.state = null; rt.selfScored = {}; rt.myScores = {};
    scheduleRender();
    return { ok: true };
  }
  function sendIntent(body) {
    if (!available()) return { ok: false, reason: "off" };
    var st = rt.state;
    if (!st) return { ok: false, reason: "no-room" };
    if (st.terminal || st.phase === "ended") return { ok: false, reason: "terminal" };
    if (st.role === "peer" && st.joinState !== "seated") return { ok: false, reason: "not-seated" };
    var frame = frameOf(st, "intent", body);
    var v = schema().validate(frame);
    if (!v.ok) return { ok: false, reason: v.reason };
    if (st.role === "host") { deliver(frame); return { ok: true, local: true }; }
    return { ok: send(frame, st.hostFp || null) };
  }
  function hostAction(action) {
    var st = rt.state;
    if (!available()) return { ok: false, reason: "off" };
    if (!st || st.role !== "host") return { ok: false, reason: "not-host" };
    var res = act(st, action, ctxNow());
    apply(res);
    return { ok: res.accepted, reason: res.reason };
  }
  function session() {
    var st = rt.state;
    if (!st) return { role: null, status: rt.transport ? "idle" : "no-transport", room: null, fp: rt.identity ? rt.identity.fp : null, seatNo: null };
    return { role: st.role, status: st.terminal ? st.terminal.kind : (st.role === "host" ? "hosting" : st.joinState), room: st.room, fp: st.self.fp, seatNo: st.self.seatNo, phase: st.phase };
  }

  /* ================================================================ */
  /*                               UI                                  */
  /* ================================================================ */

  function render(mount) {
    util().clear(mount);
    rt.mount = mount;
    mount.appendChild(el("div.section-title", {}, [el("h2", { text: "Study group" }), el("div.rule")]));
    var rootEl = el("div.sg-root");
    rt.view = el("div.sg-view");
    rt.stage = el("div.sg-stage");
    rootEl.appendChild(rt.view); rootEl.appendChild(rt.stage);
    mount.appendChild(rootEl);
    draw();
  }
  /* Focus preservation (audit finding M7): draw() fully clears and rebuilds
     `view` on every accepted frame, INCLUDING ones triggered purely by a
     remote peer's action, with zero focus/activeElement handling - worse
     here than leader.js's own already-fixed identical bug class (see its
     "Deep-gap follow-up" comment) since rebuilds here fire at unpredictable
     times driven by remote peers, not just the local user's own click.
     captureFocusKey()/restoreFocus() bracket the clear/rebuild in draw()
     below, keyed off the stable data-seat/data-fp attributes rosterTable()/
     pendingList() already stamp on their rows (so a "Remove"/"Admit" button
     re-lands focus on the SAME seat/joiner across a rebuild, not merely the
     same DOM position, which would be wrong the instant the sorted seat
     list reorders around it) - falling back to matching by CSS class for
     any other singleton control (Leave, Try to reconnect, etc.), and
     finally to the view container itself so focus never silently falls
     through to document.body when nothing else matches. */
  function captureFocusKey(view) {
    var el = document.activeElement;
    if (!el || !view.contains(el)) return null;
    var seatRow = el.closest ? el.closest("[data-seat]") : null;
    if (seatRow) return { kind: "seat", seat: seatRow.getAttribute("data-seat"), cls: el.className || "" };
    var fpEl = el.hasAttribute && el.hasAttribute("data-fp") ? el : (el.closest ? el.closest("[data-fp]") : null);
    if (fpEl) return { kind: "fp", fp: fpEl.getAttribute("data-fp") };
    if (el.className) return { kind: "class", cls: el.className };
    return { kind: "view" };
  }
  function restoreFocus(view, key) {
    if (!key) return;
    try {
      var target = null;
      if (key.kind === "seat") {
        var row = view.querySelector('[data-seat="' + key.seat + '"]');
        target = row ? row.querySelector("button") : null;
      } else if (key.kind === "fp") {
        target = view.querySelector('[data-fp="' + key.fp + '"]');
      } else if (key.kind === "class" && key.cls) {
        target = view.querySelector("." + String(key.cls).trim().split(/\s+/).join("."));
      }
      if (target && typeof target.focus === "function") { target.focus(); return; }
      // Nothing matching survived the rebuild (the row/control is gone,
      // e.g. the peer just got kicked or the screen changed entirely) -
      // land focus on the view container rather than losing it to
      // document.body silently.
      if (!view.hasAttribute("tabindex")) view.setAttribute("tabindex", "-1");
      view.focus();
    } catch (e) {}
  }
  function draw() {
    rt.lastRender = Date.now();
    if (!rt.mount || !rt.mount.isConnected || !rt.view) return;
    rt.counters.renders++;
    var view = rt.view;
    var focusKey = captureFocusKey(view);
    util().clear(view);
    var rootEl = view.parentElement;
    var st = rt.state;
    if (rootEl) { rootEl.setAttribute("data-sg-status", session().status || "idle"); rootEl.setAttribute("data-sg-phase", st ? st.phase : ""); }
    if (!available()) { drawOff(view); restoreFocus(view, focusKey); return; }
    if (!st) { drawIdle(view); restoreFocus(view, focusKey); return; }
    if (st.terminal) { drawTerminal(view, st); restoreFocus(view, focusKey); return; }
    if (st.role === "peer" && st.joinState !== "seated") { drawWaiting(view, st); restoreFocus(view, focusKey); return; }
    drawRoom(view, st);
    restoreFocus(view, focusKey);
  }
  function hint(text) { return el("p.hint", { text: text }); }
  function btn(cls, text, onClick, extra) {
    var b = el(cls ? "button." + cls : "button", Object.assign({ type: "button", text: text }, extra || {}));
    b.addEventListener("click", onClick);
    return b;
  }
  function go(hash) { location.hash = hash; }
  /* A bare room code is letters and digits and one dash (ALPHA-BRAVO-42);
     a pasted join link always carries at least one of "/", ":" or "." (a
     path, a port, or a host). Good enough to route the Join button without
     re-implementing src/room-web.js's own parser here - that parser (and
     its test suite) is the one place that actually decides what a string
     resolves to; this is only "which call do we make". */
  function looksLikeJoinLink(s) { return /[\/:.]/.test(String(s == null ? "" : s).trim()); }

  function drawOff(view) {
    var p = el("div.panel.sg-off", { style: "border-left:3px solid var(--amber)" });
    p.appendChild(el("div.eyebrow", { text: "Study groups are off" }));
    p.appendChild(el("p", { text: "Study groups (LAN rooms) are switched off in Settings, so this device will not host or join a room and opens no connection at all." }));
    p.appendChild(hint("Pass the device instead: Board Drill's Rapid Fire (Party and Team) and Mock Board all work on one device handed around the room, with nothing sent anywhere."));
    var row = el("div.btn-row", { style: "margin-top:10px" });
    row.appendChild(btn("btn.sm", "Open Settings", function () { go("#/settings"); }));
    row.appendChild(btn("btn.sm.ghost", "Open Board Drill", function () { go("#/board"); }, { style: "margin-left:6px" }));
    p.appendChild(row);
    view.appendChild(p);
  }

  function drawIdle(view) {
    if (!rt.transport) {
      var nt = el("div.panel.sg-notransport", { style: "margin-bottom:10px" });
      nt.appendChild(el("div.eyebrow", { text: "No room connection on this build yet" }));
      nt.appendChild(hint("Hosting and joining need the LAN room transport (next phase). Until then, pass the device: Rapid Fire's Party and Team modes and Mock Board work on one device."));
      view.appendChild(nt);
    }
    if (rt.msg) view.appendChild(el("div.feedback.warn.sg-msg", { text: rt.msg }));
    var grid = el("div.panel-grid-2");
    var hp = el("div.panel");
    hp.appendChild(el("div.eyebrow", { text: "Host a room" }));
    hp.appendChild(hint("Your device runs the room. Everyone joins on the same Wi-Fi or hotspot and you admit each one by hand."));
    var modeRow = el("div.segmented", { role: "group", "aria-label": "Room mode", style: "margin:8px 0" });
    [["relay", "Rapid-Fire relay"], ["board", "Mock Board Live"]].forEach(function (m) {
      var b = btn("", m[1], function () { rt.ui.mode = m[0]; draw(); }, { "aria-pressed": String(rt.ui.mode === m[0]) });
      if (rt.ui.mode === m[0]) b.classList.add("active");
      modeRow.appendChild(b);
    });
    hp.appendChild(modeRow);
    hp.appendChild(hint(rt.ui.mode === "board"
      ? "One candidate answers aloud; every other seat scores each answer on the board's own scale; you advance the cards. Only the candidate's own self-score is saved, on the candidate's device."
      : "Each seat plays one Party round on its own device, in seat order, and you tally the correct counts. Nothing is saved anywhere."));
    // Call-sign-first default (Chris, 2026-09-06), not displayName(): only
    // ever spun fresh on this field's true first look (rt.ui.hostName still
    // null) so a later re-render (the mode toggle above, say) reuses
    // whatever is already here instead of clobbering a typed or spun value.
    if (rt.ui.hostName == null) { rt.ui.hostName = spinCallsign(rt.ui.hostLastSpin); rt.ui.hostLastSpin = rt.ui.hostName; }
    var nameIn = el("input.sg-name", { type: "text", "aria-label": "Your seat name", value: rt.ui.hostName, maxlength: String(schema().MAX_NAME), style: "flex:1;margin:6px 0" });
    nameIn.addEventListener("input", function () { rt.ui.hostName = nameIn.value; });
    var hostDice = btn("btn.ghost.sg-name-dice", "\u{1F3B2}", function () {
      var pick = spinCallsign(rt.ui.hostLastSpin);
      rt.ui.hostLastSpin = pick; rt.ui.hostName = pick; nameIn.value = pick;
      try { if (util().announce) util().announce("Call sign: " + pick); } catch (e) {}
    }, { title: "Spin a random call sign", "aria-label": "Spin a random call sign", style: "flex:0 0 auto;font-size:1.15rem;padding:0 14px" });
    var nameRow = el("div", { style: "display:flex;gap:8px;align-items:stretch" });
    nameRow.appendChild(nameIn); nameRow.appendChild(hostDice);
    hp.appendChild(el("label", { text: "Seat name" })); hp.appendChild(nameRow);
    var catSel = el("select.sg-category", { "aria-label": "Category", style: "width:100%;margin:6px 0" });
    ["All"].concat(categories()).forEach(function (c) { var o = el("option", { value: c, text: c }); if (c === rt.ui.category) o.selected = true; catSel.appendChild(o); });
    catSel.addEventListener("change", function () { rt.ui.category = catSel.value; });
    hp.appendChild(el("label", { text: "Category" })); hp.appendChild(catSel);
    var extraSel;
    if (rt.ui.mode === "board") {
      extraSel = el("select.sg-count", { "aria-label": "Cards per board", style: "width:100%;margin:6px 0" });
      [3, 5, 8, 10, 15].forEach(function (n) { var o = el("option", { value: String(n), text: n + " cards" }); if (n === rt.ui.count) o.selected = true; extraSel.appendChild(o); });
      extraSel.addEventListener("change", function () { rt.ui.count = Number(extraSel.value); });
      hp.appendChild(el("label", { text: "Cards" }));
    } else {
      extraSel = el("select.sg-timer", { "aria-label": "Round timer", style: "width:100%;margin:6px 0" });
      [[30, "30s"], [60, "60s"], [90, "90s"], ["", "Untimed"]].forEach(function (t) { var o = el("option", { value: String(t[0]), text: t[1] }); if (String(rt.ui.timerSec == null ? "" : rt.ui.timerSec) === String(t[0])) o.selected = true; extraSel.appendChild(o); });
      extraSel.addEventListener("change", function () { rt.ui.timerSec = extraSel.value === "" ? null : Number(extraSel.value); });
      hp.appendChild(el("label", { text: "Round timer" }));
    }
    hp.appendChild(extraSel);
    hp.appendChild(btn("btn.primary.sg-host", "Host a room", function () {
      rt.msg = "";
      host({ mode: rt.ui.mode, name: nameIn.value, category: rt.ui.category, count: rt.ui.count, timerSec: rt.ui.timerSec }).then(function (r) { if (!r.ok) { rt.msg = r.reason; draw(); } });
    }, { style: "margin-top:8px" }));
    grid.appendChild(hp);

    var jp = el("div.panel");
    jp.appendChild(el("div.eyebrow", { text: "Join a room" }));
    jp.appendChild(hint("Type the code the host reads out - two phonetic words and two digits - or paste the join link they showed you."));
    var codeIn = el("input.sg-join-code", { type: "text", "aria-label": "Room code or join link", placeholder: "ALPHA-BRAVO-42 or a pasted link", value: rt.ui.code, autocapitalize: "off", autocorrect: "off", spellcheck: "false", style: "width:100%;margin:6px 0" });
    codeIn.addEventListener("input", function () { rt.ui.code = codeIn.value; });
    jp.appendChild(el("label", { text: "Room code or join link" })); jp.appendChild(codeIn);
    // Independent from the Host panel above: its own persisted value and its
    // own no-repeat guard (rt.ui.joinLastSpin), so spinning one panel never
    // affects what the other panel considers "last".
    if (rt.ui.joinName == null) { rt.ui.joinName = spinCallsign(rt.ui.joinLastSpin); rt.ui.joinLastSpin = rt.ui.joinName; }
    var jname = el("input.sg-join-name", { type: "text", "aria-label": "Your seat name", value: rt.ui.joinName, maxlength: String(schema().MAX_NAME), style: "flex:1;margin:6px 0" });
    jname.addEventListener("input", function () { rt.ui.joinName = jname.value; });
    var joinDice = btn("btn.ghost.sg-name-dice", "\u{1F3B2}", function () {
      var pick = spinCallsign(rt.ui.joinLastSpin);
      rt.ui.joinLastSpin = pick; rt.ui.joinName = pick; jname.value = pick;
      try { if (util().announce) util().announce("Call sign: " + pick); } catch (e) {}
    }, { title: "Spin a random call sign", "aria-label": "Spin a random call sign", style: "flex:0 0 auto;font-size:1.15rem;padding:0 14px" });
    var jnameRow = el("div", { style: "display:flex;gap:8px;align-items:stretch" });
    jnameRow.appendChild(jname); jnameRow.appendChild(joinDice);
    jp.appendChild(el("label", { text: "Seat name" })); jp.appendChild(jnameRow);
    jp.appendChild(btn("btn.primary.sg-join", "Join", function () {
      rt.msg = "";
      var raw = codeIn.value, name = jname.value;
      /* A pasted link routes through src/room-web.js's join-only WebSocket
         transport (joinAt() parses it, attaches, then calls this SAME
         join() below itself); a bare code keeps calling join({room,name})
         exactly as before - byte for byte - so its current, honest "no
         address to resolve it to" failure is unchanged (LAN discovery from
         a code alone is a separate, later phase, not this one). */
      var rw = root.__GUIDON_ROOM_WEB__;
      var call = (looksLikeJoinLink(raw) && rw && typeof rw.joinAt === "function")
        ? rw.joinAt(raw, name)
        : join({ room: raw, name: name });
      call.then(function (r) { if (!r.ok) { rt.msg = r.reason; draw(); } });
    }, { style: "margin-top:8px" }));
    grid.appendChild(jp);
    view.appendChild(grid);
    var pv = el("div.panel", { style: "margin-top:10px" });
    pv.appendChild(el("div.eyebrow", { text: "What leaves this device" }));
    pv.appendChild(hint("Only the room's own frames: your seat name, a per-session fingerprint, card ids and the scores of the round. No grade, no review schedule and nothing about anyone else is ever saved here. See the Privacy Policy."));
    view.appendChild(pv);
  }

  function drawTerminal(view, st) {
    var k = st.terminal.kind;
    var p = el("div.panel.sg-terminal", { "data-kind": k, style: "border-left:3px solid var(--red)" });
    var title = k === "host-left" ? "The host left the room" : k === "network-lost" ? "Connection to the host was lost" : k === "rejected" ? "The host turned this join down" : k === "kicked" ? "Removed from the room" : "The session has ended";
    p.appendChild(el("div.eyebrow", { text: title }));
    if (st.terminal.reason) p.appendChild(el("p", { text: st.terminal.reason }));
    if (k === "rejected" && st.terminal.reason === schema().VERSION_MISMATCH_TEXT) p.appendChild(hint("This device: " + schema().buildLabel(localBuild()) + ". Update the older GUIDON, then join again."));
    if (k === "host-left") p.appendChild(hint("Nothing from this room was saved on this device. Ask the host to open a new room, or pass the device and keep drilling."));
    if (k === "network-lost") p.appendChild(hint("Your seat is held for " + Math.round(holdMsOf(st) / 1000) + " s. Move back into range of the hotspot and try to reconnect."));
    if (k === "ended" && st.seats && st.seats.length) p.appendChild(rosterTable(st));
    var row = el("div.btn-row", { style: "margin-top:10px" });
    if (k === "network-lost" && st.role === "peer") row.appendChild(btn("btn.primary.sg-reconnect", "Try to reconnect", function () { var r = reconnect(); if (!r.ok) { rt.msg = r.reason; draw(); } }, { style: "margin-right:6px" }));
    row.appendChild(btn("btn.sg-leave", "Back", function () { leave(); }));
    p.appendChild(row);
    view.appendChild(p);
  }

  function drawWaiting(view, st) {
    var p = el("div.panel.sg-waiting", { "data-join": st.joinState });
    p.appendChild(el("div.eyebrow", { text: "Room " + st.room }));
    p.appendChild(el("div.sg-room-code", { text: st.room, style: "font-size:1.6rem;font-weight:700;letter-spacing:.06em;margin:6px 0" }));
    if (st.joinState === "hello") p.appendChild(el("p", { text: "Reaching the host..." }));
    else if (st.joinState === "pending") p.appendChild(el("p", { text: "Waiting for the host to admit you. Your seat name: " + st.self.name + " (" + st.self.fp + ")." }));
    else p.appendChild(el("p", { text: "Admitted - you get a seat at the next card." }));
    p.appendChild(hint("The host admits each joiner by hand. Nothing is stored on this device by joining."));
    p.appendChild(btn("btn.sm.ghost.sg-leave", "Leave", function () { leave(); }));
    view.appendChild(p);
  }

  function rosterTable(st) {
    var wrap = el("div.sg-roster");
    var sorted = st.seats.slice().sort(function (a, b) { return a.seatNo - b.seatNo; });
    sorted.forEach(function (x) {
      var mine = st.role === "host" ? x.fp === st.self.fp : x.seatNo === st.self.seatNo;
      var row = el("div.sg-seat", { "data-seat": String(x.seatNo), "data-online": String(!!x.online), "data-fp": x.fp, style: "display:flex;gap:10px;align-items:center;padding:4px 0" + (x.online ? "" : ";opacity:.55") });
      row.appendChild(el("span", { text: String(x.seatNo), style: "font-family:var(--mono, monospace);min-width:1.6em" }));
      var label = x.name + (x.seatNo === st.hostSeat ? " (host)" : "") + (mine ? " - you" : "");
      row.appendChild(el("span", { text: label, style: "flex:1" }));
      if (st.phase === "play" && st.turnSeat === x.seatNo) row.appendChild(el("span.sg-turn", { text: st.mode === "board" ? "candidate" : "playing", style: "color:var(--ink-amber)" }));
      if (st.phase === "lobby") row.appendChild(el("span", { text: x.ready ? "ready" : "", style: "color:var(--ink-green)" }));
      if (st.phase !== "lobby") row.appendChild(el("span.sg-score-cell", { text: (st.mode === "board" && x.seatNo !== st.turnSeat && st.phase !== "recap") ? "" : String(x.score), style: "min-width:2em;text-align:right" }));
      row.appendChild(el("span", { text: x.online ? "" : "held", style: "color:var(--ink-red)" }));
      // Confirmation gate added per audit finding H6: this was the one
      // destructive roster control in this file skipping the app's shared
      // confirm-dialog convention (leader.js:338-341 gates its identically-
      // labeled "Remove" button the same way for a far less consequential
      // local-only removal) - a mis-tap here instantly, irreversibly
      // ejects a live participant with no undo.
      if (st.role === "host" && x.fp !== st.self.fp) row.appendChild(btn("btn.sm.ghost.sg-kick", "Remove", async function () {
        var yes = await G.modal.confirm("Remove " + x.name + " from the room?", { okText: "Remove", danger: true });
        if (!yes) return;
        hostAction({ type: "kick", seatNo: x.seatNo });
      }, { "aria-label": "Remove " + x.name + " from the room" }));
      wrap.appendChild(row);
    });
    return wrap;
  }
  function pendingList(st) {
    var wrap = el("div.sg-pending");
    if (!st.pending.length && !st.admitted.length) return wrap;
    wrap.appendChild(el("div.eyebrow", { text: "Waiting to be admitted", style: "margin-top:10px" }));
    st.pending.forEach(function (p) {
      var row = el("div", { style: "display:flex;gap:10px;align-items:center;padding:4px 0" });
      row.appendChild(el("span", { text: p.name + " (" + p.fp + ")", style: "flex:1" }));
      if (p.bankSig !== st.bankSig) row.appendChild(el("span", { text: "different question bank", style: "color:var(--ink-amber)" }));
      row.appendChild(btn("btn.sm.primary.sg-admit", "Admit", function () { hostAction({ type: "admit", fp: p.fp }); }, { "data-fp": p.fp, "aria-label": "Admit " + p.name }));
      wrap.appendChild(row);
    });
    st.admitted.forEach(function (p) {
      wrap.appendChild(el("div", { text: p.name + " - admitted, seated at the next card", style: "padding:4px 0" }));
    });
    return wrap;
  }
  function cardFor(st) {
    if (!st.cardId) return null;
    // Agnosticism audit, 6 Sep 2026: st.cardText is the host's inlined
    // text, sent specifically BECAUSE refreshCardText() detected a bankSig
    // mismatch across the room. Checking the local corpus lookup first (as
    // this used to) meant the host's correction was silently discarded
    // whenever the id still happened to exist locally - the common case
    // for a same-id, edited-wording change - which made cardText's whole
    // inlining mechanism a no-op for exactly the drift it exists to catch.
    // Host-supplied text now wins whenever it's present; the local index
    // is the fallback for a truly missing id (a structurally different
    // bank), not the default.
    if (st.cardText) return { q: st.cardText.q, a: st.cardText.a, category: st.cardText.category || "", source: "" };
    var q = cardIndex()[st.cardId];
    if (q) return { q: q.q, a: q.a, category: q.category, source: q.source || "" };
    return null;
  }
  function mySeatNo(st) { return st.role === "host" ? st.self.seatNo : st.self.seatNo; }

  /* ---------------- host-screen UX ladder (X9) ---------------- */
  function joinUrlFor(st) {
    var t = rt.transport;
    try { if (t && typeof t.joinUrl === "function") return String(t.joinUrl(st.room) || ""); } catch (e) {}
    try { var loc = root.location; if (loc && /^https?:$/.test(loc.protocol) && loc.host) return schema().joinUrl(loc.protocol + "//" + loc.host, st.room); } catch (e) {}
    return "";
  }
  /* room-tls-and-discovery-pitch.md Section 1.3.6/stage 4-5. "" (never a
     throw) on every fork/build that has no secure link to offer: a
     transport with no secureJoinUrl() hook at all (every harness fake,
     room-web.js's own transports, a Tauri build whose Rust side predates
     tlsPort/identity) is exactly as silent as a missing joinUrl() above -
     drawHostLadder() below treats empty as "nothing to add", never a
     broken half-rendered section. */
  function secureJoinUrlFor(st) {
    var t = rt.transport;
    try { if (t && typeof t.secureJoinUrl === "function") return String(t.secureJoinUrl(st.room) || ""); } catch (e) {}
    return "";
  }
  function isLaptop() { try { return !(root.matchMedia && root.matchMedia("(pointer: coarse)").matches); } catch (e) { return true; } }
  /* Shared by drawHostLadder() for BOTH the plain and the secure join link -
     factored out so a second link block doesn't just duplicate the QR-vs-
     dashed-placeholder branch verbatim. Appends eyebrow + large URL text +
     (a real QR via G.qrcode.render(), or the dashed placeholder) + the
     matching hint line into `box`; `wrapClass` scopes each block's own
     .sg-join-url/.sg-qr-wrap/.sg-qr-slot under a distinct wrapper class so
     a page with both blocks present still has exactly one of each selector
     PER block, never two indistinguishable top-level matches. */
  function appendJoinLinkBlock(box, wrapClass, label, url, ariaLabel, hintWithQr, hintNoQr) {
    var inner = el("div." + wrapClass, { style: "margin-bottom:10px" });
    inner.appendChild(el("div.eyebrow", { text: label }));
    inner.appendChild(el("div.sg-join-url", { text: url, style: "font-size:1.4rem;font-weight:700;line-height:1.25;word-break:break-all;margin:4px 0 8px" }));
    /* Room-networking pitch, Stage 1.5 ("QR render on the host screen"):
       a real ISO/IEC 18004 QR code (src/app-modules/qrcode.js), encoding
       this SAME url string already shown as plain text one line above.
       render() never throws and returns null for anything it cannot
       represent (module missing, or a future join link too long for the
       encoder's supported version range) - falling back to the original
       dashed-box plain-text placeholder is the correct, deliberate
       behaviour in that case, not a bug: the link/code above always
       still works even when the QR does not render. */
    var qrNode = null;
    try { if (G.qrcode && typeof G.qrcode.render === "function") qrNode = G.qrcode.render(url, { ariaLabel: ariaLabel }); } catch (e) {}
    if (qrNode) {
      var qrWrap = el("div.sg-qr-wrap", { style: "display:inline-block;padding:8px;background:#fff;border-radius:8px;margin-bottom:6px;line-height:0" });
      qrNode.style.maxWidth = "14rem";
      qrNode.style.height = "auto";
      qrWrap.appendChild(qrNode);
      inner.appendChild(qrWrap);
      inner.appendChild(hint(hintWithQr));
    } else {
      inner.appendChild(el("div.sg-qr-slot", { text: url, "aria-label": "QR code placeholder", style: "border:2px dashed currentColor;border-radius:8px;padding:14px;font-family:var(--mono, monospace);font-size:.8rem;word-break:break-all;max-width:22rem;margin-bottom:6px" }));
      inner.appendChild(hint(hintNoQr));
    }
    box.appendChild(inner);
  }
  function drawHostLadder(head, st) {
    var t = rt.transport;
    var url = joinUrlFor(st);
    var secureUrl = secureJoinUrlFor(st);
    var box = el("div.sg-invite", { style: "margin-top:10px" });
    if (url) {
      /* Once a secure option exists, the plain link needs its own label so
         it isn't mistaken for THE join link - it's now specifically the
         browser/guest-page path, and the secure one below is what the
         GUIDON app itself should use. With no secure link on this build,
         it stays exactly "Join link", unchanged. */
      appendJoinLinkBlock(box, "sg-invite-plain", secureUrl ? "Join link (browser or guest page)" : "Join link", url, "QR code for the join link",
        "Joiners can scan this QR code, or type the link or the code by hand.",
        "Joiners type this link or the code. No scannable QR code on this build.");
    } else {
      box.appendChild(hint("No join link on this build - read the code out."));
    }
    if (secureUrl) {
      appendJoinLinkBlock(box, "sg-invite-secure", "Secure join link (for the GUIDON app)", secureUrl, "QR code for the secure join link",
        "The GUIDON app can scan this QR code to join over a pinned, encrypted connection.",
        "The GUIDON app can join over this secure link. No scannable QR code on this build.");
    }
    // R-ROOM address listing: when this device has more than one advertisable
    // IPv4 (a VPN adapter up alongside real Wi-Fi, say), show the rest so the
    // host can read out a different one if joiners can't reach the picked one.
    var addrs = [];
    try { if (t && typeof t.addresses === "function") addrs = t.addresses() || []; } catch (e) {}
    if (addrs.length > 1) {
      var alt = el("details.sg-alt-addresses", { style: "margin:4px 0 8px" });
      alt.appendChild(el("summary", { text: "This device has " + addrs.length + " network addresses - try another if the link above doesn't work" }));
      addrs.forEach(function (a) {
        alt.appendChild(el("div.hint", { text: (a.name || "?") + ": " + (a.ip || "?"), style: "font-family:var(--mono, monospace)" }));
      });
      box.appendChild(alt);
    }
    var tn = transportNotice();
    if (tn) box.appendChild(el("div.feedback.warn.sg-transport-notice", { text: tn, style: "margin-top:8px" }));
    var others = st.seats.filter(function (x) { return x.fp !== st.self.fp && x.online; }).length;
    if (!others && !st.pending.length && !st.admitted.length) {
      var elapsed = clockNow() - (st.createdAt || clockNow());
      var tier = elapsed < 20000 ? 0 : elapsed < 40000 ? 1 : 2;
      var lad = el("div.sg-ladder", { "data-tier": String(tier), style: "margin-top:8px" });
      if (tier === 0) lad.appendChild(el("p", { text: "Waiting for the first joiner..." }));
      else if (tier === 1) lad.appendChild(el("p", { text: "No one yet? Check that everyone is on the same Wi-Fi or hotspot as this device - a phone on mobile data cannot see this room." }));
      else {
        lad.appendChild(el("p", { text: "Still no one. Ask a joiner to try typing the link above exactly as shown, then admit them below." }));
        if (isLaptop()) lad.appendChild(el("p", { text: "On a laptop, host from a phone instead: a phone's hotspot reaches every device in the room without the laptop's firewall in the way." }));
      }
      box.appendChild(lad);
    }
    var hs = el("div.sg-hotspot", { style: "margin-top:8px" });
    hs.appendChild(el("div.eyebrow", { text: "Who is the hotspot?" }));
    var seg = el("div.segmented", { role: "group", "aria-label": "Hotspot" });
    [["self", "sg-hotspot-self", "I am the hotspot"], ["other", "sg-hotspot-other", "Someone else is"]].forEach(function (o) {
      var b = btn(o[1], o[2], function () { rt.ui.hotspot = o[0]; draw(); }, { "aria-pressed": String(rt.ui.hotspot === o[0]) });
      if (rt.ui.hotspot === o[0]) b.classList.add("active");
      seg.appendChild(b);
    });
    hs.appendChild(seg);
    var auto = rt.ui.hotspot !== "self";
    hs.appendChild(el("p.hint.sg-gateway", { "data-auto": String(auto), text: auto
      ? "Auto-detect: joiners reach this device at the address the network gave it - the link above."
      : "You are the hotspot (auto-detect off): joiners use your hotspot's own address, which is what the link above shows - read it out as shown." }));
    box.appendChild(hs);
    head.appendChild(box);
  }
  function capWarning(st) {
    return el("div.feedback.warn.sg-cap-warn", { text: "Seat " + HOTSPOT_CAP + ": most phone hotspots allow " + HOTSPOT_CAP + " connected devices, and the hotspot phone may count as one. A further joiner may not connect - open a second room or use a router.", style: "margin-top:8px" });
  }

  function drawRoom(view, st) {
    var isHost = st.role === "host";
    var head = el("div.panel", { style: "margin-bottom:10px" });
    head.appendChild(el("div.eyebrow", { text: (st.mode === "board" ? "Mock Board Live" : "Rapid-Fire relay") + " - room " + st.room }));
    head.appendChild(el("div.sg-room-code", { text: st.room, style: "font-size:1.6rem;font-weight:700;letter-spacing:.06em;margin:6px 0" }));
    if (st.phase === "lobby") head.appendChild(hint(isHost ? "Read this code out. Each joiner enters it, then you admit them one at a time below." : "Waiting for the host to start."));
    if (rt.msg) head.appendChild(el("div.feedback.warn.sg-msg", { text: rt.msg }));
    if (isHost && st.phase === "lobby") drawHostLadder(head, st);
    view.appendChild(head);

    if (st.phase === "play") {
      if (st.mode === "relay") drawRelay(view, st); else drawBoard(view, st);
    } else if (st.phase === "recap") {
      var rp = el("div.panel.sg-recap", { style: "margin-bottom:10px" });
      rp.appendChild(el("div.eyebrow", { text: st.mode === "board" ? "Board complete" : "Relay complete" }));
      rp.appendChild(hint(st.mode === "board" ? "Total points the board awarded the candidate are shown on the candidate's seat. Nothing from this board is saved on any device except the candidate's own self-scores." : "Correct counts per seat, tallied by the host. Nothing from this relay is saved on any device."));
      view.appendChild(rp);
    }

    var roster = el("div.panel", { style: "margin-bottom:10px" });
    roster.appendChild(el("div.eyebrow", { text: "Seats" }));
    roster.appendChild(rosterTable(st));
    if (isHost && st.seats.length >= HOTSPOT_CAP) roster.appendChild(capWarning(st));
    if (isHost) roster.appendChild(pendingList(st));
    view.appendChild(roster);

    var ctl = el("div.btn-row");
    if (isHost) {
      if (st.phase === "lobby") {
        var others = st.seats.filter(function (x) { return x.fp !== st.self.fp && x.online; }).length;
        var startBtn = btn("btn.primary.sg-start", "Start", function () { hostAction({ type: "start" }); });
        startBtn.disabled = !others || (st.mode === "board" && !st.deck.ids.length);
        ctl.appendChild(startBtn);
      }
      if (st.phase === "recap") ctl.appendChild(btn("btn.primary.sg-end", "End session", function () { hostAction({ type: "end" }); }));
      ctl.appendChild(btn("btn.ghost.sg-leave", st.phase === "lobby" ? "Close room" : "Leave room", function () { leave(); }, { style: "margin-left:6px" }));
    } else {
      if (st.phase === "lobby") {
        var me = st.seats.filter(function (x) { return x.seatNo === st.self.seatNo; })[0];
        if (me && !me.ready) ctl.appendChild(btn("btn.primary.sg-ready", "Ready", function () { sendIntent({ kind: "ready" }); }));
      }
      ctl.appendChild(btn("btn.ghost.sg-leave", "Leave room", function () { leave(); }, { style: "margin-left:6px" }));
    }
    view.appendChild(ctl);
  }

  function drawRelay(view, st) {
    var isHost = st.role === "host";
    var p = el("div.panel.sg-relay", { style: "margin-bottom:10px" });
    var turn = st.seats.filter(function (x) { return x.seatNo === st.turnSeat; })[0];
    var mine = st.turnSeat != null && st.turnSeat === mySeatNo(st);
    if (rt.engineActive) {
      p.appendChild(el("div.eyebrow", { text: "Your round is running" }));
      p.appendChild(hint("Judge Correct or Pass on each card; End Round sends your correct count to the host."));
    } else if (mine) {
      var me = st.seats.filter(function (x) { return x.seatNo === st.turnSeat; })[0];
      p.appendChild(el("div.eyebrow", { text: "Your turn" }));
      p.appendChild(hint("Pass the device to one Soldier if you are playing Party-style, or hold it yourself: the screen shows the question, everyone else gives clues out loud, and the holder taps Correct or Pass." + (st.deck.timerSec ? " " + st.deck.timerSec + " s on the clock." : " Untimed - End Round when you are done.")));
      if (me && !me.done) p.appendChild(btn("btn.primary.sg-play-round", "Start my round", startMyRound));
    } else {
      p.appendChild(el("div.eyebrow", { text: turn ? turn.name + "'s round" : "Between rounds" }));
      p.appendChild(hint(turn ? "Waiting for " + turn.name + " to finish. Seats play in order; you will see your own Start button when it is your turn." : "Waiting for the host."));
      if (isHost && turn && !turn.online) p.appendChild(btn("btn.sm.ghost.sg-advance", "Skip this seat (held)", function () { hostAction({ type: "skip" }); }));
    }
    view.appendChild(p);
  }
  function startMyRound() {
    var st = rt.state;
    if (!st || rt.engineActive || !rt.stage) return;
    if (!G.board || typeof G.board.rapidFireEngine !== "function") { rt.msg = "Rapid Fire's round engine is not available in this build."; draw(); return; }
    /* G.board.enterTheater/exitTheater are assigned inside renderDrill()
       (Board Drill's first tab) and the round engine calls both
       unconditionally. A Soldier who opens a room before ever opening Board
       Drill has neither yet: install no-op stand-ins, which renderDrill
       replaces with the real pair the moment that tab renders. The relay
       round then plays inline in the room instead of fullscreen - the
       roster stays visible, which is what a relay wants anyway. */
    if (typeof G.board.enterTheater !== "function") G.board.enterTheater = function () {};
    if (typeof G.board.exitTheater !== "function") G.board.exitTheater = function () {};
    rt.engineActive = true;
    draw();
    util().clear(rt.stage);
    var hostEl = el("div.sg-engine");
    rt.stage.appendChild(hostEl);
    var deck = st.deck || {};
    Promise.resolve(G.board.rapidFireEngine(hostEl)).then(function (eng) {
      if (!rt.engineActive || !rt.state || rt.state.room !== st.room) { rt.engineActive = false; util().clear(rt.stage); return; }
      eng.cfg.timerSec = deck.timerSec == null ? null : deck.timerSec;
      eng.cfg.passedBehavior = "requeue";
      eng.cfg.soundHaptics = true;
      var pool = poolFor(deck.category == null ? "All" : deck.category);
      if (!pool.length) { finishMyRound(0); return; }
      eng.beginRound(pool, "party", {
        onFinish: function (stats) { finishMyRound(stats && stats.correctCount ? stats.correctCount : 0); },
        onLeave: function () { finishMyRound(0); },
      });
    }).catch(function () { finishMyRound(0); });
  }
  function finishMyRound(n) {
    endEngine();
    sendIntent({ kind: "score", value: Math.max(0, Math.min(schema().MAX_SCORE, Math.floor(n) || 0)) });
    scheduleRender();
  }
  function endEngine() {
    if (rt.engineActive) { try { if (G.board && G.board.exitTheater) G.board.exitTheater(); } catch (e) {} }
    rt.engineActive = false;
    if (rt.stage) util().clear(rt.stage);
  }

  function drawBoard(view, st) {
    var isHost = st.role === "host";
    var me = mySeatNo(st);
    var candidate = st.seats.filter(function (x) { return x.seatNo === st.turnSeat; })[0];
    var amCandidate = st.turnSeat != null && st.turnSeat === me;
    var card = cardFor(st);
    var idx = st.round ? st.round.idx : 0, total = st.round ? st.round.total : 0;
    var p = el("div.panel.sg-board", { style: "margin-bottom:10px" });
    p.appendChild(el("div.eyebrow", { text: "Card " + (idx + 1) + " of " + total + " - candidate: " + (candidate ? candidate.name : "?") }));
    var c = el("div.sg-card");
    if (card) {
      c.appendChild(el("div.mb-cat.sg-cat", { text: card.category }));
      c.appendChild(el("div.mb-q.sg-q", { text: card.q }));
      if (st.lock) {
        var aw = el("div.mb-answer.sg-answer-panel");
        aw.appendChild(el("div.mb-a-label", { text: "Doctrinal answer" }));
        aw.appendChild(el("div.mb-a.sg-a", { text: card.a }));
        if (card.source) aw.appendChild(el("div.mb-a-src", { text: card.source }));
        c.appendChild(aw);
      }
    } else {
      c.appendChild(el("p", { text: "This card is not in this device's question bank - update GUIDON on one device so both carry the same bank." }));
    }
    p.appendChild(c);
    var scale = answerScale();
    if (amCandidate) {
      if (!st.lock) {
        p.appendChild(hint("Answer out loud, as you would to the board. Then tap below so the board can score you."));
        p.appendChild(btn("btn.primary.sg-answer", "I've answered - reveal", function () { sendIntent({ kind: "answer" }); }));
      } else if (!rt.selfScored[idx]) {
        p.appendChild(hint("Now score yourself honestly. This is the only thing saved from the room, on this device only - the same review schedule the solo Mock Board feeds."));
        var row = el("div.mb-score-row.sg-self-row");
        scale.forEach(function (sc) {
          var level = sc.points >= 2 ? 2 : sc.points >= 1 ? 1 : 0;
          var b = btn("mb-score-btn.score-" + sc.id + ".sg-self-score", sc.label, function () {
            rt.selfScored[idx] = level;
            try {
              if (st.cardId && G.board && G.board.noteExternalResult) {
                G.board.noteExternalResult(st.cardId, level).then(function (r) { if (r == null && util().toast) util().toast("Couldn't save that grade to your review schedule."); });
              }
            } catch (e) {}
            sendIntent({ kind: "advance-request" });
            draw();
          }, { "data-level": String(level), title: sc.d || "" });
          row.appendChild(b);
        });
        p.appendChild(row);
      } else {
        p.appendChild(hint("Self-score saved to your review schedule. Waiting for the host to advance."));
      }
    } else {
      if (!st.lock) p.appendChild(hint((candidate ? candidate.name : "The candidate") + " is answering aloud. The doctrinal answer appears when they tap \"I've answered\"."));
      else {
        var scored = st.lock.scored || [];
        var myVal = rt.myScores[idx];
        p.appendChild(hint("Score the answer you just heard. You can change it until the host advances." + (scored.length ? " Scored so far: " + scored.length + "." : "")));
        var srow = el("div.mb-score-row.sg-score-row");
        scale.forEach(function (sc) {
          var b = btn("mb-score-btn.score-" + sc.id + ".sg-score", sc.label, function () {
            rt.myScores[idx] = sc.points;
            var body = { kind: "score", value: sc.points };
            if (st.cardId) body.cardId = st.cardId;
            sendIntent(body);
            draw();
          }, { "data-value": String(sc.points), title: sc.d || "", "aria-pressed": String(myVal === sc.points) });
          if (myVal === sc.points) b.classList.add("active");
          srow.appendChild(b);
        });
        p.appendChild(srow);
      }
    }
    if (isHost) {
      var adv = btn("btn.sg-advance", idx + 1 >= total ? "Finish board" : "Next card", function () { hostAction({ type: "advance" }); }, { style: "margin-top:10px" });
      p.appendChild(adv);
      if (st.lock && st.lock.advance) p.appendChild(hint("The candidate is ready for the next card."));
    }
    view.appendChild(p);
  }

  /* The kill switch gates everything, live: flipping it off mid-session
     leaves the room (bye to everyone, nothing kept) and either way the
     #/group screen redraws - a hash that does not change fires no
     hashchange, so the route would otherwise keep the stale panel. */
  if (G.util && typeof G.util.on === "function") {
    G.util.on("settings:change", function (d) {
      if (!d || d.k !== "studyGroups") return;
      if (!available() && rt.state) leave();
      scheduleRender();
    });
  }

  G.studyGroup = {
    DEFAULTS: DEFAULTS, NEEDS_SHELL_TEXT: NEEDS_SHELL_TEXT,
    initHost: initHost, initPeer: initPeer, reduce: reduce, act: act, snapshotOf: snapshotOf, snapshotFrames: snapshotFrames, frameOf: frameOf,
    available: available, attach: attach, host: host, join: join, leave: leave, reconnect: reconnect, sendIntent: sendIntent, hostAction: hostAction,
    state: function () { return rt.state; }, session: session, counters: function () { return rt.counters; }, identity: function () { return rt.identity ? { fp: rt.identity.fp, kind: rt.identity.kind } : null; },
    render: render, _deliver: deliver, _flush: flushSnapshots, _redraw: scheduleRender, HOTSPOT_CAP: HOTSPOT_CAP,
    /* Harness-only: the ladder's clock (null restores Date.now()). */
    _setClock: function (fn) { rt.clock = typeof fn === "function" ? fn : null; },
    /* Harness-only introspection of the runtime plumbing (no state). */
    _debug: function () {
      return { renderTimer: !!rt.renderTimer, snapTimer: !!rt.snapTimer, mountConnected: !!(rt.mount && rt.mount.isConnected), viewConnected: !!(rt.view && rt.view.isConnected), viewInDom: !!(rt.view && document.contains(rt.view)), lastRender: rt.lastRender, now: Date.now(), renders: rt.counters.renders, engineActive: rt.engineActive, timers: rt.timers.length, hasTransport: !!rt.transport,
        roots: document.querySelectorAll(".sg-root").length, views: document.querySelectorAll(".sg-view").length, firstViewIsLive: document.querySelector(".sg-view") === rt.view, routeFrames: (document.getElementById("route") || { children: [] }).children.length, liveViewHead: rt.view ? rt.view.innerHTML.slice(0, 160) : "" };
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
// END studygroup.js
