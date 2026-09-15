/**
 * Tags every untagged seed record whose category / topic / lane is mapped
 * in tools/pillar-map.mjs with its ROADMAP.md §3f `pillar`. Re-runnable and
 * idempotent: an already-tagged record is never overwritten, a record
 * outside the map is left untagged BY DESIGN (see pillar-map.mjs), and a
 * run with nothing to do writes nothing.
 *
 * Run it after adding content (`node tools/backfill-pillars.mjs`), or let
 * lint-board-taxonomy's rule (f2) tell you which new record still needs it.
 * First run (2026-09-15): board 709, doctrine 259, scenarios 185 tagged.
 */
import { fileURLToPath } from "node:url";
import { readSeed, writeSeed } from "./seed-io.mjs";
import { pillarForBoard, pillarForDoctrine, pillarForScenario } from "./pillar-map.mjs";

const SEED_PATH = fileURLToPath(new URL("../src/index.html", import.meta.url));
const { data } = readSeed(SEED_PATH);

const counts = { board: 0, doctrine: 0, scenarios: 0, alreadyTagged: 0 };
const tag = (list, key, fn) => {
  for (const r of list) {
    if (r.pillar) { counts.alreadyTagged++; continue; }
    const p = fn(r);
    if (p) { r.pillar = p; counts[key]++; }
  }
};
tag(data.board.questions, "board", pillarForBoard);
tag(data.doctrine.entries, "doctrine", pillarForDoctrine);
tag(data.scenarios.scenarios, "scenarios", pillarForScenario);

const untaggedCats = [...new Set(data.board.questions.filter((q) => !q.pillar).map((q) => q.category))];
const untaggedTopics = [...new Set(data.doctrine.entries.filter((e) => !e.pillar).map((e) => e.topic))];
console.log("tagged: " + JSON.stringify(counts));
console.log("untagged by design - board categories (" + untaggedCats.length + "): " + untaggedCats.join(" | "));
console.log("untagged by design - doctrine topics (" + untaggedTopics.length + "): " + untaggedTopics.join(" | "));
const changed = counts.board + counts.doctrine + counts.scenarios;
if (changed) { const r = writeSeed(data, SEED_PATH); console.log(`wrote ${r.bytesWritten} bytes to ${r.path}`); }
else console.log("nothing to write - every mapped record already carries its pillar");
