/* GUIDON — Board Simulator (global G.mockBoardSim)
 * ROADMAP §3f Phase 1–2: a fixed, offline, four-step board rehearsal.
 * Steps 1 and 3 run in the shared scenario engine (G.engine). Step 2 hands
 * off to the existing Mock Board tab, which stays the ONLY writer of its own
 * scores, history and review-schedule rows - this module just reads the Mock
 * Board history to notice that a board was finished. No server, no
 * randomness, no generated opponent: the same rank filter always gets the
 * same steps.
 */
(function () {
  "use strict";
  var G = window.G || (window.G = {});
  var util = G.util, el = util.el, db = G.db;
  var KEY = "board:sim:v1";
  var MOCK_HISTORY = "board:mockHistory:v1";

  // ---- The steps, as data ---------------------------------------------------
  // One row per practice step, so copy, completion flag and scenario choice
  // live together instead of being repeated in three hand-written blocks.
  // `pool` is an ordered preference list: the first entry the Soldier's rank
  // filter shows wins; if the filter hides them all, the first entry runs
  // anyway (see pickScenario). Same filter in, same scenario out.
  var STEPS = [
    { id:"reporting", n:1, flag:"reportingDone", kind:"scenario", attr:"data-board-sim-reporting",
      pool:["sc-board-simulator-reporting"],
      name:"Reporting practice",
      title:"Report to the board",
      body:"Practice the choices around reporting: getting ready, entering the room, following the board's directions, and answering when you are not sure. It builds good habits rather than teaching one script, because every board sets its own procedure.",
      start:"Start reporting practice", again:"Practice reporting again" },
    { id:"knowledge", n:2, flag:"knowledgeDone", kind:"mockboard", attr:"data-board-sim-knowledge",
      name:"Mock Board",
      title:"Answer the board's questions",
      body:"Opens the Mock Board. Answer each question out loud against the clock, check the answer, and score yourself honestly. When you finish the board, come back here and this step is marked done.",
      start:"Open the Mock Board", again:"Run another Mock Board" },
    { id:"judgment", n:3, flag:"judgmentDone", kind:"scenario", attr:"data-board-sim-judgment",
      // Leader-level problem first; the junior-Soldier integrity problem is
      // what an E1-E3 filter shows, so that Soldier gets one written for them.
      pool:["sc-iot-range-safety", "sc-staff-duty"],
      name:"Leadership problem",
      title:"Work a leadership problem",
      body:"Finish with a short situation where each choice has consequences. A board wants to hear how you think: the standard, the tradeoffs, and how you follow through. There is no magic phrase.",
      start:"Start the leadership problem", again:"Try the leadership problem again" }
  ];
  function stepById(id) { return STEPS.filter(function (s) { return s.id === id; })[0] || null; }

  function fresh() {
    return {
      version:1, reportingDone:false, knowledgeDone:false, judgmentDone:false,
      mockHistoryCount:null, mockHistoryToken:null, startedAt:0, completedAt:0,
      // Scenario steps that were opened and not yet closed: { stepId:{ id, at } }.
      opened:{},
      aarDraft:{ strong:"", improve:"", next:"" }
    };
  }
  async function load() {
    try {
      var v = await db.getSetting(KEY, null);
      if (!v || typeof v !== "object" || Array.isArray(v)) return fresh();
      var out = Object.assign(fresh(), v);
      var draft = v.aarDraft && typeof v.aarDraft === "object" && !Array.isArray(v.aarDraft) ? v.aarDraft : {};
      out.aarDraft = {
        strong:String(draft.strong || ""),
        improve:String(draft.improve || ""),
        next:String(draft.next || "")
      };
      var opened = v.opened && typeof v.opened === "object" && !Array.isArray(v.opened) ? v.opened : {};
      out.opened = {};
      STEPS.forEach(function (st) {
        var o = opened[st.id];
        if (st.kind === "scenario" && o && typeof o.id === "string" && isFinite(Number(o.at))) {
          out.opened[st.id] = { id:o.id, at:Number(o.at) };
        }
      });
      return out;
    } catch (e) { return fresh(); }
  }
  async function save(s) {
    try { await db.setSetting(KEY, s); return true; } catch (e) { return false; }
  }
  async function mockHistory() {
    try { var v = await db.getSetting(MOCK_HISTORY, []); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function historyToken(h) {
    if (!Array.isArray(h) || !h.length) return "";
    try { return JSON.stringify(h[h.length - 1]); } catch (e) { return String(h.length); }
  }
  function doneCount(s) {
    return STEPS.filter(function (st) { return !!s[st.flag]; }).length;
  }
  // One place decides "the whole run is finished" - it used to be stamped by
  // two of the three steps, each checking a different pair of flags.
  function stampCompletion(s) {
    if (doneCount(s) === STEPS.length && !s.completedAt) s.completedAt = Date.now();
  }

  // ---- Completion contract --------------------------------------------------
  // A step is recorded as done ONLY on a real completion signal. "The practice
  // screen closed" is not one: the scenario engine's header Exit button and
  // its outcome screen's Done button both come back through the same callback
  // with no arguments, so tapping Exit on the very first question used to mark
  // the step Complete. The signals accepted, per kind of step:
  //   scenario  - the engine's own exit result says completed:true (the
  //               collective adapter reports one today), OR the attempt log
  //               gained a row for this step's scenario since the step was
  //               opened. The engine saves exactly one attempt row at the
  //               moment the Soldier reaches an outcome screen and at no other
  //               time, so that row IS "finished a run" - including finish,
  //               Replay, then Exit halfway, which a bare finished/cancelled
  //               flag on the last session would lose.
  //   mockboard - the Mock Board's own history gained an entry since the step
  //               was opened (reconcileKnowledge below).
  // Both are checked again on every render, so finishing and then leaving by
  // the nav bar instead of the Done button still counts.
  async function finishedRunSince(marker) {
    if (!marker) return false;
    try {
      var rows = (await db.allAttempts()) || [];
      return rows.some(function (a) { return !!a && a.scenarioId === marker.id && Number(a.ts) >= marker.at; });
    } catch (e) { return false; }
  }
  async function reconcileKnowledge(s) {
    if ((s.mockHistoryCount == null && s.mockHistoryToken == null) || s.knowledgeDone) return s;
    var h = await mockHistory();
    var grew = s.mockHistoryCount != null && h.length > Number(s.mockHistoryCount || 0);
    var changedAtCap = s.mockHistoryToken != null && historyToken(h) !== s.mockHistoryToken;
    if (grew || changedAtCap) {
      s.knowledgeDone = true;
      stampCompletion(s);
      await save(s);
    }
    return s;
  }
  async function reconcileScenarios(s) {
    var changed = false;
    for (var i = 0; i < STEPS.length; i++) {
      var st = STEPS[i], marker = s.opened && s.opened[st.id];
      if (st.kind !== "scenario" || !marker || s[st.flag]) continue;
      if (await finishedRunSince(marker)) { s[st.flag] = true; delete s.opened[st.id]; changed = true; }
    }
    if (changed) { stampCompletion(s); await save(s); }
    return s;
  }

  // ---- Scenarios, independent of the rank filter ----------------------------
  // G.store.scenario() hides everything outside the Soldier's rank filter, and
  // the scenario engine finds its scenario through that same call. These steps
  // belong to the simulator, not to the Train catalog, so a rank filter must
  // never be able to switch them off. It did: with the filter on E1-E3 (which
  // onboarding sets for every PVT/PV2/PFC) or E7-E9, steps 1 and 3 showed a
  // bare "Scenario not found." toast over an empty screen and could never be
  // finished.
  function visibleScenario(id) {
    try { return (G.store && G.store.scenario && G.store.scenario(id)) || null; } catch (e) { return null; }
  }
  function seedScenario(id) {
    var seed = window.GUIDON_SEED;
    var list = (seed && seed.scenarios && Array.isArray(seed.scenarios.scenarios)) ? seed.scenarios.scenarios : [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  function playable(sc) {
    return !!(sc && sc.nodes && typeof sc.nodes === "object" && Object.keys(sc.nodes).length);
  }
  function pickScenario(pool) {
    var i, sc;
    for (i = 0; i < pool.length; i++) { sc = visibleScenario(pool[i]); if (playable(sc)) return sc; }
    for (i = 0; i < pool.length; i++) { sc = seedScenario(pool[i]); if (playable(sc)) return sc; }
    return null;
  }
  function runScenario(sc, host, onExit) {
    if (visibleScenario(sc.id)) return G.engine.run(sc.id, "course", host, onExit);
    // The engine takes an id and looks it up itself, once, synchronously, at
    // the top of run(). Lend it this scenario for exactly that lookup and put
    // the store back before anything else can run, so no other screen ever
    // sees a scenario its rank filter hides. (If G.engine.run learns to accept
    // a scenario object, this whole branch becomes that one call.)
    var store = G.store, real = store.scenario;
    store.scenario = function (id) { return id === sc.id ? sc : real.apply(store, arguments); };
    try { return G.engine.run(sc.id, "course", host, onExit); }
    finally { store.scenario = real; }
  }

  function say(msg) { try { if (util.announce) util.announce(msg); } catch (e) {} }
  function progressLine(s) { return doneCount(s) + " of " + STEPS.length + " practice steps done"; }

  // After a redraw the control that had focus no longer exists. Put focus
  // somewhere useful (never leave it on <body>) and say what just happened -
  // the redraw rebuilds every node, so nothing on screen announces itself.
  function settle(mount, after, state) {
    if (!after || !mount.isConnected) return;
    var target = null, msg = "";
    var step = after.step ? stepById(after.step) : null;
    if (after.kind === "done" && step) {
      var next = STEPS.filter(function (st) { return !state[st.flag]; })[0];
      target = next ? mount.querySelector("[" + next.attr + "]") : mount.querySelector("[data-board-sim-aar] h3");
      msg = step.name + " finished. " + progressLine(state) + "." + (next ? "" : " Write your after-action notes next.");
    } else if (after.kind === "left" && step) {
      target = mount.querySelector("[" + step.attr + "]");
      msg = state[step.flag] ? step.name + " closed." : step.name + " closed before the end. It is not counted yet.";
    } else if (after.kind === "reset") {
      target = mount.querySelector("[" + STEPS[0].attr + "]");
      msg = "Started over. " + progressLine(state) + ".";
    } else if (after.kind === "returned") {
      // A route render: the router moves focus to the page heading itself.
      msg = after.names.join(" and ") + " finished. " + progressLine(state) + ".";
    }
    if (target && target.focus) { try { target.focus(); } catch (e) {} }
    if (msg) say(msg);
  }

  async function render(mount, after) {
    var state = await load();
    var was = {};
    STEPS.forEach(function (st) { was[st.id] = !!state[st.flag]; });
    state = await reconcileScenarios(await reconcileKnowledge(state));
    if (!state.startedAt) { state.startedAt = Date.now(); await save(state); }
    var history = await mockHistory();
    if (!after) {
      var names = STEPS.filter(function (st) { return !was[st.id] && state[st.flag]; }).map(function (st) { return st.name; });
      if (names.length) after = { kind:"returned", names:names };
    }

    // Everything that needs the database is read. Build the screen in one
    // synchronous pass so two overlapping renders cannot interleave output.
    util.clear(mount);
    mount.appendChild(el("div.section-title", {}, [el("h2", { text:"Board Simulator" }), el("div.rule")]));
    mount.appendChild(el("p.hint", { text:"Rehearse a full board appearance in four steps: report in, answer timed questions out loud, work through a leadership problem, then write down what you learned. Everything here works with no signal. Boards differ from unit to unit, so your board's written instructions (MOI), your sponsor, and the board president always come first." }));

    var done = doneCount(state);
    // Not a live region: this node is rebuilt on every redraw, and a live
    // region that arrives already filled in is not read out. Changes are
    // spoken through G.util.announce in settle() instead.
    var status = el("div.panel", { role:"group", "aria-label":"Your progress", "data-board-sim-status":"1" });
    status.appendChild(el("div.eyebrow", { text:"Your progress" }));
    status.appendChild(el("strong", { text:progressLine(state) }));
    if (done === STEPS.length) status.appendChild(el("p.hint", { text:"All three steps are done. Write your after-action notes below, then start over whenever you want another run." }));
    mount.appendChild(status);

    var engineHost = el("div", { "data-board-sim-engine":"1", style:"margin-top:12px" });

    STEPS.forEach(function (st) {
      var isDone = !!state[st.flag];
      var card = el("div.panel.board-sim-phase", { "data-board-sim-phase":String(st.n) });
      card.appendChild(el("div.eyebrow", { text:"Step " + st.n + (isDone ? " · Done" : "") }));
      card.appendChild(el("h3", { text:st.title }));
      card.appendChild(el("p", { text:st.body }));
      var sc = st.kind === "scenario" ? pickScenario(st.pool) : null;
      if (sc && st.id === "judgment") card.appendChild(el("p.hint", { text:"Your situation: " + sc.title }));
      if (after && after.kind === "left" && after.step === st.id && !isDone) {
        card.appendChild(el("p.hint", { "data-board-sim-note":st.id, text:"You left this step before the end, so it is not counted yet. Start it again when you are ready." }));
      }
      var attrs = { type:"button", text:isDone ? st.again : st.start };
      attrs[st.attr] = "1";
      var btn = el("button.btn.primary", attrs);
      btn.addEventListener("click", function () {
        if (st.kind === "mockboard") return openMockBoard(state);
        openScenarioStep(st, sc, mount, state, engineHost);
      });
      card.appendChild(btn);
      mount.appendChild(card);
    });
    mount.appendChild(engineHost);

    var aar = el("div.panel", { "data-board-sim-aar":"1" });
    aar.appendChild(el("div.eyebrow", { text:"Step 4 · After-action review" }));
    aar.appendChild(el("h3", { text:"Write down what you learned", tabindex:"-1" }));
    if (done < STEPS.length) {
      aar.appendChild(el("p.hint", { text:"These notes are most useful after all three steps, but you can write them at any time." }));
    }
    [["strong","What answer, habit, or preparation should you keep doing?"],
     ["improve","What should change before your next practice run?"],
     ["next","What one topic or habit is most worth rehearsing next?"]].forEach(function (pair) {
       aar.appendChild(el("label", { text:pair[1], for:"board-sim-" + pair[0] }));
       var ta = el("textarea", {
         id:"board-sim-" + pair[0], rows:"2", "aria-label":pair[1]
       });
       // <textarea> ignores a value HTML attribute as its live initial value.
       // Restore the saved notes through the DOM property so a redraw keeps them.
       ta.value = String((state.aarDraft && state.aarDraft[pair[0]]) || "");
       ta.addEventListener("input", function () {
         state.aarDraft = state.aarDraft || { strong:"", improve:"", next:"" };
         state.aarDraft[pair[0]] = ta.value;
         save(state);
       });
       aar.appendChild(ta);
     });
    if (history.length) {
      var last = history[history.length - 1];
      aar.appendChild(el("p.hint", { text:last.pct != null
        ? "Your most recent Mock Board score: " + last.pct + "%."
        : "Your most recent Mock Board is saved in its history." }));
    }
    var reset = el("button.btn.ghost", { type:"button", text:"Start over", "data-board-sim-reset":"1" });
    reset.addEventListener("click", async function () {
      var d = state.aarDraft || {};
      var hasWork = doneCount(state) > 0 || !!(d.strong || d.improve || d.next);
      // Starting over erases the notes with no way back; ask first, but only
      // when there is something to lose.
      if (hasWork && G.modal && G.modal.confirm) {
        var go = await G.modal.confirm(
          "This clears your progress and your after-action notes for this run. Your Mock Board history and scenario scores are kept.",
          { title:"Start over?", okText:"Start over", danger:true });
        if (!go) return;
      }
      var next = fresh(); next.startedAt = Date.now();
      await save(next);
      render(mount, { kind:"reset" });
    });
    aar.appendChild(reset); mount.appendChild(aar);

    var related = el("div.panel");
    related.appendChild(el("div.eyebrow", { text:"Related" }));
    var board = el("button.btn.sm.ghost", { type:"button", text:"Board Drill" });
    board.addEventListener("click", function () { location.hash = "#/board"; });
    var reps = el("button.btn.sm.ghost", { type:"button", text:"5-Minute Board Reps" });
    reps.addEventListener("click", function () { if (G.board) G.board._filterReps = true; location.hash = "#/board"; });
    related.appendChild(board); related.appendChild(reps); mount.appendChild(related);

    settle(mount, after, state);
  }

  function openScenarioStep(st, sc, mount, state, engineHost) {
    util.clear(engineHost);
    if (!sc) {
      // Never a raw error: say it on the page, in plain words, and out loud.
      var msg = "This step can't be opened right now. The other steps still work.";
      engineHost.appendChild(el("div.panel", { "data-board-sim-unavailable":st.id }, [
        el("div.eyebrow", { text:"Step " + st.n }),
        el("p", { text:msg })
      ]));
      say(msg);
      return;
    }
    state.opened = state.opened || {};
    state.opened[st.id] = { id:sc.id, at:Date.now() };
    save(state);
    runScenario(sc, engineHost, async function (result) {
      var marker = state.opened && state.opened[st.id];
      var finished = !!(result && result.completed === true) || await finishedRunSince(marker);
      if (state.opened) delete state.opened[st.id];
      if (finished) { state[st.flag] = true; stampCompletion(state); }
      await save(state);
      render(mount, { kind:finished ? "done" : "left", step:st.id });
    });
    // Land keyboard and screen-reader users inside the practice (its letter
    // keys only work from there) instead of leaving them on the Start button
    // with two more cards to tab past.
    var into = engineHost.querySelector(".mode-course, .mode-text, .mode-cyoa") || engineHost.querySelector("h2");
    if (into) {
      if (!into.hasAttribute("tabindex")) into.setAttribute("tabindex", "-1");
      try { into.focus({ preventScroll:true }); } catch (e) {}
    }
    if (engineHost.scrollIntoView) engineHost.scrollIntoView({ block:"start" });
  }

  async function openMockBoard(state) {
    var h = await mockHistory();
    state.mockHistoryCount = h.length;
    state.mockHistoryToken = historyToken(h);
    await save(state);
    location.hash = "#/board";
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (G.board && typeof G.board._openMockBoard === "function") {
        clearInterval(timer); G.board._openMockBoard();
      } else if (tries >= 30 || location.hash !== "#/board") clearInterval(timer);
    }, 100);
  }

  G.mockBoardSim = { render:render, KEY:KEY, STEPS:STEPS, _fresh:fresh, _reconcileKnowledge:reconcileKnowledge, _historyToken:historyToken, _pickScenario:pickScenario };
})();
