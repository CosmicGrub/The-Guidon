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
 *   /categories.json - [{ "name": "Army Values", "count": 10, "offset": 0, "lanes": ["default"] }, ...]
 *   /lanes.json      - {"schema":1,"lanes":[{ "id": "default", "label": "Standard deck", "count": 1283, "categories": [...] }, ...]}
 *
 * DECKS (LANES). The app hides every MOS-specific card (92A, 68W, ...) until a
 * Soldier opts in; the handheld does the same. The DEFAULT lane holds every
 * card with no MOS tag and none with one, and each MOS deck the bank registers
 * is a lane of its own. The device shows the default lane until the Soldier
 * picks another in Settings. cards.ndjson still holds EVERY card, exactly as
 * before lanes existed, and each categories.json entry only gains its "lanes"
 * list, so older firmware (and the microSD it already has) keeps working
 * unchanged. See tools/lanes.mjs for how lanes are worked out and checked.
 *
 * THE EXPORT IS CHECKED AGAINST THE CONTENT MANIFEST before a byte is
 * written. guidon-app/tools/content-manifest.json is the committed, reviewed
 * record of what the bank holds (total cards, cards per category, cards per
 * MOS deck, the bank fingerprint). The lines this exporter is about to write
 * are counted back and must match it exactly - and every lane must hold
 * exactly the cards the bank's own MOS tags put in it, the default lane none
 * of the MOS ones; on any mismatch it stops, says which figure is off, and
 * writes nothing - so a short deck, or an MOS card in the default lane, can
 * never reach a handheld quietly.
 *
 * Run from firmware/esp32-flashcard-os/:  node tools/extract-cards.mjs
 * Writes into ./sdcard/ (gitignored - this is device content, not source).
 * --out <dir> writes somewhere else; --manifest <file> checks against another
 * manifest (guidon-app/tools/test-content-manifest.mjs uses both to prove the
 * check fails on a planted 61-card gap; guidon-app/tools/test-esp32-lanes.mjs
 * does the same for the lanes).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { assembleBank } from "../../../guidon-app/tools/assemble-bank.mjs";
import { loadManifest, MANIFEST_PATH } from "../../../guidon-app/tools/content-manifest.mjs";
import { mosRegistry, buildExport, allMismatches, lanesJson } from "./lanes.mjs";

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 1 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const OUT_DIR = argOf("--out") || "./sdcard";
const MANIFEST = argOf("--manifest") || MANIFEST_PATH;

function main() {
  const assembled = assembleBank();
  const failed = assembled.modules.filter((m) => m.error);
  if (failed.length) throw new Error("extract-cards: content pack(s) failed to load: " + failed.map((m) => m.file + " (" + m.error + ")").join("; "));
  const data = assembled.data;
  // ROADMAP 3g E: 02-board-supplement-integration.js's audit no longer hangs
  // off window.G (content packs stopped touching it) - it is that pack's own
  // G.contentPack.define() return value, reached by id.
  const integration = assembled.packs && assembled.packs["board-supplement-integration"];
  const audit = integration && integration.audit;
  if (!audit || audit.complete !== true) {
    throw new Error("extract-cards: promotion-board supplement audit did not complete: " + JSON.stringify(audit || null));
  }
  const all = (data.board && data.board.questions) || [];
  if (!all.length) throw new Error("extract-cards: board.questions is empty - seed shape changed?");

  // Stable grouping by category (and lane), preserving first-seen order
  // (matches how the app itself presents categories - not re-sorted
  // alphabetically). Every category is wholly in one lane today, so this is
  // the same grouping, byte for byte, this exporter always wrote.
  const registry = mosRegistry(data);
  const built = buildExport(all, registry);
  const { ndjson, categories, lanes } = built;
  const order = categories;

  const manifest = loadManifest(MANIFEST);
  const problems = [...built.problems, ...allMismatches(built, all, registry, data.board.contentHash, manifest)];
  if (problems.length) {
    const shown = problems.slice(0, 12).concat(problems.length > 12 ? [`... and ${problems.length - 12} more`] : []);
    throw new Error(["extract-cards: the export does not match the content manifest - NOTHING WAS WRITTEN.",
      ...shown.map((p) => "  - " + p),
      "  If the app's content really changed, regenerate the manifest first (from guidon-app/): node tools/content-manifest.mjs --write",
      "  If it did not, cards are being lost between the bank and this exporter - find out where before flashing a card."].join("\n"));
  }

  // The text of all three files is made BEFORE any is written, so a lanes list
  // the serializer refuses (no default lane) still leaves nothing on disk.
  const lanesText = lanesJson(lanes);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/cards.ndjson`, ndjson, "utf8");
  writeFileSync(`${OUT_DIR}/categories.json`, JSON.stringify(categories), "utf8");
  writeFileSync(`${OUT_DIR}/lanes.json`, lanesText, "utf8");

  const ndjsonBytes = Buffer.byteLength(ndjson, "utf8");
  console.log(`extract-cards: ${all.length} cards across ${order.length} categories - matches the content manifest card for card (fingerprint ${manifest.fingerprint})`);
  console.log(`  promotion supplement: ${audit.accountedSourceCards}/${audit.expectedSourceCards} source cards, ${audit.accountedQAPromptLinks}/${audit.expectedQAPrompts} Q&A prompts accounted`);
  console.log(`  ${OUT_DIR}/cards.ndjson       ${(ndjsonBytes / 1024).toFixed(1)} KB`);
  console.log(`  ${OUT_DIR}/categories.json    ${order.length} entries`);
  console.log(`  ${OUT_DIR}/lanes.json         ${lanes.length} decks: ` + lanes.map((l) => `${l.id} ${l.count}`).join(", "));
  console.log(`  (source board.questions was ${(Buffer.byteLength(JSON.stringify(all), "utf8") / 1024).toFixed(1)} KB - `
    + `${Math.round(100 - (ndjsonBytes / Buffer.byteLength(JSON.stringify(all), "utf8")) * 100)}% smaller, lean fields only)`);
}

main();
