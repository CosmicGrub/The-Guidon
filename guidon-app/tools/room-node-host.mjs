/**
 * Node-side room parties over a real WebSocket (collective P3b). Not a
 * suite: tools/test-room-server.mjs and tools/test-guest-page.mjs import it.
 *
 * nodeHost(opts) runs the SAME pure core the app runs (G.studyGroup.initHost
 * / reduce / act / snapshotFrames from src/app-modules/studygroup.js, loaded
 * in Node exactly the way tools/test-room-core.mjs loads it) behind Node's
 * built-in WebSocket client, connected to a room server as role=host. It is
 * the stand-in for the Rust and Kotlin hosts in suites: every frame it puts
 * on the wire is a frame the app's own reducer produced, wrapped by
 * G.roomSchema.wireEncode (the ONE relay envelope). nodePeer(opts) is the
 * matching joiner (initPeer / reduce / act) for a synthetic candidate seat.
 *
 * Nothing here persists anything; the identity fingerprints are handed in
 * by the suite (8 base32 chars) so a log line can name the party.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

for (const f of ["src/app-modules/room-schema.js", "src/app-modules/studygroup.js"]) {
  await import(pathToFileURL(resolve(f)).href);
}
const S = globalThis.G.roomSchema;
const sg = globalThis.G.studyGroup;

function openSocket(url) {
  const ws = new WebSocket(url);
  const opened = new Promise((res, rej) => {
    ws.addEventListener("open", () => res(ws), { once: true });
    ws.addEventListener("error", (e) => rej(new Error("socket error " + url + (e && e.message ? ": " + e.message : ""))), { once: true });
  });
  return { ws, opened };
}

export function nodeHost(opts) {
  const room = opts.room || S.roomCode();
  const ids = Array.isArray(opts.ids) ? opts.ids : [];
  const cards = opts.cards || {};
  const fp = opts.fp || "NODEHOST";
  const log = [];
  const ctx = { now: () => Date.now(), token: () => opts.token ? opts.token() : cryptoToken() };
  let state = sg.initHost({
    room, mode: opts.mode === "board" ? "board" : "relay", self: { fp, name: opts.name || "NODE-HOST" },
    bankSig: opts.bankSig || "bank:node:1", deck: { category: opts.category == null ? null : opts.category, timerSec: opts.timerSec == null ? null : opts.timerSec, ids }, cards, now: Date.now(),
    pingMs: opts.pingMs || 1000, missLimit: opts.missLimit || 3, holdMs: opts.holdMs || 8000, pendingMs: opts.pendingMs, token: ctx.token,
  });
  state.scaleMax = opts.scaleMax == null ? 2 : opts.scaleMax;
  const url = S.wsUrl(opts.wsBase, room, "host");
  const { ws, opened } = openSocket(url);
  const timers = [];
  let pingN = 0;
  const stats = { sent: 0, received: 0, accepted: 0, ignored: {} };

  function send(frame, to) {
    const v = S.validate(frame);
    if (!v.ok) { log.push({ t: Date.now(), dir: "drop-out", reason: v.reason, frame }); return false; }
    ws.send(S.wireEncode(frame, to == null ? null : to));
    stats.sent++;
    log.push({ t: Date.now(), dir: "out", to: to == null ? null : to, frame });
    return true;
  }
  function apply(res) {
    state = res.state;
    if (res.accepted) stats.accepted++; else stats.ignored[res.reason || "?"] = (stats.ignored[res.reason || "?"] || 0) + 1;
    for (const e of res.effects || []) send(e.frame, e.to);
    if (res.bump) for (const e of sg.snapshotFrames(state)) send(e.frame, e.to);
    return res;
  }
  ws.addEventListener("message", (ev) => {
    stats.received++;
    const d = S.wireDecode(String(ev.data));
    if (!d) { stats.ignored.unparseable = (stats.ignored.unparseable || 0) + 1; return; }
    log.push({ t: Date.now(), dir: "in", frame: d.frame });
    apply(sg.reduce(state, d.frame, ctx));
  });
  function start() {
    timers.push(setInterval(() => {
      if (state.terminal) return;
      const n = ++pingN;
      for (const s of state.seats) if (s.fp !== state.self.fp && s.online) send(sg.frameOf(state, "ping", { n }), s.fp);
      for (const p of state.pending.concat(state.admitted)) send(sg.frameOf(state, "ping", { n }), p.fp);
    }, state.cfg.pingMs));
    timers.push(setInterval(() => { if (!state.terminal) apply(sg.act(state, { type: "tick" }, ctx)); }, Math.max(200, Math.floor(state.cfg.pingMs / 2))));
  }
  return {
    room, fp, ws, log, stats,
    ready: opened.then(() => { start(); return room; }),
    state: () => state,
    act: (action) => apply(sg.act(state, action, ctx)),
    deliver: (frame) => apply(sg.reduce(state, frame, ctx)),
    seats: () => state.seats.map((s) => ({ seatNo: s.seatNo, name: s.name, fp: s.fp, score: s.score, online: s.online, ready: s.ready })),
    pending: () => state.pending.map((p) => ({ fp: p.fp, name: p.name, bankSig: p.bankSig })),
    scores: () => JSON.parse(JSON.stringify(state.scores || {})),
    bye() {
      if (state.terminal) return;
      for (const s of state.seats) if (s.fp !== state.self.fp && s.online) send(sg.frameOf(state, "bye", {}), s.fp);
    },
    close() { for (const t of timers) clearInterval(t); timers.length = 0; try { ws.close(1000, "done"); } catch (e) {} },
  };
}

export function nodePeer(opts) {
  const fp = opts.fp;
  const ctx = { now: () => Date.now(), token: () => "x" };
  let state = sg.initPeer({ room: opts.room, self: { fp, name: opts.name || "NODE-PEER" }, bankSig: opts.bankSig || "bank:node:1", now: Date.now(), pingMs: opts.pingMs || 1000, missLimit: opts.missLimit || 3 });
  const url = S.wsUrl(opts.wsBase, opts.room, "peer");
  const { ws, opened } = openSocket(url);
  const log = [];
  const timers = [];
  function send(frame) { const v = S.validate(frame); if (!v.ok) return false; ws.send(S.wireEncode(frame, null)); log.push({ t: Date.now(), dir: "out", frame }); return true; }
  function apply(res) { state = res.state; for (const e of res.effects || []) send(e.frame); }
  ws.addEventListener("message", (ev) => {
    const d = S.wireDecode(String(ev.data));
    if (!d) return;
    log.push({ t: Date.now(), dir: "in", frame: d.frame });
    apply(sg.reduce(state, d.frame, ctx));
  });
  return {
    fp, ws, log,
    ready: opened.then(() => {
      timers.push(setInterval(() => { if (!state.terminal) apply(sg.act(state, { type: "tick" }, ctx)); }, 500));
      return fp;
    }),
    state: () => state,
    hello(resume) { const body = { name: state.self.name, bankSig: state.bankSig }; if (resume) body.resume = resume; return send(sg.frameOf(state, "hello", body)); },
    intent(body) { return send(sg.frameOf(state, "intent", body)); },
    close() { for (const t of timers) clearInterval(t); timers.length = 0; try { ws.close(1000, "done"); } catch (e) {} },
  };
}

function cryptoToken() {
  const b = new Uint8Array(15);
  globalThis.crypto.getRandomValues(b);
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0, out = "";
  for (let i = 0; i < b.length; i++) { val = ((val << 8) | b[i]) >>> 0; bits += 8; while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  return out;
}
