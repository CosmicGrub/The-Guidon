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
};

export function pillarForBoard(q) { return CATEGORY_PILLAR[q.category] || null; }
export function pillarForDoctrine(e) { return DOCTRINE_PILLAR[e.id] || TOPIC_PILLAR[e.topic] || null; }
// Scenarios use a coarse but honest rule: the catalog is overwhelmingly
// leadership-judgment content (Leadership & Counseling); mandatory-training
// modules (defaultMode "training") are Programs & Support; the Integrated
// Operational Thinking lane (sc-iot-*) is Doctrinal Thinking; the TCCC /
// MEDEVAC lane is medical, outside the six, and stays untagged.
export function pillarForScenario(s) {
  if (SCENARIO_PILLAR[s.id]) return SCENARIO_PILLAR[s.id];
  if (/^sc-iot-/.test(s.id)) return DT;
  if (/^sc-(tccc|medevac)/.test(s.id)) return null;
  if (s.defaultMode === "training") return PS;
  return LC;
}
