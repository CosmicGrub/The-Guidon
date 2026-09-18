/* GUIDON - Optional Adaptive Recall Ladder
   An opt-in memorization helper for recitable materials. This deliberately
   does NOT create a new main route, alter default navigation, or replace any
   existing study mode. Consumers may surface it as an optional method inside
   Recitation Drill / memorization-capable detail views.
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

  var LEVELS = [
    { id:"full", label:"Full text", help:"Read and rehearse the complete material." },
    { id:"easy", label:"Easy · 20% hidden", help:"Recall missing words with most context visible." },
    { id:"medium", label:"Medium · 50% hidden", help:"Recall about half of the material from context." },
    { id:"initials", label:"Hard · first letters", help:"Use only first-letter cues for each word." },
    { id:"unaided", label:"Unaided", help:"Recite from memory with no text prompt." }
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
    var i = LEVELS.findIndex(function (x) { return x.id === levelId; });
    return i < 0 ? 0 : i;
  }

  // Adaptive movement is intentionally conservative: two successful attempts
  // advance; one failed attempt steps back. The learner can always override.
  function nextLevel(state, success) {
    state = state || {};
    var i = indexOf(state.level || "full");
    var streak = Number(state.streak || 0);
    if (success) {
      streak++;
      if (streak >= 2 && i < LEVELS.length - 1) { i++; streak = 0; }
    } else {
      streak = 0;
      if (i > 0) i--;
    }
    return { level: LEVELS[i].id, streak: streak };
  }

  function storageKey(id) { return "recall-ladder:" + id; }
  async function load(id) {
    if (!G.db || typeof G.db.get !== "function") return { enabled:false, level:"full", streak:0 };
    var row = await G.db.get("kv", storageKey(id));
    var v = row && row.v ? row.v : {};
    return { enabled: v.enabled === true, level: LEVELS.some(function(x){return x.id===v.level;}) ? v.level : "full", streak: Number(v.streak || 0) };
  }
  async function save(id, state) {
    var clean = { enabled: state && state.enabled === true, level: LEVELS.some(function(x){return x.id===state.level;}) ? state.level : "full", streak: Number(state && state.streak || 0) };
    if (G.db && typeof G.db.put === "function") await G.db.put("kv", { k: storageKey(id), v: clean });
    return clean;
  }

  G.memorization.recallLadder = {
    optional: true,
    defaultEnabled: false,
    placement: "recitation-detail",
    levels: LEVELS.slice(),
    textOf: textOf,
    prompt: prompt,
    cloze: cloze,
    firstLetters: firstLetters,
    nextLevel: nextLevel,
    load: load,
    save: save,
    storageKey: storageKey,
    supports: function (item) { return !!textOf(item).trim(); }
  };
})();
