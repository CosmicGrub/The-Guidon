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
    title: "Board depth, OPSEC safeguards, and new ways to memorize",
    highlights: [
      "Promotion-board study now includes the full new core and 92A question set, with logistics-focused practice available throughout Board Drill, quizzes, weak-area review, group study, and the handheld flashcard export.",
      "New Cybersecurity & OPSEC study material adds practical scenarios, board questions, key terms, and a self-check, while MOI and roster tools add stronger warnings and local safeguards against sensitive information.",
      // Every promise in this line has a screen behind it (Recitation Drill's
      // "Recall ladder" mode and "My unit" section; four Army History cards)
      // - the first wording promised a ladder no screen showed, and a unit
      // song GUIDON has no right to hand out.
      "Recitation Drill has an optional Recall ladder that hides more of the words as you improve, and a My unit section where you can add your own unit song, creed or motto. Your own text stays on this device. 1st Cavalry Division heritage questions join Army History in Board Drill.",
      "This release is packaged from one tagged source across web/PWA and standalone, Android, Windows, macOS, iOS parity verification, and the ESP32 flashcard fork.",
    ],
  });
})();
