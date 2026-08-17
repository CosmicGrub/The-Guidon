/* ==== js/fitness.js ==== */
/* GUIDON - fitness.js : the two fitness tests of record (G.fitness)

   Why this section exists: as of 2026 a Soldier in a combat specialty can be
   held to three different physical standards at once - the AFT general
   standard, the AFT combat standard, and the Combat Field Test - each with its
   own MOS list, its own scoring model, and its own career consequence.
   Getting this wrong does not cost promotion points. It costs a PCS, or an MOS.

   Sourcing: AFT-score-to-promotion-points is AR 600-8-19 (6 Mar 2026) table
   3-4. CFT events, uniform, time cap and phasing are Army Directive 2026-07.
   MOS lists are reproduced as published, and are the most perishable thing
   here - the module says so rather than implying they are settled.
*/
window.G = window.G || {};
(function () {
  "use strict";
  const util = G.util, el = util.el;

  const AS_OF = "July 2026";

  // The AFT combat standard applies to these 21. The CFT applies to these plus
  // 12D, 89D and 89E - 24 in total. That relationship is the clearest way to
  // hold the two lists apart, and it is also the cross-check that resolved an
  // earlier "21 or 24?" contradiction in this project's own open items: the
  // sources were never in conflict, they were describing two different tests.
  const AFT_COMBAT_MOS = ["11A","11B","11C","11Z","12A","12B","13A","13F",
    "18A","180A","18B","18C","18D","18E","18F","18Z","19A","19C","19D","19K","19Z"];
  const CFT_EXTRA_MOS = ["12D","89D","89E"];

  const CFT_EVENTS = [
    ["1-mile run", "The test opens with it, so everything after it is done tired."],
    ["30 dead-stop push-ups", "Chest to the ground, hands lifted clear between repetitions."],
    ["100-metre sprint", "Maximum effort, already fatigued."],
    ["16 sandbag lifts", "40 lb sandbag onto a 65-inch platform."],
    ["50-metre water-can carry", "Two 40 lb cans - 80 lb total, carried the full distance."],
    ["50-metre movement drill", "25 m high crawl, then 25 m of 3-to-5-second rushes."],
    ["1-mile run", "The second one. This is where the 30-minute cap is usually lost."]
  ];

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
      el("h2", { text: "Fitness Tests of Record" }), el("div.rule") ]));

    mount.appendChild(el("p.hint", { text:
      "There are two tests now, not one. The Army Fitness Test is scored and feeds promotion points. The Combat Field Test is pass/fail and does not. If your MOS is on the combat list you take both, annually. Current as of " +
      AS_OF + " - fitness policy moved repeatedly this year, so confirm anything decision-critical with your chain before planning around it." }));

    mount.appendChild(el("div.eyebrow", { text: "Army Fitness Test (AFT)", style: "margin-top:14px" }));
    mount.appendChild(rows("Two standards, same five events", [
      ["General standard", "Minimum 60 points per event AND 300 overall. Performance-normed by age and sex."],
      ["Combat standard", "Minimum 60 points per event AND 350 overall. Sex-neutral and age-normed - the 350 is the same number for everyone."],
      ["The rule people miss", "Both standards require 60 in EVERY event. Drop one event below 60 and the test is a fail, whatever the total says."],
      ["Effective", "1 January 2026 for the Regular Army; 1 June 2026 for USAR and ARNG."]
    ]));

    mount.appendChild(rows("What a combat-MOS score actually costs you", [
      ["350 or above", "Combat standard met. Nothing further."],
      ["300 to 349", "General standard met, combat standard missed. Coded AEA AECBTDQ, which blocks PCS - you stay where you are until it is fixed."],
      ["Below 300", "Test failure, with the usual flag and retest consequences."],
      ["Sustained shortfall", "Soldiers in a combat MOS holding the general standard but not the combat standard are subject to in-service reclassification. The Army has described this as phased: preparation, then voluntary reclassification, then mandatory."]
    ], "var(--red)"));

    const ptsP = el("div.panel", { style: "margin-bottom:10px" });
    ptsP.appendChild(el("div.eyebrow", { text: "AFT and promotion points" }));
    ptsP.appendChild(el("p", { text:
      "Your AFT aggregate score converts to promotion points on AR 600-8-19 table 3-4: 120 points at a 500, dropping 3 points per 5-point band down to 1 point at 300. Score divided by 5 is a common shortcut, and it is wrong." }));
    const goPts = el("button.btn.sm", { type: "button", text: "Calculate it in the PPW" });
    goPts.addEventListener("click", function () { location.hash = "#/board"; });
    ptsP.appendChild(goPts);
    mount.appendChild(ptsP);

    mount.appendChild(rows("Body composition", [
      ["No AFT exemption any more", "Army Directive 2026-13 rescinded AD 2025-17 effective 7 July 2026. The old 'a 465 exempts you from taping' rule is gone. Every Soldier meets the body composition standard regardless of AFT score."]
    ]));

    mount.appendChild(el("div.eyebrow", { text: "Combat Field Test (CFT)", style: "margin-top:16px" }));
    mount.appendChild(el("p.hint", { text:
      "New in 2026 under Army Directive 2026-07. It does NOT replace the AFT - Soldiers in the designated specialties pass one of each, annually." }));

    const ev = el("div.panel", { style: "margin-bottom:10px" });
    ev.appendChild(el("div.eyebrow", { text: "Seven events, in this order, 30 minutes or less" }));
    CFT_EVENTS.forEach(function (pair, i) {
      ev.appendChild(el("div.ob-plan-cat", { text: (i + 1) + ". " + pair[0], style: "margin-top:8px" }));
      ev.appendChild(el("div.hint", { text: pair[1] }));
    });
    ev.appendChild(el("p.hint", { style: "margin-top:10px", text:
      "Continuous and cumulative - the clock does not stop between events. Uniform is ACU top and bottom, combat boots, brown T-shirt, no headgear." }));
    mount.appendChild(ev);

    mount.appendChild(rows("How it is scored", [
      ["Pass or fail only", "No event points and no total score. You finish inside 30 minutes or you do not."],
      ["No age or sex adjustment", "Unlike the AFT general standard, nothing is normed. One time cap for everyone."],
      ["It earns no promotion points", "The CFT is a gate, not a scorer. Only the AFT feeds your PPW."]
    ]));

    mount.appendChild(rows("The deadline that matters", [
      ["April 2026", "Diagnostic testing begins. A failure in this window carries no permanent record consequence."],
      ["The 365-day window", "Reconditioning, and voluntary reclassification without damage to your record. This is the cheap time to fix it."],
      ["After roughly April 2027", "For record. A failure can bring a Flag (code C) and can trigger mandatory reclassification."],
      ["Retest", "About 90 days for Active Duty, 180 for the Reserve Component."]
    ], "var(--amber)"));

    const lists = el("div.panel", { style: "margin-bottom:10px" });
    lists.appendChild(el("div.eyebrow", { text: "Which list are you on" }));
    lists.appendChild(el("div.ob-plan-cat", { text: "AFT combat standard - 21 specialties", style: "margin-top:8px" }));
    lists.appendChild(el("p", { style: "font-family:var(--font-mono);word-break:break-word;margin:4px 0",
      text: AFT_COMBAT_MOS.join("  ") }));
    lists.appendChild(el("div.ob-plan-cat", { text: "Combat Field Test - the same 21, plus 3", style: "margin-top:10px" }));
    lists.appendChild(el("p", { style: "font-family:var(--font-mono);word-break:break-word;margin:4px 0",
      text: CFT_EXTRA_MOS.join("  ") + "   (combat diver, and the two EOD specialties)" }));
    lists.appendChild(el("p.hint", { style: "margin-top:8px", text:
      "24 in total for the CFT. If you have seen '21 or 24' argued about, that is the answer - two different tests with two different lists, not a contradiction. MOS designations are the most perishable thing on this page; verify yours against the current directive before making a career decision on it." }));
    mount.appendChild(lists);

    // Audit finding (rank/MOS scoping pass): this page never checked the
    // Soldier's own profile.mos against either list, even though both are
    // plain arrays of the same MOS-code strings the Career Center already
    // uses - a Soldier reading this page had to eyeball a wall of codes to
    // find their own.
    try {
      const profile = G.profile && G.profile.current ? await G.profile.current() : null;
      const mos = profile && profile.mos ? profile.mos.trim().toUpperCase() : "";
      if (mos) {
        const onAft = AFT_COMBAT_MOS.indexOf(mos) !== -1;
        // CFT_EXTRA_MOS holds only the 3 codes ADDITIONAL to the AFT
        // combat list, per this module's own header comment ("Combat
        // Field Test - the same 21, plus 3"): the real 24-member CFT
        // roster is AFT_COMBAT_MOS UNION CFT_EXTRA_MOS, not CFT_EXTRA_MOS
        // alone. Checking only CFT_EXTRA_MOS here first missed the CFT for
        // all 21 AFT-combat MOSs (e.g. told an 11B "the CFT does not apply
        // to your MOS", which is exactly backwards).
        const onCftOnly = CFT_EXTRA_MOS.indexOf(mos) !== -1;
        const onCft = onAft || onCftOnly;
        const you = el("div.panel", { style: "margin-bottom:10px;border-left:3px solid " + (onAft || onCft ? "var(--red)" : "var(--green)") });
        you.appendChild(el("div.eyebrow", { text: "Your MOS (" + mos + ")" }));
        if (onAft) {
          you.appendChild(el("p", { text: "On the AFT combat standard (350 minimum, sex-neutral) AND the Combat Field Test list. You take both tests, annually." }));
        } else if (onCftOnly) {
          you.appendChild(el("p", { text: "On the Combat Field Test list. The AFT general standard (not combat standard) applies to your MOS." }));
        } else {
          you.appendChild(el("p", { text: "Not on either list — the AFT general standard applies. Verify against your unit's test calendar; this list is the most perishable thing on this page." }));
        }
        mount.appendChild(you);
      }
    } catch (e) {}

    mount.appendChild(rows("Where this comes from", [
      ["AR 600-8-19 (6 March 2026), table 3-4", "AFT aggregate score to promotion points."],
      ["Army Directive 2026-07", "Combat Field Test: events, uniform, time cap, phasing."],
      ["Army Directive 2026-13", "Rescinded AD 2025-17 and with it the AFT-score body composition exemption, effective 7 July 2026."],
      ["Your S-3 and your chain of command", "For which list your MOS is actually on, and your unit's test calendar. This is a study aid, not an order."]
    ]));
  }

  G.fitness = { render: render, AFT_COMBAT_MOS: AFT_COMBAT_MOS, CFT_EXTRA_MOS: CFT_EXTRA_MOS,
                CFT_EVENTS: CFT_EVENTS, AS_OF: AS_OF };
})();
// END fitness.js
