/* GUIDON - Recall ladder (an OPTIONAL study mode inside Recitation Drill)

   Five steps, from reading the whole text to reciting it with nothing on
   screen. The Soldier says how each try went; two clean tries move them up a
   step, one miss moves them down one. They can also pick any step by hand.

   WHERE IT LIVES: views.recite (src/index.html) shows it as a fifth study
   mode, "Recall ladder", next to Full text / First letters / Chunk &
   memorize / Timed recitation - for every recitable text, bundled creeds
   and the Soldier's own "My unit" text alike. It adds no route and changes
   no default: Recitation Drill still opens on "Full text", and nothing here
   runs until the Soldier taps the mode. Choosing the mode IS the opt-in,
   which is why there is no separate on/off switch to get out of sync.

   WHY this module owns the screen as well as the maths: the first release
   shipped only the helper functions, with no screen anywhere that used
   them, while What's New told Soldiers the feature was there. mount() below
   is the screen, so the two can never drift apart again.

   NO SECOND SCHEDULER: the ladder never writes a review grade itself. When a
   Soldier recites from memory twice in a row it hands back to the caller
   (opts.onMastered), and Recitation Drill shows the same "How well do you
   know it?" grade row Chunk & memorize already uses.
*/
(function () {
  "use strict";
  var G = window.G = window.G || {};
  G.memorization = G.memorization || {};

  function textOf(item) {
    if (!item) return "";
    if (Array.isArray(item.lines) && item.lines.length) return item.lines.join("\n");
    return String(item.fullText || item.a || item.boardAnswer || "");
  }

  function words(text) {
    return String(text || "").match(/\b[A-Za-z][A-Za-z']*\b/g) || [];
  }

  // Deterministic cloze: the same material always hides the same words at a
  // given level, which makes progress comparable instead of randomly easier.
  function cloze(text, ratio) {
    var source = String(text || "");
    var total = words(source).length;
    if (!total || ratio <= 0) return source;
    var hide = Math.max(1, Math.round(total * Math.min(1, ratio)));
    var seen = 0, hidden = 0;
    return source.replace(/\b[A-Za-z][A-Za-z']*\b/g, function (word) {
      var remainingWords = total - seen;
      var remainingHide = hide - hidden;
      var shouldHide = remainingHide > 0 && (remainingHide / remainingWords >= 0.5 || ((seen * 37 + 11) % total) < hide);
      seen++;
      if (!shouldHide) return word;
      hidden++;
      return "______";
    });
  }

  function firstLetters(text) {
    if (G.util && typeof G.util.firstLetterPrompt === "function") return G.util.firstLetterPrompt(text);
    return String(text || "").replace(/\b([A-Za-z])[A-Za-z']*\b/g, "$1");
  }

  // Labels are what the Soldier reads on the step chips, so they are plain
  // words. None of them repeats a study-mode chip's own label ("Full text",
  // "First letters"): two controls with the same name on one screen is a
  // trap for anyone using a screen reader or voice control.
  var LEVELS = [
    { id:"full", label:"Whole text", help:"Read the whole text out loud." },
    { id:"easy", label:"A few words hidden", help:"About one word in five is blanked out. Say the whole text, filling the gaps." },
    { id:"medium", label:"Half hidden", help:"About half the words are blanked out. Say the whole text, filling the gaps." },
    { id:"initials", label:"First letters only", help:"Only the first letter of each word is left. Say the whole text." },
    { id:"unaided", label:"From memory", help:"Nothing on screen. Recite it out loud from memory." }
  ];

  function prompt(item, levelId) {
    var text = textOf(item);
    if (levelId === "easy") return cloze(text, 0.20);
    if (levelId === "medium") return cloze(text, 0.50);
    if (levelId === "initials") return firstLetters(text);
    if (levelId === "unaided") return "";
    return text;
  }

  function indexOf(levelId) {
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === levelId) return i;
    return 0;
  }
  function validLevel(levelId) {
    return LEVELS.some(function (x) { return x.id === levelId; }) ? levelId : "full";
  }
  // A saved row can be hand-edited or arrive from an old backup: anything
  // that is not a small whole number counts as "no clean tries yet" rather
  // than becoming NaN and freezing the ladder on one step.
  function cleanStreak(n) {
    n = Number(n);
    return (isFinite(n) && n > 0) ? Math.min(Math.floor(n), 99) : 0;
  }

  // Adaptive movement is intentionally conservative: two successful attempts
  // advance; one failed attempt steps back. The learner can always override.
  function nextLevel(state, success) {
    state = state || {};
    var i = indexOf(validLevel(state.level));
    var streak = cleanStreak(state.streak);
    if (success) {
      streak++;
      if (streak >= 2 && i < LEVELS.length - 1) { i++; streak = 0; }
    } else {
      streak = 0;
      if (i > 0) i--;
    }
    return { level: LEVELS[i].id, streak: streak };
  }
  // Two clean tries in a row on the top step.
  function isMastered(state) {
    return !!state && state.level === LEVELS[LEVELS.length - 1].id && cleanStreak(state.streak) >= 2;
  }

  function storageKey(id) { return "recall-ladder:" + id; }
  async function load(id) {
    if (!G.db || typeof G.db.get !== "function") return { level:"full", streak:0 };
    var row = await G.db.get("kv", storageKey(id));
    var v = (row && row.v && typeof row.v === "object" && !Array.isArray(row.v)) ? row.v : {};
    return { level: validLevel(v.level), streak: cleanStreak(v.streak) };
  }
  async function save(id, state) {
    var clean = { level: validLevel(state && state.level), streak: cleanStreak(state && state.streak) };
    if (G.db && typeof G.db.put === "function") await G.db.put("kv", { k: storageKey(id), v: clean });
    return clean;
  }
  function forget(id) {
    if (G.db && typeof G.db.del === "function") return G.db.del("kv", storageKey(id));
    return Promise.resolve();
  }

  /* mount(container, item, opts) - draws the mode into `container`.
       opts.isCurrent()            -> false once the Soldier has moved to a
                                      different mode or text; every async
                                      step re-checks it before touching the
                                      page, so a slow save can never paint
                                      over the screen they moved on to (the
                                      same guard Chunk & memorize uses).
       opts.onMastered(container)  -> called after two clean tries in a row
                                      on "From memory"; the caller decides
                                      what goes there (the grade row for a
                                      bundled creed, a plain note for the
                                      Soldier's own text).
     Every redraw puts keyboard focus back on the control that was just
     used, so it never falls back to the top of the page, and every change
     of step is spoken through G.util.announce. */
  function mount(container, item, opts) {
    opts = opts || {};
    var util = G.util, el = util.el;
    var id = item && item.id;
    // Leaving the ladder and coming straight back starts a SECOND mount in
    // the same container while the first one may still have a save in
    // flight. isCurrent() alone cannot tell the two apart (the mode is
    // "ladder" again), so each mount takes a number and only the newest one
    // may draw - otherwise the older one could repaint a step the Soldier
    // has already moved on from.
    var turn = (container.__ladderTurn = (container.__ladderTurn || 0) + 1);
    var current = function () {
      return container.__ladderTurn === turn && (typeof opts.isCurrent === "function" ? !!opts.isCurrent() : true);
    };
    var revealed = false;

    function draw(state, focus) {
      if (!current()) return;
      util.clear(container);
      var level = LEVELS[indexOf(state.level)];

      container.appendChild(el("p.hint", { text:
        "Optional. Work up from reading the whole text to reciting it from memory. Say the text out loud, then tell GUIDON how it went: two clean tries move you up a step, a miss moves you down one. You can also pick any step yourself." }));

      var stepRow = el("div.search-filters", { "aria-label": "Recall ladder step" });
      var stepBtns = {};
      LEVELS.forEach(function (lv, i) {
        var on = lv.id === state.level;
        var b = el("button.chip.search-chip" + (on ? ".active" : ""),
          { type: "button", text: (i + 1) + ". " + lv.label, "aria-pressed": String(on), "data-ladder-step": lv.id });
        b.addEventListener("click", function () {
          if (lv.id === state.level) return;
          revealed = false;
          commit({ level: lv.id, streak: 0 }, { step: lv.id }, "Step " + (i + 1) + ", " + lv.label + ".");
        });
        stepBtns[lv.id] = b;
        stepRow.appendChild(b);
      });
      container.appendChild(stepRow);

      container.appendChild(el("p.hint", { text: level.help, "data-ladder-help": "1" }));

      var shown = prompt(item, state.level);
      if (shown) {
        // pre-line keeps the text's own line breaks; anywhere lets a long
        // run of blanks wrap instead of pushing a phone screen sideways.
        container.appendChild(el("p.mono", { text: shown, "data-ladder-prompt": "1",
          style: "white-space:pre-line;overflow-wrap:anywhere" }));
      }

      var revealBtn = null;
      if (state.level !== "full") {
        revealBtn = el("button.btn.sm.ghost", { type: "button", "data-ladder-reveal": "1",
          text: revealed ? "Hide the text" : "Show the text to check yourself", "aria-expanded": String(revealed) });
        revealBtn.addEventListener("click", function () { revealed = !revealed; draw(state, { reveal: true }); });
        container.appendChild(revealBtn);
        if (revealed) {
          container.appendChild(el("p", { text: textOf(item), "data-ladder-answer": "1",
            style: "white-space:pre-line;overflow-wrap:anywhere;margin-top:8px" }));
        }
      }

      var tries = cleanStreak(state.streak);
      container.appendChild(el("p.hint", { "data-ladder-status": "1", style: "margin-top:10px", text:
        isMastered(state) ? "From memory, twice in a row. That is the top of the ladder."
          : tries === 1 ? "One clean try on this step. One more moves you up."
          : "No clean tries on this step yet." }));

      var reportRow = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px" });
      var gotBtn = el("button.btn.primary", { type: "button", text: "Got it", "data-ladder-report": "got" });
      var missBtn = el("button.btn.ghost", { type: "button", text: "Missed it", "data-ladder-report": "miss" });
      gotBtn.addEventListener("click", function () { report(state, true); });
      missBtn.addEventListener("click", function () { report(state, false); });
      reportRow.appendChild(gotBtn); reportRow.appendChild(missBtn);
      container.appendChild(reportRow);

      if (isMastered(state) && typeof opts.onMastered === "function") {
        var masteredBox = el("div", { "data-ladder-mastered": "1", style: "margin-top:10px" });
        container.appendChild(masteredBox);
        opts.onMastered(masteredBox);
      }

      if (focus) {
        if (focus.step && stepBtns[focus.step]) stepBtns[focus.step].focus();
        else if (focus.report === "got") gotBtn.focus();
        else if (focus.report === "miss") missBtn.focus();
        else if (focus.reveal && revealBtn) revealBtn.focus();
      }
    }

    function commit(next, focus, message) {
      save(id, next).then(function (clean) {
        if (!current()) return;
        draw(clean, focus);
        if (message && util.announce) util.announce(message);
      }, function () {
        if (!current()) return;
        // Still let them keep practising; only the saved place is lost.
        draw(next, focus);
        if (util.toast) util.toast("Couldn't save your place on the ladder.");
      });
    }

    function report(state, success) {
      var next = nextLevel(state, success);
      var from = indexOf(state.level), to = indexOf(next.level);
      var message;
      if (to > from) message = "Moved up to step " + (to + 1) + ", " + LEVELS[to].label + ".";
      else if (to < from) message = "Moved down to step " + (to + 1) + ", " + LEVELS[to].label + ".";
      else if (isMastered(next)) message = "From memory, twice in a row. Top of the ladder.";
      else if (success) message = "Clean try. One more moves you up.";
      else message = "Staying on step " + (to + 1) + ", " + LEVELS[to].label + ".";
      if (to !== from) revealed = false;
      commit(next, { report: success ? "got" : "miss" }, message);
    }

    load(id).then(function (state) { draw(state, null); }, function () { draw({ level: "full", streak: 0 }, null); });
  }

  G.memorization.recallLadder = {
    optional: true,
    placement: "recitation-detail",
    modeLabel: "Recall ladder",
    levels: LEVELS.slice(),
    textOf: textOf,
    prompt: prompt,
    cloze: cloze,
    firstLetters: firstLetters,
    nextLevel: nextLevel,
    isMastered: isMastered,
    load: load,
    save: save,
    forget: forget,
    storageKey: storageKey,
    supports: function (item) { return !!textOf(item).trim(); },
    mount: mount
  };
})();
