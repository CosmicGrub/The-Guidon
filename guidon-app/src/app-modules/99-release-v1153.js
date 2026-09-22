/* GUIDON 1.15.3 "What's new" entry.
   See 99-release-v1110.js for why these live in small build-added files and
   for the WRITING RULE every entry follows: plain words, what a Soldier will
   notice and where, never how it was built - and never a feature that is not
   on a screen they can reach. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.15.3"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.15.3",
    date: "September 2026",
    title: "A small internal cleanup",
    highlights: [
      "No visible changes this update - Board Simulator's scenario steps now get a clean, direct signal when you finish one, instead of a workaround.",
    ],
  });
})();
