/* GUIDON v1.11.0 release note.
   Kept as a tiny build-injected module so release-note maintenance does not
   require replacing the multi-megabyte src/index.html through remote APIs. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.11.0"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.11.0",
    date: "September 2026",
    title: "Board depth, OPSEC safeguards, and adaptive memorization",
    highlights: [
      "Promotion-board study now includes the full new core and 92A question set, with logistics-focused practice available throughout Board Drill, quizzes, weak-area review, group study, and the handheld flashcard export.",
      "New Cybersecurity & OPSEC study material adds practical scenarios, board questions, key terms, and a self-check, while MOI and roster tools add stronger warnings and local safeguards against sensitive information.",
      "Spirit of the CAV is now available as memorization material, with an optional Adaptive Recall Ladder that starts off disabled and never replaces your existing study methods.",
      "This release is packaged from one tagged source across web/PWA and standalone, Android, Windows, macOS, iOS parity verification, and the ESP32 flashcard fork.",
    ],
  });
})();
