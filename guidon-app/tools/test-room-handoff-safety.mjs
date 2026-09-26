/**
 * Study Rooms hand-off: the safety net around what a Soldier can lose, cannot
 * reach, or could be shown that should have been stopped - through the REAL
 * screens, in separate browser contexts.
 *
 * WHY THIS SUITE EXISTS: PR #250 shipped "Study Rooms carrying PT plans and
 * Team Training sessions" (tools/test-room-handoff.mjs proves the happy path and
 * the rejects; tools/test-room-handoff-core.mjs proves the rules). Review found
 * defects a happy-path suite cannot see, each of which would ship unnoticed if
 * this file were deleted:
 *
 *  1. UNDO ERASED WORK. "Undo" after receiving a PT plan put the pre-Add plan
 *     back wholesale - silently discarding anything the Soldier changed after
 *     tapping Add. Undo is now offered and performed only while the plan is
 *     still exactly what Add wrote; otherwise it says so in plain words and
 *     changes nothing.
 *  2. A SEND BUTTON OFF THE SCREEN. The "Share to my room" confirm box had no
 *     maximum height: a legal, maximum-size plan pushed "Send to the room" below
 *     the bottom of a laptop or a phone, so the host could neither review nor
 *     send. The box now scrolls its message and keeps its buttons on screen.
 *  3. PROTOTYPE-NAMED DRILL IDS. A wire drill id of "constructor", "toString" or
 *     "valueOf" passed the "is a real drill on this device" check because the
 *     lookup table inherited those names.
 *  4. COMBINED TEXT. A changed date ("2026-10-01") and a custom name ("Live-fire
 *     at Range 4") each pass the sensitive-text check alone; on one line they are
 *     a future date, a place and a unit activity. Both the sender and the
 *     receiver now screen the line as it is read.
 *  5. A LOST DRAFT. The unsaved Team Training session draft was wiped when the
 *     host left the screen to open Study Rooms, so the advertised "host a room
 *     and come back" flow could not complete. It now survives (in memory only).
 *  6. SMALL CONTROLS. The Team Training session-name box was under 16px (iOS
 *     zooms the page on focus) and short-label buttons were narrower than 44px.
 *
 * Contexts in one browser, wired through the fake transport at the room
 * module's seam (tools/room-harness.mjs's hub - every frame is logged):
 *   H   the host, a personal profile with a plan, a custom session and PT history
 *   P1  a peer on a PHONE (390x844, touch), a personal profile with its own plan
 *   Q   a personal profile with a transport attached but NO room hosted
 *   Z   a Guest session with a transport attached but NO room hosted
 *
 * Every wait is a bounded poll on a real condition (tools/testkit.mjs).
 * Usage: node tools/test-room-handoff-safety.mjs   (exit code = FAIL count)
 */
import { bootApp, check, bad, finish, waitForRoute, clickWhenStable, clickButtonByText, until, PERSONAL_PROFILE, expectNoConsoleNoise } from "./testkit.mjs";
import { fakeTransport, writeSpy } from "./room-harness.mjs";
import { deviceDump, deviceKvGet } from "./device-storage.mjs";

const WATCHDOG_MS = 420000;
setTimeout(() => { console.log("  FAIL  suite watchdog: no verdict after " + WATCHDOG_MS + " ms"); console.log("\nROOM HANDOFF SAFETY: WATCHDOG TIMEOUT"); process.exit(99); }, WATCHDOG_MS).unref();

async function section(title, fn) {
  console.log("\n" + title);
  try { await fn(); } catch (e) { bad("block stopped early: " + String((e && e.message) || e).split("\n")[0]); }
}
const dayISO = (n) => { const d = new Date(); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
const SETTINGS_ON = { studyGroups: true };
const CUSTOM_KEY = "guidon:prt:customSessions:v1", PLAN_KEY = "prt:plan:v1";

/* ---- what each device already has on it ---- */
const HOST_SESSIONS = [{ id: "custom-1000", label: "Circuit night", effort: "hard", type: "session", blocks: [{ drillId: "cd1" }, { drillId: "cd2" }], createdAt: 1 }];
const HOST_PLAN = {
  version: 1, templateId: "field", weekStart: "sun",
  days: { sun: { id: "rest" }, mon: { id: "custom-1000" }, tue: { id: "strength" }, wed: { id: "custom", title: "Ruck 6 miles", effort: "hard" }, thu: { id: "prep" }, fri: { id: "endurance" }, sat: { id: "recovery" } },
  overrides: { [dayISO(3)]: { id: "recovery" } },
};
const P1_SESSIONS = [{ id: "custom-777", label: "Own session", effort: "moderate", type: "session", blocks: [{ drillId: "pd" }], createdAt: 5 }];
const P1_PLAN = { version: 1, templateId: "recovery", weekStart: "sun", days: { sun: { id: "rest" }, mon: { id: "recovery" }, tue: { id: "prep" }, wed: { id: "strength" }, thu: { id: "recovery" }, fri: { id: "endurance" }, sat: { id: "recovery" } }, overrides: {} };

const boot = await bootApp({ viewport: { width: 1280, height: 800 }, profile: { ...PERSONAL_PROFILE, displayName: "SGT HOSTONE", lastName: "HOSTONE" }, seedKv: { settings: SETTINGS_ON, [PLAN_KEY]: HOST_PLAN, [CUSTOM_KEY]: HOST_SESSIONS } });
const H = boot.page;
const noise = boot.noise;
const s1 = await boot.openSession({ viewport: { width: 390, height: 844 }, profile: { ...PERSONAL_PROFILE, displayName: "SGT PEERONE", lastName: "PEERONE" }, seedKv: { settings: SETTINGS_ON, [PLAN_KEY]: P1_PLAN, [CUSTOM_KEY]: P1_SESSIONS }, noise, contextOptions: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } });
const s2 = await boot.openSession({ viewport: { width: 1000, height: 800 }, profile: { ...PERSONAL_PROFILE, displayName: "SGT QUIET", lastName: "QUIET" }, seedKv: { settings: SETTINGS_ON }, noise });
const s3 = await boot.openSession({ viewport: { width: 1000, height: 800 }, profile: "guest", seedKv: { settings: SETTINGS_ON }, noise });
const P1 = s1.page, Q = s2.page, Z = s3.page;

const log = [];
const hub = fakeTransport({ log });
await hub.wire(H, { host: true });
await hub.wire(P1, {});
const hubQ = fakeTransport({});
await hubQ.wire(Q, { host: true });
const hubZ = fakeTransport({});
await hubZ.wire(Z, { host: true });
for (const p of [H, P1, Q, Z]) {
  const r = await p.evaluate(() => G.studyGroup.attach(window.__roomTransport));
  check(r && r.ok, "the room module is attached on a device", () => JSON.stringify(r));
}

const st = (p) => p.evaluate(() => { const s = G.studyGroup.state(); return s ? JSON.parse(JSON.stringify(s)) : null; });
const text = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
const has = (p, sel) => p.evaluate((s) => !!document.querySelector(s), sel);
const kv = async (p, key) => { const row = await deviceKvGet(p, key); return row === undefined ? null : row.v; };
const kvSnapshot = async (p) => JSON.stringify((await deviceDump(p)).stores.kv);
const offersSent = () => log.filter((e) => e.frame && e.frame.t === "offer" && !e.injected).length;
let ROOM = "", HOST_FP = "";
const inject = async (offer) => {
  const at = log.length;
  await H.evaluate((o) => window.__roomTransport.send({ v: G.roomSchema.PROTOCOL_VERSION, t: "offer", room: o.room, seq: 0, from: o.from, body: { offer: o.offer } }, "*"), { room: ROOM, from: HOST_FP, offer });
  await hub.drain();
  for (const e of log.slice(at)) if (e.frame && e.frame.t === "offer") e.injected = true;
};

/* ================================================================== room */
await section("0. a room with one seated peer on a phone", async () => {
  await waitForRoute(H, "#/group", { ready: "button.sg-host" });
  await waitForRoute(P1, "#/group", { ready: "button.sg-join" });
  const cats = await H.evaluate(() => { const seen = []; for (const q of G.store.boardQuestions()) if (q && q.category && seen.indexOf(q.category) === -1) seen.push(q.category); return seen.slice(0, 2); });
  const hosted = await H.evaluate((o) => G.studyGroup.host(o), { mode: "relay", name: "HOST-KILO", categories: cats, timerSec: 60, pingMs: 1500, missLimit: 8, holdMs: 30000 });
  check(hosted.ok, "hosted a relay room", () => JSON.stringify(hosted));
  ROOM = hosted.room; HOST_FP = hosted.fp;
  const joined = await P1.evaluate((o) => G.studyGroup.join(o), { room: ROOM, name: "PEER-ONE", pingMs: 1500, missLimit: 8 });
  check(joined.ok, "the phone joined", () => JSON.stringify(joined));
  await clickWhenStable(H, '.sg-admit[data-fp="' + joined.fp + '"]');
  check(await until(P1, () => G.studyGroup.state() && G.studyGroup.state().joinState === "seated"), "the phone is seated");
  await writeSpy(P1);
});

/* ================================================================== 1 */
const planIds = (plan) => ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((k) => plan.days[k].id);
const shareFromPlanner = async () => {
  await waitForRoute(H, "#/pt-plan", { ready: '[data-pt-view="week"]' });
  await clickWhenStable(H, '[data-pt-view="week"]');
  await clickWhenStable(H, "[data-pt-room-share] .sg-share-btn");
  if (!(await until(H, () => !!document.querySelector(".gm-box")))) return false;
  await clickButtonByText(H, "Send to the room", ".gm-box");
  return until(H, () => /Sent to 1 device/.test((document.querySelector("[data-pt-room-share] .sg-share-status") || {}).textContent || ""));
};
const resend = async () => {
  await waitForRoute(H, "#/group", { ready: ".sg-shared" });
  const before = (await st(H)).offer.oid;
  await clickWhenStable(H, ".sg-share-again");
  await until(H, (o) => G.studyGroup.state().offer.oid !== o, before);
  return (await st(H)).offer.oid;
};
/* The confirm box eases in (scale .97 -> 1). Measure it at rest, or a 44px button reads 43. */
const settled = (p) => until(p, () => { const b = document.querySelector(".gm-box"); if (!b) return false; const t = getComputedStyle(b).transform; return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)"; });
const readyCard = (oid) => until(P1, (o) => !!document.querySelector('.sg-offer[data-offer-oid="' + o + '"][data-offer-status="ready"]'), oid);

await section("1a. Undo is not offered once the plan was changed after Add (checked when the card is drawn)", async () => {
  check(await shareFromPlanner(), "the host shared its weekly plan from PT Planner");
  const oid = (await st(H)).offer.oid;
  await waitForRoute(P1, "#/group", { ready: ".sg-offer" });
  check(await readyCard(oid), "the phone sees a ready preview");
  check(/until you change your plan or leave the room/.test(await text(P1, ".sg-offer")), "the preview says Undo lasts until the plan is changed or the room is left");
  await clickWhenStable(P1, ".sg-offer-add");
  check(await until(P1, () => !!document.querySelector('.sg-offer[data-offer-status="added"]')), "the phone tapped Add");
  check(await has(P1, ".sg-offer-undo"), "right after Add an Undo button is there");
  const added = await kv(P1, PLAN_KEY), addedSessions = await kv(P1, CUSTOM_KEY);
  check(planIds(added)[1] !== "recovery" && addedSessions.length === 2, "the shared plan and its custom session are saved on the phone", () => JSON.stringify(planIds(added)));
  // The Soldier now works on the plan: Friday becomes something else and they save a session of their own.
  const edited = JSON.parse(JSON.stringify(added));
  edited.days.fri = await P1.evaluate(() => { const p = G.ptPlanner.PRESETS.circuit; return { id: p.id, title: p.title, type: p.type, effort: p.effort, route: p.route || "", sessionId: p.sessionId || "" }; });
  const editedSessions = addedSessions.concat([{ id: "custom-9001", label: "My new custom session", effort: "moderate", type: "session", blocks: [{ drillId: "gd" }], createdAt: 9 }]);
  await P1.evaluate(async (o) => { await G.db.setSetting("guidon:prt:customSessions:v1", o.s); await G.db.setSetting("prt:plan:v1", o.p); }, { p: edited, s: editedSessions });
  await waitForRoute(P1, "#/pt-plan", { ready: '[data-pt-view="week"]' });
  await waitForRoute(P1, "#/group", { ready: ".sg-offer" });
  check(await until(P1, () => !document.querySelector(".sg-offer-undo") && /Undo isn't possible any more/.test((document.querySelector(".sg-offer") || {}).textContent || "")), "back on the room screen the Undo button is GONE and the card says why in plain words");
  const note = await text(P1, ".sg-offer");
  check(/your PT plan or your custom sessions were changed after you added this/.test(note) && /Nothing was changed, so your changes are safe/.test(note) && !/undefined|null|\bNaN\b/.test(note), "...\"" + note + "\"");
  check(await has(P1, ".sg-offer-open") && await has(P1, ".sg-offer-done-btn"), "the card still offers the way to the planner and \"Done\"");
  const nowPlan = await kv(P1, PLAN_KEY), nowSessions = await kv(P1, CUSTOM_KEY);
  check(nowPlan.days.fri.id === "circuit" && planIds(nowPlan).join() === planIds(edited).join() && nowSessions.length === editedSessions.length && nowSessions.some((x) => x.label === "My new custom session"), "the Soldier's later edits (Friday, and the session they saved) are exactly as they left them", () => JSON.stringify({ plan: planIds(nowPlan), sessions: nowSessions.map((x) => x.label) }));
  await clickWhenStable(P1, ".sg-offer-done-btn");
  check(await until(P1, () => !document.querySelector(".sg-offer")), "\"Done\" clears the card");
});

await section("1b. Undo tapped after the plan was changed does nothing and says so (checked at the tap)", async () => {
  const oid = await resend();
  await waitForRoute(P1, "#/group", { ready: ".sg-offer" });
  check(await readyCard(oid), "the phone is offered the plan again (a new offer)");
  await clickWhenStable(P1, ".sg-offer-add");
  check(await until(P1, () => !!document.querySelector('.sg-offer[data-offer-status="added"]') && !!document.querySelector(".sg-offer-undo")), "Added, and Undo is offered");
  const added = await kv(P1, PLAN_KEY);
  // The person edits WITHOUT this card being redrawn, then taps the Undo that is still on screen.
  const edited = JSON.parse(JSON.stringify(added)); edited.days.sat = { id: "custom", title: "Own Saturday run", type: "custom", effort: "moderate", route: "", sessionId: "" };
  await P1.evaluate(async (p) => { await G.db.setSetting("prt:plan:v1", p); }, edited);
  const writesBefore = (await writeSpy(P1)).length;
  await clickWhenStable(P1, ".sg-offer-undo");
  check(await until(P1, () => /Undo isn't possible any more/.test((document.querySelector(".sg-offer-done") || {}).textContent || "")), "tapping Undo says it is no longer possible");
  check(JSON.stringify(await kv(P1, PLAN_KEY)) === JSON.stringify(edited), "the plan is exactly as the Soldier last saved it (nothing was restored over it)");
  check((await writeSpy(P1)).length === writesBefore, "and the tap wrote NOTHING to the device");
  check(!(await has(P1, ".sg-offer-undo")) && await has(P1, ".sg-offer-open"), "the Undo button is gone; the way to the planner is still there");
  await clickWhenStable(P1, ".sg-offer-done-btn");
  await until(P1, () => !document.querySelector(".sg-offer"));
});

await section("1c. Undo with nothing changed still puts the earlier plan back, exactly", async () => {
  const oid = await resend();
  await waitForRoute(P1, "#/group", { ready: ".sg-offer" });
  check(await readyCard(oid), "offered again");
  const beforePlan = JSON.stringify(await kv(P1, PLAN_KEY)), beforeSessions = JSON.stringify(await kv(P1, CUSTOM_KEY));
  await clickWhenStable(P1, ".sg-offer-add");
  check(await until(P1, () => !!document.querySelector(".sg-offer-undo")), "Added, and Undo is offered");
  check(JSON.stringify(await kv(P1, PLAN_KEY)) !== beforePlan, "the plan on the phone changed when it was added");
  await clickWhenStable(P1, ".sg-offer-undo");
  check(await until(P1, () => /Undone\. Your earlier version is back/.test((document.querySelector(".sg-offer-done") || {}).textContent || "")), "Undo says the earlier version is back");
  const afterPlan = JSON.stringify(await kv(P1, PLAN_KEY)), afterSessions = JSON.stringify(await kv(P1, CUSTOM_KEY));
  check(afterPlan === beforePlan && afterSessions === beforeSessions, "the plan and the custom sessions are byte for byte what they were before Add", () => "plan before " + beforePlan + " | plan after " + afterPlan + " | sessions before " + beforeSessions + " | sessions after " + afterSessions);
  await clickWhenStable(P1, ".sg-offer-done-btn");
  await until(P1, () => !document.querySelector(".sg-offer"));
});

await section("1d. Team Training Undo removes only the session that was added", async () => {
  await waitForRoute(H, "#/team", { ready: "details[data-team-builder]" });
  await H.evaluate(async () => { await G.db.setSetting("team:sessions:v1", []); });
  await clickWhenStable(H, "[data-team-plan-summary]");
  await clickWhenStable(H, '[data-team-add="aar-huddle"]');
  await clickWhenStable(H, '[data-team-add="blind-relay"]');
  await H.fill("[data-team-session-name]", "Squad night 1");
  await clickWhenStable(H, "details[data-team-builder] .sg-share-btn");
  check(await until(H, () => !!document.querySelector(".gm-box")), "the host opened the confirm box for a Team Training session");
  await clickButtonByText(H, "Send to the room", ".gm-box");
  check(await until(H, () => /Sent to 1 device/.test((document.querySelector("details[data-team-builder] .sg-share-status") || {}).textContent || "")), "sent");
  await P1.evaluate(async () => { await G.db.setSetting("team:sessions:v1", [{ id: "ts-own", title: "My own session", steps: ["teach-back"], createdAt: 1 }]); });
  await waitForRoute(P1, "#/group", { ready: '.sg-offer[data-offer-kind="team-session"][data-offer-status="ready"]' });
  await clickWhenStable(P1, ".sg-offer-add");
  check(await until(P1, () => !!document.querySelector(".sg-offer-undo")), "the phone added the shared session");
  await P1.evaluate(async () => { const cur = await G.db.getSetting("team:sessions:v1", []); cur.push({ id: "ts-later", title: "Added afterwards", steps: ["mdmp-round"], createdAt: 2 }); await G.db.setSetting("team:sessions:v1", cur); });
  await clickWhenStable(P1, ".sg-offer-undo");
  check(await until(P1, () => /Undone/.test((document.querySelector(".sg-offer-done") || {}).textContent || "")), "Undo says it is undone");
  const left = (await kv(P1, "team:sessions:v1")).map((s) => s.title).sort();
  check(left.join("|") === "Added afterwards|My own session", "only the added session went; the Soldier's own session and the one they added afterwards are still there", () => left.join("|"));
  await clickWhenStable(P1, ".sg-offer-done-btn");
  await until(P1, () => !document.querySelector(".sg-offer"));
});

/* ================================================================== 2 */
const MODAL_GEOMETRY = () => {
  const box = document.querySelector(".gm-box"), body = document.querySelector(".gm-dialog-body");
  const send = [...document.querySelectorAll(".gm-box button")].find((b) => /Send to the room/.test(b.textContent));
  const notNow = [...document.querySelectorAll(".gm-box button")].find((b) => /Not now/.test(b.textContent));
  if (!box || !body || !send) return null;
  const r = box.getBoundingClientRect(), s = send.getBoundingClientRect(), n = notNow.getBoundingClientRect();
  const at = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
  const eyebrow = box.querySelector(".eyebrow").getBoundingClientRect();
  return { vw: innerWidth, vh: innerHeight, boxTop: r.top, boxBottom: r.bottom, sendTop: s.top, sendBottom: s.bottom, sendLeft: s.left, sendRight: s.right, notNowBottom: n.bottom,
    sendIsTop: at === send || send.contains(at), bodyScrolls: body.scrollHeight > body.clientHeight + 1, bodyFocusable: body.tabIndex === 0, eyebrowTop: eyebrow.top, bodyH: body.clientHeight, bodyScrollH: body.scrollHeight };
};

await section("2. the confirm box keeps \"Send to the room\" on screen for a maximum-size plan", async () => {
  // The largest plan a room carries: 6 custom sessions of 12 drill blocks, all seven days on them, and 8 changed dates.
  const built = await H.evaluate(async (dates) => {
    const drills = G.store.prtMeta().drills.map((d) => d.id);
    const sessions = [];
    for (let i = 0; i < 6; i++) sessions.push({ id: "custom-" + (2000 + i), label: "Session number " + (i + 1) + " with a real name", effort: ["hard", "moderate", "recovery"][i % 3], type: "session", blocks: Array.from({ length: 12 }, (_, j) => ({ drillId: drills[(i + j) % drills.length] })), createdAt: 10 + i });
    const days = {}; ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].forEach((k, i) => { days[k] = { id: sessions[i % 6].id }; });
    const overrides = {}; dates.forEach((d, i) => { overrides[d] = { id: sessions[i % 6].id }; });
    await G.db.setSetting("guidon:prt:customSessions:v1", sessions);
    await G.db.setSetting("prt:plan:v1", { version: 1, templateId: "field", weekStart: "sun", days, overrides });
    return { sessions: sessions.length };
  }, Array.from({ length: 8 }, (_, i) => dayISO(i + 1)));
  check(built.sessions === 6, "the host's plan is now the largest one a room can carry (6 sessions x 12 blocks, 8 changed dates)");
  await waitForRoute(H, "#/pt-plan", { ready: '[data-pt-view="week"]' });
  await clickWhenStable(H, '[data-pt-view="week"]');
  await until(H, () => !!document.querySelector("[data-pt-room-share] .sg-share-btn"));

  const cases = [{ w: 1280, h: 600, what: "a short laptop (1280x600)", send: false }, { w: 390, h: 844, what: "a phone (390x844)", send: false }, { w: 360, h: 640, what: "a small phone (360x640)", send: true }];
  for (const c of cases) {
    await H.setViewportSize({ width: c.w, height: c.h });
    await clickWhenStable(H, "[data-pt-room-share] .sg-share-btn");
    const opened = await until(H, () => !!document.querySelector(".gm-box .gm-dialog-body") && document.querySelector(".gm-back.modaltrap-open") !== null);
    check(opened, c.what + ": the confirm box opened for the maximum-size plan");
    if (!opened) { const msg = await text(H, "[data-pt-room-share] .sg-share-status"); bad(c.what + ": no box - status said: " + msg); continue; }
    await settled(H);
    const g = await H.evaluate(MODAL_GEOMETRY);
    check(g && g.boxTop >= -0.5 && g.boxBottom <= g.vh + 0.5, c.what + ": the whole box is inside the screen (top " + Math.round(g.boxTop) + ", bottom " + Math.round(g.boxBottom) + " of " + g.vh + ")", () => JSON.stringify(g));
    check(g && g.sendTop >= 0 && g.sendBottom <= g.vh && g.sendLeft >= 0 && g.sendRight <= g.vw && g.notNowBottom <= g.vh, c.what + ": \"Send to the room\" and \"Not now\" are both on screen (Send bottom " + Math.round(g.sendBottom) + " of " + g.vh + ")", () => JSON.stringify(g));
    check(g && g.sendIsTop, c.what + ": the Send button is what is under its own centre (nothing covers it)");
    check(g && g.bodyScrolls && g.bodyH < g.bodyScrollH, c.what + ": the message is the part that scrolls (" + (g && g.bodyH) + "px visible of " + (g && g.bodyScrollH) + "px)", () => JSON.stringify(g));
    check(g && g.bodyFocusable && g.eyebrowTop >= 0, c.what + ": the scrolling message is a keyboard stop and the title stays visible");
    // Scroll the message to its end: the last line becomes visible, and the buttons never moved.
    const end = await H.evaluate(() => { const body = document.querySelector(".gm-dialog-body"), send = [...document.querySelectorAll(".gm-box button")].find((b) => /Send/.test(b.textContent)); const before = send.getBoundingClientRect().top; body.scrollTop = body.scrollHeight; const p = body.querySelector("p").getBoundingClientRect(), b = body.getBoundingClientRect(); return { atEnd: Math.abs(body.scrollTop + body.clientHeight - body.scrollHeight) <= 1, lastVisible: p.bottom <= b.bottom + 1, sameSpot: send.getBoundingClientRect().top === before }; });
    check(end.atEnd && end.lastVisible && end.sameSpot, c.what + ": scrolled to the end, the last line (the promise about what is not sent) shows and the buttons did not move", () => JSON.stringify(end));
    if (c.send) {
      const sentBefore = offersSent();
      await clickButtonByText(H, "Send to the room", ".gm-box");
      check(await until(H, () => /Sent to 1 device/.test((document.querySelector("[data-pt-room-share] .sg-share-status") || {}).textContent || "")), c.what + ": clicking Send went through - \"Sent to 1 device\"");
      check(offersSent() === sentBefore + 1, "exactly one offer frame went to the room");
    } else {
      await clickButtonByText(H, "Not now", ".gm-box");
      check(await until(H, () => /Nothing was sent/.test((document.querySelector("[data-pt-room-share] .sg-share-status") || {}).textContent || "")), c.what + ": \"Not now\" says nothing was sent");
    }
    await until(H, () => !document.querySelector(".gm-back"));
  }

  // Every other themed dialog is unaffected: a short message stays a small box with no scroll region and no extra tab stop.
  await H.setViewportSize({ width: 1280, height: 800 });
  const pending = H.evaluate(() => G.modal.confirm("Remove the session \"Squad night 1\" from this device? The exercises themselves are not affected.", { title: "Remove session", okText: "Remove", danger: true }));
  check(await until(H, () => !!document.querySelector(".gm-box") && document.querySelector(".gm-back.modaltrap-open") !== null), "a short confirm dialog opens");
  const short = await H.evaluate(() => { const box = document.querySelector(".gm-box"), body = document.querySelector(".gm-dialog-body"); const r = box.getBoundingClientRect(); return { h: r.height, scrolls: body.scrollHeight > body.clientHeight + 1, tab: body.hasAttribute("tabindex"), role: body.getAttribute("role"), buttons: [...box.querySelectorAll("button")].map((b) => b.textContent.trim()) }; });
  check(short.h < 260 && !short.scrolls && !short.tab && short.role === null && short.buttons.join() === "Cancel,Remove", "it is a small box (" + Math.round(short.h) + "px), scrolls nothing, adds no keyboard stop, and keeps its two buttons", () => JSON.stringify(short));
  await clickButtonByText(H, "Remove", ".gm-box");
  check((await pending) === true, "OK still resolves true");
  const asked = H.evaluate(() => G.modal.prompt("Rename it", "abc", { title: "Rename" }));
  check(await until(H, () => !!document.querySelector(".gm-box input")), "a prompt dialog still has its text box");
  const promptShape = await H.evaluate(() => { const box = document.querySelector(".gm-box"), input = box.querySelector("input"), kids = [...box.children].map((c) => c.className.split(" ")[0]); return { value: input.value, kids }; });
  check(promptShape.value === "abc" && promptShape.kids.join() === "eyebrow,gm-dialog-body,ob-input,btn-row", "...with the message above it and the buttons below, in order", () => JSON.stringify(promptShape));
  await H.fill(".gm-box input", "xyz");
  await H.keyboard.press("Enter");
  check((await asked) === "xyz", "typing and pressing Enter still returns the typed value");
  const cancelled = H.evaluate(() => G.modal.confirm("Are you sure?", { title: "Confirm" }));
  await until(H, () => !!document.querySelector(".gm-box"));
  await clickButtonByText(H, "Cancel", ".gm-box");
  check((await cancelled) === false, "Cancel still resolves false");
});

/* ================================================================== 3 */
await section("3. drill ids named like Object.prototype members are not \"real drills on this device\"", async () => {
  const ptOffer = (oid, mutate) => { const o = { oid, kind: "pt-plan", ver: 1, title: "Weekly PT plan", data: { tpl: "balanced", days: [{ id: "rest" }, { id: "session", ref: "s1" }, { id: "recovery" }, { id: "endurance" }, { id: "prep" }, { id: "circuit" }, { id: "recovery" }], sessions: [{ key: "s1", label: "Injected", effort: "hard", type: "session", blocks: ["constructor", "toString", "valueOf"] }] } }; if (mutate) mutate(o.data); return o; };
  await waitForRoute(P1, "#/group", { ready: "button.sg-leave" });
  const beforePlan = JSON.stringify(await kv(P1, PLAN_KEY)), beforeSessions = JSON.stringify(await kv(P1, CUSTOM_KEY));
  await inject(ptOffer("PROT2222"));
  check(await until(P1, () => !!document.querySelector('.sg-offer[data-offer-oid="PROT2222"]')), "the phone receives an offer whose only drill blocks are \"constructor\", \"toString\" and \"valueOf\"");
  check(await until(P1, () => { const c = document.querySelector('.sg-offer[data-offer-oid="PROT2222"]'); return !!c && c.getAttribute("data-offer-status") !== "working"; }), "...and reads it");
  const pv = await text(P1, '.sg-offer[data-offer-oid="PROT2222"]');
  check(!/function|native code|\[object|Object\(\)/.test(pv), "the preview shows no engine text (\"function Object() { [native code] }\")", () => pv);
  check(/3 drill blocks aren't on this device and will be left out/.test(pv), "all three blocks are counted as not on this device: \"" + pv.slice(0, 200) + "\"", () => pv);
  await clickWhenStable(P1, ".sg-offer-add");
  check(await until(P1, () => !!document.querySelector('.sg-offer[data-offer-status="added"]')), "added");
  const sessions = await kv(P1, CUSTOM_KEY), plan = await kv(P1, PLAN_KEY);
  const stored = JSON.stringify([sessions, plan]);
  check(!/constructor|toString|valueOf/.test(stored), "none of those ids was saved on the device (no session, no drill block)", () => stored.slice(0, 300));
  check(sessions.length === JSON.parse(beforeSessions).length && plan.days.mon.id === "custom" && plan.days.mon.title === "Injected", "the session with nothing real in it became a plain named day, not a saved session", () => JSON.stringify(plan.days.mon));
  await clickWhenStable(P1, ".sg-offer-undo");
  await until(P1, () => /Undone/.test((document.querySelector(".sg-offer-done") || {}).textContent || ""));
  check(JSON.stringify(await kv(P1, PLAN_KEY)) === beforePlan && JSON.stringify(await kv(P1, CUSTOM_KEY)) === beforeSessions, "Undo puts the phone's own plan back exactly");
  await clickWhenStable(P1, ".sg-offer-done-btn");

  // A real drill mixed in with the inherited names: only the real one is kept.
  await inject(ptOffer("PROT3333", (d) => { d.sessions[0].blocks = ["hasOwnProperty", "gd", "__proto__", "isPrototypeOf", "cd1", "constructor"]; }));
  await until(P1, () => !!document.querySelector('.sg-offer[data-offer-oid="PROT3333"][data-offer-status="ready"]'));
  const pv2 = await text(P1, '.sg-offer[data-offer-oid="PROT3333"]');
  check(/4 drill blocks aren't on this device and will be left out/.test(pv2), "with two real drills among six names, four are counted as missing", () => pv2);
  await clickWhenStable(P1, ".sg-offer-add");
  await until(P1, () => !!document.querySelector('.sg-offer[data-offer-status="added"]'));
  const kept = (await kv(P1, CUSTOM_KEY)).find((s) => s.label === "Injected");
  check(kept && JSON.stringify(kept.blocks) === JSON.stringify([{ drillId: "gd" }, { drillId: "cd1" }]), "only the two real drills (gd, cd1) were saved, in order", () => JSON.stringify(kept));
  await clickWhenStable(P1, ".sg-offer-undo");
  await until(P1, () => /Undone/.test((document.querySelector(".sg-offer-done") || {}).textContent || ""));
  await clickWhenStable(P1, ".sg-offer-done-btn");

  // The same class of bug in the Team Training adapter: a wire step named "constructor" is no exercise, and a stored row with such an id is not "already seen".
  await inject({ oid: "PROT4444", kind: "team-session", ver: 1, title: "Odd", data: { steps: ["constructor"] } });
  await until(P1, () => { const c = document.querySelector('.sg-offer[data-offer-oid="PROT4444"]'); return !!c && c.getAttribute("data-offer-status") !== "working"; });
  const tt = await text(P1, '.sg-offer[data-offer-oid="PROT4444"]');
  check(/None of this session's exercises are on this device/.test(tt) && !(await has(P1, ".sg-offer-add")), "a Team Training session whose only step is \"constructor\" is refused as having no exercises on this device", () => tt);
  await clickWhenStable(P1, ".sg-offer-dismiss");
  const kept2 = await P1.evaluate(() => G.teamTraining._normalizeSessions([{ id: "constructor", title: "A", steps: ["aar-huddle"] }, { id: "toString", title: "B", steps: ["aar-huddle"] }, { id: "constructor", title: "dup", steps: ["aar-huddle"] }]).map((s) => s.id + ":" + s.title));
  check(kept2.join() === "constructor:A,toString:B", "saved Team Training rows with ids like \"constructor\" and \"toString\" are kept (a real repeat is still dropped)", () => kept2.join());
});

/* ================================================================== 4 */
await section("4. a date and a place that only add up on one line are stopped - by the sender and by the receiver", async () => {
  const combo = await H.evaluate((d) => ({ date: G.opsecGuard.screen(d).findings.length, label: G.opsecGuard.screen("Live-fire at Range 4").findings.length, both: G.opsecGuard.screen(d + ": Live-fire at Range 4").findings.map((f) => f.code) }), dayISO(10));
  check(combo.date === 0 && combo.label === 0 && combo.both.join() === "future-operation-location", "the example: the date alone is clean, \"Live-fire at Range 4\" alone is clean, together they are a future date and place for a unit activity", () => JSON.stringify(combo));

  // ---- the receiver ----
  await waitForRoute(P1, "#/group", { ready: "button.sg-leave" });
  const plan = { tpl: "balanced", days: [{ id: "rest" }, { id: "strength" }, { id: "recovery" }, { id: "endurance" }, { id: "prep" }, { id: "circuit" }, { id: "recovery" }], dates: [{ date: dayISO(10), entry: { id: "custom", label: "Live-fire at Range 4", effort: "hard" } }] };
  const writesBefore = (await writeSpy(P1)).length;
  await inject({ oid: "COMB2222", kind: "pt-plan", ver: 1, title: "Weekly PT plan", data: plan });
  check(await until(P1, () => { const c = document.querySelector('.sg-offer[data-offer-oid="COMB2222"]'); return !!c && c.getAttribute("data-offer-status") !== "working"; }), "the phone reads a well-formed plan with that changed date");
  const rx = await text(P1, '.sg-offer[data-offer-oid="COMB2222"]');
  check(await has(P1, '.sg-offer[data-offer-oid="COMB2222"][data-offer-status="blocked"]') && !(await has(P1, ".sg-offer-add")), "it is BLOCKED - there is no Add button", () => rx);
  check(/a future date and place for a unit activity/.test(rx) && !rx.includes("Live-fire at Range 4"), "the card says what it looks like and does not echo the text: \"" + rx + "\"", () => rx);
  check((await writeSpy(P1)).length === writesBefore, "nothing was written to the phone");
  await clickWhenStable(P1, ".sg-offer-dismiss");
  // The same name on an ordinary weekday (no date) is fine: no false alarm.
  const weekday = JSON.parse(JSON.stringify(plan)); delete weekday.dates; weekday.days[5] = { id: "custom", label: "Live-fire at Range 4", effort: "hard" };
  await inject({ oid: "COMB3333", kind: "pt-plan", ver: 1, title: "Weekly PT plan", data: weekday });
  check(await until(P1, () => !!document.querySelector('.sg-offer[data-offer-oid="COMB3333"][data-offer-status="ready"]')), "the same words on a weekday line (no date) are not stopped");
  await clickWhenStable(P1, ".sg-offer-dismiss");
  // A title that is itself date + place + activity (already one string).
  await inject({ oid: "COMB4444", kind: "team-session", ver: 1, title: "2026-12-01 convoy at Range 9", data: { steps: ["aar-huddle"] } });
  check(await until(P1, () => !!document.querySelector('.sg-offer[data-offer-oid="COMB4444"][data-offer-status="blocked"]')), "a Team Training title that is a date, an activity and a place is blocked too");
  await clickWhenStable(P1, ".sg-offer-dismiss");

  // ---- the sender ----
  const hostPlan = await H.evaluate(async () => G.db.getSetting("prt:plan:v1", null));
  const withDate = JSON.parse(JSON.stringify(hostPlan));
  withDate.overrides = { [dayISO(10)]: { id: "custom", title: "Live-fire at Range 4", type: "custom", effort: "hard", route: "", sessionId: "" } };
  await H.evaluate(async (p) => { await G.db.setSetting("prt:plan:v1", p); }, withDate);
  await H.setViewportSize({ width: 1280, height: 800 });
  await waitForRoute(H, "#/pt-plan", { ready: '[data-pt-view="week"]', fresh: true });
  await clickWhenStable(H, '[data-pt-view="week"]');
  const sentBefore = offersSent();
  await clickWhenStable(H, "[data-pt-room-share] .sg-share-btn");
  check(await until(H, () => /nothing was sent/i.test((document.querySelector("[data-pt-room-share] .sg-share-status") || {}).textContent || "")), "the host taps Share: it is refused with \"nothing was sent\"");
  const said = await text(H, "[data-pt-room-share] .sg-share-status");
  check(/looks like it holds something sensitive/.test(said) && /a future date and place for a unit activity/.test(said) && new RegExp("on the line for " + dayISO(10)).test(said), "...and it names what looks sensitive and which line, in plain words: \"" + said + "\"", () => said);
  check(!(await has(H, ".gm-box")) && offersSent() === sentBefore, "no confirm box appeared and no offer frame went out");
  // Clean it and it is offered again.
  const cleaned = JSON.parse(JSON.stringify(withDate)); cleaned.overrides[dayISO(10)].title = "Ruck 6 miles";
  await H.evaluate(async (p) => { await G.db.setSetting("prt:plan:v1", p); }, cleaned);
  await waitForRoute(H, "#/pt-plan", { ready: '[data-pt-view="week"]', fresh: true });
  await clickWhenStable(H, '[data-pt-view="week"]');
  await clickWhenStable(H, "[data-pt-room-share] .sg-share-btn");
  check(await until(H, () => !!document.querySelector(".gm-box")), "with the name changed to \"Ruck 6 miles\" the confirm box opens as usual");
  await clickButtonByText(H, "Not now", ".gm-box");
  await until(H, () => !document.querySelector(".gm-back"));

  // ---- Team Training: the name is checked alone AND as the lines a person reads ----
  const tt = await H.evaluate(async () => {
    const real = G.opsecGuard.screen, seen = [];
    G.opsecGuard.screen = function (t) { seen.push(String(t)); return real.call(G.opsecGuard, t); };
    let r;
    try { r = await G.teamTraining.handoffBuild("Squad night", ["aar-huddle", "pace-trust"]); } finally { G.opsecGuard.screen = real; }
    return { ok: r.ok, seen, lines: r.lines };
  });
  const whole = tt.lines && tt.lines.join("\n");
  check(tt.ok && tt.seen.indexOf("Squad night") !== -1 && tt.seen.indexOf(whole) !== -1, "Team Training screens the name alone AND the whole list a person reads (name, exercises in order, minutes) as one text", () => JSON.stringify(tt.seen));
  const flaggedTogether = await H.evaluate(async () => {
    const real = G.opsecGuard.screen;
    // A stand-in that stops only the pair "name + exercise" - what a per-string check can never see.
    G.opsecGuard.screen = function (t) { return /Squad night/.test(t) && /AAR Huddle/.test(t) ? { findings: [{ code: "future-operation-location", looksLike: "a future date and place for a unit activity" }] } : real.call(G.opsecGuard, t); };
    let r;
    try { r = await G.teamTraining.handoffBuild("Squad night", ["aar-huddle", "pace-trust"]); } finally { G.opsecGuard.screen = real; }
    return r;
  });
  check(!flaggedTogether.ok && /session name and exercise list look like they hold a future date and place for a unit activity/.test(flaggedTogether.message) && /nothing was sent/.test(flaggedTogether.message), "when the two only add up together, the share is refused in plain words: \"" + flaggedTogether.message + "\"", () => JSON.stringify(flaggedTogether));
  const realName = await H.evaluate(async () => G.teamTraining.handoffBuild("2026-12-01 convoy at Range 9", ["aar-huddle"]));
  check(!realName.ok && /nothing was sent/.test(realName.message), "and a session name that is a date, an activity and a place is refused by the real check");
});

/* ================================================================== 5 */
const openBuilder = async (p) => {
  if (!(await p.evaluate(() => !!(document.querySelector("details[data-team-builder]") || {}).open))) await clickWhenStable(p, "[data-team-plan-summary]");
  await until(p, () => !!(document.querySelector("details[data-team-builder]") || {}).open);
};
const draftScreen = async (p) => p.evaluate(() => ({
  open: !!(document.querySelector("details[data-team-builder]") || {}).open,
  name: (document.querySelector("[data-team-session-name]") || {}).value,
  steps: Array.from(document.querySelectorAll("[data-team-draft] li")).map((li) => li.textContent.replace(/\s+/g, " ").trim().split(" (")[0]),
  total: (document.querySelector("[data-team-draft-total]") || {}).textContent,
}));

await section("5. the Team Training draft survives leaving for Study Rooms and coming back (memory only)", async () => {
  for (const [who, page, isGuest] of [["a personal profile", Q, false], ["a Guest session", Z, true]]) {
    await waitForRoute(page, "#/team", { ready: "details[data-team-builder]" });
    const before = await kvSnapshot(page);
    await writeSpy(page);
    await openBuilder(page);
    await clickWhenStable(page, '[data-team-add="aar-huddle"]');
    await clickWhenStable(page, '[data-team-add="pace-trust"]');
    await clickWhenStable(page, '[data-team-add="blind-relay"]');
    await page.fill("[data-team-session-name]", "Draft round trip");
    await clickWhenStable(page, '[data-team-up="2"]');
    check(await until(page, () => { const li = document.querySelectorAll("[data-team-draft] li"); return li.length === 3 && /^Blind Relay/.test(li[1].textContent); }), who + ": a name and three exercises, reordered, are in the builder");
    const built = await draftScreen(page);
    const gateText = await text(page, "details[data-team-builder] .sg-share-status");
    check(/aren't hosting a room right now/.test(gateText) && (await has(page, "details[data-team-builder] .sg-share-open")), who + ": Share says no room is hosted and offers \"Open Study Rooms\" (the flow the screen advertises)", () => gateText);
    await clickWhenStable(page, "details[data-team-builder] .sg-share-open");
    check(await until(page, () => location.hash === "#/group"), who + ": following it goes to Study Rooms");
    await waitForRoute(page, "#/group", { ready: "button.sg-host" });
    await waitForRoute(page, "#/team", { ready: "details[data-team-builder]" });
    const back = await draftScreen(page);
    check(JSON.stringify(back) === JSON.stringify(built) && back.open && back.name === "Draft round trip" && back.steps.length === 3, who + ": back on Team Training the builder is open with the same name, the same three exercises in the same order and the same total", () => JSON.stringify({ built, back }));
    const writes = await writeSpy(page);
    check(writes.filter((w) => /team:|guidon:prt/.test(String(w.key))).length === 0, who + ": nothing was written for the draft (no Team Training row was touched)", () => JSON.stringify(writes));
    check((await kvSnapshot(page)) === before, who + ": the device's stored rows are byte for byte what they were");
    if (isGuest) check((await kv(page, "team:sessions:v1")) === null, "the Guest's device holds no team session row at all");
    // Reloading the app (a restart) empties it: it was never stored. (A Guest session has no profile to come back to - a reload
    // returns to the welcome screen - so that half is only for the personal profile.)
    if (!isGuest) {
      await page.reload({ waitUntil: "load" });
      await waitForRoute(page, "#/team", { ready: "details[data-team-builder]" });
      const restarted = await draftScreen(page);
      check(restarted.steps.length === 0 && restarted.name === "" && !restarted.open, who + ": after the app restarts the draft is gone (it was only ever in memory)", () => JSON.stringify(restarted));
    }
    // Rebuild a draft, save it: the draft empties and stays empty across a round trip.
    await openBuilder(page);
    await clickWhenStable(page, '[data-team-add="aar-huddle"]');
    await page.fill("[data-team-session-name]", "Kept once");
    await clickWhenStable(page, "[data-team-session-save]");
    check(await until(page, () => !!document.querySelector("[data-team-session-card]") && !document.querySelector("[data-team-draft]")), who + ": \"Save session\" saves it and empties the builder");
    await waitForRoute(page, "#/group", { ready: "button.sg-host" });
    await waitForRoute(page, "#/team", { ready: "details[data-team-builder]" });
    const afterSave = await draftScreen(page);
    check(afterSave.steps.length === 0 && afterSave.name === "", who + ": after saving, a round trip finds an EMPTY builder (the saved draft is not resurrected)", () => JSON.stringify(afterSave));
    // "Clear" empties it too.
    await openBuilder(page);
    await clickWhenStable(page, '[data-team-add="blind-relay"]');
    await page.fill("[data-team-session-name]", "Discard me");
    await clickWhenStable(page, "[data-team-session-clear]");
    await waitForRoute(page, "#/group", { ready: "button.sg-host" });
    await waitForRoute(page, "#/team", { ready: "details[data-team-builder]" });
    const afterClear = await draftScreen(page);
    check(afterClear.steps.length === 0 && afterClear.name === "", who + ": \"Clear\" empties it for good", () => JSON.stringify(afterClear));
  }
});

/* ================================================================== 6 */
/* Same measurements tools/verify-ios-webkit.mjs makes (a control's tap target is
   itself plus its labels; a keyboard-raising field under 16px makes iOS zoom the
   page on focus), taken on the controls this feature added. */
const MEASURE = (scopes) => {
  const out = [];
  const NO_KEYBOARD = new Set(["checkbox", "radio", "range", "color", "file", "submit", "reset", "button", "image", "hidden"]);
  for (const sel of scopes) {
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll("button,a[href],select,input,textarea")) {
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        if (cs.display === "none" || cs.visibility === "hidden" || !r.width || !r.height) continue;
        let { left, top, right, bottom } = r;
        for (const l of (el.labels ? [...el.labels] : [])) { const lr = l.getBoundingClientRect(); if (!lr.width) continue; left = Math.min(left, lr.left); top = Math.min(top, lr.top); right = Math.max(right, lr.right); bottom = Math.max(bottom, lr.bottom); }
        const name = el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/).slice(0, 3).join(".") : "") + " \"" + (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 22) + "\"";
        out.push({ name, w: Math.round(right - left), h: Math.round(bottom - top), font: parseFloat(cs.fontSize), keyboard: el.tagName !== "BUTTON" && el.tagName !== "A" && !(el.tagName === "INPUT" && NO_KEYBOARD.has((el.getAttribute("type") || "text").toLowerCase())) });
      }
    }
  }
  return out;
};
const tooSmall = (list) => list.filter((c) => c.w < 43.5 || c.h < 43.5);
const zoomers = (list) => list.filter((c) => c.keyboard && c.font < 16);

await section("6. the controls this feature added meet the phone rules (44x44 targets, 16px fields)", async () => {
  // A Team Training draft with every control showing (Up/Down/Remove on each row, Save, Clear, Share).
  await H.setViewportSize({ width: 390, height: 844 });
  await waitForRoute(H, "#/team", { ready: "details[data-team-builder]", fresh: true });
  await H.evaluate(async () => { await G.db.setSetting("team:sessions:v1", [{ id: "ts-a", title: "Saved one", steps: ["aar-huddle", "pace-trust"], createdAt: 1 }]); });
  await waitForRoute(H, "#/pt-plan", { ready: '[data-pt-view="week"]' });
  await waitForRoute(H, "#/team", { ready: "[data-team-session-card]", fresh: true });
  await openBuilder(H);
  if (await has(H, "[data-team-session-clear]")) await clickWhenStable(H, "[data-team-session-clear]");
  await openBuilder(H);
  for (const id of ["aar-huddle", "pace-trust", "blind-relay"]) await clickWhenStable(H, '[data-team-add="' + id + '"]');
  const team = await H.evaluate(MEASURE, ["[data-team-session-panel]"]);
  check(team.length >= 20, "measured " + team.length + " controls in the Team sessions panel at 390 wide (saved card, builder rows, Save, Clear, Share)");
  check(zoomers(team).length === 0, "the session-name box and every other field there is 16px or more", () => JSON.stringify(zoomers(team)));
  check(tooSmall(team).length === 0, "every button there is at least 44x44", () => JSON.stringify(tooSmall(team)));
  const nameFont = await H.evaluate(() => parseFloat(getComputedStyle(document.querySelector("[data-team-session-name]")).fontSize));
  check(nameFont >= 16, "the session-name box renders at " + nameFont + "px (iOS zooms the page on focus below 16px)");
  // The share panel on PT Planner and the share status on the host's room screen.
  await waitForRoute(H, "#/pt-plan", { ready: '[data-pt-view="week"]' });
  await clickWhenStable(H, '[data-pt-view="week"]');
  const ptm = await H.evaluate(MEASURE, ["[data-pt-room-share]"]);
  check(ptm.length >= 1 && tooSmall(ptm).length === 0 && zoomers(ptm).length === 0, "PT Planner's \"Share to my room\" panel: " + ptm.map((c) => c.name + " " + c.w + "x" + c.h).join("; "), () => JSON.stringify(ptm));
  await waitForRoute(H, "#/group", { ready: ".sg-shared" });
  const host = await H.evaluate(MEASURE, [".sg-shared", ".sg-share"]);
  check(host.length >= 1 && tooSmall(host).length === 0, "the host's \"Shared with the room\" panel (Send again): " + host.map((c) => c.name + " " + c.w + "x" + c.h).join("; "), () => JSON.stringify(host));
  // The receiving card in each state, on the phone (touch).
  const states = [];
  const MIN = { ready: 2, added: 3, blocked: 1 };
  await waitForRoute(P1, "#/group", { ready: "button.sg-leave" });
  const oid = await resend();
  await readyCard(oid);
  states.push(["ready", await P1.evaluate(MEASURE, [".sg-offer"])]);
  await clickWhenStable(P1, ".sg-offer-add");
  await until(P1, () => !!document.querySelector(".sg-offer-undo"));
  states.push(["added", await P1.evaluate(MEASURE, [".sg-offer"])]);
  await clickWhenStable(P1, ".sg-offer-done-btn");
  await inject({ oid: "TAPS2222", kind: "quiz-pack", ver: 1, data: { x: 1 } });
  await until(P1, () => !!document.querySelector('.sg-offer[data-offer-kind="unsupported"]'));
  states.push(["blocked", await P1.evaluate(MEASURE, [".sg-offer"])]);
  for (const [name, list] of states) {
    check(list.length >= MIN[name] && tooSmall(list).length === 0, "the phone's offer card (" + name + "): " + list.map((c) => c.name + " " + c.w + "x" + c.h).join("; "), () => JSON.stringify(tooSmall(list)));
  }
  await clickWhenStable(P1, ".sg-offer-dismiss");
  // The confirm box's own buttons at phone width.
  await waitForRoute(H, "#/pt-plan", { ready: '[data-pt-view="week"]' });
  await clickWhenStable(H, '[data-pt-view="week"]');
  await clickWhenStable(H, "[data-pt-room-share] .sg-share-btn");
  await until(H, () => !!document.querySelector(".gm-box .gm-dialog-body"));
  await settled(H);
  const modal = await H.evaluate(MEASURE, [".gm-box"]);
  check(modal.length >= 2 && tooSmall(modal).length === 0, "the confirm box's buttons at 390 wide: " + modal.map((c) => c.name + " " + c.w + "x" + c.h).join("; "), () => JSON.stringify(tooSmall(modal)));
  await clickButtonByText(H, "Not now", ".gm-box");
});

expectNoConsoleNoise(noise, { ignore: [/Failed to load resource.*404/i] });
await finish("ROOM HANDOFF SAFETY");
