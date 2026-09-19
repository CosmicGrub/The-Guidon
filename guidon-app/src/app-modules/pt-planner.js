/* GUIDON — PT Planner / Training Calendar (global G.ptPlanner)
 * ROADMAP §3e: persisted day/week/month planning, template + suggestion model,
 * non-blocking hard:recovery warning, history, export, and existing reminder
 * pipeline integration. Offline-first; no recurrence service or server.
 */
(function () {
  "use strict";
  var G = window.G || (window.G = {});
  var util = G.util, el = util.el, db = G.db;
  var KEY = "prt:plan:v1";
  var HISTORY_KEY = "pt:history:v1";
  var DAY_KEYS = ["sun","mon","tue","wed","thu","fri","sat"];
  var DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var TITLE_MAX = 80; // a custom session name; also enforced on anything read from storage or a file
  var LEADER_CHECKLIST = [
    "Confirm task, conditions, standards, and the leader responsible for the session.",
    "Complete the applicable risk-management process and brief controls before training.",
    "Confirm site, equipment, water, communications, and medical/emergency support.",
    "Brief the session plan and any unit-specific limitations before execution.",
    "Close with an AAR: one sustain, one improve, and the next action."
  ];

  // Canonical multi-drill session model from docs/design/pt-scheduler.md §2a.
  // Only PD has fully authored/verified exercise text today. The remaining
  // drill IDs are explicit placeholders, never fabricated doctrine.
  var PRT_SESSION_DEFS = [
    { id:"strength", label:"Strength & Mobility Session", blocks:[
      { drillId:"pd" }, { drillId:"ssd" }, { drillId:"cd1" }, { drillId:"cd2" }, { drillId:"rd" }
    ]},
    { id:"endurance", label:"Endurance & Mobility Session", blocks:[
      { drillId:"pd" }, { drillId:"hsd" }, { drillId:"mmd1" }, { drillId:"mmd2" }, { drillId:"rd" }
    ]}
  ];
  var PRT_PENDING_DRILLS = {
    ssd:"Shoulder Stability Drill",
    cd1:"Conditioning Drill 1",
    cd2:"Conditioning Drill 2",
    hsd:"Hip Stability Drill",
    mmd1:"Military Movement Drill 1",
    mmd2:"Military Movement Drill 2",
    rd:"Recovery Drill"
  };
  function ensurePrtSessionModel() {
    try {
      var seed = window.GUIDON_SEED;
      if (!seed || !seed.prt) return;
      if (!Array.isArray(seed.prt.sessions) || !seed.prt.sessions.length) {
        seed.prt.sessions = PRT_SESSION_DEFS.map(function (s) {
          return { id:s.id, label:s.label, blocks:s.blocks.map(function (b) { return { drillId:b.drillId }; }) };
        });
      }
      if (!seed.prt.pendingDrills || typeof seed.prt.pendingDrills !== "object") {
        seed.prt.pendingDrills = Object.assign({}, PRT_PENDING_DRILLS);
      }
    } catch (e) {}
  }
  ensurePrtSessionModel();

  function prtSession(id) {
    var sessions = [];
    try { sessions = (window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.sessions) || []; } catch (e) {}
    return sessions.find(function (s) { return s && s.id === id; }) || PRT_SESSION_DEFS.find(function (s) { return s.id === id; }) || null;
  }
  function prtDrillLabel(id) {
    try {
      var drills = (window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.drills) || [];
      var real = drills.find(function (d) { return d && d.id === id; });
      if (real) return { label:String(real.name || id), pending:false };
    } catch (e) {}
    return { label:PRT_PENDING_DRILLS[id] || id, pending:true };
  }
  function prtSessionSummary(id) {
    var s = prtSession(id);
    if (!s) return "";
    return (s.blocks || []).map(function (b) {
      var d = prtDrillLabel(b.drillId);
      return d.label + (d.pending ? " (content pending)" : "");
    }).join(" → ");
  }

  var PRESETS = {
    rest: { id:"rest", title:"Rest / no organized PT", type:"rest", effort:"recovery", route:"" },
    prep: { id:"prep", title:"Preparation Drill", type:"drill", effort:"recovery", route:"#/prt" },
    recovery: { id:"recovery", title:"Recovery / mobility", type:"session", effort:"recovery", route:"#/drills" },
    strength: { id:"strength", title:"Strength & mobility session", type:"session", effort:"hard", route:"#/drills", sessionId:"strength" },
    endurance: { id:"endurance", title:"Endurance & mobility session", type:"session", effort:"hard", route:"#/drills", sessionId:"endurance" },
    circuit: { id:"circuit", title:"Leader-built circuit", type:"session", effort:"hard", route:"#/drills" },
    custom: { id:"custom", title:"Custom PT", type:"custom", effort:"moderate", route:"" }
  };

  var TEMPLATES = {
    balanced: {
      label:"Balanced week",
      hint:"Three hard sessions separated by recovery or preparation work.",
      days:{ sun:"rest", mon:"strength", tue:"recovery", wed:"endurance", thu:"prep", fri:"circuit", sat:"recovery" }
    },
    field: {
      label:"Field-ready week",
      hint:"Front-loads strength/endurance, then deliberately protects recovery.",
      days:{ sun:"rest", mon:"endurance", tue:"strength", wed:"recovery", thu:"circuit", fri:"prep", sat:"recovery" }
    },
    recovery: {
      label:"Recovery-biased week",
      hint:"Use after a demanding period or when the leader intentionally lowers training stress.",
      days:{ sun:"rest", mon:"recovery", tue:"prep", wed:"strength", thu:"recovery", fri:"endurance", sat:"recovery" }
    }
  };

  function clonePreset(id) {
    var p = PRESETS[id] || PRESETS.custom;
    return { id:p.id, title:p.title, type:p.type, effort:p.effort, route:p.route || "", sessionId:p.sessionId || "" };
  }
  function planFromTemplate(id) {
    var t = TEMPLATES[id] || TEMPLATES.balanced;
    var days = {};
    DAY_KEYS.forEach(function (k) { days[k] = clonePreset(t.days[k]); });
    return { version:1, templateId:id in TEMPLATES ? id : "balanced", intensity:"standard", weekStart:"sun", shareable:false, days:days, overrides:{} };
  }
  function normalizePlan(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return planFromTemplate("balanced");
    var out = {
      version:1,
      templateId:TEMPLATES[v.templateId] ? v.templateId : "balanced",
      intensity:["light","standard","challenge"].indexOf(v.intensity) >= 0 ? v.intensity : "standard",
      weekStart:"sun",
      shareable:!!v.shareable,
      days:{},
      overrides:(v.overrides && typeof v.overrides === "object" && !Array.isArray(v.overrides)) ? v.overrides : {}
    };
    DAY_KEYS.forEach(function (k) {
      var d = v.days && v.days[k];
      if (!d || typeof d !== "object") out.days[k] = clonePreset(TEMPLATES[out.templateId].days[k]);
      else out.days[k] = {
        id:PRESETS[d.id] ? d.id : "custom",
        title:String(d.title || (PRESETS[d.id] && PRESETS[d.id].title) || "Custom PT"),
        type:String(d.type || "custom"),
        effort:["hard","moderate","recovery"].indexOf(d.effort) >= 0 ? d.effort : "moderate",
        route:String(d.route || ""),
        sessionId:String(d.sessionId || (PRESETS[d.id] && PRESETS[d.id].sessionId) || "")
      };
    });
    return out;
  }
  async function loadPlan() {
    try { return normalizePlan(await db.getSetting(KEY, null)); }
    catch (e) { return planFromTemplate("balanced"); }
  }
  async function savePlan(plan) {
    try { await db.setSetting(KEY, normalizePlan(plan)); return true; }
    catch (e) { try { util.toast("Could not save the PT plan."); } catch (_) {} return false; }
  }
  async function loadHistory() {
    try { var v = await db.getSetting(HISTORY_KEY, []); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  async function saveHistory(list) {
    try { await db.setSetting(HISTORY_KEY, (Array.isArray(list) ? list : []).slice(0, 90)); return true; }
    catch (e) { return false; }
  }
  // The one way a completion is written. It re-reads storage at write time
  // and runs on a queue, so a Day view that has been open for a while (or two
  // quick taps) can never save its own older copy of the list over rows that
  // were written in the meantime - the same lost-update G.reminders had to
  // fix with its own write queue. One row per date: logging a date again
  // replaces that date's row.
  var _historyQueue = Promise.resolve();
  function logCompletion(row) {
    var run = _historyQueue.then(async function () {
      var list = (await loadHistory()).filter(function (x) { return x && typeof x === "object" && x.date !== row.date; });
      list.push(row);
      list.sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
      return saveHistory(list);
    });
    _historyQueue = run.catch(function () {});
    return run;
  }
  function say(msg) { try { if (G.util && G.util.announce) G.util.announce(msg); } catch (e) {} }
  // Once a date is logged its planner-made reminder has done its job; leaving
  // it would show "PT: ... - Today" on Home for a session already completed.
  // (Reminders whose date has simply passed are expired by G.reminders
  // itself - see EXPIRING_KINDS there - so nothing here needs a clock.)
  var REMINDER_NOTE = "From PT Planner";
  async function clearPtRemindersFor(iso) {
    if (!G.reminders || !G.reminders.load || !G.reminders.remove) return;
    try {
      var mine = (await G.reminders.load()).filter(function (r) { return r && r.kind === "pt" && r.date === iso && r.note === REMINDER_NOTE; });
      for (var i = 0; i < mine.length; i++) {
        await G.reminders.remove(mine[i].id);
        try { if (G.notify && G.notify.cancelForReminder) await G.notify.cancelForReminder(mine[i].id); } catch (e) {}
      }
    } catch (e) {}
  }
  function localISO(d) {
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function ratioOf(plan) {
    var hard = 0, recovery = 0, moderate = 0;
    DAY_KEYS.forEach(function (k) {
      var d = plan && plan.days && plan.days[k];
      if (!d || d.type === "rest") return;
      if (d.effort === "hard") hard++;
      else if (d.effort === "recovery") recovery++;
      else moderate++;
    });
    var ratio = recovery ? hard / recovery : (hard ? Infinity : 0);
    return { hard:hard, recovery:recovery, moderate:moderate, ratio:ratio, warn:hard > 0 && (recovery === 0 || ratio > 3) };
  }
  function historyRatio(list, nowMs) {
    var now = new Date(nowMs || Date.now()); now.setHours(23,59,59,999);
    var cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 6); cutoff.setHours(0,0,0,0);
    var hard = 0, recovery = 0, moderate = 0, logged = 0;
    (Array.isArray(list) ? list : []).forEach(function (row) {
      if (!row || !row.date) return;
      var d = new Date(String(row.date) + "T12:00:00");
      if (!Number.isFinite(d.getTime()) || d < cutoff || d > now) return;
      logged++;
      if (row.effort === "hard") hard++;
      else if (row.effort === "recovery") recovery++;
      else if (row.effort === "moderate") moderate++;
    });
    var ratio = recovery ? hard / recovery : (hard ? Infinity : 0);
    // A gap is just a gap: never infer missed-session debt. Only completed
    // history can trigger this non-blocking guard.
    var warn = (hard >= 3 && recovery === 0) || (recovery > 0 && ratio > 3);
    return { hard:hard, recovery:recovery, moderate:moderate, logged:logged, ratio:ratio, warn:warn };
  }
  function nextDateForDay(dayIndex) {
    var now = new Date(); now.setHours(0,0,0,0);
    var delta = (dayIndex - now.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    var d = new Date(now); d.setDate(d.getDate() + delta);
    return localISO(d);
  }
  // THE lookup for "what is planned on this date": a change made to one
  // date in Month view wins over the weekly plan. Every dated consumer (Month
  // cells, Day view, "Mark today complete", both reminder buttons) reads
  // through here - Day view, the completion log and the reminders used to
  // read plan.days directly, so a date the leader had changed to a recovery
  // day was still shown, logged (with the wrong effort, which feeds the
  // 7-day check) and reminded as the weekly session.
  function dayEntryForDate(plan, d) {
    var iso = localISO(d);
    var override = plan.overrides && plan.overrides[iso];
    return override && typeof override === "object" ? override : plan.days[DAY_KEYS[d.getDay()]];
  }
  // Resolves to "set" | "rest" | "full" | "failed" so each caller can say WHY
  // nothing was added. The session is looked up for the concrete date the
  // reminder will carry, never for the weekday alone: that date may have been
  // changed to rest (no reminder) or from rest to a session (reminder, with
  // that session's name).
  async function addPtReminder(plan, dayIndex, quiet) {
    if (!G.reminders || !G.reminders.add) return "failed";
    var date = nextDateForDay(dayIndex);
    var entry = dayEntryForDate(plan, new Date(date + "T12:00:00"));
    if (!entry || entry.type === "rest") {
      if (!quiet) util.toast("That date is a rest day - no reminder added.");
      return "rest";
    }
    var list = await G.reminders.add({ kind:"pt", label:"PT: " + entry.title, date:date, note:REMINDER_NOTE });
    if (!list) { util.toast("Reminder limit reached."); return "full"; }
    var r = list[list.length - 1];
    try { if (G.notify && G.notify.scheduleForReminder) await G.notify.scheduleForReminder(r); } catch (e) {}
    if (!quiet) util.toast("PT reminder set for " + date + ".");
    return "set";
  }
  function effortLabel(e) {
    return e === "hard" ? "Hard" : e === "recovery" ? "Recovery" : "Moderate";
  }

  async function render(mount) {
    util.clear(mount);
    var plan = await loadPlan();
    var activeView = "week";
    var drawGeneration = 0;

    mount.appendChild(el("div.section-title", {}, [el("h2", { text:"PT Planner" }), el("div.rule")]));
    mount.appendChild(el("p.hint", { text:"Build a day/week/month PT plan from GUIDON's existing training surfaces. Suggestions are planning aids, not an automated training prescription; unit policy, medical guidance, weather, mission, and leader judgment control." }));

    var controls = el("div.panel");
    controls.appendChild(el("div.eyebrow", { text:"Plan controls" }));
    var trow = el("div.mini-row");
    trow.appendChild(el("label", { text:"Template" }));
    var tsel = el("select", { "aria-label":"PT plan template", "data-pt-template":"1" });
    Object.keys(TEMPLATES).forEach(function (id) { tsel.appendChild(el("option", { value:id, text:TEMPLATES[id].label })); });
    tsel.value = plan.templateId;
    tsel.addEventListener("change", async function () {
      var keepIntensity = plan.intensity;
      plan = planFromTemplate(tsel.value);
      plan.intensity = keepIntensity;
      await savePlan(plan);
      draw();
    });
    trow.appendChild(tsel);
    var reset = el("button.btn.sm.ghost", { type:"button", text:"Apply template" });
    reset.addEventListener("click", async function () {
      var next = planFromTemplate(tsel.value); next.intensity = plan.intensity; plan = next;
      await savePlan(plan); draw();
    });
    trow.appendChild(reset);
    controls.appendChild(trow);
    var ih = el("p.hint", { text:TEMPLATES[plan.templateId].hint, "data-pt-template-hint":"1" });
    controls.appendChild(ih);

    var intensity = el("div.segmented", { role:"group", "aria-label":"Weekly intensity" });
    [["light","Light"],["standard","Standard"],["challenge","Challenge"]].forEach(function (pair) {
      var b = el("button", { type:"button", text:pair[1], "data-intensity":pair[0], "aria-pressed":String(plan.intensity === pair[0]) });
      if (plan.intensity === pair[0]) b.classList.add("active");
      b.addEventListener("click", async function () { plan.intensity = pair[0]; await savePlan(plan); draw(); });
      intensity.appendChild(b);
    });
    controls.appendChild(el("div.eyebrow", { text:"Intensity dial" }));
    controls.appendChild(intensity);
    var shareRow = el("label", { style:"display:flex;gap:8px;align-items:center;margin-top:10px" });
    var share = el("input", { type:"checkbox", "data-pt-shareable":"1" });
    share.checked = !!plan.shareable;
    share.addEventListener("change", async function () { plan.shareable = share.checked; await savePlan(plan); });
    shareRow.appendChild(share);
    shareRow.appendChild(document.createTextNode("Mark this plan shareable for export to the squad"));
    controls.appendChild(shareRow);
    mount.appendChild(controls);

    var ratioHost = el("div");
    mount.appendChild(ratioHost);
    var tabs = el("div.segmented", { role:"tablist", "aria-label":"PT planner view" });
    [["day","Day"],["week","Week"],["month","Month"]].forEach(function (pair) {
      var b = el("button", { type:"button", role:"tab", text:pair[1], "data-pt-view":pair[0], "aria-selected":String(activeView === pair[0]) });
      if (activeView === pair[0]) b.classList.add("active");
      b.addEventListener("click", function () { activeView = pair[0]; draw(); });
      tabs.appendChild(b);
    });
    mount.appendChild(tabs);
    var stage = el("div", { "data-pt-stage":"1" });
    mount.appendChild(stage);

    function drawRatio() {
      util.clear(ratioHost);
      var r = ratioOf(plan);
      var p = el("div.panel.pt-ratio-status", { role:"status", "aria-live":"polite", "data-pt-ratio":"1" });
      p.appendChild(el("div.eyebrow", { text:"Hard : recovery check" }));
      p.appendChild(el("strong", { text:r.hard + " hard · " + r.recovery + " recovery · " + r.moderate + " moderate" }));
      p.appendChild(el("p.hint", { text:r.warn
        ? "Flag: this week exceeds GUIDON's planning guardrail of roughly 3 hard sessions per recovery session. This is a warning, not a lockout—adjust it or keep it deliberately."
        : "No 3:1 hard-to-recovery planning flag. This does not certify the plan; leader judgment still applies." }));
      ratioHost.appendChild(p);
    }

    async function drawHistoryGuard(generation) {
      var old = ratioHost.querySelector("[data-pt-history-guard]");
      if (old) old.remove();
      var hist = await loadHistory();
      if (generation !== drawGeneration) return;
      var r = historyRatio(hist);
      var p = el("div.panel", { role:"status", "aria-live":"polite", "data-pt-history-guard":"1" });
      p.appendChild(el("div.eyebrow", { text:"Recent completed PT · 7 days" }));
      if (!r.logged) {
        p.appendChild(el("p.hint", { text:"No PT Planner completions are logged in the last 7 days yet. Missed days are treated as gaps, never debt to make up." }));
      } else {
        p.appendChild(el("strong", { text:r.hard + " hard · " + r.recovery + " recovery · " + r.moderate + " moderate" }));
        p.appendChild(el("p.hint", { text:r.warn
          ? "History flag: recent completed sessions exceed the 3:1 hard-to-recovery planning guardrail. This is advisory only; review the next assignment rather than auto-changing it."
          : "Recent completed PT does not trigger the 3:1 history flag. A missing day is not treated as a session to make up." }));
      }
      ratioHost.appendChild(p);
    }

    // A day card edits the WEEKLY plan (Week view) unless `dated` is given
    // ({ iso, entry }, Day view): then it shows what is actually planned for
    // that date and an edit changes that one date only - the same record the
    // Month view writes - so the three views can never disagree about a date.
    function makeDayCard(dayIndex, dated) {
      var key = DAY_KEYS[dayIndex];
      var changed = !!(dated && plan.overrides && plan.overrides[dated.iso]);
      var entry = dated ? dated.entry : plan.days[key];
      // The record an edit on this card writes to.
      function target() {
        if (!dated) return plan.days[key];
        if (!plan.overrides[dated.iso]) plan.overrides[dated.iso] = Object.assign({}, entry);
        return plan.overrides[dated.iso];
      }
      var card = el("div.panel.pt-day-card", { "data-pt-day":key });
      card.appendChild(el("div.eyebrow", { text:DAY_NAMES[dayIndex] + (dated ? " · today" : "") }));
      var sel = el("select", { "aria-label":"Session for " + (dated ? "today" : DAY_NAMES[dayIndex]), "data-pt-session":key });
      Object.keys(PRESETS).forEach(function (id) { sel.appendChild(el("option", { value:id, text:PRESETS[id].title })); });
      sel.value = PRESETS[entry.id] ? entry.id : "custom";
      sel.addEventListener("change", async function () {
        var picked = clonePreset(sel.value);
        if (dated) plan.overrides[dated.iso] = picked; else plan.days[key] = picked;
        await savePlan(plan);
        say((dated ? "Today" : DAY_NAMES[dayIndex]) + " set to " + picked.title + (dated ? ", for this date only." : "."));
        draw('select[data-pt-session="' + key + '"]');
      });
      card.appendChild(sel);
      if (entry.id === "custom") {
        var custom = el("input", { type:"text", value:entry.title === "Custom PT" ? "" : entry.title, maxlength:String(TITLE_MAX), placeholder:"Name this session", "aria-label":"Custom PT name for " + DAY_NAMES[dayIndex], "data-pt-custom":key });
        custom.addEventListener("change", async function () { target().title = custom.value.trim().slice(0, TITLE_MAX) || "Custom PT"; await savePlan(plan); });
        card.appendChild(custom);
        var effort = el("select", { "aria-label":"Training effort for " + DAY_NAMES[dayIndex], "data-pt-effort":key });
        [["recovery","Recovery"],["moderate","Moderate"],["hard","Hard"]].forEach(function (pair) { effort.appendChild(el("option", { value:pair[0], text:pair[1] })); });
        effort.value = entry.effort;
        effort.addEventListener("change", async function () {
          target().effort = effort.value;
          await savePlan(plan);
          say((dated ? "Today" : DAY_NAMES[dayIndex]) + " effort set to " + effortLabel(effort.value) + ".");
          // A full draw(), not drawRatio() alone: that used to wipe the
          // completed-history panel (it lived in the same host) and left this
          // card's own effort line showing the old value.
          draw('select[data-pt-effort="' + key + '"]');
        });
        card.appendChild(effort);
      }
      card.appendChild(el("p.hint", { text:effortLabel(entry.effort) + " effort · " + entry.type + (changed ? " · changed for this date" : "") }));
      if (entry.sessionId) {
        var summary = prtSessionSummary(entry.sessionId);
        if (summary) card.appendChild(el("p.hint", { text:"Session blocks: " + summary, "data-pt-session-blocks":entry.sessionId }));
      }
      var actions = el("div.btn-row");
      if (entry.route) {
        var open = el("button.btn.sm.ghost", { type:"button", text:"Open training tool" });
        open.addEventListener("click", function () { location.hash = entry.route; });
        actions.appendChild(open);
      }
      if (changed) {
        var back = el("button.btn.sm.ghost", { type:"button", text:"Use weekly plan", "data-pt-date-reset":dated.iso });
        back.addEventListener("click", async function () {
          delete plan.overrides[dated.iso];
          await savePlan(plan);
          say("Today is back on the weekly plan: " + plan.days[key].title + ".");
          draw('select[data-pt-session="' + key + '"]');
        });
        actions.appendChild(back);
      }
      // aria-disabled (not disabled) once used: a focused button that becomes
      // disabled drops keyboard focus to <body>.
      var remind = el("button.btn.sm.ghost.pt-remind-btn", { type:"button", text:dated ? "Remind me next " + DAY_NAMES[dayIndex] : "Remind me", "data-pt-remind":key });
      remind.addEventListener("click", async function () {
        if (remind.getAttribute("aria-disabled") === "true") return;
        remind.setAttribute("aria-disabled", "true");
        var res = await addPtReminder(plan, dayIndex);
        remind.textContent = res === "set" ? "Reminder set" : res === "rest" ? "Rest day - no reminder" : "Try again";
        if (res === "full" || res === "failed") remind.removeAttribute("aria-disabled");
      });
      actions.appendChild(remind);
      // Swap trades two WEEKLY slots, so it is only offered where the card is
      // showing the weekly slot (never on a date that has its own change).
      if (!changed) {
        var swap = el("button.btn.sm.ghost", { type:"button", text:"Swap with " + DAY_NAMES[(dayIndex+1)%7], "data-pt-swap":key });
        swap.addEventListener("click", async function () {
          var nextKey = DAY_KEYS[(dayIndex+1)%7], tmp = plan.days[key];
          plan.days[key] = plan.days[nextKey]; plan.days[nextKey] = tmp;
          await savePlan(plan);
          say(DAY_NAMES[dayIndex] + " and " + DAY_NAMES[(dayIndex+1)%7] + " swapped.");
          draw('[data-pt-swap="' + key + '"]');
        });
        actions.appendChild(swap);
      }
      card.appendChild(actions);
      return card;
    }

    async function renderDay(generation) {
      util.clear(stage);
      var now = new Date(), idx = now.getDay();
      stage.appendChild(makeDayCard(idx, { iso:localISO(now), entry:dayEntryForDate(plan, now) }));
      var hist = await loadHistory();
      if (generation !== drawGeneration || activeView !== "day") return;
      var todayKey = localISO(new Date());
      var already = hist.some(function (x) { return x && x.date === todayKey; });
      var complete = el("button.btn.primary", { type:"button", text:already ? "Today logged" : "Mark today complete", "data-pt-complete":"1" });
      if (already) complete.setAttribute("aria-disabled", "true");
      complete.addEventListener("click", async function () {
        if (complete.getAttribute("aria-disabled") === "true") return;
        complete.setAttribute("aria-disabled", "true");
        // What is planned for TODAY'S DATE (a change made to this date wins
        // over the weekly plan), read at click time rather than render time.
        var e = dayEntryForDate(plan, new Date());
        var ok = await logCompletion({ date:todayKey, title:e.title, effort:e.effort, type:e.type, ts:Date.now() });
        if (!ok) { complete.removeAttribute("aria-disabled"); util.toast("Could not save the PT log."); return; }
        complete.textContent = "Today logged";
        util.toast("PT session logged.");
        await clearPtRemindersFor(todayKey);
        drawHistoryGuard(drawGeneration);
      });
      stage.appendChild(el("div.panel", {}, [el("div.eyebrow", { text:"History" }), complete]));
    }
    function renderWeek() {
      util.clear(stage);
      var grid = el("div.card-results-grid", { "data-pt-week":"1" });
      for (var i=0;i<7;i++) grid.appendChild(makeDayCard(i));
      stage.appendChild(grid);

      var leader = el("div.panel", { "data-pt-leader-checklist":"1" });
      leader.appendChild(el("div.eyebrow", { text:"Leader checklist" }));
      leader.appendChild(el("p.hint", { text:"Planning prompts only—use the current unit SOP, approved risk-management process, and qualified medical/safety guidance." }));
      var checklist = el("ul");
      LEADER_CHECKLIST.forEach(function (x) { checklist.appendChild(el("li", { text:x })); });
      leader.appendChild(checklist);
      stage.appendChild(leader);

      var rebalance = el("button.btn.ghost", { type:"button", text:"Rotate training days", "data-pt-rotate":"1" });
      rebalance.addEventListener("click", async function () {
        var first = plan.days.sun;
        for (var j=0;j<6;j++) plan.days[DAY_KEYS[j]] = plan.days[DAY_KEYS[j+1]];
        plan.days.sat = first;
        await savePlan(plan);
        say("Every session moved one day earlier.");
        draw("[data-pt-rotate]");
      });
      var shuffle = el("button.btn.ghost", { type:"button", text:"Shuffle week", "data-pt-shuffle":"1" });
      shuffle.addEventListener("click", async function () {
        var entries = DAY_KEYS.map(function (k) { return plan.days[k]; });
        for (var j=entries.length-1;j>0;j--) {
          var k = Math.floor(Math.random() * (j+1)), tmp = entries[j]; entries[j] = entries[k]; entries[k] = tmp;
        }
        DAY_KEYS.forEach(function (k, idx) { plan.days[k] = entries[idx]; });
        await savePlan(plan);
        say("Week shuffled.");
        draw("[data-pt-shuffle]");
      });
      var schedule = el("button.btn.ghost", { type:"button", text:"Schedule week reminders", "data-pt-remind-week":"1" });
      schedule.addEventListener("click", async function () {
        if (schedule.getAttribute("aria-disabled") === "true") return;
        schedule.setAttribute("aria-disabled", "true");
        var made = 0, full = false;
        // Rest is decided per DATE inside addPtReminder (a date changed to
        // rest is skipped; a rest weekday changed to a session is reminded).
        for (var j=0;j<7 && !full;j++) {
          var res = await addPtReminder(plan, j, true);
          if (res === "set") made++;
          else if (res === "full") full = true;
        }
        schedule.textContent = made ? made + (made === 1 ? " reminder set" : " reminders set") : "No reminders added";
        say(made ? made + (made === 1 ? " PT reminder" : " PT reminders") + " set for the next 7 days. Rest days are skipped." : "No PT reminders were added.");
        if (full) schedule.removeAttribute("aria-disabled");
      });
      var exp = el("button.btn.ghost", { type:"button", text:"Export JSON", "data-pt-export":"1" });
      exp.addEventListener("click", function () {
        util.download("guidon-pt-plan.json", JSON.stringify({ schema:"guidon.pt-plan/v1", exportedAt:new Date().toISOString(), shareable:!!plan.shareable, plan:plan, leaderChecklist:LEADER_CHECKLIST }, null, 2), "application/json");
      });
      var sheet = el("button.btn.ghost", { type:"button", text:"Export leader sheet", "data-pt-export-sheet":"1" });
      sheet.addEventListener("click", function () {
        var lines = ["GUIDON PT PLAN", "Intensity: " + plan.intensity, "Shareable: " + (plan.shareable ? "yes" : "no"), ""];
        DAY_KEYS.forEach(function (k, i) { var e = plan.days[k]; lines.push(DAY_NAMES[i] + ": " + e.title + " [" + effortLabel(e.effort) + "]"); });
        lines.push("", "LEADER CHECKLIST");
        LEADER_CHECKLIST.forEach(function (x, i) { lines.push((i+1) + ". " + x); });
        lines.push("", "Planning aid only. Current unit policy, approved risk controls, and qualified medical/safety guidance control.");
        util.download("guidon-pt-leader-sheet.txt", lines.join("\n"), "text/plain");
      });
      stage.appendChild(el("div.btn-row", {}, [rebalance, shuffle, schedule, exp, sheet]));
    }
    function renderMonth() {
      util.clear(stage);
      var start = new Date(); start.setHours(0,0,0,0);
      var grid = el("div.card-results-grid", { "data-pt-month":"1" });
      for (let i=0;i<28;i++) {
        let d = new Date(start); d.setDate(start.getDate()+i);
        let iso = localISO(d);
        let e = dayEntryForDate(plan,d);
        let c = el("div.panel.pt-month-day", { "data-pt-date":iso });
        c.appendChild(el("div.eyebrow", { text:d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}) }));
        // `let`, never `var`, for anything a handler in this loop reads: a
        // function-scoped `var sel` was shared by all 28 handlers, so every
        // cell saved the LAST cell's value - pick Recovery for the 20th, get
        // whatever the 28th day happened to show.
        let label = d.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
        let sel = el("select", { "aria-label":"Session for " + label, "data-pt-date-session":iso });
        Object.keys(PRESETS).forEach(function (id) { sel.appendChild(el("option", { value:id, text:PRESETS[id].title })); });
        sel.value = PRESETS[e.id] ? e.id : "custom";
        sel.addEventListener("change", async function () {
          let picked = clonePreset(sel.value);
          plan.overrides[iso] = picked;
          await savePlan(plan);
          say(label + " set to " + picked.title + ", for this date only.");
          draw('select[data-pt-date-session="' + iso + '"]');
        });
        c.appendChild(sel);
        c.appendChild(el("p.hint", { text:effortLabel(e.effort) + " effort" + (plan.overrides[iso] ? " · changed for this date" : " · weekly plan") }));
        if (plan.overrides[iso]) {
          let reset = el("button.btn.sm.ghost", { type:"button", text:"Use weekly plan", "data-pt-date-reset":iso });
          reset.addEventListener("click", async function () {
            delete plan.overrides[iso];
            await savePlan(plan);
            say(label + " is back on the weekly plan.");
            // The reset button is gone after the redraw; land on the date's picker.
            draw('select[data-pt-date-session="' + iso + '"]');
          });
          c.appendChild(reset);
        }
        grid.appendChild(c);
      }
      stage.appendChild(grid);
    }
    // Every edit rebuilds the stage, which destroys the control that was just
    // used. `focusSelector` names its replacement so keyboard focus comes
    // back to it instead of falling to <body> (from where a keyboard or
    // switch user editing the 28-cell month grid had to tab in from the top
    // of the page after every single change). Never steals focus on a plain
    // first render or a view switch - only when a selector is passed.
    function refocus(focusSelector) {
      if (!focusSelector) return;
      var n = null;
      try { n = mount.querySelector(focusSelector); } catch (e) {}
      if (!n) n = tabs.querySelector('[aria-selected="true"]');
      try { if (n) n.focus(); } catch (e) {}
    }
    function draw(focusSelector) {
      var generation = ++drawGeneration;
      ih.textContent = (TEMPLATES[plan.templateId] || TEMPLATES.balanced).hint;
      Array.from(intensity.querySelectorAll("button")).forEach(function (b) { var on = b.getAttribute("data-intensity") === plan.intensity; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
      Array.from(tabs.querySelectorAll("button")).forEach(function (b) { var on = b.getAttribute("data-pt-view") === activeView; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
      drawRatio();
      drawHistoryGuard(generation);
      if (activeView === "day") renderDay(generation);
      else if (activeView === "month") renderMonth();
      else renderWeek();
      refocus(focusSelector);
    }
    draw();
  }

  G.ptPlanner = {
    render:render,
    KEY:KEY,
    HISTORY_KEY:HISTORY_KEY,
    PRESETS:PRESETS,
    TEMPLATES:TEMPLATES,
    LEADER_CHECKLIST:LEADER_CHECKLIST,
    _ratio:ratioOf,
    _historyRatio:historyRatio,
    _planFromTemplate:planFromTemplate,
    _session:prtSession,
    _sessionSummary:prtSessionSummary,
    SESSION_DEFS:PRT_SESSION_DEFS,
    PENDING_DRILLS:PRT_PENDING_DRILLS
  };
})();