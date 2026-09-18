/* GUIDON — Team Training / Scenario Relay (global G.teamTraining)
 * ROADMAP §3e cohesion lane. Ten deliberately bounded exercises reuse the
 * existing scenario engine, board bank, Leader roster, and drill surfaces.
 * No new network service and no personally-identifying team-performance store.
 */
(function () {
  "use strict";
  var G = window.G || (window.G = {});
  var util = G.util, el = util.el, db = G.db;
  var KEY = "team:training:v1";

  var CATALOG = [
    { id:"contact-relay", phase:1, title:"Contact Report Relay", minutes:12, mode:"scenario",
      desc:"Pass a changing tactical problem across the team. Each decision must be discussed, committed, and handed to the next decision-maker.",
      safety:"Use the simulated lane only; no live tactical movement is required." },
    { id:"teach-back", phase:1, title:"Teach-Back Rounds", minutes:10, mode:"teachback",
      desc:"One Soldier teaches a board topic in plain language; the next Soldier corrects or adds one point, then the group checks the source.",
      safety:"Treat GUIDON as a study aid; current publications and cadre guidance control." },
    { id:"all-domain", phase:1, title:"Cohesion Under the Clock: All-Domain Relay", minutes:20, mode:"relay",
      desc:"A linked relay across operations, casualty care, logistics, and reporting. Different Soldiers own successive decisions.",
      safety:"All actions are simulated inside GUIDON." },
    { id:"aar-huddle", phase:1, title:"AAR Huddle", minutes:8, mode:"aar",
      desc:"A structured four-question huddle: what was supposed to happen, what happened, why, and what changes next round.",
      safety:"Focus on observable decisions and process, not personal attacks." },
    { id:"blind-relay", phase:2, title:"Blind Relay", minutes:10, mode:"facilitator",
      desc:"A stationary map/whiteboard communication drill: one teammate describes information the other cannot see, then roles swap.",
      safety:"No blindfolded movement. Keep the exercise seated or stationary and remove trip/fall hazards." },
    { id:"pace-trust", phase:2, title:"Land Nav Pace-Trust", minutes:15, mode:"link-drills",
      desc:"Pair land-navigation reasoning with a deliberate cross-check: one Soldier proposes the solution, another verifies before the team commits.",
      safety:"Use the in-app drill or a properly controlled training area under unit SOP; never substitute this app for real land-navigation risk controls." },
    { id:"mdmp-round", phase:2, title:"MDMP Round-Robin", minutes:15, mode:"link-drills",
      desc:"Rotate ownership of successive MDMP reasoning steps so every participant must explain the handoff to the next teammate.",
      safety:"This is a learning exercise, not a replacement for staff SOP or commander guidance." },
    { id:"casualty-chain", phase:3, title:"Casualty Chain", minutes:15, mode:"tccc",
      desc:"Run the existing TCCC STX as a collective decision lane with a new decision-maker at each major branch.",
      safety:"Simulation only. Current medical training, protocols, and qualified instructors control real casualty care." },
    { id:"degraded-9line", phase:3, title:"Degraded-Comms 9-Line", minutes:12, mode:"medevac",
      desc:"Run the existing 9-line scenario collectively, requiring the group to agree on each major call before committing.",
      safety:"Training simulation only; unit communications and evacuation SOPs control real missions." },
    { id:"tccc-night", phase:3, title:"Squad TCCC Certification Night", minutes:30, mode:"cert",
      desc:"A GUIDON-led study circuit combining TCCC and 9-line lanes, followed by an AAR. Records only that this local practice circuit was completed.",
      safety:"This does not award or replace any official medical certification." }
  ];

  async function loadStats() {
    try { var v = await db.getSetting(KEY, {}); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
    catch (e) { return {}; }
  }
  async function markComplete(id) {
    var s = await loadStats(), cur = s[id] || { count:0, last:0 };
    s[id] = { count:(cur.count || 0) + 1, last:Date.now() };
    try { await db.setSetting(KEY, s); } catch (e) {}
    try { util.toast("Team-training session recorded."); } catch (e) {}
    return s[id];
  }

  function launchSequence(host, ids, exerciseId, collective) {
    var idx = 0;
    function next() {
      util.clear(host);
      if (idx >= ids.length) {
        markComplete(exerciseId).then(function () {
          host.appendChild(el("div.panel", {}, [
            el("div.eyebrow", { text:"Relay complete" }),
            el("h3", { text:"Run the AAR before you disperse" }),
            el("p", { text:"Capture one sustain, one improve, and one action the team will deliberately test next round." }),
            el("button.btn.primary", { type:"button", text:"Return to catalog", onclick:function () { render(document.getElementById("view") || host.parentElement); } })
          ]));
        });
        return;
      }
      var id = ids[idx++];
      var sc = G.store && G.store.scenario ? G.store.scenario(id) : null;
      if (!sc) {
        host.appendChild(el("div.panel", {}, [el("strong", { text:"Scenario unavailable under the current rank/content filter: " + id })]));
        return;
      }
      var status = el("div.panel", {}, [
        el("div.eyebrow", { text:"Relay " + idx + " of " + ids.length }),
        el("strong", { text:sc.title }),
        el("p.hint", { text:collective ? "Multi-choice decisions use the Collective Decision discussion gate." : "Complete this lane, then tap Done to hand off." })
      ]);
      host.appendChild(status);
      var engineHost = el("div.team-engine-host");
      host.appendChild(engineHost);
      G.engine.run(id, "course", engineHost, next, { collective:!!collective, discussionSeconds:45 });
    }
    next();
  }

  function renderTeachBack(host, exerciseId) {
    util.clear(host);
    var bank = (G.store && G.store.boardQuestions && G.store.boardQuestions()) || [];
    var pillars = (G.board && G.board.PILLARS) || [];
    var prompts = [];
    pillars.forEach(function (p) {
      var q = bank.find(function (x) { return x.pillar === p; });
      if (q) prompts.push(q);
    });
    prompts = prompts.slice(0, 6);
    var p = el("div.panel");
    p.appendChild(el("div.eyebrow", { text:"Teach-Back Rounds" }));
    p.appendChild(el("p", { text:"Take turns. Teach the answer before anyone reveals it; the next Soldier adds or corrects one point. Then reveal and check the source." }));
    prompts.forEach(function (q, i) {
      var card = el("div.card", { style:"margin-top:8px" });
      card.appendChild(el("strong", { text:(i+1) + ". " + q.q }));
      var ans = el("p.hint", { text:"Answer hidden", "data-teachback-answer":String(i) });
      var b = el("button.btn.sm.ghost", { type:"button", text:"Reveal" });
      b.addEventListener("click", function () {
        ans.textContent = (q.a || q.answer || "") + (q.source ? " · Source: " + q.source : "");
        b.disabled = true; b.textContent = "Revealed";
      });
      card.appendChild(ans); card.appendChild(b); p.appendChild(card);
    });
    var done = el("button.btn.primary", { type:"button", text:"Record round complete" });
    done.addEventListener("click", async function () { await markComplete(exerciseId); done.disabled = true; done.textContent = "Recorded"; });
    p.appendChild(done); host.appendChild(p);
  }

  function renderAar(host, exerciseId) {
    util.clear(host);
    var questions = [
      "What was supposed to happen?",
      "What actually happened?",
      "Why was there a difference?",
      "What will we sustain or change on the next repetition?"
    ];
    var panel = el("div.panel");
    panel.appendChild(el("div.eyebrow", { text:"AAR Huddle" }));
    panel.appendChild(el("p.hint", { text:"Keep notes on the local device only if useful. The completion record stores no names and no note text." }));
    questions.forEach(function (q, i) {
      panel.appendChild(el("label", { text:q, for:"team-aar-" + i }));
      panel.appendChild(el("textarea", { id:"team-aar-" + i, rows:"2", placeholder:"Team notes (optional)", "aria-label":q }));
    });
    var done = el("button.btn.primary", { type:"button", text:"Finish AAR" });
    done.addEventListener("click", async function () { await markComplete(exerciseId); done.disabled = true; done.textContent = "AAR complete"; });
    panel.appendChild(done); host.appendChild(panel);
  }

  function renderFacilitator(host, ex) {
    util.clear(host);
    var panel = el("div.panel");
    panel.appendChild(el("div.eyebrow", { text:"Facilitator card" }));
    panel.appendChild(el("h3", { text:ex.title }));
    panel.appendChild(el("p", { text:ex.desc }));
    panel.appendChild(el("p.hint", { text:"Safety: " + ex.safety }));
    var list = el("ol");
    ["Brief the objective and time limit.","Assign the first role and observer.","Run one repetition without coaching the answer.","Swap roles and repeat.","Close with one sustain and one improve."].forEach(function (x) { list.appendChild(el("li", { text:x })); });
    panel.appendChild(list);
    var done = el("button.btn.primary", { type:"button", text:"Record session complete" });
    done.addEventListener("click", async function () { await markComplete(ex.id); done.disabled = true; done.textContent = "Recorded"; });
    panel.appendChild(done); host.appendChild(panel);
  }

  async function render(mount) {
    util.clear(mount);
    var activePhase = 0;
    var stats = await loadStats();

    mount.appendChild(el("div.section-title", {}, [el("h2", { text:"Team Training" }), el("div.rule")]));
    mount.appendChild(el("p.hint", { text:"Optional collective practice. GUIDON coordinates discussion, handoffs, and AARs; leaders still own training standards, safety, and unit SOP." }));

    var top = el("div.panel");
    top.appendChild(el("div.eyebrow", { text:"Leader tie-in" }));
    top.appendChild(el("p", { text:"The existing Squad Roster remains the single roster. Team Training stores only exercise-level completion counts—never another copy of Soldier names or individual scores." }));
    var roster = el("button.btn.ghost", { type:"button", text:"Open Squad Roster" });
    roster.addEventListener("click", function () { location.hash = "#/leader"; });
    top.appendChild(roster); mount.appendChild(top);

    var filters = el("div.segmented", { role:"group", "aria-label":"Team-building phase" });
    [[0,"All"],[1,"Phase 1"],[2,"Phase 2"],[3,"Phase 3"]].forEach(function (pair) {
      var b = el("button", { type:"button", text:pair[1], "data-team-phase":String(pair[0]), "aria-pressed":String(activePhase === pair[0]) });
      if (activePhase === pair[0]) b.classList.add("active");
      b.addEventListener("click", function () { activePhase = pair[0]; drawCatalog(); });
      filters.appendChild(b);
    });
    mount.appendChild(filters);
    var catalogHost = el("div", { "data-team-catalog":"1" });
    mount.appendChild(catalogHost);
    var sessionHost = el("div", { "data-team-session":"1", style:"margin-top:12px" });
    mount.appendChild(sessionHost);

    function begin(ex) {
      sessionHost.scrollIntoView && sessionHost.scrollIntoView({ block:"start" });
      if (ex.mode === "scenario") return launchSequence(sessionHost, ["sc-collective-decision-relay"], ex.id, true);
      if (ex.mode === "relay") return launchSequence(sessionHost, ["sc-iot-comms-blackout","sc-iot-motorpool-belt","sc-iot-range-safety","sc-tccc-ied-strike","sc-medevac-9line-callin"], ex.id, true);
      if (ex.mode === "teachback") return renderTeachBack(sessionHost, ex.id);
      if (ex.mode === "aar") return renderAar(sessionHost, ex.id);
      if (ex.mode === "tccc") return launchSequence(sessionHost, ["sc-tccc-ied-strike"], ex.id, true);
      if (ex.mode === "medevac") return launchSequence(sessionHost, ["sc-medevac-9line-callin"], ex.id, true);
      if (ex.mode === "cert") return launchSequence(sessionHost, ["sc-tccc-ied-strike","sc-medevac-9line-callin"], ex.id, true);
      if (ex.mode === "link-drills") {
        util.clear(sessionHost);
        var p = el("div.panel", {}, [el("h3", { text:ex.title }), el("p", { text:ex.desc }), el("p.hint", { text:"Safety: " + ex.safety })]);
        var open = el("button.btn.primary", { type:"button", text:"Open Leadership Drills" });
        open.addEventListener("click", function () { location.hash = "#/drills"; });
        var done = el("button.btn.ghost", { type:"button", text:"Record facilitated session" });
        done.addEventListener("click", async function () { await markComplete(ex.id); done.disabled = true; done.textContent = "Recorded"; });
        p.appendChild(open); p.appendChild(done); sessionHost.appendChild(p); return;
      }
      renderFacilitator(sessionHost, ex);
    }

    function drawCatalog() {
      util.clear(catalogHost);
      Array.from(filters.querySelectorAll("button")).forEach(function (b) {
        var on = Number(b.getAttribute("data-team-phase")) === activePhase;
        b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on));
      });
      var grid = el("div.card-results-grid");
      CATALOG.filter(function (x) { return activePhase === 0 || x.phase === activePhase; }).forEach(function (ex) {
        var card = el("div.panel", { "data-team-exercise":ex.id });
        card.appendChild(el("div.eyebrow", { text:"Phase " + ex.phase + " · " + ex.minutes + " min" }));
        card.appendChild(el("h3", { text:ex.title }));
        card.appendChild(el("p", { text:ex.desc }));
        card.appendChild(el("p.hint", { text:"Safety: " + ex.safety }));
        var st = stats[ex.id];
        if (st && st.count) card.appendChild(el("p.hint", { text:"Local completions: " + st.count }));
        var start = el("button.btn.primary", { type:"button", text:"Start", "data-team-start":ex.id });
        start.addEventListener("click", function () { begin(ex); });
        card.appendChild(start); grid.appendChild(card);
      });
      catalogHost.appendChild(grid);
    }
    drawCatalog();
  }

  G.teamTraining = { render:render, CATALOG:CATALOG, KEY:KEY, _launchSequence:launchSequence };
})();