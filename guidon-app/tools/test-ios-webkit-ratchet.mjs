/**
 * The ratchet behind tools/verify-ios-webkit.mjs (tools/ios-webkit-baseline.mjs
 * + tools/ios-webkit-baseline.json), tested without a browser.
 *
 * Why: the "WebKit pre-flight" job was green for weeks while its verifier
 * printed 19 defects and exited 1, because the step carried
 * `continue-on-error: true`. The switch is gone (lint-capacitor-config.mjs
 * check (i) keeps it gone, test-ios-config-lint.mjs proves that check bites);
 * what replaced it is a written-down list of known defects and a verdict rule:
 * red for anything NOT on the list, red for anything on the list that no longer
 * reproduces. If that rule is wrong the job is decoration again, so it is
 * proven here on any OS - Playwright's WebKit build is only installed on the
 * CI runner.
 *
 * Also the ratchet on the list itself: the committed baseline may never hold
 * MORE than was recorded on 2026-09-19 (19 defects, 1 unbounded vh). Adding an
 * entry to turn a red run green means editing this number too, in plain sight.
 *
 * Pure node; launches no browser.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, indexBaseline, loadBaseline, emptyBaseline, defectKey, CHECKS, BASELINE_PATH } from "./ios-webkit-baseline.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFIER = path.join(HERE, "verify-ios-webkit.mjs");
const RECORDED_DEFECTS = 19, RECORDED_VH = 1; // 2026-09-19 - may only go DOWN

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message)); } };

/* 1 - the verdict rule */
{
  const base = [defectKey("font<16", "select"), defectKey("tap<44", "a.res-url")];
  const unchanged = classify(base, base);
  check(!unchanged.fresh.length && !unchanged.stale.length && same(unchanged.known, base), "same defects as the baseline: nothing new, nothing stale (the job is green, and says what is still open)", JSON.stringify(unchanged));

  const worse = classify([...base, defectKey("overflow", "document")], base);
  check(same(worse.fresh, [defectKey("overflow", "document")]) && !worse.stale.length, "one defect that is not in the baseline is NEW (the job is red) - the old switch hid exactly this", JSON.stringify(worse));

  const better = classify([base[0]], base);
  check(same(better.stale, [base[1]]) && !better.fresh.length, "a baseline entry that no longer reproduces is STALE (red until the entry is deleted, so it cannot quietly come back)", JSON.stringify(better));

  const sameSigOtherCheck = classify([defectKey("tap<44", "select")], [defectKey("font<16", "select")]);
  check(sameSigOtherCheck.fresh.length === 1 && sameSigOtherCheck.stale.length === 1, "identity is check + signature: a known small-font `select` does not excuse a new small-tap `select`", JSON.stringify(sameSigOtherCheck));

  const none = classify([defectKey("font<16", "select")], emptyBaseline().defects);
  check(none.fresh.length === 1, "--no-baseline tolerates nothing: every defect is NEW", JSON.stringify(none));
  check(classify(new Set(base), new Set(base)).known.length === 2 && classify(base.values(), base).known.length === 2, "accepts arrays, Sets and iterators (the verifier passes Map keys)", "iterable handling broke");
}

/* 2 - a baseline that is wrong must never load as "empty" or "fine" */
{
  const good = { unboundedVh: ["height:75vh;"], defects: [{ check: "font<16", signature: "select", seen: "x" }] };
  const idx = indexBaseline(good);
  check(idx.defects.has(defectKey("font<16", "select")) && idx.vh.has("height:75vh;"), "a well-formed baseline indexes to the same keys the verifier raises", JSON.stringify([...idx.defects]));
  check(throws(() => indexBaseline({}), /expected/) && throws(() => indexBaseline(null), /expected/) && throws(() => indexBaseline({ defects: [], unboundedVh: "x" }), /expected/), "a baseline with the wrong shape is refused, not read as empty (empty would re-label every known defect NEW)", "malformed shape was accepted");
  check(throws(() => indexBaseline({ unboundedVh: [], defects: [{ check: "font<l6", signature: "select" }] }), /unknown check/), "a typo'd check name is refused (it would sit there as 'stale' forever)", "unknown check accepted");
  check(throws(() => indexBaseline({ unboundedVh: [], defects: [{ check: "font<16", signature: "" }] }), /needs a "check" and a "signature"/), "an entry with no signature is refused", "empty signature accepted");
  check(throws(() => indexBaseline({ unboundedVh: [], defects: [good.defects[0], { ...good.defects[0] }] }), /duplicate entry/), "a duplicate entry is refused (a stale entry could hide behind its twin)", "duplicate accepted");
  check(throws(() => indexBaseline({ unboundedVh: ["a", "a"], defects: [] }), /duplicate unboundedVh/), "a duplicate unbounded-vh entry is refused", "duplicate vh accepted");
}

/* 3 - the committed baseline */
{
  let real = null;
  try { real = await loadBaseline(); } catch (e) { bad("the committed baseline does not load: " + e.message); }
  if (real) {
    ok(`the committed baseline loads: ${real.defects.size} known defect(s), ${real.vh.size} known unbounded vh`);
    check(real.defects.size <= RECORDED_DEFECTS && real.vh.size <= RECORDED_VH, `the list has not grown past what was recorded (${RECORDED_DEFECTS} + ${RECORDED_VH}) - it may only shrink`, `the baseline GREW to ${real.defects.size} defect(s) + ${real.vh.size} vh. Fix the new defect instead of listing it; if it truly cannot be fixed yet, say why in the change and raise the number in this test so the growth is reviewed`);
    const raw = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
    check(raw.defects.every((d) => CHECKS.includes(d.check) && typeof d.seen === "string" && d.seen), "every entry says which check raised it and where it was seen (so whoever fixes it knows where to look)", "an entry has no `seen` note");
    check(/only SHRINK/i.test(raw.note || ""), "the file itself says the rule, for whoever opens it without reading this", "baseline note lost the rule");
  }
}

/* 4 - the real verifier refuses a broken baseline BEFORE it looks at anything
   (exit 2 = "the check could not run", never 0 "clean" and never 1 "defects") */
{
  const scratch = await mkdtemp(path.join(os.tmpdir(), "guidon-ios-ratchet-"));
  const run = (file) => spawnSync(process.execPath, [VERIFIER, "--baseline=" + file], { encoding: "utf8", cwd: path.resolve(HERE, ".."), timeout: 60000 });
  const broken = path.join(scratch, "broken.json");
  await writeFile(broken, "{ not json");
  const a = run(broken);
  check(a.status === 2 && /not valid JSON/.test(a.stderr + a.stdout) && !/RESULT:/.test(a.stdout), "verify-ios-webkit.mjs with an unparseable baseline: exit 2, says so, sweeps nothing", `exit ${a.status}\n${a.stdout}\n${a.stderr}`);
  const dup = path.join(scratch, "dup.json");
  await writeFile(dup, JSON.stringify({ unboundedVh: [], defects: [{ check: "tap<44", signature: "a" }, { check: "tap<44", signature: "a" }] }));
  const b = run(dup);
  check(b.status === 2 && /duplicate entry/.test(b.stderr + b.stdout), "...and with a duplicate entry: exit 2", `exit ${b.status}\n${b.stdout}\n${b.stderr}`);
  const c = run(path.join(scratch, "missing.json"));
  check(c.status === 2 && !/RESULT:/.test(c.stdout), "...and with a baseline file that does not exist: exit 2 (not 'no baseline, so everything is fine')", `exit ${c.status}\n${c.stdout}\n${c.stderr}`);
  await rm(scratch, { recursive: true, force: true }).catch(() => {});
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nIOS WEBKIT RATCHET: all passed");
process.exit(fails ? 1 : 0);
