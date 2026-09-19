/* GUIDON 1.12.1 "What's new" entry.
   See 99-release-v1110.js for why these live in small build-added files and
   for the WRITING RULE every entry follows: plain words, what a Soldier will
   notice and where, never how it was built - and never a feature that is not
   on a screen they can reach.

   1.12.1 is the first version since 1.10.1 that was actually cut as a
   release for every device; 1.11.0 and 1.12.0 were prepared and then
   superseded by this one, so their entries stay marked `released: false`
   and a Soldier who skipped them still sees what they added. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.12.1"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.12.1",
    date: "September 2026",
    title: "A round of fixes for the newest tools",
    highlights: [
      "PT Planner saves the day you actually picked, keeps changes you made to single dates, asks before replacing your week, and clears out old PT reminders instead of stacking them up on Home.",
      "Board Simulator and Team Training now work for every rank, and a practice step only counts once you have really done it.",
      "Study Rooms can mix up to 12 subjects in one room, and everyone in the room drills the same cards.",
      "Board Drill answers were checked again against current regulations. Subjects that showed up twice under different names are now one subject, and study-guide answers are labeled as study-guide answers.",
      "Pasting into MOI Import never changes or removes your text. GUIDON points out anything that looks sensitive and lets you decide what to do.",
      "On a phone, the Board Drill filter rows each stay on one line you can swipe, so the flashcard sits closer to the top.",
    ],
  });
})();
