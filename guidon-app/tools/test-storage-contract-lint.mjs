/**
 * Verifies the verifier: tools/lint-storage-contract.mjs must FAIL, naming
 * the defect, when the storage contract is broken - and pass on the real
 * tree. A lint that cannot fail protects nothing.
 *
 * Same stand-in pattern tools/lint-ci-matrix.mjs and
 * tools/test-release-pipeline.mjs use: copy the scanned files to a temp
 * directory, plant ONE defect, point the lint at the copy with --src, and
 * expect a non-zero exit with the rule and the offender named. Pure node, no
 * browser.
 *
 * Planted, one at a time:
 *   (s1) a module that writes window.localStorage on its own;
 *   (s1) the same inside index.html, outside the db section;
 *   (s2) a module that opens IndexedDB on its own;
 *   (s3) a module that saves a new item with no restore check;
 *   (s3) a no-check-list key that has since gained a check (stale ratchet);
 * and two things that must NOT trip it: the word localStorage in a comment,
 * and a read (getItem).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const LINT = path.join(HERE, "lint-storage-contract.mjs");
const MAX_LINE = 20000;

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const run = (args) => {
  const r = spawnSync(process.execPath, [LINT].concat(args), { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};

/** A temp copy of src/ (index.html without its data-only long lines, the .js files, app-modules/). */
function standIn() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guidon-storage-lint-"));
  fs.mkdirSync(path.join(dir, "app-modules"));
  const index = fs.readFileSync(path.join(APP, "src", "index.html"), "utf8").split("\n").map((l) => (l.length > MAX_LINE ? "" : l)).join("\n");
  fs.writeFileSync(path.join(dir, "index.html"), index);
  for (const sub of ["", "app-modules"]) {
    for (const n of fs.readdirSync(path.join(APP, "src", sub))) {
      if (n.endsWith(".js")) fs.copyFileSync(path.join(APP, "src", sub, n), path.join(dir, sub, n));
    }
  }
  return dir;
}
const cleanup = [];
function planted(mutate) { const dir = standIn(); cleanup.push(dir); mutate(dir); return run(["--src", dir]); }
const writeModule = (dir, name, body) => fs.writeFileSync(path.join(dir, "app-modules", name), body);
const editIndex = (dir, fn) => { const p = path.join(dir, "index.html"); fs.writeFileSync(p, fn(fs.readFileSync(p, "utf8"))); };

// 0) the real tree, and an untouched copy of it
const real = run([]);
real.code === 0 ? ok("the real tree passes (exit 0)") : bad("the real tree fails the lint:\n" + real.out);
const copy = planted(() => {});
copy.code === 0 ? ok("an untouched stand-in copy passes too, so every failure below is the planted defect's") : bad("the untouched stand-in fails:\n" + copy.out);

// 1) (s1) a module writes localStorage
let r = planted((dir) => writeModule(dir, "zz-planted.js", '(function () { try { localStorage.setItem("planted:flag", "1"); } catch (e) {} })();\n'));
r.code !== 0 && /\(s1\) app-modules\/zz-planted\.js:1 localStorage\.setItem\(\)/.test(r.out)
  ? ok("(s1) a module calling localStorage.setItem() fails the lint, named with file and line")
  : bad("(s1) planted localStorage.setItem() was not caught: exit " + r.code + "\n" + r.out);

// 2) (s1) the same in index.html, outside the db section
r = planted((dir) => editIndex(dir, (s) => s.replace("/* ==== js/theme.js ==== */", '/* ==== js/theme.js ==== */\nwindow.localStorage.removeItem("planted:flag");')));
r.code !== 0 && /\(s1\) index\.html:\d+ localStorage\.removeItem\(\)/.test(r.out)
  ? ok("(s1) a write in index.html outside the db section fails the lint")
  : bad("(s1) planted index.html write was not caught: exit " + r.code + "\n" + r.out);

// 3) (s2) a module opens IndexedDB
r = planted((dir) => writeModule(dir, "zz-planted.js", '(function () { var req = indexedDB.open("guidon"); req.onsuccess = function () {}; })();\n'));
r.code !== 0 && /\(s2\) app-modules\/zz-planted\.js:1 indexedDB\.open\(\)/.test(r.out)
  ? ok("(s2) a module opening IndexedDB on its own fails the lint")
  : bad("(s2) planted indexedDB.open() was not caught: exit " + r.code + "\n" + r.out);

// 4) (s3) a new saved item with no restore check - both call shapes
r = planted((dir) => writeModule(dir, "zz-planted.js", '(function () { var KEY = "planted:tool:v1"; function save(v) { return G.db.setSetting(KEY, v); } G.planted = { save: save }; })();\n'));
r.code !== 0 && /\(s3\) saved item planted:tool:v1 \(app-modules\/zz-planted\.js:1\) has no restore check/.test(r.out)
  ? ok("(s3) a new saved item (db.setSetting with a KEY constant) with no restore check fails the lint")
  : bad("(s3) planted unchecked key was not caught: exit " + r.code + "\n" + r.out);
r = planted((dir) => writeModule(dir, "zz-planted.js", '(function () { function save(id, v) { return G.db.put("kv", { k: "planted-family:" + id, v: v }); } G.planted = { save: save }; })();\n'));
r.code !== 0 && /\(s3\) saved item planted-family: /.test(r.out)
  ? ok("(s3) a new saved-item FAMILY (put(\"kv\", { k: \"prefix:\" + id })) with no restore check fails too")
  : bad("(s3) planted unchecked family was not caught: exit " + r.code + "\n" + r.out);

// 5) (s3) the ratchet: a listed key that gained a check must leave the list
r = planted((dir) => editIndex(dir, (s) => s.replace('"settings": function (v)', '"boardQuiz:timedMode": function (v) { return typeof v === "boolean"; },\n    "settings": function (v)')));
r.code !== 0 && /UNCHECKED lists "boardQuiz:timedMode" but it has a restore check now/.test(r.out)
  ? ok("(s3) a no-check-list entry that has since gained a real check is reported as stale")
  : bad("(s3) stale ratchet entry was not caught: exit " + r.code + "\n" + r.out);

// 6) must NOT trip: a comment, and a read
r = planted((dir) => writeModule(dir, "zz-planted.js", '// this module never calls localStorage.setItem("x", "y") itself\n/* nor indexedDB.open("guidon") */\n(function () { var v = null; try { v = localStorage.getItem("guidon:appearance:v1"); } catch (e) {} G.planted = v; })();\n'));
r.code === 0
  ? ok("naming localStorage/indexedDB in a comment, or READING localStorage, does not fail the lint")
  : bad("a comment or a read tripped the lint: exit " + r.code + "\n" + r.out);

cleanup.forEach((dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} });

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSTORAGE CONTRACT LINT: all passed");
process.exit(fails ? 1 : 0);
