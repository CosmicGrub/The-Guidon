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
   1b) The stray-Enter promise holds wherever focus has wandered, not only while it sits on Cancel
   ===================================================================== */
console.log("\n-- on a short window the message becomes a Tab stop: an Enter there must not restore either --");
check(!/leader roster/i.test(text1), "a confirm for a device with no roster reminders says nothing about the roster", "confirm text: " + JSON.stringify(text1));
const roomy = page.viewportSize();
// A file whose restore would visibly change this device (rg-A 2 -> 9, and a card the device lacks).
const guardFile = backup(T - 3 * DAY, [card("rg-A", 9, 50, T - 3 * DAY), card("rg-GUARD", 1, 1, T - 3 * DAY)]);
const untouched = async () => { const a = await getKv("srs:rg-A"); return a && a.reps === 2 && (await getKv("srs:rg-GUARD")) === undefined; };
await page.setViewportSize({ width: 360, height: 330 });
await chooseOnProfile(guardFile);
await confirmText();
const bodyIsStop = await until(page, () => { const b = document.querySelector(".gm-box .gm-dialog-body"); return !!b && b.tabIndex === 0 && b.getAttribute("role") === "region"; });
check(bodyIsStop, "fixture: at 360x330 the message overflows and is a keyboard stop (otherwise this proves nothing)", "the message region never became a tab stop");
await focusIsOn("Cancel");
await page.keyboard.press("Shift+Tab");
const onMessage = await page.evaluate(() => document.activeElement === document.querySelector(".gm-box .gm-dialog-body"));
check(onMessage, "Shift+Tab from Cancel lands on the message", "focus is on: " + JSON.stringify(await page.evaluate(() => document.activeElement && (document.activeElement.className || document.activeElement.tagName))));
const reloadedA = page.waitForEvent("load", { timeout: 2000 }).then(() => true, () => false); // hygiene-ok: proving nothing happens takes a fixed window - a restore that wrongly went ahead reloads the page within 1.2 s
await page.keyboard.press("Enter");
check(!(await reloadedA), "Enter on the message does not restore (the page did not reload)", "the page reloaded, so an Enter on the message confirmed the restore");
check(await page.evaluate(() => !!document.querySelector(".gm-box")), "...and the dialog is still waiting for an answer", "the dialog closed");
check(await untouched(), "...and nothing from the file reached the device", "srs:rg-A is now " + JSON.stringify(await getKv("srs:rg-A")) + ", srs:rg-GUARD " + JSON.stringify(await getKv("srs:rg-GUARD")));
await page.locator(".gm-box .gm-dialog-body").click({ position: { x: 20, y: 20 } });
const clickedOnMessage = await page.evaluate(() => document.activeElement === document.querySelector(".gm-box .gm-dialog-body"));
check(clickedOnMessage, "clicking the message also puts focus on it", "focus is on: " + JSON.stringify(await page.evaluate(() => document.activeElement && (document.activeElement.className || document.activeElement.tagName))));
const reloadedB = page.waitForEvent("load", { timeout: 2000 }).then(() => true, () => false); // hygiene-ok: proving nothing happens takes a fixed window - a restore that wrongly went ahead reloads the page within 1.2 s
await page.keyboard.press("Enter");
check(!(await reloadedB), "Enter after clicking the message does not restore either", "the page reloaded, so an Enter after clicking the message confirmed the restore");
check(await untouched() && await page.evaluate(() => !!document.querySelector(".gm-box")), "...the dialog is still open and nothing was restored", "srs:rg-A is now " + JSON.stringify(await getKv("srs:rg-A")));
await page.keyboard.press("Escape");
check(await dialogGone(), "Escape still backs out of it", "the dialog is still open");
await page.setViewportSize(roomy);

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
   4b) A file dated in the FUTURE (a phone whose clock runs ahead)
   ===================================================================== */
console.log("\n-- a file whose date is later than today is not believed --");
for (const [label, ms] of [["400 days ahead", Date.now() + 400 * DAY], ["the year 2999", Date.UTC(2999, 11, 31, 12, 0, 0)]]) {
  await chooseOnProfile(backup(ms, [card("rg-A", 4, 10, T - 5 * DAY)]));
  const t = await confirmText();
  check(/looks wrong/.test(t) && !/\(today\)|\(\d+ days? ago\)|This backup was made on/.test(t), "a file dated " + label + " says its date looks wrong, and does not call it \"today\"", "confirm text: " + JSON.stringify(t));
  check(/This device already has study progress on it, and with a date that can't be trusted there is no telling which is newer\./.test(t) && /choose Cancel, use Export backup, then import again/.test(t), "...and warns as it would for a file with no date, because this device has study progress", "confirm text: " + JSON.stringify(t));
  check(!/You have used GUIDON on this device since then/.test(t), "...never claiming it knows the device was used \"since then\"", "confirm text: " + JSON.stringify(t));
  await page.locator(".gm-box button", { hasText: /^Cancel$/ }).click();
  await dialogGone();
}
await chooseOnProfile(backup(Date.now() + 20000, [card("rg-A", 4, 10, T - 5 * DAY)]));
const textSkew = await confirmText();
check(/\(today\)/.test(textSkew) && !/looks wrong/.test(textSkew), "a file dated a few seconds ahead (two clocks that differ a little) is still just \"today\"", "confirm text: " + JSON.stringify(textSkew));
await page.locator(".gm-box button", { hasText: /^Cancel$/ }).click();
await dialogGone();
const dateUnit = await page.evaluate(() => ({
  future: G.backup.describeBackupDate(new Date(Date.now() + 400 * 86400000).toISOString()),
  far: G.backup.describeBackupDate("2999-12-31T12:00:00.000Z"),
  past: G.backup.describeBackupDate(new Date(Date.now() - 2 * 86400000).toISOString()),
}));
check(dateUnit.future === "" && dateUnit.far === "" && /\(2 days ago\)$/.test(dateUnit.past), "describeBackupDate gives nothing for a date that has not happened yet, and still dates a past one", "describeBackupDate: " + JSON.stringify(dateUnit));

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
await page.locator(".gm-box button", { hasText: /^OK$/ }).click();
const failShown = await until(page, () => /did not finish/.test((document.querySelector(".backup-panel .backup-status") || {}).textContent || ""));
const failMsg = await status();
check(failShown && /The restore did not finish: your settings and progress could not be saved to this device\. Free up some space and try again\./.test(failMsg), "the restore says it did not finish, names what was lost in plain words, and what to do", "status: " + JSON.stringify(failMsg));
check(!/\bkv\b|\bstores?\b|quota|abort|indexeddb/i.test(failMsg), "...with no storage vocabulary (it used to say \"(kv)\")", "status: " + JSON.stringify(failMsg));
// The page used to reload 1.2 s later, which erased this very message. A failed restore stays on screen.
const reloadedOnFail = await page.waitForEvent("load", { timeout: 3500 }).then(() => true, () => false); // hygiene-ok: the message has to still be there well after the 1.2 s the page used to reload at
const stillThere = await status();
check(!reloadedOnFail, "...and the page does NOT reload behind it (it used to, 1.2 s later)", "the page reloaded after a failed restore");
check(/The restore did not finish/.test(stillThere) && !/Reloading/.test(stillThere), "...and the message is still on screen 3.5 s later, with no \"Reloading...\" in it", "status after 3.5 s: " + JSON.stringify(stillThere));
check((await page.locator(".backup-panel .backup-status button", { hasText: /^Reload GUIDON$/ }).count()) === 1, "...with a plain Reload button under it, for the Soldier to press when ready", "no Reload button in the status");
check(/try again. Reload GUIDON$/.test(await status()), "...set apart from the sentence by a space (\"try again. Reload GUIDON\", not \"try again.Reload GUIDON\")", "status: " + JSON.stringify(await status()));
check(await page.evaluate((k) => sessionStorage.getItem(k) === null, "guidon-restore-failed"), "...and nothing is handed to a later page load (a restore that saved nothing has no reload to hand anything to)", "the one-time hand-off was written");

console.log("\n-- the same failure from Settings stays up as well --");
await chooseOnSettings(backup(Date.now(), [card("rg-FULL", 1, 1, Date.now())]));
await confirmText();
await focusIsOn("Cancel");
await page.locator(".gm-box button", { hasText: /^OK$/ }).click();
const settingsNote = "#settings-databackup-panel .backup-status";
const failShownS = await until(page, (sel) => { const n = document.querySelector(sel); return !!n && !n.hidden && /did not finish/.test(n.textContent || ""); }, settingsNote);
check(failShownS, "Settings says the restore did not finish, on the page itself (not only in a toast that fades)", "no failure note in the Data & Backup panel");
const reloadedOnFailS = await page.waitForEvent("load", { timeout: 3500 }).then(() => true, () => false); // hygiene-ok: the note has to still be there well after the 1.2 s the page used to reload at
check(!reloadedOnFailS, "...and the page does not reload behind it", "the page reloaded after a failed restore from Settings");
const settingsText = await page.evaluate((sel) => { const n = document.querySelector(sel); return n && !n.hidden ? n.textContent : ""; }, settingsNote);
check(/The restore did not finish: your settings and progress could not be saved to this device\. Free up some space and try again\./.test(settingsText) && !/Reloading/.test(settingsText), "...in the same plain words, still on screen 3.5 s later", "note: " + JSON.stringify(settingsText));
check(/try again. Reload GUIDON$/.test(settingsText), "...also set apart from the sentence by a space", "note: " + JSON.stringify(settingsText));
const reloadedByButton = page.waitForEvent("load", { timeout: 20000 });
await page.locator(settingsNote + " button", { hasText: /^Reload GUIDON$/ }).click();
await reloadedByButton;
await waitForBoot(page);
check((await getKv("srs:rg-FULL")) === undefined, "...and none of that file's rows reached the device (the Reload button reloads when the Soldier chooses)", "srs:rg-FULL is on the device");

/* =====================================================================
   6b) A restore that saves SOME of the file: the page reloads, the next edit cannot undo what did land
   ===================================================================== */
// When part of a restore fails, the page's in-memory profile and settings are older than the rows the restore
// DID save. Left open (no reload), the next edit - a Profile Rename - wrote that old copy back over them: the
// restored rank, tier and board date quietly went back to what they were. So a PARTIAL failure reloads (and
// says what failed once the page is back); only a restore that saved NOTHING stays put (section 6).
console.log("\n-- a restore that saves only PART of the file reloads, says so after, and the next edit keeps what was saved --");
const PROF = "guidon:profile:v1", NOTICE_KEY = "guidon-restore-failed";
await page.evaluate(async (k) => { const row = await G.db.get("kv", k); row.v.boardDate = "2030-01-01"; await G.db.put("kv", row); }, PROF);
await page.reload();
await waitForBoot(page);
const held = await page.evaluate(async () => { const p = await G.profile.current(); return { rank: p.rank, tier: p.tier, boardDate: p.boardDate }; });
check(held.rank === "SGT" && held.tier === "E5" && held.boardDate === "2030-01-01", "fixture: the page holds the device's own profile (SGT, E5, board date 2030-01-01)", "profile held by the page: " + JSON.stringify(held));
const savedProfile = Object.assign({}, await getKv(PROF), { rank: "SSG", tier: "E6", boardDate: "2031-05-05" });
const partialFile = (attemptId, kvRows) => Object.assign(backup(Date.now(), kvRows), { stores: { kv: kvRows, userScenarios: [], attempts: [{ id: attemptId, scenarioId: "x", ts: Date.now() }] }, summary: { kv: kvRows.length, userScenarios: 0, attempts: 1 } });
// The kv rows land; the attempts write is the one the device refuses (its transaction aborts after the put).
const refuseAttempts = () => page.evaluate(() => {
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...a) {
    const req = realPut.apply(this, a);
    const id = a[0] && a[0].id;
    if (typeof id === "string" && id.indexOf("pf-att") === 0) req.addEventListener("success", () => { try { req.transaction.abort(); } catch (e) { /* already done */ } });
    return req;
  };
});
await refuseAttempts();
await chooseOnProfile(partialFile("pf-att-1", [{ k: PROF, v: savedProfile }]));
await confirmText();
const reloadedPartial = page.waitForEvent("load", { timeout: 15000 }).then(() => true, () => false); // hygiene-ok: the page reloads ~1.2 s after a partial restore; in the broken shape it never does, so a bound is needed
await page.locator(".gm-box button", { hasText: /^OK$/ }).click();
check(await reloadedPartial, "a restore that saved the profile but not the quiz results reloads the page (it has to: the page's copy of the profile is out of date)", "the page did not reload after a partial restore");
await waitForBoot(page);
await waitForRoute(page, "#/profile", { ready: ".backup-panel .backup-actions" });
const noteAfter = await until(page, () => /did not finish/.test((document.querySelector(".backup-panel .backup-status") || {}).textContent || ""));
const noteText = await status();
check(noteAfter && /The restore did not finish: your scenario and quiz results could not be saved to this device\. Free up some space and try again\./.test(noteText), "...and once the page is back, Profile says what failed, in the same plain words", "status: " + JSON.stringify(noteText));
check(!/Reload/.test(noteText) && (await page.locator(".backup-panel .backup-status button").count()) === 0, "...with no Reload button (the page has already reloaded) and no \"Reloading...\"", "status: " + JSON.stringify(noteText));
check(await page.evaluate((k) => sessionStorage.getItem(k) === null, NOTICE_KEY), "...and the one-time hand-off was read and removed (it does not come back on the next load)", "sessionStorage[" + NOTICE_KEY + "] is still set");
const reread = await page.evaluate(async () => { const p = await G.profile.current(); return { rank: p.rank, tier: p.tier, boardDate: p.boardDate }; });
check(reread.rank === "SSG" && reread.tier === "E6" && reread.boardDate === "2031-05-05", "the page now holds the restored profile (SSG, E6, board date 2031-05-05), not the old one", "profile held by the page: " + JSON.stringify(reread));
await page.locator("button", { hasText: "Rename" }).first().click();
await page.locator(".gm-box input").fill("NEWNAME");
await page.locator(".gm-box button", { hasText: /^Save$/ }).click();
await untilAsync(page, async (k) => { const r = await G.db.get("kv", k); return !!r && r.v.lastName === "NEWNAME"; }, PROF);
const afterRename = await getKv(PROF);
check(afterRename && afterRename.lastName === "NEWNAME" && afterRename.rank === "SSG" && afterRename.tier === "E6" && afterRename.boardDate === "2031-05-05", "a Rename afterwards changes only the name: the restored rank, tier and board date are still what was saved", "profile row after Rename: " + JSON.stringify(afterRename && { rank: afterRename.rank, tier: afterRename.tier, boardDate: afterRename.boardDate, lastName: afterRename.lastName }));
check((await getKv("srs:rg-FULL")) === undefined && (await page.evaluate(() => G.db.get("attempts", "pf-att-1"))) === undefined, "...and the quiz result the device refused is not there", "attempts row pf-att-1 exists");
check(/did not finish/.test(await status()), "...and the notice is still on screen after the edit redrew the page", "status: " + JSON.stringify(await status()));
// A new attempt (even one that is cancelled) drops the old note.
await chooseOnProfile(partialFile("pf-att-3", [{ k: PROF, v: afterRename }]));   // a new attempt, from Profile, that is then cancelled
await confirmText();
await page.locator(".gm-box button", { hasText: /^Cancel$/ }).click();
await dialogGone();
check(!/did not finish/.test(await status()), "...and a Profile restore that is cancelled leaves no old failure message behind either", "status: " + JSON.stringify(await status()));

console.log("\n-- the same partial failure from Settings: reload, then the note is on the page --");
await refuseAttempts();
await chooseOnSettings(partialFile("pf-att-2", [{ k: "srs:pf-ok", v: { reps: 1, ease: 2.5, interval: 1, due: Date.now() + DAY, misses: 0 } }]));
await confirmText();
const reloadedPartialS = page.waitForEvent("load", { timeout: 15000 }).then(() => true, () => false); // hygiene-ok: same bounded wait as above
await page.locator(".gm-box button", { hasText: /^OK$/ }).click();
check(await reloadedPartialS, "a partial restore from Settings reloads the page too", "the page did not reload after a partial restore from Settings");
await waitForBoot(page);
await waitForRoute(page, "#/settings", { ready: "#settings-databackup-panel" });
const noteS = await until(page, (sel) => { const n = document.querySelector(sel); return !!n && !n.hidden && /did not finish/.test(n.textContent || ""); }, settingsNote);
const noteSText = await page.evaluate((sel) => { const n = document.querySelector(sel); return n && !n.hidden ? n.textContent : ""; }, settingsNote);
check(noteS && /The restore did not finish: your scenario and quiz results could not be saved to this device\. Free up some space and try again\.$/.test(noteSText), "Settings' Data & Backup says what failed once the page is back, with no Reload button or \"Reloading...\"", "note: " + JSON.stringify(noteSText));
check((await getKv("srs:pf-ok")) && (await getKv("srs:pf-ok")).reps === 1, "...and the part that was saved is on the device", "srs:pf-ok is " + JSON.stringify(await getKv("srs:pf-ok")));
// A new attempt (here: a file that is not a backup) drops the old note.
await chooseOnSettings({ hello: "world" });
const noteGone = await until(page, (sel) => { const n = document.querySelector(sel); return !n || n.hidden || !(n.textContent || "").trim(); }, settingsNote);
check(noteGone, "choosing another file (even one that turns out not to be a backup) clears the old failure note", "the note is still showing");
await page.evaluate(async () => { await G.db.del("kv", "srs:pf-ok"); });

/* =====================================================================
   7) Restoring a normal backup on the device that made it keeps that device's roster reminders
   ===================================================================== */
console.log("\n-- a normal backup does not carry roster reminders, so a restore must not erase this device's --");
const ids = async () => ((await getKv("reminders:v1")) || []).map((r) => r.id).sort();
await page.evaluate(async () => {
  await G.db.put("kv", { k: "guidon:leader:roster:v1", v: [{ rank: "SGT", name: "J.D.X", mos: "" }] });
  await G.db.put("kv", { k: "reminders:v1", v: [
    { id: "own1", kind: "board", label: "My board", date: "2030-01-01", note: "", source: "" },
    { id: "ldr1", kind: "counseling", label: "Counsel SGT J.D.X", date: "2030-01-02", note: "", source: "leader" },
    { id: "ldr2", kind: "acft", label: "Schedule AFT for SGT J.D.X", date: "2030-01-03", note: "" },
  ] });
});
const normal = await page.evaluate(() => G.backup.exportAll());
const inNormal = (normal.stores.kv.find((r) => r.k === "reminders:v1") || {}).v || [];
check(inNormal.length === 1 && inNormal[0].id === "own1", "fixture: a normal backup carries only the Soldier's own reminder", "reminders in the file: " + JSON.stringify(inNormal));
await chooseOnProfile(normal);
const text7 = await confirmText();
check(/The 2 reminders you made from the leader roster on this device stay too, because a normal backup doesn't carry them\./.test(text7), "the confirm says this device's 2 roster reminders stay (one stamped, one an older unstamped one)", "confirm text: " + JSON.stringify(text7));
check(!/\bkv\b|reminders:v1|\bsource\b|\bstamp/i.test(text7), "...in a Soldier's words", "confirm text: " + JSON.stringify(text7));
await andWaitForReload(() => page.locator(".gm-box button", { hasText: /^OK$/ }).click());
check(JSON.stringify(await ids()) === JSON.stringify(["ldr1", "ldr2", "own1"]), "after restoring, the roster reminders are still there next to the Soldier's own (3 reminders, none lost, none doubled)", "reminder ids: " + JSON.stringify(await ids()));
check(((await getKv("guidon:leader:roster:v1")) || []).length === 1, "...and the roster itself is untouched", "roster: " + JSON.stringify(await getKv("guidon:leader:roster:v1")));
// A reminder the FILE holds wins over this device's copy of the same one and is not added twice.
const edited = JSON.parse(JSON.stringify(normal));
edited.stores.kv.find((r) => r.k === "reminders:v1").v.push({ id: "ldr1", kind: "counseling", label: "Counsel SGT J.D.X", date: "2031-05-05", note: "", source: "leader" });
const merged = await page.evaluate(async (file) => { const r = await G.backup.importAll(file); return { failed: r.failedStores, list: (await G.db.get("kv", "reminders:v1")).v }; }, edited);
check(merged.failed.length === 0 && merged.list.filter((r) => r.id === "ldr1").length === 1 && merged.list.find((r) => r.id === "ldr1").date === "2031-05-05" && merged.list.some((r) => r.id === "ldr2") && merged.list.length === 3, "a roster reminder the file itself holds takes the file's version, appears once, and the device's other one is still kept", "reminders after: " + JSON.stringify(merged.list));
// When the file carries the roster too (the "include" backup), the roster and its reminders come from the file together.
const included = await page.evaluate(() => G.backup.exportAll({ includePrivate: true }));
await page.evaluate(async () => { const l = (await G.db.get("kv", "reminders:v1")).v; l.push({ id: "ldr3", kind: "counseling", label: "Counsel SGT J.D.X", date: "2032-01-01", note: "", source: "leader" }); await G.db.put("kv", { k: "reminders:v1", v: l }); });
const viaInclude = await page.evaluate(async (file) => { await G.backup.importAll(file); return (await G.db.get("kv", "reminders:v1")).v.map((r) => r.id).sort(); }, included);
check(!viaInclude.includes("ldr3") && viaInclude.includes("ldr1") && viaInclude.includes("ldr2"), "a backup that includes the roster restores the roster's reminders exactly as the file has them (nothing from this device is mixed in)", "reminder ids: " + JSON.stringify(viaInclude));

expectNoConsoleNoise(noise);
await finish("BACKUP RESTORE GUARD");
