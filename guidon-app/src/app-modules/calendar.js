/* ==== js/calendar.js ==== */
/* GUIDON - calendar.js : the dated spine of a career (G.calendar)

   Everything else in this app answers "what is true". This answers "what is
   about to expire". Those are different failure modes: a Soldier who knows the
   doctrine cold still loses 160 promotion points if their weapons qualification
   quietly passed 24 months, because AR 600-8-19 para 3-15a(2) awards nothing
   for a qualification older than that.

   Deliberately built on dates the Soldier enters rather than a feed. There is
   no network, and there is not going to be one - so the honest design is to
   make the arithmetic and the consequence obvious, not to pretend we know when
   their last AFT was.

   Board date and ETS are read from the profile when set, so the one date the
   app already knows is not asked for twice.
*/
window.G = window.G || {};
(function () {
  "use strict";
  const util = G.util, el = util.el;

  const KEY = "guidon:calendar:v1";
  const DAY = 86400000;

  /* Each entry states the consequence, because a date with no consequence
     attached is just a reminder, and reminders get ignored. */
  const TRACKED = [
    { key: "wpnQual", label: "Last weapons qualification", months: 24,
      consequence: "A qualification older than 24 months earns ZERO promotion points. This is the single most expensive date on this page.",
      link: "#/board" },
    { key: "aft", label: "Last record AFT", months: 12,
      consequence: "Your AFT feeds up to 120 promotion points and is a gate. Points come from the LAST record test, even if an older one was better.",
      link: "#/fitness" },
    { key: "cft", label: "Last Combat Field Test", months: 12,
      consequence: "Combat-MOS Soldiers pass one AFT and one CFT annually. For record from roughly April 2027; a failure after that can bring a Flag.",
      link: "#/fitness" },
    { key: "ncoer", label: "Last NCOER thru-date", months: 12,
      consequence: "A missing or late evaluation is a gap in the record a board will see. Chase it before the rating period closes, not after.",
      link: "#/records" },
    { key: "acftProfile", label: "Physical profile expires", months: 0,
      consequence: "A temporary profile that lapses without a retest can remove you from the recommended list.",
      link: "#/fitness" },
    { key: "tos", label: "Arrived at current duty station", months: 0,
      consequence: "Time on station is one of the factors that makes you a mover in the Enlisted Marketplace.",
      link: "#/assignments" },
    { key: "ets", label: "ETS date", months: 0, future: true,
      consequence: "The BDD window for a VA claim is 180 to 90 days before separation. Miss it and you file after, which takes longer.",
      link: "#/transition" },
  ];

  function parseDate(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  function addMonths(d, n) {
    const x = new Date(d.getTime());
    x.setMonth(x.getMonth() + n);
    return x;
  }
  function todayMidnight() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / DAY); }
  function fmt(d) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  /** red under 14 days, amber under 45, otherwise calm. */
  function urgency(days) {
    if (days < 0) return { c: "var(--red)", word: "OVERDUE" };
    if (days <= 14) return { c: "var(--red)", word: days + " days" };
    if (days <= 45) return { c: "var(--amber)", word: days + " days" };
    return { c: "var(--green)", word: days + " days" };
  }

  /* Fixed recurring anchors nobody sets, and everybody forgets. */
  function fixedAnchors(today) {
    const out = [];
    // Promotion month cut-off: BLC/ALC graduation must be a matter of record by
    // the 26th calendar day of the board month (AR 600-8-19 para 3-17a).
    let cut = new Date(today.getFullYear(), today.getMonth(), 26);
    if (daysBetween(today, cut) < 0) cut = new Date(today.getFullYear(), today.getMonth() + 1, 26);
    out.push({ label: "Promotion month cut-off (26th)", when: cut,
      note: "Anything that has to count for next month's score must be in the system of record by this date. A correction keyed after it moves the FOLLOWING month." });

    // Credentialing Assistance is per fiscal year, which restarts 1 October.
    let fy = new Date(today.getFullYear(), 9, 1);
    if (daysBetween(today, fy) < 0) fy = new Date(today.getFullYear() + 1, 9, 1);
    out.push({ label: "Credentialing Assistance resets (1 Oct)", when: fy,
      note: "$2,000 per fiscal year, and it does not roll over. Unspent is lost." });
    return out;
  }

  async function render(mount) {
    util.clear(mount);
    mount.appendChild(el("div.section-title", {}, [
      el("h2", { text: "Career Calendar" }), el("div.rule") ]));
    mount.appendChild(el("p.hint", { text:
      "The dates that cost you something when they lapse. Enter what you know - everything is stored on this device only, and nothing is fetched." }));

    let saved = {};
    try { const r = await G.db.get("kv", KEY); saved = (r && r.v) || {}; } catch (e) { /* offline-safe */ }

    const today = todayMidnight();
    const upcoming = el("div.panel", { style: "margin-bottom:10px" });
    const inputs = el("div.panel", { style: "margin-bottom:10px" });

    async function persist() {
      try { await G.db.put("kv", { k: KEY, v: saved }); } catch (e) { /* offline-safe */ }
    }

    function buildUpcoming() {
      util.clear(upcoming);
      upcoming.appendChild(el("div.eyebrow", { text: "What is next" }));

      const rows = [];

      TRACKED.forEach(function (t) {
        const d = parseDate(saved[t.key]);
        if (!d) return;
        // A "future" date (ETS) is the event itself; everything else is a LAST
        // date from which the next due date is derived.
        const due = t.future || !t.months ? d : addMonths(d, t.months);
        if (!t.future && !t.months) return;      // reference-only, no due date
        rows.push({ label: t.label.replace(/^Last /, "").replace(/^Arrived at /, ""),
                    when: due, days: daysBetween(today, due),
                    note: t.consequence, link: t.link });
      });

      fixedAnchors(today).forEach(function (a) {
        rows.push({ label: a.label, when: a.when, days: daysBetween(today, a.when), note: a.note, link: null });
      });

      // Board date comes from the profile rather than being asked for again.
      try {
        const prof = (G.profile && G.profile.cached) ? G.profile.cached() : null;
        const bd = prof && parseDate(prof.boardDate);
        if (bd) rows.push({ label: "Promotion board", when: bd, days: daysBetween(today, bd),
          note: "Your Records Readiness checks should be complete well before this, not the week of.", link: "#/records" });
      } catch (e) { /* profile is optional */ }

      if (!rows.length) {
        upcoming.appendChild(el("p.hint", { text:
          "Nothing tracked yet. Fill in any date below and it will appear here, sorted by how soon it bites." }));
        return;
      }

      rows.sort(function (a, b) { return a.days - b.days; });
      rows.forEach(function (r) {
        const u = urgency(r.days);
        const card = el("div.card", { style: "margin-top:8px;border-left:3px solid " + u.c });
        const head = el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap" });
        head.appendChild(el("span.k", { text: r.label }));
        head.appendChild(el("span.v", { text: u.word }));
        card.appendChild(head);
        card.appendChild(el("div.hint", { text: fmt(r.when) + " — " + r.note }));
        if (r.link) {
          const b = el("button.btn.sm.ghost", { type: "button", text: "Open", style: "margin-top:6px" });
          b.addEventListener("click", function () { location.hash = r.link; });
          card.appendChild(b);
        }
        upcoming.appendChild(card);
      });
    }

    function buildInputs() {
      util.clear(inputs);
      inputs.appendChild(el("div.eyebrow", { text: "Your dates" }));
      TRACKED.forEach(function (t) {
        const c = el("div.card", { style: "margin-bottom:8px" });
        c.appendChild(el("div.k", { text: t.label + (t.months ? "  (valid " + t.months + " months)" : "") }));
        const inp = el("input.ob-input", { type: "date", value: saved[t.key] || "",
          "aria-label": t.label, style: "width:100%;margin-top:4px" });
        inp.addEventListener("change", function () {
          saved[t.key] = inp.value; persist(); buildUpcoming();
        });
        c.appendChild(inp);
        c.appendChild(el("p.hint", { style: "margin-top:6px", text: t.consequence }));
        inputs.appendChild(c);
      });
    }

    mount.appendChild(upcoming);
    mount.appendChild(inputs);
    buildUpcoming();
    buildInputs();

    const foot = el("div.panel");
    foot.appendChild(el("div.eyebrow", { text: "What this is not" }));
    foot.appendChild(el("p.hint", { text:
      "It is not connected to IPPS-A, ATIS or DTMS, and it cannot be. Nothing here is authoritative - it is your own copy of dates you should already know, doing the arithmetic for you. If a date here disagrees with the system of record, the system of record wins and you have a records problem to fix." }));
    const b = el("button.btn.sm", { type: "button", text: "Records Readiness" });
    b.addEventListener("click", function () { location.hash = "#/records"; });
    foot.appendChild(b);
    mount.appendChild(foot);
  }

  G.calendar = { render: render, TRACKED: TRACKED, KEY: KEY };
})();
// END calendar.js
