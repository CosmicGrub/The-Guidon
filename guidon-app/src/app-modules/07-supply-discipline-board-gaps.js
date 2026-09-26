/* GUIDON — current supply-discipline board gap closure.
 * Checked 2026-09-19 against the Army Publishing Directorate PDFs of the
 * CURRENT editions:
 * - AR 710-4, Property Accountability (15 Apr 2026), chapter 3, section I
 *   establishes the Command Supply Discipline Program. AR 710-2 (1 Jul
 *   2024), para 2-3, only points to AR 710-4 for it.
 * - AR 735-5, Relief of Responsibility and Accountability (30 Apr 2026)
 *   uses DA Form 7923, Statement of Charges/Cash Collection Voucher
 *   (para 4-7c, chapter 6). DD Form 362 does not appear in it at all.
 * A pack that corrects a fact must not leave the old fact in the bank: the
 * seed records these cards used to contradict (prop-8's "DD Form 362", and
 * doctrine entry doc-maint-3's "CSDP (AR 710-2)") were corrected in the same
 * change. Answers are study-guide wording, so each card's citation is cited
 * as "paraphrase" (it used to be flagged verbatim:false).
 */
(function () {
  "use strict";
  G.contentPack.define("supply-discipline-board-gaps", function (bank, ctx) {
  var list = bank && bank.board && Array.isArray(bank.board.questions) ? bank.board.questions : null;
  if (!list) return;
  var have = new Set(list.map(function (q) { return q && q.id; }));
  function add(q) { if (q && !have.has(q.id)) { q.source = ctx.cite(q.source, "paraphrase"); list.push(q); have.add(q.id); } }

  add({
    id:"supply-csdp-current-1",
    category:"Supply & Property",
    q:"What is the Command Supply Discipline Program (CSDP), and which regulation establishes it?",
    a:"The CSDP is a commander's program: a compilation of existing supply requirements, brought together for visibility, that standardizes supply discipline across the Army and spells out supervisory and managerial responsibilities within the supply system. AR 710-4, Property Accountability, chapter 3, establishes it.",
    acceptableAnswer:"A commander's program that pulls existing supply-discipline requirements into one place and standardizes them; AR 710-4, chapter 3.",
    boardAnswer:"Sergeant Major, the Command Supply Discipline Program is a commander's program. It compiles existing regulatory supply requirements for visibility, standardizes supply discipline across the Army, and addresses supervisory and managerial responsibilities from the user level up. It is established by AR 710-4, Property Accountability, chapter 3.",
    concept:"Current CSDP purpose and governing regulation",
    keyPoints:[
      "The CSDP is a commander's program, run with existing resources such as the command inspection program - commanders do not stand up new evaluation teams for it (AR 710-4, para 3-1b).",
      "Purpose (para 3-2): establish supply discipline policy, standardize the requirements, give responsible personnel a single listing of them, and save time spent monitoring subordinates.",
      "It is four-fold (para 3-3d): commanders' responsibilities, supervisory personnel's responsibilities, guidance and feedback for evaluating supply discipline, and followup.",
      "The requirements listing and evaluation checklist is DA Form 7768 (para 3-1d).",
      "AR 710-2 (1 Jul 2024), para 2-3, sends readers to AR 710-4 for CSDP policy - study material that cites AR 710-2 alone for the CSDP is out of date."
    ],
    source:"AR 710-4 (15 Apr 2026), chapter 3, paras 3-1 to 3-3",
    difficulty:"intermediate",
    pillar:"Maintenance & Supply",
    tier:["E4","E5","E6"],
    tags:["csdp","property-accountability","supply-discipline","ar-710-4"]
  });

  add({
    id:"supply-statement-charges-7923",
    category:"Supply & Property",
    q:"What is the current Army form for a Statement of Charges/Cash Collection Voucher?",
    a:"DA Form 7923, Statement of Charges/Cash Collection Voucher.",
    acceptableAnswer:"DA Form 7923.",
    boardAnswer:"Sergeant Major, the current Statement of Charges/Cash Collection Voucher is DA Form 7923. AR 735-5 governs its use.",
    concept:"Current Statement of Charges form",
    keyPoints:[
      "Use DA Form 7923 for a Statement of Charges/Cash Collection Voucher.",
      "AR 735-5 (30 Apr 2026) has leaders initiate it when damage or loss came from negligence, misconduct, or other than official business (para 4-7c), and chapter 6 covers how it is processed.",
      "The current AR 735-5 does not mention DD Form 362 anywhere - older study material that names it for the Army statement of charges is out of date."
    ],
    source:"AR 735-5 (30 Apr 2026), para 4-7c and chapter 6",
    difficulty:"basic",
    pillar:"Maintenance & Supply",
    tier:["E4","E5","E6"],
    tags:["statement-of-charges","da-form-7923","flipl","property-accountability","ar-735-5"]
  });

  add({
    id:"supply-statement-charges-use",
    category:"Supply & Property",
    q:"When is a Statement of Charges/Cash Collection Voucher used instead of treating every property loss as a FLIPL?",
    a:"It is a voluntary settlement path: the individual voluntarily admits liability and offers to pay, the loss is within the voluntary-payment limit of one month's base pay, the item is not a classified or sensitive item, and nothing makes a FLIPL or an AR 15-6 investigation mandatory.",
    acceptableAnswer:"When liability is admitted voluntarily, the amount is not more than one month's base pay, the item is not classified or sensitive, and no FLIPL or AR 15-6 investigation is mandatory.",
    boardAnswer:"Sergeant Major, a Statement of Charges is a voluntary settlement method under AR 735-5, chapter 6. It may be used when the individual voluntarily admits liability and offers reimbursement, the value does not exceed one month's base pay, the property is not a classified or sensitive item, and there is no mandatory requirement for a FLIPL or an AR 15-6 investigation.",
    concept:"Statement of Charges versus FLIPL",
    keyPoints:[
      "All four conditions of AR 735-5 para 6-2 must be met: voluntary admission and offer to pay, value within the para 6-3 limit, not a classified or sensitive item, and no mandatory FLIPL or AR 15-6 investigation.",
      "Para 6-3: the voluntary payment limit is one month's base pay (one-twelfth of annual salary for a DA Civilian).",
      "Payment is voluntary - an individual cannot be coerced or threatened with adverse action for declining, and once made it cannot be withdrawn (para 6-1).",
      "An individual may also sign a DA Form 7923 after a FLIPL has started; if the loss qualifies, the FLIPL may then be cancelled (para 7-2f)."
    ],
    source:"AR 735-5 (30 Apr 2026), paras 6-1 to 6-5 and 7-2f",
    difficulty:"intermediate",
    pillar:"Maintenance & Supply",
    tier:["E4","E5","E6"],
    tags:["statement-of-charges","da-form-7923","flipl","financial-liability","property-accountability"]
  });

  return {
    supplyDisciplineGapCards: {
      ids:["supply-csdp-current-1","supply-statement-charges-7923","supply-statement-charges-use"],
      verifiedAsOf:"2026-09-19"
    }
  };
  });
})();
