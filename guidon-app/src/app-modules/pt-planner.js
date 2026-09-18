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
  var LEADER_CHECKLIST = [
    "Confirm task, conditions, standards, and the leader responsible for the session.",
    "Complete the applicable risk-management process and brief controls before training.",
    "Confirm site, equipment, water, communications, and medical/emergency support.",
    "Brief the session plan and any unit-specific limitations before execution.",
    "Close with an AAR: one sustain, one improve, and the next action."
  ];

  var PRESETS = {
    rest: { id:"rest", title:"Rest / no organized PT", type:"rest", effort:"recovery", route:"" },
    prep: { id:"prep", title:"Preparation Drill", type:"drill", effort:"recovery", route:"#/prt" },
    recovery: { id:"recovery", title:"Recovery / mobility", type:"session", effort:"recovery", route:"#/drills" },
    strength: { id:"strength", title:"Strength & mobility session", type:"session", effort:"hard", route:"#/drills" },
    endurance: { id:"endurance", title:"Endurance & mobility session", type:"session", effort:"hard", route:"#/drills" },
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
    return { id:p.id, title:p.title, type:p.type, effort:p.effort, route:p.route || "" };
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
        route:String(d.route || "")
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
  function nextDateForDay(dayIndex) {
    var now = new Date(); now.setHours(0,0,0,0);
    var delta = (dayIndex - now.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    var d = new Date(now); d.setDate(d.getDate() + delta);
    return localISO(d);
  }
  function dayEntryForDate(plan, d) {
    var iso = localISO(d);
    var override = plan.overrides && plan.overrides[iso];
    return override && typeof override === "object" ? override : plan.days[DAY_KEYS[d.getDay()]];
  }
  async function addPtReminder(entry, dayIndex) {
    if (!G.reminders || !G.reminders.add) return false;
    var date = nextDateForDay(dayIndex);
    var list = await G.reminders.add({ kind:"pt", label:"PT: " + entry.title, date:date, note:"From PT Planner" });
    if (!list) { util.toast("Reminder limit reached."); return false; }
    var r = list[list.length - 1];
    try { if (G.notify && G.notify.scheduleForReminder) await G.notify.scheduleForReminder(r); } catch (e) {}
    util.toast("PT reminder set for " + date + ".");
    return true;
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

    function makeDayCard(dayIndex, compact) {
      var key = DAY_KEYS[dayIndex], entry = plan.days[key];
      var card = el("div.panel.pt-day-card", { "data-pt-day":key });
      card.appendChild(el("div.eyebrow", { text:DAY_NAMES[dayIndex] }));
      if (compact) {
        card.appendChild(el("strong", { text:entry.title }));
        card.appendChild(el("p.hint", { text:effortLabel(entry.effort) + " · " + plan.intensity }));
        return card;
      }
      var sel = el("select", { "aria-label":"Session for " + DAY_NAMES[dayIndex], "data-pt-session":key });
      Object.keys(PRESETS).forEach(function (id) { sel.appendChild(el("option", { value:id, text:PRESETS[id].title })); });
      sel.value = PRESETS[entry.id] ? entry.id : "custom";
      sel.addEventListener("change", async function () {
        plan.days[key] = clonePreset(sel.value);
        await savePlan(plan);
        draw();
      });
      card.appendChild(sel);
      if (entry.id === "custom") {
        var custom = el("input", { type:"text", value:entry.title === "Custom PT" ? "" : entry.title, placeholder:"Name this session", "aria-label":"Custom PT name for " + DAY_NAMES[dayIndex], "data-pt-custom":key });
        custom.addEventListener("change", async function () { plan.days[key].title = custom.value.trim() || "Custom PT"; await savePlan(plan); });
        card.appendChild(custom);
        var effort = el("select", { "aria-label":"Training effort for " + DAY_NAMES[dayIndex], "data-pt-effort":key });
        [["recovery","Recovery"],["moderate","Moderate"],["hard","Hard"]].forEach(function (pair) { effort.appendChild(el("option", { value:pair[0], text:pair[1] })); });
        effort.value = entry.effort;
        effort.addEventListener("change", async function () { plan.days[key].effort = effort.value; await savePlan(plan); drawRatio(); });
        card.appendChild(effort);
      }
      card.appendChild(el("p.hint", { text:effortLabel(entry.effort) + " effort · " + entry.type }));
      var actions = el("div.btn-row");
      if (entry.route) {
        var open = el("button.btn.sm.ghost", { type:"button", text:"Open training tool" });
        open.addEventListener("click", function () { location.hash = entry.route; });
        actions.appendChild(open);
      }
      var remind = el("button.btn.sm.ghost.pt-remind-btn", { type:"button", text:"Remind me", "data-pt-remind":key });
      remind.addEventListener("click", async function () {
        remind.disabled = true;
        var ok = await addPtReminder(plan.days[key], dayIndex);
        remind.textContent = ok ? "Reminder set" : "Try again";
        if (!ok) remind.disabled = false;
      });
      actions.appendChild(remind);
      var swap = el("button.btn.sm.ghost", { type:"button", text:"Swap with " + DAY_NAMES[(dayIndex+1)%7], "data-pt-swap":key });
      swap.addEventListener("click", async function () {
        var nextKey = DAY_KEYS[(dayIndex+1)%7], tmp = plan.days[key];
        plan.days[key] = plan.days[nextKey]; plan.days[nextKey] = tmp;
        await savePlan(plan); draw();
      });
      actions.appendChild(swap);
      card.appendChild(actions);
      return card;
    }

    async function renderDay(generation) {
      util.clear(stage);
      var idx = new Date().getDay();
      stage.appendChild(makeDayCard(idx, false));
      var hist = await loadHistory();
      if (generation !== drawGeneration || activeView !== "day") return;
      var todayKey = localISO(new Date());
      var already = hist.some(function (x) { return x && x.date === todayKey; });
      var complete = el("button.btn.primary", { type:"button", text:already ? "Today logged" : "Mark today complete", "data-pt-complete":"1" });
      complete.disabled = already;
      complete.addEventListener("click", async function () {
        var e = plan.days[DAY_KEYS[idx]];
        hist.unshift({ date:todayKey, title:e.title, effort:e.effort, intensity:plan.intensity, ts:Date.now() });
        await saveHistory(hist); complete.disabled = true; complete.textContent = "Today logged"; util.toast("PT session logged.");
      });
      stage.appendChild(el("div.panel", {}, [el("div.eyebrow", { text:"History" }), complete]));
    }
    function renderWeek() {
      util.clear(stage);
      var grid = el("div.card-results-grid", { "data-pt-week":"1" });
      for (var i=0;i<7;i++) grid.appendChild(makeDayCard(i, false));
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
        await savePlan(plan); draw();
      });
      var shuffle = el("button.btn.ghost", { type:"button", text:"Shuffle week", "data-pt-shuffle":"1" });
      shuffle.addEventListener("click", async function () {
        var entries = DAY_KEYS.map(function (k) { return plan.days[k]; });
        for (var j=entries.length-1;j>0;j--) {
          var k = Math.floor(Math.random() * (j+1)), tmp = entries[j]; entries[j] = entries[k]; entries[k] = tmp;
        }
        DAY_KEYS.forEach(function (k, idx) { plan.days[k] = entries[idx]; });
        await savePlan(plan); draw();
      });
      var schedule = el("button.btn.ghost", { type:"button", text:"Schedule week reminders", "data-pt-remind-week":"1" });
      schedule.addEventListener("click", async function () {
        schedule.disabled = true;
        var made = 0;
        for (var j=0;j<7;j++) {
          var e = plan.days[DAY_KEYS[j]];
          if (e && e.type !== "rest" && await addPtReminder(e, j)) made++;
        }
        schedule.textContent = made ? made + " reminders set" : "No reminders added";
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
        var sel = el("select", { "aria-label":"Session override for " + iso, "data-pt-date-session":iso });
        Object.keys(PRESETS).forEach(function (id) { sel.appendChild(el("option", { value:id, text:PRESETS[id].title })); });
        sel.value = PRESETS[e.id] ? e.id : "custom";
        sel.addEventListener("change", async function () {
          plan.overrides[iso] = clonePreset(sel.value);
          await savePlan(plan); draw();
        });
        c.appendChild(sel);
        c.appendChild(el("p.hint", { text:effortLabel(e.effort) + " · " + plan.intensity + (plan.overrides[iso] ? " · date override" : " · weekly plan") }));
        if (plan.overrides[iso]) {
          var reset = el("button.btn.sm.ghost", { type:"button", text:"Use weekly plan", "data-pt-date-reset":iso });
          reset.addEventListener("click", async function () { delete plan.overrides[iso]; await savePlan(plan); draw(); });
          c.appendChild(reset);
        }
        grid.appendChild(c);
      }
      stage.appendChild(grid);
    }
    function draw() {
      var generation = ++drawGeneration;
      ih.textContent = (TEMPLATES[plan.templateId] || TEMPLATES.balanced).hint;
      Array.from(intensity.querySelectorAll("button")).forEach(function (b) { var on = b.getAttribute("data-intensity") === plan.intensity; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
      Array.from(tabs.querySelectorAll("button")).forEach(function (b) { var on = b.getAttribute("data-pt-view") === activeView; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
      drawRatio();
      if (activeView === "day") renderDay(generation);
      else if (activeView === "month") renderMonth();
      else renderWeek();
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
    _planFromTemplate:planFromTemplate
  };
})();