/**
 * Legal package (GUIDON_COMMAND_LEGAL_PACKAGE.md), paragraph 7 and the release
 * checklist: "The in-app Study Rooms screen states, IN EVERY ROOM STATE, that the
 * feature is for personal/off-duty local Wi-Fi by default and must not be used on
 * DoD/Army enterprise networks unless the organization has explicitly authorized
 * the application and connection ...".
 *
 * Until this suite the only proof was a search of studygroup.js for the sentence
 * (tools/test-opsec-harmonization.mjs). "In every room state" is a claim about
 * what is on screen in each state, so this walks a real room through every state
 * the screen has - with two real pages and the fake transport at the room
 * module's seam (tools/room-harness.mjs) - and reads the boundary panel in each,
 * on both the host and the joiner:
 *
 *   switch off (the default) - the screen that says "Pass the device"
 *   switch on, no room yet
 *   a joiner turned down (wrong room code)
 *   host: lobby, in play, on the recap screen, room ended
 *   joiner: waiting to be admitted, seated in the lobby, in play, on the recap,
 *           room ended by the host, the host leaving
 *
 * (The host-served guest join page has its own suite, tools/test-guest-page.mjs,
 * which reads its notice on the join screen and in the waiting, in-round and
 * ended states.)
 *
 * Assertions carry the id of the claim they stand behind ([LP-065] is claim
 * LP-065 in tools/legal-package-claims.json); tools/verify-legal-package.mjs
 * --run reads those lines.
 */
import { serve } from "./server.mjs";
import { openRoom, fakeTransport, close } from "./room-harness.mjs";
import { until, waitForRoute, finish } from "./testkit.mjs";
import { check, tag, list } from "./legal-package-kit.mjs";

const PING = 1000, MISS = 3, HOLD = 8000;
const BOARD_CAT = "Creeds";
const PHRASES = [
  "Personal / explicitly authorized networks only",
  "Do not host or join GUIDON Study Rooms on DoD/Army enterprise networks",
  "unless your organization has explicitly authorized this application and connection under its cybersecurity and network-connection process",
  "By default, use personal/off-duty local Wi-Fi.",
  "Offline-first design is not an ATO or network authorization.",
];
const seen = []; // "who was looking at which state"
const problems = [];

const { server, url } = await serve("web");
let room = null;
try {
  room = await openRoom(url, 2, { hash: "#/group", studyGroups: false });
  const [H, P] = room.pages;
  const sess = (p) => p.evaluate(() => (window.G && G.studyGroup && G.studyGroup.state) ? G.studyGroup.state() : null);

  /** Read the boundary panel on one page; `label` says which state the page is meant to be in, `want` checks that it really is. */
  async function panel(p, who, label, want) {
    const got = await p.evaluate(() => {
      const n = document.querySelector("#route .sg-network-boundary");
      const st = (window.G && G.studyGroup && G.studyGroup.state) ? G.studyGroup.state() : null;
      const r = n ? n.getBoundingClientRect() : null;
      return {
        text: n ? n.textContent.replace(/\s+/g, " ").trim() : null,
        visible: !!r && r.width > 0 && r.height > 0,
        beforeRoom: !!n && !!document.querySelector("#route .sg-root") && (n.compareDocumentPosition(document.querySelector("#route .sg-root")) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        off: !!document.querySelector("#route .sg-off"),
        role: st && st.role, phase: st && st.phase, joinState: st && st.joinState, terminal: st && st.terminal && st.terminal.kind,
      };
    });
    const inState = want ? want(got) : true;
    const missing = got.text ? PHRASES.filter((s) => !got.text.includes(s)) : PHRASES;
    seen.push(who + ": " + label);
    if (!inState) problems.push(`${who} was not in the state "${label}" when read: ${JSON.stringify({ off: got.off, role: got.role, phase: got.phase, joinState: got.joinState, terminal: got.terminal })}`);
    else if (!got.visible || missing.length || !got.beforeRoom) problems.push(`${who}, ${label}: boundary panel visible=${got.visible}, above the room controls=${got.beforeRoom}, missing phrases: ${list(missing)}`);
  }
  const both = async (label, wantH, wantP) => { await panel(H, "host", label, wantH); await panel(P, "joiner", label, wantP); };

  /* ---- switch off: the default ---- */
  await until(H, () => !!document.querySelector("#route .sg-off"));
  await until(P, () => !!document.querySelector("#route .sg-off"));
  await both("switch off (the default)", (g) => g.off, (g) => g.off);

  /* ---- switch on, wired ---- */
  const log = [];
  const hub = fakeTransport({ log });
  await hub.wire(H, { host: true });
  await hub.wire(P, { host: false });
  for (const p of [H, P]) await p.evaluate(async () => { await G.store.setSetting("studyGroups", true); });
  for (const p of [H, P]) await p.evaluate(() => G.studyGroup.attach(window.__roomTransport));
  for (const p of [H, P]) await waitForRoute(p, "#/group", { fresh: true });
  await until(H, () => !document.querySelector("#route .sg-off") && !!document.querySelector("#route .sg-root"));
  await until(P, () => !document.querySelector("#route .sg-off") && !!document.querySelector("#route .sg-root"));
  await both("switch on, no room yet", (g) => !g.off && !g.role, (g) => !g.off && !g.role);

  /* ---- a wrong code is turned down ---- */
  const hosted = await H.evaluate((o) => G.studyGroup.host(o), { mode: "board", name: "HOST-ALPHA", category: BOARD_CAT, count: 2, pingMs: PING, holdMs: HOLD, missLimit: MISS });
  const ROOM = hosted.room;
  const wrong = ROOM.replace(/\d\d$/, (d) => String((Number(d) + 1) % 100).padStart(2, "0"));
  await P.evaluate((o) => G.studyGroup.join(o), { room: wrong, name: "PEER-ONE", pingMs: PING, missLimit: MISS });
  await until(P, () => { const s = G.studyGroup.state(); return !!(s && s.terminal && s.terminal.kind === "rejected") && !!document.querySelector(".sg-terminal[data-kind=rejected]"); });
  await panel(P, "joiner", "turned down (wrong room code)", (g) => g.terminal === "rejected");
  await P.evaluate(() => G.studyGroup.leave());

  /* ---- the host's lobby; the joiner waits, is seated ---- */
  await until(H, () => !!document.querySelector(".sg-room-code"));
  await panel(H, "host", "in the lobby, nobody yet", (g) => g.role === "host" && g.phase === "lobby");
  const joined = await P.evaluate((o) => G.studyGroup.join(o), { room: ROOM, name: "PEER-ONE", pingMs: PING, missLimit: MISS });
  check(!!joined && joined.ok, "the joiner's join() was accepted", () => JSON.stringify(joined));
  await until(H, () => G.studyGroup.state().pending.length === 1);
  await until(P, () => { const s = G.studyGroup.state(); return !!s && s.joinState !== "seated" && !s.terminal && /waiting for the host/i.test(document.getElementById("route").textContent || ""); });
  await panel(P, "joiner", "waiting to be admitted", (g) => g.role === "peer" && g.joinState !== "seated" && !g.terminal);
  await panel(H, "host", "in the lobby, a joiner waiting", (g) => g.role === "host" && g.phase === "lobby");
  const fp = await P.evaluate(() => G.studyGroup.session().fp);
  await H.evaluate((f) => G.studyGroup.hostAction({ type: "admit", fp: f }), fp);
  await until(P, () => { const s = G.studyGroup.state(); return !!s && s.joinState === "seated" && !!document.querySelector(".sg-seat"); });
  await until(H, () => document.querySelectorAll(".sg-seat[data-seat]").length === 2);
  await panel(H, "host", "in the lobby, the joiner seated", (g) => g.role === "host" && g.phase === "lobby");
  await panel(P, "joiner", "seated in the lobby", (g) => g.joinState === "seated" && g.phase === "lobby");

  /* ---- in play, recap, ended ---- */
  const started = await H.evaluate(() => G.studyGroup.hostAction({ type: "start" }));
  check(!!started && started.ok, "the host started the board", () => JSON.stringify(started));
  await until(H, () => G.studyGroup.state().phase === "play" && !!document.querySelector(".sg-stage, .sg-view"));
  await until(P, () => G.studyGroup.state().phase === "play");
  await panel(H, "host", "in play (card 1)", (g) => g.phase === "play");
  await panel(P, "joiner", "in play (card 1)", (g) => g.phase === "play");
  await H.evaluate(() => G.studyGroup.hostAction({ type: "advance" }));
  await until(P, () => { const s = G.studyGroup.state(); return s.phase === "play" && s.round && s.round.idx === 1; });
  await panel(P, "joiner", "in play (card 2)", (g) => g.phase === "play");
  await H.evaluate(() => G.studyGroup.hostAction({ type: "advance" }));
  await until(P, () => G.studyGroup.state().phase === "recap" && !!document.querySelector(".sg-seat"));
  await until(H, () => G.studyGroup.state().phase === "recap");
  await panel(H, "host", "on the recap screen", (g) => g.phase === "recap");
  await panel(P, "joiner", "on the recap screen", (g) => g.phase === "recap");
  await H.evaluate(() => G.studyGroup.hostAction({ type: "end" }));
  await until(P, () => !!document.querySelector(".sg-terminal[data-kind=ended]"));
  await until(H, () => { const s = G.studyGroup.state(); return !!s && (s.phase === "ended" || !!s.terminal); });
  await panel(H, "host", "room ended by the host", (g) => g.phase === "ended" || g.terminal === "ended");
  await panel(P, "joiner", "room ended by the host", (g) => g.terminal === "ended");
  await P.evaluate(() => G.studyGroup.leave()); await H.evaluate(() => G.studyGroup.leave());

  /* ---- a second room: the host walks away ---- */
  const hosted2 = await H.evaluate((o) => G.studyGroup.host(o), { mode: "board", name: "HOST-ALPHA", category: BOARD_CAT, count: 2, pingMs: PING, holdMs: HOLD, missLimit: MISS });
  await P.evaluate((o) => G.studyGroup.join(o), { room: hosted2.room, name: "PEER-ONE", pingMs: PING, missLimit: MISS });
  await until(H, () => G.studyGroup.state().pending.length === 1);
  const fp2 = await P.evaluate(() => G.studyGroup.session().fp);
  await H.evaluate((f) => G.studyGroup.hostAction({ type: "admit", fp: f }), fp2);
  await until(P, () => G.studyGroup.state().joinState === "seated");
  await H.evaluate(() => G.studyGroup.leave());
  await until(P, () => !!document.querySelector(".sg-terminal[data-kind=host-left]"));
  await panel(P, "joiner", "the host left the room", (g) => g.terminal === "host-left");

  const states = [...new Set(seen.map((s) => s.replace(/^(host|joiner): /, "")))];
  // Every state the screen has, each actually read (a state skipped by a wait that quietly did nothing must fail, not pass).
  const EXPECTED = ["switch off (the default)", "switch on, no room yet", "turned down (wrong room code)", "in the lobby, nobody yet", "waiting to be admitted", "in the lobby, a joiner waiting", "in the lobby, the joiner seated", "seated in the lobby",
    "in play (card 1)", "in play (card 2)", "on the recap screen", "room ended by the host", "the host left the room"];
  const unread = EXPECTED.filter((l) => !seen.some((s) => s.endsWith(": " + l)));
  check(problems.length === 0 && unread.length === 0,
    tag("LP-065", "LP-183", "LP-109", "LP-014", "LP-116") + " the Study Rooms screen shows the boundary panel - 'Personal / explicitly authorized networks only ... Do not host or join GUIDON Study Rooms on DoD/Army enterprise networks unless your organization has explicitly authorized this application and connection under its cybersecurity and network-connection process. By default, use personal/off-duty local Wi-Fi. Offline-first design is not an ATO or network authorization.' - above the room controls in every state a room passes through, on the host and on the joiner: " + states.join("; ") + " (" + seen.length + " screens read)",
    () => problems.join(" || ") + (unread.length ? " | states never read: " + list(unread) : ""));
  check(problems.length === 0 && unread.length === 0, tag("LP-070") + " and that screen itself says local-only operation is not an ATO or network authorization ('Offline-first design is not an ATO or network authorization.') in each of those states", () => problems.join(" || "));
} finally {
  await close().catch(() => {});
  server.close();
}
await finish("LEGAL PACKAGE ROOMS");
