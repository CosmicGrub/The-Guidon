/* ==== js/room-web.js ==== */
/* GUIDON - room-web.js : the in-app plain-WebSocket JOIN transport
   (window.__GUIDON_ROOM_WEB__). Collective roadmap P4b (in-app room
   joining, 2026-09-05): src/room-tauri.js gives the Tauri PC a place to
   HOST a room; nothing before this file let ANY fork - Tauri included -
   JOIN one from inside the app itself, which is why tapping "Join a room"
   in the main app did nothing on every fork (the root cause behind the
   "why does it turn into a webpage" question - dist/guest.html is the
   ONLY thing that could ever join, because it is the only page that ever
   opened a socket). This file is that missing half: G.studyGroup's ONE
   transport seam (attach({ send, onmessage, open?, onclose?, onended? }),
   src/app-modules/studygroup.js) implemented over a plain outbound
   WebSocket, usable on EVERY fork - Android/Capacitor, PWA, plain web and
   Tauri's own WebView2 can all open one, so unlike room-tauri.js this
   module carries NO fork guard and never self-attaches: it does nothing
   at load beyond defining window.__GUIDON_ROOM_WEB__, and only attaches
   when a Soldier actually asks to join (joinAt() below), the same way
   host()/join() themselves are seam calls, never load-time side effects.

   Two real hazards this module owns, and nowhere else does:

   1. QUEUE BEFORE OPEN. G.studyGroup.join() calls sendHello() SYNCHRONOUSLY
      right after attach() returns (studygroup.js's join(), immediately
      after initPeer()) - long before a brand-new WebSocket's handshake can
      possibly finish (readyState 0 CONNECTING, not 1 OPEN). Every frame
      handed to send() while the socket is not OPEN is queued here, in
      order, and flushed the instant onopen fires. This is the ONE fix;
      studygroup.js's join()/sendHello call sequence is untouched.

   2. RECONNECT REOPENS ITSELF. reconnect() (peer-only) calls sendHello()
      again through this SAME attached transport and never calls open()
      again - there is no seam hook for "reopen a transport", and adding
      one would mean touching studygroup.js's reconnect() for a need only
      THIS transport has. Instead send() itself notices a closed or
      missing socket and transparently opens a fresh one to the SAME
      stored target before queuing/flushing, so "Try to reconnect" Just
      Works with zero change to reconnect() itself.

   PARSING. parse(input) is the ONE place this project turns a pasted join
   link (or a bare room code) into a dial target - tested directly by
   tools/test-room-web.mjs so it can never quietly drift from the shape
   G.roomSchema.joinUrl() actually produces or from dist/guest.html's own
   codeFromUrl (src/guest.html), which this mirrors. A bare code with no
   host to reach fails immediately and honestly (LAN discovery - finding a
   host from a code alone with no link - is a separate, larger, not-yet-
   built project) instead of hanging on "Reaching the host..." forever.

   ENDING. attach() (studygroup.js) now hands back whatever transport was
   attached before it, as `previous`, so a caller that swaps the seam's
   transport can put it back later - nothing in studygroup.js itself keeps
   that reference, and a caller that never reads it (every existing one)
   changes nothing. joinAt() below is the one caller that does: it stashes
   `previous` (room-tauri.js's own host transport, on a Tauri PC that was
   not currently hosting - or nothing, everywhere else) and restores it,
   through the SAME attach(), the moment the room is over. That "moment"
   is the transport's own optional onended hook - see studygroup.js's
   transportOnEnded() - fired by leave() and by a peer terminal state other
   than network-lost (which keeps this same transport alive for "Try to
   reconnect"). A fork with nothing stashed restores nothing: unchanged.

   PACKAGING. Splices into web/index.html only (tools/build.mjs), spliced
   immediately after room-tauri.js so G.studyGroup/G.roomSchema/G.caps
   already exist, and - like room-tauri.js - is asserted absent from
   dist/guidon-standalone.html: that file is a single offline HTML page
   with no server nearby, and joining a LAN room is a networked feature
   with nothing to dial from inside it. */
(function (root) {
  "use strict";
  root.G = root.G || {};
  var G = root.G;

  function schema() { return G.roomSchema; }

  /* Mirrors dist/guest.html's own codeFromUrl (src/guest.html): a room
     code lives at /j/<code> in the path, case-insensitive, uppercased
     before validation. ONE regex, here, is what both a pasted join link
     and (via build.mjs's verbatim copy into the guest page) the guest
     page's own address bar agree on. */
  var ROOM_PATH_RE = /\/j\/([A-Za-z]+-[A-Za-z]+-[0-9]{2})/;

  function normalizeCode(s) {
    return String(s == null ? "" : s).trim().toUpperCase().replace(/\s+/g, "-");
  }

  /** parse(input) -> exactly one of:
        { kind: "url",  hostPort, room }  a resolvable join link: dial hostPort (host:port, no scheme - what `new URL(x).host` gives), join room
        { kind: "code", room }            a syntactically valid room code with no address to reach it at
        { kind: "invalid" }               neither
      Never throws. The ONE parser this project uses for a pasted join
      target - unit-tested directly (tools/test-room-web.mjs) against a
      full URL, a URL with a trailing slash, a URL with extra query
      params, a bare code, and garbage. */
  function parse(input) {
    var raw = String(input == null ? "" : input).trim();
    if (!raw) return { kind: "invalid" };
    /* Accept the link with or without a scheme: a host reads the link out
       WITH "http://" on it (G.roomSchema.joinUrl()'s own shape), but a
       Soldier pasting from a text message may drop it. */
    var candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? [raw] : ["http://" + raw];
    for (var i = 0; i < candidates.length; i++) {
      var u = null;
      try { u = new URL(candidates[i]); } catch (e) { u = null; }
      if (!u || !u.host) continue;
      var m = ROOM_PATH_RE.exec(u.pathname);
      if (m) {
        var room = m[1].toUpperCase();
        if (schema().isRoomCode(room)) return { kind: "url", hostPort: u.host, room: room };
      }
    }
    var bare = normalizeCode(raw);
    if (schema().isRoomCode(bare)) return { kind: "code", room: bare };
    return { kind: "invalid" };
  }

  /* ---------------------------------------------------- the transport */
  /** makeTransport(hostPort, room) - one outbound WebSocket to ONE fixed
      target for the lifetime of a join. See the header for the two
      hazards this closes over (queue-before-open, reconnect-reopens). */
  function makeTransport(hostPort, room) {
    var ws = null, queue = [], handler = null, closeHandler = null, endedHandler = null, closedForGood = false;

    function ensureSocket() {
      if (closedForGood) return null;
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) return ws;
      var sock;
      try { sock = new WebSocket(schema().wsUrl(hostPort, room, "peer")); } catch (e) { return null; }
      ws = sock;
      sock.onopen = function () {
        if (ws !== sock) return;
        var pending = queue;
        queue = [];
        for (var i = 0; i < pending.length; i++) { try { sock.send(pending[i]); } catch (e) {} }
      };
      sock.onmessage = function (ev) {
        if (ws !== sock || !handler) return;
        var d = null;
        try { d = schema().wireDecode(String(ev.data)); } catch (e) { d = null; }
        if (d && d.frame) { try { handler(d.frame); } catch (e) {} }
      };
      sock.onclose = function () {
        if (ws !== sock) return;
        ws = null;
        if (closedForGood) return;
        /* An unexpected drop - not this module's own onended() closing on
           purpose (that sets closedForGood first). studygroup.js's
           onTransportClosed (wired by attach() through the optional
           onclose hook) turns this into the peer's "network-lost"
           terminal; reconnect() then calls send() again, which reopens a
           fresh socket right here via ensureSocket() above. */
        if (closeHandler) { try { closeHandler(); } catch (e) {} }
      };
      sock.onerror = function () { /* onclose always follows an onerror */ };
      return sock;
    }

    return {
      kind: "room-web-ws", peer: hostPort,
      send: function (frame, to) {
        var sock = ensureSocket();
        if (!sock) return false;
        var text = schema().wireEncode(frame, to == null ? null : to);
        if (sock.readyState === 1) {
          try { sock.send(text); return true; } catch (e) { return false; }
        }
        queue.push(text); // readyState 0 (CONNECTING): flushed by onopen above
        return true;
      },
      onmessage: function (h) { handler = typeof h === "function" ? h : null; },
      onclose: function (h) { closeHandler = typeof h === "function" ? h : null; },
      open: function () {},
      /* Optional seam hook (attach()'s own rule: "a transport without the
         hook changes nothing"). studygroup.js calls this once the room is
         over for good - leave(), or a peer terminal other than
         network-lost. Closes the socket for good (further send()s refuse,
         they do not reopen) and restores whatever transport joinAt()
         stashed, if any. */
      onended: function () {
        if (closedForGood) return;
        closedForGood = true;
        queue = [];
        if (ws) { var w = ws; ws = null; try { w.close(1000, "bye"); } catch (e) {} }
        if (endedHandler) { var fn = endedHandler; endedHandler = null; try { fn(); } catch (e) {} }
      },
      /* joinAt()-only: registers what onended() runs once, after which it
         forgets it (a second onended() call - leave() AFTER a terminal
         already fired it - is then a plain no-op, guarded above). */
      _setEndedRestore: function (fn) { endedHandler = fn; },
    };
  }

  /** joinAt(urlOrCode, name) -> the same shape G.studyGroup.join() itself
      returns ({ ok, fp, identity } or { ok:false, reason }). Parses the
      input; a resolvable link attaches a fresh transport there (stashing
      whatever was attached before, restored on end) and joins through
      join()'s EXISTING, unmodified {room, name} signature - callers that
      never pass a url still work byte-for-byte as before, because this
      function is never in their call path. A bare code fails immediately:
      there is nothing here to resolve it to an address with. */
  function joinAt(urlOrCode, name) {
    var sg = G.studyGroup;
    if (!sg || typeof sg.attach !== "function" || typeof sg.join !== "function") {
      return Promise.resolve({ ok: false, reason: "The room module is not loaded on this build." });
    }
    var target = parse(urlOrCode);
    if (target.kind === "code") {
      return Promise.resolve({ ok: false, reason: "That's a room code with no address to reach the host at yet - paste the full join link the host showed instead. Finding a host from the code alone needs LAN discovery, a later phase." });
    }
    if (target.kind !== "url") {
      return Promise.resolve({ ok: false, reason: "That doesn't look like a room code or a join link. Paste the link the host showed, or type the code, like ALPHA-BRAVO-42." });
    }
    /* join()'s own guard (`if (rt.state) leave();`) runs AFTER attach()
       below would already have swapped in the new transport, so a leave
       triggered from inside join() would tear down the transport this
       call is trying to join through, not whatever was there before -
       the new hello would then go out over a transport already mid-
       restore. Leave any existing room FIRST, through whatever transport
       is CURRENTLY attached, so join()'s internal guard is a no-op by the
       time it runs (rt.state is already null) and the new attach() below
       is the only transport swap in play. Not reachable via any shipped
       UI path today (the Join panel only renders when no room is active)
       but real if this is ever called with a room already open - fixed
       at the root rather than left as a latent ordering hazard. */
    if (typeof sg.state === "function" && sg.state() && typeof sg.leave === "function") sg.leave();
    var t = makeTransport(target.hostPort, target.room);
    var r = sg.attach(t);
    if (!r || !r.ok) return Promise.resolve({ ok: false, reason: (r && r.reason) || "Could not attach the room connection." });
    var previous = r.previous || null;
    t._setEndedRestore(function () {
      if (!previous) return;
      var prev = previous; previous = null;
      try { sg.attach(prev); } catch (e) {}
    });
    return sg.join({ room: target.room, name: name });
  }

  root.__GUIDON_ROOM_WEB__ = { joinAt: joinAt, parse: parse, _makeTransport: makeTransport };
})(typeof window !== "undefined" ? window : globalThis);
// END room-web.js
