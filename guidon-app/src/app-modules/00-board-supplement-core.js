/* GUIDON - promotion-board supplement intake (core 72 cards)
   User-supplied board material is expanded into the canonical board question
   shape before DOMContentLoaded, so every existing consumer of
   G.store.boardQuestions() (Board Drill, Rapid Fire, Mock Board, SRS/weak
   areas, search, study rooms, etc.) sees the same cards with no parallel
   study silo. Exact-question matches preserve the existing id/SRS history;
   the intake provenance is appended instead of creating a duplicate.
*/
(function () {
  "use strict";
  var G = window.G = window.G || {};
  var seed = window.GUIDON_SEED;
  if (!seed || !seed.board || !Array.isArray(seed.board.questions)) return;

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[\u2018\u2019]/g, "'")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }
  /* INTERIM: a hand copy of the rows of tools/pillar-map.mjs CATEGORY_PILLAR
     this deck uses (a later change feeds the real map in at build time). It
     must agree with that map for every category a deck uses - "Discipline"
     was missing, so two cards fell out of the Leadership & Counseling pillar
     filter and readiness row. tools/test-board-content-truth.mjs compares the
     live bank against pillar-map.mjs so a gap here fails a test. */
  function pillarFor(cat) {
    var m = {
      "Army Values":"Drill & Board Etiquette", "Warrior Ethos":"Drill & Board Etiquette",
      "Creeds":"Drill & Board Etiquette", "NCO Creed":"Drill & Board Etiquette",
      "Chain of Command":"Leadership & Counseling", "NCO Support Channel":"Leadership & Counseling",
      "Customs & Courtesies":"Drill & Board Etiquette", "Board Procedures":"Drill & Board Etiquette",
      "AR 670-1 — Uniform Standards":"Drill & Board Etiquette", "Awards":"Leadership & Counseling",
      "AR 623-3 — Evaluations":"Leadership & Counseling", "Army Programs":"Programs & Support",
      "SHARP (AR 600-52)":"Programs & Support", "Equal Opportunity (AR 600-20)":"Programs & Support",
      "UCMJ":"Leadership & Counseling", "Promotions":"Leadership & Counseling",
      "Discipline":"Leadership & Counseling",
      "Counseling (ATP 6-22.1)":"Leadership & Counseling", "Leadership":"Leadership & Counseling",
      "Mission Command (ADP 6-0)":"Doctrinal Thinking", "Risk Management":"Doctrinal Thinking",
      "AR 350-1 (Training Regulation / METL)":"Training Management"
    };
    return m[cat] || null;
  }
  /* Prompts already folded into an older card (normalized question -> older
     id). It outlives one deck so that the SAME prompt in a later deck folds
     to the same card instead of being added as new. */
  var foldedPrompts = new Map();
  function mergeDeck(deck) {
    var bank = seed.board.questions;
    var byQ = new Map();
    var byId = new Map();
    var ids = new Set();
    bank.forEach(function (q) { byQ.set(norm(q.q), q); byId.set(q.id, q); ids.add(q.id); });
    foldedPrompts.forEach(function (olderId, key) { if (!byQ.has(key) && byId.has(olderId)) byQ.set(key, byId.get(olderId)); });
    var stats = { sourceCards: deck.cards.length, qas: 0, added: 0, matched: 0, folded: 0, unresolved: 0 };
    deck.cards.forEach(function (card) {
      card.qa.forEach(function (pair, i) {
        stats.qas++;
        var qtext = pair[0], ans = pair[1], k = norm(qtext), existing = byQ.get(k);
        var sourceCard = deck.id + "-" + String(card.n).padStart(2, "0");
        /* Same question, different words. Exact-text matching caught 8 of the
           224 prompts; "What is the Warrior Ethos?" still landed beside
           "Recite the Warrior Ethos." as a second card, and the Quiz could
           then offer one twin's correct answer as a wrong option for the
           other. A third element {sameAs:"<older id>"} is the authoring-time
           decision that this prompt IS that older card: nothing is added,
           the older id (and the Soldier's study history on it) stays, and
           its reviewed answer is left alone - only the provenance link is
           recorded so the intake audit still accounts for the prompt. */
        var folded = !!existing && foldedPrompts.has(k);
        if (!existing && pair[2] && pair[2].sameAs) {
          existing = byId.get(pair[2].sameAs);
          if (existing) { folded = true; foldedPrompts.set(k, existing.id); byQ.set(k, existing); } else stats.unresolved++;
        }
        if (existing) {
          existing.sourceCards = Array.isArray(existing.sourceCards) ? existing.sourceCards : [];
          if (existing.sourceCards.indexOf(sourceCard) < 0) existing.sourceCards.push(sourceCard);
          if (folded) {
            /* The supplement offered this prompt to every Soldier. If the
               older card was limited to some ranks, folding must not take
               the question away from the rest. */
            if (Array.isArray(existing.tier) && existing.tier.length) existing.tier = ["E1", "E2", "E3", "E4", "E5", "E6"];
            stats.folded++; stats.matched++;
            return;
          }
          existing.keyPoints = Array.isArray(existing.keyPoints) && existing.keyPoints.length ? existing.keyPoints : [existing.a || ans];
          if (existing.keyPoints.indexOf(ans) < 0 && ans !== existing.a && ans.length < 260) existing.keyPoints.push(ans);
          stats.matched++;
          return;
        }
        var id = "pb-" + deck.id + "-" + String(card.n).padStart(2, "0") + "-" + (i + 1);
        while (ids.has(id)) id += "x";
        /* These decks are a study guide's own wording, not quotations from
           the cited publication. verbatim:false makes the card back say so
           ("Study-guide answer (not a word-for-word quote)") instead of
           presenting the text under "By the Book (verbatim doctrine)".
           boardAnswer is still filled because every consumer of the bank
           (search, Mock Board, the handheld export) expects the field. */
        var rec = {
          id: id,
          category: card.category,
          q: qtext,
          a: ans,
          acceptableAnswer: ans,
          boardAnswer: ans,
          verbatim: false,
          source: card.source,
          concept: card.title,
          keyPoints: [ans],
          difficulty: card.difficulty || "basic",
          sourceCards: [sourceCard]
        };
        var p = pillarFor(card.category); if (p) rec.pillar = p;
        bank.push(rec); byQ.set(k, rec); byId.set(id, rec); ids.add(id); stats.added++;
      });
    });
    G.boardSupplement = G.boardSupplement || { decks: [], totals: { sourceCards: 0, qas: 0, added: 0, matched: 0, folded: 0, unresolved: 0 } };
    G.boardSupplement.decks.push({ id: deck.id, stats: stats });
    Object.keys(stats).forEach(function (k) { G.boardSupplement.totals[k] = (G.boardSupplement.totals[k] || 0) + stats[k]; });
  }
  G.boardSupplementMergeDeck = mergeDeck;

  mergeDeck({ id: "core72", cards: [
    {n:1,title:"Army Values: LDRSHIP",category:"Army Values",source:"ADP 6-22",qa:[["What are the seven Army Values?","Loyalty, Duty, Respect, Selfless Service, Honor, Integrity, and Personal Courage."],["What mnemonic is commonly used to remember the Army Values?","LDRSHIP."]]},
    {n:2,title:"Loyalty & Duty",category:"Army Values",source:"ADP 6-22",qa:[["What is Loyalty?","Bear true faith and allegiance to the U.S. Constitution, the Army, your unit, and other Soldiers."],["What is Duty?","Fulfill your obligations and accept responsibility for your actions and those entrusted to you.",{sameAs:"av-duty"}]]},
    {n:3,title:"Respect & Selfless Service",category:"Army Values",source:"ADP 6-22",qa:[["What is Respect?","Treat people as they should be treated."],["What is Selfless Service?","Put the welfare of the Nation, the Army, and your subordinates before your own, without neglecting your own legitimate needs."]]},
    {n:4,title:"Honor & Integrity",category:"Army Values",source:"ADP 6-22",qa:[["What is Honor?","Live up to all the Army Values."],["What is Integrity?","Do what is right, legally and morally."]]},
    {n:5,title:"Personal Courage",category:"Army Values",source:"ADP 6-22",qa:[["What is Personal Courage?","Face moral or physical fear, danger, or adversity."],["Give a leadership example of moral courage.","Correcting a wrong, reporting misconduct, or speaking truthfully when doing so is difficult or unpopular."]]},
    {n:6,title:"Applying Army Values",category:"Army Values",source:"ADP 6-22",qa:[["Why are Army Values important to an NCO?","They guide decisions, behavior, leadership, trust, and the example an NCO sets for Soldiers."],["If mission pressure conflicts with an Army Value, what should you do?","Choose the lawful and ethical course, seek guidance when needed, and never use mission pressure to justify misconduct."]]},
    {n:7,title:"Soldier's Creed",category:"Creeds",source:"Soldier's Creed / ADP 6-22",qa:[["What does the Soldier's Creed express?","The identity, obligations, Warrior Ethos, discipline, and professional commitment expected of an American Soldier."],["What phrase begins the Soldier's Creed?","I am an American Soldier."]]},
    {n:8,title:"Warrior Ethos",category:"Warrior Ethos",source:"ADP 6-22 / Soldier's Creed",qa:[["What are the four lines of the Warrior Ethos?","Always place the mission first; never accept defeat; never quit; never leave a fallen comrade.",{sameAs:"we-8"}],["Why should a Soldier know the Warrior Ethos?","It provides a concise standard for mission focus, perseverance, courage, and commitment to teammates."]]},
    {n:9,title:"Soldier's Creed: Profession",category:"Creeds",source:"Soldier's Creed",qa:[["What does 'I am a warrior and a member of a team' emphasize?","Soldiers combine individual competence with teamwork and service to something larger than themselves."],["What does the Soldier's Creed say about standards?","A Soldier is disciplined, physically and mentally tough, trained and proficient, and maintains arms, equipment, and self."]]},
    {n:10,title:"NCO Creed: Identity",category:"NCO Creed",source:"Creed of the Noncommissioned Officer / TC 7-22.7",qa:[["What opening principle is central to the NCO Creed?","No one is more professional than I."],["What does the NCO Creed say an NCO is?","A noncommissioned officer, a leader of Soldiers."]]},
    {n:11,title:"NCO Responsibilities",category:"NCO Creed",source:"Creed of the Noncommissioned Officer / TC 7-22.7",qa:[["What are an NCO's two basic responsibilities stated in the Creed?","Accomplishment of the mission and the welfare of Soldiers.",{sameAs:"creeds-3"}],["Which responsibility comes first in the NCO Creed?","Accomplishment of the mission."]]},
    {n:12,title:"NCO Leadership",category:"NCO Creed",source:"Creed of the Noncommissioned Officer / TC 7-22.7",qa:[["What does the NCO Creed require regarding communication?","NCOs communicate consistently and never leave Soldiers uninformed."],["What does the NCO Creed require regarding officers?","The Creed says: \"Officers of my unit will have maximum time to accomplish their duties; they will not have to accomplish mine. I will earn their respect and confidence as well as that of my Soldiers.\"",{sameAs:"creeds-5"}]]},
    {n:13,title:"Chain of Command",category:"Chain of Command",source:"AR 600-20",qa:[["What is the chain of command?","The succession of commanders through which command authority is exercised from a superior to a subordinate."],["Why is the chain of command important?","It establishes authority, responsibility, accountability, communication, and disciplined execution."]]},
    {n:14,title:"NCO Support Channel",category:"NCO Support Channel",source:"AR 600-20",qa:[["What is the NCO support channel?","The communication and supervision channel that parallels and supports the chain of command through NCO leadership."],["Does the NCO support channel replace the chain of command?","No. It supports the chain of command and functions within the commander's policies and authority."]]},
    {n:15,title:"Know Your Unit",category:"Board Procedures",source:"Local promotion-board MOI / AR 600-8-19",qa:[["Which leaders should you know by name before your board?","At minimum, the leaders required by your board MOI, normally your immediate chain through battalion or brigade and any higher positions specified."],["Why should permanent flashcards not hard-code all leader names?","Command positions change. Verify current names immediately before the board."]]},
    {n:16,title:"Chain vs. NCO Channel",category:"Chain of Command",source:"AR 600-20",qa:[["Who normally begins your immediate chain of command?","Your commander structure, beginning at the lowest applicable commander in your organization."],["Who normally begins your NCO support channel?","Your first-line NCO leadership, followed by progressively senior NCOs such as platoon sergeant, first sergeant, and command sergeant major as applicable."]]},
    {n:17,title:"Open Door Policy",category:"Chain of Command",source:"AR 600-20",qa:[["What is the commander's open door policy?","A command-climate tool allowing Soldiers to present issues to commanders as established by command policy."],["Does the open door policy eliminate normal leadership channels?","No. Soldiers should still use normal leadership communication when appropriate, although urgent or sensitive circumstances may justify direct access."]]},
    {n:18,title:"Chain of Command: Board Prep",category:"Board Procedures",source:"Local promotion-board MOI",qa:[["What should you do if asked for a current leader's name and you are unsure?","Do not invent a name. State that you do not know and will find the correct answer."],["What should you study immediately before the board?","Your current chain of command, NCO support channel, command teams, board members, and positions identified in the MOI."]]},
    {n:19,title:"Saluting",category:"Customs & Courtesies",source:"AR 600-25",qa:[["What is the salute?","A military courtesy used as a greeting and sign of respect between members of the Armed Forces."],["Who normally initiates the salute?","The junior member initiates the salute and holds it until returned, subject to the situation and applicable policy."]]},
    {n:20,title:"National Anthem",category:"Customs & Courtesies",source:"AR 600-25",qa:[["What do Soldiers in uniform do outdoors during the U.S. national anthem?","Face the flag, or the music if the flag is not visible, stand at attention, and render the hand salute from the first note through the last."],["What do Soldiers in uniform normally do indoors during the national anthem?","Follow the prescribed ceremony and applicable guidance; normally stand at attention rather than render the outdoor hand salute."]]},
    {n:21,title:"Reveille & Retreat",category:"Customs & Courtesies",source:"AR 600-25",qa:[["What does Reveille traditionally signal?","The start of the official duty day and a ceremony honoring the U.S. flag."],["What does Retreat traditionally signal?","The end of the official duty day and precedes lowering the flag during the retreat ceremony."]]},
    {n:22,title:"Reporting to the Board",category:"Board Procedures",source:"Local promotion-board MOI / AR 600-8-19",qa:[["How do you report to the president of a promotion board?","Follow the board MOI and sponsor instructions: enter when directed, move to the prescribed position, salute when appropriate, and give the required reporting statement."],["Why practice reporting procedures?","They demonstrate military bearing, confidence, attention to detail, and knowledge of military customs."]]},
    {n:23,title:"Forms of Address",category:"Customs & Courtesies",source:"AR 600-25",qa:[["How do you address an NCO?","Use the appropriate title of rank or authorized form of address."],["How do you address a commissioned officer?","By rank or title, using Sir or Ma'am as appropriate."]]},
    {n:24,title:"Respect for the Flag",category:"Customs & Courtesies",source:"AR 600-25",qa:[["What should a Soldier do when passing or being passed by uncased colors outdoors?","Render the honors prescribed by AR 600-25."],["Why are customs and courtesies important?","They reinforce discipline, respect, cohesion, military heritage, and authority."]]},
    {n:25,title:"Governing Publications",category:"AR 670-1 — Uniform Standards",source:"AR 670-1 / DA PAM 670-1",qa:[["What regulation governs wear and appearance of Army uniforms and insignia?","AR 670-1.",{sameAs:"unif-1"}],["What publication provides detailed uniform wear guidance?","DA PAM 670-1."]]},
    {n:26,title:"Soldier Responsibility",category:"AR 670-1 — Uniform Standards",source:"AR 670-1",qa:[["Who is responsible for maintaining a proper military appearance?","Every Soldier is responsible for meeting the standard; leaders enforce the standard."],["What image should Soldiers present?","A professional military image consistent with discipline, uniformity, and Army standards."]]},
    {n:27,title:"Grooming",category:"AR 670-1 — Uniform Standards",source:"AR 670-1 / DA PAM 670-1 / current Army directives",qa:[["Must Soldiers comply with grooming standards while in uniform?","Yes, as well as applicable standards while in civilian clothes on duty."],["Should you rely solely on an old study guide for grooming rules?","No. Check current AR 670-1, DA PAM 670-1, and current Army directives because policy can change."]]},
    {n:28,title:"Awards",category:"Awards",source:"AR 600-8-22 / AR 670-1 / DA PAM 670-1",qa:[["What regulation primarily governs Army awards and decorations?","AR 600-8-22."],["Where do you verify how awards and insignia are worn?","AR 670-1 and DA PAM 670-1, together with applicable awards and heraldry guidance."]]},
    {n:29,title:"Headgear",category:"AR 670-1 — Uniform Standards",source:"AR 670-1 / DA PAM 670-1",qa:[["When is military headgear normally worn?","Outdoors in uniform unless an authorized exception applies."],["What uniform details should you verify for your board?","The exact uniform, headgear, rank, unit insignia, badges, and placement required by the MOI and current regulations."]]},
    {n:30,title:"Uniform Inspection",category:"AR 670-1 — Uniform Standards",source:"AR 670-1 / DA PAM 670-1",qa:[["What should you inspect before your promotion board?","Fit, cleanliness, serviceability, rank, insignia, awards, badges, nameplates, ribbons, devices, footwear, grooming, and placement."],["Who should inspect your uniform?","A knowledgeable NCO or leader, early enough to correct discrepancies."]]},
    {n:31,title:"NCOER Publications",category:"AR 623-3 — Evaluations",source:"AR 623-3 / DA PAM 623-3",qa:[["What regulation governs the Army Evaluation Reporting System?","AR 623-3."],["What publication provides procedural guidance for evaluations?","DA PAM 623-3."]]},
    {n:32,title:"NCOER Forms",category:"AR 623-3 — Evaluations",source:"AR 623-3 / DA PAM 623-3",qa:[["What form series is used for NCOERs?","DA Form 2166-9 series."],["Why are there different NCOER forms?","The evaluation format is tailored to the rated NCO's grade and level of responsibility."]]},
    {n:33,title:"Rating Chain",category:"AR 623-3 — Evaluations",source:"AR 623-3",qa:[["What is a rating chain?","The officials designated to evaluate a rated Soldier under Army evaluation policy."],["Why must rating chains be communicated?","So rated Soldiers know who evaluates them and rating officials understand their responsibilities."]]},
    {n:34,title:"NCOER Counseling",category:"AR 623-3 — Evaluations",source:"AR 623-3 / DA PAM 623-3",qa:[["What role does counseling play in the evaluation process?","It communicates duties, performance expectations, strengths, weaknesses, goals, and development needs throughout the rating period."],["Should an NCO first learn of major performance problems from the final NCOER?","Normally no. Effective leadership provides timely counseling and feedback."]]},
    {n:35,title:"Performance",category:"AR 623-3 — Evaluations",source:"AR 623-3 / DA PAM 623-3",qa:[["What should evaluation comments be based on?","Observed performance, demonstrated potential where applicable, and substantiated facts during the rating period."],["Why is evaluation accuracy important?","Evaluations affect development, assignments, selections, promotions, and the integrity of the personnel system."]]},
    {n:36,title:"Rated NCO",category:"AR 623-3 — Evaluations",source:"AR 623-3 / DA PAM 623-3",qa:[["What should a rated NCO do during the rating period?","Understand duties and standards, participate in counseling, communicate with the rating chain, and perform to Army standards."],["What if evaluation information appears incorrect?","Use the review, inquiry, or appeal procedures provided by current evaluation policy."]]},
    {n:37,title:"SHARP",category:"SHARP (AR 600-52)",source:"AR 600-52 / current Army SHARP policy",qa:[["What does SHARP stand for?","Sexual Harassment/Assault Response and Prevention."],["What is an NCO's responsibility regarding SHARP?","Build a climate of dignity and respect, prevent misconduct, respond properly, protect privacy as required, and prevent retaliation."]]},
    {n:38,title:"EO",category:"Equal Opportunity (AR 600-20)",source:"AR 600-20",qa:[["What does EO stand for?","Equal Opportunity."],["What is the goal of Army EO?","Promote fair treatment and an environment free from unlawful discrimination and harassment while supporting readiness and cohesion."]]},
    {n:39,title:"ASAP",category:"Army Programs",source:"AR 600-85",qa:[["What does ASAP stand for?","Army Substance Abuse Program."],["What does ASAP focus on?","Prevention, education, deterrence, drug testing, and related non-clinical program functions; clinical treatment is handled through appropriate medical channels."]]},
    {n:40,title:"ACES",category:"Army Programs",source:"AR 621-5",qa:[["What does ACES stand for?","Army Continuing Education System."],["What does ACES provide?","Education counseling and programs supporting Soldiers' academic, testing, credentialing, and continuing-education goals."]]},
    {n:41,title:"BOSS",category:"Army Programs",source:"Army BOSS program / AR 215-1",qa:[["What does BOSS stand for?","Better Opportunities for Single Soldiers."],["What does BOSS support?","Quality of life, community involvement and service, recreation and leisure, and life skills for eligible Soldiers."]]},
    {n:42,title:"Using Army Programs",category:"Army Programs",source:"AR 600-85 / AR 621-5 / AR 215-1 / AR 600-20",qa:[["What should an NCO do when a Soldier asks for help through an Army program?","Listen, identify urgency, connect the Soldier to the correct resource, protect required privacy, follow reporting rules, and follow up within policy."],["What if you are unsure which Army program or rule applies?","Do not guess. Protect the Soldier, use the chain of command or qualified program representative, and verify current policy."]]},
    {n:43,title:"UCMJ",category:"UCMJ",source:"Uniform Code of Military Justice / 10 USC Chapter 47",qa:[["What does UCMJ stand for?","Uniform Code of Military Justice."],["Who does the UCMJ govern?","Persons subject to the UCMJ as defined by federal law."]]},
    {n:44,title:"Article 15",category:"UCMJ",source:"Article 15, UCMJ / AR 27-10",qa:[["What is Article 15?","Nonjudicial punishment allowing commanders to address certain offenses without a court-martial."],["Is an Article 15 a court-martial conviction?","No. It is nonjudicial punishment."]]},
    {n:45,title:"Article 31",category:"UCMJ",source:"Article 31, UCMJ / AR 27-10",qa:[["What is the basic purpose of Article 31 rights?","To protect a suspected or accused person from compelled self-incrimination and require appropriate rights advisement before questioning."],["What should a leader do before questioning a Soldier suspected of an offense?","Ensure required rights are protected and seek legal guidance when appropriate."]]},
    {n:46,title:"Lawful Orders",category:"UCMJ",source:"UCMJ / AR 600-20 (Army Command Policy)",qa:[["Are Soldiers required to obey unlawful orders?","No. Soldiers are obligated to obey lawful orders."],["What if a Soldier is uncertain about an order's legality?","Seek clarification and appropriate command or legal guidance when circumstances permit rather than relying on guesswork."]]},
    {n:47,title:"NJP Rights",category:"UCMJ",source:"Article 15, UCMJ / AR 27-10",qa:[["What should a Soldier facing Article 15 proceedings understand?","The alleged misconduct, applicable rights, available choices, and opportunities to consult counsel provided by law and regulation."],["Should an NCO improvise legal advice?","No. Provide factual leadership support and refer legal questions to qualified legal resources."]]},
    {n:48,title:"NCO Responsibility",category:"Discipline",source:"AR 600-20 / UCMJ / command policy",qa:[["What is an NCO's role in military discipline?","Set and enforce standards, correct deficiencies, document appropriately, protect Soldiers' rights, and use command and legal resources when necessary."],["What should guide corrective action?","It should be lawful, professional, proportionate, mission-focused, and consistent with command policy."]]},
    {n:49,title:"Promotions",category:"Promotions",source:"AR 600-8-19",qa:[["What regulation governs enlisted promotions and demotions?","AR 600-8-19.",{sameAs:"boardprocedu-8"}],["What should a promotion candidate verify?","Eligibility, records, required training and education, promotion data, board requirements, and current policy."]]},
    {n:50,title:"DA Form 4856",category:"Counseling (ATP 6-22.1)",source:"ATP 6-22.1 / DA Form 4856",qa:[["What form documents developmental counseling?","DA Form 4856."],["What is counseling intended to accomplish?","Communicate standards and performance, address events or issues, develop Soldiers, and establish plans of action with follow-up."]]},
    {n:51,title:"Counseling Categories",category:"Counseling (ATP 6-22.1)",source:"ATP 6-22.1",qa:[["What are the three major categories of developmental counseling?","Event-oriented, performance, and professional growth counseling."],["Can a counseling fit more than one category?","Yes. The leader should focus on the Soldier's needs and purpose."]]},
    {n:52,title:"Counseling Process",category:"Counseling (ATP 6-22.1)",source:"ATP 6-22.1",qa:[["What are the four stages of the counseling process?","Identify the need; prepare; conduct the counseling session; follow up."],["Why is counseling follow-up important?","It evaluates the plan of action, reinforces progress, and allows adjustments."]]},
    {n:53,title:"Board MOI",category:"Board Procedures",source:"AR 600-8-19 / local promotion-board MOI",qa:[["What document should you obtain for your local promotion board?","The current board memorandum of instruction or equivalent unit guidance."],["Why should you obtain the current board MOI?","It identifies subjects, uniform, reporting procedures, documents, board composition, and local requirements."]]},
    {n:54,title:"Promotion Records",category:"Promotions",source:"AR 600-8-19 / personnel records policy",qa:[["Why should you review your personnel records before a board?","To ensure awards, education, qualifications, evaluations, and promotion-relevant information are accurate."],["What should you do if you find an error in your promotion records?","Use the appropriate personnel process and supporting documentation to request correction as early as possible."]]},
    {n:55,title:"H2F",category:"FM 7-22",source:"FM 7-22",qa:[["What are the five H2F readiness domains?","Physical, nutritional, mental, spiritual, and sleep readiness.",{sameAs:"acft-005"}],["What publication covers H2F?","FM 7-22, Holistic Health and Fitness."]]},
    {n:56,title:"Current Fitness Test",category:"Army Fitness Test (AFT)",source:"Army Directive 2025-06 / Army AFT implementation guidance",qa:[["What is the Army's current physical fitness test of record?","The Army Fitness Test, or AFT, effective June 1, 2025."],["Should you answer ACFT because an older study guide says so?","No. Use current Army policy and your board MOI."]]},
    {n:57,title:"AFT Events",category:"Army Fitness Test (AFT)",source:"Army Directive 2025-06 / Army AFT implementation guidance",qa:[["What are the five AFT events?","Three-Repetition Maximum Deadlift, Hand-Release Push-Up Arm Extension, Sprint-Drag-Carry, Plank, and Two-Mile Run.",{sameAs:"acft-003"}],["What happened to the Standing Power Throw in the AFT?","It was removed during the transition from the six-event ACFT to the five-event AFT."]]},
    {n:58,title:"Physical Readiness",category:"FM 7-22",source:"FM 7-22",qa:[["What is physical readiness?","The ability to meet the physical demands of duty and combat while reducing preventable injury and sustaining performance.",{sameAs:"fm722-2"}],["Who is responsible for physical readiness?","Individual Soldiers and leaders; commanders and NCOs plan, execute, assess, and enforce readiness standards."]]},
    {n:59,title:"Recovery",category:"FM 7-22",source:"FM 7-22",qa:[["Why are sleep and recovery part of readiness?","They support physical recovery, cognitive performance, learning, resilience, and sustained mission performance."],["Is more training always better?","No. Effective programming balances appropriate overload with recovery, progression, and mission requirements."]]},
    {n:60,title:"Nutrition & Mental Readiness",category:"FM 7-22",source:"FM 7-22",qa:[["Why is nutrition readiness important?","Fueling and hydration affect health, recovery, body composition, cognition, and performance."],["What is mental readiness?","The ability to use psychological and cognitive skills to meet demands, adapt, make decisions, and sustain performance."]]},
    {n:61,title:"Rifle & Carbine",category:"Weapons (TC 3-22.9)",source:"TC 3-22.9",qa:[["What publication covers the rifle and carbine?","TC 3-22.9, Rifle and Carbine."],["What weapon families does TC 3-22.9 address?","The M4- and M16-series weapon systems and their employment."]]},
    {n:62,title:"Weapon Safety",category:"Weapons (TC 3-22.9)",source:"TC 3-22.9",qa:[["What is the first rule when handling a weapon?","Treat every weapon as if it is loaded."],["Where should the muzzle point?","Never at anything you do not intend to engage; maintain positive muzzle awareness."]]},
    {n:63,title:"Trigger & Selector",category:"Weapons (TC 3-22.9)",source:"TC 3-22.9",qa:[["Where should your trigger finger be until you intend to fire?","Straight and off the trigger, outside the trigger guard."],["When should the weapon be placed on FIRE?","Only when you intend to fire in accordance with the situation and commands."]]},
    {n:64,title:"Shot Process",category:"Weapons (TC 3-22.9)",source:"TC 3-22.9",qa:[["What is the shot process?","The Soldier's systematic application of firing tasks and fundamentals to detect, identify, engage, and assess targets."],["Why is consistency important in the shot process?","Consistent position, aiming, trigger control, and follow-through improve accuracy and repeatability."]]},
    {n:65,title:"Malfunctions",category:"Weapons (TC 3-22.9)",source:"TC 3-22.9",qa:[["What should you do if the weapon fails to fire?","Maintain muzzle awareness and apply the trained immediate or remedial action appropriate to the weapon and malfunction."],["Should you improvise a clearing procedure you do not remember?","No. Follow trained procedures, range commands, and applicable publications."]]},
    {n:66,title:"Maintenance",category:"Weapons (TC 3-22.9)",source:"TC 3-22.9 / applicable technical manual",qa:[["Why is preventive maintenance important for a weapon?","It supports safe operation, reliability, serviceability, and combat readiness."],["What should a Soldier do before and after firing?","Inspect and maintain the weapon as required, identify faults, and follow the applicable technical manual, range SOP, and unit procedures."]]},
    {n:67,title:"Current Publication",category:"Land Navigation (TC 3-25.26)",source:"TC 3-25.26",qa:[["What current publication covers Map Reading and Land Navigation?","TC 3-25.26."],["Why might an older study guide say FM 3-25.26?","FM 3-25.26 was the older designation; current Army training references use TC 3-25.26."]]},
    {n:68,title:"Marginal Information",category:"Land Navigation (TC 3-25.26)",source:"TC 3-25.26",qa:[["Why is marginal information important?","It provides map identification, scale, contour interval, grid information, declination data, and other information needed to use the map correctly."],["What should you check before navigating?","Correct map sheet and edition, scale, grid zone, contour interval, declination information, and area of operation."]]},
    {n:69,title:"Grid Coordinates",category:"Land Navigation (TC 3-25.26)",source:"TC 3-25.26",qa:[["What is the purpose of a grid coordinate?","To identify a location on a military map using the grid reference system."],["What memory aid helps when plotting grid coordinates?","Read right, then up."]]},
    {n:70,title:"Azimuth",category:"Land Navigation (TC 3-25.26)",source:"TC 3-25.26",qa:[["What is an azimuth?","A horizontal angle measured clockwise from a reference direction, commonly north, to a line of direction."],["How many degrees are in a circle?","360 degrees."]]},
    {n:71,title:"Terrain Features",category:"Land Navigation (TC 3-25.26)",source:"TC 3-25.26",qa:[["What are the five major terrain features?","Hill, ridge, valley, saddle, and depression.",{sameAs:"bq-nav-02"}],["Name three commonly taught minor terrain features.","Draw, spur, and cliff.",{sameAs:"tc32526-3"}]]},
    {n:72,title:"Compass & Pace Count",category:"Land Navigation (TC 3-25.26)",source:"TC 3-25.26",qa:[["What is pace count used for?","Estimating distance traveled on the ground.",{sameAs:"landnav-9"}],["Why must you account for declination when required?","Grid north and magnetic north differ. Correct conversion prevents directional error when moving between a map and compass."]]}
  ]});
})();
