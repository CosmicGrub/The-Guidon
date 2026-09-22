/**
 * content-pack-engine, in isolation: G.contentPack.define(), ctx.pack()'s
 * requires-gate, manifest order, ctx.pillarFor(), and every emit:"build"
 * refusal - all against a stand-in folder built here, before this engine is
 * ever wired into tools/build.mjs or tools/assemble-bank.mjs (mirrors
 * tools/test-module-manifest.mjs's stand-in-folder pattern).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeContentPacks } from "./content-pack-engine.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));

console.log("content-pack-engine: G.contentPack.define(), ctx.pack(), manifest order, ctx.pillarFor()\n");

const scratch = mkdtempSync(join(tmpdir(), "guidon-content-pack-engine-"));
const dir = (name) => { const d = join(scratch, name); mkdirSync(d, { recursive: true }); return d; };
const entry = (file, id, extra = {}) => Object.assign(
  { file, id, kind: "content-pack", emit: "build", headless: true, requires: [], provides: [], routes: [], storageKeys: [], optionalApis: [] },
  extra
);
const write = (d, file, src) => writeFileSync(join(d, file), src);
const manifestOf = (d, modules) => write(d, "manifest.json", JSON.stringify({ modules }));
const seed = () => ({ board: { questions: [] }, doctrine: { entries: [] }, scenarios: { scenarios: [] }, acronyms: { terms: [] } });

/* ---- (1) the ordinary path: define(), a builder returns a value, another
   pack reads it through ctx.pack() because it declared "requires" ---- */
{
  const d = dir("clean");
  write(d, "10-alpha.js", [
    '(function () {',
    '  "use strict";',
    '  G.contentPack.define("alpha", function (bank, ctx) {',
    '    bank.board.questions.push({ id: "alpha-1", category: "x", q: "q1", a: "a1" });',
    '    return { value: 1, pillar: ctx.pillarFor("Army Values") };',
    '  });',
    '})();',
  ].join("\n"));
  write(d, "20-bravo.js", [
    '(function () {',
    '  "use strict";',
    '  G.contentPack.define("bravo", function (bank, ctx) {',
    '    var alpha = ctx.pack("alpha");',
    '    bank.board.questions.push({ id: "bravo-1", category: "x", q: "q2", a: "a2" });',
    '    return { sawAlphaValue: alpha.value };',
    '  });',
    '})();',
  ].join("\n"));
  write(d, "30-charlie-runtime.js", [
    '(function () {',
    '  "use strict";',
    '  window.G.runtimeOnlyThingThatShouldNeverRun = true;',
    '})();',
  ].join("\n"));
  write(d, "90-finalize.js", [
    '(function () {',
    '  "use strict";',
    '  G.contentPack.define("finalize", function (bank, ctx) {',
    '    var sawBravo = ctx.hasPack("bravo") ? ctx.pack("bravo").sawAlphaValue : null;',
    '    var sawUndeclared = ctx.hasPack("alpha");', // "alpha" is not under finalize's own requires
    '    return { finishedWith: bank.board.questions.length, sawBravo: sawBravo, sawUndeclared: sawUndeclared };',
    '  });',
    '})();',
  ].join("\n"));
  manifestOf(d, [
    entry("10-alpha.js", "alpha"),
    entry("20-bravo.js", "bravo", { requires: ["alpha"] }),
    entry("30-charlie-runtime.js", "charlie", { kind: "feature", emit: "runtime", headless: false }),
    entry("90-finalize.js", "finalize", { kind: "finalize", requires: ["bravo"] }),
  ]);

  const s = seed();
  const r = mergeContentPacks(s, d);
  check(r.modules.every((m) => !m.error), "every well-formed pack runs with no error", () => JSON.stringify(r.modules));
  check(r.modules.length === 3, "only the 3 emit:\"build\" modules ran (the emit:\"runtime\" one was skipped)", `ran ${r.modules.length}: ${JSON.stringify(r.modules.map((m) => m.file))}`);
  check(r.modules.map((m) => m.file).join(",") === "10-alpha.js,20-bravo.js,90-finalize.js", "they ran in manifest order", r.modules.map((m) => m.file).join(","));
  check(s.board.questions.length === 2, "both packs' board cards reached the real seed object (bank IS the seed, mutated in place)", `board.questions.length=${s.board.questions.length}`); // hygiene-ok: a synthetic, self-authored 2-card fixture in a scratch dir, not the live app's bank
  check(r.data === s, "the returned data is the SAME object passed in, not a copy", "data !== seedObject");
  check(r.packs.alpha && r.packs.alpha.value === 1, "alpha's own return value is readable by id from the result's packs map", JSON.stringify(r.packs.alpha));
  check(r.packs.bravo && r.packs.bravo.sawAlphaValue === 1, "bravo read alpha's return value through ctx.pack(\"alpha\") because it declared alpha under requires", JSON.stringify(r.packs.bravo));
  check(r.packs.alpha.pillar === "Drill & Board Etiquette", "ctx.pillarFor() resolves a real category through tools/pillar-map.mjs, not a hand-copied table", `pillar=${r.packs.alpha.pillar}`);
  check(r.finalized && r.finalized.finishedWith === 2, "the kind:\"finalize\" module's return value is also exposed as the top-level \"finalized\" convenience field", JSON.stringify(r.finalized));
  check(r.finalized && r.finalized.sawBravo === 1, "ctx.hasPack(id) true + ctx.pack(id) reads a declared dependency's result", JSON.stringify(r.finalized));
  check(r.finalized && r.finalized.sawUndeclared === false, "ctx.hasPack(id) is false (not a throw) for an id this module never declared under \"requires\" - a safe, optional check", JSON.stringify(r.finalized));
  check(r.G.runtimeOnlyThingThatShouldNeverRun === undefined, "the emit:\"runtime\" module's code never ran (window.G was never touched by it)", "runtimeOnlyThingThatShouldNeverRun leaked in");
  check(typeof r.staticCounts.board === "number" && r.staticCounts.board === 0 && r.finalCounts.board === 2, "staticCounts is measured BEFORE any pack ran, finalCounts AFTER", JSON.stringify({ staticCounts: r.staticCounts, finalCounts: r.finalCounts }));
}

/* ---- (2) manifest order really drives execution order, not file name ---- */
{
  const d = dir("reordered");
  write(d, "zz-first.js", [
    '(function () {',
    '  "use strict";',
    '  G.contentPack.define("first", function (bank, ctx) { return { ran: "first" }; });',
    '})();',
  ].join("\n"));
  write(d, "aa-second.js", [
    '(function () {',
    '  "use strict";',
    '  G.contentPack.define("second", function (bank, ctx) { return { sawFirst: ctx.pack("first").ran }; });',
    '})();',
  ].join("\n"));
  // manifest lists zz-first.js BEFORE aa-second.js, opposite of alphabetical -
  // if the engine picked file-name order instead of manifest order, "second"
  // would run first and ctx.pack("first") would throw (nothing registered yet).
  manifestOf(d, [entry("zz-first.js", "first"), entry("aa-second.js", "second", { requires: ["first"] })]);
  const r = mergeContentPacks(seed(), d);
  check(r.modules.every((m) => !m.error) && r.packs.second && r.packs.second.sawFirst === "first", "execution follows MANIFEST order, not alphabetical file-name order", JSON.stringify(r.modules));
}

/* ---- (3) an undeclared cross-pack call throws, naming the file ---- */
{
  const d = dir("undeclared-cross-pack");
  write(d, "10-alpha.js", [
    '(function () {',
    '  "use strict";',
    '  G.contentPack.define("alpha", function () { return { value: 1 }; });',
    '})();',
  ].join("\n"));
  write(d, "20-rogue.js", [
    '(function () {',
    '  "use strict";',
    '  G.contentPack.define("rogue", function (bank, ctx) { return { v: ctx.pack("alpha").value }; });',
    '})();',
  ].join("\n"));
  // "rogue" calls ctx.pack("alpha") but does NOT list "alpha" under requires.
  manifestOf(d, [entry("10-alpha.js", "alpha"), entry("20-rogue.js", "rogue")]);
  const r = mergeContentPacks(seed(), d);
  const rogue = r.modules.find((m) => m.file === "20-rogue.js");
  check(!!rogue && /ctx\.pack\("alpha"\) is not declared under this module's "requires"/.test(rogue.error || ""), "an undeclared ctx.pack() call throws, naming the file and the missing id", JSON.stringify(rogue));
}

/* ---- (4) a pack that never calls define() is a build-time error, not a silent no-op ---- */
{
  const d = dir("never-defines");
  write(d, "10-quiet.js", '(function () { "use strict"; /* forgot to call G.contentPack.define() */ })();\n');
  manifestOf(d, [entry("10-quiet.js", "quiet")]);
  const r = mergeContentPacks(seed(), d);
  check(/did not call G\.contentPack\.define\("quiet"/.test(r.modules[0].error || ""), "a content-pack file that never registers itself is reported as an error, naming its own id", JSON.stringify(r.modules[0]));
}

/* ---- (5) define()'s own guardrails: wrong id, called twice, no builder ---- */
{
  const d = dir("wrong-id");
  write(d, "10-mislabeled.js", '(function () { "use strict"; G.contentPack.define("not-my-id", function () { return {}; }); })();\n');
  manifestOf(d, [entry("10-mislabeled.js", "mislabeled")]);
  const r = mergeContentPacks(seed(), d);
  check(/does not match this file's own manifest id "mislabeled"/.test(r.modules[0].error || ""), "define() with an id that does not match the file's own manifest id fails, rather than silently registering under the wrong name", JSON.stringify(r.modules[0]));
}
{
  const d = dir("defines-twice");
  write(d, "10-twice.js", [
    '(function () { "use strict";',
    '  G.contentPack.define("twice", function () { return { n: 1 }; });',
    '  G.contentPack.define("twice", function () { return { n: 2 }; });',
    '})();',
  ].join("\n"));
  manifestOf(d, [entry("10-twice.js", "twice")]);
  const r = mergeContentPacks(seed(), d);
  check(/was called more than once/.test(r.modules[0].error || ""), "calling define() a second time in the same file fails", JSON.stringify(r.modules[0]));
}

/* ---- (6) mutations really land on the passed-in object, board/doctrine/scenario counts are tracked per pack ---- */
{
  const d = dir("counts");
  write(d, "10-mixed.js", [
    '(function () { "use strict";',
    '  G.contentPack.define("mixed", function (bank) {',
    '    bank.board.questions.push({ id: "m-1" });',
    '    bank.doctrine.entries.push({ id: "d-1" });',
    '    bank.scenarios.scenarios.push({ id: "s-1" }, { id: "s-2" });',
    '    return {};',
    '  });',
    '})();',
  ].join("\n"));
  manifestOf(d, [entry("10-mixed.js", "mixed")]);
  const r = mergeContentPacks(seed(), d);
  check(JSON.stringify(r.modules[0].added) === JSON.stringify({ board: 1, doctrine: 1, scenarios: 2 }), "per-pack added counts (board/doctrine/scenarios) are tracked independently", JSON.stringify(r.modules[0].added));
}

rmSync(scratch, { recursive: true, force: true });
console.log(fails === 0 ? "\nCONTENT PACK ENGINE: all passed" : `\nCONTENT PACK ENGINE: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
