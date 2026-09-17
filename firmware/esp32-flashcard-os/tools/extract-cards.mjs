#!/usr/bin/env node
/**
 * Extracts GUIDON's board-question flashcard bank (window.GUIDON_SEED.
 * board.questions inside guidon-app/src/index.html) into the lean, SD-
 * streamable format this firmware actually reads on-device.
 *
 * The desktop/mobile app also has pre-DOMContentLoaded board-supplement
 * modules in guidon-app/src/app-modules. This exporter executes those same
 * modules against the parsed seed before writing cards.ndjson, so the ESP32
 * fork cannot silently drift from the app's expanded promotion-board bank.
 *
 * WHY NOT JUST COPY THE APP'S OWN JSON: this ESP32-D0WD-V3 module has NO
 * PSRAM and 520KB of SRAM total (see HARDWARE.md). The app's own
 * board.questions is a large JSON bank, and each card carries fields this
 * fork's scope explicitly does not use - acceptableAnswer, boardAnswer,
 * keyPoints[], tier[], source, concept. Loading the full JSON into RAM on
 * device would blow the RAM budget before a single UI pixel is drawn.
 *
 * FORMAT ON THE MICROSD CARD (root of the card):
 *   /cards.ndjson    - one compact JSON object per line, one per card:
 *                        {"i":"bq1","c":"Army Values","q":"...","a":"..."}
 *   /categories.json - [{ "name": "Army Values", "count": 10, "offset": 0 }, ...]
 *
 * Run from firmware/esp32-flashcard-os/:  node tools/extract-cards.mjs
 * Writes into ./sdcard/ (gitignored - this is device content, not source).
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { readSeed } from "../../../guidon-app/tools/seed-io.mjs";

const SEED_PATH = "../../guidon-app/src/index.html";
const OUT_DIR = "./sdcard";
const SUPPLEMENT_MODULES = [
  "../../guidon-app/src/app-modules/00-board-supplement-core.js",
  "../../guidon-app/src/app-modules/01-board-supplement-92a.js",
  "../../guidon-app/src/app-modules/02-board-supplement-integration.js",
];

function applyBoardSupplements(data) {
  const sandbox = { window: { GUIDON_SEED: data, G: {} }, console };
  sandbox.window.window = sandbox.window;
  for (const path of SUPPLEMENT_MODULES) {
    const src = readFileSync(path, "utf8");
    vm.runInNewContext(src, sandbox, { filename: path });
  }
  const audit = sandbox.window.G.boardSupplement && sandbox.window.G.boardSupplement.audit;
  if (!audit || audit.complete !== true) {
    throw new Error("extract-cards: promotion-board supplement audit did not complete: " + JSON.stringify(audit || null));
  }
  return audit;
}

function main() {
  const { data } = readSeed(SEED_PATH);
  const audit = applyBoardSupplements(data);
  const all = (data.board && data.board.questions) || [];
  if (!all.length) throw new Error("extract-cards: board.questions is empty - seed shape changed?");

  // Stable grouping by category, preserving first-seen order (matches how
  // the app itself presents categories - not re-sorted alphabetically).
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
  console.log(`  promotion supplement: ${audit.accountedSourceCards}/${audit.expectedSourceCards} source cards, ${audit.accountedQAPromptLinks}/${audit.expectedQAPrompts} Q&A prompts accounted`);
  console.log(`  ${OUT_DIR}/cards.ndjson       ${(ndjsonBytes / 1024).toFixed(1)} KB`);
  console.log(`  ${OUT_DIR}/categories.json    ${order.length} entries`);
  console.log(`  (source board.questions was ${(Buffer.byteLength(JSON.stringify(all), "utf8") / 1024).toFixed(1)} KB - `
    + `${Math.round(100 - (ndjsonBytes / Buffer.byteLength(JSON.stringify(all), "utf8")) * 100)}% smaller, lean fields only)`);
}

main();
