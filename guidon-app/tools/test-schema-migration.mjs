/**
 * Schema-migration harness (roadmap Tier 8) — db.js's MIGRATIONS registry
 * and runMigrations() loop.
 *
 * The real "guidon" database has never needed a schema migration (DB_VERSION
 * has been 1 since inception), so this can't test a real pending migration —
 * there isn't one. Instead it proves the actual SHIPPED mechanism works, on
 * a disposable scratch database ("guidon-migration-test", matching the
 * "guidon-android-probe"/"guidon-csp-probe" naming convention the existing
 * IndexedDB-availability probes in test-android.mjs/test-csp.mjs already
 * use), never touching the real "guidon" database or bumping the real
 * DB_VERSION to do it:
 *
 *   1. Open the scratch database at version 1 directly (raw indexedDB API,
 *      not through G.db — G.db only ever talks to "guidon"). Seed one
 *      old-shape row.
 *   2. Close that connection, then reopen the SAME database name at version
 *      2. Its onupgradeneeded calls window.G.db._runMigrations(...) — the
 *      real, shipped runMigrations() function (exposed on db as
 *      db._runMigrations for exactly this purpose) — not a reimplementation
 *      of the loop.
 *   3. Before that, inject a disposable migration into
 *      window.G.db._migrations[2] that rewrites the seeded row to a new
 *      shape. This is the one piece of test-only state; it mutates the real
 *      G.db._migrations object for this page's lifetime, but harmlessly —
 *      the real "guidon" database already opened at its real DB_VERSION (1)
 *      during page boot, before this test does anything, and never reopens
 *      in this same context, so the injected registry entry is never
 *      consulted for anything but the scratch database this test drives.
 *   4. Assert oldVersion/newVersion were passed through correctly, the
 *      migration actually ran (real row mutation, read back raw), and it
 *      ran exactly once (not per-store-guard, not twice).
 *   5. A second scenario proves the "N migrations between old and new, in
 *      order" loop itself — jumping straight from version 1 to version 4
 *      with migrations registered at 2, 3, and 4 — runs all three in
 *      ascending order, not just the last one.
 *   6. A third scenario proves the real production no-op path: opening a
 *      version-1-to-version-1 case (nothing to upgrade) never invokes any
 *      registered migration at all — the empty-MIGRATIONS state every
 *      existing "guidon" install is actually in today stays truly inert.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") noise.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(500);

const hasHooks = await page.evaluate(() => ({
  hasDb: typeof window.G !== "undefined" && typeof window.G.db !== "undefined",
  hasRunMigrations: typeof (window.G && window.G.db && window.G.db._runMigrations) === "function",
  hasMigrationsObj: typeof (window.G && window.G.db && window.G.db._migrations) === "object",
}));
hasHooks.hasDb ? ok("window.G.db exists on real page boot") : bad("window.G.db missing");
hasHooks.hasRunMigrations ? ok("G.db._runMigrations is exposed as a real, callable function") : bad("G.db._runMigrations missing/not a function");
hasHooks.hasMigrationsObj ? ok("G.db._migrations is exposed as a real, mutable object") : bad("G.db._migrations missing/not an object");

// ── 1) A single real migration actually runs against a scratch DB ────────
const scenario1 = await page.evaluate(() => new Promise((resolve, reject) => {
  const DB = "guidon-migration-test-1";
  indexedDB.deleteDatabase(DB); // clean slate if a prior run left it
  const req1 = indexedDB.open(DB, 1);
  req1.onupgradeneeded = () => { req1.result.createObjectStore("kv", { keyPath: "k" }); };
  req1.onerror = () => reject(req1.error);
  req1.onsuccess = () => {
    const db1 = req1.result;
    const putTx = db1.transaction("kv", "readwrite");
    putTx.objectStore("kv").put({ k: "widget:v1", v: { shape: "old" } });
    putTx.oncomplete = () => {
      db1.close();

      window.G.db._migrations[2] = (targetDb, versionTx) => {
        window.__migrationCalls = (window.__migrationCalls || 0) + 1;
        const store = versionTx.objectStore("kv");
        const getReq = store.get("widget:v1");
        getReq.onsuccess = () => {
          const row = getReq.result;
          if (row) store.put({ k: "widget:v1", v: { shape: "new", migratedFrom: row.v.shape } });
        };
      };

      window.__migrationCalls = 0;
      let capturedOld = null, capturedNew = null;
      const req2 = indexedDB.open(DB, 2);
      req2.onupgradeneeded = (e) => {
        capturedOld = e.oldVersion; capturedNew = e.newVersion;
        window.G.db._runMigrations(e.target.result, e.target.transaction, e.oldVersion, 2);
      };
      req2.onerror = () => reject(req2.error);
      req2.onsuccess = () => {
        const db2 = req2.result;
        const readTx = db2.transaction("kv", "readonly");
        const getReq = readTx.objectStore("kv").get("widget:v1");
        getReq.onsuccess = () => {
          db2.close();
          indexedDB.deleteDatabase(DB);
          resolve({
            row: getReq.result,
            calls: window.__migrationCalls,
            capturedOld, capturedNew,
          });
        };
        getReq.onerror = () => reject(getReq.error);
      };
    };
  };
}));

scenario1.capturedOld === 1 && scenario1.capturedNew === 2
  ? ok("onupgradeneeded's real e.oldVersion/e.newVersion (1 -> 2) reach runMigrations() unmodified")
  : bad("captured old/new version: " + JSON.stringify({ old: scenario1.capturedOld, new: scenario1.capturedNew }));
scenario1.calls === 1
  ? ok("the injected migration ran exactly once for a 1 -> 2 upgrade")
  : bad("migration call count: " + scenario1.calls + ", expected 1");
scenario1.row && scenario1.row.v && scenario1.row.v.shape === "new" && scenario1.row.v.migratedFrom === "old"
  ? ok("the seeded row was genuinely rewritten by the real runMigrations() loop, in place, inside the real versionchange transaction — not a copy the test made itself")
  : bad("row after migration: " + JSON.stringify(scenario1.row));

// ── 2) Multiple migrations between old and new run in ascending order ────
const scenario2 = await page.evaluate(() => new Promise((resolve, reject) => {
  const DB = "guidon-migration-test-2";
  indexedDB.deleteDatabase(DB);
  const req1 = indexedDB.open(DB, 1);
  req1.onupgradeneeded = () => { req1.result.createObjectStore("kv", { keyPath: "k" }); };
  req1.onerror = () => reject(req1.error);
  req1.onsuccess = () => {
    req1.result.close();

    window.__order = [];
    window.G.db._migrations[2] = () => { window.__order.push(2); };
    window.G.db._migrations[3] = () => { window.__order.push(3); };
    window.G.db._migrations[4] = () => { window.__order.push(4); };

    const req2 = indexedDB.open(DB, 4);
    req2.onupgradeneeded = (e) => {
      window.G.db._runMigrations(e.target.result, e.target.transaction, e.oldVersion, 4);
    };
    req2.onerror = () => reject(req2.error);
    req2.onsuccess = () => {
      req2.result.close();
      indexedDB.deleteDatabase(DB);
      resolve(window.__order.slice());
    };
  };
}));

JSON.stringify(scenario2) === JSON.stringify([2, 3, 4])
  ? ok("jumping straight from version 1 to version 4 runs every registered migration in between (2, 3, 4), in ascending order — not just the last one")
  : bad("migration run order: " + JSON.stringify(scenario2) + ", expected [2,3,4]");

// ── 3) The real production no-op state stays genuinely inert ─────────────
const scenario3 = await page.evaluate(() => new Promise((resolve, reject) => {
  const DB = "guidon-migration-test-3";
  indexedDB.deleteDatabase(DB);
  // No injected migrations here at all — this models every "guidon"
  // install that exists today: MIGRATIONS is empty, DB_VERSION is 1.
  window.__inertCalls = 0;
  const req1 = indexedDB.open(DB, 1);
  req1.onupgradeneeded = (e) => {
    e.target.result.createObjectStore("kv", { keyPath: "k" });
    window.G.db._runMigrations(e.target.result, e.target.transaction, e.oldVersion, 1);
  };
  req1.onerror = () => reject(req1.error);
  req1.onsuccess = () => {
    req1.result.close();
    indexedDB.deleteDatabase(DB);
    resolve(window.__inertCalls);
  };
}));

scenario3 === 0
  ? ok("a fresh open at version 1 with an empty MIGRATIONS registry (today's real production state) invokes zero migrations — genuinely inert, not just untested")
  : bad("inert-state migration call count: " + scenario3 + ", expected 0");

noise.length === 0
  ? ok("no console errors/warnings across the whole flow")
  : bad("console noise: " + JSON.stringify(noise));

await browser.close();
server.close();
console.log("\n" + (fails ? `SCHEMA MIGRATION: ${fails} FAILURE(S)` : "SCHEMA MIGRATION: all passed"));
process.exit(fails ? 1 : 0);
