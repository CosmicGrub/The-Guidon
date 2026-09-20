/* GUIDON 1.13.0 "What's new" entry.
   See 99-release-v1110.js for why these live in small build-added files and
   for the WRITING RULE every entry follows: plain words, what a Soldier will
   notice and where, never how it was built - and never a feature that is not
   on a screen they can reach. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.13.0"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.13.0",
    date: "September 2026",
    title: "Cybersecurity Fundamentals, MOS decks, and a safer backup",
    highlights: [
      "A new \"Cybersecurity Fundamentals\" section on the Cybersecurity & OPSEC screen: ransomware, insider threats, AI scams and deepfakes, telework security, smart devices, secure spaces, and safe use of military AI tools.",
      "MOS-specific board content (92A first, more to come) now has its own \"MOS Decks\" toggle in Settings and its own Readiness row - off by default, so it only shows up for the job it's actually for, or once you turn it on.",
      "Exporting a backup now lets you choose to include your leader roster and any saved Risk Worksheets - left out by default, included only if you check the box (moving to a new device, for example).",
      "The Risk Worksheet's synthetic-data reminder now comes before the quick-start templates, not after, so you see it before you start typing.",
      "The PT session builder's exercise names now match PT Planner's own wording exactly, and any drill without a fully sourced exercise list says so plainly instead of showing content that hasn't been verified yet.",
    ],
  });
})();
