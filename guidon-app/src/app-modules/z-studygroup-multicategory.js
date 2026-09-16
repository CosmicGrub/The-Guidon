/* GUIDON Study Rooms: backward-compatible multi-category deck selection.
   This is deliberately an additive shim over studygroup.js. The room wire
   schema remains v1: selected categories are encoded into the existing
   <=80-char deck.category string, so older peers still validate snapshots.
   New peers decode the label and filter their local board bank accordingly.
   Board rooms already send explicit card ids, while relay rooms use the
   filtered local bank for Rapid Fire. */
(function (root) {
  "use strict";
  var G = root.G || {};
  if (!G.studyGroup || !G.store || typeof G.store.boardQuestions !== "function") return;

  var PREFIX = "Multi: ";
  var SEP = " + ";
  var originalHost = G.studyGroup.host;
  var originalRender = G.studyGroup.render;
  var originalBoardQuestions = G.store.boardQuestions.bind(G.store);

  function clean(xs) {
    var seen = {}, out = [];
    (Array.isArray(xs) ? xs : [xs]).forEach(function (x) {
      x = String(x == null ? "" : x).trim();
      if (!x || x === "All" || seen[x]) return;
      seen[x] = 1; out.push(x);
    });
    return out;
  }
  function encode(xs) {
    xs = clean(xs);
    if (!xs.length) return "All";
    if (xs.length === 1) return xs[0];
    var s = PREFIX + xs.join(SEP);
    return s.length <= 80 ? s : PREFIX + xs.join("+").slice(0, 80 - PREFIX.length);
  }
  function decode(s) {
    s = String(s == null ? "" : s);
    if (s.indexOf(PREFIX) !== 0) return null;
    return clean(s.slice(PREFIX.length).split(/\s*\+\s*/));
  }
  function activeCategories() {
    try {
      var st = G.studyGroup.state();
      return st && st.deck ? decode(st.deck.category) : null;
    } catch (e) { return null; }
  }

  /* Keep every existing boardQuestions() caller unchanged unless a
     multi-category room is active. This lets studygroup.js's existing
     poolFor() remain the single pool-selection path without changing the
     protocol or duplicating the Rapid Fire engine. */
  G.store.boardQuestions = function () {
    var all = originalBoardQuestions.apply(null, arguments);
    var cats = activeCategories();
    if (!cats || !cats.length || !Array.isArray(all)) return all;
    var wanted = {};
    cats.forEach(function (c) { wanted[c] = 1; });
    var filtered = all.filter(function (q) { return q && wanted[q.category]; });
    return filtered.length ? filtered : all;
  };

  G.studyGroup.host = function (opts) {
    opts = Object.assign({}, opts || {});
    var picked = clean(opts.categories || []);
    /* The idle UI stores its multi-select choice here immediately before
       the original click handler calls host(). Programmatic callers can
       pass categories directly. Single-category callers are untouched. */
    if (!picked.length && G.studyGroup._multiCategories) picked = clean(G.studyGroup._multiCategories);
    if (picked.length) opts.category = encode(picked);
    return originalHost(opts);
  };

  function enhance(rootEl) {
    var sel = rootEl && rootEl.querySelector ? rootEl.querySelector("select.sg-category") : null;
    if (!sel || sel.dataset.multiCategory === "1") return;
    sel.dataset.multiCategory = "1";
    sel.multiple = true;
    sel.size = Math.min(6, Math.max(3, sel.options.length));
    sel.setAttribute("aria-label", "Categories");
    var label = sel.previousElementSibling;
    if (label && label.tagName === "LABEL") label.textContent = "Categories";
    var hint = root.document.createElement("p");
    hint.className = "hint sg-category-hint";
    hint.textContent = "Choose one or more categories. Use Ctrl/Command-click (or your platform's multi-select gesture) for a mixed deck.";
    sel.parentNode.insertBefore(hint, sel.nextSibling);
    function remember() {
      var vals = Array.prototype.map.call(sel.selectedOptions || [], function (o) { return o.value; });
      if (vals.indexOf("All") >= 0 && vals.length > 1) vals = vals.filter(function (v) { return v !== "All"; });
      G.studyGroup._multiCategories = clean(vals);
    }
    sel.addEventListener("change", remember);
    var hostBtn = rootEl.querySelector("button.sg-host");
    if (hostBtn) hostBtn.addEventListener("click", remember, true);
  }

  G.studyGroup.render = function (mount) {
    var out = originalRender(mount);
    try { enhance(mount || root.document); } catch (e) {}
    return out;
  };

  /* Small pure surface for regression tests; no protocol internals exposed. */
  G.studyGroup.multiCategory = { encode: encode, decode: decode, clean: clean };
})(typeof window !== "undefined" ? window : globalThis);
