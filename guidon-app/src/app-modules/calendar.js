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

   ROADMAP 3g "customizable screen layouts", Phase A: this screen now renders
   through a small LAYOUTS registry (see the bottom of this file) instead of
   one hardcoded render() - "classic" is this file's original view, unchanged
   in behavior; "shared-grid" draws the same weekday-grid component PT
   Planner's own shared-grid layout uses (src/app-modules/date-grid.js),
   fed from this module's own tracked dates. Phase B adds further
   screen-specific layouts by pushing another entry onto LAYOUTS - nothing
   else in this file needs to change for that.
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
    // computeRows() silently dropped this row from "What is next" even
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
    // Leap-day regression fix: setMonth() silently OVERFLOWS into the
    // following month when the target month is shorter than d's own
    // day-of-month (e.g. Jan 31 plus 1 month "becomes" Mar 3, not clamped to
    // Feb 28/29). Most visibly wrong for a Feb-29 "last" date plus 12 or 24
    // months landing on a non-leap year: it used to silently slide to Mar 1
    // instead of the intended Feb 28. If the day-of-month changed, the month
    // overflowed - setDate(0) clamps back to the LAST day of the month
    // setMonth() actually landed on one past the intended target, which is
    // exactly the intended month's own last day.
    if (x.getDate() !== d.getDate()) x.setDate(0);
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
  // (and every <input type=date>.value on this page). Promoted to
  // util.localISO (src/index.html, next to util.parseISODate) - this stays a
  // one-line wrapper so every existing call site in this file (isoLocal(...))
  // keeps working unchanged. NOT d.toISOString() - every `when` this module
  // hands to this function was built from a local midnight Date
  // (parseDate()/addMonths(), or `new Date(y,m,d)` in fixedAnchors()), and
  // toISOString() converts to UTC first, which can silently roll the date a
  // day in either direction depending on the Soldier's timezone - the exact
  // "ms subtraction between two LOCAL dates" bug class this file's
  // daysBetween() comment above already warns about.
  function isoLocal(d) { return util.localISO(d); }

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
    // the 26th calendar day of the board month (AR 600-8-19 para 3-17a). Was
    // its own inline copy of this math; now the same util.nextPromotionCutoff
    // (src/index.html, next to util.parseISODate) records.js's nextCutoff()
    // also calls, so the two can never silently drift apart again.
    const cut = util.nextPromotionCutoff(today);
    // remKind:"promopoints" - matches records.js's own identical-date
    // reminder (its "Remind me before the cutoff" panel). Used to default to
    // "other" here (calendar.js never set a remKind on this row at all), so
    // clicking THIS screen's "Remind me" for the same cutoff date created a
    // differently-kinded row than records.js's own button for it.
    out.push({ label: "Promotion month cut-off (26th)", when: cut,
      note: "Anything that has to count for next month's score must be in the system of record by this date. A correction keyed after it moves the FOLLOWING month.",
      remKind: "promopoints" });

    // Credentialing Assistance is per fiscal year, which restarts 1 October.
    let fy = new Date(today.getFullYear(), 9, 1);
    if (daysBetween(today, fy) < 0) fy = new Date(today.getFullYear() + 1, 9, 1);
    out.push({ label: "Credentialing Assistance resets (1 Oct)", when: fy,
      note: "$2,000 per fiscal year, and it does not roll over. Unspent is lost." });
    return out;
  }

  // Board date / ETS date, resolved once through util.resolveBoardDate()/
  // util.resolveETSDate() (src/index.html, next to util.parseISODate) -
  // profile first, then the app-wide Settings copy the two-way sync keeps in
  // step with it, same precedence renderBoardCountdown/Home's ETS banner use.
  // `saved.ets` is passed as resolveETSDate's legacy fallback: a date some
  // Soldiers saved directly in Calendar before ETS moved to the profile/
  // Settings pair, kept reachable rather than silently orphaned. Both
  // computeRows() and buildTimeline() call this instead of separately
  // re-deriving the same chain - that duplication (typed out twice in this
  // one file) is what actually collapses here.
  function resolveBoardEts(saved) {
    const boardRaw = util.resolveBoardDate ? util.resolveBoardDate() : "";
    const etsRaw = util.resolveETSDate ? util.resolveETSDate((saved && saved.ets) || "") : ((saved && saved.ets) || "");
    return { boardDate: parseDate(boardRaw), etsDate: parseDate(etsRaw) };
  }

  // {hasDate, dueDate, daysUntil, overdue} for the wpnQual TRACKED entry -
  // reuses the same addMonths/daysBetween math computeRows() uses for every
  // other TRACKED date. Exported so records.js can cross-check its own
  // weapons-qual checklist item against Career Calendar's own tracked date
  // without re-deriving the 24-month math a second time.
  function wpnQualStatus(saved, today) {
    const t = TRACKED.filter(function (x) { return x.key === "wpnQual"; })[0];
    const d = parseDate(saved && saved.wpnQual);
    if (!d || !t) return { hasDate: false, dueDate: null, daysUntil: null, overdue: false };
    const due = addMonths(d, t.months);
    const days = daysBetween(today, due);
    return { hasDate: true, dueDate: due, daysUntil: days, overdue: days < 0 };
  }

  // Pure row-building: every dated row "What is next" shows, sorted by
  // urgency, with no DOM touched - extracted from the old buildUpcoming() so
  // it can be unit-tested directly and reused by the shared-grid layout
  // below (which buckets these same rows into weekday columns instead of a
  // sorted card list).
  function computeRows(saved, today) {
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
      // row; G.reminders.addManaged() already falls back to "other" for
      // anything else, so there is no need to invent a new kind per TRACKED
      // entry. `source` (Screen Layouts / ROADMAP 3g) lets the "Remind me"
      // button on THIS row (and the date-change handler for this same
      // field) find and clear a stale reminder if the date is later edited.
      const remKind = t.key === "wpnQual" ? "weapons" : t.key === "aft" ? "acft" : "other";
      rows.push({ label: t.label.replace(/^Last /, "").replace(/^Arrived at /, ""),
                  when: due, days: daysBetween(today, due),
                  note: t.consequence, link: t.link, remKind: remKind, source: "calendar:" + t.key });
    });

    fixedAnchors(today).forEach(function (a) {
      rows.push({ label: a.label, when: a.when, days: daysBetween(today, a.when), note: a.note, link: null, remKind: a.remKind });
    });

    // Board date / ETS date - profile first, then Settings (see
    // resolveBoardEts()'s own comment). Neither throws: util.resolveBoardDate/
    // resolveETSDate already guard internally, so no try/catch is needed here
    // the way the old inline version needed one around each block.
    const be = resolveBoardEts(saved);
    if (be.boardDate) rows.push({ label: "Promotion board", when: be.boardDate, days: daysBetween(today, be.boardDate),
      note: "Your Records Readiness checks should be complete well before this, not the week of.", link: "#/records",
      urgencyFn: util.boardUrgency, remKind: "board" });
    // remKind:"ets" - reminders.js's own urgencyFor() already has a branch
    // for this exact kind (util.etsUrgency's 30/90-day scale); this row used
    // to carry no remKind at all, so a reminder made from it fell back to
    // "other" and was colored by the generic 14/45-day scale instead.
    if (be.etsDate) rows.push({ label: "ETS date", when: be.etsDate, days: daysBetween(today, be.etsDate),
      note: ETS_CONSEQUENCE, link: ETS_LINK, urgencyFn: util.etsUrgency, remKind: "ets" });

    rows.sort(function (a, b) { return a.days - b.days; });
    return rows;
  }

  // Builds the Open/Remind-me button row for one computeRows() row. Pulled
  // out of renderClassic's own buildUpcoming() (ROADMAP 3g Phase B, "The
  // Zero Board") so the Zero Board layout's expandable tiles can offer the
  // exact same reminder-creation path - G.reminders.addManaged() stamping
  // r.source, the MAX-reminder toast, the scheduleForReminder() call, the
  // util.announce() confirmation, and the button disabling itself in place -
  // instead of a second, easy-to-drift-apart copy of this logic. Nothing
  // about the BEHAVIOR changed by extracting this; renderClassic's own call
  // site below is otherwise identical to what it replaced.
  function buildRowButtons(r) {
    const btnRow = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px" });
    if (r.link) {
      const b = el("button.btn.sm.ghost", { type: "button", text: "Open" });
      b.addEventListener("click", function () { location.hash = r.link; });
      btnRow.appendChild(b);
    }
    if (G.reminders && G.reminders.addManaged) {
      const rb = el("button.btn.sm.ghost", { type: "button", text: "Remind me" });
      rb.addEventListener("click", async function () {
        const updated = await G.reminders.addManaged({ kind: r.remKind || "other", label: r.label, date: isoLocal(r.when), source: r.source || "" });
        if (!updated) { try { util.toast && util.toast("You've reached the " + G.reminders.MAX + "-reminder limit — remove an old one first."); } catch (e) {} return; }
        try { if (G.notify) await G.notify.scheduleForReminder(updated[updated.length - 1]); } catch (e) {}
        try { if (util.announce) util.announce("Reminder set for " + fmt(r.when) + "."); } catch (e) {}
        rb.disabled = true;
        rb.textContent = "Reminder set";
      });
      btnRow.appendChild(rb);
    }
    return btnRow;
  }

  // The single most urgent row app-wide, INCLUDING a deeply overdue one -
  // Zero Board's "NEXT ZERO" hero. computeRows() already sorts ascending by
  // `days` (so an overdue row's very negative day-count already sorts
  // first), but this reads the minimum directly rather than assuming that
  // ordering is a permanent contract of computeRows() - a small pure
  // function, not a re-derivation of any urgency math.
  function pickHeroRow(rows) {
    let best = null;
    rows.forEach(function (r) { if (!best || r.days < best.days) best = r; });
    return best;
  }

  // {level, color, word} for one row, calling the row's OWN urgency function
  // (board/ETS rows carry urgencyFn:util.boardUrgency/util.etsUrgency; every
  // other row falls back to util.genericUrgency, same fallback buildWeekCells
  // already uses) exactly once - the single source for both which SHELF a
  // Zero Board row belongs on and what color/word it renders with, so the
  // two can never disagree the way two independently-thresholded checks
  // could.
  function zoneInfo(r) {
    const fn = r.urgencyFn || util.genericUrgency;
    const info = fn(r.days);
    return { level: info.level, color: info.color, word: r.days < 0 ? "OVERDUE" : r.days + " days" };
  }

  async function renderClassic(mount) {
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

      const rows = computeRows(saved, today);

      if (!rows.length) {
        upcoming.appendChild(el("p.hint", { text:
          "Nothing tracked yet. Fill in any date below and it will appear here, sorted by how soon it bites." }));
        return;
      }

      rows.forEach(function (r) {
        const u = r.urgencyFn ? sharedUrgency(r.days, r.urgencyFn) : urgency(r.days);
        const card = el("div.card", { style: "margin-top:8px;border-left:3px solid " + u.c });
        const head = el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:baseline" });
        head.appendChild(el("span.k", { text: r.label, style: "min-width:0;flex:1 1 auto" }));
        head.appendChild(el("span.v", { text: u.word, style: "flex:0 0 auto;white-space:nowrap" }));
        card.appendChild(head);
        card.appendChild(el("div.hint", { text: fmt(r.when) + " — " + r.note }));
        // Audit finding (ux-consistency): the two Money-tab quick-adds
        // (salary-negotiation follow-up, USAJOBS closing date) already let a
        // Soldier turn a date into a native reminder in one click - every
        // date on the single screen whose whole purpose is "the dates that
        // cost you something when they lapse" had no such button at all.
        // Unlike those two, this page already computed the date (r.when),
        // so there's nothing to ask for; the reminder fires ON that
        // computed due date - honest with what the app actually knows,
        // rather than guessing a lead time this build has no basis for.
        // addManaged() (not add()) stamps r.source when this row has one (a
        // TRACKED field) - see the date-change handler in buildInputs()
        // below, which clears a stale reminder by that same source when the
        // field's date is edited. buildRowButtons() (shared with Zero
        // Board's own tiles, above) is what actually builds this.
        const btnRow = buildRowButtons(r);
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
        // no `future` flag, so computeRows()'s own "reference-only, no
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
        inp.addEventListener("change", async function () {
          saved[t.key] = inp.value; persist(); buildUpcoming(); refreshTosStat();
          // Editing this field's date invalidates any reminder made for its
          // OLD due date - without this, a Soldier who requalifies and
          // updates wpnQual, say, kept a stale "Remind me" reminder pointed
          // at the date they just corrected, forever. No date filter: every
          // reminder ever stamped with this field's source is stale now,
          // regardless of which due date it carried.
          try { if (G.reminders && G.reminders.clearManagedFor) await G.reminders.clearManagedFor({ source: "calendar:" + t.key }); } catch (e) {}
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

      let prof = null;
      try { prof = (G.profile && G.profile.cached) ? G.profile.cached() : null; } catch (e) {}
      const rank = (prof && (prof.rank || prof.tier)) || "";

      const points = [{ label: rank ? "Now — " + rank : "Now", when: today, isNow: true }];
      const be = resolveBoardEts(saved);
      if (be.boardDate) points.push({ label: "Promotion board", when: be.boardDate, link: "#/records" });
      if (be.etsDate) points.push({ label: "ETS", when: be.etsDate, link: "#/transition" });
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

  // ---- shared-grid layout (ROADMAP 3g "customizable screen layouts") ----
  // Buckets computeRows()'s sorted list into 7 weekday columns (today plus
  // the next 6 days) - several tracked dates can legitimately fall on the
  // same day, so each column shows its single most urgent row plus a "+N
  // more" count rather than trying to cram every row in.
  function buildWeekCells(rows, today) {
    const byDate = {};
    rows.forEach(function (r) {
      const iso = isoLocal(r.when);
      (byDate[iso] = byDate[iso] || []).push(r);
    });
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const iso = isoLocal(d);
      const dayRows = (byDate[iso] || []).slice().sort(function (a, b) { return a.days - b.days; });
      const top = dayRows[0];
      let level = "neutral";
      if (top) {
        const fn = top.urgencyFn || util.genericUrgency;
        level = fn(top.days).level;
      }
      out.push({
        iso: iso,
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
        isToday: i === 0,
        title: top ? top.label : "",
        sub: top ? (top.days < 0 ? "Overdue" : top.days === 0 ? "Today" : top.days + "d") + (dayRows.length > 1 ? " +" + (dayRows.length - 1) + " more" : "") : "Nothing tracked",
        tone: { level: level },
        link: top ? (top.link || "") : "",
        source: "calendar",
        actions: [],
      });
    }
    return out;
  }

  async function renderSharedGrid(mount) {
    util.clear(mount);
    mount.appendChild(el("div.section-title", {}, [
      el("h2", { text: "Career Calendar" }), el("div.rule") ]));
    mount.appendChild(el("p.hint", { text:
      "Shared grid layout — the same weekday-grid component PT Planner's own shared-grid layout uses, switched to Career Calendar's tracked dates for the next 7 days. Change this in Settings → Screen Layouts." }));

    let saved = {};
    try { const r = await G.db.get("kv", KEY); saved = (r && r.v) || {}; } catch (e) { /* offline-safe */ }
    const today = todayMidnight();
    const rows = computeRows(saved, today);
    const cells = buildWeekCells(rows, today);

    const host = el("div.panel");
    mount.appendChild(host);

    // The switcher navigates to the OTHER screen's own route rather than
    // rendering its data inline here - PT Planner and Career Calendar each
    // choose their layout independently (ptPlannerLayout/calendarLayout are
    // separate settings), so jumping over lets that screen's OWN choice
    // decide what it shows next, instead of this screen guessing.
    function draw(activeSource) {
      if (activeSource === "pt-planner") { location.hash = "#/pt-plan"; return; }
      if (!G.dateGrid || !G.dateGrid.renderWeek) {
        util.clear(host);
        host.appendChild(el("p.hint", { text: "The shared weekday-grid component isn't available - try Classic in Settings → Screen Layouts." }));
        return;
      }
      G.dateGrid.renderWeek(host, cells, {
        activeSource: "calendar",
        sources: [{ id: "pt-planner", label: "PT Planner" }, { id: "calendar", label: "Career Calendar" }],
        onSwitch: draw,
      });
    }
    draw("calendar");

    const foot = el("div.panel", { style: "margin-top:10px" });
    foot.appendChild(el("p.hint", { text: "Showing the next 7 days only. Switch to Classic in Settings → Screen Layouts for the full list, editor, and career timeline." }));
    const b = el("button.btn.sm.ghost", { type: "button", text: "Records Readiness" });
    b.addEventListener("click", function () { location.hash = "#/records"; });
    foot.appendChild(b);
    mount.appendChild(foot);
  }

  // ---- Zero Board layout (ROADMAP 3g "customizable screen layouts" Phase B) ----
  // "Urgency itself as the entire visual language" - a range-control
  // countdown board, not a calendar grid. A NEXT ZERO hero for the single
  // soonest item app-wide, a cyan DTG (days-to-go) readout for Today/Board/
  // ETS, three RED/AMBER/STANDBY shelves holding every OTHER computeRows()
  // row bucketed by its own real urgency zone, and a violet reference strip
  // for any tracked fact with no due date at all (today, only "tos"). Every
  // shelf/tile is built fresh from computeRows() on each render() call, so a
  // date edit made on Classic and then switched back to here (or a whole-
  // page reload) simply lands each row on the correct shelf - no separate
  // "did urgency change zones" transition logic needed.

  /** Renders one collapsed/expandable tile for a shelf row. Collapsed shows
   *  only the big day-count digit and the label (no date, no consequence
   *  text - the brief's "collapsed tile" contract); a click reveals the real
   *  date and consequence text plus the row's real Open/Remind-me buttons
   *  (buildRowButtons(), same function Classic's own cards use) in place,
   *  no navigation. The tile head's own aria-label states zone + label +
   *  day-count collapsed, and on expand gains the date/consequence text as a
   *  SUFFIX (never replaces the collapsed wording) so a screen-reader user
   *  hears strictly more, never different, information. */
  function buildTile(zoneTitle, level, row) {
    const z = zoneInfo(row);
    const overdue = row.days < 0;
    // border-left-COLOR only (not the whole shorthand) - width/style stay in
    // CSS so .zb-overdue's own heavier border-left-width below can win over
    // this inline color without needing !important.
    const wrap = el("div.zb-tile.zb-tile-" + level + (overdue ? ".zb-overdue" : ""), { style: "border-left-color:" + z.color });
    const collapsedName = zoneTitle + " zone: " + row.label + ", " + z.word.toLowerCase();
    const head = el("button.zb-tile-head", { type: "button", "aria-expanded": "false", "aria-label": collapsedName });
    const headRow = el("div", { style: "display:flex;align-items:flex-start;justify-content:space-between;gap:4px" });
    headRow.appendChild(el("div.zb-tile-count", { text: overdue ? "OVERDUE" : String(row.days), "aria-hidden": "true" }));
    headRow.appendChild(el("span.zb-tile-chev", { "aria-hidden": "true", gi: "chevron-right", giSize: 14 }));
    head.appendChild(headRow);
    head.appendChild(el("div.zb-tile-label", { text: row.label, "aria-hidden": "true" }));
    const body = el("div.zb-tile-body", { hidden: "hidden" });
    body.appendChild(el("p.hint", { text: fmt(row.when) + " — " + row.note }));
    const btnRow = buildRowButtons(row);
    if (btnRow.childNodes.length) body.appendChild(btnRow);
    head.addEventListener("click", function () {
      const open = body.hasAttribute("hidden");
      if (open) {
        body.removeAttribute("hidden");
        head.setAttribute("aria-expanded", "true");
        head.setAttribute("aria-label", collapsedName + ". Due " + fmt(row.when) + " — " + row.note);
      } else {
        body.setAttribute("hidden", "hidden");
        head.setAttribute("aria-expanded", "false");
        head.setAttribute("aria-label", collapsedName);
      }
    });
    wrap.appendChild(head);
    wrap.appendChild(body);
    // Overdue emphasis: a heavier static border ALWAYS (zb-overdue, above -
    // satisfied whether or not motion is allowed), plus a pulse ONLY when
    // util.prefersReducedMotion() says motion is fine - the shared app-wide
    // predicate (src/index.html), not a re-derived media-query check. The
    // CSS itself also zeroes .zb-pulse's animation under
    // prefers-reduced-motion as defense in depth, same double-guard pattern
    // this file's own view-transition CSS already uses.
    if (overdue && !util.prefersReducedMotion()) wrap.classList.add("zb-pulse");
    return wrap;
  }

  function buildShelf(title, level, rows) {
    const shelf = el("section.zb-shelf.zb-shelf-" + level, {
      "aria-label": title + " shelf, " + rows.length + " item" + (rows.length === 1 ? "" : "s") });
    const head = el("div.zb-shelf-head");
    // The shelf's real visible text label - RED/AMBER/STANDBY - is never
    // color-only; the color (zb-shelf-<level> below) is a reinforcing
    // accent on top of it, not the only signal.
    head.appendChild(el("span.zb-shelf-title", { text: title }));
    head.appendChild(el("span.zb-shelf-count", { text: String(rows.length) }));
    shelf.appendChild(head);
    if (!rows.length) {
      shelf.appendChild(el("p.hint", { text: "Nothing here." }));
      return shelf;
    }
    const grid = el("div.zb-shelf-grid");
    rows.forEach(function (r) { grid.appendChild(buildTile(title, level, r)); });
    shelf.appendChild(grid);
    return shelf;
  }

  /** The NEXT ZERO hero: the single most urgent row app-wide, in oversized
   *  type, colored via its OWN real urgency function (zoneInfo(), same
   *  source of truth the shelves use) with a real Open action. */
  function buildHero(row) {
    const wrap = el("div.zb-hero" + (row ? "" : ".zb-hero-empty"));
    wrap.appendChild(el("div.eyebrow", { text: "NEXT ZERO" }));
    if (!row) {
      wrap.appendChild(el("p.hint", { text: "Nothing tracked yet. Switch to Classic in Settings → Screen Layouts to add a date." }));
      return wrap;
    }
    const z = zoneInfo(row);
    const overdue = row.days < 0;
    wrap.style.borderLeftColor = z.color;
    if (overdue) wrap.classList.add("zb-overdue");
    if (overdue && !util.prefersReducedMotion()) wrap.classList.add("zb-pulse");
    wrap.appendChild(el("div.zb-hero-label", { text: row.label }));
    wrap.appendChild(el("div.zb-hero-count", { text: z.word }));
    wrap.appendChild(el("p.hint", { text: fmt(row.when) + " — " + row.note }));
    const btnRow = buildRowButtons(row);
    if (btnRow.childNodes.length) wrap.appendChild(btnRow);
    return wrap;
  }

  /** The compact DTG (days-to-go) readout: Today / Promotion board / ETS,
   *  all three framed in --cyan regardless of how close any of them are -
   *  deliberately NOT run through util.boardUrgency/util.etsUrgency here,
   *  because those two dates already get their own dedicated red/amber/
   *  green treatment down in the shelves (as ordinary computeRows() rows);
   *  this strip is orientation chrome, not a second urgency vocabulary. */
  function buildDtgReadout(saved, today) {
    const be = resolveBoardEts(saved);
    const wrap = el("div.zb-dtg", { role: "group", "aria-label": "Days to go readout" });
    function seg(label, days, dateText) {
      const s = el("div.zb-dtg-seg");
      s.appendChild(el("div.zb-dtg-label", { text: label }));
      s.appendChild(el("div.zb-dtg-count", { text: days == null ? "—" : (days < 0 ? "OVERDUE" : days === 0 ? "TODAY" : days + "d") }));
      s.appendChild(el("div.hint", { text: dateText }));
      return s;
    }
    wrap.appendChild(seg("Today", 0, fmt(today)));
    wrap.appendChild(seg("Promotion board", be.boardDate ? daysBetween(today, be.boardDate) : null, be.boardDate ? fmt(be.boardDate) : "Not set"));
    wrap.appendChild(seg("ETS", be.etsDate ? daysBetween(today, be.etsDate) : null, be.etsDate ? fmt(be.etsDate) : "Not set"));
    return wrap;
  }

  /** The violet no-due-date reference strip: any TRACKED field that is
   *  reference-only (no `future` flag AND no `months`, computeRows()'s own
   *  "reference-only, no due date" guard a few hundred lines up - currently
   *  just "tos", read generically rather than hardcoded so a future TRACKED
   *  entry of the same shape picks this up automatically) with a value
   *  saved. Never red/amber/green - there is no due date here to be urgent
   *  about, so coloring it that way would just be noise. Reuses
   *  monthsBetween(), the exact same whole-calendar-months arithmetic
   *  Classic's own "Your dates" tosStat already shows. Returns null when
   *  nothing reference-only has a value yet, so the caller can skip it
   *  entirely rather than rendering an empty strip. */
  function buildReferenceStrip(saved, today) {
    const refFields = TRACKED.filter(function (t) { return !t.future && !t.months; });
    const withDates = refFields.filter(function (t) { return !!parseDate(saved[t.key]); });
    if (!withDates.length) return null;
    const wrap = el("div.zb-reference");
    wrap.appendChild(el("div.eyebrow", { text: "Reference — no due date" }));
    withDates.forEach(function (t) {
      const n = monthsBetween(parseDate(saved[t.key]), today);
      const row = el("div.zb-reference-row");
      row.appendChild(el("span.k", { text: t.label }));
      row.appendChild(el("span.hint", { text: n + " month" + (n === 1 ? "" : "s") + " so far — " + t.consequence }));
      wrap.appendChild(row);
    });
    return wrap;
  }

  async function renderZeroBoard(mount) {
    util.clear(mount);
    mount.appendChild(el("div.section-title", {}, [
      el("h2", { text: "Career Calendar" }), el("div.rule") ]));
    mount.appendChild(el("p.hint", { text:
      "The Zero Board — urgency itself as the layout. Every tracked date sorted onto a RED, AMBER or STANDBY shelf by real days-to-go. Change this in Settings → Screen Layouts." }));

    let saved = {};
    try { const r = await G.db.get("kv", KEY); saved = (r && r.v) || {}; } catch (e) { /* offline-safe */ }
    const today = todayMidnight();
    const rows = computeRows(saved, today);

    // role=status aria-live=polite mirrors renderClassic's own `upcoming`
    // panel (its comment a few hundred lines up explains why: a rebuild
    // that changes what a screen-reader user is told needs to actually be
    // announced). Nothing here rebuilds after the initial render - there is
    // no in-place editor on this layout, Classic already owns that - but
    // expanding a tile reveals genuinely new text inside this same region,
    // which this announces exactly the way Classic's own dynamic updates do.
    const host = el("div.zb-board", { role: "status", "aria-live": "polite" });
    mount.appendChild(host);

    host.appendChild(buildHero(pickHeroRow(rows)));
    host.appendChild(buildDtgReadout(saved, today));

    const shelves = { red: [], amber: [], green: [] };
    rows.forEach(function (r) { (shelves[zoneInfo(r).level] || shelves.green).push(r); });
    host.appendChild(buildShelf("RED", "red", shelves.red));
    host.appendChild(buildShelf("AMBER", "amber", shelves.amber));
    host.appendChild(buildShelf("STANDBY", "green", shelves.green));

    const ref = buildReferenceStrip(saved, today);
    if (ref) host.appendChild(ref);

    const foot = el("div.panel", { style: "margin-top:10px" });
    foot.appendChild(el("p.hint", { text: "Switch to Classic in Settings → Screen Layouts for the full editable list and the career timeline." }));
    const b = el("button.btn.sm.ghost", { type: "button", text: "Records Readiness" });
    b.addEventListener("click", function () { location.hash = "#/records"; });
    foot.appendChild(b);
    mount.appendChild(foot);
  }

  // A simple id -> {label, render} map. Phase B adds the screen-specific
  // "Zero Board" layout ("zero-board", above) as one more entry - nothing
  // else in this file (including the dispatcher below) needs to change for
  // that, and Settings' own layout picker (src/index.html) enumerates
  // G.calendar.LAYOUTS dynamically, so it appears there automatically too.
  const LAYOUTS = {
    classic: { label: "Classic", render: renderClassic },
    "shared-grid": { label: "Shared grid (with PT Planner)", render: renderSharedGrid },
    "zero-board": { label: "The Zero Board", render: renderZeroBoard },
  };

  // Thin dispatcher: reads the Soldier's chosen layout from Settings, falls
  // back to "classic" for an id this build doesn't recognise (e.g. a Phase-B
  // layout picked on another device and later removed here).
  async function render(mount) {
    let s = {};
    try { s = (G.store && G.store.settings) ? G.store.settings() : {}; } catch (e) {}
    const layoutId = (s && s.calendarLayout) || "classic";
    const layout = LAYOUTS[layoutId] || LAYOUTS.classic;
    await layout.render(mount);
  }

  G.calendar = {
    render: render,
    TRACKED: TRACKED,
    KEY: KEY,
    LAYOUTS: LAYOUTS,
    computeRows: computeRows,
    resolveBoardEts: resolveBoardEts,
    wpnQualStatus: wpnQualStatus,
  };
})();
// END calendar.js
