/* GUIDON 1.14.2 "What's new" entry.
   See 99-release-v1110.js for why these live in small build-added files and
   for the WRITING RULE every entry follows: plain words, what a Soldier will
   notice and where, never how it was built - and never a feature that is not
   on a screen they can reach. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.14.2"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.14.2",
    date: "September 2026",
    title: "Search finds a lot more of the app now",
    highlights: [
      "Search now finds screens by what they do, not just their name - try \"PCS\", \"TSP\", or \"dark mode\" - and can take you straight to a specific Settings option, not just the Settings page.",
    ],
  });
})();
