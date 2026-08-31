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
    // tabindex:-1: programmatically focusable (not in the Tab order) so the
    // roster-Remove focus-restore fallback below has somewhere real to
    // land when the last visible entry is removed - matching reminders.js's
    // own listMount, the reference implementation this fix follows.
    const list = el("div", { tabindex: "-1" });
    // List-detail left pane (Fold5/tablet fidelity wave 1): a real roster
    // list at >=1024px (.list-detail, see index.html) that jumps to and
    // highlights a Soldier's existing edit card rather than replacing the
    // "all cards" view with a single-selection one - a leader scanning a
    // real roster still sees every Soldier's data at a glance, they just no
    // longer have to scroll to find the one they came here for, and this
    // needed zero changes to persist()/buildSummary()/the data model itself.
    const rosterList = el("div.list-detail-list", { role: "listbox", "aria-label": "Jump to Soldier" });
    function jumpToSoldier(idx) {
      if (listExpanded === false) {
        const stillCapped = !Array.from(list.querySelectorAll("[data-roster-idx]"))
          .some(function (n) { return Number(n.getAttribute("data-roster-idx")) === idx; });
        if (stillCapped) { listExpanded = true; buildList(); }
      }
      const card = list.querySelector('[data-roster-idx="' + idx + '"]');
      if (!card) return;
      let reduceMotion = false;
      try { reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
      card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      card.classList.add("list-detail-jumped");
      setTimeout(function () { card.classList.remove("list-detail-jumped"); }, 1600);
      const first = card.querySelector("input");
      if (first) first.focus({ preventScroll: true });
    }

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
    // Roadmap Tier 5 (width-utilization audit, "(latent)" - only visible
    // once a roster is actually populated): every Soldier card used to be
    // appended straight to `list`, one full-width row after another, on
    // every viewport including a 1500px desktop. `cardsGrid` reuses the
    // same .card-results-grid utility career.js's NCOES ladder and half a
    // dozen other routes already share (see that class's own comment in
    // the CSS) rather than inventing a leader.js-specific grid - auto-fill/
    // minmax(260px,1fr) needs no media query of its own: it collapses to a
    // single column below ~530px of available width on its own (measured:
    // 375px viewport unchanged, still one column) and opens to 2-3 up once
    // the roster's own panel actually has the room (measured: 2-up at
    // 768-1023px and 1200-1499px, 3-up at >=1500px; it dips back to one
    // column at 1024-1199px because .list-detail's own >=1024px split
    // narrows this panel to ~464-580px there - real, honest available
    // space, not a bug). The "Show all N (M more)" expander button is
    // appended to `list` itself, OUTSIDE cardsGrid, so it naturally spans
    // full width instead of sitting inside a grid cell sized for a card.
    // A card this narrow (as little as 268px at 3-up) is exactly what made
    // fieldsGrid's own inline grid-template-columns override necessary
    // below - see that override's comment for the real overflow it fixed.
    const cardsGrid = el("div.card-results-grid");
    function buildList() {
      util.clear(list);
      util.clear(rosterList);
      util.clear(cardsGrid);
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
      shown.forEach(function (entry, visiblePos) {
        const sol = entry.sol, idx = entry.idx;
        const worst = overdueFor(sol).filter(function (x) { return x.over !== null; }).sort(function (a, b) { return b.over - a.over; })[0];
        const row = el("button.list-detail-row", { type: "button", role: "option" }, [
          el("span.ldr-name", { text: (sol.rank ? sol.rank + " " : "") + (sol.name || "(unnamed)") }),
          worst ? el("span.ldr-badge", { text: worst.over + "d over" }) : null,
        ]);
        row.addEventListener("click", function () { jumpToSoldier(idx); });
        rosterList.appendChild(row);

        // No margin-bottom here (unlike other .panel usages in this file) -
        // cardsGrid's own .card-results-grid gap:10px now provides the
        // spacing between cards, in both the stacked (narrow-width,
        // one-column) and side-by-side (gridded) cases, so a hand-set
        // margin would just double up on top of the grid gap.
        const card = el("div.panel", { "data-roster-idx": String(idx) });
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

        const del = el("button.btn.sm.ghost", { type: "button", text: "Remove", "aria-label": "Remove roster entry " + (idx + 1), "data-visible-pos": String(visiblePos) });
        del.addEventListener("click", async function () {
          const label = (sol.rank ? sol.rank + " " : "") + (sol.name || "this entry");
          const yes = await G.modal.confirm("Remove " + label + " from the roster?", { okText: "Remove", danger: true });
          if (!yes) return;
          roster.splice(idx, 1); await persist(); buildSummary(); buildList();
          // Deep-gap follow-up ("Screen-Reader Announcements" bucket): same
          // fix reminders.js's own row-remove handler already applies (see
          // its own "redraw() clears and rebuilds every row" comment,
          // index.html) - buildList() rebuilds every card fresh, so the
          // just-clicked Remove button no longer exists and keyboard focus
          // falls through to document.body. Land it on the Remove button
          // now at this same visible position, or the list container if
          // nothing remains.
          const buttons = cardsGrid.querySelectorAll("button[data-visible-pos]");
          const nextBtn = buttons[Math.min(visiblePos, buttons.length - 1)];
          if (nextBtn) nextBtn.focus(); else list.focus();
        });
        head.appendChild(del);
        card.appendChild(head);

        // .panel-grid-2 (>=600px, see index.html) lays the 4 date fields out
        // 2x2 on a Fold5/tablet-class screen instead of 4 full-width rows -
        // roughly halves each card's height once a roster is actually
        // populated, without changing anything about the fields themselves.
        //
        // Roadmap Tier 5 (width-utilization audit) follow-up: .panel-grid-2's
        // own "1fr 1fr" is a fixed 2-column split with no minimum, sized off
        // VIEWPORT width - fine when this card was always the full detail-pane
        // width, but now that cardsGrid (below) can put 2-3 roster cards side
        // by side, a card's OWN width can drop as low as ~268px while the
        // viewport is still >=600px. A native <input type="date"> has a real,
        // unshrinkable min-content width (measured 151px) that "1fr 1fr" does
        // not respect, so at that card width the second date column measurably
        // overflowed the card by 18-63px (real bounding-rect measurement, not
        // a guess). Overriding grid-template-columns inline - while leaving
        // .panel-grid-2's own media-gated `display:grid` (and every OTHER
        // route's plain "1fr 1fr" usage) completely untouched - swaps just
        // this card's 2 date columns for an auto-fit/minmax(150px,1fr) grid:
        // it still shows 2x2 whenever the card is wide enough, but degrades
        // to a single column instead of overflowing when cardsGrid has
        // squeezed this particular card narrower than that.
        const fieldsGrid = el("div.panel-grid-2", { style: "grid-template-columns:repeat(auto-fit,minmax(150px,1fr))" });
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
          fieldsGrid.appendChild(row);
        });
        card.appendChild(fieldsGrid);
        cardsGrid.appendChild(card);
      });
      list.appendChild(cardsGrid);
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

    const rosterDetail = el("div");
    rosterDetail.appendChild(summary);
    rosterDetail.appendChild(controls);
    rosterDetail.appendChild(list);
    mount.appendChild(el("div.list-detail", {}, [rosterList, rosterDetail]));

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
