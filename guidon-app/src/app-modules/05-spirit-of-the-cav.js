/* GUIDON - Spirit of the CAV study-content integration.
   Adds the user-supplied cavalry song/tradition to the same canonical study
   surfaces already used by Board Drill/Quiz/Rapid Fire and Recitation Drill.

   Design:
   - one full-text recitable board record with lines[] for #/recite;
   - line-by-line recall cards plus fill-in-the-blank prompts via the existing
     board supplement merge path, so all normal board-study consumers see them;
   - one Creeds & Branch Identities reading/reference record cross-linked to the
     recitable board record;
   - provenance is explicit: the supplied text is treated as unit-tradition
     content, not as numbered Army doctrine.
*/
(function () {
  "use strict";

  var G = window.G = window.G || {};
  var seed = window.GUIDON_SEED;
  if (!seed || !seed.board || !Array.isArray(seed.board.questions)) return;
  if (typeof G.boardSupplementMergeDeck !== "function") return;

  var lines = [
    "We are the CAV, we are the First Team",
    "Our sabers shining in the sun.",
    "We are the CAV, we are the First Team",
    "Our fathers rode in '21.",
    "We have a heritage that will never die",
    "'Cause we ride the charge with sabers high.",
    "We are the CAV, we are the First Team,",
    "We're Gary Owen, sound the charge!"
  ];

  var fullText = lines.join("\n");
  var boardId = "creed-spirit-of-the-cav";
  var exists = seed.board.questions.some(function (q) { return q.id === boardId; });

  if (!exists) {
    seed.board.questions.push({
      id: boardId,
      category: "Creeds",
      q: "Recite the Spirit of the CAV.",
      a: fullText,
      boardAnswer: fullText,
      acceptableAnswer: fullText,
      source: "User-supplied unit tradition text — Spirit of the CAV",
      concept: "Spirit of the CAV",
      keyPoints: [
        "First Team identifies the 1st Cavalry Division.",
        "Gary Owen/Garryowen is historically associated with U.S. Cavalry tradition.",
        "Memorize the text in sequence and preserve the exact line order."
      ],
      difficulty: "intermediate",
      pillar: "Drill & Board Etiquette",
      lines: lines,
      tags: ["spirit-of-the-cav", "cavalry", "first-team", "gary-owen", "garryowen", "unit-tradition"]
    });
  }

  G.boardSupplementMergeDeck({
    id: "spirit-cav",
    cards: [
      {n:1,title:"Spirit of the CAV — Line 1",category:"Creeds",source:"User-supplied unit tradition text — Spirit of the CAV",qa:[
        ["What is the opening line of the Spirit of the CAV?","We are the CAV, we are the First Team"],
        ["In the opening line, what identity follows 'We are the CAV'?","We are the First Team."]
      ]},
      {n:2,title:"Spirit of the CAV — Line 2",category:"Creeds",source:"User-supplied unit tradition text — Spirit of the CAV",qa:[
        ["What line follows 'We are the CAV, we are the First Team'?","Our sabers shining in the sun."],
        ["Fill in the blank: 'Our ______ shining in the sun.'","sabers"]
      ]},
      {n:3,title:"Spirit of the CAV — Line 3",category:"Creeds",source:"User-supplied unit tradition text — Spirit of the CAV",qa:[
        ["After 'Our sabers shining in the sun,' what line comes next?","We are the CAV, we are the First Team"],
        ["Fill in the blank: 'We are the CAV, we are the ______ ______.'","First Team"]
      ]},
      {n:4,title:"Spirit of the CAV — Line 4",category:"Creeds",source:"User-supplied unit tradition text — Spirit of the CAV",qa:[
        ["What line follows the second 'We are the CAV, we are the First Team'?","Our fathers rode in '21."],
        ["Fill in the blank: 'Our fathers rode in ______.'","'21"]
      ]},
      {n:5,title:"Spirit of the CAV — Line 5",category:"Creeds",source:"User-supplied unit tradition text — Spirit of the CAV",qa:[
        ["What line comes after 'Our fathers rode in '21'?","We have a heritage that will never die"],
        ["Fill in the blank: 'We have a ______ that will never die.'","heritage"]
      ]},
      {n:6,title:"Spirit of the CAV — Line 6",category:"Creeds",source:"User-supplied unit tradition text — Spirit of the CAV",qa:[
        ["What line follows 'We have a heritage that will never die'?","'Cause we ride the charge with sabers high."],
        ["Fill in the blank: 'Cause we ride the ______ with sabers high.","charge"]
      ]},
      {n:7,title:"Spirit of the CAV — Line 7",category:"Creeds",source:"User-supplied unit tradition text — Spirit of the CAV",qa:[
        ["What line follows 'Cause we ride the charge with sabers high?","We are the CAV, we are the First Team,"],
        ["Fill in the blank: 'We are the CAV, we are the ______ ______.'","First Team"]
      ]},
      {n:8,title:"Spirit of the CAV — Final Line",category:"Creeds",source:"User-supplied unit tradition text — Spirit of the CAV",qa:[
        ["What is the final line of the Spirit of the CAV?","We're Gary Owen, sound the charge!"],
        ["Fill in the blanks: We're ______ ______, sound the ______!","Gary Owen; charge"]
      ]},
      {n:9,title:"Spirit of the CAV — Meaning",category:"Creeds",source:"1st Cavalry Division / U.S. Cavalry historical tradition; user-supplied text",qa:[
        ["What does 'First Team' refer to in the Spirit of the CAV?","The 1st Cavalry Division, widely known as the First Team."],
        ["What does 'Gary Owen' refer to in cavalry tradition?","It refers to Garryowen/Gary Owen, a traditional cavalry tune and name strongly associated with U.S. Cavalry heritage, including the 7th Cavalry and later cavalry tradition."]
      ]}
    ]
  });

  seed.creeds = Array.isArray(seed.creeds) ? seed.creeds : [];
  if (!seed.creeds.some(function (c) { return c.id === "creed-spirit-of-the-cav"; })) {
    seed.creeds.push({
      id: "creed-spirit-of-the-cav",
      kind: "creed",
      group: "Maneuver & Combat Arms",
      branch: "Cavalry",
      scope: "unit-tradition",
      officialTitle: "Spirit of the CAV",
      fullText: fullText,
      history: "A cavalry heritage piece centered on the 1st Cavalry Division's 'First Team' identity and the Garryowen/Gary Owen cavalry tradition. In GUIDON it is presented as unit-tradition study content rather than numbered Army doctrine.",
      coreTenets: [
        "Cavalry identity and esprit de corps",
        "Connection to the First Team",
        "Continuity of cavalry heritage across generations",
        "Charge, sabers, and Garryowen/Gary Owen imagery"
      ],
      source: {
        ref: "User-supplied Spirit of the CAV text; historical context from established U.S. Cavalry / 1st Cavalry Division tradition",
        para: "",
        asOf: "2026-09-17",
        status: "unit-tradition"
      },
      tier: "all",
      tags: ["spirit-of-the-cav", "cavalry", "first-team", "gary-owen", "garryowen", "song", "unit-tradition"],
      linkedBoardId: boardId
    });
  }

  G.spiritOfTheCav = {
    boardId: boardId,
    lines: lines.slice(),
    cloze: {
      easy: "We are the CAV, we are the ______ Team\nOur sabers shining in the sun.\nWe are the CAV, we are the First Team\nOur fathers rode in '21.\nWe have a ______ that will never die\n'Cause we ride the charge with sabers high.\nWe are the CAV, we are the First Team,\nWe're Gary Owen, sound the ______!",
      medium: "We are the ______, we are the ______ ______\nOur ______ shining in the ______.\nWe are the ______, we are the ______ ______\nOur ______ rode in ______.\nWe have a ______ that will never ______\n'Cause we ______ the ______ with ______ high.\nWe are the ______, we are the ______ ______,\nWe're ______ ______, sound the ______!",
      hard: lines.map(function (line) {
        return line.replace(/\b([A-Za-z])[A-Za-z']*\b/g, "$1");
      }).join("\n")
    }
  };
})();
