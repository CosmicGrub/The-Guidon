/* GUIDON — DA Form 2166-9-2 (NCOER), real rater/senior-rater content pack.

   Forms Trainer's "da4856ncoer" entry (src/index.html's embedded
   GUIDON_SEED.forms.forms - its id predates this pack and is kept for
   backward compatibility with anything already saved under it, such as a
   Soldier's own "forms:saved" draft) already carries the real form number
   (DA Form 2166-9-2, AR 623-3) but only a thin stub: an Administrative
   section, then a "Rater Evaluation" section with just three of the six
   Leadership Requirements Model bullet fields (Leads/Develops/Achieves) and
   NO Part V (Senior Rater) section at all - so the form never taught the
   half of the NCOER that decides most of what a promotion board actually
   reads. It also had one real accuracy bug this pack fixes: its "Rater
   Overall Performance" select carried the SENIOR RATER's four-tier
   POTENTIAL scale (Most/Highly Qualified/Qualified/Not Qualified) instead
   of the RATER's own four-tier PERFORMANCE scale - confirmed by this app's
   own already-shipped board card bq32 ("the rater assesses PERFORMANCE
   (Far Exceeded/Exceeded/Met/Did Not Meet Standard); the senior rater
   assesses POTENTIAL (Most/Highly/Qualified/Not Qualified) under a managed
   profile").

   This pack finds that entry by id and, rather than hand-editing the
   embedded seed literal directly (house rule), extends it programmatically
   at build time the same way every other content pack extends the seed:
     - fixes the mislabeled rater scale
     - adds the three missing Part IV attribute bullets (Character,
       Presence, Intellect) plus the rater's mandatory overall comments
     - adds the Part V — Senior Rater section entirely (potential box +
       mandatory senior-rater comments) - this is the biggest real gap,
       since board study material (and doc-prom-4 in this same seed)
       consistently flags the senior rater's box + narrative as the single
       highest-weight signal a selection board reads
     - adds a "Check" self-quiz tab (checks[]), matching da4856's own
       pattern, so the tab bar actually gains the "Check" tab
       (drawBody() in src/index.html only adds it when f.checks.length)

   Sourcing discipline (house rule: real citations only, no fabricated
   precision): every claim below that names a specific Part/block letter is
   one this session directly confirmed against the current AR 623-3 (14 Feb
   2025) PDF text - para 1-1 (the three 2166-9 forms), para 2-12h (Part IV,
   blocks a and b = APFT/height-weight), and para 2-12j/k (Part IV, block c
   = Character, including SHARP-finding documentation). The specific block
   letters for Presence/Intellect/Leads/Develops/Achieves (Part IV) and for
   the Senior Rater's own blocks (Part V) live in DA Pam 623-3's procedural
   detail, which this session could not reach (the official armypubs.army.mil
   DA 2166-9-2 PDF is a dynamic XFA form with no extractable text, and every
   current DA Pam 623-3 mirror this session tried 404'd or served an
   unrelated 2014 pre-rater-reform edition) - so field "guide" text below
   is deliberately worded as "Part IV"/"Part V" without inventing a specific
   block letter for those five fields, the same "don't fabricate a precise
   citation you're not confident of" discipline GUIDON_SEED.prt.drills[0]
   already established for its rep-count rule.

   Reuses G.writing.gradeBullet (Write -> Bullet Builder's own deterministic
   bullet grader) for live feedback on every bullet field this form adds -
   see src/index.html's DYNAMICS.da4856ncoer, next to DYNAMICS.da638 - rather
   than building a second, parallel bullet grader. That live-grading UI is
   application logic, not seed content, so it lives in src/index.html's own
   forms.js, not here; this pack only supplies the field data it reads.

   Standing rule (content-pipeline): every new sourced/researched content
   addition also ships matching board-drill flashcards. The three cards
   below are the facts this pack itself newly confirmed (Part IV block c,
   Part IV blocks a/b, and AR 623-3's current edition date) - not a re-ask
   of ground this seed's own bq32/bq33/ncoer-1/ncoer-3/ar6233-1/ar6233-4
   already cover (checked against the assembled bank before writing these;
   see the PR description for the exact diff). */
(function () {
  "use strict";
  G.contentPack.define("da2166-ncoer-content", function (bank, ctx) {
  if (!bank || !bank.forms || !Array.isArray(bank.forms.forms)) return null;
  var f = bank.forms.forms.filter(function (x) { return x && x.id === "da4856ncoer"; })[0];
  if (!f || !Array.isArray(f.sections)) return null; // defensive: never crash the build if the seed's own shape ever moves

  // ---- Part IV: fix the mislabeled rater scale, add the three missing attributes ----
  var raterSection = f.sections.filter(function (s) { return s && s.name === "Rater Evaluation"; })[0];
  if (raterSection && Array.isArray(raterSection.fields)) {
    raterSection.name = "Part IV — Rater: Attributes & Overall Performance";
    var overallField = raterSection.fields.filter(function (fl) { return fl.id === "overall"; })[0];
    if (overallField) {
      overallField.label = "Rater Overall Performance (Part IV)";
      overallField.options = ["Far Exceeded Standard", "Exceeded Standard", "Met Standard", "Did Not Meet Standard"];
      overallField.guide = "The RATER's own box uses this four-tier PERFORMANCE scale - not the Senior Rater's Most/Highly Qualified/Qualified/Not Qualified POTENTIAL scale in Part V below. Mixing the two up is a common, avoidable board-study error.";
    }
    var insertAt = overallField ? raterSection.fields.indexOf(overallField) : 0;
    raterSection.fields.splice(insertAt, 0,
      { id: "character", label: "CHARACTER bullet (Part IV, block c)", type: "bullets", maxLines: 3, maxChars: 110,
        example: ["Reported a supply discrepancy against own accountability rather than concealing it — models Army values under pressure"],
        guide: "Confirmed block: AR 623-3 (14 Feb 2025), para 2-12 names Part IV, block c as where the rater documents Character, including any substantiated SHARP finding. Character, Presence, Intellect, Leads, Develops and Achieves are the six Leadership Requirements Model areas every NCOER rates (ADP 6-22)." },
      { id: "presence", label: "PRESENCE bullet", type: "bullets", maxLines: 3, maxChars: 110,
        example: ["Composed and decisive directing casualty evacuation during a live-fire safety incident; restored range control in under two minutes"] },
      { id: "intellect", label: "INTELLECT bullet", type: "bullets", maxLines: 3, maxChars: 110,
        example: ["Identified a recurring maintenance-request bottleneck and proposed a fix GCSS-Army adopted battalion-wide"] }
    );
    raterSection.fields.push({
      id: "raterComments", label: "Rater overall comments (mandatory)", type: "bullets", maxLines: 4, maxChars: 110,
      example: ["Top 10% of SSGs rated this period; promote ahead of peers to SFC"],
      guide: "Every NCOER requires rater comments comparing the rated NCO to peers of the same grade - generic praise (“outstanding NCO”) does not compete with specific, quantified bullets."
    });
  }

  // ---- Part V: the section this stub never had at all ----
  var hasPartV = f.sections.some(function (s) { return s && /Senior Rater/i.test(s.name || ""); });
  if (!hasPartV) {
    f.sections.push({
      name: "Part V — Senior Rater Assessment",
      fields: [
        { id: "potential", label: "Senior Rater Potential", type: "select",
          options: ["Most Qualified", "Highly Qualified", "Qualified", "Not Qualified"],
          guide: "The SENIOR RATER's own box - a four-tier POTENTIAL scale, separate from the rater's Performance scale in Part IV above. Senior raters manage a limited profile of “Most Qualified” blocks across everyone they senior-rate, so the box alone doesn't tell the whole story - the narrative below carries real weight, especially for the top two blocks." },
        { id: "srComments", label: "Senior Rater comments (mandatory)", type: "bullets", maxLines: 4, maxChars: 110,
          example: ["Best of 12 SSGs senior-rated this period; ready now for platoon sergeant duties"],
          guide: "May draw on the rated NCO's final DA Form 2166-9-1A support form. Selection boards weigh this narrative heavily, particularly alongside a “Most Qualified” or “Highly Qualified” box." }
      ]
    });
  }

  // ---- self-quiz tab (only shown when f.checks.length, per drawBody()) ----
  f.checks = (f.checks || []).concat([
    { q: "On the NCOER, does the RATER evaluate performance or potential?", a: "Performance — the rater box-checks Far Exceeded/Exceeded/Met/Did Not Meet Standard. The SENIOR RATER separately assesses potential (Most Qualified/Highly Qualified/Qualified/Not Qualified)." },
    { q: "Where does the rater document a substantiated finding about the rated NCO's Character, including a SHARP-related finding?", a: "Part IV, block c (Character) of the DA Form 2166-9 series." },
    { q: "For DA Form 2166-9-2 (SSG-1SG/MSG), are Part IV comments written in bullet format or narrative format?", a: "Bullet format — DA Form 2166-9-1 and -2 both require bullets; only the -3 (CSM/SGM) uses narrative comments." },
    { q: "What support form does the rater review and initial at the start of the rating period, then use to prepare the NCOER at the end?", a: "DA Form 2166-9-1A, the NCO Evaluation Report Support Form." }
  ]);

  f.useCases = (f.useCases || []).concat([
    { rarity: "routine", title: "Senior rater profile management", situation: "The senior rater manages a limited number of “Most Qualified” blocks across everyone they senior-rate, to curb rating inflation.", action: "Not every strong NCO gets the top block — the senior rater's narrative comments carry real weight alongside (and sometimes instead of) the box check.", ref: "AR 623-3" }
  ]);

  // ---- matching board-drill flashcards (content-pipeline standing rule) ----
  var CATEGORY = "AR 623-3 — Evaluations";
  var cards = [
    ["da2166-block-c", "On the DA Form 2166-9 series NCOER, where does the rater document a substantiated finding — including a SHARP-related finding — about the rated NCO's Character?", "Part IV, block c.", "AR 623-3 (14 Feb 2025), para 2-12", "NCOER — Character block location"],
    ["da2166-blocks-ab", "Where on the NCOER does the rater enter the rated NCO's APFT/ACFT results and height/weight (AR 600-9) compliance?", "Part IV, blocks a and b.", "AR 623-3 (14 Feb 2025), para 2-12", "NCOER — fitness/height-weight block location"],
    ["da2166-current-edition", "What is the current edition date of AR 623-3, the regulation governing the NCOER?", "14 February 2025.", "AR 623-3", "AR 623-3 — current edition"]
  ];
  bank.board = bank.board || { questions: [] };
  bank.board.questions = Array.isArray(bank.board.questions) ? bank.board.questions : [];
  var qIds = {};
  bank.board.questions.forEach(function (q) { qIds[q.id] = true; });
  cards.forEach(function (x) {
    if (qIds[x[0]]) return;
    // "verbatim" keeps these cards' backs exactly as they have always read
    // (this pack never set verbatim:false).
    bank.board.questions.push({
      id: x[0], category: CATEGORY, q: x[1], a: x[2], boardAnswer: x[2], source: ctx.cite(x[3], "verbatim"),
      concept: x[4], keyPoints: [x[2]], difficulty: "intermediate", pillar: "Leadership & Counseling"
    });
    qIds[x[0]] = true;
  });

  function restampBoardHash() {
    var qs = bank.board && bank.board.questions;
    if (!Array.isArray(qs)) return;
    var h1 = 0x811c9dc5 >>> 0, h2 = 0x9e3779b9 >>> 0;
    function feed(s) { s = String(s == null ? "" : s); for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0; h2 ^= (c + i) & 0xffff; h2 = Math.imul(h2, 0x85ebca6b) >>> 0; } h1 ^= 31; h1 = Math.imul(h1, 0x01000193) >>> 0; h2 ^= 127; h2 = Math.imul(h2, 0xc2b2ae35) >>> 0; }
    qs.forEach(function (q) { feed(q.id); feed(q.category); feed(q.q); feed(q.boardAnswer || q.a); });
    function hex(n) { return ("00000000" + (n >>> 0).toString(16)).slice(-8); }
    bank.board.contentHash = hex(h1) + hex(h2);
  }
  restampBoardHash();

  return { formId: "da4856ncoer", cardIds: cards.map(function (x) { return x[0]; }) };
  });
})();
