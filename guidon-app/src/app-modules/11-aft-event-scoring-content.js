/* ==== js/11-aft-event-scoring-content.js ==== */
/* GUIDON - AFT (Army Fitness Test) event scoring: board-drill content pack.

   Standing rule (guidon-content-pipeline-board-cards-rule): every new
   sourced/researched content addition ships matching board-drill
   flashcards, not just the feature that uses the sourced facts. The new
   per-event AFT calculator (aft-scoring.js, feeding #/fitness) introduced
   several real, previously-unstated facts about how the AFT is actually
   scored - the 60-per-event auto-fail rule, the two aggregate minimums, the
   sex-neutral Plank, and the Combat standard's shared-column mechanic. This
   pack turns those into 5 board.questions cards a Soldier can drill,
   independent of whether they ever open the calculator itself.

   Sourcing: same two documents aft-scoring.js cites (see that file's own
   header for the full citation trail) -
     ATP 7-22.01, Holistic Health and Fitness Testing (12 March 2026,
     Headquarters, Department of the Army), Chapter 2, Section II.
     "Army Fitness Test Score Tables" (Approved 15 May 2025 / Effective
     1 June 2025), https://www.army.mil/e2/downloads/rv7/aft/AFT_Scoring_Scales_250601.pdf
*/
window.G = window.G || {};
(function () {
  "use strict";
  G.contentPack.define("aft-event-scoring-content", function (bank) {
    if (!bank) return;

    // Reuses the seed's own existing category exactly (not a new one) -
    // lint-content-packs.mjs fails a pack category that is neither an
    // existing seed category nor declared in tools/pillar-map.mjs's
    // PACK_CATEGORIES, precisely so "AFT" content never splits across two
    // spellings in the picker/chips/Readiness heatmap.
    var CATEGORY = "Army Fitness Test (AFT)";
    var SRC_ATP = "ATP 7-22.01 (12 Mar 2026), Chapter 2, Section II";
    var SRC_TABLE = "Army Fitness Test Score Tables (Approved 15 May 2025 / Effective 1 June 2025), army.mil/aft";
    var SRC_BOTH = SRC_ATP + "; " + SRC_TABLE;

    var cards = [
      ["aft-scoring-01",
        "Each AFT event is scored 0-100 points for a 500-point aggregate. What happens if a Soldier scores 45 on one event but well over 400 in total?",
        "Automatic test failure. Every one of the 5 events has its own 60-point minimum, and missing it on even one event fails the test no matter how high the aggregate is - the total does not average out a low event score.",
        SRC_ATP,
        "AFT per-event 60-point minimum (independent of the aggregate)"],
      ["aft-scoring-02",
        "What is the minimum AFT aggregate score under the General standard, and under the Combat standard?",
        "300 under the General standard (performance-normed by age and sex, for combat-enabling specialties). 350 under the Combat standard (sex-neutral, age-normed only, for the 21 designated combat specialties) - both on top of the 60-per-event minimum.",
        SRC_ATP,
        "AFT aggregate minimums: General 300 vs Combat 350"],
      ["aft-scoring-03",
        "On the AFT Combat standard, whose scoring table governs a Soldier's event-by-event points, regardless of the Soldier's own sex?",
        "The same sex-neutral column that already scores male Soldiers under the General standard. The published scoring tables print it as one merged \"M | C\" column rather than a separate Combat-standard table - the Combat standard reuses the male-general column for every Soldier in a combat MOS.",
        SRC_TABLE,
        "Combat standard reuses the General standard's male column"],
      ["aft-scoring-04",
        "Which single AFT event is scored on an identical table for men and women even under the sex-normed General standard?",
        "The Plank (PLK). Its time-held standard is the same for both sexes at every one of the 10 published age bands - the only one of the 5 AFT events where that is true outside the Combat standard.",
        SRC_TABLE,
        "Plank is sex-neutral even under the General standard"],
      ["aft-scoring-05",
        "Name the 5 AFT events, in the order a Soldier takes them.",
        "3-Repetition Maximum Deadlift (MDL), Hand-Release Push-up (HRP), Sprint-Drag-Carry (SDC), Plank (PLK), then the 2-Mile Run (2MR) last.",
        SRC_BOTH,
        "The 5 AFT events, in test order"]
    ];

    bank.board = bank.board || { questions: [] };
    bank.board.questions = Array.isArray(bank.board.questions) ? bank.board.questions : [];
    var qIds = new Set(bank.board.questions.map(function (q) { return q.id; }));
    cards.forEach(function (x) {
      if (qIds.has(x[0])) return;
      bank.board.questions.push({
        id: x[0], category: CATEGORY, q: x[1], a: x[2], boardAnswer: x[2], source: x[3],
        concept: x[4], keyPoints: [x[2]], difficulty: "basic"
      });
      qIds.add(x[0]);
    });
  });
})();
// END 11-aft-event-scoring-content.js
