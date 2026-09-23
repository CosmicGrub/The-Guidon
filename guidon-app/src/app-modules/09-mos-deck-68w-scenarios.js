/* GUIDON - 68W MOS deck: scenario-engine expansion.
   Mirrors 04-board-supplement-92a-scenarios.js's own shape and reasoning
   (a sibling pack, not a dependent of it - this file declares no
   "requires" and reads nothing from 92A's own scenario pack). Standing
   content-pipeline rule: sourced content ships WITH matching board-drill
   flashcards, never scenarios alone - the flashcards live in
   08-mos-deck-68w-content.js, which loads immediately before this file.

   Both scenarios below deliberately test something the app's EXISTING
   general TCCC/MEDEVAC scenarios (sc-tccc-ied-strike: the MARCH sequence
   under fire; sc-medevac-9line-callin: building a single 9-line request)
   do not: triage AUTHORITY across multiple simultaneous casualties, and
   the CLS-vs-Combat-Medic scope-of-practice line a 68W has to enforce in
   the field. See 08-mos-deck-68w-content.js's own header for the full
   overlap check against the app's pre-existing medical content. */
(function () {
  "use strict";
  G.contentPack.define("mos-deck-68w-scenarios", function (bank) {
  var list = bank && bank.scenarios && Array.isArray(bank.scenarios.scenarios) ? bank.scenarios.scenarios : null;
  if (!list) return;
  var have = new Set(list.map(function (s) { return s.id; }));

  function add(sc) {
    if (!have.has(sc.id)) { list.push(sc); have.add(sc.id); }
  }

  add({
    id: "sc-68w-mascal-triage",
    title: "Five Casualties, One Medic: MASCAL Triage",
    tier: ["E3", "E4", "E5", "E6"],
    competency: ["Achieves", "Character", "Intellect"],
    estMinutes: 4,
    difficulty: "Intermediate",
    doctrine: [
      { pub: "STP 21-1-SMCT", para: "Task 081-000-0055, Perform Casualty Triage", edition: "", quoteKind: "paraphrase" },
      { pub: "ATP 4-02.2", para: "Casualty collection and evacuation precedence", edition: "2019-07", quoteKind: "paraphrase" },
    ],
    defaultMode: "cyoa",
    renderModes: ["text", "course", "cyoa"],
    scene: "An IED strikes a resupply convoy - five casualties are down at the Casualty Collection Point you are running alone, with more help still minutes out",
    start: "n1",
    mos: ["68W"],
    curriculum: ["68W Health Care Specialist"],
    nodes: {
      n1: { prompt: "Five casualties are at your CCP: one is unresponsive with no radial pulse, one has a self-applied tourniquet and is talking, one has a minor laceration and is walking around helping others, one is unresponsive with agonal breathing and massive head trauma, and one has a painful but stable-looking ankle injury. You have limited tourniquets, one evacuation slot inbound, and no additional medic support for several minutes. What do you do first?", choices: [{ text: "Continue", goto: "n2" }] },
      n2: { prompt: "Choose the response that best applies triage doctrine to this many casualties at once.", choices: [
        { text: "Do a rapid sweep of all five casualties first, sorting each into Immediate/Delayed/Minimal/Expectant before committing to detailed treatment on any one of them, then work the Immediate casualties in order.", goto: "end-good", score: { Achieves: 3, Character: 2, Intellect: 3 }, feedback: "Correct. Triage exists to sort BEFORE you commit resources - a fast primary sweep across all five tells you who needs the one evacuation slot and your limited tourniquets first, instead of finding out by accident." },
        { text: "Go straight to the first casualty you reached and provide full treatment before checking on anyone else.", goto: "end-first", score: { Achieves: 0, Character: 0, Intellect: -1 }, feedback: "Treating the first casualty found, rather than the most salvageable one first, can cost the evacuation slot and your limited supplies on the wrong casualty while an Immediate-category casualty goes unaddressed." },
        { text: "Spend your limited time and tourniquet on the casualty with the most severe, least survivable injuries, since they need help the most.", goto: "end-expectant", score: { Achieves: -1, Character: 1, Intellect: -1 }, feedback: "Triage doctrine reserves \"Expectant\" for exactly this situation - when treating the most critically injured casualty would consume resources that could otherwise save more lives and limbs. Compassion has to follow the sort, not replace it." },
        { text: "Call in all five as Urgent on the 9-line so the evacuation crew sorts it out on arrival.", goto: "end-punt", score: { Achieves: -1, Character: 0, Intellect: -1 }, feedback: "Reporting every casualty as the same, highest precedence does not actually prioritize anyone and can cost the platform planning time; triage is the medic's own job at the CCP, not something to hand off unsorted." },
      ] },
      "end-good": { prompt: "", end: true, outcome: "The primary sweep finds the tourniqueted-and-talking casualty is Immediate (uncontrolled risk of re-bleed), the unresponsive-no-pulse casualty is also Immediate, the agonal-breathing head-trauma casualty is Expectant given your resources, the laceration casualty is Minimal, and the ankle injury is Delayed. The single evacuation slot and your attention go where they save the most life and limb - a decision you could only make because you sorted first." },
      "end-first": { prompt: "", end: true, outcome: "Minutes later you realize the casualty you spent your attention on was the least urgent of the five - a genuinely critical casualty nearby went unaddressed the whole time, and the one evacuation slot is now needed for someone you have not even assessed yet." },
      "end-expectant": { prompt: "", end: true, outcome: "The prolonged effort on the least-salvageable casualty consumes the tourniquet and time you needed for the two Immediate casualties, who deteriorate while you are occupied. Expectant exists to prevent exactly this trade." },
      "end-punt": { prompt: "", end: true, outcome: "The evacuation crew arrives with no sorted picture of who needs the seat most, and has to re-triage on the ground - time the one Immediate casualty who actually needed that slot did not have." },
    },
  });

  add({
    id: "sc-68w-scope-of-practice",
    title: "Scope of Practice: A CLS Wants to Go Further",
    tier: ["E3", "E4", "E5", "E6"],
    competency: ["Leads", "Character", "Achieves"],
    estMinutes: 3,
    difficulty: "Intermediate",
    doctrine: [
      { pub: "ATP 4-02.11", para: "Tactical Field Care - provider-tier scope of practice", edition: "2026-03", quoteKind: "paraphrase" },
      { pub: "TC 4-02.1", para: "Combat Lifesaver Program", edition: "2020", quoteKind: "paraphrase" },
    ],
    defaultMode: "cyoa",
    renderModes: ["text", "course", "cyoa"],
    scene: "Tactical Field Care - a Combat Lifesaver on your team wants to attempt a procedure beyond CLS-level training",
    start: "n1",
    mos: ["68W"],
    curriculum: ["68W Health Care Specialist"],
    nodes: {
      n1: { prompt: "You are the only 68W on scene with a stabilized casualty who now needs an intervention outside basic CLS-level tasks. A CLS-trained teammate, eager to help, volunteers to attempt it himself so you can move to check on other Soldiers. What do you do?", choices: [{ text: "Continue", goto: "n2" }] },
      n2: { prompt: "Choose the response that keeps the casualty inside proper scope of practice without wasting a Soldier who wants to help.", choices: [
        { text: "Perform the intervention yourself, and give the CLS a clear, in-scope task - holding direct pressure, prepping the next dressing, watching for signs of shock - so his help is still put to use.", goto: "end-good", score: { Leads: 3, Character: 2, Achieves: 2 }, feedback: "Correct. The 68W is the TCCC Tier 3 provider trained and authorized for this intervention; redirecting the CLS to an in-scope task keeps the casualty properly cared for and still uses every set of hands available." },
        { text: "Let the CLS attempt it under your verbal guidance so you can move on faster.", goto: "end-outofscope", score: { Leads: -1, Character: -1, Achieves: 0 }, feedback: "Talking a CLS through a procedure outside his trained scope does not make it authorized - CLS training and TCCC Tier 3 combat-medic training are not interchangeable, and the casualty is the one who bears that risk." },
        { text: "Tell the CLS there is nothing for him to do right now and handle everything yourself, alone.", goto: "end-wasted", score: { Leads: 0, Character: 0, Achieves: 0 }, feedback: "Correctly keeping the procedure in your own hands is right - but dismissing a trained, willing CLS with nothing to do wastes real capacity you have on scene and slows everything else that still needs doing." },
        { text: "Stop to explain the exact scope-of-practice boundary before doing anything, while the casualty waits.", goto: "end-delay", score: { Leads: 0, Character: 1, Achieves: -1 }, feedback: "The scope distinction is real and worth teaching - just not while a casualty is waiting on the intervention. Act first, debrief the reasoning afterward." },
      ] },
      "end-good": { prompt: "", end: true, outcome: "The casualty receives the intervention from the Soldier actually trained and authorized to give it, and the CLS's help still moves the casualty toward stabilization faster instead of standing by idle. Scope of practice and using every available hand are not actually in tension when the medic assigns the work correctly." },
      "end-outofscope": { prompt: "", end: true, outcome: "The CLS attempts a procedure outside his training under time pressure - exactly the setup for a preventable complication, and one the 68W's own presence was supposed to prevent." },
      "end-wasted": { prompt: "", end: true, outcome: "The intervention itself goes fine, but a trained, willing Soldier stood by with nothing to do while other tasks around the casualty went unaddressed - a real capacity the medic did not use." },
      "end-delay": { prompt: "", end: true, outcome: "The explanation is accurate, but it costs time the casualty did not have to spare. Teach the scope-of-practice lesson in the after-action review, not mid-intervention." },
    },
  });
  });
})();
