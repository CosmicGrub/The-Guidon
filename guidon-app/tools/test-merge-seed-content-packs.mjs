#!/usr/bin/env node
/**
 * build.mjs's mergeSeedContentPacks(): must be a HARD build failure, never a
 * silent skip, when the seed literal is not the one shape it knows how to
 * parse.
 *
 * PR #196 review finding: before this fix, an unexpected seed shape made
 * mergeSeedContentPacks() return { skipped: true } and main() carried on -
 * but assembleAppModules() unconditionally excludes every "emit":"build"
 * content pack from the page regardless of whether the merge ran. Net
 * effect: `node tools/build.mjs` would exit 0, print "build ok", and ship a
 * page with ONLY the static seed - missing every content pack's cards and
 * scenarios (hundreds of board cards in the real app), with no runtime pack
 * scripts to fall back on either, and nothing anywhere saying so.
 *
 * This proves the fix two ways:
 *   (a) a stand-in HTML string whose GUIDON_SEED assignment is not a plain
 *       `{...}` object literal (the exact shape locateSeedLiteral() cannot
 *       parse) makes mergeSeedContentPacks() THROW, naming the problem -
 *       never return a "skipped" result for main() to silently carry on
 *       past;
 *   (b) the SAME mutation applied to the REAL src/index.html (a full
 *       document, not a synthetic snippet, so this also proves the earlier
 *       build steps that run before this one - version/theme/engine-floor
 *       stamping - do not accidentally produce a shape this function can no
 *       longer find) throws too, and the normal, untouched real seed does
 *       NOT throw and really merges content - so this is a real refusal on
 *       the bad shape, not a suite that is broken and would refuse anything.
 *
 * Direct-import unit test of the extracted function (mirrors
 * tools/test-theme-id-sync.mjs's own PART B: deriveThemeIds() fed a
 * synthetic literal) rather than a full `node tools/build.mjs` subprocess -
 * there is no supported way to point build.mjs at a stand-in src/index.html
 * the way GUIDON_APP_MODULE_DIR points it at a stand-in module folder, and
 * mergeSeedContentPacks() is already exported for exactly this reason.
 */
import { readFileSync } from "node:fs";
import { mergeSeedContentPacks } from "./build.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail === undefined ? pass : fail));
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

console.log("build: mergeSeedContentPacks() refuses instead of silently skipping on an unexpected seed shape\n");

/* ---- (a) a minimal, synthetic stand-in ---- */
{
  const goodHtml = '<html><body><script>\nwindow.GUIDON_SEED = {"board":{"questions":[]},"doctrine":{"entries":[]},"scenarios":{"scenarios":[]},"acronyms":{"terms":[]}};\n</script></body></html>';
  const badHtml = goodHtml.replace('window.GUIDON_SEED = {"board"', 'window.GUIDON_SEED = JSON.parse("{\\"board\\"');
  check(!badHtml.includes('window.GUIDON_SEED = {'), "(setup) the stand-in's GUIDON_SEED assignment is genuinely not a plain object literal any more", badHtml);

  const err = throws(() => mergeSeedContentPacks(badHtml, "src/app-modules"));
  check(err instanceof Error, "a non-literal GUIDON_SEED shape throws (does not return a value main() could silently continue with)", "no error thrown");
  check(!!err && /GUIDON_SEED is not a plain object literal/.test(err.message), "...naming what shape was expected", err && err.message);

  // The reverse control: an ordinary, plain-literal stand-in with a real
  // content pack must NOT throw, and must really merge - so this suite is
  // proving a real refusal on the bad shape, not something that rejects
  // every input.
  let threwOnGood = null;
  let result = null;
  try { result = mergeSeedContentPacks(goodHtml, "src/app-modules"); } catch (e) { threwOnGood = e; }
  check(threwOnGood === null, "an ordinary plain-object-literal seed does not throw", threwOnGood && threwOnGood.message);
  check(!!result && !!result.merge && result.merge.modules.length > 0 && result.merge.modules.every((m) => !m.error), "...and really merges the real app's content packs into it (proves this is a targeted refusal, not a suite that would refuse anything)", result && JSON.stringify(result.merge && result.merge.modules.filter((m) => m.error)));
  check(!!result && result.merge.finalCounts.board > result.merge.staticCounts.board, "...board.questions actually grew past the (empty) static seed", result && JSON.stringify(result.merge && { static: result.merge.staticCounts, final: result.merge.finalCounts }));
}

/* ---- (b) the same mutation against the REAL src/index.html ---- */
{
  const real = readFileSync("src/index.html", "utf8");
  const marker = "window.GUIDON_SEED = ";
  const at = real.indexOf(marker);
  check(at >= 0 && real[at + marker.length] === "{", "(setup) the real src/index.html's GUIDON_SEED assignment is a plain object literal, as this test assumes", "real src/index.html shape changed - update this test's mutation");
  const mutatedReal = real.slice(0, at) + 'window.GUIDON_SEED = JSON.parse("{}");' + real.slice(at + marker.length + 1);

  const err = throws(() => mergeSeedContentPacks(mutatedReal, "src/app-modules"));
  check(err instanceof Error && /GUIDON_SEED is not a plain object literal/.test(err.message), "the same mutation applied to the REAL, full src/index.html document also throws - not just a minimal synthetic snippet", err && err.message);

  let threwOnReal = null, realResult = null;
  try { realResult = mergeSeedContentPacks(real, "src/app-modules"); } catch (e) { threwOnReal = e; }
  check(threwOnReal === null, "the real, UNMUTATED src/index.html does not throw", threwOnReal && threwOnReal.message);
  check(!!realResult && realResult.merge.modules.length > 0 && realResult.merge.modules.every((m) => !m.error), "...and merges the real app's content packs with no error", realResult && JSON.stringify(realResult.merge.modules.filter((m) => m.error)));
}

console.log(fails === 0 ? "\nMERGE SEED CONTENT PACKS: all passed" : `\nMERGE SEED CONTENT PACKS: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
