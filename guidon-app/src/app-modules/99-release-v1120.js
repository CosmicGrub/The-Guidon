/* GUIDON v1.12.0 release note.
   Leader-readiness release: collective training, PT planning, Board Simulator,
   and the remaining roadmap study-content gaps. */
window.G = window.G || {};
(function () {
  "use strict";
  if (!G.whatsNew || !Array.isArray(G.whatsNew.RELEASE_NOTES)) return;
  if (G.whatsNew.RELEASE_NOTES.some(function (x) { return x && x.version === "1.12.0"; })) return;
  G.whatsNew.RELEASE_NOTES.push({
    version: "1.12.0",
    date: "September 2026",
    title: "Leader readiness, team training, and PT planning",
    highlights: [
      "Team Training now includes a complete 10-exercise catalog and a shared Collective Decision mode that turns existing scenarios into discuss-then-commit group lanes without creating a second scenario engine.",
      "The new PT Planner provides persistent day, week, and month planning, editable templates, reminders, leader exports, an advisory hard-to-recovery guard, recent-history context, and canonical strength/endurance PRT session blocks with unauthored drills labeled honestly as content pending.",
      "Board Simulator now links reporting-procedure rehearsal, the existing Mock Board knowledge round, judgment scenarios, and an AAR into one offline progression while preserving local-MOI differences instead of inventing a universal script.",
      "Board readiness content closes the remaining roadmap gaps for AER, ACS, SUDCC, current CSDP, and the current DA Form 7923 Statement of Charges, while keeping the existing six-pillar taxonomy, regulation filters, 5-Minute Board Reps, and Integrated Operational Thinking scenarios intact."
    ],
  });
})();