/**
 * Baseline ratchet for tools/verify-ios-webkit.mjs.
 *
 * WHY THIS EXISTS. The iOS "WebKit pre-flight" job is the only check that
 * looks at layout, tap-target size and zoom-on-focus for the iPhone/iPad
 * fork. Its verifier has exited 1 on every run for weeks (19 known defects
 * as of main @ 6d5d004: 12 form controls under 16px, 7 tap targets under
 * 44x44, plus one unbounded `vh`), so ios.yml ran it with
 * `continue-on-error: true` - which made the job green whatever it found.
 * It was meant to be temporary ("remove once ios:verify exits 0"); that note
 * was deleted and the defect count kept growing with nothing to notice.
 *
 * All-or-nothing was the wrong choice: "fix all 19 first" never happens, and
 * meanwhile defect 20 walks in unseen. A ratchet is the fix - the defects
 * that exist today are written down in tools/ios-webkit-baseline.json and
 * tolerated; ANY defect not on that list fails the job. The list can only
 * shrink: fixing one prints a reminder to delete its line.
 *
 * Pure functions only (no Playwright, no file system) so
 * tools/test-release-pipeline.mjs can prove the rules with the real defect
 * list CI reported, on a machine with no WebKit installed.
 */

/** One stable string per deduped defect: the check plus the selector. */
export const keyOf = (check, signature) => `${check}|${signature}`;

/** Normalise an unbounded-vh declaration so spacing cannot cause a miss. */
export const vhKey = (decl) => String(decl).replace(/\s+/g, "").replace(/;$/, "").toLowerCase();

/** Accepts the parsed JSON (or null/undefined for "no baseline in use"). */
export function loadBaseline(json) {
  if (json == null) return { on: false, defects: new Set(), vh: new Set() };
  if (typeof json !== "object" || !Array.isArray(json.defects) || !Array.isArray(json.vh)) {
    throw new Error('ios-webkit baseline must be { "defects": [...], "vh": [...] }');
  }
  return { on: true, defects: new Set(json.defects.map(String)), vh: new Set(json.vh.map(vhKey)) };
}

/**
 * observedDefects: iterable of keyOf() strings seen on ANY device this run.
 * observedVh:      unbounded vh declarations the static audit found.
 * fresh = not in the baseline (these fail the run);
 * known = tolerated; stale = on the list but no longer seen (delete them).
 */
export function judge({ observedDefects, observedVh, baseline }) {
  const seen = new Set(observedDefects || []);
  const seenVh = new Set([...(observedVh || [])].map(vhKey));
  const sort = (s) => [...s].sort();
  return {
    freshDefects: sort([...seen].filter((k) => !baseline.defects.has(k))),
    knownDefects: sort([...seen].filter((k) => baseline.defects.has(k))),
    staleDefects: sort([...baseline.defects].filter((k) => !seen.has(k))),
    freshVh: sort([...seenVh].filter((k) => !baseline.vh.has(k))),
    knownVh: sort([...seenVh].filter((k) => baseline.vh.has(k))),
    staleVh: sort([...baseline.vh].filter((k) => !seenVh.has(k))),
  };
}

/** What --write-baseline saves. Sorted, so a regenerated file diffs cleanly. */
export function serialize({ observedDefects, observedVh, note }) {
  return JSON.stringify({
    _note: note,
    defects: [...new Set(observedDefects || [])].sort(),
    vh: [...new Set([...(observedVh || [])].map(vhKey))].sort(),
  }, null, 2) + "\n";
}
