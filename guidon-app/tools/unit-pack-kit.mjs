/**
 * unit-pack-kit: the ONE way a node tool gets at GUIDON's unit-deck validator.
 *
 * A unit deck is checked by src/app-modules/unit-decks-core.js - the same file
 * the app runs. A tool must not keep its own copy of those rules, because the
 * day the copy drifts, the authoring command would bless a deck the app then
 * refuses (or the reverse). So this loads the app's OWN two files, in the
 * app's own manifest order, into a node:vm sandbox with no page:
 *
 *   05-opsec-guard.js       G.opsecGuard.screen - the sensitive-text check
 *   unit-decks-core.js      G.unitPack          - format, limits, schema, screen
 *
 * The sandbox has a window, an inert document and navigator.webdriver = true
 * (which is what stops the guard's first-run "Before you start" dialog from
 * being scheduled). Nothing else is provided: no storage, no network.
 *
 * Used by tools/make-unit-pack.mjs and tools/test-unit-*.mjs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { loadModules, APP_MODULE_DIR } from "./module-manifest.mjs";

const FILES = ["opsec-guard", "unit-decks-core"];

/** Returns the sandbox's window.G. `moduleDir` lets a test load a planted copy. */
export function loadUnitPackKit({ moduleDir = APP_MODULE_DIR } = {}) {
  const { modules } = loadModules(APP_MODULE_DIR);
  const noop = () => {};
  const win = {
    G: {},
    navigator: { webdriver: true, userAgent: "unit-pack-kit" },
    document: { readyState: "complete", addEventListener: noop },
    console: { log: noop, info: noop, debug: noop, warn: noop, error: noop },
    setTimeout: noop, clearTimeout: noop,
  };
  win.window = win; win.self = win; win.globalThis = win;
  vm.createContext(win);
  for (const id of FILES) {
    const m = modules.find((x) => x.id === id);
    if (!m) throw new Error(`unit-pack-kit: src/app-modules/manifest.json has no module "${id}"`);
    vm.runInContext(readFileSync(join(moduleDir, m.file), "utf8"), win, { filename: m.file });
  }
  if (!win.G.unitPack || typeof win.G.unitPack.validate !== "function") throw new Error("unit-pack-kit: unit-decks-core.js did not define G.unitPack");
  return win.G;
}

/** The node twin of the page's parser, for the agreement test: tools/citation-parse.mjs, untouched. */
export { cite as nodeCite, parseSource as nodeParseSource, regulationsOfEntries as nodeRegulationsOfEntries, startsWithDesignator as nodeStartsWithDesignator } from "./citation-parse.mjs";
export { renderCitation as nodeRenderCitation } from "./cite-schema.mjs";
