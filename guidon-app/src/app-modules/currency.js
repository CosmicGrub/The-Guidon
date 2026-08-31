/* ==== js/currency.js ==== */
/* GUIDON - currency.js : how old is what you just read (G.currency)

   This app is full of dated policy, and 2026 has been unusually brutal about
   it: the promotion regulation was reissued in March, a second fitness test
   of record appeared in April, the body-composition exemption was rescinded in
   July, and Credentialing Assistance halved in March. Every one of those broke
   something that had been correct a few months earlier.

   Until now the app stored `asOf` stamps in its data and never showed them.
   That is the wrong way round: the reader cannot tell a fact verified last week
   from one carried forward for a year, and the ones most likely to be stale are
   exactly the ones with career consequences.

   So this does three things and refuses to do a fourth:
     - states, per policy area, what edition the app is built on
     - computes the AGE of that from the stamp, rather than asserting freshness
     - says who to ask to confirm it
     - does NOT phone home. There is no feed, and pretending otherwise would be
       worse than the staleness it is trying to surface.
*/
window.G = window.G || {};
(function () {
  "use strict";
  const util = G.util, el = util.el;

  // Money's own currency signal (window.GUIDON_SEED.finance.asOf, read live
  // via G.store.finance() - the exact same accessor finance.js's own data()
  // uses, so this can never see anything finance.js itself couldn't) is
  // prose, not a bare stamp: "TSP/BRS rules current as of 2026 (IRS Notice
  // 2025-67, TSP Bulletin 25-3); VA compensation rates current as of 2026
  // (2.8% COLA, effective Dec 1 2025, verified at va.gov) - always verify
  // at tsp.gov and va.gov" - because two different regimes (TSP/BRS vs
  // VA/GI Bill, both on the Money tab) are asserted current together, each
  // with its own citation. ageOf() below only understands a bare
  // YYYY[-MM[-DD]] stamp, so pull the leading year out of that prose at
  // render time instead of hand-typing a second date here that the real
  // field could silently drift away from - the whole point of this file.
  // Called from a `get asOf()` accessor on the DOMAINS entry below (not
  // computed once at module load): finance.js's asOf backfills to "" until
  // loadContent() resolves state.seed.finance (see sgtCapsFromSeed() above
  // PPW for the same seed-not-ready-yet race, solved the same way there).
  let _financeAsOfWarned = false;
  function financeAsOfStamp() {
    try {
      const s = (G.store && G.store.finance && G.store.finance()) || {};
      const m = /\b(20\d{2})\b/.exec(s.asOf || "");
      if (m) return m[1];
    } catch (e) {}
    // Either the seed hasn't loaded yet (normal, transient - render() only
    // runs once the user opens #/currency, by which point store.init()
    // has already resolved in every real path) or finance.asOf changed
    // shape enough to no longer contain a leading year - which would
    // otherwise leave this domain silently reading "unknown" forever with
    // no trace. Log once per session, not once per read (this getter is
    // read multiple times per render() call - once per sort comparison,
    // again for display).
    if (!_financeAsOfWarned && G.selfheal) {
      _financeAsOfWarned = true;
      G.selfheal.log("currency-derive-fail", "finance", "could not find a leading year in G.store.finance().asOf - the Money/Finance Freshness entry will read “unknown” instead of a real age");
    }
    return null;
  }

  // Career's own currency signal, same live-getter shape as financeAsOfStamp()
  // just above but simpler to extract: G.store.career().fy26Snapshot -
  // read live via G.store.career(), the exact same accessor career.js's own
  // data() uses - carries a `sourceMilper` object naming the actual MILPER
  // message the shortage/growth and overstrength/restricted MOS lists come
  // from (`{ number, title, effectiveDate, supersedes }`), added specifically
  // so this tracker has something real to read instead of the hand-typed
  // "2026" literal this domain used to carry. Unlike finance.asOf (prose that
  // needs a year regexed out of it), sourceMilper.effectiveDate is already a
  // bare ISO-ish stamp (YYYY-MM-DD) in exactly the shape ageOf() below
  // parses natively, so no extraction is needed - just a shape check.
  // Called from a `get asOf()` accessor on the DOMAINS entry below, not
  // computed once at module load, for the same reason as Money: the seed
  // backfills to {} until loadContent() resolves state.seed.career.
  let _careerAsOfWarned = false;
  function careerAsOfStamp() {
    try {
      const s = (G.store && G.store.career && G.store.career()) || {};
      const snap = s.fy26Snapshot || {};
      const stamp = (snap.sourceMilper && snap.sourceMilper.effectiveDate) || "";
      if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(stamp)) return stamp;
    } catch (e) {}
    // Either the seed hasn't loaded yet (normal, transient - same race as
    // financeAsOfStamp() above) or fy26Snapshot.sourceMilper changed shape
    // enough to no longer carry a parseable effectiveDate - which would
    // otherwise leave this domain silently reading "unknown" forever with
    // no trace. Log once per session, not once per read (this getter is
    // read multiple times per render() call - once per sort comparison,
    // again for display).
    if (!_careerAsOfWarned && G.selfheal) {
      _careerAsOfWarned = true;
      G.selfheal.log("currency-derive-fail", "career", "could not find a parseable sourceMilper.effectiveDate in G.store.career().fy26Snapshot - the Career Freshness entry will read “unknown” instead of a real age");
    }
    return null;
  }

  // Resources' own currency signal, same live-getter shape as
  // financeAsOfStamp() and careerAsOfStamp() above: G.store.resources().asOf
  // ("Curated from the DOL VETS Resource Guide, April 2026 - verify at
  // dol.gov/agencies/vets/programs/tap"), read live via G.store.resources() -
  // the exact same accessor resources.js's own data() uses, so this can
  // never see anything resources.js itself couldn't. Prose, not a bare
  // stamp, same reasoning as Money: pull the embedded year out at render
  // time rather than hand-typing a second "2026" here that the real field
  // could silently drift away from.
  let _resourcesAsOfWarned = false;
  function resourcesAsOfStamp() {
    try {
      const s = (G.store && G.store.resources && G.store.resources()) || {};
      const m = /\b(20\d{2})\b/.exec(s.asOf || "");
      if (m) return m[1];
    } catch (e) {}
    if (!_resourcesAsOfWarned && G.selfheal) {
      _resourcesAsOfWarned = true;
      G.selfheal.log("currency-derive-fail", "resources", "could not find a leading year in G.store.resources().asOf - the Resources Freshness entry will read “unknown” instead of a real age");
    }
    return null;
  }

  // Enhancement backlog round 1, "Hardcoded content numbers" bucket: two
  // domains here each carried their own independent literal for a date a
  // sibling module ALSO hardcodes as its own module-level AS_OF constant -
  // Assignments ("2026-07" here vs assignments.js's own "July 2026") and
  // Fitness ("2026-07-07" here vs fitness.js's own "July 2026", not even
  // the same day-precision) - two or three independently-maintained
  // stamps for the same policy area that could silently drift apart on a
  // future content refresh, the exact failure shape careerAsOfStamp() and
  // financeAsOfStamp() above already exist to prevent. Both source modules
  // export AS_OF (G.assignments.AS_OF, G.fitness.AS_OF) in the same
  // "Month YYYY" prose shape - this one shared parser turns that into the
  // bare YYYY-MM ageOf() expects, so a module's own displayed disclaimer
  // and this tracker's card can never disagree again.
  const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const _monthYearWarned = {};
  function monthYearStamp(moduleName, raw) {
    try {
      const m = /^([A-Za-z]+)\s+(\d{4})$/.exec((raw || "").trim());
      if (m) {
        const idx = MONTH_NAMES.indexOf(m[1].toLowerCase());
        if (idx >= 0) return m[2] + "-" + String(idx + 1).padStart(2, "0");
      }
    } catch (e) {}
    if (!_monthYearWarned[moduleName] && G.selfheal) {
      _monthYearWarned[moduleName] = true;
      G.selfheal.log("currency-derive-fail", moduleName, "could not parse a \"Month YYYY\" stamp from G." + moduleName + ".AS_OF - the " + moduleName + " Freshness entry will read “unknown” instead of a real age");
    }
    return null;
  }

  /* volatility: how fast this area has actually moved, not how important it is.
     "high" = it changed within the last year and could again. */
  const DOMAINS = [
    { area: "Promotion points and eligibility", short: "Board Prep", asOf: "2026-03-06", volatility: "high",
      basis: "AR 600-8-19, 6 March 2026 (effective 6 April 2026), superseding the 21 June 2024 edition.",
      implemented: "Point tables 3-2, 3-3 and 3-4 are transcribed from this edition and unit-tested against it.",
      ask: "S-1, and the monthly HQDA cutoff message for your MOS.", link: "#/board",
      // Reference Library cross-link: the one domain here whose `basis`
      // names a single publication that's also in the Library's 15-document
      // core set - a direct "don't just trust the transcription, read the
      // actual regulation" path. Not added to every domain: most of the
      // others cite Army Directives/ALARACTs/EXORDs outside that set, or a
      // whole corpus (Doctrine) rather than one document - a fabricated
      // link there would be worse than no link.
      libraryId: "ar-600-8-19" },

    { area: "Fitness tests of record", short: "Fitness",
      get asOf() { return monthYearStamp("fitness", G.fitness && G.fitness.AS_OF); },
      volatility: "high",
      basis: "AFT combat standard effective 1 Jan 2026 (RA); Combat Field Test under AD 2026-07 from April 2026; AD 2026-13 rescinded the body-composition exemption on 7 July 2026.",
      implemented: "Both tests, both MOS lists, and the CFT phasing dates.",
      ask: "Your S-3 and your unit's test calendar.", link: "#/fitness",
      // Enhancement backlog round 4, "Currency/Freshness tracker missing
      // entries it already has rules for" bucket: this domain's basis
      // touches the body-composition exemption, governed by AR 600-9 - one
      // of the Library's 15 core documents (confirmed via library.js's own
      // DOCS entry, id "ar-600-9") - the same "single publication in the
      // core set" criterion the Board Prep domain above already documents
      // for its own libraryId. Missing here purely by oversight, not by the
      // documented exclusion (that's for domains citing a whole corpus or
      // Directives/ALARACTs/EXORDs outside the core set).
      libraryId: "ar-600-9" },

    { area: "Credentialing and tuition assistance", short: "Channels", asOf: "2026-03-19", volatility: "high",
      basis: "ALARACT 102/2025 - CA reduced to $2,000 per fiscal year, officers ineligible, all requests routed through ArmyIgnitED.",
      implemented: "Current rules stated in Channels and reflected in the PPW's civilian-education advice.",
      ask: "Your education centre.", link: "#/channels" },

    { area: "NCO professional development", short: "BLC Prep", asOf: "2026-07", volatility: "medium",
      basis: "DLC eliminated as a resident-PME prerequisite 1 Oct 2024; PME course lengths are actively changing across the ladder.",
      implemented: "BLC, ALC and SLC modules, each carrying its own change warning.",
      ask: "Your NCO Academy and S-3 - course length is the part most likely to be wrong.", link: "#/blc",
      // Enhancement backlog round 4, "Currency/Freshness tracker missing
      // entries it already has rules for" bucket: same reasoning as Fitness
      // above - this domain's subject is DA PAM 600-25 (U.S. Army NCO
      // Professional Development Guide), a single publication in the
      // Library's core set (confirmed via library.js's own DOCS entry, id
      // "da-pam-600-25"), so it qualifies for the same "Read the source"
      // cross-link the Board Prep domain already has.
      libraryId: "da-pam-600-25" },

    { area: "Assignments and the Marketplace", short: "Assignments",
      get asOf() { return monthYearStamp("assignments", G.assignments && G.assignments.AS_OF); },
      volatility: "medium",
      basis: "HRC Enlisted Manning Cycle guidance. Four cycles a year; dates move and are deliberately not shipped.",
      implemented: "Mechanics only - YMAV, YMAEAT, KDA, preferencing.",
      ask: "Your talent manager or career counsellor.", link: "#/assignments" },

    // Audit finding (rank/MOS scoping pass): the MOS Career Center's own
    // in-page disclaimer already says ASVAB minimums, IN/OUT-call status
    // and SRB tables "change roughly every six months via MILPER message" -
    // it was the single most self-described-perishable content in the app
    // and the one domain this tracker never listed.
    // asOf is a live getter, not a literal, same reasoning as Money below:
    // data.career.fy26Snapshot.sourceMilper.effectiveDate is the real MILPER
    // message's own effective date, read live via G.store.career() so this
    // can never see anything career.js itself couldn't - see
    // careerAsOfStamp() above.
    { area: "MOS shortage/growth and reclassification", short: "Career",
      get asOf() { return careerAsOfStamp(); },
      volatility: "high",
      basis: "FY26 shortage/growth and overstrength/restricted MOS lists; SRB Quality Tiered Incentive Program (HQDA EXORD 117-26). Superseded roughly every six months by a new IN/OUT-call MILPER message - see the Career tab's own fy26Snapshot.sourceMilper for the exact message this age is derived from.",
      implemented: "164 MOS entries, Warrant Officer feeder pathways, civilian-credential mapping, and the reclassification policy panel.",
      ask: "Your Career Counselor / Installation Retention Office via RETAIN for the current IN/OUT call.", link: "#/career" },

    { area: "Transition and VA benefits", short: "ETS", asOf: "2026-07", volatility: "medium",
      basis: "BDD filing window and the DD-214 walkthrough; Continuation Pay window moved to 7 years on 1 Jan 2026.",
      implemented: "ETS timeline and the money section.",
      ask: "SFL-TAP and a VSO.", link: "#/transition" },

    // Distinct from "Transition and VA benefits" just above: that domain is
    // the #/transition route's own ETS timeline and DD-214 walkthrough.
    // This one is the separate #/money route (G.finance) - BRS/TSP, TSP
    // Funds, Budget, Predatory Lending, ETS Finance, VA Compensation,
    // Credit & Debt and Salary Negotiation all live behind ONE tab bar and
    // share ONE asOf stamp (rendered as the Money tab's own top disclaimer),
    // and none of that was tracked here before. asOf is a live getter, not
    // a literal, on purpose - see financeAsOfStamp() above.
    { area: "TSP, BRS, VA and GI Bill dollar figures", short: "Money",
      get asOf() { return financeAsOfStamp(); },
      volatility: "medium",
      basis: "IRS Notice 2025-67 / TSP Bulletin 25-3 (TSP contribution limits and the BRS match); the Dec 2025 VA COLA (VA compensation and GI Bill figures) - see the Money tab's own disclaimer for the exact citation text this age is derived from.",
      implemented: "All eight Money tabs: BRS & TSP, TSP Funds, Budget, Predatory Lending, ETS Finance, VA Compensation, Credit & Debt, Salary Negotiation.",
      ask: "tsp.gov, va.gov, and your installation's Personal Financial Counselor.", link: "#/money" },

    { area: "Acronyms and terms", short: "Terms", asOf: "2021", volatility: "low",
      basis: "DoD Dictionary of Military and Associated Terms, 2021 baseline, with an Army overlay.",
      // Enhancement backlog round 1, "Hardcoded content numbers" bucket:
      // this hand-typed "3,629 terms" agreed with neither the real
      // browsable set (terms.length, 3,623 - what Dictionary itself now
      // shows) nor the upstream metadata field (count, 3,631) - a third,
      // independently wrong number for the same dataset. Now reads the
      // same live length Dictionary's own render() displays, via
      // G.store.acronyms(), so the two screens can never disagree again.
      get implemented() {
        try {
          const terms = (G.store && G.store.acronyms && G.store.acronyms().terms) || [];
          if (terms.length) return terms.length.toLocaleString() + " terms. The baseline is the oldest thing in the app and is flagged as such.";
        } catch (e) {}
        return "An unknown number of terms. The baseline is the oldest thing in the app and is flagged as such.";
      },
      ask: "The current DoD Dictionary if a term matters legally.", link: "#/dictionary" },

    { area: "Doctrine corpus", short: "Doctrine", asOf: "2026-07", volatility: "low",
      basis: "ADP/FM/ATP publications spanning many years. Doctrine changes slowly; the risk here is a superseded edition, not a wrong number.",
      // Enhancement backlog round 1, "Hardcoded content numbers" bucket:
      // this previously hand-typed "1,069 board cards" - a second stale
      // literal caught here after the same file already caught and fixed
      // "1,014 board cards" once before (task history: "bump board-card
      // regression baseline 1014 -> 1069"). This file exists specifically
      // to catch stale numbers, so it should not carry one itself - now a
      // live getter reading the raw seed (state.seed via G.store.seed()),
      // NOT G.store.boardQuestions(), which applies the Soldier's own
      // tierFilter setting and would understate the true corpus size for
      // anyone who has narrowed their tier - the same reasoning
      // doctrineSeed()'s own unfiltered entries.length already follows.
      get implemented() {
        try {
          const s = G.store && G.store.seed && G.store.seed();
          const n = (s && s.board && s.board.questions && s.board.questions.length) || null;
          if (n) return "336 entries and " + n.toLocaleString() + " board cards.";
        } catch (e) {}
        return "336 entries and an unknown number of board cards.";
      },
      ask: "armypubs.army.mil for the current edition of any publication you are quoting.", link: "#/doctrine" },

    // Enhancement backlog round 4, "Currency/Freshness tracker missing
    // entries it already has rules for" bucket: #/resources carries its own
    // explicit dated citation (data.resources.asOf, rendered as the tab's
    // own top hint by resources.js) exactly like Money and Career above do -
    // but unlike them, it never had a DOMAINS entry here, so a reader could
    // land on 24 categories of apprenticeship/legal/spouse-employment
    // program links with no way to see how stale the underlying guide is
    // without leaving #/currency to go find the in-page stamp themselves.
    // asOf is a live getter, not a literal, same reasoning as Money/Career -
    // see resourcesAsOfStamp() above.
    { area: "Resources directory (apprenticeships, licensing, employment rights, spouse programs)", short: "Resources",
      get asOf() { return resourcesAsOfStamp(); },
      volatility: "medium",
      basis: "DOL VETS Resource Guide, April 2026 - program names, URLs and eligibility figures (e.g. MyCAA's $4,000 cap) are drawn from it - see the Resources tab's own hint for the exact citation text this age is derived from.",
      implemented: "All 24 categories: apprenticeships, certification/credentialing, employment rights, military spouse employment, mentorship, and the rest of the directory.",
      ask: "The linked agency (dol.gov, mycaa.militaryonesource.mil, etc.) for the current version of any program you're relying on.", link: "#/resources" },
  ];

  function ageOf(stamp) {
    // Accept YYYY, YYYY-MM or YYYY-MM-DD; assume the start of the period, which
    // makes the reported age conservative (older) rather than flattering.
    const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(stamp);
    if (!m) return null;
    const d = new Date(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    return { days: days, months: Math.floor(days / 30.44) };
  }

  function band(months, volatility) {
    // A high-volatility area goes amber fast; a low-volatility one has longer.
    const amber = volatility === "high" ? 6 : volatility === "medium" ? 12 : 36;
    const red = volatility === "high" ? 12 : volatility === "medium" ? 24 : 60;
    if (months >= red) return { c: "var(--red)", word: "verify before you rely on it" };
    if (months >= amber) return { c: "var(--amber)", word: "worth confirming" };
    return { c: "var(--green)", word: "recent" };
  }

  async function render(mount) {
    util.clear(mount);
    mount.appendChild(el("div.section-title", {}, [
      el("h2", { text: "How current is this?" }), el("div.rule") ]));

    mount.appendChild(el("p.hint", { text:
      "GUIDON is offline by design, which means it cannot tell you when something changed - only when it was last checked. This page shows that, per policy area, and who to ask. Age is computed from the stamp each time you open it, so it gets more honest, not less, as this build gets older." }));

    const sorted = DOMAINS.slice().sort(function (a, b) {
      const A = ageOf(a.asOf), B = ageOf(b.asOf);
      return (B ? B.months : 0) - (A ? A.months : 0);
    });

    // Fold5/tablet fidelity wave 2: uniform domain-staleness cards (9 at the
    // time, now 10 with Money/Finance added below) used to stack
    // single-column regardless of viewport - same .card-results-grid
    // utility as Learn/Drills/Health.
    const grid = el("div.card-results-grid");
    mount.appendChild(grid);

    sorted.forEach(function (d) {
      const age = ageOf(d.asOf);
      const bd = age ? band(age.months, d.volatility) : { c: "var(--text-dim)", word: "unknown" };
      const p = el("div.panel", { style: "margin-bottom:10px;border-left:3px solid " + bd.c });
      const head = el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:baseline" });
      head.appendChild(el("span.k", { text: d.area, style: "min-width:0;flex:1 1 auto" }));
      head.appendChild(el("span.v", { text: age ? (age.months < 1 ? "this month" : age.months + " months old") : "—", style: "flex:0 0 auto;white-space:nowrap" }));
      p.appendChild(head);
      p.appendChild(el("div.hint", { text: bd.word + " · " + d.volatility + " volatility" }));
      p.appendChild(el("div.ob-plan-cat", { text: "Built on", style: "margin-top:8px" }));
      p.appendChild(el("div.hint", { text: d.basis }));
      p.appendChild(el("div.ob-plan-cat", { text: "In the app", style: "margin-top:6px" }));
      p.appendChild(el("div.hint", { text: d.implemented }));
      p.appendChild(el("div.ob-plan-cat", { text: "Confirm with", style: "margin-top:6px" }));
      p.appendChild(el("div.hint", { text: d.ask }));
      if (d.link) {
        // Named for its destination, not "Open section". Screen-reader users
        // navigate by pulling up a list of controls stripped of surrounding
        // context; eight buttons all announcing "Open section" are unusable
        // there even though each is perfectly clear on screen.
        const b = el("button.btn.sm.ghost", { type: "button", text: "Open " + (d.short || d.area), style: "margin-top:8px" });
        b.addEventListener("click", function () { location.hash = d.link; });
        p.appendChild(b);
      }
      if (d.libraryId && G.library) {
        const rb = el("button.btn.sm.ghost", { type: "button", text: "Read the source", style: "margin-top:8px;margin-left:6px" });
        rb.addEventListener("click", function () { G.library._openId = d.libraryId; location.hash = "#/library"; });
        p.appendChild(rb);
      }
      grid.appendChild(p);
    });

    const foot = el("div.panel");
    foot.appendChild(el("div.eyebrow", { text: "Before a board, a packet, or a decision" }));
    foot.appendChild(el("p", { text:
      "Anything in red or amber above should be confirmed against the source before you act on it. That is not a disclaimer to skip past - in the twelve months to July 2026 the promotion regulation, the fitness test of record and the credentialing budget all changed, and each of them made previously-correct content wrong." }));
    foot.appendChild(el("p.hint", { text:
      "If you find something in GUIDON that contradicts a current publication, the publication wins. armypubs.army.mil is the authority." }));
    mount.appendChild(foot);
  }

  G.currency = { render: render, DOMAINS: DOMAINS, ageOf: ageOf, band: band };
})();
// END currency.js
