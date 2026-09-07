/* ==== js/xwin.js ==== */
/* GUIDON - xwin.js : cross-context state bus (G.xwin)

   Two GUIDON pages on ONE origin (a Soldier with the PWA open in two tabs,
   or two Tauri WebviewWindows of the same app) share ONE IndexedDB but
   nothing else. A PWA and a Tauri window are different origins with
   separate databases - this bus never bridges those. Measured on the pre-bus build in both engines
   (tools/test-xwin-sync.mjs, Session 1 of the desktop roadmap):

     - wrapKvCache() (src/index.html, js/db.js section) memoises db.all("kv")
       per page and only that page's own writes clear it, so page A's cached
       read never sees page B's put - while A's db.get() does;
     - the store's debounced settings save writes the WHOLE state.settings
       row, so A setting userName and B setting navDensity 450 ms apart left
       the row with only B's edit - A's write silently lost;
     - Home's due count is computed on render only, and util.emit() is
       in-process, so B's Home stayed stale after A graded cards and B never
       heard A's "scenarios:change".

   This module is the missing wire. It only does anything when the page has
   BroadcastChannel AND a live G.db; anywhere else (the standalone file never
   receives this module at all - tools/build.mjs injects it into web/ only,
   the same way it injects native.js/pwa.js) every function is a no-op.

   Two halves, deliberately asymmetric:

     SEND  Wraps G.db.put / putMany / del / delMany / clear AS THEY ARE when
           this file runs - i.e. on top of wrapKvCache()'s versions, so the
           local cache invalidation on our own writes is untouched - and,
           once the underlying write has RESOLVED, posts
             { store, keys, from, cleared }
           on the "guidon:store" channel. keys are the k/id values written
           or deleted; clear posts an empty keys array with cleared:true.
           A rejected write posts nothing. installMemoryFallback() can
           reassign these same methods after boot (it re-runs wrapKvCache
           for the localStorage/memory backends), so the wrap is re-applied
           on "store:ready" if it finds itself gone - idempotent by marker.

     RECEIVE  A message from ANOTHER page (from !== this page's id) never
           writes anything - a receipt that wrote would echo across pages
           forever - and never posts. It:
             kv            -> G.db._invalidateKvCache(), so the next cached
                              db.all("kv") re-scans;
                              keys incl. "settings" -> re-read the row fresh
                              via db.get() and merge it PER KEY into the
                              live G.store.settings() object, skipping keys
                              this page has edited whose debounced save has
                              not flushed yet (G.store._dirtySettingsKeys()
                              - the in-flight race: without that exclusion
                              the other page's whole-row write would revert
                              our pending edit before our own save landed),
                              then G.theme.syncFromSettings() and one
                              util.emit("settings:change", { k: "*" });
                              keys with an "srs:" / "curr:" prefix -> one
                              util.emit("progress:change"), coalesced to at
                              most one per 100 ms (Home/Progress re-render
                              on it - see the listener near app.start());
             attempts      -> the same coalesced "progress:change";
             userScenarios -> G.store.reloadUserScenarios().

   Exposed loudly on G per the project's standing rule: G.xwin.state carries
   the counters the suites read (posted/received/ignoredOwn/rewraps).
*/
window.G = window.G || {};
(function () {
  "use strict";

  const CHANNEL = "guidon:store";
  const WRITE_METHODS = ["put", "putMany", "del", "delMany", "clear"];
  // The kv key prefixes whose rows feed the progress screens: board-card
  // schedules (srsKey() in the board module) and curriculum lesson progress
  // (key() in the curriculum module). Read from those modules' own code.
  const PROGRESS_PREFIXES = ["srs:", "curr:"];
  const PROGRESS_COALESCE_MS = 100;

  const supported = typeof BroadcastChannel === "function" && !!(G.db && G.util && G.store);
  const state = {
    supported,
    id: null,
    posted: 0,        // messages this page sent
    received: 0,      // foreign messages this page acted on
    ignoredOwn: 0,    // messages carrying our own id (never expected; belt and braces)
    rewraps: 0,       // times the write wrap had to be re-applied after a backend swap
    lastReceipt: null,
  };

  if (!supported) {
    G.xwin = { state, isActive: () => false, channel: CHANNEL, originId: () => null };
    return;
  }

  const util = G.util, db = G.db;

  function originId() {
    try {
      const a = new Uint8Array(8);
      crypto.getRandomValues(a);
      return Array.prototype.map.call(a, (b) => ("0" + b.toString(16)).slice(-2)).join("");
    } catch (e) {
      return Math.random().toString(16).slice(2) + Date.now().toString(16);
    }
  }
  const id = originId();
  state.id = id;

  const chan = new BroadcastChannel(CHANNEL);

  /* ------------------------------------------------------------------ send */

  function keyOf(v) { return v && v.k !== undefined ? v.k : v && v.id; }
  function keysOf(name, arg) {
    try {
      if (name === "put") return [keyOf(arg)];
      if (name === "del") return [arg];
      if (name === "putMany") return (arg || []).map(keyOf);
      if (name === "delMany") return (arg || []).slice();
    } catch (e) {}
    return [];
  }

  function post(store, keys, cleared) {
    try {
      chan.postMessage({ store, keys, from: id, cleared: !!cleared });
      state.posted++;
    } catch (e) { /* a non-cloneable key (never expected) must not fail the write that already landed */ }
  }

  function wrapWrites() {
    let applied = 0;
    WRITE_METHODS.forEach((name) => {
      const orig = db[name];
      if (typeof orig !== "function" || orig._xwinWrapped) return;
      const wrapped = function (store, arg) {
        const args = arguments;
        // orig is called first, un-caught: a synchronous throw propagates
        // exactly as it did before this wrap existed.
        return Promise.resolve(orig.apply(db, args)).then((r) => {
          post(store, keysOf(name, arg), name === "clear");
          return r;
        });
      };
      wrapped._xwinWrapped = true;
      db[name] = wrapped;
      applied++;
    });
    return applied;
  }

  wrapWrites();
  // installMemoryFallback() (index.html, db section) reassigns put/putMany/
  // del/delMany/clear when IndexedDB is unavailable and the boot path only
  // learns that after db.ready() settles - after this file has run. The
  // store emits "store:ready" once that decision is final.
  util.on("store:ready", () => { const n = wrapWrites(); if (n) state.rewraps++; });

  /* --------------------------------------------------------------- receive */

  let progressTimer = null, progressPending = false;
  function emitProgress() {
    if (progressTimer) { progressPending = true; return; }
    util.emit("progress:change");
    progressTimer = setTimeout(() => {
      progressTimer = null;
      if (progressPending) { progressPending = false; emitProgress(); }
    }, PROGRESS_COALESCE_MS);
  }

  function isProgressKey(k) {
    if (typeof k !== "string") return false;
    for (let i = 0; i < PROGRESS_PREFIXES.length; i++) if (k.lastIndexOf(PROGRESS_PREFIXES[i], 0) === 0) return true;
    return false;
  }

  function sameValue(a, b) {
    if (a === b) return true;
    if (a && b && typeof a === "object" && typeof b === "object") {
      try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
    }
    return false;
  }

  /* Mirrors the boot path's OS reduce-motion override (app.start(), "Item
     D"): a person who never touched Settings -> Motion keeps the OS choice
     even when the other page's row says "rich". Never written back. */
  function effectiveSettings(s) {
    try {
      if (!s.motionUserSet && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return Object.assign({}, s, { motion: "minimal", reduceMotion: true });
      }
    } catch (e) {}
    return s;
  }

  let settingsSeq = 0;
  function mergeSettings() {
    const seq = ++settingsSeq;
    return db.get("kv", "settings").then((row) => {
      if (seq !== settingsSeq) return null;   // a newer receipt's read supersedes this one
      const fresh = row && row.v;
      if (!fresh || typeof fresh !== "object") return null;
      const live = G.store.settings();
      if (!live || typeof live !== "object") return null;
      const dirty = typeof G.store._dirtySettingsKeys === "function" ? G.store._dirtySettingsKeys() : [];
      const changed = [];
      Object.keys(fresh).forEach((k) => {
        if (dirty.indexOf(k) !== -1) return;
        if (sameValue(live[k], fresh[k])) return;
        live[k] = fresh[k];
        changed.push(k);
      });
      if (!changed.length) return changed;
      if (G.theme && typeof G.theme.syncFromSettings === "function") G.theme.syncFromSettings(effectiveSettings(live));
      util.emit("settings:change", { k: "*", v: null, keys: changed, from: "xwin" });
      return changed;
    }).catch(() => null);
  }

  function reloadScenarios() {
    if (typeof G.store.reloadUserScenarios !== "function") return Promise.resolve();
    return Promise.resolve(G.store.reloadUserScenarios()).catch(() => null);
  }

  chan.addEventListener("message", (ev) => {
    const m = ev && ev.data;
    if (!m || typeof m !== "object") return;
    if (m.from === id) { state.ignoredOwn++; return; }
    const keys = Array.isArray(m.keys) ? m.keys : [];
    state.received++;
    state.lastReceipt = { store: m.store, keys: keys.length, cleared: !!m.cleared, t: Date.now() };
    if (m.store === "kv") {
      if (typeof db._invalidateKvCache === "function") db._invalidateKvCache();
      if (m.cleared || keys.indexOf("settings") !== -1) mergeSettings();
      if (m.cleared || keys.some(isProgressKey)) emitProgress();
    } else if (m.store === "attempts") {
      emitProgress();
    } else if (m.store === "userScenarios") {
      reloadScenarios();
    }
  });

  G.xwin = {
    state,
    isActive: () => true,
    channel: CHANNEL,
    originId: () => id,
    // exposed for the suites
    _debug: { keysOf, isProgressKey, effectiveSettings },
  };
})();
// END xwin.js
