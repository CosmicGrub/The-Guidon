/* GUIDON 1.15.7 "What's new" entry.
   See 99-release-v1110.js for why these live in small build-added files and
   for the WRITING RULE every entry follows: plain words, what a Soldier will
   notice and where, never how it was built - and never a feature that is not
   on a screen they can reach. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.15.7"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.15.7",
    date: "September 2026",
    title: "Board Drill's filters are easier to browse, and fullscreen study feels smoother",
    highlights: [
      "Board Drill's category and regulation filters now follow your pillar pick - pick a pillar and only its own categories show up, pick a category and only its own regulations do. Every category is still one tap away in \"Jump to category.\"",
      "Fullscreen study now grows into place instead of snapping - fold your phone into a tighter screen or tap the fullscreen button and the card smoothly fills the space.",
    ],
  });
})();
