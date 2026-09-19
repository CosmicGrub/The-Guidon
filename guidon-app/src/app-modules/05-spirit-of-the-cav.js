/* GUIDON - 1st Cavalry Division heritage (facts only; no song text).

   WHY this file carries no song text any more: it used to bundle the whole
   text of the division song, line by line, as board cards and as a
   recitable record. That song has a named author and no recorded
   public-domain or permission basis, and the project rule is that GUIDON
   never ships copyrighted text or song lyrics. So the text is gone - from
   the recitable record, the line-by-line cards, the fill-in-the-blank
   strings and the Creeds entry - and nothing here may quote or paraphrase it
   line by line again (tools/test-spirit-of-the-cav.mjs fails the build's
   output if any of it comes back).

   What stays is FACT, which nobody owns, each with a real source a Soldier
   can check:
   - a title-only entry in Creeds & Branch Identities (same shape as the
     branch-motto entries: history + source, no full text);
   - four heritage cards filed under the existing "Army History" category.
     They are NOT in "Creeds" - that deck is the Army-wide recall deck every
     Soldier quizzes, and one division's heritage does not belong in it.

   A Soldier who wants to drill their own unit's song, creed or motto does it
   through Recitation Drill's "My unit" section (recite-user-texts.js): they
   paste the text themselves, it is stored only on their device, and it is
   never part of the app.

   IDs: pb-spirit-cav-09-1 / -09-2 are kept from the original release so a
   Soldier's review history on those two facts carries over.
*/
(function () {
  "use strict";

  var seed = window.GUIDON_SEED;
  if (!seed || !seed.board || !Array.isArray(seed.board.questions)) return;

  // Sources were opened and read on CHECKED. They are official 1st Cavalry
  // Division / U.S. Army pages, not a regulation - so no paragraph numbers
  // are cited, because there are none to cite.
  var CHECKED = "2026-09-18";
  var SRC_DIVISION = "U.S. Army 1st Cavalry Division official page (army.mil/1stcav), History";
  var SRC_SONG = "1st Cavalry Division official social media post, 24 March 2025; DVIDS, \"1st Cavalry Division Command Sergeant Major Relinquishes Responsibility,\" 28 February 2023";
  var SRC_GARRYOWEN = "U.S. Army (army.mil), \"Echo Garryowen,\" 7 June 2013; 1st Cavalry Division Public Affairs";

  var CATEGORY = "Army History";
  // tools/pillar-map.mjs files "Army History" under this pillar; a card whose
  // category is mapped must carry exactly that pillar (lint-board-taxonomy f2).
  var PILLAR = "Drill & Board Etiquette";

  function card(id, q, a, source, keyPoints) {
    return {
      id: id,
      category: CATEGORY,
      q: q,
      a: a,
      boardAnswer: a,
      acceptableAnswer: a,
      source: source,
      concept: "1st Cavalry Division heritage",
      keyPoints: keyPoints,
      difficulty: "basic",
      pillar: PILLAR,
      // Read by nothing yet - the same kind of tag the 92A lane carries
      // (mos/curriculum), so a future unit filter has something to key on.
      unit: "1st Cavalry Division",
      tags: ["1st-cavalry-division", "unit-heritage"]
    };
  }

  var cards = [
    card("pb-spirit-cav-09-1",
      "Which Army division is known as the \"First Team\"?",
      "The 1st Cavalry Division. Its official history says the name took root in World War II under Major General William C. Chase.",
      SRC_DIVISION,
      ["\"First Team\" is the nickname of the 1st Cavalry Division.",
       "The division's official history ties the name to World War II and Major General William C. Chase.",
       "The same history records the division as the first into Tokyo at the start of the occupation of Japan."]),
    card("pb-spirit-cav-09-2",
      "What is \"Garryowen\" in U.S. Cavalry tradition?",
      "A traditional Irish tune that the 7th Cavalry Regiment took as its own. The regiment is nicknamed \"Garryowen,\" and 7th Cavalry units have served in the 1st Cavalry Division.",
      SRC_GARRYOWEN,
      ["Garryowen is a traditional Irish tune (a quickstep), not an Army composition.",
       "It is the regimental namesake of the 7th Cavalry Regiment.",
       "7th Cavalry units have served in the 1st Cavalry Division, which is why Troopers there use the name."]),
    card("pb-spirit-cav-10-1",
      "When and where was the 1st Cavalry Division activated?",
      "13 September 1921 at Fort Bliss, Texas.",
      SRC_DIVISION,
      ["Activated 13 September 1921.",
       "It began at Fort Bliss, Texas, as a horse-mounted division patrolling the Mexican border."]),
    card("pb-spirit-cav-11-1",
      "What is \"Spirit of the Cav\"?",
      "The official song of the 1st Cavalry Division, sung by its Troopers at division ceremonies.",
      SRC_SONG,
      ["It is the 1st Cavalry Division's official song.",
       "Troopers sing it at division ceremonies, such as changes of command and responsibility.",
       "GUIDON does not include the words. A Soldier can add their own copy under Recitation Drill, My unit, and it stays on their device."])
  ];

  var have = {};
  seed.board.questions.forEach(function (q) { have[q.id] = true; });
  cards.forEach(function (c) { if (!have[c.id]) seed.board.questions.push(c); });

  seed.creeds = Array.isArray(seed.creeds) ? seed.creeds : [];
  if (!seed.creeds.some(function (c) { return c.id === "creed-spirit-of-the-cav"; })) {
    seed.creeds.push({
      id: "creed-spirit-of-the-cav",
      kind: "song",
      group: "Maneuver & Combat Arms",
      branch: "Cavalry",
      scope: "unit",
      officialTitle: "Spirit of the Cav (1st Cavalry Division song)",
      // Title and history only, on purpose - see this file's header.
      fullText: "",
      history: "\"Spirit of the Cav\" is the official song of the 1st Cavalry Division, the \"First Team,\" and its Troopers sing it at division ceremonies. The division was activated on 13 September 1921 at Fort Bliss, Texas. The words are not included in GUIDON because they are not GUIDON's to share. If this is your unit, you can add your own copy under Recitation Drill, My unit - it stays on your device.",
      coreTenets: [],
      source: {
        ref: SRC_SONG + "; " + SRC_DIVISION,
        para: "",
        asOf: CHECKED,
        status: "unit-tradition"
      },
      tier: "all",
      tags: ["spirit-of-the-cav", "1st-cavalry-division", "first-team", "garryowen", "song", "unit-tradition"],
      // No recitable record exists for it any more, so there is nothing for
      // the Creeds page to link to in Board Drill or Recitation Drill.
      linkedBoardId: null
    });
  }
})();
