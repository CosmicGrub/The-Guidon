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
  // Shared with calendar.js as util.parseISODate() - see its definition in
  // src/index.html for why this delegates rather than building the Date
  // itself (the multi-argument Date constructor this used to use directly
  // triggers JS's legacy 2-digit-year rule for year values 0-99).
  function parseDate(s) { return util.parseISODate(s); }
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
      // "Needs attention" is meant to be an at-a-glance triage list, not a
      // second copy of the full roster - at real unit scale (~400 Soldiers)
      // it previously printed every single flagged entry (379 cards in the
      // measured case), exactly as long as the full roster below it and
      // defeating the whole point of a quick-scan summary. Show the worst
      // SUMMARY_CAP by days-overdue, with an explicit "show all" expander
      // rather than a silent truncation.
      const SUMMARY_CAP = 15;
      let expanded = false;
      function renderFlagged() {
        Array.prototype.slice.call(summary.querySelectorAll(".card, .lead-more")).forEach(function (n) { n.remove(); });
        const shown = expanded ? flagged : flagged.slice(0, SUMMARY_CAP);
        shown.forEach(function (x) {
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
        if (!expanded && flagged.length > SUMMARY_CAP) {
          const more = el("button.btn.sm.ghost.lead-more", { type: "button",
            text: "Show all " + flagged.length + " (" + (flagged.length - SUMMARY_CAP) + " more)", style: "margin-top:8px" });
          more.addEventListener("click", function () { expanded = true; renderFlagged(); });
          summary.appendChild(more);
        }
      }
      renderFlagged();
    }

    let filterTerm = "";
    // Each roster card below renders 2 text inputs, 4 date inputs, and 4
    // computed hint strings with their own change listeners - at real unit
    // scale (buildSummary's own comment above measured ~400 Soldiers) that
    // is 400 full card rebuilds on every keystroke into the filter box,
    // with no debounce to collapse a fast typist's keystrokes into one
    // rebuild and no cap to bound a single rebuild's size (task #231).
    // Same CAP value and "show all N (M more)" expander shape as
    // buildSummary's own SUMMARY_CAP just above - one file, one pattern.
    const LIST_CAP = 25;
    let listExpanded = false;
    function buildList() {
      util.clear(list);
      // Filter by rank/initials substring, preserving each entry's REAL
      // index in `roster` (not its position in the filtered subset) - the
      // Remove button and every field's change handler below index into
      // the full roster array by that index, so filtering first without
      // tracking the real index would edit/remove the wrong entry.
      const term = filterTerm.trim().toLowerCase();
      const visible = term
        ? roster.map(function (sol, idx) { return { sol: sol, idx: idx }; })
                .filter(function (x) { return ((x.sol.rank || "") + " " + (x.sol.name || "")).toLowerCase().indexOf(term) !== -1; })
        : roster.map(function (sol, idx) { return { sol: sol, idx: idx }; });
      if (term && !visible.length) {
        list.appendChild(el("p.hint", { text: "No roster entries match “" + filterTerm.trim() + "”." }));
        return;
      }
      const shown = listExpanded ? visible : visible.slice(0, LIST_CAP);
      shown.forEach(function (entry) {
        const sol = entry.sol, idx = entry.idx;
        const card = el("div.panel", { style: "margin-bottom:10px" });
        const head = el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" });
        // Audit finding (rank/MOS scoping pass): rank was free text with no
        // link to the app's own canonical RANKS list (G.rankUtils, shared
        // with onboarding) - a "rank" that can't resolve to a tier can't
        // drive anything tier-aware elsewhere in the app. list= keeps this
        // a real text input (an existing hand-typed value still displays
        // and edits fine) rather than swapping in a <select> that could
        // silently reject data already saved before this change.
        const ranksListId = "roster-ranks-list";
        if (!document.getElementById(ranksListId) && G.rankUtils && G.rankUtils.RANKS) {
          const dl = el("datalist", { id: ranksListId });
          G.rankUtils.RANKS.forEach(function (r) { dl.appendChild(el("option", { value: r })); });
          document.body.appendChild(dl);
        }
        const rankIn = el("input.ob-input", { type: "text", value: sol.rank || "", placeholder: "Rank",
          list: (G.rankUtils && G.rankUtils.RANKS) ? ranksListId : null,
          "aria-label": "Rank for roster entry " + (idx + 1), style: "width:90px" });
        const nameIn = el("input.ob-input", { type: "text", value: sol.name || "", placeholder: "Initials",
          "aria-label": "Initials or roster number for entry " + (idx + 1), style: "flex:1;min-width:120px" });
        // Same MOS <datalist> pattern the onboarding role step and
        // career.js's own lookup already use - unlike rank, MOS never
        // existed on a roster entry at all, so a squad leader had no way
        // to see which of their Soldiers were in a shortage MOS or open
        // the Career Center for one of them specifically.
        const mosListId = "roster-mos-list";
        if (!document.getElementById(mosListId) && G.store && G.store.career) {
          const career = G.store.career() || { mos: [] };
          const mdl = el("datalist", { id: mosListId });
          (career.mos || []).forEach(function (m) { mdl.appendChild(el("option", { value: m.code, text: m.code + " — " + m.title })); });
          document.body.appendChild(mdl);
        }
        const mosIn = el("input.ob-input", { type: "text", value: sol.mos || "", placeholder: "MOS",
          list: mosListId, maxlength: 6,
          "aria-label": "MOS for roster entry " + (idx + 1), style: "width:80px" });
        rankIn.addEventListener("change", function () { sol.rank = rankIn.value.trim().toUpperCase(); persist(); buildSummary(); });
        nameIn.addEventListener("change", function () { sol.name = nameIn.value.trim(); persist(); buildSummary(); });
        mosIn.addEventListener("change", function () { sol.mos = mosIn.value.trim().toUpperCase(); persist(); });
        head.appendChild(rankIn); head.appendChild(mosIn); head.appendChild(nameIn);

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
          row.appendChild(lab); row.appendChild(inp);
          const hintEl = el("div.hint");
          // Was computed once at render time and never touched again - the
          // change handler below only called buildSummary(), so after
          // editing a date the summary panel above correctly reflected the
          // new overdue status but THIS field's own hint text (right under
          // the input the user just edited) kept showing the stale value
          // until some unrelated action forced a full buildList() rebuild.
          // A visible contradiction between the summary and its own detail
          // card, right after the edit that caused it.
          function refreshHint() {
            const d = parseDate(sol[f.key]);
            if (d) {
              const since = daysSince(d), over = since - f.days;
              hintEl.textContent = over > 0
                ? since + " days ago - " + over + " days past the " + f.days + "-day mark. " + f.note
                : since + " days ago. Next due in " + (-over) + " days.";
            } else {
              hintEl.textContent = f.note;
            }
          }
          refreshHint();
          inp.addEventListener("change", function () { sol[f.key] = inp.value; persist(); buildSummary(); refreshHint(); });
          row.appendChild(hintEl);
          // Upgrade-roadmap first wave, item 8: "counseling" is a real,
          // already-defined Reminders kind (reminders.js's own KINDS[0])
          // that had zero integration anywhere in the app, despite THIS
          // being the one module whose stated purpose is tracking
          // counselling overdue-ness. Reuses the exact G.reminders.add() +
          // G.notify.scheduleForReminder() pattern records.js's cutoff
          // reminder already established, one row per Soldier (label names
          // them) rather than one shared reminder for the whole roster.
          if (f.key === "counseled" && G.reminders && G.reminders.add) {
            const rb = el("button.btn.sm.ghost", { type: "button", text: "Remind me", style: "margin-top:6px" });
            rb.addEventListener("click", async function () {
              const last = parseDate(sol[f.key]);
              const due = last ? new Date(last.getTime() + f.days * DAY) : todayMid();
              const p = function (n) { return (n < 10 ? "0" : "") + n; };
              const dueIso = due.getFullYear() + "-" + p(due.getMonth() + 1) + "-" + p(due.getDate());
              const who = (sol.rank ? sol.rank + " " : "") + (sol.name || "Soldier " + (idx + 1));
              const updated = await G.reminders.add({ kind: "counseling", label: "Counsel " + who, date: dueIso });
              if (!updated) { try { util.toast && util.toast("You've reached the " + G.reminders.MAX + "-reminder limit — remove an old one first."); } catch (e) {} return; }
              try { if (G.notify) await G.notify.scheduleForReminder(updated[updated.length - 1]); } catch (e) {}
              try { if (util.announce) util.announce("Reminder set to counsel " + who + "."); } catch (e) {}
              rb.disabled = true;
              rb.textContent = "Reminder set";
            });
            row.appendChild(rb);
          }
          card.appendChild(row);
        });
        list.appendChild(card);
      });
      if (!listExpanded && visible.length > LIST_CAP) {
        const more = el("button.btn.sm.ghost", { type: "button",
          text: "Show all " + visible.length + " (" + (visible.length - LIST_CAP) + " more)", style: "margin-top:8px" });
        more.addEventListener("click", function () { listExpanded = true; buildList(); });
        list.appendChild(more);
      }
    }

    const controls = el("div.panel", { style: "margin-bottom:10px" });
    const addBtn = el("button.btn.primary", { type: "button", text: "+ Add Soldier", style: "margin-right:6px" });
    addBtn.addEventListener("click", async function () {
      roster.push({ rank: "", name: "", mos: "", counseled: "", aft: "", wpn: "", ncoer: "" });
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

    // Simple text filter for the full roster below - not needed at a
    // handful of entries, but a unit tracking a large number of Soldiers
    // had no way to jump to one without scrolling a list as long as the
    // page itself. Filters by rank or initials substring.
    const filterRow = el("div", { style: "margin-top:8px" });
    const filterInp = el("input.ob-input", { type: "search", placeholder: "Filter by rank or initials…",
      "aria-label": "Filter roster by rank or initials" });
    let filterDeb;
    filterInp.addEventListener("input", function () {
      filterTerm = filterInp.value;
      listExpanded = false; // a new search starts capped again, same as a fresh visit to this view
      clearTimeout(filterDeb);
      filterDeb = setTimeout(buildList, 120);
    });
    filterRow.appendChild(filterInp);
    controls.appendChild(filterRow);

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
