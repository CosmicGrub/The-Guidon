/**
 * Doctrine confidence-field completeness gate.
 *
 * WHY THIS EXISTS: every doctrine.entries record carries a "confidence"
 * field describing how much a Soldier should trust it at face value - the
 * seed's own header note defines the three valid values: "verified"
 * (current primary doctrine), "in_transition" (policy actively changing
 * in FY25-FY27 - flag it, don't just trust it), and "community"
 * (supplementary/board-prep framing, not itself a direct regulatory
 * citation). #/doctrine's own UI reads this field to drive real filtering
 * (showInTransition/showCommunity toggles, src/index.html ~8068-8069) -
 * an entry with NO confidence field is invisible to that filter logic in
 * a silent, easy-to-miss way: it always shows regardless of the toggle
 * state, which happens to look harmless for a "verified"-equivalent entry
 * but is a real filter-correctness bug for anything that should actually
 * be hideable as in_transition/community.
 *
 * 32 entries shipped with no confidence field at all until a dedicated
 * research pass (8 parallel batches + an adversarial consistency-review
 * pass, each independently web-verifying current doctrine status rather
 * than defaulting to "verified") backfilled all of them - see GUIDON
 * files/ROADMAP.md and CHANGELOG.md for the full accounting, including 3
 * real content fixes the same pass surfaced (a course-to-rank ladder
 * error, a superseded citation, a wrong secondary citation). This lint is
 * the mechanical backstop against a repeat: it fails CI if any future
 * doctrine.entries record ships without a valid confidence value, the
 * same "don't let a required tag silently go missing again" discipline
 * tools/lint-prt-sources.mjs already established for PrtExercise records.
 *
 * Checks (PASS/FAIL lines, exit 1 on any FAIL, style of lint-patterns.mjs):
 *   (a) doctrine.entries is a real array.
 *   (b) every entry has a "confidence" field.
 *   (c) every confidence value is one of the 3 valid values.
 *
 * `--seed <path>` points it at a different copy so the verifier can be
 * verified. No dependencies beyond tools/seed-io.mjs.
 */
import { readSeed } from "./seed-io.mjs";

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const SEED_PATH = argOf("--seed") || "src/index.html";
const VALID_CONFIDENCE = ["verified", "in_transition", "community"];

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

console.log("lint-doctrine-confidence: no doctrine entry ships without a real confidence tag\n");

let data;
try {
  ({ data } = readSeed(SEED_PATH));
} catch (e) {
  bad(`could not read/parse the seed at ${SEED_PATH}: ${e.message}`);
  console.log("\nLINT-DOCTRINE-CONFIDENCE: " + fails + " FAILURE(S)");
  process.exit(1);
}

const entries = (data.doctrine && Array.isArray(data.doctrine.entries)) ? data.doctrine.entries : null;
if (!entries) {
  bad("GUIDON_SEED.doctrine.entries is missing or not an array");
} else {
  ok(`GUIDON_SEED.doctrine.entries is an array (${entries.length} entries)`);

  let missing = 0;
  let invalid = 0;
  const counts = { verified: 0, in_transition: 0, community: 0 };

  entries.forEach((e, i) => {
    const label = `entries[${i}]${e && e.id ? ` ("${e.id}")` : ""}`;
    if (!e || typeof e !== "object") { bad(`${label} is not an object`); return; }
    if (!("confidence" in e) || e.confidence == null || e.confidence === "") {
      missing++;
      bad(`${label} has no confidence field - every doctrine entry must be tagged verified/in_transition/community`);
      return;
    }
    if (!VALID_CONFIDENCE.includes(e.confidence)) {
      invalid++;
      bad(`${label}.confidence is "${e.confidence}", must be one of: ${VALID_CONFIDENCE.join(", ")}`);
      return;
    }
    counts[e.confidence]++;
  });

  if (!missing) ok(`(b) no entry is missing a confidence field (${entries.length} entries checked)`);
  if (!invalid) ok(`(c) every present confidence value is one of the 3 valid values`);
  if (!missing && !invalid) {
    ok(`distribution: ${counts.verified} verified, ${counts.in_transition} in_transition, ${counts.community} community`);
  }
}

console.log("\n" + (fails ? `LINT-DOCTRINE-CONFIDENCE: ${fails} FAILURE(S)` : "LINT-DOCTRINE-CONFIDENCE: all passed"));
process.exit(fails ? 1 : 0);
