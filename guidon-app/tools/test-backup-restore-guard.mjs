/**
 * Restoring a backup says what it is about to do, before it does it.
 *
 * WHY THIS SUITE EXISTS: "Import backup" puts the file's copy of every item it
 * holds over this device's copy of the same item. On a new phone that is exactly
 * right; on a device that has moved on since the file was made (a second device,
 * or the wrong file picked) it silently turns back mastered cards, reminders and
 * goals - and the old confirm said "Your existing data will be kept", which read
 * as a promise the restore did not make. The confirm now says when the file was
 * made, warns plainly when this device has been used since, states what really
 * happens to an item that is in both places, and opens on Cancel. A file from a
 * NEWER GUIDON is refused in so many words (it used to say "this isn't a GUIDON
 * backup"), and a restore no longer rewrites "last backed up" with the file's
 * date. Delete this file and all of it can regress with nothing to notice.
 *
 * Every restore below goes through the real "Import backup" file input and the
 * real confirm dialog; the page reloads itself after a restore, exactly as it
 * does for a Soldier. Every "it warns" check has a sibling that proves the
 * ordinary restore (a file this device has not moved past) is not nagged and
 * still works.
 */
import { bootApp, check, finish, until, untilAsync, waitForBoot, waitForRoute, PERSONAL_PROFILE, expectNoConsoleNoise } from "./testkit.mjs";

const DAY = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const armyDate = (ms) => { const d = new Date(ms); return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); };

const boot = await bootApp({ profile: { ...PERSONAL_PROFILE } });
const { page, noise } = boot;

/* ---------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------- */
const asFile = (obj) => ({ name: "guidon-backup-test.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(obj)) });
// A flashcard row as board.js schedule() writes it: due = last review + interval days.
const card = (id, reps, interval, lastReviewMs) => ({ k: "srs:" + id, v: { reps, ease: 2.5, interval, due: lastReviewMs + interval * DAY, misses: 0 } });
const reminder = (id, label) => ({ id, kind: "other", label, date: "2030-01-01", note: "" });
const backup = (exportedAtMs, kv, extra = {}) => Object.assign({
  schema: "guidon.backup/v1",
  exportedAt: exportedAtMs == null ? undefined : new Date(exportedAtMs).toISOString(),
  stores: { kv, userScenarios: [], attempts: [] },
  summary: { kv: kv.length, userScenarios: 0, attempts: 0 },
}, extra);

const getKv = (key) => page.evaluate((k) => G.db.get("kv", k).then((r) => (r ? r.v : undefined)), key);
const putKv = (rows) => page.evaluate(async (list) => { for (const r of list) await G.db.put("kv", r); }, rows);

async function chooseOnProfile(file) {
  await waitForRoute(page, "#/profile", { ready: ".backup-panel .backup-actions" });
  await page.locator(".backup-panel input[type=file]").setInputFiles(asFile(file));
}
async function chooseOnSettings(file) {
  await waitForRoute(page, "#/settings", { ready: "#settings-databackup-panel" });
  await page.locator("#settings-databackup-panel input[type=file]").setInputFiles(asFile(file));
}
async function confirmText() {
  await page.locator(".gm-box .gm-dialog-body").waitFor({ state: "visible" });
  return page.evaluate(() => document.querySelector(".gm-box .gm-dialog-body").textContent);
}
const dialogGone = () => until(page, () => !document.querySelector(".gm-box"));
// True once focus has sat on the named dialog button for 15 frames running. A bare "is it on Cancel right
// now" can catch the moment the dialog first lands focus on its first button, before its own 40 ms timer
// moves focus to the default one - 15 frames (~250 ms) outlasts that timer.
const focusIsOn = (label) => page.evaluate((l) => new Promise((resolve) => {
  let steady = 0, total = 0;
  const step = () => {
    const a = document.activeElement;
    steady = (a && a.closest && a.closest(".gm-box") && a.textContent.trim() === l) ? steady + 1 : 0;
    if (steady >= 15) return resolve(true);
    if (++total > 900) return resolve(false);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}), label);
// The page reloads itself ~1.2 s after a restore; resolve once it has and the app is up again.
async function andWaitForReload(action) {
  const reloaded = page.waitForEvent("load", { timeout: 20000 });
  await action();
  await reloaded;
  await waitForBoot(page);
}

/* =====================================================================
   1) A device that has moved on since the file was made
   ===================================================================== */
console.log("\n-- a file older than this device's own work: dated, warned about, and nothing happens on a stray Enter --");
const T = Date.now();
await putKv([card("rg-A", 6, 40, T - 60000), card("rg-B", 3, 7, T - 60000), { k: "reminders:v1", v: [reminder("r1", "Counseling follow-up"), reminder("r2", "Retest")] }]);
const oldFile = backup(T - 3 * DAY, [card("rg-A", 2, 3, T - 3 * DAY), { k: "reminders:v1", v: [reminder("r1", "Counseling follow-up")] }]);

await chooseOnProfile(oldFile);
const text1 = await confirmText();
check(text1.includes("This backup was made on " + armyDate(T - 3 * DAY) + " (3 days ago)."), "the confirm says when the backup was made, in Army date style, and how long ago", "confirm text: " + JSON.stringify(text1));
check(/You have used GUIDON on this device since then, so some of what is here may be newer than this backup\./.test(text1), "...and warns plainly that this device has been used since", "confirm text: " + JSON.stringify(text1));
check(/choose Cancel, use Export backup, then import again/.test(text1), "...and says how to keep a copy of what is here first", "confirm text: " + JSON.stringify(text1));
check(text1.includes("Items that are in both places will be replaced by the backup's version; everything else on this device stays."), "it states what a restore really does to an item that is in both places", "confirm text: " + JSON.stringify(text1));
check(!/existing data will be kept/i.test(text1), "the old \"Your existing data will be kept\" line is gone", "confirm text: " + JSON.stringify(text1));
check(!/\bkv\b|srs:|indexeddb|\bschema\b|storage key/i.test(text1), "the whole confirm is in a Soldier's words (no storage vocabulary)", "confirm text: " + JSON.stringify(text1));
check(await focusIsOn("Cancel"), "the dialog opens with Cancel focused", "focus was on: " + JSON.stringify(await page.evaluate(() => document.activeElement && document.activeElement.textContent)));
await page.keyboard.press("Enter");
check(await dialogGone(), "Enter on the focused Cancel closes the dialog", "the dialog is still open");
const reloadedAnyway = await page.waitForEvent("load", { timeout: 2400 }).then(() => true, () => false); // hygiene-ok: proving nothing happens takes a fixed window - a restore that wrongly went ahead reloads the page within 1.2 s
check(!reloadedAnyway, "...and nothing was restored (the page did not reload)", "the page reloaded, so the stray Enter confirmed the restore");
const stillA = await getKv("srs:rg-A");
check(stillA && stillA.reps === 6, "the device's own card is untouched after Cancel", "srs:rg-A is now " + JSON.stringify(stillA));

console.log("\n-- the same file from Settings reads the same, and a restore does exactly what the confirm said --");
await chooseOnSettings(oldFile);
const text2 = await confirmText();
check(text2 === text1, "Settings' Import backup shows the very same confirm", "Profile: " + JSON.stringify(text1) + " / Settings: " + JSON.stringify(text2));
await focusIsOn("Cancel");
await andWaitForReload(async () => { await page.keyboard.press("Tab"); await page.keyboard.press("Enter"); });
const afterA = await getKv("srs:rg-A"), afterB = await getKv("srs:rg-B"), afterRem = await getKv("reminders:v1");
check(afterA && afterA.reps === 2, "Tab to OK and Enter restores: the item in both places took the backup's version (the card went 6 -> 2)", "srs:rg-A: " + JSON.stringify(afterA));
check(afterB && afterB.reps === 3, "...and the item only this device had stayed exactly as it was", "srs:rg-B: " + JSON.stringify(afterB));
check(Array.isArray(afterRem) && afterRem.length === 1, "...so the confirm's warning was true: the newer second reminder is what was replaced", "reminders: " + JSON.stringify(afterRem));

/* =====================================================================
   2) A device that has NOT moved past the file: no nag, and it still works
   ===================================================================== */
console.log("\n-- a file this device has not moved past: dated, not warned, restores, and \"last backed up\" stays this device's --");
const own = await page.evaluate(async () => {
  await G.db.put("kv", { k: "reminders:v1", v: [{ id: "r1", kind: "other", label: "Counseling follow-up", date: "2030-01-01", note: "" }, { id: "r2", kind: "other", label: "Retest", date: "2030-01-01", note: "" }] });
  await G.db.setSetting("backup:lastExportAt", new Date().toISOString());
  const payload = await G.backup.exportAll();
  const lastRow = payload.stores.kv.find((r) => r.k === "backup:lastExportAt");
  lastRow.v = "2025-01-01T00:00:00.000Z";            // the file carries an old "last backed up" - a restore must not adopt it
  await G.db.put("kv", { k: "reminders:v1", v: [{ id: "r1", kind: "other", label: "Counseling follow-up", date: "2030-01-01", note: "" }] });  // work done AFTER the file was made, that is not a card, result or streak day
  return { payload, deviceLast: (await G.db.get("kv", "backup:lastExportAt")).v, madeAt: payload.exportedAt };
});
await chooseOnProfile(own.payload);
const text3 = await confirmText();
check(text3.includes("This backup was made on " + armyDate(new Date(own.madeAt).getTime()) + " (today)."), "a backup made today says so", "confirm text: " + JSON.stringify(text3));
check(!/You have used GUIDON on this device since then|already has study progress/.test(text3), "...and, because this device has not been used since, it is NOT warned (no false alarm on the ordinary restore)", "confirm text: " + JSON.stringify(text3));
check(text3.includes("Items that are in both places will be replaced by the backup's version"), "...but still states what a restore does", "confirm text: " + JSON.stringify(text3));
await andWaitForReload(() => page.locator(".gm-box button", { hasText: /^OK$/ }).click());
const remBack = await getKv("reminders:v1");
check(Array.isArray(remBack) && remBack.length === 2, "clicking OK restores the file's two reminders (the ordinary restore still works)", "reminders: " + JSON.stringify(remBack));
check((await getKv("backup:lastExportAt")) === own.deviceLast, "restoring an older file leaves this device's own \"last backed up\" alone (it did not become 2025-01-01)", "backup:lastExportAt is now " + JSON.stringify(await getKv("backup:lastExportAt")) + ", device had " + own.deviceLast);

/* =====================================================================
   3) A file this GUIDON cannot read is refused in so many words, with no confirm
   ===================================================================== */
console.log("\n-- a newer GUIDON's backup, and a file that is not a backup --");
const status = () => page.evaluate(() => (document.querySelector(".backup-panel .backup-status") || {}).textContent || "");
await chooseOnProfile({ schema: "guidon.backup/v2", exportedAt: new Date(T).toISOString(), stores: { kv: [card("rg-NEWER", 9, 9, T)], userScenarios: [], attempts: [] } });
check(await until(page, () => /Import failed/.test((document.querySelector(".backup-panel .backup-status") || {}).textContent || "")), "a backup from a newer GUIDON is refused on the spot", "status: " + JSON.stringify(await status()));
const newerMsg = await status();
check(/newer GUIDON than this one/.test(newerMsg) && /Update GUIDON, then import it again/.test(newerMsg) && !/isn't a GUIDON backup/.test(newerMsg), "...saying it is from a NEWER GUIDON and to update (not \"this isn't a GUIDON backup\")", "status: " + JSON.stringify(newerMsg));
check((await page.locator(".gm-box").count()) === 0, "...without first asking \"Import this backup?\"", "a confirm dialog was shown");
check((await getKv("srs:rg-NEWER")) === undefined, "...and nothing from that file was written", "srs:rg-NEWER exists");
await page.evaluate(() => { document.querySelector(".backup-panel .backup-status").textContent = ""; });
await chooseOnProfile({ schema: "guidon.backup/v12", stores: { kv: [] } });
check(await until(page, () => /newer GUIDON than this one/.test((document.querySelector(".backup-panel .backup-status") || {}).textContent || "")), "a two-digit newer version (v12) is also recognised as newer", "status: " + JSON.stringify(await status()));
await page.evaluate(() => { document.querySelector(".backup-panel .backup-status").textContent = ""; });
await chooseOnProfile({ hello: "world" });
check(await until(page, () => /isn't a GUIDON backup/.test((document.querySelector(".backup-panel .backup-status") || {}).textContent || "")), "a JSON file that is not a backup at all still says so", "status: " + JSON.stringify(await status()));
check((await page.locator(".gm-box").count()) === 0, "...also without a confirm dialog", "a confirm dialog was shown");

/* =====================================================================
   4) A file with no date
   ===================================================================== */
console.log("\n-- a file that does not say when it was made --");
await chooseOnProfile(backup(null, [card("rg-A", 4, 10, T - 5 * DAY)]));
const text4 = await confirmText();
check(text4.includes("This backup file doesn't say when it was made."), "the confirm admits the file has no date", "confirm text: " + JSON.stringify(text4));
check(/This device already has study progress on it, and without a date there is no telling which is newer\./.test(text4), "...and, since this device has study progress, warns that the two cannot be told apart", "confirm text: " + JSON.stringify(text4));
await page.locator(".gm-box button", { hasText: /^Cancel$/ }).click();
await dialogGone();

/* =====================================================================
   5) What "used since" means, measured against the data the app really keeps
   ===================================================================== */
console.log("\n-- activity since a date: cards, results and the streak day --");
const unit = await page.evaluate(async (DAY) => {
  const B = Date.now() + 5 * 365 * DAY;      // far ahead of anything the app has written, so only the rows planted here can count
  const day = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const priorStreak = await G.db.get("kv", "streak:v1");
  await G.db.putMany("kv", [
    { k: "srs:u-after", v: { reps: 2, ease: 2.5, interval: 10, due: B + 1000 + 10 * DAY, misses: 0 } },   // last reviewed at B+1000
    { k: "srs:u-miss", v: { reps: 0, ease: 2.2, interval: 0, due: B + 1500, misses: 1 } },                  // a miss: due = now, interval 0 -> reviewed at B+1500
    { k: "srs:u-never", v: { reps: 0, ease: 2.3, interval: 0, due: 0, misses: 0 } },                        // never graded
    { k: "streak:v1", v: { lastActive: day(B + 2 * DAY), count: 3, longestCount: 3 } },
  ]);
  await G.db.put("attempts", { id: "u-att", scenarioId: "x", ts: B + 3000 });
  const at = async (ms) => G.backup.deviceActivitySince(ms);
  const out = {
    atB: await at(B), at1200: await at(B + 1200), at2000: await at(B + 2000), at2500: await at(B + 2500), at3500: await at(B + 3500),
    nullSince: await at(null),
  };
  await G.db.put("kv", { k: "streak:v1", v: { lastActive: day(B), count: 3, longestCount: 3 } });
  out.sameDay = await at(B);
  await G.db.put("kv", { k: "streak:v1", v: { lastActive: day(B - 2 * DAY), count: 3, longestCount: 3 } });
  out.olderDay = await at(B);
  if (priorStreak) await G.db.put("kv", priorStreak); else await G.db.del("kv", "streak:v1");
  await G.db.delMany("kv", ["srs:u-after", "srs:u-miss", "srs:u-never"]);
  await G.db.del("attempts", "u-att");
  return out;
}, DAY);
check(unit.atB.cards === 2 && unit.atB.newer, "a card's last review is read as due minus interval: 2 of the 3 planted cards were reviewed after the cut-off (the never-graded one is not)", "since B: " + JSON.stringify(unit.atB));
check(unit.at1200.cards === 1, "...a card reviewed before the cut-off is not counted (1 of 3 after B+1200)", "since B+1200: " + JSON.stringify(unit.at1200));
check(unit.at2000.cards === 0, "...and none after B+2000", "since B+2000: " + JSON.stringify(unit.at2000));
check(unit.atB.results === 1 && unit.at2500.results === 1 && unit.at3500.results === 0, "a finished scenario or quiz counts by its time (counted at B and B+2500, not at B+3500)", "results: " + JSON.stringify({ atB: unit.atB, at2500: unit.at2500, at3500: unit.at3500 }));
check(unit.atB.streak === true && unit.sameDay.streak === false && unit.olderDay.streak === false, "the streak counts only when its last day is a LATER day than the file (same day and earlier days do not)", "streak: " + JSON.stringify({ later: unit.atB.streak, same: unit.sameDay.streak, older: unit.olderDay.streak }));
check(unit.at3500.newer === true && unit.at3500.streak === true && unit.at3500.cards === 0 && unit.at3500.results === 0, "newer is true when only the streak day is later", "since B+3500: " + JSON.stringify(unit.at3500));
check(unit.nullSince.newer === true, "with no date at all, any study history counts", "since null: " + JSON.stringify(unit.nullSince));

/* =====================================================================
   6) A restore the device refuses: said in a Soldier's words
   ===================================================================== */
console.log("\n-- a restore that cannot be saved says so plainly (and writes nothing) --");
await page.evaluate(() => {
  window.__failWrites = true;
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...a) {
    const req = realPut.apply(this, a);
    const k = a[0] && a[0].k;
    if (window.__failWrites && typeof k === "string" && k.indexOf("srs:rg-FULL") === 0) req.addEventListener("success", () => { try { req.transaction.abort(); } catch (e) { /* already done */ } });
    return req;
  };
});
await chooseOnProfile(backup(Date.now(), [card("rg-FULL", 1, 1, Date.now())]));
await confirmText();
await focusIsOn("Cancel");
const reloadAfterFail = page.waitForEvent("load", { timeout: 20000 });
await page.locator(".gm-box button", { hasText: /^OK$/ }).click();
const failShown = await until(page, () => /did not finish/.test((document.querySelector(".backup-panel .backup-status") || {}).textContent || ""));
const failMsg = await status();
check(failShown && /The restore did not finish: your settings and progress could not be saved to this device\. Free up some space and try again\./.test(failMsg), "the restore says it did not finish, names what was lost in plain words, and what to do", "status: " + JSON.stringify(failMsg));
check(!/\bkv\b|\bstores?\b|quota|abort|indexeddb/i.test(failMsg), "...with no storage vocabulary (it used to say \"(kv)\")", "status: " + JSON.stringify(failMsg));
await reloadAfterFail;
await waitForBoot(page);
check((await getKv("srs:rg-FULL")) === undefined, "...and none of that file's rows reached the device", "srs:rg-FULL is on the device");

expectNoConsoleNoise(noise);
await finish("BACKUP RESTORE GUARD");
