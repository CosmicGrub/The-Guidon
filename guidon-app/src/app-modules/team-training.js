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

  // ---- Team sessions (AUDIT-2026-09 6M / ROADMAP "Later": Study Rooms
  // carrying Team Training sessions) -----------------------------------------
  // A "session" here is an ordered list of catalog exercises a leader plans to
  // run in one sitting - nothing but exercise ids in order and a short name
  // the leader gave it. It is saved on this device ("team:sessions:v1"), run
  // one exercise after another, and can be sent to a Study Room, where each
  // Soldier previews it and chooses whether to add it to THEIR list. It never
  // holds a name, a score, a note or a result: the completion counts stay in
  // team:training:v1 exactly as before.
  var SESSIONS_KEY = "team:sessions:v1";
  var SESSION_MAX = 20;
  var SESSION_TITLE_MAX = 40;
  var SESSION_STEPS_MAX = 10;
  function exerciseById(id) {
    for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i];
    return null;
  }
  function sessionMinutes(steps) {
    return steps.reduce(function (n, id) { var ex = exerciseById(id); return n + (ex ? ex.minutes : 0); }, 0);
  }
  function cleanTitle(s) { return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, SESSION_TITLE_MAX) : ""; }
  // Every read, from storage or a backup, is rebuilt field by field: only ids
  // this catalog really has survive, capped, and a row with nothing left is
  // dropped rather than shown as an empty card.
  function normalizeSessions(v) {
    if (!Array.isArray(v)) return [];
    var seen = {}, out = [];
    v.forEach(function (s) {
      if (!s || typeof s !== "object" || Array.isArray(s)) return;
      if (typeof s.id !== "string" || !s.id || seen[s.id]) return;
      var steps = Array.isArray(s.steps) ? s.steps.filter(function (x) { return typeof x === "string" && exerciseById(x); }).slice(0, SESSION_STEPS_MAX) : [];
      if (!steps.length) return;
      seen[s.id] = true;
      out.push({ id:s.id, title:cleanTitle(s.title) || "Team session", steps:steps, createdAt:typeof s.createdAt === "number" && isFinite(s.createdAt) ? s.createdAt : Date.now() });
    });
    return out.slice(0, SESSION_MAX);
  }
  async function loadSessions() {
    try { return normalizeSessions(await db.getSetting(SESSIONS_KEY, [])); }
    catch (e) { return []; }
  }
  // Load -> change -> save on one queue (the same shape as markComplete):
  // `change(list)` returns the new list, or null to leave things as they are.
  var _sessionsQueue = Promise.resolve();
  function updateSessions(change) {
    var run = _sessionsQueue.then(async function () {
      var cur = await loadSessions();
      var next = change(cur.slice());
      if (!next) return cur;
      var list = normalizeSessions(next);
      await db.setSetting(SESSIONS_KEY, list);
      return list;
    });
    _sessionsQueue = run.catch(function () {});
    return run;
  }
  var _sessionSeq = 0;
  function nextSessionId() { return "ts-" + Date.now().toString(36) + "-" + (++_sessionSeq); }
  function sameSteps(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function stepLines(steps) {
    return steps.map(function (id, i) { var ex = exerciseById(id); return (i + 1) + ". " + (ex ? ex.title + " (" + ex.minutes + " min)" : "An exercise this version doesn't have"); });
  }

  // The session being run one exercise after another (set by "Start
  // session"). Kept at module level so "Return to catalog" - which rebuilds
  // the whole screen - does not lose its place. `_running` is the exercise
  // whose panel is open right now, so a completion only moves the session on
  // when it is the exercise the session was waiting for.
  var _chain = null;
  var _running = "";

  // Study Rooms hand-off (src/app-modules/room-schema.js, "THE HAND-OFF
  // MODEL", kind "team-session"): the wire carries exercise ids in order and
  // a short name. Which ids exist is THIS device's catalog - an exercise a
  // newer build has and this one does not is counted as "not on this device",
  // never shown by id and never added.
  function handoffPrepare(data, offer) {
    var known = data.steps.filter(exerciseById), missing = data.steps.length - known.length;
    if (!known.length) return { ok:false, message:"None of this session's exercises are on this device, so there is nothing to add. Update GUIDON on this device, then ask the host to share it again." };
    var notes = ["About " + sessionMinutes(known) + " minutes in all.", "Adding this saves it in your list of team sessions on this device. It holds only the exercise names in order - no names and no scores."];
    if (missing) notes.push(missing + (missing === 1 ? " exercise isn't" : " exercises aren't") + " on this device and will be left out.");
    return { ok:true, title:cleanTitle(offer && offer.title) || "Team session", lines:stepLines(known), notes:notes };
  }
  async function handoffApply(data, offer) {
    var known = data.steps.filter(exerciseById), missing = data.steps.length - known.length;
    var title = cleanTitle(offer && offer.title) || "Team session";
    var newId = nextSessionId(), duplicate = false, full = false;
    try {
      await updateSessions(function (cur) {
        if (cur.some(function (s) { return s.title === title && sameSteps(s.steps, known); })) { duplicate = true; return null; }
        if (cur.length >= SESSION_MAX) { full = true; return null; }
        cur.push({ id:newId, title:title, steps:known, createdAt:Date.now() });
        return cur;
      });
    } catch (e) { return { ok:false, message:"GUIDON couldn't save that session. Nothing was changed." }; }
    if (full) return { ok:false, message:"You already have " + SESSION_MAX + " saved team sessions. Remove one, then try again." };
    if (duplicate) return { ok:true, message:"You already have this session saved, so nothing new was added." };
    return {
      ok:true,
      message:"Added to Team Training." + (missing ? " " + missing + (missing === 1 ? " exercise wasn't" : " exercises weren't") + " on this device and " + (missing === 1 ? "was" : "were") + " left out." : ""),
      undo:async function () {
        try { await updateSessions(function (cur) { return cur.filter(function (s) { return s.id !== newId; }); }); return { ok:true }; }
        catch (e) { return { ok:false }; }
      }
    };
  }
  var ROOM_ADAPTER = { kind:"team-session", addText:"Add to Team Training", openHash:"#/team", openText:"Open Team Training", prepare:handoffPrepare, apply:handoffApply };
  if (G.roomHandoffAdapters) G.roomHandoffAdapters["team-session"] = ROOM_ADAPTER;
  // The host side: a title and an ordered list of ids -> the payload Study
  // Rooms sends (and the lines its confirm box lists, word for word).
  async function handoffBuild(title, steps) {
    var ids = (Array.isArray(steps) ? steps : []).filter(exerciseById);
    if (!ids.length) return { ok:false, message:"Add at least one exercise to the session first." };
    if (ids.length > SESSION_STEPS_MAX) return { ok:false, message:"A session can hold up to " + SESSION_STEPS_MAX + " exercises." };
    var name = cleanTitle(title) || "Team session";
    var guard = G.opsecGuard;
    if (!guard || typeof guard.screen !== "function") return { ok:false, message:"GUIDON couldn't check the session name, so nothing was sent." };
    var found = guard.screen(name).findings;
    if (found.length) return { ok:false, message:"The session name looks like it holds " + guard.listWhat(found) + ", so nothing was sent. Change the name and try again." };
    return { ok:true, title:name, data:{ steps:ids.slice() }, lines:[name].concat(stepLines(ids), ["About " + sessionMinutes(ids) + " minutes in all."]) };
  }

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
    top.appendChild(el("p", { text:"The existing Squad Roster remains the single roster. Team Training stores only exercise-level completion counts—never another copy of Soldier names or individual scores. A saved team session keeps only the exercise names in the order you set." }));
    var roster = el("button.btn.ghost", { type:"button", text:"Open Squad Roster" });
    roster.addEventListener("click", function () { location.hash = "#/leader"; });
    top.appendChild(roster); mount.appendChild(top);
    // Team sessions: the saved list and the "Plan a session" builder, then the
    // session-in-progress bar (both filled in below, once begin() exists).
    var sessionsHost = el("div", { "data-team-sessions":"1", style:"margin-top:10px" });
    mount.appendChild(sessionsHost);
    var chainHost = el("div", { "data-team-chain":"1", style:"margin-top:10px" });
    mount.appendChild(chainHost);

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
      recorded:function () {
        advanceChain();
        loadStats().then(function (s) { stats = s; if (catalogHost.isConnected) drawCatalog(); });
      }
    };

    function begin(ex) {
      _running = ex.id;
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

    // ---- the session in progress: "N of M done, next: ..." ----
    function drawChain() {
      util.clear(chainHost);
      if (!_chain) return;
      var total = _chain.steps.length;
      var panel = el("div.panel", { "data-team-chain-bar":"1", role:"group", "aria-label":"Team session in progress" });
      panel.appendChild(el("div.eyebrow", { text:"Session in progress" }));
      panel.appendChild(el("strong", { text:_chain.title }));
      if (_chain.done >= total) {
        panel.appendChild(el("p", { text:"Session complete: all " + total + (total === 1 ? " exercise is" : " exercises are") + " recorded. Run the AAR before you disperse." }));
        var fin = el("button.btn.primary", { type:"button", text:"Finish session", "data-team-chain-finish":"1" });
        fin.addEventListener("click", function () { _chain = null; _running = ""; drawChain(); say("Session finished."); });
        panel.appendChild(fin);
      } else {
        var next = exerciseById(_chain.steps[_chain.done]);
        panel.appendChild(el("p", { text:_chain.done + " of " + total + " done. Next: " + (next ? next.title + " (" + next.minutes + " min)" : "an exercise") + "." }));
        var row = el("div.btn-row", { style:"gap:8px" });
        var go = el("button.btn.primary", { type:"button", text:"Start " + (next ? next.title : "next exercise"), "data-team-chain-next":"1" });
        go.addEventListener("click", function () { if (next) begin(next); });
        var stop = el("button.btn.ghost", { type:"button", text:"End session", "data-team-chain-end":"1" });
        stop.addEventListener("click", function () { _chain = null; _running = ""; drawChain(); say("Session ended. Exercises already recorded stay recorded."); });
        row.appendChild(go); row.appendChild(stop);
        panel.appendChild(row);
      }
      chainHost.appendChild(panel);
    }
    // Only an exercise the session was WAITING for moves it on; running some
    // other exercise from the catalog mid-session leaves it where it was.
    function advanceChain() {
      if (!_chain || !_running || _chain.steps[_chain.done] !== _running) return;
      _chain.done++; _running = "";
      drawChain();
      say(_chain.done >= _chain.steps.length ? "Session complete. Run the AAR before you disperse." : "Exercise " + _chain.done + " of " + _chain.steps.length + " recorded. The next one is ready.");
    }

    // ---- saved sessions + "Plan a session" ----
    var draft = { title:"", steps:[], open:false };
    var sessionsGen = 0, sessionsStatus = "", sessionsGate = null;
    async function drawSessions(focusSel) {
      var gen = ++sessionsGen;
      var list = await loadSessions();
      if (gen !== sessionsGen || !sessionsHost.isConnected) return;
      util.clear(sessionsHost);
      var panel = el("div.panel", { "data-team-session-panel":"1" });
      panel.appendChild(el("div.eyebrow", { text:"Team sessions" }));
      panel.appendChild(el("p.hint", { text:"A session is a few exercises in the order you will run them. Save the ones you use, or share one to your Study Room so your team can add it too. A saved session keeps only the exercise names and their order - no names, no scores." }));
      var status = el("p.hint", { role:"status", "aria-live":"polite", "data-team-sessions-status":"1", text:sessionsStatus });
      var statusGo = el("div");
      function setStatus(text, gate) {
        sessionsStatus = text; status.textContent = text;
        util.clear(statusGo);
        if (gate && gate.go) {
          var open = el("button.btn.sm.ghost", { type:"button", text:gate.goText || "Open", "data-team-share-open":"1" });
          open.addEventListener("click", function () { location.hash = gate.go; });
          statusGo.appendChild(open);
        }
      }
      // One shared Study Rooms call for every button here: Study Rooms builds
      // the confirm box and does the send; this file only supplies the payload.
      async function shareVia(build) {
        if (!(G.studyGroup && typeof G.studyGroup.share === "function")) { setStatus("Study Rooms isn't available in this build."); return; }
        var r = await G.studyGroup.share({ kind:"team-session", build:build });
        setStatus(r.text, r.gate);
      }

      if (!list.length) panel.appendChild(el("p.hint", { text:"No saved sessions yet. Plan one below." }));
      list.forEach(function (s) {
        var card = el("div.card", { "data-team-session-card":s.id, style:"margin-top:8px" });
        card.appendChild(el("strong", { text:s.title }));
        card.appendChild(el("p.hint", { text:s.steps.length + (s.steps.length === 1 ? " exercise" : " exercises") + " - about " + sessionMinutes(s.steps) + " min" }));
        var ol = el("ol", { style:"margin:4px 0 8px 1.2rem;padding:0" });
        s.steps.forEach(function (id) { var ex = exerciseById(id); if (ex) ol.appendChild(el("li", { text:ex.title })); });
        card.appendChild(ol);
        var row = el("div.btn-row", { style:"gap:8px;flex-wrap:wrap" });
        var startS = el("button.btn.primary.sm", { type:"button", text:"Start session", "aria-label":"Start session " + s.title, "data-team-session-start":s.id });
        startS.addEventListener("click", function () {
          var first = exerciseById(s.steps[0]);
          if (!first) return;
          _chain = { id:s.id, title:s.title, steps:s.steps.slice(), done:0 };
          drawChain();
          begin(first);
        });
        var shareS = el("button.btn.sm.ghost", { type:"button", text:"Share to my room", "aria-label":"Share " + s.title + " to my room", "data-team-session-share":s.id });
        shareS.addEventListener("click", async function () {
          if (spent(shareS)) return;
          shareS.setAttribute("aria-disabled", "true");
          try { await shareVia(function () { return handoffBuild(s.title, s.steps); }); }
          finally { shareS.removeAttribute("aria-disabled"); }
        });
        var rm = el("button.btn.sm.ghost", { type:"button", text:"Remove", "aria-label":"Remove session " + s.title, "data-team-session-remove":s.id });
        rm.addEventListener("click", async function () {
          var yes = !(G.modal && G.modal.confirm) || await G.modal.confirm("Remove the session \"" + s.title + "\" from this device? The exercises themselves are not affected.", { title:"Remove session", okText:"Remove", danger:true });
          if (!yes) return;
          try { await updateSessions(function (cur) { return cur.filter(function (x) { return x.id !== s.id; }); }); sessionsStatus = "Session removed."; }
          catch (e) { sessionsStatus = "GUIDON couldn't remove that session."; }
          if (_chain && _chain.id === s.id) { _chain = null; _running = ""; drawChain(); }
          say(sessionsStatus);
          drawSessions("[data-team-plan-summary]");
        });
        row.appendChild(startS); row.appendChild(shareS); row.appendChild(rm);
        card.appendChild(row);
        panel.appendChild(card);
      });
      panel.appendChild(status); panel.appendChild(statusGo);

      // ---- Plan a session ----
      var det = el("details", { "data-team-builder":"1", style:"margin-top:10px" });
      if (draft.open) det.open = true;
      det.addEventListener("toggle", function () { draft.open = det.open; });
      det.appendChild(el("summary", { text:"Plan a session", "data-team-plan-summary":"1" }));
      var nameId = "team-session-name";
      det.appendChild(el("label", { text:"Session name (optional)", for:nameId }));
      var nameIn = el("input", { type:"text", id:nameId, maxlength:String(SESSION_TITLE_MAX), value:draft.title, "data-team-session-name":"1", style:"width:100%;margin-bottom:8px" });
      nameIn.addEventListener("input", function () { draft.title = nameIn.value; });
      det.appendChild(nameIn);
      det.appendChild(el("p.hint", { text:"Add exercises in the order you will run them - up to " + SESSION_STEPS_MAX + "." }));
      var pick = el("div", { style:"display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px" });
      CATALOG.forEach(function (ex) {
        var full = draft.steps.length >= SESSION_STEPS_MAX;
        var add = el("button.btn.sm.ghost", { type:"button", text:ex.title, "aria-label":"Add " + ex.title + " to the session", "data-team-add":ex.id, style:"text-align:left;overflow-wrap:anywhere;max-width:100%" });
        if (full) add.setAttribute("aria-disabled", "true");
        add.addEventListener("click", function () {
          if (add.getAttribute("aria-disabled") === "true") { say("The session already has " + SESSION_STEPS_MAX + " exercises."); return; }
          draft.steps.push(ex.id); draft.open = true;
          say(ex.title + " added. " + draft.steps.length + (draft.steps.length === 1 ? " exercise" : " exercises") + " in the session.");
          drawSessions('[data-team-add="' + ex.id + '"]');
        });
        pick.appendChild(add);
      });
      det.appendChild(pick);
      if (draft.steps.length) {
        var ordered = el("ol", { "data-team-draft":"1", style:"margin:4px 0 8px 1.2rem;padding:0" });
        draft.steps.forEach(function (id, i) {
          var ex = exerciseById(id);
          var li = el("li", { style:"margin:4px 0" });
          li.appendChild(el("span", { text:(ex ? ex.title + " (" + ex.minutes + " min)" : id) + " " }));
          var up = el("button.btn.sm.ghost", { type:"button", text:"Up", "aria-label":"Move " + ex.title + " up", "data-team-up":String(i) });
          var down = el("button.btn.sm.ghost", { type:"button", text:"Down", "aria-label":"Move " + ex.title + " down", "data-team-down":String(i) });
          var del = el("button.btn.sm.ghost", { type:"button", text:"Remove", "aria-label":"Remove " + ex.title + " from the session", "data-team-drop":String(i) });
          if (i === 0) up.setAttribute("aria-disabled", "true");
          if (i === draft.steps.length - 1) down.setAttribute("aria-disabled", "true");
          up.addEventListener("click", function () {
            if (i === 0) return;
            var t = draft.steps[i - 1]; draft.steps[i - 1] = draft.steps[i]; draft.steps[i] = t;
            say(ex.title + " moved to position " + i + ".");
            drawSessions('[data-team-up="' + (i - 1) + '"]');
          });
          down.addEventListener("click", function () {
            if (i >= draft.steps.length - 1) return;
            var t = draft.steps[i + 1]; draft.steps[i + 1] = draft.steps[i]; draft.steps[i] = t;
            say(ex.title + " moved to position " + (i + 2) + ".");
            drawSessions('[data-team-down="' + (i + 1) + '"]');
          });
          del.addEventListener("click", function () {
            draft.steps.splice(i, 1);
            say(ex.title + " removed from the session.");
            drawSessions(draft.steps.length ? '[data-team-drop="' + Math.min(i, draft.steps.length - 1) + '"]' : "[data-team-plan-summary]");
          });
          li.appendChild(up); li.appendChild(down); li.appendChild(del);
          ordered.appendChild(li);
        });
        det.appendChild(ordered);
      }
      det.appendChild(el("p.hint", { "data-team-draft-total":"1", text:draft.steps.length ? draft.steps.length + (draft.steps.length === 1 ? " exercise" : " exercises") + " - about " + sessionMinutes(draft.steps) + " min." : "Nothing added yet." }));
      var brow = el("div.btn-row", { style:"gap:8px;flex-wrap:wrap" });
      var save = el("button.btn.primary.sm", { type:"button", text:"Save session", "data-team-session-save":"1" });
      if (!draft.steps.length) save.setAttribute("aria-disabled", "true");
      save.addEventListener("click", async function () {
        if (save.getAttribute("aria-disabled") === "true") { say("Add at least one exercise first."); return; }
        var title = cleanTitle(draft.title) || "Team session", full = false;
        try {
          await updateSessions(function (cur) {
            if (cur.length >= SESSION_MAX) { full = true; return null; }
            cur.push({ id:nextSessionId(), title:title, steps:draft.steps.slice(), createdAt:Date.now() });
            return cur;
          });
          sessionsStatus = full ? "You already have " + SESSION_MAX + " saved sessions. Remove one first." : "Session saved: " + title + ".";
          if (!full) { draft.title = ""; draft.steps = []; }
        } catch (e) { sessionsStatus = "GUIDON couldn't save that session."; }
        say(sessionsStatus);
        drawSessions("[data-team-plan-summary]");
      });
      var clear = el("button.btn.sm.ghost", { type:"button", text:"Clear", "data-team-session-clear":"1" });
      clear.addEventListener("click", function () { draft.title = ""; draft.steps = []; say("Session cleared."); drawSessions("[data-team-plan-summary]"); });
      brow.appendChild(save); brow.appendChild(clear);
      det.appendChild(brow);
      // Share the session as planned, without saving it first.
      if (G.studyGroup && typeof G.studyGroup.shareControl === "function") {
        det.appendChild(G.studyGroup.shareControl({ kind:"team-session", buttonText:"Share to my room", build:function () { return handoffBuild(draft.title, draft.steps); } }));
      }
      panel.appendChild(det);
      sessionsHost.appendChild(panel);
      if (focusSel) { var n = null; try { n = sessionsHost.querySelector(focusSel); } catch (e) {} try { if (n) n.focus(); } catch (e) {} }
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
    drawChain();
    drawSessions();
    if (focusExercise) {
      var startBtn = catalogHost.querySelector('[data-team-start="' + focusExercise + '"]');
      try { if (startBtn) { startBtn.focus(); say("Back at the exercise list."); } } catch (e) {}
    }
  }

  G.teamTraining = { render:render, CATALOG:CATALOG, KEY:KEY, SESSIONS_KEY:SESSIONS_KEY, _launchSequence:launchSequence, _findScenario:findScenario, _resolveLanes:resolveLanes, _teachBackPrompts:teachBackPrompts,
    // Study Rooms hand-off (see "Team sessions" above): the adapter Study
    // Rooms reads (also at G.roomHandoffAdapters["team-session"]) and the
    // payload builder the "Share to my room" buttons use.
    handoff:ROOM_ADAPTER, handoffBuild:handoffBuild, _normalizeSessions:normalizeSessions };
})();
