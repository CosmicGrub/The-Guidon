/* GUIDON — roadmap cohesion + board-simulator scenarios.
 * Additive seed module. Uses the existing scenario schema and only broad,
 * honest references; exact local board procedure remains an MOI/SOP matter.
 */
(function () {
  "use strict";
  var seed = window.GUIDON_SEED;
  var list = seed && seed.scenarios && Array.isArray(seed.scenarios.scenarios) ? seed.scenarios.scenarios : null;
  if (!list) return;
  var have = new Set(list.map(function (s) { return s.id; }));
  function add(sc) { if (!have.has(sc.id)) { list.push(sc); have.add(sc.id); } }

  add({
    id:"sc-collective-decision-relay",
    title:"Collective Decision Relay",
    summary:"Three cross-subject decisions built specifically for GUIDON's collective discussion gate.",
    tier:["E4","E5","E6"],
    competency:["Leads","Intellect","Achieves"],
    estMinutes:10,
    difficulty:"Intermediate",
    doctrine:[
      { ref:"ADP 6-0", para:"Mission command principles and disciplined initiative", asOf:"current library copy" },
      { ref:"ADP 6-22", para:"Leadership and team development", asOf:"current library copy" }
    ],
    defaultMode:"course",
    renderModes:["course","text","cyoa"],
    scene:"TEAM TRAINING — CROSS-SUBJECT RELAY",
    start:"d1",
    pillar:"Leadership & Counseling",
    nodes:{
      d1:{
        beat:"DECISION 1 — COMMS",
        prompt:"Your team loses primary communications during a time-sensitive task. The published plan includes alternates, but the first alternate does not answer. What should the team commit to?",
        discuss:true, discussionSeconds:45,
        choices:[
          { text:"Work the next authorized PACE option, keep the team aligned on the commander's intent, and report once contact is restored.", goto:"d1a", score:{Leads:2,Intellect:2,Achieves:2}, feedback:"A disciplined pivot preserves the plan's intent without freezing on one failed method." },
          { text:"Stop all action until the primary net returns, regardless of the task's time sensitivity.", goto:"d1b", score:{Leads:0,Intellect:0,Achieves:0}, feedback:"A failed primary method is not automatically a reason to abandon every planned alternate." },
          { text:"Abandon the communications plan and improvise an uncoordinated method without checking authorities or risk.", goto:"d1b", score:{Leads:0,Intellect:0,Achieves:0}, feedback:"Adaptation still needs disciplined boundaries and shared understanding." }
        ]
      },
      d1a:{ prompt:"The team uses the next planned option, continues the mission within intent, and restores reporting.", next:"d2" },
      d1b:{ prompt:"The team either freezes or improvises without a shared plan. Re-center on intent, authorized alternatives, and communication discipline.", next:"d2" },
      d2:{
        beat:"DECISION 2 — MAINTENANCE",
        prompt:"A vehicle needed for the next movement has a newly discovered fault. Schedule pressure is building. What should the team decide before anyone starts solving around the standard?",
        discuss:true, discussionSeconds:45,
        choices:[
          { text:"Verify the applicable technical standard and fault status first, then coordinate the fastest authorized way to restore capability or replace the asset.", goto:"d2a", score:{Character:2,Intellect:2,Achieves:2}, feedback:"Standards establish the boundary; lateral problem-solving happens inside that boundary." },
          { text:"Operate it because the mission is important and address the fault after movement.", goto:"d2b", score:{Character:0,Intellect:0,Achieves:0}, feedback:"Mission pressure is not evidence that a maintenance or safety standard can be ignored." },
          { text:"Declare the whole mission impossible as soon as the fault appears, without checking alternatives.", goto:"d2b", score:{Leads:0,Intellect:0,Achieves:0}, feedback:"Rigid compliance without searching for authorized alternatives can be as weak as reckless improvisation." }
        ]
      },
      d2a:{ prompt:"The team confirms the standard, protects safety/accountability, and works an authorized alternate.", next:"d3" },
      d2b:{ prompt:"The team either accepted avoidable risk or stopped thinking after finding the constraint. Reset around the standard and the mission requirement.", next:"d3" },
      d3:{
        beat:"DECISION 3 — RANGE",
        prompt:"Just before a live-fire iteration, a safety condition no longer matches the approved setup. What does the team commit to?",
        discuss:true, discussionSeconds:45,
        choices:[
          { text:"Pause the iteration, make the condition safe, notify the responsible range leadership, and resume only after the approved condition is restored.", goto:"good", score:{Character:3,Leads:2,Achieves:2}, feedback:"Protect the force first, then restore training through the responsible range chain." },
          { text:"Continue because the schedule is tight and fix the condition after the relay.", goto:"bad", score:{Character:0,Leads:0,Achieves:0}, feedback:"Schedule pressure does not erase a live-fire safety condition." },
          { text:"Let the newest Soldier decide whether the condition is serious enough to stop training.", goto:"bad", score:{Character:0,Leads:0,Achieves:0}, feedback:"Leaders cannot outsource responsibility for a known safety concern." }
        ]
      },
      good:{ end:true, outcome:"The team showed the pattern this relay is built to reinforce: know the standard, understand the purpose, discuss the tradeoff, commit clearly, and adapt inside legitimate boundaries." },
      bad:{ end:true, outcome:"The last decision traded safety or responsibility for schedule pressure. In the AAR, identify the standard that should have bounded the decision and the authorized alternatives the team still had." }
    }
  });

  add({
    id:"sc-board-simulator-reporting",
    title:"Promotion Board Reporting Procedure — Decision Rehearsal",
    summary:"An MOI-aware procedural rehearsal that avoids inventing one universal reporting script.",
    tier:["E4","E5","E6"],
    competency:["Presence","Intellect","Leads"],
    estMinutes:5,
    difficulty:"Board Prep",
    doctrine:[{ ref:"Unit board MOI / sponsor instructions", para:"Local reporting and board procedures", asOf:"current board cycle" }],
    defaultMode:"course",
    renderModes:["course","text"],
    scene:"PROMOTION BOARD — REPORTING PHASE",
    start:"b1",
    pillar:"Drill & Board Etiquette",
    nodes:{
      b1:{
        beat:"BEFORE THE DOOR",
        prompt:"You are about to report to a promotion board. You remember several reporting scripts from different units. What is the strongest preparation move?",
        choices:[
          { text:"Use the current board MOI, sponsor/cadre guidance, and rehearsed local procedure rather than assuming one internet script applies everywhere.", goto:"b2", score:{Intellect:3,Presence:2}, feedback:"Local board instructions control details that are not universal Army doctrine." },
          { text:"Use whichever script you memorized first, even if the current MOI says something different.", goto:"bad", score:{Intellect:0,Presence:0}, feedback:"A familiar script is not stronger than the current instructions for this board." },
          { text:"Skip procedural rehearsal and rely on improvisation so you sound natural.", goto:"bad", score:{Presence:0,Intellect:0}, feedback:"Professional bearing is easier when procedure is rehearsed and uncertainty is resolved before the board." }
        ]
      },
      b2:{
        beat:"ENTRY AND REPORTING",
        prompt:"You are directed to enter. What principle should drive the next actions?",
        choices:[
          { text:"Follow the board's directions exactly, maintain military bearing, and use the reporting sequence you verified for this board.", goto:"b3", score:{Presence:3,Leads:1}, feedback:"The goal is disciplined execution of the procedure actually prescribed for this board." },
          { text:"Add extra movements and ceremonial steps to look more confident.", goto:"bad", score:{Presence:0,Intellect:0}, feedback:"Unrequested flourishes create opportunities for error; execute the verified procedure cleanly." },
          { text:"Rush through the report so questioning can start sooner.", goto:"bad", score:{Presence:0,Leads:0}, feedback:"Speed is not bearing. Deliberate, correct execution communicates composure." }
        ]
      },
      b3:{
        beat:"FIRST QUESTION",
        prompt:"The president gives the first question and you do not immediately know the answer. What is the best board-practice response?",
        choices:[
          { text:"Pause briefly, answer what you know accurately, and if you do not know, say so professionally rather than inventing an answer.", goto:"good", score:{Character:3,Presence:2,Intellect:2}, feedback:"Credibility matters more than bluffing. A board can evaluate bearing and judgment even when recall is imperfect." },
          { text:"Fill the silence with a confident-sounding answer even if you are unsure.", goto:"bad", score:{Character:0,Presence:0,Intellect:0}, feedback:"Confident fabrication is worse than an honest knowledge gap." },
          { text:"Argue that the question was unclear before attempting any answer.", goto:"bad", score:{Presence:0,Leads:0}, feedback:"Seek clarification when genuinely needed, but do not use it to avoid a question you simply do not know." }
        ]
      },
      good:{ end:true, outcome:"Reporting rehearsal complete. Carry the verified local procedure into the live Mock Board knowledge round, then finish with a judgment scenario and AAR." },
      bad:{ end:true, outcome:"Reset the reporting phase around three anchors: current local instructions, deliberate military bearing, and honest answers. Rehearse again before treating the script as memorized." }
    }
  });
})();