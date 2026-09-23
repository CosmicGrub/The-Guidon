/* GUIDON 1.16.0 "What's new" entry.
   See 99-release-v1110.js for why these live in small build-added files and
   for the WRITING RULE every entry follows: plain words, what a Soldier will
   notice and where, never how it was built - and never a feature that is not
   on a screen they can reach. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.16.0"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.16.0",
    date: "September 2026",
    title: "A bigger search, a real AFT calculator, and new study content for medics, senior NCOs, and NCOER writers",
    highlights: [
      "Search now covers the Army Dictionary, Forms, Counsel, IDP goals, and Health & Resilience too - and results are ranked by how well they match, not just by where they happen to sit in the app.",
      "The Fitness screen can now score your Army Fitness Test for you - enter your deadlift, push-ups, sprint-drag-carry, plank, and run, and it scores every event and adds them up, straight from the real official tables.",
      "68W Combat Medics get their own study deck - real board cards and two judgment-call scenarios on casualty collection, medical logistics, and scope of practice.",
      "Senior NCOs (E7/E8) get a new Master Leader Course prep screen and 41 board cards - the first study material this app has ever had above E6.",
      "PRT Drill now covers all five standard drills, not just the Preparation Drill - Conditioning Drill 1 & 2, Climbing Drill 1 & 2, and the Guerilla Drill, each with every exercise spelled out.",
      "The NCOER (DA Form 2166-9-2) worksheet is filled out - the Senior Rater section is there for the first time, and the rater performance rating no longer uses the wrong scale.",
      "You can now pin your favorite Board Drill categories for one-tap access, and those pins travel with you in a backup and restore.",
    ],
  });
})();
