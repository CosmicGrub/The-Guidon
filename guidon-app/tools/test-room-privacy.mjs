/**
 * Study-room privacy (collective P3a): the spine. One Chromium, three GUIDON
 * pages in one context, fake transport at the seam (tools/room-harness.mjs).
 * Written BEFORE the module exists - its first run is the RED baseline.
 *
 *   (1) kill switch OFF (the default): attach()/host()/join() all refuse,
 *       G.netLedger stays EMPTY on every page, and #/group shows the
 *       "Pass the device" panel instead of a room.
 *   (2) switch ON: attach() records exactly one ledger entry per page - the
 *       only place a connection can be opened.
 *   (3) writeSpy on every page across a whole Rapid-Fire Team relay (host +
 *       2 seats, every seat plays): ZERO db writes on every page.
 *   (4) writeSpy across a Mock Board Live board (P1 candidate, host + P2
 *       scorers, 3 cards): the ONLY writes anywhere are the candidate's own
 *       kv "srs:<cardId>" rows for the cards it self-scored (the solo Mock
 *       Board path, G.board.noteExternalResult); the scorers write nothing.
 *   (5) allowlist: 30 real SRS rows seeded on a scorer (P2) for a category
 *       the board never deals; none of those ids appears in ANY frame the
 *       host received (every frame is logged at the hub), and no frame of
 *       any page carries a "grade" key.
 *   (5b) two hostile intents injected at the seated scorer P2's own
 *       transport seam (a score carrying a grade key; kind "grade") reach
 *       the host and are REJECTED with seq, lock.scored and the candidate's
 *       score untouched - the wire scan in (5) alone never sent one, so a
 *       host that accepted a grade key stayed green until this case.
 *   (6) G.backup.exportAll() on every page after both sessions contains no
 *       peer name, no fingerprint, no room code and no room/seat key.
 *   (7) switch OFF again: host()/join() refuse and the ledger does not grow.
 *
 * Usage: node tools/test-room-privacy.mjs   (exit code = FAIL count)
 */
import { serve } from "./server.mjs";
import { openRoom, fakeTransport, writeSpy, close } from "./room-harness.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const info = (m) => console.log("  INFO  " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, limit = 6000, step = 50) {
  const t0 = Date.now();
  for (;;) {
    let value = null;
    try { value = await pred(); } catch (e) { value = null; }
    if (value) return { hit: true, ms: Date.now() - t0, value };
    if (Date.now() - t0 >= limit) return { hit: false, ms: Date.now() - t0, value };
    await sleep(step);
  }
}
const WATCHDOG_MS = 180000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nROOM PRIVACY: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

const PING = 1000, MISS = 3, HOLD = 8000;
const RELAY_CAT = "Army Fitness Test (AFT)";
const BOARD_CAT = "Creeds";
const SEED_CAT = "Land Navigation (TC 3-25.26)";
const NAMES = { host: "HOST-KILO", p1: "PEER-LIMA-ONE", p2: "PEER-MIKE-TWO" };
const click = (p, sel) => p.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel);
const clickText = (p, text) => p.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t); if (!b) return false; b.click(); return true; }, text);
const clickWhen = async (p, sel) => (await until(() => p.evaluate((s) => { const b = document.querySelector(s); if (!b) return null; b.click(); return true; }, sel))).hit;
/* The DOM follows the state within the 100 ms render window: every control
   is polled for (enabled) before it is clicked, never read the instant the
   state changed. */
const clickStart = async (p) => (await until(() => p.evaluate(() => { const b = document.querySelector("button.sg-start"); if (!b || b.disabled) return null; b.click(); return true; }))).hit;
const admitFp = async (p, fp) => (await until(() => p.evaluate((f) => { const b = document.querySelector('.sg-admit[data-fp="' + f + '"]'); if (!b) return null; b.click(); return true; }, fp))).hit;

console.log("test-room-privacy: 3 pages, one Chromium, write spies + frame log");
const { server, url } = await serve("web");
const log = [];
try {
  const room = await openRoom(url, 3, { hash: "#/group", studyGroups: false });
  const { pages, noise } = room;
  const [H, P1, P2] = pages;
  const hub = fakeTransport({ log });
  for (let i = 0; i < pages.length; i++) await hub.wire(pages[i], { host: i === 0 });

  const present = await H.evaluate(() => ({ schema: !!(window.G && G.roomSchema), sg: !!(window.G && G.studyGroup) }));
  present.schema && present.sg ? ok("G.roomSchema and G.studyGroup are present") : bad("module absent: " + JSON.stringify(present));
  if (!present.schema || !present.sg) throw new Error("module absent - RED");

  /* ---------------- (1) switch OFF ---------------- */
  {
    const offs = await Promise.all(pages.map((p) => p.evaluate(() => G.store.settings().studyGroups)));
    offs.every((v) => v === false) ? ok("(1) studyGroups is false on all 3 pages") : bad("(1) studyGroups: " + offs.join(","));
    const avail = await Promise.all(pages.map((p) => p.evaluate(() => G.studyGroup.available())));
    avail.every((v) => v === false) ? ok("(1) G.studyGroup.available() is false everywhere") : bad("(1) available(): " + avail.join(","));
    const att = await H.evaluate(() => G.studyGroup.attach(window.__roomTransport));
    !att.ok ? ok("(1) attach() refuses with the switch off: " + att.reason) : bad("(1) attach() succeeded with the switch off");
    const h = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: NAMES.host, category: RELAY_CAT });
    !h.ok ? ok("(1) host() refuses with the switch off: " + h.reason) : bad("(1) host() succeeded with the switch off");
    const j = await P1.evaluate((o) => G.studyGroup.join(o), { room: "ALPHA-BRAVO-01", name: NAMES.p1 });
    !j.ok ? ok("(1) join() refuses with the switch off: " + j.reason) : bad("(1) join() succeeded with the switch off");
    const led = await Promise.all(pages.map((p) => p.evaluate(() => G.netLedger.list().length)));
    led.every((n) => n === 0) ? ok("(1) G.netLedger is empty on every page") : bad("(1) ledger: " + led.join(","));
    await H.evaluate(() => { location.hash = "#/home"; }); await sleep(200);
    await H.evaluate(() => { location.hash = "#/group"; });
    const panel = await until(() => H.evaluate(() => { const p = document.querySelector("#route .sg-off"); return p ? p.textContent : null; }));
    panel.hit && /pass the device/i.test(panel.value) ? ok("(1) #/group shows the kill-switch-off panel and it says \"Pass the device\"") : bad("(1) off panel: " + JSON.stringify(panel.value && panel.value.slice(0, 120)));
    const noRoomUi = await H.evaluate(() => !document.querySelector(".sg-room-code, button.sg-start, .sg-admit"));
    noRoomUi ? ok("(1) no room controls render while the switch is off") : bad("(1) room controls rendered with the switch off");
  }

  /* ---------------- (2) switch ON + attach ---------------- */
  for (const p of pages) await p.evaluate(async () => { await G.store.setSetting("studyGroups", true); });
  await sleep(600);
  for (const p of pages) { const r = await p.evaluate(() => G.studyGroup.attach(window.__roomTransport)); if (!r.ok) bad("(2) attach refused: " + JSON.stringify(r)); }
  {
    const led = await Promise.all(pages.map((p) => p.evaluate(() => G.netLedger.list())));
    led.every((l) => l.length === 1 && l[0].kind === "fake") ? ok("(2) attach() recorded exactly one ledger entry per page: " + JSON.stringify(led[0][0])) : bad("(2) ledger after attach: " + JSON.stringify(led));
  }
  for (const p of pages) { await p.evaluate(() => { location.hash = "#/group"; }); }
  await until(() => H.evaluate(() => !document.querySelector("#route .sg-off") && !!document.querySelector("#route .sg-root")));

  /* ---------------- (3) relay: nothing writes ---------------- */
  await sleep(500);
  for (const p of pages) await writeSpy(p);
  const hosted = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: NAMES.host, category: RELAY_CAT, timerSec: null, pingMs: PING, holdMs: HOLD, missLimit: MISS });
  hosted.ok ? ok("(3) relay room " + hosted.room) : bad("(3) host(): " + JSON.stringify(hosted));
  const ROOM = hosted.room;
  const fps = { host: hosted.fp };
  for (const [p, k, n] of [[P1, "p1", NAMES.p1], [P2, "p2", NAMES.p2]]) { const r = await p.evaluate((o) => G.studyGroup.join(o), { room: ROOM, name: n, pingMs: PING, missLimit: MISS }); fps[k] = r.fp; if (!r.ok) bad("(3) join " + n + ": " + JSON.stringify(r)); }
  await until(() => H.evaluate(() => G.studyGroup.state().pending.length === 2));
  for (const k of ["p1", "p2"]) { if (!(await admitFp(H, fps[k]))) bad("no Admit button for " + k); }
  const seated = await until(() => Promise.all([P1, P2].map((p) => p.evaluate(() => G.studyGroup.state().joinState === "seated"))).then((r) => r.every(Boolean) ? true : null));
  seated.hit ? ok("(3) both peers seated") : bad("(3) peers not seated");
  if (!(await clickStart(H))) bad("(3) no enabled .sg-start on the host");
  const order = [H, P1, P2], scores = [2, 3, 1];
  for (let i = 0; i < order.length; i++) {
    const p = order[i];
    const turn = await until(() => p.evaluate((n) => { const s = G.studyGroup.state(); return s && s.phase === "play" && s.turnSeat === n && !!document.querySelector("button.sg-play-round"); }, i + 1));
    if (!turn.hit) { bad("(3) seat " + (i + 1) + " never got its turn"); break; }
    await click(p, "button.sg-play-round");
    const card = await until(() => p.evaluate(() => !!document.querySelector(".rf-judge-correct")));
    if (!card.hit) { bad("(3) seat " + (i + 1) + ": no round screen"); break; }
    for (let k = 0; k < scores[i]; k++) { await p.evaluate(() => document.querySelector(".rf-judge-correct").click()); await sleep(30); }
    await clickText(p, "End Round");
    const t = await until(() => H.evaluate((n) => { const s = G.studyGroup.state().seats.find((x) => x.seatNo === n); return s && s.done ? s.score : null; }, i + 1));
    if (!t.hit || t.value !== scores[i]) bad("(3) seat " + (i + 1) + " tally " + JSON.stringify(t.value));
  }
  const recap = await until(() => P2.evaluate(() => G.studyGroup.state().phase === "recap" ? true : null));
  recap.hit ? ok("(3) relay played to recap (host tallies " + scores.join(",") + ")") : bad("(3) no recap");
  await H.evaluate(() => G.studyGroup.leave());
  await until(() => P1.evaluate(() => !!document.querySelector(".sg-terminal[data-kind=host-left]")));
  for (const p of [P1, P2]) await p.evaluate(() => G.studyGroup.leave());
  await sleep(700);
  {
    const w = await Promise.all(pages.map((p) => writeSpy(p)));
    const total = w.reduce((n, a) => n + a.length, 0);
    total === 0 ? ok("(3) ZERO db writes on all 3 pages across the whole relay (spy on put/putMany/del/delMany/clear)") : bad("(3) writes during the relay: " + w.map((a, i) => "p" + i + "=" + JSON.stringify(a.slice(0, 5))).join(" "));
  }

  /* ---------------- (4)+(5) board: only the candidate's own srs rows ---------------- */
  const seededIds = await P2.evaluate(async (cat) => {
    const qs = G.store.boardQuestions().filter((q) => q.category === cat).slice(0, 30);
    const rows = qs.map((q, i) => ({ k: "srs:" + q.id, v: { reps: 3, ease: 2.5, interval: 4, due: Date.now() - 1000, misses: i % 2 } }));
    await G.db.putMany("kv", rows);
    return qs.map((q) => q.id);
  }, SEED_CAT);
  seededIds.length >= 20 ? ok("(5) seeded " + seededIds.length + " real SRS rows on P2 for \"" + SEED_CAT + "\"") : bad("(5) seeded only " + seededIds.length);
  await sleep(500);
  for (const p of pages) await p.evaluate(() => { window.__roomWrites.length = 0; });
  const logStart = log.length;
  const hosted2 = await H.evaluate((o) => G.studyGroup.host(o), { mode: "board", name: NAMES.host, category: BOARD_CAT, count: 3, pingMs: PING, holdMs: HOLD, missLimit: MISS });
  hosted2.ok ? ok("(4) board room " + hosted2.room) : bad("(4) host(): " + JSON.stringify(hosted2));
  const ROOM2 = hosted2.room;
  for (const [p, k, n] of [[P1, "p1", NAMES.p1], [P2, "p2", NAMES.p2]]) { const r = await p.evaluate((o) => G.studyGroup.join(o), { room: ROOM2, name: n, pingMs: PING, missLimit: MISS }); fps[k] = r.fp; }
  await until(() => H.evaluate(() => G.studyGroup.state().pending.length === 2));
  for (const k of ["p1", "p2"]) { if (!(await admitFp(H, fps[k]))) bad("no Admit button for " + k); }
  await until(() => Promise.all([P1, P2].map((p) => p.evaluate(() => G.studyGroup.state().joinState === "seated"))).then((r) => r.every(Boolean) ? true : null));
  if (!(await clickStart(H))) bad("(4) no enabled .sg-start on the host");
  const played = [];
  for (let i = 0; i < 3; i++) {
    const c = await until(() => P1.evaluate((i) => { const s = G.studyGroup.state(); return s.phase === "play" && s.round.idx === i && s.turnSeat === 2 && s.cardId ? s.cardId : null; }, i));
    if (!c.hit) { bad("(4) card " + (i + 1) + " never showed on the candidate"); break; }
    played.push(c.value);
    if (!(await clickWhen(P1, "button.sg-answer"))) bad("(4) no answer button");
    await until(() => H.evaluate(() => { const s = G.studyGroup.state(); return s.lock && s.lock.kind === "scoring" ? true : null; }));
    if (!(await clickWhen(H, 'button.sg-score[data-value="2"]'))) bad("(4) no host score button");
    if (i === 0) {
      /* (5b) A grade intent from a SEATED scorer (P2), injected at P2's own
         transport seam the way test-room-xeng injects the v+1 hello: the
         host must reject it with its state untouched. Without this, "(5) no
         frame on the wire carries a grade key" only proved the UI never
         SENDS one - a host that ACCEPTED a grade key stayed green (measured
         2026-09-05 against a copy of web/index.html whose validate let a
         grade key through and listed grade as an intent kind and body key:
         "ROOM PRIVACY: all passed"). The two frames are tagged in the hub
         log so (5)'s wire scan below still judges only what the app sent. */
      const scoredBefore = await until(() => H.evaluate(() => { const s = G.studyGroup.state(); return s.lock && s.lock.scored && s.lock.scored.length === 1 ? { seq: s.seq, scored: s.lock.scored.slice(), score2: s.seats.find((x) => x.seatNo === 2).score } : null; }));
      const injectAt = log.length;
      await P2.evaluate((o) => window.__roomTransport.send({ v: G.roomSchema.PROTOCOL_VERSION, t: "intent", room: o.room, seq: 0, from: o.fp, body: { kind: "score", value: 1, cardId: o.cardId, grade: 3 } }, null), { room: ROOM2, fp: fps.p2, cardId: played[0] });
      await P2.evaluate((o) => window.__roomTransport.send({ v: G.roomSchema.PROTOCOL_VERSION, t: "intent", room: o.room, seq: 0, from: o.fp, body: { kind: "grade", value: 3 } }, null), { room: ROOM2, fp: fps.p2 });
      await hub.drain();
      const injected = log.slice(injectAt);
      for (const e of injected) e.injected = true;
      const after = await H.evaluate(() => { const s = G.studyGroup.state(); return { seq: s.seq, scored: s.lock ? s.lock.scored.slice() : null, score2: s.seats.find((x) => x.seatNo === 2).score }; });
      injected.length === 2 && injected.every((e) => e.arrival) ? ok("(5b) two hostile intents from seated P2 (a score carrying a grade key, and kind \"grade\") reached the host's handler") : bad("(5b) injected frames: " + JSON.stringify(injected.map((e) => ({ t: e.frame && e.frame.t, dropped: e.dropped, arrival: e.arrival }))));
      scoredBefore.hit && after.seq === scoredBefore.value.seq && JSON.stringify(after.scored) === JSON.stringify(scoredBefore.value.scored) && after.score2 === scoredBefore.value.score2
        ? ok("(5b) the host REJECTED both: seq " + after.seq + " unchanged, lock.scored " + JSON.stringify(after.scored) + " unchanged, candidate score " + after.score2 + " unchanged")
        : bad("(5b) the host ACCEPTED a grade intent: before " + JSON.stringify(scoredBefore.value) + ", after " + JSON.stringify(after));
    }
    if (!(await clickWhen(P2, 'button.sg-score[data-value="1"]'))) bad("(4) no P2 score button");
    if (!(await clickWhen(P1, 'button.sg-self-score[data-level="' + (i % 3) + '"]'))) bad("(4) no self-score button");
    await until(() => H.evaluate(() => { const s = G.studyGroup.state(); return s.lock && s.lock.scored && s.lock.scored.length === 2 && s.lock.advance ? true : null; }));
    await click(H, "button.sg-advance");
  }
  const recap2 = await until(() => P2.evaluate(() => G.studyGroup.state().phase === "recap" ? G.studyGroup.state().seats.find((s) => s.seatNo === 2).score : null));
  recap2.hit ? ok("(4) board played 3 cards to recap (candidate total " + recap2.value + ")") : bad("(4) no board recap");
  await click(H, "button.sg-end");
  await until(() => P1.evaluate(() => !!document.querySelector(".sg-terminal[data-kind=ended]")));
  for (const p of [P1, P2]) await p.evaluate(() => G.studyGroup.leave());
  await H.evaluate(() => G.studyGroup.leave());
  await sleep(800);
  {
    const [wH, w1, w2] = await Promise.all(pages.map((p) => writeSpy(p)));
    wH.length === 0 ? ok("(4) host (a scorer) wrote NOTHING") : bad("(4) host writes: " + JSON.stringify(wH.slice(0, 5)));
    w2.length === 0 ? ok("(4) scorer P2 wrote NOTHING") : bad("(4) P2 writes: " + JSON.stringify(w2.slice(0, 5)));
    const want = played.map((id) => "srs:" + id);
    const keys = w1.map((e) => e.store + "/" + e.key);
    const onlySrs = w1.every((e) => e.store === "kv" && want.indexOf(e.key) !== -1);
    onlySrs && w1.length === played.length ? ok("(4) the candidate's ONLY writes are its own srs rows for the 3 cards it self-scored: " + keys.join(", ")) : bad("(4) candidate writes: " + JSON.stringify(keys) + " (expected exactly " + JSON.stringify(want) + ")");
    const hist = w1.concat(wH, w2).filter((e) => /mockHistory|group|room|seat/i.test(String(e.key)));
    hist.length === 0 ? ok("(4) no history/room/seat row was written anywhere (Mock Board Live never touches board:mockHistory)") : bad("(4) forbidden rows: " + JSON.stringify(hist));
  }
  {
    const allFrames = log.slice(logStart).filter((x) => x.frame && !x.frame.unparseable);
    /* The two frames (5b) injected are the suite's own hostile input, not
       the app's output: they are excluded from the wire scan by their tag
       (and counted aloud), never by a pattern on their content. */
    const frames = allFrames.filter((x) => !x.injected);
    const injectedCount = allFrames.length - frames.length;
    injectedCount === 2 ? ok("(5) " + injectedCount + " suite-injected hostile frames excluded from the wire scan by tag; " + frames.length + " app-sent frames scanned") : bad("(5) expected exactly 2 suite-injected frames in the log, found " + injectedCount);
    const toHost = frames.filter((x) => x.to === "" || x.from !== "host");
    const texts = frames.map((x) => JSON.stringify(x.frame));
    const leaked = seededIds.filter((id) => allFrames.map((x) => JSON.stringify(x.frame)).some((t) => t.indexOf('"' + id + '"') !== -1 || t.indexOf("srs:" + id) !== -1));
    leaked.length === 0 ? ok("(5) none of the " + seededIds.length + " seeded SRS ids appears in any of the " + allFrames.length + " frames logged (" + toHost.length + " app-sent frames received by the host)") : bad("(5) seeded ids on the wire: " + leaked.join(","));
    const graded = texts.filter((t) => /"grade"\s*:/.test(t));
    graded.length === 0 ? ok("(5) no app-sent frame on the wire carries a grade key") : bad("(5) " + graded.length + " app-sent frame(s) carry a grade key");
    const srsAny = texts.filter((t) => /srs:/.test(t) || /"reps"|"ease"|"interval"|"misses"/.test(t));
    srsAny.length === 0 ? ok("(5) no frame carries an SRS row shape (reps/ease/interval/misses) or an srs: key") : bad("(5) SRS-shaped frame on the wire: " + srsAny[0].slice(0, 200));
    const validAll = await H.evaluate((ts) => ts.map((t) => G.roomSchema.validate(JSON.parse(t)).ok), texts);
    validAll.every(Boolean) ? ok("(5) every one of the " + texts.length + " logged frames passes G.roomSchema.validate (the allowlist is the enforcement)") : bad("(5) " + validAll.filter((v) => !v).length + " logged frame(s) fail validate");
  }

  /* ---------------- (6) backup export scan ---------------- */
  {
    const needles = [NAMES.host, NAMES.p1, NAMES.p2, fps.host, fps.p1, fps.p2, ROOM, ROOM2].filter(Boolean);
    const results = await Promise.all(pages.map((p) => p.evaluate(async (needles) => {
      const payload = await G.backup.exportAll({ includePrivate: true });
      const raw = JSON.stringify(payload);
      const hits = needles.filter((n) => raw.indexOf(n) !== -1);
      const keys = (payload.stores && payload.stores.kv || []).map((r) => r.k).filter((k) => /group|room|seat|studyGroup:/i.test(k) && k !== "settings");
      return { hits, keys, bytes: raw.length };
    }, needles)));
    results.every((r) => r.hits.length === 0) ? ok("(6) exportAll() on every page holds no peer name, fingerprint or room code (" + needles.length + " needles over " + results.map((r) => r.bytes).join("/") + " bytes)") : bad("(6) export hits: " + JSON.stringify(results.map((r) => r.hits)));
    results.every((r) => r.keys.length === 0) ? ok("(6) no room/seat/group kv key in any export") : bad("(6) suspicious kv keys: " + JSON.stringify(results.map((r) => r.keys)));
    const scoreRows = await P1.evaluate(async () => { const p = await G.backup.exportAll(); return (p.stores.kv || []).filter((r) => /^srs:/.test(r.k)).length; });
    scoreRows >= 3 ? ok("(6) the candidate's own srs rows ARE in its export (own grades persist exactly as solo): " + scoreRows + " rows") : bad("(6) candidate export has " + scoreRows + " srs rows");
  }

  /* ---------------- (7) switch OFF again ---------------- */
  {
    const ledBefore = await Promise.all(pages.map((p) => p.evaluate(() => G.netLedger.list().length)));
    for (const p of pages) await p.evaluate(async () => { await G.store.setSetting("studyGroups", false); });
    const h = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: NAMES.host, category: RELAY_CAT });
    const j = await P1.evaluate((o) => G.studyGroup.join(o), { room: ROOM, name: NAMES.p1 });
    const a = await P2.evaluate(() => G.studyGroup.attach(window.__roomTransport));
    !h.ok && !j.ok && !a.ok ? ok("(7) with the switch back off, host()/join()/attach() refuse again") : bad("(7) refusals: " + JSON.stringify({ h, j, a }));
    const ledAfter = await Promise.all(pages.map((p) => p.evaluate(() => G.netLedger.list().length)));
    ledAfter.join(",") === ledBefore.join(",") ? ok("(7) the ledger did not grow: " + ledAfter.join(",")) : bad("(7) ledger grew: " + ledBefore.join(",") + " -> " + ledAfter.join(","));
  }
  const total = noise.reduce((n, a) => n + a.length, 0);
  total === 0 ? ok("zero page errors and zero console errors on all 3 pages") : bad("noise: " + noise.map((a, i) => a.length ? "p" + i + ": " + a.slice(0, 3).join(" | ") : "").filter(Boolean).join(" || "));
} catch (e) {
  bad("suite error: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
} finally {
  await close().catch(() => {});
  await new Promise((r) => server.close(r));
}
console.log("\n" + (fails ? `ROOM PRIVACY: ${fails} FAILURE(S)` : "ROOM PRIVACY: all passed"));
process.exit(fails ? 1 : 0);
