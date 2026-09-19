#!/usr/bin/env node
/**
 * Extracts GUIDON's board-question flashcard bank (window.GUIDON_SEED.
 * board.questions inside guidon-app/src/index.html) into the lean, SD-
 * streamable format this firmware actually reads on-device.
 *
 * The desktop/mobile app also adds cards at load time from content packs in
 * guidon-app/src/app-modules. This exporter therefore reads the ASSEMBLED
 * bank (guidon-app/tools/assemble-bank.mjs: the seed plus EVERY numbered
 * pack, evaluated in the app's own load order) rather than the seed.
 *
 * It used to name three supplement modules by hand. Every pack added after
 * that list was written - the OPSEC curriculum, the Army-program and supply
 * cards - was silently missing from the handheld: 1,213 cards exported
 * against 1,274 in the app (2026-09-18 audit). There is no list any more; a
 * new pack is exported the moment its file exists.
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
import { writeFileSync, mkdirSync } from "node:fs";
import { assembleBank } from "../../../guidon-app/tools/assemble-bank.mjs";

const OUT_DIR = "./sdcard";

function main() {
  const assembled = assembleBank();
  const failed = assembled.modules.filter((m) => m.error);
  if (failed.length) throw new Error("extract-cards: content pack(s) failed to load: " + failed.map((m) => m.file + " (" + m.error + ")").join("; "));
  const data = assembled.data;
  const audit = assembled.G && assembled.G.boardSupplement && assembled.G.boardSupplement.audit;
  if (!audit || audit.complete !== true) {
    throw new Error("extract-cards: promotion-board supplement audit did not complete: " + JSON.stringify(audit || null));
  }
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
