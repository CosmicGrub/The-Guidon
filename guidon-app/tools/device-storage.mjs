/**
 * What is REALLY on the device - read and written underneath the app.
 *
 * Suites that make a claim about storage ("nothing a Guest session did was
 * saved", "a real owner's rows are untouched", "this profile was already on
 * the device when the app opened") must not ask the app. G.db is the seam
 * under test: in a Guest or Kiosk session it answers from memory by design
 * (src/index.html, "Session-only storage"), so reading or seeding through it
 * proves nothing about the device. Everything here talks to IndexedDB and
 * localStorage directly from the page, the same way a second copy of the app
 * opened later would find them.
 *
 * Two uses:
 *   deviceDump(page)            - a stable, comparable snapshot of every
 *                                 object store and every localStorage key.
 *   putOnDevice(page, ...)      - put rows on the device as if an earlier
 *   seedOwnerProfile(page, ...)   session (or another install) had saved
 *                                 them. This replaces the old "G.db.put()
 *                                 a profile from inside a guest session,
 *                                 then reload" idiom, which can no longer
 *                                 work: a guest session saves nothing.
 *
 * Never opens the database with a version number, so it can never trigger
 * (or block) the app's own upgrade path.
 */

const DB_NAME = "guidon";

/** The canonical personal profile the suites seed (same shape as
    test-biometric-lock.mjs's original seedPersonalProfile()). */
export const OWNER_PROFILE = {
  onboardingComplete: true, mode: "personal", tier: "E5", rank: "SGT",
  displayName: "SGT TESTFIRE", lastName: "TESTFIRE", anonymous: false,
  studyWeakPoints: [], readinessConcerns: [], actionPlan: [], promoPoints: {},
};

/**
 * Every row of every object store (sorted by key) plus every localStorage
 * key, as plain data. `meta` holds the app's cached built-in content - many
 * megabytes that no session edits - so it is reduced to a per-row size and
 * checksum unless { fullMeta: true }.
 */
export async function deviceDump(page, { fullMeta = false } = {}) {
  return page.evaluate(async ({ name, fullMeta }) => {
    const sum = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; };
    const idb = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        // Opened before the app ever created its database: that would leave
        // an empty version-1 database behind and the app's own store
        // creation would never run. Undo it and say so.
        if (!req.result.objectStoreNames.length) {
          req.result.close();
          indexedDB.deleteDatabase(name);
          reject(new Error("device-storage: the app has not created its database yet - load the app and wait for it to boot first"));
          return;
        }
        resolve(req.result);
      };
    });
    const stores = {};
    for (const s of Array.from(idb.objectStoreNames).sort()) {
      const rows = await new Promise((resolve, reject) => {
        const r = idb.transaction(s, "readonly").objectStore(s).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const keyed = rows.map((row) => ({ key: String(row && (row.k != null ? row.k : row.id)), row }));
      keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      stores[s] = (s === "meta" && !fullMeta)
        ? keyed.map((x) => { const j = JSON.stringify(x.row); return { key: x.key, bytes: j.length, sum: sum(j) }; })
        : keyed.map((x) => x.row);
    }
    idb.close();
    const local = {};
    try {
      Object.keys(localStorage).sort().forEach((k) => { local[k] = localStorage.getItem(k); });
    } catch (e) { /* storage blocked: reads as empty, which is what it is */ }
    return { stores, local };
  }, { name: DB_NAME, fullMeta });
}

/** One kv row straight off the device (undefined when absent). */
export async function deviceKvGet(page, key) {
  return page.evaluate(async ({ name, key }) => {
    const idb = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        // Opened before the app ever created its database: that would leave
        // an empty version-1 database behind and the app's own store
        // creation would never run. Undo it and say so.
        if (!req.result.objectStoreNames.length) {
          req.result.close();
          indexedDB.deleteDatabase(name);
          reject(new Error("device-storage: the app has not created its database yet - load the app and wait for it to boot first"));
          return;
        }
        resolve(req.result);
      };
    });
    const row = await new Promise((resolve, reject) => {
      const r = idb.transaction("kv", "readonly").objectStore("kv").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    idb.close();
    return row;
  }, { name: DB_NAME, key });
}

/**
 * Put rows on the device directly. `stores` maps an object-store name to an
 * array of rows ({k, v} for kv/meta, {id, ...} for attempts/userScenarios);
 * `local` maps localStorage keys to string values. The app must have opened
 * its database at least once on this origin (any page load does that).
 */
export async function putOnDevice(page, { stores = {}, local = {} } = {}) {
  await page.evaluate(async ({ name, stores, local }) => {
    const idb = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        // Opened before the app ever created its database: that would leave
        // an empty version-1 database behind and the app's own store
        // creation would never run. Undo it and say so.
        if (!req.result.objectStoreNames.length) {
          req.result.close();
          indexedDB.deleteDatabase(name);
          reject(new Error("device-storage: the app has not created its database yet - load the app and wait for it to boot first"));
          return;
        }
        resolve(req.result);
      };
    });
    const names = Object.keys(stores).filter((s) => (stores[s] || []).length);
    if (names.length) {
      await new Promise((resolve, reject) => {
        const t = idb.transaction(names, "readwrite");
        names.forEach((s) => stores[s].forEach((row) => t.objectStore(s).put(row)));
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    }
    idb.close();
    Object.keys(local).forEach((k) => localStorage.setItem(k, local[k]));
    // This page's copy of the app may have the kv store memoised.
    try { if (window.G && window.G.db && window.G.db._invalidateKvCache) window.G.db._invalidateKvCache(); } catch (e) {}
  }, { name: DB_NAME, stores, local });
}

/**
 * A real personal profile, on the device, as if its owner had set the app up
 * earlier. Reload afterwards and the app opens as that Soldier with no
 * welcome screen. Works from any state, including from inside a guest
 * session (where G.db.put() would only reach memory).
 */
export async function seedOwnerProfile(page, overrides = {}) {
  const profile = Object.assign({}, OWNER_PROFILE, overrides);
  await putOnDevice(page, { stores: { kv: [{ k: "guidon:profile:v1", v: profile }] } });
  return profile;
}

/**
 * Open the app as a real, already-set-up Soldier: load, wait for the
 * database to exist, seed the profile underneath the app, reload, and wait
 * for the app to be past its boot decision with no welcome screen.
 */
export async function openAsOwner(page, url, overrides = {}) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => !!(window.G && window.G.store && window.G.db) && !/Loading GUIDON/.test((document.getElementById("route") || {}).textContent || ""), null, { timeout: 15000 });
  const profile = await seedOwnerProfile(page, overrides);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!(window.G && window.G.profile && window.G.profile.cached && window.G.profile.cached()) && !/Loading GUIDON/.test((document.getElementById("route") || {}).textContent || ""), null, { timeout: 15000 });
  const overlay = await page.locator("#ob-overlay").count();
  if (overlay) throw new Error("openAsOwner: the welcome screen is still showing after seeding a real profile and reloading");
  return profile;
}

/**
 * For a page that is ALREADY loaded: make sure it is running as a real
 * profile. If the app came up on the welcome screen (nothing on the device
 * yet), put the owner profile on the device and reload; if a profile was
 * already there (a second page at the same origin), do nothing.
 */
export async function ensureOwner(page, { timeoutMs = 15000, overrides = {} } = {}) {
  const decided = () => !!(window.G && window.G.store && window.G.db) && !/Loading GUIDON/.test((document.getElementById("route") || {}).textContent || "");
  await page.waitForFunction(decided, null, { timeout: timeoutMs });
  // The welcome screen is attached one animation frame after the decision.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  if (!(await page.locator("#ob-overlay").count())) return { seeded: false };
  await seedOwnerProfile(page, overrides);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(decided, null, { timeout: timeoutMs });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  if (await page.locator("#ob-overlay").count()) throw new Error("ensureOwner: the welcome screen is still showing after seeding a real profile and reloading");
  return { seeded: true };
}
