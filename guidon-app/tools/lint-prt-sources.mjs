/**
 * PRT (Physical Readiness Training) content-sourcing gate, per
 * docs/design/content-education-roadmap.md §2.4.
 *
 * WHY THIS EXISTS: ATP 7-22.02 - the doctrine manual with each Preparation
 * Drill exercise's real starting position and movement description - is
 * confirmed absent from docs-source/ as of this lint's authoring. Every
 * PrtExercise record therefore ships with startingPosition/
 * movementDescription left null and sourceStatus:"pending-source" (see
 * tools/seed-io.mjs-authored content in window.GUIDON_SEED.prt.drills[]).
 * This project has a documented history (GUIDON files/ROADMAP.md section 1)
 * of catching and reverting fabricated or unverifiable doctrine content -
 * the same discipline applies here. This lint is the mechanical backstop:
 * it fails CI if any PrtExercise record ever ships a non-null
 * startingPosition or movementDescription WITHOUT sourceStatus being
 * exactly "verified" - the one state that's supposed to mean "this text was
 * actually transcribed from a real source," not filled in from memory or
 * general PT knowledge.
 *
 * Checks (PASS/FAIL lines, exit 1 on any FAIL, style of lint-patterns.mjs):
 *   (a) every drill in prt.drills[] has the required top-level fields.
 *   (b) every exercise has the required fields, unique `order` per drill
 *       (1..N, no gaps or duplicates), and a `sourceStatus` that is one of
 *       the two real values this app's content ever uses.
 *   (c) THE GATE: no exercise has a non-null startingPosition or
 *       movementDescription while sourceStatus !== "verified".
 *   (d) every exercise with sourceStatus === "verified" actually HAS a
 *       real (non-empty-string) startingPosition and movementDescription -
 *       catches the opposite mistake (marking a record verified without
 *       actually filling it in).
 *
 * No dependencies beyond tools/seed-io.mjs. `--seed <path>` points it at a
 * different copy so the verifier can be verified.
 */
import { readSeed } from "./seed-io.mjs";

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const SEED_PATH = argOf("--seed") || "src/index.html";
const VALID_SOURCE_STATUS = ["pending-source", "verified"];

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const nonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

console.log("lint-prt-sources: no PRT exercise text ships without a real, verified source\n");

let data;
try {
  ({ data } = readSeed(SEED_PATH));
} catch (e) {
  bad(`could not read/parse the seed at ${SEED_PATH}: ${e.message}`);
  console.log("\nLINT-PRT-SOURCES: " + fails + " FAILURE(S)");
  process.exit(1);
}

const drills = (data.prt && Array.isArray(data.prt.drills)) ? data.prt.drills : null;
if (!drills) {
  bad("GUIDON_SEED.prt.drills is missing or not an array - expected at least an empty array");
} else {
  ok(`GUIDON_SEED.prt.drills is an array (${drills.length} drill(s))`);

  let totalExercises = 0;
  let gateViolations = 0;
  let verifiedButIncomplete = 0;

  drills.forEach((drill, di) => {
    const dLabel = `drills[${di}]${drill && drill.id ? ` ("${drill.id}")` : ""}`;
    if (!drill || typeof drill !== "object") { bad(`${dLabel} is not an object`); return; }
    ["id", "name", "cadence", "repRule", "exercises"].forEach((f) => {
      if (!(f in drill)) bad(`${dLabel} is missing required field "${f}"`);
    });
    if (!Array.isArray(drill.exercises)) return;

    const orders = [];
    drill.exercises.forEach((ex, ei) => {
      totalExercises++;
      const eLabel = `${dLabel}.exercises[${ei}]${ex && ex.id ? ` ("${ex.id}")` : ""}`;
      if (!ex || typeof ex !== "object") { bad(`${eLabel} is not an object`); return; }

      ["id", "drillId", "order", "name", "sourceStatus", "source"].forEach((f) => {
        if (!(f in ex)) bad(`${eLabel} is missing required field "${f}"`);
      });

      if (typeof ex.order === "number") orders.push(ex.order);
      else bad(`${eLabel}.order is not a number`);

      if (!VALID_SOURCE_STATUS.includes(ex.sourceStatus)) {
        bad(`${eLabel}.sourceStatus is "${ex.sourceStatus}", must be one of: ${VALID_SOURCE_STATUS.join(", ")}`);
      }

      // (c) THE GATE.
      const hasPosition = nonEmptyString(ex.startingPosition);
      const hasMovement = nonEmptyString(ex.movementDescription);
      if ((hasPosition || hasMovement) && ex.sourceStatus !== "verified") {
        gateViolations++;
        bad(`${eLabel} has a real startingPosition/movementDescription but sourceStatus is "${ex.sourceStatus}", not "verified" - this looks like real doctrine text that was never actually confirmed against ATP 7-22.02. Either mark it "verified" (only if it genuinely was transcribed from that source) or clear the text back to null.`);
      }

      // (d) the opposite mistake.
      if (ex.sourceStatus === "verified" && !(hasPosition && hasMovement)) {
        verifiedButIncomplete++;
        bad(`${eLabel} is marked sourceStatus:"verified" but is missing a real startingPosition and/or movementDescription - a verified record must actually carry the transcribed text, not just the label.`);
      }
    });

    const n = drill.exercises.length;
    const expected = Array.from({ length: n }, (_, i) => i + 1);
    const sortedOrders = [...orders].sort((a, b) => a - b);
    const ordersMatch = n > 0 && JSON.stringify(sortedOrders) === JSON.stringify(expected);
    if (n > 0 && !ordersMatch) {
      bad(`${dLabel}: exercise "order" values are ${JSON.stringify(orders)}, expected exactly 1..${n} with no gaps or duplicates`);
    } else if (n > 0) {
      ok(`${dLabel}: ${n} exercise(s), order 1..${n} with no gaps or duplicates`);
    }
  });

  if (totalExercises > 0 && !gateViolations) {
    ok(`(c) no unverified exercise carries real startingPosition/movementDescription text (${totalExercises} exercise(s) checked)`);
  }
  if (totalExercises > 0 && !verifiedButIncomplete) {
    ok(`(d) every "verified" exercise actually carries real startingPosition and movementDescription text`);
  }
}

console.log("\n" + (fails ? `LINT-PRT-SOURCES: ${fails} FAILURE(S)` : "LINT-PRT-SOURCES: all passed"));
process.exit(fails ? 1 : 0);
