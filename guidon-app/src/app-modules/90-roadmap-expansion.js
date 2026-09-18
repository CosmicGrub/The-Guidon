/* GUIDON - roadmap expansion foundations: PT planner, team tools, board readiness rollup.
   Additive runtime APIs only. UI integrations live in their owning routes.
*/
window.G = window.G || {};
(function () {
  "use strict";

  const PT_PLAN_KEY = "prt:plan:v1";
  const PT_HISTORY_KEY = "pt:history";
  const TEAM_KEY = "guidon:leader:team-training:v1";
  const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

  function isoDay(d) {
    const x = d instanceof Date ? d : new Date(d || Date.now());
    return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  const SESSION_LIBRARY = [
    { id:"strength", name:"Strength", intensity:"hard", kind:"template", note:"Strength-focused training session." },
    { id:"speed", name:"Speed / intervals", intensity:"hard", kind:"template", note:"High-intensity running or interval session." },
    { id:"endurance", name:"Aerobic endurance", intensity:"hard", kind:"template", note:"Sustained aerobic conditioning." },
    { id:"combat", name:"Combat conditioning", intensity:"hard", kind:"template", note:"Mission-oriented conditioning session." },
    { id:"recovery", name:"Recovery / mobility", intensity:"recovery", kind:"template", note:"Low-intensity recovery and mobility." },
    { id:"prt-pd", name:"Preparation Drill", intensity:"recovery", kind:"drill", drillId:"pd", note:"Run the verified Preparation Drill already in GUIDON." },
    { id:"rest", name:"Rest", intensity:"recovery", kind:"rest", note:"No scheduled physical training." },
  ];

  function defaultWeek() {
    const pattern = ["strength","speed","recovery","strength","endurance","recovery","rest"];
    return DAY_NAMES.map(function (day, i) {
      const s = SESSION_LIBRARY.find(function (x) { return x.id === pattern[i]; });
      return { day: day, sessionId: s.id, title: s.name, intensity: s.intensity, kind: s.kind, drillId: s.drillId || null, note:"" };
    });
  }

  function normalizePlan(v) {
    if (!v || typeof v !== "object") v = {};
    let week = Array.isArray(v.week) ? v.week.slice(0, 7) : [];
    const defs = defaultWeek();
    while (week.length < 7) week.push(defs[week.length]);
    week = week.map(function (row, i) {
      row = row && typeof row === "object" ? row : {};
      const lib = SESSION_LIBRARY.find(function (x) { return x.id === row.sessionId; });
      return {
        day: DAY_NAMES[i],
        sessionId: row.sessionId || (lib && lib.id) || defs[i].sessionId,
        title: row.title || (lib && lib.name) || defs[i].title,
        intensity: row.intensity === "hard" ? "hard" : "recovery",
        kind: row.kind || (lib && lib.kind) || "custom",
        drillId: row.drillId || (lib && lib.drillId) || null,
        note: String(row.note || "").slice(0, 240),
      };
    });
    return { schema:1, week:week, updatedAt:Number(v.updatedAt)||Date.now() };
  }

  async function loadPlan() {
    try {
      const r = await G.db.get("kv", PT_PLAN_KEY);
      return normalizePlan(r && r.v);
    } catch (e) { return normalizePlan(null); }
  }
  async function savePlan(plan) {
    const clean = normalizePlan(plan);
    clean.updatedAt = Date.now();
    await G.db.put("kv", { k: PT_PLAN_KEY, v: clean });
    return clean;
  }
  function ratio(plan) {
    const p = normalizePlan(plan);
    let hard = 0, recovery = 0;
    p.week.forEach(function (d) { if (d.intensity === "hard") hard++; else recovery++; });
    return {
      hard:hard, recovery:recovery,
      ratio: recovery ? hard / recovery : hard ? Infinity : 0,
      warning: hard > 0 && (recovery === 0 || hard / recovery > 3),
      label: hard + ":" + recovery,
    };
  }
  async function history() {
    try {
      const r = await G.db.get("kv", PT_HISTORY_KEY);
      return Array.isArray(r && r.v) ? r.v : [];
    } catch (e) { return []; }
  }
  async function recordHistory(entry) {
    const rows = await history();
    rows.push(Object.assign({ ts:Date.now(), date:isoDay() }, entry || {}));
    if (rows.length > 180) rows.splice(0, rows.length - 180);
    await G.db.put("kv", { k: PT_HISTORY_KEY, v: rows });
    return rows[rows.length - 1];
  }
  function swap(plan, a, b) {
    const p = normalizePlan(plan);
    if (a < 0 || b < 0 || a > 6 || b > 6 || a === b) return p;
    const x = p.week[a], y = p.week[b];
    p.week[a] = Object.assign({}, y, { day:DAY_NAMES[a] });
    p.week[b] = Object.assign({}, x, { day:DAY_NAMES[b] });
    return p;
  }
  function shuffleWeek(plan) {
    const p = normalizePlan(plan);
    const rows = p.week.map(function (x) { return Object.assign({}, x); });
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); const t = rows[i]; rows[i] = rows[j]; rows[j] = t;
    }
    p.week = rows.map(function (x, i) { x.day = DAY_NAMES[i]; return x; });
    return p;
  }
  function exportPlan(plan) {
    const p = normalizePlan(plan);
    return {
      schema:"guidon-pt-plan/1",
      generatedAt:new Date().toISOString(),
      plan:p,
      text:p.week.map(function (d) { return d.day + ": " + d.title + " [" + d.intensity + "]" + (d.note ? " — " + d.note : ""); }).join("\n"),
    };
  }

  async function renderPlanner(mount) {
    const el = G.util.el;
    G.util.clear(mount);
    let plan = await loadPlan();
    let mode = "week";

    const tabs = el("div.segmented", { "aria-label":"PT planner view" });
    const body = el("div", { style:"margin-top:10px" });
    const status = el("div", { role:"status", "aria-live":"polite" });
    ["day","week","month"].forEach(function (m) {
      const b = el("button" + (m === mode ? ".active" : ""), { type:"button", text:m[0].toUpperCase()+m.slice(1), "aria-pressed":String(m===mode) });
      b.addEventListener("click", function () {
        mode=m;
        Array.prototype.forEach.call(tabs.querySelectorAll("button"), function (x) { const on=x.textContent.toLowerCase()===m; x.classList.toggle("active",on); x.setAttribute("aria-pressed",String(on)); });
        draw();
      });
      tabs.appendChild(b);
    });
    mount.appendChild(el("div.panel", {}, [
      el("div.eyebrow", { text:"PT Planner" }),
      el("h3", { text:"Day / week / month training plan" }),
      el("p.hint", { text:"Editable local plan. Defaults are suggestions, not orders; adjust them to your unit program and current guidance." }),
      tabs, status, body
    ]));

    async function persist(msg) {
      plan = await savePlan(plan);
      status.textContent = msg || "PT plan saved.";
    }
    function libFor(id) { return SESSION_LIBRARY.find(function (x) { return x.id === id; }); }
    function ratioLine() {
      const r = ratio(plan);
      const p = el("div.feedback." + (r.warning ? "warn" : "good"), { style:"margin-bottom:10px",
        text:"Hard : recovery/rest = " + r.label + (r.warning ? " — above the planner's 3:1 caution threshold; consider adding recovery." : " — within the planner's 3:1 caution threshold.") });
      return p;
    }
    function dayIndexNow() { const d=new Date().getDay(); return d===0 ? 6 : d-1; }
    function drawDay() {
      const d = plan.week[dayIndexNow()];
      body.appendChild(ratioLine());
      const card = el("div.card");
      card.appendChild(el("div.eyebrow", { text:"Today · " + d.day }));
      card.appendChild(el("h3", { text:d.title }));
      card.appendChild(el("p.hint", { text:"Intensity: " + d.intensity + (d.note ? " · " + d.note : "") }));
      if (d.drillId === "pd") {
        const run = el("button.btn.primary", { type:"button", text:"Open Preparation Drill" });
        run.addEventListener("click", function () { location.hash="#/prt"; });
        card.appendChild(run);
      }
      body.appendChild(card);
    }
    function drawWeek() {
      body.appendChild(ratioLine());
      const grid = el("div");
      plan.week.forEach(function (d, i) {
        const row = el("div.panel", { style:"margin-bottom:8px" });
        const head = el("div.stat", {}, [el("span.k", { text:d.day }), el("span.v", { text:d.intensity })]);
        row.appendChild(head);
        const sel = el("select", { "aria-label":"Session for " + d.day, style:"width:100%;margin:6px 0" });
        SESSION_LIBRARY.forEach(function (s) { sel.appendChild(el("option", { value:s.id, text:s.name, selected:s.id===d.sessionId ? "selected" : null })); });
        sel.addEventListener("change", async function () {
          const s=libFor(sel.value); plan.week[i]=Object.assign({}, plan.week[i], { sessionId:s.id,title:s.name,intensity:s.intensity,kind:s.kind,drillId:s.drillId||null });
          await persist(d.day + " updated."); draw();
        });
        row.appendChild(sel);
        const note = el("input", { type:"text", value:d.note||"", maxlength:"240", placeholder:"Optional session note", "aria-label":"Note for " + d.day, style:"width:100%" });
        note.addEventListener("change", async function () { plan.week[i].note=note.value.slice(0,240); await persist(d.day + " note saved."); });
        row.appendChild(note);
        const move = el("div.btn-row", { style:"margin-top:6px" });
        if (i>0) {
          const up=el("button.btn.ghost.sm",{type:"button",text:"↑ Swap"});
          up.addEventListener("click",async function(){plan=swap(plan,i,i-1);await persist("Sessions swapped.");draw();}); move.appendChild(up);
        }
        if (i<6) {
          const down=el("button.btn.ghost.sm",{type:"button",text:"↓ Swap"});
          down.addEventListener("click",async function(){plan=swap(plan,i,i+1);await persist("Sessions swapped.");draw();}); move.appendChild(down);
        }
        row.appendChild(move); grid.appendChild(row);
      });
      body.appendChild(grid);
      const acts=el("div.btn-row",{style:"margin-top:10px;flex-wrap:wrap"});
      const shuf=el("button.btn",{type:"button",text:"Shuffle week"});
      shuf.addEventListener("click",async function(){plan=shuffleWeek(plan);await persist("Week shuffled.");draw();});
      const reset=el("button.btn.ghost",{type:"button",text:"Restore defaults"});
      reset.addEventListener("click",async function(){plan=normalizePlan({week:defaultWeek()});await persist("Default week restored.");draw();});
      const exp=el("button.btn.ghost",{type:"button",text:"Export plan"});
      exp.addEventListener("click",function(){
        const x=exportPlan(plan), blob=new Blob([x.text+"\n\n"+JSON.stringify(x,null,2)],{type:"text/plain"});
        const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="guidon-pt-plan.txt"; a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
      });
      const print=el("button.btn.ghost",{type:"button",text:"Print"});
      print.addEventListener("click",function(){const x=exportPlan(plan); G.util.printHTML("GUIDON PT Plan","<pre style='white-space:pre-wrap'>"+G.util.esc(x.text)+"</pre>");});
      acts.appendChild(shuf);acts.appendChild(reset);acts.appendChild(exp);acts.appendChild(print);body.appendChild(acts);
    }
    function drawMonth() {
      body.appendChild(ratioLine());
      body.appendChild(el("p.hint", { text:"Four-week projection using the editable weekly template. Change Week view once and the projection updates everywhere." }));
      for(let w=1;w<=4;w++) {
        const p=el("div.panel",{style:"margin-bottom:8px"}); p.appendChild(el("div.eyebrow",{text:"Week "+w}));
        p.appendChild(el("p",{text:plan.week.map(function(d){return d.day.slice(0,3)+" "+d.title;}).join(" · ")})); body.appendChild(p);
      }
    }
    function draw() {
      G.util.clear(body);
      if(mode==="day") drawDay(); else if(mode==="month") drawMonth(); else drawWeek();
    }
    draw();
  }

  G.ptPlanner = {
    KEY:PT_PLAN_KEY, HISTORY_KEY:PT_HISTORY_KEY, DAYS:DAY_NAMES.slice(), library:SESSION_LIBRARY.slice(),
    defaultWeek:defaultWeek, normalize:normalizePlan, load:loadPlan, save:savePlan, ratio:ratio,
    history:history, recordHistory:recordHistory, swap:swap, shuffle:shuffleWeek, exportPlan:exportPlan, render:renderPlanner,
  };

  const TEAM_CATALOG = [
    { id:"relay-tccc", title:"TCCC Decision Relay", route:"#/train", scenarioId:"sc-tccc-ied-strike", band:"content", objective:"Rotate decision ownership through a casualty-care scenario and require a short rationale before each team answer." },
    { id:"relay-medevac", title:"9-Line Handoff Relay", route:"#/train", scenarioId:"sc-medevac-9line-callin", band:"content", objective:"Practice concise handoffs and collective correction while building a 9-line MEDEVAC request." },
    { id:"relay-comms", title:"Comms Blackout Decision Relay", route:"#/train", scenarioId:"sc-iot-comms-blackout", band:"content", objective:"Rotate through a communications-loss vignette and compare individual versus collective decisions." },
    { id:"relay-motorpool", title:"Motor Pool Safety Huddle", route:"#/train", scenarioId:"sc-iot-motorpool-belt", band:"content", objective:"Discuss safety, maintenance, and schedule pressure before locking in a team response." },
    { id:"relay-range", title:"Range Safety Decision Huddle", route:"#/train", scenarioId:"sc-iot-range-safety", band:"content", objective:"Use a time-boxed group decision before committing to a range-safety choice." },
    { id:"board-pass", title:"Board Question Pass", route:"#/board", band:"icebreaker", objective:"Pass the device; each Soldier answers one board question and explains the source before handing off." },
    { id:"first-letter", title:"Creed First-Letter Relay", route:"#/recite", band:"icebreaker", objective:"Rotate line ownership through a creed or identity text using first-letter prompts." },
    { id:"landnav-plot", title:"Grid Plot Partner Check", route:"#/landnav", band:"trust", objective:"One Soldier plots while a partner independently checks the grid and explains any correction." },
    { id:"rapid-team", title:"Rapid Fire Team Round", route:"#/board", band:"stress", objective:"Run the existing pass-the-device team mode under time pressure, then review misses together." },
    { id:"prt-lead", title:"PRT Lead-and-Correct", route:"#/prt", band:"trust", objective:"Rotate exercise leadership while peers verify sequence, cadence, and corrections against the reference." },
  ];

  async function loadTeamState() {
    try { const r = await G.db.get("kv", TEAM_KEY); return (r && r.v && typeof r.v === "object") ? r.v : { schema:1, certifications:{} }; }
    catch (e) { return { schema:1, certifications:{} }; }
  }
  async function setCertification(rosterIndex, skillId, state) {
    const v = await loadTeamState();
    v.certifications = v.certifications || {};
    const k = String(rosterIndex);
    v.certifications[k] = v.certifications[k] || {};
    if (state) v.certifications[k][skillId] = { complete:true, ts:Date.now() };
    else delete v.certifications[k][skillId];
    await G.db.put("kv", { k:TEAM_KEY, v:v });
    return v;
  }
  function startCatalogItem(itemId, members) {
    const item = TEAM_CATALOG.find(function (x) { return x.id === itemId; });
    if (!item) return false;
    if (item.scenarioId && G.engine) {
      G.engine._pendingTeam = {
        scenarioId:item.scenarioId,
        members:Array.isArray(members) && members.length ? members.slice(0, 12) : ["Soldier 1","Soldier 2"],
        relay:true,
        discussionSeconds:30,
      };
      location.hash = "#/train";
      return true;
    }
    location.hash = item.route;
    return true;
  }
  G.teamTools = { KEY:TEAM_KEY, catalog:TEAM_CATALOG.slice(), load:loadTeamState, setCertification:setCertification, start:startCatalogItem };

  // Opt selected, already-shipped scenarios into the new collective-decision
  // behavior without creating a parallel scenario collection. Only nodes with
  // two or more choices are eligible; the first two decision nodes are marked,
  // leaving the rest of every scenario unchanged in ordinary solo play.
  try {
    const ids = ["sc-tccc-ied-strike","sc-medevac-9line-callin","sc-iot-comms-blackout","sc-iot-motorpool-belt","sc-iot-range-safety"];
    const list = window.GUIDON_SEED && window.GUIDON_SEED.scenarios && window.GUIDON_SEED.scenarios.scenarios;
    if (Array.isArray(list)) ids.forEach(function (id) {
      const sc = list.find(function (x) { return x.id === id; });
      if (!sc || !sc.nodes) return;
      let marked = 0;
      Object.keys(sc.nodes).forEach(function (k) {
        const n = sc.nodes[k];
        if (marked < 2 && n && Array.isArray(n.choices) && n.choices.length >= 2) { n.discuss = true; marked++; }
      });
    });
  } catch (e) {}

  if (G.board) {
    G.board.readinessScore = async function () {
      const cats = await G.board.categoryMasteryScores();
      const active = cats.filter(function (c) { return c.total > 0; });
      const mastery = active.length ? Math.round(active.reduce(function (a,c) { return a + c.pct; }, 0) / active.length) : 0;
      let attempts = [];
      try { attempts = await G.db.allAttempts(); } catch (e) {}
      const scenarioAttempts = attempts.filter(function (a) { return a && a.scenarioId && a.mode !== "training"; });
      const unique = new Set(scenarioAttempts.map(function (a) { return a.scenarioId; })).size;
      const scenario = Math.min(100, unique * 10);
      const score = Math.round(mastery * 0.8 + scenario * 0.2);
      return {
        score:score, mastery:mastery, scenario:scenario, uniqueScenarios:unique,
        formula:"80% board-card category mastery + 20% scenario-practice coverage (10 unique scenarios = full scenario component)",
      };
    };
  }
})();
