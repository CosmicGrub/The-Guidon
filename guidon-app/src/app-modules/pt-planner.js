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
  //
  // ROADMAP 3g item I: the session/pending-drill defaults that used to live
  // here as a module-local PRT_SESSION_DEFS/PRT_PENDING_DRILLS literal,
  // injected into window.GUIDON_SEED.prt at this module's own load time by
  // an ensurePrtSessionModel() IIFE, now live in core (src/index.html's
  // loadContent(), see DEFAULT_PRT_SESSIONS/DEFAULT_PRT_PENDING_DRILLS
  // there) so they are guaranteed present on the seed the instant it loads,
  // regardless of module load order or whether this module even runs. The
  // functions below read window.GUIDON_SEED.prt.sessions/.pendingDrills
  // directly - the `|| []`/`|| {}` fallbacks are only this file's usual
  // defensive try/catch pattern, not a local-literal fallback.
  function prtSession(id) {
    var sessions = [];
    try { sessions = (window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.sessions) || []; } catch (e) {}
    return sessions.find(function (s) { return s && s.id === id; }) || null;
  }
  function prtDrillLabel(id) {
    try {
      var drills = (window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.drills) || [];
      var real = drills.find(function (d) { return d && d.id === id; });
      if (real) return { label:String(real.name || id), pending:false };
    } catch (e) {}
    var pending = {};
    try { pending = (window.GUIDON_SEED.prt && window.GUIDON_SEED.prt.pendingDrills) || {}; } catch (e) {}
    return { label:pending[id] || id, pending:true };
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
    return { version:1, templateId:Object.prototype.hasOwnProperty.call(TEMPLATES, id) ? id : "balanced", weekStart:"sun", days:days, overrides:{} };
  }
  // One session record, from anywhere (storage, a backup, a plan file someone
  // sent). A built-in session is REBUILT from PRESETS by id - its title, the
  // screen it opens and its drill blocks are never taken from the input, so a
  // handed-over file cannot point "Open training tool" somewhere else. Only a
  // custom session keeps anything of its own: a name (length-capped) and an
  // effort. Returns null for something that is not a session record at all.
  function normalizeEntry(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    var id = typeof d.id === "string" && Object.prototype.hasOwnProperty.call(PRESETS, d.id) ? d.id : "custom";
    if (id !== "custom") return clonePreset(id);
    var title = typeof d.title === "string" ? d.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) : "";
    return { id:"custom", title:title || "Custom PT", type:"custom",
      effort:["hard","moderate","recovery"].indexOf(d.effort) >= 0 ? d.effort : "moderate", route:"", sessionId:"" };
  }
  // A change to a single date is only worth keeping while that date can still
  // show up somewhere (Month view looks 28 days ahead; the 7-day check and
  // the leader sheet look a little behind). Older ones are dropped on the
  // next save so the row cannot grow without bound over years of use.
  var OVERRIDE_KEEP_DAYS = 35;
  function normalizeOverrides(v, nowMs) {
    var out = {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return out;
    var floor = new Date(nowMs || Date.now()); floor.setHours(0,0,0,0); floor.setDate(floor.getDate() - OVERRIDE_KEEP_DAYS);
    Object.keys(v).forEach(function (iso) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
      var d = new Date(iso + "T12:00:00");
      if (!Number.isFinite(d.getTime()) || localISO(d) !== iso || d < floor) return;
      var e = normalizeEntry(v[iso]);
      if (e) out[iso] = e;
    });
    return out;
  }
  function normalizePlan(v, nowMs) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return planFromTemplate("balanced");
    var out = {
      version:1,
      templateId:typeof v.templateId === "string" && Object.prototype.hasOwnProperty.call(TEMPLATES, v.templateId) ? v.templateId : "balanced",
      weekStart:"sun",
      days:{},
      overrides:normalizeOverrides(v.overrides, nowMs)
    };
    DAY_KEYS.forEach(function (k) {
      out.days[k] = normalizeEntry(v.days && v.days[k]) || clonePreset(TEMPLATES[out.templateId].days[k]);
    });
    return out;
  }
  // A plan file is small (a week plus a few date changes). Anything big is
  // not one, and is refused before it is even parsed.
  var PLAN_FILE_SCHEMA = "guidon.pt-plan/v1";
  var PLAN_FILE_MAX_BYTES = 256 * 1024;
  async function readPlanFile(file) {
    var NOT_A_PLAN = "That file isn't a GUIDON PT plan, so nothing was changed. Ask for a file made with \"Save plan file to share\".";
    try {
      if (!file || file.size > PLAN_FILE_MAX_BYTES) return { plan:null, message:NOT_A_PLAN };
      var data = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || data.schema !== PLAN_FILE_SCHEMA) return { plan:null, message:NOT_A_PLAN };
      var p = data.plan;
      if (!p || typeof p !== "object" || Array.isArray(p) || !p.days || typeof p.days !== "object" || Array.isArray(p.days)) return { plan:null, message:NOT_A_PLAN };
      return { plan:normalizePlan(p), message:"" };
    } catch (e) { return { plan:null, message:NOT_A_PLAN }; }
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
  // ONE rule for both checks (the planned week and the completed 7 days), so
  // they can never disagree about the same week:
  //  - a rest day relieves hard training exactly like a recovery session
  //    does. The plan check used to ignore rest days entirely, so one hard
  //    session plus six rest days - or hard Mon/Wed/Fri with rest between -
  //    was flagged as "exceeds 3 hard per recovery", while the history check
  //    counted a logged rest day as recovery;
  //  - with no recovery or rest at all, it takes 3 hard sessions to flag
  //    (the history check's threshold; the plan check used to flag at 1).
  // `recovery` stays "recovery sessions" and `rest` is reported beside it.
  function guardFrom(c) {
    var relief = c.recovery + c.rest;
    c.ratio = relief ? c.hard / relief : (c.hard ? Infinity : 0);
    c.warn = relief ? c.ratio > 3 : c.hard >= 3;
    return c;
  }
  function tally(c, type, effort) {
    if (type === "rest") c.rest++;
    else if (effort === "hard") c.hard++;
    else if (effort === "recovery") c.recovery++;
    else c.moderate++;
  }
  function ratioOf(plan) {
    var c = { hard:0, recovery:0, rest:0, moderate:0 };
    DAY_KEYS.forEach(function (k) {
      var d = plan && plan.days && plan.days[k];
      if (d) tally(c, d.type, d.effort);
    });
    return guardFrom(c);
  }
  function historyRatio(list, nowMs) {
    var now = new Date(nowMs || Date.now()); now.setHours(23,59,59,999);
    var cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 6); cutoff.setHours(0,0,0,0);
    var c = { hard:0, recovery:0, rest:0, moderate:0, logged:0 };
    (Array.isArray(list) ? list : []).forEach(function (row) {
      if (!row || !row.date) return;
      var d = new Date(String(row.date) + "T12:00:00");
      if (!Number.isFinite(d.getTime()) || d < cutoff || d > now) return;
      c.logged++;
      // Rows logged before `type` was recorded have none; a rest day's
      // effort is "recovery", so it still lands on the relief side.
      if (row.type === "rest" || ["hard","recovery","moderate"].indexOf(row.effort) >= 0) tally(c, row.type, row.effort);
    });
    // A gap is just a gap: never infer missed-session debt. Only completed
    // history can trigger this non-blocking guard.
    return guardFrom(c);
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
    // One-step Undo for the changes that rearrange or replace the whole week
    // (template, rotate, shuffle, opening a plan file). It holds a copy of
    // the plan from just before that change and is dropped by any other edit,
    // so Undo can never silently throw away work done after it was offered.
    var undo = null;
    function rememberForUndo(what, focusSelector) {
      undo = { plan:JSON.parse(JSON.stringify(plan)), what:what, focus:focusSelector };
    }
    // Every plan edit ends here: save, announce, redraw, put focus back.
    async function commit(message, focusSelector, keepUndo) {
      if (!keepUndo) undo = null;
      await savePlan(plan);
      if (message) say(message);
      draw(focusSelector);
    }

    mount.appendChild(el("div.section-title", {}, [el("h2", { text:"PT Planner" }), el("div.rule")]));
    mount.appendChild(el("p.hint", { text:"Build a day/week/month PT plan from GUIDON's existing training surfaces. Suggestions are planning aids, not an automated training prescription; unit policy, medical guidance, weather, mission, and leader judgment control." }));

    var controls = el("div.panel");
    controls.appendChild(el("div.eyebrow", { text:"Plan controls" }));
    var trow = el("div.mini-row");
    trow.appendChild(el("label", { text:"Template" }));
    var tsel = el("select", { "aria-label":"PT plan template", "data-pt-template":"1" });
    Object.keys(TEMPLATES).forEach(function (id) { tsel.appendChild(el("option", { value:id, text:TEMPLATES[id].label })); });
    tsel.value = plan.templateId;
    // The dropdown only PREVIEWS. It used to replace all seven days and wipe
    // every date change the moment its value changed - and a closed <select>
    // fires "change" on every arrow key on Windows, so a keyboard user could
    // not even read the list without overwriting the week. "Apply template"
    // is the only thing that commits, it asks first when there are edited
    // days to lose, keeps changes made to single dates, and can be undone.
    function showTemplateHint() {
      var id = TEMPLATES[tsel.value] ? tsel.value : plan.templateId;
      ih.textContent = TEMPLATES[id].hint + (id !== plan.templateId ? " Not in use yet - press Apply template to use it." : "");
    }
    tsel.addEventListener("change", showTemplateHint);
    trow.appendChild(tsel);
    var apply = el("button.btn.sm.ghost", { type:"button", text:"Apply template", "data-pt-apply-template":"1" });
    apply.addEventListener("click", async function () {
      var id = TEMPLATES[tsel.value] ? tsel.value : "balanced";
      var edited = JSON.stringify(plan.days) !== JSON.stringify(planFromTemplate(plan.templateId).days);
      if (edited && G.modal && G.modal.confirm) {
        var go = await G.modal.confirm(
          "Replace all seven days with the \"" + TEMPLATES[id].label + "\" template?\n\nThe changes you made to this week's days will be replaced. Changes you made to single dates in Month view are kept. You can undo this straight afterwards.",
          { title:"Apply template?", okText:"Replace week", danger:true });
        if (!go) { tsel.value = plan.templateId; showTemplateHint(); say("Template not applied. Your week is unchanged."); return; }
      }
      var next = planFromTemplate(id);
      next.overrides = plan.overrides || {}; // each date change already has its own "Use weekly plan"
      rememberForUndo("the template change", "[data-pt-apply-template]");
      plan = next;
      await commit("\"" + TEMPLATES[id].label + "\" template applied. Undo is available.", "[data-pt-apply-template]", true);
    });
    trow.appendChild(apply);
    controls.appendChild(trow);
    var ih = el("p.hint", { text:TEMPLATES[plan.templateId].hint, "data-pt-template-hint":"1" });
    controls.appendChild(ih);

    mount.appendChild(controls);

    // Undo bar. Persistent host, filled by draw() while an Undo is on offer.
    var undoHost = el("div", { "data-pt-undo-host":"1" });
    mount.appendChild(undoHost);
    function drawUndo() {
      util.clear(undoHost);
      if (!undo) return;
      var bar = el("div.panel", { style:"display:flex;flex-wrap:wrap;gap:8px;align-items:center" });
      bar.appendChild(el("span", { text:"Changed your mind about " + undo.what + "?" }));
      var b = el("button.btn.sm.ghost", { type:"button", text:"Undo", "aria-label":"Undo " + undo.what, "data-pt-undo":"1" });
      b.addEventListener("click", async function () {
        if (!undo) return;
        var back = undo; undo = null;
        plan = normalizePlan(back.plan);
        tsel.value = plan.templateId;
        // The Undo button is gone after the redraw; focus returns to the
        // control that made the change.
        await commit("Undone. Your earlier week is back.", back.focus);
      });
      bar.appendChild(b);
      undoHost.appendChild(bar);
    }

    // The two check panels are built ONCE and updated in place. They used to
    // be torn down and rebuilt (as brand-new role=status nodes) on every
    // draw, which screen readers do not reliably announce, and a custom-effort
    // edit redrew only the first and deleted the second. A change of flag
    // state is announced explicitly, in the same message as the edit that
    // caused it (see flagNote), so neither announcement overwrites the other.
    var ratioHost = el("div");
    var ratioCounts = el("strong"), ratioMsg = el("p.hint");
    ratioHost.appendChild(el("div.panel.pt-ratio-status", { role:"group", "aria-label":"Hard to recovery check for the planned week", "data-pt-ratio":"1" }, [
      el("div.eyebrow", { text:"Hard : recovery check" }), ratioCounts, ratioMsg
    ]));
    var histCounts = el("strong"), histMsg = el("p.hint");
    ratioHost.appendChild(el("div.panel", { role:"group", "aria-label":"Completed PT in the last 7 days", "data-pt-history-guard":"1" }, [
      el("div.eyebrow", { text:"Recent completed PT · 7 days" }), histCounts, histMsg
    ]));
    mount.appendChild(ratioHost);

    // Day / Week / Month: a real tablist - ids, roving tabindex and arrow
    // keys through the app's shared util.tabbarKeys, and a labelled tabpanel.
    var tabs = el("div.segmented", { role:"tablist", "aria-label":"PT planner view" });
    [["day","Day"],["week","Week"],["month","Month"]].forEach(function (pair) {
      var b = el("button", { type:"button", role:"tab", id:"pt-view-tab-" + pair[0], text:pair[1], "data-pt-view":pair[0], "aria-selected":String(activeView === pair[0]), "aria-controls":"pt-view-panel" });
      if (activeView === pair[0]) b.classList.add("active");
      b.addEventListener("click", function () {
        // tabbarKeys raises this flag so a RE-RENDERED tablist can reclaim
        // focus. This tablist is never re-rendered, so clear it here or the
        // next screen's tablist would grab focus on arrival.
        util._tabKbd = false;
        activeView = pair[0]; draw();
      });
      tabs.appendChild(b);
    });
    mount.appendChild(tabs);
    var stage = el("div", { id:"pt-view-panel", role:"tabpanel", "aria-labelledby":"pt-view-tab-" + activeView, "data-pt-stage":"1" });
    mount.appendChild(stage);
    if (util.tabbarKeys) util.tabbarKeys(tabs);

    var lastWarn = null;
    // "" unless the planned-week flag just changed state.
    function flagNote() {
      var w = ratioOf(plan).warn, note = "";
      if (lastWarn !== null && w !== lastWarn) {
        note = w ? " Heads up: this week now has more than about 3 hard sessions for each recovery or rest day."
                 : " The hard-to-recovery flag is now clear.";
      }
      lastWarn = w;
      return note;
    }
    function countsLine(r) {
      return r.hard + " hard · " + (r.recovery + r.rest) + " recovery or rest · " + r.moderate + " moderate";
    }
    function drawRatio() {
      var r = ratioOf(plan);
      ratioCounts.textContent = countsLine(r);
      ratioMsg.textContent = r.warn
        ? "Flag: this week has more than about 3 hard sessions for each recovery or rest day, which is GUIDON's planning guide. This is a warning, not a lockout—adjust it or keep it deliberately."
        : "No hard-to-recovery flag (GUIDON's planning guide is about 3 hard sessions for each recovery or rest day). This does not certify the plan; leader judgment still applies.";
    }

    async function drawHistoryGuard(generation) {
      var hist = await loadHistory();
      if (generation !== drawGeneration) return;
      var r = historyRatio(hist);
      if (!r.logged) {
        histCounts.textContent = "";
        histMsg.textContent = "No PT Planner completions are logged in the last 7 days yet. Missed days are treated as gaps, never debt to make up.";
      } else {
        histCounts.textContent = countsLine(r);
        histMsg.textContent = r.warn
          ? "History flag: your completed sessions in the last 7 days are over the same guide of about 3 hard sessions for each recovery or rest day. This is advisory only; review the next assignment rather than auto-changing it."
          : "Recent completed PT does not raise the history flag. A missing day is not treated as a session to make up.";
      }
      return r;
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
        await commit((dated ? "Today" : DAY_NAMES[dayIndex]) + " set to " + picked.title + (dated ? ", for this date only." : ".") + flagNote(), 'select[data-pt-session="' + key + '"]');
      });
      card.appendChild(sel);
      if (entry.id === "custom") {
        var custom = el("input", { type:"text", value:entry.title === "Custom PT" ? "" : entry.title, maxlength:String(TITLE_MAX), placeholder:"Name this session", "aria-label":"Custom PT name for " + DAY_NAMES[dayIndex], "data-pt-custom":key });
        custom.addEventListener("change", async function () {
          target().title = custom.value.trim().slice(0, TITLE_MAX) || "Custom PT";
          // Saved without a redraw so typing focus is never disturbed; only
          // the Undo offer (if any) is withdrawn, like after any other edit.
          undo = null; drawUndo();
          if (dated) hint.textContent = effortLabel(target().effort) + " effort · custom · changed for this date";
          await savePlan(plan);
        });
        card.appendChild(custom);
        var effort = el("select", { "aria-label":"Training effort for " + DAY_NAMES[dayIndex], "data-pt-effort":key });
        [["recovery","Recovery"],["moderate","Moderate"],["hard","Hard"]].forEach(function (pair) { effort.appendChild(el("option", { value:pair[0], text:pair[1] })); });
        effort.value = entry.effort;
        effort.addEventListener("change", async function () {
          target().effort = effort.value;
          // A full redraw, not drawRatio() alone: that used to wipe the
          // completed-history panel (it lived in the same host) and left this
          // card's own effort line showing the old value.
          await commit((dated ? "Today" : DAY_NAMES[dayIndex]) + " effort set to " + effortLabel(effort.value) + "." + flagNote(), 'select[data-pt-effort="' + key + '"]');
        });
        card.appendChild(effort);
      }
      var hint = el("p.hint", { text:effortLabel(entry.effort) + " effort · " + entry.type + (changed ? " · changed for this date" : "") });
      card.appendChild(hint);
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
          await commit("Today is back on the weekly plan: " + plan.days[key].title + ".", 'select[data-pt-session="' + key + '"]');
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
          await commit(DAY_NAMES[dayIndex] + " and " + DAY_NAMES[(dayIndex+1)%7] + " swapped.", '[data-pt-swap="' + key + '"]');
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
        await clearPtRemindersFor(todayKey);
        var after = await drawHistoryGuard(drawGeneration);
        // The toast is a live region, so this is also what is read out.
        util.toast("PT session logged." + (after && after.warn ? " Heads up: your last 7 days are over the hard-to-recovery guide." : ""));
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
        rememberForUndo("rotating the week", "[data-pt-rotate]");
        var first = plan.days.sun;
        for (var j=0;j<6;j++) plan.days[DAY_KEYS[j]] = plan.days[DAY_KEYS[j+1]];
        plan.days.sat = first;
        await commit("Every session moved one day earlier. Undo is available.", "[data-pt-rotate]", true);
      });
      var shuffle = el("button.btn.ghost", { type:"button", text:"Shuffle week", "data-pt-shuffle":"1" });
      shuffle.addEventListener("click", async function () {
        rememberForUndo("shuffling the week", "[data-pt-shuffle]");
        var entries = DAY_KEYS.map(function (k) { return plan.days[k]; });
        for (var j=entries.length-1;j>0;j--) {
          var k = Math.floor(Math.random() * (j+1)), tmp = entries[j]; entries[j] = entries[k]; entries[k] = tmp;
        }
        DAY_KEYS.forEach(function (k, idx) { plan.days[k] = entries[idx]; });
        await commit("Week shuffled. Undo is available.", "[data-pt-shuffle]", true);
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
      // Plan file out / plan file in. The old "Export JSON" wrote a file that
      // no GUIDON screen could open, so a squad could not actually follow a
      // leader's plan "on their own devices". The same file now opens here,
      // on any device, after passing through the same clean-up as a stored
      // plan (normalizePlan) and a confirmation.
      var exp = el("button.btn.ghost", { type:"button", text:"Save plan file to share", "data-pt-export":"1" });
      exp.addEventListener("click", function () {
        util.download("guidon-pt-plan.json", JSON.stringify({ schema:PLAN_FILE_SCHEMA, exportedAt:new Date().toISOString(), plan:normalizePlan(plan), leaderChecklist:LEADER_CHECKLIST }, null, 2), "application/json");
        say("Plan file saved. Send it to your Soldiers; they open it from PT Planner with Open a shared plan file.");
      });
      var fileIn = el("input", { type:"file", accept:"application/json,.json", style:"display:none", "aria-hidden":"true", tabIndex:"-1", "data-pt-import-file":"1" });
      var imp = el("button.btn.ghost", { type:"button", text:"Open a shared plan file", "data-pt-import":"1" });
      // Same biometric-gate courtesy as Settings' "Import backup": the native
      // file picker backgrounds the app, which must not re-prompt on return.
      imp.addEventListener("click", function () { try { if (G.biometricGate) G.biometricGate.expectReturn(); } catch (e) {} fileIn.click(); });
      var impStatus = el("p.hint", { role:"status", "aria-live":"polite", "data-pt-import-status":"1" });
      fileIn.addEventListener("change", async function () {
        var file = fileIn.files && fileIn.files[0];
        if (!file) return;
        var res = await readPlanFile(file);
        fileIn.value = "";
        if (!res.plan) { impStatus.textContent = res.message; return; }
        var lines = DAY_KEYS.map(function (k, i) { return DAY_NAMES[i] + ": " + res.plan.days[k].title; }).join("\n");
        var go = !(G.modal && G.modal.confirm) || await G.modal.confirm(
          "Replace this device's PT plan with the one in this file?\n\n" + lines + "\n\nYour completed-PT log is not affected. You can undo this straight afterwards.",
          { title:"Open shared plan?", okText:"Use this plan", danger:true });
        if (!go) { impStatus.textContent = "Plan file not opened. Your plan is unchanged."; return; }
        rememberForUndo("opening the plan file", "[data-pt-import]");
        plan = res.plan;
        tsel.value = plan.templateId;
        lastWarn = ratioOf(plan).warn; // a different plan, not an edit to announce
        await commit("Shared plan opened. Undo is available.", "[data-pt-import]", true);
        var st = mount.querySelector("[data-pt-import-status]");
        if (st) st.textContent = "Shared plan opened. It is now this device's PT plan.";
      });
      var sheet = el("button.btn.ghost", { type:"button", text:"Save leader sheet (text)", "data-pt-export-sheet":"1" });
      sheet.addEventListener("click", function () {
        var lines = ["GUIDON PT PLAN", ""];
        DAY_KEYS.forEach(function (k, i) { var e = plan.days[k]; lines.push(DAY_NAMES[i] + ": " + e.title + " [" + effortLabel(e.effort) + "]"); });
        var changedDates = Object.keys(plan.overrides || {}).sort();
        if (changedDates.length) {
          lines.push("", "DATES CHANGED FROM THE WEEKLY PLAN");
          changedDates.forEach(function (iso) { var e = plan.overrides[iso]; lines.push(iso + ": " + e.title + " [" + effortLabel(e.effort) + "]"); });
        }
        lines.push("", "LEADER CHECKLIST");
        LEADER_CHECKLIST.forEach(function (x, i) { lines.push((i+1) + ". " + x); });
        lines.push("", "Planning aid only. Current unit policy, approved risk controls, and qualified medical/safety guidance control.");
        util.download("guidon-pt-leader-sheet.txt", lines.join("\n"), "text/plain");
      });
      stage.appendChild(el("div.btn-row", {}, [rebalance, shuffle, schedule]));
      stage.appendChild(el("div.panel", { "data-pt-share":"1" }, [
        el("div.eyebrow", { text:"Share this plan" }),
        el("p.hint", { text:"Save the plan as a file and send it however your unit shares files. Anyone with GUIDON opens it here with \"Open a shared plan file\". Nothing is sent by GUIDON itself." }),
        el("div.btn-row", {}, [exp, imp, sheet]), fileIn, impStatus
      ]));
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
          await commit(label + " set to " + picked.title + ", for this date only.", 'select[data-pt-date-session="' + iso + '"]');
        });
        c.appendChild(sel);
        c.appendChild(el("p.hint", { text:effortLabel(e.effort) + " effort" + (plan.overrides[iso] ? " · changed for this date" : " · weekly plan") }));
        if (plan.overrides[iso]) {
          let reset = el("button.btn.sm.ghost", { type:"button", text:"Use weekly plan", "data-pt-date-reset":iso });
          reset.addEventListener("click", async function () {
            delete plan.overrides[iso];
            // The reset button is gone after the redraw; land on the date's picker.
            await commit(label + " is back on the weekly plan.", 'select[data-pt-date-session="' + iso + '"]');
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
      showTemplateHint();
      Array.from(tabs.querySelectorAll("button")).forEach(function (b) {
        var on = b.getAttribute("data-pt-view") === activeView;
        b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1; // roving tabindex: a mouse click must move it too
      });
      stage.setAttribute("aria-labelledby", "pt-view-tab-" + activeView);
      drawUndo();
      drawRatio();
      drawHistoryGuard(generation);
      if (activeView === "day") renderDay(generation);
      else if (activeView === "month") renderMonth();
      else renderWeek();
      refocus(focusSelector);
    }
    lastWarn = ratioOf(plan).warn; // the state on arrival is not a "change" to announce
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
    _normalizePlan:normalizePlan,       // pure helpers, exported for tests
    _dayEntryForDate:dayEntryForDate,
    _nextDateForDay:nextDateForDay,
    PLAN_FILE_SCHEMA:PLAN_FILE_SCHEMA,
    _session:prtSession,
    _sessionSummary:prtSessionSummary
  };
})();