/* ==== js/leader.js ==== */
/* GUIDON - leader.js : squad roster and leader duties (G.leader)

   Every other section of this app serves one Soldier: the person holding the
   phone. This app is named for leader development, and until now a squad leader
   with four Soldiers had no way to use any of it FOR them.

   The duty this targets is the one leaders are most often gigged on and least
   often reminded about: monthly developmental counselling. Not because leaders
   do not know the requirement - because nobody is tracking who is overdue.

   PRIVACY IS THE DESIGN CONSTRAINT, not a footnote. This is the first feature
   in GUIDON that stores information about OTHER people, on a device that
   belongs to one of them. So:
     - it never leaves the device, like everything else here
     - it defaults to initials and asks for nothing sensitive
     - it holds dates and a counselling cadence, not performance narrative,
       not medical, not legal, not anything that belongs in a real system
     - clearing the roster is one obvious button, not buried
   A leader tool that quietly became a shadow personnel file would be worse
   than no leader tool.
*/
window.G = window.G || {};
(function () {
  "use strict";
  const util = G.util, el = util.el;

  const KEY = "guidon:leader:roster:v1";
  const DAY = 86400000;

  /* Tracked per Soldier. Dates only - deliberately no free-text assessment. */
  const FIELDS = [
    { key: "counseled", label: "Last counselling", days: 30,
      note: "Monthly developmental counselling. The most commonly missed leader duty.", link: "#/counsel" },
    { key: "aft", label: "Last AFT", days: 365,
      note: "Feeds their promotion points and their readiness.", link: "#/fitness" },
    { key: "wpn", label: "Last weapons qual", days: 730,
      note: "Past 24 months it is worth zero promotion points to them.", link: "#/board" },
    { key: "ncoer", label: "Last NCOER thru-date", days: 365,
      note: "NCOs only. A gap in the record is a gap a board sees.", link: "#/records" },
  ];

  function todayMid() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  function daysSince(d) { return Math.round((todayMid().getTime() - d.getTime()) / DAY); }

  /** Returns the overdue items for one Soldier, worst first. */
  function overdueFor(sol) {
    const out = [];
    FIELDS.forEach(function (f) {
      const d = parseDate(sol[f.key]);
      if (!d) { out.push({ f: f, over: null, label: f.label + ": not recorded" }); return; }
      const since = daysSince(d);
      const over = since - f.days;
      if (over > 0) out.push({ f: f, over: over, label: f.label + ": " + over + " days overdue" });
    });
    return out;
  }

  async function render(mount) {
    util.clear(mount);
    mount.appendChild(el("div.section-title", {}, [
      el("h2", { text: "Squad Roster" }), el("div.rule") ]));

    let roster = [];
    try { const r = await G.db.get("kv", KEY); roster = (r && r.v) || []; } catch (e) { /* offline-safe */ }

    async function persist() {
      try { await G.db.put("kv", { k: KEY, v: roster }); } catch (e) { /* offline-safe */ }
    }

    /* ---- the privacy statement, first, not buried ---- */
    const priv = el("div.panel", { style: "margin-bottom:10px;border-left:3px solid var(--amber)" });
    priv.appendChild(el("div.eyebrow", { text: "Read this before you put anyone in here" }));
    priv.appendChild(el("p", { text:
      "This is the only part of GUIDON that holds information about other people. It stays on this device, it is never uploaded, and it is not a system of record - IPPS-A and your unit's tracker are." }));
    priv.appendChild(el("p", { text:
      "Use initials or a roster number, not full names. Keep it to dates. Do not put medical, legal, SHARP, financial or performance narrative in here - that belongs in the systems built for it, with the access controls that come with them." }));
    priv.appendChild(el("p.hint", { text:
      "If this device is shared, issued, or you are about to hand it to someone, clear the roster." }));
    priv.appendChild(el("p.hint", { text:
      "The roster is deliberately LEFT OUT of GUIDON backup files, so exporting your study data will not quietly carry other people's information with it. That also means it does not follow you to a new device - if you replace this one, you re-enter it." }));
    mount.appendChild(priv);

    const summary = el("div.panel", { style: "margin-bottom:10px" });
    const list = el("div");

    function buildSummary() {
      util.clear(summary);
      summary.appendChild(el("div.eyebrow", { text: "Needs attention" }));
      if (!roster.length) {
        summary.appendChild(el("p.hint", { text: "No one on the roster yet." }));
        return;
      }
      const flagged = [];
      roster.forEach(function (sol) {
        const od = overdueFor(sol).filter(function (x) { return x.over !== null; });
        if (od.length) {
          od.sort(function (a, b) { return b.over - a.over; });
          flagged.push({ sol: sol, worst: od[0], count: od.length });
        }
      });
      if (!flagged.length) {
        summary.appendChild(el("p.hint", { text: "Nothing overdue against the dates you have recorded. Blank fields are not the same as current - fill them in to know." }));
        return;
      }
      flagged.sort(function (a, b) { return b.worst.over - a.worst.over; });
      flagged.forEach(function (x) {
        const c = el("div.card", { style: "margin-top:8px;border-left:3px solid " + (x.worst.over > 30 ? "var(--red)" : "var(--amber)") });
        const head = el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:baseline" });
        head.appendChild(el("span.k", { text: (x.sol.rank ? x.sol.rank + " " : "") + (x.sol.name || "(unnamed)"), style: "min-width:0;flex:1 1 auto" }));
        head.appendChild(el("span.v", { text: x.count + (x.count === 1 ? " item" : " items"), style: "flex:0 0 auto;white-space:nowrap" }));
        c.appendChild(head);
        c.appendChild(el("div.hint", { text: x.worst.label }));
        if (x.worst.f.link) {
          const b = el("button.btn.sm.ghost", { type: "button", text: "Open " + x.worst.f.link.replace("#/", ""), style: "margin-top:6px" });
          b.addEventListener("click", function () { location.hash = x.worst.f.link; });
          c.appendChild(b);
        }
        summary.appendChild(c);
      });
    }

    function buildList() {
      util.clear(list);
      roster.forEach(function (sol, idx) {
        const card = el("div.panel", { style: "margin-bottom:10px" });
        const head = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" });
        const rankIn = el("input.ob-input", { type: "text", value: sol.rank || "", placeholder: "Rank",
          "aria-label": "Rank for roster entry " + (idx + 1), style: "width:90px" });
        const nameIn = el("input.ob-input", { type: "text", value: sol.name || "", placeholder: "Initials",
          "aria-label": "Initials or roster number for entry " + (idx + 1), style: "flex:1;min-width:120px" });
        rankIn.addEventListener("change", function () { sol.rank = rankIn.value.trim(); persist(); buildSummary(); });
        nameIn.addEventListener("change", function () { sol.name = nameIn.value.trim(); persist(); buildSummary(); });
        head.appendChild(rankIn); head.appendChild(nameIn);

        const del = el("button.btn.sm.ghost", { type: "button", text: "Remove", "aria-label": "Remove roster entry " + (idx + 1) });
        del.addEventListener("click", async function () {
          const label = (sol.rank ? sol.rank + " " : "") + (sol.name || "this entry");
          const yes = await G.modal.confirm("Remove " + label + " from the roster?", { okText: "Remove", danger: true });
          if (!yes) return;
          roster.splice(idx, 1); await persist(); buildSummary(); buildList();
        });
        head.appendChild(del);
        card.appendChild(head);

        FIELDS.forEach(function (f) {
          const row = el("div", { style: "margin-top:8px" });
          const lab = el("div.k", { text: f.label });
          const inp = el("input.ob-input", { type: "date", value: sol[f.key] || "",
            "aria-label": f.label + " for roster entry " + (idx + 1), style: "width:100%;margin-top:4px" });
          inp.addEventListener("change", function () { sol[f.key] = inp.value; persist(); buildSummary(); });
          row.appendChild(lab); row.appendChild(inp);
          const d = parseDate(sol[f.key]);
          if (d) {
            const since = daysSince(d), over = since - f.days;
            row.appendChild(el("div.hint", { text: over > 0
              ? since + " days ago - " + over + " days past the " + f.days + "-day mark. " + f.note
              : since + " days ago. Next due in " + (-over) + " days." }));
          } else {
            row.appendChild(el("div.hint", { text: f.note }));
          }
          card.appendChild(row);
        });
        list.appendChild(card);
      });
    }

    const controls = el("div.panel", { style: "margin-bottom:10px" });
    const addBtn = el("button.btn.primary", { type: "button", text: "+ Add Soldier", style: "margin-right:6px" });
    addBtn.addEventListener("click", async function () {
      roster.push({ rank: "", name: "", counseled: "", aft: "", wpn: "", ncoer: "" });
      await persist(); buildSummary(); buildList();
    });
    const clrBtn = el("button.btn.sm.ghost", { type: "button", text: "Clear roster" });
    clrBtn.addEventListener("click", async function () {
      if (!roster.length) return;
      const yes = await G.modal.confirm(
        "Delete all " + roster.length + " roster entries from this device? This cannot be undone.",
        { okText: "Delete all", danger: true });
      if (!yes) return;
      roster = []; await persist(); buildSummary(); buildList();
    });
    controls.appendChild(addBtn); controls.appendChild(clrBtn);

    mount.appendChild(summary);
    mount.appendChild(controls);
    mount.appendChild(list);

    const foot = el("div.panel");
    foot.appendChild(el("div.eyebrow", { text: "Counselling, properly" }));
    foot.appendChild(el("p.hint", { text:
      "Tracking the date is the easy half. The counselling itself is a DA Form 4856, and GUIDON can build and export a real one." }));
    [["Counselling skill-builder", "#/counsel"], ["DA 4856 form", "#/forms"], ["Army writing", "#/write"]].forEach(function (pair) {
      const b = el("button.btn.sm.ghost", { type: "button", text: pair[0], style: "margin:6px 6px 0 0" });
      b.addEventListener("click", function () { location.hash = pair[1]; });
      foot.appendChild(b);
    });
    mount.appendChild(foot);

    buildSummary();
    buildList();
  }

  G.leader = { render: render, FIELDS: FIELDS, KEY: KEY, overdueFor: overdueFor };
})();
// END leader.js
