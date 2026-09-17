/* GUIDON - restamp board.contentHash after runtime supplement merge.
   tools/build.mjs hashes the inline seed before app-modules are injected.
   Because 00/01 add or reconcile cards afterward, keep study-room bankSig
   content-sensitive by hashing the final canonical id/category/q/a surface.
   Two independent FNV-1a accumulators produce the same 16-hex shape used by
   the build stamp; this is a compatibility fingerprint, not a security hash.
*/
(function () {
  "use strict";
  var seed = window.GUIDON_SEED;
  var qs = seed && seed.board && Array.isArray(seed.board.questions) ? seed.board.questions : null;
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
  seed.board.contentHash = hex(h1) + hex(h2);
  if (window.G && window.G.boardSupplement && window.G.boardSupplement.audit) {
    window.G.boardSupplement.audit.contentHash = seed.board.contentHash;
  }
})();
