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

  // AFT Event Score Calculator: the interactive counterpart to the two
  // reference panels above. Those explain the standards in prose; this
  // takes a Soldier's actual raw per-event performance and scores it
  // against the real table (G.aftScoring, aft-scoring.js - see that
  // file's header for the exact source). Kept as its own function so
  // render() stays readable; called once, appends into `mount`.
  //
  // Persistence: raw inputs + age band/sex/standard selections are saved
  // to their own kv row (guidon:aft-calc:v1, this module's own key) with
  // the same 300ms-debounce-plus-flush-hook shape index.html's PPW
  // worksheet already established (see PPW_KEY/persistPPWDebounced there)
  // - a Soldier filling this in should not lose it by navigating away.
  const AFT_CALC_KEY = "guidon:aft-calc:v1";
  async function buildAftCalculator(mount) {
    const AS = G.aftScoring;
    if (!AS) return; // aft-scoring.js failed to load; the reference panels above still work without it.

    const v = { bandIndex: 1, sex: "male", standard: "general",
      mdl: 0, hrp: 0, sdcMin: 0, sdcSec: 0, plkMin: 0, plkSec: 0, tmrMin: 0, tmrSec: 0 };
    let hadSavedState = false;
    try {
      const saved = await G.db.get("kv", AFT_CALC_KEY);
      if (saved && saved.v && typeof saved.v === "object") { Object.assign(v, saved.v); hadSavedState = true; }
    } catch (e) {}
    // Default the standard from the Soldier's own MOS the same way the
    // "Your MOS" panel below already does, but only on first use (a saved
    // choice, even one that no longer matches profile.mos, is left alone -
    // this is a study aid, not a re-derived fact, and a Soldier evaluating
    // "what if I were on the combat standard" should not have that flipped
    // back out from under them on every visit).
    if (!hadSavedState) {
      try {
        const profile = G.profile && G.profile.current ? await G.profile.current() : null;
        const mos = profile && profile.mos ? profile.mos.trim().toUpperCase() : "";
        if (mos && AFT_COMBAT_MOS.indexOf(mos) !== -1) v.standard = "combat";
      } catch (e) {}
    }

    let _saveTimer = null;
    async function doPersist() { try { await G.db.put("kv", { k: AFT_CALC_KEY, v: v }); } catch (e) {} }
    function persistDebounced() { clearTimeout(_saveTimer); _saveTimer = setTimeout(function () { _saveTimer = null; doPersist(); }, 300); }
    util.onFlush("aft-calc", function () { if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; doPersist(); } });

    const wrap = el("div.panel", { style: "margin-bottom:10px;border-left:3px solid var(--amber)" });
    wrap.appendChild(el("div.eyebrow", { text: "AFT Event Score Calculator" }));
    wrap.appendChild(el("p.hint", { text:
      "Enter your actual raw performance on each event. This scores it against the real, published age- and sex-normed table (" + AS.SOURCE.pub + ", " + AS.SOURCE.edition + ") — the same conversion a grader reads off DA Form 705-TEST — and totals the five events into your 0–500 aggregate. Nothing here is estimated." }));

    const ctl = el("div.panel-grid-2", { style: "margin:8px 0" });
    function selectRow(label, options, current, onChange) {
      const c = el("div.card", { style: "margin-bottom:8px" });
      c.appendChild(el("div.k", { text: label }));
      const sel = el("select.ob-input", { "aria-label": label, style: "width:100%;margin-top:4px" });
      options.forEach(function (opt) {
        const o = el("option", { value: opt[0], text: opt[1] });
        if (opt[0] === current) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function () { onChange(sel.value); persistDebounced(); redraw(); });
      c.appendChild(sel);
      return c;
    }
    const bandOpts = AS.AGE_BANDS.map(function (b, i) { return [String(i), b]; });
    ctl.appendChild(selectRow("Age band", bandOpts, String(v.bandIndex), function (val) { v.bandIndex = +val; }));
    ctl.appendChild(selectRow("Sex (general standard only)", [["male", "Male"], ["female", "Female"]], v.sex, function (val) { v.sex = val; }));
    ctl.appendChild(selectRow("Standard", [["general", "General (300 min, sex-normed)"], ["combat", "Combat (350 min, sex-neutral)"]], v.standard, function (val) { v.standard = val; }));
    wrap.appendChild(ctl);

    const inputsWrap = el("div.panel-grid-2", { style: "margin:8px 0" });
    function numField(label, key, min, max, step, unit) {
      const c = el("div.card", { style: "margin-bottom:8px" });
      c.appendChild(el("div.k", { text: label }));
      const row2 = el("div", { style: "display:flex;align-items:center;gap:6px;margin-top:4px" });
      const inp = el("input", { type: "number", min: String(min), max: String(max), step: String(step || 1),
        value: String(v[key]), "aria-label": label, style: "width:100px" });
      inp.addEventListener("input", function () {
        let n = parseFloat(inp.value); if (isNaN(n)) n = 0;
        n = Math.max(min, Math.min(max, n));
        if (inp.value !== String(n)) inp.value = String(n);
        v[key] = n; persistDebounced(); redraw();
      });
      row2.appendChild(inp);
      if (unit) row2.appendChild(el("span.hint", { text: unit, style: "margin:0" }));
      c.appendChild(row2);
      return c;
    }
    function timeField(label, minKey, secKey) {
      const c = el("div.card", { style: "margin-bottom:8px" });
      c.appendChild(el("div.k", { text: label }));
      const row2 = el("div", { style: "display:flex;align-items:center;gap:6px;margin-top:4px" });
      const minInp = el("input", { type: "number", min: "0", max: "59", step: "1", value: String(v[minKey]), "aria-label": label + " minutes", style: "width:60px" });
      const secInp = el("input", { type: "number", min: "0", max: "59", step: "1", value: String(v[secKey]), "aria-label": label + " seconds", style: "width:60px" });
      function onChange() {
        let m = Math.max(0, Math.min(59, parseInt(minInp.value, 10) || 0));
        let s = Math.max(0, Math.min(59, parseInt(secInp.value, 10) || 0));
        minInp.value = String(m); secInp.value = String(s);
        v[minKey] = m; v[secKey] = s; persistDebounced(); redraw();
      }
      minInp.addEventListener("input", onChange); secInp.addEventListener("input", onChange);
      row2.appendChild(minInp); row2.appendChild(el("span", { text: "min", style: "font-size:0.85em" }));
      row2.appendChild(secInp); row2.appendChild(el("span", { text: "sec", style: "font-size:0.85em" }));
      c.appendChild(row2);
      return c;
    }
    // Bounds come from aft-scoring.js's own EVENTS metadata (inputMin/Max/
    // Step) rather than being retyped here, so the input's own clamp can
    // never quietly drift from what that module documents as the event's
    // real range.
    inputsWrap.appendChild(numField(AS.EVENTS.mdl.label, "mdl", AS.EVENTS.mdl.inputMin, AS.EVENTS.mdl.inputMax, AS.EVENTS.mdl.inputStep, "lbs"));
    inputsWrap.appendChild(numField(AS.EVENTS.hrp.label, "hrp", AS.EVENTS.hrp.inputMin, AS.EVENTS.hrp.inputMax, AS.EVENTS.hrp.inputStep, "reps in 2:00"));
    inputsWrap.appendChild(timeField("Sprint-Drag-Carry", "sdcMin", "sdcSec"));
    inputsWrap.appendChild(timeField("Plank", "plkMin", "plkSec"));
    inputsWrap.appendChild(timeField("2-Mile Run", "tmrMin", "tmrSec"));
    wrap.appendChild(inputsWrap);

    const resultBox = el("div.panel", { style: "margin-top:8px" });
    wrap.appendChild(resultBox);
    mount.appendChild(wrap);

    function redraw() {
      util.clear(resultBox);
      const raws = {
        mdl: v.mdl, hrp: v.hrp,
        sdc: AS.clockToSec(v.sdcMin, v.sdcSec),
        plk: AS.clockToSec(v.plkMin, v.plkSec),
        tmr: AS.clockToSec(v.tmrMin, v.tmrSec)
      };
      // scoreAll() (aft-scoring.js) takes an age in years and derives the
      // band itself via ageToBand() - this calculator asks for a band
      // directly instead (no birthdate collected; see this function's own
      // note on why), so each event is scored here with v.bandIndex rather
      // than routing through scoreAll()'s age-based path.
      const column = AS.columnFor(v.sex, v.standard);
      const scores = {}, belowSixty = [];
      let aggregate = 0;
      AS.EVENT_ORDER.forEach(function (k) {
        const pts = AS.scoreEvent(k, v.bandIndex, column, raws[k]);
        scores[k] = pts; aggregate += pts;
        if (pts < 60) belowSixty.push(AS.EVENTS[k].short);
      });

      resultBox.appendChild(el("div.eyebrow", { text: "Event scores" }));
      const scoreGrid = el("div", { style: "display:flex;flex-wrap:wrap;gap:10px;margin:6px 0" });
      AS.EVENT_ORDER.forEach(function (k) {
        const ev = AS.EVENTS[k];
        const cell = el("div.stat", { style: "min-width:90px" });
        cell.appendChild(el("span.k", { text: ev.short }));
        cell.appendChild(el("span.v", { text: String(scores[k]) + " pts" }));
        scoreGrid.appendChild(cell);
      });
      resultBox.appendChild(scoreGrid);

      const total = el("p", { style: "font-size:1.3em;font-weight:600;margin:8px 0 2px" });
      total.textContent = "Aggregate: " + aggregate + " / 500";
      resultBox.appendChild(total);

      const min = v.standard === "combat" ? 350 : 300;
      let statusText, statusColor;
      if (belowSixty.length) { statusText = "Automatic test failure — below 60 on " + belowSixty.join(", ") + " (every event needs at least 60, whatever the total is)."; statusColor = "var(--red)"; }
      else if (aggregate >= min) { statusText = (v.standard === "combat" ? "Combat" : "General") + " standard met (" + min + " minimum)."; statusColor = "var(--green)"; }
      else { statusText = (v.standard === "combat" ? "Combat" : "General") + " standard NOT met — " + (min - aggregate) + " points short of the " + min + " minimum."; statusColor = "var(--amber)"; }
      resultBox.appendChild(el("p.hint", { text: statusText, style: "color:" + statusColor }));
      resultBox.appendChild(el("p.hint", { text: "Promotion points at this aggregate: " + aftPointsPreview(aggregate) + ". Send it to the PPW for the full worksheet.", style: "margin-top:2px" }));

      const sendBtn = el("button.btn.sm", { type: "button", text: "Send this aggregate to the PPW" });
      sendBtn.addEventListener("click", async function () {
        try {
          const PPW_KEY = "guidon:ppw:v1";
          // A deliberate, single-field, user-triggered merge into the PPW
          // worksheet's own kv row (not this module's key) - the exact
          // cross-link the roadmap audit flagged as missing: a Soldier
          // used to have to already know their AFT aggregate before the
          // PPW calculator could do anything with it. Every other field
          // in that row is preserved untouched.
          const existing = await G.db.get("kv", PPW_KEY);
          const merged = (existing && existing.v && typeof existing.v === "object") ? Object.assign({}, existing.v) : {};
          merged.aftScore = aggregate;
          await G.db.put("kv", { k: PPW_KEY, v: merged });
          sendBtn.textContent = "Sent — opening PPW…";
          setTimeout(function () { location.hash = "#/board"; }, 300);
        } catch (e) { sendBtn.textContent = "Could not save — try again"; }
      });
      resultBox.appendChild(sendBtn);

      resultBox.appendChild(el("p.hint", { text: "Source: " + AS.SOURCE.pub + " (" + AS.SOURCE.edition + "), via " + AS.SOURCE.via + ". Age band, sex and standard above change which column of that table your raw performance is read against.", style: "margin-top:8px" }));
    }

    // aftPointsPreview: a tiny read-only mirror of index.html's own
    // aftPts() (AR 600-8-19 table 3-4 - 120 at 500, 1 at 300, 0 below 300)
    // so this panel can show the promotion-point number inline without a
    // circular dependency on core (aft-scoring.js loads before index.html's
    // own script finishes, and this file has no "requires" on core - core
    // is always present, by definition). Kept as one clearly-labeled,
    // clearly-sourced copy of the same small formula, not a reimplementation
    // of PPW's category caps or worksheet.
    function aftPointsPreview(score) {
      const s = Math.round(score || 0);
      if (s >= 500) return 120;
      if (s >= 310) return 6 + 3 * Math.floor((s - 310) / 5);
      if (s >= 305) return 3;
      if (s >= 300) return 1;
      return 0;
    }

    redraw();
  }

  async function render(mount) {
    util.clear(mount);
    mount.appendChild(el("div.section-title", {}, [
      el("h2", { text: "Fitness Tests of Record" }), el("div.rule") ]));

    mount.appendChild(el("p.hint", { text:
      "There are two tests now, not one. The Army Fitness Test is scored and feeds promotion points. The Combat Field Test is pass/fail and does not. If your MOS is on the combat list you take both, annually. Current as of " +
      AS_OF + " - fitness policy moved repeatedly this year, so confirm anything decision-critical with your chain before planning around it." }));

    mount.appendChild(el("div.eyebrow", { text: "Army Fitness Test (AFT)", style: "margin-top:14px" }));

    // Width-waste audit (Tier 5): these four AFT reference panels (the two
    // standards, what a miss costs you, the points note, body composition)
    // used to stack single-column all the way down regardless of viewport -
    // 2,000px+ of unused right-hand margin on tablet/Fold-5-unfolded/desktop
    // for four panels that are each a few short lines. .panel-grid-2
    // (>=600px, see CSS) pairs them up the same way Career's own
    // reclass-policy/FY26-snapshot topGrid already does. The CFT's ordered
    // 7-event walkthrough and the MOS code walls further down stay OUT of
    // this treatment on purpose - see the comments at each.
    const aftGrid = el("div.panel-grid-2");
    aftGrid.appendChild(rows("Two standards, same five events", [
      ["General standard", "Minimum 60 points per event AND 300 overall. Performance-normed by age and sex."],
      ["Combat standard", "Minimum 60 points per event AND 350 overall. Sex-neutral and age-normed - the 350 is the same number for everyone."],
      ["The rule people miss", "Both standards require 60 in EVERY event. Drop one event below 60 and the test is a fail, whatever the total says."],
      ["Effective", "1 January 2026 for the Regular Army; 1 June 2026 for USAR and ARNG."]
    ]));

    aftGrid.appendChild(rows("What a combat-MOS score actually costs you", [
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
    aftGrid.appendChild(ptsP);

    aftGrid.appendChild(rows("Body composition", [
      ["No AFT exemption any more", "Army Directive 2026-13 rescinded AD 2025-17 effective 7 July 2026. The old 'a 465 exempts you from taping' rule is gone. Every Soldier meets the body composition standard regardless of AFT score."]
    ]));
    mount.appendChild(aftGrid);

    // The AFT was reference-only up to this point: five events and a
    // conversion rule explained in prose, with no way to actually run a
    // Soldier's own numbers. This is the connected flow - raw performance
    // in, event scores + aggregate out, one button from there into the PPW
    // (index.html's aftPts()) rather than two disconnected screens.
    await buildAftCalculator(mount);

    mount.appendChild(el("div.eyebrow", { text: "Combat Field Test (CFT)", style: "margin-top:16px" }));
    mount.appendChild(el("p.hint", { text:
      "New in 2026 under Army Directive 2026-07. It does NOT replace the AFT - Soldiers in the designated specialties pass one of each, annually." }));

    // Kept full width, unlike the two grids above: this is a NUMBERED,
    // ordered 7-step procedure meant to be read top to bottom in sequence -
    // halving its width would just wrap a walkthrough into a cramped
    // column, the same reasoning Career's own topGrid keeps its growing
    // NCOES ladder out of .panel-grid-2 for.
    const ev = el("div.panel", { style: "margin-bottom:10px" });
    ev.appendChild(el("div.eyebrow", { text: "Seven events, in this order, 30 minutes or less" }));
    CFT_EVENTS.forEach(function (pair, i) {
      ev.appendChild(el("div.ob-plan-cat", { text: (i + 1) + ". " + pair[0], style: "margin-top:8px" }));
      ev.appendChild(el("div.hint", { text: pair[1] }));
    });
    ev.appendChild(el("p.hint", { style: "margin-top:10px", text:
      "Continuous and cumulative - the clock does not stop between events. Uniform is ACU top and bottom, combat boots, brown T-shirt, no headgear." }));
    mount.appendChild(ev);

    // Same pairing treatment as the AFT group above: two short, comparable
    // reference panels (how it's scored, the phasing deadline).
    const cftGrid = el("div.panel-grid-2");
    cftGrid.appendChild(rows("How it is scored", [
      ["Pass or fail only", "No event points and no total score. You finish inside 30 minutes or you do not."],
      ["No age or sex adjustment", "Unlike the AFT general standard, nothing is normed. One time cap for everyone."],
      ["It earns no promotion points", "The CFT is a gate, not a scorer. Only the AFT feeds your PPW."]
    ]));

    cftGrid.appendChild(rows("The deadline that matters", [
      ["April 2026", "Diagnostic testing begins. A failure in this window carries no permanent record consequence."],
      ["The 365-day window", "Reconditioning, and voluntary reclassification without damage to your record. This is the cheap time to fix it."],
      ["After roughly April 2027", "For record. A failure can bring a Flag (code C) and can trigger mandatory reclassification."],
      ["Retest", "About 90 days for Active Duty, 180 for the Reserve Component."]
    ], "var(--amber)"));
    mount.appendChild(cftGrid);

    // Also kept full width: the monospace MOS code walls below wrap on
    // word-break as it is at full width - halving the column would just
    // force them into more, choppier wrapped lines for no readability gain.
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

    // Roadmap audit round 4, "UX: cross-links and action feedback" bucket:
    // Calendar and Money already link INTO #/fitness (calendar.js's AFT/CFT-
    // due reminder rows, currency.js's BRS/TSP fitness note), but this
    // render() had no reciprocal links back out - the one inline button
    // above only goes to #/board for the PPW calculator, so a Soldier who
    // arrived from Calendar or Money had no way back without the browser
    // history stack. Every comparable sibling route (assignments.js,
    // career.js, currency.js, calendar.js, records.js, leader.js) ends its
    // render with a "Related" panel of nav buttons; this copies that exact
    // shape rather than inventing a fitness-specific one. Calendar closes
    // the loop back to the AFT-due reminder that likely pointed here, Health
    // because body composition and the AFT are the same conversation, and
    // Career for the promotion-point stakes both tests feed.
    const related = el("div.panel", { style: "margin-top:10px" });
    related.appendChild(el("div.eyebrow", { text: "Related" }));
    [["Calendar", "#/calendar"], ["Health", "#/health"], ["MOS Career Center", "#/career"]].forEach(function (pair) {
      const b = el("button.btn.sm.ghost", { type: "button", text: pair[0], style: "margin:4px 6px 0 0" });
      b.addEventListener("click", function () { location.hash = pair[1]; });
      related.appendChild(b);
    });
    mount.appendChild(related);
  }

  G.fitness = { render: render, AFT_COMBAT_MOS: AFT_COMBAT_MOS, CFT_EXTRA_MOS: CFT_EXTRA_MOS,
                CFT_EVENTS: CFT_EVENTS, AS_OF: AS_OF };
})();
// END fitness.js
