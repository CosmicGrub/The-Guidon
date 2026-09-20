/* GUIDON - content-pack finalize pass. Runs AFTER every content pack
 * (manifest order; only the 99-release-* notes follow it) and, since ROADMAP
 * 3g E, at BUILD TIME rather than in the browser - so everything downstream
 * sees one finished bank before the app ever ships.
 *
 * Why it exists (audit of the 2026-09 content packs): packs push records
 * straight into the seed. Two jobs were being done badly, by hand, in more
 * than one place:
 *
 * 1. PILLAR TAGS. The six-pillar taxonomy has exactly one definition,
 *    tools/pillar-map.mjs, which the seed is linted against. A pack cannot
 *    import a Node tool, so the first pack carried a hand-copied table - it
 *    had already drifted (it lacked "Discipline", leaving two live cards out
 *    of the pillar filter and the Readiness rollup). The build injects that
 *    one definition as window.GUIDON_PILLAR_MAP (tools/build.mjs, and
 *    tools/content-pack-engine.mjs for headless tooling), and this pass
 *    applies it to every record a pack added. A pack never needs to know the
 *    taxonomy; the map is authoritative, so a hand-set tag that disagrees is
 *    corrected here and reported by tools/lint-content-packs.mjs.
 *
 * 2. THE BANK FINGERPRINT. Study rooms compare board.contentHash so two
 *    devices know they hold the same deck. tools/build.mjs's seedAsJsonParse
 *    stamps a placeholder from the STATIC seed before any pack runs; this
 *    pass restamps it from the FINAL bank, once, last, after every content
 *    pack (including the earlier restamps in 03-board-supplement-bankhash.js
 *    and the two Cyber/OPSEC content packs) has already run. Same
 *    two-accumulator FNV-1a shape as before (a compatibility fingerprint,
 *    not a security hash), computed once, last.
 *
 * No DOM, no window.G dependencies: it must run identically whether
 * tools/build.mjs merges it into the shipped seed or a tool re-runs
 * tools/content-pack-engine.mjs against the same static seed later.
 */
(function () {
  "use strict";
  G.contentPack.define("content-pack-finalize", function (bank, ctx) {
  if (!bank || !bank.board || !Array.isArray(bank.board.questions)) return null;
  var map = (typeof window !== "undefined" && window.GUIDON_PILLAR_MAP) || null;
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
  // The one live "New" wave. theme.js's convention, enforced by
  // lint-board-taxonomy (g) and lint-content-packs (p9): exactly one
  // `since` value is live at a time, so the badge keeps meaning "added in
  // the release you just got". To rotate: replace the version and the
  // ids here, and remove any `since` still set in the seed or in a pack.
  var NEW_WAVE = { since: "v1.12.1", scenarioIds: [
    "sc-92a-critical-part-overdue", "sc-92a-inventory-discrepancy",
    "sc-collective-decision-relay", "sc-board-simulator-reporting",
    "sc-opsec-social-engineering", "sc-cyber-removable-media",
    "sc-opsec-fitness-tracking", "sc-cui-spillage-reporting",
  ] };
  var waveTagged = 0;
  ((bank.scenarios && bank.scenarios.scenarios) || []).forEach(function (sc) {
    if (sc && NEW_WAVE.scenarioIds.indexOf(sc.id) !== -1 && !sc.since) { sc.since = NEW_WAVE.since; waveTagged++; }
  });
  if (map) {
    apply(bank.board.questions, function (q) { return (map.category || {})[q.category] || null; }, "board");
    apply(bank.doctrine && bank.doctrine.entries, function (e) { return (map.doctrineId || {})[e.id] || (map.topic || {})[e.topic] || null; }, "doctrine");
    // Same lane rule as tools/pillar-map.mjs pillarForScenario(); the lint's
    // rule (f2) runs the REAL function over the assembled bank, so if this
    // copy of four lines ever drifts from it, the lint fails.
    apply(bank.scenarios && bank.scenarios.scenarios, function (s) {
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
  var qs = bank.board.questions;
  for (var k = 0; k < qs.length; k++) { feed(qs[k].id); feed(qs[k].category); feed(qs[k].q); feed(qs[k].boardAnswer || qs[k].a); }
  function hex(n) { return ("00000000" + (n >>> 0).toString(16)).slice(-8); }
  bank.board.contentHash = hex(h1) + hex(h2);

  var finalized = { newWave: { since: NEW_WAVE.since, expected: NEW_WAVE.scenarioIds.length, tagged: waveTagged }, pillarsApplied: stats, corrections: corrections, cards: qs.length, contentHash: bank.board.contentHash, hadMap: !!map };
  // Optional, "if present" - the same graceful degradation the original
  // window.G.boardSupplement check had (a fixture or a future build that
  // never runs board-supplement-integration must not fail here just because
  // this one audit-sync line has nothing to reach).
  if (ctx.hasPack("board-supplement-integration")) {
    var integration = ctx.pack("board-supplement-integration");
    if (integration && integration.audit) integration.audit.contentHash = bank.board.contentHash;
  }
  return finalized;
  });
})();
