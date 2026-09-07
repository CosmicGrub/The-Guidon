/* ==== js/room-tauri.js ==== */
/* GUIDON - room-tauri.js : the Tauri transport adapter (window.__GUIDON_ROOM__)
   Collective roadmap P4 (R-ROOM). Locked: native host + LAN WebSocket +
   host-served guest page (Q3); Tauri hosts first (Q4); the HOST role is the
   Rust listener in src-tauri/src/room.rs, never this page - the page never
   opens a socket on the host side.

   This file is web/-only (tools/build.mjs injects it after xwin.js, the
   same way it injects native.js; the standalone file never receives it)
   and does NOTHING outside the Tauri shell: without
   window.__TAURI_INTERNALS__ the whole module returns at once. Inside the
   shell it implements G.studyGroup's ONE transport seam
   { send, onmessage, open, close } over the raw IPC surface
   (__TAURI_INTERNALS__.invoke - no @tauri-apps/api, no capability file,
   rule 8: app commands from the bundled origin need none):

     send(frame, to)   -> invoke("room_send",  { frame, to })   the page names a fingerprint
     hostStart(room)   -> invoke("room_start", { port, code })  when this device opens a room
     hostStop()        -> invoke("room_stop")                   when it leaves
     inbound           <- window.__GUIDON_ROOM_RX__(msg)        Rust evals this on the window

   Why eval and not a Tauri event: listening to a Tauri event from JS is
   the plugin command plugin:event|listen, and tauri 2.11.5 consults the
   ACL for EVERY plugin command (src/webview/mod.rs, the
   `plugin_command.is_some() || has_app_acl_manifest || !is_local` gate) -
   with no capability file that is a reject. So the Rust side delivers
   with WebviewWindow::eval into __GUIDON_ROOM_RX__, and this module
   re-dispatches each message as a DOM CustomEvent of the same name
   ("room:frame", "room:peer") on window for anything else that listens.

   Every invoke carries the two gate arguments the Rust side refuses
   without: studyGroups (the live Settings value - the page is the source
   of truth) and fork (G.caps.fork(), "tauri" here). The adapter attaches
   itself to G.studyGroup only while Settings -> Study groups is on and the
   fork is tauri; attach() is the place G.netLedger records the seam, and
   every accepted socket the listener reports ("room:peer" open) is
   recorded there too, with the peer address. X10: RoomInfo.reachable is
   the Rust side's own TCP probe of the advertised ip:port; false means the
   per-user installer could not open the firewall, and notice() hands the
   host screen the "host from a phone instead" line. */
(function () {
  "use strict";
  var T = window.__TAURI_INTERNALS__;
  if (!T || typeof T.invoke !== "function") return;
  window.G = window.G || {};
  var G = window.G;

  var UNREACHABLE_TEXT = "This computer's room port did not answer its own probe - a per-user install cannot open the Windows firewall. Host from a phone instead: a phone's hotspot reaches every device in the room without the firewall in the way.";
  var rt = { attached: false, info: null, room: null, lastError: "", notice: "", handler: null, onclose: null, peers: { open: 0, close: 0 }, frames: 0, sends: 0, sendErrors: 0 };

  function schema() { return G.roomSchema; }
  function settingOn() {
    try { return !!(G.store && typeof G.store.settings === "function" && G.store.settings().studyGroups === true); } catch (e) { return false; }
  }
  function forkName() {
    try { if (G.caps && typeof G.caps.fork === "function") return G.caps.fork(); } catch (e) {}
    return typeof window.GUIDON_FORK === "string" ? window.GUIDON_FORK : null;
  }
  function gate(extra) {
    var o = extra || {};
    o.studyGroups = settingOn();
    o.fork = forkName();
    return o;
  }
  function invoke(cmd, args) { return T.invoke(cmd, gate(args)); }
  function redraw() { try { if (G.studyGroup && typeof G.studyGroup._redraw === "function") G.studyGroup._redraw(); } catch (e) {} }
  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {}
  }

  function start(room) {
    rt.room = String(room || "");
    rt.info = null; rt.notice = ""; rt.lastError = "";
    return invoke("room_start", { port: null, code: rt.room }).then(function (info) {
      if (info && info.room === rt.room) {
        rt.info = info;
        if (info.reachable === false) rt.notice = UNREACHABLE_TEXT;
      }
      redraw();
      return info;
    }).catch(function (e) {
      rt.lastError = String(e && e.message ? e.message : e);
      rt.notice = "The room listener could not start: " + rt.lastError;
      redraw();
      return null;
    });
  }
  function stop() {
    rt.info = null; rt.room = null; rt.notice = "";
    return invoke("room_stop", {}).catch(function (e) { rt.lastError = String(e && e.message ? e.message : e); return null; });
  }

  var transport = {
    kind: "tauri-listener", peer: "0.0.0.0 (Rust LAN listener)",
    send: function (frame, to) {
      rt.sends++;
      invoke("room_send", { frame: frame, to: to == null ? null : String(to) }).catch(function (e) {
        rt.sendErrors++;
        rt.lastError = String(e && e.message ? e.message : e);
        rt.notice = "A message could not be sent: " + rt.lastError;
        redraw();
      });
      return true;
    },
    onmessage: function (h) { rt.handler = typeof h === "function" ? h : null; },
    onclose: function (h) { rt.onclose = typeof h === "function" ? h : null; },
    /* open() runs at attach time, before any room code exists; the
       listener starts in hostStart(room), the seam hook host() calls. */
    open: function () {},
    close: function () { return stop(); },
    hostStart: function (room) { return start(room); },
    hostStop: function () { return stop(); },
    joinUrl: function (room) { return rt.info && rt.info.room === String(room || "") ? String(rt.info.url || "") : ""; },
    /* room-tls-and-discovery-pitch.md Section 1.3.6/stage 4-5. RoomInfo
       (Rust, room.rs) has carried tlsPort/identity.{fp,spkiSha256} since
       this session's earlier TLS work - room_start()'s whole response is
       stored untouched as rt.info above, so those fields are ALREADY on
       rt.info with zero change to start()/invoke() themselves. What was
       missing is a way for studygroup.js to reach them: the transport seam
       only ever exposed joinUrl()/addresses()/notice() (narrow getters),
       and studygroup.js never touches window.__GUIDON_ROOM__ directly (it
       goes through the seam exclusively, by design - see this file's own
       header) - so a secure link never reached the host screen without
       ONE more getter here. Deliberately mirrors joinUrl()'s own shape
       (same room-match guard, same "" on anything not ready) and reuses
       the SAME rt.info.ip choose_advertised() already picked for the
       plain link above - never a second IP-selection - so the two links
       always name the same device. "" (not a thrown error) for a
       pre-rebuild Rust binary that has no tlsPort/identity yet, or any
       other transport that never had this getter at all: drawHostLadder()
       (studygroup.js) treats a missing/empty result as "no secure link on
       this build" and shows only the plain link, additive and silent. */
    secureJoinUrl: function (room) {
      if (!rt.info || rt.info.room !== String(room || "")) return "";
      if (typeof rt.info.tlsPort !== "number" || !rt.info.identity || !rt.info.identity.spkiSha256) return "";
      try { return schema().joinUrl("https://" + rt.info.ip + ":" + rt.info.tlsPort, String(room || ""), rt.info.identity.spkiSha256); }
      catch (e) { return ""; }
    },
    notice: function () { return rt.notice; },
    addresses: addresses,
  };

  /* Rust -> page. msg is one of
       { type: "room:frame", text, from, peer }   the ORIGINAL wire text of a validated peer frame
       { type: "room:peer",  event: "open"|"close", peer, room, role, fp, code, id } */
  window.__GUIDON_ROOM_RX__ = function (msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "room:frame") {
      rt.frames++;
      emit("room:frame", msg);
      if (!rt.handler) return;
      var d = null;
      try { d = schema().wireDecode(String(msg.text)); } catch (e) { d = null; }
      if (d && d.frame) { try { rt.handler(d.frame); } catch (e) {} }
      return;
    }
    if (msg.type === "room:peer") {
      if (msg.event === "open") {
        rt.peers.open++;
        try { if (G.netLedger && G.netLedger.record) G.netLedger.record({ kind: "ws-in", peer: String(msg.peer || "unknown"), at: Date.now() }); } catch (e) {}
      } else if (msg.event === "close") {
        rt.peers.close++;
      }
      emit("room:peer", msg);
    }
  };

  function attachIfOn() {
    if (rt.attached || !settingOn() || forkName() !== "tauri" || !G.studyGroup || typeof G.studyGroup.attach !== "function") return;
    var r = G.studyGroup.attach(transport);
    rt.attached = !!(r && r.ok);
    if (!rt.attached && r && r.reason) rt.lastError = String(r.reason);
  }
  attachIfOn();
  if (G.util && typeof G.util.on === "function") {
    G.util.on("store:ready", attachIfOn);
    G.util.on("settings:change", function (d) { if (!d || d.k === undefined || d.k === "studyGroups") attachIfOn(); });
  }

  /* R-ROOM address listing: every non-loopback IPv4 room_start reported,
     with its adapter name; rt.info.ip/url are whichever one the Rust side
     (room.rs::choose_advertised) picked. The host-ladder UI
     (studygroup.js drawHostLadder) shows the rest when there is more than
     one, so a laptop with a VPN adapter up can be corrected by eye
     instead of only trusting the auto-pick. */
  function addresses() {
    return (rt.info && Array.isArray(rt.info.addresses)) ? rt.info.addresses : [];
  }

  window.__GUIDON_ROOM__ = {
    attached: function () { return rt.attached; },
    info: function () { return rt.info; },
    addresses: addresses,
    notice: function () { return rt.notice; },
    lastError: function () { return rt.lastError; },
    /* General-purpose getter for the native TLS identity's fingerprint
       (rt.info.identity.fp - see secureJoinUrl()'s own comment above for
       where rt.info.identity comes from), for callers that just want the
       fp rather than a built join-link string. Returns the fingerprint
       string when a room is active and the native side reported an
       identity, null otherwise (no room started yet, or a pre-rebuild
       Rust binary with no identity on RoomInfo). To be consumed by
       src/app-modules/studygroup.js in a later, separate change. */
    fp: function () { return (rt.info && rt.info.identity && rt.info.identity.fp) || null; },
    peers: function () { return { open: rt.peers.open, close: rt.peers.close, frames: rt.frames, sends: rt.sends, sendErrors: rt.sendErrors }; },
    stats: function () { return invoke("room_stats", {}); },
    transport: transport,
  };
})();
// END room-tauri.js
