/* GUIDON — Blended Retirement System continuation pay board cards.
 *
 * The seed's BRS doctrine entry, the Money tab and the Junior Soldier lesson
 * all carry the Army's continuation pay window, but until this pack there was
 * no board card behind any of them (standing rule: every sourced fact ships
 * with matching board-drill flashcards).
 *
 * Every fact below was read on 2026-09-25 from:
 *   ALARACT 100/2025, "Army Continuation Pay (CP) Within the Blended
 *     Retirement System (BRS) - Calendar Year 2026 (CY26) Implementation
 *     Guidance", DTG R 071630Z NOV 25 (armypubs.army.mil, ARN45300):
 *       para 3   effective 1 January 2026
 *       para 4.A.2  CY26: no less than seven and not more than 12 years of
 *                   service, computed from the Pay Entry Base Date (PEBD)
 *       para 4.A.3  CY27: no less than seven and not more than 10 years
 *       para 5   four years of service in the component the Soldier is in
 *       para 6   2.5 x monthly basic pay (RA/AGR); 0.5 x (USAR/ARNG, not AGR),
 *                or 2.5 x with 270+ days of involuntary mobilization in a
 *                730-day period (excluding 12301(h) status)
 *       para 7.a lump sum or up to four equal annual installments
 *       para 10.b future-year changes to the end year of eligibility
 *   37 USC 356(a) (uscode.house.gov / law.cornell.edu): "not less than 7 and
 *     not more than 12 years of service"; "not less than 3 additional years
 *     of obligated service"; the 8-to-7 change is Pub. L. 118-31, sec. 611(a)
 *     (22 Dec 2023).
 * The Army's EARLIER window (8 to 12 years, calendar year 2025) is not in
 * ALARACT 100/2025 - that message covers CY26 and CY27 only. It was read on
 * 2026-09-26 from the Army's previous guidance:
 *   ASA(M&RA) memorandum, "Blended Retirement System (BRS) Continuation Pay
 *     (CP) - Calendar Years 2024/2025 (CY24/CY25) Implementation Guidance",
 *     SAMR (637-1), as hosted on kansastag.gov (DocumentCenter/View/2677; the
 *     copy shows no date line):
 *       para 3   effective immediately, expires 31 December 2025
 *       para 4.a(2)  "no less than eight and not more than 12 years of
 *                   service", computed from the PEBD
 * NOT read: the 31 December 2024 S1Net special message (CY25-27) and
 * ALARACT 029/2025 (the CY25 message) - the only copies found sit behind a
 * bot check on a state National Guard site, so no fact here rests on them.
 * The answers are study-guide wording, not quotations, so each card is
 * marked verbatim:false.
 */
(function () {
  "use strict";
  G.contentPack.define("brs-continuation-pay-board", function (bank) {
  var list = bank && bank.board && Array.isArray(bank.board.questions) ? bank.board.questions : null;
  if (!list) return;

  var have = new Set(list.map(function (q) { return q && q.id; }));
  function add(q) {
    if (!q || have.has(q.id)) return;
    q.verbatim = false;
    list.push(q);
    have.add(q.id);
  }

  add({
    id:"brs-cp-1",
    category:"Financial Readiness",
    q:"In the Army, what years-of-service window applies to Blended Retirement System continuation pay in calendar year 2026?",
    a:"A Soldier covered by the BRS must have completed no less than 7 and no more than 12 years of service, counted from the Pay Entry Base Date (PEBD). The window opens a year earlier than the 8-to-12-year window the Army used in 2025.",
    acceptableAnswer:"7 to 12 years of service from the PEBD in 2026, a year earlier than the old 8 to 12.",
    boardAnswer:"Sergeant Major, for calendar year 2026 the Army's guidance in ALARACT 100/2025, effective 1 January 2026, says a Soldier covered by the Blended Retirement System must have completed no less than seven and no more than 12 years of service, computed from the Pay Entry Base Date. That is a year earlier than the 8-to-12-year window the Army used in 2025.",
    concept:"Army BRS continuation pay window, calendar year 2026",
    keyPoints:[
      "ALARACT 100/2025 (7 Nov 2025) para 3: the guidance is effective 1 January 2026; para 4.A.2 sets the 2026 window at no less than 7 and no more than 12 years of service from the PEBD.",
      "The Army's 2025 window was 8 to 12 years (the Army's CY24/CY25 continuation pay memorandum, para 4.a(2); that guidance expired 31 December 2025), so 1 January 2026 is when it opened a year earlier.",
      "The current text of 37 USC 356(a)(1) reads 'not less than 7 and not more than 12 years of service' (changed from 8 by Pub. L. 118-31, sec. 611(a), December 2023). The Army's guidance sets its own window each calendar year: 7 to 12 in 2026, 7 to 10 in 2027.",
      "Years of service are computed from the Soldier's Pay Entry Base Date (PEBD), per para 4.A.2."
    ],
    source:"ALARACT 100/2025, paras 3 and 4.A.2; 37 USC 356(a)(1); ASA(M&RA) memorandum, BRS Continuation Pay CY24/CY25 Implementation Guidance (SAMR 637-1), paras 3 and 4.a(2) (the 2025 window)",
    difficulty:"intermediate",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["brs","continuation-pay","financial-readiness","army-programs"]
  });

  add({
    id:"brs-cp-2",
    category:"Financial Readiness",
    q:"How does the Army's continuation pay window change in calendar year 2027, and what should a Soldier do about it?",
    a:"For calendar year 2027 the Army's guidance says a Soldier must have completed no less than 7 and no more than 10 years of service (from the PEBD), so the upper limit drops from 12 to 10. Soldiers are told to apply as soon as they become eligible, because future-year changes to the end of the window can cost them the entitlement.",
    acceptableAnswer:"The window becomes 7 to 10 years in 2027, so apply as soon as you are eligible and confirm the current window with S-1.",
    boardAnswer:"Sergeant Major, ALARACT 100/2025 sets the calendar year 2027 window at no less than seven and not more than 10 years of service from the PEBD, so the top of the window drops from 12 to 10. The same message tells Soldiers to apply as soon as they enter their period of eligibility, because future-year changes to the end year of eligibility can forfeit the entitlement. Because that message is the 2026 guidance, I would confirm the current-year window with S-1 or the career counselor.",
    concept:"Army BRS continuation pay window, calendar year 2027",
    keyPoints:[
      "ALARACT 100/2025 para 4.A.3: for CY27 the Soldier has completed no less than 7 and not more than 10 years of service, computed from the PEBD.",
      "Para 4.A.4: for CY28 and beyond the Army says it will analyze the eligibility window and multiplier further, so nothing is published past 2027.",
      "Para 10.a: Soldiers are encouraged to apply as soon as they enter their period of eligibility; para 10.b warns that future-year changes to the end year of eligibility can cost a Soldier the entitlement.",
      "The message is written as calendar year 2026 implementation guidance, so the current-year window is worth confirming with S-1 or a career counselor before acting."
    ],
    source:"ALARACT 100/2025, paras 4.A.3, 4.A.4 and 10",
    difficulty:"intermediate",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["brs","continuation-pay","financial-readiness","army-programs"]
  });

  add({
    id:"brs-cp-3",
    category:"Financial Readiness",
    q:"What does a Soldier agree to in exchange for Army continuation pay, and how much is it for a Regular Army Soldier?",
    a:"The Soldier agrees to serve four years in the component they are serving in when they request it. For Regular Army and Active Guard Reserve Soldiers the amount is 2.5 times the active-duty monthly basic pay, paid as a lump sum or in up to four equal annual installments.",
    acceptableAnswer:"Four more years of service; 2.5 times monthly basic pay for Regular Army and AGR Soldiers.",
    boardAnswer:"Sergeant Major, under ALARACT 100/2025 a Soldier must agree to serve four years of service in the component they are serving in when continuation pay is requested. For Regular Army and Active Guard Reserve Soldiers the amount is 2.5 times the active-duty monthly basic pay, computed from the Soldier's pay grade and years of service on the date they sign the election form. The Soldier may take it as a lump sum or in up to four equal annual installments.",
    concept:"Army BRS continuation pay obligation and amount",
    keyPoints:[
      "ALARACT 100/2025 para 5: four years of service in the component the Soldier is in when continuation pay is requested; the obligation starts on the date the Soldier signs the election form.",
      "Federal law sets only a floor: 37 USC 356(a)(2) requires 'not less than 3 additional years of obligated service'. The Army requires four.",
      "Para 6: 2.5 times monthly basic pay for RA and AGR Soldiers; 0.5 times for USAR and ARNG Soldiers not in an AGR status, or 2.5 times if they performed 270 or more days of involuntary mobilization in a 730-day period (excluding 12301(h) status).",
      "Para 7.a: a single lump sum or equal installments over up to four consecutive years; a Soldier who wants payments sent to the TSP must set that up in myPay before submitting the request (para 7.b)."
    ],
    source:"ALARACT 100/2025, paras 5, 6 and 7; 37 USC 356(a)(2)",
    difficulty:"intermediate",
    pillar:"Programs & Support",
    tier:["E4","E5","E6"],
    tags:["brs","continuation-pay","financial-readiness","army-programs"]
  });

  return {
    brsContinuationPayCards: {
      ids:["brs-cp-1","brs-cp-2","brs-cp-3"],
      verifiedAsOf:"2026-09-25"
    }
  };
  });
})();
