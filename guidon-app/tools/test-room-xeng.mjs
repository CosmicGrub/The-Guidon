/**
 * Cross-engine room session (collective P3b, X4): ONE test process holds a
 * Chromium page as host and a WebKit page as joiner (then the mirror), with
 * every frame relayed by THIS process at the room module's transport seam
 * (tools/room-harness.mjs fakeTransport - the seam is what gets mocked,
 * never the WebSocket class). Two engines, two browsers, two IndexedDBs:
 * the closest thing to iOS-with-Android this laptop can run. The two
 * launches live in tools/xeng-harness.mjs; this file launches nothing.
 * Written BEFORE the P3b module changes - its first run is the RED baseline.
 *
 * Per direction (chromium-host/webkit-joiner, then webkit-host/chromium-
 * joiner), each with its latency reported:
 *   - version skew: the joiner (pending) sends a hello with PROTOCOL_VERSION
 *     + 1 -> the host answers the exact sentence "update GUIDON on one
 *     device", the joiner renders it, the host's message names both builds
 *   - join / admit (by hand, the real Admit button) / welcome -> seated
 *   - a Rapid-Fire relay round: both seats play through the REAL beginRound
 *     engine on their own engine, the host tallies, recap agrees
 *   - a Mock Board Live board with a synthetic candidate (seat 2, fed
 *     through the host's own inbound path) and the joiner page SCORING
 *   - buzz ORDER is reserved (P7): instead, 30 score intents under 200 ms
 *     of independent per-frame jitter (real reordering at the seam) - the
 *     host's final value is the one that ARRIVED last (host receive order
 *     is the rule), seq stays monotonic, every intent is received
 *   - reconnect with the seat token after the link is cut
 *   - host leaves -> host-left terminal on the joiner
 *   - zero page errors and console errors in both engines
 *
 * Usage: node tools/test-room-xeng.mjs   (exit code = FAIL count). Skips
 * aloud (exit 0) when Playwright WebKit is not installed.
 */
import { serve } from "./server.mjs";
import { fakeTransport } from "./room-harness.mjs";
import { openXeng, closeXeng, webkitAvailable } from "./xeng-harness.mjs";

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
const WATCHDOG_MS = 300000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nROOM XENG: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

const PING = 1000, MISS = 3, HOLD = 8000;
const CAT = "Army Fitness Test (AFT)";
const BOARD_CAT = "Creeds";
const has = (p, sel) => p.evaluate((s) => !!document.querySelector(s), sel);
const clickWhen = async (p, sel) => until(() => p.evaluate((s) => { const b = document.querySelector(s); if (!b || b.disabled) return null; b.click(); return true; }, sel));
const clickText = (p, text) => p.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t); if (!b) return false; b.click(); return true; }, text);
const fpOf = (p) => p.evaluate(() => G.studyGroup.session().fp);
const latency = {};

if (!webkitAvailable()) {
  info("SKIP: Playwright WebKit is not installed here (npx playwright install webkit); ci.yml installs Chromium only, so this suite cannot run there");
  console.log("\nROOM XENG: skipped (no WebKit)");
  process.exit(0);
}

console.log("test-room-xeng: Chromium host + WebKit joiner, then the mirror; frames relayed by this process at the seam\n");
const { server, url } = await serve("web");

async function direction(hostEngine) {
  const tag = hostEngine + "-host";
  const lat = (name, ms) => { latency[tag + " " + name] = ms; info("latency[" + tag + "] " + name + ": " + ms + " ms"); };
  const log = [];
  const pair = await openXeng(url, { hostEngine, hash: "#/group" });
  const { host: H, joiner: J, joinerEngine, noise } = pair;
  const uas = await Promise.all([H, J].map((p) => p.evaluate(() => navigator.userAgent)));
  const isWk = (ua) => /AppleWebKit/.test(ua) && !/Chrome/.test(ua);
  const isCr = (ua) => /Chrome\//.test(ua);
  (hostEngine === "chromium" ? isCr(uas[0]) && isWk(uas[1]) : isWk(uas[0]) && isCr(uas[1]))
    ? ok("[" + tag + "] engines confirmed by UA: host " + (hostEngine === "chromium" ? "Chromium" : "WebKit") + ", joiner " + (joinerEngine === "webkit" ? "WebKit" : "Chromium"))
    : bad("[" + tag + "] UA mismatch: " + uas.join(" || "));
  const hub = fakeTransport({ log });
  await hub.wire(H, { host: true });
  await hub.wire(J, { host: false });
  for (const p of [H, J]) { const r = await p.evaluate(() => G.studyGroup.attach(window.__roomTransport)); if (!r || !r.ok) bad("[" + tag + "] attach: " + JSON.stringify(r)); }
  const led = await Promise.all([H, J].map((p) => p.evaluate(() => G.netLedger.list().length)));
  led.every((n) => n === 1) ? ok("[" + tag + "] G.netLedger.record() once per page on attach") : bad("[" + tag + "] ledger " + led.join(","));

  /* ---------------- host, join pending, version skew ---------------- */
  const hosted = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: "HOST-" + hostEngine.toUpperCase(), category: CAT, timerSec: null, pingMs: PING, holdMs: HOLD, missLimit: MISS });
  hosted && hosted.ok ? ok("[" + tag + "] host() opened relay room " + hosted.room) : bad("[" + tag + "] host(): " + JSON.stringify(hosted));
  const ROOM = hosted.room;
  await J.evaluate((o) => G.studyGroup.join(o), { room: ROOM, name: "JOINER-" + joinerEngine.toUpperCase(), pingMs: PING, missLimit: MISS });
  const pend = await until(() => H.evaluate(() => G.studyGroup.state().pending.length === 1 ? true : null));
  pend.hit ? ok("[" + tag + "] the joiner's hello is pending on the host") : bad("[" + tag + "] pending: " + JSON.stringify(pend));
  const jfp = await fpOf(J);
  const tSkew = Date.now();
  await J.evaluate((o) => window.__roomTransport.send({ v: G.roomSchema.PROTOCOL_VERSION + 1, t: "hello", room: o.room, seq: 0, from: o.fp, body: { name: "OLD-BUILD", bankSig: "x", build: "0123456789ab", app: "1.4.0" } }, null), { room: ROOM, fp: jfp });
  const rej = await until(() => { const e = log.find((x) => x.frame && x.frame.t === "reject" && x.to === jfp && x.t >= tSkew); return e ? e.frame.body.reason : null; });
  rej.hit && rej.value === "update GUIDON on one device" ? ok("[" + tag + "] a v+1 hello from the " + joinerEngine + " joiner is answered with the exact sentence \"" + rej.value + "\"") : bad("[" + tag + "] skew reject: " + JSON.stringify(rej.value));
  const jRej = await until(() => J.evaluate(() => { const t = document.querySelector(".sg-terminal[data-kind=rejected]"); return t ? t.textContent : null; }));
  lat("version skew -> rejected panel on the joiner", jRej.ms + rej.ms);
  jRej.hit && jRej.value.includes("update GUIDON on one device") ? ok("[" + tag + "] the joiner renders the rejected state with the sentence") : bad("[" + tag + "] joiner rejected panel: " + JSON.stringify(jRej.value && jRej.value.slice(0, 160)));
  const hb = await H.evaluate(() => ({ sha: (window.GUIDON_BUILD_SHA || "").slice(0, 7), app: window.GUIDON_APP_VERSION || "" }));
  const skewMsg = await until(() => H.evaluate(() => { const m = document.querySelector(".sg-msg"); return m ? m.textContent : null; }));
  skewMsg.hit && skewMsg.value.includes("joiner: GUIDON 1.4.0 build 0123456") && skewMsg.value.includes("this device: GUIDON " + hb.app) ? ok("[" + tag + "] the host's message names both builds: \"" + skewMsg.value.trim().slice(0, 140) + "\"") : bad("[" + tag + "] host skew message: " + JSON.stringify(skewMsg.value));
  await J.evaluate(() => G.studyGroup.leave());

  /* ---------------- join / admit / welcome ---------------- */
  await J.evaluate((o) => G.studyGroup.join(o), { room: ROOM, name: "JOINER-" + joinerEngine.toUpperCase(), pingMs: PING, missLimit: MISS });
  const jfp2 = await fpOf(J);
  const admitBtn = await until(() => H.evaluate((f) => { const b = document.querySelector('.sg-admit[data-fp="' + f + '"]'); if (!b) return null; b.click(); return true; }, jfp2));
  admitBtn.hit ? ok("[" + tag + "] the host clicked Admit for the joiner (admit-each)") : bad("[" + tag + "] no Admit button");
  const tAdmit = Date.now();
  const seated = await until(() => J.evaluate(() => { const s = G.studyGroup.state(); return s && s.joinState === "seated" ? { seat: s.self.seatNo, token: s.self.token } : null; }));
  lat("admit click -> joiner seated", Date.now() - tAdmit);
  seated.hit && seated.value.seat === 2 ? ok("[" + tag + "] welcome seated the joiner as seat 2 with a token (" + seated.value.token.length + " chars)") : bad("[" + tag + "] seated: " + JSON.stringify(seated));
  const noAdmitAll = await H.evaluate(() => !/admit all/i.test(document.getElementById("route").textContent || ""));
  noAdmitAll ? ok("[" + tag + "] no Admit all control on the host screen") : bad("[" + tag + "] an Admit all control exists");
  await J.evaluate(() => G.studyGroup.sendIntent({ kind: "ready" }));
  const ready = await until(() => H.evaluate(() => G.studyGroup.state().seats.every((s) => s.ready) ? true : null));
  ready.hit ? ok("[" + tag + "] ready intent tallied") : bad("[" + tag + "] ready: " + JSON.stringify(ready));

  /* ---------------- Rapid-Fire relay round ---------------- */
  const started = await clickWhen(H, "button.sg-start");
  started.hit ? ok("[" + tag + "] host clicked Start") : bad("[" + tag + "] no enabled Start");
  const scores = [2, 3];
  let relayOk = true;
  for (let i = 0; i < 2; i++) {
    const p = i === 0 ? H : J;
    const turn = await until(() => p.evaluate((n) => { const s = G.studyGroup.state(); return s && s.phase === "play" && s.turnSeat === n && !!document.querySelector("button.sg-play-round") ? true : null; }, i + 1));
    if (!turn.hit) { relayOk = false; bad("[" + tag + "] seat " + (i + 1) + " never got its turn"); break; }
    await p.evaluate(() => document.querySelector("button.sg-play-round").click());
    const card = await until(() => p.evaluate(() => !!document.querySelector(".rf-card .rf-question") && !!document.querySelector(".rf-judge-correct")));
    if (!card.hit) { relayOk = false; bad("[" + tag + "] seat " + (i + 1) + ": the Rapid Fire engine did not render"); break; }
    for (let k = 0; k < scores[i]; k++) { await p.evaluate(() => document.querySelector(".rf-judge-correct").click()); await sleep(40); }
    await p.evaluate(() => document.querySelector(".rf-judge-pass").click());
    const tEnd = Date.now();
    await clickText(p, "End Round");
    const tallied = await until(() => H.evaluate((n) => { const s = G.studyGroup.state(); const seat = s.seats.find((x) => x.seatNo === n); return seat && seat.done ? seat.score : null; }, i + 1));
    if (i === 1) lat("joiner End Round -> host tally", Date.now() - tEnd);
    if (!tallied.hit || tallied.value !== scores[i]) { relayOk = false; bad("[" + tag + "] seat " + (i + 1) + " tally " + JSON.stringify(tallied.value) + " (expected " + scores[i] + ")"); }
  }
  if (relayOk) ok("[" + tag + "] both seats played a Party round through the real engine on their own engine; host tallied " + scores.join(","));
  const recap = await until(() => J.evaluate(() => { const s = G.studyGroup.state(); return s && s.phase === "recap" ? s.seats.map((x) => x.score).join(",") : null; }));
  recap.hit && recap.value === scores.join(",") ? ok("[" + tag + "] recap on the joiner agrees with the host: " + recap.value) : bad("[" + tag + "] recap: " + JSON.stringify(recap));
  await H.evaluate(() => G.studyGroup.leave());
  const hl1 = await until(() => has(J, ".sg-terminal[data-kind=host-left]"));
  hl1.hit ? ok("[" + tag + "] host leave() -> host-left on the joiner (" + hl1.ms + " ms)") : bad("[" + tag + "] host-left missing after the relay");
  await J.evaluate(() => G.studyGroup.leave());

  /* ---------------- Mock Board Live: synthetic candidate seat 2, joiner scores ---------------- */
  const hosted2 = await H.evaluate((o) => G.studyGroup.host(o), { mode: "board", name: "HOST-" + hostEngine.toUpperCase(), category: BOARD_CAT, count: 3, pingMs: PING, holdMs: HOLD, missLimit: MISS });
  hosted2 && hosted2.ok ? ok("[" + tag + "] host() opened a Mock Board Live room " + hosted2.room) : bad("[" + tag + "] board host(): " + JSON.stringify(hosted2));
  const ROOM2 = hosted2.room;
  const CAND = "CANDCAND";
  const feed = (frame) => H.evaluate((f) => G.studyGroup._deliver(f), frame);
  const mkc = (t, body) => ({ v: 1, t, room: ROOM2, seq: 0, from: CAND, body });
  await feed(mkc("hello", { name: "CANDIDATE", bankSig: await H.evaluate(() => G.roomSchema.bankSig(G.store.seed())) }));
  const admC = await until(() => H.evaluate((f) => { const b = document.querySelector('.sg-admit[data-fp="' + f + '"]'); if (!b) return null; b.click(); return true; }, CAND));
  admC.hit ? ok("[" + tag + "] synthetic candidate admitted as seat 2 through the real Admit button") : bad("[" + tag + "] no Admit for the candidate");
  await J.evaluate((o) => G.studyGroup.join(o), { room: ROOM2, name: "SCORER-" + joinerEngine.toUpperCase(), pingMs: PING, missLimit: MISS });
  const jfp3 = await fpOf(J);
  await until(() => H.evaluate((f) => { const b = document.querySelector('.sg-admit[data-fp="' + f + '"]'); if (!b) return null; b.click(); return true; }, jfp3));
  const seat3 = await until(() => J.evaluate(() => { const s = G.studyGroup.state(); return s && s.joinState === "seated" ? s.self.seatNo : null; }));
  seat3.hit && seat3.value === 3 ? ok("[" + tag + "] the joiner is seat 3 (a scorer)") : bad("[" + tag + "] joiner seat: " + JSON.stringify(seat3));
  const startB = await clickWhen(H, "button.sg-start");
  startB.hit ? ok("[" + tag + "] host started the board") : bad("[" + tag + "] board Start never enabled");
  const cardJ = await until(() => J.evaluate(() => { const s = G.studyGroup.state(); const q = document.querySelector(".sg-card .sg-q"); return s.phase === "play" && s.turnSeat === 2 && q && q.textContent.trim().length > 5 ? s.cardId : null; }));
  cardJ.hit ? ok("[" + tag + "] card 1 (" + cardJ.value + ") renders on the joiner from its own bank; candidate is seat 2") : bad("[" + tag + "] card on joiner: " + JSON.stringify(cardJ));
  const tAns = Date.now();
  await feed(mkc("intent", { kind: "answer" }));
  const lock = await until(() => J.evaluate(() => { const s = G.studyGroup.state(); return s.lock && s.lock.kind === "scoring" && document.querySelectorAll("button.sg-score").length >= 3 ? true : null; }));
  lat("candidate answer -> score buttons on the joiner", Date.now() - tAns);
  lock.hit ? ok("[" + tag + "] the scoring lock reached the joiner and its score buttons rendered") : bad("[" + tag + "] no scoring lock on the joiner");
  const tScore = Date.now();
  const sc = await clickWhen(J, 'button.sg-score[data-value="2"]');
  const tallyJ = await until(() => H.evaluate(() => { const s = G.studyGroup.state(); const per = (s.scores["0"] || {}); return per["3"] === 2 ? s.seats.find((x) => x.seatNo === 2).score : null; }));
  lat("joiner score click -> host tally", Date.now() - tScore);
  sc.hit && tallyJ.hit && tallyJ.value === 2 ? ok("[" + tag + "] the " + joinerEngine + " page scored 2 and the host tallied it on the candidate's seat") : bad("[" + tag + "] score: " + JSON.stringify({ sc: sc.hit, tallyJ }));
  const hostScored = await clickWhen(H, 'button.sg-score[data-value="1"]');
  const tally2 = await until(() => H.evaluate(() => { const s = G.studyGroup.state(); return s.lock && s.lock.scored && s.lock.scored.length === 2 ? s.seats.find((x) => x.seatNo === 2).score : null; }));
  hostScored.hit && tally2.hit && tally2.value === 3 ? ok("[" + tag + "] host scored 1: candidate total 3") : bad("[" + tag + "] host score: " + JSON.stringify(tally2));

  /* ---------------- ordering under 200 ms jitter (buzz order reserved) ---------------- */
  hub.setJitter(200);
  const recvBefore = await H.evaluate(() => G.studyGroup.counters().received);
  const seqBefore = await H.evaluate(() => G.studyGroup.state().seq);
  const tJ = Date.now();
  await J.evaluate(() => { for (let i = 0; i < 30; i++) G.studyGroup.sendIntent({ kind: "score", value: i % 3 }); });
  const got = await until(() => H.evaluate((b) => { const c = G.studyGroup.counters(); return c.received - b >= 30 ? c.received - b : null; }, recvBefore), 15000);
  await hub.drain();
  await sleep(300);
  hub.setJitter(0);
  const jitterMs = Date.now() - tJ;
  /* The oracle is the HOST'S OWN receive order: rec.arrival is the host
     page's receive counter, taken in-page in the turn that ran the handler
     (room-harness.mjs deliverTo). A Node-side timestamp after the evaluate
     resolves is not that order - it ties at 1 ms and the round trips back
     to Node can resolve out of order - which is exactly what made this
     assertion flake ("final value 1 vs last-arrived 2"). */
  const intents = log.filter((x) => x.t >= tJ && x.frame && x.frame.t === "intent" && x.frame.body.kind === "score" && x.frame.from === jfp3 && x.arrival);
  const bySend = intents.slice().sort((a, b) => a.n - b.n);
  const byArrival = intents.slice().sort((a, b) => a.arrival - b.arrival);
  const reordered = bySend.some((x, i) => byArrival[i] !== x);
  const last = byArrival[byArrival.length - 1];
  const hostVal = await H.evaluate(() => (G.studyGroup.state().scores["0"] || {})["3"]);
  const seqAfter = await H.evaluate(() => G.studyGroup.state().seq);
  got.hit && intents.length === 30 ? ok("[" + tag + "] all 30 score intents were received by the host under 200 ms per-frame jitter (" + jitterMs + " ms)") : bad("[" + tag + "] jitter burst: received " + JSON.stringify(got.value) + ", logged " + intents.length);
  reordered ? ok("[" + tag + "] the seam really reordered them (arrival order differs from send order)") : info("[" + tag + "] no reordering happened this run (jitter draw)");
  last && hostVal === last.frame.body.value ? ok("[" + tag + "] host receive order is the rule: the final value " + hostVal + " is the intent that ARRIVED last (send #" + last.n + "), not the one sent last (value " + bySend[bySend.length - 1].frame.body.value + ")") : bad("[" + tag + "] final value " + hostVal + " vs last-arrived " + JSON.stringify(last && last.frame.body.value));
  seqAfter >= seqBefore && seqAfter - seqBefore <= 30 ? ok("[" + tag + "] host seq advanced monotonically by " + (seqAfter - seqBefore)) : bad("[" + tag + "] seq " + seqBefore + " -> " + seqAfter);
  const conv = await until(() => J.evaluate((s) => G.studyGroup.state().seq === s ? true : null, seqAfter));
  conv.hit ? ok("[" + tag + "] the joiner converged on the host's seq " + seqAfter) : bad("[" + tag + "] joiner seq did not converge");

  /* ---------------- reconnect with the seat token ---------------- */
  const before = await J.evaluate(() => ({ seat: G.studyGroup.state().self.seatNo, token: G.studyGroup.state().self.token }));
  hub.kill(J);
  const tKill = Date.now();
  const off = await until(() => H.evaluate((f) => { const s = G.studyGroup.state().seats.find((x) => x.fp === f); return s && !s.online ? true : null; }, jfp3), PING * (MISS + 4) + 2000);
  off.hit ? ok("[" + tag + "] link cut: the host held seat 3 offline after " + off.ms + " ms") : bad("[" + tag + "] seat not held");
  const lost = await until(() => has(J, ".sg-terminal[data-kind=network-lost]"), PING * (MISS + 4) + 2000);
  lat("link cut -> network-lost panel on the joiner", Date.now() - tKill);
  lost.hit ? ok("[" + tag + "] the joiner shows the network-lost state") : bad("[" + tag + "] no network-lost on the joiner");
  hub.revive(J);
  const tRc = Date.now();
  const rc = await J.evaluate(() => G.studyGroup.reconnect());
  const back = await until(() => J.evaluate(() => { const s = G.studyGroup.state(); return s && s.joinState === "seated" && !s.terminal ? { seat: s.self.seatNo, token: s.self.token } : null; }));
  lat("reconnect() -> re-seated", Date.now() - tRc);
  rc && rc.ok && back.hit && back.value.seat === before.seat && back.value.token === before.token ? ok("[" + tag + "] reconnected to the SAME seat " + back.value.seat + " with the SAME token") : bad("[" + tag + "] reconnect: " + JSON.stringify({ rc, before, back: back.value }));

  /* ---------------- host leaves ---------------- */
  const tLeave = Date.now();
  await H.evaluate(() => G.studyGroup.leave());
  const hl = await until(() => has(J, ".sg-terminal[data-kind=host-left]"));
  lat("host leave() -> host-left panel on the joiner", Date.now() - tLeave);
  hl.hit ? ok("[" + tag + "] host left -> host-left terminal on the joiner") : bad("[" + tag + "] host-left missing");
  const post = await J.evaluate(() => G.studyGroup.sendIntent({ kind: "score", value: 1 }));
  !post || !post.ok ? ok("[" + tag + "] an intent after host-left is refused locally") : bad("[" + tag + "] post-end intent sent");
  await J.evaluate(() => G.studyGroup.leave());

  const total = noise.host.length + noise.joiner.length;
  total === 0 ? ok("[" + tag + "] zero page errors and zero console errors in both engines") : bad("[" + tag + "] noise: host " + noise.host.slice(0, 2).join(" | ") + " joiner " + noise.joiner.slice(0, 2).join(" | "));
  info("[" + tag + "] hub " + JSON.stringify(hub.stats));
  await closeXeng();
}

try {
  await direction("chromium");
  await direction("webkit");
  info("latency summary: " + JSON.stringify(latency));
} catch (e) {
  bad("suite error: " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join(" ") : e));
} finally {
  await closeXeng().catch(() => {});
  await new Promise((r) => server.close(r));
}
console.log("\n" + (fails ? `ROOM XENG: ${fails} FAILURE(S)` : "ROOM XENG: all passed"));
process.exit(fails ? 1 : 0);
