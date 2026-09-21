/* ==== js/moi-import.js ==== */
/* GUIDON - moi-import.js : MOI Import Engine, Phase 1 (G.moiImport)

   An MOI (memorandum of instruction) is the memo a board assigns a Soldier -
   a list of doctrine citations naming exactly what to study. The gap this
   closes: GUIDON already has a huge doctrine/board-question corpus, but a
   Soldier working from an authorized public or synthetic study MOI needs a way
   to see it filtered down to ONLY what that study document assigns. This lets them paste or upload that
   memo and get a study dashboard built from exactly those citations -
   nothing added, nothing assumed relevant just because it's in the corpus.

   Architecture, on purpose: a PLAIN ROUTE (#/moi), not a modal or wizard.
   Landing / Capture / Review+Build / Result are all just DOM swaps inside
   this route's own `stage` element, matching Drills' menu()/open(id) shape
   (grep G.drills.render in index.html) - no util.modalTrap, no #app inert,
   no separate steps to navigate between.

   The matching pipeline (tokenizeCitations/normalizeCitation/matchCitation/
   buildCitationRegistry) is written as plain functions with no DOM
   dependency at all, on purpose - tools/test-moi-import.mjs exercises them
   directly via window.G.moiImport, the same way test-rankutils.mjs already
   does for G.rankUtils.

   Correctness rule this whole pipeline is built around: a citation match
   is either an EXACT post-normalization tuple match, or it doesn't count.
   Real regulations collide at 1-2 characters - AR 600-8-2 is a literal
   substring of AR 600-8-22; TC 3-21.5 and TC 3-21.8 differ by one digit and
   cover unrelated subjects (Drill and Ceremonies vs. a different TC
   entirely). A fuzzy/"closest guess" matcher would confidently hand a
   Soldier the wrong regulation to study. There is no fuzzy fallback
   anywhere in this file - see matchCitation()'s own comment.

   Phase 1 overhaul (2026-09-21) added multi-plan history on top of the
   pipeline above, unchanged: the real storage is now PLANS_KEY
   ("guidon:moi:plans:v1"), an array of "plan family" records shaped
   { id, createdAt, current, history:[{importedAt, snapshot, diff}, ...] } -
   `current` is the same plan object build() has always produced (now with
   a topicTiers field, see TIER_BADGE below), and `diff` is diffPlans()'s
   pure before/after comparison of two such plans. A Soldier can now import
   more than one MOI (a current board's, a future one) and can re-import a
   REVISION of an existing family (openPlan()'s "Re-import a revision") to
   see exactly what changed since the last time. KEY ("guidon:moi:plan:v1")
   is the old single-plan key - kept defined as a read-once migration
   source only; see render()'s own migration flow and migratePlansArray().
*/
window.G = window.G || {};
(function () {
  "use strict";
  const util = G.util, el = util.el;

  // Persisted "my board" entry. A NEW kv key - deliberately NOT the
  // existing "tierFilter" setting key, which (see Settings' own tier <select>
  // and onboarding's profile-save path, index.html) has an unrelated side
  // effect of also overwriting the Soldier's saved rank profile. This
  // feature has nothing to do with rank tier and must not touch that key.
  // Phase 1: this is now a LEGACY key - the one-time migration source for
  // PLANS_KEY below (render()'s own migration flow). Left defined, not
  // removed: it is still that migration's read side, and it is still
  // written once (nulled, never deleted - see KV_VALIDATORS' own comment
  // in index.html for why null, not a missing row, is this key's real
  // "done" state) the moment migration finishes on a device.
  const KEY = "guidon:moi:plan:v1";

  // The real, current storage as of Phase 1: an array of "plan family"
  // records, each { id, createdAt, current, history }. `current` is a plan
  // object in the exact shape build() has always produced; `history` is a
  // capped, newest-first list of { importedAt, snapshot, diff } - one entry
  // per revision this family has ever had re-imported over it (see build()
  // and diffPlans() below). FAMILY_CAP/HISTORY_CAP bound both lists so a
  // Soldier who imports MOIs for years doesn't grow this row without limit;
  // the oldest entry is dropped first in both cases.
  const PLANS_KEY = "guidon:moi:plans:v1";
  const FAMILY_CAP = 20;
  const HISTORY_CAP = 10;
  // Set once, the moment KEY's legacy row (if any) has been folded into
  // PLANS_KEY - mirrors index.html's own "legacyStorageMigration:v1" flag
  // for its LEGACY_KEYS localStorage->kv migration (grep it there) down to
  // the same idiom: checked before doing any migration work, set
  // unconditionally after, so a Soldier who deletes every migrated family
  // afterward never has the legacy plan resurrected on a later boot.
  const LEGACY_MIGRATED_FLAG = "guidon:moi:legacyMigrated:v1";

  // Part E (MOI Scope, ROADMAP 3g phase 2): in-memory cache of PLANS_KEY's
  // current value, kept in sync on every write path below (render()'s own
  // initial load and its legacy-migration write, the Delete handler, and
  // build()'s own save) - mirrors G.profile's own _cache/current()/cached()
  // split (index.html, grep "_cache = await loadProfile") so a SYNCHRONOUS
  // caller can read a same-boot-session-fresh answer with no async G.db
  // call. store.boardQuestions()/store.doctrine() (index.html) are exactly
  // that caller: they must read this mid-render, and app.start()'s own boot
  // sequence (store.init(), index.html) also awaits currentFamilies() once
  // at boot so this cache is never cold just because #/moi hasn't rendered
  // yet this session - see that call site's own comment for why an empty
  // cache would be a real correctness bug here, not just a stale read.
  let _familiesCache = null;
  function updateFamiliesCache(list) { _familiesCache = Array.isArray(list) ? list : []; }
  // Synchronous read of whatever is cached right now - [] (never null) both
  // before the first populate and once populated-but-empty, so a caller
  // never needs its own null-guard on top of this one. Mirrors G.profile's
  // own cached().
  function cachedFamilies() { return _familiesCache || []; }
  // Async populate, mirroring G.profile's own current(): returns the cache
  // as-is if already populated this session (by this call, render()'s own
  // load, or a write path above), otherwise does the one G.db read PLANS_KEY
  // needs and populates it. Exists mainly for app.start()'s own boot-time
  // warm call (index.html, store.init()) - see that call site's comment for
  // why the cache must not stay cold just because #/moi hasn't rendered yet.
  async function currentFamilies() {
    if (_familiesCache !== null) return _familiesCache;
    let list = [];
    try {
      const r = await G.db.get("kv", PLANS_KEY);
      list = (r && Array.isArray(r.v)) ? r.v : [];
    } catch (e) { /* offline-safe, matches render()'s own G.db.get try/catch */ }
    updateFamiliesCache(list);
    return _familiesCache;
  }

  /* ======================================================================
     PURE MATCHING PIPELINE - no DOM, no G.db, fully unit-testable.
     ====================================================================== */

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // The pub-type prefixes this engine recognizes. "DA PAM" is the one
  // two-word type - sorted longest-first below purely as documented intent
  // (none of these are literal prefixes of one another, so ordering isn't
  // load-bearing here, just deliberate).
  const PUB_TYPES = ["DA PAM", "ADP", "ATP", "AR", "FM", "TC", "TM"];
  const PUB_TYPE_FRAGMENT = PUB_TYPES
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((pt) => pt.split(" ").map(escapeRegExp).join("\\s+"))
    .join("|");

  // A "number-shaped" run: real digits plus the five glyphs OCR/hand-typed
  // MOIs most often confuse for a digit (0<->O, 1<->I/l, 8<->B, 6<->G - see
  // normalizeCitation's own glyph-fold below), joined by "." or "-" the way
  // real citation numbers are ("600-20", "3-21.5", "6-22.1", "638-8"). The
  // tokenizer only needs to recognize the SHAPE here; normalizeCitation
  // does the actual digit substitution, and only against a run this shape
  // already isolated - never against surrounding prose.
  const NUM_LOOSE_SRC = "[0-9OoIiLlBbGg]+(?:[.\\-][0-9OoIiLlBbGg]+)*";

  // Fresh RegExp per call (never a shared module-level instance with the
  // "g" flag) - a shared global regex's mutable lastIndex is a classic
  // source of "works once, breaks on the second call" bugs.
  function citationRegex(flags) {
    return new RegExp("\\b(" + PUB_TYPE_FRAGMENT + ")\\s+(" + NUM_LOOSE_SRC + ")", flags);
  }

  // 1. tokenizeCitations(text): every pub-type + number-shaped run in the
  // text, as plain "PUBTYPE NUMBER" candidate strings. Comma/semicolon/
  // newline act as strong delimiters between distinct citations - not via
  // an explicit pre-split step, but for free: none of the three characters
  // are in NUM_LOOSE_SRC's charset, so the global scan below already treats
  // them as hard stops between one match and the next.
  function tokenizeCitations(text) {
    const out = [];
    if (!text) return out;
    const str = String(text);
    const re = citationRegex("gi");
    let m;
    while ((m = re.exec(str))) {
      const pubType = m[1], number = m[2];
      // Require at least one real digit - a run built entirely from
      // confusable LETTERS ("AR OOO") isn't a citation, just noise; without
      // this, a stray run of capital O's/I's/B's/G's near a pub-type word
      // would tokenize into something that can never resolve to anything
      // and would just clutter the Not-found list for no reason.
      if (!/\d/.test(number)) continue;
      out.push(pubType + " " + number);
      // "/"-joined second half ("TC 3-21.5/3-21.8", "AR 600-8-2 / 22").
      // Real MOI shorthand can mean either one dual citation or two
      // separate ones sharing a pub type, and the two are NOT
      // interchangeable (see matchCitation's own header comment on
      // AR 600-8-2 vs AR 600-8-22). This tokenizer refuses to guess which:
      // it surfaces the right-hand side as an INDEPENDENT second candidate
      // under the same pub type, and matchCitation resolves each candidate
      // on its own with no fuzzy fallback - an invented candidate that
      // isn't a real citation just falls out unmatched instead of silently
      // misattributing.
      const rest = str.slice(re.lastIndex);
      const slash = /^\s*\/\s*([0-9OoIiLlBbGg]+(?:[.\-][0-9OoIiLlBbGg]+)*)/.exec(rest);
      if (slash && /\d/.test(slash[1])) out.push(pubType + " " + slash[1]);
    }
    return out;
  }

  const GLYPH_FOLD = { O: "0", o: "0", I: "1", i: "1", L: "1", l: "1", B: "8", b: "8", G: "6", g: "6" };

  // 2. normalizeCitation(raw): a bare {pubType, number} tuple, plus whether
  // resolving it required folding a confusable glyph to a digit.
  function normalizeCitation(raw) {
    if (raw == null) return null;
    const str = String(raw).trim();
    if (!str) return null;
    // No separate "strip the trailing chapter/paragraph/date suffix" pass
    // needed here: NUM_LOOSE_SRC's own character class (digits/glyphs plus
    // "." and "-" only) already excludes everything such a suffix would
    // start with - a comma, a space then a letter, an open paren - so
    // citationRegex naturally isolates the bare number and never even sees
    // ", Ch 3" / ", para 2-1" / " (2019)" in the first place. An explicit
    // strip-first pass was tried and dropped: it was strictly redundant
    // with this boundary-based extraction AND introduced a real false-
    // positive risk of its own (a word ending in "...ch" directly followed
    // by a number - "reach 5" - would have been misread as a chapter
    // suffix and chopped).
    const m = citationRegex("i").exec(str);
    if (!m) return null;
    const pubType = m[1].toUpperCase().replace(/\s+/g, " ");
    const rawNumber = m[2];
    // The narrow glyph-fold - ONLY within this already-isolated digit-run,
    // never against pubType or anything else in the string.
    const number = rawNumber.replace(/[OoIiLlBbGg]/g, (c) => GLYPH_FOLD[c]);
    return { pubType: pubType, number: number, glyphFolded: number !== rawNumber };
  }

  // 4. Hand-curated, deliberately small: seeded ONLY from supersessions
  // this app's own doctrine content already documents in prose (grep
  // index.html for "supersed"), and only where the OLD publication's type
  // is one tokenizeCitations actually recognizes - e.g. ADRP 6-22 -> ADP
  // 6-22 is a real, documented 2019 merger, but "ADRP" isn't a pub type
  // this tokenizer looks for, so an alias keyed on it could never be
  // reached by the real pipeline and was left out rather than shipped as
  // dead weight. Partial supersessions (AR 600-92 only replaces the
  // suicide-prevention PORTION of AR 600-63, which still stands for
  // everything else) are deliberately excluded too, for the same
  // never-guess reason matchCitation itself refuses fuzzy matching.
  const MOI_CITATION_ALIASES = {
    "FM 3-22.9": "TC 3-22.9",     // Rifle and Carbine marksmanship
    "FM 3-23.35": "TC 3-23.35",   // Pistol marksmanship
    "AR 600-8-1": "AR 638-8",     // Casualty Program - AR 600-8-1 fully rescinded, superseded 2019
    "FM 6-22": "ADP 6-22",        // Developing Leaders -> Army Leadership and the Profession (2019 merge)
  };

  // 3. buildCitationRegistry(): scans the FULL unfiltered seed via
  // G.store.seed() - never store.doctrine()/store.boardQuestions()/
  // store.scenarios(), which apply the Soldier's own tierFilter (and, for
  // doctrine, the confidence gate too). A citation the registry can't see
  // is a citation this feature would wrongly report as "not in your
  // library" for a Soldier whose settings happen to narrow those
  // accessors - this scan must see everything regardless.
  //
  // Memoized compute-once, mirroring store.doctrine()/store.boardQuestions()'s
  // own cache-key idiom (index.html) - but keyed on nothing, since the raw
  // seed never changes at runtime the way tierFilter does, so there's no
  // invalidation key to track.
  let _registryCache = null;
  function buildCitationRegistry() {
    if (_registryCache) return _registryCache;
    const registry = new Map(); // "PUBTYPE NUMBER" -> { topics, boardCategories, counts }

    function entryFor(key) {
      let e = registry.get(key);
      if (!e) {
        e = {
          topics: new Set(), boardCategories: new Set(),
          counts: { doctrineCards: 0, selfCheckQuestions: 0 },
          // Per-topic mirror of `counts` above (Part A2 fix, 2026-09-21): a
          // fan-out citation - one cited by more than one topic - used to
          // have its ONE shared `counts` total added to EVERY topic bucket
          // that cites it in build()'s own aggregation loop, inflating
          // every topic's coverage numbers to the citation's combined
          // total instead of that topic's real share. This Map holds each
          // topic's OWN {doctrineCards, selfCheckQuestions} contribution to
          // this citation, keyed by topic name - see topicCountFor() below
          // and matchCitation()'s own topicCounts field.
          topicCounts: new Map(),
        };
        registry.set(key, e);
      }
      return e;
    }
    // Gets-or-creates this citation entry's per-topic count bucket. Never
    // called with a falsy topic - see record()'s own `if (topic)` guard
    // below, matching `e.topics.add(topic)`'s identical guard.
    function topicCountFor(e, topic) {
      let c = e.topicCounts.get(topic);
      if (!c) { c = { doctrineCards: 0, selfCheckQuestions: 0 }; e.topicCounts.set(topic, c); }
      return c;
    }
    function record(rawCitation, topic, kind) {
      const norm = normalizeCitation(rawCitation);
      if (!norm) return;
      const key = norm.pubType + " " + norm.number;
      const e = entryFor(key);
      if (topic) e.topics.add(topic);
      if (kind === "board") {
        e.counts.selfCheckQuestions++;
        // Kept separately, in addition to the unified `topics` set above,
        // ONLY so a deep link to #/board can pass an exact category string
        // - store.boardQuestions()'s own category filter is an exact
        // match, not a substring search like #/doctrine's.
        if (topic) e.boardCategories.add(topic);
      } else {
        e.counts.doctrineCards++;
      }
      // Same `if (topic)` guard as `e.topics.add(topic)` above - a
      // topic-less record (scenarios, forms - see their own comments
      // further down) has nothing to key a per-topic bucket on, and only
      // ever contributes to the shared `e.counts` total above.
      if (topic) {
        const tc = topicCountFor(e, topic);
        if (kind === "board") tc.selfCheckQuestions++; else tc.doctrineCards++;
      }
    }

    const seed = (G.store && G.store.seed && G.store.seed()) || {};

    const doctrineEntries = (seed.doctrine && seed.doctrine.entries) || [];
    doctrineEntries.forEach((d) => {
      const ref = (d.source && d.source.ref) || d.ref || "";
      record(ref, d.topic, "doctrine");
      // A category string occasionally embeds a real citation itself
      // (board.questions do this a lot - "Weapons (TC 3-22.9)"); checked
      // defensively here too even though doctrine topics rarely do it.
      tokenizeCitations(d.topic || "").forEach((tok) => record(tok, d.topic, "doctrine"));
    });

    const boardQuestions = (seed.board && seed.board.questions) || [];
    boardQuestions.forEach((q) => {
      record(q.source, q.category, "board");
      tokenizeCitations(q.category || "").forEach((tok) => record(tok, q.category, "board"));
    });

    // Scenarios carry their own doctrine[] citation list ({ref, para, asOf}
    // per entry - the same shape as a doctrine entry's own source). Counted
    // toward doctrineCards - they're study material, not self-check
    // questions - but deliberately recorded with NO topic: a scenario's
    // own title ("The Chronically Late Soldier") is not a topic label the
    // way doctrine.topic/board.category are, and every scenario tends to
    // cite the same handful of foundational pubs (ADP 6-22 above all),
    // so folding scenario titles into `topics` would flood a widely-cited
    // citation's fan-out list with dozens of unrelated scenario names
    // instead of real topic labels. A citation with no OTHER coverage
    // still displays fine - the Matched card falls back to the citation
    // number itself when its topics list is empty (see buildMatchedRow()).
    const scenarios = (seed.scenarios && seed.scenarios.scenarios) || [];
    scenarios.forEach((sc) => {
      (sc.doctrine || []).forEach((d) => record(d.ref, null, "doctrine"));
    });

    // Forms Trainer entries carry a "reference" field (e.g. "ATP 6-22.1,
    // The Counseling Process"). Same reasoning as scenarios just above -
    // recorded with no topic, doctrineCards only. Counsel's skills/drills
    // data was checked too (grepped for "supersed" and any citation-shaped
    // field) and carries no comparable structured field - only free-prose
    // mentions like "per ATP 6-22.1 and ADP 6-22" - so it's excluded here
    // rather than guessed at.
    const forms = (seed.forms && seed.forms.forms) || [];
    forms.forEach((f) => {
      tokenizeCitations(f.reference || "").forEach((tok) => record(tok, null, "doctrine"));
    });

    _registryCache = registry;
    return registry;
  }

  // 5. matchCitation(rawToken): normalize -> alias table -> exact registry
  // lookup -> exactly one of 5 confidence tiers. NEVER a "closest guess"
  // past an exact post-normalization tuple match - see this file's own
  // header comment for why (AR 600-8-2 vs AR 600-8-22, TC 3-21.5 vs
  // TC 3-21.8).
  // Map -> plain object, so downstream consumers (build()'s aggregation
  // loop, tools/test-moi-import.mjs) can index it by topic name without
  // needing to know it started life as a Map.
  function topicCountsToObj(map) {
    const out = {};
    map.forEach((v, k) => { out[k] = v; });
    return out;
  }

  function matchCitation(rawToken) {
    const norm = normalizeCitation(rawToken);
    if (!norm) return { raw: rawToken, tier: "unmatched", normalized: null, topics: [], boardCategories: [], counts: null, topicCounts: null };
    const key = norm.pubType + " " + norm.number;
    const registry = buildCitationRegistry();

    // Alias table checked FIRST, before a direct lookup - a citation that
    // literally spells a rescinded/superseded publication should resolve
    // to what replaced it, not report "not found" just because the old
    // number was never itself cited anywhere in the corpus.
    const aliasTarget = MOI_CITATION_ALIASES[key];
    if (aliasTarget && registry.has(aliasTarget)) {
      const e = registry.get(aliasTarget);
      return { raw: rawToken, tier: "alias", normalized: aliasTarget, topics: Array.from(e.topics), boardCategories: Array.from(e.boardCategories), counts: e.counts, topicCounts: topicCountsToObj(e.topicCounts) };
    }

    const e = registry.get(key);
    if (e) {
      const tier = norm.glyphFolded ? "glyph-folded" : (e.topics.size > 1 ? "exact-fanout" : "exact-unique");
      return { raw: rawToken, tier: tier, normalized: key, topics: Array.from(e.topics), boardCategories: Array.from(e.boardCategories), counts: e.counts, topicCounts: topicCountsToObj(e.topicCounts) };
    }

    return { raw: rawToken, tier: "unmatched", normalized: key, topics: [], boardCategories: [], counts: null, topicCounts: null };
  }

  function allKnownTopics() {
    const registry = buildCitationRegistry();
    const set = new Set();
    registry.forEach((e) => e.topics.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }

  function libraryDocFor(citationKey) {
    if (!citationKey || !G.library || !G.library.DOCS) return null;
    try {
      const key = citationKey.toUpperCase();
      return G.library.DOCS.find((d) => d.citation && d.citation.toUpperCase() === key) || null;
    } catch (e) { return null; }
  }

  // Strong/Partial/Gap coverage, reusing this app's existing .badge
  // green/amber/red tone classes (index.html) rather than inventing new CSS.
  function coverageTier(counts) {
    if (!counts) return "gap";
    const hasDoc = counts.doctrineCards > 0, hasQ = counts.selfCheckQuestions > 0;
    if (hasDoc && hasQ) return "strong";
    if (hasDoc || hasQ) return "partial";
    return "gap";
  }
  const COVERAGE_BADGE = {
    strong: { cls: "badge green", label: "Strong" },
    partial: { cls: "badge amber", label: "Partial" },
    gap: { cls: "badge red", label: "Gap" },
  };
  function coverageBadge(counts) {
    const tone = coverageTier(counts);
    return el("span." + COVERAGE_BADGE[tone].cls, { text: COVERAGE_BADGE[tone].label, style: "flex:0 0 auto;white-space:nowrap" });
  }

  // Part B: the match-tier badge, mirroring COVERAGE_BADGE's own
  // green/amber/red convention just above - but for HOW a citation
  // resolved, not what it covers. Plain-language labels, not engineering
  // tier names (this app's own end-user-copy rule: nothing user-facing
  // reads like an engineering transaction): "exact-unique"/"exact-fanout"
  // both mean the citation matched exactly as written, "alias" means it
  // matched through a documented supersession (the OLD publication was
  // superseded by a newer one this app tracks instead), and
  // "glyph-folded" means GUIDON corrected a likely typo (a 0/O, 1/I/l,
  // 8/B or 6/G mix-up) before matching. "unmatched" carries no entry here
  // on purpose - it never reaches a row that renders a tier badge (see
  // review()'s own matched/needsReview/notFound split), so there is
  // nothing to label.
  const TIER_BADGE = {
    "exact-unique": { cls: "badge green", label: "Exact match" },
    "exact-fanout": { cls: "badge green", label: "Exact match" },
    "alias": { cls: "badge amber", label: "Superseded citation" },
    "glyph-folded": { cls: "badge amber", label: "Corrected typo" },
  };
  function tierBadge(tier) {
    const t = TIER_BADGE[tier];
    if (!t) return null;
    return el("span." + t.cls, { text: t.label, style: "flex:0 0 auto;white-space:nowrap" });
  }

  // Best-effort unit-designation sniff near the top of the document -
  // "1-501 IN BN", "3rd Battalion, 15th Infantry Regiment" - real Army
  // unit-designation shorthand is too free-form for one clean regex to
  // fully cover, so this looks for the common shapes rather than claiming
  // to parse every one; a caller with no match falls back to a generic
  // label, which is a safe, honest default.
  const UNIT_RE = /\b\d+(?:st|nd|rd|th)?[\s-]*(?:BN|BDE|BCT|CO|BTRY|SQDN|REGT|Battalion|Brigade|Company|Battery|Squadron|Regiment)\b[^\n,.;]{0,40}/i;
  function detectMoiName(sourceText) {
    const lines = String(sourceText || "").split(/\r\n|\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12);
    for (let i = 0; i < lines.length; i++) {
      const m = UNIT_RE.exec(lines[i]);
      if (m) return m[0].trim();
    }
    return null;
  }

  // Best-effort "assigned-to: subject list" block structure. Returns
  // [{heading, topics:[name,...]}] when the source text has real,
  // recognizable heading lines, or null when it doesn't - callers fall
  // back to a single alphabetical bucket on null, per this feature's own
  // "best-effort, not guaranteed" framing.
  function detectGroups(sourceText, topicNames) {
    if (!topicNames || !topicNames.length) return null;
    const known = new Set(topicNames);
    const lines = String(sourceText || "").split(/\r\n|\n/);
    let current = null, sawHeading = false;
    const buckets = [];
    function bucketFor(h) {
      let b = buckets.find((x) => x.heading === h);
      if (!b) { b = { heading: h, topics: new Set() }; buckets.push(b); }
      return b;
    }
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // A "heading" line: short, carries no citation of its own, and
      // either ends in a colon or reads as an all-caps label (section
      // titles/subject headers in real MOIs commonly do one or the other).
      const looksHeading = trimmed.length <= 60 && !tokenizeCitations(trimmed).length &&
        (/:$/.test(trimmed) || (trimmed === trimmed.toUpperCase() && /[A-Z]{3,}/.test(trimmed)));
      if (looksHeading) { current = trimmed.replace(/:$/, ""); sawHeading = true; return; }
      tokenizeCitations(trimmed).forEach((tok) => {
        const m = matchCitation(tok);
        (m.topics || []).forEach((t) => { if (known.has(t)) bucketFor(current || "General").topics.add(t); });
      });
    });
    if (!sawHeading || buckets.length <= 1) return null;
    return buckets.map((b) => ({ heading: b.heading, topics: Array.from(b.topics).sort() }));
  }

  // 6. diffPlans(prevSnapshot, nextSnapshot): pure, DOM-free comparison of
  // two plan objects' own .topics/.topicCoverage - matching this pipeline's
  // "no DOM dependency at all" convention (this file's own header comment).
  // Used by build() (Part C7) to record what changed when a Soldier
  // re-imports a revision of an existing plan family, and exported via
  // G.moiImport for tools/test-moi-import.mjs to exercise directly, the
  // same way it already exercises tokenizeCitations/matchCitation.
  function diffPlans(prevSnapshot, nextSnapshot) {
    const prevTopics = new Set((prevSnapshot && prevSnapshot.topics) || []);
    const nextTopics = new Set((nextSnapshot && nextSnapshot.topics) || []);
    const added = Array.from(nextTopics).filter((t) => !prevTopics.has(t)).sort();
    const removed = Array.from(prevTopics).filter((t) => !nextTopics.has(t)).sort();
    const prevCov = (prevSnapshot && prevSnapshot.topicCoverage) || {};
    const nextCov = (nextSnapshot && nextSnapshot.topicCoverage) || {};
    const coverageChanged = [];
    // Only topics present in BOTH snapshots - a topic that appeared or
    // disappeared is already fully described by added/removed above, and
    // showing it a second time under "coverage changed" (going from real
    // counts to {0,0}, or the reverse) would just be the same fact twice.
    prevTopics.forEach((t) => {
      if (!nextTopics.has(t)) return;
      const before = prevCov[t] || { doctrineCards: 0, selfCheckQuestions: 0 };
      const after = nextCov[t] || { doctrineCards: 0, selfCheckQuestions: 0 };
      if (before.doctrineCards !== after.doctrineCards || before.selfCheckQuestions !== after.selfCheckQuestions) {
        coverageChanged.push({ topic: t, before: before, after: after });
      }
    });
    coverageChanged.sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
    return { added: added, removed: removed, coverageChanged: coverageChanged };
  }

  // 7. migratePlansArray(existingFamilies, legacyPlan): wraps the OLD
  // single-plan shape (guidon:moi:plan:v1 / KEY) into one family record -
  // but ONLY the very first time this ever matters on a device
  // (existingFamilies is empty AND legacyPlan is a real, usable plan).
  // Otherwise returns existingFamilies completely untouched. Deliberately
  // idempotent so render()'s migration flow (below) can call it on every
  // boot with no separate "have I already migrated" branching of its own -
  // hasPlan() (below) is reused here as the same "is this actually a usable
  // plan" gate landing() has always used, so a legacy row too broken to
  // ever have rendered as "already imported" under the old code doesn't
  // get resurrected as a family either.
  function migratePlansArray(existingFamilies, legacyPlan) {
    const families = existingFamilies || [];
    if (families.length || !hasPlan(legacyPlan)) return families;
    return [{
      id: "legacy-" + legacyPlan.importedAt,
      createdAt: legacyPlan.importedAt,
      current: legacyPlan,
      history: [],
    }];
  }

  // 8. Part E (MOI Scope, ROADMAP 3g phase 2 - the real design question
  // Phase 1's multi-plan rewrite raised: with more than one saved plan
  // FAMILY now possible, which family's topics should narrow #/board and
  // #/doctrine? Resolved as PER-FAMILY OPT-IN, not a single global switch -
  // a Soldier prepping for two concurrent boards can opt both families in;
  // one who keeps an old plan around for reference opts only the current
  // one. activeFocusSet(families, optedInIds): the UNION, across every
  // family whose id is in optedInIds, of that family's current.topics and
  // current.topicLinks[t].boardCategory.
  //
  // Deliberately topicLinks[t].boardCategory, NOT generatedDrillCategories:
  // the latter is populated only when the Soldier left "Generate a practice
  // drill now" checked at Build time (review()'s own optWrap, genDrillCb) -
  // see build()'s own `generatedDrillCategories: genDrill ? ... : []` line.
  // A family built with that box unchecked would carry [] there forever,
  // silently under-narrowing #/board to nothing for that family even though
  // its topics have real board coverage. topicLinks is populated for every
  // topic regardless of that checkbox (build()'s topicAgg loop sets
  // a.boardCategory unconditionally), so it is the field this function
  // must read - and the correct behavior it's exercised against was
  // re-verified here directly against build()'s current source, not
  // assumed from the original single-plan proposal.
  //
  // Returns null - never an empty-but-active {topics:Set(),
  // boardCategories:Set()} - when optedInIds is empty. Mirrors
  // G.mosDecks.activeCodes()'s own "no signal = show everything" contract
  // (00-mos-decks-core.js): a caller that got an empty Set back and filtered
  // against it would silently narrow the pool to NOTHING, which reads as a
  // real (if confusing) result rather than "filtering is off" - the exact
  // ambiguous-empty-set trap this return shape is designed to avoid. Every
  // caller (store.boardQuestions()/store.doctrine(), index.html) checks the
  // return value truthy before filtering, never assumes a Set.
  function activeFocusSet(families, optedInIds) {
    const ids = Array.isArray(optedInIds) ? optedInIds : [];
    if (!ids.length) return null;
    const idSet = new Set(ids);
    const topics = new Set(), boardCategories = new Set();
    (families || []).forEach((family) => {
      if (!family || !idSet.has(family.id) || !family.current) return;
      const plan = family.current;
      (plan.topics || []).forEach((t) => topics.add(t));
      const links = plan.topicLinks || {};
      Object.keys(links).forEach((t) => {
        const bc = links[t] && links[t].boardCategory;
        if (bc) boardCategories.add(bc);
      });
    });
    return { topics: topics, boardCategories: boardCategories };
  }

  // inScopeIds()/setInScope(): the Settings/plan-card read-write pair for
  // the moiScopeFamilies setting, mirroring G.mosDecks.optedIn()/
  // setOptedIn() (00-mos-decks-core.js) down to the same guard shape - []
  // when G.store isn't present yet (tools/assemble-bank.mjs's headless
  // sandbox), and a no-op write when the requested state already holds (no
  // pointless settings write or change event). Exported so index.html's
  // Settings panel and this file's own menu()/openPlan() toggles both read
  // and write through the ONE place this array is shaped, instead of each
  // hand-rolling the add/remove logic and risking the two drifting apart.
  function inScopeIds() {
    if (!window.G || !G.store || typeof G.store.settings !== "function") return [];
    let s;
    try { s = G.store.settings(); } catch (e) { return []; }
    return (s && Array.isArray(s.moiScopeFamilies)) ? s.moiScopeFamilies.slice() : [];
  }
  function setInScope(familyId, on) {
    if (!familyId || !window.G || !G.store || typeof G.store.setSetting !== "function") return;
    const cur = inScopeIds();
    const has = cur.indexOf(familyId) !== -1;
    let next = cur;
    if (on && !has) next = cur.concat([familyId]);
    else if (!on && has) next = cur.filter((id) => id !== familyId);
    else return;
    G.store.setSetting("moiScopeFamilies", next);
  }

  /* ======================================================================
     RENDERING - a plain route, one mount, no navigation between states.
     ====================================================================== */

  function hasPlan(s) { return !!(s && Array.isArray(s.topics) && s.topics.length); }

  function ensurePdfJsLocal() {
    if (window.pdfjsLib) return Promise.resolve(true);
    if (G.pdfjsAssets && G.pdfjsAssets.ensure) return G.pdfjsAssets.ensure();
    return Promise.reject(new Error("PDF reading isn't available in this build."));
  }

  async function render(mount) {
    util.clear(mount);
    mount.appendChild(el("div.section-title", {}, [
      el("h2", { text: "MOI Import" }), el("div.rule") ]));
    mount.appendChild(el("p.hint", { text:
      "Import your board's MOI (memorandum of instruction) and get a study plan built from exactly what it assigns — not the whole corpus, just your citations." }));

    const stage = el("div");
    mount.appendChild(stage);

    // What the sensitive-text check found in the import now in progress but
    // did not stop on ({ findings } or null) - see mentionNotice() below.
    let pendingNotice = null;

    let families = [];
    try {
      const r = await G.db.get("kv", PLANS_KEY);
      families = (r && Array.isArray(r.v)) ? r.v : [];
    } catch (e) { /* offline-safe, matches records.js's own G.db.get try/catch */ }
    updateFamiliesCache(families);

    // One-time legacy migration (Part C3): guidon:moi:plan:v1 -> one family
    // inside guidon:moi:plans:v1. Mirrors index.html's own LEGACY_KEYS
    // localStorage->kv migration (grep "legacyStorageMigration:v1") down to
    // the same idiom - a boolean flag checked BEFORE doing any work and set
    // unconditionally after, so this whole block is safe to run on every
    // render() call forever: migratePlansArray() itself also refuses to
    // touch a non-empty families array (belt and suspenders), and the flag
    // is what actually stops a Soldier who deletes every migrated family
    // from ever seeing the legacy plan resurrected on a later boot.
    if (!families.length) {
      try {
        const migrated = await G.db.getSetting(LEGACY_MIGRATED_FLAG, false);
        if (!migrated) {
          let legacyPlan = null;
          try {
            const lr = await G.db.get("kv", KEY);
            legacyPlan = (lr && lr.v && typeof lr.v === "object") ? lr.v : null;
          } catch (e) {}
          const migratedFamilies = migratePlansArray(families, legacyPlan);
          // Only clear the legacy row and mark migration done once the
          // new home for that data (or the fact there was none) is safely
          // persisted. Writing PLANS_KEY can fail (quota, offline write
          // error) - swallowing that and nulling KEY/setting the flag
          // anyway would lose both the only copy of the data AND the
          // chance to retry migration on the next render(). writeOk stays
          // true when there was nothing to migrate, so that case still
          // clears KEY/sets the flag exactly as before.
          let writeOk = true;
          if (migratedFamilies.length) {
            try {
              await G.db.put("kv", { k: PLANS_KEY, v: migratedFamilies });
              families = migratedFamilies;
              updateFamiliesCache(families);
            } catch (e) { writeOk = false; }
          }
          if (writeOk) {
            // Nulled, never deleted - see KV_VALIDATORS' own comment on this
            // key (index.html, backup section) for why a null row IS this
            // key's legitimate "done, permanently" state rather than
            // corruption.
            try { await G.db.put("kv", { k: KEY, v: null }); } catch (e) {}
            try { await G.db.setSetting(LEGACY_MIGRATED_FLAG, true); } catch (e) {}
          }
        }
      } catch (e) { /* non-fatal: matches core's own migrateLegacyLocalStorage() try/catch */ }
    }

    landing();

    // ---- Landing ---------------------------------------------------------
    function landing() {
      util.clear(stage);
      if (!families.length) {
        const empty = util.emptyState(
          "No MOI imported yet",
          "Paste or upload your board's MOI and GUIDON builds a study dashboard from exactly what it assigns — nothing added, nothing assumed.",
          "Import an MOI",
          () => capture(null));
        stage.appendChild(empty);
        // Roadmap audit lens (a11y, HIGH): matches review()'s own
        // tabindex="-1" + focus({preventScroll:true}) convention below -
        // this is an in-page state swap inside the SAME route (e.g. after
        // Delete, or Capture's own Cancel), not a fresh route() call the
        // router would announce on its own.
        empty.setAttribute("tabindex", "-1");
        try { empty.focus({ preventScroll: true }); } catch (e) {}
        return;
      }
      menu();
    }

    // Part C4: a menu of imported MOI plan families - Drills' own
    // menu()/open(id) shape (grep G.drills.render in index.html; this
    // file's own header comment already names it as the architectural
    // model). Shown whenever there is at least one family, even just one -
    // a routine revisit no longer jumps straight into the single plan's
    // detail view the way it used to, so "open a plan" always means the
    // same one click regardless of how many a Soldier has saved.
    function menu() {
      util.clear(stage);
      const h3 = el("h3", { text: "Your MOI plans" });
      stage.appendChild(h3);
      const importBtn = el("button.btn.sm", { type: "button", text: "+ Import another MOI", style: "margin:6px 0 10px" });
      importBtn.addEventListener("click", () => capture(null));
      stage.appendChild(importBtn);
      // card-results-grid - the same auto-filling card grid Drills' own
      // menu() uses (grep it in index.html), one panel-button per family.
      // Newest import first: the plan a Soldier is most likely mid-studying
      // from is the one they see without scrolling.
      const grid = el("div.card-results-grid");
      families.slice().sort((a, b) => (b.current.importedAt || 0) - (a.current.importedAt || 0)).forEach((family) => {
        const topicCount = (family.current.topics || []).length;
        const card = el("div.panel", { style: "margin-bottom:10px" });
        const btn = el("button", { type: "button",
          "aria-label": (family.current.name || "Your MOI") + ", " + topicCount + " topic" + (topicCount === 1 ? "" : "s"),
          style: "width:100%;text-align:left;background:none;border:none;cursor:pointer;padding:0;color:inherit;font:inherit" });
        btn.appendChild(el("div.eyebrow", { text: family.current.name || "Your MOI" }));
        const dateStr = family.current.importedAt ? new Date(family.current.importedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
        btn.appendChild(el("p.hint", { style: "margin:4px 0 0", text: (dateStr ? "Imported " + dateStr + " · " : "") + topicCount + " topic" + (topicCount === 1 ? "" : "s") }));
        btn.addEventListener("click", () => openPlan(family, false));
        card.appendChild(btn);
        // Part E (MOI Scope): a SIBLING of btn above, not nested inside it -
        // a checkbox inside a <button> is invalid markup and would double-
        // fire on every click. Real checkbox + visible text label (this
        // app's own .switch/.toggle/.track convention - grep "MOS Decks" in
        // Settings' render code for the identical shape), not a repurposed
        // button - native checkbox semantics already give it a correct
        // accessible name/state with no extra aria-checked needed. Toggling
        // re-draws this whole menu() (same full-redraw convention every
        // other state change on this route already uses) so its checked
        // state and Settings' own mirrored list can never show two
        // different answers.
        const scopeInput = el("input", { type: "checkbox",
          "aria-label": "Narrow Board Drill and Doctrine to " + (family.current.name || "this MOI") + "'s topics" });
        scopeInput.checked = inScopeIds().indexOf(family.id) !== -1;
        scopeInput.addEventListener("change", () => { setInScope(family.id, scopeInput.checked); menu(); });
        card.appendChild(el("div.switch", { style: "margin-top:8px" }, [
          el("label.toggle", { style: "margin:0" }, [scopeInput, el("span.track")]),
          el("span", { text: "In Scope — narrow Board Drill and Doctrine to this plan's topics" }),
        ]));
        grid.appendChild(card);
      });
      stage.appendChild(grid);
      // Roadmap audit lens (a11y, HIGH): matches this route's own
      // established tabindex="-1" + focus({preventScroll:true}) convention
      // (openPlan()'s own head-panel focus below) - an in-page state swap
      // inside the SAME route (a fresh landing() with 1+ saved families, or
      // openPlan()'s own "back to your plans" return), not a fresh route()
      // call the router would announce on its own.
      h3.setAttribute("tabindex", "-1");
      try { h3.focus({ preventScroll: true }); } catch (e) {}
    }

    // Part C5: renamed/refactored from renderAlreadyImported(plan, expanded)
    // - operates on a plan FAMILY rather than the single module-level
    // `saved` plan this route used to keep, now that PLANS_KEY can hold
    // more than one. Every `plan` reference below is `family.current`;
    // every `saved = ...` assignment from the old code became a `families`
    // array update (see the Delete handler and build()'s own caller).
    function openPlan(family, expanded) {
      util.clear(stage);
      const backBtn = el("button.btn.sm.ghost", { type: "button", text: "← Your MOI plans" });
      backBtn.addEventListener("click", landing);
      stage.appendChild(backBtn);

      const plan = family.current;
      const head = el("div.panel", { style: "margin-top:8px;margin-bottom:10px" });
      head.appendChild(el("div.eyebrow", { text: plan.name || "Your MOI" }));
      const dateStr = plan.importedAt ? new Date(plan.importedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
      head.appendChild(el("p.hint", { text: (dateStr ? "Imported " + dateStr + " · " : "") + plan.topics.length + " topic" + (plan.topics.length === 1 ? "" : "s") }));
      const row = el("div.btn-row", { style: "gap:8px;flex-wrap:wrap;margin-top:6px" });
      // Part C5 decision (left as a judgment call by design, documented
      // here): today's plain "Replace" immediately discarded this plan for
      // an unrelated fresh one - that use case still exists, just relocated
      // to the menu's own "+ Import another MOI" button and Landing's
      // "Import an MOI" (both create a brand-new family, targetFamilyId
      // null). A SAVED family already carries a name and a history worth
      // building on, so the one button here instead threads THIS family's
      // id through capture() (Part C6) - Build (Part C7) updates this SAME
      // family and records a diff, instead of silently creating an
      // unrelated second family and leaving the old one orphaned. A
      // separate plain "Replace" button would just be a slower path to
      // what "+ Import another MOI" already does one screen up, so it was
      // not kept as a second action here.
      const reimportBtn = el("button.btn.sm", { type: "button", text: "Re-import a revision" });
      reimportBtn.addEventListener("click", () => capture(family.id));
      // Roadmap audit lens (a11y, Medium): matches searchBtn's own
      // disclosure-toggle convention below (grep "aria-expanded" in this
      // file) - aria-expanded set here from the current `expanded` state;
      // a click re-renders this whole function with `expanded` flipped, so
      // the freshly-created viewBtn below always carries the right value
      // rather than needing a separate flip-in-place.
      const viewBtn = el("button.btn.sm.ghost", { type: "button", text: expanded ? "Hide details" : "View", "aria-expanded": String(expanded) });
      viewBtn.addEventListener("click", () => openPlan(family, !expanded));
      const deleteBtn = el("button.btn.sm.ghost", { type: "button", text: "Delete" });
      deleteBtn.addEventListener("click", async () => {
        // Roadmap audit lens (a11y/UX polish): every other destructive
        // delete in the app (scenario delete, profile delete, backup-clear
        // actions - grep "modal.confirm" for the danger:true convention)
        // gates on G.modal.confirm first. This one deleted the whole saved
        // MOI plan on a single click with no confirmation - the one
        // sibling delete action that skipped the app's own guard.
        if (!(await G.modal.confirm("Delete this imported MOI plan? This can't be undone.", { okText: "Delete", danger: true }))) return;
        // Part C5: filters this ONE family out and re-saves PLANS_KEY,
        // rather than nulling the single legacy row the old code did.
        // Re-read PLANS_KEY fresh right before the write (never trust the
        // in-memory `families` this route loaded at render time): another
        // tab/window may have added or revised a family since then, and a
        // stale read-modify-write here would silently erase that work when
        // this write lands second - the same "reload before you overwrite
        // a shared row" discipline build() already follows in Part C7.
        let freshFamilies = families;
        try {
          const fr = await G.db.get("kv", PLANS_KEY);
          if (fr && Array.isArray(fr.v)) freshFamilies = fr.v;
        } catch (e) {}
        families = freshFamilies.filter((f) => f.id !== family.id);
        try { await G.db.put("kv", { k: PLANS_KEY, v: families }); } catch (e) {}
        updateFamiliesCache(families);
        // Part D3: the board-date reminder (if any) is tied to a fixed
        // source, not to which family it was set from - see D2's own
        // comment on why. There is only ever one MOI board reminder
        // possible under that scheme, so deleting ANY family is exactly
        // when it should go stale, matching calendar.js's own
        // clear-on-change pattern (grep clearManagedFor there).
        try { if (G.reminders && G.reminders.clearManagedFor) await G.reminders.clearManagedFor({ source: "moi:plan" }); } catch (e) {}
        try { util.toast("MOI plan deleted."); } catch (e) {}
        landing();
      });
      row.appendChild(reimportBtn); row.appendChild(viewBtn); row.appendChild(deleteBtn);
      // Part D2: only offered once a board date actually exists to remind
      // toward - util.resolveBoardDate() already folds profile-first/
      // settings-fallback the same way renderBoardCountdown() does (Part
      // D1 just below), so this button and that banner never disagree
      // about whether a date is set.
      if (util.resolveBoardDate && util.resolveBoardDate()) {
        const remindBtn = el("button.btn.sm.ghost", { type: "button", text: "Remind me before board" });
        remindBtn.addEventListener("click", async () => {
          // source:"moi:plan" is a FIXED string, not per-family - Part D2's
          // own judgment call, re-checked here against the real multi-plan
          // model: this reminder is conceptually tied to "the board I'm
          // studying for", not to which MOI family happens to be open when
          // the button is clicked. A per-family source would let a Soldier
          // stack one board-countdown reminder per imported MOI, which
          // reads as N duplicate nags for the SAME board date rather than
          // N useful reminders - the fixed source keeps it to the one
          // reminder that actually matters.
          // G.reminders.add()'s own duplicate-collapse only matches on
          // (kind,label,date), and label embeds the plan NAME - so clicking
          // this from two differently-named families on the same board date
          // would NOT collapse into one reminder without an explicit clear
          // first. Clear by source before adding so there is truly only
          // ever one MOI board reminder regardless of which family's name
          // was in the label of whatever reminder existed before.
          try { if (G.reminders.clearManagedFor) await G.reminders.clearManagedFor({ source: "moi:plan" }); } catch (e) {}
          const updated = await G.reminders.addManaged({ kind: "board", label: "Finish studying: " + (plan.name || "your MOI"), date: util.resolveBoardDate(), source: "moi:plan" });
          if (!updated) { try { util.toast("You've reached the " + G.reminders.MAX + "-reminder limit — remove an old one first."); } catch (e) {} return; }
          // Matches calendar.js's own "Remind me" button (grep it there):
          // addManaged() alone never schedules the native notification.
          try { if (G.notify) await G.notify.scheduleForReminder(updated[updated.length - 1]); } catch (e) {}
          try { if (util.announce) util.announce("Reminder set."); } catch (e) {}
          remindBtn.disabled = true;
          remindBtn.textContent = "Reminder set";
        });
        row.appendChild(remindBtn);
      }
      head.appendChild(row);
      // Part E (MOI Scope): same real checkbox + .switch/.toggle/.track
      // convention as menu()'s own card toggle above - this is the OTHER
      // half of the "either place you can see a plan, you can see and
      // flip its scope" requirement (the card in menu(), and this detail
      // view). Toggling re-invokes openPlan() with the SAME expanded state
      // (the full-redraw convention every other control on this screen
      // already uses), so View/Hide, the diff panel and this toggle's own
      // checked state can never disagree with each other or with Settings'
      // mirrored list.
      const scopeInput = el("input", { type: "checkbox",
        "aria-label": "Narrow Board Drill and Doctrine to " + (plan.name || "this MOI") + "'s topics" });
      scopeInput.checked = inScopeIds().indexOf(family.id) !== -1;
      scopeInput.addEventListener("change", () => { setInScope(family.id, scopeInput.checked); openPlan(family, expanded); });
      head.appendChild(el("div.switch", { style: "margin-top:10px" }, [
        el("label.toggle", { style: "margin:0" }, [scopeInput, el("span.track")]),
        el("span", { text: "In Scope — narrow Board Drill and Doctrine to this plan's topics" }),
      ]));
      stage.appendChild(head);

      // Part D1: an existing, already-shared component (grep
      // G.renderBoardCountdown in index.html - records.js's own Board Prep
      // screen calls it the exact same cross-module way, guarded by the
      // same typeof check). Right after the head panel, and only on this
      // non-empty-plan path - Landing's empty state has no plan yet, so
      // there is nothing to count down to. It self-manages the "no board
      // date set yet" case (its own inline date input), reads
      // util.resolveBoardDate() internally, and colors itself via the
      // shared util.boardUrgency() scale - no second countdown UI here.
      if (typeof G.renderBoardCountdown === "function") {
        // onDateSet: the button row above was built BEFORE this renders,
        // from whatever util.resolveBoardDate() returned at that moment -
        // if the Soldier had no date yet, "Remind me before board" was
        // never created at all (see the guard above). Setting one from
        // THIS component's own inline input redraws only itself, not this
        // whole function, so without this callback the button would stay
        // missing until View/Hide toggled or the route was reopened. A
        // full re-render of openPlan() is the simplest correct fix - it's
        // the exact same "redraw the whole function" pattern View/Hide,
        // Delete and Build's own success path already use for every other
        // state change on this screen.
        try { stage.appendChild(G.renderBoardCountdown(() => openPlan(family, expanded))); } catch (e) {}
      }

      if (expanded) stage.appendChild(buildResultView(plan));

      // Part C5: "What changed since <date>" - shown only once this family
      // has been re-imported at least once, built purely from the MOST
      // RECENT history entry's own stored diff (never recomputed here), so
      // what a Soldier reads matches exactly what build() recorded the
      // moment that revision was imported, even after a reload.
      if (family.history && family.history.length && family.history[0]) stage.appendChild(buildDiffPanel(family));

      // A "heads up" from the import just finished that the Soldier has not
      // dismissed yet follows them here (Build cleared the Review screen it
      // was on, and View/Hide details redraws this whole function). On a
      // routine later visit there is none: pendingNotice is per-import.
      const heads = mentionNotice(() => head);
      if (heads) stage.insertBefore(heads.node, stage.firstChild);
      // Roadmap audit lens (a11y, HIGH): matches review()'s own
      // tabindex="-1" + focus({preventScroll:true}) convention below - this
      // is an in-page state swap inside the SAME route (Delete's return to
      // Landing, Build's success path, and this function's own
      // View/Hide-details re-invocation just above all land here), not a
      // fresh route() call the router would announce on its own.
      head.setAttribute("tabindex", "-1");
      try { head.focus({ preventScroll: true }); } catch (e) {}
    }

    // Part C5: the "What changed since <date>" disclosure panel's own body -
    // same aria-expanded disclosure convention this file already uses for
    // its search toggle (grep "aria-expanded" in this file, e.g.
    // buildNeedsReviewRow()'s searchBtn below).
    function buildDiffPanel(family) {
      const latest = family.history[0]; // unshifted newest-first in build()
      const diff = latest.diff || { added: [], removed: [], coverageChanged: [] };
      const wrap = el("div.panel", { style: "margin-top:10px" });
      const dateStr = latest.importedAt ? new Date(latest.importedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "the last import";
      const summary = "+" + diff.added.length + " / −" + diff.removed.length + " / ~" + diff.coverageChanged.length;
      const toggle = el("button.btn.sm.ghost", { type: "button", text: "What changed since " + dateStr + " (" + summary + ")", "aria-expanded": "false" });
      wrap.appendChild(toggle);
      const body = el("div", { style: "margin-top:8px;display:none" });
      wrap.appendChild(body);

      function drawBody() {
        if (diff.added.length) {
          body.appendChild(el("div.ob-plan-label", { text: "Added (" + diff.added.length + ")" }));
          diff.added.forEach((topicName) => {
            const counts = (family.current.topicCoverage && family.current.topicCoverage[topicName]) || { doctrineCards: 0, selfCheckQuestions: 0 };
            const links = (family.current.topicLinks && family.current.topicLinks[topicName]) || {};
            const topicRow = el("div", { style: "margin:6px 0" });
            topicRow.appendChild(el("div.ob-plan-cat", { text: topicName }));
            // Reuses the SAME #/doctrine / #/board / #/library deep-link
            // buttons buildResultView() builds for every topic - never a
            // second copy of that button-building logic.
            const linkRow = buildTopicLinkRow(topicName, counts, links);
            if (linkRow.childNodes.length) topicRow.appendChild(linkRow);
            body.appendChild(topicRow);
          });
        }
        if (diff.removed.length) {
          body.appendChild(el("div.ob-plan-label", { text: "Removed (" + diff.removed.length + ")", style: "margin-top:8px" }));
          diff.removed.forEach((topicName) => body.appendChild(el("p.hint", { text: topicName, style: "margin:2px 0" })));
        }
        if (diff.coverageChanged.length) {
          body.appendChild(el("div.ob-plan-label", { text: "Coverage changed (" + diff.coverageChanged.length + ")", style: "margin-top:8px" }));
          diff.coverageChanged.forEach((c) => {
            const changeRow = el("div", { style: "margin:4px 0" });
            changeRow.appendChild(el("div.ob-plan-cat", { text: c.topic }));
            changeRow.appendChild(el("p.hint", { text: c.before.doctrineCards + " → " + c.after.doctrineCards + " doctrine cards · " + c.before.selfCheckQuestions + " → " + c.after.selfCheckQuestions + " self-check questions" }));
            body.appendChild(changeRow);
          });
        }
        if (!diff.added.length && !diff.removed.length && !diff.coverageChanged.length) {
          body.appendChild(el("p.hint", { text: "No topic or coverage changes since then." }));
        }
      }
      toggle.addEventListener("click", () => {
        const isOpen = body.style.display !== "none";
        body.style.display = isOpen ? "none" : "";
        toggle.setAttribute("aria-expanded", String(!isOpen));
        if (!isOpen && !body.firstChild) drawBody();
      });
      return wrap;
    }

    // Shared by buildResultView() (every topic row, below) and
    // buildDiffPanel()'s own added-topics list above - builds the SAME
    // #/doctrine / #/board / #/library deep-link buttons from a topic's own
    // coverage counts + links, so the two call sites can never drift out of
    // sync with each other.
    function buildTopicLinkRow(topicName, counts, links) {
      links = links || {};
      const linkRow = el("div.btn-row", { style: "gap:8px;flex-wrap:wrap;margin-top:6px" });
      if (counts.doctrineCards > 0) {
        const b = el("button.btn.sm.ghost", { type: "button", text: "Doctrine →" });
        // Reuses the SAME cross-link mechanism board questions already
        // use to jump into #/doctrine pre-filled (grep "_doctrineSeed"
        // in index.html) - not a new one.
        b.addEventListener("click", () => { if (G.views) G.views._doctrineSeed = links.citationKey || topicName; location.hash = "#/doctrine"; });
        linkRow.appendChild(b);
      }
      if (counts.selfCheckQuestions > 0 && links.boardCategory) {
        const b = el("button.btn.sm.ghost", { type: "button", text: "Board →" });
        // Reuses #/board's existing G.board._filterCat pre-filter
        // mechanism (grep it in index.html) - not a new one.
        b.addEventListener("click", () => { if (G.board) G.board._filterCat = links.boardCategory; location.hash = "#/board"; });
        linkRow.appendChild(b);
      }
      const doc = libraryDocFor(links.citationKey);
      if (doc) {
        const b = el("button.btn.sm.ghost", { type: "button", text: "Library →" });
        // Reuses #/library's existing G.library._openId mechanism
        // (grep it in library.js) - not a new one.
        b.addEventListener("click", () => { G.library._openId = doc.id; location.hash = "#/library"; });
        linkRow.appendChild(b);
      }
      return linkRow;
    }

    function buildResultView(plan) {
      const wrap = el("div");
      const groups = (plan.groups && plan.groups.length) ? plan.groups : [{ heading: null, topics: plan.topics.slice().sort() }];
      groups.forEach((g) => {
        if (g.heading) wrap.appendChild(el("div.ob-plan-label", { text: g.heading, style: "margin-top:10px" }));
        g.topics.forEach((topicName) => {
          const counts = (plan.topicCoverage && plan.topicCoverage[topicName]) || { doctrineCards: 0, selfCheckQuestions: 0 };
          const links = (plan.topicLinks && plan.topicLinks[topicName]) || {};
          // Part B4: same "|| null, no tag if missing" defensive idiom this
          // function already uses for counts/links above - an old plan
          // saved before Part B shipped just has no topicTiers field at
          // all, and renders with no tier badge, no migration needed.
          const tier = (plan.topicTiers && plan.topicTiers[topicName]) || null;
          const row = el("div.panel", { style: "margin-bottom:8px" });
          const rowHead = el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap" });
          rowHead.appendChild(el("div.ob-plan-cat", { text: topicName, style: "flex:1 1 auto;min-width:0" }));
          const badges = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;flex:0 0 auto" });
          const tb = tierBadge(tier);
          if (tb) badges.appendChild(tb);
          badges.appendChild(coverageBadge(counts));
          rowHead.appendChild(badges);
          row.appendChild(rowHead);
          row.appendChild(el("p.hint", { text: counts.doctrineCards + " doctrine card" + (counts.doctrineCards === 1 ? "" : "s") + " · " + counts.selfCheckQuestions + " self-check question" + (counts.selfCheckQuestions === 1 ? "" : "s") }));
          const linkRow = buildTopicLinkRow(topicName, counts, links);
          if (linkRow.childNodes.length) row.appendChild(linkRow);
          wrap.appendChild(row);
        });
      });
      if (plan.generatedDrillCategories && plan.generatedDrillCategories.length) {
        const drillHost = el("div.panel", { style: "margin-top:10px" });
        wrap.appendChild(drillHost);
        renderPracticeDrill(drillHost, plan.generatedDrillCategories);
      }
      return wrap;
    }

    // ---- Capture -----------------------------------------------------
    // Part C6: targetFamilyId threads through capture() -> runMatching() ->
    // review() -> build(). null/absent (every call site that starts a
    // BRAND-NEW plan - Landing's empty state, menu()'s "+ Import another
    // MOI") means "new plan family", the exact default this parameter has
    // whenever it is omitted. A real id (openPlan()'s "Re-import a
    // revision") means "this is a revision of an existing family."
    function capture(targetFamilyId) {
      targetFamilyId = targetFamilyId || null;
      util.clear(stage);
      const backBtn = el("button.btn.sm.ghost", { type: "button", text: "← Cancel" });
      // Roadmap audit lens (UX consistency): this used to discard whatever
      // was pasted/uploaded with zero warning - the one capture/edit screen
      // in the app that skipped the confirm-before-discard guard every
      // sibling screen already has. Matches the Author Studio scenario
      // editor's own Cancel button (index.html, grep "Discard this
      // scenario") precisely: confirm unconditionally rather than adding a
      // dirty-check, the same tradeoff that button already makes for the
      // identical problem shape.
      backBtn.addEventListener("click", async () => {
        if (!(await G.modal.confirm("Discard this MOI and any pasted/uploaded text? This can't be undone.", { danger: true }))) return;
        landing();
      });
      stage.appendChild(backBtn);

      const intro = el("p.hint", { style: "margin-top:8px", text:
        "Add your MOI below — upload a PDF, paste text, or both. A Soldier might have a clean PDF for part of an MOI and need to hand-paste an OCR'd or garbled part; both get combined before matching." });
      stage.appendChild(intro);
      // Part C6: names which family this capture will update once Built,
      // so a Soldier mid-paste is never confused about whether they are
      // starting something new or revising a plan they already have.
      if (targetFamilyId) {
        const revising = families.find((f) => f.id === targetFamilyId);
        stage.appendChild(el("p.hint", { style: "margin-top:2px;font-weight:600",
          text: "Re-importing a revision of “" + ((revising && revising.current.name) || "this MOI") + "”." }));
      }
      // Roadmap audit lens (a11y, HIGH): matches review()'s own
      // tabindex="-1" + focus({preventScroll:true}) convention below - this
      // is an in-page state swap inside the SAME route (Landing's "Import
      // an MOI", menu()'s "+ Import another MOI", and openPlan()'s
      // "Re-import a revision" all land here), not a fresh route() call
      // the router would announce on its own. Focuses this intro text
      // rather than the "← Cancel" button just above it - that button is
      // page chrome, not the content this transition needs to announce.
      intro.setAttribute("tabindex", "-1");
      try { intro.focus({ preventScroll: true }); } catch (e) {}

      let pdfText = "";
      const fileInput = el("input", { type: "file", accept: "application/pdf,.pdf,text/plain,.txt", "aria-label": "Upload MOI file (PDF or text)" });
      const fileStatus = el("p.hint", { role: "status", "aria-live": "polite", style: "margin-top:4px" });
      const errorBox = el("div");

      fileInput.addEventListener("change", async () => {
        const f = fileInput.files && fileInput.files[0];
        util.clear(errorBox);
        if (!f) { pdfText = ""; fileStatus.textContent = ""; return; }
        const isPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
        if (isPdf) {
          fileStatus.textContent = "Reading " + f.name + "…";
          try {
            const bytes = new Uint8Array(await f.arrayBuffer());
            await ensurePdfJsLocal();
            // Reuses openPdfPreview()'s exact getDocument() call shape
            // (index.html), including isEvalSupported:false - the same
            // GHSA-wgrm-67xf-hhpq mitigation - but this IS the first place
            // in the app that parses untrusted, externally-supplied PDF
            // bytes (openPdfPreview only ever renders this app's own
            // generated DA 4856), so the defense matters for real here,
            // not just as a copy-pasted precaution. getTextContent(), not
            // render() - this only ever needs the text, never a canvas.
            const doc = await window.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
            // Roadmap audit lens (Performance): each page's extraction has
            // no data dependency on any other page, so awaiting them one at
            // a time in a loop serialized work that can run concurrently.
            // Promise.all preserves page order in its results array
            // regardless of resolution order, so the join below still comes
            // out in the right sequence.
            const pagePromises = [];
            for (let i = 0; i < doc.numPages; i++) {
              pagePromises.push(
                doc.getPage(i + 1)
                  .then((page) => page.getTextContent())
                  .then((content) => content.items.map((it) => it.str).join(" "))
              );
            }
            const pageTexts = await Promise.all(pagePromises);
            let text = pageTexts.join("\n") + "\n";
            try { doc.destroy(); } catch (e2) {}
            pdfText = text;
            fileStatus.textContent = "Read " + doc.numPages + " page" + (doc.numPages === 1 ? "" : "s") + " from " + f.name + ".";
          } catch (e) {
            pdfText = "";
            fileStatus.textContent = "";
            errorBox.appendChild(el("div.feedback.warn", { text: "Couldn't read that PDF (" + (e && e.message ? e.message : "unknown error") + "). You can still paste its text below." }));
          }
        } else {
          try {
            pdfText = await f.text();
            fileStatus.textContent = "Read " + f.name + ".";
          } catch (e) {
            pdfText = "";
            errorBox.appendChild(el("div.feedback.warn", { text: "Couldn't read that file. You can still paste its text below." }));
          }
        }
        // Matches the Authoring Studio's own file-input reset (index.html)
        // so re-picking the same file after fixing something fires a
        // fresh "change" event instead of silently doing nothing.
        fileInput.value = "";
      });

      const ta = el("textarea", { rows: "8", placeholder: "Paste MOI text here (or part of it — combine with an uploaded PDF above)…", "aria-label": "Paste MOI text" });

      // The sensitive-text notice gets a box of its own, right above the
      // button that raised it. It used to share errorBox, which the file
      // picker clears on every change - and the one notice that was written
      // on the way to Review sat inside `stage`, which runMatching() clears
      // as its first statement, so it was destroyed in the same tick it was
      // written and no Soldier ever saw it.
      const guardBox = el("div");
      pendingNotice = null;

      // G.opsecGuard only REPORTS (see 05-opsec-guard.js); it never changes
      // the text. This screen decides what a report means, and the Soldier
      // decides the rest:
      //   stop  - real marking syntax. The text is not read. The notice names
      //           the line and the pasted text stays exactly as typed, so it
      //           can be fixed and tried again.
      //   check - the import pauses and asks. "Continue" reads the text as is.
      //   note  - routine contact details; the import carries on and Review
      //           mentions them.
      // The parser ALWAYS gets the original text. The earlier guard handed it
      // a rewritten copy, and "AR 600-20 2020" arrived as "AR [SSN REDACTED]":
      // the assigned regulation silently dropped out of the study plan.
      function find(acknowledged) {
        const combined = [pdfText, ta.value].filter(Boolean).join("\n");
        if (!combined.trim()) { try { util.toast("Add some MOI text first — upload a PDF or paste text."); } catch (e) {} return; }
        const result = (G.opsecGuard && G.opsecGuard.screen) ? G.opsecGuard.screen(combined) : { findings: [], stop: false, check: false };
        util.clear(guardBox);
        if (result.stop || (result.check && !acknowledged)) {
          const kind = result.stop ? "stop" : "check";
          const notice = guardNotice(kind, result.findings.filter((f) => f.severity === kind), {
            onContinue: () => find(true),
            onBack: () => { util.clear(guardBox); try { ta.focus(); } catch (e) {} },
          });
          guardBox.appendChild(notice.node);
          notice.focus();
          return;
        }
        const mention = result.findings.filter((f) => f.severity !== "stop");
        pendingNotice = mention.length ? { findings: mention } : null;
        runMatching(combined, targetFamilyId);
      }

      const findBtn = el("button.btn.primary", { type: "button", text: "Find my topics", style: "margin-top:10px" });
      findBtn.addEventListener("click", () => find(false));

      stage.appendChild(el("div.panel", { style: "margin-top:10px;border-left:3px solid var(--amber)" }, [
        el("div.eyebrow", { text: "Public / synthetic study material only" }),
        el("p.hint", { text: "Do not paste or upload classified information, CUI, real operational orders/rosters, mission grids, or sensitive personnel data. GUIDON checks the text first and points out anything that looks like a marking, an ID number, or a real future date and place. It never changes what you pasted, and the check is not a classification or public-release decision." }) ]));
      stage.appendChild(el("div.panel", { style: "margin-top:10px" }, [
        el("div.eyebrow", { text: "Upload a PDF or text file" }), fileInput, fileStatus, errorBox ]));
      stage.appendChild(el("div.panel", { style: "margin-top:10px" }, [
        el("div.eyebrow", { text: "Or paste text" }), ta ]));
      stage.appendChild(guardBox);
      stage.appendChild(findBtn);
    }

    // ---- Sensitive-text notice ----------------------------------------
    // One builder for all three kinds so the wording stays consistent. The
    // notice is an ordinary panel that stays on screen until the Soldier acts
    // on it - never a toast, which is gone before a 40-word message can be
    // read. Returns { node, focus } so the caller places it and then moves
    // keyboard focus onto its heading (the same tabindex="-1" convention
    // capture() and review() use for an in-page state swap).
    function guardNotice(kind, findings, handlers) {
      handlers = handlers || {};
      const what = (G.opsecGuard && G.opsecGuard.listWhat) ? G.opsecGuard.listWhat(findings) : "sensitive details";
      const box = el("div.panel", { "data-moi-guard": kind, style: "margin-top:10px;border-left:3px solid var(--amber)" });
      const title = el("div.eyebrow", { tabindex: "-1", text:
        kind === "stop" ? "GUIDON did not read this text" :
        kind === "check" ? "Take a look before GUIDON reads this" : "Heads up" });
      box.appendChild(title);

      let lead;
      if (kind === "stop") lead = "Part of it looks like " + what + ". A personal study tool is not the place for marked material.";
      else if (kind === "check") lead = "Part of it looks like " + what + ". GUIDON only looks for publication numbers (like AR 600-20). It keeps the topics it finds and your section headings, not the rest of your text.";
      else lead = "Your text includes " + what + ". GUIDON used the text only to find your publications — those details are not saved in your plan.";
      box.appendChild(el("p", { style: "margin:4px 0", text: lead }));

      if (kind !== "note") {
        const list = el("ul", { style: "margin:6px 0 6px 18px;padding:0" });
        findings.slice(0, 5).forEach((f) => {
          list.appendChild(el("li", { style: "margin:2px 0;overflow-wrap:anywhere", text: "Line " + f.line + ": “" + f.excerpt + "”" }));
        });
        if (findings.length > 5) list.appendChild(el("li", { style: "margin:2px 0", text: "…and " + (findings.length - 5) + " more." }));
        box.appendChild(list);
      }

      if (kind === "stop") {
        box.appendChild(el("p.hint", { text: "If this really is marked material, stop here and follow your unit's handling and reporting procedures. If it is only study text that talks about markings, take that line out and try again. Your text has not been changed or saved." }));
      } else if (kind === "check") {
        box.appendChild(el("p.hint", { text: "If this is a board date, a made-up example or a harmless detail, continue. If it is a real mission detail or someone's personal information, go back and take it out first. Your text has not been changed." }));
      }

      const row = el("div.btn-row", { style: "gap:8px;margin-top:6px" });
      if (kind === "check") {
        const go = el("button.btn.sm", { type: "button", text: "Continue" });
        go.addEventListener("click", () => { if (handlers.onContinue) handlers.onContinue(); });
        row.appendChild(go);
      }
      const back = el("button.btn.sm.ghost", { type: "button", text: kind === "note" ? "Dismiss" : (kind === "check" ? "Go back and edit" : "Dismiss") });
      back.addEventListener("click", () => { if (handlers.onBack) handlers.onBack(); });
      row.appendChild(back);
      box.appendChild(row);

      // Screen-reader users hear it too (G.util.announce is the app's one
      // polite live region), with the first flagged line so the message is
      // actionable without hunting for the list.
      const spoken = title.textContent + ". " + lead + (kind !== "note" && findings[0] ? " Line " + findings[0].line + "." : "");
      return {
        node: box,
        focus: () => { try { if (util.announce) util.announce(spoken); } catch (e) {} try { title.focus({ preventScroll: false }); } catch (e) {} },
        announce: () => { try { if (util.announce) util.announce(spoken); } catch (e) {} },
      };
    }

    // The "heads up" notice for what the check found but did not stop on.
    // It stays until dismissed: shown on Review, and carried onto the result
    // view by build() if the Soldier builds without dismissing it.
    function mentionNotice(afterDismissFocus) {
      if (!pendingNotice) return null;
      const notice = guardNotice("note", pendingNotice.findings, {
        onBack: () => {
          pendingNotice = null;
          if (notice.node.parentNode) notice.node.parentNode.removeChild(notice.node);
          try { if (afterDismissFocus) afterDismissFocus().focus({ preventScroll: true }); } catch (e) {}
        },
      });
      return notice;
    }

    // Only text the check found nothing in is ever written into the saved
    // plan. The plan keeps two strings lifted from the MOI - a unit line and
    // the section headings - and a POC line in capitals ("SSG DOE
    // 270-555-0101") reads as a heading. Such a line is left out rather than
    // rewritten: its topics fall under "General" instead.
    function cleanForPlan(str) {
      if (!str || !G.opsecGuard || !G.opsecGuard.screen) return str;
      return G.opsecGuard.screen(str).findings.length ? null : str;
    }
    function cleanGroupsForPlan(groups) {
      if (!groups) return groups;
      const merged = [];
      groups.forEach((g) => {
        const heading = cleanForPlan(g.heading) || "General";
        let b = merged.find((x) => x.heading === heading);
        if (!b) { b = { heading: heading, topics: [] }; merged.push(b); }
        (g.topics || []).forEach((t) => { if (b.topics.indexOf(t) === -1) b.topics.push(t); });
      });
      merged.forEach((b) => b.topics.sort());
      return merged.length > 1 ? merged : null;
    }

    // ---- Matching placeholder -> Review -------------------------------
    function runMatching(sourceText, targetFamilyId) {
      util.clear(stage);
      const placeholder = el("div.panel", { role: "status", "aria-live": "polite" });
      placeholder.appendChild(el("p", { text: "Reading your MOI…" }));
      stage.appendChild(placeholder);
      // Deliberately no heading-focus() call here - the placeholder is
      // transient. Focus moves once real Review content replaces it (see
      // review()'s own focus call below).
      setTimeout(() => {
        const tokens = tokenizeCitations(sourceText);
        // Dedup raw tokens (case-insensitive) - a citation repeated 3x in
        // one MOI shouldn't produce 3 identical cards - while keeping
        // first-seen order.
        const seen = new Set();
        const uniqueTokens = tokens.filter((t) => { const k = t.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; });
        const items = uniqueTokens.map((raw, i) => {
          const m = matchCitation(raw);
          return {
            id: "moi-item-" + i,
            raw: raw,
            tier: m.tier,
            normalized: m.normalized,
            topics: m.topics,
            boardCategories: m.boardCategories,
            counts: m.counts,
            // Part A2: this citation's OWN per-topic split of `counts` -
            // see build()'s own aggregation loop for why this, not `counts`
            // alone, is what fixes the fan-out inflation bug.
            topicCounts: m.topicCounts,
            // Matched tiers are pre-included by default; glyph-folded needs
            // an explicit Accept (see review()'s own bucketing below);
            // unmatched never contributes regardless.
            accepted: (m.tier === "exact-unique" || m.tier === "exact-fanout" || m.tier === "alias"),
            dismissed: false,
          };
        });
        review(items, sourceText, targetFamilyId);
      }, 30);
    }

    // ---- Review + Build (one screen) -----------------------------------
    function review(items, sourceText, targetFamilyId) {
      util.clear(stage);

      // Matched = high-confidence tiers, pre-included. Needs review =
      // glyph-folded only - a digit substitution is a correction, and this
      // app's own doctrine-accuracy standard says a correction never gets
      // silently trusted without the Soldier seeing it. Not found =
      // unmatched.
      const matched = items.filter((it) => it.tier === "exact-unique" || it.tier === "exact-fanout" || it.tier === "alias");
      const needsReview = items.filter((it) => it.tier === "glyph-folded");
      const notFound = items.filter((it) => it.tier === "unmatched");

      const h3 = el("h3", { text: "Review your matches" });
      stage.appendChild(h3);
      stage.appendChild(el("p.hint", { text:
        matched.length + " matched · " + needsReview.length + " need a look · " + notFound.length + " not found" }));

      // Added AFTER this function's own util.clear(stage) above, so it is
      // still here when the Soldier looks (the same wiped-before-it-painted
      // trap build() documents for its "Not saved" warning).
      const heads = mentionNotice(() => h3);
      if (heads) { stage.appendChild(heads.node); heads.announce(); }

      // Segmented filter - reuses this app's existing .segmented/
      // aria-pressed toggle convention (11+ existing sites, grep
      // index.html for ".segmented") instead of a new component. Shows
      // only ONE list at a time - the layout is too dense for a
      // phone-width column to stack all three.
      let activeSeg = matched.length ? "matched" : (needsReview.length ? "needs" : "notfound");
      const seg = el("div.segmented", { style: "margin:8px 0" });
      const matchedList = el("div");
      const needsList = el("div");
      const notFoundList = el("div");
      const SEGMENTS = [
        ["matched", "Matched (" + matched.length + ")", matchedList],
        ["needs", "Needs review (" + needsReview.length + ")", needsList],
        ["notfound", "Not found (" + notFound.length + ")", notFoundList],
      ];
      function drawSeg() {
        util.clear(seg);
        SEGMENTS.forEach((s) => {
          const id = s[0];
          const b = el("button", { type: "button", text: s[1], "aria-pressed": String(id === activeSeg) });
          if (id === activeSeg) b.classList.add("active");
          b.addEventListener("click", () => {
            if (activeSeg === id) return;
            activeSeg = id;
            drawSeg();
            showActiveList();
          });
          seg.appendChild(b);
        });
      }
      function showActiveList() {
        matchedList.style.display = activeSeg === "matched" ? "" : "none";
        needsList.style.display = activeSeg === "needs" ? "" : "none";
        notFoundList.style.display = activeSeg === "notfound" ? "" : "none";
      }
      drawSeg();
      stage.appendChild(seg);

      if (matched.length) matched.forEach((it) => matchedList.appendChild(buildMatchedRow(it)));
      else matchedList.appendChild(util.emptyState("Nothing matched yet", "Nothing in this MOI matched a known citation."));

      if (needsReview.length) needsReview.forEach((it) => needsList.appendChild(buildNeedsReviewRow(it)));
      else needsList.appendChild(util.emptyState("Nothing needs a look", "Every citation GUIDON found was either a clean match or wasn't found at all."));

      if (notFound.length) notFound.forEach((it) => notFoundList.appendChild(buildNotFoundRow(it)));
      else notFoundList.appendChild(util.emptyState("Nothing missing", "Every citation GUIDON found matched something in the library."));

      stage.appendChild(matchedList); stage.appendChild(needsList); stage.appendChild(notFoundList);
      showActiveList();

      // ---- Commit-time choices: both independently selectable, both
      // checked by default, not mutually exclusive. ----
      const optWrap = el("div.panel", { style: "margin-top:12px" });
      const savePlanCb = el("input", { type: "checkbox", id: "moi-opt-save" }); savePlanCb.checked = true;
      const genDrillCb = el("input", { type: "checkbox", id: "moi-opt-drill" }); genDrillCb.checked = true;
      optWrap.appendChild(el("div", { style: "display:flex;gap:8px;align-items:center;margin:4px 0" }, [savePlanCb, el("label", { "for": "moi-opt-save", text: "Save as my study plan" })]));
      optWrap.appendChild(el("div", { style: "display:flex;gap:8px;align-items:center;margin:4px 0" }, [genDrillCb, el("label", { "for": "moi-opt-drill", text: "Generate a practice drill now" })]));
      const buildBtn = el("button.btn.primary", { type: "button", text: "Build →", style: "margin-top:8px" });
      buildBtn.addEventListener("click", () => build(items, sourceText, savePlanCb.checked, genDrillCb.checked, targetFamilyId));
      optWrap.appendChild(buildBtn);
      stage.appendChild(optWrap);

      // Real content just replaced the "Reading your MOI…" placeholder -
      // matches the router's own tabindex="-1" + focus({preventScroll:true})
      // convention for announcing new content to screen-reader/keyboard
      // users (route()'s h1/h2 focus in index.html), done manually here
      // because this is an in-page state swap inside the SAME route, not a
      // fresh route() call the router would announce on its own.
      h3.setAttribute("tabindex", "-1");
      try { h3.focus({ preventScroll: true }); } catch (e) {}
    }

    function buildMatchedRow(it) {
      const card = el("div.panel", { style: "margin-bottom:8px" });
      const topLine = el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap" });
      const nameBox = el("div", { style: "flex:1 1 auto;min-width:0" });
      nameBox.appendChild(el("div.ob-plan-cat", { text: it.topics.length ? it.topics.join(", ") : it.normalized }));
      nameBox.appendChild(el("div.hint", { text: it.normalized + (it.tier === "alias" ? " (superseded " + it.raw + ")" : "") }));
      topLine.appendChild(nameBox);
      // Part B2: the tier badge sits next to the existing coverage badge -
      // same pairing buildResultView() renders for a saved plan (Part B4),
      // so Review and the persisted dashboard never disagree about what a
      // match tier means.
      const badges = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;flex:0 0 auto" });
      const tb = tierBadge(it.tier);
      if (tb) badges.appendChild(tb);
      badges.appendChild(coverageBadge(it.counts));
      topLine.appendChild(badges);
      card.appendChild(topLine);
      const cnt = it.counts || { doctrineCards: 0, selfCheckQuestions: 0 };
      card.appendChild(el("p.hint", { style: "margin:4px 0 0", text: cnt.doctrineCards + " doctrine card" + (cnt.doctrineCards === 1 ? "" : "s") + " · " + cnt.selfCheckQuestions + " self-check question" + (cnt.selfCheckQuestions === 1 ? "" : "s") }));
      const row = el("div", { style: "margin-top:6px;display:flex;gap:6px;align-items:center" });
      const includeCb = el("input", { type: "checkbox", id: it.id + "-include" }); includeCb.checked = it.accepted;
      // In-place only: this toggle updates the item's own state and never
      // touches any other row or rebuilds the list.
      includeCb.addEventListener("change", () => { it.accepted = includeCb.checked; });
      row.appendChild(includeCb); row.appendChild(el("label", { "for": it.id + "-include", text: "Include in my plan" }));
      card.appendChild(row);
      return card;
    }

    function buildNeedsReviewRow(it) {
      const card = el("div.panel", { style: "margin-bottom:8px" });
      const status = el("span.badge", { text: "Needs a look" });
      card.appendChild(status);
      card.appendChild(el("p", { style: "margin:4px 0", text: "You wrote: “" + it.raw + "”" }));
      card.appendChild(el("p.hint", { text: "Guessing: " + it.normalized + (it.topics.length ? " (" + it.topics.join(", ") + ")" : "") }));

      const btnRow = el("div.btn-row", { style: "gap:8px;margin-top:6px" });
      const acceptBtn = el("button.btn.sm", { type: "button", text: "Accept" });
      const dismissBtn = el("button.btn.sm.ghost", { type: "button", text: "Dismiss" });
      // Roadmap audit lens (a11y/UX polish): this button flips searchWrap's
      // display style without touching aria-expanded - the same disclosure-
      // toggle gap a prior audit round fixed for detailsBtn/moreToggle/
      // filtersToggle/settingsAdvToggle (see index.html, grep "aria-expanded"
      // convention comment near "detailsBtn"). moi-import.js was added after
      // that round so it never got the same treatment. Matches that pattern:
      // aria-expanded="false" at creation, flipped in the click handler.
      const searchBtn = el("button.btn.sm.ghost", { type: "button", text: "Search for the right topic", "aria-expanded": "false" });
      btnRow.appendChild(acceptBtn); btnRow.appendChild(dismissBtn); btnRow.appendChild(searchBtn);
      card.appendChild(btnRow);

      const searchWrap = el("div", { style: "margin-top:8px;display:none" });
      card.appendChild(searchWrap);

      // Every action below mutates ONLY this row's own DOM/state - it never
      // clears or rebuilds matchedList/needsList/notFoundList, so a fast
      // second tap always lands on the control it was aimed at, even right
      // after a prior action on this same row.
      function refreshStatus() {
        util.clear(status);
        status.textContent = it.accepted ? "Accepted" : (it.dismissed ? "Dismissed" : "Needs a look");
        status.className = "badge" + (it.accepted ? " green" : (it.dismissed ? "" : " amber"));
      }
      acceptBtn.addEventListener("click", () => { it.accepted = true; it.dismissed = false; refreshStatus(); });
      dismissBtn.addEventListener("click", () => { it.accepted = false; it.dismissed = true; refreshStatus(); });
      searchBtn.addEventListener("click", () => {
        const isOpen = searchWrap.style.display !== "none";
        searchWrap.style.display = isOpen ? "none" : "";
        searchBtn.setAttribute("aria-expanded", String(!isOpen));
        if (!isOpen && !searchWrap.firstChild) buildInlineTopicSearch(searchWrap, it, refreshStatus);
      });
      refreshStatus();
      return card;
    }

    // Expands WITHIN the row itself - a small text input + filtered list
    // over the known topic set - never a separate modal.
    function buildInlineTopicSearch(wrap, it, onPicked) {
      const input = el("input", { type: "text", placeholder: "Search topics…", "aria-label": "Search for the right topic" });
      const results = el("div", { style: "max-height:180px;overflow:auto;margin-top:4px" });
      wrap.appendChild(input); wrap.appendChild(results);
      const topics = allKnownTopics();
      function draw() {
        util.clear(results);
        const q = input.value.trim().toLowerCase();
        const list = (q ? topics.filter((t) => t.toLowerCase().indexOf(q) !== -1) : topics).slice(0, 25);
        list.forEach((t) => {
          const b = el("button.btn.sm.ghost", { type: "button", text: t, style: "display:block;width:100%;text-align:left;margin-top:2px" });
          b.addEventListener("click", () => {
            // Never silently swallow the original correction - the trail
            // stays visible in the row's own "Guessing:" line.
            it.normalized = it.normalized + " → " + t;
            it.topics = [t];
            it.accepted = true; it.dismissed = false;
            onPicked();
          });
          results.appendChild(b);
        });
        if (!list.length) results.appendChild(el("p.hint", { text: "No topics match." }));
      }
      input.addEventListener("input", draw);
      draw();
    }

    function buildNotFoundRow(it) {
      const card = el("div.panel", { style: "margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap" });
      card.appendChild(el("div", { text: it.raw, style: "flex:1 1 auto;min-width:0" }));
      const dismissBtn = el("button.btn.sm.ghost", { type: "button", text: "Dismiss" });
      dismissBtn.addEventListener("click", () => { card.style.display = "none"; }); // in-place: hides only this row
      card.appendChild(dismissBtn);
      return card;
    }

    // ---- Build -----------------------------------------------------------
    function build(items, sourceText, savePlan, genDrill, targetFamilyId) {
      const topicAgg = new Map(); // topicName -> { doctrineCards, selfCheckQuestions, citationKey, boardCategory, tier }
      const boardCatsForDrill = new Set();
      items.forEach((it) => {
        if (!it.accepted || it.dismissed) return;
        (it.boardCategories || []).forEach((c) => boardCatsForDrill.add(c));
        (it.topics || []).forEach((t) => {
          let a = topicAgg.get(t);
          // citationKey/boardCategory/tier all use the same first-write-wins
          // idiom: set once at creation (citationKey, tier) or the first
          // time a real value shows up (boardCategory's own `if (!a.x)`
          // guard below) and never revisited - a topic that appears via
          // more than one accepted citation keeps whichever was recorded
          // first.
          if (!a) { a = { doctrineCards: 0, selfCheckQuestions: 0, citationKey: it.normalized, boardCategory: null, tier: it.tier }; topicAgg.set(t, a); }
          // Part A2 fix: a fan-out citation's shared aggregate (it.counts)
          // used to be added to EVERY topic bucket it touches, inflating
          // every topic's coverage to the citation's COMBINED total instead
          // of that topic's real share. it.topicCounts[t] is this SAME
          // citation's contribution to JUST this topic. Falls back to
          // it.counts for two cases where no per-topic entry exists:
          // buildInlineTopicSearch()'s manual topic-pick path (it.topics =
          // [t] is set after the fact, with no topicCounts entry for that
          // freshly-chosen topic), and the pre-fix common case of a
          // citation with only ONE topic overall (topicCounts[t] and counts
          // are numerically identical there, so the fallback changes
          // nothing). Both must keep behaving exactly as before this fix.
          const c = (it.topicCounts && it.topicCounts[t]) || it.counts || { doctrineCards: 0, selfCheckQuestions: 0 };
          a.doctrineCards += c.doctrineCards; a.selfCheckQuestions += c.selfCheckQuestions;
          if (!a.boardCategory && it.boardCategories && it.boardCategories.length) a.boardCategory = it.boardCategories[0];
        });
      });

      if (!topicAgg.size) {
        try { util.toast("Nothing is included yet — accept at least one match first."); } catch (e) {}
        return;
      }

      const topicNames = Array.from(topicAgg.keys());
      const topicCoverage = {}, topicLinks = {}, topicTiers = {};
      topicAgg.forEach((a, t) => {
        topicCoverage[t] = { doctrineCards: a.doctrineCards, selfCheckQuestions: a.selfCheckQuestions };
        topicLinks[t] = { citationKey: a.citationKey, boardCategory: a.boardCategory };
        topicTiers[t] = a.tier || null;
      });

      const plan = {
        name: cleanForPlan(detectMoiName(sourceText)) || ("MOI imported " + new Date().toLocaleDateString()),
        importedAt: Date.now(),
        topics: topicNames,
        topicCoverage: topicCoverage,
        topicLinks: topicLinks,
        // Part B3: {topicName: tier} - which confidence tier matched each
        // topic into this plan, rendered by buildResultView() (Part B4) as
        // the same TIER_BADGE tag Review already shows.
        topicTiers: topicTiers,
        groups: cleanGroupsForPlan(detectGroups(sourceText, topicNames)), // [{heading, topics}] or null -> alphabetical fallback in buildResultView
        generatedDrillCategories: genDrill ? Array.from(boardCatsForDrill) : [],
      };

      (async () => {
        // Reload fresh (not just the in-memory `families` captured when
        // this route rendered) so a family this same visit already changed
        // elsewhere (Delete, an earlier Build) is never clobbered by a
        // stale copy.
        try {
          const pr = await G.db.get("kv", PLANS_KEY);
          if (pr && Array.isArray(pr.v)) families = pr.v;
        } catch (e) {}

        const existingIdx = targetFamilyId ? families.findIndex((f) => f.id === targetFamilyId) : -1;
        let family, nextFamilies;
        if (existingIdx !== -1) {
          // Part C7: a revision of an existing family - diff the OLD
          // current against the freshly built plan, unshift it onto
          // history (newest first), cap at HISTORY_CAP dropping the
          // oldest, then replace current.
          const existing = families[existingIdx];
          const diff = diffPlans(existing.current, plan);
          const history = [{ importedAt: existing.current.importedAt, snapshot: existing.current, diff: diff }]
            .concat(existing.history || [])
            .slice(0, HISTORY_CAP);
          family = Object.assign({}, existing, { current: plan, history: history });
          nextFamilies = families.slice();
          nextFamilies[existingIdx] = family;
        } else {
          // A brand-new family - fresh id, no history yet. Trimmed to
          // FAMILY_CAP, oldest createdAt dropped first.
          family = { id: "moi-" + plan.importedAt + "-" + Math.random().toString(36).slice(2, 8), createdAt: plan.importedAt, current: plan, history: [] };
          nextFamilies = families.concat([family]);
          if (nextFamilies.length > FAMILY_CAP) {
            nextFamilies = nextFamilies.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, FAMILY_CAP);
          }
        }

        if (savePlan) {
          // Roadmap audit lens (UX consistency): the failure path already
          // toasted "Couldn't save your plan." - success was silent, the
          // one save action in this file with no positive confirmation.
          try {
            await G.db.put("kv", { k: PLANS_KEY, v: nextFamilies });
            families = nextFamilies;
            updateFamiliesCache(families);
            try { util.toast("MOI plan saved."); } catch (e2) {}
          } catch (e) { try { util.toast("Couldn't save your plan."); } catch (e2) {} }
        }
        // "Redraw Landing's own already-imported branch AS the result
        // view" - the SAME route re-rendering with new state, not a
        // separate step. Starts expanded (unlike a routine later visit,
        // which defaults collapsed behind "View") so the Soldier
        // immediately sees what was just built, saved or not. Even when
        // NOT saved, `family` (built above but never written to
        // `families`/PLANS_KEY) still carries a correct preview - a
        // revision-in-progress shows its real diff-so-far without ever
        // persisting anything.
        // openPlan() does its own util.clear(stage) as its first
        // statement, which would wipe a warning appended before calling
        // it - so the warning has to be inserted AFTER, not before
        // (confirmed live via Playwright: the pre-call ordering left the
        // warning text absent from the rendered DOM even though it was
        // present in this file's source).
        openPlan(family, true);
        if (!savePlan) {
          stage.insertBefore(el("div.feedback.warn", { text: "Not saved — “Save as my study plan” was unchecked, so this view will be gone once you navigate away." }), stage.firstChild);
        }
      })();
    }

    // ---- Practice drill: small, self-contained, disposable session state
    // (never persisted, discarded on navigating away - matches Mock
    // Board/Rapid Fire's own local-session convention) modeled closely on
    // Drills' mdmpDrill() reveal/next shape (index.html), as an
    // independent implementation rather than sharing its code, per this
    // feature's own scope. ----
    function renderPracticeDrill(container, boardCategories) {
      util.clear(container);
      container.appendChild(el("div.eyebrow", { text: "Practice drill — built from your MOI" }));
      const catSet = new Set(boardCategories || []);
      const all = (G.store && G.store.boardQuestions && G.store.boardQuestions()) || [];
      const pool = all.filter((q) => catSet.has(q.category));
      // Fisher-Yates shuffle - a fresh order every session.
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      if (!pool.length) {
        container.appendChild(el("p.hint", { text: "No self-check questions found yet for these topics — the doctrine coverage is still there, just no board-question bank entry for this exact citation." }));
        return;
      }
      let i = 0, revealed = false;
      const prog = el("p.hint");
      const catLine = el("div.ob-plan-cat");
      const box = el("div.card", { style: "margin:8px 0" });
      const row = el("div.btn-row", { style: "gap:8px" });
      const rev = el("button.btn.sm", { type: "button", text: "Reveal answer" });
      const nxt = el("button.btn.sm", { type: "button", text: "Next →" });
      row.appendChild(rev); row.appendChild(nxt);
      container.appendChild(prog); container.appendChild(catLine); container.appendChild(box); container.appendChild(row);
      function draw() {
        const q = pool[i];
        prog.textContent = "Question " + (i + 1) + " of " + pool.length;
        catLine.textContent = q.category;
        util.clear(box);
        box.appendChild(el("p", { text: q.q }));
        if (revealed) box.appendChild(el("p", { style: "margin-top:6px;font-weight:600", text: q.a || q.boardAnswer || "" }));
        else box.appendChild(el("p", { style: "opacity:.72;font-style:italic;margin-top:6px", text: "Answer, then reveal." }));
        rev.textContent = revealed ? "Hide" : "Reveal answer";
      }
      rev.addEventListener("click", () => { revealed = !revealed; draw(); });
      nxt.addEventListener("click", () => { i = (i + 1) % pool.length; revealed = false; draw(); });
      draw();
    }
  }

  // Pure functions exposed alongside render() so tools/test-moi-import.mjs
  // can exercise them directly against the real seed via window.G.moiImport
  // - the same pattern test-rankutils.mjs already uses for G.rankUtils, and
  // records.js uses for its own GROUPS/TOTAL/VALID_IDS.
  G.moiImport = {
    render: render,
    tokenizeCitations: tokenizeCitations,
    normalizeCitation: normalizeCitation,
    matchCitation: matchCitation,
    buildCitationRegistry: buildCitationRegistry,
    // Part C8: diffPlans exported so tools/test-moi-import.mjs can unit-test
    // it directly, the same way it already exercises tokenizeCitations/
    // matchCitation. PLANS_KEY alongside the legacy KEY - both real kv keys
    // a test needs to seed/read directly.
    diffPlans: diffPlans,
    MOI_CITATION_ALIASES: MOI_CITATION_ALIASES,
    KEY: KEY,
    PLANS_KEY: PLANS_KEY,
    // Part E (MOI Scope, ROADMAP 3g phase 2): activeFocusSet is pure and
    // exported for tools/test-moi-scope.mjs to exercise directly, the same
    // way diffPlans already is for tools/test-moi-import.mjs. cachedFamilies/
    // currentFamilies/inScopeIds/setInScope are the read/write surface
    // store.boardQuestions()/store.doctrine() and index.html's Settings
    // panel (and this file's own menu()/openPlan() toggles) all go through -
    // see each function's own comment.
    activeFocusSet: activeFocusSet,
    cachedFamilies: cachedFamilies,
    currentFamilies: currentFamilies,
    inScopeIds: inScopeIds,
    setInScope: setInScope,
  };
})();
// END moi-import.js
