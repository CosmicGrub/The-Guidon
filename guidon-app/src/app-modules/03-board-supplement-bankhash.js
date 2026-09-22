/* GUIDON - restamp board.contentHash after the supplement merge.
   tools/build.mjs's seedAsJsonParse() hashes the seed before content packs
   run; because 00/01 add or reconcile cards, keep study-room bankSig
   content-sensitive by hashing the final canonical id/category/q/a surface.
   Two independent FNV-1a accumulators produce the same 16-hex shape used by
   the build stamp; this is a compatibility fingerprint, not a security hash.

   ROADMAP 3g E: reads/writes `bank` (the mutable seed tree passed to every
   content pack's builder) instead of window.GUIDON_SEED, and reaches the
   integration pass's audit object through ctx.pack("board-supplement-
   integration") instead of window.G.boardSupplement.audit.
*/
(function () {
  "use strict";
  G.contentPack.define("board-supplement-bankhash", function (bank, ctx) {
  var qs = bank && bank.board && Array.isArray(bank.board.questions) ? bank.board.questions : null;
  if (!qs) return;
  var h1 = 0x811c9dc5 >>> 0, h2 = 0x9e3779b9 >>> 0;
  function feed(s) {
    s = String(s == null ? "" : s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= (c + i) & 0xffff; h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
    h1 ^= 31; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= 127; h2 = Math.imul(h2, 0xc2b2ae35) >>> 0;
  }
  qs.forEach(function (q) { feed(q.id); feed(q.category); feed(q.q); feed(q.boardAnswer || q.a); });
  function hex(n) { return ("00000000" + (n >>> 0).toString(16)).slice(-8); }
  bank.board.contentHash = hex(h1) + hex(h2);
  var integration = ctx.pack("board-supplement-integration");
  if (integration && integration.audit) integration.audit.contentHash = bank.board.contentHash;
  });
})();
