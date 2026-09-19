/* GUIDON — current supply-discipline board gap closure.
 * Verified 2026-09-18 against current Army sources:
 * - CSDP is under AR 710-4 in current command policy.
 * - DA Form 7923 (MAR 2024) is the current Statement of Charges /
 *   Cash Collection Voucher and points to AR 735-5.
 * Additive runtime cards only; no legacy content is overwritten.
 */
(function () {
  "use strict";
  var seed = window.GUIDON_SEED;
  var list = seed && seed.board && Array.isArray(seed.board.questions) ? seed.board.questions : null;
  if (!list) return;
  var have = new Set(list.map(function (q) { return q && q.id; }));
  function add(q) { if (q && !have.has(q.id)) { list.push(q); have.add(q.id); } }

  add({
    id:"supply-csdp-current-1",
    category:"Supply & Property",
    q:"What is the Command Supply Discipline Program (CSDP), and what regulation currently provides its property-accountability framework?",
    a:"CSDP is a commander's program used to establish and enforce supply discipline, supervisory responsibility, accountability, and compliance with Army supply policy. Current Army command policy cites AR 710-4, Property Accountability, for CSDP.",
    acceptableAnswer:"A commander's supply-discipline and accountability program; current policy cites AR 710-4.",
    boardAnswer:"Sergeant Major, the Command Supply Discipline Program is a commander's program for enforcing supply discipline, supervisory responsibility, accountability, and compliance with Army supply policy. Current Army command policy implements CSDP under AR 710-4, Property Accountability.",
    concept:"Current CSDP purpose and governing framework",
    keyPoints:[
      "CSDP is a commander's program, not merely a supply-room inspection checklist.",
      "It establishes command, supervisory, and managerial responsibility for supply discipline and property accountability.",
      "Current 2025 Army command policy cites AR 710-4, Property Accountability, as the governing reference."
    ],
    source:"AR 710-4, Property Accountability; USARJ Command Policy Memorandum 25-14, CSDP (7 Jul 2025)",
    difficulty:"intermediate",
    pillar:"Maintenance & Supply",
    tier:["E4","E5","E6"],
    tags:["csdp","property-accountability","supply-discipline","ar-710-4"]
  });

  add({
    id:"supply-statement-charges-7923",
    category:"Supply & Property",
    q:"What is the current Army form for a Statement of Charges/Cash Collection Voucher?",
    a:"DA Form 7923, Statement of Charges/Cash Collection Voucher, dated March 2024.",
    acceptableAnswer:"DA Form 7923.",
    boardAnswer:"Sergeant Major, the current Statement of Charges/Cash Collection Voucher is DA Form 7923, dated March 2024. The form directs users to AR 735-5.",
    concept:"Current Statement of Charges form",
    keyPoints:[
      "Use DA Form 7923 for the current Statement of Charges/Cash Collection Voucher.",
      "DA Form 7923 is dated March 2024.",
      "The form itself states that AR 735-5 governs its use.",
      "Older study material naming DD Form 362 should not be treated as the current form."
    ],
    source:"DA Form 7923 (MAR 2024), Statement of Charges/Cash Collection Voucher; AR 735-5",
    difficulty:"basic",
    pillar:"Maintenance & Supply",
    tier:["E4","E5","E6"],
    tags:["statement-of-charges","da-form-7923","flipl","property-accountability","ar-735-5"]
  });

  add({
    id:"supply-statement-charges-use",
    category:"Supply & Property",
    q:"When is a Statement of Charges/Cash Collection Voucher used instead of treating every property loss as a FLIPL?",
    a:"It is a voluntary settlement path when the responsible person admits liability and agrees to cash collection or payroll deduction, when the loss does not require a mandatory FLIPL or other investigation under the governing policy.",
    acceptableAnswer:"When liability is admitted voluntarily and the case does not require a mandatory FLIPL; payment is made by cash collection or payroll deduction.",
    boardAnswer:"Sergeant Major, a Statement of Charges is a voluntary settlement method. It may be used when the responsible individual admits liability and agrees to cash collection or payroll deduction, provided the circumstances do not require a mandatory FLIPL or other investigation.",
    concept:"Statement of Charges versus FLIPL",
    keyPoints:[
      "Signing a Statement of Charges is an admission of liability and authorization for collection.",
      "Current Army property-book procedures use DA Form 7923 for this purpose.",
      "A mandatory FLIPL or other required investigation cannot be bypassed by simply choosing a Statement of Charges."
    ],
    source:"DA Form 7923 (MAR 2024); AR 735-5; current Army installation property-accountability procedures (2025-2026)",
    difficulty:"intermediate",
    pillar:"Maintenance & Supply",
    tier:["E4","E5","E6"],
    tags:["statement-of-charges","da-form-7923","flipl","financial-liability","property-accountability"]
  });

  window.G = window.G || {};
  window.G.supplyDisciplineGapCards = {
    ids:["supply-csdp-current-1","supply-statement-charges-7923","supply-statement-charges-use"],
    verifiedAsOf:"2026-09-18"
  };
})();