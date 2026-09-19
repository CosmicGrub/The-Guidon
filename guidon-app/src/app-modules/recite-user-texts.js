/* GUIDON - "My unit": a Soldier's own text for Recitation Drill (G.reciteUser)

   WHY this exists: every unit has a song, a creed or a motto its Soldiers
   are expected to know, and GUIDON must never ship most of them - a unit
   song usually has an author and an owner, and the project rule is that the
   app carries no copyrighted text or lyrics. So instead of bundling anyone's
   words, the Soldier pastes their own copy here and drills it with the same
   study modes as the built-in creeds.

   WHERE THE TEXT LIVES: only in this device's own storage, in ONE row of the
   app's "kv" store (KEY below). It is never part of the app, never leaves
   the device on its own, and never enters the board question bank - so it
   cannot reach Board Drill, Quiz, Mock Board, review scheduling, study
   rooms or the handheld flashcard export. Because the app's backup copies
   every kv row, it IS carried in a backup file the Soldier chooses to
   export, and comes back on restore: it is their own study material, the
   same as a scenario they wrote (unlike the squad roster, which is about
   other people and stays out of backups by default).

   views.recite (src/index.html) draws the "My unit" section from list(),
   and calls add()/remove(). Nothing else reads this.
*/
(function () {
  "use strict";
  var G = window.G = window.G || {};

  var KEY = "guidon:recite:own:v1";
  // Generous for a song, creed or motto; small enough that one pasted novel
  // cannot bloat every backup file from then on.
  var LIMITS = { items: 20, title: 80, chars: 8000, lines: 200 };
  var NOTE = "Your own text. It is saved only on this device and is never shared or sent anywhere.";
  // See add(): the marking words, in capitals only, not part of a longer word.
  var MARKING_IN_CAPS = /(^|[^A-Za-z])(TOP\s+SECRET|SECRET|CONFIDENTIAL|CUI|NOFORN|REL\s+TO|FEDCON|CONTROLLED\s+UNCLASSIFIED\s+INFORMATION)(?![A-Za-z])/;

  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) : s; }

  // One recitable line per line the Soldier typed. A text pasted as a single
  // block (common for a creed copied from a slide) is split at sentence ends
  // instead, so "Chunk & memorize" still has pieces to work through.
  function toLines(text) {
    var lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n")
      .map(function (s) { return s.replace(/\s+/g, " ").trim(); })
      .filter(function (s) { return !!s; });
    if (lines.length === 1 && lines[0].length > 160) {
      var parts = (lines[0].match(/[^.!?;]+[.!?;]*\s*/g) || [lines[0]])
        .map(function (s) { return s.trim(); }).filter(function (s) { return !!s; });
      if (parts.length > 1) lines = parts;
    }
    return lines.slice(0, LIMITS.lines);
  }

  // The shape guard every reader goes through: a hand-edited row or an old
  // backup must never be able to crash Recitation Drill.
  function cleanRow(r) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    if (typeof r.id !== "string" || !/^own-[a-z0-9]{4,40}$/.test(r.id)) return null;
    var lines = Array.isArray(r.lines) ? r.lines.filter(function (s) { return typeof s === "string" && s.trim(); }) : [];
    if (!lines.length) return null;
    var title = clip(typeof r.title === "string" ? r.title.trim() : "", LIMITS.title) || "My unit text";
    return { id: r.id, title: title, lines: lines.slice(0, LIMITS.lines), addedAt: typeof r.addedAt === "string" ? r.addedAt : "" };
  }
  function validStore(v) {
    return Array.isArray(v) && v.every(function (r) { return !!cleanRow(r); });
  }

  // What Recitation Drill works with: the same fields a bundled recitable
  // creed carries (id / concept / lines / source), plus own:true so the view
  // knows there is no review card behind it.
  function toItem(r) {
    return { id: r.id, own: true, category: "My unit", concept: r.title, q: r.title, lines: r.lines.slice(), source: NOTE, addedAt: r.addedAt };
  }

  function readRows() {
    if (!G.db || typeof G.db.getSetting !== "function") return Promise.resolve([]);
    return G.db.getSetting(KEY, []).then(function (v) {
      return (Array.isArray(v) ? v : []).map(cleanRow).filter(function (r) { return !!r; });
    }, function () { return []; });
  }
  function writeRows(rows) { return G.db.setSetting(KEY, rows); }

  function list() { return readRows().then(function (rows) { return rows.map(toItem); }); }

  // Resolves { ok:true, item } or { ok:false, error:"<plain sentence>" } -
  // never rejects for a problem the Soldier can fix, so the form can show
  // the sentence as it is.
  function add(input) {
    input = input || {};
    var title = clip(String(input.title == null ? "" : input.title).replace(/\s+/g, " ").trim(), LIMITS.title);
    var raw = String(input.text == null ? "" : input.text);
    if (!title) return Promise.resolve({ ok: false, error: "Give it a name first, for example your unit song or motto." });
    if (!raw.trim()) return Promise.resolve({ ok: false, error: "Paste or type the text first." });
    if (raw.length > LIMITS.chars) return Promise.resolve({ ok: false, error: "That is too long to save here. Keep it under " + LIMITS.chars.toLocaleString() + " characters." });
    // The same local check the MOI import uses. Only a hard stop matters
    // here (a classification or handling marking); the text itself is never
    // changed, because a recitation has to be word for word.
    // That shared check ignores upper and lower case, so on its own it
    // would refuse a creed for containing the everyday word "secret" or
    // "confidential". A real marking is written in capitals, so a refusal
    // also needs the marking word to appear in capitals in what was pasted.
    if (G.opsecGuard && typeof G.opsecGuard.sanitizeInput === "function") {
      var screened = null;
      try { screened = G.opsecGuard.sanitizeInput(title + "\n" + raw, { redactContact: false }); } catch (e) { screened = null; }
      if (screened && screened.blocked && MARKING_IN_CAPS.test(title + "\n" + raw)) {
        return Promise.resolve({ ok: false, error: "This looks like it carries a classification or handling marking, so GUIDON did not save it. Only add text that is cleared for open study." });
      }
    }
    var lines = toLines(raw);
    if (!lines.length) return Promise.resolve({ ok: false, error: "Paste or type the text first." });
    return readRows().then(function (rows) {
      if (rows.length >= LIMITS.items) return { ok: false, error: "You already have " + LIMITS.items + " texts saved. Delete one to make room." };
      var row = { id: "own-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: title, lines: lines, addedAt: new Date().toISOString() };
      return writeRows(rows.concat([row])).then(function () { return { ok: true, item: toItem(row) }; });
    }).then(null, function () {
      return { ok: false, error: "Couldn't save that on this device. Check that the device has free storage and try again." };
    });
  }

  // Deleting a text also deletes the study progress saved for it, so
  // nothing about it is left behind on the device.
  function remove(id) {
    return readRows().then(function (rows) {
      var keep = rows.filter(function (r) { return r.id !== id; });
      if (keep.length === rows.length) return false;
      return writeRows(keep).then(function () {
        var extra = ["recite:" + id, "recall-ladder:" + id];
        return (G.db && typeof G.db.delMany === "function") ? G.db.delMany("kv", extra) : null;
      }).then(function () { return true; });
    });
  }

  G.reciteUser = { KEY: KEY, LIMITS: LIMITS, NOTE: NOTE, list: list, add: add, remove: remove, toLines: toLines, validStore: validStore };
})();
