/* GUIDON - 92A scenario-engine expansion.
   The source deck's final card contains two judgment scenarios. Keeping them
   only as recall prompts would leave teaching value on the table, so this
   module also expresses each one in the existing G.engine scenario schema.
   The original Q&A cards remain in board.questions for board/SRS practice.
*/
(function () {
  "use strict";
  var seed = window.GUIDON_SEED;
  var list = seed && seed.scenarios && Array.isArray(seed.scenarios.scenarios) ? seed.scenarios.scenarios : null;
  if (!list) return;
  var have = new Set(list.map(function (s) { return s.id; }));

  function add(sc) {
    if (!have.has(sc.id)) { list.push(sc); have.add(sc.id); }
  }

  add({
    id: "sc-92a-critical-part-overdue",
    title: "Critical Repair Part Is Overdue",
    tier: ["E4", "E5", "E6"],
    competency: ["Leads", "Intellect", "Achieves"],
    estMinutes: 3,
    difficulty: "Intermediate",
    doctrine: [{ ref: "AR 710-2", para: "4-26 (overdue deliveries) and 4-22 (requests and requisitions)", asOf: "2024-07" }],
    defaultMode: "cyoa",
    renderModes: ["text", "course", "cyoa"],
    scene: "SSA — a supported unit needs a critical repair part that is past its expected delivery date",
    start: "n1",
    mos: ["92A"],
    curriculum: ["92A Promotion Board"],
    pillar: "Maintenance & Supply",
    nodes: {
      n1: { prompt: "A customer tells you a mission-critical repair part is overdue and wants an immediate answer. What do you do first?", choices: [{ text: "Continue", goto: "n2" }] },
      n2: { prompt: "Choose the response that best combines accountability, system research, customer support, and follow-through.", choices: [
        { text: "Verify the requirement and priority, research the order/status and exceptions, identify the cause, coordinate through the proper supply channel, communicate an evidence-based status, and document follow-up.", goto: "end-good", score: { Leads: 2, Intellect: 3, Achieves: 3 }, feedback: "Start with facts in the system, then coordinate and close the loop." },
        { text: "Promise the customer a delivery time now so they know you are taking the problem seriously, then research the order later.", goto: "end-promise", score: { Leads: 0, Intellect: 0, Achieves: 0 }, feedback: "A confident answer is not useful if it is unsupported by the logistics record." },
        { text: "Submit another requisition immediately without researching the existing document so the customer has a second chance at receiving the part.", goto: "end-duplicate", score: { Leads: 0, Intellect: 0, Achieves: 0 }, feedback: "A duplicate action can create excess, cost, and record problems; research the existing requirement first." },
        { text: "Tell the customer the item is the supply system's problem and have them call higher support directly.", goto: "end-pass", score: { Leads: 0, Intellect: 1, Achieves: 0 }, feedback: "A 92A should research, coordinate, communicate, and follow through rather than simply passing the problem away." }
      ] },
      "end-good": { prompt: "", end: true, outcome: "You validate the requirement, find the order's real status and exception, coordinate the next authorized action, give the customer a factual update, and set a follow-up point. The requirement stays accountable and the customer knows what happens next." },
      "end-promise": { prompt: "", end: true, outcome: "The unsupported delivery promise becomes a second problem when the part does not arrive. You now have the original supply issue plus damaged customer trust." },
      "end-duplicate": { prompt: "", end: true, outcome: "The duplicate request obscures the original problem and can create excess or competing documents. Research and resolve the existing transaction before taking a new authorized supply action." },
      "end-pass": { prompt: "", end: true, outcome: "The customer still lacks a researched status, and the SSA loses the chance to resolve an exception inside its own process. Technical ownership means working the problem through the proper channel." }
    }
  });

  add({
    id: "sc-92a-inventory-discrepancy",
    title: "Inventory Count Does Not Match GCSS-Army",
    tier: ["E4", "E5", "E6"],
    competency: ["Character", "Intellect", "Achieves"],
    estMinutes: 3,
    difficulty: "Intermediate",
    doctrine: [{ ref: "AR 710-2", para: "6-5 (physical inventory and location survey) and 6-6 (discrepancies, causative research, adjustments)", asOf: "2024-07" }, { ref: "AR 735-5", para: "inventory adjustment reports and relief from responsibility", asOf: "2026-04" }],
    defaultMode: "cyoa",
    renderModes: ["text", "course", "cyoa"],
    scene: "SSA — a physical inventory count does not match the accountable system record",
    start: "n1",
    mos: ["92A"],
    curriculum: ["92A Promotion Board"],
    pillar: "Maintenance & Supply",
    nodes: {
      n1: { prompt: "During inventory, the physical quantity does not match the system. The section is busy and an adjustment would make the numbers agree. What do you do?", choices: [{ text: "Continue", goto: "n2" }] },
      n2: { prompt: "Choose the response that best protects accountability and solves the discrepancy.", choices: [
        { text: "Recount and verify the item identity, research locations and transaction history, notify the appropriate supervisor, document the findings, and process only the authorized corrective action.", goto: "end-good", score: { Character: 3, Intellect: 3, Achieves: 3 }, feedback: "Verify, research, document, elevate appropriately, then make only an authorized correction." },
        { text: "Adjust the system quantity to the physical count now so the inventory closes cleanly, then mention it to your supervisor later.", goto: "end-adjust", score: { Character: 0, Intellect: 1, Achieves: 0 }, feedback: "Making an unsupported adjustment destroys the audit trail and bypasses authorized discrepancy procedures." },
        { text: "Keep recounting the same location until someone gets the number the system expects.", goto: "end-force", score: { Character: 0, Intellect: 0, Achieves: 0 }, feedback: "Inventory exists to test the record against reality, not to force reality to match the record." },
        { text: "Ignore the mismatch because small quantity differences are normal in a busy warehouse.", goto: "end-ignore", score: { Character: 0, Intellect: 0, Achieves: 0 }, feedback: "Unresolved discrepancies compound and undermine accountability and readiness." }
      ] },
      "end-good": { prompt: "", end: true, outcome: "The recount confirms the discrepancy, transaction and location research identifies the likely cause, leadership is informed, and the authorized correction preserves the audit trail. The record is fixed for a reason, not merely made to balance." },
      "end-adjust": { prompt: "", end: true, outcome: "The books balance temporarily, but the unsupported adjustment hides why the discrepancy existed and creates an accountability problem of its own." },
      "end-force": { prompt: "", end: true, outcome: "Repeatedly counting toward an expected answer defeats the purpose of the inventory. The unexplained discrepancy remains and the record cannot be trusted." },
      "end-ignore": { prompt: "", end: true, outcome: "The unresearched mismatch remains in the account and can surface later as a larger shortage, excess, issue error, or readiness problem." }
    }
  });
})();
