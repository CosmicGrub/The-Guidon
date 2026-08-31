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
    // future:true - this is the expiration date itself (like ETS below used
    // to be), not a "last done" date to add months to. Without it, the
    // generic "reference-only, no due date" guard a few lines down in
    // buildUpcoming() silently dropped this row from "What is next" even
    // after `due` had already been computed correctly - a Soldier could
    // fill this in, watch it persist, and it would just never show up in
    // the one panel the whole page exists to provide.
    { key: "acftProfile", label: "Physical profile expires", months: 0, future: true,
      consequence: "A temporary profile that lapses without a retest can remove you from the recommended list.",
      link: "#/fitness" },
    { key: "tos", label: "Arrived at current duty station", months: 0,
      consequence: "Time on station is one of the factors that makes you a mover in the Enlisted Marketplace.",
      link: "#/assignments" },
  ];
  // ETS is handled like board date below (read from the profile/settings,
  // not asked for a second time here) - it used to be a TRACKED entry with
  // its own input, which contradicted this module's own header comment and
  // let it silently drift out of sync with the ETS date Home/Transition
  // actually use. ETS_CONSEQUENCE/ETS_LINK are kept as named constants so
  // the copy lives in one place, not duplicated between the two blocks that
  // now reference it (the profile-sourced row below, and the legacy-data
  // fallback path for anyone who already saved one directly in Calendar
  // before this fix, whose input is intentionally NOT re-added here).
  const ETS_CONSEQUENCE = "The BDD window for a VA claim is 180 to 90 days before separation. Miss it and you file after, which takes longer.";
  const ETS_LINK = "#/transition";

  // Shared with leader.js as util.parseISODate() - see its definition in
  // src/index.html for why this delegates rather than building the Date
  // itself (the multi-argument Date constructor this used to use directly
  // triggers JS's legacy 2-digit-year rule for year values 0-99).
  function parseDate(s) { return util.parseISODate(s); }
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
  // Enhancement backlog round 4, "'Arrived at current duty station' date is
  // collected but never used" bucket: whole completed calendar months
  // between two LOCAL midnight Dates (a before b). Calendar-month, not
  // days/30 - matches how "time on station" is actually talked about
  // (whole months), and stays exact regardless of how many 28/30/31-day
  // months fall in the range. Decrements when b's day-of-month hasn't yet
  // reached a's, same logic every "how many months since X" calculator
  // uses (e.g. someone who arrived on the 20th isn't credited a new whole
  // month until the 20th comes around again).
  function monthsBetween(a, b) {
    let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) months--;
    return Math.max(0, months);
  }
  function fmt(d) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  // Formats a local Date as "YYYY-MM-DD" for G.reminders.add()'s date field
  // (and every <input type=date>.value on this page). NOT d.toISOString() -
  // every `when` this module hands to this function was built from a local
  // midnight Date (parseDate()/addMonths(), or `new Date(y,m,d)` in
  // fixedAnchors()), and toISOString() converts to UTC first, which can
  // silently roll the date a day in either direction depending on the
  // Soldier's timezone - the exact "ms subtraction between two LOCAL dates"
  // bug class this file's daysBetween() comment above already warns about.
  function isoLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /** red under 14 days, amber under 45, otherwise calm. Used for every date
      on this page EXCEPT board date and ETS, which have their own shared
      colour scale (util.boardUrgency / util.etsUrgency) that Home, Transition
      and Board Prep's own countdown banners also use - this generic scale
      used to apply to those two as well, which meant the same boardDate/
      etsDate could show a contradicting colour depending which screen you
      were looking at, even after the underlying VALUE was already fixed to
      come from the same profile field. */
  function urgency(days) {
    // Colour now sourced from util.genericUrgency() (pulled out to util for
    // reminders.js's own urgency-convergence fix - see its comment there)
    // rather than re-deriving the same 14/45 cutoffs locally - identical
    // numbers to before, so every non-board/ETS row on this page renders
    // exactly as it always did. Only the WORD differs for a negative day
    // count, same as sharedUrgency() just below handles it for board/ETS.
    return { c: util.genericUrgency(days).color, word: days < 0 ? "OVERDUE" : days + " days" };
  }
  function sharedUrgency(days, fn) {
    // Negative days (overdue) still resolves correctly through fn's own
    // <= thresholds without special-casing - a negative number is <= any
    // positive cutoff, so it always lands on "red" the same way util.
    // etsUrgency/util.boardUrgency already treat a passed date elsewhere.
    return { c: fn(days).color, word: days < 0 ? "OVERDUE" : days + " days" };
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
    // Roadmap audit round 4, "Accessibility: missing accessible names, live
    // regions, and toggle state" bucket: buildUpcoming() below fully clears
    // and rebuilds this panel (util.clear(upcoming)) on every date edit in
    // "Your dates", including flipping a row's urgency word to "OVERDUE" -
    // with no live-region wiring a screen-reader user who just entered a
    // date heard nothing about "What is next" changing at all. role="status"
    // aria-live="polite" here announces the rebuilt card list, same pattern
    // as leader.js's summary panel below.
    const upcoming = el("div.panel", { style: "margin-bottom:10px", role: "status", "aria-live": "polite" });
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
        // Reuses Reminders' own existing "weapons"/"acft" kinds (its editor's
        // dropdown, KINDS in reminders.js) where one genuinely matches this
        // row; G.reminders.add() already falls back to "other" for anything
        // else, so there is no need to invent a new kind per TRACKED entry.
        const remKind = t.key === "wpnQual" ? "weapons" : t.key === "aft" ? "acft" : "other";
        rows.push({ label: t.label.replace(/^Last /, "").replace(/^Arrived at /, ""),
                    when: due, days: daysBetween(today, due),
                    note: t.consequence, link: t.link, remKind: remKind });
      });

      fixedAnchors(today).forEach(function (a) {
        rows.push({ label: a.label, when: a.when, days: daysBetween(today, a.when), note: a.note, link: null });
      });

      // Board date comes from the profile rather than being asked for again -
      // profile first, then the app-wide settings copy (same precedence
      // renderBoardCountdown itself uses), so a guest/kiosk session (no
      // profile.boardDate) still surfaces a board date that was only ever
      // set via Settings, instead of this row just silently never appearing.
      let prof = null;
      try {
        prof = (G.profile && G.profile.cached) ? G.profile.cached() : null;
        const settings = (G.store && G.store.settings) ? G.store.settings() : {};
        const bd = parseDate((prof && prof.boardDate) || (settings && settings.boardDate));
        if (bd) rows.push({ label: "Promotion board", when: bd, days: daysBetween(today, bd),
          note: "Your Records Readiness checks should be complete well before this, not the week of.", link: "#/records",
          urgencyFn: util.boardUrgency, remKind: "board" });
      } catch (e) { /* profile is optional */ }

      // ETS, same treatment as board date just above (profile first, then
      // the app-wide settings copy the two-way sync keeps in step with it -
      // same precedence board.js's own Readiness panel uses for board
      // date). Previously ETS was a separate TRACKED field asked for again
      // right here, so it could silently disagree with the ETS date Home
      // and Transition's own countdown banners actually use. Falls back to
      // whatever was already saved directly in Calendar before this fix, so
      // existing entries stay visible even with no profile ETS set.
      try {
        const settings = (G.store && G.store.settings) ? G.store.settings() : {};
        const etsRaw = (prof && prof.etsDate) || (settings && settings.etsDate) || saved.ets;
        const ed = parseDate(etsRaw);
        if (ed) rows.push({ label: "ETS date", when: ed, days: daysBetween(today, ed),
          note: ETS_CONSEQUENCE, link: ETS_LINK, urgencyFn: util.etsUrgency });
      } catch (e) { /* profile/settings are optional */ }

      if (!rows.length) {
        upcoming.appendChild(el("p.hint", { text:
          "Nothing tracked yet. Fill in any date below and it will appear here, sorted by how soon it bites." }));
        return;
      }

      rows.sort(function (a, b) { return a.days - b.days; });
      rows.forEach(function (r) {
        const u = r.urgencyFn ? sharedUrgency(r.days, r.urgencyFn) : urgency(r.days);
        const card = el("div.card", { style: "margin-top:8px;border-left:3px solid " + u.c });
        const head = el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:baseline" });
        head.appendChild(el("span.k", { text: r.label, style: "min-width:0;flex:1 1 auto" }));
        head.appendChild(el("span.v", { text: u.word, style: "flex:0 0 auto;white-space:nowrap" }));
        card.appendChild(head);
        card.appendChild(el("div.hint", { text: fmt(r.when) + " — " + r.note }));
        const btnRow = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px" });
        if (r.link) {
          const b = el("button.btn.sm.ghost", { type: "button", text: "Open" });
          b.addEventListener("click", function () { location.hash = r.link; });
          btnRow.appendChild(b);
        }
        // Audit finding (ux-consistency): the two Money-tab quick-adds
        // (salary-negotiation follow-up, USAJOBS closing date) already let a
        // Soldier turn a date into a native reminder in one click - every
        // date on the single screen whose whole purpose is "the dates that
        // cost you something when they lapse" had no such button at all.
        // Unlike those two, this page already computed the date (r.when),
        // so there's nothing to ask for; the reminder fires ON that
        // computed due date - honest with what the app actually knows,
        // rather than guessing a lead time this build has no basis for.
        if (G.reminders && G.reminders.add) {
          const rb = el("button.btn.sm.ghost", { type: "button", text: "Remind me" });
          rb.addEventListener("click", async function () {
            const updated = await G.reminders.add({ kind: r.remKind || "other", label: r.label, date: isoLocal(r.when) });
            if (!updated) { try { util.toast && util.toast("You've reached the " + G.reminders.MAX + "-reminder limit — remove an old one first."); } catch (e) {} return; }
            // Same fix as the Money-tab quick-adds: add() alone never
            // schedules the native notification, syncAll() would only ever
            // catch it on the next cold boot.
            try { if (G.notify) await G.notify.scheduleForReminder(updated[updated.length - 1]); } catch (e) {}
            try { if (util.announce) util.announce("Reminder set for " + fmt(r.when) + "."); } catch (e) {}
            rb.disabled = true;
            rb.textContent = "Reminder set";
          });
          btnRow.appendChild(rb);
        }
        if (btnRow.childNodes.length) card.appendChild(btnRow);
        upcoming.appendChild(card);
      });
    }

    function buildInputs() {
      util.clear(inputs);
      inputs.appendChild(el("div.eyebrow", { text: "Your dates" }));
      // Roadmap Tier 5 width-waste audit: these 6 TRACKED cards used to
      // append straight into `inputs` (a plain block container), so they
      // stacked single-column no matter how wide the "Your dates" side of
      // the calGrid panel-grid-2 split got - a 1360px-wide viewport still
      // rendered each card at its full ~484px column width even though the
      // content (a label, one date input, a couple lines of hint text) is
      // comfortably narrower than that. .cal-dates-grid (see its own CSS
      // comment for why it's a 150px-floor sibling of the shared 260px
      // .card-results-grid utility, not that utility reused directly)
      // auto-fills instead - degrades to the existing single column below
      // that width (matches the 375px mobile layout exactly) and opens up
      // to 2-3 columns once the halved panel is wide enough, with
      // align-items:start so the 6 cards' varying hint-text lengths don't
      // force a shorter card to stretch to match a taller row-mate.
      const cardsGrid = el("div.cal-dates-grid");
      TRACKED.forEach(function (t) {
        const c = el("div.card", { style: "margin-bottom:8px" });
        c.appendChild(el("div.k", { text: t.label + (t.months ? "  (valid " + t.months + " months)" : "") }));
        const inp = el("input.ob-input", { type: "date", value: saved[t.key] || "",
          "aria-label": t.label, style: "width:100%;margin-top:4px" });
        // Enhancement backlog round 4, "'Arrived at current duty station'
        // date is collected but never used" bucket: "tos" has months:0 and
        // no `future` flag, so buildUpcoming()'s own "reference-only, no
        // due date" guard (its comment a few lines up) correctly leaves it
        // out of "What is next" - an open-ended duration like time-on-
        // station has no due date to compute. But that guard was the ONLY
        // place this value was ever read anywhere in the app: once
        // excluded there, the date just sat in storage while this card
        // kept telling the Soldier it "matters." Rather than inventing a
        // threshold or a Marketplace effect this app has no real data for,
        // this shows the one honest, already-computable fact the date
        // actually supports - whole months on station, from simple
        // calendar-month arithmetic against today - right where the date
        // was entered.
        let tosStat = null;
        if (t.key === "tos") {
          tosStat = el("p.hint", { style: "margin-top:6px;font-weight:600" });
          c.appendChild(inp);
          c.appendChild(tosStat);
        } else {
          c.appendChild(inp);
        }
        function refreshTosStat() {
          if (!tosStat) return;
          const arrived = parseDate(saved.tos);
          if (!arrived) { tosStat.textContent = ""; return; }
          const n = monthsBetween(arrived, today);
          tosStat.textContent = "Time on station: " + n + " month" + (n === 1 ? "" : "s") + ".";
        }
        refreshTosStat();
        inp.addEventListener("change", function () {
          saved[t.key] = inp.value; persist(); buildUpcoming(); refreshTosStat();
        });
        c.appendChild(el("p.hint", { style: "margin-top:6px", text: t.consequence }));
        cardsGrid.appendChild(c);
      });
      inputs.appendChild(cardsGrid);
    }

    // Roadmap Tier 8: a real career timeline - "now" plus the two genuine
    // career-shaping dates this app actually tracks (board date, ETS),
    // drawn as a vertical stepper rather than another sorted card list
    // ("What is next" below already is that). Deliberately does NOT plot
    // a projected next-promotion-eligibility date: that would need an
    // enlistment/grade-entry date this profile has never collected, and
    // the TIS/TIG thresholds that would drive it (Board's own Compare
    // SGT/SSG segment, #/board) exist only as display strings today, not
    // structured numbers - faking a date from neither would be exactly
    // the kind of guess this module's own header comment says it won't
    // make ("make the arithmetic and the consequence obvious, not
    // pretend we know when their last AFT was"). Real anchors only.
    function buildTimeline() {
      util.clear(timeline);
      timeline.appendChild(el("div.eyebrow", { text: "Career timeline" }));

      let prof = null, settings = {};
      try { prof = (G.profile && G.profile.cached) ? G.profile.cached() : null; } catch (e) {}
      try { settings = (G.store && G.store.settings) ? G.store.settings() : {}; } catch (e) {}
      const rank = (prof && (prof.rank || prof.tier)) || "";

      const points = [{ label: rank ? "Now — " + rank : "Now", when: today, isNow: true }];
      const bd = parseDate((prof && prof.boardDate) || settings.boardDate);
      if (bd) points.push({ label: "Promotion board", when: bd, link: "#/records" });
      const etsRaw = (prof && prof.etsDate) || settings.etsDate || saved.ets;
      const ed = parseDate(etsRaw);
      if (ed) points.push({ label: "ETS", when: ed, link: "#/transition" });
      points.sort(function (a, b) { return a.when.getTime() - b.when.getTime(); });

      const track = el("div.cal-timeline");
      points.forEach(function (p, i) {
        const days = daysBetween(today, p.when);
        const row = el("div.cal-timeline-row" + (p.isNow ? ".cal-timeline-now" : ""));
        row.appendChild(el("div.cal-timeline-dot"));
        const body = el("div.cal-timeline-body");
        body.appendChild(el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:baseline" }, [
          el("span.k", { text: p.label }),
          el("span.hint", { text: p.isNow ? fmt(p.when) : fmt(p.when) + " · " + (days < 0 ? "OVERDUE" : days + "d") }),
        ]));
        if (p.link && !p.isNow) {
          const b = el("button.btn.sm.ghost", { type: "button", text: "Open", style: "margin-top:4px" });
          b.addEventListener("click", function () { location.hash = p.link; });
          body.appendChild(b);
        }
        row.appendChild(body);
        track.appendChild(row);
        if (i < points.length - 1) track.appendChild(el("div.cal-timeline-line"));
      });
      timeline.appendChild(track);

      if (points.length === 1) {
        timeline.appendChild(el("p.hint", { style: "margin-top:8px", text:
          "Add a board date and/or ETS date below (or in Settings) to see them plotted here." }));
      }
      timeline.appendChild(el("p.hint", { style: "margin-top:8px", text:
        "Real dates only — this does not project a next-promotion-eligibility date, because that needs an enlistment date this app doesn't collect and TIS/TIG math it doesn't yet compute. See #/board's Compare SGT/SSG for the real threshold figures to do that math yourself." }));
    }

    // Fold5/tablet fidelity wave 2: "What is next" (read-only, sorted by
    // urgency) and "Your dates" (the editor that feeds it) used to stack in
    // a single column regardless of viewport, even though they're a
    // classic summary/editor pair - .panel-grid-2 (>=600px) sits them
    // side by side instead.
    const timeline = el("div.panel", { style: "margin-bottom:10px" });
    mount.appendChild(timeline);
    const calGrid = el("div.panel-grid-2");
    calGrid.appendChild(upcoming);
    calGrid.appendChild(inputs);
    mount.appendChild(calGrid);
    buildTimeline();
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
