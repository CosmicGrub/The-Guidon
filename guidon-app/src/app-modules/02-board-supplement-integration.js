/* GUIDON - final promotion-board supplement integration pass.
   Runs after both intake decks (manifest order). It adds MOS/pillar metadata
   to the 92A lane and exposes an audit summary proving all 112 supplied
   source cards / 224 Q&A prompts were considered by the merge.

   ROADMAP 3g E: the audit object used to hang off window.G.boardSupplement.
   It is attached to 00-board-supplement-core.js's own shared boardSupplement
   object (reached through ctx.pack("board-supplement-core"), since this
   file's manifest entry declares that id under "requires") and ALSO returned
   from this file's own define() call, so 98-content-pack-finalize.js can
   reach it either way through ctx.pack("board-supplement-integration").
*/
(function () {
  "use strict";
  G.contentPack.define("board-supplement-integration", function (bank, ctx) {
  if (!bank || !bank.board || !Array.isArray(bank.board.questions)) return { audit: null };

  var links = 0, uniqueSourceCards = new Set(), mosQuestions = 0;
  bank.board.questions.forEach(function (q) {
    var sc = Array.isArray(q.sourceCards) ? q.sourceCards : [];
    sc.forEach(function (id) {
      if (/^(core72|deck40-general|deck40-92a)-/.test(id)) {
        links++;
        uniqueSourceCards.add(id);
      }
    });
    if (sc.some(function (id) { return /^deck40-92a-/.test(id); })) {
      q.mos = ["92A"];
      q.curriculum = ["92A Promotion Board"];
      q.pillar = "Maintenance & Supply";
      mosQuestions++;
    }
  });

  var audit = {
    expectedSourceCards: 112,
    expectedQAPrompts: 224,
    accountedSourceCards: uniqueSourceCards.size,
    accountedQAPromptLinks: links,
    mos92aQuestions: mosQuestions,
    complete: uniqueSourceCards.size === 112 && links === 224
  };
  var core = ctx.pack("board-supplement-core");
  if (core && core.boardSupplement) core.boardSupplement.audit = audit;

  if (!audit.complete) {
    console.error("GUIDON board supplement intake incomplete", audit);
  }
  return { audit: audit };
  });
})();
