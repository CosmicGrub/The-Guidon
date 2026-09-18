/* GUIDON — Board Simulator wrapper (global G.mockBoardSim)
 * ROADMAP §3f Phase 1–2: deterministic, offline multi-phase board practice.
 * Reuses G.engine for procedural/judgment phases and the existing live Mock
 * Board tab for dynamic knowledge questions; no server or generative opponent.
 */
(function () {
  "use strict";
  var G = window.G || (window.G = {});
  var util = G.util, el = util.el, db = G.db;
  var KEY = "board:sim:v1";
  var MOCK_HISTORY = "board:mockHistory:v1";

  function fresh() {
    return {
      version:1, reportingDone:false, knowledgeDone:false, judgmentDone:false,
      mockHistoryCount:null, mockHistoryToken:null, startedAt:0, completedAt:0,
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
  async function reconcileKnowledge(s) {
    if ((s.mockHistoryCount == null && s.mockHistoryToken == null) || s.knowledgeDone) return s;
    var h = await mockHistory();
    var grew = s.mockHistoryCount != null && h.length > Number(s.mockHistoryCount || 0);
    var changedAtCap = s.mockHistoryToken != null && historyToken(h) !== s.mockHistoryToken;
    if (grew || changedAtCap) {
      s.knowledgeDone = true;
      s.completedAt = s.judgmentDone ? Date.now() : s.completedAt;
      await save(s);
    }
    return s;
  }
  function phaseCard(n, title, done, body) {
    var c = el("div.panel.board-sim-phase", { "data-board-sim-phase":String(n) });
    c.appendChild(el("div.eyebrow", { text:"Phase " + n + (done ? " · Complete" : "") }));
    c.appendChild(el("h3", { text:title }));
    c.appendChild(el("p", { text:body }));
    return c;
  }

  async function render(mount) {
    util.clear(mount);
    var state = await reconcileKnowledge(await load());
    if (!state.startedAt) { state.startedAt = Date.now(); await save(state); }

    mount.appendChild(el("div.section-title", {}, [el("h2", { text:"Board Simulator" }), el("div.rule")]));
    mount.appendChild(el("p.hint", { text:"A deterministic, offline board run: reporting procedure → live knowledge round → judgment scenario → AAR. Exact board procedures vary; your unit MOI, sponsor guidance, and board president control." }));

    var status = el("div.panel", { role:"status", "aria-live":"polite", "data-board-sim-status":"1" });
    var doneCount = [state.reportingDone,state.knowledgeDone,state.judgmentDone].filter(Boolean).length;
    status.appendChild(el("div.eyebrow", { text:"Session progress" }));
    status.appendChild(el("strong", { text:doneCount + " of 3 active phases complete" }));
    if (doneCount === 3) status.appendChild(el("p.hint", { text:"Complete the AAR below, then reset whenever you want a fresh board sequence." }));
    mount.appendChild(status);

    var p1 = phaseCard(1, "Report to the board", state.reportingDone,
      "Practice the procedural decisions around preparation, entry, directions, and reporting without pretending every unit uses one universal script.");
    var start1 = el("button.btn.primary", { type:"button", text:state.reportingDone ? "Run reporting phase again" : "Start reporting phase", "data-board-sim-reporting":"1" });
    p1.appendChild(start1); mount.appendChild(p1);

    var p2 = phaseCard(2, "Knowledge round", state.knowledgeDone,
      "Launch GUIDON's existing Mock Board: timed spoken answers, answer reveal, self-scoring, rubric dimensions, history, and printable AAR.");
    var start2 = el("button.btn.primary", { type:"button", text:state.knowledgeDone ? "Run another live Mock Board" : "Open live Mock Board", "data-board-sim-knowledge":"1" });
    p2.appendChild(start2); mount.appendChild(p2);

    var p3 = phaseCard(3, "Leadership judgment", state.judgmentDone,
      "Finish with a consequence-based scenario. The goal is to explain the decision, standards, tradeoffs, and follow-through—not guess a magic phrase.");
    var start3 = el("button.btn.primary", { type:"button", text:state.judgmentDone ? "Run judgment phase again" : "Start judgment phase", "data-board-sim-judgment":"1" });
    p3.appendChild(start3); mount.appendChild(p3);

    var engineHost = el("div", { "data-board-sim-engine":"1", style:"margin-top:12px" });
    mount.appendChild(engineHost);

    start1.addEventListener("click", function () {
      util.clear(engineHost);
      G.engine.run("sc-board-simulator-reporting", "course", engineHost, async function () {
        state.reportingDone = true; await save(state); render(mount);
      });
      engineHost.scrollIntoView && engineHost.scrollIntoView({ block:"start" });
    });

    start2.addEventListener("click", async function () {
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
    });

    start3.addEventListener("click", function () {
      util.clear(engineHost);
      G.engine.run("sc-iot-range-safety", "course", engineHost, async function () {
        state.judgmentDone = true;
        if (state.reportingDone && state.knowledgeDone) state.completedAt = Date.now();
        await save(state); render(mount);
      });
      engineHost.scrollIntoView && engineHost.scrollIntoView({ block:"start" });
    });

    var aar = el("div.panel", { "data-board-sim-aar":"1" });
    aar.appendChild(el("div.eyebrow", { text:"Phase 4 · AAR" }));
    aar.appendChild(el("h3", { text:"Close the loop" }));
    if (doneCount < 3) {
      aar.appendChild(el("p.hint", { text:"Finish the first three phases for the strongest full-session AAR. You can still write notes now." }));
    }
    [["strong","What answer, behavior, or preparation should you sustain?"],
     ["improve","What should change before the next board repetition?"],
     ["next","What is the single highest-value topic or behavior to rehearse next?"]].forEach(function (pair) {
       aar.appendChild(el("label", { text:pair[1], for:"board-sim-" + pair[0] }));
       var ta = el("textarea", {
         id:"board-sim-" + pair[0], rows:"2", "aria-label":pair[1],
         value:String((state.aarDraft && state.aarDraft[pair[0]]) || "")
       });
       ta.addEventListener("input", function () {
         state.aarDraft = state.aarDraft || { strong:"", improve:"", next:"" };
         state.aarDraft[pair[0]] = ta.value;
         save(state);
       });
       aar.appendChild(ta);
     });
    var history = await mockHistory();
    if (history.length) {
      var last = history[history.length - 1];
      aar.appendChild(el("p.hint", { text:"Latest Mock Board history: " + (last.pct != null ? last.pct + "%" : "saved session") + "." }));
    }
    var reset = el("button.btn.ghost", { type:"button", text:"Start a fresh simulator session", "data-board-sim-reset":"1" });
    reset.addEventListener("click", async function () {
      state = fresh(); state.startedAt = Date.now(); await save(state); render(mount);
    });
    aar.appendChild(reset); mount.appendChild(aar);

    var related = el("div.panel");
    related.appendChild(el("div.eyebrow", { text:"Related" }));
    var board = el("button.btn.sm.ghost", { type:"button", text:"Board Drill" });
    board.addEventListener("click", function () { location.hash = "#/board"; });
    var reps = el("button.btn.sm.ghost", { type:"button", text:"5-Minute Board Reps" });
    reps.addEventListener("click", function () { if (G.board) G.board._filterReps = true; location.hash = "#/board"; });
    related.appendChild(board); related.appendChild(reps); mount.appendChild(related);
  }

  G.mockBoardSim = { render:render, KEY:KEY, _fresh:fresh, _reconcileKnowledge:reconcileKnowledge, _historyToken:historyToken };
})();