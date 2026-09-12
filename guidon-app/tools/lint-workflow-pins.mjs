/**
 * Workflow action-pin lint for GUIDON (roadmap audit round 10, "Dependency &
 * CI hygiene cleanup" bucket).
 *
 * Every `uses:` step across .github/workflows/*.yml is supposed to reference
 * a third-party action by its immutable 40-character commit SHA, never a
 * mutable tag or branch (`@v4`, `@main`) - the SHA-pin-over-mutable-tag
 * discipline round 4's "CI / supply-chain hardening" bucket applied by hand
 * across every workflow step (see ci.yml/desktop.yml/ios.yml/pages.yml's own
 * "SHA-pin-over-mutable-tag" comments) to close the real supply-chain vector
 * a repointed tag opens - a publisher-mutable tag lets whoever controls the
 * upstream repo silently swap in different code after the fact with no diff
 * for anyone here to review (the exact vector behind the 2025
 * tj-actions/changed-files compromise, cited in ci.yml's own Checkout
 * comment). That discipline has held across every workflow so far, but
 * nothing mechanical enforced it - a future PR (or a well-meaning Dependabot
 * auto-merge, which is exactly the kind of automated bump this project
 * already treats with suspicion for Gradle - see ROADMAP.md's own
 * gradle-wrapper-regression entry) could reintroduce a bare `@v4` with
 * nothing failing CI. This is that mechanical backstop.
 *
 * Checks (PASS/FAIL lines, exit 1 on any FAIL, style of lint-patterns.mjs):
 *   (a) every `uses:` value naming a remote action (`owner/repo[/path]@ref`)
 *       has a ref that is exactly 40 hex characters - a real commit SHA,
 *       never a tag (`v4`, `v4.1.0`), a branch (`main`), or anything shorter.
 *
 * Local composite actions (`uses: ./...`) and Docker actions
 * (`uses: docker://...`) are counted and reported but not gated: a local
 * action has no separate remote ref to pin at all, and a Docker action pins
 * by image digest (`image@sha256:...`), a different and already-immutable
 * mechanism this lint doesn't need to re-check. Neither form appears in this
 * repo's workflows today, but the distinction is made explicit rather than
 * having such a step silently fall through the `@ref` regex uncounted.
 *
 * `--dir <path>` points the scan at another workflows directory so the
 * verifier can be verified (a scratch copy with one `@v4` fails, naming it).
 * No dependencies; run from anywhere (paths resolve from this file).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const REPO = path.resolve(APP, "..");
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const DIR = argOf("--dir") || path.join(REPO, ".github", "workflows");
const SHA_RE = /^[0-9a-fA-F]{40}$/;
const USES_RE = /^\s*(?:-\s*)?uses:\s*["']?([^"'\s#]+)["']?/;

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const rel = (p) => path.relative(REPO, p).split(path.sep).join("/");

console.log("lint-workflow-pins: every workflow `uses:` step pins a real commit SHA, not a mutable tag/branch\n");

let files = [];
try {
  files = (await readdir(DIR)).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).sort().map((f) => path.join(DIR, f));
} catch (e) {
  bad(`${rel(DIR)} unreadable: ${e.message}`);
}
if (files.length === 0 && fails === 0) bad(`${rel(DIR)} contains no *.yml/*.yaml workflow files`);

let scanned = 0, remote = 0, local = 0, docker = 0;
for (const file of files) {
  const text = await readFile(file, "utf-8");
  text.split("\n").forEach((line, i) => {
    const m = line.match(USES_RE);
    if (!m) return;
    scanned++;
    const value = m[1];
    if (value.startsWith("./") || value.startsWith("../")) { local++; return; }
    if (value.startsWith("docker://")) { docker++; return; }
    const at = value.lastIndexOf("@");
    if (at === -1) {
      bad(`${rel(file)}:${i + 1} uses: ${value} - no @ref at all, can't be a SHA pin`);
      return;
    }
    const action = value.slice(0, at);
    const ref = value.slice(at + 1);
    if (SHA_RE.test(ref)) { remote++; return; }
    bad(`${rel(file)}:${i + 1} uses: ${value} - ref "${ref}" is not a 40-character commit SHA (looks like a mutable tag or branch); resolve the real commit via \`gh api repos/${action}/commits/${ref}\` and pin that instead`);
  });
}
if (fails === 0) {
  ok(`${scanned} \`uses:\` step(s) across ${files.length} workflow file(s): ${remote} remote action(s) SHA-pinned, ${local} local composite action(s), ${docker} Docker action(s) (pinned by digest, not checked here)`);
}

console.log("\n" + (fails ? `LINT-WORKFLOW-PINS: ${fails} FAILURE(S)` : "LINT-WORKFLOW-PINS: all passed"));
process.exit(fails ? 1 : 0);
