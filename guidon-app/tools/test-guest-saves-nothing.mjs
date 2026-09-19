/**
 * Guest and Kiosk sessions REALLY save nothing.
 *
 * Owner decision, 2026-09-19 (audit decision 15). The welcome screen says
 * "Session-only - no data saved after you close the app", and Profile says
 * "nothing is saved after you close the app". Until this change that was
 * only true of the profile row: every tool still wrote its own data to the
 * device. The rule now lives in ONE place - the storage layer (src/index.html,
 * "Session-only storage" in the db section) - and this suite holds it there.
 *
 * What it proves, through the real screens, as a Guest and again as a Kiosk
 * session, on a device that already carries a real owner's data:
 *
 *  - every tool still WORKS for the length of the session: grade a Board
 *    Drill card, change the PT plan, add a "My unit" text (and delete the
 *    owner's), write Board Simulator notes, record a Team Training exercise,
 *    change the theme;
 *  - the DEVICE is byte-for-byte what it was before the session started -
 *    IndexedDB (every object store) and localStorage are read directly,
 *    underneath the app (tools/device-storage.mjs), never through G.db;
 *  - after a reload the session is gone, the owner's data is what the tools
 *    show, and the device is still untouched;
 *  - setting up a real account from INSIDE a Kiosk session (Profile ->
 *    "Redo my setup") writes the new profile and nothing the session did;
 *  - a session never schedules or cancels a phone notification (the one
 *    place outside the database where something could outlive it);
 *  - the same actions under a real profile DO reach the device - so none of
 *    the above can pass because saving is simply broken.
 *
 * On the old code the "device is unchanged" checks fail: the grade, the
 * plan, the text, the notes, the count, the settings row and the appearance
 * mirror were all written like any other key.
 *
 * The practice text was written for this test. It is nobody's song.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { deviceDump, deviceKvGet, putOnDevice, seedOwnerProfile } from "./device-storage.mjs";
import { waitForRoute } from "./testkit.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));

const OWNER_TEXT = { id: "own-ownertext1", title: "Owner troop motto", lines: ["First line the owner saved", "Second line the owner saved"], addedAt: "2026-09-01T00:00:00.000Z" };
const OWNER_NOTE = "OWNER-NOTE keep rehearsing the reporting statement";
const OWNER_SEARCH = "owner-search-term";

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];
const watch = (page, tag) => {
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(tag + " " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push(tag + " pageerror: " + e.message));
};

const bootDecided = (page) => page.waitForFunction(() => !!(window.G && window.G.db && window.G.store) && !/Loading GUIDON/.test((document.getElementById("route") || {}).textContent || ""), null, { timeout: 15000 });
// The device is "settled" when two dumps a beat apart are identical - boot
// does a little housekeeping of its own (none of it the session's doing).
async function settledDump(page) {
  let last = JSON.stringify(await deviceDump(page));
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(350);
    const now = JSON.stringify(await deviceDump(page));
    if (now === last) return now;
    last = now;
  }
  return last;
}
// waitForRoute (tools/testkit.mjs) tags the outgoing screen before the hash
// changes and waits for #route to hold a DIFFERENT, fully drawn one - a bare
// `waitForSelector(selector)` can match a generic selector (an <input>, a
// heading) still sitting in the PREVIOUS screen's stale DOM for a moment
// after the hash changes, before the new view has replaced it.
const go = (page, hash, selector) => waitForRoute(page, hash, { ready: selector, fresh: true });
// For a moment after the welcome screen closes, the page behind it is still
// switched off for input (inert), and typing into it is silently dropped.
const typable = (page, selector) => page.waitForFunction((sel) => { const n = document.querySelector(sel); return !!n && !n.closest("[inert]"); }, selector, { timeout: 8000 });
const appKv = (page, k) => page.evaluate(async (key) => { const r = await window.G.db.get("kv", key); return r ? r.v : null; }, k);

/** What a real owner left on this device before anyone opened a session. */
async function ownerDataOnDevice(page) {
  const plan = await page.evaluate(() => window.G.ptPlanner && window.G.ptPlanner._planFromTemplate ? window.G.ptPlanner._planFromTemplate("balanced") : null);
  const settings = Object.assign({}, await appKv(page, "settings") || {}, { theme: "parade-rest", userName: "SSG OWNER" });
  await putOnDevice(page, {
    stores: {
      kv: [
        // What "Switch account or mode" leaves behind: the row, emptied.
        { k: "guidon:profile:v1", v: null },
        { k: "settings", v: settings },
        { k: "guidon:recite:own:v1", v: [OWNER_TEXT] },
        { k: "recite:" + OWNER_TEXT.id, v: { chunksLearned: [0] } },
        { k: "recall-ladder:" + OWNER_TEXT.id, v: { level: "medium", streak: 1 } },
        { k: "board:sim:v1", v: { version: 1, reportingDone: true, knowledgeDone: false, judgmentDone: false, mockHistoryCount: null, mockHistoryToken: null, startedAt: 1757000000000, completedAt: 0, opened: {}, aarDraft: { strong: OWNER_NOTE, improve: "", next: "" } } },
        { k: "team:training:v1", v: { "aar-huddle": { count: 2, last: 1757000000000 } } },
        { k: "pt:history:v1", v: [{ date: "2026-09-10", title: "Owner run", effort: "hard" }] },
      ].concat(plan ? [{ k: "prt:plan:v1", v: plan }] : []),
      attempts: [{ id: "owner-attempt-1", scenarioId: "sc-staff-duty", ts: 1757000000000, pct: 80, mode: "course" }],
    },
    local: {
      "guidon-search-recent": JSON.stringify([OWNER_SEARCH]),
      "guidon:appearance:v1": JSON.stringify({ theme: "parade-rest" }),
    },
  });
}

/**
 * Use the tools the way a Soldier would. `tag` makes this session's words
 * unique so they can be searched for on the device afterwards. Returns what
 * was done, for the caller's assertions.
 */
async function useTheTools(page, tag, { deleteOwnerText = false } = {}) {
  const did = { tag, marker: "SESSION-" + tag + "-words", note: "SESSION-" + tag + "-note" };

  // 1) Board Drill: flip a card and grade it "Know It".
  const srsBefore = await page.evaluate(async () => (await window.G.db.all("kv")).filter((r) => String(r.k).indexOf("srs:") === 0).map((r) => r.k));
  await go(page, "#/board", ".qz-wrap");
  await page.waitForTimeout(600);
  // Keyboard, the way a Soldier at a desk does it: Space flips, 1-4 grades
  // (3 = "Know It"). Real key presses, not a scripted button click.
  await page.evaluate(() => document.querySelector(".qz-wrap").focus());
  await page.keyboard.press("Space");
  await page.waitForSelector(".qz-card.flipped", { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.keyboard.press("3");
  await page.waitForTimeout(500);
  const srsAfter = await page.evaluate(async () => (await window.G.db.all("kv")).filter((r) => String(r.k).indexOf("srs:") === 0).map((r) => r.k));
  did.gradedKeys = srsAfter.filter((k) => srsBefore.indexOf(k) === -1);

  // 2) PT Planner: change Monday.
  await go(page, "#/pt-plan", 'select[data-pt-session="mon"]');
  const monBefore = await page.locator('select[data-pt-session="mon"]').inputValue();
  did.monBefore = monBefore;
  did.mon = monBefore === "rest" ? "prep" : "rest";
  await page.locator('select[data-pt-session="mon"]').selectOption(did.mon);
  await page.waitForTimeout(500);

  // 3) Recitation Drill, "My unit": add a text (and, when asked, delete the owner's).
  await go(page, "#/recite", "[data-recite-add]");
  await page.locator("[data-recite-add]").click();
  await page.waitForSelector("#recite-own-title");
  await page.fill("#recite-own-title", "Session motto " + tag);
  await page.fill("#recite-own-text", did.marker + "\nsecond line of the session text");
  await page.locator("button", { hasText: /^Save on this device$/ }).click();
  await page.waitForFunction((t) => Array.from(document.querySelectorAll("[data-recite-own] .list-detail-row")).some((r) => r.textContent === "Session motto " + t), tag, { timeout: 6000 });
  if (deleteOwnerText) {
    await page.locator('[data-recite-own] .list-detail-row[data-recite-id="' + OWNER_TEXT.id + '"]').click();
    await page.waitForSelector("[data-recite-own-delete]");
    await page.locator("[data-recite-own-delete]").click();
    await page.waitForSelector(".gm-box");
    await page.locator(".gm-box button", { hasText: /^Delete$/ }).click();
    await page.waitForFunction((id) => !document.querySelector('[data-recite-own] .list-detail-row[data-recite-id="' + id + '"]'), OWNER_TEXT.id, { timeout: 6000 });
    await page.waitForTimeout(300);
  }

  // 4) Board Simulator: after-action notes.
  await go(page, "#/board-sim", "#board-sim-improve");
  await page.fill("#board-sim-improve", did.note);
  await page.waitForTimeout(400);

  // 5) Team Training: run the AAR Huddle and record it.
  await go(page, "#/team", '[data-team-start="aar-huddle"]');
  const countBefore = await page.evaluate(() => { const n = document.querySelector('[data-team-count="aar-huddle"]'); return n ? Number((n.textContent.match(/\d+/) || [0])[0]) : 0; });
  await page.locator('[data-team-start="aar-huddle"]').click();
  await page.waitForSelector("[data-team-record]");
  await page.locator("[data-team-record]").click();
  await page.waitForFunction((n) => { const c = document.querySelector('[data-team-count="aar-huddle"]'); return !!c && Number((c.textContent.match(/\d+/) || [0])[0]) === n + 1; }, countBefore, { timeout: 6000 });
  did.teamCount = countBefore + 1;

  // 6) Settings: pick another theme (this also feeds the appearance mirror
  //    the app reads before it paints), and leave a recent search behind.
  await go(page, "#/settings", "button[aria-expanded]:has-text('Change theme')");
  await page.locator("button", { hasText: /Change theme/ }).click();
  await page.waitForSelector(".theme-swatch-btn", { state: "visible" });
  did.themeBefore = await page.evaluate(() => window.G.store.settings().theme);
  await page.locator(".theme-swatch-btn:not(.active)").first().click();
  await page.waitForTimeout(600); // the settings save is debounced
  did.theme = await page.evaluate(() => window.G.store.settings().theme);

  await go(page, "#/search", "#route input");
  await page.fill("#route input", "session-search-" + tag);
  await page.locator("#route input").blur();
  await page.waitForTimeout(200);
  return did;
}

/** The tools must show what the session did - after leaving each screen and coming back. */
async function sessionStillShowsItsWork(page, did, who) {
  const graded = did.gradedKeys.length === 1 ? await appKv(page, did.gradedKeys[0]) : null;
  check(graded && graded.lastGrade === 2, who + ": the graded card is remembered for the session (" + did.gradedKeys[0] + ", Know It)", who + ": the grade was not kept for the session: " + JSON.stringify({ keys: did.gradedKeys, graded }));

  await go(page, "#/pt-plan", 'select[data-pt-session="mon"]');
  const mon = await page.locator('select[data-pt-session="mon"]').inputValue();
  check(mon === did.mon && did.mon !== did.monBefore, who + ": PT Planner still shows Monday as changed (" + did.monBefore + " -> " + did.mon + ")", who + ": PT Planner lost the change: shows " + mon + ", expected " + did.mon);

  await go(page, "#/recite", "[data-recite-add]");
  const texts = await page.evaluate(() => Array.from(document.querySelectorAll("[data-recite-own] .list-detail-row")).map((r) => r.textContent));
  check(texts.indexOf("Session motto " + did.tag) !== -1, who + ": the My unit text is still listed", who + ": My unit lost the session text: " + JSON.stringify(texts));

  await go(page, "#/board-sim", "#board-sim-improve");
  const note = await page.inputValue("#board-sim-improve");
  check(note === did.note, who + ": Board Simulator notes are still there after leaving and coming back", who + ": Board Simulator notes lost: " + JSON.stringify(note));

  await go(page, "#/team", '[data-team-start="aar-huddle"]');
  const count = await page.evaluate(() => { const n = document.querySelector('[data-team-count="aar-huddle"]'); return n ? Number((n.textContent.match(/\d+/) || [0])[0]) : 0; });
  check(count === did.teamCount, who + ": Team Training shows the recorded exercise (" + count + ")", who + ": Team Training count is " + count + ", expected " + did.teamCount);

  check(did.theme && did.theme !== did.themeBefore, who + ": the theme changed for the session (" + did.themeBefore + " -> " + did.theme + ")", who + ": the theme did not change: " + JSON.stringify([did.themeBefore, did.theme]));
}

function sessionWordsOn(dumpJson, did) {
  return [did.marker, did.note, "Session motto " + did.tag, "session-search-" + did.tag].filter((w) => dumpJson.indexOf(w) !== -1);
}

/* ======================================================================
 * Guest, then Kiosk: same promises.
 * ==================================================================== */
for (const kind of ["guest", "kiosk"]) {
  const who = kind === "guest" ? "Guest" : "Kiosk";
  console.log("\n-- " + who + " session on a device that already has an owner's data --");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page, who);

  await page.goto(url, { waitUntil: "load" });
  await bootDecided(page);
  await ownerDataOnDevice(page);
  // Open the app the way the next person would find it: the owner's data is
  // on the device, there is no profile, the welcome screen is up.
  await page.reload({ waitUntil: "load" });
  await bootDecided(page);
  await page.waitForSelector("#ob-overlay", { timeout: 8000 });
  const before = await settledDump(page);
  const beforeObj = JSON.parse(before);
  check(before.indexOf(OWNER_NOTE) !== -1 && before.indexOf(OWNER_SEARCH) !== -1 && beforeObj.stores.attempts.length === 1,
    who + ": the owner's data is on the device before the session starts (" + beforeObj.stores.kv.length + " saved items)",
    who + ": seeding the owner's data failed");

  // The welcome screen tells the truth about both before either is chosen.
  const cardSays = await page.evaluate((re) => { const c = Array.from(document.querySelectorAll("#ob-overlay .ob-mode-card")).find((n) => new RegExp(re, "i").test(n.textContent)); return c ? c.textContent : ""; }, kind === "guest" ? "guest session" : "kiosk");
  check(kind === "guest" ? /no data saved after you close the app/i.test(cardSays) : /Nothing is saved/.test(cardSays), who + ": its card on the welcome screen says nothing is saved", who + ": welcome-screen card reads: " + JSON.stringify(cardSays));

  await dismissOnboarding(page, { mode: kind });
  const active = await page.evaluate(() => (window.G.db.session ? { on: window.G.db.session.active(), kind: window.G.db.session.kind() } : { on: false, kind: "(this build has no save-nothing session)" }));
  check(active.on && active.kind === kind, who + ": choosing it on the welcome screen starts a save-nothing session", who + ": the session did not start: " + JSON.stringify(active));

  await go(page, "#/profile", "#route .panel");
  const label = await page.evaluate(() => (document.querySelector("#route .panel .hint") || {}).textContent || "");
  check(/nothing is saved after you close the app/i.test(label), who + ": Profile says so in plain words (\"" + label + "\")", who + ": Profile does not say nothing is saved: " + JSON.stringify(label));

  // The session can still READ what is on the device (unchanged behaviour).
  await go(page, "#/board-sim", "#board-sim-strong");
  check((await page.inputValue("#board-sim-strong")) === OWNER_NOTE, who + ": what the session can see of the device is unchanged (the owner's notes show)", who + ": the owner's notes are not visible to the session");

  const did = await useTheTools(page, kind, { deleteOwnerText: true });
  await sessionStillShowsItsWork(page, did, who);

  // Deleting the owner's text hid it from the session...
  const ownerTextInSession = await appKv(page, "guidon:recite:own:v1");
  check(Array.isArray(ownerTextInSession) && !ownerTextInSession.some((r) => r.id === OWNER_TEXT.id) && (await appKv(page, "recall-ladder:" + OWNER_TEXT.id)) === null,
    who + ": deleting the owner's My unit text removes it (and its progress) for the session",
    who + ": delete inside the session did not take: " + JSON.stringify(ownerTextInSession));

  // ...and the device never heard about any of it.
  const after = JSON.stringify(await deviceDump(page));
  check(after === before, who + ": IndexedDB (every store) and localStorage are byte-for-byte what they were before the session", who + ": the session changed the device. " + describeDiff(before, after));
  check(sessionWordsOn(after, did).length === 0, who + ": none of the session's own words are anywhere on the device", who + ": found on the device: " + JSON.stringify(sessionWordsOn(after, did)));

  // A backup made and restored inside a session must not be a way around it.
  const imported = await page.evaluate(async () => {
    const payload = await window.G.backup.exportAll();
    const res = await window.G.backup.importAll(payload);
    return res.restored.kv;
  });
  const afterImport = JSON.stringify(await deviceDump(page));
  check(imported > 0 && afterImport === before, who + ": restoring a backup inside the session (" + imported + " items) still leaves the device untouched", who + ": a restore inside the session wrote to the device. " + describeDiff(before, afterImport));

  // ...and the real Import button does not pretend: it would otherwise say
  // "Restored", reload, and be gone. It says why not, and where to go.
  const backupFile = path.join(os.tmpdir(), "guidon-guest-import-" + kind + "-" + Date.now() + ".json");
  fs.writeFileSync(backupFile, JSON.stringify(await page.evaluate(() => window.G.backup.exportAll())));
  await go(page, "#/profile", ".backup-panel");
  await page.locator(".backup-panel button", { hasText: /Import backup/ }).click();
  await page.locator('.backup-panel input[type="file"]').setInputFiles(backupFile);
  await page.waitForFunction(() => ((document.querySelector(".backup-status") || {}).textContent || "").length > 0, null, { timeout: 6000 }).catch(() => {});
  const importSays = await page.evaluate(() => ({ status: (document.querySelector(".backup-status") || {}).textContent || "", asked: !!document.querySelector(".gm-box") }));
  check(/nothing is saved in a Guest or Kiosk session/.test(importSays.status) && /Personal Account/.test(importSays.status) && !importSays.asked,
    who + ": the Import backup button explains, in plain words, that nothing can be restored here and what to do instead",
    who + ": Import backup inside the session said: " + JSON.stringify(importSays));
  try { fs.unlinkSync(backupFile); } catch (e) {}

  if (kind === "kiosk") {
    // The Focus-tier picker used to write the Kiosk profile straight to the
    // device (its own db.put, past saveProfile()'s guard) - one more caller
    // that no longer has to remember the rule.
    await go(page, "#/settings", 'select[aria-label^="Focus tier"]');
    await page.locator('select[aria-label^="Focus tier"]').selectOption("E6");
    const cont = page.locator(".gm-box button", { hasText: /^Continue$/ });
    try { await cont.waitFor({ state: "visible", timeout: 1500 }); await cont.click(); await page.locator(".gm-box").waitFor({ state: "detached", timeout: 3000 }); } catch (e) { /* not asked */ }
    await page.waitForTimeout(600);
    const tierNow = await page.evaluate(() => window.G.store.settings().tierFilter);
    const afterTier = JSON.stringify(await deviceDump(page));
    check(tierNow === "E6" && afterTier === before, "Kiosk: changing the Focus tier works for the session and leaves the device untouched (it used to save the Kiosk profile)", "Kiosk: Focus tier change: tier=" + tierNow + ". " + describeDiff(before, afterTier));
  }

  if (kind === "guest") {
    // Close and reopen. (From Home: reopening ON the Profile screen with no
    // profile draws a second copy of the welcome wizard inside that screen,
    // underneath the real one, and the helper would click the hidden copy.)
    await page.evaluate(() => { location.hash = "#/home"; });
    await page.waitForTimeout(150);
    await page.reload({ waitUntil: "load" });
    await bootDecided(page);
    await page.waitForSelector("#ob-overlay", { timeout: 8000 });
    ok("Guest: after a reload the welcome screen is back - the session is over");
    const reloaded = await settledDump(page);
    const r = JSON.parse(reloaded), b = JSON.parse(before);
    const sameRow = (k) => JSON.stringify(r.stores.kv.find((x) => x.k === k)) === JSON.stringify(b.stores.kv.find((x) => x.k === k));
    const ownerKeys = ["guidon:profile:v1", "settings", "guidon:recite:own:v1", "recite:" + OWNER_TEXT.id, "recall-ladder:" + OWNER_TEXT.id, "board:sim:v1", "team:training:v1", "pt:history:v1", "prt:plan:v1"];
    const changed = ownerKeys.filter((k) => !sameRow(k));
    check(changed.length === 0 && JSON.stringify(r.stores.attempts) === JSON.stringify(b.stores.attempts) && r.local["guidon-search-recent"] === b.local["guidon-search-recent"] && r.local["guidon:appearance:v1"] === b.local["guidon:appearance:v1"],
      "Guest: every one of the owner's saved items is byte-for-byte unchanged after the reload",
      "Guest: owner data changed across the reload: " + JSON.stringify(changed));
    check(sessionWordsOn(reloaded, did).length === 0 && !r.stores.kv.some((x) => did.gradedKeys.indexOf(x.k) !== -1),
      "Guest: nothing the session did survived it (no grade, no text, no notes, no search)",
      "Guest: session data survived: " + JSON.stringify(sessionWordsOn(reloaded, did)));

    // A second guest sees the owner's data, not the first guest's.
    await dismissOnboarding(page, { mode: "guest" });
    await go(page, "#/recite", "[data-recite-add]");
    const texts = await page.evaluate(() => Array.from(document.querySelectorAll("[data-recite-own] .list-detail-row")).map((x) => x.textContent));
    check(JSON.stringify(texts) === JSON.stringify([OWNER_TEXT.title]), "Guest: the next session sees the owner's text again and not the last guest's", "Guest: My unit after reload shows " + JSON.stringify(texts));
    const themeNow = await page.evaluate(() => window.G.store.settings().theme);
    check(themeNow === "parade-rest", "Guest: the app opens in the owner's theme, not the last guest's", "Guest: theme after reload is " + themeNow);
  } else {
    // Set up a real account from inside the Kiosk session.
    console.log("\n-- Kiosk -> a real account, without closing the app --");
    await go(page, "#/profile", "#route .panel");
    await page.locator("button", { hasText: /Redo my setup/ }).click();
    await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).click();
    await page.waitForSelector(".ob-rank-btn");
    await page.locator(".ob-rank-btn", { hasText: /^SSG$/ }).click();
    await page.locator("button.ob-next", { hasText: /Next/ }).click();
    await page.waitForTimeout(250);
    await page.locator("button.ob-next", { hasText: /Next/ }).click();
    await page.waitForTimeout(250);
    await page.locator("button", { hasText: /^Next →$/ }).click();
    await page.waitForTimeout(250);
    await page.locator("button", { hasText: /^Next →$/ }).click();
    await page.waitForTimeout(250);
    await page.locator("button", { hasText: /^Skip$/ }).click();
    await page.waitForTimeout(250);
    // The new account starts from a restarted app. A build that carries on
    // in place (the old behaviour) is reported, not crashed on.
    const restarted = await Promise.all([
      page.waitForEvent("load", { timeout: 15000 }).then(() => true, () => false),
      page.locator("button", { hasText: /Save profile & start/ }).click(),
    ]);
    check(restarted[0], "saving the new account restarts the app, so no screen can carry session state across", "the app did not restart after the new account was saved from inside a Kiosk session");
    await bootDecided(page);
    await page.waitForFunction(() => !!(window.G.profile.cached && window.G.profile.cached()), null, { timeout: 8000 });
    const now = await page.evaluate(() => ({ mode: window.G.profile.cached().mode, session: !!(window.G.db.session && window.G.db.session.active()), overlay: !!document.getElementById("ob-overlay"), hash: location.hash }));
    check(now.mode === "personal" && !now.session && !now.overlay, "the app restarts as the new personal account, saving normally, with no welcome screen", "after setup: " + JSON.stringify(now));

    const dumped = await settledDump(page);
    const d = JSON.parse(dumped), b = JSON.parse(before);
    const prof = (d.stores.kv.find((x) => x.k === "guidon:profile:v1") || {}).v;
    check(prof && prof.mode === "personal" && prof.onboardingComplete === true && prof.rank === "SSG", "the new profile really is on the device", "profile row on the device: " + JSON.stringify(prof));
    const sameRow = (k) => JSON.stringify(d.stores.kv.find((x) => x.k === k)) === JSON.stringify(b.stores.kv.find((x) => x.k === k));
    const carried = ["guidon:recite:own:v1", "recall-ladder:" + OWNER_TEXT.id, "board:sim:v1", "team:training:v1", "prt:plan:v1"].filter((k) => !sameRow(k));
    check(carried.length === 0 && sessionWordsOn(dumped, did).length === 0 && !d.stores.kv.some((x) => did.gradedKeys.indexOf(x.k) !== -1),
      "nothing the Kiosk session did rode along into the new account (no grade, plan change, text, notes or count)",
      "session data leaked into the new account: " + JSON.stringify({ carried, words: sessionWordsOn(dumped, did) }));
    const st = (d.stores.kv.find((x) => x.k === "settings") || {}).v || {};
    check(st.theme === "parade-rest" && st.tierFilter === "E6",
      "settings: the session's theme was not carried over, and the new account's own rank filter was saved (E6)",
      "settings row after setup: " + JSON.stringify({ theme: st.theme, tierFilter: st.tierFilter }));
  }
  await ctx.close();
}

/* ======================================================================
 * Control: a real profile DOES save - the checks above cannot pass just
 * because saving is broken.
 * ==================================================================== */
{
  console.log("\n-- a real profile: the same actions are saved --");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page, "Owner");
  await page.goto(url, { waitUntil: "load" });
  await bootDecided(page);
  await seedOwnerProfile(page);
  await page.reload({ waitUntil: "load" });
  await bootDecided(page);
  await page.waitForFunction(() => !!(window.G.profile.cached && window.G.profile.cached()), null, { timeout: 8000 });
  const started = await page.evaluate(() => ({ overlay: !!document.getElementById("ob-overlay"), session: !!(window.G.db.session && window.G.db.session.active()), mode: window.G.profile.cached().mode }));
  check(!started.overlay && !started.session && started.mode === "personal", "a profile that was already on the device opens straight into the app, saving normally", "owner boot: " + JSON.stringify(started));

  const did = await useTheTools(page, "owner");
  await page.waitForTimeout(500);
  const dump = await deviceDump(page);
  const kv = (k) => (dump.stores.kv.find((x) => x.k === k) || {}).v;
  const graded = did.gradedKeys.length === 1 ? kv(did.gradedKeys[0]) : null;
  check(graded && graded.lastGrade === 2, "the grade is on the device (" + did.gradedKeys[0] + ")", "grade not saved: " + JSON.stringify(did.gradedKeys));
  check(kv("prt:plan:v1") && kv("prt:plan:v1").days.mon.id === did.mon, "the PT plan change is on the device", "PT plan on the device: " + JSON.stringify(kv("prt:plan:v1") && kv("prt:plan:v1").days.mon));
  check(JSON.stringify(kv("guidon:recite:own:v1") || []).indexOf(did.marker) !== -1, "the My unit text is on the device", "My unit not saved");
  check(kv("board:sim:v1") && kv("board:sim:v1").aarDraft.improve === did.note, "the Board Simulator notes are on the device", "notes not saved: " + JSON.stringify(kv("board:sim:v1")));
  check(kv("team:training:v1") && kv("team:training:v1")["aar-huddle"].count === did.teamCount, "the Team Training count is on the device", "team count not saved: " + JSON.stringify(kv("team:training:v1")));
  check(kv("settings") && kv("settings").theme === did.theme, "the theme is on the device", "theme not saved: " + JSON.stringify(kv("settings") && kv("settings").theme));
  check(JSON.parse(dump.local["guidon:appearance:v1"] || "{}").theme === did.theme && (dump.local["guidon-search-recent"] || "").indexOf("session-search-owner") !== -1,
    "the small on-device preferences (the look the app opens with, recent searches) are saved too", "localStorage: " + JSON.stringify(dump.local));

  await page.reload({ waitUntil: "load" });
  await bootDecided(page);
  await go(page, "#/board-sim", "#board-sim-improve");
  check((await page.inputValue("#board-sim-improve")) === did.note, "and it is all still there after the app is closed and reopened", "notes lost across a reload under a real profile");
  await ctx.close();
}

/* ======================================================================
 * Phone notifications: the one place outside the database where something
 * could outlive a session. (A stand-in for the phone's notification service,
 * the same one tools/test-notify-status.mjs uses.)
 * ==================================================================== */
{
  console.log("\n-- phone notifications --");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    window.__queue = JSON.parse(sessionStorage.getItem("__test_queue") || "[]");
    const keep = () => sessionStorage.setItem("__test_queue", JSON.stringify(window.__queue));
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { LocalNotifications: {
        checkPermissions: async () => ({ display: "granted" }),
        requestPermissions: async () => ({ display: "granted" }),
        schedule: async (o) => { (o.notifications || []).forEach((n) => { window.__queue = window.__queue.filter((x) => x.id !== n.id); window.__queue.push({ id: n.id, title: n.title }); }); keep(); return {}; },
        cancel: async (o) => { const ids = (o.notifications || []).map((n) => n.id); window.__queue = window.__queue.filter((x) => ids.indexOf(x.id) === -1); keep(); return {}; },
        getPending: async () => ({ notifications: window.__queue }),
      } },
    };
  });
  const page = await ctx.newPage();
  watch(page, "Notify");
  await page.goto(url, { waitUntil: "load" });
  await bootDecided(page);
  const tomorrow = await page.evaluate(() => { const d = new Date(Date.now() + 3 * 86400000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
  // The owner turned reminder notifications on and has one queued.
  const settings = Object.assign({}, await appKv(page, "settings") || {}, { notifyReminders: true });
  await putOnDevice(page, { stores: { kv: [{ k: "settings", v: settings }, { k: "reminders:v1", v: [{ id: "owner-rem-1", label: "Owner board", date: tomorrow, kind: "board", note: "" }] }] } });
  await seedOwnerProfile(page);
  await page.reload({ waitUntil: "load" });
  await bootDecided(page);
  await page.waitForFunction(() => (window.__queue || []).length === 1, null, { timeout: 8000 }).catch(() => {});
  const ownerQueued = await page.evaluate(() => window.__queue.length);
  check(ownerQueued === 1, "under a real profile a reminder is queued with the phone (the stand-in is wired up)", "owner reminder was not queued: " + ownerQueued);

  // The owner switches the device to a guest: profile gone, everything else stays.
  await putOnDevice(page, { stores: { kv: [{ k: "guidon:profile:v1", v: null }] } });
  await page.reload({ waitUntil: "load" });
  await bootDecided(page);
  await dismissOnboarding(page, { mode: "guest" });
  const res = await page.evaluate(async (date) => {
    const scheduled = await window.G.notify.scheduleForReminder({ id: "guest-rem-1", label: "Guest reminder", date, note: "" });
    const cancelled = await window.G.notify.cancelForReminder("owner-rem-1");
    return { scheduled, cancelled, queue: window.__queue.map((x) => x.title) };
  }, tomorrow);
  check(res.scheduled === false && res.cancelled === false && res.queue.length === 1 && /Owner board/.test(res.queue[0]),
    "a Guest session neither queues a notification of its own nor cancels the owner's", "notification queue after the guest session: " + JSON.stringify(res));
  await ctx.close();
}

/* ======================================================================
 * A browser with no database (the single-file build opened where IndexedDB
 * is blocked): the app keeps everything in localStorage instead. The rule
 * has to hold on that path too - it is a different set of functions
 * underneath, swapped in after boot.
 * ==================================================================== */
{
  console.log("\n-- a browser with no database (everything kept in localStorage) --");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { window.indexedDB.open = function () { throw new Error("blocked for this test"); }; });
  const page = await ctx.newPage();
  watch(page, "NoDB");
  const localDump = () => page.evaluate(() => { const o = {}; Object.keys(localStorage).sort().forEach((k) => { o[k] = localStorage.getItem(k); }); return JSON.stringify(o); });
  await page.goto(url, { waitUntil: "load" });
  await bootDecided(page);
  await page.waitForSelector("#ob-overlay", { timeout: 8000 });
  await page.waitForTimeout(800);
  const backend = await page.evaluate(() => window.G.db._backend);
  const before = await localDump();
  await dismissOnboarding(page, { mode: "guest" });
  await go(page, "#/board-sim", "#board-sim-improve");
  await typable(page, "#board-sim-improve");
  await page.fill("#board-sim-improve", "SESSION-nodb-note");
  await page.waitForTimeout(400);
  await go(page, "#/home", "#route");
  await go(page, "#/board-sim", "#board-sim-improve");
  const kept = await page.inputValue("#board-sim-improve");
  const after = await localDump();
  check(backend === "localStorage" && kept === "SESSION-nodb-note" && after === before && after.indexOf("SESSION-nodb-note") === -1,
    "with no database, a Guest's notes still work for the session and localStorage is byte-for-byte unchanged",
    "no-database path: backend=" + backend + ", notes kept=" + JSON.stringify(kept) + ", localStorage unchanged=" + (after === before));
  await ctx.close();
}

/* ======================================================================
 * The "Before you start" notice. Automated browsers never see it (the app
 * skips it for them so it cannot steal clicks in every other suite), so this
 * context tells the app it is an ordinary browser.
 * ==================================================================== */
{
  console.log("\n-- the \"Before you start\" notice --");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }); });
  const page = await ctx.newPage();
  watch(page, "Notice");
  const ACK = "guidon:opsec-ack:v1";
  const answer = async (label) => {
    const btn = page.locator(".gm-box button", { hasText: label });
    await btn.waitFor({ state: "visible", timeout: 8000 });
    await btn.click();
    await page.locator(".gm-box").waitFor({ state: "detached", timeout: 4000 });
  };
  await page.goto(url, { waitUntil: "load" });
  await bootDecided(page);
  await answer(/^Not yet$/);
  await dismissOnboarding(page, { mode: "guest" });
  await page.evaluate(() => window.G.opsecGuard.showDisclaimerOnce());
  await answer(/^I understand$/);
  const inSession = await page.evaluate((k) => ({ device: localStorage.getItem(k), app: window.G.db.local.get(k) }), ACK);
  check(inSession.device === null && inSession.app === "accepted", "a Guest's \"I understand\" counts for the session and is not left on the device for the next person", "notice acknowledgement in a Guest session: " + JSON.stringify(inSession));

  await seedOwnerProfile(page);
  await page.reload({ waitUntil: "load" });
  await bootDecided(page);
  await answer(/^I understand$/);
  const asOwner = await page.evaluate((k) => localStorage.getItem(k), ACK);
  await page.reload({ waitUntil: "load" });
  await bootDecided(page);
  await page.waitForTimeout(900);
  const askedAgain = await page.locator(".gm-box").count();
  check(asOwner === "accepted" && askedAgain === 0, "under a real profile it is remembered, and the notice does not come back", "notice under a real profile: stored=" + asOwner + ", asked again=" + askedAgain);
  await ctx.close();
}

/* The welcome screen's longer Kiosk line must still fit a folded phone. */
{
  const ctx = await browser.newContext({ viewport: { width: 344, height: 800 } });
  const page = await ctx.newPage();
  watch(page, "Narrow");
  await page.goto(url, { waitUntil: "load" });
  await bootDecided(page);
  await page.waitForSelector("#ob-overlay .ob-mode-card", { timeout: 8000 });
  const wide = await page.evaluate(() => {
    const over = document.documentElement.scrollWidth - window.innerWidth;
    const cards = Array.from(document.querySelectorAll("#ob-overlay .ob-mode-card")).map((c) => Math.ceil(c.getBoundingClientRect().right) - window.innerWidth);
    return { over, cardsPast: Math.max.apply(null, cards) };
  });
  check(wide.over <= 0 && wide.cardsPast <= 0, "the welcome screen does not scroll sideways at 344px with the new Kiosk line", "welcome screen at 344px: " + JSON.stringify(wide));
  await ctx.close();
}

function describeDiff(a, b) {
  try {
    const A = JSON.parse(a), B = JSON.parse(b), out = [];
    Object.keys(B.stores).forEach((s) => {
      const ak = {}; (A.stores[s] || []).forEach((r) => { ak[String(r.k != null ? r.k : r.id != null ? r.id : r.key)] = JSON.stringify(r); });
      (B.stores[s] || []).forEach((r) => { const k = String(r.k != null ? r.k : r.id != null ? r.id : r.key); if (ak[k] !== JSON.stringify(r)) out.push(s + ":" + k + (ak[k] ? " changed" : " added")); delete ak[k]; });
      Object.keys(ak).forEach((k) => out.push(s + ":" + k + " removed"));
    });
    Object.keys(Object.assign({}, A.local, B.local)).forEach((k) => { if (A.local[k] !== B.local[k]) out.push("localStorage:" + k); });
    return "Differences: " + out.slice(0, 12).join(", ");
  } catch (e) { return "(could not diff)"; }
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
check(relevantNoise.length === 0, "no console errors or warnings in any session", "console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nGUEST SAVES NOTHING: all passed");
process.exit(fails ? 1 : 0);
