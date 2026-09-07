/**
 * Study-room session (collective P3a): one Chromium, six GUIDON pages in one
 * context wired through the fake transport at the room module's seam
 * (tools/room-harness.mjs). Written BEFORE the module exists - its first
 * run is the RED baseline.
 *
 * A full Rapid-Fire Team relay across 6 seats, then a Mock Board Live board
 * with 1 candidate + 3 scorers, driven through the REAL #/group UI (the
 * .sg-* controls) with the live G.studyGroup state read back as evidence:
 *   - admit-each: an unadmitted page receives no snapshot and no welcome
 *     (the hub log is the record); there is no admit-all control anywhere
 *   - a hello with a wrong room code is rejected; a v-mismatch hello is
 *     rejected with the exact sentence "update GUIDON on one device"
 *   - each seat plays its Party round through the SAME beginRound engine
 *     Rapid Fire's own tab uses, the host tallies, the turn advances in
 *     seat order, recap on every page agrees with the host
 *   - a page whose link dies is held (seat kept, online:false) and
 *     reconnects to the SAME seat with the SAME token inside the hold
 *   - host leaves -> every peer shows the host-left state; no post-end
 *     intent applies anywhere
 *   - late join lands at a card boundary (admitted mid-card, welcomed only
 *     when the host advances, with the new card's snapshot)
 *   - 900 score intents in a burst -> host re-render count bounded, seq
 *     stays monotonic, every peer converges on the host's seq
 *   - zero page errors and zero console errors on all six pages *   - P3b X6: hello carries the stamped build sha + app version (display
 *     only; PROTOCOL_VERSION stays the integer in room-schema.js), the skew
 *     message names both builds, welcome carries the host's hold window,
 *     the harness drops one page's PONGS only -> 3 misses -> seat offline
 *     and the hold starts, the cut-off page reaches network-lost and shows
 *     the host's hold, a hello from that fp WITHOUT its token is rejected,
 *     reconnect() with the token re-seats; tokens unique/random/never the sha
 *   - P3b X9: the host screen shows the join URL (large), the phonetic
 *     code, a real rendered QR code (Stage 1.5, src/app-modules/qrcode.js -
 *     a from-scratch ISO/IEC 18004 encoder; see tools/test-qrcode.mjs for
 *     its own dedicated round-trip verification), the 60 s no-joiners ladder
 *     (walked with a mocked clock), the hotspot toggle disabling the
 *     gateway auto-detect text, and the hotspot-cap warning at seat 8
 *   - room-tls-and-discovery-pitch.md Section 1.3.6/stage 4-5 (2026-09-06):
 *     a SECOND, labeled secure join link + its own QR code appears once the
 *     host's transport offers secureJoinUrl() (the real room-tauri.js does,
 *     once RoomInfo carries tlsPort/identity), the plain link is relabeled
 *     to clarify it is the browser/guest-page option, and removing the
 *     capability drops the secure block again cleanly - never a broken
 *     half-rendered section

 *
 * Every positive assertion is a bounded poll (until()), never a bare sleep.
 * Usage: node tools/test-room-session.mjs   (exit code = FAIL count)
 */
import { serve } from "./server.mjs";
import { openRoom, fakeTransport, close } from "./room-harness.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MAX = 6000;
async function until(pred, limit = POLL_MAX, step = 50) {
  const t0 = Date.now();
  for (;;) {
    let value = null;
    try { value = await pred(); } catch (e) { value = null; }
    if (value) return { hit: true, ms: Date.now() - t0, value };
    if (Date.now() - t0 >= limit) return { hit: false, ms: Date.now() - t0, value };
    await sleep(step);
  }
}
const WATCHDOG_MS = 240000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nROOM SESSION: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

const PING = 1000, MISS = 3, HOLD = 8000;
const CAT = "Army Fitness Test (AFT)";
const BOARD_CAT = "Creeds";
const st = (p) => p.evaluate(() => (window.G && G.studyGroup && G.studyGroup.state) ? G.studyGroup.state() : null);
const sess = (p) => p.evaluate(() => (window.G && G.studyGroup && G.studyGroup.session) ? G.studyGroup.session() : null);
const click = (p, sel) => p.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel);
const clickText = (p, text) => p.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t); if (!b) return false; b.click(); return true; }, text);
const has = (p, sel) => p.evaluate((s) => !!document.querySelector(s), sel);
/* The DOM follows the state within the 100 ms render window: controls are
   polled for before they are clicked, never read the instant the state
   changed. */
const clickWhen = async (p, sel) => (await until(() => p.evaluate((s) => { const b = document.querySelector(s); if (!b || b.disabled) return null; b.click(); return true; }, sel))).hit;

console.log("test-room-session: 6 pages, one Chromium, fake transport at the seam");
const { server, url } = await serve("web");
let room = null;
const log = [];
try {
  room = await openRoom(url, 6, { hash: "#/group" });
  const { pages, noise } = room;
  const [H, P1, P2, P3, P4, P5] = pages;
  const hub = fakeTransport({ log });
  for (let i = 0; i < pages.length; i++) await hub.wire(pages[i], { host: i === 0 });

  let guardThrew = null;
  try { await openRoom(url, 1); } catch (e) { guardThrew = e.message; }
  guardThrew && /already open/.test(guardThrew) ? ok("harness refuses a second browser while one is open") : bad("harness guard did not throw: " + guardThrew);

  const present = await H.evaluate(() => ({ schema: !!(window.G && G.roomSchema), sg: !!(window.G && G.studyGroup), route: !!(window.G && G.routes && G.routes.some((r) => r.hash === "#/group")) }));
  present.schema ? ok("G.roomSchema is present in web/") : bad("G.roomSchema missing in web/");
  present.sg ? ok("G.studyGroup is present in web/") : bad("G.studyGroup missing in web/");
  present.route ? ok("ROUTES has #/group") : bad("ROUTES has no #/group entry");
  if (!present.schema || !present.sg || !present.route) throw new Error("module absent - RED");

  const onGroup = await until(() => H.evaluate(() => location.hash === "#/group" && [...document.querySelectorAll("#route h2")].some((h) => h.textContent.trim() === "Study group")));
  onGroup.hit ? ok("#/group renders with the \"Study group\" heading") : bad("#/group did not render its heading");
  const anyAdmitAll = await H.evaluate(() => /admit all/i.test(document.getElementById("route").textContent || ""));
  !anyAdmitAll ? ok("no \"Admit all\" control anywhere on the host screen (ruled 2026-09-04)") : bad("an Admit all control exists");

  /* ---------------- attach + host ---------------- */
  for (const p of pages) {
    const r = await p.evaluate(() => G.studyGroup.attach(window.__roomTransport));
    if (!r || !r.ok) bad("attach refused on a page: " + JSON.stringify(r));
  }
  const ledgers = await Promise.all(pages.map((p) => p.evaluate(() => G.netLedger.list().length)));
  ledgers.every((n) => n === 1) ? ok("G.netLedger.record() called exactly once per page on attach: " + ledgers.join(",")) : bad("ledger counts after attach: " + ledgers.join(","));

  const hosted = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: "HOST-ALPHA", category: CAT, timerSec: null, pingMs: PING, holdMs: HOLD, missLimit: MISS });
  hosted && hosted.ok ? ok("host() opened a relay room " + hosted.room + " as " + hosted.fp) : bad("host() failed: " + JSON.stringify(hosted));
  const ROOM = hosted.room;
  const codeOk = (await until(() => H.evaluate(() => { const s = G.roomSchema; const el = document.querySelector(".sg-room-code"); return el && s.isRoomCode(el.textContent.trim()) && el.textContent.trim() === G.studyGroup.state().room; }))).hit;
  codeOk ? ok("the phonetic room code is shown on the host screen and matches the state") : bad("room code not shown / not phonetic");
  /^[A-Z2-7]{8}$/.test(hosted.fp) ? ok("host fingerprint is 8 base32 chars") : bad("host fp = " + hosted.fp);

  /* ---------------- join: wrong room, then right room ---------------- */
  const wrong = ROOM.replace(/\d\d$/, (d) => String((Number(d) + 1) % 100).padStart(2, "0"));
  await P5.evaluate((o) => G.studyGroup.join(o), { room: wrong, name: "PEER-FIVE", pingMs: PING, missLimit: MISS });
  const rej = await until(() => P5.evaluate(() => { const s = G.studyGroup.state(); return s && s.terminal && s.terminal.kind === "rejected" ? s.terminal.reason : null; }));
  rej.hit ? ok("a hello with the wrong room code is rejected: \"" + rej.value + "\"") : bad("wrong-room hello was not rejected");
  const rejShown = await until(() => has(P5, ".sg-terminal[data-kind=rejected]"));
  rejShown.hit ? ok("the rejected terminal state renders on the joiner (" + rejShown.ms + " ms)") : bad("no .sg-terminal[data-kind=rejected] on P5");
  await P5.evaluate(() => G.studyGroup.leave());

  const names = ["PEER-ONE", "PEER-TWO", "PEER-THREE", "PEER-FOUR", "PEER-FIVE"];
  const joiners = [P1, P2, P3, P4, P5];
  for (let i = 0; i < joiners.length; i++) {
    const r = await joiners[i].evaluate((o) => G.studyGroup.join(o), { room: ROOM, name: names[i], pingMs: PING, missLimit: MISS });
    if (!r || !r.ok) bad("join() failed on " + names[i] + ": " + JSON.stringify(r));
  }
  const pend = await until(() => H.evaluate(() => { const s = G.studyGroup.state(); return s && s.pending.length === 5 ? s.pending.length : null; }));
  pend.hit ? ok("5 hellos are pending on the host after " + pend.ms + " ms") : bad("pending = " + JSON.stringify(pend.value));
  const pendingShown = await until(() => H.evaluate(() => document.querySelectorAll(".sg-pending .sg-admit[data-fp]").length === 5));
  pendingShown.hit ? ok("the lobby lists 5 pending joiners each with its own Admit button (admit-each)") : bad("Admit buttons: " + JSON.stringify(pendingShown.value));
  const waiting = (await until(() => P1.evaluate(() => /waiting for the host/i.test(document.getElementById("route").textContent || "")))).hit;
  waiting ? ok("a pending joiner sees \"Waiting for the host\"") : bad("pending joiner copy missing");

  /* v mismatch: a raw hello with v+1 from P5's context (its fp is learned by the hub) */
  const fp5 = await P5.evaluate(() => G.studyGroup.session().fp);
  await P5.evaluate((o) => window.__roomTransport.send({ v: G.roomSchema.PROTOCOL_VERSION + 1, t: "hello", room: o.room, seq: 0, from: o.fp, body: { name: "OLD-BUILD", bankSig: "x", build: "deadbeefcafe", app: "1.4.0" } }, null), { room: ROOM, fp: fp5 });
  const vrej = await until(() => { const e = log.find((x) => x.frame && x.frame.t === "reject" && x.to === fp5 && x.frame.body && x.frame.body.reason === "update GUIDON on one device"); return e ? e.frame.body.reason : null; });
  vrej.hit ? ok("a v-mismatch hello is answered with reject \"update GUIDON on one device\"") : bad("no reject with the exact sentence for the v-mismatch hello");
  const cnt = await H.evaluate(() => G.studyGroup.counters());
  cnt && cnt.ignored && cnt.ignored.version >= 1 ? ok("the host counted the invalid frame (ignored.version = " + cnt.ignored.version + ")") : bad("host counters: " + JSON.stringify(cnt));
  const p5term = await until(() => P5.evaluate(() => { const s = G.studyGroup.state(); return s && s.terminal ? s.terminal.reason : null; }));
  p5term.hit ? ok("P5 shows the rejection sentence: \"" + p5term.value + "\"") : bad("P5 did not enter the rejected state");  /* X6 (P3b): the skew message names BOTH sides - the joiner's informational
     build/app fields from its hello (untrusted, display only) and this
     device's own stamped build - around the ONE locked sentence. */
  const skewMsg = await until(() => H.evaluate(() => { const m = document.querySelector(".sg-msg"); return m && /update GUIDON on one device/.test(m.textContent) ? m.textContent : null; }));
  const hb = await H.evaluate(() => ({ sha: (window.GUIDON_BUILD_SHA || "").slice(0, 7), app: window.GUIDON_APP_VERSION || "" }));
  skewMsg.hit && /joiner: GUIDON 1\.4\.0 build deadbee \(protocol \d+\)/.test(skewMsg.value) && skewMsg.value.includes("this device: GUIDON " + hb.app + " build " + (hb.sha || "?") + " (protocol " + 1 + ")")
    ? ok("(X6) the host's skew message names both builds around the locked sentence: \"" + skewMsg.value.trim() + "\"")
    : bad("(X6) host skew message: " + JSON.stringify(skewMsg.value) + " (this device app " + hb.app + " sha " + hb.sha + ")");
  const p5panel = await until(() => P5.evaluate(() => { const t = document.querySelector(".sg-terminal[data-kind=rejected]"); return t ? t.textContent : null; }));
  p5panel.hit && p5panel.value.includes("This device: GUIDON " + hb.app) ? ok("(X6) the rejected joiner's panel names its own build beside the sentence") : bad("(X6) rejected panel on P5: " + JSON.stringify(p5panel.value && p5panel.value.slice(0, 200)));

  await P5.evaluate(() => G.studyGroup.leave());
  const stillPending = await H.evaluate(() => G.studyGroup.state().pending.length);
  stillPending === 4 ? ok("P5's bye dropped it from pending (4 left)") : info("pending after P5 left: " + stillPending);

  /* admit-each: admit P1..P4 by clicking; P5 (rejoining) stays pending for a while */
  const r5 = await P5.evaluate((o) => G.studyGroup.join(o), { room: ROOM, name: "PEER-FIVE", pingMs: PING, missLimit: MISS });
  r5 && r5.ok ? ok("P5 rejoined the room after leaving the rejected state") : bad("P5 rejoin: " + JSON.stringify(r5));
  await until(() => H.evaluate(() => G.studyGroup.state().pending.length === 5));
  const fps = {};
  for (const p of joiners) fps[await p.evaluate(() => G.studyGroup.session().fp)] = p;
  const fpOf = async (p) => p.evaluate(() => G.studyGroup.session().fp);
  const admit = async (p) => {
    const fp = await fpOf(p);
    const clicked = await until(() => H.evaluate((f) => { const b = document.querySelector('.sg-admit[data-fp="' + f + '"]'); if (!b) return null; b.click(); return true; }, fp));
    if (!clicked.hit) bad("no Admit button for " + fp + " within " + clicked.ms + " ms");
    return until(() => p.evaluate(() => { const s = G.studyGroup.state(); return s && s.joinState === "seated" ? s.self.seatNo : null; }));
  };
  const seatNos = [];
  for (const p of [P1, P2, P3, P4]) { const r = await admit(p); seatNos.push(r.value); if (!r.hit) bad("admitted page did not seat within " + r.ms + " ms"); }
  seatNos.join(",") === "2,3,4,5" ? ok("admit-each seated P1..P4 as seats 2,3,4,5 (in admit order)") : bad("seat numbers " + seatNos.join(","));  const tokRoom1 = await P1.evaluate(() => G.studyGroup.state().self.token);

  const fpP5 = await fpOf(P5);
  const p5Frames = log.filter((x) => x.to === fpP5 && x.frame && (x.frame.t === "snapshot" || x.frame.t === "welcome"));
  p5Frames.length === 0 ? ok("the unadmitted page (P5) received no snapshot and no welcome while 4 others were admitted (hub log)") : bad("P5 received " + p5Frames.length + " snapshot/welcome frame(s) while unadmitted");
  const p5seq = await P5.evaluate(() => G.studyGroup.state().seq);
  p5seq === 0 ? ok("P5's local seq is still 0 (nothing applied)") : bad("P5 seq = " + p5seq);
  const r5b = await admit(P5);
  r5b.hit && r5b.value === 6 ? ok("P5 admitted last as seat 6") : bad("P5 seat: " + JSON.stringify(r5b));
  const seatsShown = await until(() => P3.evaluate(() => document.querySelectorAll(".sg-seat[data-seat]").length === 6));
  seatsShown.hit ? ok("every page renders the 6-seat roster") : bad("P3 seat rows: " + JSON.stringify(seatsShown.value));

  /* ready intents from peers */
  for (const p of joiners) await p.evaluate(() => G.studyGroup.sendIntent({ kind: "ready" }));
  const readyAll = await until(() => H.evaluate(() => G.studyGroup.state().seats.filter((s) => s.ready).length === 6 ? 6 : null));
  readyAll.hit ? ok("all 5 peer ready intents reached the host (host is ready by default)") : bad("ready seats: " + JSON.stringify(readyAll.value));

  /* ---------------- relay: each seat plays its Party round ---------------- */
  /* The DOM follows the state within the 100 ms render window - poll for
     the ENABLED button, never read it the instant the state changed. */
  const started = await until(() => H.evaluate(() => { const b = document.querySelector("button.sg-start"); if (!b || b.disabled) return null; b.click(); return true; }));
  started.hit ? ok("host clicked Start (enabled after " + started.ms + " ms)") : bad("no enabled .sg-start button on the host");
  const inPlay = await until(() => P2.evaluate(() => { const s = G.studyGroup.state(); return s && s.phase === "play" ? s.turnSeat : null; }));
  inPlay.hit && inPlay.value === 1 ? ok("phase play reached every peer; turnSeat 1 (the host plays first)") : bad("play: " + JSON.stringify(inPlay));
  const order = [H, P1, P2, P3, P4, P5];
  const scores = [3, 1, 4, 2, 0, 5];
  let relayOk = true;
  for (let i = 0; i < order.length; i++) {
    const p = order[i];
    const turn = await until(() => p.evaluate((n) => { const s = G.studyGroup.state(); return s && s.phase === "play" && s.turnSeat === n && !!document.querySelector("button.sg-play-round"); }, i + 1));
    if (!turn.hit) { relayOk = false; bad("seat " + (i + 1) + " never got its turn with a Start-my-round button"); break; }
    await click(p, "button.sg-play-round");
    const card = await until(() => p.evaluate(() => !!document.querySelector(".rf-card .rf-question") && !!document.querySelector(".rf-judge-correct")));
    if (!card.hit) { relayOk = false; bad("seat " + (i + 1) + ": the Rapid Fire round screen (.rf-card) did not appear"); break; }
    for (let k = 0; k < scores[i]; k++) { await p.evaluate(() => document.querySelector(".rf-judge-correct").click()); await sleep(30); }
    await p.evaluate(() => document.querySelector(".rf-judge-pass").click());
    await clickText(p, "End Round");
    const tallied = await until(() => H.evaluate((n) => { const s = G.studyGroup.state(); const seat = s.seats.find((x) => x.seatNo === n); return seat && seat.done ? { score: seat.score } : null; }, i + 1));
    if (!tallied.hit || tallied.value.score !== scores[i]) { relayOk = false; bad("seat " + (i + 1) + " tally = " + JSON.stringify(tallied.value) + " (expected " + scores[i] + ")"); }
    if (i === 2) {
      /* Seat 3 (P2) finished: kill its link, expect a held seat, then reconnect. */
      const before = await P2.evaluate(() => ({ seat: G.studyGroup.state().self.seatNo, token: G.studyGroup.state().self.token }));
      hub.kill(P2);
      const offline = await until(() => H.evaluate(() => { const s = G.studyGroup.state().seats.find((x) => x.seatNo === 3); return s && !s.online ? { held: true, score: s.score, token: s.token } : null; }), PING * (MISS + 3) + 2000);
      offline.hit ? ok("killed link: the host marked seat 3 offline after " + offline.ms + " ms and KEPT the seat (score " + offline.value.score + ")") : bad("seat 3 was not held after its link died");
      const lostOnPeer = await until(() => P2.evaluate(() => { const s = G.studyGroup.state(); return s && s.terminal && s.terminal.kind === "network-lost" ? true : null; }), PING * (MISS + 3) + 2000);
      lostOnPeer.hit ? ok("the cut-off page shows the network-lost state after " + lostOnPeer.ms + " ms") : bad("P2 never entered network-lost");
      const shown = (await until(() => has(P2, ".sg-terminal[data-kind=network-lost]"))).hit;
      shown ? ok("network-lost terminal renders on P2") : bad("no .sg-terminal[data-kind=network-lost] on P2");
      /* The hold is a WINDOW (HOLD ms), not one tick: stay dark for five
         tick intervals and the seat must still be there, offline, with its
         token (added by the P3a verification pass - a holdMs of 0 passed
         the instant reconnect below). */
      await sleep(Math.floor(PING / 2) * 5);
      const stillHeld = await H.evaluate(() => { const s = G.studyGroup.state().seats.find((x) => x.seatNo === 3); return s ? { online: s.online, token: s.token } : null; });
      stillHeld && !stillHeld.online && stillHeld.token === before.token ? ok("seat 3 still held (offline, same token) " + Math.floor(PING / 2) * 5 + " ms later - inside the " + HOLD + " ms hold") : bad("seat 3 not held across the wait: " + JSON.stringify(stillHeld));
      hub.revive(P2);
      const rc = await P2.evaluate(() => G.studyGroup.reconnect());
      rc && rc.ok ? ok("reconnect() re-sent hello with the resume token") : bad("reconnect(): " + JSON.stringify(rc));
      const back = await until(() => H.evaluate(() => { const s = G.studyGroup.state().seats.find((x) => x.seatNo === 3); return s && s.online ? { token: s.token, score: s.score } : null; }));
      const after = await P2.evaluate(() => ({ seat: G.studyGroup.state().self.seatNo, token: G.studyGroup.state().self.token, terminal: G.studyGroup.state().terminal, joinState: G.studyGroup.state().joinState }));
      back.hit && after.seat === before.seat && after.token === before.token && back.value.token === before.token && after.joinState === "seated" && !after.terminal
        ? ok("reconnected inside the hold window to the SAME seat " + after.seat + " with the SAME token, score kept (" + back.value.score + ")")
        : bad("reconnect: " + JSON.stringify({ before, after, host: back.value }));
    }
  }
  if (relayOk) ok("all 6 seats played their Party round through the real Rapid Fire engine; host tallied " + scores.join(",") + " in seat order");
  const recap = await until(() => P4.evaluate(() => { const s = G.studyGroup.state(); return s && s.phase === "recap" ? s.seats.map((x) => x.score).join(",") : null; }));
  recap.hit && recap.value === scores.join(",") ? ok("recap reached the peers with the host's tallies: " + recap.value) : bad("recap on P4: " + JSON.stringify(recap));
  const hostSeq = await H.evaluate(() => G.studyGroup.state().seq);
  const seqs = await Promise.all(joiners.map((p) => p.evaluate(() => G.studyGroup.state().seq)));
  seqs.every((s) => s === hostSeq) ? ok("every peer converged on the host's seq " + hostSeq) : bad("seqs " + seqs.join(",") + " vs host " + hostSeq);

  /* ---------------- host leaves ---------------- */
  const timerProbe = async (page, label) => {
    const r = await Promise.race([
      page.evaluate(() => new Promise((res) => { const t0 = performance.now(); setTimeout(() => res({ fired: Math.round(performance.now() - t0), vis: document.visibilityState, fs: !!document.fullscreenElement, active: document.activeElement && document.activeElement.tagName }), 20); })),
      sleep(3000).then(() => "TIMEOUT: setTimeout(20) did not fire within 3000 ms"),
    ]);
    info("timer probe " + label + ": " + JSON.stringify(r));
    return r;
  };
  await timerProbe(H, "host, before leave()");
  const logLen = log.length;
  await H.evaluate(() => G.studyGroup.leave());
  await timerProbe(H, "host, after leave()");
  const hostLeft = await until(async () => { const r = await Promise.all(joiners.map((p) => has(p, ".sg-terminal[data-kind=host-left]"))); return r.every(Boolean) ? true : null; });
  hostLeft.hit ? ok("host leave(): every peer shows the host-left state after " + hostLeft.ms + " ms") : bad("host-left state missing on a peer");
  const post = await P1.evaluate(() => G.studyGroup.sendIntent({ kind: "score", value: 9 }));
  !post || !post.ok ? ok("a peer's intent after host-left is refused locally: " + JSON.stringify(post)) : bad("post-end intent was sent");
  const hostIdle = await H.evaluate((o) => { const before = G.studyGroup.counters().received; G.studyGroup._deliver({ v: 1, t: "intent", room: o.room, seq: 0, from: o.fp, body: { kind: "score", value: 9 } }); return { state: G.studyGroup.state(), received: G.studyGroup.counters().received - before, ignored: G.studyGroup.counters().ignored }; }, { room: ROOM, fp: await fpOf(P1) });
  hostIdle.state === null ? ok("a frame delivered to the host after it left applies to nothing (state null, ignored " + JSON.stringify(hostIdle.ignored) + ")") : bad("host still has state after leave: " + JSON.stringify(hostIdle.state && hostIdle.state.phase));
  const snapsAfter = log.slice(logLen).filter((x) => x.frame && x.frame.t === "snapshot");
  snapsAfter.length === 0 ? ok("no snapshot went out after the host's bye") : bad(snapsAfter.length + " snapshot(s) after bye");
  for (const p of joiners) await p.evaluate(() => G.studyGroup.leave());
  await timerProbe(H, "host, before hosting the board");

  /* ---------------- Mock Board Live: 1 candidate + 3 scorers ---------------- */
  const hosted2 = await H.evaluate((o) => G.studyGroup.host(o), { mode: "board", name: "HOST-ALPHA", category: BOARD_CAT, count: 3, pingMs: PING, holdMs: HOLD, missLimit: MISS });
  hosted2 && hosted2.ok ? ok("host() opened a Mock Board Live room " + hosted2.room) : bad("host() board: " + JSON.stringify(hosted2));
  const ROOM2 = hosted2.room;
  for (const [p, n] of [[P1, "CANDIDATE"], [P2, "SCORER-TWO"], [P3, "SCORER-THREE"]]) await p.evaluate((o) => G.studyGroup.join(o), { room: ROOM2, name: n, pingMs: PING, missLimit: MISS });
  await until(() => H.evaluate(() => G.studyGroup.state().pending.length === 3));
  for (const p of [P1, P2, P3]) await admit(p);
  const startClicked = await until(() => H.evaluate(() => { const b = document.querySelector("button.sg-start"); if (!b || b.disabled) return null; b.click(); const s = G.studyGroup.state(); return { ids: s.deck.ids.length, online: s.seats.filter((x) => x.online).length }; }));
  startClicked.hit ? ok("host clicked Start on the board lobby (" + startClicked.value.ids + " cards, " + startClicked.value.online + " online, enabled after " + startClicked.ms + " ms)") : bad("board Start never enabled: " + JSON.stringify(await H.evaluate(() => G.studyGroup._debug ? G.studyGroup._debug() : null)));
  const b0 = await until(() => P1.evaluate(() => { const s = G.studyGroup.state(); return s && s.phase === "play" && s.turnSeat === 2 && s.cardId ? s.cardId : null; }));
  b0.hit ? ok("board started: candidate is seat 2, card 1 = " + b0.value) : bad("board start: " + JSON.stringify(b0) + " host=" + JSON.stringify(await H.evaluate(() => { const s = G.studyGroup.state(); return { phase: s.phase, turnSeat: s.turnSeat, cardId: s.cardId, seq: s.seq, seats: s.seats.map((x) => [x.seatNo, x.online]) }; })) + " p1=" + JSON.stringify(await P1.evaluate(() => { const s = G.studyGroup.state(); return { phase: s.phase, turnSeat: s.turnSeat, seq: s.seq, seat: s.self.seatNo, joinState: s.joinState }; })));
  const cardOnPeer = (await until(() => P2.evaluate(() => { const q = document.querySelector(".sg-card .sg-q"); return q && q.textContent.trim().length > 5 ? q.textContent.trim().length : null; }))).value || 0;
  cardOnPeer > 5 ? ok("scorer page renders the card's question text from its own bank (id on the wire)") : bad("no question text on the scorer page");
  const cardFrames = log.filter((x) => x.frame && x.frame.t === "snapshot" && x.frame.body.snapshot.cardText);
  cardFrames.length === 0 ? ok("same bankSig everywhere: no snapshot carried inline card text") : bad(cardFrames.length + " snapshot(s) carried inline card text");

  /* Agnosticism audit, 6 Sep 2026 (bankSig content-hash gap, cardFor
     precedence): the host inlines cardText specifically because it
     detected a bank mismatch - a receiving peer must show that text over
     its own local copy for the SAME card id, or the whole inlining
     mechanism is a no-op for exactly the drift it exists to catch. Rather
     than standing up a second peer with a genuinely different bank (its
     own real integration path, exercised by refreshCardText's own byte-
     shrinking logic elsewhere), this drives cardFor() directly: mutate
     P2's live state (the object state() already hands back by reference)
     to carry a sentinel cardText for the SAME cardId P2 already has a
     real local card for, force a redraw, and read what actually painted. */
  const sentinelCheck = await P2.evaluate(() => {
    const s = G.studyGroup.state();
    const localQ = (G.store.seed().board.questions.find((q) => q.id === s.cardId) || {}).q || "";
    s.cardText = { q: "SENTINEL-INLINE-TEXT-" + s.cardId, a: "sentinel-a", category: "sentinel-cat" };
    G.studyGroup._redraw();
    return { cardId: s.cardId, localQ };
  });
  const sentinelRendered = await until(() => P2.evaluate((sentinel) => { const q = document.querySelector(".sg-card .sg-q"); return q && q.textContent.trim() === sentinel ? true : null; }, "SENTINEL-INLINE-TEXT-" + sentinelCheck.cardId), 3000);
  sentinelRendered.hit
    ? ok("cardFor() prefers host-supplied cardText over the local corpus lookup for the same card id (was backwards before this session's fix)")
    : bad("cardFor() precedence: sentinel cardText never rendered - " + JSON.stringify(await P2.evaluate(() => { const q = document.querySelector(".sg-card .sg-q"); return q ? q.textContent.trim() : null; })));

  /* card 1: candidate answers, three scorers score, candidate self-scores, host advances */
  const scoreOnce = async (p, sel) => { const r = await until(() => p.evaluate((s) => { const b = document.querySelector(s); if (!b) return null; b.click(); return true; }, sel)); return r.hit; };
  const ans = await scoreOnce(P1, "button.sg-answer");
  ans ? ok("candidate clicked \"I've answered\"") : bad("no .sg-answer on the candidate");
  const locked = await until(() => P2.evaluate(() => { const s = G.studyGroup.state(); return s.lock && s.lock.kind === "scoring" ? true : null; }));
  locked.hit ? ok("scoring lock reached the scorers") : bad("no scoring lock on P2");
  for (const [p, v] of [[H, 2], [P2, 1], [P3, 2]]) { if (!(await scoreOnce(p, 'button.sg-score[data-value="' + v + '"]'))) bad("no score button value " + v); }
  const scored3 = await until(() => H.evaluate(() => { const s = G.studyGroup.state(); return s.lock && s.lock.scored && s.lock.scored.length === 3 ? s.seats.find((x) => x.seatNo === 2).score : null; }));
  scored3.hit && scored3.value === 5 ? ok("three score intents tallied on the candidate's seat: 2+1+2 = 5") : bad("board tally: " + JSON.stringify(scored3));
  const selfScored = await scoreOnce(P1, 'button.sg-self-score[data-level="2"]');
  selfScored ? ok("candidate self-scored on its own device (the solo Mock Board path)") : bad("no .sg-self-score on the candidate");
  const advReq = await until(() => H.evaluate(() => { const s = G.studyGroup.state(); return s.lock && s.lock.advance ? true : null; }));
  advReq.hit ? ok("the candidate's advance-request reached the host") : bad("no advance-request on the host");

  /* late join during card 1 -> welcomed only at the boundary (host advance) */
  await P4.evaluate((o) => G.studyGroup.join(o), { room: ROOM2, name: "LATE-FOUR", pingMs: PING, missLimit: MISS });
  await until(() => H.evaluate(() => G.studyGroup.state().pending.length === 1));
  const fp4 = await fpOf(P4);
  const lateAdmit = await until(() => H.evaluate((f) => { const b = document.querySelector('.sg-admit[data-fp="' + f + '"]'); if (!b) return null; b.click(); return true; }, fp4));
  if (!lateAdmit.hit) bad("no Admit button for the late joiner");
  const admittedWait = await until(() => H.evaluate((f) => G.studyGroup.state().admitted.some((a) => a.fp === f) ? true : null, fp4));
  admittedWait.hit ? ok("mid-card admit is parked until the next boundary (host state.admitted)") : bad("mid-card admit was not parked");
  await sleep(400);
  const earlyWelcome = log.filter((x) => x.to === fp4 && x.frame && x.frame.t === "welcome");
  earlyWelcome.length === 0 ? ok("no welcome went to the late joiner before the boundary") : bad("late joiner welcomed mid-card");
  const p4Pending = await P4.evaluate(() => G.studyGroup.state().joinState);
  p4Pending !== "seated" ? ok("late joiner still " + p4Pending + " mid-card") : bad("late joiner seated mid-card");
  if (!(await clickWhen(H, "button.sg-advance"))) bad("no .sg-advance on the host");
  const seated4 = await until(() => P4.evaluate(() => { const s = G.studyGroup.state(); return s.joinState === "seated" ? { seat: s.self.seatNo, idx: s.round.idx, cardId: s.cardId } : null; }));
  seated4.hit && seated4.value.idx === 1 ? ok("host advanced: the late joiner landed at the boundary as seat " + seated4.value.seat + " with card 2's snapshot (" + seated4.value.cardId + ")") : bad("late join: " + JSON.stringify(seated4));

  /* card 2: burst of 900 score intents from 3 scorers */
  await scoreOnce(P1, "button.sg-answer");
  await until(() => H.evaluate(() => { const s = G.studyGroup.state(); return s.lock && s.lock.kind === "scoring" ? true : null; }));
  const seqBefore = await H.evaluate(() => G.studyGroup.state().seq);
  const rendersBefore = await H.evaluate(() => G.studyGroup.counters().renders);
  const recvBefore = await H.evaluate(() => G.studyGroup.counters().received);
  const t0 = Date.now();
  await Promise.all([P2, P3, P4].map((p) => p.evaluate(() => { for (let i = 0; i < 300; i++) G.studyGroup.sendIntent({ kind: "score", value: i % 3 }); })));
  const burstDone = await until(() => H.evaluate((b) => { const c = G.studyGroup.counters(); return c.received - b >= 900 ? c.received - b : null; }, recvBefore), 60000, 100);
  burstDone.hit ? info("host received " + burstDone.value + " frames of the burst in " + burstDone.ms + " ms") : bad("host received only " + burstDone.value + " of 900 burst frames");
  await hub.drain();
  const burstMs = Date.now() - t0;
  const after = await H.evaluate(() => ({ seq: G.studyGroup.state().seq, renders: G.studyGroup.counters().renders, received: G.studyGroup.counters().received, accepted: G.studyGroup.counters().accepted }));
  const gotIntents = log.filter((x) => x.t >= t0 && x.frame && x.frame.t === "intent" && x.frame.body.kind === "score").length;
  gotIntents >= 900 ? ok("900 score intents went through the seam in " + burstMs + " ms") : bad("burst: " + gotIntents + " intents seen");
  after.seq > seqBefore && after.seq - seqBefore <= 900 ? ok("host seq advanced monotonically by " + (after.seq - seqBefore) + " over the burst") : bad("seq " + seqBefore + " -> " + after.seq);
  const renders = after.renders - rendersBefore;
  const bound = Math.max(12, Math.ceil(burstMs / 100) + 2);
  renders <= bound ? ok("host re-rendered " + renders + " time(s) for 900 intents (bound " + bound + " at >=100 ms coalescing)") : bad("host re-rendered " + renders + " times for 900 intents (bound " + bound + ")");
  // Widened from 10000ms (measured 2026-09-06: a full 151-suite concurrent
  // run genuinely needs longer than 10s for 4 pages to relay+apply 900
  // rapid-fire intents each while several other heavy suites contend for
  // the same CPU - "peer seqs after burst: null vs 814" was 4 peers still
  // mid-catch-up, not a real desync). The line below used to run
  // unconditionally even on a miss here, so a slow-but-not-actually-broken
  // convergence crashed with an unrelated-looking "reading 'score' of
  // undefined" instead of just this one accurate bad() - guarded now, same
  // fix as the other until()-then-assume-success spots this session.
  const conv = await until(() => Promise.all([P1, P2, P3, P4].map((p) => p.evaluate(() => G.studyGroup.state().seq))).then((s) => s.every((x) => x === after.seq) ? s.join(",") : null), 30000);
  conv.hit ? ok("every peer converged on the host's seq " + after.seq + " after the burst") : bad("peer seqs after burst: " + JSON.stringify(conv.value) + " vs " + after.seq);
  if (conv.hit) {
    const tallyAfter = await H.evaluate(() => G.studyGroup.state().seats.find((x) => x.seatNo === 2).score);
    info("candidate tally after the burst (last value per scorer wins): " + tallyAfter);
  }

  /* card 3 -> recap -> end */
  if (!(await clickWhen(H, "button.sg-advance"))) bad("no .sg-advance on the host");
  await until(() => P1.evaluate(() => G.studyGroup.state().round.idx === 2));
  await scoreOnce(P1, "button.sg-answer");
  await until(() => H.evaluate(() => { const s = G.studyGroup.state(); return s.lock && s.lock.kind === "scoring" ? true : null; }));
  for (const p of [H, P2, P3, P4]) await scoreOnce(p, 'button.sg-score[data-value="1"]');
  await scoreOnce(P1, 'button.sg-self-score[data-level="1"]');
  if (!(await clickWhen(H, "button.sg-advance"))) bad("no .sg-advance on the host");
  const recap2 = await until(() => P3.evaluate(() => { const s = G.studyGroup.state(); return s.phase === "recap" ? s.seats.find((x) => x.seatNo === 2).score : null; }));
  recap2.hit ? ok("board recap reached the peers (candidate total " + recap2.value + ")") : bad("board recap: " + JSON.stringify(recap2));
  const ended = await clickWhen(H, "button.sg-end");
  ended ? ok("host clicked End session") : bad("no .sg-end");
  const endedAll = await until(async () => { const r = await Promise.all([P1, P2, P3, P4].map((p) => has(p, ".sg-terminal[data-kind=ended]"))); return r.every(Boolean) ? true : null; });
  endedAll.hit ? ok("every peer shows the ended state") : bad("ended state missing on a peer");
  const late = await P2.evaluate(() => G.studyGroup.sendIntent({ kind: "score", value: 2 }));
  !late || !late.ok ? ok("no intent applies after end (refused locally)") : bad("post-end intent sent");

  /* ---------------- X6 (P3b): heartbeat, dead-peer detection, token-required hello ---------------- */
  {
    const hosted3 = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: "HOST-ALPHA", category: CAT, timerSec: null, pingMs: PING, holdMs: HOLD, missLimit: MISS });
    hosted3 && hosted3.ok ? ok("(X6) host() opened a heartbeat room " + hosted3.room) : bad("(X6) host(): " + JSON.stringify(hosted3));
    const ROOM3 = hosted3.room;
    for (const [p, n] of [[P1, "BEAT-ONE"], [P2, "BEAT-TWO"]]) await p.evaluate((o) => G.studyGroup.join(o), { room: ROOM3, name: n, pingMs: PING, missLimit: MISS });
    await until(() => H.evaluate(() => G.studyGroup.state().pending.length === 2));
    for (const p of [P1, P2]) await admit(p);
    const fp1 = await fpOf(P1);
    const build = await P1.evaluate(() => ({ sha: window.GUIDON_BUILD_SHA || "", app: window.GUIDON_APP_VERSION || "" }));
    const hb3 = log.find((x) => x.frame && x.frame.t === "hello" && x.frame.from === fp1 && x.frame.room === ROOM3);
    hb3 && (hb3.frame.body.build || "") === build.sha && hb3.frame.body.app === build.app && build.app
      ? ok("(X6) hello carries the stamped build sha and app version as informational fields (app " + build.app + ", build " + (build.sha ? build.sha.slice(0, 7) : "unknown") + ") - PROTOCOL_VERSION stays the integer " + (await H.evaluate(() => G.roomSchema.PROTOCOL_VERSION)))
      : bad("(X6) hello body: " + JSON.stringify(hb3 && hb3.frame.body) + " vs page " + JSON.stringify(build));
    const w1 = log.filter((x) => x.frame && x.frame.t === "welcome" && x.to === fp1).pop();
    w1 && w1.frame.body.hold === Math.round(HOLD / 1000) ? ok("(X6) welcome carries the host's hold window in seconds: hold=" + w1.frame.body.hold) : bad("(X6) welcome.hold: " + JSON.stringify(w1 && w1.frame.body.hold));
    const tokBefore = await P1.evaluate(() => G.studyGroup.state().self.token);
    /* Drop P1's pongs ONLY: P1 keeps receiving every ping (the link is alive
       one way), so a host that judged liveness by anything but pongs would
       never notice. */
    hub.dropPongs(P1, true);
    const tDrop = Date.now();
    const off = await until(() => H.evaluate((f) => { const s = G.studyGroup.state().seats.find((x) => x.fp === f); return s && !s.online ? { offlineAt: s.offlineAt, token: s.token } : null; }, fp1), PING * (MISS + 4) + 2000, 50);
    const lo = PING * MISS - PING, hi = PING * (MISS + 2) + 1000;
    off.hit && off.ms >= lo && off.ms <= hi
      ? ok("(X6) dead-peer detection: " + MISS + " missed pongs at " + PING + " ms -> seat offline after " + off.ms + " ms (window " + lo + "-" + hi + " ms)")
      : bad("(X6) seat offline after dropped pongs: " + JSON.stringify(off));
    off.value && off.value.offlineAt >= tDrop && off.value.token === tokBefore ? ok("(X6) the hold window started (offlineAt stamped) and the token is kept") : bad("(X6) offline seat: " + JSON.stringify(off.value));
    const pingsIn = log.filter((x) => x.frame && x.frame.t === "ping" && x.to === fp1 && x.t >= tDrop && !x.dropped).length;
    const pongsDropped = log.filter((x) => x.dropped === "pong-dropped" && x.frame && x.frame.from === fp1).length;
    pingsIn >= MISS && pongsDropped >= MISS ? ok("(X6) while cut off, P1 still received " + pingsIn + " ping(s) and " + pongsDropped + " of its pongs were dropped by the harness") : bad("(X6) pings delivered " + pingsIn + ", pongs dropped " + pongsDropped);
    const lost = await until(() => P1.evaluate(() => { const s = G.studyGroup.state(); return s && s.terminal && s.terminal.kind === "network-lost" ? true : null; }), PING * (MISS + 4) + 2000);
    lost.hit ? ok("(X6) the held seat's page reached network-lost by its own miss count " + lost.ms + " ms after the host stopped pinging it") : bad("(X6) P1 never entered network-lost");
    const holdCopy = await until(() => P1.evaluate(() => { const t = document.querySelector(".sg-terminal[data-kind=network-lost]"); return t ? t.textContent : null; }));
    holdCopy.hit && new RegExp("held for " + Math.round(HOLD / 1000) + " s").test(holdCopy.value) ? ok("(X6) the network-lost panel names the HOST's hold window (" + Math.round(HOLD / 1000) + " s from welcome.hold), not the 60 s default") : bad("(X6) network-lost copy: " + JSON.stringify(holdCopy.value && holdCopy.value.slice(0, 200)));
    hub.dropPongs(P1, false);
    /* A hello from the held seat's fingerprint WITHOUT its token must not
       re-seat it: the token is required on reconnect. */
    const logAt = log.length;
    await P1.evaluate((o) => window.__roomTransport.send({ v: G.roomSchema.PROTOCOL_VERSION, t: "hello", room: o.room, seq: 0, from: o.fp, body: { name: "BEAT-ONE", bankSig: G.roomSchema.bankSig(G.store.seed()) } }, null), { room: ROOM3, fp: fp1 });
    const rejNoTok = await until(() => { const e = log.slice(logAt).find((x) => x.frame && x.frame.t === "reject" && x.to === fp1); return e ? e.frame.body.reason : null; });
    rejNoTok.hit ? ok("(X6) a hello from a held seat's fingerprint without its resume token is rejected: \"" + rejNoTok.value + "\"") : bad("(X6) token-less hello from a held fp was not rejected");
    const noWelcome = log.slice(logAt).filter((x) => x.frame && x.frame.t === "welcome" && x.to === fp1).length === 0;
    const stillOff = await H.evaluate((f) => { const s = G.studyGroup.state().seats.find((x) => x.fp === f); return s ? { online: s.online, token: s.token } : null; }, fp1);
    noWelcome && stillOff && !stillOff.online && stillOff.token === tokBefore ? ok("(X6) no welcome went out and the seat is still held (offline, same token)") : bad("(X6) after token-less hello: welcome " + !noWelcome + " seat " + JSON.stringify(stillOff));
    const rc3 = await P1.evaluate(() => G.studyGroup.reconnect());
    const back3 = await until(() => H.evaluate((f) => { const s = G.studyGroup.state().seats.find((x) => x.fp === f); return s && s.online ? s.token : null; }, fp1));
    const p1After = await P1.evaluate(() => ({ token: G.studyGroup.state().self.token, joinState: G.studyGroup.state().joinState, terminal: G.studyGroup.state().terminal }));
    rc3 && rc3.ok && back3.hit && back3.value === tokBefore && p1After.token === tokBefore && p1After.joinState === "seated" && !p1After.terminal
      ? ok("(X6) reconnect() with the resume token re-seated the SAME seat with the SAME token after " + back3.ms + " ms")
      : bad("(X6) reconnect: " + JSON.stringify({ rc3, back3: back3.value, p1After }));
    const toks = await H.evaluate(() => G.studyGroup.state().seats.map((s) => s.token));
    new Set(toks).size === toks.length && toks.every((t) => typeof t === "string" && t.length >= 16 && (!build.sha || !t.includes(build.sha.slice(0, 7))))
      ? ok("(X6) seat tokens are unique, >= 16 chars and never contain the build sha (" + toks.length + " seats)") : bad("(X6) tokens: " + JSON.stringify(toks));
    tokRoom1 && tokBefore && tokRoom1 !== tokBefore ? ok("(X6) P1's seat token differs between sessions (random per session, not derived)") : bad("(X6) tokens across sessions: " + tokRoom1 + " vs " + tokBefore);
    await H.evaluate(() => G.studyGroup.leave());
    const hl = await until(async () => { const r = await Promise.all([P1, P2].map((p) => has(p, ".sg-terminal[data-kind=host-left]"))); return r.every(Boolean) ? true : null; });
    hl.hit ? ok("(X6) host-left terminal rendered on both peers after leave() (" + hl.ms + " ms)") : bad("(X6) host-left state missing");
    for (const p of [P1, P2]) await p.evaluate(() => G.studyGroup.leave());
  }

  /* ---------------- X9 (P3b): host-screen ladder, hotspot toggle, cap warning ---------------- */
  {
    const hosted4 = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: "HOST-ALPHA", category: CAT, timerSec: null, pingMs: PING, holdMs: HOLD, missLimit: MISS });
    hosted4 && hosted4.ok ? ok("(X9) host() opened a room for the ladder " + hosted4.room) : bad("(X9) host(): " + JSON.stringify(hosted4));
    const ROOM4 = hosted4.room;
    const created = await H.evaluate(() => G.studyGroup.state().createdAt);
    const setClock = (ms) => H.evaluate((t) => { G.studyGroup._setClock(() => t); G.studyGroup._redraw(); }, created + ms);
    await setClock(1000);
    const urlShown = await until(() => H.evaluate(() => { const u = document.querySelector(".sg-join-url"); return u && u.textContent.trim() ? u.textContent.trim() : null; }));
    urlShown.hit && urlShown.value.includes(ROOM4) && /^https?:\/\//.test(urlShown.value) ? ok("(X9) the join URL is shown and carries the room code: " + urlShown.value) : bad("(X9) join URL: " + JSON.stringify(urlShown.value));
    const urlBig = await H.evaluate(() => { const u = document.querySelector(".sg-join-url"); return u ? parseFloat(getComputedStyle(u).fontSize) : 0; });
    urlBig >= 20 ? ok("(X9) the join URL is large type (" + urlBig + "px)") : bad("(X9) join URL font-size " + urlBig + "px");
    // Stage 1.5: a valid join URL must render as a REAL <svg> QR code (not
    // the dashed-box fallback) - src/app-modules/qrcode.js's own
    // tools/test-qrcode.mjs proves the encoding is correct; this just
    // proves the UI actually calls it and wires up the fallback contract.
    const qr = await H.evaluate(() => {
      const svg = document.querySelector(".sg-qr-wrap svg.sg-qr");
      const slotPresent = !!document.querySelector(".sg-qr-slot");
      if (!svg) return { svg: null, slotPresent };
      return { svg: { viewBox: svg.getAttribute("viewBox"), width: Number(svg.getAttribute("width")), ariaLabel: svg.getAttribute("aria-label") }, slotPresent };
    });
    qr.svg && qr.svg.viewBox && qr.svg.width > 0 && qr.svg.ariaLabel && !qr.slotPresent
      ? ok("(X9) a real QR code (inline <svg>, hand-rolled ISO/IEC 18004 encoder) renders for the join link - no dashed placeholder shown")
      : bad("(X9) qr: " + JSON.stringify(qr));
    const codeShown = await H.evaluate(() => (document.querySelector(".sg-room-code") || { textContent: "" }).textContent.trim());
    codeShown === ROOM4 ? ok("(X9) the phonetic code is shown beside the URL") : bad("(X9) code shown: " + codeShown);

    /* ---------------- secure join link (room-tls-and-discovery-pitch.md Section 1.3.6/stage 4-5) ---------------- */
    {
      // Default: the fake transport (room-harness.mjs) has no secureJoinUrl() at all - the SAME "a transport without the hook changes nothing" contract as joinUrl()/addresses() - so only the plain link shows, still labeled bare "Join link".
      const noSecure = await H.evaluate(() => ({
        secureBox: !!document.querySelector(".sg-invite-secure"),
        plainLabel: (document.querySelector(".sg-invite-plain .eyebrow") || {}).textContent || null,
      }));
      !noSecure.secureBox && noSecure.plainLabel === "Join link"
        ? ok("(X9) with no secureJoinUrl() on the transport (RoomInfo has no tlsPort/identity), only the plain join link shows, labeled plain \"Join link\" - a clean, additive fallback, not a broken half-rendered section")
        : bad("(X9) no-secure-link fallback: " + JSON.stringify(noSecure));

      // Stand in for a Rust rebuild whose RoomInfo carries tlsPort/identity: room-tauri.js's real secureJoinUrl() builds this same shape from rt.info.ip/tlsPort/identity.spkiSha256 - here the fake transport is given the getter directly, proving studygroup.js's OWN reactive rendering of it.
      const SECURE_URL = "https://198.51.100.7:8443/j/" + ROOM4 + "#pin=" + "cd".repeat(32);
      await H.evaluate((url) => { window.__roomTransport.secureJoinUrl = function () { return url; }; G.studyGroup._redraw(); }, SECURE_URL);
      const withSecure = await until(() => H.evaluate((url) => {
        const secureBox = document.querySelector(".sg-invite-secure");
        if (!secureBox) return null;
        const secureUrlText = (secureBox.querySelector(".sg-join-url") || {}).textContent || null;
        if (secureUrlText !== url) return null;
        return {
          plainLabel: (document.querySelector(".sg-invite-plain .eyebrow") || {}).textContent || null,
          secureLabel: (secureBox.querySelector(".eyebrow") || {}).textContent || null,
          secureUrlText,
          hasSvg: !!secureBox.querySelector(".sg-qr-wrap svg.sg-qr"),
          plainStillShown: (document.querySelector(".sg-invite-plain .sg-join-url") || {}).textContent || null,
        };
      }, SECURE_URL));
      withSecure.hit && withSecure.value.plainLabel === "Join link (browser or guest page)" && /secure/i.test(withSecure.value.secureLabel) && withSecure.value.hasSvg && withSecure.value.plainStillShown === urlShown.value
        ? ok("(X9) once RoomInfo carries tlsPort/identity (secureJoinUrl() present), a SECOND join link + its own QR code renders labeled \"" + withSecure.value.secureLabel + "\", the plain link stays (relabeled \"" + withSecure.value.plainLabel + "\"): " + withSecure.value.secureUrlText)
        : bad("(X9) secure join link block: " + JSON.stringify(withSecure.value));

      // Removing the capability again drops the secure block and restores the plain bare label - proves this is reactive, not a one-shot render.
      await H.evaluate(() => { delete window.__roomTransport.secureJoinUrl; G.studyGroup._redraw(); });
      const backToPlain = await until(() => H.evaluate(() => document.querySelector(".sg-invite-secure") ? null : ((document.querySelector(".sg-invite-plain .eyebrow") || {}).textContent || "")));
      backToPlain.hit && backToPlain.value === "Join link"
        ? ok("(X9) removing secureJoinUrl() drops the secure block again and restores the plain \"Join link\" label")
        : bad("(X9) after removing secureJoinUrl(): " + JSON.stringify(backToPlain));
    }

    const tierAt = async (ms, want, re, label) => {
      await setClock(ms);
      const r = await until(() => H.evaluate((w) => { const l = document.querySelector(".sg-ladder"); return l && l.getAttribute("data-tier") === w ? l.textContent : null; }, want));
      r.hit && re.test(r.value) ? ok("(X9) " + label + ": tier " + want + " at " + ms / 1000 + " s: \"" + r.value.trim().slice(0, 100) + "\"") : bad("(X9) " + label + " at " + ms + " ms: " + JSON.stringify(r.value));
      return r.value || "";
    };
    await tierAt(1000, "0", /waiting/i, "0-20 s");
    await tierAt(25000, "1", /same wi-fi or hotspot/i, "20-40 s");
    const t2 = await tierAt(45000, "2", /typ(e|ing) the (url|link|address)/i, "40-60 s");
    /host from a phone/i.test(t2) ? ok("(X9) on a laptop (fine pointer) tier 2 adds \"host from a phone instead\" (X10)") : bad("(X9) tier 2 lacks the laptop line: " + t2.slice(0, 160));
    const gwAuto = await H.evaluate(() => { const g = document.querySelector(".sg-gateway"); return g ? g.getAttribute("data-auto") : null; });
    gwAuto === "true" ? ok("(X9) default: someone else is the hotspot, gateway auto-detect text on") : bad("(X9) .sg-gateway data-auto = " + gwAuto);
    await click(H, ".sg-hotspot-self");
    const gwOff = await until(() => H.evaluate(() => { const g = document.querySelector(".sg-gateway"); return g && g.getAttribute("data-auto") === "false" ? g.textContent : null; }));
    gwOff.hit && /auto-detect off/i.test(gwOff.value) && (await has(H, '.sg-hotspot-self[aria-pressed="true"]')) ? ok("(X9) \"I am the hotspot\" disables the gateway auto-detect text: \"" + gwOff.value.trim().slice(0, 100) + "\"") : bad("(X9) hotspot self: " + JSON.stringify(gwOff.value));
    await click(H, ".sg-hotspot-other");
    const gwOn = await until(() => H.evaluate(() => { const g = document.querySelector(".sg-gateway"); return g && g.getAttribute("data-auto") === "true" ? true : null; }));
    gwOn.hit ? ok("(X9) \"someone else is\" restores the auto-detect text") : bad("(X9) hotspot other did not restore data-auto");
    /* Cap: 7 synthetic joiners through the host's own inbound path, admitted
       one by one through the real Admit buttons; the warning must appear at
       seat 8 and not before. */
    const syn = ["CAPSEATA", "CAPSEATB", "CAPSEATC", "CAPSEATD", "CAPSEATE", "CAPSEATF", "CAPSEATG"];
    let capEarly = false, ladderGone = false;
    for (let i = 0; i < syn.length; i++) {
      await H.evaluate((o) => G.studyGroup._deliver({ v: G.roomSchema.PROTOCOL_VERSION, t: "hello", room: o.room, seq: 0, from: o.fp, body: { name: "SYN-" + o.fp.slice(-1), bankSig: G.roomSchema.bankSig(G.store.seed()) } }), { room: ROOM4, fp: syn[i] });
      const clicked = await until(() => H.evaluate((f) => { const b = document.querySelector('.sg-admit[data-fp="' + f + '"]'); if (!b) return null; b.click(); return true; }, syn[i]));
      if (!clicked.hit) bad("(X9) no Admit button for synthetic joiner " + syn[i]);
      const seated = await until(() => H.evaluate((n) => G.studyGroup.state().seats.length === n ? n : null, i + 2));
      if (!seated.hit) bad("(X9) seats after admit " + (i + 1) + ": " + JSON.stringify(seated.value));
      if (i === 0) ladderGone = (await until(() => H.evaluate(() => document.querySelector(".sg-ladder") ? null : true))).hit;
      if (i < syn.length - 1) { await sleep(150); if (await has(H, ".sg-cap-warn")) capEarly = true; }
    }
    ladderGone ? ok("(X9) the no-joiners ladder goes away once the first joiner is seated") : bad("(X9) the ladder stayed after a seat was taken");
    !capEarly ? ok("(X9) no hotspot-cap warning at 7 seats or fewer") : bad("(X9) the cap warning appeared before seat 8");
    const cap = await until(() => H.evaluate(() => { const w = document.querySelector(".sg-cap-warn"); return w ? w.textContent : null; }));
    cap.hit && /8/.test(cap.value) ? ok("(X9) the hotspot-cap warning appears at seat 8: \"" + cap.value.trim().slice(0, 120) + "\"") : bad("(X9) cap warning at 8 seats: " + JSON.stringify(cap.value));
    await H.evaluate(() => { G.studyGroup._setClock(null); G.studyGroup.leave(); });
  }

  /* ---------------- noise ---------------- */
  const total = noise.reduce((n, a) => n + a.length, 0);
  total === 0 ? ok("zero page errors and zero console errors across all 6 pages") : bad("noise: " + noise.map((a, i) => a.length ? "p" + i + ": " + a.slice(0, 3).join(" | ") : "").filter(Boolean).join(" || "));
  info("hub: " + JSON.stringify(hub.stats));
} catch (e) {
  bad("suite error: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
} finally {
  await close().catch(() => {});
  await new Promise((r) => server.close(r));
}
console.log("\n" + (fails ? `ROOM SESSION: ${fails} FAILURE(S)` : "ROOM SESSION: all passed"));
process.exit(fails ? 1 : 0);
