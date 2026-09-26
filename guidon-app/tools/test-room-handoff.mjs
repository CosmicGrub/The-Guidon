/**
 * Study Rooms hand-off, end to end through the REAL screens, in separate
 * browser contexts (separate storage - a plan "added" on the second device is
 * a real second copy, not the host's own row read back).
 *
 * WHY THIS SUITE EXISTS: AUDIT-2026-09 6M / ROADMAP "Later" - Study Rooms
 * carrying PT plans and Team Training sessions through ONE hand-off model.
 * What would ship broken, and go unnoticed, if this file were deleted: a
 * "Share to my room" that sends more than the plan's structure (a name, a
 * rank, progress, a note), a receiving device that adds something the person
 * never confirmed, a Guest or Kiosk session that quietly saves what it was
 * handed, a forged or oversize or newer-version share that a device accepts
 * (or crashes on) instead of refusing in plain words, or a study deck that
 * behaves differently now it rides the model. tools/test-room-handoff-core.mjs
 * holds the rules themselves; this file proves they hold through the screens.
 *
 * Three contexts in one browser, wired through the fake transport at the room
 * module's seam (tools/room-harness.mjs's hub - every frame is logged):
 *   H   the host, a personal profile with planted personal data everywhere
 *       (profile, plan and session records, PT history, Team counts)
 *   P1  a peer with its OWN plan and custom session (so an add is visible and
 *       Undo means something), a personal profile
 *   P2  a peer in a Guest session (nothing may reach its device)
 *   P3  a peer in a Kiosk session (same)
 *
 *  1. the study deck: hosted from the real screen exactly as before; the
 *     room's deck line is the same on both devices, the snapshot's deck IS the
 *     model's deck data, and a deck never travels as an offer
 *  2. PT plan: "Share to my room" on PT Planner -> a confirm box lists exactly
 *     what would go -> both peers see a preview and NOTHING is written on
 *     either until "Add to my PT Planner" is tapped -> the plan and its custom
 *     session land on P1 (fresh local ids, planted data absent), Undo puts the
 *     old ones back, the Guest's device is byte-for-byte unchanged, and the
 *     host's own records are untouched
 *  3. Team Training session: planned and reordered in the builder, shared,
 *     previewed and added; an added session runs one exercise after another
 *  4. Kiosk: same add, nothing on the device
 *  5. reject paths: an unknown kind, a newer version, an oversize offer, a
 *     forged field, a forged personal key, a phone number and a classification
 *     marking inside otherwise-valid text, a replay of a dismissed offer, and
 *     an offer sent BY a peer - each ends in plain words and no change
 *  6. privacy: no planted string and no forbidden key in any frame the app
 *     sent, only the host ever sent an offer, every logged frame validates
 *  7. the guest page: the built dist/guest.html, joined to a real relay,
 *     shows a share as "open the app to receive it" with none of its content,
 *     and stores nothing
 *
 * Every wait is a bounded poll on a real condition (tools/testkit.mjs).
 * Usage: node tools/test-room-handoff.mjs   (exit code = FAIL count)
 */
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { bootApp, check, bad, ok, finish, waitForRoute, clickWhenStable, clickButtonByText, until, PERSONAL_PROFILE, expectNoConsoleNoise } from "./testkit.mjs";
import { fakeTransport, writeSpy } from "./room-harness.mjs";
import { deviceDump, deviceKvGet } from "./device-storage.mjs";
import { startRoomServer } from "./room-server.mjs";
import { nodeHost } from "./room-node-host.mjs";

const WATCHDOG_MS = 420000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nROOM HANDOFF: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

// A block that throws (a locator that never appeared) must not hide the blocks after it.
async function section(title, fn) {
  console.log("\n" + title);
  try { await fn(); } catch (e) { bad("block stopped early: " + String((e && e.message) || e).split("\n")[0]); }
}

const PLANTED = { name: "PLANTEDNAME", last: "PLANTEDLAST", mos: "PLANTEDMOS", note: "PLANTED-NOTE", owner: "PLANTED-OWNER", result: "PLANTEDRESULT" };
const PLANTED_ALL = Object.values(PLANTED);
const dayISO = (n) => { const d = new Date(); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
const DATE_CHANGE = dayISO(3);
const ARROW = String.fromCharCode(8594); // the arrow between drill blocks in a session line
/* A bounded poll for a condition on the Node side (the host stand-in). */
async function pollNode(pred, limit = 8000) {
  const t0 = Date.now();
  for (;;) {
    if (pred()) return true;
    if (Date.now() - t0 > limit) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}
const SETTINGS_ON = { studyGroups: true };

/* ---- what each device already has on it ---- */
const HOST_SESSIONS = [{ id: "custom-1000", label: "Circuit night", effort: "hard", type: "session", blocks: [{ drillId: "cd1" }, { drillId: "cd2" }], createdAt: 1, notes: PLANTED.note, ownerName: PLANTED.owner }];
const HOST_PLAN = {
  version: 1, templateId: "field", weekStart: "sun",
  days: { sun: { id: "rest" }, mon: { id: "custom-1000" }, tue: { id: "strength" }, wed: { id: "custom", title: "Ruck 6 miles", effort: "hard" }, thu: { id: "prep" }, fri: { id: "endurance" }, sat: { id: "recovery" } },
  overrides: { [DATE_CHANGE]: { id: "recovery" } },
  notes: PLANTED.note, ownerName: PLANTED.owner,
};
const HOST_HISTORY = [{ date: "2026-09-01", title: PLANTED.result, note: PLANTED.note }];
const HOST_KV = { settings: SETTINGS_ON, "prt:plan:v1": HOST_PLAN, "guidon:prt:customSessions:v1": HOST_SESSIONS, "pt:history:v1": HOST_HISTORY, "team:training:v1": { "aar-huddle": { count: 7, last: 1757000000000 } } };
const P1_SESSIONS = [{ id: "custom-777", label: "Own session", effort: "moderate", type: "session", blocks: [{ drillId: "pd" }], createdAt: 5 }];
const P1_PLAN = { version: 1, templateId: "recovery", weekStart: "sun", days: { sun: { id: "rest" }, mon: { id: "recovery" }, tue: { id: "prep" }, wed: { id: "strength" }, thu: { id: "recovery" }, fri: { id: "endurance" }, sat: { id: "recovery" } }, overrides: {} };
const P1_KV = { settings: SETTINGS_ON, "prt:plan:v1": P1_PLAN, "guidon:prt:customSessions:v1": P1_SESSIONS };
const HANDOFF_KEYS = ["prt:plan:v1", "guidon:prt:customSessions:v1", "team:sessions:v1"];

const VIEWPORT = { width: 1100, height: 900 };
const boot = await bootApp({ viewport: VIEWPORT, profile: { ...PERSONAL_PROFILE, displayName: "SGT " + PLANTED.name, lastName: PLANTED.last, mos: PLANTED.mos }, seedKv: HOST_KV });
const H = boot.page;
const noise = boot.noise;
const s1 = await boot.openSession({ viewport: VIEWPORT, profile: { ...PERSONAL_PROFILE, displayName: "SGT PEERONE", lastName: "PEERONE" }, seedKv: P1_KV, noise });
const s2 = await boot.openSession({ viewport: VIEWPORT, profile: "guest", seedKv: { settings: SETTINGS_ON }, noise });
const s3 = await boot.openSession({ viewport: VIEWPORT, profile: "kiosk", seedKv: { settings: SETTINGS_ON }, noise });
const P1 = s1.page, P2 = s2.page, P3 = s3.page;
const PEERS = [P1, P2, P3];

/* ---- the room: one hub at the room module's seam, every frame logged ---- */
const log = [];
const hub = fakeTransport({ log });
await hub.wire(H, { host: true });
for (const p of PEERS) await hub.wire(p, {});
for (const p of [H, ...PEERS]) {
  const r = await p.evaluate(() => G.studyGroup.attach(window.__roomTransport));
  check(r && r.ok, "the room module is attached on a device", () => JSON.stringify(r));
}
const st = (p) => p.evaluate(() => { const s = G.studyGroup.state(); return s ? JSON.parse(JSON.stringify(s)) : null; });
const text = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
const texts = (p, sel) => p.evaluate((s) => Array.from(document.querySelectorAll(s)).map((e) => e.textContent.replace(/\s+/g, " ").trim()), sel);
const has = (p, sel) => p.evaluate((s) => !!document.querySelector(s), sel);
const kv = async (p, key) => { const row = await deviceKvGet(p, key); return row === undefined ? null : row.v; };
const kvSnapshot = async (p) => JSON.stringify((await deviceDump(p)).stores.kv);
const idsOf = (plan) => ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((k) => plan.days[k].id);
const inject = async (offer, opts = {}) => {
  const at = log.length;
  await H.evaluate((o) => window.__roomTransport.send({ v: G.roomSchema.PROTOCOL_VERSION, t: "offer", room: o.room, seq: 0, from: o.from, body: { offer: o.offer } }, o.to), { room: ROOM, from: HOST_FP, offer, to: opts.to || "*" });
  await hub.drain();
  for (const e of log.slice(at)) if (e.frame && e.frame.t === "offer") e.injected = true;
};
let ROOM = "", HOST_FP = "";
const MSG = await H.evaluate(() => G.roomSchema.handoff.MESSAGES);
const PRESET_TITLES = await H.evaluate(() => Object.fromEntries(Object.entries(G.ptPlanner.PRESETS).map(([k, v]) => [k, v.title])));

/* ================================================================== 1 */
await section("1. the study deck: hosted from the real screen, carried as it always was", async () => {
  await waitForRoute(H, "#/group", { ready: "button.sg-host" });
  for (const p of PEERS) await waitForRoute(p, "#/group", { ready: "button.sg-join" });
  const cats = await H.evaluate(() => { const seen = []; for (const q of G.store.boardQuestions()) if (q && q.category && seen.indexOf(q.category) === -1) seen.push(q.category); return seen.slice(0, 2); });
  check(cats.length === 2, "the running app has two categories to mix: " + cats.join(" + "), () => JSON.stringify(cats));
  const hosted = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: "HOST-KILO", categories: cats, timerSec: 60, pingMs: 1500, missLimit: 8, holdMs: 30000 });
  check(hosted.ok, "hosted a relay room with a two-category mixed deck and a 60 s timer", () => JSON.stringify(hosted));
  ROOM = hosted.room; HOST_FP = hosted.fp;
  const fps = {};
  for (const [p, name] of [[P1, "PEER-ONE"], [P2, "PEER-GUEST"], [P3, "PEER-KIOSK"]]) {
    const r = await p.evaluate((o) => G.studyGroup.join(o), { room: ROOM, name, pingMs: 1500, missLimit: 8 });
    check(r.ok, name + " joined", () => JSON.stringify(r));
    fps[name] = r.fp;
  }
  for (const fp of Object.values(fps)) await clickWhenStable(H, '.sg-admit[data-fp="' + fp + '"]');
  for (const [i, p] of PEERS.entries()) check(await until(p, () => G.studyGroup.state() && G.studyGroup.state().joinState === "seated"), "peer " + (i + 1) + " is seated");
  await until(H, () => !!document.querySelector(".sg-deck"));
  await until(P1, () => !!document.querySelector(".sg-deck"));
  const hostLine = await text(H, ".sg-deck"), peerLine = await text(P1, ".sg-deck");
  check(hostLine === peerLine && cats.every((c) => hostLine.indexOf(c) !== -1), "the host and a peer read the same deck line naming both categories: \"" + hostLine + "\"", () => hostLine + " vs " + peerLine);
  const view = await H.evaluate(() => { const s = G.studyGroup.state(); return { snap: G.studyGroup.snapshotOf(s).deck, model: G.roomSchema.handoff.deckData({ category: s.deck.category, timerSec: s.deck.timerSec }) }; });
  check(JSON.stringify(view.snap) === JSON.stringify(view.model) && view.snap.timerSec === 60 && /^Mixed deck #/.test(view.snap.category), "the snapshot's deck IS the model's deck data (a mixed label and 60 s)", () => JSON.stringify(view));
  const peerDeck = (await st(P1)).deck;
  check(JSON.stringify(peerDeck) === JSON.stringify(view.model), "the peer's deck is exactly that data - it arrived through the snapshot as before", () => JSON.stringify(peerDeck));
  const wireDecks = log.filter((e) => e.frame && e.frame.t === "welcome" && e.frame.body.snapshot.deck).map((e) => JSON.stringify(e.frame.body.snapshot.deck));
  check(wireDecks.length > 0 && wireDecks.every((d) => d === JSON.stringify(view.model)), "every welcome frame carried that deck (" + wireDecks.length + " frames)", () => wireDecks.join(" | "));
  check(!log.some((e) => e.frame && e.frame.t === "offer"), "no offer frame has been sent: a deck is never an offer");
});

/* ================================================================== 2 */
let P2_BEFORE = "", P3_BEFORE = "";
await section("2. PT plan: share, preview, confirm", async () => {
  for (const p of PEERS) await writeSpy(p);
  P2_BEFORE = await kvSnapshot(P2); P3_BEFORE = await kvSnapshot(P3);
  await waitForRoute(H, "#/pt-plan", { ready: '[data-pt-view="week"]' });
  await clickWhenStable(H, '[data-pt-view="week"]');
  check(await until(H, () => !!document.querySelector("[data-pt-room-share] .sg-share-btn")), "the Week view of PT Planner has a \"Share to my room\" button");
  const idle = await text(H, "[data-pt-room-share] .sg-share-status");
  check(idle.indexOf(ROOM) !== -1 && /3 devices are seated/.test(idle) && /no names, ranks, progress or notes/.test(idle), "before anything is tapped it says which room and how many devices, and what never goes: \"" + idle + "\"", () => idle);
  check((await Promise.all(PEERS.map((p) => st(p)))).every((s) => s.offer === null), "no device holds an offer yet");

  await clickWhenStable(H, "[data-pt-room-share] .sg-share-btn");
  check(await until(H, () => !!document.querySelector(".gm-box")), "tapping it opens a confirm box - nothing has been sent");
  check(!log.some((e) => e.frame && e.frame.t === "offer"), "...and no offer frame is on the wire yet");
  const box = await text(H, ".gm-box");
  const wantLines = ["Sunday: " + PRESET_TITLES.rest, "Tuesday: " + PRESET_TITLES.strength, "Wednesday: Ruck 6 miles (Hard)", "Thursday: " + PRESET_TITLES.prep, "Friday: " + PRESET_TITLES.endurance, "Saturday: " + PRESET_TITLES.recovery];
  check(/Send a PT plan to everyone in room/.test(box) && box.indexOf(ROOM) !== -1 && wantLines.every((l) => box.indexOf(l) !== -1), "the confirm box lists the week in the host's own words", () => box);
  check(/Monday: Circuit night \(Hard\)/.test(box) && box.indexOf(ARROW) !== -1, "...including the custom session by name and its drill blocks in order");
  check(box.indexOf(DATE_CHANGE + ": " + PRESET_TITLES.recovery) !== -1, "...and the one changed date (" + DATE_CHANGE + ")");
  check(PLANTED_ALL.every((s) => box.indexOf(s) === -1) && !/\bcd[12]\b/.test(box), "nothing planted and no internal drill id is on it", () => box);
  check(/no names, ranks, progress or notes/.test(box) && /unless that person chooses/.test(box), "it says only this is sent and nothing is added unless each person chooses");
  await clickButtonByText(H, "Send to the room", ".gm-box");
  check(await until(H, () => /Sent to 3 devices/.test((document.querySelector("[data-pt-room-share] .sg-share-status") || {}).textContent || "")), "the status line says it went to 3 devices");
  const hostState = await st(H);
  check(hostState.offer && hostState.offer.kind === "pt-plan" && hostState.offer.ver === 1, "the host holds the offer it sent (pt-plan, ver 1)");
  const sent = log.filter((e) => e.frame && e.frame.t === "offer" && !e.injected);
  check(sent.length === 3 && sent.every((e) => e.from === "host" && e.frame.body.offer.oid === hostState.offer.oid), "exactly one offer frame per seated peer, all from the host, all one offer id", () => sent.map((e) => e.from + ":" + e.to).join());

  for (const [i, p] of PEERS.entries()) {
    check(await until(p, () => !!document.querySelector('.sg-offer[data-offer-kind="pt-plan"][data-offer-status="ready"]')), "peer " + (i + 1) + " sees a ready PT plan preview");
  }
  const lines = await texts(P1, ".sg-offer-lines li");
  check(lines.length === 8 && lines[0] === "Sunday: " + PRESET_TITLES.rest && /^Monday: Circuit night \(Hard\)/.test(lines[1]) && lines[3] === "Wednesday: Ruck 6 miles (Hard)" && lines[7] === DATE_CHANGE + ": " + PRESET_TITLES.recovery,
    "the preview lists seven days and the changed date, in this device's own words", () => JSON.stringify(lines));
  const pv = await text(P1, ".sg-offer");
  check(/Nothing is added until you say so/.test(pv) && /replaces your current weekly PT plan/.test(pv) && /history is not touched/.test(pv) && /undo it straight afterwards/.test(pv), "the preview says what adding will do, before it does anything");
  check(PLANTED_ALL.every((s) => pv.indexOf(s) === -1) && !/\bcd[12]\b/.test(pv), "nothing planted and no internal id is shown");
  check(/Add to my PT Planner/.test(await text(P1, ".sg-offer-add")) && /Not now/.test(await text(P1, ".sg-offer-dismiss")), "two buttons: \"Add to my PT Planner\" and \"Not now\"");
  check(/Guest or Kiosk session/.test(await text(P2, ".sg-offer")) && /Guest or Kiosk session/.test(await text(P3, ".sg-offer")) && !/Guest or Kiosk session/.test(pv), "a Guest or Kiosk device is told anything it adds stays only until GUIDON closes; a personal one is not");

  // Nothing was applied or saved by receiving it.
  for (const [i, p] of PEERS.entries()) check((await writeSpy(p)).length === 0, "peer " + (i + 1) + " has written NOTHING to its storage after receiving the offer");
  check(JSON.stringify(await kv(P1, "prt:plan:v1")) === JSON.stringify(P1_PLAN), "P1's own plan on the device is exactly as it was");
  check(JSON.stringify(await kv(P1, "guidon:prt:customSessions:v1")) === JSON.stringify(P1_SESSIONS), "P1's own custom sessions are exactly as they were");
  check((await kvSnapshot(P2)) === P2_BEFORE && (await kvSnapshot(P3)) === P3_BEFORE, "the Guest's and the Kiosk's device storage is byte-for-byte unchanged");
});

await section("2b. PT plan: add, undo, and a Guest who adds", async () => {
  await clickWhenStable(P1, ".sg-offer-add");
  check(await until(P1, () => !!document.querySelector('.sg-offer[data-offer-status="added"]')), "P1 tapped Add: the card says it was added");
  const done = await text(P1, ".sg-offer-done");
  check(/Added\. This is now your PT plan/.test(done), "in plain words: \"" + done + "\"");
  const plan = await kv(P1, "prt:plan:v1"), sessions = await kv(P1, "guidon:prt:customSessions:v1");
  const added = sessions.find((s) => s.label === "Circuit night");
  check(sessions.length === 2 && sessions[0].id === "custom-777" && added && added.id !== "custom-1000" && /^custom-\d+$/.test(added.id), "P1 now has its own session untouched plus the shared one under a FRESH local id (" + (added && added.id) + ", not the host's custom-1000)", () => JSON.stringify(sessions));
  check(added && added.effort === "hard" && added.type === "session" && JSON.stringify(added.blocks) === JSON.stringify([{ drillId: "cd1" }, { drillId: "cd2" }]), "...with its label, effort, type and the two drill blocks");
  check(JSON.stringify(idsOf(plan)) === JSON.stringify(["rest", added.id, "strength", "custom", "prep", "endurance", "recovery"]) && plan.days.wed.title === "Ruck 6 miles" && plan.days.wed.effort === "hard" && plan.templateId === "field", "P1's weekly plan is the host's: the same seven days (the Monday session pointing at ITS copy), the ad hoc Wednesday, the same template", () => JSON.stringify(plan));
  check(plan.overrides[DATE_CHANGE] && plan.overrides[DATE_CHANGE].id === "recovery", "the changed date came too");
  const raw = JSON.stringify([plan, sessions]);
  check(PLANTED_ALL.every((s) => raw.indexOf(s) === -1) && raw.indexOf("notes") === -1 && raw.indexOf("ownerName") === -1, "none of the host's planted personal data is on P1's device");
  const writes = await writeSpy(P1);
  check(writes.length > 0 && writes.every((w) => HANDOFF_KEYS.indexOf(w.key) !== -1), "P1's ONLY writes were the plan and the custom sessions: " + writes.map((w) => w.key).join(", "), () => JSON.stringify(writes));

  // The host's own records are exactly what they were.
  check(JSON.stringify(await kv(H, "prt:plan:v1")) === JSON.stringify(HOST_PLAN) && JSON.stringify(await kv(H, "guidon:prt:customSessions:v1")) === JSON.stringify(HOST_SESSIONS), "the host's own plan and custom sessions are exactly as they were (sharing changes nothing on the sender)");
  check(JSON.stringify(await kv(H, "pt:history:v1")) === JSON.stringify(HOST_HISTORY), "the host's completed-PT history is untouched too");

  // Undo.
  await clickWhenStable(P1, ".sg-offer-undo");
  check(await until(P1, () => /Undone/.test((document.querySelector(".sg-offer-done") || {}).textContent || "")), "Undo says it is undone");
  const back = await kv(P1, "prt:plan:v1"), backSessions = await kv(P1, "guidon:prt:customSessions:v1");
  check(JSON.stringify(idsOf(back)) === JSON.stringify(idsOf(P1_PLAN)) && back.templateId === "recovery" && backSessions.length === 1 && backSessions[0].id === "custom-777", "P1's plan, template and custom sessions are back exactly as before the add", () => JSON.stringify({ back: idsOf(back), t: back.templateId, s: backSessions.map((s) => s.id) }));
  await clickWhenStable(P1, ".sg-offer-done-btn");
  check(await until(P1, () => !document.querySelector(".sg-offer")), "\"Done\" clears the card");

  // A Guest adds: it works for the session, and lands nowhere on the device.
  await clickWhenStable(P2, ".sg-offer-add");
  check(await until(P2, () => !!document.querySelector('.sg-offer[data-offer-status="added"]')), "the Guest tapped Add: the card says it was added");
  const guestPlan = await P2.evaluate(() => G.db.getSetting("prt:plan:v1", null));
  check(guestPlan && guestPlan.days.mon.title === "Circuit night" && guestPlan.days.wed.title === "Ruck 6 miles", "for the length of the session the Guest's PT Planner has the plan", () => JSON.stringify(guestPlan));
  check((await kvSnapshot(P2)) === P2_BEFORE && (await kv(P2, "prt:plan:v1")) === null && (await kv(P2, "guidon:prt:customSessions:v1")) === null, "...and the Guest's DEVICE is byte-for-byte what it was: nothing saved");
  await clickWhenStable(P3, ".sg-offer-dismiss");
  check(await until(P3, () => !document.querySelector(".sg-offer")), "the Kiosk said \"Not now\": the card goes and nothing was added");
  check((await kvSnapshot(P3)) === P3_BEFORE && (await P3.evaluate(() => G.db.getSetting("prt:plan:v1", null))) === null, "the Kiosk's device and session are untouched");
});

/* ================================================================== 3 */
await section("3. Team Training session: plan, reorder, share, add, run", async () => {
  await waitForRoute(H, "#/team", { ready: "details[data-team-builder]" });
  const noSessions = await text(H, "[data-team-session-panel]");
  check(/No saved sessions yet/.test(noSessions) && /no names, no scores/.test(noSessions), "the Team Training screen has a \"Team sessions\" panel and says a saved session holds only exercise names and order");
  await clickWhenStable(H, "[data-team-plan-summary]");
  await clickWhenStable(H, '[data-team-add="aar-huddle"]');
  await clickWhenStable(H, '[data-team-add="pace-trust"]');
  await clickWhenStable(H, '[data-team-add="blind-relay"]');
  await H.fill("[data-team-session-name]", "Squad night 1");
  await clickWhenStable(H, '[data-team-up="2"]');
  // The redraw after "Up" is asynchronous: wait for the NEW order, not just for three rows.
  check(await until(H, () => { const li = document.querySelectorAll("[data-team-draft] li"); return li.length === 3 && /^Blind Relay/.test(li[1].textContent); }), "three exercises are in the plan and the order has changed");
  const order = await texts(H, "[data-team-draft] li");
  check(/^AAR Huddle/.test(order[0]) && /^Blind Relay/.test(order[1]) && /^Land Nav Pace-Trust/.test(order[2]), "\"Up\" moved Blind Relay above Pace-Trust: " + order.map((t) => t.split(" (")[0]).join(" > "), () => JSON.stringify(order));
  check(await text(H, "[data-team-draft-total]") === "3 exercises - about 33 min.", "the total is 3 exercises, about 33 min (8 + 10 + 15)");
  check((await H.inputValue("[data-team-session-name]")) === "Squad night 1", "the typed name survived the redraws");
  check(/Study Rooms|room/i.test(await text(H, "details[data-team-builder] .sg-share-status")), "the builder has its own Share to my room control");
  await clickWhenStable(H, "details[data-team-builder] .sg-share-btn");
  check(await until(H, () => !!document.querySelector(".gm-box")), "tapping it opens the confirm box");
  const box = await text(H, ".gm-box");
  check(/Send a Team Training session to everyone in room/.test(box) && /Squad night 1/.test(box) && /1\. AAR Huddle \(8 min\)/.test(box) && /2\. Blind Relay \(10 min\)/.test(box) && /3\. Land Nav Pace-Trust \(15 min\)/.test(box) && /About 33 minutes/.test(box), "it lists the name and the three exercises in order", () => box);
  check(PLANTED_ALL.every((s) => box.indexOf(s) === -1) && !/count|completion/i.test(box), "no planted text and no completion counts on it");
  await clickButtonByText(H, "Send to the room", ".gm-box");
  check(await until(H, () => /Sent to 3 devices/.test((document.querySelector("details[data-team-builder] .sg-share-status") || {}).textContent || "")), "sent to 3 devices");

  // P1 is on another screen when it arrives; the share waits for it in the room screen.
  await waitForRoute(P1, "#/group", { ready: '.sg-offer[data-offer-kind="team-session"][data-offer-status="ready"]' });
  const lines = await texts(P1, ".sg-offer-lines li");
  check(JSON.stringify(lines) === JSON.stringify(["1. AAR Huddle (8 min)", "2. Blind Relay (10 min)", "3. Land Nav Pace-Trust (15 min)"]) && await text(P1, ".sg-offer-title") === "Squad night 1", "P1 sees the named session and the three exercises in order", () => JSON.stringify(lines));
  const pv = await text(P1, ".sg-offer");
  check(/About 33 minutes/.test(pv) && /no names and no scores/.test(pv) && /Add to Team Training/.test(pv), "with the minutes, what saving holds, and \"Add to Team Training\"");
  check((await kv(P1, "team:sessions:v1")) === null, "nothing is saved until it is added");
  await clickWhenStable(P1, ".sg-offer-add");
  check(await until(P1, () => !!document.querySelector('.sg-offer[data-offer-status="added"]')), "P1 added it");
  const saved = await kv(P1, "team:sessions:v1");
  check(saved && saved.length === 1 && saved[0].title === "Squad night 1" && JSON.stringify(saved[0].steps) === JSON.stringify(["aar-huddle", "blind-relay", "pace-trust"]) && Object.keys(saved[0]).sort().join() === "createdAt,id,steps,title", "P1 saved one session: the name and the ids in order, and nothing else (" + JSON.stringify(saved && saved[0] && Object.keys(saved[0])) + ")", () => JSON.stringify(saved));
  check((await kv(P1, "team:training:v1")) === null, "Team Training's completion counts were not touched");

  // Run it: one exercise after another.
  await waitForRoute(P1, "#/team", { ready: "[data-team-session-card]" });
  check(/Squad night 1/.test(await text(P1, "[data-team-session-card]")) && /3 exercises - about 33 min/.test(await text(P1, "[data-team-session-card]")), "the saved session is in P1's Team Training list");
  await clickWhenStable(P1, "[data-team-session-start]");
  check(await until(P1, () => !!document.querySelector("[data-team-chain-bar]") && !!document.querySelector("[data-team-session] [data-team-record]")), "\"Start session\" opens the first exercise (the AAR Huddle) with a session bar above the list");
  check(/0 of 3 done\. Next: AAR Huddle/.test(await text(P1, "[data-team-chain-bar]")), "the bar says 0 of 3 done, next: AAR Huddle");
  await clickWhenStable(P1, "[data-team-session] [data-team-record]");
  check(await until(P1, () => /1 of 3 done\. Next: Blind Relay/.test((document.querySelector("[data-team-chain-bar]") || {}).textContent || "")), "finishing it moves the bar to 1 of 3 done, next: Blind Relay");
  await clickWhenStable(P1, "[data-team-chain-next]");
  await clickWhenStable(P1, "[data-team-session] [data-team-record]");
  check(await until(P1, () => /2 of 3 done\. Next: Land Nav Pace-Trust/.test((document.querySelector("[data-team-chain-bar]") || {}).textContent || "")), "then 2 of 3, next: Land Nav Pace-Trust");
  await clickWhenStable(P1, "[data-team-chain-next]");
  await clickWhenStable(P1, "[data-team-session] [data-team-record]");
  check(await until(P1, () => /Session complete: all 3 exercises are recorded/.test((document.querySelector("[data-team-chain-bar]") || {}).textContent || "")), "after the third the bar says the session is complete");
  const counts = await kv(P1, "team:training:v1");
  check(counts && counts["aar-huddle"].count === 1 && counts["blind-relay"].count === 1 && counts["pace-trust"].count === 1, "each exercise recorded ONE completion, exactly as a single run does", () => JSON.stringify(counts));
  await clickWhenStable(P1, "[data-team-chain-finish]");
  check(await until(P1, () => !document.querySelector("[data-team-chain-bar] *")), "\"Finish session\" clears the bar");

  // The Guest adds the same session: for the session only.
  await waitForRoute(P2, "#/group", { ready: '.sg-offer[data-offer-kind="team-session"][data-offer-status="ready"]' });
  await clickWhenStable(P2, ".sg-offer-add");
  check(await until(P2, () => !!document.querySelector('.sg-offer[data-offer-status="added"]')), "the Guest added the session");
  const guestSaved = await P2.evaluate(() => G.db.getSetting("team:sessions:v1", null));
  check(guestSaved && guestSaved.length === 1 && guestSaved[0].steps.length === 3, "for the session, the Guest has it");
  check((await kvSnapshot(P2)) === P2_BEFORE && (await kv(P2, "team:sessions:v1")) === null, "...and the Guest's device is still byte-for-byte what it was");
});

await section("3b. Team sessions on the host: save, share a saved one, the builder's other controls, remove", async () => {
  await waitForRoute(H, "#/team", { ready: "details[data-team-builder]" });
  check(await until(H, () => document.querySelectorAll("[data-team-draft] li").length === 3), "the host's builder still holds the session it shared (sharing does not clear it)");
  await clickWhenStable(H, "[data-team-session-save]");
  check(await until(H, () => !!document.querySelector("[data-team-session-card]") && !document.querySelector("[data-team-draft]")), "\"Save session\" puts it in the saved list and empties the builder");
  const saved = await kv(H, "team:sessions:v1");
  check(saved && saved.length === 1 && saved[0].title === "Squad night 1" && JSON.stringify(saved[0].steps) === JSON.stringify(["aar-huddle", "blind-relay", "pace-trust"]), "the host's own device holds the session: name and ids in order", () => JSON.stringify(saved));
  check(/Session saved: Squad night 1/.test(await text(H, "[data-team-sessions-status]")), "the status line says it was saved");

  // Sharing a saved session asks first, and "Not now" sends nothing.
  const offersBefore = log.filter((e) => e.frame && e.frame.t === "offer" && !e.injected).length;
  await clickWhenStable(H, "[data-team-session-share]");
  check(await until(H, () => !!document.querySelector(".gm-box")), "\"Share to my room\" on a saved session opens the same confirm box");
  await clickButtonByText(H, "Not now", ".gm-box");
  check(await until(H, () => /Nothing was sent/.test((document.querySelector("[data-team-sessions-status]") || {}).textContent || "")), "\"Not now\" says nothing was sent");
  await hub.drain();
  check(log.filter((e) => e.frame && e.frame.t === "offer" && !e.injected).length === offersBefore, "...and no offer frame went out");

  // The builder's other controls: Down, Remove, Clear, and Save with nothing in it.
  await clickWhenStable(H, '[data-team-add="aar-huddle"]');
  await clickWhenStable(H, '[data-team-add="blind-relay"]');
  await clickWhenStable(H, '[data-team-down="0"]');
  check(await until(H, () => { const li = document.querySelectorAll("[data-team-draft] li"); return li.length === 2 && /^Blind Relay/.test(li[0].textContent); }), "\"Down\" moved the first exercise below the second");
  await clickWhenStable(H, '[data-team-drop="0"]');
  check(await until(H, () => { const li = document.querySelectorAll("[data-team-draft] li"); return li.length === 1 && /^AAR Huddle/.test(li[0].textContent); }), "\"Remove\" took Blind Relay out of the plan");
  await clickWhenStable(H, "[data-team-session-clear]");
  check(await until(H, () => !document.querySelector("[data-team-draft]") && /Nothing added yet/.test((document.querySelector("[data-team-draft-total]") || {}).textContent || "")), "\"Clear\" empties the plan");
  const rowsBefore = JSON.stringify(await kv(H, "team:sessions:v1"));
  // (aria-disabled, so a real click still lands - and must do nothing)
  await H.evaluate(() => document.querySelector("[data-team-session-save]").click());
  check((await H.evaluate(() => document.querySelector("[data-team-session-save]").getAttribute("aria-disabled"))) === "true" && JSON.stringify(await kv(H, "team:sessions:v1")) === rowsBefore, "\"Save session\" with nothing in the plan is disabled and saves nothing");

  // Remove the saved session (asks first).
  await clickWhenStable(H, "[data-team-session-remove]");
  check(await until(H, () => !!document.querySelector(".gm-box")), "\"Remove\" asks before it removes anything");
  await clickButtonByText(H, "Remove", ".gm-box");
  check(await until(H, () => !document.querySelector("[data-team-session-card]")), "confirming removes the session from the list");
  check(JSON.stringify(await kv(H, "team:sessions:v1")) === "[]", "...and from the device");
  check(JSON.stringify(await kv(H, "team:training:v1")) === JSON.stringify(HOST_KV["team:training:v1"]), "the host's completion counts were never touched by any of this");
});

await section("4. Kiosk: the same add, nothing on the device", async () => {
  await waitForRoute(P3, "#/group", { ready: '.sg-offer[data-offer-kind="team-session"][data-offer-status="ready"]' });
  await clickWhenStable(P3, ".sg-offer-add");
  check(await until(P3, () => !!document.querySelector('.sg-offer[data-offer-status="added"]')), "the Kiosk added the session");
  const kioskSaved = await P3.evaluate(() => G.db.getSetting("team:sessions:v1", null));
  check(kioskSaved && kioskSaved.length === 1, "for the session, the Kiosk has it");
  check((await kvSnapshot(P3)) === P3_BEFORE, "...and the Kiosk's device is byte-for-byte what it was");
});

/* ================================================================== 5 */
await section("5. reject paths: each ends in plain words and no change", async () => {
  await waitForRoute(P1, "#/group", { ready: "button.sg-leave" });
  const writesBefore = (await writeSpy(P1)).length;
  const planBefore = JSON.stringify(await kv(P1, "prt:plan:v1")), teamBefore = JSON.stringify(await kv(P1, "team:sessions:v1"));
  const ptOffer = (oid, extra, dataEdit) => { const o = { oid, kind: "pt-plan", ver: 1, title: "Weekly PT plan", data: { tpl: "balanced", days: [{ id: "rest" }, { id: "strength" }, { id: "recovery" }, { id: "endurance" }, { id: "prep" }, { id: "circuit" }, { id: "recovery" }] } }; if (dataEdit) dataEdit(o.data); return Object.assign(o, extra || {}); };
  const counter = (p, k) => p.evaluate((key) => (G.studyGroup.counters().ignored[key] || 0), k);

  // a. a kind no build has heard of
  await inject({ oid: "UNKN2222", kind: "quiz-pack", ver: 1, title: "Secret sauce", data: { anything: [1, 2, 3] } });
  check(await until(P1, () => !!document.querySelector('.sg-offer[data-offer-kind="unsupported"]')), "an unknown kind shows a card on P1");
  check(await text(P1, ".sg-offer-blocked") === MSG.unsupportedKind && !(await has(P1, ".sg-offer-add")), "...that says so in plain words (\"" + MSG.unsupportedKind.slice(0, 60) + "...\") and has no Add button");
  check(!(await text(P1, ".sg-offer")).includes("Secret sauce") && !(await text(P1, ".sg-offer")).includes("quiz-pack"), "the sender's title and kind name are never shown");
  const held = (await st(P1)).offer;
  check(held.unsupported === "unsupported-kind" && !("data" in held) && !("title" in held), "the device kept only a bare note - the kind's data and title were dropped");

  // b. a newer version of a known kind
  await inject(ptOffer("NEWV2222", { ver: 2 }));
  check(await until(P1, (m) => (document.querySelector(".sg-offer-blocked") || {}).textContent === m, MSG.newerVersion), "a newer version of a PT plan says it comes from a newer GUIDON and to update, and adds nothing");

  // c. oversize
  await inject({ oid: "BIGG2222", kind: "team-session", ver: 1, data: { steps: ["aar-huddle"], pad: "P".repeat(3300) } });
  check(await until(P1, () => (G.studyGroup.counters().ignored["offer-size"] || 0) >= 1), "an oversize offer is refused as too big at the wire rules");
  check(await until(P1, () => !!document.querySelector(".sg-offer-note")) && await text(P1, ".sg-offer-note") === MSG.refused, "P1 is told once, in one fixed sentence: \"" + MSG.refused + "\"");
  check((await st(P1)).offer.oid === "NEWV2222", "the offer P1 already held is untouched by the refused one");

  // d. a forged field the wire rules do not name
  await inject(ptOffer("FORG2222", null, (d) => { d.foo = "x"; }));
  check(await until(P1, () => (G.studyGroup.counters().ignored["offer-pt-plan-key:foo"] || 0) >= 1), "a forged extra field inside a PT plan is refused by that kind's closed key set");

  // e. a forged personal key
  await inject(ptOffer("PERS2222", null, (d) => { d.rank = "SSG"; d.notes = "PLANTED-NOTE"; }));
  check(await until(P1, () => (G.studyGroup.counters().ignored["offer-personal"] || 0) >= 1), "a forged rank and notes inside a PT plan is refused as personal, at the wire rules");
  const forgedFrames = log.filter((e) => e.injected && e.frame && e.frame.t === "offer");
  check(forgedFrames.length === 5, "all five forged frames went out to the room (" + forgedFrames.length + " sends at the seam) - and none of them applied anything");

  // f. valid structure, sensitive text: the guard catches it
  await inject(ptOffer("GARD2222", null, (d) => { d.days[5] = { id: "custom", label: "Call 270-555-0101 for the route", effort: "hard" }; }));
  check(await until(P1, (oid) => !!document.querySelector('.sg-offer[data-offer-oid="' + oid + '"][data-offer-status="blocked"]'), "GARD2222"), "a well-formed plan whose day name holds a phone number is caught on the device");
  const gtxt = await text(P1, ".sg-offer-blocked");
  check(/phone number/.test(gtxt) && gtxt.indexOf(MSG.refused) === 0 && !(await has(P1, ".sg-offer-add")) && !(await has(P1, ".sg-offer-note")), "P1 says it looks like it holds a phone number, offers no Add, and the old note is gone: \"" + gtxt + "\"");
  check(!gtxt.includes("270-555"), "the sensitive text itself is not echoed back");

  // g. a classification marking in the title
  await inject(ptOffer("MARK2222", { title: "Route SECRET//NOFORN" }));
  check(await until(P1, () => /classification or handling marking/.test((document.querySelector(".sg-offer-blocked") || {}).textContent || "")), "a title carrying a classification marking is caught the same way");

  // h. dismiss it, then replay the very same offer
  await clickWhenStable(P1, ".sg-offer-dismiss");
  check(await until(P1, () => !document.querySelector(".sg-offer")), "\"Dismiss\" clears the card");
  await inject(ptOffer("MARK2222", { title: "Route SECRET//NOFORN" }));
  check(await counter(P1, "dup-offer") >= 1 && !(await has(P1, ".sg-offer")), "replaying the same offer id asks nothing twice (\"dup-offer\") and the card stays gone");

  // i. an offer sent BY a peer
  const hostOid = (await st(H)).offer.oid;
  const roleBefore = await counter(H, "role");
  const peerAt = log.length; // the suite's own hostile frame: tagged, so the wire scan in block 6 judges only what the app sent
  await P2.evaluate((o) => window.__roomTransport.send({ v: G.roomSchema.PROTOCOL_VERSION, t: "offer", room: o.room, seq: 0, from: G.studyGroup.state().self.fp, body: { offer: { oid: "PEER2222", kind: "team-session", ver: 1, data: { steps: ["aar-huddle"] } } } }, null), { room: ROOM });
  await hub.drain();
  for (const e of log.slice(peerAt)) if (e.frame && e.frame.t === "offer") e.injected = true;
  check(await until(H, (n) => (G.studyGroup.counters().ignored.role || 0) > n, roleBefore), "an offer sent by a peer reaches the host as an ordinary frame and the host ignores it (\"role\")");
  check((await st(H)).offer.oid === hostOid && (await st(P1)).offer.oid !== "PEER2222", "the host's own offer is untouched and no other device got the peer's");

  // j. text with control and direction-override characters is cleaned before it is shown
  const RLO = String.fromCharCode(8238), NUL = String.fromCharCode(0);
  await inject(ptOffer("CLEN2222", { title: "Weekly" + RLO + "  PT" + NUL + " plan" }));
  check(await until(P1, () => !!document.querySelector('.sg-offer[data-offer-oid="CLEN2222"][data-offer-status="ready"]')), "an offer whose title carries control and direction-override characters still previews");
  check(await text(P1, ".sg-offer-title") === "Weekly PT plan", "...cleaned to plain text before it is shown: \"" + (await text(P1, ".sg-offer-title")) + "\"");
  await clickWhenStable(P1, ".sg-offer-dismiss");
  check(await until(P1, () => !document.querySelector(".sg-offer")), "...and dismissed");

  // k. no way to screen the text: fail closed
  await P1.evaluate(() => { window.__savedGuard = G.opsecGuard; G.opsecGuard = undefined; });
  await inject(ptOffer("NOGD2222"));
  check(await until(P1, (oid) => !!document.querySelector('.sg-offer[data-offer-oid="' + oid + '"][data-offer-status="blocked"]'), "NOGD2222"), "with the screening check unavailable, a perfectly good offer is NOT opened");
  check(await text(P1, ".sg-offer-blocked") === MSG.noGuard && !(await has(P1, ".sg-offer-add")), "P1 says it couldn't check what the host shared, and offers no Add: \"" + (await text(P1, ".sg-offer-blocked")) + "\"");
  await P1.evaluate(() => { G.opsecGuard = window.__savedGuard; delete window.__savedGuard; });
  await clickWhenStable(P1, ".sg-offer-dismiss");

  // Nothing above changed anything on P1's device.
  check((await writeSpy(P1)).length === writesBefore && JSON.stringify(await kv(P1, "prt:plan:v1")) === planBefore && JSON.stringify(await kv(P1, "team:sessions:v1")) === teamBefore, "through all eleven, P1 wrote nothing and its plan and sessions are exactly as they were");

  // A resend is a NEW offer: a device that said "Not now" is asked again on purpose.
  await waitForRoute(H, "#/group", { ready: ".sg-shared" });
  check(/Team Training session/.test(await text(H, ".sg-shared")) && /Squad night 1/.test(await text(H, ".sg-shared")) && /Send again/.test(await text(H, ".sg-share-again")), "the host's room screen notes what it shared (the session) and offers \"Send again\"");
  await clickWhenStable(H, ".sg-share-again");
  const resent = (await st(H)).offer;
  check(resent.oid !== hostOid && resent.kind === "team-session", "\"Send again\" is a NEW offer with a new id (" + hostOid + " -> " + resent.oid + ")");
  check(await until(P1, (id) => !!document.querySelector('.sg-offer[data-offer-kind="team-session"][data-offer-status="ready"][data-offer-oid="' + id + '"]'), resent.oid), "P1, which had already added the first one, is asked again about the new one - a resend is on purpose");
});

/* ================================================================== 6 */
await section("6. privacy: what the app put on the wire", async () => {
  await hub.drain();
  const app = log.filter((e) => !e.injected && e.frame && !e.frame.unparseable);
  const injected = log.filter((e) => e.injected).length;
  check(injected > 0, injected + " suite-injected frames are excluded from the scan by their tag");
  const offers = app.filter((e) => e.frame.t === "offer");
  check(offers.length >= 4 && offers.every((e) => e.from === "host"), "the app sent " + offers.length + " offer frames and EVERY one came from the host - no peer ever sent one", () => offers.map((e) => e.from).join());
  const texts = app.map((e) => JSON.stringify(e.frame));
  const leaked = PLANTED_ALL.filter((s) => texts.some((t) => t.indexOf(s) !== -1));
  check(leaked.length === 0, "none of the " + PLANTED_ALL.length + " planted personal strings (profile name, last name, MOS, a note, an owner, a PT result) appears in any of the " + app.length + " frames the app sent", () => leaked.join());
  const keys = new Set();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const k of Object.keys(v)) { keys.add(k.toLowerCase()); walk(v[k]); } };
  offers.forEach((e) => walk(e.frame.body.offer));
  const banned = await H.evaluate(() => G.roomSchema.handoff.FORBIDDEN_KEYS);
  check([...keys].every((k) => banned.indexOf(k) === -1) && !keys.has("count") && !keys.has("last") && !keys.has("createdat"), "no forbidden key name - and no completion count, no timestamp - appears anywhere in the " + offers.length + " offers (" + keys.size + " distinct keys: " + [...keys].sort().join(" ") + ")", () => [...keys].join());
  const validity = await H.evaluate((ts) => ts.map((t) => G.roomSchema.validate(JSON.parse(t)).ok), texts);
  check(validity.every(Boolean), "every one of the " + texts.length + " app-sent frames passes G.roomSchema.validate", () => validity.filter((v) => !v).length + " failed");
  check(offers.every((e) => new TextEncoder().encode(JSON.stringify(e.frame.body.offer)).length <= 3072), "every offer is within the payload cap");
  const perOid = {};
  offers.forEach((e) => { perOid[e.frame.body.offer.oid] = (perOid[e.frame.body.offer.oid] || 0) + 1; });
  check(Object.values(perOid).every((n) => n >= 3), "each offer id went to every seated device at least once (" + JSON.stringify(perOid) + ")");
});

/* ================================================================== 7 */
await section("7. the guest page (dist/guest.html) joins a real relay and shows a share without its content", async () => {
  const evidence = join(tmpdir(), "guidon-room-handoff-guest-evidence-" + process.pid + ".json");
  let srv = null, host = null, ctx = null;
  try {
    srv = await startRoomServer({ loopback: true, port: 0, guest: resolve("dist/guest.html"), evidence, quiet: true });
    const room = "MIKE-NOVEMBER-27";
    host = nodeHost({ room, wsBase: "127.0.0.1:" + srv.port, fp: "NODEHOST", name: "HOST-KILO", bankSig: "bank:10:x" });
    await host.ready;
    ctx = await boot.browser.newContext({ viewport: { width: 390, height: 844 } });
    const g = await ctx.newPage();
    const gnoise = [];
    g.on("console", (m) => { if (["error", "warning"].includes(m.type())) gnoise.push(m.type() + ": " + m.text()); });
    g.on("pageerror", (e) => gnoise.push("pageerror: " + e.message));
    await g.goto("http://127.0.0.1:" + srv.port + "/j/" + room, { waitUntil: "load" });
    await g.fill("input.gp-name", "GUEST-BROWSER");
    await clickWhenStable(g, "button.gp-join");
    check(await until(g, () => !!window.__guestState && !!window.__guestState() && window.__guestState().joinState === "pending"), "the guest page joined and is waiting to be admitted");
    check(await pollNode(() => host.pending().length === 1), "the host saw the hello through the relay");
    host.act({ type: "admit", fp: host.pending()[0].fp });
    check(await until(g, () => window.__guestState().joinState === "seated"), "admitted and seated");
    const res = host.act({ type: "offer", offer: { kind: "pt-plan", ver: 1, title: "Weekly PT plan", data: { tpl: "balanced", days: [{ id: "rest" }, { id: "strength" }, { id: "custom", label: "Ruck 6 miles", effort: "hard" }, { id: "endurance" }, { id: "prep" }, { id: "circuit" }, { id: "recovery" }] } } });
    check(res.accepted, "the host offered a PT plan", () => res.reason);
    check(await until(g, () => !!document.querySelector(".gp-offer")), "the guest page shows a \"Shared by the host\" panel");
    const t = await text(g, ".gp-offer");
    check(/a PT plan/.test(t) && /can't add it to anything/.test(t) && /open the GUIDON app/.test(t) && /Nothing about it is kept on this page/.test(t), "it says the host shared a PT plan, that this page cannot add it, to open the app, and that nothing is kept: \"" + t + "\"", () => t);
    const body = await g.evaluate(() => document.body.innerText);
    check(body.indexOf("Ruck 6 miles") === -1 && body.indexOf("Weekly PT plan") === -1, "none of the plan's content is drawn on the page");
    check(!(await has(g, ".gp-offer button")), "and there is no button to add it");
    const stores = await g.evaluate(async () => ({ ls: localStorage.length, ss: sessionStorage.length, cookie: document.cookie, dbs: typeof indexedDB.databases === "function" ? (await indexedDB.databases()).length : 0 }));
    check(stores.ls === 0 && stores.ss === 0 && stores.cookie === "" && stores.dbs === 0, "the guest page stores nothing: no localStorage, sessionStorage, cookie or database", () => JSON.stringify(stores));
    check(gnoise.length === 0, "no console errors on the guest page", () => gnoise.join(" | "));
  } finally {
    if (ctx) await ctx.close();
    if (host) host.close();
    if (srv) await srv.close();
    await rm(evidence, { force: true });
  }
});

expectNoConsoleNoise(noise, { ignore: [/Failed to load resource.*404/i] });
await finish("ROOM HANDOFF");
