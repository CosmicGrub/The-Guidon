/* GUIDON 1.15.6 "What's new" entry.
   See 99-release-v1110.js for why these live in small build-added files and
   for the WRITING RULE every entry follows: plain words, what a Soldier will
   notice and where, never how it was built - and never a feature that is not
   on a screen they can reach. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.15.6"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.15.6",
    date: "September 2026",
    title: "Your sidebar can now spotlight what matters to you",
    highlights: [
      "Turn on Nav Spotlight (offered right after setup, or any time in Settings) and your sidebar pins the routes that match what you're focused on to the top - nothing else moves or goes away, and it's one tap to turn back off.",
      "MOI Import now recognizes Army Directive citations, however your MOI writes them (abbreviated or spelled out) - including the one behind the current body composition and fitness test rules.",
    ],
  });
})();
