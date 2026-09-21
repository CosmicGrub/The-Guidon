/**
 * Module manifest (src/app-modules/manifest.json) and its ONE reader
 * (tools/module-manifest.mjs). Pure node, no browser.
 *
 * What this pins, and why each matters:
 *
 *  - the real manifest is valid and lists EVERY *.js file in the folder.
 *    Until 2026-09 the build injected whatever was in the folder in
 *    alphabetical order; the manifest replaced that, so a file that is not
 *    listed would silently stop shipping - it has to be a build failure.
 *  - the first manifest reproduces the old alphabetical order exactly
 *    (RATCHET below), so moving to manifest order changed nothing a Soldier
 *    can see. A later, deliberate reorder updates the ratchet in the same
 *    change - that is the point: load order is now a reviewed decision.
 *  - tools/assemble-bank.mjs (the headless bank the lints, the counts and the
 *    handheld exporter read) takes its files from the same manifest.
 *  - the real build refuses, naming the file, when: a file is unlisted, a
 *    listed file is missing, a "requires" is unknown or loads later, two
 *    entries share an id or a file. Each refusal is proven against a planted
 *    defect in a stand-in folder (GUIDON_APP_MODULE_DIR / --dir), the same
 *    way tools/lint-ci-matrix.mjs is proven by tools/test-release-pipeline.mjs.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModules, checkManifest, readManifest, moduleFilesOnDisk, APP_MODULE_DIR, KINDS } from "./module-manifest.mjs";
import { contentPackFiles, assembleBank } from "./assemble-bank.mjs";
import { assembleAppModules } from "./build.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));

console.log("module manifest: one declared load order, read by the build and the headless bank\n");

/* ---- the real manifest ---- */
let real = null;
try { real = loadModules(); ok(`src/app-modules/manifest.json is valid: ${real.modules.length} modules, every *.js file in the folder listed once`); }
catch (e) { bad("the real manifest does not load: " + e.message); }

if (real) {
  const onDisk = moduleFilesOnDisk();
  check(real.files.length === onDisk.length && onDisk.every((f) => real.files.includes(f)),
    `manifest files and the folder agree (${onDisk.length} files)`,
    "manifest files and the folder differ: " + JSON.stringify({ unlisted: onDisk.filter((f) => !real.files.includes(f)), missing: real.files.filter((f) => !onDisk.includes(f)) }));

  // RATCHET: the first manifest must reproduce the order the build used until
  // now (plain .sort() of the folder). When a later change reorders modules on
  // purpose, set this to false in that same change and say why in the commit.
  //
  // ROADMAP 3g "customizable screen layouts" Phase A: date-grid.js
  // (src/app-modules/date-grid.js) was inserted right before calendar.js -
  // "date-grid" sorts alphabetically AFTER "calendar", but it must LOAD
  // before both calendar.js and pt-planner.js (each declares it under their
  // own "requires": ["date-grid"], and module-manifest.mjs's own load-order
  // check enforces that a "requires" target sits at an earlier array
  // position). Alphabetical order could not satisfy that dependency, so this
  // is exactly the "later, deliberate reorder" this ratchet exists to allow.
  const ORDER_IS_STILL_ALPHABETICAL = false;
  if (ORDER_IS_STILL_ALPHABETICAL) {
    const firstDiff = real.files.findIndex((f, i) => f !== onDisk[i]);
    check(firstDiff === -1, "manifest order is exactly the alphabetical order the build used before the manifest existed - behaviour unchanged",
      `manifest order departs from the old alphabetical order at position ${firstDiff + 1}: manifest has ${real.files[firstDiff]}, alphabetical has ${onDisk[firstDiff]}`);
  }

  check(real.modules.every((m) => KINDS.includes(m.kind)), "every entry has a known kind", "an entry has an unknown kind");
  const packs = real.modules.filter((m) => m.kind === "content-pack" || m.kind === "finalize");
  check(packs.length > 0 && packs.every((m) => m.headless), `all ${packs.length} content packs and the finalize pass are evaluated headlessly`, "a content pack is not headless");

  // The headless bank reads the SAME list (it used to pick "files that start with two digits").
  const headless = contentPackFiles();
  check(JSON.stringify(headless) === JSON.stringify(real.headlessFiles),
    `tools/assemble-bank.mjs evaluates exactly the manifest's headless files, in manifest order (${headless.length})`,
    "assemble-bank's file list differs from the manifest's headless list: " + JSON.stringify({ assemble: headless, manifest: real.headlessFiles }));
  const bank = assembleBank();
  check(JSON.stringify(bank.modules.map((m) => m.file)) === JSON.stringify(real.headlessFiles) && bank.modules.every((m) => !m.error),
    "assembleBank() ran those files in that order with no error", "assembleBank() ran " + JSON.stringify(bank.modules.map((m) => [m.file, m.error])));
}

/* ---- planted defects: the checker and the REAL build must both refuse, naming the file ---- */
const scratch = mkdtempSync(join(tmpdir(), "guidon-module-manifest-"));
try {
  const A = "10-alpha.js", B = "20-bravo.js", C = "charlie.js";
  const entry = (file, id, extra = {}) => Object.assign({ file, id, kind: "feature", headless: false, requires: [], provides: [], routes: [], storageKeys: [], optionalApis: [] }, extra);
  const standIn = (name, files, modules) => {
    const dir = join(scratch, name); mkdirSync(dir, { recursive: true });
    for (const f of files) writeFileSync(join(dir, f), "/* stand-in */\n");
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ modules }, null, 2));
    return dir;
  };
  const cases = [
    { name: "clean", files: [A, B, C], modules: [entry(A, "alpha"), entry(B, "bravo", { requires: ["alpha"] }), entry(C, "charlie", { requires: ["alpha", "bravo"] })], expect: null },
    { name: "unlisted-file", files: [A, B, C], modules: [entry(A, "alpha"), entry(B, "bravo")], expect: /charlie\.js: not listed in manifest\.json/ },
    { name: "missing-file", files: [A, B], modules: [entry(A, "alpha"), entry(B, "bravo"), entry(C, "charlie")], expect: /charlie\.js: listed in manifest\.json .* but there is no such file/ },
    { name: "requires-unknown", files: [A, B], modules: [entry(A, "alpha"), entry(B, "bravo", { requires: ["delta"] })], expect: /20-bravo\.js: requires "delta", which is not the id of any module/ },
    { name: "requires-later", files: [A, B], modules: [entry(A, "alpha", { requires: ["bravo"] }), entry(B, "bravo")], expect: /10-alpha\.js: requires "bravo", but src\/app-modules\/20-bravo\.js loads LATER/ },
    { name: "duplicate-id", files: [A, B], modules: [entry(A, "alpha"), entry(B, "alpha")], expect: /20-bravo\.js: id "alpha" is already used by src\/app-modules\/10-alpha\.js/ },
    { name: "duplicate-file", files: [A], modules: [entry(A, "alpha"), entry(A, "alpha-again")], expect: /10-alpha\.js: this file is listed twice/ },
    { name: "uses-earlier", files: [A, B], modules: [entry(A, "alpha"), entry(B, "bravo", { uses: ["alpha"] })], expect: /20-bravo\.js: uses "alpha", which loads earlier/ },
    { name: "pack-after-finalize", files: [A, B], modules: [entry(A, "alpha", { kind: "finalize", headless: true }), entry(B, "bravo", { kind: "content-pack", headless: true })], expect: /20-bravo\.js: a content pack must load BEFORE the finalize pass/ },
    { name: "pack-not-headless", files: [A], modules: [entry(A, "alpha", { kind: "content-pack", headless: false })], expect: /10-alpha\.js: a content-pack must be "headless": true/ },
    { name: "optional-without-reason", files: [A], modules: [entry(A, "alpha", { optionalApis: [{ name: "G.native.isNative", why: "" }] })], expect: /10-alpha\.js: optional API G\.native\.isNative has no written reason/ },
    { name: "patch-without-when", files: [A], modules: [entry(A, "alpha", { patches: [{ name: "G.engine.run", why: "because it has to for now" }] })], expect: /10-alpha\.js: patch G\.engine\.run needs "when"/ },
  ];
  for (const c of cases) {
    const dir = standIn(c.name, c.files, c.modules);
    const problems = checkManifest(readManifest(dir).manifest, moduleFilesOnDisk(dir));
    const cli = spawnSync(process.execPath, ["tools/module-manifest.mjs", "--dir", dir], { encoding: "utf8" });
    if (c.expect === null) {
      check(problems.length === 0 && cli.status === 0, `stand-in "${c.name}": a well-formed manifest is accepted`, `stand-in "${c.name}" was refused: ${JSON.stringify(problems)} ${cli.stderr}`);
    } else {
      check(problems.some((p) => c.expect.test(p)), `planted defect "${c.name}": refused, naming the file`, `planted defect "${c.name}" was NOT reported as ${c.expect} - got ${JSON.stringify(problems)}`);
      check(cli.status === 1 && c.expect.test(cli.stderr), `planted defect "${c.name}": the command-line check exits 1 with the same message`, `planted defect "${c.name}": cli exit ${cli.status}, stderr ${JSON.stringify(cli.stderr.slice(0, 300))}`);
    }
  }

  // ORDER is the manifest's, not the file name's: the build's own function,
  // given a stand-in whose manifest lists charlie, alpha, bravo, must emit
  // them in THAT order. (The alphabetical readdir() it replaced emits
  // alpha, bravo, charlie - so this fails on the old build.)
  {
    const dir = join(scratch, "reordered"); mkdirSync(dir);
    for (const f of [A, B, C]) writeFileSync(join(dir, f), `/* MARK:${f} */\n`);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ modules: [entry(C, "charlie"), entry(A, "alpha", { requires: ["charlie"] }), entry(B, "bravo", { requires: ["alpha"] })] }));
    const out = await assembleAppModules(dir);
    const seen = [...out.matchAll(/\/\* MARK:([^ ]+) \*\//g)].map((m) => m[1]);
    check(JSON.stringify(seen) === JSON.stringify([C, A, B]), "the build injects modules in MANIFEST order even when that is not alphabetical (charlie, alpha, bravo)", "build order for a reordered manifest was " + JSON.stringify(seen));
    check(out.startsWith("<script>\nwindow.GUIDON_PILLAR_MAP = "), "the pillar map is still injected ahead of the first module", "the pillar-map script is no longer first");
  }

  // The built outputs: every manifest module exactly once, in manifest order,
  // and dist/ and web/ carry the SAME module bytes (one bundle on every fork).
  if (real && existsSync("web/index.html") && existsSync("dist/guidon-standalone.html")) {
    const expected = await assembleAppModules(APP_MODULE_DIR);
    for (const out of ["web/index.html", "dist/guidon-standalone.html"]) {
      const html = readFileSync(out, "utf8");
      const at = html.indexOf(expected);
      check(at > 0 && html.indexOf(expected, at + 1) === -1, `${out} carries the pillar map and all ${real.files.length} modules, byte for byte, once, in manifest order`, `${out} does not contain the manifest-ordered module block exactly once (rebuild? index ${at})`);
    }
  } else bad("web/index.html or dist/guidon-standalone.html is missing - run `npm run build` before this suite");

  // The REAL build, pointed at a stand-in copy of the real folder with one
  // extra, unlisted file - it must stop before writing anything, and name it.
  if (real) {
    const copy = join(scratch, "real-copy"); mkdirSync(copy);
    for (const f of [...real.files, "manifest.json"]) copyFileSync(join(APP_MODULE_DIR, f), join(copy, f));
    writeFileSync(join(copy, "zz-not-in-manifest.js"), "/* a module someone forgot to list */\n");
    const stamp = (p) => (existsSync(p) ? readFileSync(p, "utf8").length : -1);
    const before = [stamp("web/index.html"), stamp("dist/guidon-standalone.html")];
    const r = spawnSync(process.execPath, ["tools/build.mjs"], { encoding: "utf8", env: { ...process.env, GUIDON_APP_MODULE_DIR: copy } });
    check(r.status === 1 && /zz-not-in-manifest\.js: not listed in manifest\.json/.test(r.stderr + r.stdout),
      "the real build fails, naming the file, when a module in the folder is not in the manifest",
      `build with an unlisted module: exit ${r.status}, output ${JSON.stringify((r.stderr + r.stdout).slice(0, 400))}`);
    const after = [stamp("web/index.html"), stamp("dist/guidon-standalone.html")];
    check(JSON.stringify(before) === JSON.stringify(after), "and it stopped before touching web/ or dist/", "the refused build still rewrote an output file");

    // The switch that made the check above possible must not be a way to SHIP.
    // A VALID stand-in - the real folder plus one extra module that its manifest
    // does list - would otherwise be built into web/ and dist/ by anyone (or any
    // CI job) with the variable left set, and the build would still say "build ok".
    const valid = join(scratch, "valid-copy"); mkdirSync(valid);
    for (const f of real.files) copyFileSync(join(APP_MODULE_DIR, f), join(valid, f));
    const MARK = "STAND-IN-MODULE-" + process.pid;
    writeFileSync(join(valid, "zz-stand-in.js"), `/* ${MARK} */\n`);
    const m2 = JSON.parse(readFileSync(join(APP_MODULE_DIR, "manifest.json"), "utf8"));
    m2.modules.push(entry("zz-stand-in.js", "zz-stand-in"));
    writeFileSync(join(valid, "manifest.json"), JSON.stringify(m2));
    const r2 = spawnSync(process.execPath, ["tools/build.mjs"], { encoding: "utf8", env: { ...process.env, GUIDON_APP_MODULE_DIR: valid } });
    const shipped = ["web/index.html", "dist/guidon-standalone.html"].filter((p) => existsSync(p) && readFileSync(p, "utf8").includes(MARK));
    check(r2.status === 0 && /NOTHING WAS BUILT/.test(r2.stdout) && !/build ok/.test(r2.stdout),
      "pointed at a VALID stand-in folder, the real build checks it, says nothing was built, and does not claim \"build ok\"",
      `build with a valid stand-in: exit ${r2.status}, output ${JSON.stringify((r2.stderr + r2.stdout).slice(0, 400))}`);
    check(shipped.length === 0 && JSON.stringify(before) === JSON.stringify([stamp("web/index.html"), stamp("dist/guidon-standalone.html")]),
      "and the stand-in's module is in neither web/ nor dist/ - GUIDON_APP_MODULE_DIR cannot change what ships",
      `the stand-in module was BUILT INTO ${shipped.join(" and ") || "(outputs rewritten)"} - rebuild with \`npm run build\` before trusting web/ or dist/`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nMODULE MANIFEST: all passed" : `\nMODULE MANIFEST: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
