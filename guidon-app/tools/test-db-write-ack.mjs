/**
 * Storage writes settle on COMMIT: a save that never landed is reported, once,
 * in plain words, and the kv read cache cannot go stale behind a write.
 *
 * WHY THIS SUITE EXISTS: G.db.put()/del()/clear() used to say "done" the moment
 * IndexedDB accepted the request - before the transaction committed - and
 * putMany()/delMany() never settled at all when the commit was cancelled. So a
 * full device, or any commit-time failure, took none of the app's ~40 "Couldn't
 * save" paths: a grade, a setting or a whole restore was reported as saved when
 * it was not, and a restore could sit on "Restoring..." forever. Separately the
 * shared kv read cache (behind Backup export and Diagnostics) went stale
 * whenever a read overlapped a write, so a backup could silently omit recent
 * rows. Delete this file and both ship broken with nothing to notice.
 *
 * How a commit-time failure is simulated: a real full disk cannot be induced in
 * headless Chromium, so the page's own IndexedDB is asked to cancel the
 * transaction from inside a put's success handler (tx.abort()) - the same
 * transaction-abort event a quota error at commit produces. The localStorage
 * backend is different: its quota is real and IS reached here, unsimulated.
 *
 * Every "the failure is caught" check below has a sibling that proves the
 * ordinary save still works, still resolves after the commit, and stays quiet.
 */
import { bootApp, ok, bad, check, finish, until, untilAsync, waitForBoot, waitForRoute, PERSONAL_PROFILE, expectNoConsoleNoise } from "./testkit.mjs";

const boot = await bootApp({ profile: { ...PERSONAL_PROFILE } });
const { page, noise } = boot;

/* ---------------------------------------------------------------------
   In-page instruments (re-installed after every reload)
   --------------------------------------------------------------------- */
async function installInstruments(target = page) {
  await target.evaluate(() => {
    if (window.__fault) return;
    const F = window.__fault = {
      abortPrefix: null,      // a put/delete whose key starts with this has its transaction cancelled
      abortClear: null,       // a clear() of this store has its transaction cancelled
      badKey: null,           // a put of exactly this key throws synchronously (a row the store refuses)
      txError: null,          // when set, a cancelled transaction reports this DOMException name as its error (a full device says "QuotaExceededError")
      lastTxCompleted: false, // did the most recent write's transaction actually commit?
    };
    // What a browser reports when the commit fails for lack of space: the aborted transaction's own
    // .error is a QuotaExceededError. tx.abort() alone leaves .error null, so the page-level getter is
    // swapped for one that answers like the real thing for transactions THIS suite cancelled.
    const realTxError = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "error");
    Object.defineProperty(IDBTransaction.prototype, "error", {
      configurable: true,
      get() {
        const real = realTxError.get.call(this);
        if (!real && F.txError && this.__cancelledBySuite) return new DOMException("injected: " + F.txError, F.txError);
        return real;
      },
    });
    const cancelAfterSuccess = (req) => req.addEventListener("success", () => { try { req.transaction.__cancelledBySuite = true; req.transaction.abort(); } catch (e) { /* already finished */ } });
    const trackCommit = (req) => { F.lastTxCompleted = false; req.transaction.addEventListener("complete", () => { F.lastTxCompleted = true; }); };
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...a) {
      const k = a[0] && (a[0].k !== undefined ? a[0].k : a[0].id);   // kv rows are keyed by k, every other store by id
      if (F.badKey && k === F.badKey) throw new DOMException("injected: the store refuses this row", "DataError");
      const req = realPut.apply(this, a);
      trackCommit(req);
      if (F.abortPrefix && typeof k === "string" && k.indexOf(F.abortPrefix) === 0) cancelAfterSuccess(req);
      return req;
    };
    const realDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...a) {
      const req = realDelete.apply(this, a);
      trackCommit(req);
      if (F.abortPrefix && typeof a[0] === "string" && a[0].indexOf(F.abortPrefix) === 0) cancelAfterSuccess(req);
      return req;
    };
    const realClear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function (...a) {
      const req = realClear.apply(this, a);
      trackCommit(req);
      if (F.abortClear && this.name === F.abortClear) cancelAfterSuccess(req);
      return req;
    };
    // "resolved", "rejected:<name>", or "hung" if it has not settled after `ms`.
    window.__settle = (p, ms) => Promise.race([
      Promise.resolve(p).then(() => "resolved", (e) => "rejected:" + ((e && e.name) || "Error")),
      new Promise((r) => setTimeout(() => r("hung"), ms || 2000)),
    ]);
    // Straight from the database on a brand-new connection: what is REALLY on disk.
    window.__raw = (store, key) => new Promise((res, rej) => {
      const o = indexedDB.open("guidon");
      o.onsuccess = () => {
        const d = o.result;
        const r = d.transaction(store).objectStore(store).get(key);
        r.onsuccess = () => { d.close(); res(r.result); };
        r.onerror = () => { d.close(); rej(r.error); };
      };
      o.onerror = () => rej(o.error);
    });
    window.__rawKeys = (store) => new Promise((res, rej) => {
      const o = indexedDB.open("guidon");
      o.onsuccess = () => {
        const d = o.result;
        const r = d.transaction(store).objectStore(store).getAllKeys();
        r.onsuccess = () => { d.close(); res(r.result.slice().sort()); };
        r.onerror = () => { d.close(); rej(r.error); };
      };
      o.onerror = () => rej(o.error);
    });
    // What the Soldier is shown, and what reaches the audit trail.
    window.__toasts = [];
    const realToast = G.util.toast;
    G.util.toast = function (m, ms) { window.__toasts.push(String(m)); return realToast.call(G.util, m, ms); };
    window.__unhandled = 0;
    window.addEventListener("unhandledrejection", () => { window.__unhandled++; });
  });
}
await installInstruments();

const storageNotices = () => page.evaluate(() => window.__toasts.filter((t) => /wasn.t saved|out of space|didn.t save|not saved/i.test(t)));
const storageLogEntries = () => page.evaluate(async () => (await G.selfheal.recent(200)).filter((e) => e.kind === "storage-write-fail"));

// The suite's own bookkeeping: reset instruments between scenarios so one
// scenario's notices can never be mistaken for the next one's.
async function resetScenario({ advanceClockMs = 0 } = {}) {
  await page.evaluate(({ advanceClockMs }) => {
    window.__toasts.length = 0;
    window.__fault.abortPrefix = null; window.__fault.abortClear = null; window.__fault.badKey = null; window.__fault.txError = null;
    // The notice is throttled by wall-clock time; move the clock instead of waiting it out.
    if (advanceClockMs) { window.__skew = (window.__skew || 0) + advanceClockMs; const real = window.__realNow || (window.__realNow = Date.now.bind(Date)); Date.now = () => real() + window.__skew; }
  }, { advanceClockMs });
}

/* =====================================================================
   1) A commit that is cancelled after the request succeeded
   ===================================================================== */
console.log("\n-- a cancelled commit is reported, not called saved --");
await page.evaluate(() => { window.__fault.abortPrefix = "__ack:"; });

const put1 = await page.evaluate(async () => ({ outcome: await window.__settle(G.db.put("kv", { k: "__ack:put1", v: 1 })), onDisk: await window.__raw("kv", "__ack:put1") }));
check(put1.outcome.startsWith("rejected"), "put(): a save whose commit was cancelled is reported as failed (" + put1.outcome + ")", "put() said: " + put1.outcome + " - the app would call this saved");
check(put1.onDisk === undefined, "the cancelled row really is not on the device", "row on disk: " + JSON.stringify(put1.onDisk));

const noticed = await until(page, () => window.__toasts.some((t) => /wasn.t saved|out of space/i.test(t)));
const shown = await storageNotices();
check(noticed && shown.length === 1, "the Soldier is told once, on screen, that the change did not save", "notices shown: " + JSON.stringify(shown));
check(shown.length === 1 && !/quota|abort|indexeddb|transaction|exception|error/i.test(shown[0]) && /space|storage|device/i.test(shown[0]),
  "the notice is plain words about the device (no storage vocabulary): \"" + (shown[0] || "") + "\"", "notice text: " + JSON.stringify(shown));
const logged = await untilAsync(page, async () => (await G.selfheal.recent(200)).some((e) => e.kind === "storage-write-fail"));
const entries = await storageLogEntries();
check(logged && entries.length === 1 && entries[0].key === "__ack:put1", "the self-heal trail (Diagnostics) keeps a matching entry that names the row that did not save", "self-heal entries: " + JSON.stringify(entries));
check(entries.length === 1 && /was not saved/.test(entries[0].detail || "") && !/QuotaExceeded|AbortError|DOMException|\bkv\b|store:/.test(entries[0].detail || ""),
  "the trail entry is worded for a person, not a stack trace or a storage key: \"" + ((entries[0] || {}).detail || "") + "\"", "trail detail: " + JSON.stringify(entries[0]));
check(entries.length === 1 && /cancelled/.test(entries[0].detail || ""), "...and says why in words (the save was cancelled)", "trail detail: " + JSON.stringify(entries[0]));
check(shown.length === 1 && !/out of space/.test(shown[0]), "a cancelled save with no stated reason does not claim to know the device is full (\"" + (shown[0] || "") + "\")", "notice text: " + JSON.stringify(shown));

// A burst of failures must not machine-gun the Soldier: one notice on screen - but the trail keeps EVERY lost save.
const burst = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 5; i++) out.push(await window.__settle(G.db.put("kv", { k: "__ack:burst" + i, v: i })));
  return out;
});
check(burst.every((o) => o.startsWith("rejected")), "five more cancelled saves in a row all report failure", "burst: " + JSON.stringify(burst));
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const entriesAfterBurst = await untilAsync(page, async () => (await G.selfheal.recent(200)).filter((e) => e.kind === "storage-write-fail").length >= 6)
  .then(() => storageLogEntries());
const afterBurst = await storageNotices();
check(afterBurst.length === 1, "...but the on-screen notice stays at one (throttled)", "notices=" + afterBurst.length);
const burstKeys = entriesAfterBurst.map((e) => e.key);
check(entriesAfterBurst.length === 6 && [0, 1, 2, 3, 4].every((i) => burstKeys.includes("__ack:burst" + i)), "...while the Diagnostics trail names every one of the six lost saves, not only the first", "trail keys: " + JSON.stringify(burstKeys));

// Past the throttle window a fresh failure speaks up again.
await resetScenario({ advanceClockMs: 10 * 60 * 1000 });
await page.evaluate(() => { window.__fault.abortPrefix = "__ack:"; });
await page.evaluate(() => window.__settle(G.db.put("kv", { k: "__ack:later", v: 1 })));
const again = await until(page, () => window.__toasts.some((t) => /wasn.t saved|out of space/i.test(t)));
check(again, "after the throttle window a new failure is announced again (the warning is not one-shot forever)", "no second notice after the window");

// A commit the browser cancelled because the device is full says so (the aborted transaction's own
// error is a QuotaExceededError): the Soldier is told THAT, in plain words, and so is the trail.
await resetScenario({ advanceClockMs: 10 * 60 * 1000 });
await page.evaluate(() => { window.__fault.abortPrefix = "__ack:"; window.__fault.txError = "QuotaExceededError"; });
const fullPut = await page.evaluate(async () => await window.__settle(G.db.put("kv", { k: "__ack:full1", v: 1 })));
check(fullPut === "rejected:QuotaExceededError", "put(): a commit refused for lack of space rejects with the device's own reason (" + fullPut + ")", "put() said: " + fullPut);
const fullNoticed = await until(page, () => window.__toasts.some((t) => /out of space/i.test(t)));
const fullShown = await storageNotices();
check(fullNoticed && fullShown.length === 1 && /because this device is out of space/.test(fullShown[0]) && !/quota|indexeddb|transaction|exception|error/i.test(fullShown[0]),
  "...and the Soldier is told, in plain words, that the device is out of space: \"" + (fullShown[0] || "") + "\"", "notices: " + JSON.stringify(fullShown));
const fullLogged = await untilAsync(page, async () => (await G.selfheal.recent(200)).some((e) => e.kind === "storage-write-fail" && e.key === "__ack:full1"));
const fullEntry = (await storageLogEntries()).find((e) => e.key === "__ack:full1");
check(fullLogged && fullEntry && /out of space/.test(fullEntry.detail) && !/QuotaExceeded|DOMException|\bkv\b/.test(fullEntry.detail),
  "...and the trail says the device ran out of space, without the browser's error name: \"" + ((fullEntry || {}).detail || "") + "\"", "trail entry: " + JSON.stringify(fullEntry));
await page.evaluate(() => { window.__fault.txError = null; });

/* ---------- a flood of failed writes cannot push other records out of the trail ---------- */
// The trail logs every failed write, and a device that refuses writes refuses hundreds at once. With a cap of 200 that
// used to evict everything before it - a restore record, a repair record - leaving nothing but "a change was not saved".
console.log("\n-- a burst of failed saves folds into one entry per item, and gives way before restore and repair records --");
await resetScenario({ advanceClockMs: 10 * 60 * 1000 });
await page.evaluate(async () => {
  await G.db.del("kv", "guidon:selfheal:v1");
  await G.selfheal.log("backup-import", null, "restored 12 kv/0 scenarios/0 attempts, skipped 0 kv row(s)");
  await G.selfheal.log("profile-backfill", "guidon:profile:v1", "a profile row from an older version was filled in");
  window.__fault.abortPrefix = "__ack:";
});
const sameKey = await page.evaluate(async () => (await Promise.all(Array.from({ length: 40 }, () => window.__settle(G.db.put("kv", { k: "__ack:same", v: 1 }), 15000)))).every((o) => o.startsWith("rejected")));
check(sameKey, "fixture: forty cancelled saves of the same item all report failure", "not every save reported failure");
const folded = await untilAsync(page, async () => ((await G.selfheal.recent(200)).find((e) => e.key === "__ack:same") || {}).count === 40)
  .then(async (okNow) => ({ okNow, entries: (await storageLogEntries()).filter((e) => e.key === "__ack:same") }));
check(folded.okNow && folded.entries.length === 1 && folded.entries[0].count === 40 && /40 times in a row/.test(folded.entries[0].detail),
  "forty failed saves of ONE item are one trail entry with the count (not forty entries): \"" + ((folded.entries[0] || {}).detail || "") + "\"", "entries for that item: " + JSON.stringify(folded.entries));
const flood = await page.evaluate(async () => (await Promise.all(Array.from({ length: 300 }, (_, i) => window.__settle(G.db.put("kv", { k: "__ack:flood" + i, v: i }), 15000)))).filter((o) => o.startsWith("rejected")).length);
check(flood === 300, "fixture: three hundred cancelled saves of different items in a burst all report failure", "only " + flood + " of 300 reported failure");
const last = await untilAsync(page, async () => (await G.selfheal.recent(200)).some((e) => e.key === "__ack:flood299"));
const trail = await page.evaluate(async () => (await G.selfheal.recent(1000)).map((e) => ({ kind: e.kind, key: e.key })));
check(last && trail.length <= 200, "the trail still holds no more than its 200 entries after the burst", "entries: " + trail.length + ", newest burst entry present: " + last);
check(trail.some((e) => e.kind === "backup-import") && trail.some((e) => e.kind === "profile-backfill" && e.key === "guidon:profile:v1"),
  "...and the restore record and the repair record from before the burst are both still there", "kinds in the trail: " + JSON.stringify([...new Set(trail.map((e) => e.kind))]));
check(trail.filter((e) => e.kind === "storage-write-fail").length === trail.length - 2, "...everything else in the trail is the burst's own entries (the two older records, nothing evicted but failed-save entries)", "kinds: " + JSON.stringify([...new Set(trail.map((e) => e.kind))]));
// The edge a burst cannot reach: the trail is already FULL of other records, and the newest entry is itself a failed save.
// It used to be the first thing dropped - the very record the trail exists to keep - because the trim took "the oldest failed
// save" and that was the one just written. Now the oldest OTHER record makes room, and a later failed save pushes out the
// older failed save before it touches any restore or repair record.
console.log("\n-- a failed save is kept when the trail is already full of other records --");
const fullTrail = await page.evaluate(async () => {
  await G.db.del("kv", "guidon:selfheal:v1");
  const seed = Array.from({ length: 200 }, (_, i) => ({ at: new Date(Date.now() - (200 - i) * 1000).toISOString(), kind: i < 3 ? "backup-import" : "kv-reject", key: "k" + i, detail: "seeded record " + i }));
  await G.db.put("kv", { k: "guidon:selfheal:v1", v: seed });
  await G.selfheal.log("storage-write-fail", "__ack:full-1", "A change to your saved settings and progress was not saved");
  const afterOne = (await G.selfheal.recent(1000)).map((e) => ({ kind: e.kind, key: e.key }));
  await G.selfheal.log("storage-write-fail", "__ack:full-2", "A change to your saved settings and progress was not saved");
  const afterTwo = (await G.selfheal.recent(1000)).map((e) => ({ kind: e.kind, key: e.key }));
  return { afterOne, afterTwo };
});
check(fullTrail.afterOne.length === 200 && fullTrail.afterOne.some((e) => e.kind === "storage-write-fail" && e.key === "__ack:full-1"),
  "a failed save written into a trail of 200 other records is kept (it used to be dropped on the spot)", "trail of " + fullTrail.afterOne.length + ", failed save present: " + fullTrail.afterOne.some((e) => e.key === "__ack:full-1"));
check(!fullTrail.afterOne.some((e) => e.key === "k0") && fullTrail.afterOne.some((e) => e.key === "k1") && fullTrail.afterOne.some((e) => e.key === "k199"),
  "...and it is the OLDEST other record that made room, still at the cap of 200", "k0 present: " + fullTrail.afterOne.some((e) => e.key === "k0"));
const wf = fullTrail.afterTwo.filter((e) => e.kind === "storage-write-fail");
check(fullTrail.afterTwo.length === 200 && wf.length === 1 && wf[0].key === "__ack:full-2" && fullTrail.afterTwo.filter((e) => e.kind === "backup-import").length === 2,
  "a second failed save pushes out the first failed save, before any restore or repair record", "failed saves in the trail: " + JSON.stringify(wf) + ", restore records: " + fullTrail.afterTwo.filter((e) => e.kind === "backup-import").length);
// (a full trail would push out the failed-save entries the later sections look for, so leave it empty)
await page.evaluate(async () => { await G.db.del("kv", "guidon:selfheal:v1"); });
await page.evaluate(() => { window.__fault.abortPrefix = null; });
await resetScenario();

/* ---------- the other write paths ---------- */
console.log("\n-- del / putMany / delMany / clear settle too --");
await resetScenario({ advanceClockMs: 10 * 60 * 1000 });
await page.evaluate(() => { window.__fault.abortPrefix = "__ack:"; window.__fault.abortClear = "userScenarios"; });
const paths = await page.evaluate(async () => ({
  del: await window.__settle(G.db.del("kv", "__ack:del1")),
  putMany: await window.__settle(G.db.putMany("kv", [{ k: "__ack:m1", v: 1 }, { k: "__ack:m2", v: 2 }])),
  delMany: await window.__settle(G.db.delMany("kv", ["__ack:m1", "__ack:m2"])),
  clear: await window.__settle(G.db.clear("userScenarios")),
}));
check(paths.del.startsWith("rejected"), "del(): a cancelled delete is reported (" + paths.del + ")", "del() said: " + paths.del);
check(paths.putMany.startsWith("rejected"), "putMany(): a cancelled batch reports failure instead of never settling (" + paths.putMany + ")", "putMany() said: " + paths.putMany);
check(paths.delMany.startsWith("rejected"), "delMany(): a cancelled batch delete reports failure instead of never settling (" + paths.delMany + ")", "delMany() said: " + paths.delMany);
check(paths.clear.startsWith("rejected"), "clear(): a cancelled clear is reported (" + paths.clear + ")", "clear() said: " + paths.clear);

/* ---------- a restore over a failing device ---------- */
console.log("\n-- a restore that cannot be committed says so (and finishes) --");
await resetScenario({ advanceClockMs: 10 * 60 * 1000 });
await page.evaluate(() => { window.__fault.abortPrefix = "__ack:"; });
const restoreFail = await page.evaluate(async () => {
  const file = { schema: "guidon.backup/v1", exportedAt: new Date().toISOString(), stores: { kv: [{ k: "__ack:r1", v: { n: 1 } }, { k: "__ack:r2", v: { n: 2 } }, { k: "__ack:r3", v: { n: 3 } }], userScenarios: [], attempts: [] } };
  let res = null;
  const outcome = await window.__settle(G.backup.importAll(file).then((r) => { res = r; }), 4000);
  return { outcome, restored: res && res.restored, failedStores: res && res.failedStores, onDisk: await window.__raw("kv", "__ack:r1") };
});
check(restoreFail.outcome === "resolved", "importAll() finishes when the device refuses the write (it used to hang on \"Restoring...\" forever): " + restoreFail.outcome, "importAll() outcome: " + restoreFail.outcome);
check(restoreFail.failedStores && restoreFail.failedStores.indexOf("kv") !== -1 && restoreFail.restored && restoreFail.restored.kv === 0,
  "...and reports the kv store as failed, with 0 rows restored, rather than a clean 3", "restore result: " + JSON.stringify({ restored: restoreFail.restored, failedStores: restoreFail.failedStores }));
check(restoreFail.onDisk === undefined, "none of the refused rows is on the device", "on disk: " + JSON.stringify(restoreFail.onDisk));

// One row the store refuses outright must not take the batch down - and must be counted.
await resetScenario();
await page.evaluate(() => { window.__fault.badKey = "__ack:refused"; });
const partial = await page.evaluate(async () => {
  const file = { schema: "guidon.backup/v1", exportedAt: new Date().toISOString(), stores: { kv: [{ k: "__ack:p1", v: 1 }, { k: "__ack:refused", v: 2 }, { k: "__ack:p3", v: 3 }], userScenarios: [], attempts: [] } };
  const res = await G.backup.importAll(file);
  return { res, p1: await window.__raw("kv", "__ack:p1"), p3: await window.__raw("kv", "__ack:p3"), refused: await window.__raw("kv", "__ack:refused") };
});
check(partial.p1 && partial.p3 && partial.refused === undefined, "one refused row does not stop its neighbours from being restored", "rows on disk: " + JSON.stringify({ p1: partial.p1, p3: partial.p3, refused: partial.refused }));
check(partial.res.restored.kv === 2 && partial.res.failedStores.indexOf("kv") !== -1,
  "...and the restore admits it wrote 2 of 3 (kv listed as failed) instead of claiming all 3", "restore result: " + JSON.stringify(partial.res));
await page.evaluate(() => { window.__fault.badKey = null; });

/* =====================================================================
   2) The ordinary path: still fast in spirit, resolves AFTER commit, quiet
   ===================================================================== */
console.log("\n-- the ordinary save is unchanged: committed, resolved, quiet --");
// The notice is throttled, so a wrongful announcement right after the last scenario's real one would be
// swallowed and these "stays quiet" checks could pass for the wrong reason: open the throttle first.
await resetScenario({ advanceClockMs: 10 * 60 * 1000 });
const beforeEntries = (await storageLogEntries()).length;
const happy = await page.evaluate(async () => {
  const F = window.__fault;
  F.lastTxCompleted = false;
  await G.db.put("kv", { k: "__ack:happy1", v: "ok" });
  const committedWhenResolved = F.lastTxCompleted;
  F.lastTxCompleted = false;
  await G.db.del("kv", "__ack:nothing-here");
  const delCommitted = F.lastTxCompleted;
  const many = await G.db.putMany("kv", [{ k: "__ack:h2", v: 2 }, { k: "__ack:h3", v: 3 }, { k: "__ack:h4", v: 4 }]);
  const manyOnDisk = [await window.__raw("kv", "__ack:h2"), await window.__raw("kv", "__ack:h3"), await window.__raw("kv", "__ack:h4")];
  const del = await G.db.delMany("kv", ["__ack:h2", "__ack:h3"]);
  const afterDel = [await window.__raw("kv", "__ack:h2"), await window.__raw("kv", "__ack:h3"), await window.__raw("kv", "__ack:h4")];
  const empty = await G.db.putMany("kv", []);
  return { committedWhenResolved, delCommitted, many, manyOnDisk, del, afterDel, empty, read: await G.db.get("kv", "__ack:happy1") };
});
check(happy.committedWhenResolved, "put() resolves only AFTER the transaction has committed", "put() resolved while its transaction was still open");
check(happy.delCommitted, "del() resolves only after the commit too", "del() resolved before commit");
check(happy.read && happy.read.v === "ok", "the saved row reads back", "read back: " + JSON.stringify(happy.read));
check(happy.many && happy.many.written === 3 && happy.many.skipped === 0 && happy.manyOnDisk.every(Boolean), "putMany(): 3 rows in, {written: 3, skipped: 0} out, all on the device", "putMany: " + JSON.stringify({ many: happy.many, onDisk: happy.manyOnDisk }));
check(happy.afterDel[0] === undefined && happy.afterDel[1] === undefined && !!happy.afterDel[2], "delMany() removes exactly the rows named", "after delMany: " + JSON.stringify(happy.afterDel));
check(happy.empty === undefined || (happy.empty && happy.empty.written === 0), "an empty batch is a harmless no-op", "empty batch result: " + JSON.stringify(happy.empty));

// A row the store refuses is skipped and counted - a batch never fails wholesale for it, and it is not "the device is full".
await page.evaluate(() => { window.__fault.badKey = "__ack:refused"; });
const tolerant = await page.evaluate(async () => {
  const r = await G.db.putMany("kv", [{ k: "__ack:t1", v: 1 }, { k: "__ack:refused", v: 2 }, { k: "__ack:t3", v: 3 }]);
  return { r, t1: await window.__raw("kv", "__ack:t1"), t3: await window.__raw("kv", "__ack:t3") };
});
check(tolerant.r && tolerant.r.written === 2 && tolerant.r.skipped === 1 && tolerant.t1 && tolerant.t3, "putMany() still tolerates one bad row and now says so: {written: 2, skipped: 1}", "result: " + JSON.stringify(tolerant));
// ...and a single row the store refuses before it is even sent still rejects, as it always did - the caller
// decides what to say about its own bad row; it is not mistaken for a full device (checked just below).
const refusedPut = await page.evaluate(async () => await window.__settle(G.db.put("kv", { k: "__ack:refused", v: 1 })));
check(refusedPut === "rejected:DataError", "put() of a row the store refuses outright still rejects with its own reason (" + refusedPut + ")", "put() said: " + refusedPut);
await page.evaluate(() => { window.__fault.badKey = null; });

const quietNotices = await storageNotices();
const afterEntries = (await storageLogEntries()).length;
check(quietNotices.length === 0 && afterEntries === beforeEntries, "none of the ordinary saves showed a notice or wrote a self-heal entry", "notices=" + JSON.stringify(quietNotices) + " entries " + beforeEntries + " -> " + afterEntries);

// A save nobody awaited (the settings save is one) must still be caught, and must not crash anything.
await resetScenario({ advanceClockMs: 10 * 60 * 1000 });
await page.evaluate(() => { window.__fault.abortPrefix = "__ack:"; window.__unhandled = 0; G.db.put("kv", { k: "__ack:forgotten", v: 1 }); });
const forgottenSeen = await until(page, () => window.__toasts.some((t) => /wasn.t saved|out of space/i.test(t)));
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const unhandled = await page.evaluate(() => window.__unhandled);
check(forgottenSeen, "a save nobody waited on (fire-and-forget, like the settings save) still triggers the one notice", "no notice for an un-awaited failed save");
check(unhandled === 0, "...without raising an unhandled error", "unhandledrejection events: " + unhandled);
await page.evaluate(() => { window.__fault.abortPrefix = null; });

/* ---------- the commonest save: grading a Board Drill card ---------- */
console.log("\n-- a card grade that cannot be saved: the cause stays on screen, then the caller's own words --");
await waitForRoute(page, "#/board", { fresh: true, ready: ".qz-card" });
await installInstruments();
await resetScenario({ advanceClockMs: 10 * 60 * 1000 });
await page.evaluate(() => { window.__fault.abortPrefix = "srs:"; window.__fault.txError = "QuotaExceededError"; });
const gradeOnce = async () => {
  await page.evaluate(() => { const w = document.querySelector(".qz-wrap"); if (w) w.focus(); });
  await page.keyboard.press("Space");
  await until(page, () => !!document.querySelector(".qz-card.flipped"));
  await page.evaluate(() => document.querySelector(".qz-grade-btn.qz-grade-2").click());
};
await gradeOnce();
const causeUp = await until(page, () => window.__toasts.some((t) => /out of space/i.test(t)));
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const gradeToast = await page.evaluate(() => ({ visible: (document.getElementById("toast") || {}).textContent || "", callerSaid: window.__toasts.filter((t) => /couldn.t save that grade/i.test(t)).length }));
check(causeUp && /because this device is out of space/.test(gradeToast.visible), "a grade the device refuses leaves the \"out of space\" notice on screen: \"" + gradeToast.visible + "\"", "toast on screen: " + JSON.stringify(gradeToast));
check(gradeToast.callerSaid === 0, "...and the drill's own \"Couldn't save that grade\" does not replace it (the cause is the useful part)", "the caller's toast replaced the notice: " + JSON.stringify(gradeToast));
// Seconds later the storage notice is throttled, so now the drill speaks for itself instead of staying silent.
await resetScenario({ advanceClockMs: 4000 });
await page.evaluate(() => { window.__fault.abortPrefix = "srs:"; window.__fault.txError = "QuotaExceededError"; });
await gradeOnce();
const callerSpoke = await until(page, () => window.__toasts.some((t) => /couldn.t save that grade/i.test(t)));
check(callerSpoke && !(await storageNotices()).length, "a few seconds later, with the storage notice throttled, the drill's own \"Couldn't save that grade\" is shown (a failed grade is never silent)", "toasts: " + JSON.stringify(await page.evaluate(() => window.__toasts)));
const gradeTrail = (await storageLogEntries()).filter((e) => typeof e.key === "string" && e.key.indexOf("srs:") === 0);
check(gradeTrail.length >= 2, "...and the Diagnostics trail names both lost grades (" + gradeTrail.length + " entries for srs: rows)", "trail: " + JSON.stringify(gradeTrail.map((e) => e.key)));
await page.evaluate(() => { window.__fault.abortPrefix = null; window.__fault.txError = null; });

/* =====================================================================
   3) The kv read cache cannot go stale behind an overlapping write
   ===================================================================== */
console.log("\n-- the kv read cache stays true --");
const race = await page.evaluate(async () => {
  const N = 40;
  let stale = 0;
  for (let i = 0; i < N; i++) {
    const key = "__race:" + i;
    G.db._invalidateKvCache();                       // a cold cache, as on every first read after boot
    const read = G.db.all("kv");                      // read in flight...
    const write = G.db.put("kv", { k: key, v: i });   // ...and a write overlapping it
    await Promise.all([read, write]);
    const view = await G.db.all("kv");                // what the app now believes is on the device
    if (!view.some((r) => r.k === key)) stale++;
  }
  const raw = await window.__rawKeys("kv");
  const rawHas = raw.filter((k) => k.indexOf("__race:") === 0).length;
  return { N, stale, rawHas };
});
check(race.rawHas === race.N && race.stale === 0, "0 of " + race.N + " cold-cache read-then-write rounds left the app's view of kv stale", race.stale + " of " + race.N + " rounds left the cached view missing the row the device holds");

const exportRace = await page.evaluate(async () => {
  G.db._invalidateKvCache();
  const read = G.db.all("kv");
  const rows = []; for (let i = 0; i < 300; i++) rows.push({ k: "__bulk:" + i, v: i });
  const write = G.db.putMany("kv", rows);
  await Promise.all([read, write]);
  const payload = await G.backup.exportAll();
  return { inBackup: payload.stores.kv.filter((r) => r.k.indexOf("__bulk:") === 0).length };
});
check(exportRace.inBackup === 300, "a big batch racing a background read still lands in the very next backup export (300 of 300)", "backup carried " + exportRace.inBackup + " of 300 rows");
await page.evaluate(async () => { await G.db.delMany("kv", Array.from({ length: 300 }, (_, i) => "__bulk:" + i).concat(Array.from({ length: 40 }, (_, i) => "__race:" + i))); });

// The cache still does its job: repeated reads with no write in between are served from it (no second scan of the store).
const cachedReads = await page.evaluate(async () => {
  await G.db.all("kv");                               // warm
  let scans = 0;
  const realOpen = IDBObjectStore.prototype.openCursor;
  IDBObjectStore.prototype.openCursor = function (...a) { scans++; return realOpen.apply(this, a); };
  try { await G.db.all("kv"); await G.db.all("kv"); await G.db.all("kv"); } finally { IDBObjectStore.prototype.openCursor = realOpen; }
  return scans;
});
check(cachedReads === 0, "the cache still serves repeat reads (0 store scans for 3 reads in a row)", "store scans for 3 warm reads: " + cachedReads);
const invalidated = await page.evaluate(async () => {
  await G.db.all("kv");
  await G.db.put("kv", { k: "__ack:inv", v: 1 });
  const view = await G.db.all("kv");
  await G.db.del("kv", "__ack:inv");
  const view2 = await G.db.all("kv");
  return { sawIt: view.some((r) => r.k === "__ack:inv"), goneAfter: !view2.some((r) => r.k === "__ack:inv") };
});
check(invalidated.sawIt && invalidated.goneAfter, "a write is visible to the very next read, and so is a delete (no timer, no lag)", "cache after write/delete: " + JSON.stringify(invalidated));

// The real thing: fresh boots. The app's view of kv must equal what is on disk once it is up.
// (A guard, not the proof: on the old rule this stays green here because the next write after boot - the
// settings save, a streak tick - clears a stale cache within a second. The 40-round race above is what fails.)
let bootsMatching = 0; const BOOTS = 3;
for (let i = 0; i < BOOTS; i++) {
  await page.reload({ waitUntil: "load" });
  await waitForBoot(page);
  await installInstruments();
  const same = await untilAsync(page, async () => {
    const app = (await G.db.all("kv")).map((r) => r.k).sort();
    const raw = await window.__rawKeys("kv");
    return JSON.stringify(app) === JSON.stringify(raw);
  }, null, { timeout: 8000 });
  if (same) bootsMatching++;
}
check(bootsMatching === BOOTS, "after " + BOOTS + " fresh boots the app's view of kv equals the database itself each time", "only " + bootsMatching + " of " + BOOTS + " boots ended with the app seeing every row the device holds");

/* =====================================================================
   4) The localStorage fallback: a full store is reported, not shrugged off
   ===================================================================== */
console.log("\n-- the localStorage backend reports a full store --");
const fb = await boot.openSession({ profile: null, noise: [] });
await fb.page.evaluate(() => {
  window.__toasts = [];
  const realToast = G.util.toast;
  G.util.toast = function (m, ms) { window.__toasts.push(String(m)); return realToast.call(G.util, m, ms); };
  G.db.installMemoryFallback();
});
const quota = await fb.page.evaluate(async () => {
  const big = "x".repeat(2000000);
  const results = [];
  for (let i = 0; i < 8; i++) {
    let r;
    try { await G.db.put("kv", { k: "__ack:big" + i, v: big }); r = "resolved"; } catch (e) { r = "rejected:" + (e && e.name); }
    results.push(r);
  }
  const stored = [];
  for (let i = 0; i < 8; i++) stored.push(window.localStorage.getItem("guidon:kv:__ack:big" + i) !== null);
  return { results, stored, backend: G.db._backend };
});
const lied = quota.results.map((r, i) => r === "resolved" && !quota.stored[i]);
check(quota.backend === "localStorage", "the fallback under test really is the localStorage backend", "backend: " + quota.backend);
check(quota.results.some((r) => r.indexOf("rejected") === 0), "a put that does not fit in localStorage is REJECTED (real quota, not simulated)", "results: " + JSON.stringify(quota.results));
check(!lied.some(Boolean), "no put claimed success without storing the row (" + quota.results.filter((r) => r === "resolved").length + " resolved, " + quota.stored.filter(Boolean).length + " stored)", "resolved-but-missing: " + JSON.stringify(lied));
const fbNotice = await until(fb.page, () => window.__toasts.some((t) => /wasn.t saved|out of space/i.test(t)));
check(fbNotice, "the Soldier is told, in plain words, that the change did not save", "toasts: " + JSON.stringify(await fb.page.evaluate(() => window.__toasts)));
check(await fb.page.evaluate(() => window.__toasts.some((t) => /because this device is out of space/.test(t))), "...and, because the browser reported a real full-storage error, that the device is out of space", "toasts: " + JSON.stringify(await fb.page.evaluate(() => window.__toasts)));
await fb.page.evaluate(() => { Object.keys(localStorage).filter((k) => k.indexOf("guidon:kv:__ack:") === 0).forEach((k) => localStorage.removeItem(k)); });
const fbOrdinary = await fb.page.evaluate(async () => {
  await G.db.put("kv", { k: "__ack:fine", v: "ok" });
  const many = await G.db.putMany("kv", [{ k: "__ack:fine2", v: 2 }, { k: "__ack:fine3", v: 3 }]);
  return { read: await G.db.get("kv", "__ack:fine"), many };
});
check(fbOrdinary.read && fbOrdinary.read.v === "ok" && fbOrdinary.many && fbOrdinary.many.written === 2 && fbOrdinary.many.skipped === 0, "an ordinary save on the localStorage backend still works and reports {written: 2, skipped: 0}", "ordinary saves: " + JSON.stringify(fbOrdinary));
await fb.context.close();

/* =====================================================================
   5) Booting on a backend that is not IndexedDB says so
   ===================================================================== */
console.log("\n-- a browser that cannot use IndexedDB shows a visible notice at start --");
const limited = await boot.openSession({
  profile: null,
  noise: [],
  beforeLoad: async ({ page: p }) => {
    await p.addInitScript(() => {
      window.__toastLog = [];
      new MutationObserver(() => {
        const t = document.getElementById("toast");
        const s = t ? t.textContent : "";
        if (s && window.__toastLog[window.__toastLog.length - 1] !== s) window.__toastLog.push(s);
      }).observe(document, { subtree: true, childList: true, characterData: true });
      // IndexedDB blocked outright (as in some private/locked-down browsers): opening it throws.
      // The first time the app tries to open it, a save is ATTEMPTED at that very moment - while the app
      // is still on the database it is about to find unusable - so what a save does when the database
      // cannot even be opened is observed directly, not assumed from the app's quiet start.
      let probed = false;
      Object.defineProperty(window, "indexedDB", { configurable: true, get() { return { open() {
        if (!probed && window.G && G.db && typeof G.db.put === "function") {
          probed = true;
          window.__openFailProbe = "pending";
          // Every toast CALL from here on (a mutation observer on the toast box only sees what is on screen
          // when it looks, and the next notice can overwrite this one before it does).
          window.__toastCalls = [];
          const realToast = G.util.toast;
          G.util.toast = function (m) { window.__toastCalls.push(String(m)); return realToast.apply(this, arguments); };
          G.db.put("kv", { k: "__ack:open-fail", v: 1 }).then(() => { window.__openFailProbe = "resolved"; }, () => { window.__openFailProbe = "rejected"; });
        }
        throw new Error("IndexedDB is blocked in this browser");
      } }; } });
    });
  },
});
const limitedBackend = await until(limited.page, () => !!(window.G && G.db && G.db._backend === "localStorage" && G.store && G.store.settings));
check(limitedBackend, "with IndexedDB blocked the app starts on the localStorage backend", "backend: " + (await limited.page.evaluate(() => window.G && G.db && G.db._backend)));
const limitedNotice = await until(limited.page, () => window.__toastLog.some((t) => /limited|small|browser|space/i.test(t)));
const limitedLog = await limited.page.evaluate(() => window.__toastLog);
check(limitedNotice, "a plain-language notice about limited saving is shown at start (it used to be silent for this backend)", "toasts seen at start: " + JSON.stringify(limitedLog));
check(!limitedLog.some((t) => /localstorage|indexeddb|quota/i.test(t)), "and it uses no storage vocabulary", "toasts: " + JSON.stringify(limitedLog));
const openProbe = await until(limited.page, () => window.__openFailProbe === "rejected" || window.__openFailProbe === "resolved");
check(openProbe && (await limited.page.evaluate(() => window.__openFailProbe)) === "rejected", "a save attempted while the database cannot be opened is refused (it is not quietly called saved)", "probe: " + (await limited.page.evaluate(() => window.__openFailProbe)));
const limitedCalls = await limited.page.evaluate(() => window.__toastCalls || []);
check(limitedCalls.some((t) => /limited|small|browser|space/i.test(t)) && !limitedCalls.some((t) => /wasn.t saved/i.test(t)),
  "...but it is not announced as \"that change wasn't saved\" - the app switches to its small-space fallback and says that instead", "every notice raised from the first open attempt on: " + JSON.stringify(limitedCalls));
await limited.context.close();

/* =====================================================================
   6) The single-file build has no cross-window bus: the database layer alone
      must keep a save nobody waited on from raising an unhandled error
   ===================================================================== */
console.log("\n-- the standalone single-file build behaves the same --");
const solo = await boot.openSession({ dir: "dist", profile: { ...PERSONAL_PROFILE }, noise });
await installInstruments(solo.page);
const soloBus = await solo.page.evaluate(() => (window.G.xwin ? window.G.xwin.isActive() : false));
check(soloBus === false, "the single-file build really runs without the cross-window bus (so nothing above the database layer can be hiding a bug)", "xwin active: " + soloBus);
await solo.page.evaluate(() => { window.__fault.abortPrefix = "__ack:"; });
const soloOwn = await solo.page.evaluate(async () => ({ outcome: await window.__settle(G.db.put("kv", { k: "__ack:solo1", v: 1 })), onDisk: await window.__raw("kv", "__ack:solo1") }));
check(soloOwn.outcome.startsWith("rejected") && soloOwn.onDisk === undefined, "single-file build: a cancelled commit is reported as failed and the row is not on the device (" + soloOwn.outcome + ")", "result: " + JSON.stringify(soloOwn));
await solo.page.evaluate(() => { window.__fault.abortPrefix = "__ack:"; window.__unhandled = 0; Date.now = (() => { const r = Date.now.bind(Date); return () => r() + 20 * 60 * 1000; })(); G.db.put("kv", { k: "__ack:solo-forgotten", v: 1 }); G.db.put("attempts", { id: "__ack:att-forgotten", scenarioId: "x", ts: 1 }); });
await until(solo.page, () => window.__toasts.some((t) => /wasn.t saved|out of space/i.test(t)));
await solo.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const soloUnhandled = await solo.page.evaluate(() => window.__unhandled);
check(soloUnhandled === 0, "single-file build: saves nobody waited on (a settings row, a scenario result) that fail raise no unhandled error", "unhandledrejection events: " + soloUnhandled);
await solo.page.evaluate(() => { window.__fault.abortPrefix = null; });
const soloOrdinary = await solo.page.evaluate(async () => { await G.db.put("kv", { k: "__ack:solo-fine", v: "ok" }); return (await window.__raw("kv", "__ack:solo-fine")) || null; });
check(soloOrdinary && soloOrdinary.v === "ok", "single-file build: an ordinary save still lands", "on disk: " + JSON.stringify(soloOrdinary));
await solo.context.close();

expectNoConsoleNoise(noise);
await finish("DB WRITE ACK");
