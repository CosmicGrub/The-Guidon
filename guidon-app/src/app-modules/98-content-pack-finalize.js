/* GUIDON - content-pack finalize pass. Runs AFTER every numbered content pack
   (alphabetical module order; only the 99-release-* notes follow it) and
   BEFORE the app boots, so everything downstream sees one finished bank.

   Why it exists (audit of the 2026-09 content packs): packs push records
   straight into window.GUIDON_SEED. Two jobs were being done badly, by
   hand, in more than one place:

   1. PILLAR TAGS. The six-pillar taxonomy has exactly one definition,
      tools/pillar-map.mjs, which the seed is linted against. Packs cannot
      import a Node tool, so the first pack carried a hand-copied table - it
      had already drifted (it lacked "Discipline", leaving two live cards out
      of the pillar filter and the Readiness rollup). The build now injects
      that one definition as window.GUIDON_PILLAR_MAP (tools/build.mjs, and
      tools/assemble-bank.mjs for headless tooling), and this pass applies
      it to every record a pack added. A pack never needs to know the
      taxonomy; the map is authoritative, so a hand-set tag that disagrees
      is corrected here and reported by tools/lint-content-packs.mjs.

   2. THE BANK FINGERPRINT. Study rooms compare board.contentHash so two
      devices know they hold the same deck. tools/build.mjs stamps it from
      the STATIC seed; packs add cards afterwards, so it has to be restamped
      from the final bank. The earlier restamp (03-board-supplement-
      bankhash.js) ran fourth of fifteen modules: every pack loading after
      it - Spirit of the CAV, the OPSEC curriculum, the Army-program and
      supply cards - changed the deck without changing its fingerprint.
      Same two-accumulator FNV-1a shape as before (a compatibility
      fingerprint, not a security hash), computed once, last.

   No DOM, no G.* dependencies: it must run identically in the page and in
   tools/assemble-bank.mjs's headless sandbox.
*/
(function () {
  "use strict";
  var seed = window.GUIDON_SEED;
  if (!seed || !seed.board || !Array.isArray(seed.board.questions)) return;
  var map = window.GUIDON_PILLAR_MAP || null;
  var stats = { board: 0, doctrine: 0, scenarios: 0, corrected: 0 };
  var corrections = [];

  function apply(list, want, key) {
    if (!map || !Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r) continue;
      var p = want(r);
      if (!p) continue;
      if (r.pillar === p) continue;
      if (r.pillar != null) { stats.corrected++; corrections.push({ kind: key, id: r.id, from: r.pillar, to: p }); }
      r.pillar = p;
      stats[key]++;
    }
  }
  if (map) {
    apply(seed.board.questions, function (q) { return (map.category || {})[q.category] || null; }, "board");
    apply(seed.doctrine && seed.doctrine.entries, function (e) { return (map.doctrineId || {})[e.id] || (map.topic || {})[e.topic] || null; }, "doctrine");
    // Same lane rule as tools/pillar-map.mjs pillarForScenario(); the lint's
    // rule (f2) runs the REAL function over the assembled bank, so if this
    // copy of four lines ever drifts from it, the lint fails.
    apply(seed.scenarios && seed.scenarios.scenarios, function (s) {
      if ((map.scenarioId || {})[s.id]) return map.scenarioId[s.id];
      if (/^sc-iot-/.test(s.id)) return "Doctrinal Thinking";
      if (/^sc-(tccc|medevac|opsec|cyber|cui)-/.test(s.id)) return null;
      if (s.defaultMode === "training") return "Programs & Support";
      return "Leadership & Counseling";
    }, "scenarios");
  }

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
  var qs = seed.board.questions;
  for (var k = 0; k < qs.length; k++) { feed(qs[k].id); feed(qs[k].category); feed(qs[k].q); feed(qs[k].boardAnswer || qs[k].a); }
  function hex(n) { return ("00000000" + (n >>> 0).toString(16)).slice(-8); }
  seed.board.contentHash = hex(h1) + hex(h2);

  var G = window.G = window.G || {};
  G.contentPacks = G.contentPacks || {};
  G.contentPacks.finalized = { pillarsApplied: stats, corrections: corrections, cards: qs.length, contentHash: seed.board.contentHash, hadMap: !!map };
  if (G.boardSupplement && G.boardSupplement.audit) G.boardSupplement.audit.contentHash = seed.board.contentHash;
})();
