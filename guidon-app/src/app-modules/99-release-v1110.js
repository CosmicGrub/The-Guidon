/* GUIDON 1.11.0 "What's new" entry.
   Kept as a tiny build-added file so a release note never requires editing
   the multi-megabyte src/index.html. Load order does not matter: G.whatsNew
   finds and sorts entries by version number, never by position.

   WRITING RULE (see G.whatsNew's own header in src/index.html): this is read
   by Soldiers, not developers. Say what they will notice and where to find
   it, in plain words. Never describe how something was built, tested or
   packaged, and never announce something that is not on a screen they can
   reach. tools/lint-patterns.mjs check (h) rejects build/engineering wording
   here. This entry was rewritten on those terms: it used to advertise a
   memorization feature no screen offers, and said the app was "packaged from
   one tagged source" for platforms that were never built. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.11.0"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.11.0",
    // This number was prepared on main but never cut as a tagged release.
    // The entry stays so anyone who updates past it still hears what it
    // added; tools/lint-release-state.mjs requires the mark (and fails if a
    // v1.11.0 tag ever appears while it is still here).
    released: false,
    date: "September 2026",
    title: "More board questions, cybersecurity and OPSEC, and new ways to memorize",
    highlights: [
      "Many more board questions across the subjects you already study, plus new supply question sets for 92A Soldiers. They show up in Board Drill, quizzes, and weak-area review.",
      "New in the menu: Cybersecurity & OPSEC, with scenarios, board questions, key terms, and a short self-check on protecting sensitive information.",
      "GUIDON now reminds you to keep sensitive information out of MOI imports and rosters. Everything you enter still stays on your device.",
      // Every promise in this line has a screen behind it (Recitation Drill's
      // "Recall ladder" mode and "My unit" section; four Army History cards)
      // - the first wording promised a ladder no screen showed, and a unit
      // song GUIDON has no right to hand out.
      "Recitation Drill has an optional Recall ladder that hides more of the words as you improve, and a My unit section where you can add your own unit song, creed or motto. Your own text stays on this device. 1st Cavalry Division heritage questions join Army History in Board Drill.",
    ],
  });
})();
