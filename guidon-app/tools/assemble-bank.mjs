/**
 * assemble-bank: the ONE way tooling sees GUIDON's content - the static seed
 * (window.GUIDON_SEED inside src/index.html) PLUS everything the content
 * packs in src/app-modules add to it when the page loads.
 *
 * Why this exists (2026-09-18 audit of PRs #177-#183): content started
 * arriving from numbered src/app-modules/NN-*.js "packs" that push into the
 * seed at load - 277 of the app's 1,274 board cards and 8 of its scenarios at
 * the time of writing. Every gate the seed is held to (lint-board-taxonomy,
 * the consistency counts, the pillar map, the duplicate-category guard) read
 * ONLY the static seed, so packs shipped 81 untagged cards, near-duplicate
 * categories ("Land Navigation" beside "Land Navigation (TC 3-25.26)") and
 * a duplicated question without anything noticing; the ESP32 card exporter
 * and the study-room bank fingerprint each hard-coded WHICH packs exist and
 * silently drifted (the handheld deck was 61 cards short).
 *
 * The fix is not another list of module names kept by this tool. It is this:
 * evaluate every headless module exactly the way the page does (same order
 * tools/build.mjs injects them in), with no browser, against a parsed copy of
 * the seed - and hand the RESULT to every tool.
 *
 * WHICH files, and in WHAT order, comes from src/app-modules/manifest.json
 * through tools/module-manifest.mjs - the same reader the build uses, so the
 * two cannot disagree. (This tool used to pick "files whose name starts with
 * two digits" and sort them itself: a second, implicit copy of the load
 * order.) A module is evaluated here when its entry says "headless": true;
 * the manifest check refuses a content pack or the finalize pass that is not,
 * and the build refuses a file that is not listed at all - so a new pack is
 * still covered the moment it can ship.
 *
 * The contract this imposes on a headless module (enforced by
 * tools/lint-content-packs.mjs): it must be loadable with no DOM - it may
 * read and extend window.GUIDON_SEED and hang things off window.G at load,
 * and must defer anything that needs the page (routes, views, listeners) to
 * DOMContentLoaded or a function called later. Every pack written so far
 * already works this way, because they all have to run before the app boots.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";
import { readSeed } from "./seed-io.mjs";
import { runtimePillarMap } from "./pillar-map.mjs";
import { loadModules, APP_MODULE_DIR } from "./module-manifest.mjs";

export const SEED_PATH = fileURLToPath(new URL("../src/index.html", import.meta.url));
export { APP_MODULE_DIR };

/** The modules evaluated headlessly, in manifest (= build) order. Throws,
 *  naming the file, if the manifest and the folder disagree - a bank
 *  assembled from a list the build would refuse is not worth linting. */
export function contentPackFiles(dir = APP_MODULE_DIR) {
  return loadModules(dir).headlessFiles;
}

const counts = (d) => ({
  board: ((d.board && d.board.questions) || []).length,
  doctrine: ((d.doctrine && d.doctrine.entries) || []).length,
  scenarios: ((d.scenarios && d.scenarios.scenarios) || []).length,
});

/**
 * Returns { data, staticCounts, finalCounts, modules: [{ file, added, error }] }.
 * `data` is the seed AFTER every pack has run; records a pack added carry a
 * non-enumerable-free, plain `__pack` provenance string ONLY in the returned
 * copy (never written anywhere) so lints can say which file a bad record
 * came from.
 */
export function assembleBank({ seedPath = SEED_PATH, moduleDir = APP_MODULE_DIR } = {}) {
  const { data } = readSeed(seedPath);
  const staticCounts = counts(data);
  const logs = [];
  const noop = () => {};
  const elementStub = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, appendChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] });
  const documentStub = { readyState: "loading", addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: elementStub, body: elementStub(), documentElement: elementStub(), head: elementStub() };
  const storageStub = { getItem: () => null, setItem: noop, removeItem: noop };
  const win = { GUIDON_SEED: data, GUIDON_PILLAR_MAP: runtimePillarMap(), G: {}, addEventListener: noop, removeEventListener: noop, document: documentStub, location: { hash: "", href: "", protocol: "http:" }, localStorage: storageStub, sessionStorage: storageStub, navigator: { userAgent: "assemble-bank" }, matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }), setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop };
  win.window = win; win.self = win; win.globalThis = win;
  const sandbox = Object.assign(win, { console: { log: noop, info: noop, debug: noop, warn: (...a) => logs.push("warn: " + a.join(" ")), error: (...a) => logs.push("error: " + a.join(" ")) } });
  vm.createContext(sandbox);

  const modules = [];
  const tag = (list, seen, file) => { for (const r of list) { if (r && !seen.has(r)) { seen.add(r); r.__pack = file; } } };
  const seenB = new Set(data.board.questions), seenD = new Set(data.doctrine.entries), seenS = new Set(data.scenarios.scenarios);
  for (const file of contentPackFiles(moduleDir)) {
    const before = counts(data);
    let error = null;
    try { vm.runInContext(readFileSync(join(moduleDir, file), "utf8"), sandbox, { filename: file }); }
    catch (e) { error = (e && e.message) ? e.message : String(e); }
    const after = counts(data);
    tag(data.board.questions, seenB, file); tag(data.doctrine.entries, seenD, file); tag(data.scenarios.scenarios, seenS, file);
    modules.push({ file, added: { board: after.board - before.board, doctrine: after.doctrine - before.doctrine, scenarios: after.scenarios - before.scenarios }, error });
  }
  return { data, staticCounts, finalCounts: counts(data), modules, logs, G: sandbox.G };
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
