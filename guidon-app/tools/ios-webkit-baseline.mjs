/**
 * GUIDON - the ratchet behind tools/verify-ios-webkit.mjs.
 *
 * Why this exists (audit U7): the "WebKit pre-flight" job in
 * .github/workflows/ios.yml ran the verifier under `continue-on-error: true`,
 * so the job was green while the verifier printed 19 defects and exited 1 -
 * and the comment that called that temporary ("remove continue-on-error once
 * ios:verify exits 0") was deleted along with the rest of the workflow's
 * documentation. A check that cannot fail is decoration: a brand-new overflow
 * or a new 12px input would have shipped under the same green tick.
 *
 * All-or-nothing was the wrong choice in both directions - red-until-all-19-
 * are-fixed trains everyone to ignore the job, green-regardless hides new
 * ones. So the known defects are written down (ios-webkit-baseline.json) and
 * the verifier fails on exactly two things:
 *   - a defect that is NOT in the baseline (something got worse), and
 *   - a baseline entry that no longer reproduces (something got better - delete
 *     the line in the same change, so the list can only shrink and a fixed
 *     defect cannot quietly come back under its old entry).
 * Same discipline as lint-capacitor-config.mjs's exact permission allow-list.
 *
 * Pure functions only, so tools/test-ios-webkit-ratchet.mjs can prove the
 * verdict logic on any machine - Playwright's WebKit build is only installed
 * on the CI runner, and a ratchet nobody can test locally would be one more
 * unverified verifier.
 *
 * A defect's identity is `check` + `signature` (tag, type, first two classes,
 * id with digits folded to N) - the same key verify-ios-webkit.mjs already
 * dedupes on. Routes and devices are evidence, not identity: one CSS rule is
 * one defect however many screens render it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = path.join(HERE, "ios-webkit-baseline.json");

/** The checks the route sweep can raise. A baseline entry naming anything
    else is a typo, and a typo'd entry would be reported as "stale" forever. */
export const CHECKS = ["overflow", "font<16", "tap<44", "orphan-label", "bad-text"];

export const defectKey = (check, signature) => `${check} :: ${signature}`;

/** Validate and index a parsed baseline. Throws on anything malformed - a
    baseline that silently loads as "empty" would turn every known defect
    into a NEW one, and one that silently loads duplicates hides a stale
    entry behind its twin. */
export function indexBaseline(raw, label = "baseline") {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.defects) || !Array.isArray(raw.unboundedVh)) {
    throw new Error(`${label}: expected { "unboundedVh": [...], "defects": [...] }`);
  }
  const defects = new Set();
  for (const d of raw.defects) {
    if (!d || typeof d.check !== "string" || typeof d.signature !== "string" || !d.signature) {
      throw new Error(`${label}: every defect needs a "check" and a "signature" - got ${JSON.stringify(d)}`);
    }
    if (!CHECKS.includes(d.check)) throw new Error(`${label}: unknown check ${JSON.stringify(d.check)} (known: ${CHECKS.join(", ")})`);
    const key = defectKey(d.check, d.signature);
    if (defects.has(key)) throw new Error(`${label}: duplicate entry ${key}`);
    defects.add(key);
  }
  const vh = new Set();
  for (const v of raw.unboundedVh) {
    if (typeof v !== "string" || !v) throw new Error(`${label}: unboundedVh entries are declaration strings - got ${JSON.stringify(v)}`);
    if (vh.has(v)) throw new Error(`${label}: duplicate unboundedVh entry ${v}`);
    vh.add(v);
  }
  return { defects, vh };
}

export async function loadBaseline(file = BASELINE_PATH) {
  const text = await readFile(file, "utf8");
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error(`${file}: not valid JSON - ${e.message}`); }
  return indexBaseline(raw, path.basename(file));
}

/** An empty baseline: every defect is NEW. `--no-baseline` uses it, which is
    the old strict behaviour (exit 1 while anything at all is wrong). */
export const emptyBaseline = () => ({ defects: new Set(), vh: new Set() });

/**
 * Split what a run observed against what the baseline allows.
 *   fresh - observed, not allowed  -> the run fails
 *   known - observed and allowed   -> reported, does not fail
 *   stale - allowed, not observed  -> the run fails (delete the entry)
 */
export function classify(observed, allowed) {
  const obs = new Set(observed), base = new Set(allowed);
  return {
    fresh: [...obs].filter((k) => !base.has(k)),
    known: [...obs].filter((k) => base.has(k)),
    stale: [...base].filter((k) => !obs.has(k)),
  };
}
