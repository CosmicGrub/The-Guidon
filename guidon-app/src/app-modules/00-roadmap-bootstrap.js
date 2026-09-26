/* GUIDON — roadmap feature bootstrap.
 * Keeps the large legacy shell stable: adds three modular routes at runtime,
 * exposes them from existing navigation surfaces, extends Reminders with PT,
 * and layers collective mode onto the public G.engine.run API while delegating
 * every ordinary scenario to the original engine unchanged.
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
  if (!G.routes || !G.engine || !G.util) return;
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

  // ---------------- Collective adapter on the shared public engine API ----------------
  var originalRun = G.engine.run.bind(G.engine);
  if (!G.engine._soloRun) G.engine._soloRun = originalRun;

  function condMet(cond, flags) {
    if (cond == null) return true;
    if (typeof cond === "string") return !!flags[cond];
    if (Array.isArray(cond)) return cond.every(function (c) { return condMet(c, flags); });
    if (typeof cond === "object") {
      if (cond.all) return cond.all.every(function (c) { return condMet(c, flags); });
      if (cond.any) return cond.any.some(function (c) { return condMet(c, flags); });
      if (cond.not) return !condMet(cond.not, flags);
      if (cond.flag) return Object.prototype.hasOwnProperty.call(cond, "is") ? flags[cond.flag] === cond.is : !!flags[cond.flag];
    }
    return true;
  }
  function visible(node, flags) {
    return (node.choices || []).filter(function (c) { return condMet(c.showIf != null ? c.showIf : c.requires, flags); });
  }
  function scenarioHasDiscuss(sc) {
    return Object.keys((sc && sc.nodes) || {}).some(function (k) { return !!sc.nodes[k].discuss; });
  }
  function sumScore(score) {
    return Object.keys(score).reduce(function (n, k) { return n + (Number(score[k]) || 0); }, 0);
  }
  function applyChoice(sess, c) {
    if (c.score) Object.keys(c.score).forEach(function (k) { sess.score[k] = (sess.score[k] || 0) + (Number(c.score[k]) || 0); });
    if (c.set) Object.keys(c.set).forEach(function (k) { sess.flags[k] = c.set[k]; });
    sess.path.push(sess.nodeId); sess.choices++;
  }
  function targetFor(sess, c) {
    return c.goto || (c.outcome && sess.sc.nodes && sess.sc.nodes[c.outcome] ? c.outcome : null);
  }
  function header(sess) {
    var h = el("div.engine-head");
    var title = el("div.title");
    title.appendChild(el("div.eyebrow", { text:"Collective scenario" }));
    title.appendChild(el("h2", { text:sess.sc.title }));
    if (sess.sc.scene) title.appendChild(el("div.engine-scene-tag", { text:sess.sc.scene }));
    h.appendChild(title);
    var exit = el("button.btn.ghost.sm", { type:"button", text:"Exit" });
    exit.addEventListener("click", function () {
      if (sess.onExit) sess.onExit({ completed:false, cancelled:true, scenarioId:sess.sc.id });
    });
    h.appendChild(exit);
    return h;
  }
  function addDialogue(host, dialogue) {
    if (!Array.isArray(dialogue)) return;
    dialogue.forEach(function (d) {
      if (!d || typeof d !== "object") return;
      var line = el("div.card", { style:"margin-top:6px" });
      line.appendChild(el("strong", { text:String(d.speaker || d.role || "Speaker") }));
      line.appendChild(el("p", { text:String(d.line || "") }));
      host.appendChild(line);
    });
  }
  async function finish(sess, node) {
    if (sess.finished) return;
    sess.finished = true;
    try {
      await G.store.recordAttempt({
        scenarioId:sess.sc.id, title:sess.sc.title, mode:"collective",
        score:Object.assign({}, sess.score), total:sumScore(sess.score), choices:sess.choices,
        outcomeNode:sess.nodeId
      });
    } catch (e) {}
    util.clear(sess.container);
    sess.container.appendChild(header(sess));
    var p = el("div.panel.collective-outcome");
    p.appendChild(el("div.eyebrow", { text:"Collective AAR" }));
    p.appendChild(el("h3", { text:"Scenario complete" }));
    p.appendChild(el("p", { text:String(node.outcome || node.prompt || "Review the team's decisions and identify one sustain and one improve.") }));
    p.appendChild(el("p.hint", { text:"Team score: " + sumScore(sess.score) + " · " + sess.choices + " decision" + (sess.choices === 1 ? "" : "s") + ". The score is a study signal, not an official evaluation." }));
    var again = el("button.btn.ghost", { type:"button", text:"Replay collective lane" });
    again.addEventListener("click", function () { runCollective(sess.sc, sess.container, sess.onExit, sess.options); });
    var done = el("button.btn.primary", { type:"button", text:"Done" });
    done.addEventListener("click", function () {
      if (sess.onExit) sess.onExit({ completed:true, cancelled:false, scenarioId:sess.sc.id });
    });
    p.appendChild(el("div.btn-row", {}, [again, done]));
    sess.container.appendChild(p);
  }
  function continueAppliedChoice(sess, c) {
    var target = targetFor(sess, c);
    if (!target) return finish(sess, { outcome:"This authored path has no valid next node. Review the scenario graph." });
    sess.nodeId = target;
    renderCollective(sess);
  }
  function advance(sess, c) {
    applyChoice(sess, c);
    continueAppliedChoice(sess, c);
  }
  function renderSingle(sess, node, choices) {
    util.clear(sess.container); sess.container.appendChild(header(sess));
    var p = el("div.panel");
    if (node.beat) p.appendChild(el("div.eyebrow", { text:node.beat }));
    if (node.prompt || node.body) p.appendChild(el("p", { text:String(node.prompt || node.body) }));
    addDialogue(p, node.dialogue);
    var c = choices[0] || { text:"Continue", goto:node.next };
    var btn = el("button.btn.primary", { type:"button", text:c.text || "Continue" });
    btn.addEventListener("click", function () {
      btn.disabled = true;
      applyChoice(sess, c);
      if (c.feedback || c.tradeoff) {
        var fb = el("div", { style:"margin-top:10px" });
        if (c.feedback) fb.appendChild(el("div.feedback", { role:"status", "aria-live":"polite", text:c.feedback }));
        if (c.tradeoff) fb.appendChild(el("p.hint", { text:"Tradeoff: " + c.tradeoff }));
        var next = el("button.btn.primary", { type:"button", text:"Continue" });
        next.addEventListener("click", function () { continueAppliedChoice(sess, c); });
        fb.appendChild(next); p.appendChild(fb); next.focus();
        return;
      }
      continueAppliedChoice(sess, c);
    });
    p.appendChild(btn); sess.container.appendChild(p); btn.focus();
  }
  function renderDecision(sess, node, choices) {
    util.clear(sess.container); sess.container.appendChild(header(sess));
    var root = el("div.panel.collective-decision", { role:"region", "aria-label":"Collective Decision" });
    root.appendChild(el("div.eyebrow", { text:"Collective Decision" }));
    if (node.beat) root.appendChild(el("div.engine-scene-tag", { text:node.beat }));
    if (node.prompt || node.body) root.appendChild(el("h3", { text:String(node.prompt || node.body) }));
    addDialogue(root, node.dialogue);

    var raw = Number(node.discussionSeconds || (node.discuss && node.discuss.seconds) || sess.options.discussionSeconds || 60);
    var remaining = Number.isFinite(raw) ? Math.max(10, Math.min(300, Math.round(raw))) : 60;
    var unlocked = false, chosen = null, committed = false, timerId = null;
    var timer = el("div", { "data-collective-timer":"1", "aria-label":"Discussion time remaining", text:"Discussion: " + remaining + "s" });
    var status = el("p.hint", { role:"status", "aria-live":"polite", text:"Discuss first. Lock the discussion early when the team is ready." });
    root.appendChild(timer); root.appendChild(status);
    var choiceHost = el("div", { role:"group", "aria-label":"Team decision choices" });
    var buttons = [];
    var commit = el("button.btn.primary", { type:"button", text:"Commit team answer" }); commit.disabled = true;

    choices.forEach(function (c, i) {
      var b = el("button.btn.ghost.collective-choice", { type:"button", text:String.fromCharCode(65+i) + ". " + (c.text || ""), "aria-pressed":"false" });
      b.disabled = true;
      b.addEventListener("click", function () {
        if (!unlocked || committed) return;
        chosen = c;
        buttons.forEach(function (x) { var on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on)); });
        commit.disabled = false; status.textContent = "Team choice selected. Commit when everyone is ready.";
      });
      buttons.push(b); choiceHost.appendChild(b);
    });
    root.appendChild(choiceHost);

    function stop() { if (timerId) { clearInterval(timerId); timerId = null; } }
    function unlock(msg) {
      if (unlocked || committed) return;
      unlocked = true; buttons.forEach(function (b) { b.disabled = false; });
      status.textContent = msg || "Discussion complete. Select the team's answer.";
      if (G.util.announce) G.util.announce(status.textContent);
    }
    var early = el("button.btn.ghost", { type:"button", text:"Lock decision early" });
    early.addEventListener("click", function () { unlock("Discussion locked early. Select the team's answer."); });
    root.appendChild(el("div.btn-row", {}, [early, commit]));

    timerId = setInterval(function () {
      if (!root.isConnected) { stop(); return; }
      if (unlocked || committed) return;
      remaining = Math.max(0, remaining - 1); timer.textContent = "Discussion: " + remaining + "s";
      if (remaining === 0) { stop(); unlock("Discussion time complete. Select the team's answer."); }
    }, 1000);

    commit.addEventListener("click", function () {
      if (!chosen || committed) return;
      committed = true; stop(); buttons.forEach(function (b) { b.disabled = true; }); early.disabled = true; commit.disabled = true; commit.textContent = "Team answer committed";
      var fb = el("div", { style:"margin-top:10px" });
      if (chosen.feedback) fb.appendChild(el("div.feedback", { role:"status", "aria-live":"polite", text:chosen.feedback }));
      if (chosen.tradeoff) fb.appendChild(el("p.hint", { text:"Tradeoff: " + chosen.tradeoff }));
      var next = el("button.btn.primary", { type:"button", text:"Continue" });
      next.addEventListener("click", function () { advance(sess, chosen); });
      fb.appendChild(next); root.appendChild(fb); next.focus();
    });
    sess.container.appendChild(root); early.focus();
  }
  function renderCollective(sess) {
    var node = (sess.sc.nodes || {})[sess.nodeId];
    if (!node) return finish(sess, { outcome:"This path points to a missing node: " + sess.nodeId + "." });
    if (node.end) return finish(sess, node);
    var choices = visible(node, sess.flags);
    if ((!choices || !choices.length) && node.next) choices = [{ text:"Continue", goto:node.next }];
    if (!choices || !choices.length) return finish(sess, node);
    if (choices.length === 1) return renderSingle(sess, node, choices);
    return renderDecision(sess, node, choices);
  }
  function runCollective(sc, container, onExit, options) {
    var sess = { sc:sc, container:container, onExit:onExit, options:options || {}, nodeId:sc.start || "n1", score:{}, flags:{}, path:[sc.start || "n1"], choices:0, finished:false };
    ["Leads","Develops","Achieves","Character","Presence","Intellect"].forEach(function (d) { sess.score[d] = 0; });
    renderCollective(sess);
  }

  G.engine.run = function (scenarioId, mode, container, onExit, options) {
    var sc = G.store && G.store.scenario ? G.store.scenario(scenarioId) : null;
    var opts = options || {};
    if (sc && (opts.collective || scenarioHasDiscuss(sc))) return runCollective(sc, container, onExit, opts);
    return originalRun(scenarioId, mode, container, onExit);
  };
  G.engine.runCollective = function (scenarioOrId, container, onExit, options) {
    // Accept an authored scenario object as well as a stored id. This keeps
    // the collective adapter useful to Authoring/preview/test surfaces
    // without forcing a temporary scenario into the memoized store.
    var sc = scenarioOrId && typeof scenarioOrId === "object"
      ? scenarioOrId
      : (G.store && G.store.scenario ? G.store.scenario(scenarioOrId) : null);
    if (!sc) { util.toast("Scenario not found."); return; }
    return runCollective(sc, container, onExit, Object.assign({ collective:true }, options || {}));
  };
})();