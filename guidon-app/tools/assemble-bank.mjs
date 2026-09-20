/**
 * assemble-bank: the ONE way tooling sees GUIDON's content - the static seed
 * (window.GUIDON_SEED inside src/index.html) merged with every "emit":"build"
 * content pack, through tools/content-pack-engine.mjs.
 *
 * ROADMAP 3g E rewrite: before this, content only existed after a content
 * pack's <script> had run in a real browser, so this file ran the SAME
 * files a SECOND time, in its own hand-built node:vm sandbox, hoping never
 * to disagree with the real page (2026-09-18 audit of PRs #177-#183: it
 * once had, by 81 untagged cards and a fingerprint stamped before the deck
 * that was supposed to cover). Content packs now run through ONE authoring
 * call, G.contentPack.define(id, builder), and ONE engine that runs it -
 * tools/build.mjs bakes its result into the seed before the page ever
 * ships; this file is now a thin wrapper around the SAME engine, so a tool
 * and the real app cannot disagree by construction.
 *
 * WHICH files, and in WHAT order, still comes from src/app-modules/
 * manifest.json through tools/module-manifest.mjs - the same reader the
 * build uses (tools/content-pack-engine.mjs itself reads it), so the two
 * cannot disagree. A module is merged when its entry says "emit":"build"
 * (every content-pack and the finalize pass; enforced by
 * tools/module-manifest.mjs's checkManifest()) - a new pack is still
 * covered the moment it can ship.
 */
import { fileURLToPath } from "node:url";
import { readSeed } from "./seed-io.mjs";
import { loadModules, APP_MODULE_DIR } from "./module-manifest.mjs";
import { mergeContentPacks } from "./content-pack-engine.mjs";

export const SEED_PATH = fileURLToPath(new URL("../src/index.html", import.meta.url));
export { APP_MODULE_DIR };

/** Every module the manifest marks "headless": true, in manifest order -
 *  broader than "emit":"build" (it also covers headless FEATURE modules,
 *  such as 05-opsec-guard.js, that are safe to load with no DOM but never
 *  touch the seed). Kept for tools/test-module-manifest.mjs's own check that
 *  this list still agrees with the manifest; assembleBank() below no longer
 *  goes through it - see mergeContentPacks() in tools/content-pack-engine.mjs
 *  for the narrower "emit":"build" selection the actual bank merge uses. */
export function contentPackFiles(dir = APP_MODULE_DIR) {
  return loadModules(dir).headlessFiles;
}

/**
 * Returns { data, staticCounts, finalCounts, modules, logs, packs, finalized, G } -
 * see tools/content-pack-engine.mjs's mergeContentPacks() for the exact
 * shape of each field. `data` is the seed AFTER every "emit":"build" content
 * pack has run; a record a pack added carries a non-enumerable-free, plain
 * `__pack` provenance string ONLY in the returned copy (never written
 * anywhere) so lints can say which file a bad record came from - the same
 * contract this function always had.
 */
export function assembleBank({ seedPath = SEED_PATH, moduleDir = APP_MODULE_DIR } = {}) {
  const { data } = readSeed(seedPath);
  const merged = mergeContentPacks(data, moduleDir);
  // mergeContentPacks() itself never tags provenance - build.mjs calls it
  // directly (tools/build.mjs's mergeSeedContentPacks()) and a __pack key
  // must never leak into the shipped seed. This wrapper is the one caller
  // lints rely on for "which file added this record", so it derives the tag
  // from the same per-module added-counts the engine already returns: every
  // pack only ever APPENDS new records (never reorders or removes one), so
  // each pack's contribution is exactly the index range its own "added"
  // count carved out of the final, fully-merged array.
  const board = (data.board && data.board.questions) || [];
  const doctrine = (data.doctrine && data.doctrine.entries) || [];
  const scenarios = (data.scenarios && data.scenarios.scenarios) || [];
  let bi = 0, di = 0, si = 0;
  for (const m of merged.modules) {
    for (let i = 0; i < m.added.board; i++) { const r = board[bi + i]; if (r) r.__pack = m.file; }
    bi += m.added.board;
    for (let i = 0; i < m.added.doctrine; i++) { const r = doctrine[di + i]; if (r) r.__pack = m.file; }
    di += m.added.doctrine;
    for (let i = 0; i < m.added.scenarios; i++) { const r = scenarios[si + i]; if (r) r.__pack = m.file; }
    si += m.added.scenarios;
  }
  return merged;
}

// CLI: node tools/assemble-bank.mjs  -> prints the per-pack breakdown.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, "/").replace(/^([a-z]):/, (m, d) => d.toUpperCase() + ":") || (process.argv[1] || "").endsWith("assemble-bank.mjs")) {
  const r = assembleBank();
  console.log("static seed :", JSON.stringify(r.staticCounts));
  for (const m of r.modules) console.log("  " + m.file.padEnd(44) + (m.error ? "ERROR " + m.error : "+" + m.added.board + " cards, +" + m.added.doctrine + " doctrine, +" + m.added.scenarios + " scenarios"));
  console.log("assembled   :", JSON.stringify(r.finalCounts));
  if (r.logs.length) console.log("pack console output:\n  " + r.logs.join("\n  "));
  process.exit(r.modules.some((m) => m.error) ? 1 : 0);
}
