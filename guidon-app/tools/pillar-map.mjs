/**
 * The ONE place the ROADMAP.md §3f `pillar` taxonomy is defined: which
 * board `category` / doctrine `topic` / scenario belongs to which of the
 * six SGT-board study pillars. Imported by
 *   - tools/backfill-pillars.mjs   (tags untagged seed records - re-runnable)
 *   - tools/lint-board-taxonomy.mjs (rule (f2): a record whose category /
 *     topic IS mapped here must carry exactly that pillar - so the next
 *     content PR can't ship a counseling card without its pillar, and the
 *     map can't silently drift from the seed)
 *
 * OPTIONAL is load-bearing: the six pillars were scoped to the SGT-board
 * study track. Weapons, land nav, TCCC/medical, CBRN, SERE, patrolling,
 * radio, fitness standards, LOAC, antiterrorism, safety, OPSEC - a large share of
 * the app - belong to NONE of them, and forcing every one of 81 categories
 * into six buckets would produce a taxonomy nobody could study by. A
 * category/topic absent from these tables is untagged BY DESIGN; add it
 * here only when it genuinely fits a pillar.
 */
export const PILLARS = ["Doctrinal Thinking", "Programs & Support", "Leadership & Counseling", "Maintenance & Supply", "Training Management", "Drill & Board Etiquette"];
const DT = "Doctrinal Thinking", PS = "Programs & Support", LC = "Leadership & Counseling",
      MS = "Maintenance & Supply", TM = "Training Management", DB = "Drill & Board Etiquette";

// Board `category` -> pillar. Operational doctrine (ADP 3-0/5-0/6-0, MDMP,
// TLP, mission command) is Doctrinal Thinking; ADP 6-22 leadership doctrine
// and the admin that runs on it (counseling, evals, awards, promotions,
// UCMJ, discipline) is Leadership & Counseling.
export const CATEGORY_PILLAR = {
  "ADP / Doctrine Publications": DT, "ADP 1": DT, "ADP 3-0": DT, "ADP 3-28": DT, "ADP 5-0": DT,
  "FM 3-90": DT, "Multidomain Operations (FM 3-0)": DT, "Mission Command (ADP 6-0)": DT,
  "Operations": DT, "Operations Process": DT, "Troop Leading Procedures": DT,
  "Defense Support of Civil Authorities": DT, "Risk Management": DT,

  "ACS (AR 608-1)": PS, "AER (AR 930-4)": PS, "SUDCC (AR 600-85)": PS, "Army Programs": PS,
  "SHARP (AR 600-52)": PS, "Equal Opportunity (AR 600-20)": PS, "Suicide Prevention": PS,
  "Soldier Care": PS, "Financial Readiness": PS, "TRICARE and Healthcare": PS,
  "GI Bill and Education Benefits": PS, "Military Pay & Benefits": PS, "Leave & Passes": PS,
  "Inspector General": PS,

  "Counseling (ATP 6-22.1)": LC, "AR 623-3 — Evaluations": LC, "Awards": LC, "Promotions": LC,
  "UCMJ": LC, "Discipline": LC, "Chain of Command": LC, "NCO Support Channel": LC, "NCO": LC,
  "TC 7-22.7": LC, "Leadership": LC, "Levels of Leadership": LC, "Leadership Requirements Model": LC,
  "Counterproductive Leadership": LC, "Attributes": LC, "Achieves": LC,

  "DA PAM 750-8": MS, "Supply & Property": MS,

  "ADP 7-0 (Training Doctrine)": TM, "AR 350-1 (Training Regulation / METL)": TM,
  "After Action Reviews": TM, "NCO PME": TM,

  "Drill and Ceremony (TC 3-21.5)": DB, "Board Procedures": DB, "Customs & Courtesies": DB,
  "Creeds": DB, "NCO Creed": DB, "General Orders": DB, "Army Values": DB, "Warrior Ethos": DB,
  "Rank Structure": DB, "Army History": DB, "AR 670-1 — Uniform Standards": DB,
};

// Doctrine `topic` -> pillar, same reasoning.
export const TOPIC_PILLAR = {
  "Operations": DT, "Tactical Operations": DT, "Mission Command": DT, "Troop Leading Procedures": DT,
  "Movement and Maneuver": DT, "Defense Support of Civil Authorities": DT, "Risk Management": DT,
  "Intelligence": DT,

  "Army Programs": PS, "Army Emergency Relief": PS, "SHARP": PS, "Equal Opportunity": PS,
  "Suicide Prevention": PS, "Soldier Care": PS, "Soldier Wellness": PS, "Financial Readiness": PS,
  "TRICARE and Healthcare": PS, "GI Bill and Education Benefits": PS, "Military Pay & Benefits": PS,
  "Leave & Passes": PS, "Inspector General": PS, "Family Readiness Group": PS, "Legal Assistance": PS,
  "Survivor Benefit Plan": PS, "Vocational Rehabilitation": PS, "Transition": PS, "Medical Readiness": PS,
  "Congressional and Administrative Inquiries": PS,

  "Counseling": LC, "Developing Others": LC, "Evaluations": LC, "Awards": LC, "Promotions": LC,
  "UCMJ": LC, "Discipline": LC, "Chain of Command": LC, "The NCO": LC, "NCO Development": LC,
  "Leadership": LC, "Levels of Leadership": LC, "Leadership Requirements Model": LC,
  "Counterproductive Leadership": LC, "Attributes": LC, "Competencies": LC, "Career Management": LC,
  "Administration": LC, "Records Management": LC, "Army Writing": LC,

  "Property Accountability": MS, "Maintenance Leadership": MS, "Logistics": MS,

  "Sergeant's Time Training": TM, "After Action Reviews": TM, "Professional Military Education": TM,
  "Self-Development": TM, "Training Management": TM,

  "Drill and Ceremony": DB, "Customs & Courtesies": DB, "Creeds": DB, "Army Values": DB,
  "Warrior Ethos": DB, "Rank Structure": DB, "Army History": DB, "The Army Profession": DB,
  "Uniform Standards": DB,
  // "Foundations" is deliberately NOT mapped: it is a mixed topic (four
  // ADP 6-22 leadership definitions + the Soldier's Creed, General Orders
  // and the Army Ethic). Its entries are tagged one by one in
  // DOCTRINE_PILLAR below, so "The Three Levels of Leadership" sits with
  // the "Levels of Leadership" topic instead of under Drill & Board
  // Etiquette (review finding on PR #170).
};

// Per-id overrides, consulted BEFORE the category/topic/lane rules. Keep
// these short: an override exists only where the coarse rule would file a
// record under a pillar its own subject contradicts.
export const DOCTRINE_PILLAR = {
  "def-leadership": LC, "def-leader": LC, "levels-leadership": LC, "subordinate-role": LC,
  "soldiers-creed": DB, "general-orders": DB, "army-ethic": DB,
};
export const SCENARIO_PILLAR = {
  // AR 735-5 / AR 710-2 property accountability: the same subject as board
  // "Supply & Property" and doctrine "Property Accountability" (both MS).
  // It is PRESENTED as a mandatory-training module, but the lane rule below
  // keys on presentation, not subject. (Do NOT generalise this to "cites
  // AR 735-5": sc-the-favor cites it and is a leadership-integrity dilemma,
  // correctly Leadership & Counseling.)
  "sc-train-property": MS,
  // Content-pack scenarios whose SUBJECT is not the lane default below. Each
  // was tagged this way by its own pack and confirmed on review (2026-09-18):
  // two 92A logistics dilemmas, and the board-reporting rehearsal the Board
  // Simulator opens with.
  "sc-92a-critical-part-overdue": MS,
  "sc-92a-inventory-discrepancy": MS,
  "sc-board-simulator-reporting": DB,
};

// Categories a CONTENT PACK (src/app-modules/NN-*.js) may introduce that the
// static seed does not have. Anything else a pack uses must be an existing
// seed category, spelled exactly - tools/lint-content-packs.mjs fails on a
// pack category that is neither (that is how "Land Navigation" ended up
// beside the seed's "Land Navigation (TC 3-25.26)", splitting one subject
// across two names in the picker, the chips and the Readiness heatmap).
// Value = the pillar, or null for "outside the six by design".
export const PACK_CATEGORIES = {
  "92A — MOS Fundamentals": MS, "92A — GCSS-Army": MS, "92A — Supply Support Activity": MS,
  "92A — Inventory & Stock Control": MS, "92A — Supply Fundamentals": MS, "92A — Supply Transactions": MS,
  "92A — Accountability": MS, "92A — Maintenance Support": MS, "92A — Materiel Management": MS,
  "92A — Leadership": MS, "92A — Scenarios": MS,
  // 68W (second MOS deck, ROADMAP: "92A is the reference pattern, not a
  // one-off"): medical content, like the seed's own "TCCC / First Aid" /
  // "Army Medical System" categories, is outside the six SGT-board pillars
  // by design (see this file's header) - null, not MS, even though 92A's
  // own categories above are MS. Do not fold medical content into
  // Maintenance & Supply just because both happen to be MOS decks.
  "68W — MOS Fundamentals": null, "68W — Scope of Practice": null,
  "68W — Casualty Collection & Evacuation": null, "68W — Medical Logistics": null,
  "68W — Medical Records & Readiness": null, "68W — Legal Protections & Medical Ethics": null,
  "68W — Recognition": null,
  "Army Profession": DB,
  "Cybersecurity & OPSEC": null,
  "Cybersecurity Fundamentals": null,
  // MLC/senior-NCO content pack (10-mlc-senior-leader-content.js): course
  // facts, organizational/strategic leadership (ADP 6-22 Ch 9-10), NCOER
  // rater responsibilities, readiness reporting and talent management sit
  // squarely in the app's existing Leadership & Counseling pillar (the same
  // pillar "Levels of Leadership" and "Leadership Requirements Model"
  // already use); the mission-command/MDMP-at-echelon half of the same pack
  // is operations doctrine, matching "Mission Command (ADP 6-0)" above.
  "Master Leader Course (MLC)": LC,
  "Mission Command at Echelon": DT,
};

export function pillarForBoard(q) { return CATEGORY_PILLAR[q.category] || PACK_CATEGORIES[q.category] || null; }

// The taxonomy as plain data for the RUNNING app. tools/build.mjs injects it
// as window.GUIDON_PILLAR_MAP ahead of the app modules and tools/assemble-
// bank.mjs hands the same object to its headless sandbox, so
// src/app-modules/98-content-pack-finalize.js tags pack records from THIS
// definition instead of a hand-copied table that drifts.
export function runtimePillarMap() {
  const category = { ...CATEGORY_PILLAR };
  for (const [c, p] of Object.entries(PACK_CATEGORIES)) if (p) category[c] = p;
  return { pillars: PILLARS.slice(), category, topic: { ...TOPIC_PILLAR }, doctrineId: { ...DOCTRINE_PILLAR }, scenarioId: { ...SCENARIO_PILLAR } };
}
export function pillarForDoctrine(e) { return DOCTRINE_PILLAR[e.id] || TOPIC_PILLAR[e.topic] || null; }
// Scenarios use a coarse but honest rule: the catalog is overwhelmingly
// leadership-judgment content (Leadership & Counseling); mandatory-training
// modules (defaultMode "training") are Programs & Support; the Integrated
// Operational Thinking lane (sc-iot-*) is Doctrinal Thinking; the TCCC /
// MEDEVAC lane is medical, outside the six, and stays untagged.
export function pillarForScenario(s) {
  if (SCENARIO_PILLAR[s.id]) return SCENARIO_PILLAR[s.id];
  if (/^sc-iot-/.test(s.id)) return DT;
  // Lanes outside the six by design: medical (TCCC / MEDEVAC / 68W), and the
  // OPSEC / cyber / CUI lane - the same call the board side makes by leaving
  // "OPSEC & Information Security" and "Cybersecurity & OPSEC" untagged.
  // "68w" added alongside "tccc"/"medevac" when the 68W MOS deck shipped -
  // same medical lane, same reasoning: SCENARIO_PILLAR can only override TO
  // a truthy pillar (see the `if (SCENARIO_PILLAR[s.id])` check above), so a
  // 68W scenario NOT matched here would fall through to the LC default
  // below and be wrongly tagged Leadership & Counseling.
  if (/^sc-(tccc|medevac|opsec|cyber|cui|68w)-/.test(s.id)) return null;
  if (s.defaultMode === "training") return PS;
  return LC;
}
