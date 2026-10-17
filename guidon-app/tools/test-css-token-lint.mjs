/**
 * Verifies the verifier: the "every var(--x) names a defined custom property"
 * check (lint-patterns.mjs (t), judged by tools/css-token-rules.mjs) must FAIL,
 * naming the token and the line, on each shape of the defect - and must stay
 * quiet on honest input. A lint that cannot fail protects nothing.
 *
 * The defect it exists for (audit 2026-09, forms-invisible-text): Forms
 * Trainer text was written var(--fg, #e8f0f6) and var(--muted, #8ba0ad). No
 * theme defines --fg or --muted, so the browser used the pale fallback in
 * every theme - fine on the 20 dark ones, 1.04:1 (invisible) on the 10 light
 * ones, Field Manual (the default) included. Nothing errored.
 *
 * Pure node, no browser. Two halves:
 *   A) the judge, called directly on small planted sources;
 *   B) the real wiring: lint-patterns.mjs pointed with --src-dir at a stand-in
 *      src/ must exit 1 and print "(t)" plus the planted token, and exit 0 on
 *      an honest stand-in, so a check that is merely not wired in is caught.
 * Plus the real tree: it passes, and the scan saw a real amount of CSS (a
 * judge that reads nothing would also "pass").
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, finish } from "./testkit.mjs";
import { judgeDocument, judgeAllowlist, scanTokens, stripComments, lintCssTokens, LONG_LINE } from "./css-token-rules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");

const judge = (text, opts) => judgeDocument([{ name: "x.html", text }], opts);
const names = (res) => res.problems.map((p) => (p.match(/var\((--[\w-]+)\)/) || [])[1]);

/* ---- A) the judge ---- */
let r = judge(".a { color: var(--fg, #e8f0f6); }\n:root { --text: #111; }\n");
check(r.problems.length === 1 && names(r)[0] === "--fg" && /^x\.html:1 /.test(r.problems[0]),
  "an undefined token WITH a fallback (the exact Forms bug) is refused, naming the token, file and line", () => JSON.stringify(r.problems));

r = judge(".a { color: var(--muted); }\n");
check(r.problems.length === 1 && names(r)[0] === "--muted", "an undefined token with no fallback at all is refused too", () => JSON.stringify(r.problems));

r = judge(":root { --text: #111; --text-dim: #444; }\n.a { color: var(--text); border-color: var( --text-dim ); }\n");
check(r.problems.length === 0 && r.used === 2, "honest input passes: defined tokens, including one written var( --x )", () => JSON.stringify(r));

r = judge("el.style.cssText = 'font-family:var(--font-mono);';\nel.style.setProperty('--font-mono', 'x');\n");
check(r.problems.length === 0, "a token defined by setProperty() in script counts as defined", () => JSON.stringify(r.problems));

r = judge("<div style=\"--tone:red;color:var(--tone)\"></div>\n");
check(r.problems.length === 0, "a token defined in an inline style string counts as defined", () => JSON.stringify(r.problems));

r = judge("@property --angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }\n.a { rotate: var(--angle); }\n");
check(r.problems.length === 0, "an @property declaration counts as a definition", () => JSON.stringify(r.problems));

r = judge("/* the old var(--ghost) is gone */\n// and var(--ghost2) too\n.a { color: var(--text); }\n:root { --text: #111; }\n");
check(r.problems.length === 0, "a token merely MENTIONED in a /* */ or // comment is not a use", () => JSON.stringify(r.problems));

r = judge("/* --ghost: red; */\n.a { color: var(--ghost); }\n");
check(r.problems.length === 1 && names(r)[0] === "--ghost", "a definition that only exists inside a comment does not define anything", () => JSON.stringify(r.problems));

r = judge("const u = 'https://example.org/a';\n.a { color: var(--nope); }\n");
check(r.problems.length === 1 && /^x\.html:2 /.test(r.problems[0]), "a URL's // is not mistaken for a comment, and the line number stays true", () => JSON.stringify(r.problems));

r = judge("." + "a".repeat(LONG_LINE) + " { width: var(--scale-factor); }\n.b { color: var(--text); }\n:root { --text: #111; }\n");
check(r.problems.length === 0 && r.used === 1, "a line past the embedded-data limit (vendored pdf.js, the seed blob) is skipped, short lines still count", () => JSON.stringify({ p: r.problems, used: r.used }));

const two = judgeDocument([{ name: "index.html", text: ".a{color:var(--tone)}" }, { name: "mod.js", text: "x.style.setProperty('--tone','red')" }]);
check(two.problems.length === 0, "a script file may use a token index.html defines, and the other way round (one document)", () => JSON.stringify(two.problems));

const split = [
  judgeDocument([{ name: "index.html", text: ".a{color:var(--muted)}" }]),
  judgeDocument([{ name: "guest.html", text: ":root{--muted:#666}.b{color:var(--muted)}" }]),
];
check(split[0].problems.length === 1 && split[1].problems.length === 0,
  "guest.html defining --muted does NOT rescue index.html using it: each document is judged on its own tokens", () => JSON.stringify(split.map((s) => s.problems)));

// the allowlist: a reason is required, and an entry nothing needs is itself a failure
const used = judge(".a{color:var(--runtime)}", { allow: { "--runtime": "set by the host page at run time, never by this source" } });
check(used.problems.length === 0 && judgeAllowlist([used], { allow: { "--runtime": "set by the host page at run time, never by this source" } }).length === 0,
  "an allowlisted token with a real reason, still used and still undefined, passes", () => JSON.stringify(used.problems));
check(judgeAllowlist([judge(".a{color:red}")], { allow: { "--runtime": "set by the host page at run time, never by this source" } }).some((p) => /no longer used/.test(p)),
  "an allowlist entry the source no longer uses is refused (the list cannot quietly rot)");
check(judgeAllowlist([judge(":root{--runtime:1}.a{color:var(--runtime)}")], { allow: { "--runtime": "set by the host page at run time, never by this source" } }).some((p) => /now defined/.test(p)),
  "an allowlist entry the source now defines is refused");
check(judgeAllowlist([used], { allow: { "--runtime": "" } }).some((p) => /no real reason/.test(p)), "an allowlist entry with no reason is refused");

check(stripComments("a\n/* x\ny */\nb // c\nd").split("\n").length === 5, "stripping comments keeps every newline, so reported line numbers are the file's own line numbers");
check(scanTokens("a { b: var(--x); }").uses.length === 1, "scanTokens finds a plain use");

/* ---- the real tree ---- */
const real = lintCssTokens();
check(real.problems.length === 0, "the real source tree passes", () => real.problems.slice(0, 5).join("\n"));
const app = real.results[0];
check(app.used > 1000 && app.defined > 30, `the scan read a real amount of the app (${app.used} uses, ${app.defined} definitions), so a pass means something`, () => JSON.stringify({ used: app.used, defined: app.defined }));
check(real.results.some((x) => /guest\.html/.test(x.label) && x.used > 0), "guest.html is judged as its own document");

/* ---- B) the wiring: lint-patterns.mjs --src-dir ---- */
const LINT = path.join(HERE, "lint-patterns.mjs");
const dirs = [];
function standIn(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guidon-token-lint-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}
const runLint = (dir) => {
  const res = spawnSync(process.execPath, [LINT, "--src-dir", dir], { cwd: APP, encoding: "utf8" });
  return { code: res.status, out: (res.stdout || "") + (res.stderr || "") };
};
try {
  const honest = standIn({ "index.html": ":root{--text:#111}\n.a{color:var(--text)}\n", "guest.html": ":root{--muted:#666}\n.b{color:var(--muted)}\n" });
  const h = runLint(honest);
  check(h.code === 0 && /PASS {2}\(t\) every var/.test(h.out), "lint-patterns passes on an honest stand-in src (the check is wired in and not merely failing)", () => `exit ${h.code}\n${h.out}`);

  const planted = standIn({ "index.html": ":root{--text:#111}\n.a{color:var(--text)}\n.b{color:var(--fg,#e8f0f6)}\n", "guest.html": ":root{--muted:#666}\n" });
  const p = runLint(planted);
  check(p.code !== 0 && /FAIL {2}\(t\) index\.html:3 uses var\(--fg\)|FAIL {2}\(t\) src\/index\.html:3 uses var\(--fg\)/.test(p.out),
    "lint-patterns exits non-zero and names (t), the file, the line and --fg when a stand-in src plants the Forms bug", () => `exit ${p.code}\n${p.out.split("\n").filter((l) => /\(t\)/.test(l)).join("\n")}`);

  const crossDoc = standIn({ "index.html": ":root{--text:#111}\n.a{color:var(--muted)}\n", "guest.html": ":root{--muted:#666}\n" });
  const c = runLint(crossDoc);
  check(c.code !== 0 && /--muted/.test(c.out), "lint-patterns refuses index.html using a token only guest.html defines", () => `exit ${c.code}\n${c.out}`);
} finally {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

await finish("CSS-TOKEN-LINT");
