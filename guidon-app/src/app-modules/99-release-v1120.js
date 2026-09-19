/* GUIDON 1.12.0 "What's new" entry.
   See 99-release-v1110.js for why these live in small build-added files and
   for the WRITING RULE every entry follows: plain words, what a Soldier will
   notice and where, never how it was built - and never a feature that is not
   on a screen they can reach. (This entry used to read like a changelog for
   developers; the facts are the same, the words are for the people using
   the app.) */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.12.0"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.12.0",
    // This number was prepared on main but never cut as a tagged release.
    // The entry stays so anyone who updates past it still hears what it
    // added; tools/lint-release-state.mjs requires the mark (and fails if a
    // v1.12.0 tag ever appears while it is still here).
    released: false,
    date: "September 2026",
    title: "Team training, a PT planner, and a full practice board",
    highlights: [
      "New: Team Training. Short exercises for a squad or study group - talk a decision over together, then lock in one answer.",
      "New: PT Planner. Lay out your PT by day, week, or month, set reminders, and get a heads-up when hard days start to outnumber recovery days.",
      "New: Board Simulator. Practice reporting in, answer board questions, work a leadership problem, then write your own after-action notes.",
      "More board questions on Army Emergency Relief, Army Community Service, and supply discipline.",
    ],
  });
})();
