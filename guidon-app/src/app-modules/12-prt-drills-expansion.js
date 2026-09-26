/* GUIDON — PRT drill expansion: Conditioning Drill 1, Conditioning Drill 2,
 * Climbing Drill 1, Climbing Drill 2, and the Guerilla Drill.
 *
 * WHY THIS EXISTS: GUIDON_SEED.prt.drills shipped exactly one drill
 * ("pd", the Preparation Drill) with real, per-exercise ATP 7-22.02
 * citations (tools/lint-prt-sources.mjs gates that record). FM 7-22's own
 * Field/Sustaining-Phase PT schedules (FM 7-22 table, para 14-20 area, and
 * the FSP activity lists around para 5514/5524 of the extracted text) name
 * Preparation Drill, Conditioning Drill 1, Conditioning Drill 2, Climbing
 * Drill 1, Climbing Drill 2, and the Guerilla Drill as the standard PRT
 * drill sequence. docs/design/content-education-roadmap.md §7 sized this
 * exact expansion ("Recovery Drill and Conditioning Drills 1/2 slot in
 * later as additional entries with zero schema change") without building
 * it. This pack builds it, for the five drills after PD in that sequence.
 *
 * SOURCING: every exercise's startingPosition/movementDescription below is
 * transcribed from docs-source/ATP_7-22.02_Holistic_Health_and_Fitness_
 * Drills_and_Exercises.pdf (chapters 5 "Conditioning Drills" and 6
 * "Climbing and Guerilla Drills"), re-extracted with `pdftotext -enc UTF-8`
 * the same way tools/build-library-data.mjs extracts every Reference
 * Library document — not from memory. Every exercise below is
 * sourceStatus:"verified" because the movement text really was transcribed
 * this way, matching lint-prt-sources.mjs's own gate (a non-null starting
 * position/movement description without "verified" fails that lint).
 *
 * cadenceOverride follows PD's own convention (a per-exercise deviation
 * from what a generic reader would assume): CD1 states "at a moderate
 * cadence" for all five of its own exercises (ATP 7-22.02 para 5-3–5-7,
 * unlike PD's mostly-slow baseline), so every CD1 exercise below carries an
 * explicit override rather than relying on a null default that would read
 * as "slow." CD2 mixes slow (3 exercises) and moderate (2), the same
 * asymmetric shape PD's own slow-baseline-with-two-moderate-exceptions
 * already uses, so only CD2's two moderate exercises carry an override.
 * CL1/CL2 exercises are cued by verbal command ("UP"/"DOWN") or a timed
 * hold, not a named slow/moderate 4-count cadence, and the Guerilla
 * Drill is executed "at quick time" (a marching tempo, not this module's
 * counts-per-minute system) — none of those fifteen exercises fabricate a
 * cadence label the source does not give them; cadenceOverride stays null
 * throughout CL1/CL2/GD, and each drill's own repRule.note says so.
 *
 * repRule confidence, per drill (mirrors PD's own honest treatment of its
 * combined-day rep figure, GUIDON_SEED.prt.drills[0] — see that record's
 * own note before assuming a pattern here):
 *   - CD1: no single CD1 paragraph (5-3–5-7) states a rep count. The
 *     closest real figure is para 5-24 (the CD3 introduction), which says
 *     Soldiers progress to CD3 "after mastering the movements and being
 *     able to tolerate 10 repetitions of Conditioning Drills 1 and 2" — a
 *     real, citable, but cross-referenced (not self-contained) figure.
 *     sourceStatus: "pending-source".
 *   - CD2: every one of CD2's five exercises (para 5-19–5-23) ends with
 *     its own "Complete 5–10 repetitions" line — directly, repeatedly
 *     stated inside CD2's own paragraphs. sourceStatus: "verified".
 *   - CL1: four of five exercises (para 6-3, 6-5, 6-6, 6-7) end with
 *     "Repeat the exercise 5–10 times"; the Heel Hook (para 6-4) does not
 *     restate a count. sourceStatus: "pending-source" — the pattern is
 *     consistent but not universal within the drill's own text.
 *   - CL2: para 6-8 states the goal as "5–10 repetitions of all five
 *     exercises unassisted," but that describes the unassisted-performance
 *     GOAL under load, not a rep count restated in every exercise's own
 *     text (the Flexed-Arm Hang is a 5-second timed hold, not a rep
 *     count). sourceStatus: "pending-source".
 *   - GD: has no rep-count structure at all — three exercises, each done
 *     once per 25-meter pass, progressing to up to three sets of the whole
 *     drill (para 6-14). That is a directly, plainly stated rule, not an
 *     inference. sourceStatus: "verified".
 *
 * Board-drill flashcards: the seed already carries "exercises in fixed
 * order" cards for CD1/CD2/CL1/CL2 (prt-drills-5/6/8/9) and has none for
 * the Guerilla Drill at all. Repeating those same sequence questions here
 * would violate tools/lint-content-packs.mjs rule (p7) (no duplicate
 * question), so this pack adds ONE new, genuinely different card per CD1/
 * CD2/CL1/CL2 — testing the newly-transcribed per-exercise detail (each
 * exercise's purpose/cadence for CD1, the moderate-cadence exceptions and
 * rep range for CD2, the spotter rule for CL1, the loaded-conditions
 * difference for CL2) — plus the two GD cards the drill was missing
 * entirely: its own fixed sequence (matching prt-drills-1/2/3/.../11's
 * established pattern) and its set-progression rule.
 */
(function () {
  "use strict";
  var EDITION = "2020-10-01 (incl. C1)";
  function src(para) { return [{ pub: "ATP 7-22.02", edition: EDITION, para: para, quoteKind: "paraphrase" }]; }

  G.contentPack.define("prt-drills-expansion", function (bank, ctx) {
  if (!bank) return null;
  bank.prt = bank.prt && typeof bank.prt === "object" ? bank.prt : {};
  bank.prt.drills = Array.isArray(bank.prt.drills) ? bank.prt.drills : [];
  var drillIds = new Set(bank.prt.drills.map(function (d) { return d && d.id; }));

  function exercise(drillId, order, name, counts, cadenceOverride, startingPosition, movementDescription, para) {
    return {
      id: drillId + "-ex-" + (order < 10 ? "0" + order : order),
      drillId: drillId, order: order, name: name, counts: counts,
      cadenceOverride: cadenceOverride, repRuleOverride: null,
      startingPosition: startingPosition, movementDescription: movementDescription,
      sourceStatus: "verified", source: src(para),
    };
  }
  function moderate(note) {
    return { cadence: "moderate", note: note, source: { ref: "ATP 7-22.02", para: null, asOf: null } };
  }

  function addDrill(d) {
    if (drillIds.has(d.id)) return;
    bank.prt.drills.push(d);
    drillIds.add(d.id);
  }

  // ---- Conditioning Drill 1 (CD1) — ATP 7-22.02 paras 5-1–5-7 ----
  addDrill({
    id: "cd1", name: "Conditioning Drill 1", abbr: "CD1",
    purpose: "Five exercises that build muscular strength and endurance, balance, and coordination — the entry-level circuit in the Conditioning Drill progression, performed with no equipment.",
    cadence: { slow: 50, moderate: 80, unit: "counts/min" },
    repRule: {
      standalone: 10, combinedSameSession: null,
      note: "ATP 7-22.02 does not print an explicit \"5–10 repetitions\" line inside CD1's own five exercise write-ups (para 5-3–5-7), unlike CD2/CD3. Para 5-24 (the Conditioning Drill 3 introduction) states Soldiers progress to CD3 only \"after mastering the movements and being able to tolerate 10 repetitions of Conditioning Drills 1 and 2\" — the closest real, citable figure for CD1's own build-up target, but a cross-reference rather than a rule stated inside CD1's own paragraphs.",
      sourceStatus: "pending-source", source: src("5-24"),
    },
    exercises: [
      exercise("cd1", 1, "Power Jump", 4, moderate("CD1 exercises are conducted at a moderate cadence (ATP 7-22.02 para 5-3–5-7), unlike PD's mostly-slow baseline."),
        "The starting position for the Power Jump is the Straddle Stance position with hands on hips.",
        "On count 1, squat with the heels flat while rounding the spine forward and reaching to the ground, placing the palms on the ground with the gaze remaining forward. On count 2, jump forcefully from the ground, swinging the arms up and overhead to unweight the body and increase the height of the jump, palms facing inward. On count 3, return to the count 1 position after landing softly with the feet directed forward and shoulder-width apart. On count 4, return to the starting position.",
        "5-3"),
      exercise("cd1", 2, "V-Up", 4, moderate("Conducted at a moderate cadence, ATP 7-22.02 para 5-4."),
        "The starting position for the V-Up is the Supine position with arms on the ground at 45 degrees from the body and knees bent to 90 degrees. The head is 1–2 inches off the ground.",
        "On count 1, raise the legs and trunk at the same time into a V position, using the arms to balance. Keep the knees straight and the head aligned with the trunk — neither bent forward nor extended backward. On count 2, return under control to the starting position, avoiding dropping the legs. On count 3, repeat count 1. On count 4, return to the count 2 position.",
        "5-4"),
      exercise("cd1", 3, "Mountain Climber", 4, moderate("Conducted at a moderate cadence, ATP 7-22.02 para 5-5."),
        "The starting position for the Mountain Climber is the Front Leaning Rest with the left foot below the chest and the left knee between the arms.",
        "On count 1, shift body weight to the hands while changing the position of the feet, keeping the back straight and the hips from moving up and down throughout the exercise. On count 2, reverse the movement performed in count 1 to return to the starting position. On count 3, repeat count 1. On count 4, return to the starting position.",
        "5-5"),
      exercise("cd1", 4, "Leg-Tuck and Twist", 4, moderate("Conducted at a moderate cadence, ATP 7-22.02 para 5-6."),
        "The starting position for the Leg-Tuck and Twist is the supported reclining Sitting position. Hands are on the ground to the rear of the shoulders, palms down. Legs are straight and kept together with the feet 8–12 inches above the ground.",
        "On count 1, raise the legs while rotating onto the left buttock and drawing the knees toward the left shoulder, maintaining control of the leg movement and trunk position. On count 2, reverse the movement performed in count 1 to return to the starting position. On count 3, repeat count 1, this time rotating the legs to the right. On count 4, return to the starting position.",
        "5-6"),
      exercise("cd1", 5, "Single-Leg Push-Up", 4, moderate("Conducted at a moderate cadence, ATP 7-22.02 para 5-7."),
        "The starting position for the Single-Leg Push-Up is the Front Leaning Rest. Hands are directly beneath the shoulders with fingers spread, feet together, and the body forms a straight line from the top of the head to the heels.",
        "On count 1, bend the elbows, lowering the body until the upper arms are parallel to the ground. At the same time, raise the left leg until the toe is level with or just above the right heel, keeping the left knee straight — this is not a high leg raise or hyper-extension of the hip. On count 2, reverse the movement performed in count 1 to return to the starting position. On count 3, repeat count 1, moving the right leg the same way the left leg moved in count 1. On count 4, return to the starting position.",
        "5-7"),
    ],
  });

  // ---- Conditioning Drill 2 (CD2) — ATP 7-22.02 paras 5-18–5-23 ----
  addDrill({
    id: "cd2", name: "Conditioning Drill 2", abbr: "CD2",
    purpose: "Five exercises that develop and improve strength, agility, and mobility — the intermediate progression from Conditioning Drill 1.",
    cadence: { slow: 50, moderate: 80, unit: "counts/min" },
    repRule: {
      standalone: 10, combinedSameSession: null,
      note: "Each of CD2's five exercises (para 5-19–5-23) ends with its own \"Complete 5–10 repetitions\" line — a directly, repeatedly stated range, the same one PD's own 4-count exercises (Rower, Squat Bender, Windmill, Forward Lunge) already use. Still recorded pending-source only in the sense that no single paragraph states one drill-wide rule covering all five exercises at once; each exercise's own movementDescription is the ground truth for its own count.",
      sourceStatus: "verified", source: src("5-19"),
    },
    exercises: [
      exercise("cd2", 1, "Turn and Lunge", 4, null,
        "The starting position for the Turn and Lunge is the Straddle Stance position with hands on hips.",
        "On count 1, turn 90 degrees to the left, pivoting on the right foot while stepping with the left, and perform a Forward Lunge facing left, reaching to the ground with the right hand between the legs; the left arm moves rearward at the left side of the body, and the head stays in line with the spine. On count 2, stand up and rotate to the right to return to the starting position, stepping with the right foot and pivoting on the ball of the left foot. On count 3, repeat count 1 to the right, stepping with the right foot and pivoting on the left. On count 4, rotate to the left, pivoting on the right foot and stepping with the left, to return to the starting position. Complete 5–10 repetitions, continuing to pivot on the rear foot and step with the lead foot.",
        "5-19"),
      exercise("cd2", 2, "Supine Bicycle", 4, null,
        "The starting position for the Supine Bicycle is the Supine position with hands resting on top of the head — not the back of the head — and knees and hips bent to 90 degrees. The head is 2–4 inches off the ground.",
        "On count 1, bring the left knee toward the chest while flexing and rotating the trunk to the left, attempting to touch the right elbow with the right thigh, while extending the right knee to straighten the right leg. On count 2, return under control to the starting position — there is a pause on count 2, not a continuous movement to the opposite side. On count 3, repeat count 1 to the opposite side. On count 4, return to the starting position. Complete 5–10 repetitions.",
        "5-20"),
      exercise("cd2", 3, "Half Jack", 4, moderate("Half Jack is performed at a moderate cadence, unlike most CD2 exercises (slow), ATP 7-22.02 para 5-21."),
        "The starting position for the Half Jack is the Position of Attention.",
        "On count 1, jump and land with the feet shoulder-width apart and pointed straight ahead, arms straight out to the side of the body, palms down with fingers and thumbs extended and joined; the arms do not move beyond the point where they are parallel to the ground. On count 2, reverse the movement performed in count 1 to return to the starting position. On count 3, repeat count 1. On count 4, return to the starting position. Complete 5–10 repetitions.",
        "5-21"),
      exercise("cd2", 4, "Swimmer", 4, null,
        "The starting position for the Swimmer is the Prone position with the arms extended overhead, palms down and on the ground, toes pointed to the rear.",
        "On count 1, raise the left arm and right leg off the ground while lifting the head up and arching the back slightly, gaze \"down-range\" or parallel to the ground. On count 2, reverse the movement performed in count 1 to return to the starting position. On count 3, repeat count 1, this time with the opposite arm and leg. On count 4, return to the starting position. Complete 5–10 repetitions.",
        "5-22"),
      exercise("cd2", 5, "8-Count T Push-Up", 8, moderate("The 8-Count T Push-Up is performed at a moderate cadence, unlike most CD2 exercises (slow), ATP 7-22.02 para 5-23."),
        "The starting position for the 8-Count T Push-Up is the Position of Attention.",
        "On count 1, assume the Squat position. On count 2, thrust the legs backward into the Front Leaning Rest position. On count 3, bend the elbows, lowering the body to the ground. On count 4, release the hands from the ground, moving the arms directly out to the side into the T position — the same position used in the T-Raise exercise; hands may be on or off the ground in the T position. On count 6, perform a push-up from the ground into the Front Leaning Rest position, keeping the body in a straight line from the head to the bottom of the heels. On count 7, return to the Squat position. On count 8, return to the Position of Attention. Complete 5–10 repetitions. (ATP 7-22.02's own count sequence skips directly from count 4 to count 6 — that gap is in the source text itself, not an error introduced here.)",
        "5-23"),
    ],
  });

  // ---- Climbing Drill 1 (CL1) — ATP 7-22.02 paras 6-1–6-7 ----
  addDrill({
    id: "cl1", name: "Climbing Drill 1", abbr: "CL1",
    purpose: "A broad variety of pulling exercises that improve upper-body strength and endurance, preparing Soldiers to pull up as well as onto and over obstacles; performed on a climbing bar with spotters.",
    cadence: { slow: 50, moderate: 80, unit: "counts/min", note: "Climbing Drill 1's exercises are cued by verbal command (\"UP\"/\"DOWN\"), not by a named slow/moderate 4-count cadence — these values are this module's shared cadence reference (ATP 7-22.02 para 1-17), not a per-exercise claim for CL1." },
    repRule: {
      standalone: 10, combinedSameSession: null,
      note: "Four of Climbing Drill 1's five exercises (Straight-Arm Pull para 6-3, Pull-Up para 6-5, Leg Tuck para 6-6, Alternating Grip Pull-Up para 6-7) each end with \"Repeat the exercise 5–10 times.\" The Heel Hook (para 6-4) does not restate a count in its own paragraph. Recorded pending-source because the pattern, while consistent across four of five exercises, is not stated as one drill-wide rule.",
      sourceStatus: "pending-source", source: src("6-3"),
    },
    exercises: [
      exercise("cl1", 1, "Straight-Arm Pull", null, null,
        "The starting position for the Straight-Arm Pull is the Straight-Arm Hang using the closed overhand grip. Unless the Soldier states \"No spotter needed,\" two spotters assume the Straddle Stance position, staggered in front of and behind the exerciser.",
        "On the command \"UP,\" move from the starting position keeping the arms straight and pull the body up with the effect of raising the head between the arms; the chest moves up toward the bar and the shoulder blades move together. On the command \"DOWN,\" return to the starting position. Repeat the exercise 5–10 times. The front spotter places palms toward the exerciser at chest height to support the exerciser if the grip fails; the rear spotter does the same and also guides the exerciser to the foot pegs.",
        "6-3"),
      exercise("cl1", 2, "Heel Hook", null, null,
        "The starting position for the Heel Hook is the Straight-Arm Hang using the closed overhand grip. Unless the Soldier states \"No spotter needed,\" two spotters assume the Straddle Stance position on either side of the exerciser, each positioning one hand behind and off the back of the knee and the low back, ready to catch the exerciser if the grip fails.",
        "On the command \"UP,\" flex the elbows, knees, and hips to raise both feet above the bar, crossing one ankle over the other. On the command \"DOWN,\" return to the starting position. The spotters may assist in guiding the exerciser to the foot pegs after \"DOWN\" and before \"DISMOUNT.\"",
        "6-4"),
      exercise("cl1", 3, "Pull-Up", null, null,
        "The starting position for the Pull-Up is the Straight-Arm Hang using the closed overhand grip. Unless the Soldier states \"No spotter needed,\" the front spotter places palms toward the exerciser at chest height, and the rear spotter holds the exerciser's feet against their thighs or abdomen to support the movement up.",
        "On the command \"UP,\" flex the elbows, raising the body in a straight line until the head is above the bar. On the command \"DOWN,\" return to the starting position. Repeat the exercise 5–10 times; once the Soldier is up, the rear spotter stops assisting.",
        "6-5"),
      exercise("cl1", 4, "Leg Tuck", null, null,
        "The starting position for the Leg Tuck is the Straight-Arm Hang using the closed alternating overhand grip. Unless the Soldier states \"No spotter needed,\" two spotters assume the Straddle Stance position on either side of the exerciser, each positioning one hand behind and off the back of the knee and the low back.",
        "On the command \"UP,\" flex the elbows and hips, raising the legs until the thighs touch the elbows. On the command \"DOWN,\" return to the starting position. Repeat the exercise 5–10 times.",
        "6-6"),
      exercise("cl1", 5, "Alternating Grip Pull-Up", 2, null,
        "The starting position for the Alternating Grip Pull-Up is the Straight-Arm Hang using the closed alternating grip, which positions the Soldier perpendicular to the bar. Unless the Soldier states \"No spotter needed,\" the front spotter places palms toward the exerciser at chest height, and the rear spotter holds the exerciser's feet against their thighs or abdomen.",
        "On count 1, flex the elbows, raising the body up so the head moves to the side of the bar. On count 2, return to the starting position. Repeat the exercise 5–10 times; once the Soldier is up, the rear spotter stops assisting.",
        "6-7"),
    ],
  });

  // ---- Climbing Drill 2 (CL2) — ATP 7-22.02 paras 6-8–6-13 ----
  addDrill({
    id: "cl2", name: "Climbing Drill 2", abbr: "CL2",
    purpose: "A higher-intensity progression of Climbing Drill 1, performed in the Sustaining Phase under a fighting load (Army Combat Uniform, load-bearing equipment or vest, improved outer tactical vest, advanced combat helmet, and an individual weapon) to prepare Soldiers for climbing, traversing a rope, and pulling the body up under load.",
    cadence: { slow: 50, moderate: 80, unit: "counts/min", note: "Climbing Drill 2's exercises are cued by verbal command or a timed hold, not a named slow/moderate cadence — these values are this module's shared cadence reference (ATP 7-22.02 para 1-17), not a per-exercise claim for CL2." },
    repRule: {
      standalone: 10, combinedSameSession: null,
      note: "Para 6-8 states the goal as \"to perform 5–10 repetitions of all five exercises unassisted,\" a real, direct drill-wide figure — but it describes the unassisted-performance GOAL under load, not a rep count restated inside every exercise's own text (the Flexed-Arm Hang, para 6-9, is a 5-second timed hold, not a rep count). Recorded pending-source pending a clearer read on how that figure applies to a timed-hold exercise.",
      sourceStatus: "pending-source", source: src("6-8"),
    },
    exercises: [
      exercise("cl2", 1, "Flexed-Arm Hang", null, null,
        "The starting position for the Flexed-Arm Hang is the Straight-Arm Hang using the closed overhand grip. Unless the Soldier states \"No spotter needed,\" the front spotter places palms toward the exerciser at chest height, and the rear spotter holds the exerciser's feet against their thighs or abdomen to support the movement up.",
        "On the command \"UP,\" flex the elbows to pull up, raising the head above the bar, and hold this position for a count of 5 seconds — a Soldier who can perform every Climbing Drill exercise for 5 repetitions unassisted holds longer. On the command \"DOWN,\" return to the starting position. A Soldier who cannot hold the up position for 5 seconds returns to the starting position instead.",
        "6-9"),
      exercise("cl2", 2, "Heel Hook", null, null,
        "Climbing Drill 2's Heel Hook is the same exercise as Climbing Drill 1's (ATP 7-22.02 para 6-10 states it is identical to para 6-4): the starting position is the Straight-Arm Hang using the closed overhand grip, with two spotters on either side of the exerciser unless the Soldier states \"No spotter needed.\"",
        "On the command \"UP,\" flex the elbows, knees, and hips to raise both feet above the bar, crossing one ankle over the other. On the command \"DOWN,\" return to the starting position. Because Climbing Drill 2 is performed under the heavier fighting load described in this drill's own purpose, spotters must be ready to assist earlier than in Climbing Drill 1.",
        "6-10"),
      exercise("cl2", 3, "Pull-Up", null, null,
        "Climbing Drill 2's Pull-Up is the same exercise as Climbing Drill 1's (ATP 7-22.02 para 6-11 states it is identical to para 6-5): the starting position is the Straight-Arm Hang using the closed overhand grip, with a front spotter at chest height and a rear spotter supporting the feet, unless the Soldier states \"No spotter needed.\"",
        "On the command \"UP,\" flex the elbows, raising the body in a straight line until the head is above the bar. On the command \"DOWN,\" return to the starting position. Because Climbing Drill 2 is performed under the heavier fighting load described in this drill's own purpose, spotters must be ready to assist earlier than in Climbing Drill 1.",
        "6-11"),
      exercise("cl2", 4, "Leg Tuck", null, null,
        "Climbing Drill 2's Leg Tuck is the same exercise as Climbing Drill 1's (ATP 7-22.02 para 6-12 states it is identical to para 6-6): the starting position is the Straight-Arm Hang using the closed alternating overhand grip, with two spotters on either side of the exerciser unless the Soldier states \"No spotter needed.\"",
        "On the command \"UP,\" flex the elbows and hips, raising the legs until the thighs touch the elbows. On the command \"DOWN,\" return to the starting position. Because Climbing Drill 2 is performed under the heavier fighting load described in this drill's own purpose, spotters must be ready to assist earlier than in Climbing Drill 1.",
        "6-12"),
      exercise("cl2", 5, "Alternating Grip Pull-Up", 2, null,
        "Climbing Drill 2's Alternating Grip Pull-Up is the same exercise as Climbing Drill 1's (ATP 7-22.02 para 6-13 states it is identical to para 6-7): the starting position is the Straight-Arm Hang using the closed alternating grip, perpendicular to the bar, with a front spotter at chest height and a rear spotter supporting the feet, unless the Soldier states \"No spotter needed.\"",
        "On count 1, flex the elbows, raising the body up so the head moves to the side of the bar. On count 2, return to the starting position. Because Climbing Drill 2 is performed under the heavier fighting load described in this drill's own purpose, spotters must be ready to assist earlier than in Climbing Drill 1.",
        "6-13"),
    ],
  });

  // ---- Guerilla Drill (GD) — ATP 7-22.02 paras 6-14–6-17 ----
  // ATP 7-22.02 itself spells this drill's name "Guerilla Drill" (one R) in
  // its own chapter and paragraph headings ("GUERILLA DRILL (GD)", "GD —
  // Guerilla Drill" in FM 7-22's own abbreviations list). This record keeps
  // the source publication's own spelling for citation fidelity, since a
  // Soldier who opens ATP 7-22.02 to check this record should find the same
  // heading, not a "corrected" one.
  addDrill({
    id: "gd", name: "Guerilla Drill", abbr: "GD",
    purpose: "An advanced drill that develops leg power, coordination, and the ability to lift and carry another Soldier of comparable size — three exercises always performed in order, at quick time, with careful attention to precise movement skill, across a 25-meter course.",
    cadence: { slow: 50, moderate: 80, unit: "counts/min", note: "The Guerilla Drill is executed \"at quick time\" (a marching tempo), not the slow/moderate 4-count cadence used elsewhere in this module — these values are this module's shared cadence reference (ATP 7-22.02 para 1-17), not a per-exercise claim for GD. Source: ATP 7-22.02 para 6-14." },
    repRule: {
      standalone: null, combinedSameSession: null,
      note: "The Guerilla Drill has no rep-count structure at all — its three exercises are each performed once per pass across the 25-meter course, \"always performed in order, at quick time.\" Soldiers progress from one pass to up to three sets of the full drill once they can execute it precisely, not by increasing repetitions of an individual exercise the way PD/CD1/CD2/CL1/CL2 do. This is a directly, plainly stated rule, not an inference.",
      sourceStatus: "verified", source: src("6-14"),
    },
    exercises: [
      exercise("gd", 1, "Shoulder Roll", null, null,
        "The starting position for the Shoulder Roll is the Straddle Stance position.",
        "From the starting position, step forward with the left foot, squat down, and make a wheel with the arms by placing the left hand on the ground with the fingers facing to the rear, pointing the lead elbow in the direction of travel; the right hand is also on the ground with the fingers facing forward, and the chin is tucked to avoid neck injury. Push off with the right leg and roll over the left shoulder along the left side of the body — never onto the neck — generating enough momentum to come up onto the knees, then continue to the feet by pushing off with the rear leg to stand up. To roll to the opposite side, step forward and switch hand and leg positions. Continue alternating shoulder rolls until across the 25-meter line.",
        "6-15"),
      exercise("gd", 2, "Lunge Walk", null, null,
        "The starting position for the Lunge Walk is the Position of Attention.",
        "From the starting position, step forward with the left foot as in a Lunge, swinging the opposite arm until the upper arm is parallel to the ground, lightly touching the knee of the rear leg to the ground with each step. Step forward and under the body with the right leg, avoiding raising the trunk or swinging the leg out to the side to clear the ground. Continue alternating leg and arm movements until crossing the 25-meter line.",
        "6-16"),
      exercise("gd", 3, "Soldier Carry", null, null,
        "The starting position for the Soldier Carry pairs two Soldiers: Soldier B (the Soldier being carried) is in the Prone position with arms overhead, and Soldier A (the Soldier performing the carry) is in the Straddle Stance position at Soldier B's feet.",
        "From the starting position, Soldier A steps over Soldier B, squats, reaches under the armpits and in front of the top of Soldier B's chest, and clasps the hands together. Soldier A stands, leaning or stepping backward to lift Soldier B until Soldier B's legs are locked straight, then steps forward to continue lifting Soldier B onto their feet, separating Soldier B's legs with their own feet. Soldier A lifts one of Soldier B's arms overhead, steps under that arm toward the front of Soldier B, turns to face Soldier B from the side, places one leg between and under Soldier B's legs, and squats deeply to let Soldier B drape over their back. Soldier A grasps the back of Soldier B's far leg, stands to lift Soldier B off the ground, and — using the hand of the arm between Soldier B's legs — grasps Soldier B's forearm and carries Soldier B at quick time to the 25-meter line. After Soldier A sets Soldier B's feet back on the ground, the Soldiers switch roles and return to the start.",
        "6-17"),
    ],
  });

  // ---- Matching board-drill flashcards (standing content-pipeline rule) ----
  // The seed already carries "exercises in fixed order" cards for CD1/CD2/
  // CL1/CL2 (prt-drills-5/6/8/9); these five cards test the newly-
  // transcribed per-exercise detail instead of repeating that question (see
  // this file's own header for why), plus GD's missing sequence card.
  bank.board = bank.board || { questions: [] };
  bank.board.questions = Array.isArray(bank.board.questions) ? bank.board.questions : [];
  var have = new Set(bank.board.questions.map(function (q) { return q && q.id; }));
  // "verbatim" keeps these cards' backs exactly as they have always read (this
  // pack never set verbatim:false).
  function addCard(q) { if (q && !have.has(q.id)) { q.source = ctx.cite(q.source, "verbatim"); bank.board.questions.push(q); have.add(q.id); } }
  var TIER = ["E1", "E2", "E3", "E4", "E5", "E6"];

  addCard({
    id: "prt-drills-14", category: "Physical Readiness Training", tier: TIER,
    q: "What does each individual exercise in Conditioning Drill 1 (CD1) develop, and at what cadence is the whole drill performed?",
    a: "All five CD1 exercises are conducted at a moderate cadence (80 counts per minute), unlike most PD/CD2 exercises' slow baseline. Each exercise targets something specific: the Power Jump reinforces correct jumping/landing skill and develops explosive strength off the ground; the V-Up develops the abdominal and hip flexor muscles for tasks like the leg tuck, rope traverse, and surmounting obstacles; the Mountain Climber develops the ability to quickly power out of the Front Leaning Rest into a Run or Crouch Run; the Leg-Tuck and Twist strengthens trunk and hip muscle coordination and control of trunk rotation; and the Single-Leg Push-Up strengthens the chest and hips while increasing the challenge to shoulder stability.",
    acceptableAnswer: "CD1's five exercises are all moderate-cadence; each targets something specific — Power Jump (jumping/landing/explosive power), V-Up (abs/hip flexors), Mountain Climber (powering out of the front leaning rest), Leg-Tuck and Twist (trunk/hip rotation control), Single-Leg Push-Up (chest/hip/shoulder stability).",
    boardAnswer: "Conditioning Drill 1 (CD1)'s five exercises are all performed at a moderate cadence, and each develops something distinct: the Power Jump builds jumping/landing skill and explosive strength, the V-Up develops the abdominal and hip flexor muscles for the leg tuck and obstacle tasks, the Mountain Climber develops the ability to power out of the Front Leaning Rest, the Leg-Tuck and Twist strengthens trunk/hip rotation control, and the Single-Leg Push-Up strengthens the chest, hips, and shoulder stability (ATP 7-22.02, paras 5-3–5-7).",
    keyPoints: [
      "All five CD1 exercises are conducted at a moderate cadence (80 counts/min) — a different baseline than PD's mostly-slow one",
      "Power Jump: jumping/landing skill, balance, explosive strength off the ground",
      "V-Up: abdominal and hip flexor muscles, for the leg tuck, rope traverse, and obstacles",
      "Mountain Climber: powering out of the Front Leaning Rest into a Run or Crouch Run",
      "Leg-Tuck and Twist: trunk and hip muscle coordination, control of trunk rotation",
      "Single-Leg Push-Up: chest and hip strength plus a shoulder-stability challenge"
    ],
    source: "ATP 7-22.02, paras 5-3–5-7", difficulty: "advanced",
  });

  addCard({
    id: "prt-drills-15", category: "Physical Readiness Training", tier: TIER,
    q: "Which two exercises of Conditioning Drill 2 (CD2) are performed at a moderate cadence rather than the drill's usual slow cadence, and what is the standard repetition range for CD2's exercises?",
    a: "The Half Jack and the 8-Count T Push-Up are CD2's two moderate-cadence exercises; the other three (Turn and Lunge, Supine Bicycle, Swimmer) are slow-cadence. Each of CD2's five exercises directs Soldiers to \"Complete 5–10 repetitions.\"",
    acceptableAnswer: "Half Jack and 8-Count T Push-Up are moderate-cadence; Turn and Lunge/Supine Bicycle/Swimmer are slow. All five exercises use a 5–10 repetition range.",
    boardAnswer: "In Conditioning Drill 2 (CD2), the Half Jack and the 8-Count T Push-Up are performed at a moderate cadence, while the Turn and Lunge, Supine Bicycle, and Swimmer are performed at a slow cadence; every one of CD2's five exercises is dosed at 5–10 repetitions (ATP 7-22.02, paras 5-19–5-23).",
    keyPoints: [
      "CD2 mixes cadences: Half Jack and 8-Count T Push-Up are moderate; the other three are slow",
      "Every CD2 exercise's own text states \"Complete 5–10 repetitions\"",
      "The 8-Count T Push-Up releases the hands from the ground into a T position, the same position used in the T-Raise exercise",
      "CD2 is the intermediate progression from CD1, per ATP 7-22.02 para 5-18"
    ],
    source: "ATP 7-22.02, paras 5-19–5-23", difficulty: "intermediate",
  });

  addCard({
    id: "prt-drills-16", category: "Physical Readiness Training", tier: TIER,
    q: "What is the role of a spotter in Climbing Drill 1 (CL1), and when can a Soldier perform it without one?",
    a: "Spotters in CL1 assist a Soldier who cannot yet perform 5 repetitions of all the drill's exercises unassisted, and they provide the LEAST assistance possible so the exercise is still completed safely through the greatest range of motion — too much help from a spotter can blunt the exerciser's own improvement. A Soldier who states \"No spotter needed\" performs the drill without one.",
    acceptableAnswer: "CL1 spotters assist Soldiers who can't yet do 5 reps unassisted, giving the least help needed for a safe full range of motion; a Soldier who says \"No spotter needed\" skips them.",
    boardAnswer: "In Climbing Drill 1 (CL1), spotters assist an exerciser who cannot yet perform 5 repetitions of every exercise unassisted, providing the least amount of assistance necessary so the movement is completed safely through its greatest range of motion — too much assistance can actually reduce the exerciser's own improvement. A Soldier who states \"No spotter needed\" performs the drill without spotters (ATP 7-22.02, para 6-1).",
    keyPoints: [
      "Spotters are required by default, but a Soldier may state \"No spotter needed\" to skip them",
      "Spotters assist when the exerciser cannot yet do 5 reps of all CL1 exercises unassisted",
      "Spotters give the LEAST assistance needed for a safe full range of motion",
      "Too much spotter assistance can reduce the exerciser's own performance gains"
    ],
    source: "ATP 7-22.02, para 6-1", difficulty: "intermediate",
  });

  addCard({
    id: "prt-drills-17", category: "Physical Readiness Training", tier: TIER,
    q: "Beyond swapping the Straight-Arm Pull for the Flexed-Arm Hang, what makes Climbing Drill 2 (CL2) more demanding than Climbing Drill 1, and when is it performed?",
    a: "CL2 is performed in the Sustaining Phase, wearing the Army Combat Uniform, load-bearing equipment or a load-bearing vest, the improved outer tactical vest, and the advanced combat helmet, and carrying an individual weapon. Because of that heavier load, spotters must be ready to assist much earlier than in CL1. The goal is still to perform 5–10 repetitions of all five exercises unassisted.",
    acceptableAnswer: "CL2 is performed under a fighting load (ACU, LBE/vest, IOTV, ACH, individual weapon) in the Sustaining Phase, so spotters have to be ready sooner than in CL1; the goal is still 5–10 unassisted reps.",
    boardAnswer: "Climbing Drill 2 (CL2) is performed in the Sustaining Phase under a fighting load — Army Combat Uniform, load-bearing equipment or vest, improved outer tactical vest, advanced combat helmet, and an individual weapon — so spotters must be ready to assist much earlier than in Climbing Drill 1, even though the goal is still 5–10 unassisted repetitions of all five exercises (ATP 7-22.02, para 6-8).",
    keyPoints: [
      "CL2 is performed in the Sustaining Phase, not the Initial/Toughening phases",
      "Soldiers add a fighting load: ACU, load-bearing equipment or vest, IOTV, advanced combat helmet, individual weapon",
      "Because of the heavier load, spotters must be ready to assist earlier than in CL1",
      "The performance goal (5–10 unassisted reps of all five exercises) does not change from CL1"
    ],
    source: "ATP 7-22.02, para 6-8", difficulty: "advanced",
  });

  addCard({
    id: "prt-drills-18", category: "Physical Readiness Training", tier: TIER,
    q: "What are the 3 exercises of the Guerilla Drill (GD), in order, and how is the drill performed?",
    a: "The Guerilla Drill consists of 3 exercises always performed in this order: (1) Shoulder Roll, (2) Lunge Walk, and (3) Soldier Carry. The whole drill is performed at quick time, with careful attention to precise movement skill, across a 25-meter course.",
    acceptableAnswer: "GD, in order: Shoulder Roll, Lunge Walk, Soldier Carry — always in that order, at quick time, across a 25-meter course.",
    boardAnswer: "The Guerilla Drill (GD) consists of 3 exercises — the Shoulder Roll, the Lunge Walk, and the Soldier Carry — always performed in that order, at quick time, across a 25-meter course (ATP 7-22.02, para 6-14).",
    keyPoints: [
      "3 exercises, always performed in this fixed order",
      "Order: Shoulder Roll, Lunge Walk, Soldier Carry",
      "Performed at quick time, across a 25-meter course",
      "An advanced drill: develops leg power, coordination, and the ability to lift and carry another Soldier"
    ],
    source: "ATP 7-22.02, para 6-14", difficulty: "basic",
  });

  addCard({
    id: "prt-drills-19", category: "Physical Readiness Training", tier: TIER,
    q: "Once a Soldier can precisely execute the Guerilla Drill (GD) across the 25-meter course, how does the drill progress?",
    a: "Soldiers progress up to three sets of the full drill (Shoulder Roll, Lunge Walk, Soldier Carry, always in that order) once they can execute it precisely across the 25-meter course. Unlike PD/CD1/CD2/CL1/CL2, GD has no per-exercise rep count — the drill is dosed by number of full passes/sets, not repetitions of a single exercise.",
    acceptableAnswer: "Once GD is executed precisely across the course, Soldiers progress to up to 3 full sets of the 3-exercise drill — dosed by sets/passes, not individual-exercise reps.",
    boardAnswer: "Once Soldiers can precisely execute the Guerilla Drill across the 25-meter course, they progress up to three sets of the full drill; GD is dosed by the number of full passes rather than by a per-exercise repetition count (ATP 7-22.02, para 6-14).",
    keyPoints: [
      "Progression is measured in SETS of the whole 3-exercise drill, not reps of one exercise",
      "Soldiers progress up to three sets once they can execute the drill precisely",
      "Precision of movement skill is the gate for progressing, not just fitness level",
      "This is a directly stated rule (para 6-14), not an inference from another paragraph"
    ],
    source: "ATP 7-22.02, para 6-14", difficulty: "intermediate",
  });

  return { drillIds: ["cd1", "cd2", "cl1", "cl2", "gd"], cardIds: ["prt-drills-14", "prt-drills-15", "prt-drills-16", "prt-drills-17", "prt-drills-18", "prt-drills-19"] };
  });
})();
