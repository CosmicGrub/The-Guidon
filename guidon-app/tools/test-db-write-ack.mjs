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
import { bootApp, ok, bad, check, finish, until, untilAsync, waitForBoot, PERSONAL_PROFILE, expectNoConsoleNoise } from "./testkit.mjs";

const boot = await bootApp({ profile: { ...PERSONAL_PROFILE } });
const { page, noise } = boot;

/* ---------------------------------------------------------------------
   In-page instruments (re-installed after every reload)
   --------------------------------------------------------------------- */
async function installInstruments() {
  await page.evaluate(() => {
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
      const k = a[0] && a[0].k;
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

// A burst of failures must not machine-gun the Soldier: one notice, one entry.
const burst = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 5; i++) out.push(await window.__settle(G.db.put("kv", { k: "__ack:burst" + i, v: i })));
  return out;
});
check(burst.every((o) => o.startsWith("rejected")), "five more cancelled saves in a row all report failure", "burst: " + JSON.stringify(burst));
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const afterBurst = await storageNotices();
const entriesAfterBurst = await storageLogEntries();
check(afterBurst.length === 1 && entriesAfterBurst.length === 1, "...but the notice and the trail entry stay at one (throttled)", "notices=" + afterBurst.length + " entries=" + entriesAfterBurst.length);

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
await resetScenario();
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
      Object.defineProperty(window, "indexedDB", { configurable: true, get() { return { open() { throw new Error("IndexedDB is blocked in this browser"); } }; } });
    });
  },
});
const limitedBackend = await until(limited.page, () => !!(window.G && G.db && G.db._backend === "localStorage" && G.store && G.store.settings));
check(limitedBackend, "with IndexedDB blocked the app starts on the localStorage backend", "backend: " + (await limited.page.evaluate(() => window.G && G.db && G.db._backend)));
const limitedNotice = await until(limited.page, () => window.__toastLog.some((t) => /limited|small|browser|space/i.test(t)));
const limitedLog = await limited.page.evaluate(() => window.__toastLog);
check(limitedNotice, "a plain-language notice about limited saving is shown at start (it used to be silent for this backend)", "toasts seen at start: " + JSON.stringify(limitedLog));
check(!limitedLog.some((t) => /localstorage|indexeddb|quota/i.test(t)), "and it uses no storage vocabulary", "toasts: " + JSON.stringify(limitedLog));
check(!limitedLog.some((t) => /wasn.t saved/i.test(t)), "a database that would not open is not announced as \"that change wasn't saved\" (the app already switched to its small-space fallback and said so)", "toasts: " + JSON.stringify(limitedLog));
await limited.context.close();

expectNoConsoleNoise(noise);
await finish("DB WRITE ACK");
