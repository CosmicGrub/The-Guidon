/* GUIDON — Army-program board coverage gap closure (AER, ACS, SUDCC).
 * ROADMAP §3f Phase 0 named three under-covered programs. The seed already
 * carries aer-1..3, acs-1..3 and sudcc-1..3, so this pack only adds what
 * those nine cards do NOT ask - it must never restate one of them with a
 * different answer (an earlier version did: a second "ACS mission" card
 * quoting the superseded 2017 AR 608-1, and a second "what is SUDCC" card
 * beside a seed card that called SUDCC "under ASAP"). Those two twins were
 * folded into acs-1 and sudcc-1 in the seed, which keep their ids so study
 * history survives.
 *
 * Every card was checked against the Army Publishing Directorate PDF of the
 * CURRENT edition on 2026-09-19:
 *   AR 930-4, Army Emergency Relief ............ 15 Apr 2026 (supersedes 29 Nov 2024)
 *   AR 608-1, Soldier and Family Readiness ..... 26 May 2026 (retitled from "Army Community Service")
 *   AR 600-85, The Army Substance Abuse Program . 4 Oct 2024 (supersedes 23 Jul 2020)
 * The answers are study-guide wording, not quotations, so each card is
 * marked verbatim:false and the card back says so instead of claiming
 * "verbatim doctrine".
 */
(function () {
  "use strict";
  var seed = window.GUIDON_SEED;
  var list = seed && seed.board && Array.isArray(seed.board.questions) ? seed.board.questions : null;
  if (!list) return;

  var have = new Set(list.map(function (q) { return q && q.id; }));
  function add(q) {
    if (!q || have.has(q.id)) return;
    q.verbatim = false;
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
      "The current edition is dated and effective 15 April 2026; it superseded the 29 November 2024 edition.",
      "AER assistance supports eligible Soldiers and eligible Family members; exact eligibility and assistance categories are controlled by the regulation and current AER policy."
    ],
    source:"AR 930-4 (15 Apr 2026), Army Emergency Relief",
    difficulty:"basic",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["aer","army-emergency-relief","army-programs","financial-readiness"]
  });

  add({
    id:"prog-aer-2",
    category:"AER (AR 930-4)",
    q:"Under the current AR 930-4, which unit leaders are specifically charged with ensuring Soldiers are informed about AER programs and benefits?",
    a:"Company, battery, and troop commanders and first sergeants.",
    acceptableAnswer:"Company, battery, and troop commanders and first sergeants.",
    boardAnswer:"Sergeant Major, AR 930-4 charges company, battery, and troop commanders and first sergeants with ensuring Soldiers are informed year-round of how to obtain AER assistance and have current information on AER categories of assistance and programs.",
    concept:"Leader responsibility to inform Soldiers about AER",
    keyPoints:[
      "AR 930-4 (15 Apr 2026), para 1-18, lists the AER duties of company, battery, and troop commanders and first sergeants.",
      "Para 1-18g: ensure Soldiers are informed on a year-round basis of how to obtain assistance and have updated information on AER categories of assistance and programs, including education assistance.",
      "The same paragraph also has them make sure all unit officers and NCOs are familiar with AER assistance (para 1-18c)."
    ],
    source:"AR 930-4 (15 Apr 2026), para 1-18g",
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
    boardAnswer:"Sergeant Major, Army Community Service and Soldier and Family Readiness services are governed by AR 608-1, Soldier and Family Readiness.",
    concept:"Army Community Service governing regulation",
    keyPoints:[
      "AR 608-1 is the governing Army regulation.",
      "The 26 May 2026 edition changed the publication's title from Army Community Service to Soldier and Family Readiness.",
      "Under it, an ACS center is one kind of Soldier and Family Readiness access point, alongside the Family Assistance Center and the Army Reserve Family Programs Office."
    ],
    source:"AR 608-1 (26 May 2026), Soldier and Family Readiness",
    difficulty:"basic",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["acs","army-community-service","soldier-family-readiness","army-programs"]
  });

  add({
    id:"prog-sudcc-2",
    category:"SUDCC (AR 600-85)",
    q:"How does SUDCC relate to the Army Substance Abuse Program (ASAP)?",
    a:"AR 600-85 says SUDCC is not a part of ASAP. It is the clinical-care function, integrated with the Behavioral Health System of Care, and it supports the Army's strategy to prevent substance abuse by providing treatment services when clinically indicated.",
    acceptableAnswer:"SUDCC is the clinical treatment function integrated with behavioral health; it supports the Army's substance abuse strategy but is not a part of ASAP itself.",
    boardAnswer:"Sergeant Major, AR 600-85 states that SUDCC is not a part of ASAP. SUDCC is integrated with the Behavioral Health System of Care and supports the Army's strategy to prevent substance abuse by providing treatment services when clinically indicated.",
    concept:"SUDCC and ASAP relationship",
    keyPoints:[
      "ASAP's overarching tenets are deterrence, prevention, and treatment (AR 600-85, para 1-7c).",
      "The same paragraph says that, while not a part of ASAP, SUDCC supports the Army's strategy and provides treatment services when clinically indicated.",
      "Substance use disorder treatment is a single program integrated with the Behavioral Health System of Care (para 1-7d).",
      "Avoid the outdated shorthand that all substance-use clinical treatment is simply 'ASAP rehab.'"
    ],
    source:"AR 600-85 (4 Oct 2024), para 1-7",
    difficulty:"intermediate",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["sudcc","asap","behavioral-health","army-programs"]
  });

  window.G = window.G || {};
  window.G.armyProgramGapCards = {
    ids:["prog-aer-1","prog-aer-2","prog-acs-1","prog-sudcc-2"],
    /* prog-acs-2 and prog-sudcc-1 were near-duplicates of seed cards acs-1 and
       sudcc-1; their verified wording now lives on those older ids. */
    foldedIntoSeed:{ "prog-acs-2":"acs-1", "prog-sudcc-1":"sudcc-1" },
    verifiedAsOf:"2026-09-19"
  };
})();
