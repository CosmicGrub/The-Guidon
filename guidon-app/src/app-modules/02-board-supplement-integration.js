/* GUIDON - final promotion-board supplement integration pass.
   Runs after both intake decks (alphabetical module order). It adds MOS/pillar
   metadata to the 92A lane and exposes an audit summary proving all 112
   supplied source cards / 224 Q&A prompts were considered by the merge.
*/
(function () {
  "use strict";
  var G = window.G = window.G || {};
  var seed = window.GUIDON_SEED;
  if (!seed || !seed.board || !Array.isArray(seed.board.questions)) return;

  var links = 0, uniqueSourceCards = new Set(), mosQuestions = 0;
  seed.board.questions.forEach(function (q) {
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

  G.boardSupplement = G.boardSupplement || {};
  G.boardSupplement.audit = {
    expectedSourceCards: 112,
    expectedQAPrompts: 224,
    accountedSourceCards: uniqueSourceCards.size,
    accountedQAPromptLinks: links,
    mos92aQuestions: mosQuestions,
    complete: uniqueSourceCards.size === 112 && links === 224
  };

  if (!G.boardSupplement.audit.complete) {
    console.error("GUIDON board supplement intake incomplete", G.boardSupplement.audit);
  }
})();
