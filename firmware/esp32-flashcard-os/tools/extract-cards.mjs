#!/usr/bin/env node
/**
 * Extracts GUIDON's board-question flashcard bank (window.GUIDON_SEED.
 * board.questions inside guidon-app/src/index.html) into the lean, SD-
 * streamable format this firmware actually reads on-device.
 *
 * WHY NOT JUST COPY THE APP'S OWN JSON: this ESP32-D0WD-V3 module has NO
 * PSRAM and 520KB of SRAM total (see HARDWARE.md). The app's own
 * board.questions is 984 cards / ~2.56MB of JSON, and each card carries
 * fields this fork's scope explicitly does not use - acceptableAnswer,
 * boardAnswer, keyPoints[], tier[], source, concept (see the user's own
 * scope note: "just: all the flashcards, and the ability to sort and
 * navigate between topics/subjects" - no drilling/grading, so none of the
 * SRS/grading-support fields this app's Board Drill needs are relevant
 * here). Loading the full JSON into RAM at once, with a DOM-style parser,
 * would blow the RAM budget on its own before a single UI pixel is drawn.
 *
 * FORMAT ON THE MICROSD CARD (root of the card):
 *   /cards.ndjson    - one compact JSON object per line, one per card:
 *                        {"i":"bq1","c":"Army Values","q":"...","a":"..."}
 *                      main.cpp reads this file one line at a time with a
 *                      small fixed-size buffer - never the whole file.
 *   /categories.json - [{ "name": "Army Values", "count": 10, "offset": 0 },
 *                       ...], sorted the same order cards.ndjson uses.
 *                      "offset" is the byte offset of that category's FIRST
 *                      line in cards.ndjson, so switching subjects seeks
 *                      straight there instead of scanning from the top -
 *                      the only reason this index file exists at all.
 *
 * Run from firmware/esp32-flashcard-os/:  node tools/extract-cards.mjs
 * Writes into ./sdcard/ (gitignored - this is device content, not source;
 * flash-to-sd.md documents copying ./sdcard/*'s contents onto the real
 * microSD card).
 */
import { writeFileSync, mkdirSync } from "node:fs";
// NOTE the two different base paths below: the `import` is resolved
// relative to THIS FILE's own location (tools/, hence three "../"s up to
// the repo root), while SEED_PATH is a plain runtime string handed to
// fs.readFileSync inside seed-io.mjs, resolved relative to the process's
// current working directory - this script is documented as run from
// firmware/esp32-flashcard-os/, hence only two "../"s from there.
import { readSeed } from "../../../guidon-app/tools/seed-io.mjs";

const SEED_PATH = "../../guidon-app/src/index.html";
const OUT_DIR = "./sdcard";

function main() {
  const { data } = readSeed(SEED_PATH);
  const all = (data.board && data.board.questions) || [];
  if (!all.length) throw new Error("extract-cards: board.questions is empty - seed shape changed?");

  // Stable grouping by category, preserving first-seen order (matches how
  // the app itself presents categories - not re-sorted alphabetically,
  // so a Soldier who knows the app's own category order isn't surprised).
  const order = [];
  const byCat = new Map();
  for (const q of all) {
    const cat = q.category || "(uncategorized)";
    if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat); }
    byCat.get(cat).push(q);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  let ndjson = "";
  const categories = [];
  for (const cat of order) {
    const cards = byCat.get(cat);
    const offset = Buffer.byteLength(ndjson, "utf8");
    for (const q of cards) {
      // Lean shape: id, category, question, answer only - see file header.
      // `a` is board.questions' own `boardAnswer` when present (the fuller,
      // board-appropriate phrasing this app's own Board Drill treats as
      // the canonical spoken answer), falling back to `a` for any card
      // shape that doesn't carry boardAnswer.
      const line = JSON.stringify({
        i: q.id,
        c: cat,
        q: q.q,
        a: q.boardAnswer || q.a,
      });
      ndjson += line + "\n";
    }
    categories.push({ name: cat, count: cards.length, offset });
  }

  writeFileSync(`${OUT_DIR}/cards.ndjson`, ndjson, "utf8");
  writeFileSync(`${OUT_DIR}/categories.json`, JSON.stringify(categories), "utf8");

  const ndjsonBytes = Buffer.byteLength(ndjson, "utf8");
  console.log(`extract-cards: ${all.length} cards across ${order.length} categories`);
  console.log(`  ${OUT_DIR}/cards.ndjson       ${(ndjsonBytes / 1024).toFixed(1)} KB`);
  console.log(`  ${OUT_DIR}/categories.json    ${order.length} entries`);
  console.log(`  (source board.questions was ${(Buffer.byteLength(JSON.stringify(all), "utf8") / 1024).toFixed(1)} KB - `
    + `${Math.round(100 - (ndjsonBytes / Buffer.byteLength(JSON.stringify(all), "utf8")) * 100)}% smaller, lean fields only)`);
}

main();
