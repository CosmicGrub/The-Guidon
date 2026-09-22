/* GUIDON 1.14.0 "What's new" entry.
   See 99-release-v1110.js for why these live in small build-added files and
   for the WRITING RULE every entry follows: plain words, what a Soldier will
   notice and where, never how it was built - and never a feature that is not
   on a screen they can reach. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.14.0"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.14.0",
    date: "September 2026",
    title: "Build-your-own PT sessions, flexible screen layouts, and a smarter MOI Import",
    highlights: [
      "PT Planner: build your own PT session from the drills GUIDON has — add them, put them in the order you want, save it, and it works everywhere a regular session does.",
      "PT Planner and Career Calendar can each be shown a different way now — open Settings → Screen Layouts to try \"Tasking Board\" or \"The Zero Board\" alongside the screen you already know.",
      "Six new themes, all chosen to be easy on the eyes for long study sessions — see them in Settings → Theme.",
      "MOI Import can now hold more than one imported MOI at a time, and shows you exactly what changed — topics added, removed, or updated — when you re-import a revised one.",
      "An imported MOI can show its own board-date countdown and remind you before the board, right on the MOI screen.",
      "MOI Import now shows how sure it is about each matched citation, and can optionally narrow Board Drill and Doctrine down to just what your MOI actually assigns — off unless you turn it on.",
      "MOI Import now recognizes UCMJ Article citations, not just regulation and manual numbers.",
      "Leaders can attach a shared MOI to their roster and see which Soldiers have been briefed on it — dates only, never anyone's own study details.",
    ],
  });
})();
