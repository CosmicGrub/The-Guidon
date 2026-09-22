#!/usr/bin/env node
/**
 * lint-content-packs, and the __pack provenance tagging it depends on
 * (tools/assemble-bank.mjs's assembleBank()), proved against a small
 * stand-in bank - not the real app's content, which can only tell you the
 * checks pass today, never that they would actually CATCH something.
 *
 * PR #196 review found a real bug: assembleBank()'s tagging cursors (which
 * record in the merged bank came from which content pack) started at 0
 * instead of at the STATIC seed's own record counts. Content packs APPEND
 * onto arrays that already hold the seed's own records, so starting at 0
 * tagged the first N static records as "pack content" and left the actual,
 * appended pack records - including a genuinely malformed one - untagged as
 * static. lint-content-packs.mjs only checks records with a __pack tag, so
 * a malformed pack card would have silently bypassed every rule below while
 * unrelated, already-reviewed static cards got checked against pack-only
 * rules for no reason.
 *
 * This suite builds a stand-in seed (three well-formed static cards) and a
 * stand-in content pack (one well-formed card, one deliberately missing
 * `source` - rule p5), then proves:
 *   (a) assembleBank()'s __pack tag lands on exactly the two pack-added
 *       cards, never on a static one - the direct regression check for the
 *       cursor bug itself;
 *   (b) node tools/lint-content-packs.mjs --seed ... --modules ... (the
 *       same --seed/--modules convention tools/content-manifest.mjs already
 *       uses) really fails, naming the malformed card under rule p5, and
 *       does not also flag the well-formed pack card or any static one.
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleBank } from "./assemble-bank.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "lint-content-packs.mjs");

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail === undefined ? pass : fail));

console.log("lint-content-packs (and its __pack provenance tagging): a deliberately malformed pack card is really caught\n");

const scratch = mkdtempSync(path.join(tmpdir(), "guidon-lint-content-packs-"));
try {
  const SEED = path.join(scratch, "index.html");
  const MODULES = path.join(scratch, "modules");
  mkdirSync(MODULES);

  // "Army Values" is a real seed category the real tools/pillar-map.mjs maps
  // to a pillar (Drill & Board Etiquette) - using it (rather than an
  // unmapped one) means the real finalize pass below has real pillar work to
  // do, so rule (p6) exercises something instead of trivially passing.
  const staticCard = (id) => ({ id, category: "Army Values", q: "Static question " + id + "?", a: "Static answer " + id, boardAnswer: "Static answer " + id, source: "ADP 6-22", keyPoints: ["Static answer " + id], difficulty: "basic" });
  // The real 98-content-pack-finalize.js hard-codes its own "New" wave as
  // eight specific scenario ids (see that file's NEW_WAVE) and checks that
  // all eight are found and tagged - a fixture that copies the real file in
  // (rather than a stand-in finalize pack) has to carry those exact ids for
  // rule (p9) to pass. Bare static stubs are enough: finalize only reads
  // .id and .since off them, and being static (not pack-tagged) means rule
  // (p8)'s own structural scenario checks never look at them.
  const NEW_WAVE_IDS = ["sc-92a-critical-part-overdue", "sc-92a-inventory-discrepancy", "sc-collective-decision-relay", "sc-board-simulator-reporting", "sc-opsec-social-engineering", "sc-cyber-removable-media", "sc-opsec-fitness-tracking", "sc-cui-spillage-reporting"];
  const seedBank = {
    board: { questions: [staticCard("s1"), staticCard("s2"), staticCard("s3")] },
    doctrine: { entries: [] },
    scenarios: { scenarios: NEW_WAVE_IDS.map((id) => ({ id })) },
    acronyms: { terms: [] },
  };
  writeFileSync(SEED, "<!doctype html>\n<script>\nwindow.GUIDON_SEED = " + JSON.stringify(seedBank) + "\n</script>\n", "utf8");

  // The REAL 98-content-pack-finalize.js, copied in - same fixture
  // convention tools/test-content-manifest.mjs already uses. Its own
  // "requires" is deliberately empty (ctx.hasPack() makes that graceful):
  // this fixture only needs the pillar-tag + fingerprint pass finalize
  // always does, not the board-supplement audit sync that pass ALSO does
  // "if present".
  writeFileSync(path.join(MODULES, "manifest.json"), JSON.stringify({
    modules: [
      { file: "01-stand-in-pack.js", id: "stand-in-pack", kind: "content-pack", emit: "build", headless: true, requires: [], provides: [], routes: [], storageKeys: [], optionalApis: [] },
      { file: "98-content-pack-finalize.js", id: "content-pack-finalize", kind: "finalize", emit: "build", headless: true, requires: [], provides: [], routes: [], storageKeys: [], optionalApis: [] },
    ],
  }, null, 2) + "\n", "utf8");
  writeFileSync(path.join(MODULES, "98-content-pack-finalize.js"), readFileSync(path.join(HERE, "..", "src", "app-modules", "98-content-pack-finalize.js"), "utf8"), "utf8");
  writeFileSync(path.join(MODULES, "01-stand-in-pack.js"), [
    '(function () {',
    '  "use strict";',
    '  G.contentPack.define("stand-in-pack", function (bank) {',
    '    bank.board.questions.push({ id: "good-1", category: "Army Values", q: "Pack question, well-formed?", a: "Pack answer", boardAnswer: "Pack answer", source: "ADP 6-22", keyPoints: ["Pack answer"], difficulty: "basic" });',
    '    bank.board.questions.push({ id: "bad-1", category: "Army Values", q: "Pack question, missing its source?", a: "Pack answer 2", boardAnswer: "Pack answer 2", source: "", keyPoints: ["Pack answer 2"], difficulty: "basic" });',
    '  });',
    '})();',
  ].join("\n"), "utf8");

  /* ---- (a) the tagging itself: exactly the two pack-added cards, never a static one ---- */
  const assembled = assembleBank({ seedPath: SEED, moduleDir: MODULES });
  const taggedIds = assembled.data.board.questions.filter((q) => q.__pack).map((q) => q.id).sort();
  check(JSON.stringify(taggedIds) === JSON.stringify(["bad-1", "good-1"]), "assembleBank() tags exactly the two pack-added cards (good-1, bad-1) with __pack, never a static seed card", "tagged ids: " + JSON.stringify(taggedIds));
  const staticTagged = assembled.data.board.questions.filter((q) => !q.__pack).map((q) => q.id).sort();
  check(JSON.stringify(staticTagged) === JSON.stringify(["s1", "s2", "s3"]), "the three static seed cards are left untagged", "untagged ids: " + JSON.stringify(staticTagged));
  // The fixture must actually be ABLE to distinguish the buggy (cursor starts
  // at 0) tagging from the correct one - otherwise this proves nothing. With
  // 3 static cards ahead of it, the buggy formula would have tagged the
  // first 2 records (s1, s2) as "pack" instead of (good-1, bad-1).
  const buggyWouldHaveTagged = assembled.data.board.questions.slice(0, 2).map((q) => q.id).sort();
  check(JSON.stringify(buggyWouldHaveTagged) !== JSON.stringify(taggedIds), "the fixture actually distinguishes the buggy (cursor-starts-at-0) tagging from the fixed one - a cursor bug here would tag " + JSON.stringify(buggyWouldHaveTagged) + " instead");

  /* ---- (b) the real lint script, run against the stand-in via --seed/--modules ---- */
  const run = () => spawnSync(process.execPath, [TOOL, "--seed", SEED, "--modules", MODULES], { encoding: "utf8" });
  const r = run();
  check(r.status === 1, "the lint fails on the stand-in bank (a malformed pack card exists)", "exit code: " + r.status + "\n" + (r.stdout || "") + (r.stderr || ""));
  check(/\(p5\)/.test(r.stdout) && /bad-1/.test(r.stdout) && /source/i.test(r.stdout), "...naming rule (p5) and the malformed card's id (bad-1)", "stdout:\n" + r.stdout);
  check(!new RegExp("\\bgood-1\\b[^\\n]*\\[").test(r.stdout.replace(/bad-1/g, "")), "...and does not also flag the well-formed pack card (good-1)", "stdout:\n" + r.stdout);
  check(!/\bs1\b|\bs2\b|\bs3\b/.test(r.stdout), "...and never names a static seed card (s1/s2/s3) - they were never pack-tagged, so no pack-only rule ever looks at them", "stdout:\n" + r.stdout);

  /* ---- the well-formed control: with only the good card, the lint passes ---- */
  writeFileSync(path.join(MODULES, "01-stand-in-pack.js"), [
    '(function () {',
    '  "use strict";',
    '  G.contentPack.define("stand-in-pack", function (bank) {',
    '    bank.board.questions.push({ id: "good-1", category: "Army Values", q: "Pack question, well-formed?", a: "Pack answer", boardAnswer: "Pack answer", source: "ADP 6-22", keyPoints: ["Pack answer"], difficulty: "basic" });',
    '  });',
    '})();',
  ].join("\n"), "utf8");
  const r2 = run();
  check(r2.status === 0 && /LINT-CONTENT-PACKS: all passed/.test(r2.stdout), "with only the well-formed pack card, the same stand-in bank passes cleanly (the lint is not just always failing)", "exit code: " + r2.status + "\n" + r2.stdout);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nLINT-CONTENT-PACKS PROVENANCE: all passed" : `\nLINT-CONTENT-PACKS PROVENANCE: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
