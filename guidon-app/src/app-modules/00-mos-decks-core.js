/* GUIDON - MOS decks core (ROADMAP 3g item G).
   "MOS decks as a first-class opt-in lane with their own Readiness row (92A
   is the first of many)." The product decision this round: a MOS-tagged
   card or scenario is HIDDEN by default, not shown-by-default-and-narrowed
   the way it worked before this module existed. A Soldier sees a MOS deck's
   content only when:
     (a) their own profile.mos prefix-matches the deck's code (the pre-
         existing narrowing rule store.boardQuestions() already applied), OR
     (b) they have explicitly opted in from Settings -> Study Preferences ->
         MOS Decks.
   Before this module, (a) was the ONLY signal, and it only ever narrowed a
   pool that was visible to EVERYONE by default (no MOS on the profile meant
   nothing was hidden) - see boardQuestions()'s own comment in src/index.html
   for that history. This module is the one place both halves of "is this
   MOS deck active for this Soldier" are decided, so store.boardQuestions(),
   store.scenarios() and the Readiness tab's new "MOS Deck Readiness" panel
   can never drift into three different answers to the same question.

   This is a content-pack-adjacent FEATURE module (kind "feature" in
   manifest.json, not "content-pack") - it adds no cards or scenarios of its
   own, only the registry and the opt-in API every MOS content pack (92A
   today, more later) and the runtime filters call into. headless:true: it
   touches nothing but a plain in-memory array and (when present) G.store,
   so tools/assemble-bank.mjs's no-DOM sandbox loads it exactly like the
   browser does. It loads BEFORE 01-board-supplement-92a.js (manifest.json's
   "requires") so that pack's own registration call always has somewhere to
   register into.

   STANDING RULE for every MOS-specific content pack from here forward, not
   just 92A: 92A (01-board-supplement-92a.js) is the REFERENCE PATTERN, not a
   one-off special case. Declare the deck once, inside its own pack file,
   the way that best matches when the pack actually runs (ROADMAP 3g E x G
   reconciliation - E moved every "content-pack"-kind module to run once at
   BUILD time, in a Node sandbox with no window.G, after G had already
   shipped register() as a runtime-only call):
     1a. a BUILD-TIME pack ("emit":"build", e.g. 01-board-supplement-92a.js)
         pushes { code, label, pillar } onto bank.mosDecks (create the array
         if absent) from inside its own G.contentPack.define(...) builder -
         baked into the shipped seed like every other pack-added fact, read
         back by this module below via seedFromBakedSeed(); OR
     1b. a RUNTIME "feature"-kind pack (none exist yet) calls
         G.mosDecks.register({code, label, pillar}) once, at the top of its
         own IIFE, guarded the same way 01-board-supplement-92a.js's
         predecessor did before the E/G reconciliation;
     2. either way, add "mos-decks-core" to its own manifest.json "requires"
        so the build guarantees this file has already loaded (build-time
        packs need this so ctx ordering is right; runtime packs need it so
        register() has somewhere to land);
     3. tag its own cards/scenarios with a `mos` array (and, if it shares a
        pillar with other content, a matching `pillar` string) - never
        hardcode a MOS check anywhere else in the app. G.mosDecks.available()
        is the ONLY place "which MOS decks exist" may be read from (Settings'
        checkbox list, the Readiness panel, and store.boardQuestions()/
        scenarios()'s activeCodes() lookup already do this and need no
        change for a new deck to appear in all three automatically).
   A MOS deck that skips this and gets special-cased elsewhere breaks the
   hidden-by-default/opt-in promise this module exists to keep in one place. */
(function () {
  "use strict";
  var G = window.G = window.G || {};

  // One in-memory registry for the whole session, seeded two ways:
  //  (a) a build-time ("emit":"build") content pack - 01-board-supplement-
  //      92a.js today - cannot call register() below at all: it runs once
  //      in content-pack-engine.mjs's Node sandbox, where window.G.mosDecks
  //      does not exist, so it bakes its {code,label,pillar} entry into the
  //      shipped seed as bank.mosDecks instead (ROADMAP 3g E x G
  //      reconciliation - see that pack's own comment). Read here, once, at
  //      load, from window.GUIDON_SEED.mosDecks.
  //  (b) a runtime ("feature") MOS pack, if one is ever written, calls
  //      register() directly, synchronously, while it loads - never at
  //      render time - same as before.
  // Either path lands in this same array, so available() never needs to
  // know which way a given deck arrived.
  var decks = [];
  (function seedFromBakedSeed() {
    var seed = window.GUIDON_SEED;
    var baked = seed && Array.isArray(seed.mosDecks) ? seed.mosDecks : [];
    baked.forEach(function (d) { register(d); });
  })();

  /* The ONE normalize helper both call sites that used to hand-roll this
     regex now share: src/index.html's store.boardQuestions() (previously an
     inline `.toUpperCase().replace(/[^A-Z0-9]/g, "")` right next to the
     myMos computation) and this module's own optedIn()/activeCodes() below.
     Uppercase, strip everything but letters and digits - "92a", "92-A" and
     "  92A " all normalize to "92A". */
  function normalize(raw) {
    return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  /* register({code, label, pillar}): called once per MOS content pack at
     load time (01-board-supplement-92a.js calls this for 92A). Idempotent
     on code - a second call with the same code (a hot-reload dev path, or a
     future pack that shares a code by mistake) updates nothing and is not
     an error, so a content pack can call this unconditionally without
     guarding "have I already registered" itself. */
  function register(deck) {
    if (!deck || !deck.code) return;
    var code = normalize(deck.code);
    if (!code) return;
    if (decks.some(function (d) { return d.code === code; })) return;
    decks.push({ code: code, label: String(deck.label || code), pillar: deck.pillar || null });
  }

  /* available(): the ONE source of truth for "which MOS decks exist" -
     every consumer (the Settings panel, the Readiness panel, a future
     "Study <MOS>" deep link) reads this instead of hardcoding "92A"
     anywhere outside the 92A pack itself. Sorted by label so the Settings
     checkbox list and the Readiness panel present decks in the same,
     stable order regardless of content-pack load order. Returns fresh
     plain objects (not the internal registry entries) so a caller can
     never mutate the registry by editing what this returns. */
  function available() {
    return decks
      .slice()
      .sort(function (a, b) { return a.label < b.label ? -1 : a.label > b.label ? 1 : 0; })
      .map(function (d) { return { code: d.code, label: d.label, pillar: d.pillar }; });
  }

  /* optedIn(): the Soldier's own explicit MOS opt-ins, as an array of
     normalized codes. Reads through G.store.settings() rather than caching
     locally, so it is always exactly what Settings' checkboxes last wrote -
     and guarded ([] when G.store does not exist yet) so tools/assemble-
     bank.mjs's headless, no-page sandbox (which evaluates this file but
     never loads src/index.html's store) gets a safe, empty answer instead
     of throwing. */
  function optedIn() {
    if (!window.G || !G.store || typeof G.store.settings !== "function") return [];
    var s;
    try { s = G.store.settings(); } catch (e) { return []; }
    return (s && Array.isArray(s.mosOptIn)) ? s.mosOptIn.slice() : [];
  }

  /* setOptedIn(code, on): flips one deck's opt-in and writes the whole
     array back through G.store.setSetting("mosOptIn", ...) - the same
     settings kv row DEFAULT_SETTINGS.mosOptIn seeds as [] (src/index.html).
     Sync-dispatch: G.store.setSetting() itself updates the in-memory
     settings object immediately and only debounces the on-disk write (see
     its own comment), so a caller that reads optedIn()/activeCodes() right
     after calling this sees the change with no await needed. No-op when
     G.store is not present (the headless sandbox never calls this - only a
     running page's Settings screen does). */
  function setOptedIn(code, on) {
    if (!window.G || !G.store || typeof G.store.setSetting !== "function") return;
    var norm = normalize(code);
    if (!norm) return;
    var cur = optedIn();
    var has = cur.indexOf(norm) !== -1;
    var next = cur;
    if (on && !has) next = cur.concat([norm]);
    else if (!on && has) next = cur.filter(function (c) { return c !== norm; });
    else return; // already in the requested state - do not touch settings or fire a change event for nothing
    G.store.setSetting("mosOptIn", next);
  }

  /* activeCodes(profile): the single source of truth BOTH
     store.boardQuestions() and renderReadiness() consume - the union of
     (a) every registered deck whose code the Soldier's own profile.mos
     prefix-matches (the pre-existing narrowing rule, unchanged), and
     (b) every deck the Soldier has explicitly opted into. A deck code
     appears at most once. Returns [] (nothing active) when there is no
     profile match and no opt-in - the corrected, hidden-by-default
     behavior: MOS-tagged content is no longer visible just because nobody
     has said anything about MOS at all. */
  function activeCodes(profile) {
    var codes = available().map(function (d) { return d.code; });
    var myMos = normalize(profile && profile.mos);
    var seen = {};
    var out = [];
    function add(c) { if (!seen[c]) { seen[c] = true; out.push(c); } }
    if (myMos) codes.forEach(function (c) { if (myMos.indexOf(c) === 0) add(c); });
    optedIn().forEach(function (c) { if (codes.indexOf(c) !== -1) add(c); });
    return out;
  }

  G.mosDecks = { register: register, available: available, normalize: normalize, optedIn: optedIn, setOptedIn: setOptedIn, activeCodes: activeCodes };
})();
