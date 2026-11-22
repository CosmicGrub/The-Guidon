/**
 * Study-room join failures, in plain words (CN-09, v1.18.1).
 *
 * WHY THIS SUITE EXISTS: every failed join used to read "Connection to the host was lost. Your seat is
 * held for 60 s", whatever actually happened - a full room, a seat another device took, a host that was
 * never reached - and the promise of a held seat was made to a Soldier who never had one. The transport
 * now reports how the connection closed ({ code, opened }; the relay's own close codes 4000 host left,
 * 4001 seat taken, 4004 room full, 4005 too many messages) and the room panel turns that into words, and
 * only says "your seat is held" when the Soldier was actually seated.
 *
 * Two browsers pages in one Chromium, the fake transport at the room module's seam (tools/room-harness.mjs).
 * The transport-level half (room-web.js passes the real close code of a real WebSocket) is in
 * tools/test-room-web.mjs. The relay still cannot send a "wrong code" or "version mismatch" reason before it
 * closes (that needs a reject frame ahead of close 4004 in room.rs / room-server.mjs): version mismatch already
 * arrives as the host's own reject frame, a wrong code shows as the host never being reached.
 *
 * Usage: node tools/test-room-join-errors.mjs   (exit code = FAIL count)
 */
import { serve } from "./server.mjs";
import { openRoom, fakeTransport, close } from "./room-harness.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
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
setTimeout(() => { console.log("  FAIL  suite watchdog"); process.exit(99); }, 90000).unref();

const CAT = "Army Fitness Test (AFT)";
console.log("test-room-join-errors: join failures in plain words\n");
const { server, url } = await serve("web");
try {
  const r = await openRoom(url, 2, { hash: "#/group" });
  const [H, P] = r.pages;
  const hub = fakeTransport({ log: [] });
  await hub.wire(H, { host: true });
  await hub.wire(P, { host: false });
  for (const p of r.pages) await p.evaluate(() => G.studyGroup.attach(window.__roomTransport));
  const hosted = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: "HOST-ALPHA", category: CAT, timerSec: null, pingMs: 1000, holdMs: 60000, missLimit: 3 });
  if (!hosted || !hosted.ok) throw new Error("host() failed " + JSON.stringify(hosted));
  const ROOM = hosted.room;

  const terminal = () => P.evaluate(() => { const s = G.studyGroup.state(); return s && s.terminal ? JSON.parse(JSON.stringify(s.terminal)) : null; });
  const panelText = async () => (await until(() => P.evaluate(() => { const t = document.querySelector(".sg-terminal"); return t ? t.textContent : null; }))).value || "";
  const joinPending = async () => {
    const j = await P.evaluate((o) => G.studyGroup.join(o), { room: ROOM, name: "PEER-ONE", pingMs: 1000, missLimit: 3 });
    if (!j || !j.ok) throw new Error("join failed " + JSON.stringify(j));
    await until(() => H.evaluate(() => G.studyGroup.state().pending.length === 1));
  };
  const closeWith = (info) => P.evaluate((i) => window.__roomOnClose(i), info);

  /* -------- never seated: nothing is held, and each cause says what it is -------- */
  const cases = [
    { info: { code: 4004, opened: true }, kind: "network-lost", words: /room is full/i, label: "close 4004 -> the room is full" },
    { info: { code: 4001, opened: true }, kind: "network-lost", words: /another device took this seat/i, label: "close 4001 -> another device took the seat" },
    { info: { code: 0, opened: false }, kind: "network-lost", words: /could not reach the host/i, label: "the socket never opened -> the host was not reached" },
    { info: undefined, kind: "network-lost", words: /connection closed/i, label: "a transport that says nothing (the native connector) keeps the plain generic words" },
  ];
  for (const c of cases) {
    await joinPending();
    await closeWith(c.info);
    const t = await terminal();
    const text = await panelText();
    t && t.kind === c.kind && c.words.test(t.reason) ? ok(c.label + ": \"" + (t && t.reason) + "\"") : bad(c.label + ": " + JSON.stringify(t));
    !/seat is held/i.test(text) ? ok("  ...and no \"seat is held\" promise to a Soldier who was never seated") : bad("  ...the panel still promised a held seat: " + text.slice(0, 160));
    !/connection to the host was lost/i.test(text) ? ok("  ...and the title no longer says the connection to the host \"was lost\"") : bad("  ...title still says the connection was lost: " + text.slice(0, 120));
    await P.evaluate(() => G.studyGroup.leave());
    await H.evaluate(() => { const s = G.studyGroup.state(); return s && s.pending.length; });
    await sleep(100);
  }

  /* -------- the host closes the room: it says the host left -------- */
  await joinPending();
  await closeWith({ code: 4000, opened: true });
  const left = await terminal();
  left && left.kind === "host-left" ? ok("close 4000 -> the host left the room") : bad("close 4000: " + JSON.stringify(left));
  await P.evaluate(() => G.studyGroup.leave());
  await sleep(100);

  /* -------- seated: the 60 s hold is real, and still said -------- */
  await joinPending();
  const fp = await P.evaluate(() => G.studyGroup.session().fp);
  const admitted = await until(() => H.evaluate((f) => { const b = document.querySelector('.sg-admit[data-fp="' + f + '"]'); if (!b) return null; b.click(); return true; }, fp));
  if (!admitted.hit) bad("no Admit button for the joiner");
  const seated = await until(() => P.evaluate(() => { const s = G.studyGroup.state(); return s && s.joinState === "seated" ? s.self.seatNo : null; }));
  seated.hit ? ok("fixture: the joiner is seated") : bad("the joiner was not seated");
  await closeWith({ code: 0, opened: true });
  const held = await terminal();
  const heldText = await panelText();
  held && held.kind === "network-lost" && held.held === true ? ok("a seated Soldier whose link drops is marked as holding a seat") : bad("seated drop: " + JSON.stringify(held));
  /your seat is held for \d+ s/i.test(heldText) && /connection to the host was lost/i.test(heldText)
    ? ok("...and the panel still says the connection was lost and the seat is held") : bad("seated drop panel: " + heldText.slice(0, 200));
  await P.evaluate(() => G.studyGroup.leave());

  const total = r.noise.reduce((n, a) => n + a.length, 0);
  total === 0 ? ok("no page errors or console errors") : bad("noise: " + JSON.stringify(r.noise));
} catch (e) {
  bad("suite error: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
} finally {
  await close().catch(() => {});
  await new Promise((r) => server.close(r));
}
console.log("\n" + (fails ? `ROOM JOIN ERRORS: ${fails} FAILURE(S)` : "ROOM JOIN ERRORS: all passed"));
process.exit(fails ? 1 : 0);
