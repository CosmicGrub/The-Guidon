/* GUIDON — Army-program board coverage gap closure.
 * ROADMAP §3f Phase 0 identified exactly three under-covered programs:
 * AER, ACS, and SUDCC. These additive cards use current Army sources
 * verified 2026-09-18 and the category names already reserved in
 * tools/pillar-map.mjs. No new engine or taxonomy is introduced.
 */
(function () {
  "use strict";
  var seed = window.GUIDON_SEED;
  var list = seed && seed.board && Array.isArray(seed.board.questions) ? seed.board.questions : null;
  if (!list) return;

  var have = new Set(list.map(function (q) { return q && q.id; }));
  function add(q) {
    if (!q || have.has(q.id)) return;
    list.push(q);
    have.add(q.id);
  }

  add({
    id:"prog-aer-1",
    category:"AER (AR 930-4)",
    q:"What regulation governs Army Emergency Relief, and what is AER's basic purpose?",
    a:"AR 930-4 governs Army Emergency Relief. AER provides financial assistance to eligible Soldiers and eligible Family members for authorized emergency and other qualifying needs.",
    acceptableAnswer:"AR 930-4; AER provides financial assistance to eligible Soldiers and Family members.",
    boardAnswer:"Sergeant Major, Army Emergency Relief is governed by AR 930-4. AER exists to provide financial assistance to eligible Soldiers and eligible Family members for authorized emergency and other qualifying needs.",
    concept:"Army Emergency Relief purpose and governing regulation",
    keyPoints:[
      "AR 930-4 is the governing Army regulation for Army Emergency Relief.",
      "The current regulation is dated 29 November 2024 and became effective 29 December 2024.",
      "AER assistance supports eligible Soldiers and eligible Family members; exact eligibility and assistance categories are controlled by the regulation and current AER policy."
    ],
    source:"AR 930-4 (29 Nov 2024), Army Emergency Relief",
    difficulty:"basic",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["aer","army-emergency-relief","army-programs","financial-readiness"]
  });

  add({
    id:"prog-aer-2",
    category:"AER (AR 930-4)",
    q:"Under the current AR 930-4, which unit leaders are specifically charged with ensuring Soldiers are informed about AER programs and benefits?",
    a:"Company or battery commanders and first sergeants.",
    acceptableAnswer:"Company/battery commanders and first sergeants.",
    boardAnswer:"Sergeant Major, AR 930-4 specifically requires company or battery commanders and first sergeants to ensure Soldiers are informed about Army Emergency Relief programs and benefits.",
    concept:"Leader responsibility to inform Soldiers about AER",
    keyPoints:[
      "The 29 November 2024 revision added this leader responsibility.",
      "Company/battery commanders and first sergeants are the specifically named leaders.",
      "The requirement is to ensure Soldiers are informed about AER programs and benefits."
    ],
    source:"AR 930-4 (29 Nov 2024), para 1-18i / Summary of Change",
    difficulty:"intermediate",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["aer","army-emergency-relief","leadership","army-programs"]
  });

  add({
    id:"prog-acs-1",
    category:"ACS (AR 608-1)",
    q:"What regulation governs Army Community Service and Soldier and Family Readiness services?",
    a:"AR 608-1, Soldier and Family Readiness.",
    acceptableAnswer:"AR 608-1.",
    boardAnswer:"Sergeant Major, Army Community Service and Soldier and Family Readiness services are governed by AR 608-1.",
    concept:"Army Community Service governing regulation",
    keyPoints:[
      "AR 608-1 is the governing Army regulation.",
      "Current Army benefits references identify the publication as Soldier and Family Readiness.",
      "ACS delivers standardized Soldier and Family support services across the Army."
    ],
    source:"AR 608-1, Soldier and Family Readiness (current Army publication; reviewed 18 Sep 2026)",
    difficulty:"basic",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["acs","army-community-service","soldier-family-readiness","army-programs"]
  });

  add({
    id:"prog-acs-2",
    category:"ACS (AR 608-1)",
    q:"What is the mission of Army Community Service?",
    a:"To facilitate the commander's ability to provide comprehensive, standardized, coordinated, and responsive services supporting Soldiers, DA Civilians, and Families regardless of geographic location, while using resources effectively and measuring service effectiveness.",
    acceptableAnswer:"ACS helps commanders provide comprehensive, standardized, coordinated, responsive support to Soldiers, DA Civilians, and Families regardless of location.",
    boardAnswer:"Sergeant Major, ACS facilitates the commander's ability to provide comprehensive, standardized, coordinated, and responsive services that support Soldiers, DA Civilians, and Families regardless of geographic location.",
    concept:"Army Community Service mission",
    keyPoints:[
      "ACS is a commander-support and quality-of-life system, not just a single counseling office.",
      "The mission emphasizes comprehensive, standardized, coordinated, and responsive services.",
      "Support is intended to reach Soldiers, DA Civilians, and Families regardless of geographic location."
    ],
    source:"AR 608-1, para 1-6, Army Community Service mission",
    difficulty:"intermediate",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["acs","army-community-service","soldier-family-readiness","army-programs"]
  });

  add({
    id:"prog-sudcc-1",
    category:"SUDCC (AR 600-85)",
    q:"What is Substance Use Disorder Clinical Care (SUDCC)?",
    a:"SUDCC is the Army's integrated clinical model for substance-use-disorder care, providing assessment, treatment, and aftercare within the behavioral health system to support health, recovery, and readiness.",
    acceptableAnswer:"The Army's integrated behavioral-health clinical care for substance use disorders, including assessment, treatment, and aftercare.",
    boardAnswer:"Sergeant Major, SUDCC is the Army's integrated clinical model for substance-use-disorder care. It provides assessment, treatment, and aftercare within the behavioral health system to support recovery and readiness.",
    concept:"SUDCC purpose",
    keyPoints:[
      "SUDCC means Substance Use Disorder Clinical Care.",
      "It provides clinical assessment, treatment, and aftercare.",
      "The model is integrated with the Army behavioral health system and is designed to support recovery and readiness."
    ],
    source:"AR 600-85 (23 Jul 2020), The Army Substance Abuse Program; Army Resilience Directorate, Substance Use Disorder Clinical Care (reviewed 18 Sep 2026)",
    difficulty:"basic",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["sudcc","asap","behavioral-health","army-programs"]
  });

  add({
    id:"prog-sudcc-2",
    category:"SUDCC (AR 600-85)",
    q:"How does SUDCC relate to the Army Substance Abuse Program (ASAP)?",
    a:"AR 600-85 distinguishes SUDCC as the clinical-care function integrated within the Behavioral Health System of Care. SUDCC is not itself part of the nonclinical ASAP structure, but it supports the Army's substance-abuse strategy by providing treatment when clinically indicated.",
    acceptableAnswer:"SUDCC is the clinical treatment function integrated with behavioral health; it supports ASAP's overall strategy but is not the nonclinical ASAP program itself.",
    boardAnswer:"Sergeant Major, AR 600-85 separates the clinical-care function from the nonclinical ASAP structure. SUDCC is integrated with the Behavioral Health System of Care and supports the Army's substance-abuse strategy by providing treatment when clinically indicated.",
    concept:"SUDCC and ASAP relationship",
    keyPoints:[
      "AR 600-85 separates deterrence/prevention functions from the clinical treatment function.",
      "SUDCC is integrated within the Behavioral Health System of Care.",
      "Avoid the outdated shorthand that all substance-use clinical treatment is simply 'ASAP rehab.'"
    ],
    source:"AR 600-85 (23 Jul 2020), paras 1-1 and 1-7; Army Resilience Directorate SUDCC (reviewed 18 Sep 2026)",
    difficulty:"intermediate",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["sudcc","asap","behavioral-health","army-programs"]
  });

  window.G = window.G || {};
  window.G.armyProgramGapCards = {
    ids:["prog-aer-1","prog-aer-2","prog-acs-1","prog-acs-2","prog-sudcc-1","prog-sudcc-2"],
    verifiedAsOf:"2026-09-18"
  };
})();