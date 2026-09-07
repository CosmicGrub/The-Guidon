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

   SECURE ROUTING (room-tls-and-discovery-pitch.md Section 1.3.6, added
   2026-09-06). A link whose origin is https:// (G.roomSchema.isSecureOrigin())
   is a TLS-pinned room: the actual pin travels as the link's OWN #pin=<hex>
   fragment (G.roomSchema.pinFromUrl()), never guessed or defaulted. parse()
   below resolves both signals up front so callers see all three cases a
   secure-looking link can be in - see its own comment for the exact shape.
   joinAt() then picks the transport:
     - plain (http) target: today's makeTransport(), unchanged, byte for byte.
     - secure target, a valid pin, AND a native pinning capability present
       (window.Capacitor?.Plugins?.RoomTls today - Android only, checked
       fresh on every join, never cached, since it can differ app to app):
       makeNativeTransport() below, over that plugin's connect/send/close +
       roomTlsEvent surface, never a raw WebSocket.
     - secure target with no valid pin, OR no native capability present:
       an IMMEDIATE, HONEST refusal ({ok:false, reason}) - see
       SECURE_NO_NATIVE_TEXT / SECURE_BAD_PIN_TEXT below for the exact
       wording. A plain `new WebSocket("wss://...")` against a self-signed,
       unpinned certificate cannot succeed from ANY JS context (the pitch
       doc's whole reason a native half exists at all) - so this module
       never attempts one, and never silently downgrades a link the host
       advertised as secure to an insecure ws:// connection either.
   makeNativeTransport() carries the SAME two hazards as makeTransport()
   below, translated to an async connect() in place of a synchronous
   `new WebSocket(...)` - see its own header comment for exactly how.

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
        { kind: "url",  hostPort, room, secure, pin }
            a resolvable join link: dial hostPort (host:port, no scheme -
            what `new URL(x).host` gives), join room. `secure` and `pin`
            (added 2026-09-06, room-tls-and-discovery-pitch.md Section
            1.3.6) distinguish the THREE states a resolved link can be in -
            never guessed, always read straight off the link itself:
              secure:false, pin:null        a plain http:// link (today's
                                             only case before this change;
                                             pin is always null here)
              secure:true,  pin:<64-hex>     an https:// link with a valid
                                             #pin=<hex> fragment - the
                                             complete, connectable case
              secure:true,  pin:null         an https:// link with NO valid
                                             pin (missing fragment, or one
                                             that fails isSpkiPin's shape
                                             check) - an incomplete or
                                             corrupted secure link, never a
                                             reason to guess a pin or fall
                                             back to plain ws://
            joinAt() below is the one caller that reads secure/pin.
        { kind: "code", room }            a syntactically valid room code with no address to reach it at
        { kind: "invalid" }               neither
      Never throws. The ONE parser this project uses for a pasted join
      target - unit-tested directly (tools/test-room-web.mjs) against a
      full URL, a URL with a trailing slash, a URL with extra query
      params, a bare code, garbage, and (2026-09-06) the three secure-link
      states above. */
  function parse(input) {
    var raw = String(input == null ? "" : input).trim();
    if (!raw) return { kind: "invalid" };
    /* Accept the link with or without a scheme: a host reads the link out
       WITH "http://" on it (G.roomSchema.joinUrl()'s own shape), but a
       Soldier pasting from a text message may drop it. A link with no
       scheme at all is ALWAYS treated as plain http:// here (never
       upgraded to https:// by guessing) - so `secure` below can only ever
       be true when `raw` itself already spelled out "https://", which is
       exactly the case pinFromUrl(raw) needs to read the pin fragment. */
    var candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? [raw] : ["http://" + raw];
    for (var i = 0; i < candidates.length; i++) {
      var u = null;
      try { u = new URL(candidates[i]); } catch (e) { u = null; }
      if (!u || !u.host) continue;
      var m = ROOM_PATH_RE.exec(u.pathname);
      if (m) {
        var room = m[1].toUpperCase();
        if (schema().isRoomCode(room)) {
          var secure = schema().isSecureOrigin(u.origin);
          // pinFromUrl() reads the ORIGINAL pasted text (raw), before the
          // room code above gets uppercased - a fragment's hex is already
          // lowercase-or-nothing (isSpkiPin's own shape), so nothing here
          // needs to survive normalization except the origin swap already
          // done above via `u`, which pinFromUrl() never touches.
          var pin = secure ? schema().pinFromUrl(raw) : null;
          return { kind: "url", hostPort: u.host, room: room, secure: secure, pin: pin };
        }
      }
    }
    var bare = normalizeCode(raw);
    if (schema().isRoomCode(bare)) return { kind: "code", room: bare };
    return { kind: "invalid" };
  }

  /* --------------------------------------------- native TLS capability */
  /** window.Capacitor?.Plugins?.RoomTls, or null - the SAME access pattern
      every other Capacitor plugin in this codebase uses (src/biometric.js,
      src/native.js: `Cap.Plugins.<Name>`, guarded by presence, never a
      second, invented shape). Checked fresh on every call, never cached -
      a build could plausibly gain or lose this plugin between joins (a
      hot-reloaded dev build, say), and there is exactly one call site
      (joinAt() below) that needs the answer. */
  function nativeTlsPlugin() {
    try {
      var C = root.Capacitor;
      return (C && C.Plugins && C.Plugins.RoomTls) || null;
    } catch (e) { return null; }
  }
  var SECURE_NO_NATIVE_TEXT = "That's a secure join link (wss://, pinned to the host's TLS identity) - this build has no native TLS connector to dial it with, and a plain WebSocket can never complete that handshake from here, on any device. Open the link in the GUIDON Android app instead, or ask the host for the plain (non-secure) link if the app isn't available.";
  var SECURE_BAD_PIN_TEXT = "That secure join link is missing its pin, or the pin doesn't look right - without it there is nothing to verify the host's TLS identity against, and connecting anyway would defeat the whole point of a secure link. Ask the host to resend the link exactly as shown, or re-scan its QR code.";

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

  /* One roomTlsEvent listener for the plugin's whole lifetime (module-
     scoped, registered lazily on the first native connect() any transport
     ever makes) - Capacitor's addListener is a SINGLE stream from the
     plugin, not one per call, so every native transport this module ever
     creates (one join, a reconnect, a later join to a different room) is
     routed by matching the event's own `id` against whichever transport
     instance currently owns that id. Registering a fresh listener per
     transport would leak one on every reconnect; this never does. */
  var nativeListenerPlugin = null;
  var nativeIdHandlers = new Map();
  function ensureNativeListener(plugin) {
    if (nativeListenerPlugin === plugin) return;
    nativeListenerPlugin = plugin;
    try {
      plugin.addListener("roomTlsEvent", function (ev) {
        var h = ev && nativeIdHandlers.get(ev.id);
        if (!h) return;
        if (ev.type === "open" && h.onOpen) h.onOpen();
        else if (ev.type === "message" && h.onMessage) h.onMessage(ev.data);
        else if (ev.type === "close" && h.onClose) h.onClose();
        else if (ev.type === "error" && h.onError) h.onError();
      });
    } catch (e) {}
  }

  /** makeNativeTransport(hostPort, room, pin, plugin) - the SAME transport
      seam as makeTransport() above, over RoomTlsPlugin's native pinned-TLS
      socket (connect({url,pin}) -> Promise<{id}>, send({id,text}),
      close({id}), and the roomTlsEvent stream routed above) instead of a
      raw WebSocket. The two hazards makeTransport() owns apply here too,
      translated to an async connect() replacing a synchronous
      `new WebSocket(...)`:

      1. QUEUE BEFORE OPEN. A raw WebSocket gives a live object with a
         readyState the instant it's constructed, so makeTransport() can
         queue against THAT object from the very first send(). connect()
         gives nothing synchronously - not even a connection id, which only
         arrives once its Promise resolves - so every send() before this
         transport's own `opened` flag is set (by the plugin's "open"
         roomTlsEvent, never by connect()'s Promise resolving: a resolved
         id is not yet a working socket) queues in `queue`, exactly like
         readyState 0 does above; flushed the instant "open" fires.
      2. RECONNECT REOPENS ITSELF. send() itself notices there is no live
         connection (id is null and a connect() is not already in flight)
         and starts a fresh one to the SAME stored (url, pin) before
         queuing/flushing - same as ensureSocket() above, so
         studygroup.js's reconnect() (which only ever calls send() again,
         never a "reopen" hook that doesn't exist on this seam) Just Works
         here too. */
  function makeNativeTransport(hostPort, room, pin, plugin) {
    var url = schema().wsUrl(hostPort, room, "peer", true);
    var id = null, connecting = false, opened = false, closedForGood = false;
    var queue = [], handler = null, closeHandler = null, endedHandler = null;

    function flush() {
      opened = true;
      var pending = queue;
      queue = [];
      for (var i = 0; i < pending.length; i++) { try { plugin.send({ id: id, text: pending[i] }); } catch (e) {} }
    }
    function onClosed() {
      if (id != null) nativeIdHandlers.delete(id);
      id = null; opened = false; connecting = false;
      if (closedForGood) return;
      /* An unexpected drop, mirroring makeTransport()'s onclose comment
         verbatim: studygroup.js's onTransportClosed turns this into the
         peer's network-lost terminal; reconnect() then calls send() again,
         which reopens a fresh connection right here via ensureConnection(). */
      if (closeHandler) { try { closeHandler(); } catch (e) {} }
    }
    function ensureConnection() {
      if (closedForGood) return false;
      if (id != null || connecting) return true;
      connecting = true;
      ensureNativeListener(plugin);
      var p;
      try { p = plugin.connect({ url: url, pin: pin }); } catch (e) { connecting = false; return false; }
      if (!p || typeof p.then !== "function") { connecting = false; return false; }
      p.then(function (r) {
        connecting = false;
        if (!r || r.id == null) { if (!closedForGood && closeHandler) { try { closeHandler(); } catch (e) {} } return; }
        if (closedForGood) { try { plugin.close({ id: r.id }); } catch (e) {} return; } // torn down mid-connect: don't leak the native socket
        id = r.id;
        nativeIdHandlers.set(id, {
          onOpen: flush,
          onMessage: function (data) {
            if (!handler) return;
            var d = null;
            try { d = schema().wireDecode(String(data)); } catch (e) { d = null; }
            if (d && d.frame) { try { handler(d.frame); } catch (e) {} }
          },
          onClose: onClosed,
          onError: function () { /* a close event always follows, mirroring the WS transport's onerror */ },
        });
      }).catch(function () {
        connecting = false;
        if (!closedForGood && closeHandler) { try { closeHandler(); } catch (e) {} }
      });
      return true;
    }

    return {
      kind: "room-web-tls", peer: hostPort,
      send: function (frame, to) {
        if (closedForGood) return false;
        if (!ensureConnection()) return false;
        var text = schema().wireEncode(frame, to == null ? null : to);
        if (id != null && opened) {
          try { plugin.send({ id: id, text: text }); return true; } catch (e) { return false; }
        }
        queue.push(text); // not open yet (still connecting, or connected but pre-"open"): flushed by flush() above
        return true;
      },
      onmessage: function (h) { handler = typeof h === "function" ? h : null; },
      onclose: function (h) { closeHandler = typeof h === "function" ? h : null; },
      open: function () {},
      onended: function () {
        if (closedForGood) return;
        closedForGood = true;
        queue = [];
        var wasId = id;
        id = null; opened = false;
        if (wasId != null) { nativeIdHandlers.delete(wasId); try { plugin.close({ id: wasId }); } catch (e) {} }
        if (endedHandler) { var fn = endedHandler; endedHandler = null; try { fn(); } catch (e) {} }
      },
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
    /* Secure routing decision (room-tls-and-discovery-pitch.md Section
       1.3.6) - resolved BEFORE anything below touches the current room or
       the seam, so a doomed or refused secure attempt never disturbs a
       session already in progress. A plain (http) target falls straight
       through to makeTransport(), unchanged. */
    var plugin = null;
    if (target.secure) {
      plugin = nativeTlsPlugin();
      if (!plugin) return Promise.resolve({ ok: false, reason: SECURE_NO_NATIVE_TEXT });
      if (!target.pin) return Promise.resolve({ ok: false, reason: SECURE_BAD_PIN_TEXT });
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
    var t = target.secure ? makeNativeTransport(target.hostPort, target.room, target.pin, plugin) : makeTransport(target.hostPort, target.room);
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

  root.__GUIDON_ROOM_WEB__ = { joinAt: joinAt, parse: parse, _makeTransport: makeTransport, _makeNativeTransport: makeNativeTransport };
})(typeof window !== "undefined" ? window : globalThis);
// END room-web.js
