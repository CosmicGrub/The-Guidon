/* GUIDON - second MOS deck: 68W Health Care Specialist (Combat Medic).
   00-mos-decks-core.js's own header calls 92A "the REFERENCE PATTERN, not a
   one-off special case" for every future MOS deck - this is the first one
   built after that comment, roughly two months and 163 still-uncovered MOS
   codes later.

   Deliberately NOT the same mechanism 01-board-supplement-92a.js used
   (ctx.pack("board-supplement-core").mergeDeck): that engine exists to fold
   a user-SUPPLIED intake deck's near-duplicate questions into the existing
   bank and audit that every supplied card/QA pair was accounted for - real
   machinery for a real one-time reconciliation problem 92A had, not a
   requirement of the MOS-deck standing rule itself. This pack instead
   follows 07-cyber-fundamentals-content.js's simpler, equally-established
   shape: push finished board.questions records straight into the bank, with
   mos/curriculum already set on each record (no separate "integration" pass
   needed to tag them after the fact).

   OVERLAP CHECK (done before writing a single card): TCCC's three phases,
   MARCH, tourniquet application, the 9-line MEDEVAC request format, TRIAGE's
   four categories, CASEVAC vs MEDEVAC, the Role 1-4 echelon system and the
   Combat Lifesaver program overview already exist as GENERAL (non-MOS)
   board content - see board.questions ids bq-tccc-02/03, tccc-004/005/006/
   010, med-003/004/5/7, 9line, rpt-9, and doctrine entries doc-tccc /
   doc-armymed-3. Every card below goes DEEPER or SIDEWAYS from that existing
   coverage (the 68W's own scope of practice, MOS pipeline, casualty-
   collection/triage AUTHORITY, medical logistics, records systems, and the
   legal-protection doctrine none of that existing content touches) rather
   than restating it under a new id.

   Real citations only, per the standing content rule. Two records below
   carry `sourceStatus:"pending-source"` (with a `sourceNote` explaining
   what is uncertain) instead of a precisely-pinned citation, the same
   pattern documented on GUIDON_SEED.prt.drills[0]'s repRule - the
   underlying publication is real and named, but the exact current
   wording/terminology was not independently re-verified against the
   primary source text for this PR. That field is not part of the
   board.questions schema anywhere else in the app (only prt.drills uses
   it), so it is informational here - the real, human-readable caveat lives
   in the "source" string itself, which every card already renders. */
(function () {
  "use strict";
  G.contentPack.define("mos-deck-68w-content", function (bank, ctx) {
  if (!bank) return;

  bank.mosDecks = Array.isArray(bank.mosDecks) ? bank.mosDecks : [];
  if (!bank.mosDecks.some(function (d) { return d && d.code === "68W"; })) {
    // pillar: null (not "Maintenance & Supply" the way 92A's entry is) -
    // medical content is outside the six SGT-board pillars by design, the
    // same call every other TCCC/medical record in this app already makes;
    // see tools/pillar-map.mjs's header and its own comment on why this
    // deck's board categories are declared `null` there too. Nothing in the
    // running app currently reads a mosDecks[].pillar value (Settings and
    // the Readiness panel key off .code/.label only) - set correctly anyway
    // so a future consumer doesn't have to guess.
    bank.mosDecks.push({ code: "68W", label: "68W Combat Medic Specialist (Health Care Specialist)", pillar: null });
  }

  var CURRICULUM = ["68W Health Care Specialist"];
  var C = {
    FUND: "68W — MOS Fundamentals",
    SCOPE: "68W — Scope of Practice",
    EVAC: "68W — Casualty Collection & Evacuation",
    LOG: "68W — Medical Logistics",
    REC: "68W — Medical Records & Readiness",
    LEGAL: "68W — Legal Protections & Medical Ethics",
    AWARD: "68W — Recognition",
  };

  // { id, category, q, a, source, concept, difficulty, sourceStatus?, sourceNote? }
  var cards = [
    { id: "68w-fund-01", category: C.FUND, difficulty: "basic",
      q: "What is the primary role of a 68W Health Care Specialist?",
      a: "A 68W (commonly called a Combat Medic) provides emergency medical treatment, limited primary care, force health protection, and evacuation support across operational and clinical settings - administering point-of-injury emergency care to battle and non-battle casualties on the battlefield, and assisting with outpatient or inpatient care under the supervision of a physician, physician assistant, nurse, or health care NCO.",
      source: "DA PAM 611-21 (20 Dec 2022), MOS 68W", concept: "68W role" },
    { id: "68w-fund-02", category: C.FUND, difficulty: "basic",
      q: "What is the 68W initial training pipeline?",
      a: "After Basic Combat Training, a 68W candidate attends a 16-week Advanced Individual Training (AIT) at the U.S. Army Medical Center of Excellence (Fort Sam Houston, TX), combining a civilian EMT-Basic curriculum with Army-specific trauma and field-medicine tasks - roughly 26 weeks of training in total before reporting to a unit.",
      source: "DA PAM 611-21, MOS 68W; U.S. Army Medical Center of Excellence (MEDCoE/AMEDD) 68W course structure", concept: "68W AIT pipeline" },
    { id: "68w-fund-03", category: C.FUND, difficulty: "intermediate",
      q: "What civilian certification must a 68W earn and maintain, and under what regulation?",
      a: "National Registry of Emergency Medical Technicians (NREMT) certification at the EMT-Basic level. The Army is currently the only U.S. service that requires its medics to earn and maintain this civilian EMT accreditation to stay MOS-qualified (MOSQ); a Soldier who does not pass may reattempt up to six times during training. AR 40-68 (Clinical Quality Management) governs the requirement.",
      source: "AR 40-68, Clinical Quality Management", concept: "NREMT requirement" },
    { id: "68w-fund-04", category: C.FUND, difficulty: "intermediate",
      q: "What does TC 8-800 (MEDIC) govern, and how does it connect to a 68W's civilian certification?",
      a: "TC 8-800, Medical Education and Demonstration of Individual Competence (MEDIC), gives commanders a structured program - Tables I through VIII - for unit-level combat medic sustainment training and skills validation. Completing Tables I-VII counts toward the continuing-education hours a 68W needs for NREMT recertification.",
      source: "TC 8-800 (Aug 2024)", concept: "TC 8-800 MEDIC sustainment training" },
    { id: "68w-fund-05", category: C.FUND, difficulty: "intermediate",
      q: "How does a 68W's scope of duties expand from skill level 1 to skill level 3?",
      a: "68W10 (PVT-SPC) administers emergency treatment to battlefield casualties and assists with outpatient or inpatient care under supervision. 68W20 (Sergeant) administers both emergency and routine treatment and supervises field and clinical treatment facilities. 68W30 (SSG/SFC) supervises the activities of field, clinical, and mobile treatment facilities.",
      source: "DA PAM 611-21, MOS 68W skill-level duty descriptions - pending-source: paraphrased from secondary summaries of DA PAM 611-21; the exact current paragraph/edition was not independently re-verified against the primary document for this PR",
      concept: "68W skill-level progression", sourceStatus: "pending-source",
      sourceNote: "The publication (DA PAM 611-21, MOS 68W) is real and correctly cited; the specific 68W10/68W20/68W30 duty-description wording above was reconstructed from secondary summaries of that pamphlet, not read directly from the primary PDF, so it is flagged rather than presented as a verbatim/confirmed paragraph." },

    { id: "68w-scope-01", category: C.SCOPE, difficulty: "basic",
      q: "What are the four TCCC provider tiers, from least to most advanced?",
      a: "Tier 1 - All Service Member (ASM): the hemorrhage-control basics every Soldier learns. Tier 2 - Combat Lifesaver (CLS): a non-medical Soldier given additional command-directed training. Tier 3 - Combat Medic/Corpsman: the MOS-qualified medic (68W in the Army), trained and certified as a full TCCC provider. Tier 4 - Combat Paramedic/Provider: the most advanced DoD pre-hospital trauma care, for credentialed paramedics, physician assistants, and physicians.",
      source: "Committee on TCCC (CoTCCC) / Joint Trauma System TCCC Guidelines; ATP 4-02.11", concept: "TCCC provider tiers" },
    { id: "68w-scope-02", category: C.SCOPE, difficulty: "intermediate",
      q: "How does a Combat Medic's (68W) scope of practice differ from a Combat Lifesaver's?",
      a: "A Combat Lifesaver (TCCC Tier 2) is a non-medical MOS Soldier who receives additional command-directed training in select lifesaving interventions - hemorrhage control and basic airway adjuncts - to bridge the gap between self/buddy aid and medic response. A 68W Combat Medic (Tier 3) is a credentialed, NREMT-certified TCCC provider, trained and authorized under Army training standards and medical standing orders for the full range of point-of-injury trauma assessment and treatment - not limited to the CLS task list.",
      source: "ATP 4-02.11; TC 4-02.1 / ATP 4-02.84 (Combat Lifesaver Program)", concept: "68W vs. CLS scope of practice" },
    { id: "68w-scope-03", category: C.SCOPE, difficulty: "basic",
      q: "Who clinically supervises a 68W's outpatient and inpatient care duties?",
      a: "A physician, physician assistant, nurse, or health care NCO, per the skill-level duty descriptions in DA PAM 611-21 - a 68W does not provide unsupervised outpatient or inpatient care independent of that clinical chain.",
      source: "DA PAM 611-21, MOS 68W", concept: "68W clinical supervision" },
    { id: "68w-scope-04", category: C.SCOPE, difficulty: "intermediate",
      q: "What must a 68W complete during the Tactical Evacuation Care phase, beyond continued treatment?",
      a: "Documentation and handoff: completing the DD Form 1380 (TCCC Card), which doubles as the MIST report, and coordinating with the evacuation platform crew so the next role of care receives an accurate record of mechanism of injury, injuries found, signs/symptoms, and treatment already given.",
      source: "ATP 4-02.11", concept: "TACEVAC documentation/handoff" },

    { id: "68w-evac-01", category: C.EVAC, difficulty: "intermediate",
      q: "What is a Casualty Collection Point (CCP)?",
      a: "A predesignated location, normally along the axis of advance or an evacuation route and forward of the battalion aid station, where combat medics, combat lifesavers, and other Soldiers bring casualties to be gathered, receive further lifesaving care, and be positioned for evacuation to higher care. A CCP may be medically or non-medically staffed, based on the risk and personnel available.",
      source: "ATP 4-02.2 (Jul 2019), Medical Evacuation", concept: "Casualty Collection Point" },
    { id: "68w-evac-02", category: C.EVAC, difficulty: "intermediate",
      q: "In a mass-casualty (MASCAL) situation, who applies triage priorities, and what is the goal?",
      a: "The senior medical provider present - often the senior 68W on scene - rapidly sorts multiple casualties into the Immediate/Delayed/Minimal/Expectant categories before treating any one of them in depth, directing the limited available treatment and evacuation resources to save the most lives and limbs possible. \"Expectant\" is used only when resources genuinely cannot treat everyone.",
      source: "TCCC / STP 21-1-SMCT", concept: "MASCAL triage authority" },
    { id: "68w-evac-03", category: C.EVAC, difficulty: "basic",
      q: "What is the \"Golden Hour,\" and what set it as an evacuation goal?",
      a: "The principle that a critically wounded casualty's survival odds rise sharply if they reach surgical trauma care within about 60 minutes of being wounded. On 15 June 2009, Secretary of Defense Robert Gates directed a 60-minute MEDEVAC transport standard for Afghanistan, halving the prior two-hour goal - median transport time fell from roughly 90 minutes to roughly 43 minutes afterward.",
      source: "SECDEF Robert Gates directive, 15 Jun 2009 (\"golden hour\" MEDEVAC transport standard)", concept: "Golden Hour policy" },

    { id: "68w-medlog-01", category: C.LOG, difficulty: "intermediate",
      q: "What is Class VIII supply, and what two sub-classes does Army medical logistics divide it into?",
      a: "Class VIII is medical materiel. Army medical logistics (MEDLOG) splits it into Class VIIIA - pharmaceuticals, medical/surgical/dental/lab/radiology supplies, medical equipment, and repair parts - and Class VIIIB - blood and blood components, which require separate, temperature-controlled cold-chain storage and handling.",
      source: "ATP 4-02.1 (Oct 2015), Army Medical Logistics", concept: "Class VIIIA/VIIIB" },
    { id: "68w-medlog-02", category: C.LOG, difficulty: "intermediate",
      q: "What is an AMAL, and how does it relate to a unit's medical resupply?",
      a: "An Authorized Medical Allowance List - the approved list of medical equipment and consumable supplies a unit or treatment facility is authorized to hold. A unit's medical sets, and a 68W's own aid bag, are built and resupplied against the applicable AMAL for their mission.",
      source: "AR 40-61, Medical Logistics Policies; ATP 4-02.1 - pending-source: current AMAL terminology/usage was not independently re-verified against the primary text for this PR",
      concept: "AMAL", sourceStatus: "pending-source",
      sourceNote: "AMAL is well documented across DoD medical-logistics sources; the specific claim that a 68W's own aid bag is resupplied \"against the applicable AMAL\" was not confirmed against the primary ATP 4-02.1/AR 40-61 text for this PR, so it is flagged." },
    { id: "68w-medlog-03", category: C.LOG, difficulty: "intermediate",
      q: "Why is Class VIII resupply handled through a separate MEDLOG channel instead of the general supply system?",
      a: "Medical materiel carries requirements general logistics is not built for: shelf-life and cold-chain management, controlled-substance accountability, and clinical-quality oversight. Army doctrine treats medical logistics as its own distinct function within the Army Health System, running its own request and distribution channel from the medical platoon/section up through supporting medical logistics units.",
      source: "ATP 4-02.1 (Oct 2015); AR 40-61", concept: "Why MEDLOG is separate from general supply" },

    { id: "68w-rec-01", category: C.REC, difficulty: "basic",
      q: "What is MHS GENESIS, and what legacy system did it replace?",
      a: "MHS GENESIS is the Military Health System's current electronic health record, used DoD-wide for inpatient, outpatient, and dental records. It replaced the legacy AHLTA (Armed Forces Health Longitudinal Technology Application) and CHCS (Composite Health Care System).",
      source: "Defense Health Agency, MHS GENESIS Fact Sheet (health.mil)", concept: "MHS GENESIS replaces AHLTA" },
    { id: "68w-rec-02", category: C.REC, difficulty: "basic",
      q: "What paper form has long been used to document a Soldier's outpatient sick-call visits?",
      a: "SF 600, Chronological Record of Medical Care - a standard federal medical-record form still referenced alongside electronic systems like MHS GENESIS.",
      source: "Standard Form 600, Chronological Record of Medical Care", concept: "SF 600" },
    { id: "68w-rec-03", category: C.REC, difficulty: "intermediate",
      q: "What is a Periodic Health Assessment (PHA), and why does it matter for deployability?",
      a: "An annual, DoD-required medical/readiness screening that documents a Service member's health status. A Soldier overdue for their PHA is coded Partially Medically Ready under the Individual Medical Readiness program, which can affect deployability. 68Ws at the troop/unit level often help conduct or process PHA components (vitals, screening questions) under supervision.",
      source: "DoDI 6025.19, Individual Medical Readiness Program", concept: "Periodic Health Assessment" },

    { id: "68w-legal-01", category: C.LEGAL, difficulty: "basic",
      q: "What protected status do dedicated military medical personnel hold under the law of war?",
      a: "Noncombatant, protected status. Geneva Convention I (1949), Article 24 protects personnel exclusively engaged in the search for, collection, transport, or treatment of the wounded and sick, or in the administration of medical units, in all circumstances.",
      source: "Geneva Convention I (1949), Art. 24; DoD Law of War Manual (updated Jul 2023)", concept: "Protected medical-personnel status" },
    { id: "68w-legal-02", category: C.LEGAL, difficulty: "intermediate",
      q: "Can a 68W carry a weapon without losing protected medical status?",
      a: "Yes - medical personnel may be armed with light arms for their own defense and the defense of the wounded and sick in their care without forfeiting protected status. Carrying heavier weapons (crew-served weapons and the like) can put that protected status at risk.",
      source: "DoD Law of War Manual (updated Jul 2023); Geneva Convention I (1949)", concept: "Medical personnel self-defense arming" },
    { id: "68w-legal-03", category: C.LEGAL, difficulty: "basic",
      q: "What is the distinctive emblem, and who decides whether it is displayed?",
      a: "The Red Cross (or Red Crescent / Red Crystal) - the protective emblem marking medical personnel, units, and equipment under the Geneva Conventions. Its display is controlled by the competent military authority, who may authorize removing or obscuring it for tactical reasons such as camouflage.",
      source: "DoD Law of War Manual (updated Jul 2023); Geneva Convention I (1949)", concept: "The distinctive emblem" },
    { id: "68w-legal-04", category: C.LEGAL, difficulty: "intermediate",
      q: "Under Geneva Convention I, must a 68W treat wounded enemy combatants the same as friendly wounded?",
      a: "Yes - Article 12 requires the wounded and sick to be treated humanely and cared for without any adverse distinction based on nationality, race, religion, political opinion, or similar criteria. Treatment priority is set by medical need and triage category, not by which side a casualty fought for.",
      source: "Geneva Convention I (1949), Art. 12", concept: "Impartial treatment of the wounded" },
    { id: "68w-legal-05", category: C.LEGAL, difficulty: "basic",
      q: "What identification must permanent military medical personnel carry under Geneva Convention I?",
      a: "A special identity card bearing the distinctive emblem - issued in U.S. practice as the Geneva Conventions Identification Card - required under Article 40 so medical (and religious) personnel can prove their protected status and be eligible for repatriation if captured.",
      source: "Geneva Convention I (1949), Art. 40", concept: "Geneva Conventions identity card" },

    { id: "68w-award-01", category: C.AWARD, difficulty: "intermediate",
      q: "What does a Soldier need to earn the Combat Medical Badge (CMB)?",
      a: "Hold a qualifying MOS (the 11-series, 18-series, or 68-series); be assigned or attached to a qualifying infantry, ranger, or Special Forces unit of brigade size or smaller, or to a medical unit organic or attached to one of those units; and perform medical duties while personally engaged by the enemy in active ground combat.",
      source: "AR 600-8-22 (19 Jan 2024), para 8-7", concept: "Combat Medical Badge criteria" },
  ];

  bank.board = bank.board || { questions: [] };
  bank.board.questions = Array.isArray(bank.board.questions) ? bank.board.questions : [];
  var qIds = new Set(bank.board.questions.map(function (q) { return q.id; }));
  // "verbatim" keeps the cards whose citation is a real, checked reference
  // reading exactly as they have always read (this pack never set
  // verbatim:false). A card marked sourceStatus:"pending-source" is the
  // opposite case - its own citation text says the wording is paraphrased or
  // not re-verified - so it is cited "paraphrase" and its card back says
  // "Study-guide answer", never "By the Book". A pending source must never
  // claim to be a quotation (tools/lint-citation-schema.mjs fails it).
  cards.forEach(function (c) {
    if (qIds.has(c.id)) return;
    var rec = {
      id: c.id, category: c.category, q: c.q, a: c.a, boardAnswer: c.a,
      source: ctx.cite(c.source, c.sourceStatus === "pending-source" ? "paraphrase" : "verbatim"),
      concept: c.concept, keyPoints: [c.a], difficulty: c.difficulty,
      mos: ["68W"], curriculum: CURRICULUM,
    };
    if (c.sourceStatus) rec.sourceStatus = c.sourceStatus;
    if (c.sourceNote) rec.sourceNote = c.sourceNote;
    bank.board.questions.push(rec);
    qIds.add(c.id);
  });

  // Dictionary terms. Safe-merge, same rule 07-cyber-fundamentals-content.js
  // and 06-opsec-cyber-curriculum-content.js already established: ADD a
  // sense to an existing entry, never replace one outright - several of
  // these abbreviations already carry an unrelated meaning in the seed
  // (CLS = "contractor logistic support", MEDLOG's own entry is USAF-
  // flavored, TFC = "threat finance cell"); this pack adds the Army-medical
  // sense alongside them rather than overwriting.
  var terms = [
    ["NREMT", "National Registry of Emergency Medical Technicians - the civilian EMT credentialing body. Army 68Ws must earn and maintain NREMT-Basic certification (AR 40-68) to remain MOS-qualified."],
    ["IFAK", "Individual First Aid Kit - the personal aid pouch every Soldier carries for self-aid/buddy aid, resupplied by unit medical personnel."],
    ["AMAL", "Authorized Medical Allowance List - the approved list of medical equipment and consumable supplies a unit or treatment facility is authorized to hold."],
    ["CMB", "Combat Medical Badge - awarded to qualifying medical personnel who personally performed medical duties while engaged by the enemy in active ground combat (AR 600-8-22)."],
    ["MHS GENESIS", "The Military Health System's current DoD-wide electronic health record, replacing the legacy AHLTA and CHCS systems."],
    ["AHLTA", "Armed Forces Health Longitudinal Technology Application - the legacy DoD electronic health record MHS GENESIS is replacing."],
    ["TACEVAC", "Tactical Evacuation Care - the third phase of TCCC, covering casualty care during MEDEVAC/CASEVAC transport."],
    ["CUF", "Care Under Fire - the first phase of TCCC, treating a casualty while still under effective hostile fire."],
    ["TFC", "Tactical Field Care - the second phase of TCCC, once no longer under effective fire."],
    ["CLS", "Combat Lifesaver - a non-medical Soldier given command-directed training in select lifesaving interventions beyond self-aid/buddy aid."],
    ["MEDLOG", "Army Medical Logistics - one of the Army's ten medical functions (ATP 4-02.1), managing Class VIII (medical materiel and blood) from unit to theater level."],
  ];
  bank.acronyms = bank.acronyms || { terms: [] };
  bank.acronyms.terms = Array.isArray(bank.acronyms.terms) ? bank.acronyms.terms : [];
  var termMap = new Map(bank.acronyms.terms.map(function (t) { return [String(t.a || "").toUpperCase(), t]; }));
  function mergeDefinition(had, incoming) {
    had = String(had || "");
    var head = incoming.split(" - ")[0].toLowerCase();
    if (!had) return incoming;
    var senses = had.split(";").map(function (s) { return s.trim().toLowerCase(); });
    if (had.toLowerCase().indexOf(incoming.toLowerCase()) !== -1) return had;
    if (senses.length === 1 && senses[0] === head) return incoming;
    if (senses.indexOf(head) !== -1) return had + " (" + incoming + ")";
    return had + "; " + incoming;
  }
  terms.forEach(function (x) {
    var key = x[0].toUpperCase(), existing = termMap.get(key);
    if (existing) { existing.d = mergeDefinition(existing.d, x[1]); }
    else { var t = { a: x[0], d: x[1], src: "army" }; bank.acronyms.terms.push(t); termMap.set(key, t); }
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

  return { cardIds: cards.map(function (c) { return c.id; }), termKeys: terms.map(function (x) { return x[0]; }) };
  });
})();
