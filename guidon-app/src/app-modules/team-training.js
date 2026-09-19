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

  // `lanes` = the scenarios an exercise runs, in order. Declared on the row
  // (not buried in begin()'s if-chain) so the catalog and the launcher read
  // the same list and a lane that cannot be found is caught in one place.
  var CATALOG = [
    { id:"contact-relay", phase:1, title:"Contact Report Relay", minutes:12, mode:"scenario",
      lanes:["sc-collective-decision-relay"],
      desc:"Pass a changing tactical problem across the team. Each decision must be discussed, committed, and handed to the next decision-maker.",
      safety:"Use the simulated lane only; no live tactical movement is required." },
    { id:"teach-back", phase:1, title:"Teach-Back Rounds", minutes:10, mode:"teachback",
      desc:"One Soldier teaches a board topic in plain language; the next Soldier corrects or adds one point, then the group checks the source.",
      safety:"Treat GUIDON as a study aid; current publications and cadre guidance control." },
    { id:"all-domain", phase:1, title:"Cohesion Under the Clock: All-Domain Relay", minutes:20, mode:"relay",
      lanes:["sc-iot-comms-blackout","sc-iot-motorpool-belt","sc-iot-range-safety","sc-tccc-ied-strike","sc-medevac-9line-callin"],
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
      lanes:["sc-tccc-ied-strike"],
      desc:"Run the existing TCCC STX as a collective decision lane with a new decision-maker at each major branch.",
      safety:"Simulation only. Current medical training, protocols, and qualified instructors control real casualty care." },
    { id:"degraded-9line", phase:3, title:"Degraded-Comms 9-Line", minutes:12, mode:"medevac",
      lanes:["sc-medevac-9line-callin"],
      desc:"Run the existing 9-line scenario collectively, requiring the group to agree on each major call before committing.",
      safety:"Training simulation only; unit communications and evacuation SOPs control real missions." },
    { id:"tccc-night", phase:3, title:"Squad TCCC Certification Night", minutes:30, mode:"cert",
      lanes:["sc-tccc-ied-strike","sc-medevac-9line-callin"],
      desc:"A GUIDON-led study circuit combining TCCC and 9-line lanes, followed by an AAR. Records only that this local practice circuit was completed.",
      safety:"This does not award or replace any official medical certification." }
  ];

  function say(msg) { try { if (G.util && G.util.announce) G.util.announce(msg); } catch (e) {} }

  async function loadStats() {
    try { var v = await db.getSetting(KEY, {}); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
    catch (e) { return {}; }
  }
  // Queued load -> change -> save: two completions recorded close together
  // (a relay finishing while a leader taps "Record" on another card) used to
  // be able to read the same counts and the later save lost the earlier one.
  var _statsQueue = Promise.resolve();
  function markComplete(id) {
    var run = _statsQueue.then(async function () {
      var s = await loadStats(), cur = s[id] && typeof s[id] === "object" ? s[id] : { count:0, last:0 };
      s[id] = { count:(Number(cur.count) || 0) + 1, last:Date.now() };
      try { await db.setSetting(KEY, s); } catch (e) {}
      try { util.toast("Team-training session recorded."); } catch (e) {}
      return s[id];
    });
    _statsQueue = run.catch(function () {});
    return run;
  }

  // A team exercise is for the GROUP in the room, so its lanes are resolved
  // regardless of the device owner's personal rank filter. G.store.scenario()
  // only knows scenarios that pass that filter, and onboarding sets the
  // filter to the owner's own rank - so a Sergeant First Class running a
  // squad session (the very person this screen is for) could not start half
  // the catalog: every built-in lane is tagged E4-E6 or E1-E6. Fall back to
  // the full built-in library by id.
  function findScenario(id) {
    var sc = null;
    try { sc = G.store && G.store.scenario ? G.store.scenario(id) : null; } catch (e) {}
    if (sc) return sc;
    try {
      var all = window.GUIDON_SEED && window.GUIDON_SEED.scenarios && window.GUIDON_SEED.scenarios.scenarios;
      return (Array.isArray(all) ? all : []).find(function (s) { return s && s.id === id; }) || null;
    } catch (e) { return null; }
  }
  function resolveLanes(ex) {
    var found = [], missing = 0;
    ((ex && ex.lanes) || []).forEach(function (id) { var sc = findScenario(id); if (sc) found.push(sc); else missing++; });
    return { scenarios:found, missing:missing };
  }

  // A "used" button goes aria-disabled, never disabled: a focused button that
  // becomes disabled drops keyboard focus to <body>.
  function spend(btn, label) { btn.setAttribute("aria-disabled", "true"); btn.textContent = label; }
  function spent(btn) { return btn.getAttribute("aria-disabled") === "true"; }
  // Session panels open below a ten-card catalog. Move focus to the new
  // panel's heading so a keyboard or screen-reader user is taken to it
  // instead of being left on the Start button above.
  function headline(text) {
    return el("h3", { text:text, tabIndex:"-1", "data-team-heading":"1" });
  }
  function focusHeading(host) {
    var h = host.querySelector("[data-team-heading]");
    try { if (h) h.focus(); } catch (e) {}
  }

  // `ui` = { back(exerciseId), recorded() } supplied by render().
  function launchSequence(host, ex, ui) {
    var lanes = resolveLanes(ex), scenarios = lanes.scenarios, idx = 0;
    function backButton() {
      var back = el("button.btn.primary", { type:"button", text:"Return to catalog", "data-team-return":"1" });
      back.addEventListener("click", function () { ui.back(ex.id); });
      return back;
    }
    function next(result) {
      util.clear(host);
      if (result && result.cancelled) {
        host.appendChild(el("div.panel", {}, [
          el("div.eyebrow", { text:"Relay paused" }),
          headline("Session not recorded"),
          el("p", { text:"You exited before completing the current lane. No completion was added." }),
          backButton()
        ]));
        focusHeading(host); say("Relay paused. Session not recorded.");
        return;
      }
      if (!scenarios.length) {
        // Never a dead end and never an internal id on screen: say what
        // happened in plain words and always offer the way back.
        host.appendChild(el("div.panel", { "data-team-unavailable":"1" }, [
          el("div.eyebrow", { text:ex.title }),
          headline("This exercise isn't available on this device right now"),
          el("p", { text:"GUIDON could not find the practice lane this exercise uses. Nothing was recorded. You can still run it as a talk-through from the description on its card, or pick another exercise." }),
          backButton()
        ]));
        focusHeading(host); say("This exercise isn't available on this device right now.");
        return;
      }
      if (idx >= scenarios.length) {
        markComplete(ex.id).then(function () {
          host.appendChild(el("div.panel", {}, [
            el("div.eyebrow", { text:"Relay complete" }),
            headline("Run the AAR before you disperse"),
            el("p", { text:"Capture one sustain, one improve, and one action the team will deliberately test next round." }),
            backButton()
          ]));
          focusHeading(host); say("Relay complete. Run the AAR before you disperse.");
          ui.recorded();
        });
        return;
      }
      var sc = scenarios[idx++];
      var status = el("div.panel", {}, [
        el("div.eyebrow", { text:"Relay " + idx + " of " + scenarios.length }),
        el("strong", { text:sc.title }),
        el("p.hint", { text:"Multi-choice decisions use the Collective Decision discussion gate." + (lanes.missing && idx === 1 ? " One part of this exercise isn't available on this device, so the relay is shorter." : "") })
      ]);
      host.appendChild(status);
      var engineHost = el("div.team-engine-host");
      host.appendChild(engineHost);
      // The scenario OBJECT, not its id: G.engine.run(id) would look the id
      // up again through the rank-filtered store and fail the same way.
      G.engine.runCollective(sc, engineHost, next, { discussionSeconds:45 });
    }
    next();
  }

  // One prompt per board pillar, drawn fresh each session. This used to take
  // the FIRST card of each pillar, so every Teach-Back round on every device
  // served the same six questions.
  function teachBackPrompts() {
    var bank = (G.store && G.store.boardQuestions && G.store.boardQuestions()) || [];
    var pillars = (G.board && G.board.PILLARS) || [];
    var prompts = [];
    pillars.forEach(function (p) {
      var pool = bank.filter(function (x) { return x && x.pillar === p && x.q && (x.a || x.answer); });
      if (pool.length) prompts.push(pool[Math.floor(Math.random() * pool.length)]);
    });
    return prompts.slice(0, 6);
  }
  function sourceText(q) {
    var s = q && q.source;
    if (!s) return "";
    if (typeof s === "string") return s;
    if (typeof s === "object") return [s.ref, s.para].filter(Boolean).join(", ");
    return "";
  }

  function renderTeachBack(host, ex, ui) {
    util.clear(host);
    var prompts = teachBackPrompts();
    var p = el("div.panel");
    p.appendChild(el("div.eyebrow", { text:"Teach-Back Rounds" }));
    p.appendChild(headline("Teach it before you reveal it"));
    p.appendChild(el("p", { text:"Take turns. Teach the answer before anyone reveals it; the next Soldier adds or corrects one point. Then reveal and check the source." }));
    if (!prompts.length) p.appendChild(el("p.hint", { text:"No board questions match this device's current rank filter. Use your own study topics for this round." }));
    prompts.forEach(function (q, i) {
      var card = el("div.card", { style:"margin-top:8px", "data-teachback-card":String(q.id || i) });
      card.appendChild(el("strong", { text:(i+1) + ". " + q.q }));
      var ans = el("p.hint", { text:"Answer hidden", "data-teachback-answer":String(i), role:"status", "aria-live":"polite" });
      var b = el("button.btn.sm.ghost", { type:"button", text:"Reveal", "data-teachback-reveal":String(i) });
      b.addEventListener("click", function () {
        if (spent(b)) return;
        var src = sourceText(q);
        ans.textContent = (q.a || q.answer || "") + (src ? " · Source: " + src : "");
        spend(b, "Revealed");
      });
      card.appendChild(ans); card.appendChild(b); p.appendChild(card);
    });
    var again = el("button.btn.ghost", { type:"button", text:"New questions", "data-teachback-again":"1" });
    again.addEventListener("click", function () { renderTeachBack(host, ex, ui); focusHeading(host); say("New teach-back questions."); });
    var done = el("button.btn.primary", { type:"button", text:"Record round complete", "data-team-record":"1" });
    done.addEventListener("click", async function () { if (spent(done)) return; spend(done, "Recorded"); await markComplete(ex.id); ui.recorded(); });
    p.appendChild(el("div.btn-row", { style:"margin-top:10px" }, [done, again]));
    host.appendChild(p);
  }

  function renderAar(host, ex, ui) {
    util.clear(host);
    var questions = [
      "What was supposed to happen?",
      "What actually happened?",
      "Why was there a difference?",
      "What will we sustain or change on the next repetition?"
    ];
    var panel = el("div.panel");
    panel.appendChild(el("div.eyebrow", { text:"AAR Huddle" }));
    panel.appendChild(headline("Four questions, in order"));
    panel.appendChild(el("p.hint", { text:"Anything typed here is a scratch pad for the huddle: it is not saved and is gone when you leave this screen. The completion record stores no names and no note text." }));
    questions.forEach(function (q, i) {
      panel.appendChild(el("label", { text:q, for:"team-aar-" + i }));
      panel.appendChild(el("textarea", { id:"team-aar-" + i, rows:"2", placeholder:"Team notes (optional, not saved)", "aria-label":q }));
    });
    var done = el("button.btn.primary", { type:"button", text:"Finish AAR", "data-team-record":"1" });
    done.addEventListener("click", async function () { if (spent(done)) return; spend(done, "AAR complete"); await markComplete(ex.id); ui.recorded(); });
    panel.appendChild(done); host.appendChild(panel);
  }

  function renderFacilitator(host, ex, ui) {
    util.clear(host);
    var panel = el("div.panel");
    panel.appendChild(el("div.eyebrow", { text:"Facilitator card" }));
    panel.appendChild(headline(ex.title));
    panel.appendChild(el("p", { text:ex.desc }));
    panel.appendChild(el("p.hint", { text:"Safety: " + ex.safety }));
    var list = el("ol");
    ["Brief the objective and time limit.","Assign the first role and observer.","Run one repetition without coaching the answer.","Swap roles and repeat.","Close with one sustain and one improve."].forEach(function (x) { list.appendChild(el("li", { text:x })); });
    panel.appendChild(list);
    var done = el("button.btn.primary", { type:"button", text:"Record session complete", "data-team-record":"1" });
    done.addEventListener("click", async function () { if (spent(done)) return; spend(done, "Recorded"); await markComplete(ex.id); ui.recorded(); });
    panel.appendChild(done); host.appendChild(panel);
  }

  function renderLinkDrills(host, ex, ui) {
    util.clear(host);
    var p = el("div.panel", {}, [el("div.eyebrow", { text:"Facilitated drill" }), headline(ex.title), el("p", { text:ex.desc }), el("p.hint", { text:"Safety: " + ex.safety })]);
    var open = el("button.btn.primary", { type:"button", text:"Open Leadership Drills" });
    open.addEventListener("click", function () { location.hash = "#/drills"; });
    var done = el("button.btn.ghost", { type:"button", text:"Record facilitated session", "data-team-record":"1" });
    done.addEventListener("click", async function () { if (spent(done)) return; spend(done, "Recorded"); await markComplete(ex.id); ui.recorded(); });
    p.appendChild(el("div.btn-row", {}, [open, done])); host.appendChild(p);
  }

  // `focusExercise`: after "Return to catalog" rebuilds this screen, put
  // keyboard focus back on the Start button of the exercise that was run
  // (a full rebuild otherwise drops it to <body>).
  async function render(mount, focusExercise) {
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
      b.addEventListener("click", function () {
        activePhase = pair[0]; drawCatalog();
        var shown = CATALOG.filter(function (x) { return activePhase === 0 || x.phase === activePhase; }).length;
        say((activePhase === 0 ? "All phases" : "Phase " + activePhase) + ": " + shown + " exercises.");
      });
      filters.appendChild(b);
    });
    mount.appendChild(filters);
    var catalogHost = el("div", { "data-team-catalog":"1" });
    mount.appendChild(catalogHost);
    var sessionHost = el("div", { "data-team-session":"1", style:"margin-top:12px" });
    mount.appendChild(sessionHost);

    var ui = {
      back:function (exerciseId) { render(document.getElementById("route") || mount, exerciseId); },
      // Refresh the "Local completions" line on the card. Focus is inside the
      // session panel at this point, so rebuilding the catalog cannot drop it.
      recorded:function () { loadStats().then(function (s) { stats = s; if (catalogHost.isConnected) drawCatalog(); }); }
    };

    function begin(ex) {
      if (ex.lanes) {
        // The scenario engine focuses its own first control.
        launchSequence(sessionHost, ex, ui);
      } else {
        if (ex.mode === "teachback") renderTeachBack(sessionHost, ex, ui);
        else if (ex.mode === "aar") renderAar(sessionHost, ex, ui);
        else if (ex.mode === "link-drills") renderLinkDrills(sessionHost, ex, ui);
        else renderFacilitator(sessionHost, ex, ui);
        focusHeading(sessionHost);
      }
      say(ex.title + " started.");
      try { if (sessionHost.scrollIntoView) sessionHost.scrollIntoView({ block:"start" }); } catch (e) {}
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
        if (st && st.count) card.appendChild(el("p.hint", { text:"Local completions: " + st.count, "data-team-count":ex.id }));
        var start = el("button.btn.primary", { type:"button", text:"Start", "aria-label":"Start " + ex.title, "data-team-start":ex.id });
        start.addEventListener("click", function () { begin(ex); });
        card.appendChild(start); grid.appendChild(card);
      });
      catalogHost.appendChild(grid);
    }
    drawCatalog();
    if (focusExercise) {
      var startBtn = catalogHost.querySelector('[data-team-start="' + focusExercise + '"]');
      try { if (startBtn) { startBtn.focus(); say("Back at the exercise list."); } } catch (e) {}
    }
  }

  G.teamTraining = { render:render, CATALOG:CATALOG, KEY:KEY, _launchSequence:launchSequence, _findScenario:findScenario, _resolveLanes:resolveLanes, _teachBackPrompts:teachBackPrompts };
})();
