/**
 * module-manifest: the ONE reader of src/app-modules/manifest.json.
 *
 * Why this exists (AUDIT-2026-09 section 6 item A, ROADMAP 3g A): since
 * 2026-09-16 features and content arrive as ~35 files in src/app-modules.
 * tools/build.mjs injected every *.js there in plain alphabetical order and
 * tools/assemble-bank.mjs picked "the numbered ones" by filename pattern, so
 * load order, which files carry content, and who depends on whom all lived in
 * FILENAMES. "00-" and "98-" prefixes are a convention nobody can lint. The
 * manifest says those things out loud, and this module is how every tool
 * reads it - the build, the headless bank and the contract test must never
 * each grow their own idea of the module list again (that is how the ESP32
 * deck ended up 61 cards short).
 *
 * What the manifest declares per module (see manifest.json's own "$doc"):
 *   file, id, kind, headless, requires, uses, provides, routes, storageKeys,
 *   clearsKeys, optionalApis, patches, hooks.
 * What is checked HERE (pure, no browser - so the build can fail fast):
 *   - a *.js file in the folder that the manifest does not list
 *   - a listed file that is not on disk
 *   - two entries sharing an id or a file
 *   - a "requires" that names an unknown id, itself, or a module that loads
 *     LATER (requires is a load-order promise)
 *   - a "uses" that names an unknown id or one that loads EARLIER (then it
 *     belongs in "requires"; "uses" is the declared exception for calls that
 *     only happen at run time, after every module has loaded)
 *   - a content pack that loads after the finalize pass (its cards would be
 *     left out of the pillar tags and the study-room fingerprint), or a
 *     content pack / finalize entry that is not headless (the content lints
 *     and the handheld exporter would never see it)
 *   - malformed fields
 * Every message names the file. What needs the RUNNING app (does a provided
 * name exist, is a route registered, does a module patch a core function it
 * did not declare) is tools/test-module-contract.mjs's job.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

export const APP_MODULE_DIR = fileURLToPath(new URL("../src/app-modules/", import.meta.url));
export const MANIFEST_NAME = "manifest.json";
export const KINDS = ["content-pack", "feature", "finalize", "release-note"];
export const PATCH_WHEN = ["load", "call"];
export const EMITS = ["build", "runtime"];
/** The effective "emit" of a module entry: the field if present, else the
 *  kind-based default (content-pack/finalize -> "build", everything else ->
 *  "runtime"). Centralised so a caller never re-derives this default. */
export const emitOf = (m) => m.emit || ((m.kind === "content-pack" || m.kind === "finalize") ? "build" : "runtime");

const API_NAME = /^G(\.[A-Za-z_$][\w$]*)+$/;
const ROUTE = /^#\/[a-z0-9-]+$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LIST_FIELDS = ["requires", "provides", "routes", "storageKeys", "optionalApis"];
const OPTIONAL_LIST_FIELDS = ["uses", "clearsKeys", "patches", "hooks"];

/** Every *.js file in the folder, in the order the build USED to inject them
 *  (plain .sort()). Kept only so the manifest can be compared with it. */
export function moduleFilesOnDisk(dir = APP_MODULE_DIR) {
  return readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
}

export function readManifest(dir = APP_MODULE_DIR) {
  const path = join(dir, MANIFEST_NAME);
  if (!existsSync(path)) throw new Error(`module manifest: ${path} does not exist - every file in src/app-modules must be listed there, in load order`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { throw new Error(`module manifest: ${path} is not valid JSON (${e.message})`); }
  return { manifest, path };
}

const isStrList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.trim());

function checkOptionalApis(list, where, problems) {
  if (!Array.isArray(list)) { problems.push(`${where}: "optionalApis" must be a list of { name, why }`); return; }
  for (const o of list) {
    if (!o || typeof o !== "object" || !API_NAME.test(String(o.name || ""))) { problems.push(`${where}: an "optionalApis" entry needs a "name" like "G.native.isNative" (got ${JSON.stringify(o)})`); continue; }
    if (typeof o.why !== "string" || o.why.trim().length < 8) problems.push(`${where}: optional API ${o.name} has no written reason - say WHY it may be missing (for example "native shell only")`);
  }
}

/**
 * Pure check. `onDisk` is the list of *.js file names actually in the folder.
 * Returns a list of problems (empty = valid); never throws.
 */
export function checkManifest(manifest, onDisk) {
  const problems = [];
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.modules)) {
    return ['manifest.json must be an object with a "modules" list'];
  }
  const core = manifest.core || {};
  if (core.optionalApis !== undefined) checkOptionalApis(core.optionalApis, "manifest.json core", problems);
  if (core.extensionPoints !== undefined && !isStrList(core.extensionPoints)) problems.push('manifest.json core: "extensionPoints" must be a list of names');

  const mods = manifest.modules;
  const byId = new Map(), byFile = new Map();
  mods.forEach((m, i) => {
    const where = `src/app-modules/${(m && m.file) || "(entry " + (i + 1) + ", no file)"}`;
    if (!m || typeof m !== "object") { problems.push(`${where}: entry is not an object`); return; }
    if (typeof m.file !== "string" || !/^[^\\/]+\.js$/.test(m.file)) problems.push(`${where}: "file" must be a plain *.js file name inside src/app-modules`);
    if (typeof m.id !== "string" || !ID.test(m.id)) problems.push(`${where}: "id" must be lower-case words joined by dashes (got ${JSON.stringify(m.id)})`);
    if (!KINDS.includes(m.kind)) problems.push(`${where}: "kind" must be one of ${KINDS.join(" | ")} (got ${JSON.stringify(m.kind)})`);
    if (typeof m.headless !== "boolean") problems.push(`${where}: "headless" must be true or false - true means tools/assemble-bank.mjs evaluates this file with no page`);
    if (m.kind === "content-pack" || m.kind === "finalize") {
      if (m.emit !== "build") problems.push(`${where}: a ${m.kind} must be "emit": "build" (got ${JSON.stringify(m.emit)}) - it calls G.contentPack.define() and is merged into the seed at build time, never spliced into the page as a <script>`);
    } else if (m.emit !== undefined && m.emit !== "runtime") {
      problems.push(`${where}: "emit" must be omitted or "runtime" for a ${m.kind} (got ${JSON.stringify(m.emit)}) - only content-pack and finalize modules may be "build"`);
    }
    for (const f of LIST_FIELDS) if (!Array.isArray(m[f])) problems.push(`${where}: "${f}" must be a list (use [] when there is nothing to declare)`);
    for (const f of OPTIONAL_LIST_FIELDS) if (m[f] !== undefined && !Array.isArray(m[f])) problems.push(`${where}: "${f}" must be a list when present`);
    for (const f of ["requires", "uses", "routes", "storageKeys", "clearsKeys", "provides", "hooks"]) if (Array.isArray(m[f]) && !isStrList(m[f])) problems.push(`${where}: "${f}" must contain only non-empty strings`);
    for (const p of (Array.isArray(m.provides) ? m.provides : [])) if (typeof p === "string" && !API_NAME.test(p)) problems.push(`${where}: "provides" entry ${JSON.stringify(p)} is not an API name like "G.opsecGuard.screen"`);
    for (const r of (Array.isArray(m.routes) ? m.routes : [])) if (typeof r === "string" && !ROUTE.test(r)) problems.push(`${where}: "routes" entry ${JSON.stringify(r)} is not a route like "#/pt-plan"`);
    if (Array.isArray(m.optionalApis)) checkOptionalApis(m.optionalApis, where, problems);
    for (const p of (Array.isArray(m.patches) ? m.patches : [])) {
      if (!p || typeof p !== "object" || !API_NAME.test(String(p.name || ""))) { problems.push(`${where}: a "patches" entry needs a "name" like "G.engine.run" (got ${JSON.stringify(p)})`); continue; }
      if (!PATCH_WHEN.includes(p.when)) problems.push(`${where}: patch ${p.name} needs "when": "load" (replaced as the file loads) or "call" (swapped while one of its own functions runs)`);
      if (typeof p.why !== "string" || p.why.trim().length < 8) problems.push(`${where}: patch ${p.name} has no written reason`);
    }
    if (typeof m.id === "string") { if (byId.has(m.id)) problems.push(`${where}: id "${m.id}" is already used by src/app-modules/${byId.get(m.id).file}`); else byId.set(m.id, m); }
    if (typeof m.file === "string") { if (byFile.has(m.file)) problems.push(`${where}: this file is listed twice`); else byFile.set(m.file, m); }
  });

  for (const f of onDisk) if (!byFile.has(f)) problems.push(`src/app-modules/${f}: not listed in manifest.json - add an entry where it should LOAD (order is the manifest's, not the file name's), or the build would silently leave it out`);
  for (const m of mods) if (m && typeof m.file === "string" && !onDisk.includes(m.file)) problems.push(`src/app-modules/${m.file}: listed in manifest.json (id "${m.id}") but there is no such file`);

  const position = new Map(mods.map((m, i) => [m && m.id, i]));
  let finalizeAt = -1;
  mods.forEach((m, i) => {
    if (!m || typeof m !== "object") return;
    const where = `src/app-modules/${m.file}`;
    for (const r of (isStrList(m.requires) ? m.requires : [])) {
      if (!position.has(r)) problems.push(`${where}: requires "${r}", which is not the id of any module in manifest.json`);
      else if (position.get(r) === i) problems.push(`${where}: requires itself`);
      else if (position.get(r) > i) problems.push(`${where}: requires "${r}", but src/app-modules/${mods[position.get(r)].file} loads LATER - move this entry below it, or, if the calls only happen after the app has started, declare it under "uses" instead`);
    }
    for (const u of (isStrList(m.uses) ? m.uses : [])) {
      if (!position.has(u)) problems.push(`${where}: uses "${u}", which is not the id of any module in manifest.json`);
      else if (position.get(u) <= i) problems.push(`${where}: uses "${u}", which loads earlier (or is this module) - an earlier module belongs under "requires"; "uses" is only for modules that load later and are called at run time`);
    }
    if ((m.kind === "content-pack" || m.kind === "finalize") && m.headless === false) problems.push(`${where}: a ${m.kind} must be "headless": true, or the content lints, the consistency counts and the handheld card exporter never see what it adds`);
    if (m.kind === "content-pack" && finalizeAt >= 0) problems.push(`${where}: a content pack must load BEFORE the finalize pass (src/app-modules/${mods[finalizeAt].file}) - cards added after it get no pillar tag and are left out of the study-room fingerprint`);
    if (m.kind === "finalize" && finalizeAt < 0) finalizeAt = i;
  });
  return problems;
}

/**
 * The checked module list, in load order. Throws ONE error listing every
 * problem (each line names the file) - callers print it and stop.
 */
export function loadModules(dir = APP_MODULE_DIR) {
  const { manifest, path } = readManifest(dir);
  const problems = checkManifest(manifest, moduleFilesOnDisk(dir));
  if (problems.length) throw new Error(`module manifest (${path}) has ${problems.length} problem(s):\n  - ` + problems.join("\n  - "));
  const modules = manifest.modules;
  return {
    manifest, path, modules,
    files: modules.map((m) => m.file),
    headlessFiles: modules.filter((m) => m.headless).map((m) => m.file),
  };
}

// CLI: node tools/module-manifest.mjs [--dir <app-modules folder>] [--check]
//   prints the load order (just the verdict with --check, for use in a lint chain); exits 1 on a problem.
// (pathToFileURL, not a file-name match: tools/test-module-manifest.mjs ends in the same letters.)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--dir");
  const dir = i > 0 && process.argv[i + 1] ? process.argv[i + 1] : APP_MODULE_DIR;
  try {
    const r = loadModules(dir);
    if (!process.argv.includes("--check")) r.modules.forEach((m, n) => console.log(String(n + 1).padStart(3) + "  " + m.file.padEnd(40) + m.kind.padEnd(14) + (m.headless ? "headless  " : "          ") + (m.requires.length ? "requires " + m.requires.join(", ") : "")));
    console.log(`\nmodule manifest ok: ${r.modules.length} modules, ${r.headlessFiles.length} evaluated headlessly`);
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
