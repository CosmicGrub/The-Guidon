import { readFile, writeFile } from "node:fs/promises";

const FILE = "src/index.html";
let c = await readFile(FILE, "utf8");
let changed = 0;

function replaceOnce(oldText, newText, label) {
  if (c.includes(newText)) return;
  const count = c.split(oldText).length - 1;
  if (count !== 1) throw new Error(label + ": expected exactly one anchor, found " + count);
  c = c.replace(oldText, newText);
  changed++;
}

// ---- scenario relay + collective decision ----
replaceOnce(
`  function newSession(sc, mode, container, onExit) {
    const score = {}; DIMS.forEach((d) => (score[d] = 0));
    return { sc, mode, container, onExit, nodeId: sc.start, score, path: [sc.start || "n1"], choices: 0, finished: false, flags: {}, tr: { correct: 0, total: 0 } };
  }`,
`  function newSession(sc, mode, container, onExit, opts) {
    const score = {}; DIMS.forEach((d) => (score[d] = 0));
    opts = opts && typeof opts === "object" ? opts : {};
    const members = Array.isArray(opts.members) ? opts.members.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12) : [];
    return {
      sc, mode, container, onExit, nodeId: sc.start, score, path: [sc.start || "n1"],
      choices: 0, finished: false, flags: {}, tr: { correct: 0, total: 0 },
      collective: members.length > 0, relay: !!opts.relay && members.length > 1,
      members, relayIndex: 0,
      discussionSeconds: Math.max(5, Math.min(180, Number(opts.discussionSeconds) || 30)),
      discussionUnlocked: Object.create(null),
    };
  }`,
"newSession");

replaceOnce(
`  function advance(sess, choice) {
    applyChoice(sess, choice);
    if (sess.choices > MAX_STEPS) {`,
`  function advance(sess, choice) {
    applyChoice(sess, choice);
    if (sess.relay && sess.members.length > 1) sess.relayIndex = (sess.relayIndex + 1) % sess.members.length;
    if (sess.choices > MAX_STEPS) {`,
"advance relay");

replaceOnce(
`    if (sess.mode === "text") return renderText(sess, node);
    if (sess.mode === "cyoa") return renderCyoa(sess, node);
    if (sess.mode === "training") return renderTraining(sess, node);
    return renderCourse(sess, node);`,
`    if (sess.collective && sess.mode !== "training" && node.discuss && !sess.discussionUnlocked[sess.nodeId]) {
      return renderCollectiveGate(sess, node);
    }
    if (sess.mode === "text") return renderText(sess, node);
    if (sess.mode === "cyoa") return renderCyoa(sess, node);
    if (sess.mode === "training") return renderTraining(sess, node);
    return renderCourse(sess, node);`,
"collective dispatch");

replaceOnce(
`  // ---------- TEXT (console transcript) ----------`,
`  function renderCollectiveGate(sess, node) {
    util.clear(sess.container);
    sess.container.appendChild(renderHeader(sess));
    const owner = sess.members[sess.relayIndex] || "Team";
    const panel = el("div.panel", { tabIndex:"-1" });
    panel.appendChild(el("div.eyebrow", { text:"Collective Decision" }));
    panel.appendChild(el("h2", { text: sess.relay ? owner + " has the decision" : "Discuss before deciding" }));
    if (node.prompt) panel.appendChild(el("p", { text:node.prompt }));
    panel.appendChild(el("p.hint", { text:"Discuss the situation as a team. One answer is recorded for this decision. " + (sess.relay ? "Decision ownership rotates after each choice." : "") }));
    const clock = el("div.rf-timer", { text: util.fmtClock(sess.discussionSeconds) });
    const row = el("div.btn-row", { style:"margin-top:12px;flex-wrap:wrap" });
    const timed = el("button.btn", { type:"button", text:"Start " + sess.discussionSeconds + "s discussion" });
    const decide = el("button.btn.primary", { type:"button", text:"Lock discussion & show choices" });
    let timer = null;
    function unlock() {
      if (timer) timer.stop();
      sess.discussionUnlocked[sess.nodeId] = true;
      render(sess);
    }
    timed.addEventListener("click", function () {
      timed.disabled = true;
      timer = util.makeRoundTimer({
        anchorEl:panel, totalSec:sess.discussionSeconds,
        onTick:function (_elapsed, remaining) { clock.textContent = util.fmtClock(remaining); },
        onDone:function () {
          decide.textContent = "Discussion complete — show choices";
          decide.focus();
          try { if (G.util.announce) G.util.announce("Discussion time complete. Lock the team decision when ready."); } catch (e) {}
        },
      });
    });
    decide.addEventListener("click", unlock);
    row.appendChild(timed); row.appendChild(decide);
    panel.appendChild(clock); panel.appendChild(row);
    sess.container.appendChild(panel);
    panel.focus();
  }

  // ---------- TEXT (console transcript) ----------`,
"collective gate");

replaceOnce(
`  G.engine = {
    _pending: null,   // set by cross-links; consumed by views.train on next render
    run(scenarioId, mode, container, onExit) {
      const sc = store.scenario(scenarioId);
      if (!sc) { util.toast("Scenario not found."); return; }
      const chosen = mode || sc.defaultMode || store.settings().defaultMode || "course";
      const validMode = (sc.renderModes || ["text", "course", "cyoa"]).includes(chosen) ? chosen : (sc.renderModes || ["course"])[0];
      const sess = newSession(sc, validMode, container, onExit);
      render(sess);
    },
  };`,
`  G.engine = {
    _pending: null,
    _pendingTeam: null,
    run(scenarioId, mode, container, onExit, opts) {
      const sc = store.scenario(scenarioId);
      if (!sc) { util.toast("Scenario not found."); return; }
      const chosen = mode || sc.defaultMode || store.settings().defaultMode || "course";
      const validMode = (sc.renderModes || ["text", "course", "cyoa"]).includes(chosen) ? chosen : (sc.renderModes || ["course"])[0];
      const sess = newSession(sc, validMode, container, onExit, opts);
      render(sess);
    },
    runTeam(scenarioId, mode, container, members, onExit, opts) {
      const teamOpts = Object.assign({}, opts || {}, { members:Array.isArray(members) ? members : [], relay:true });
      this.run(scenarioId, mode, container, onExit, teamOpts);
    },
  };`,
"engine API");

replaceOnce(
`    // Consume cross-link pending scenario — open it immediately
    if (G.engine && G.engine._pending) {`,
`    // Consume collective/team handoff before the ordinary single-scenario handoff.
    if (G.engine && G.engine._pendingTeam) {
      const pendingTeam = G.engine._pendingTeam;
      G.engine._pendingTeam = null;
      const teamSc = store.scenarios ? store.scenarios().find((s) => s.id === pendingTeam.scenarioId) : null;
      if (teamSc) {
        G.engine.run(pendingTeam.scenarioId, null, mount, () => views.train(mount), pendingTeam);
        return;
      }
    }
    // Consume cross-link pending scenario — open it immediately
    if (G.engine && G.engine._pending) {`,
"train team handoff");

// ---- PRT planner + history ----
replaceOnce(
`    function finishDrill() {
      util.clear(wrap);`,
`    function finishDrill() {
      try {
        if (G.ptPlanner && G.ptPlanner.recordHistory) {
          G.ptPlanner.recordHistory({ type:"prt-drill", drillId:drill.id, title:drill.name, intensity:"recovery", repContext:repContext, exercises:exercises.length })
            .catch(function () {});
        }
      } catch (e) {}
      util.clear(wrap);`,
"PRT history");

replaceOnce(
`    actionsRow.appendChild(runBtn);
    mount.appendChild(actionsRow);

    var selectedId = exercises[0].id;`,
`    actionsRow.appendChild(runBtn);
    mount.appendChild(actionsRow);

    if (G.ptPlanner && G.ptPlanner.render) {
      var plannerMount = el("div", { style:"margin:14px 0" });
      mount.appendChild(plannerMount);
      G.ptPlanner.render(plannerMount).catch(function (e) {
        util.clear(plannerMount);
        plannerMount.appendChild(el("div.feedback.warn", { text:"PT planner could not load. Your PRT reference and drill runner are still available." }));
        if (window.console) console.error("PT planner render failed", e);
      });
    }

    var selectedId = exercises[0].id;`,
"PRT planner mount");

// ---- combined Board Readiness Score ----
replaceOnce(
`  async function renderReadiness(mount) {
    util.clear(mount);
    const all = store.boardQuestions();`,
`  async function renderReadiness(mount) {
    util.clear(mount);
    if (G.board.readinessScore) {
      try {
        const combined = await G.board.readinessScore();
        const combinedPanel = el("div.panel", { style:"margin-bottom:12px;border-left:3px solid var(--cyan)" });
        combinedPanel.appendChild(el("div.eyebrow", { text:"Board Readiness 2.0" }));
        combinedPanel.appendChild(el("div.stat", {}, [
          el("span.k", { text:"Combined readiness" }),
          el("span.v", { text:combined.score + "%", style:"font-weight:700;color:var(--cyan)" })
        ]));
        combinedPanel.appendChild(el("div.bar.cyan", {}, [el("span", { style:"transform:scaleX(" + (combined.score / 100) + ")" })]));
        combinedPanel.appendChild(el("p.hint", { text:"Card mastery " + combined.mastery + "% · Scenario practice " + combined.scenario + "% (" + combined.uniqueScenarios + " unique scenarios). " + combined.formula + "." }));
        mount.appendChild(combinedPanel);
      } catch (e) { if (window.console) console.error("Combined readiness failed", e); }
    }
    const all = store.boardQuestions();`,
"combined readiness");

// ---- full Mock Board preset/phases ----
replaceOnce(
`      results: [],          // { q, cat, score } per answered question
    };`,
`      results: [],          // { q, cat, score } per answered question
      fullSimulation: false,
      phasePlan: ["Drill & Board Etiquette","Leadership & Counseling","Programs & Support","Maintenance & Supply","Training Management","Doctrinal Thinking"],
    };`,
"mock session full mode");

replaceOnce(
`      // number of questions
      const qRow = el("div.mb-row");`,
`      const fullRow = el("div.mb-row");
      fullRow.appendChild(el("label.mb-label", { text:"Simulation depth" }));
      const fullBtn = el("button.chip.search-chip", { type:"button", text:"Full phased board simulation", "aria-pressed":"false" });
      fullBtn.addEventListener("click", function () {
        sess.fullSimulation = !sess.fullSimulation;
        fullBtn.classList.toggle("active", sess.fullSimulation);
        fullBtn.setAttribute("aria-pressed", String(sess.fullSimulation));
        if (sess.fullSimulation) { sess.count = Math.min(20, bank.length); qSel.value = String(sess.count); }
      });
      fullRow.appendChild(fullBtn);
      fullRow.appendChild(el("p.hint", { text:"Runs reporting, then rotates through the six study pillars before the normal scored debrief. Still fully offline and deterministic — no live AI." }));
      panel.appendChild(fullRow);

      // number of questions
      const qRow = el("div.mb-row");`,
"mock full control");

replaceOnce(
`        sess.queue = shuffle(pool).slice(0, Math.min(sess.count, pool.length));
        sess.idx = 0; sess.results = [];`,
`        if (sess.fullSimulation) {
          const picked = [], used = new Set();
          sess.phasePlan.forEach(function (pillar) {
            const candidates = shuffle(pool.filter(function (q) { return q.pillar === pillar && !used.has(q.id); }));
            const quota = Math.max(1, Math.floor(sess.count / sess.phasePlan.length));
            candidates.slice(0, quota).forEach(function (q) { picked.push(q); used.add(q.id); });
          });
          if (picked.length < sess.count) {
            shuffle(pool.filter(function (q) { return !used.has(q.id); })).slice(0, sess.count - picked.length).forEach(function (q) { picked.push(q); used.add(q.id); });
          }
          sess.queue = picked.slice(0, Math.min(sess.count, pool.length));
        } else {
          sess.queue = shuffle(pool).slice(0, Math.min(sess.count, pool.length));
        }
        sess.idx = 0; sess.results = [];`,
"mock phased queue");

replaceOnce(
`      panel.appendChild(el("div.mb-cat", { text: q.category }));
      panel.appendChild(el("div.mb-q", { text: q.q }));`,
`      if (sess.fullSimulation) {
        panel.appendChild(el("div.eyebrow", { text:"Board phase · " + (q.pillar || "General Knowledge") }));
      }
      panel.appendChild(el("div.mb-cat", { text: q.category }));
      panel.appendChild(el("div.mb-q", { text: q.q }));`,
"mock phase label");

if (changed) await writeFile(FILE, c, "utf8");
console.log("roadmap expansion patcher:", changed ? changed + " edits applied" : "already applied");
