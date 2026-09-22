/* GUIDON 1.15.0 "What's new" entry.
   See 99-release-v1110.js for why these live in small build-added files and
   for the WRITING RULE every entry follows: plain words, what a Soldier will
   notice and where, never how it was built - and never a feature that is not
   on a screen they can reach. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.15.0"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.15.0",
    date: "September 2026",
    title: "Cleaner citations under the hood",
    highlights: [
      "Doctrine, Creeds, PRT, and Scenario Training citations are now tracked more precisely behind the scenes - you may notice a few source lines read a little differently, but nothing you study has changed.",
    ],
  });
})();
