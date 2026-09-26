/* GUIDON — roadmap feature bootstrap.
 * Keeps the large legacy shell stable: adds three modular routes at runtime,
 * exposes them from existing navigation surfaces, and extends Reminders with
 * PT. (Collective Decision mode used to be layered on here by replacing
 * G.engine.run; it is a real mode of the core engine now - ROADMAP 3g item H.)
 */
(function () {
  "use strict";
  var G = window.G || (window.G = {});
  // The one place a screen registers what it can RECEIVE from a Study Room
  // (kind -> adapter; see src/app-modules/studygroup.js "HAND-OFFS" and
  // room-schema.js "THE HAND-OFF MODEL"). PT Planner and Team Training fill it
  // in as they load; Study Rooms reads it when an offer arrives. It lives
  // here, first, so no load order between those three matters.
  G.roomHandoffAdapters = G.roomHandoffAdapters || {};
  if (!G.routes || !G.util) return;
  var util = G.util, el = util.el;

  function addRoute(hash, label, ico, render) {
    if (G.routes.some(function (r) { return r.hash === hash; })) return;
    G.routes.push({ hash:hash, label:label, ico:ico, render:render });
  }
  addRoute("#/board-sim", "Board Simulator", "target", function (m) { return G.mockBoardSim.render(m); });
  addRoute("#/team", "Team Training", "users", function (m) { return G.teamTraining.render(m); });
  addRoute("#/pt-plan", "PT Planner", "calendar", function (m) { return G.ptPlanner.render(m); });

  // The reminders editor reads the same KINDS array exported here, so mutating
  // it once adds PT to both programmatic quick-adds and the manual picker.
  if (G.reminders && Array.isArray(G.reminders.KINDS) && !G.reminders.KINDS.some(function (k) { return k.id === "pt"; })) {
    G.reminders.KINDS.push({ id:"pt", label:"Planned PT session", hint:"A dated session created by PT Planner." });
  }

  function addLaunchPanel(mount, title, copy, buttons) {
    if (!mount || mount.querySelector("[data-roadmap-launch='" + title + "']")) return;
    var p = el("div.panel", { "data-roadmap-launch":title, style:"margin-top:12px" });
    p.appendChild(el("div.eyebrow", { text:title }));
    p.appendChild(el("p.hint", { text:copy }));
    var row = el("div.btn-row");
    buttons.forEach(function (b) {
      var btn = el("button.btn.ghost", { type:"button", text:b.label });
      btn.addEventListener("click", function () { location.hash = b.hash; });
      row.appendChild(btn);
    });
    p.appendChild(row); mount.appendChild(p);
  }

  // These are the discoverability anchors. The new routes are real routes in
  // the same ROUTES array (G.routes is that array), but NAV_GROUPS is private
  // legacy-shell state; placing launchers in the nearest existing first-class
  // surfaces avoids a second navigation system and keeps this modular batch
  // from rewriting the 9.9 MB shell solely to add three sidebar rows.
  //
  // They hang off core's named extension points (G.ext, util.js). They used
  // to REPLACE G.board.render, G.drills.render and G.views.prt with wrappers,
  // which only held while no other module wrapped the same function and this
  // file happened to load first. G.ext.on is called with no typeof guard on
  // purpose: if the registry or a point ever goes away this must fail out
  // loud, not quietly stop showing three launch panels.
  G.ext.on("board:rendered", function (m) {
    addLaunchPanel(m, "Board Simulator", "Rehearse a whole board appearance in one sitting: report in, answer timed questions, work a leadership problem, then write your after-action notes. Works with no signal.",
      [{ label:"Open Board Simulator", hash:"#/board-sim" }]);
  });
  G.ext.on("drills:rendered", function (m) {
    addLaunchPanel(m, "Collective leader tools", "Optional team-development and PT-planning surfaces built on GUIDON's existing drills, scenarios, roster, and reminders.",
      [{ label:"Team Training", hash:"#/team" }, { label:"PT Planner", hash:"#/pt-plan" }]);
  });
  G.ext.on("prt:rendered", function (m) {
    addLaunchPanel(m, "Plan the week", "Turn the verified PRT reference plus GUIDON's broader drill/checklist surfaces into an editable weekly schedule.",
      [{ label:"Open PT Planner", hash:"#/pt-plan" }]);
  });
})();
