/**
 * css-token-rules: the ONE judge of "does every var(--x) in the app's own
 * source name a custom property something actually defines?".
 *
 * Why this exists (audit 2026-09, forms-invisible-text): Forms Trainer text
 * was written as var(--fg, #e8f0f6) and var(--muted, #8ba0ad). No theme has
 * ever defined --fg or --muted, so the browser quietly used the pale
 * FALLBACK colour in every theme - fine on the 20 dark themes, near-invisible
 * (1.04:1) on the 10 light ones, including Field Manual, the default. A typo
 * in a token name never errors: CSS just uses the fallback (or, with no
 * fallback, the inherited/initial value), and only a person looking at a
 * light theme notices. Eight such tokens had accumulated (--fg, --muted,
 * --accent, --warn, --olive, --ink-blue, --mono, --grid-line).
 *
 * What counts as "defined" (per document): a declaration `--name:` anywhere
 * in the source (a CSS rule, an inline style string, a JS style string), a
 * setProperty("--name", ...) call, or an @property rule. Comments are removed
 * first, so a note that MENTIONS a token neither uses nor defines it.
 *
 * What is skipped: a line over LONG_LINE characters is embedded data or a
 * vendored library (the GUIDON_SEED blob, base64 PDFs, pdf.js), never
 * hand-written CSS. That is how the vendored pdf.js --scale-factor uses are
 * kept out without naming them.
 *
 * Documents: src/index.html plus every script it loads at run time
 * (src/*.js, src/app-modules/*.js) are ONE document - a module's inline style
 * legitimately uses a token index.html defines. src/guest.html is its own
 * page with its own tokens, so it is judged against itself.
 *
 * ALLOWLIST: { "--token": "why this one is fine" }. Every entry needs a
 * reason, and an entry the source no longer needs is itself a failure, so the
 * list cannot quietly rot. It is empty today: nothing has needed it.
 *
 * Pure functions, no browser; tools/test-css-token-lint.mjs plants each
 * defect shape to prove this rejects it and accepts honest input.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SRC_DIR = path.resolve(HERE, "..", "src");
export const LONG_LINE = 20000;

/* Tokens set at run time in a way no static scan can see (for example
   "--" + name), each with the reason. Empty on purpose. */
export const ALLOWLIST = Object.freeze({});

const TOKEN = "--[A-Za-z0-9_-]+";

/** Blank out over-long lines (embedded data / vendored code), keep newlines. */
export function dropLongLines(text, limit = LONG_LINE) {
  return text.split("\n").map((l) => (l.length > limit ? "" : l)).join("\n");
}

/** Remove comments but keep every newline, so line numbers stay true.
    Block comments first; then a `//` comment that starts a line or follows
    whitespace (never the // inside "https://..."). */
export function stripComments(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
  return noBlock.replace(/(^|[\s;{}(,])\/\/[^\n]*/gm, "$1");
}

/** Every var(--x ...) use and every definition in one cleaned source text. */
export function scanTokens(text) {
  const clean = stripComments(dropLongLines(text));
  const uses = [];
  const defs = new Set();
  clean.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(new RegExp("var\\(\\s*(" + TOKEN + ")", "g"))) uses.push({ token: m[1], line: i + 1 });
    for (const m of line.matchAll(new RegExp("(" + TOKEN + ")\\s*:", "g"))) defs.add(m[1]);
    for (const m of line.matchAll(new RegExp("setProperty\\(\\s*[\"'`](" + TOKEN + ")", "g"))) defs.add(m[1]);
    for (const m of line.matchAll(new RegExp("@property\\s+(" + TOKEN + ")", "g"))) defs.add(m[1]);
  });
  return { uses, defs };
}

/**
 * judgeDocument([{ name, text }...], { allow }) -> { problems, used, defined,
 * usedUndefined, definedSet }
 * One call judges ONE document (all the given sources together). It reports
 * uses nothing defines; whether an allowlist entry is still needed is judged
 * across ALL documents by judgeAllowlist().
 */
export function judgeDocument(sources, { allow = ALLOWLIST } = {}) {
  const scans = sources.map((s) => ({ name: s.name, ...scanTokens(s.text) }));
  const definedSet = new Set();
  for (const s of scans) for (const d of s.defs) definedSet.add(d);
  const problems = [];
  const usedUndefined = new Set();
  let used = 0;
  for (const s of scans) {
    for (const u of s.uses) {
      used++;
      if (definedSet.has(u.token)) continue;
      if (Object.prototype.hasOwnProperty.call(allow, u.token)) { usedUndefined.add(u.token); continue; }
      problems.push(`${s.name}:${u.line} uses var(${u.token}), which nothing defines - the browser silently falls back, so the colour or size is wrong in some themes. Use a real token (--text, --text-dim, --ink-cyan, ...) or define this one.`);
    }
  }
  return { problems, used, defined: definedSet.size, usedUndefined, definedSet };
}

/** An allowlist entry needs a real reason and must still be needed: used
    somewhere, and defined nowhere. Judged over every document's result. */
export function judgeAllowlist(results, { allow = ALLOWLIST } = {}) {
  const problems = [];
  for (const [tok, why] of Object.entries(allow)) {
    if (!why || typeof why !== "string" || why.trim().length < 12) problems.push(`allowlist entry ${tok} has no real reason - write down why it is fine`);
    if (results.some((r) => r.definedSet.has(tok))) problems.push(`allowlist entry ${tok} is now defined in the source - remove it from the allowlist`);
    else if (!results.some((r) => r.usedUndefined.has(tok))) problems.push(`allowlist entry ${tok} is no longer used - remove it from the allowlist`);
  }
  return problems;
}

/** The repo's real documents, read from disk. */
export function collectDocuments(srcDir = SRC_DIR) {
  const read = (rel) => ({ name: "src/" + rel.split(path.sep).join("/"), text: readFileSync(path.join(srcDir, rel), "utf8") });
  const app = [read("index.html")];
  for (const f of readdirSync(srcDir).sort()) if (f.endsWith(".js")) app.push(read(f));
  const modDir = path.join(srcDir, "app-modules");
  if (existsSync(modDir)) for (const f of readdirSync(modDir).sort()) if (f.endsWith(".js")) app.push(read(path.join("app-modules", f)));
  const docs = [{ label: "the app (index.html + its scripts)", sources: app }];
  if (existsSync(path.join(srcDir, "guest.html"))) docs.push({ label: "guest.html", sources: [read("guest.html")] });
  return docs;
}

/** Judge every real document; returns { results, problems } (problems is the
    flat list, each already naming its file and line). */
export function lintCssTokens({ srcDir = SRC_DIR, allow = ALLOWLIST } = {}) {
  const results = collectDocuments(srcDir).map((d) => ({ label: d.label, ...judgeDocument(d.sources, { allow }) }));
  const problems = results.flatMap((r) => r.problems).concat(judgeAllowlist(results, { allow }));
  return { results, problems };
}
