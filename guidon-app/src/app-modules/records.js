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
        "I have physically read my own record end to end, recently" ] }
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
    try { const r = await G.db.get("kv", KEY); saved = (r && r.v) || {}; } catch (e) { /* offline-safe */ }

    const warn = el("div.panel", { style: "margin:10px 0;border-left:3px solid var(--red)" });
    warn.appendChild(el("div.eyebrow", { text: "The rule that costs people a cycle" }));
    warn.appendChild(el("p", { text:
      "Promotion points are calculated automatically from your records for a specific promotion month. A correction keyed after that month's cutoff does not retroactively fix your score - it moves the following month's. Fix the record early, then verify it, then verify it again after the change has had time to propagate." }));
    warn.appendChild(el("div.hint", { text: "AR 600-8-19 (6 March 2026), paragraph 3-14." }));
    mount.appendChild(warn);

    const prog = el("div.panel", { style: "margin-bottom:10px" });
    prog.appendChild(el("div.eyebrow", { text: "Progress" }));
    const progText = el("div.ob-plan-cat", { text: "" });
    const bar = el("div", { style: "height:8px;border-radius:4px;background:var(--panel-2);margin-top:6px;overflow:hidden" });
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
    }

    async function persist() {
      try { await G.db.put("kv", { k: KEY, v: saved }); } catch (e) { /* offline-safe */ }
    }

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
      mount.appendChild(p);
    });

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

  G.records = { render: render, GROUPS: GROUPS, TOTAL: TOTAL, KEY: KEY };
})();
// END records.js
