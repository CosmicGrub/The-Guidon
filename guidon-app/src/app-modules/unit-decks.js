/* GUIDON - Unit decks, the on-device half (G.unitDecks)
   ROADMAP "Later" / AUDIT-2026-09.md section 6 item M. The format, its limits,
   the schema and the sensitive-text screening live in unit-decks-core.js
   (G.unitPack); this file is what happens on a Soldier's own device: reading a
   file the Soldier chose, showing a preview, keeping the deck, offering its
   cards to the study tools, switching it off and removing it.

   WHERE A DECK LIVES: one row of the app's "kv" store per deck, under
   "unit-deck:<deckId>" - only on this device. It is the Soldier's own study
   material, exactly like their My unit texts: it travels in a backup they
   choose to export and comes back on restore, where every row is checked again
   (KV_PREFIX_VALIDATORS in src/index.html calls G.unitPack.validRow). It never
   enters the shipped bank, the bank fingerprint, the content manifest, the
   handheld export, a Study Room or any network request.

   HOW STUDY TOOLS SEE IT: they do NOT get unit cards from store.boardQuestions()
   (that stays exactly the shipped bank, so nothing that reads it - Study Rooms,
   Mock Board, the Home dashboard - can ever pick a unit card up by accident).
   store.studyQuestions() adds cards() to it, and only Board Drill, Quiz, Rapid
   Fire, global search and the Readiness screen call that.

   GUEST AND KIOSK SESSIONS: every write below goes through G.db, which keeps a
   session-only profile's writes in memory. A deck imported in a Guest session
   is studied for that session and is gone afterwards; the device is untouched.

   ALL TEXT is drawn as text nodes (el(..., { text })). This file never builds
   markup from a deck's strings - no html:, innerHTML, insertAdjacentHTML or
   DOMParser - and tools/test-unit-decks.mjs fails the build if one appears.
*/
(function () {
  "use strict";
  var G = window.G = window.G || {};
  var P = G.unitPack;
  var util = G.util, el = util.el;

  var PANEL_ID = "settings-unitdecks-panel";
  // The two helpers below have this exact shape on purpose: tools/module-contract.mjs and
  // tools/lint-storage-contract.mjs find the keys this module writes and deletes by reading them.
  function deckKey(id) { return "unit-deck:" + id; }
  function srsKey(id) { return "srs:" + id; }

  var decks = {};          // id -> a row that passed G.unitPack.validRow
  var rev = 0;
  var cardMemo = null;     // { rev, list }

  function bump() {
    rev++;
    cardMemo = null;
    try { if (util.emit) util.emit("unitdecks:change", { rev: rev }); } catch (e) { /* a listener must not undo a save */ }
  }
  function say(msg) { try { if (util.announce) util.announce(msg); } catch (e) { /* announcing is a courtesy */ } }
  function byName(a, b) { var x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1); }
  function sortedRows() { return Object.keys(decks).map(function (k) { return decks[k]; }).sort(byName); }
  function copyRow(row) { return JSON.parse(JSON.stringify(row)); }

  /* ---- reading what is on the device ---- */
  // Called once at start-up (store.init) so the study tools have the decks the moment they draw.
  // A row that fails the check (a hand edit, a damaged backup, a row under the wrong key) is left
  // out and logged - never guessed at, never allowed to crash Board Drill.
  function load() {
    if (!G.db || typeof G.db.all !== "function") return Promise.resolve();
    return G.db.all("kv").then(function (rows) {
      var next = {};
      (rows || []).forEach(function (row) {
        if (!row || typeof row.k !== "string" || row.k.indexOf("unit-deck:") !== 0) return;
        var id = row.k.slice("unit-deck:".length);
        if (P.validRow(row.v) && row.v.id === id) next[id] = row.v;
        else if (G.selfheal && typeof G.selfheal.log === "function") G.selfheal.log("kv-reject", row.k, "a saved unit deck did not pass its check and was left out");
      });
      decks = next;
      bump();
    }, function () { /* storage unreadable: no unit decks this session, everything else still works */ });
  }

  function list() {
    return sortedRows().map(function (r) {
      var cats = {};
      r.cards.forEach(function (c) { cats[c.category] = true; });
      return { id: r.id, name: r.name, unit: r.unit, packVersion: r.packVersion, packDate: r.packDate, importedAt: r.importedAt, enabled: r.enabled,
        cardCount: r.cards.length, categoryCount: Object.keys(cats).length };
    });
  }
  function deck(id) { return decks[id] ? copyRow(decks[id]) : null; }

  // The cards of every deck that is switched on: what the study tools work with.
  function cards() {
    if (cardMemo && cardMemo.rev === rev) return cardMemo.list;
    var out = [];
    sortedRows().forEach(function (r) { if (r.enabled) out = out.concat(P.cardsOf(r)); });
    cardMemo = { rev: rev, list: out };
    return out;
  }
  function suggestedTitles() {
    var seen = {}, out = [];
    sortedRows().forEach(function (r) {
      if (!r.enabled) return;
      r.reciteTitles.forEach(function (t) {
        var k = t.toLowerCase();
        if (seen[k]) return;
        seen[k] = true; out.push({ title: t, deckName: r.name });
      });
    });
    return out;
  }

  /* ---- the import check: everything that can refuse a deck, in order ---- */
  // Resolves { ok:true, pack, summary, existing, replaces } or { ok:false, stage, messages[], findings[] }.
  // Nothing is written. add() below runs it again, so the screen cannot be walked around.
  function inspect(input, opts) {
    opts = opts || {};
    var parsed;
    if (typeof input === "string") parsed = P.parse(input);
    else { var v = P.validate(input); parsed = v.ok ? { ok: true, pack: input, errors: [] } : { ok: false, errors: v.errors, newer: !!v.newer, truncated: v.truncated }; }
    if (!parsed.ok) {
      return { ok: false, stage: parsed.newer ? "newer" : "format", messages: parsed.errors.map(function (e) { return e.message; }), findings: [], truncated: !!parsed.truncated };
    }
    var pack = parsed.pack;
    var scr = P.screen(pack, opts.now != null ? { now: opts.now } : undefined);
    if (scr.unavailable) return { ok: false, stage: "screen", messages: [scr.message], findings: [] };
    if (!scr.ok) {
      return { ok: false, stage: "screen", messages: scr.findings.map(P.describeFinding), findings: scr.findings, total: scr.total, truncated: scr.truncated };
    }
    var existing = decks[pack.id] || null;
    if (!existing && Object.keys(decks).length >= P.LIMITS.decks) {
      return { ok: false, stage: "limit", messages: ["You already have " + P.LIMITS.decks + " unit decks on this device, which is the most GUIDON keeps. Remove one first."], findings: [] };
    }
    return { ok: true, pack: pack, summary: P.summarize(pack), replaces: existing ? { name: existing.name, unit: existing.unit, packVersion: existing.packVersion, packDate: existing.packDate, enabled: existing.enabled } : null };
  }

  /* ---- writing ---- */
  // input: the deck text, or a parsed pack. Re-checks everything, so calling this directly is no way around the screen.
  function add(input, opts) {
    opts = opts || {};
    var chk = inspect(input, opts);
    if (!chk.ok) return Promise.resolve({ ok: false, stage: chk.stage, messages: chk.messages, findings: chk.findings });
    var existing = decks[chk.pack.id] || null;
    // A deck the Soldier switched off stays off when its newer version is added.
    var row = P.toDeck(chk.pack, { enabled: existing ? existing.enabled : true, importedAt: opts.importedAt });
    return Promise.resolve().then(function () { return G.db.setSetting(deckKey(row.id), row); }).then(function () {
      decks[row.id] = row;
      bump();
      return { ok: true, id: row.id, replaced: !!existing, summary: chk.summary };
    }, function () {
      return { ok: false, stage: "save", messages: ["Couldn't save that on this device. Check that the device has free storage and try again."], findings: [] };
    });
  }

  function setEnabled(id, on) {
    var cur = decks[id];
    if (!cur) return Promise.resolve({ ok: false });
    var row = copyRow(cur);
    row.enabled = !!on;
    return Promise.resolve().then(function () { return G.db.setSetting(deckKey(id), row); }).then(function () {
      decks[id] = row;
      bump();
      return { ok: true };
    }, function () { return { ok: false }; });
  }

  // Deletes the review schedule kept for each of a deck's cards (Board Drill's "srs:" rows).
  function clearHistory(row) {
    return Promise.all(row.cards.map(function (c) { return G.db.del("kv", srsKey(P.unitCardId(row.id, c.id))); })).then(function () { return row.cards.length; });
  }
  // deleteHistory: false keeps the review progress (it comes back if the deck is added again).
  function remove(id, opts) {
    opts = opts || {};
    var cur = decks[id];
    if (!cur) return Promise.resolve({ ok: false });
    var row = copyRow(cur);
    return Promise.resolve().then(function () { return G.db.del("kv", deckKey(id)); }).then(function () {
      delete decks[id];
      bump();
      return opts.deleteHistory ? clearHistory(row) : 0;
    }).then(function (n) {
      return { ok: true, historyDeleted: !!opts.deleteHistory, cards: row.cards.length, cleared: n };
    }, function () { return { ok: false }; });
  }
  function resetHistory(id) {
    var cur = decks[id];
    if (!cur) return Promise.resolve({ ok: false });
    return clearHistory(copyRow(cur)).then(function (n) { return { ok: true, cleared: n }; }, function () { return { ok: false }; });
  }

  /* ---- reading a file the Soldier chose ---- */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error("no file")); return; }
      // Larger than the format allows: refuse before reading it into memory.
      if (typeof file.size === "number" && file.size > P.LIMITS.bytes + 4096) { resolve({ tooBig: true }); return; }
      if (typeof file.text === "function") { file.text().then(function (t) { resolve({ text: t }); }, reject); return; }
      var fr = new FileReader();
      fr.onload = function () { resolve({ text: String(fr.result || "") }); };
      fr.onerror = function () { reject(fr.error || new Error("read failed")); };
      fr.readAsText(file);
    });
  }

  /* ---- Settings -> Study Preferences -> Unit decks ---- */
  var NOTICE_ADD = "Only add a deck your own unit gave you. It is not for classified or controlled information. GUIDON looks for markings and personal details and will not add a deck that has any, but that check can miss things. The deck stays on this device.";
  var NOTICE_PREVIEW = "This deck comes from your unit. GUIDON has not checked it for accuracy, so it may be wrong or out of date, and it is not Army doctrine. Your unit's real orders and current publications always win. It never leaves this device. It is not for classified or controlled information.";

  function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }

  function renderPanel() {
    var panel = el("div.panel", { id: PANEL_ID, style: "margin-top:12px" });
    panel.appendChild(el("label", { text: "Unit decks" }));
    panel.appendChild(el("p.hint", { text: "Study a small deck your own unit wrote, such as local SOP facts, unit history or local board study material. It comes from your unit, not from GUIDON or the Army. It stays on this device, and its cards are labeled “Unit deck” wherever they show up." }));
    var listWrap = el("div", { "data-unit-decks-list": "1" });
    var addWrap = el("div", { "data-unit-decks-add": "1" });
    panel.appendChild(listWrap);
    panel.appendChild(addWrap);

    var openBtn = null;
    function focusOpen() { if (openBtn && openBtn.isConnected) openBtn.focus(); }

    function drawList(focusId) {
      util.clear(listWrap);
      var rows = sortedRows();
      if (!rows.length) {
        listWrap.appendChild(el("p.hint", { "data-unit-decks-empty": "1", text: "No unit decks yet." }));
        return;
      }
      rows.forEach(function (r) {
        var input = el("input", { type: "checkbox", "aria-label": "Study the unit deck " + r.name, "data-unit-deck-toggle": r.id });
        input.checked = !!r.enabled;
        input.addEventListener("change", function () {
          input.disabled = true;
          setEnabled(r.id, input.checked).then(function (res) {
            if (!res.ok) { input.checked = !input.checked; util.toast("Couldn't save that change."); }
            else say(r.name + (input.checked ? " is on. Its cards are in your study tools." : " is off. Its cards are hidden."));
            input.disabled = false;
          });
        });
        var meta = plural(r.cards.length, "card") + (r.unit ? " · " + r.unit : "") + " · version " + r.packVersion + " (" + r.packDate + ")";
        var resetBtn = el("button.btn.ghost.sm", { type: "button", text: "Reset progress", "aria-label": "Reset your review progress on the unit deck " + r.name, "data-unit-deck-reset": r.id });
        resetBtn.addEventListener("click", function () {
          G.modal.confirm("Reset your review progress on the " + plural(r.cards.length, "card") + " in “" + r.name + "”? The deck stays. This can't be undone.", { title: "Reset progress?", okText: "Reset", danger: true }).then(function (yes) {
            if (!yes) return;
            resetHistory(r.id).then(function (res) { util.toast(res.ok ? "Progress on this deck was reset." : "Couldn't reset that."); });
          });
        });
        var removeBtn = el("button.btn.ghost.sm", { type: "button", text: "Remove deck", "aria-label": "Remove the unit deck " + r.name, "data-unit-deck-remove": r.id });
        var row = el("div.unit-deck-row", { "data-unit-deck": r.id, style: "margin:12px 0;padding-top:10px;border-top:1px solid var(--line-2)" }, [
          el("div.switch", {}, [el("label.toggle", { style: "margin:0" }, [input, el("span.track")]), el("span", { text: r.name })]),
          el("p.hint", { text: meta + ". Not Army doctrine." }),
          el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:6px" }, [resetBtn, removeBtn]),
        ]);
        var confirmWrap = el("div", { "data-unit-deck-confirm": r.id });
        row.appendChild(confirmWrap);
        removeBtn.addEventListener("click", function () { drawRemove(r, confirmWrap, removeBtn); });
        listWrap.appendChild(row);
      });
      if (focusId) {
        var t = listWrap.querySelector('[data-unit-deck-toggle="' + focusId + '"]');
        if (t) t.focus();
      }
    }

    // Remove: asks first, and says what happens to the review progress.
    function drawRemove(r, host, opener) {
      util.clear(host);
      var name = "unit-deck-history-" + r.id;
      var keep = el("input", { type: "radio", name: name, id: name + "-keep", value: "keep", checked: "checked" });
      var del = el("input", { type: "radio", name: name, id: name + "-delete", value: "delete" });
      var go = el("button.btn.sm", { type: "button", text: "Remove deck", "data-unit-deck-remove-go": r.id });
      var cancel = el("button.btn.ghost.sm", { type: "button", text: "Cancel" });
      var box = el("div", { role: "group", "aria-label": "Remove " + r.name, style: "margin-top:8px;padding:10px;border:1px solid var(--line-2);border-radius:8px" }, [
        el("p", { text: "Remove “" + r.name + "” from this device? Its " + plural(r.cards.length, "card") + " will leave your study tools." }),
        el("p.hint", { text: "What about your review progress on those cards (what Board Drill has scheduled for you)?" }),
        el("div", { style: "margin:6px 0" }, [keep, el("label", { for: name + "-keep", style: "display:inline;margin-left:6px;text-transform:none;letter-spacing:normal", text: "Keep it, in case you add this deck again" })]),
        el("div", { style: "margin:6px 0" }, [del, el("label", { for: name + "-delete", style: "display:inline;margin-left:6px;text-transform:none;letter-spacing:normal", text: "Delete it too" })]),
        el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:8px" }, [go, cancel]),
      ]);
      host.appendChild(box);
      keep.focus();
      cancel.addEventListener("click", function () { util.clear(host); if (opener && opener.isConnected) opener.focus(); });
      go.addEventListener("click", function () {
        go.disabled = true;
        remove(r.id, { deleteHistory: del.checked }).then(function (res) {
          if (!res.ok) { go.disabled = false; util.toast("Couldn't remove that deck."); return; }
          drawList();
          focusOpen();
          say(r.name + " was removed." + (res.historyDeleted ? " Your review progress on it was deleted too." : " Your review progress on it was kept."));
        });
      });
    }

    // Add: file or paste -> check -> preview -> explicit confirm.
    function drawAddButton() {
      util.clear(addWrap);
      openBtn = el("button.btn.sm", { type: "button", text: "Add a unit deck", "data-unit-deck-open": "1" });
      openBtn.addEventListener("click", drawAddForm);
      addWrap.appendChild(el("div", { style: "margin-top:8px" }, [openBtn]));
    }

    function drawAddForm() {
      util.clear(addWrap);
      var fileIn = el("input", { type: "file", id: "unit-deck-file", accept: ".json,application/json,text/plain", "data-unit-deck-file": "1" });
      var textIn = el("textarea", { id: "unit-deck-text", rows: "5", "data-unit-deck-text": "1", spellcheck: "false", autocomplete: "off" });
      var checkBtn = el("button.btn.sm", { type: "button", text: "Check this deck", "data-unit-deck-check": "1" });
      var cancelBtn = el("button.btn.ghost.sm", { type: "button", text: "Cancel" });
      var result = el("div", { "data-unit-deck-result": "1", style: "margin-top:10px" });
      var form = el("div", { role: "group", "aria-label": "Add a unit deck", style: "margin-top:10px;padding:10px;border:1px solid var(--line-2);border-radius:8px" }, [
        el("p.hint", { "data-unit-deck-notice": "1", text: NOTICE_ADD }),
        el("label", { for: "unit-deck-file", text: "Choose the deck file (.json)" }), fileIn,
        el("label", { for: "unit-deck-text", style: "margin-top:8px", text: "Or paste the deck text here" }), textIn,
        el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:8px" }, [checkBtn, cancelBtn]),
        result,
      ]);
      addWrap.appendChild(form);
      fileIn.focus();

      cancelBtn.addEventListener("click", function () { drawAddButton(); focusOpen(); });
      // Choosing a file replaces whatever was pasted, and the other way round: one source at a time.
      fileIn.addEventListener("change", function () { if (fileIn.files && fileIn.files.length) textIn.value = ""; util.clear(result); });
      textIn.addEventListener("input", function () { if (textIn.value && fileIn.value) { try { fileIn.value = ""; } catch (e) { /* some browsers refuse to clear a file input */ } } });

      checkBtn.addEventListener("click", function () {
        util.clear(result);
        checkBtn.disabled = true;
        var file = fileIn.files && fileIn.files[0];
        var source = file ? readFile(file) : Promise.resolve({ text: textIn.value });
        source.then(function (got) {
          if (got.tooBig) return { ok: false, stage: "format", messages: ["That file is bigger than the " + (P.LIMITS.bytes / 1024) + " KB a unit deck may be."], findings: [] };
          return inspect(got.text);
        }, function () {
          return { ok: false, stage: "read", messages: ["GUIDON couldn't read that file. Try choosing it again, or paste the deck text."], findings: [] };
        }).then(function (chk) {
          checkBtn.disabled = false;
          if (!form.isConnected) return;
          if (!chk.ok) drawRefusal(result, chk);
          else drawPreview(result, chk, function () { drawAddButton(); focusOpen(); });
        }).then(null, function () {
          // Nothing above is expected to throw; if something does, say so plainly and let the Soldier try again.
          checkBtn.disabled = false;
          if (form.isConnected) drawRefusal(result, { stage: "read", messages: ["Something went wrong while checking that deck. Nothing was saved. Try again, or paste the deck text instead."], findings: [] });
        });
      });
    }

    function drawRefusal(host, chk) {
      util.clear(host);
      var box = el("div", { role: "alert", "data-unit-deck-refused": chk.stage });
      box.appendChild(el("p", { style: "font-weight:600", text: "This deck was not added. Nothing was saved." }));
      if (chk.stage === "screen") box.appendChild(el("p.hint", { text: "GUIDON found something that does not belong in a study deck. It does not add a deck at all if it finds any of these:" }));
      var ul = el("ul", { style: "margin:6px 0 6px 18px" });
      chk.messages.forEach(function (m) { ul.appendChild(el("li", { text: m })); });
      box.appendChild(ul);
      if (chk.truncated) box.appendChild(el("p.hint", { text: "There are more problems than are listed here." }));
      if (chk.stage !== "newer") box.appendChild(el("p.hint", { text: "Fix the deck and try again, or ask your unit for a corrected copy." }));
      host.appendChild(box);
    }

    function drawPreview(host, chk, done) {
      util.clear(host);
      var s = chk.summary;
      var box = el("div", { role: "region", "aria-label": "Deck preview", "data-unit-deck-preview": s.id });
      box.appendChild(el("p", { style: "font-weight:600", text: "Ready to add: " + s.name }));
      box.appendChild(el("p.hint", { text: (s.unit ? "From: " + s.unit + " · " : "") + "version " + s.packVersion + " (" + s.packDate + ")" }));
      box.appendChild(el("p.hint", { "data-unit-deck-counts": "1", text: plural(s.cards, "card") + " in " + plural(s.categories.length, "category", "categories") + ": " + s.categories.map(function (c) { return c.name + " (" + c.count + ")"; }).join(", ") }));
      if (chk.replaces) {
        box.appendChild(el("p", { "data-unit-deck-replaces": "1", text: "You already have a deck with this id: “" + chk.replaces.name + "”" + (chk.replaces.unit ? " from " + chk.replaces.unit : "") + ", version " + chk.replaces.packVersion + " (" + chk.replaces.packDate + "). Adding this replaces it. Your review progress on cards that are still in the deck is kept." }));
      }
      box.appendChild(el("div.eyebrow", { style: "margin-top:8px", text: "Sample cards" }));
      s.samples.forEach(function (c, i) {
        box.appendChild(el("div.unit-deck-sample", { "data-unit-deck-sample": String(i), style: "margin:6px 0;padding:8px;border:1px solid var(--line-2);border-radius:8px" }, [
          el("div.hint", { text: c.category }),
          el("div", { text: "Q: " + trunc(c.q, 200) }),
          el("div", { text: "A: " + trunc(c.a, 240) }),
          c.source ? el("div.hint", { text: "Source (as your unit wrote it): " + trunc(c.source, 160) }) : null,
        ]));
      });
      if (s.reciteTitles.length) {
        box.appendChild(el("p.hint", { text: "This deck suggests these titles for My unit in Recitation Drill: " + s.reciteTitles.join(", ") + ". It carries no words to recite. You add your own." }));
      }
      box.appendChild(el("p", { "data-unit-deck-preview-notice": "1", text: NOTICE_PREVIEW }));
      var add1 = el("button.btn.primary.sm", { type: "button", text: "Add this deck", "data-unit-deck-confirm-add": "1" });
      var no = el("button.btn.ghost.sm", { type: "button", text: "Cancel" });
      box.appendChild(el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:8px" }, [add1, no]));
      host.appendChild(box);
      add1.focus();
      no.addEventListener("click", done);
      add1.addEventListener("click", function () {
        add1.disabled = true;
        add(chk.pack).then(function (res) {
          if (!res.ok) { add1.disabled = false; drawRefusal(host, { stage: res.stage, messages: res.messages, findings: res.findings }); return; }
          drawAddButton();
          drawList(res.id);
          say((res.replaced ? "Replaced " : "Added ") + s.name + ". Its cards now show up in Board Drill, Quiz and Rapid Fire as Unit deck: " + s.name + ".");
          util.toast((res.replaced ? "Replaced " : "Added ") + s.name + ".");
        });
      });
    }

    drawList();
    drawAddButton();
    return panel;
  }

  G.unitDecks = {
    PANEL_ID: PANEL_ID,
    load: load, list: list, deck: deck, cards: cards, rev: function () { return rev; }, suggestedTitles: suggestedTitles,
    inspect: inspect, add: add, setEnabled: setEnabled, remove: remove, resetHistory: resetHistory,
    readFile: readFile, renderPanel: renderPanel
  };
})();
