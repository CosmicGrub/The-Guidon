/* GUIDON — Master Leader Course (MLC) / senior-NCO content pack.
   Fills a real content gap: the board bank was tier-tagged E1 through E6
   only (zero E7/E8 cards) and BLC/ALC/SLC each have a dedicated prep module,
   but MLC — a real, current NCOPDS course and a pin-on/eligibility gate the
   app's own doctrine already references (GUIDON_SEED.doctrine "ncopds-ladder",
   the GATES table in channels.js) — had no matching content at all.

   Scope, deliberately: operational-level leadership (ADP 6-22 Chapters 9-10,
   Organizational and Strategic Leadership), mission command / command and
   control at echelon (ADP 6-0, FM 6-0), senior-NCO rater responsibilities on
   the NCOER (AR 623-3), unit readiness reporting at battalion/brigade
   (AR 220-1), and talent management — the material a Soldier preparing for
   MLC or the MSG board actually needs, not a rehash of the E4-E6 MDMP/
   levels-of-leadership cards the seed already carries (bq26, ll-3, ll-7,
   ll-8, lol-1, pmeed-5 etc. — this pack's cards are written to NOT
   duplicate those questions; see each card's angle).

   Sourcing note: every card below cites a real, currently-in-force
   publication. Two areas of MLC's own program of instruction (the exact
   post-redesign academic-hour count and the capstone's precise scope) are
   drawn from public TRADOC/NCOLCoE reporting rather than a numbered POI
   document this pack's author could directly open — those two cards carry
   sourceStatus:"pending-source" and say so, the same honest-uncertainty
   pattern GUIDON_SEED.prt.drills[0]'s repRule already uses, rather than
   asserting a precise figure with false confidence. Every doctrinal
   paragraph number cited (ADP 6-22 Ch 9/10, ADP 6-0 paras 1-37/1-49, AR
   350-1 para 3-38a/b, DA PAM 600-25 para 2-12e(4)) was confirmed either
   directly against the publication's own table of contents or against an
   already-shipped, already-reviewed GUIDON board card citing the identical
   paragraph (ll-3/ll-7/ll-8, pmeed-5, adp-4, mission-cmd) — never invented.

   Standing content-pipeline rule: this pack ships the matching board-drill
   flashcards for the #/mlc route module's own prose (src/index.html,
   G.mlc) — the route explains what MLC is and how to prepare for it in
   plain language; this pack is where that same material becomes gradable,
   spaced-repetition board cards, plus a genuinely MLC-scope scenario set. */
(function () {
  "use strict";
  G.contentPack.define("mlc-senior-leader-content", function (bank, ctx) {
  if (!bank) return;

  var CAT_MLC = "Master Leader Course (MLC)";
  var CAT_MC = "Mission Command at Echelon";
  var TIER_78 = ["E7", "E8"];
  var TIER_789 = ["E7", "E8", "E9"];
  var CURRICULUM = ["Master Leader Course"];

  // [id, category, q, a, source, concept, tier, extra?]
  // extra (optional 8th element): { sourceStatus, note } for the two cards
  // relying on secondary reporting rather than a primary numbered document.
  var cards = [
    // ---- MLC course facts ---------------------------------------------
    ["mlc-course-01", CAT_MLC,
      "What course is a formal prerequisite to enroll in the Master Leader Course (MLC)?",
      "The Senior Leader Course (SLC). AR 350-1, para 3-38a (1 June 2025): 'The SLC is a prerequisite to MLC.'",
      "AR 350-1, para 3-38a (1 Jun 2025)", "MLC — SLC prerequisite", TIER_78],
    ["mlc-course-02", CAT_MLC,
      "Is the Master Leader Course branch-specific or branch-immaterial, and what does that mean for who attends together?",
      "Branch-immaterial — like BLC, and unlike the branch/MOS-specific ALC and SLC. MLC classes are mixed-MOS: Sergeants First Class and Master Sergeants from across the Army train together on the same operational/staff-level material rather than a branch-specific program.",
      "AR 350-1, para 3-38a (1 Jun 2025)", "MLC — branch-immaterial", TIER_78],
    ["mlc-course-03", CAT_MLC,
      "According to AR 350-1, what subject area does MLC cover that was not part of the NCOPDS courses below it?",
      "Understanding and applying the Military Decision-Making Process (MDMP). AR 350-1 para 3-38a lists it among MLC's areas of study alongside public speaking, other services' capabilities, mission command, decisive action, organizational management, and inter-agency/multinational considerations — MDMP was newly introduced to MLC's program of instruction as part of the course's redesign.",
      "AR 350-1, para 3-38a (1 Jun 2025)", "MLC — MDMP newly added", TIER_78],
    ["mlc-course-04", CAT_MLC,
      "Per DA PAM 600-25, what specific skill areas is the Master Leader Course designed to challenge and educate selected Sergeants First Class in?",
      "DA PAM 600-25, para 2-12e(4) (11 Sep 2023): professional writing, communication skills, public speaking, critical thinking, organizational and command leadership, management skills, joint and operational level of war fighting, discipline, readiness, health, and administrative requirements.",
      "DA PAM 600-25, para 2-12e(4) (11 Sep 2023)", "MLC — DA PAM 600-25 skill areas", TIER_78],
    ["mlc-course-05", CAT_MLC,
      "Per AR 350-1, what is MLC's stated target training population?",
      "Grades E-7 and E-8 — Sergeants First Class preparing for Master Sergeant, and Master Sergeants who have not yet completed the course. AR 350-1 para 3-38b: 'Target training population is E-8 and E-7.'",
      "AR 350-1, para 3-38b (1 Jun 2025)", "MLC — target population", TIER_78],
    ["mlc-course-06", CAT_MLC,
      "How has the length of the Master Leader Course changed under the Army's ongoing NCOPDS redesign, and how confident should you be in an exact current hour count?",
      "MLC has been extended from 15 training days (112 academic hours) to 21 training days (144 academic hours). Public TRADOC/NCO Leadership Center of Excellence reporting describes Active Component initial operational capability beginning 14 July 2026, with Army Reserve/National Guard full operational capability in October 2026 — so the exact hour count your own class runs on depends on when and where you attend. Confirm the current figure with your NCO Academy's course announcement rather than treating any single number as fixed.",
      "TRADOC / NCO Leadership Center of Excellence course-length update (2025-26); public reporting, not a numbered POI this pack cites directly", "MLC — course length change",
      TIER_78, { sourceStatus: "pending-source", note: "The 15->21 day / 112->144 hour figures and the IOC/FOC dates are drawn from public Army and National Guard reporting on the redesigned course, not from a numbered training circular or program of instruction this pack's author directly opened — treat the exact hour count as accurate in direction (a real, substantial lengthening) but confirm the precise current figure against your own NCO Academy's course announcement." }],
    ["mlc-course-07", CAT_MLC,
      "What does MLC's warfighting capstone exercise ask students to do, and how much class time is set aside for it?",
      "Public reporting on the redesigned course describes a roughly three-day, about-24-academic-hour warfighting capstone in which students apply the early steps of MDMP — receipt of mission, mission analysis, and course of action development — in a scenario built around first-sergeant-level responsibilities, integrating leadership, discipline, and readiness management with operational planning.",
      "TRADOC / NCO Leadership Center of Excellence course-redesign reporting (2025-26); public reporting, not a numbered POI this pack cites directly", "MLC — capstone exercise",
      TIER_78, { sourceStatus: "pending-source", note: "The capstone's exact day/hour count and precise MDMP-step scope come from public reporting on the redesigned course, not a numbered POI document — the shape of the claim (a multi-day warfighting capstone applying early MDMP steps) is well corroborated, but confirm the exact figures with your NCO Academy before repeating them as settled fact." }],
    ["mlc-course-08", CAT_MLC,
      "How does MLC completion connect to promotion and course-eligibility gates above it, and why is this an actively-changing area rather than a settled fact?",
      "GUIDON's own doctrine content (the NCOPDS ladder entry) states MLC is becoming a requirement for MSG as the Army's ongoing NCO PME redesign fields it, and that Sergeants Major Course-Active (SGM-A) completion is a pin-on requirement for SGM — with MLC itself functioning as at least an eligibility step toward SGM-level schooling. Because the Army's PME transformation is in execution, treat any single 'MLC is required for X, eligibility for Y' statement as a snapshot, not a permanent rule, and confirm your own gate with S-1 and your career counselor.",
      "AR 350-1 / DA PAM 600-25 (NCOPDS ladder); confidence: in_transition, matching GUIDON_SEED's own doctrine entry for this same fact",
      "MLC — promotion/eligibility linkage, actively changing", TIER_789],
    ["mlc-course-09", CAT_MLC,
      "What is the general shape of a senior NCO's professional military education after SLC, in course order?",
      "Master Leader Course (MLC), then the Sergeants Major Course (SMC) — resident or by distance learning. MLC sits between SLC and SMC in the NCO Professional Development System ladder: BLC (team/squad) -> ALC (squad/platoon) -> SLC (platoon/company) -> MLC (operational/staff-level, branch-immaterial) -> SMC (strategic).",
      "AR 350-1; DA PAM 600-25 (NCOPDS ladder)", "MLC — position in the NCOPDS ladder", TIER_78],

    // ---- ADP 6-22 Organizational Leadership (Chapter 9) ----------------
    ["mlc-org-01", CAT_MLC,
      "ADP 6-22 organizes both organizational and strategic leadership around the same three core-competency categories as direct leadership. What are they, and where does Chapter 9 (Organizational Leadership) address each?",
      "Leads, Develops, and Achieves — the same three competency categories from the Army Leadership Requirements Model, scaled up. Chapter 9 addresses them at organizational scope under Leading (para 9-1), Developing (para 9-3), and Achieving (para 9-6).",
      "ADP 6-22, Ch 9 (paras 9-1, 9-3, 9-6)", "Organizational leadership — chapter structure", TIER_78],
    ["mlc-org-02", CAT_MLC,
      "What specific two-way communication responsibility does ADP 6-22 assign to an organizational-level leader that a direct leader typically does not carry?",
      "Communicating intent two echelons down and understanding intent two echelons up — a responsibility ADP 6-22 assigns specifically at the organizational level (para 1-128), because an organizational leader no longer gives daily face-to-face guidance to every subordinate the way a direct leader does.",
      "ADP 6-22, para 1-128", "Organizational leadership — intent two echelons up/down", TIER_78],
    ["mlc-org-03", CAT_MLC,
      "How does an organizational leader typically verify that subordinate units actually understand the commander's intent, given that they are not present for every action?",
      "Through personal observation and visits — ADP 6-22 para 1-129 describes organizational leaders regularly and personally interacting with subordinates and using observation and visits to assess how well subordinates understand and are executing intent, rather than relying only on reports.",
      "ADP 6-22, para 1-129", "Organizational leadership — verifying understanding of intent", TIER_78],
    ["mlc-org-04", CAT_MLC,
      "At the organizational level, what does 'Develops' (Chapter 9, para 9-3) shift toward compared to a direct leader developing individual Soldiers?",
      "Developing the organization's bench strength and leader pipeline at scale — deliberately building subordinate leaders (not just subordinate Soldiers) who can themselves lead through others, since an organizational leader's own effectiveness depends on the quality of the leaders one echelon down running the organizations underneath them.",
      "ADP 6-22, Ch 9, para 9-3 (Developing)", "Organizational leadership — Develops at scale", TIER_78],
    ["mlc-org-05", CAT_MLC,
      "Does rank by itself determine whether a senior NCO is operating at the direct, organizational, or strategic leadership level, per ADP 6-22?",
      "No. ADP 6-22 para 1-123 is explicit: 'Rank does not generally determine the difference between organizational and strategic leaders, positions do.' A battalion command sergeant major and the Sergeant Major of the Army hold comparable rank but operate at very different leadership levels because of the position, not the grade.",
      "ADP 6-22, para 1-123", "Leadership levels — position, not rank, is the determinant", TIER_78],

    // ---- ADP 6-22 Strategic Leadership (Chapter 10) --------------------
    ["mlc-strat-01", CAT_MLC,
      "ADP 6-22 Chapter 10 covers Strategic Leadership using the same Leading/Developing/Achieving frame as Chapter 9. At what paragraphs does each begin?",
      "Leading at para 10-2, Developing at para 10-5, and Achieving at para 10-7.",
      "ADP 6-22, Ch 10 (paras 10-2, 10-5, 10-7)", "Strategic leadership — chapter structure", TIER_78],
    ["mlc-strat-02", CAT_MLC,
      "Why do strategic leaders, per ADP 6-22, often not see the results of their own decisions during their own tenure?",
      "Because they take a long-term approach to planning, preparing, executing, and assessing (para 1-132) — decisions like Army modernization or major policy/culture shifts play out over years, well past a single senior leader's assignment. That makes sound judgment in selecting and developing subordinates who will carry the work forward especially important.",
      "ADP 6-22, para 1-132", "Strategic leadership — long time horizon", TIER_789],
    ["mlc-strat-03", CAT_MLC,
      "A senior NCO at the organizational level (brigade/battalion CSM, MSG staff NCO) does not personally 'sit' at the strategic level, but ADP 6-22 still expects strategic-level judgment from them in what way?",
      "By preparing the force and its people for future missions and change — an organizational leader executes and interprets strategic-level direction (Army modernization, new equipment, new doctrine) for the formation, translating it into something subordinate units can actually train to and execute, which is itself part of what ADP 6-22's Achieving competency at the organizational level requires.",
      "ADP 6-22, Ch 9 (Achieving, para 9-6); Ch 10 (para 1-130)", "Organizational leaders as the bridge to strategic direction", TIER_78],
    ["mlc-strat-04", CAT_MLC,
      "Per ADP 6-22, roughly how large a population can a strategic leader's decisions influence, and what perspective do they apply that direct and organizational leaders typically do not?",
      "Several thousand to hundreds of thousands of people. Strategic leaders apply a global, regional, national, and societal perspective, and weigh factors — congressional hearings, Army-wide budget constraints, systems acquisition, inter-service and international cooperation — that do not arise at the direct or organizational level.",
      "ADP 6-22, paras 1-130 to 1-131", "Strategic leadership — scale and perspective", TIER_789],

    // ---- ADP 6-0, Command and Control (senior-NCO angle) ---------------
    ["mlc-c2-01", CAT_MC,
      "ADP 6-0, Command and Control (7 July 2026 edition), is organized into four chapters. What are they?",
      "Chapter 1, Fundamentals of Command and Control; Chapter 2, Command; Chapter 3, Control; and Chapter 4, The Command and Control Warfighting Function.",
      "ADP 6-0, Command and Control (7 Jul 2026)", "ADP 6-0 — chapter structure", TIER_78],
    ["mlc-c2-02", CAT_MC,
      "What did the 7 July 2026 edition of ADP 6-0 change about how the publication frames 'mission command,' compared to the 31 July 2019 edition it supersedes?",
      "The publication itself was retitled from 'Mission Command: Command and Control of Army Forces' to simply 'Command and Control.' Mission command was not dropped — it is now framed as the Army's approach for exercising command and control (the 'how'), with command and control as the overarching subject the whole publication covers.",
      "ADP 6-0, Preface (7 Jul 2026, supersedes 31 Jul 2019)", "ADP 6-0 — 2026 retitling", TIER_78],
    ["mlc-c2-03", CAT_MC,
      "What real, structural change did the 2026 revision of ADP 6-0 make to how command posts are described, and why does that matter to a senior NCO helping run one?",
      "The 2026 revision no longer treats the command post as a single static center — it describes forces dispersing across multiple command-and-control nodes for survivability. For a senior NCO with command-post or staff-section responsibilities, that means planning for redundancy and mobility across several physical locations rather than one fixed operations center.",
      "ADP 6-0, Command and Control (7 Jul 2026), Ch 4", "ADP 6-0 — dispersed C2 nodes", TIER_78],
    ["mlc-c2-04", CAT_MC,
      "Name the seven principles that enable mission command, and identify which two are explicitly about people trusting and understanding each other rather than about orders or intent.",
      "Competence; mutual trust; shared understanding; commander's intent; mission orders; disciplined initiative; and risk acceptance (ADP 6-0, para 1-49). Mutual trust and shared understanding are the two built directly on relationships between people, rather than on the content of an order or intent statement.",
      "ADP 6-0, para 1-49", "Mission command principles — the relational two", TIER_78],
    ["mlc-c2-05", CAT_MC,
      "What is a senior NCO's practical role in building the 'mutual trust' and 'shared understanding' that ADP 6-0 lists among the seven principles of mission command?",
      "Serving as the trusted, experienced voice across the formation who personally checks — through observation and direct interaction with subordinate leaders, not just reports — that intent is actually understood the way it was meant, and who gives a commander an honest, candid read on the formation's real state. That role is exactly what ADP 6-22 describes an organizational leader doing (paras 1-128 to 1-129) in support of mission command.",
      "ADP 6-0, para 1-49; ADP 6-22, paras 1-128 to 1-129", "Senior NCO's role in mission command principles", TIER_78],
    ["mlc-c2-06", CAT_MC,
      "The Command and Control Warfighting Function (ADP 6-0, Chapter 4) is built on a C2 system of people, processes, networks, and nodes. What is a senior staff NCO's typical contribution to that system, distinct from a commander's or a staff officer's?",
      "Running the section that actually operates the C2 system day to day — enforcing standards on the information flowing through it, training and supervising the Soldiers who run the equipment and battle-tracking, and giving the commander and staff a continuously accurate, disciplined picture rather than a stale one. ADP 6-0 frames the C2 system as people, processes, networks/data, and C2 nodes working together; senior NCOs are frequently the ones who make the 'people and processes' half of that actually function under pressure.",
      "ADP 6-0, Command and Control (7 Jul 2026), Ch 4", "C2 system — senior NCO's contribution", TIER_78],

    // ---- FM 6-0 / ADP 5-0: MDMP at the senior-NCO/staff level ----------
    ["mlc-mdmp-01", CAT_MC,
      "The Military Decision-Making Process is detailed in FM 6-0. As a senior NCO now expected to understand and apply MDMP (per AR 350-1's MLC course description), what running product are you most likely to be asked to build or maintain to support Mission Analysis?",
      "A running estimate for your own functional area (personnel, logistics/sustainment, training/readiness, or similar) — a continuously updated staff product that tracks the current status, facts, assumptions, and risks in that area so the commander and planning staff can draw on it during Mission Analysis and course-of-action development, rather than starting from zero each time.",
      "FM 6-0; ADP 5-0", "MDMP — the senior NCO's running estimate", TIER_78],
    ["mlc-mdmp-02", CAT_MC,
      "What are the Operations Process's four activities per ADP 5-0, and how does a senior NCO's contribution differ across them compared to a direct-level NCO's?",
      "Plan, Prepare, Execute, and Assess. A direct-level NCO is mostly consumer/executor of the plan produced by this process; a senior NCO at battalion/brigade is more often a contributor DURING Plan (through staff estimates and MDMP participation) and a key set of eyes during Assess — feeding real, on-the-ground readiness and training data back into the process rather than only receiving orders from it.",
      "ADP 5-0", "Operations Process — senior NCO's role across all four activities", TIER_78],
    ["mlc-mdmp-03", CAT_MC,
      "During MDMP's Mission Analysis step, a senior NCO's running estimate surfaces a real resourcing risk, but the unit's planning timeline does not allow it to be fully war-gamed before the commander must approve a course of action. What is the doctrinally sound move?",
      "Report the risk to the staff and commander clearly and in time to inform the decision, rather than either burying it to avoid slowing the timeline or unilaterally trying to resolve it outside the planning process. MDMP is built to accept incomplete information under time pressure — the senior NCO's job is to make sure the commander's decision is made with the risk known, not to guarantee the risk gets solved before a decision is reached.",
      "FM 6-0; ADP 5-0", "MDMP — reporting risk under time pressure", TIER_78],

    // ---- AR 623-3: the senior NCO as RATER on the NCOER ---------------
    ["mlc-ncoer-01", CAT_MLC,
      "Under AR 623-3, what is the minimum number of calendar days a rater must supervise a rated NCO before qualifying to rate that Soldier?",
      "90 calendar days.",
      "AR 623-3", "NCOER — rater minimum qualifying period", TIER_78],
    ["mlc-ncoer-02", CAT_MLC,
      "Under AR 623-3, what is the minimum qualifying period for a senior rater, and who is the senior rater in the rating chain?",
      "60 calendar days. The senior rater is the immediate supervisor of the rater — one step further up the rating chain from the person who directly supervises the rated NCO day to day.",
      "AR 623-3", "NCOER — senior rater minimum qualifying period and position", TIER_78],
    ["mlc-ncoer-03", CAT_MLC,
      "As a newly-promoted senior NCO now serving as a RATER for the first time (rather than only as a rated Soldier), what does AR 623-3 hold you responsible for that a first-time rated Soldier does not have to think about?",
      "Directing and honestly assessing the rated NCO's actual performance and potential, and doing so consistently across everyone you rate — 'rater tendency' (a pattern of inflated or deflated ratings from one rater) is a documented problem AR 623-3's system is built to make visible over time, so an inflated first NCOER sets an inaccurate baseline the rated NCO and the Army both have to live with.",
      "AR 623-3", "NCOER — first-time rater responsibility and rater tendency", TIER_78],
    ["mlc-ncoer-04", CAT_MLC,
      "What obligation does AR 623-3 place on senior raters specifically regarding the TIMELINESS of a completed NCOER, not just its content?",
      "Senior raters (or their designated representative) are required to ensure the completed report reaches Human Resources Command no later than 90 calendar days after the report's THRU date, whether submitted electronically or as a hard-copy original — timeliness is a senior rater responsibility distinct from, and in addition to, assessing the NCO's performance and potential.",
      "AR 623-3", "NCOER — senior rater timeliness responsibility", TIER_78],
    ["mlc-ncoer-05", CAT_MLC,
      "Beyond writing the report itself, what compliance responsibility does AR 623-3 assign to senior raters (or their representative) across the whole evaluation reporting system?",
      "Ensuring compliance with the standards for preparing and forwarding evaluation reports that AR 623-3 (and DA PAM 623-3) prescribe — senior raters are a checkpoint for the SYSTEM's integrity (accurate, complete, on-time reports moving correctly through the chain), not only the evaluator of the one Soldier in front of them.",
      "AR 623-3", "NCOER — senior rater's system-compliance responsibility", TIER_78],

    // ---- AR 220-1: readiness reporting at battalion/brigade ------------
    ["mlc-readiness-01", CAT_MLC,
      "What does AR 220-1 call the readiness report a unit commander submits, and what term does the regulation use to emphasize whose responsibility it is?",
      "The Commander's Unit Status Report (CUSR). AR 220-1 deliberately uses 'commander's' in the name to emphasize that the unit commander is solely responsible for the accuracy of the information and data entered into the report.",
      "AR 220-1", "Readiness reporting — Commander's Unit Status Report (CUSR)", TIER_78],
    ["mlc-readiness-02", CAT_MLC,
      "AR 220-1 requires a unit's readiness report to give an honest picture. What specific failure does the regulation warn against on both ends of the spectrum?",
      "Reports that either mask (hide/understate) or exaggerate (overstate) readiness deficiencies. AR 220-1 requires timely, accurate, and complete reporting — an overly rosy report is exactly as much of a violation of the regulation's intent as an overly pessimistic one, because either distorts the picture higher headquarters uses to allocate resources and assess risk.",
      "AR 220-1", "Readiness reporting — neither masking nor exaggerating", TIER_78],
    ["mlc-readiness-03", CAT_MLC,
      "As the senior NCO for a company, battalion, or brigade-level formation, what is your practical role in the readiness-reporting process AR 220-1 governs, even though the commander is the one who is 'solely responsible' for the report?",
      "Providing the commander with the accurate, ground-truth personnel, training, and equipment status data the report is built from — the commander owns final accountability for the CUSR, but a senior NCO who inflates or sits on bad news up the informal chain is undermining the same honest-reporting standard AR 220-1 exists to protect, just one step removed from the actual signature block.",
      "AR 220-1", "Readiness reporting — senior NCO's data-integrity role", TIER_78],

    // ---- Talent management -----------------------------------------
    ["mlc-talent-01", CAT_MLC,
      "What is the Army's official talent management strategy document called, and what four qualities does its subtitle commit the Army to building an enlisted and officer force around?",
      "The 'U.S. Army Talent Management Strategy, Force 2025 and Beyond: Ready, Professional, Diverse, and Integrated.'",
      "U.S. Army Talent Management Strategy, Force 2025 and Beyond (2016)", "Talent management — strategy document and its aims", TIER_78],
    ["mlc-talent-02", CAT_MLC,
      "In plain terms, what problem is 'talent management' trying to solve that a purely seniority- or vacancy-based assignment system does not?",
      "Matching a person's actual knowledge, skills, behaviors, and preferences to the specific position that will most develop them and most benefit the organization — rather than simply filling the next open slot with the next available body in order of seniority, regardless of fit.",
      "U.S. Army Talent Management Strategy, Force 2025 and Beyond (2016)", "Talent management — core concept", TIER_78],
    ["mlc-talent-03", CAT_MLC,
      "As a senior NCO with input into where subordinate NCOs are assigned or developed next, what tension does talent management doctrine ask you to manage between the needs of the losing organization and the needs of the NCO's own career?",
      "Talent management explicitly frames development as a shared investment: the gaining organization benefits from a well-matched NCO, the NCO benefits from developmental growth, and the Army benefits long-term from a deeper bench of leaders who have been placed in positions that actually built their capability — a senior NCO who blocks a subordinate's best developmental move purely to keep a strong performer in place is optimizing for the short-term needs of one organization at the expense of the talent-management system's broader intent.",
      "U.S. Army Talent Management Strategy, Force 2025 and Beyond (2016)", "Talent management — the losing-organization tension", TIER_78],
    ["mlc-talent-04", CAT_MLC,
      "What Army system lets Soldiers and gaining units express preference and compete for open assignments, rather than assignments being made purely by needs-of-the-Army algorithm?",
      "The Enlisted Marketplace / Assignment Interactive Module (AIM), the enlisted talent-marketplace system built into IPPS-A — a practical application of talent-management doctrine that lets a Soldier's own preferences and a gaining unit's stated requirements both factor into an assignment, rather than a Soldier being slotted with no visibility into where they are going or why.",
      "U.S. Army Talent Management Strategy, Force 2025 and Beyond (2016); IPPS-A / Assignment Interactive Module program materials", "Talent management — the Enlisted Marketplace", TIER_78],

    // ---- Operational level / levels of war (ADP 3-0) -------------------
    ["mlc-oplevel-01", CAT_MC,
      "ADP 3-0 describes three levels of warfare. Name them, and identify which one DA PAM 600-25 explicitly ties to MLC's curriculum.",
      "Tactical, operational, and strategic. DA PAM 600-25 para 2-12e(4) describes MLC as covering the 'joint and operational level of war fighting' — explicitly placing MLC's scope above the purely tactical level junior and mid-grade NCOs work at day to day.",
      "ADP 3-0; DA PAM 600-25, para 2-12e(4)", "Levels of war — MLC's operational-level scope", TIER_78],
    ["mlc-oplevel-02", CAT_MC,
      "What does 'JIIM' stand for, and why would a senior NCO operating at the operational level need to understand it, per AR 350-1's description of MLC?",
      "Joint, Interagency, Intergovernmental, and Multinational. AR 350-1 lists 'other services capabilities' and 'inter-agency capabilities and multinational considerations' among MLC's areas of study — at battalion/brigade and above, a senior NCO increasingly coordinates with joint, interagency, and multinational partners rather than working inside a single-Service, single-unit bubble.",
      "AR 350-1, para 3-38a (1 Jun 2025)", "JIIM — why MLC covers it", TIER_78]
  ];

  bank.board = bank.board || { questions: [] };
  bank.board.questions = Array.isArray(bank.board.questions) ? bank.board.questions : [];
  var qIds = new Set(bank.board.questions.map(function (q) { return q.id; }));
  cards.forEach(function (x) {
    var id = x[0], category = x[1], q = x[2], a = x[3], source = x[4], concept = x[5], tier = x[6], extra = x[7] || {};
    if (qIds.has(id)) return;
    // "verbatim" keeps the cards whose citation is a real, checked reference
    // reading exactly as they have always read (this pack never set
    // verbatim:false). A card marked sourceStatus:"pending-source" (the two
    // built on secondary public reporting) is the opposite case, so it is
    // cited "paraphrase" and its card back says "Study-guide answer", never
    // "By the Book". A pending source must never claim to be a quotation
    // (tools/lint-citation-schema.mjs fails it).
    var rec = {
      id: id, category: category, q: q, a: a, boardAnswer: a,
      source: ctx.cite(source, extra.sourceStatus === "pending-source" ? "paraphrase" : "verbatim"),
      concept: concept, keyPoints: [a], difficulty: "expert", tier: tier,
      curriculum: CURRICULUM
    };
    if (extra.sourceStatus) rec.sourceStatus = extra.sourceStatus;
    if (extra.note) rec.note = extra.note;
    bank.board.questions.push(rec);
    qIds.add(id);
  });

  // ---- Dictionary terms (new only; MLC/NCOER/MDMP/C2 already exist) ----
  var terms = [
    ["CUSR", "Commander's Unit Status Report — AR 220-1's readiness report, named to emphasize that the unit commander is solely responsible for the accuracy of what it reports."],
    ["JIIM", "Joint, Interagency, Intergovernmental, and Multinational — the range of partners a senior NCO increasingly coordinates with at the operational level and above."]
  ];
  bank.acronyms = bank.acronyms || { terms: [] };
  bank.acronyms.terms = Array.isArray(bank.acronyms.terms) ? bank.acronyms.terms : [];
  var termMap = new Map(bank.acronyms.terms.map(function (t) { return [String(t.a || "").toUpperCase(), t]; }));
  function mergeDefinition(had, incoming) {
    had = String(had || "");
    var head = incoming.split(" — ")[0].toLowerCase();
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

  // ---- Scenarios: MLC-scope operational/strategic decision points ------
  var scenarioList = bank.scenarios && Array.isArray(bank.scenarios.scenarios) ? bank.scenarios.scenarios : null;
  if (scenarioList) {
    var have = new Set(scenarioList.map(function (s) { return s.id; }));
    function add(sc) { if (!have.has(sc.id)) { scenarioList.push(sc); have.add(sc.id); } }

    add({
      id: "sc-mlc-readiness-pressure",
      title: "Pressure to Report Readiness More Favorably",
      tier: TIER_78, competency: ["Character", "Achieves"], estMinutes: 4, difficulty: "Advanced",
      doctrine: [{ pub: "AR 220-1", para: "Commander's Unit Status Report — accuracy and the requirement to neither mask nor exaggerate deficiencies", edition: "2022-08", quoteKind: "paraphrase" }],
      defaultMode: "cyoa", renderModes: ["text", "course", "cyoa"],
      scene: "Battalion staff — a major training event is two weeks out, and the true personnel/equipment readiness picture would put the battalion below the threshold leadership wants to show",
      start: "n1", curriculum: CURRICULUM, pillar: "Leadership & Counseling",
      nodes: {
        n1: { prompt: "The battalion commander's executive officer asks you, as the senior NCO compiling readiness input, to 'find a way to get the numbers closer to green' before the report goes up. What do you do?", choices: [{ text: "Continue", goto: "n2" }] },
        n2: { prompt: "Choose the response that best protects the integrity of the readiness report while still supporting the commander.", choices: [
          { text: "Report the real numbers, and separately brief the commander in person on exactly what is driving the shortfall and what is already being done to fix it, so the report and the conversation match.", goto: "end-good", score: { Character: 3, Achieves: 3 }, feedback: "AR 220-1 exists precisely so leadership above the battalion gets an accurate picture — pairing the honest number with a clear improvement plan is the doctrinally sound move." },
          { text: "Reclassify a few marginal line items as ready, reasoning that the true status will likely improve before the event anyway.", goto: "end-fudge", score: { Character: 0, Achieves: 0 }, feedback: "AR 220-1 requires accuracy at the time reported, not a forecast. A report closer to what you hope will be true rather than what is true is the exact failure the regulation names." },
          { text: "Quietly comply, since the XO outranks you and it is ultimately the commander's report and the commander's call.", goto: "end-comply", score: { Character: 0, Achieves: 0 }, feedback: "The commander is solely responsible for the CUSR's accuracy, but that does not make a subordinate's data honest by delegation — feeding false input upstream still corrupts the report." },
          { text: "Refuse to provide any input at all until the dispute is resolved, leaving the section blank on the report.", goto: "end-blank", score: { Character: 1, Achieves: 0 }, feedback: "Withholding real data helps no one make a decision. Report what is true and raise the disagreement through the chain — do not simply go silent." }
        ] },
        "end-good": { prompt: "", end: true, outcome: "The commander gets an accurate report AND a clear picture of what is being done about the shortfall — able to make real decisions and, if needed, ask higher headquarters for help before the training event rather than being surprised by it." },
        "end-fudge": { prompt: "", end: true, outcome: "The report no longer reflects reality. If the shortfall causes a problem at the event, the paper trail shows a battalion that reported itself ready when it was not — a far worse outcome for everyone involved than an honest report would have been." },
        "end-comply": { prompt: "", end: true, outcome: "The inflated report goes up the chain with your name behind the data. Rank does not transfer the accuracy obligation away from the person who actually compiled the numbers." },
        "end-blank": { prompt: "", end: true, outcome: "The disagreement gets resolved eventually, but the commander loses time and the report is late — better than a false report, but slower and messier than simply reporting the truth up front." }
      }
    });

    add({
      id: "sc-mlc-ncoer-rater-tendency",
      title: "Rating Your First NCOER as a New Rater",
      tier: TIER_78, competency: ["Character", "Leads"], estMinutes: 4, difficulty: "Advanced",
      doctrine: [{ pub: "AR 623-3", para: "Rater responsibilities and rater tendency", edition: "2024", quoteKind: "paraphrase" }],
      defaultMode: "cyoa", renderModes: ["text", "course", "cyoa"],
      scene: "You have just pinned MSG and are now the rater for three SFCs for the first time. Every recent NCOER in the section's files carries top-block ratings and near-identical bullet comments, regardless of actual performance",
      start: "n1", curriculum: CURRICULUM, pillar: "Leadership & Counseling",
      nodes: {
        n1: { prompt: "One of your three rated SFCs is a genuinely average performer, but every predecessor in your job has rated everyone top-block. How do you approach this first NCOER cycle?", choices: [{ text: "Continue", goto: "n2" }] },
        n2: { prompt: "Choose the response that best serves the rated NCO, the Army's evaluation system, and your own credibility as a rater.", choices: [
          { text: "Rate honestly based on this SFC's actual performance and potential, and have the counseling conversation now so the rating is not a surprise.", goto: "end-good", score: { Character: 3, Leads: 3 }, feedback: "An honest, well-communicated rating protects the integrity of the system and, done with real counseling, does not have to damage the relationship." },
          { text: "Match the established pattern this cycle to avoid standing out, and plan to rate more honestly once you have more time in the position.", goto: "end-match", score: { Character: 0, Leads: 0 }, feedback: "Rater tendency compounds the longer it continues. 'Fixing it later' from an already-inflated baseline is harder, not easier, and this cycle's report is now part of the pattern too." },
          { text: "Rate the SFC honestly without any counseling conversation, since the NCOER speaks for itself.", goto: "end-nocounsel", score: { Character: 2, Leads: 0 }, feedback: "An honest but unexplained rating that breaks from years of inflated reports will read as a surprise attack rather than fair feedback — the accuracy is right, but the execution undermines it." },
          { text: "Ask your own senior rater to handle the rating decision instead, since you are new to the position.", goto: "end-punt", score: { Character: 1, Leads: 0 }, feedback: "The rater's assessment of day-to-day performance is exactly the part of the report the senior rater is not positioned to make — this is a decision the rater has to own." }
        ] },
        "end-good": { prompt: "", end: true, outcome: "The SFC understands exactly where the rating came from and what to work on, the report reflects reality, and you have started your own rating record on solid, defensible ground rather than inheriting someone else's inflation." },
        "end-match": { prompt: "", end: true, outcome: "The pattern of inflated ratings continues under your name now too, and the honest baseline gets harder to establish the longer it goes on." },
        "end-nocounsel": { prompt: "", end: true, outcome: "The rating is accurate, but the SFC has no warning and no path forward — a fair number delivered unfairly still damages trust and misses the point of evaluation as a development tool." },
        "end-punt": { prompt: "", end: true, outcome: "The senior rater cannot substitute for firsthand knowledge of day-to-day performance, and the report is delayed while the rating gets sorted out anyway." }
      }
    });

    add({
      id: "sc-mlc-mdmp-time-pressure",
      title: "A Resourcing Risk Surfaces Late in Mission Analysis",
      tier: TIER_78, competency: ["Intellect", "Achieves"], estMinutes: 4, difficulty: "Advanced",
      doctrine: [{ pub: "FM 6-0", para: "Military Decision-Making Process — Mission Analysis", edition: "2022", quoteKind: "paraphrase" }, { pub: "ADP 5-0", para: "The Operations Process — Plan", edition: "2019", quoteKind: "paraphrase" }],
      defaultMode: "cyoa", renderModes: ["text", "course", "cyoa"],
      scene: "Brigade staff, MDMP Mission Analysis — your running estimate for sustainment shows a real shortfall that was not accounted for in the planning guidance, but the wargame is scheduled to start in two hours",
      start: "n1", curriculum: CURRICULUM, pillar: "Leadership & Counseling",
      nodes: {
        n1: { prompt: "The planning timeline does not allow a full re-work of the estimate before the wargame. What is your move as the senior NCO who owns this running estimate?", choices: [{ text: "Continue", goto: "n2" }] },
        n2: { prompt: "Choose the response that gives the commander and staff the best decision, given the real time constraint.", choices: [
          { text: "Flag the risk clearly to the planning staff now, with your best current estimate of its size, so it is accounted for going into the wargame even if it cannot be fully resolved first.", goto: "end-good", score: { Intellect: 3, Achieves: 3 }, feedback: "MDMP is built to run on the best available information under time pressure — surfacing a known risk early lets the staff wargame against it instead of being blindsided by it." },
          { text: "Keep working the numbers quietly and only bring it up if you finish before the wargame starts.", goto: "end-quiet", score: { Intellect: 0, Achieves: 0 }, feedback: "A risk the staff does not know about cannot be planned against. Silence, even well-intentioned, removes the commander's ability to weigh it." },
          { text: "Delay the wargame until your estimate is fully resolved.", goto: "end-delay", score: { Intellect: 0, Achieves: 1 }, feedback: "Unilaterally stopping the planning timeline is not a senior NCO's call to make, and it treats an incomplete estimate as a reason to halt rather than a risk to report." },
          { text: "Round the estimate to whatever number keeps the plan looking feasible, since raising an unresolved problem this late might reflect poorly on your section.", goto: "end-fudge", score: { Intellect: 0, Achieves: 0 }, feedback: "A plan built on a smoothed-over number is a plan built on bad information — the risk does not go away because the estimate stopped reflecting it." }
        ] },
        "end-good": { prompt: "", end: true, outcome: "The staff wargames the course of action with the sustainment risk in view, and the commander can decide whether to accept it, mitigate it, or request additional resources — an informed decision instead of an unpleasant surprise." },
        "end-quiet": { prompt: "", end: true, outcome: "The wargame proceeds without the risk on the table. If it materializes during execution, the staff is dealing with it for the first time in the field instead of having planned around it." },
        "end-delay": { prompt: "", end: true, outcome: "The timeline slips without authorization, and the staff loses planning time it cannot recover — the risk still was not resolved, it was only postponed." },
        "end-fudge": { prompt: "", end: true, outcome: "The plan looks feasible on paper and is not feasible in reality. The gap surfaces during execution, when it is far more expensive to fix." }
      }
    });

    add({
      id: "sc-mlc-toxic-first-sergeant",
      title: "A High-Performing First Sergeant with a Toxic Climate",
      tier: TIER_78, competency: ["Character", "Leads", "Develops"], estMinutes: 4, difficulty: "Advanced",
      doctrine: [{ pub: "ADP 6-22", para: "Ch 9 (Organizational Leadership) and Counterproductive Leadership", edition: "2019-07 (incl. C1 Nov 2019)", quoteKind: "paraphrase" }],
      defaultMode: "cyoa", renderModes: ["text", "course", "cyoa"],
      scene: "Battalion CSM's office — a company first sergeant consistently delivers top training and readiness numbers, but a pattern of anonymous complaints and rising attrition in that company points to a fear-based, counterproductive command climate",
      start: "n1", curriculum: CURRICULUM, pillar: "Leadership & Counseling",
      nodes: {
        n1: { prompt: "The company's numbers make the battalion look good, and the first sergeant is well liked by the chain above. How do you, as the senior organizational-level NCO, handle this?", choices: [{ text: "Continue", goto: "n2" }] },
        n2: { prompt: "Choose the response that best fulfills an organizational leader's responsibility to set and protect the command climate.", choices: [
          { text: "Investigate the pattern directly (climate assessment, individual conversations, EO/IG channels as appropriate), and address it with the first sergeant regardless of the company's output.", goto: "end-good", score: { Character: 3, Leads: 3, Develops: 2 }, feedback: "ADP 6-22 holds organizational leaders responsible for the climate across the whole formation, not just for the metrics one subordinate unit produces — results do not excuse a counterproductive climate." },
          { text: "Let it continue since the numbers are good and nothing has been formally substantiated yet.", goto: "end-ignore", score: { Character: 0, Leads: 0, Develops: 0 }, feedback: "Treating strong output as proof the climate is fine ignores the actual signal (complaints, attrition) an organizational leader is specifically responsible for noticing and acting on." },
          { text: "Quietly move the first sergeant to a different position without addressing the underlying behavior, to avoid a confrontation.", goto: "end-relocate", score: { Character: 1, Leads: 0, Develops: 0 }, feedback: "Relocating the problem without correcting the behavior just exports it to the next formation — it protects the battalion's optics, not the Soldiers actually affected." },
          { text: "Address it, but only informally and off the record, to avoid a paper trail that could affect the first sergeant's career.", goto: "end-informal", score: { Character: 1, Leads: 1, Develops: 0 }, feedback: "An informal conversation can be a legitimate FIRST step, but avoiding any documented accountability for a substantiated pattern of counterproductive leadership protects the leader's record over the Soldiers experiencing the climate." }
        ] },
        "end-good": { prompt: "", end: true, outcome: "The climate issue gets addressed on its own terms rather than being excused by good metrics — consistent with an organizational leader's responsibility to set climate across the formation, not just to reward whichever subordinate unit produces the best numbers." },
        "end-ignore": { prompt: "", end: true, outcome: "The attrition and complaints continue, and the battalion eventually has to deal with a worse version of the same problem — now with a longer pattern and more people affected." },
        "end-relocate": { prompt: "", end: true, outcome: "The specific company's numbers may improve, but the same counterproductive leadership pattern now belongs to whichever formation receives the first sergeant next." },
        "end-informal": { prompt: "", end: true, outcome: "The conversation may produce some short-term change, but without documentation there is no record if the pattern continues, and no accountability commensurate with a substantiated, ongoing problem." }
      }
    });

    add({
      id: "sc-mlc-talent-slotting",
      title: "Slotting the Right NCO Into the Hard Job",
      tier: TIER_78, competency: ["Character", "Develops", "Achieves"], estMinutes: 3, difficulty: "Advanced",
      doctrine: [{ pub: "U.S. Army Talent Management Strategy, Force 2025 and Beyond", para: "Matching knowledge, skills, behaviors and preferences to positions; shared investment in development", edition: "2016", quoteKind: "paraphrase" }],
      defaultMode: "cyoa", renderModes: ["text", "course", "cyoa"],
      scene: "Battalion senior NCO's desk — a demanding, unglamorous staff NCO position needs to be filled. One SFC is clearly the best-qualified fit and would grow the most from it, but has already told you they would rather not take it; a less-qualified SFC is eager and politically convenient to place there",
      start: "n1", curriculum: CURRICULUM, pillar: "Leadership & Counseling",
      nodes: {
        n1: { prompt: "You have the authority to recommend either NCO for the position. What do you do?", choices: [{ text: "Continue", goto: "n2" }] },
        n2: { prompt: "Choose the response that best reflects talent-management doctrine's intent.", choices: [
          { text: "Have a direct conversation with the best-fit SFC about why the position matters for their development and the organization, listen to their concerns, and make an honest case for taking it — while still respecting their input into the final decision.", goto: "end-good", score: { Character: 3, Develops: 3, Achieves: 2 }, feedback: "Talent management is built on matching people to positions AND accounting for preference — a real conversation, not a unilateral assignment or a pure popularity contest, is the doctrinal middle path." },
          { text: "Assign the eager but less-qualified SFC simply because they want it and will cause no friction.", goto: "end-convenient", score: { Character: 0, Develops: 0, Achieves: 0 }, feedback: "Optimizing for the path of least resistance instead of fit and development potential is exactly the seniority/convenience-based approach talent management doctrine is meant to replace." },
          { text: "Assign the best-fit SFC to the position regardless of their stated preference, since the organization's needs come first.", goto: "end-force", score: { Character: 1, Develops: 1, Achieves: 2 }, feedback: "This may produce a good short-term fit, but ignoring stated preference entirely undercuts the 'preferences' half of the talent-management framework and risks the NCO's buy-in and retention." },
          { text: "Leave the position unfilled rather than resolve the disagreement, hoping someone else volunteers.", goto: "end-vacant", score: { Character: 0, Develops: 0, Achieves: 0 }, feedback: "An unfilled critical position helps no one — avoiding the decision is itself a decision, and a costly one." }
        ] },
        "end-good": { prompt: "", end: true, outcome: "The best-fit SFC takes the position with a clear understanding of why, more likely to be engaged rather than resentful — and if they still decline after a genuine conversation, you have real information to make the next call with." },
        "end-convenient": { prompt: "", end: true, outcome: "The position is filled quickly, but with the weaker fit — the organization gets a worse outcome and a real developmental opportunity is wasted on someone less positioned to grow from it." },
        "end-force": { prompt: "", end: true, outcome: "The organization likely gets strong short-term performance, but an NCO assigned against their clearly stated preference with no real conversation is more likely to disengage or seek to leave the organization at the next opportunity." },
        "end-vacant": { prompt: "", end: true, outcome: "The position sits empty and the work it covers does not get done, while the underlying disagreement remains completely unresolved." }
      }
    });

    add({
      id: "sc-mlc-jiim-coordination",
      title: "Coordinating Support for a Partner-Nation Liaison Team",
      tier: TIER_78, competency: ["Intellect", "Leads"], estMinutes: 3, difficulty: "Advanced",
      doctrine: [{ pub: "AR 350-1", para: "3-38a — inter-agency capabilities and multinational considerations in MLC's areas of study", edition: "2025-06-01", quoteKind: "paraphrase" }, { pub: "ADP 3-0", para: "Operational-level considerations; unified action partners", edition: "2019", quoteKind: "paraphrase" }],
      defaultMode: "cyoa", renderModes: ["text", "course", "cyoa"],
      scene: "Brigade level, a multinational training exercise — a partner-nation liaison team needs logistics and communications support, but no existing SOP clearly assigns which staff section owns that coordination",
      start: "n1", curriculum: CURRICULUM, pillar: "Leadership & Counseling",
      nodes: {
        n1: { prompt: "The liaison team's requests are falling through the gap between sections, and the exercise timeline is tightening. What do you do as the senior NCO asked to sort this out?", choices: [{ text: "Continue", goto: "n2" }] },
        n2: { prompt: "Choose the response that best resolves the coordination gap at the operational, JIIM level this situation calls for.", choices: [
          { text: "Identify the specific unmet needs, quickly establish a single point of contact and a simple coordination process across the relevant staff sections, and get the commander's endorsement so it holds for the rest of the exercise.", goto: "end-good", score: { Intellect: 3, Leads: 3 }, feedback: "Operational-level coordination with unified action partners is exactly the kind of ambiguous, cross-section problem MLC's JIIM-focused curriculum is meant to prepare a senior NCO to solve." },
          { text: "Tell the liaison team to route every request through you personally so nothing falls through the cracks again.", goto: "end-bottleneck", score: { Intellect: 1, Leads: 1 }, feedback: "This solves the immediate gap but creates a single point of failure — if you are unavailable, the same coordination problem returns, worse." },
          { text: "Leave it to the partner-nation liaison team to figure out which section to approach, since it is not clearly anyone's assigned responsibility.", goto: "end-punt", score: { Intellect: 0, Leads: 0 }, feedback: "A gap in the SOP is not the partner force's problem to solve — leaving it unresolved damages the coordination the exercise is specifically meant to build." },
          { text: "Escalate the entire issue to the brigade commander to decide, without proposing any interim fix yourself.", goto: "end-escalate", score: { Intellect: 0, Leads: 1 }, feedback: "Escalating with no proposed solution offloads a problem a senior NCO is well positioned to solve directly, and wastes time the tightening timeline does not allow." }
        ] },
        "end-good": { prompt: "", end: true, outcome: "The liaison team gets reliable support, the ad hoc process the commander endorsed can outlast this one exercise, and the gap in the SOP gets fixed for next time instead of just patched over once." },
        "end-bottleneck": { prompt: "", end: true, outcome: "Requests stop falling through the cracks while you are personally available, but the underlying coordination gap in the SOP never actually gets fixed." },
        "end-punt": { prompt: "", end: true, outcome: "The liaison team's needs continue to go unmet, straining exactly the multinational coordination this exercise exists to build and practice." },
        "end-escalate": { prompt: "", end: true, outcome: "The commander eventually directs a fix, but only after real time was lost that a direct, proposed solution at your level could have saved." }
      }
    });

    add({
      id: "sc-mlc-modernization-resistance",
      title: "Implementing a New Army System Across a Resistant Battalion",
      tier: TIER_78, competency: ["Leads", "Achieves", "Develops"], estMinutes: 4, difficulty: "Advanced",
      doctrine: [{ pub: "ADP 6-22", para: "Ch 9 (Organizational Leadership, Achieving) and Ch 10 (Strategic Leadership) — preparing the force for future missions and change", edition: "2019-07 (incl. C1 Nov 2019)", quoteKind: "paraphrase" }],
      defaultMode: "cyoa", renderModes: ["text", "course", "cyoa"],
      scene: "Battalion level — Department of the Army has directed adoption of a new readiness-reporting or personnel system across the force, and several company-level leaders are quietly slow-rolling it, preferring their old process",
      start: "n1", curriculum: CURRICULUM, pillar: "Leadership & Counseling",
      nodes: {
        n1: { prompt: "As the battalion's senior NCO, you are responsible for actually making this Army-directed change work in your formation. How do you approach the resistance?", choices: [{ text: "Continue", goto: "n2" }] },
        n2: { prompt: "Choose the response that best fulfills an organizational leader's role in translating and driving strategic-level direction.", choices: [
          { text: "Understand specifically what is driving the resistance (unclear training, workload concerns, distrust of the new system), address those causes directly, and set a clear standard and timeline for adoption across every company.", goto: "end-good", score: { Leads: 3, Achieves: 3, Develops: 2 }, feedback: "ADP 6-22 frames the organizational leader as the one who prepares the formation for change and translates strategic direction into something subordinate units can actually execute — that means solving the real cause of resistance, not just issuing another order." },
          { text: "Issue a single directive that the new system will be used starting immediately, with no explanation of why or support for the transition.", goto: "end-directive", score: { Leads: 1, Achieves: 1, Develops: 0 }, feedback: "A bare directive with no explanation or support tends to produce compliance on paper and continued resistance in practice — the underlying cause never gets addressed." },
          { text: "Allow companies to keep using their preferred legacy process informally as long as the new system's paperwork gets filled out for appearances.", goto: "end-shadow", score: { Leads: 0, Achieves: 0, Develops: 0 }, feedback: "This creates a shadow process that looks compliant but is not — it defeats the purpose of the Army-directed change and leaves the battalion unprepared when the legacy process is eventually retired entirely." },
          { text: "Wait to see if the mandate gets rescinded or delayed before pushing adoption.", goto: "end-wait", score: { Leads: 0, Achieves: 0, Develops: 0 }, feedback: "Treating a directed Army-wide change as optional or likely to disappear is a poor bet, and it leaves the battalion further behind if and when enforcement tightens." }
          ] },
        "end-good": { prompt: "", end: true, outcome: "The battalion genuinely adopts the new system rather than just appearing to, because the actual causes of resistance were addressed — a real example of an organizational leader translating strategic-level direction into effective execution." },
        "end-directive": { prompt: "", end: true, outcome: "Compliance is uneven and grudging. Without addressing the real resistance, the same friction resurfaces at the next Army-directed change." },
        "end-shadow": { prompt: "", end: true, outcome: "The battalion looks compliant on paper while the real underlying process never changes — a problem that surfaces badly whenever the legacy workaround is no longer available." },
        "end-wait": { prompt: "", end: true, outcome: "The mandate does not disappear, and the battalion now has less time to adopt it properly than if the transition had started immediately." }
      }
    });

    add({
      id: "sc-mlc-intent-two-echelons",
      title: "Ambiguous Intent Between Two Companies",
      tier: TIER_78, competency: ["Intellect", "Leads"], estMinutes: 3, difficulty: "Advanced",
      doctrine: [{ pub: "ADP 6-22", para: "1-128 — organizational leaders communicate intent two echelons down and understand intent two echelons up", edition: "2019-07 (incl. C1 Nov 2019)", quoteKind: "paraphrase" }, { pub: "ADP 6-0", para: "1-49 — commander's intent and mission orders among the principles of mission command", edition: "2026-07-07", quoteKind: "paraphrase" }],
      defaultMode: "cyoa", renderModes: ["text", "course", "cyoa"],
      scene: "Battalion CSM's position — a new battalion commander's stated intent leaves it unclear which of two companies has priority of effort for a limited set of training resources, and both first sergeants are planning as if their company has priority",
      start: "n1", curriculum: CURRICULUM, pillar: "Leadership & Counseling",
      nodes: {
        n1: { prompt: "Both companies are about to commit resources based on conflicting assumptions about the commander's real priority. What do you do?", choices: [{ text: "Continue", goto: "n2" }] },
        n2: { prompt: "Choose the response that best fulfills the organizational leader's responsibility to communicate intent two echelons down.", choices: [
          { text: "Go directly to the commander, get a clear answer on priority of effort, then personally communicate that clarified intent to both first sergeants before either commits resources.", goto: "end-good", score: { Intellect: 3, Leads: 3 }, feedback: "This is exactly the responsibility ADP 6-22 para 1-128 assigns an organizational leader: understand intent accurately, then push it two echelons down before a costly conflict plays out on the ground." },
          { text: "Let both first sergeants proceed on their own assumptions and sort out the resource conflict when it actually happens.", goto: "end-collide", score: { Intellect: 0, Leads: 0 }, feedback: "Waiting for the conflict to materialize wastes both companies' planning effort and risks a much messier, more visible resolution than clarifying intent up front would have." },
          { text: "Make your own best guess about the commander's likely priority and tell both first sergeants what to do, without checking with the commander first.", goto: "end-guess", score: { Intellect: 1, Leads: 1 }, feedback: "A confident guess is not the same as understood intent — if the guess is wrong, you have now given both companies incorrect direction with your own authority behind it." },
          { text: "Split the limited resources evenly between the two companies to avoid the question of priority entirely.", goto: "end-split", score: { Intellect: 0, Leads: 1 }, feedback: "An even split avoids conflict but may directly contradict the commander's actual priority of effort, and does not solve the real problem: intent was never actually clarified." }
        ] },
        "end-good": { prompt: "", end: true, outcome: "Both companies now plan against the same, commander-confirmed priority — exactly the kind of intent-clarification an organizational leader is positioned to provide before ambiguity turns into a resource conflict on the ground." },
        "end-collide": { prompt: "", end: true, outcome: "The conflict happens as predicted, and it now has to be resolved under time pressure, with both companies having already sunk planning effort into incompatible assumptions." },
        "end-guess": { prompt: "", end: true, outcome: "If the guess happens to be right, no harm done — but if it is wrong, both companies now have to be redirected, and trust in your read of the commander's intent takes a hit." },
        "end-split": { prompt: "", end: true, outcome: "The immediate friction is avoided, but if the commander's real intent was to prioritize one company, the even split silently works against the actual mission — and the ambiguity is still unresolved for next time." }
      }
    });
  }

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

  return {
    CATEGORY: [CAT_MLC, CAT_MC],
    cardIds: cards.map(function (x) { return x[0]; }),
    scenarioCount: 8,
    termKeys: terms.map(function (x) { return x[0]; })
  };
  });
})();
