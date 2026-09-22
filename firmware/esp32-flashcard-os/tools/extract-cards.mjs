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
 * THE EXPORT IS CHECKED AGAINST THE CONTENT MANIFEST before a byte is
 * written. guidon-app/tools/content-manifest.json is the committed, reviewed
 * record of what the bank holds (total cards, cards per category, the bank
 * fingerprint). The lines this exporter is about to write are counted back
 * and must match it exactly; on any mismatch it stops, says which figure is
 * off, and writes nothing - so a short deck can never reach a handheld
 * quietly again.
 *
 * Run from firmware/esp32-flashcard-os/:  node tools/extract-cards.mjs
 * Writes into ./sdcard/ (gitignored - this is device content, not source).
 * --out <dir> writes somewhere else; --manifest <file> checks against another
 * manifest (guidon-app/tools/test-content-manifest.mjs uses both to prove the
 * check fails on a planted 61-card gap).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { assembleBank } from "../../../guidon-app/tools/assemble-bank.mjs";
import { loadManifest, MANIFEST_PATH } from "../../../guidon-app/tools/content-manifest.mjs";

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 1 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const OUT_DIR = argOf("--out") || "./sdcard";
const MANIFEST = argOf("--manifest") || MANIFEST_PATH;

/** Count the export back from the very text that will be written and compare
 *  it with the manifest. Returns the list of mismatches, in plain words. */
function exportMismatches(ndjson, categories, fingerprint, manifest) {
  const problems = [];
  const lines = ndjson.split("\n").filter(Boolean);
  if (lines.length !== manifest.totals.board) problems.push(`cards: exporting ${lines.length}, the content manifest says ${manifest.totals.board} (${lines.length < manifest.totals.board ? manifest.totals.board - lines.length + " missing" : lines.length - manifest.totals.board + " extra"})`);
  const exported = new Map(categories.map((c) => [c.name, c.count]));
  const reviewed = manifest.board.byCategory;
  for (const name of new Set([...exported.keys(), ...Object.keys(reviewed)])) {
    const got = exported.get(name) || 0, want = reviewed[name] || 0;
    if (got !== want) problems.push(`category "${name}": exporting ${got}, the content manifest says ${want}`);
  }
  const perCategory = categories.reduce((n, c) => n + c.count, 0);
  if (perCategory !== lines.length) problems.push(`categories.json adds up to ${perCategory} cards but cards.ndjson has ${lines.length} lines`);
  if (fingerprint !== manifest.fingerprint) problems.push(`bank fingerprint: this bank is ${fingerprint}, the content manifest says ${manifest.fingerprint}`);
  return problems;
}

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

  // Stable grouping by category, preserving first-seen order (matches how
  // the app itself presents categories - not re-sorted alphabetically).
  const order = [];
  const byCat = new Map();
  for (const q of all) {
    const cat = q.category || "(uncategorized)";
    if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat); }
    byCat.get(cat).push(q);
  }

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

  const manifest = loadManifest(MANIFEST);
  const problems = exportMismatches(ndjson, categories, data.board.contentHash, manifest);
  if (problems.length) {
    const shown = problems.slice(0, 12).concat(problems.length > 12 ? [`... and ${problems.length - 12} more`] : []);
    throw new Error(["extract-cards: the export does not match the content manifest - NOTHING WAS WRITTEN.",
      ...shown.map((p) => "  - " + p),
      "  If the app's content really changed, regenerate the manifest first (from guidon-app/): node tools/content-manifest.mjs --write",
      "  If it did not, cards are being lost between the bank and this exporter - find out where before flashing a card."].join("\n"));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/cards.ndjson`, ndjson, "utf8");
  writeFileSync(`${OUT_DIR}/categories.json`, JSON.stringify(categories), "utf8");

  const ndjsonBytes = Buffer.byteLength(ndjson, "utf8");
  console.log(`extract-cards: ${all.length} cards across ${order.length} categories - matches the content manifest card for card (fingerprint ${manifest.fingerprint})`);
  console.log(`  promotion supplement: ${audit.accountedSourceCards}/${audit.expectedSourceCards} source cards, ${audit.accountedQAPromptLinks}/${audit.expectedQAPrompts} Q&A prompts accounted`);
  console.log(`  ${OUT_DIR}/cards.ndjson       ${(ndjsonBytes / 1024).toFixed(1)} KB`);
  console.log(`  ${OUT_DIR}/categories.json    ${order.length} entries`);
  console.log(`  (source board.questions was ${(Buffer.byteLength(JSON.stringify(all), "utf8") / 1024).toFixed(1)} KB - `
    + `${Math.round(100 - (ndjsonBytes / Buffer.byteLength(JSON.stringify(all), "utf8")) * 100)}% smaller, lean fields only)`);
}

main();
