/* ==== js/assignments.js ==== */
/* GUIDON - assignments.js : the Enlisted Marketplace (G.assignments)

   Before this section the app had zero coverage of how assignments actually
   work, which is a strange gap in a career tool: for most Soldiers the next
   duty station shapes the next three years more than any single promotion
   point does.

   The honesty problem this module has to solve up front: the Marketplace is
   principally for SSG through MSG. A Specialist reading a generic "here is how
   you choose your assignment" page would be misled - their lever is
   reenlistment options, not preferencing. So the module says who it applies to
   in the first panel rather than burying it.

   Sources: HRC Enlisted Manning Cycle guidance and the Army's own "Enlisted
   Soldiers: Your Guide to the Marketplace". Cycle DATES are deliberately not
   shipped - there are four cycles a year and they move.
*/
window.G = window.G || {};
(function () {
  "use strict";
  const util = G.util, el = util.el;

  const AS_OF = "July 2026";

  function rows(title, list, border) {
    const p = el("div.panel", { style: "margin-bottom:10px" + (border ? ";border-left:3px solid " + border : "") });
    p.appendChild(el("div.eyebrow", { text: title }));
    list.forEach(function (pair) {
      p.appendChild(el("div.ob-plan-cat", { text: pair[0], style: "margin-top:8px" }));
      p.appendChild(el("div.hint", { text: pair[1] }));
    });
    return p;
  }

  async function render(mount) {
    util.clear(mount);
    mount.appendChild(el("div.section-title", {}, [
      el("h2", { text: "Assignments & Marketplace" }), el("div.rule") ]));

    // Roadmap Tier 5 (width-waste audit): these 5 stage panels - eligibility,
    // the two governing dates, what else the Army weighs, how to preference,
    // and pre-window prep - used to append straight into `mount`, one
    // full-width .panel each, so a tablet/Fold5-unfolded/desktop Soldier
    // scrolled a single narrow column past wide-open space either side.
    // .panel-grid-2 (see its own header comment in the CSS, near
    // "Fold 5's unfolded main screen is ~673px CSS-wide" - triggers at
    // >=600px, not 768, specifically so Fold5-portrait isn't skipped) is the
    // SAME "independent, differing-length reference panels sit side by side"
    // shape career.js's own reclass-policy/FY26-snapshot pair already uses
    // (see G.career's topGrid) - reused here rather than inventing a
    // route-specific grid, exactly the "wired to their specific markup"
    // gap the audit called out. 2-up (not 3) because each panel is several
    // full-sentence rows, not a short label - 3 columns would squeeze that
    // prose uncomfortably narrow. "Related" (below) stays out of the grid:
    // it is a row of nav buttons, not a reference panel, and halving its
    // width would just wrap the button row for no benefit.
    const stageGrid = el("div.panel-grid-2");
    stageGrid.appendChild(rows("Does this apply to you yet?", [
      ["SSG through MSG", "Yes. You preference assignments in the IPPS-A Enlisted Marketplace, four cycles a year."],
      ["SGT and below", "Not usually. Your assignment options generally come at REENLISTMENT, through your career counsellor, rather than through Marketplace preferencing. Read this anyway - the record you build now is what preferences against later."],
      ["Everyone", "Your talent profile feeds both the Marketplace AND promotion boards. Accuracy is not an assignments-only problem."]
    ], "var(--amber)"));

    stageGrid.appendChild(rows("The two dates that decide whether you move", [
      ["YMAV - Year Month Available to Move", "This is what makes you a 'mover' in a cycle. HRC identifies vacancies, identifies movers by YMAV, and loads both into IPPS-A; Marketplace then opens for that population."],
      ["YMAEAT", "Year Month of Assignment Eligibility and Availability Termination. For Soldiers under formal stabilisation this is the primary factor in the assignment process."],
      ["Want to move earlier?", "A YMAV change is requested through your chain of command, routinely by submitting a Personnel Action Request in IPPS-A. It is a request, not a setting you flip."]
    ]));

    stageGrid.appendChild(rows("What else the Army weighs", [
      ["Time on station", "One of the factors in identifying you for assignment."],
      ["KDA completion", "Key and Developmental Assignments. Whether you have done the jobs your CMF expects at your grade."],
      ["Unit strengths", "Where the Army is short, against Active Component Manning Guidance and senior leader priorities."],
      ["CMF Talent Development Plan", "Your career field's own view of what a Soldier at your grade should do next."]
    ]));

    stageGrid.appendChild(rows("How to preference, properly", [
      ["Preference deeply", "Do not rank three places and stop. Anything you leave unpreferenced is treated as equally desirable and gets ranked between your top-down and bottom-up choices - so silence is a choice, and not a good one."],
      ["Top-down and bottom-up", "Top-down marks what you want. Bottom-up marks what you do not. Using both is how you actually shape the outcome."],
      ["Be honest anyway", "Not everyone gets their top picks, and unforecasted requirements can place Soldiers against assignments outside a cycle entirely. Preferencing improves your odds; it does not buy a guarantee."]
    ]));

    stageGrid.appendChild(rows("Before the window opens", [
      ["Fix the profile first", "The Talent Management tile in IPPS-A is where your talent profile lives. It is read for Marketplace selection AND for promotion boards - a stale profile costs you twice."],
      ["Check it against your own records", "Same discipline as a board packet: the system shows what was keyed, not what you did."],
      ["Know your own YMAV", "If you do not know it, you cannot tell whether you are in the next cycle. S-1 or your talent manager can tell you."]
    ]));
    mount.appendChild(stageGrid);

    const links = el("div.panel");
    links.appendChild(el("div.eyebrow", { text: "Related" }));
    [["Records Readiness", "#/records"], ["Career Calendar", "#/calendar"],
     ["Channels - who to ask", "#/channels"], ["MOS Career Center", "#/career"]].forEach(function (pair) {
      const b = el("button.btn.sm.ghost", { type: "button", text: pair[0], style: "margin:4px 6px 0 0" });
      b.addEventListener("click", function () { location.hash = pair[1]; });
      links.appendChild(b);
    });
    mount.appendChild(links);

    mount.appendChild(el("p.hint", { style: "margin-top:12px", text:
      "Current as of " + AS_OF + ". Cycle dates and preferencing windows are NOT shipped in this app - there are four cycles a year and they move. Your talent manager, career counsellor and S-1 are the authority on when your window opens." }));
  }

  G.assignments = { render: render, AS_OF: AS_OF };
})();
// END assignments.js
