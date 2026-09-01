/* ==== js/records.js ==== */
/* GUIDON - records.js : records readiness before a board (G.records)

   The premise of this section, stated plainly because it is the whole point:
   most Soldiers do not lose promotion points because they do not know doctrine.
   They lose them because a DA 1059 never reached iPERMS, an award was never
   keyed, a primary weapon was never assigned in DTMS, or a correction was made
   three days after the cutoff.

   AR 600-8-19 (6 Mar 2026) para 3-14 is blunt about where that responsibility
   sits: promotion points are calculated automatically from the HR system of
   record, every Soldier has been given access to their own data, and "there
   will be no consideration given to correct scores outside of the promotion
   cycle based on missing or incomplete information." A correction keyed after
   the cutoff moves your score for the FOLLOWING month, not this one.

   So this is a checklist with a clock attached, not a reading list.
*/
window.G = window.G || {};
(function () {
  "use strict";
  const util = G.util, el = util.el;

  const KEY = "guidon:records:checks:v1";

  // Promotion month cut-off: BLC/ALC graduation must be a matter of record by
  // the 26th calendar day of the board month (AR 600-8-19 para 3-17a) - the
  // same date "The clock" group below warns about and calendar.js's own
  // fixedAnchors() computes. Duplicated rather than read off G.calendar:
  // four lines, and this module has no business depending on calendar.js's
  // internal shape (or its load order) just to get one date.
  function nextCutoff() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let cut = new Date(today.getFullYear(), today.getMonth(), 26);
    if (cut.getTime() < today.getTime()) cut = new Date(today.getFullYear(), today.getMonth() + 1, 26);
    return cut;
  }
  function fmt(d) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  // "YYYY-MM-DD" in LOCAL time for G.reminders.add() - not d.toISOString(),
  // which converts to UTC first and can silently roll the date a day either
  // direction depending on the Soldier's timezone.
  function isoLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* Grouped because the fix path differs per group - different system, different
     office, different lead time. Ordered by how often each one actually bites. */
  const GROUPS = [
    { title: "iPERMS - the source documents",
      why: "Nothing can be keyed into IPPS-A until the supporting document exists in iPERMS. This is the upstream failure, and it is the most common one.",
      items: [
        "Every DA Form 1059 (course completion) I hold is in iPERMS",
        "Every award certificate and citation I hold is in iPERMS",
        "Every NCOER is present, and none are missing from a rating period",
        "My documents are full PDF scans - not photographs, which are rejected",
        "I have run the Record Review Tool and cleared or noted every item it flagged" ] },

    { title: "IPPS-A - what the board actually sees",
      why: "The promotion point worksheet is generated from this. If it is wrong here, it is wrong at the board.",
      items: [
        "My promotion point worksheet totals match what I can evidence",
        "My awards in IPPS-A match the certificates I actually hold",
        "My civilian education transcripts are on file and reflected",
        "My ERB and my DA Form 2-1 do not contradict each other",
        "No critical data element on my record is blank" ] },

    { title: "ATRRS and DTMS - the feeder systems",
      why: "IPPS-A only displays what these feed it. Fixing IPPS-A without fixing the source means it reverts.",
      items: [
        "Every completed course shows a graduate entry in ATRRS",
        "My correspondence hours are complete courses, not part-finished sub-courses",
        "My primary weapon is assigned to me in DTMS",
        "That assignment was in place at least one day BEFORE my qualification date",
        "My weapons qualification is inside 24 months" ] },

    { title: "The clock",
      why: "AR 600-8-19 para 3-14: corrections made after the cutoff apply to the next promotion month, not this one. This is the part that turns a paperwork problem into a lost cycle.",
      items: [
        "I know my board month and the cutoff date that goes with it",
        "Anything I submitted to S-1 has been followed up on, not just handed over",
        "BLC/ALC graduation is a matter of record by the 26th calendar day of the board month",
        "I have re-checked my worksheet AFTER submitting corrections, not just before" ] },

    { title: "The board file itself",
      why: "Presentation is scored by people. These are cheap points to keep.",
      items: [
        "My board letter is correctly formatted and free of grammatical errors",
        "My photograph, if my board requires one, is current and correct",
        "I have no flags",
        "I have physically read my own record end to end, recently" ] },

    // Board Packet Checklist (new feature): sourced from real Battalion board
    // MOIs, which uniformly require ALL of the items below to be SUBMITTED
    // ahead of the board, on top of whatever is already on file - a
    // biography, a Soldier Talent Profile dated within 30 days, a printed
    // head-to-toe photo in ASU, a 5-to-7-page essay on direct, organizational,
    // and strategic leadership (ADP 6-22) in APA format (3-5 pages of content
    // plus cover/reference pages), a current AFT scorecard plus DA Form
    // 5500/5501 where applicable, the primary-weapon qualification score
    // sheet, and (for NCOs) the last three NCOERs where available. Packets
    // that are late or incomplete get returned without action - the same
    // "the clock is working against you" stakes as the group above, which is
    // why this gets its own group rather than folding into "The board file
    // itself": that group is about what's already on file being presentable,
    // this one is about assembling and submitting a distinct packet by a
    // deadline. Item text is deliberately unit-agnostic - no battalion name,
    // no MOI-specific numbering - so it stays correct across different
    // units' actual MOIs, which vary in the specifics but not in requiring
    // these documents. Appended as a NEW group at the END of GROUPS (not
    // inserted between existing ones) so every earlier group keeps its
    // index - and therefore every Soldier's already-saved
    // "rec-<groupIndex>-<itemIndex>" checkmark keeps pointing at the same
    // item it always did (see the VALID_IDS positional-id comment above).
    { title: "The board packet",
      why: "This is a distinct submission with its own deadline, ahead of the board itself - not something you bring with you. A packet that's late or missing an item is returned without action, so this has to be done early, not the week of.",
      items: [
        "My Soldier/NCO biography is written and ready to submit",
        "My Soldier Talent Profile is dated within 30 days of my board",
        "My printed photo is a full head-to-toe shot in ASU, not a headshot",
        "My leadership essay (direct, organizational, and strategic, per ADP 6-22) is 5-7 pages in APA format - 3-5 pages of content plus cover and reference pages",
        "My current AFT scorecard is in the packet, with DA Form 5500/5501 attached if I'm on a body-composition program",
        "The most recent qualification score sheet for my primary weapon is in the packet",
        "If I'm an NCO, my last three NCOERs are copied into the packet where available" ] }
  ];

  const TOTAL = GROUPS.reduce(function (n, g) { return n + g.items.length; }, 0);
  // Every id this exact GROUPS shape can produce, right now. Persisted
  // checks are keyed positionally ("rec-"+groupIndex+"-"+itemIndex), so a
  // future reorder/resize of GROUPS would otherwise leave stale IndexedDB
  // keys that either silently apply an old checkmark to a now-different
  // item, or inflate the "done" count past TOTAL with no clamp - the exact
  // "persist without validating against the current shape" class of bug
  // this app's own backup-import path was hardened against elsewhere.
  const VALID_IDS = (function () {
    const s = {};
    GROUPS.forEach(function (g, gi) { g.items.forEach(function (_, ii) { s["rec-" + gi + "-" + ii] = true; }); });
    return s;
  })();

  async function render(mount) {
    util.clear(mount);
    mount.appendChild(el("div.section-title", {}, [
      el("h2", { text: "Records Readiness" }), el("div.rule") ]));

    mount.appendChild(el("p.hint", { text:
      "Doctrine gets you through the board. Your record gets you to it. This is the pre-board audit - " + TOTAL +
      " checks across the systems that actually generate your promotion points." }));

    let saved = {};
    try {
      const r = await G.db.get("kv", KEY);
      const v = r && r.v;
      saved = (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
    } catch (e) { /* offline-safe */ }

    const warn = el("div.panel", { style: "margin:10px 0;border-left:3px solid var(--red)" });
    warn.appendChild(el("div.eyebrow", { text: "The rule that costs people a cycle" }));
    warn.appendChild(el("p", { text:
      "Promotion points are calculated automatically from your records for a specific promotion month. A correction keyed after that month's cutoff does not retroactively fix your score - it moves the following month's. Fix the record early, then verify it, then verify it again after the change has had time to propagate." }));
    warn.appendChild(el("div.hint", { text: "AR 600-8-19 (6 March 2026), paragraph 3-14." }));
    mount.appendChild(warn);

    const prog = el("div.panel", { style: "margin-bottom:10px" });
    prog.appendChild(el("div.eyebrow", { text: "Progress" }));
    // Roadmap audit round 4, "Accessibility: missing accessible names, live
    // regions, and toggle state" bucket: progText/fill below get rewritten
    // by every single checkbox toggle in the four groups (refresh() runs on
    // every "change" listener a few lines down), but neither carried any
    // live-region wiring - a screen-reader user checking items off heard
    // nothing update after the initial page load, so the "N of TOTAL
    // confirmed" count and the fill bar were both silent. role="status"
    // aria-live="polite" on progText announces each new count; role=
    // "progressbar" + aria-valuenow/min/max on the track (kept in sync
    // inside refresh() below) exposes the same fraction to AT that already
    // gets it visually from the fill width.
    const progText = el("div.ob-plan-cat", { text: "", role: "status", "aria-live": "polite" });
    const bar = el("div", { style: "height:8px;border-radius:4px;background:var(--panel-2);margin-top:6px;overflow:hidden", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(TOTAL), "aria-valuenow": "0" });
    const fill = el("div", { style: "height:100%;width:0%;background:var(--amber);transition:width .2s" });
    bar.appendChild(fill);
    prog.appendChild(progText); prog.appendChild(bar);
    mount.appendChild(prog);

    function refresh() {
      var done = 0;
      // Only count keys that still name a real checklist item today - a
      // stale key from a prior GROUPS shape (orphaned by a reorder/resize)
      // is silently ignored here rather than misapplied or counted.
      Object.keys(saved).forEach(function (k) { if (VALID_IDS[k] && saved[k]) done++; });
      done = Math.min(done, TOTAL);
      progText.textContent = done + " of " + TOTAL + " confirmed";
      fill.style.width = (TOTAL ? Math.min(100, Math.round((done / TOTAL) * 100)) : 0) + "%";
      bar.setAttribute("aria-valuenow", String(done));
    }

    async function persist() {
      try { await G.db.put("kv", { k: KEY, v: saved }); } catch (e) { /* offline-safe */ }
    }

    // .panel-grid-2 (>=600px, see index.html) lays the 4 groups out 2-across
    // on a Fold5/tablet-class screen instead of forcing one long single-
    // column scroll - purely a container change, nothing below cares which
    // parent its panel ends up in.
    const groupGrid = el("div.panel-grid-2");
    GROUPS.forEach(function (grp, gi) {
      const p = el("div.panel", { style: "margin-bottom:10px" });
      p.appendChild(el("div.eyebrow", { text: grp.title }));
      p.appendChild(el("p.hint", { style: "margin-bottom:6px", text: grp.why }));
      grp.items.forEach(function (label, ii) {
        const id = "rec-" + gi + "-" + ii;
        const row = el("div", { style: "display:flex;gap:8px;align-items:flex-start;margin-top:6px" });
        const box = el("input", { type: "checkbox", id: id, "aria-label": label });
        box.checked = !!saved[id];
        box.addEventListener("change", function () {
          saved[id] = box.checked; refresh(); persist();
        });
        const lab = el("label", { "for": id, text: label, style: "cursor:pointer" });
        row.appendChild(box); row.appendChild(lab);
        p.appendChild(row);
      });
      groupGrid.appendChild(p);
    });
    mount.appendChild(groupGrid);

    // Audit finding (ux-consistency): "The clock" group above states the one
    // checklist item this page can't just let a Soldier tick off from memory
    // - "I know my board month and the cutoff date that goes with it" still
    // requires independently remembering that date. Reuses the exact
    // G.reminders.add() + G.notify.scheduleForReminder() one-click pattern
    // this build already ships in three other places (Calendar's per-row
    // "Remind me", and the two Money-tab quick-adds), and Reminders' own
    // existing "promopoints" kind ("Recompute promo points... against the
    // current cutoff") - a pre-existing, exact semantic match, not a new one.
    if (G.reminders && G.reminders.add) {
      const cutoff = nextCutoff();
      const rem = el("div.panel", { style: "margin-bottom:10px;border-left:3px solid var(--amber)" });
      rem.appendChild(el("div.eyebrow", { text: "Remind me before the cutoff" }));
      rem.appendChild(el("p.hint", { text:
        "Your next promotion month cut-off is " + fmt(cutoff) + " — anything that has to count for that month must be a matter of record by then, not after." }));
      const rb = el("button.btn.sm.ghost", { type: "button", text: "Remind me" });
      rb.addEventListener("click", async function () {
        const updated = await G.reminders.add({ kind: "promopoints", label: "Records Readiness cutoff", date: isoLocal(cutoff) });
        if (!updated) { try { util.toast && util.toast("You've reached the " + G.reminders.MAX + "-reminder limit — remove an old one first."); } catch (e) {} return; }
        try { if (G.notify) await G.notify.scheduleForReminder(updated[updated.length - 1]); } catch (e) {}
        try { if (util.announce) util.announce("Reminder set for " + fmt(cutoff) + "."); } catch (e) {}
        rb.disabled = true;
        rb.textContent = "Reminder set";
      });
      rem.appendChild(rb);
      mount.appendChild(rem);
    }

    const next = el("div.panel");
    next.appendChild(el("div.eyebrow", { text: "When something is wrong" }));
    next.appendChild(el("p.hint", { text:
      "Channels tells you which door to knock on for each of these - S-1, ATRRS, or a CRM case - and roughly how long each takes to propagate." }));
    const goCh = el("button.btn.sm", { type: "button", text: "Open Channels", style: "margin-right:6px" });
    goCh.addEventListener("click", function () { location.hash = "#/channels"; });
    const goPts = el("button.btn.sm", { type: "button", text: "Open the PPW" });
    goPts.addEventListener("click", function () { location.hash = "#/board"; });
    next.appendChild(goCh); next.appendChild(goPts);
    mount.appendChild(next);

    refresh();
  }

  // VALID_IDS exposed (previously private) so Home's "My readiness"
  // dashboard strip can tell a real checked item apart from a stale kv
  // key using this module's OWN validity rule, rather than re-deriving
  // the "rec-"+groupIndex+"-"+itemIndex id scheme a second time and
  // risking the two silently disagreeing after a future GROUPS edit -
  // see the "PME/Records readiness -> dashboard" bucket comment in
  // views.home's own tiles block.
  G.records = { render: render, GROUPS: GROUPS, TOTAL: TOTAL, KEY: KEY, VALID_IDS: VALID_IDS };
})();
// END records.js
