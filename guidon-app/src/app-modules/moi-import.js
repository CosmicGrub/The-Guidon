/* ==== js/moi-import.js ==== */
/* GUIDON - moi-import.js : MOI Import Engine, Phase 1 (G.moiImport)

   An MOI (memorandum of instruction) is the memo a board assigns a Soldier -
   a list of doctrine citations naming exactly what to study. The gap this
   closes: GUIDON already has a huge doctrine/board-question corpus, but a
   Soldier handed a real MOI has no way to see it filtered down to ONLY what
   their own board actually assigned. This lets them paste or upload that
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
  const KEY = "guidon:moi:plan:v1";

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
      if (!e) { e = { topics: new Set(), boardCategories: new Set(), counts: { doctrineCards: 0, selfCheckQuestions: 0 } }; registry.set(key, e); }
      return e;
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
  function matchCitation(rawToken) {
    const norm = normalizeCitation(rawToken);
    if (!norm) return { raw: rawToken, tier: "unmatched", normalized: null, topics: [], boardCategories: [], counts: null };
    const key = norm.pubType + " " + norm.number;
    const registry = buildCitationRegistry();

    // Alias table checked FIRST, before a direct lookup - a citation that
    // literally spells a rescinded/superseded publication should resolve
    // to what replaced it, not report "not found" just because the old
    // number was never itself cited anywhere in the corpus.
    const aliasTarget = MOI_CITATION_ALIASES[key];
    if (aliasTarget && registry.has(aliasTarget)) {
      const e = registry.get(aliasTarget);
      return { raw: rawToken, tier: "alias", normalized: aliasTarget, topics: Array.from(e.topics), boardCategories: Array.from(e.boardCategories), counts: e.counts };
    }

    const e = registry.get(key);
    if (e) {
      const tier = norm.glyphFolded ? "glyph-folded" : (e.topics.size > 1 ? "exact-fanout" : "exact-unique");
      return { raw: rawToken, tier: tier, normalized: key, topics: Array.from(e.topics), boardCategories: Array.from(e.boardCategories), counts: e.counts };
    }

    return { raw: rawToken, tier: "unmatched", normalized: key, topics: [], boardCategories: [], counts: null };
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

    let saved = null;
    try {
      const r = await G.db.get("kv", KEY);
      saved = (r && r.v && typeof r.v === "object") ? r.v : null;
    } catch (e) { /* offline-safe, matches records.js's own G.db.get try/catch */ }

    landing();

    // ---- Landing ---------------------------------------------------------
    function landing() {
      util.clear(stage);
      if (!hasPlan(saved)) {
        stage.appendChild(util.emptyState(
          "No MOI imported yet",
          "Paste or upload your board's MOI and GUIDON builds a study dashboard from exactly what it assigns — nothing added, nothing assumed.",
          "Import an MOI",
          capture));
        return;
      }
      renderAlreadyImported(saved, false);
    }

    function renderAlreadyImported(plan, expanded) {
      util.clear(stage);
      const head = el("div.panel", { style: "margin-bottom:10px" });
      head.appendChild(el("div.eyebrow", { text: plan.name || "Your MOI" }));
      const dateStr = plan.importedAt ? new Date(plan.importedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
      head.appendChild(el("p.hint", { text: (dateStr ? "Imported " + dateStr + " · " : "") + plan.topics.length + " topic" + (plan.topics.length === 1 ? "" : "s") }));
      const row = el("div.btn-row", { style: "gap:8px;flex-wrap:wrap;margin-top:6px" });
      const replaceBtn = el("button.btn.sm", { type: "button", text: "Replace" });
      replaceBtn.addEventListener("click", capture);
      const viewBtn = el("button.btn.sm.ghost", { type: "button", text: expanded ? "Hide details" : "View" });
      viewBtn.addEventListener("click", () => renderAlreadyImported(plan, !expanded));
      const deleteBtn = el("button.btn.sm.ghost", { type: "button", text: "Delete" });
      deleteBtn.addEventListener("click", async () => {
        try { await G.db.put("kv", { k: KEY, v: null }); } catch (e) {}
        saved = null;
        try { util.toast("MOI plan deleted."); } catch (e) {}
        landing();
      });
      row.appendChild(replaceBtn); row.appendChild(viewBtn); row.appendChild(deleteBtn);
      head.appendChild(row);
      stage.appendChild(head);
      if (expanded) stage.appendChild(buildResultView(plan));
    }

    function buildResultView(plan) {
      const wrap = el("div");
      const groups = (plan.groups && plan.groups.length) ? plan.groups : [{ heading: null, topics: plan.topics.slice().sort() }];
      groups.forEach((g) => {
        if (g.heading) wrap.appendChild(el("div.ob-plan-label", { text: g.heading, style: "margin-top:10px" }));
        g.topics.forEach((topicName) => {
          const counts = (plan.topicCoverage && plan.topicCoverage[topicName]) || { doctrineCards: 0, selfCheckQuestions: 0 };
          const links = (plan.topicLinks && plan.topicLinks[topicName]) || {};
          const row = el("div.panel", { style: "margin-bottom:8px" });
          const rowHead = el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap" });
          rowHead.appendChild(el("div.ob-plan-cat", { text: topicName, style: "flex:1 1 auto;min-width:0" }));
          rowHead.appendChild(coverageBadge(counts));
          row.appendChild(rowHead);
          row.appendChild(el("p.hint", { text: counts.doctrineCards + " doctrine card" + (counts.doctrineCards === 1 ? "" : "s") + " · " + counts.selfCheckQuestions + " self-check question" + (counts.selfCheckQuestions === 1 ? "" : "s") }));
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
    function capture() {
      util.clear(stage);
      const backBtn = el("button.btn.sm.ghost", { type: "button", text: "← Cancel" });
      backBtn.addEventListener("click", landing);
      stage.appendChild(backBtn);

      stage.appendChild(el("p.hint", { style: "margin-top:8px", text:
        "Add your MOI below — upload a PDF, paste text, or both. A Soldier might have a clean PDF for part of an MOI and need to hand-paste an OCR'd or garbled part; both get combined before matching." }));

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
            let text = "";
            for (let p = 1; p <= doc.numPages; p++) {
              const page = await doc.getPage(p);
              const content = await page.getTextContent();
              text += content.items.map((it) => it.str).join(" ") + "\n";
            }
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

      const findBtn = el("button.btn.primary", { type: "button", text: "Find my topics", style: "margin-top:10px" });
      findBtn.addEventListener("click", () => {
        const combined = [pdfText, ta.value].filter(Boolean).join("\n");
        if (!combined.trim()) { try { util.toast("Add some MOI text first — upload a PDF or paste text."); } catch (e) {} return; }
        runMatching(combined);
      });

      stage.appendChild(el("div.panel", { style: "margin-top:10px" }, [
        el("div.eyebrow", { text: "Upload a PDF or text file" }), fileInput, fileStatus, errorBox ]));
      stage.appendChild(el("div.panel", { style: "margin-top:10px" }, [
        el("div.eyebrow", { text: "Or paste text" }), ta ]));
      stage.appendChild(findBtn);
    }

    // ---- Matching placeholder -> Review -------------------------------
    function runMatching(sourceText) {
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
            // Matched tiers are pre-included by default; glyph-folded needs
            // an explicit Accept (see review()'s own bucketing below);
            // unmatched never contributes regardless.
            accepted: (m.tier === "exact-unique" || m.tier === "exact-fanout" || m.tier === "alias"),
            dismissed: false,
          };
        });
        review(items, sourceText);
      }, 30);
    }

    // ---- Review + Build (one screen) -----------------------------------
    function review(items, sourceText) {
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
      buildBtn.addEventListener("click", () => build(items, sourceText, savePlanCb.checked, genDrillCb.checked));
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
      topLine.appendChild(coverageBadge(it.counts));
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
      const searchBtn = el("button.btn.sm.ghost", { type: "button", text: "Search for the right topic" });
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
    function build(items, sourceText, savePlan, genDrill) {
      const topicAgg = new Map(); // topicName -> { doctrineCards, selfCheckQuestions, citationKey, boardCategory }
      const boardCatsForDrill = new Set();
      items.forEach((it) => {
        if (!it.accepted || it.dismissed) return;
        (it.boardCategories || []).forEach((c) => boardCatsForDrill.add(c));
        (it.topics || []).forEach((t) => {
          let a = topicAgg.get(t);
          if (!a) { a = { doctrineCards: 0, selfCheckQuestions: 0, citationKey: it.normalized, boardCategory: null }; topicAgg.set(t, a); }
          if (it.counts) { a.doctrineCards += it.counts.doctrineCards; a.selfCheckQuestions += it.counts.selfCheckQuestions; }
          if (!a.boardCategory && it.boardCategories && it.boardCategories.length) a.boardCategory = it.boardCategories[0];
        });
      });

      if (!topicAgg.size) {
        try { util.toast("Nothing is included yet — accept at least one match first."); } catch (e) {}
        return;
      }

      const topicNames = Array.from(topicAgg.keys());
      const topicCoverage = {}, topicLinks = {};
      topicAgg.forEach((a, t) => {
        topicCoverage[t] = { doctrineCards: a.doctrineCards, selfCheckQuestions: a.selfCheckQuestions };
        topicLinks[t] = { citationKey: a.citationKey, boardCategory: a.boardCategory };
      });

      const plan = {
        name: detectMoiName(sourceText) || ("MOI imported " + new Date().toLocaleDateString()),
        importedAt: Date.now(),
        topics: topicNames,
        topicCoverage: topicCoverage,
        topicLinks: topicLinks,
        groups: detectGroups(sourceText, topicNames), // [{heading, topics}] or null -> alphabetical fallback in buildResultView
        generatedDrillCategories: genDrill ? Array.from(boardCatsForDrill) : [],
      };

      (async () => {
        if (savePlan) {
          try { await G.db.put("kv", { k: KEY, v: plan }); } catch (e) { try { util.toast("Couldn't save your plan."); } catch (e2) {} }
          saved = plan;
        }
        // "Redraw Landing's own already-imported branch AS the result
        // view" - the SAME route re-rendering with new state, not a
        // separate step. Starts expanded (unlike a routine later visit,
        // which defaults collapsed behind "View") so the Soldier
        // immediately sees what was just built, saved or not.
        util.clear(stage);
        if (!savePlan) {
          stage.appendChild(el("div.feedback.warn", { text: "Not saved — “Save as my study plan” was unchecked, so this view will be gone once you navigate away." }));
        }
        renderAlreadyImported(plan, true);
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
    MOI_CITATION_ALIASES: MOI_CITATION_ALIASES,
    KEY: KEY,
  };
})();
// END moi-import.js
