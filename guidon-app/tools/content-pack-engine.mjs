/**
 * content-pack-engine: the ONE place a "emit":"build" content pack actually
 * runs, and the ONE authoring surface every such pack calls -
 * G.contentPack.define(id, function (bank, ctx) { ... }).
 *
 * ROADMAP 3g item E. Why this exists: before this file, GUIDON's content was
 * assembled TWICE, by two independently-written evaluators that had to agree
 * by discipline alone. tools/build.mjs's assembleAppModules() spliced every
 * src/app-modules/*.js file into the shipped page as its own <script>, and a
 * "content-pack" file mutated window.GUIDON_SEED imperatively as it loaded in
 * the real browser. Because content only existed after those scripts ran in a
 * real DOM, every tool that needed "the true bank" (lint-content-packs.mjs,
 * content-manifest.mjs, test-content-packs.mjs, the ESP32 exporter) re-ran the
 * SAME files a second time, in the SAME order, inside a hand-built node:vm
 * sandbox (tools/assemble-bank.mjs) - a second evaluator that had already
 * drifted from the manifest once before (the "picks files that start with two
 * digits" era) and could drift again.
 *
 * The fix: content packs no longer mutate window.GUIDON_SEED at their IIFE's
 * top level. They call G.contentPack.define(id, builder) - the SAME call,
 * whether this engine runs it at BUILD TIME (tools/build.mjs, merging into
 * the static seed before it ever ships) or a TOOL runs it later against the
 * same static seed (tools/assemble-bank.mjs's thin wrapper). One evaluator,
 * two callers, so they cannot disagree - every tool that reads the seed sees
 * one bank by construction.
 *
 * This reuses the exact "fake window/G, real seed object" vm sandbox
 * tools/assemble-bank.mjs already proved works with no browser; only the
 * entry point changed, from "run the file, let it mutate window.GUIDON_SEED"
 * to "run the file, expect it to register itself; invoke its builder against
 * the real seed object; remember what it returned".
 *
 * ctx.pack(id): a content pack may read another pack's result ONLY when its
 * own manifest.json entry lists that id under "requires" - the engine builds
 * this gate from the manifest's own requires graph, so an undeclared
 * cross-pack call throws here, at build/lint time, rather than being
 * discoverable only by reading source (the manifest already promises
 * "requires" means "loads earlier"; this makes it also mean "the only ids you
 * may read").
 *
 * ctx.cite(text, quoteKind): the ONE way a pack writes a board card's
 * `source` (ROADMAP item F Wave 2) - see the method's own comment below.
 *
 * ctx.pillarFor(category): tools/pillar-map.mjs's REAL category -> pillar
 * table (by way of window.GUIDON_PILLAR_MAP, the same object the build
 * already injects for the running app - see tools/build.mjs and
 * tools/pillar-map.mjs's runtimePillarMap()). A pack that needs the richer
 * doctrine/scenario lane rules too (only 98-content-pack-finalize.js does)
 * reads window.GUIDON_PILLAR_MAP directly, unchanged from before.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { loadModules, APP_MODULE_DIR } from "./module-manifest.mjs";
import { runtimePillarMap } from "./pillar-map.mjs";
import { cite } from "./citation-parse.mjs";

const counts = (d) => ({
  board: ((d.board && d.board.questions) || []).length,
  doctrine: ((d.doctrine && d.doctrine.entries) || []).length,
  scenarios: ((d.scenarios && d.scenarios.scenarios) || []).length,
});

/**
 * Runs every "emit":"build" module (src/app-modules/manifest.json, read
 * through tools/module-manifest.mjs so this can never pick a different list
 * than the build does) against `seedObject` - the real, mutable seed tree
 * (the object that becomes window.GUIDON_SEED) - in manifest order.
 *
 * Returns { data, staticCounts, finalCounts, modules, logs, packs, finalized, G }:
 *   data          seedObject itself (mutated in place; returned for a
 *                 destructuring-friendly call site, same shape callers of the
 *                 old assembleBank() already expect).
 *   staticCounts  board/doctrine/scenario counts BEFORE any pack ran.
 *   finalCounts   the same counts AFTER every pack ran.
 *   modules       [{ file, added: { board, doctrine, scenarios }, error }],
 *                 one per emit:"build" module, in manifest order - the same
 *                 shape tools/assemble-bank.mjs returned before this file
 *                 existed, so downstream tools barely change.
 *   logs          console.warn/console.error calls made by any pack.
 *   packs         { [id]: <builder's return value> } - every pack's own
 *                 return value, keyed by manifest id (this is how a tool
 *                 that used to read a pack's state off window.G, such as
 *                 G.boardSupplement.audit or G.contentPacks.finalized, reads
 *                 it now).
 *   finalized     packs[<the kind:"finalize" module's id>], or null if this
 *                 run's module set has none - a convenience alias, since
 *                 there is always at most one.
 *   G             the sandbox's window.G, kept for parity with the previous
 *                 assembleBank() return shape; after migration a compliant
 *                 pack assigns nothing onto it directly (see
 *                 tools/module-manifest.mjs's emit:"build" source check), so
 *                 in practice it holds only G.contentPack.
 */
export function mergeContentPacks(seedObject, moduleDir = APP_MODULE_DIR) {
  const { modules: allModules } = loadModules(moduleDir);
  const buildModules = allModules.filter((m) => m.emit === "build");
  const staticCounts = counts(seedObject);

  const logs = [];
  const noop = () => {};
  const pillarMap = runtimePillarMap();
  const win = {
    GUIDON_SEED: seedObject, GUIDON_PILLAR_MAP: pillarMap, G: {},
    addEventListener: noop, removeEventListener: noop,
    location: { hash: "", href: "", protocol: "http:" },
    navigator: { userAgent: "content-pack-engine" },
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
  };
  win.window = win; win.self = win; win.globalThis = win;
  const sandbox = Object.assign(win, { console: { log: noop, info: noop, debug: noop, warn: (...a) => logs.push("warn: " + a.join(" ")), error: (...a) => logs.push("error: " + a.join(" ")) } });

  const registry = new Map(); // manifest id -> that pack's define() return value
  let current = null;         // the manifest entry whose file is running right now
  let definedThisFile = false;
  sandbox.G.contentPack = {
    define(id, builder) {
      if (!current) throw new Error(`G.contentPack.define("${id}", ...) was called outside of a content-pack file's own load`);
      if (typeof id !== "string" || !id) throw new Error(`${current.file}: G.contentPack.define() needs a non-empty string id`);
      if (id !== current.id) throw new Error(`${current.file}: G.contentPack.define("${id}", ...) does not match this file's own manifest id "${current.id}" - a pack may only define itself`);
      if (typeof builder !== "function") throw new Error(`${current.file}: G.contentPack.define("${id}", ...) needs a builder function`);
      if (definedThisFile) throw new Error(`${current.file}: G.contentPack.define() was called more than once`);
      definedThisFile = true;
      const requires = current.requires || [];
      const owner = current.file;
      const ctx = {
        pillarFor(category) { return (pillarMap.category || {})[category] || null; },
        // ROADMAP item F Wave 2: a board card's `source` is a structured
        // array, never a bare string. A pack keeps writing the readable
        // citation ("AR 600-9, para 3-9c; DA PAM 600-25") and calls
        // ctx.cite(text, quoteKind); the array it returns is what goes into
        // the bank. quoteKind is REQUIRED - "verbatim" only when the card's
        // By-the-Book text is a quotation from the cited publication,
        // "paraphrase" for study-guide wording, "synthesis" for text drawn
        // from several sources. It uses tools/citation-parse.mjs, the same
        // conservative parser the seed migration used, and
        // tools/lint-citation-schema.mjs fails CI on any card that reaches
        // the assembled bank with a string instead.
        cite(text, quoteKind) {
          try { return cite(text, quoteKind); }
          catch (e) { throw new Error(`${owner}: ctx.cite(${JSON.stringify(text)}, ${JSON.stringify(quoteKind)}) - ${e.message}`); }
        },
        pack(depId) {
          if (!requires.includes(depId)) throw new Error(`${owner}: ctx.pack("${depId}") is not declared under this module's "requires" in manifest.json`);
          if (!registry.has(depId)) throw new Error(`${owner}: ctx.pack("${depId}") has no result yet - "${depId}" must load earlier and must itself call G.contentPack.define()`);
          return registry.get(depId);
        },
        // A non-throwing check for an OPTIONAL cross-pack read: true only when
        // depId is both declared under "requires" and has actually produced a
        // result. Lets a pack reach for another one's state "if present"
        // (98-content-pack-finalize.js's own audit-sync is the one example
        // today) instead of hard-failing in a build, or a test fixture, that
        // legitimately does not carry that other pack.
        hasPack(depId) { return requires.includes(depId) && registry.has(depId); },
      };
      registry.set(id, builder(seedObject, ctx));
    },
  };
  vm.createContext(sandbox);

  const modules = [];
  for (const m of buildModules) {
    const before = counts(seedObject);
    current = m; definedThisFile = false;
    let error = null;
    try {
      vm.runInContext(readFileSync(join(moduleDir, m.file), "utf8"), sandbox, { filename: m.file });
      if (!definedThisFile) error = `did not call G.contentPack.define("${m.id}", ...)`;
    } catch (e) { error = (e && e.message) ? e.message : String(e); }
    const after = counts(seedObject);
    modules.push({ file: m.file, added: { board: after.board - before.board, doctrine: after.doctrine - before.doctrine, scenarios: after.scenarios - before.scenarios }, error });
    current = null;
  }

  const finalizeEntry = buildModules.find((m) => m.kind === "finalize");
  const finalized = finalizeEntry ? (registry.has(finalizeEntry.id) ? registry.get(finalizeEntry.id) : null) : null;
  return { data: seedObject, staticCounts, finalCounts: counts(seedObject), modules, logs, packs: Object.fromEntries(registry), finalized, G: sandbox.G };
}
