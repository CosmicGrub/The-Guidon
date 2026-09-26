/**
 * Shared plumbing for the suites that stand behind GUIDON_COMMAND_LEGAL_PACKAGE.md
 * (tools/test-legal-package-*.mjs, checked by tools/verify-legal-package.mjs).
 *
 * A "claim" is one sentence, clause or cell of the package, with a stable id
 * (LP-030 ...) in tools/legal-package-claims.json. A suite proves a claim by
 * printing a line that starts with its tag:
 *
 *     PASS  [LP-030][LP-171] each of the six banner words ... is a stop finding
 *     FAIL  [LP-030][LP-171] not read as a banner: "FOUO"
 *
 * check() below keeps the tag on the FAIL line too (testkit's check() prints only
 * the failure text), so a failed claim names itself. verify-legal-package --run
 * reads these lines: a claim is proved only if its tag printed a PASS and no FAIL.
 *
 * Not a suite (no test- prefix) and no dependencies beyond testkit.
 */
import { check as baseCheck } from "./testkit.mjs";

export const tag = (...ids) => ids.map((i) => `[${i}]`).join("");

/** testkit's check(cond, pass, fail), with the leading [LP-nnn] tags of `pass` repeated on the failure line. */
export function check(cond, pass, fail) {
  const t = (String(pass).match(/^(?:\[LP-\d{3,}\])+/) || [""])[0];
  return baseCheck(cond, pass, () => t + " " + (typeof fail === "function" ? fail() : fail == null ? "NOT: " + pass : fail));
}

/** "a", "b" ... for a failure message, each cut to 60 characters. */
export const list = (a) => a.map((s) => JSON.stringify(String(s).length > 60 ? String(s).slice(0, 57) + "..." : String(s))).join(", ");
