/* GUIDON — date-grid.js : shared weekday-grid component (global G.dateGrid)
 *
 * ROADMAP 3g "customizable screen layouts", Phase A: the one real piece of
 * new shared infrastructure a "shared" layout needs to actually BE shared,
 * rather than two screens each drawing their own grid that merely looks
 * similar. PT Planner's and Career Calendar's own "Shared grid" layouts
 * each build a week of date-cells in their own module's own shape (session
 * effort tags / tracked-date urgency) and hand them to renderWeek() here -
 * this is the only place that actually draws a 7-day grid, so the SAME
 * rendered component does double duty for both screens.
 *
 * Pure rendering: this module owns no storage of its own and never calls
 * into pt-planner.js or calendar.js - see manifest.json's "requires": []
 * for why (it must load BEFORE both of them, since each adds "date-grid" to
 * its own "requires").
 *
 * Date-cell shape (see the Phase A brief this shipped from):
 *   { iso, date, weekday, isToday, title, sub,
 *     tone: { level: "red" | "amber" | "green" | "neutral" },
 *     link, source: "pt-planner" | "calendar",
 *     actions: [{ label, onClick }] }
 * Every field is optional except `iso` - a cell missing `title`/`tone`/etc.
 * still renders (an empty day column), so a caller with a sparse week (e.g.
 * Career Calendar on a day with nothing tracked) doesn't need to pad shape.
 */
(function () {
  "use strict";
  var G = window.G || (window.G = {});
  var util = G.util, el = util.el;

  // tone.level -> the app's own real CSS custom properties (never a
  // hardcoded hex) - same --red/--amber/--green vocabulary every other
  // urgency-colored surface in the app already uses (calendar.js's
  // urgency()/sharedUrgency(), reminders.js's urgencyFor()), so a themed
  // Soldier sees the same colors here as everywhere else.
  var TONE_VAR = { red: "var(--red)", amber: "var(--amber)", green: "var(--green)", neutral: "var(--text-dim)" };
  function toneColor(tone) {
    var level = (tone && tone.level) || "neutral";
    return TONE_VAR[level] || TONE_VAR.neutral;
  }

  // Draws a 7(ish)-day grid into `mount` (cleared first, like every other
  // module's own render(mount) convention). `opts`:
  //   activeSource - which source's data `cells` currently holds ("pt-planner"|"calendar")
  //   sources       - [{id,label}, ...] to offer in the switcher; omitted/1 entry = no switcher
  //   onSwitch      - function(id) called when a different source tab is picked
  function renderWeek(mount, cells, opts) {
    opts = opts || {};
    util.clear(mount);
    var wrap = el("div.date-grid", { "data-date-grid": "1" });

    if (typeof opts.onSwitch === "function" && Array.isArray(opts.sources) && opts.sources.length > 1) {
      var switcher = el("div.segmented.date-grid-switch", { role: "tablist", "aria-label": "Show" });
      opts.sources.forEach(function (s) {
        if (!s || !s.id) return;
        var active = s.id === opts.activeSource;
        var b = el("button", { type: "button", role: "tab", text: s.label || s.id, "aria-selected": String(active) });
        if (active) b.classList.add("active");
        b.addEventListener("click", function () {
          if (s.id !== opts.activeSource) opts.onSwitch(s.id);
        });
        switcher.appendChild(b);
      });
      wrap.appendChild(switcher);
      if (util.tabbarKeys) util.tabbarKeys(switcher);
    }

    var grid = el("div.date-grid-row", { role: "list", "aria-label": "Week" });
    (Array.isArray(cells) ? cells : []).forEach(function (c) {
      if (!c) return;
      var col = el("div.date-grid-col" + (c.isToday ? ".is-today" : ""), { role: "listitem" });
      col.style.borderTopColor = toneColor(c.tone);
      col.appendChild(el("div.date-grid-weekday", { text: c.weekday || "" }));
      col.appendChild(el("div.date-grid-date", { text: c.date || "" }));
      if (c.title) col.appendChild(el("div.date-grid-title", { text: c.title }));
      if (c.sub) col.appendChild(el("div.date-grid-sub", { text: c.sub }));
      if (c.link) {
        var open = el("button.btn.sm.ghost", { type: "button", text: "Open" });
        open.addEventListener("click", function () { location.hash = c.link; });
        col.appendChild(open);
      }
      (Array.isArray(c.actions) ? c.actions : []).forEach(function (a) {
        if (!a || typeof a.onClick !== "function") return;
        var btn = el("button.btn.sm.ghost", { type: "button", text: a.label || "Action" });
        btn.addEventListener("click", a.onClick);
        col.appendChild(btn);
      });
      grid.appendChild(col);
    });
    wrap.appendChild(grid);
    mount.appendChild(wrap);
    return wrap;
  }

  G.dateGrid = { renderWeek: renderWeek };
})();
