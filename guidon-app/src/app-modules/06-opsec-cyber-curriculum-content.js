/* GUIDON — Cybersecurity & OPSEC curriculum: content half.
   Public/unclassified doctrine + synthetic scenarios only. This pack mutates
   the same canonical seed used by Board Drill, SRS, Search, Train, and Study
   Rooms; it does not create a parallel study-data silo.

   ROADMAP 3g E split: 06-opsec-cyber-curriculum.js used to be one file that
   BOTH pushed this content into the seed at load AND owned the #/cyber-opsec
   screen (render(), a route, self-audit state on window.G.opsec) - a genuine
   hybrid, since a "content-pack" module must not touch the DOM or own a
   route. This file is the "emit":"build" half: cards, dictionary terms and
   scenarios only, plus the fingerprint restamp the original file also did.
   The screen keeps the original file name and id (opsec-cyber-curriculum, in
   06-opsec-cyber-curriculum.js) as an ordinary "feature" module, reading this
   already-merged content back out of the seed at render time - see that
   file's own header for the rest of the split.
*/
(function () {
  "use strict";
  G.contentPack.define("opsec-cyber-curriculum-content", function (bank) {
  if (!bank) return;

  var CATEGORY = "Cybersecurity & OPSEC";
  /* opsec-cyber-01 used to ask "What is OPSEC?" - word for word the prompt of
     the seed's own bq-opsec-02, with a different answer, so the bank held one
     question twice. It now asks what the process examines (the part of the
     definition bq-opsec-02 does not cover); the id stays so saved progress on
     this card is kept. */
  var cards = [
    ["opsec-cyber-01","What does the OPSEC process examine, and what is that examination for?","It identifies critical information and analyzes friendly actions related to military operations and other activities, so that indicators can be identified and protective measures applied.","AR 530-1 / DoDD 5205.02E","OPSEC purpose"],
    ["opsec-cyber-02","What is critical information in OPSEC?","Specific facts about friendly intentions, capabilities, or activities that an adversary needs to plan and act effectively against mission accomplishment.","AR 530-1 / DoDD 5205.02E","Critical information"],
    ["opsec-cyber-03","What is an OPSEC indicator?","Friendly detectable information or activity that can be interpreted or combined by an adversary to reveal critical information.","AR 530-1 / DoDD 5205.02E","Indicators"],
    ["opsec-cyber-04","Why does aggregation matter in OPSEC?","Separate unclassified facts can become operationally revealing when combined. Users must consider the total picture, not only each data point in isolation.","AR 530-1 / DoDD 5205.02E","Aggregation risk"],
    ["opsec-cyber-05","What should a Soldier do before posting unit-related information online?","Apply unit OPSEC guidance, avoid critical information and sensitive indicators, and seek appropriate review when public release is uncertain.","AR 530-1 / AR 360-1","Social media OPSEC"],
    ["opsec-cyber-06","Why can geotagged photos create OPSEC risk?","Embedded or visible location and timing information can reveal patterns, positions, routes, or activity when combined with other information.","AR 530-1","Geolocation risk"],
    ["opsec-cyber-07","How should wearable or fitness-tracking location sharing be handled around sensitive activities?","Follow unit policy and disable or avoid location-sharing features when they could reveal sensitive locations, routes, timing, or patterns.","AR 530-1 / DoD geolocation policy","Wearable location risk"],
    ["opsec-cyber-08","What is CUI?","Unclassified information that requires safeguarding or dissemination controls pursuant to and consistent with applicable law, regulation, and government-wide policy.","DoDI 5200.48 / 32 CFR Part 2002","CUI definition"],
    ["opsec-cyber-09","Is CUI classified information?","No. CUI is unclassified information that requires safeguarding or dissemination controls under an applicable authority.","DoDI 5200.48","CUI vs classified"],
    ["opsec-cyber-10","Can a keyword scanner determine whether information is CUI?","No. CUI status depends on the applicable authority, category, markings, context, and organizational handling rules; automated screening is only a warning aid.","DoDI 5200.48","CUI determinations"],
    ["opsec-cyber-11","What should you do if you receive information marked CUI unexpectedly?","Protect it from further unauthorized dissemination and follow your organization's handling, security, and incident-reporting procedures.","DoDI 5200.48","Unexpected CUI"],
    ["opsec-cyber-12","What should you do after accidentally sending CUI or PII through an unauthorized channel?","Stop further dissemination, do not compound the incident, preserve the relevant facts, and promptly follow organizational security/privacy/cyber incident-reporting procedures.","DoDI 5200.48 / DoD privacy and incident procedures","Spillage response"],
    ["opsec-cyber-13","What does FOUO mean in the current CUI environment?","For Official Use Only is a legacy marking. Do not assume legacy FOUO maps automatically to a specific CUI category; handle and remark legacy information under applicable transition guidance.","DoDI 5200.48 / CUI Program guidance","Legacy FOUO"],
    ["opsec-cyber-14","What is the purpose of Army cybersecurity policy?","To establish cybersecurity requirements, responsibilities, risk management, and protection of Army information and information systems.","AR 25-2","Army cybersecurity"],
    ["opsec-cyber-15","Should a Soldier connect an unapproved personal device or storage medium to a government system?","No. Use only devices, media, software, and connection methods authorized by the responsible organization and system policy.","AR 25-2","Unauthorized devices"],
    ["opsec-cyber-16","What should you do with an unknown USB device found near a workplace?","Do not connect it to a government or mission system. Follow local cybersecurity/security procedures for handling or reporting it.","AR 25-2","Unknown removable media"],
    ["opsec-cyber-17","Why is least privilege important?","Users and processes should receive only the access needed to perform authorized duties, reducing the damage possible from error, misuse, or compromise.","AR 25-2 / DoDI 8500.01","Least privilege"],
    ["opsec-cyber-18","What is multi-factor authentication?","Authentication that uses factors from more than one category, such as something you know plus something you have or are.","DoDI 8500.01 / DoD identity guidance","MFA"],
    ["opsec-cyber-19","How should a CAC be protected?","Treat it as an identity/authentication credential: maintain physical control, protect associated PINs, and report loss or compromise through required channels.","AR 25-2 / DoD identity credential policy","CAC protection"],
    ["opsec-cyber-20","What is the RMF?","The Risk Management Framework is DoD's structured process for managing cybersecurity risk across the system life cycle and supporting authorization decisions.","DoDI 8510.01","RMF"],
    ["opsec-cyber-21","What is an Authorization to Operate (ATO)?","A formal authorization decision accepting a defined level of risk for operation of a system under stated conditions. An app does not gain an ATO merely by being offline-first.","DoDI 8510.01","ATO"],
    ["opsec-cyber-22","Does local-only storage automatically make an application approved for DoD networks?","No. Network/system use is governed by organizational authorization, connection, cybersecurity, and acceptable-use requirements separate from whether the app has a cloud backend.","AR 25-2 / DoDI 8510.01","Network authorization"],
    ["opsec-cyber-23","Why are phishing messages effective against organizations?","They exploit trust, urgency, authority, curiosity, or routine behavior to induce users to disclose information, open malicious content, or take unauthorized action.","AR 25-2 / DoD Cyber Awareness guidance","Phishing"],
    ["opsec-cyber-24","What is a safe response to a suspicious message requesting unit movements or schedules?","Do not provide the information, do not use the sender's supplied contact path to verify them, and report or verify through known organizational channels.","AR 530-1 / AR 25-2","Social engineering"],
    ["opsec-cyber-25","What is PII?","Information that can be used to distinguish or trace an individual's identity, alone or when combined with other information linked or linkable to that individual.","DoDI 5400.11 / DoD privacy guidance","PII"],
    ["opsec-cyber-26","Should GUIDON be used as an official personnel system of record?","No. GUIDON is an unofficial study tool. Sensitive personnel records belong in authorized systems with appropriate access controls and records-management requirements.","DoDI 5400.11 / Army records and privacy policy","Unofficial tool boundary"],
    ["opsec-cyber-27","What is a public-release review?","A process used by authorized organizations to determine whether DoD information proposed for public release may be released and whether required security/policy reviews are complete.","DoDI 5230.09 / AR 360-1","Public release"],
    ["opsec-cyber-28","Does citing a publicly available Army publication make every derivative compilation safe to publish?","No. Public sources reduce source-classification risk, but context, aggregation, privacy, export, security, and public-release rules can still matter for a new compilation.","AR 530-1 / DoDI 5230.09","Derivative aggregation"],
    ["opsec-cyber-29","What does UCMJ Article 92 generally address?","Failure to obey a lawful general order or regulation, failure to obey another lawful order, and dereliction of duty, subject to the elements and facts of the case.","10 U.S.C. § 892 (UCMJ Art. 92)","Article 92"],
    ["opsec-cyber-30","Is every cybersecurity mistake automatically an Article 92 offense?","No. Criminal or disciplinary liability depends on the applicable duty/order, required mental state, facts, and legal elements. Report incidents and seek qualified legal guidance rather than assuming an outcome.","10 U.S.C. § 892 / MCM","Article 92 limits"],
    ["opsec-cyber-31","What does UCMJ Article 103a address?","Espionage. It is a serious offense with specific statutory elements; it should not be used as a generic label for ordinary information-handling mistakes.","10 U.S.C. § 903a (UCMJ Art. 103a)","Article 103a"],
    ["opsec-cyber-32","What is UCMJ Article 134?","The General Article addresses certain conduct prejudicial to good order and discipline, service-discrediting conduct, and specified offenses, subject to applicable elements and law.","10 U.S.C. § 934 (UCMJ Art. 134)","Article 134"],
    ["opsec-cyber-33","What should a Soldier do when unsure whether information is authorized for a personal device?","Do not move or paste it into the personal tool. Ask the responsible security, privacy, records, information-management, or supervisory authority using established channels.","AR 530-1 / AR 25-2 / DoDI 5200.48","When unsure"],
    ["opsec-cyber-34","What is the safest rule for synthetic OPSEC training data?","Use fictional unit names, fictional people, fictional grids, and non-operational dates so the exercise teaches the decision without reproducing a real mission or roster.","AR 530-1 / GUIDON content-control standard","Synthetic training data"]
  ];

  bank.board = bank.board || { questions: [] };
  bank.board.questions = Array.isArray(bank.board.questions) ? bank.board.questions : [];
  var qIds = new Set(bank.board.questions.map(function (q) { return q.id; }));
  cards.forEach(function (x) {
    if (qIds.has(x[0])) return;
    bank.board.questions.push({
      id: x[0], category: CATEGORY, q: x[1], a: x[2], boardAnswer: x[2], source: x[3],
      concept: x[4], keyPoints: [x[2]], difficulty: /29|30|31|32/.test(x[0]) ? "intermediate" : "basic",
      curriculum: ["Cybersecurity & OPSEC Specialist"]
    });
    qIds.add(x[0]);
  });

  var terms = [
    ["CUI","Controlled Unclassified Information — unclassified information requiring safeguarding or dissemination controls under an applicable authority."],
    ["OPSEC","Operations Security — a process for protecting critical information by identifying indicators, vulnerabilities, threats, and protective measures."],
    ["RMF","Risk Management Framework — DoD's structured cybersecurity risk-management and authorization process."],
    ["ATO","Authorization to Operate — a formal authorization decision accepting defined risk under stated conditions."],
    ["AO","Authorizing Official — the official responsible for accepting risk and making authorization decisions within assigned authority."],
    ["PII","Personally Identifiable Information — information usable to distinguish or trace an individual's identity, alone or with linked information."],
    ["CAC","Common Access Card — the DoD smart identity credential used for identification and logical/physical access functions."],
    ["SCIF","Sensitive Compartmented Information Facility — an accredited area for handling Sensitive Compartmented Information."],
    ["ISSM","Information System Security Manager — cybersecurity role responsible for information-system security management within assigned scope."],
    ["ISSO","Information System Security Officer — cybersecurity role supporting implementation and operation of system security controls."],
    ["ISSE","Information System Security Engineer — engineering role applying security principles to systems and architectures."],
    ["POA&M","Plan of Action and Milestones — a record used to track identified security weaknesses, planned corrective actions, milestones, and status."],
    ["STIG","Security Technical Implementation Guide — DISA security configuration guidance for technologies and systems."],
    ["DISA","Defense Information Systems Agency — DoD combat support agency providing enterprise information capabilities and cybersecurity services."],
    ["DLP","Data Loss Prevention — controls and processes intended to detect or prevent unauthorized disclosure or movement of protected data."],
    ["MFA","Multi-Factor Authentication — authentication using more than one category of factor."],
    ["PKI","Public Key Infrastructure — certificates, authorities, keys, and supporting processes used for trusted digital identity and cryptographic functions."],
    ["FOUO","For Official Use Only — a legacy dissemination marking; it is not itself a current CUI category."],
    ["CMMC","Cybersecurity Maturity Model Certification — DoD program for assessing specified cybersecurity requirements in the Defense Industrial Base."],
    ["DoDIN","Department of Defense Information Network — DoD information capabilities and associated processes for collecting, processing, storing, disseminating, and managing information."],
  ];
  bank.acronyms = bank.acronyms || { terms: [] };
  bank.acronyms.terms = Array.isArray(bank.acronyms.terms) ? bank.acronyms.terms : [];
  var termMap = new Map(bank.acronyms.terms.map(function (t) { return [String(t.a || "").toUpperCase(), t]; }));
  var termsAdded = 0, termsUpdated = 0;
  /* ADD a meaning, never replace one. This used to run `existing.d = x[1]`,
     so the Dictionary's "AO" lost "area of operations", "ATO" lost "air
     tasking order; antiterrorism officer" and "PII" lost its seed meaning -
     a Soldier looking up AO before a board saw only the cybersecurity sense.
     Every meaning the dictionary already had stays, in its original order,
     and the entry keeps its own source tag. */
  function mergeDefinition(had, incoming) {
    had = String(had || "");
    var head = incoming.split(" — ")[0].toLowerCase();
    if (!had) return incoming;
    var senses = had.split(";").map(function (s) { return s.trim().toLowerCase(); });
    if (had.toLowerCase().indexOf(incoming.toLowerCase()) !== -1) return had;                    /* already merged */
    if (senses.length === 1 && senses[0] === head) return incoming;                             /* same single meaning, fuller wording */
    if (senses.indexOf(head) !== -1) return had + " (" + incoming + ")";                        /* one of several meanings: keep them all, explain this one */
    return had + "; " + incoming;                                                               /* a new meaning: append it */
  }
  terms.forEach(function (x) {
    var key = x[0].toUpperCase(), existing = termMap.get(key);
    if (existing) { existing.d = mergeDefinition(existing.d, x[1]); termsUpdated++; }
    /* New entries belong to the dictionary's curated Army overlay, so they carry
       the overlay's own tag. The old value, "official", was one the Dictionary
       had never heard of: it fell through to the JOINT badge, which claimed
       terms such as CMMC and MFA came from the joint dictionary. */
    else { var t = { a: x[0], d: x[1], src: "army" }; bank.acronyms.terms.push(t); termMap.set(key, t); termsAdded++; }
  });

  var scenarioList = bank.scenarios && Array.isArray(bank.scenarios.scenarios) ? bank.scenarios.scenarios : null;
  if (scenarioList) {
    var have = new Set(scenarioList.map(function (s) { return s.id; }));
    function addScenario(sc) { if (!have.has(sc.id)) { scenarioList.push(sc); have.add(sc.id); } }
    function common(id, title, scene, doctrine, choices, outcomes) {
      var nodes = {
        n1: { prompt: scene, choices: [{ text: "Continue", goto: "n2" }] },
        n2: { prompt: "Choose the response that best protects the mission, information, and people.", choices: choices }
      };
      Object.keys(outcomes).forEach(function (k) { nodes[k] = { prompt: "", end: true, outcome: outcomes[k] }; });
      return { id:id, title:title, tier:["E4","E5","E6"], competency:["Character","Intellect","Leads"], estMinutes:3,
        difficulty:"Intermediate", doctrine:doctrine, defaultMode:"cyoa", renderModes:["text","course","cyoa"], scene:scene, start:"n1",
        curriculum:["Cybersecurity & OPSEC Specialist"], nodes:nodes };
    }
    addScenario(common("sc-opsec-social-engineering","Targeted Social Engineering","A personal social-media account receives a friendly-looking message from someone claiming to know your unit. They ask when your section is moving and where it will stage.",
      [{pub:"AR 530-1",edition:"2026-09",para:"OPSEC process and protection of critical information",quoteKind:"paraphrase"},{pub:"AR 25-2",edition:"2026-09",para:"Cybersecurity user responsibilities",quoteKind:"paraphrase"}],
      [
        {text:"Do not disclose the requested information; verify any legitimate need through a known channel and report the suspicious contact under local OPSEC/cyber procedures.",goto:"end-good",score:{Character:3,Intellect:3,Leads:2},feedback:"Treat unsolicited requests for operational information as a verification and reporting problem, not a social-media conversation."},
        {text:"Give only the movement date but not the location, because partial information is harmless.",goto:"end-partial",score:{Character:0,Intellect:0,Leads:0},feedback:"Partial facts can still be critical indicators or combine with other data."},
        {text:"Ask the sender to prove who they are by sending you more unit details in the same chat.",goto:"end-channel",score:{Character:1,Intellect:0,Leads:0},feedback:"Do not use the suspicious contact's own channel as the basis for verification."}
      ],{
        "end-good":"You protect the information, verify through trusted channels, and route the suspicious contact through the unit's reporting process without escalating the exchange.",
        "end-partial":"The date becomes an indicator an adversary can combine with other public data. Withholding only one half of the answer did not remove the OPSEC risk.",
        "end-channel":"The suspicious channel remains untrusted and the conversation reveals additional interest and context. Verification should move to a known, authorized path."
      }));
    addScenario(common("sc-cyber-removable-media","Unknown Removable Media","You find an unmarked USB drive near a government workstation. A teammate suggests plugging it in to identify the owner.",
      [{pub:"AR 25-2",edition:"2026-09",para:"Authorized devices/media and cybersecurity responsibilities",quoteKind:"paraphrase"}],
      [
        {text:"Do not connect it. Handle/report it under local cybersecurity or security procedures and use only authorized media on government systems.",goto:"end-good",score:{Character:3,Intellect:3,Leads:2},feedback:"Unknown removable media is not a troubleshooting shortcut."},
        {text:"Plug it into an unclassified government computer first because the system is not classified.",goto:"end-plug",score:{Character:0,Intellect:0,Leads:0},feedback:"Unclassified does not mean unrestricted or safe for unknown media."},
        {text:"Take it home and inspect it on a personal laptop so the government system is protected.",goto:"end-home",score:{Character:0,Intellect:1,Leads:0},feedback:"Moving suspicious media to a personal system can spread risk and bypass reporting/handling requirements."}
      ],{
        "end-good":"The media never touches a system. You preserve the security boundary and let the appropriate local process determine what happens next.",
        "end-plug":"The drive is now connected to a government endpoint before anyone established that it was authorized or safe.",
        "end-home":"The risk was moved, not resolved, and the local reporting/handling process was bypassed."
      }));
    addScenario(common("sc-opsec-fitness-tracking","Fitness Tracker Location Exposure","During a field exercise, you notice your fitness app is recording a precise route and automatically sharing activities with a public group.",
      [{pub:"AR 530-1",edition:"2026-09",para:"OPSEC indicators and protective measures",quoteKind:"paraphrase"}],
      [
        {text:"Stop public location sharing/recording as required by unit policy, avoid publishing the route, and notify the appropriate leader if sensitive activity may already have been exposed.",goto:"end-good",score:{Character:3,Intellect:3,Leads:2},feedback:"Treat location traces as potential operational indicators."},
        {text:"Leave it running but rename the activity so outsiders will not know it was military training.",goto:"end-name",score:{Character:0,Intellect:0,Leads:0},feedback:"Changing a label does not remove the route, timestamps, or pattern."},
        {text:"Wait until the exercise ends and delete the activity later.",goto:"end-late",score:{Character:1,Intellect:0,Leads:0},feedback:"Automatic sharing may expose the data while the event is still underway."}
      ],{
        "end-good":"You stop the source of exposure, avoid further publication, and use the unit's OPSEC process if already-shared data may matter.",
        "end-name":"The visible route and timing remain useful indicators even under a harmless-looking activity name.",
        "end-late":"The information may remain public throughout the sensitive period. A later deletion does not undo every prior view or copy."
      }));
    addScenario(common("sc-cui-spillage-reporting","Accidental CUI / PII Transmission","You realize a message you just sent through an unauthorized channel included information marked CUI and personal information.",
      [{pub:"DoDI 5200.48",edition:"2026-09",para:"CUI safeguarding and incident handling",quoteKind:"paraphrase"},{pub:"AR 25-2",edition:"2026-09",para:"Cybersecurity incident reporting",quoteKind:"paraphrase"}],
      [
        {text:"Stop further dissemination, do not forward it again, preserve the relevant facts, and promptly follow your organization's security/privacy/cyber incident-reporting procedures.",goto:"end-good",score:{Character:3,Intellect:3,Leads:2},feedback:"Contain first, then report through the organization's actual incident process."},
        {text:"Delete your copy and say nothing if the recipient promises to delete theirs.",goto:"end-hide",score:{Character:0,Intellect:0,Leads:0},feedback:"Private cleanup does not replace required incident reporting or assessment."},
        {text:"Forward the message to several leaders so everyone has the evidence.",goto:"end-spread",score:{Character:1,Intellect:0,Leads:0},feedback:"Do not multiply an exposure in the name of reporting; use the authorized reporting path."}
      ],{
        "end-good":"You avoid compounding the disclosure and give the responsible security/privacy/cyber personnel the facts they need to assess and respond under local procedures.",
        "end-hide":"The organization loses the opportunity to assess scope, required notifications, containment, and remediation.",
        "end-spread":"The reporting attempt creates additional unauthorized copies and increases the incident's scope."
      }));
  }

  function restampBoardHash() {
    var qs = bank.board && bank.board.questions;
    if (!Array.isArray(qs)) return;
    var h1 = 0x811c9dc5 >>> 0, h2 = 0x9e3779b9 >>> 0;
    function feed(s) { s=String(s==null?"":s); for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);h1^=c;h1=Math.imul(h1,0x01000193)>>>0;h2^=(c+i)&0xffff;h2=Math.imul(h2,0x85ebca6b)>>>0;} h1^=31;h1=Math.imul(h1,0x01000193)>>>0;h2^=127;h2=Math.imul(h2,0xc2b2ae35)>>>0; }
    qs.forEach(function(q){feed(q.id);feed(q.category);feed(q.q);feed(q.boardAnswer||q.a);});
    function hex(n){return("00000000"+(n>>>0).toString(16)).slice(-8);} bank.board.contentHash=hex(h1)+hex(h2);
  }
  restampBoardHash();

  return {
    CATEGORY: CATEGORY,
    cardIds: cards.map(function (x) { return x[0]; }),
    termsAdded: termsAdded,
    termsUpdated: termsUpdated,
  };
  });
})();
