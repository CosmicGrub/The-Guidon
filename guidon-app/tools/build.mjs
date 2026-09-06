/**
 * GUIDON build.
 *
 * Two sources - src/index.html (the app shell: nav, routing, and every module
 * that hasn't been split out) PLUS every *.js file in src/app-modules/ (a
 * module per file, spliced in as its own <script> block right before
 * </body> - see "app modules" below) - produce two artifacts, because the
 * project has two distribution promises to keep:
 *
 *   dist/guidon-standalone.html
 *       The hand-someone-the-file build. Self-contained, opens from file://,
 *       no siblings required. Unchanged behaviour; only the favicon is upgraded.
 *
 *   web/
 *       The installable/hostable bundle: index.html + manifest.webmanifest +
 *       sw.js + icons/. This is what installs as a real app and what the native
 *       wrappers (Tauri desktop, Capacitor Android) load.
 *
 *   dist/guest.html   (collective P3b, X2)
 *       The room GUEST page a host device serves to a phone with nothing
 *       installed (tools/room-server.mjs, later the Rust/Kotlin hosts):
 *       src/guest.html with src/app-modules/room-schema.js pasted in
 *       verbatim and the room module's PURE CORE lifted from between the
 *       GUEST-CORE markers in src/app-modules/studygroup.js - see
 *       buildGuestPage(). Under 200 KB, GUIDON_FORK = "guest" exactly
 *       once, and no crypto.subtle / getUserMedia / wakeLock / storage
 *       API named anywhere in it - all asserted, never assumed.
 *
 * src/index.html alone is NOT the complete app - a handful of modules
 * (currently: assignments, calendar, currency, fitness, icons, leader,
 * records, scrollhint) live only in src/app-modules/*.js and are injected
 * here. Grepping src/index.html alone for one of those modules' "G.<name> ="
 * assignment will correctly find nothing; that is not evidence of a missing
 * module, only evidence of where it actually lives. assertRouteModulesPresent()
 * below cross-checks the fully ASSEMBLED output instead, and fails the build
 * loudly if a registered route's module genuinely never got assigned.
 *
 * Nothing is minified or restructured. Every edit below is a targeted,
 * asserted replacement — if the anchor text is not found exactly once, the
 * build fails loudly rather than silently producing a broken artifact.
 */
import { readFile, writeFile, mkdir, copyFile, readdir, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ICON_TARGETS } from "./icon-spec.mjs";

const SRC = "src/index.html";
const PWA = "src/pwa.js";
const WEB = "web";
const DIST = "dist";

/**
 * Rewrites `window.GUIDON_SEED = {...}` as `window.GUIDON_SEED = JSON.parse("...")`.
 *
 * V8 parses JSON with a dedicated parser that is materially faster than the
 * full JavaScript parser over the same bytes. Measured on this seed with
 * tools/perf-seed.mjs, median of 5 cold loads at 412x915:
 *
 *      1x CPU   85ms -> 81ms   (-4ms)
 *      4x CPU  395ms -> 362ms  (-33ms)
 *      6x CPU  652ms -> 558ms  (-94ms, 14%)
 *
 * Cost is +0.11 MB raw and, measured, ZERO gzip and ZERO brotli — the escaped
 * quotes compress away completely, so nothing extra goes over the wire.
 *
 * Every prior session deferred the seed as "needs its own dedicated session",
 * because the obvious lever — loading it asynchronously — touches all 34 modules
 * that read store.* and risks a study app's correctness for ~200ms. This is a
 * different lever: a build-time transform, no async, no module changes.
 *
 * The safety net is that the literal must be STRICT JSON. If it ever stops
 * being (a trailing comma, a comment, an unquoted key, a Date), JSON.parse
 * throws here and the build fails loudly rather than shipping a broken seed.
 *
 * RE-CONFIRMED 2026-08-30 (roadmap-week audit, Performance lens): this
 * transform is still the only mitigation shipped, and the bulk of the cost
 * is still live. Ran tools/perf.mjs end-to-end against the current shipped
 * web/index.html vs. a GUIDON_SEED-surgically-stripped variant (median of 3
 * cold loads, 412x915 viewport):
 *
 *      1x CPU (desktop):        full  241ms DCL vs no-seed  179ms -> seed costs  ~62ms
 *      4x CPU (mid-range phone): full 1261ms DCL vs no-seed  874ms -> seed costs ~387ms
 *      6x CPU (budget phone):    full 2118ms DCL vs no-seed 1319ms -> seed costs ~799ms
 *
 * At the 6x tier this one inline payload is ~38% of total DOMContentLoaded.
 * The deferred-async-load lever above is still the real fix and still not
 * attempted here on purpose - touching all 34 store.*-reading modules for a
 * study app's correctness is genuinely its own session, not a roadmap-week
 * bucket item alongside a dozen unrelated fixes. A narrower first step worth
 * a future session's own dedicated pass: defer only the seed's largest,
 * least-immediately-needed sub-trees (doctrine's ~210KB of body text, the
 * board bank's ~611KB of question text) behind a microtask/idle-callback
 * after first paint, mirroring how build.mjs already extracts pdf-lib/DA4856
 * to an on-demand sibling file - a smaller-scoped version of the same lever,
 * rather than deferring the whole seed at once.
 */
function seedAsJsonParse(html) {
  const START = "window.GUIDON_SEED = ";
  const at = html.indexOf(START);
  if (at < 0) throw new Error("build: GUIDON_SEED assignment not found");
  const objStart = at + START.length;
  if (html[objStart] !== "{") {
    // Already transformed, or shaped differently than expected. Do not guess.
    return { html, skipped: true };
  }
  // Brace-match through string literals so braces inside content cannot fool it.
  let depth = 0, inStr = false, esc = false, objEnd = -1;
  for (let p = objStart; p < html.length; p++) {
    const c = html[p];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (inStr) { if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { objEnd = p + 1; break; } }
  }
  if (objEnd < 0) throw new Error("build: could not brace-match the GUIDON_SEED literal");

  const literal = html.slice(objStart, objEnd);
  let parsed;
  try {
    parsed = JSON.parse(literal);
  } catch (e) {
    throw new Error(
      "build: GUIDON_SEED is no longer strict JSON, so it cannot be served through " +
      "JSON.parse (" + e.message + "). Either restore strict JSON or remove this transform."
    );
  }
  // JSON.stringify produces a correctly-escaped JS string literal. Hand-rolling
  // that escaping produced a variant that measured 37% faster because it had
  // silently stopped booting — the kind of result that reads as a win.
  const out = html.slice(0, objStart) + "JSON.parse(" + JSON.stringify(JSON.stringify(parsed)) + ")" + html.slice(objEnd);
  return { html: out, skipped: false, keys: Object.keys(parsed).length,
           before: literal.length, after: out.length - html.length + literal.length };
}

/**
 * Parses js/theme.js's `const THEMES = [...]` registry (embedded in src/index.html)
 * and returns the two derived lists the pre-paint bootstrap <script> needs:
 * every theme id in registration order, and the subset whose `kind` is "light".
 *
 * WHY THIS EXISTS: the pre-paint script (top of <head>, applies data-theme
 * before first paint so there's no flash of the wrong theme) runs before
 * js/theme.js itself has loaded, so it can't just call G.theme / read its
 * THEME_IDS at runtime - it has always carried its OWN copies, `var T=[...]`
 * (every id) and `var LIGHT=[...]` (the light-kind subset, for the legacy
 * `.light` class toggle). Those copies used to be hand-maintained and drifted:
 * the ten "Focus set" themes added in session 35 (graphite-calm, umber-lamp,
 * pine-dusk, slate-quiet, clay-warm, harbor-mid, parchment-read, bone-neutral,
 * overcast-glare, sandstone-sun) were never added to either array, so anyone
 * on one of those themes got a real flash of the wrong theme on every load -
 * T.indexOf(a.theme) came back -1, so the pre-paint script silently fell back
 * to field-manual/parade-rest until js/theme.js finished parsing and corrected
 * the attribute a beat later. Fixed by deriving both lists here, at build
 * time, from the same THEMES array THEME_IDS itself is built from (see
 * js/theme.js), so a new theme can never again exist in THEMES without the
 * pre-paint script knowing about it - see the "pre-paint theme-id sync" call
 * site in main() below, which asserts these into `var T=`/`var LIGHT=`.
 *
 * Brace-matches through string literals exactly like seedAsJsonParse above
 * (so a `]` or `"` inside a blurb can't fool it), then evaluates the literal
 * with `new Function` - safe here because the input is this repo's own
 * trusted src/index.html, not user data, same trust boundary as
 * seedAsJsonParse's JSON.parse. Exported (and main() only self-invokes under
 * the direct-execution guard at the bottom of this file) so tools/test-*.mjs
 * can unit-test this derivation against a synthetic THEMES literal without
 * triggering a real build as an import side effect.
 */
function deriveThemeIds(html) {
  const START = "const THEMES = [";
  const at = html.indexOf(START);
  if (at < 0) throw new Error("build: THEMES array not found (js/theme.js registry)");
  const arrStart = html.indexOf("[", at);
  let depth = 0, inStr = false, esc = false, arrEnd = -1;
  for (let p = arrStart; p < html.length; p++) {
    const c = html[p];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (inStr) { if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { arrEnd = p + 1; break; } }
  }
  if (arrEnd < 0) throw new Error("build: could not brace-match the THEMES array literal");
  const literal = html.slice(arrStart, arrEnd);
  let themes;
  try {
    themes = new Function("return " + literal)();
  } catch (e) {
    throw new Error(`build: THEMES array literal did not evaluate (${e.message})`);
  }
  if (!Array.isArray(themes) || !themes.length) {
    throw new Error("build: THEMES evaluated to something empty or non-array");
  }
  const ids = themes.map((t) => t.id);
  const lightIds = themes.filter((t) => t.kind === "light").map((t) => t.id);
  return { ids, lightIds };
}

/**
 * --ink-* static fallbacks for engines below the floor (collective roadmap
 * Q11: Chromium 111 / WebView 111 / WebKit 16.2 / Gecko 113 - the releases
 * that first shipped color-mix(), see tools/engine-floor.json).
 *
 * The five --ink-* text tokens are declared once, on html, as
 * color-mix(in srgb, var(--amber) 60%, var(--text) 40%) etc. Below the floor
 * that computes to nothing and every accent-coloured line of text falls back
 * to its inherited colour. This generates, per theme, the same 60/40 sRGB
 * blend as a static #rrggbb - resolved from THAT theme's own --amber/--green/
 * --red/--cyan/--violet/--text through the real cascade: the theme block
 * html[data-theme="<id>"] {...} first, then html.light {...} for light-kind
 * themes (same specificity, earlier in source - asserted), then :root - and
 * emits one rule per theme (plus a base html {} rule from :root) inside
 *
 *   @supports not (color: color-mix(in srgb, red, blue)) { ... }
 *
 * appended to the main stylesheet, so an engine AT the floor never sees them
 * and the live color-mix rule stays in charge (tools/test-ink-fallbacks.mjs
 * proves the cascade in Chromium and recomputes every blend independently).
 *
 * WHY NOT two declarations in each theme block (static, then color-mix, "the
 * engine without color-mix keeps the first")? Measured, not assumed
 * (test-ink-fallbacks part (e)): a custom property is never invalid at parse
 * time - any token stream is a valid value - so the LAST declaration wins on
 * every engine and the static one would be discarded exactly where it is
 * needed. Declaration-level fallback exists for `color:`, not for `--x:`.
 *
 * Nothing here is typed by hand: the theme ids come from the stylesheet's own
 * html[data-theme="<id>"] blocks (cross-checked against the THEMES registry
 * by the caller), the colours from the declarations inside them. A value
 * that is not a plain #hex / rgb() literal is reported and skipped in favour
 * of the next rule in the chain; a declaration of one of the six tokens in
 * any OTHER rule fails the build, because this resolver would not model it.
 */
const INK_TOKENS = ["amber", "green", "red", "cyan", "violet"];
const INK_SOURCE_TOKENS = [...INK_TOKENS, "text"];
const INK_MARKER = "/* ==== --ink-* static fallbacks (generated by tools/build.mjs - do not hand-edit) ====";
const INK_SUPPORTS = "@supports not (color: color-mix(in srgb, red, blue)) {";

function parseColorLiteral(v) {
  const s = String(v == null ? "" : v).trim();
  let m;
  if ((m = /^#([0-9a-f]{6})$/i.exec(s))) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  if ((m = /^#([0-9a-f]{3})$/i.exec(s))) return m[1].split("").map((c) => parseInt(c + c, 16));
  if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*1(?:\.0*)?\s*)?\)$/i.exec(s))) return [+m[1], +m[2], +m[3]];
  return null;
}

function injectInkFallbacks(html, lightIds, floor) {
  const styleOpen = html.indexOf("<style>");
  const styleClose = html.indexOf("</style>", styleOpen);
  if (styleOpen < 0 || styleClose < 0) throw new Error("build: main <style> block not found (ink fallbacks)");
  const cssRaw = html.slice(styleOpen, styleClose);
  // Blank comments in place (offsets and line numbers survive) so a token
  // named in prose is never read as a declaration.
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lineAt = (i) => html.slice(0, styleOpen + i).split("\n").length;
  const bodyOf = (open) => {
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") { depth--; if (depth === 0) return { body: css.slice(open + 1, i), end: i }; }
    }
    throw new Error("build: unbalanced braces in the stylesheet (ink fallbacks)");
  };
  const declsOf = (body) => {
    const d = {};
    for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;{}]+);/g)) d[m[1]] = m[2].trim();
    return d;
  };
  const oneBlock = (re, label) => {
    const ms = [...css.matchAll(re)];
    if (ms.length !== 1) throw new Error(`build: expected exactly one "${label}" rule in the stylesheet, found ${ms.length} (ink fallbacks)`);
    const b = bodyOf(css.indexOf("{", ms[0].index));
    return { index: ms[0].index, end: b.end, decls: declsOf(b.body) };
  };
  const root = oneBlock(/^:root\s*\{/gm, ":root {");
  // html.light is declared more than once (a one-line color-scheme rule
  // near the top, the token block further down): merge every html.light
  // block in source order, later declarations winning, exactly as the
  // cascade does for equal-specificity rules.
  const lightBlocks = [...css.matchAll(/^html\.light\s*\{/gm)].map((m) => {
    const b = bodyOf(css.indexOf("{", m.index));
    return { index: m.index, end: b.end, decls: declsOf(b.body) };
  });
  if (!lightBlocks.length) throw new Error("build: no html.light { } rule found in the stylesheet (ink fallbacks)");
  const light = { decls: Object.assign({}, ...lightBlocks.map((b) => b.decls)) };
  const themes = [];
  for (const m of css.matchAll(/^html\[data-theme="([a-z0-9-]+)"\]\s*\{/gm)) {
    const b = bodyOf(css.indexOf("{", m.index));
    themes.push({ id: m[1], index: m.index, end: b.end, decls: declsOf(b.body) });
  }
  if (!themes.length) throw new Error("build: no html[data-theme=\"<id>\"] { blocks found (ink fallbacks)");
  const dupes = themes.map((t) => t.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupes.length) throw new Error(`build: theme block declared twice: ${dupes.join(", ")} (ink fallbacks)`);
  // Cascade-order assumption: html.light and html[data-theme] tie on
  // specificity (0,1,1), so a light theme's own block only wins because it
  // comes LATER in source. Assert that for every html.light block that
  // declares one of the six tokens, rather than trusting it.
  const firstTheme = Math.min(...themes.map((t) => t.index));
  for (const b of lightBlocks) {
    const declares = INK_SOURCE_TOKENS.filter((t) => t in b.decls);
    if (declares.length && b.index > firstTheme) {
      throw new Error(`build: an html.light { } rule at src/index.html:${lineAt(b.index)} declares --${declares.join("/--")} AFTER a theme block - it would override light themes' tokens, and this resolver assumes the opposite`);
    }
  }
  // Every declaration of the six source tokens must live in one of the
  // rules modelled here; anything else (an @media, html.hc, a variant
  // rule) would make the static blend wrong on that engine.
  const ranges = [root, ...lightBlocks, ...themes].map((b) => [b.index, b.end]);
  const tokenRe = new RegExp("--(" + INK_SOURCE_TOKENS.join("|") + ")\\s*:", "g");
  for (const m of css.matchAll(tokenRe)) {
    if (!ranges.some(([a, b]) => m.index >= a && m.index <= b)) {
      throw new Error(`build: --${m[1]} is declared outside :root / html.light / html[data-theme] blocks at src/index.html:${lineAt(m.index)} - the --ink-* fallback resolver does not model that rule; add it to injectInkFallbacks() first`);
    }
  }
  const reported = [];
  const resolve = (id, chain) => {
    const out = {};
    for (const t of INK_SOURCE_TOKENS) {
      let picked = null;
      for (const [where, decls] of chain) {
        const v = decls[t];
        if (v === undefined) continue;
        const c = parseColorLiteral(v);
        if (c) { picked = c; break; }
        reported.push(`${id}: --${t}: "${v}" in ${where} is not a plain #hex / rgb() literal - skipped, next rule in the chain used`);
      }
      if (!picked) throw new Error(`build: cannot resolve --${t} for ${id} to a literal colour (ink fallbacks)`);
      out[t] = picked;
    }
    return out;
  };
  const blend = (a, t) => a.map((v, i) => Math.round(0.6 * v + 0.4 * t[i]));
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  const ruleFor = (sel, r) => `${sel} { ` + INK_TOKENS.map((t) => `--ink-${t}: ${hex(blend(r[t], r.text))};`).join(" ") + " }";
  const lines = [
    INK_MARKER,
    `   Engine floor (tools/engine-floor.json, ${floor.decidedBy}): Chromium ${floor.chromium} / WebView ${floor.webview} /`,
    `   WebKit ${floor.webkit} / Gecko ${floor.gecko} - the releases that first shipped color-mix(). Below it the`,
    "   html { --ink-*: color-mix(...) } rule above computes to nothing, so every theme gets its",
    "   60% accent / 40% --text blend precomputed in sRGB from that theme's own tokens (per",
    "   channel: round(.6 * accent + .4 * text)), resolved through the real cascade (theme block,",
    "   then html.light for light themes, then :root). An engine AT the floor never enters",
    "   this block. Two declarations in the theme block would NOT work: a custom property is",
    "   never invalid at parse time, so the later one always wins (measured in",
    "   tools/test-ink-fallbacks.mjs). Regenerated by every build from the theme blocks. */",
    INK_SUPPORTS,
    ruleFor("html", resolve(":root (base)", [[":root", root.decls]])),
  ];
  for (const t of themes) {
    const chain = [[`html[data-theme="${t.id}"]`, t.decls]];
    if (lightIds.includes(t.id)) chain.push(["html.light", light.decls]);
    chain.push([":root", root.decls]);
    lines.push(ruleFor(`html[data-theme="${t.id}"]`, resolve(t.id, chain)));
  }
  lines.push("}", "");
  const block = "\n" + lines.join("\n");
  return { html: html.slice(0, styleClose) + block + html.slice(styleClose), ids: themes.map((t) => t.id), reported, block };
}

/** Number of generated static --ink-* declarations inside an output's fallback block. */
function countInkFallbacks(html, label) {
  const parts = html.split(INK_MARKER);
  if (parts.length !== 2) throw new Error(`build: ${label} carries the --ink-* fallback marker ${parts.length - 1} times (expected exactly 1)`);
  const from = html.indexOf(INK_SUPPORTS, html.indexOf(INK_MARKER));
  if (from < 0) throw new Error(`build: ${label} lacks the @supports-not block after the --ink-* marker`);
  let depth = 0, to = -1;
  for (let i = html.indexOf("{", from); i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) { to = i; break; } }
  }
  const body = html.slice(from, to);
  return {
    themeRules: (body.match(/html\[data-theme="[a-z0-9-]+"\] \{/g) || []).length,
    statics: (body.match(/--ink-(amber|green|red|cyan|violet): #[0-9a-f]{6};/g) || []).length,
  };
}

/**
 * { sha, dirty } of the checkout this build runs from (collective P2). sha is
 * the full 40-hex HEAD or "" when git is unavailable; dirty is true when
 * `git status --porcelain` lists anything (so a probe from an uncommitted
 * tree - like every P2 session build - says so). Never throws.
 */
function gitIdentity() {
  const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
  let sha = "", dirty = false;
  try { sha = execSync("git rev-parse HEAD", opts).trim(); } catch (e) { sha = ""; }
  if (!/^[0-9a-f]{40}$/.test(sha)) sha = "";
  if (sha) {
    try { dirty = execSync("git status --porcelain", opts).trim().length > 0; } catch (e) { dirty = false; }
  }
  return { sha, dirty };
}

/** Replace exactly once, or fail. Silent no-op replacements are how builds rot. */
function sub(html, find, replace, label) {
  const parts = html.split(find);
  if (parts.length !== 2) {
    throw new Error(`build: anchor "${label}" matched ${parts.length - 1} times (expected exactly 1)`);
  }
  return parts[0] + replace + parts[1];
}

/* ---------------- guest page (collective P3b, X2) ----------------
   dist/guest.html from src/guest.html + the SAME two sources the app
   carries: src/app-modules/room-schema.js verbatim (ONE schema module,
   tools/test-guest-page.mjs asserts the exact text is inside) and the
   block of src/app-modules/studygroup.js between the GUEST-CORE markers
   (the defaults, the helpers and the pure host/peer core), wrapped in its
   own IIFE as G.roomCore. Every slot is an asserted exactly-once
   replacement; the assembled page is asserted small, LF-only, stamped
   once, and free of the secure-context and storage APIs a guest page must
   never touch (the guest is a plain-http insecure context that stores
   nothing). */
const GUEST_TEMPLATE = "src/guest.html";
const GUEST_CORE_BEGIN = "  /* ==== GUEST-CORE BEGIN ==== */\n";
const GUEST_CORE_END = "  /* ==== GUEST-CORE END ==== */\n";
const GUEST_MAX_BYTES = 200 * 1024;
const GUEST_FORBIDDEN = [/crypto\.subtle/, /\.subtle\b/, /getUserMedia/, /wakeLock/, /mediaDevices/, /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /navigator\.storage/, /serviceWorker/];
async function buildGuestPage(o) {
  const tpl = await readFile(GUEST_TEMPLATE, "utf8");
  const schemaSrc = await readFile("src/app-modules/room-schema.js", "utf8");
  const sgSrc = await readFile("src/app-modules/studygroup.js", "utf8");
  for (const [label, src] of [["src/guest.html", tpl], ["room-schema.js", schemaSrc], ["studygroup.js", sgSrc]]) {
    if (src.includes("\r")) throw new Error(`build: ${label} contains CR bytes (LF-only)`);
  }
  const a = sgSrc.split(GUEST_CORE_BEGIN);
  if (a.length !== 2) throw new Error(`build: GUEST-CORE BEGIN marker found ${a.length - 1} times in studygroup.js (expected exactly 1)`);
  const b = a[1].split(GUEST_CORE_END);
  if (b.length !== 2) throw new Error(`build: GUEST-CORE END marker found ${b.length - 1} times after BEGIN in studygroup.js (expected exactly 1)`);
  const block = b[0];
  for (const re of GUEST_FORBIDDEN) if (re.test(block)) throw new Error(`build: the GUEST-CORE block of studygroup.js names ${re} - the guest page must not carry it`);
  for (const name of ["function initPeer", "function reduce(", "function act(", "function frameOf", "function snapshotOf", "function randomToken", "var DEFAULTS"]) {
    if (!block.includes(name)) throw new Error(`build: the GUEST-CORE block lacks ${name}`);
  }
  const core = [
    "/* ==== room core (lifted verbatim from src/app-modules/studygroup.js between its GUEST-CORE markers by tools/build.mjs) ==== */",
    "(function (root) {",
    "  \"use strict\";",
    "  root.G = root.G || {};",
    "  var G = root.G;",
    block.replace(/\n$/, ""),
    "  G.roomCore = { DEFAULTS: DEFAULTS, initHost: initHost, initPeer: initPeer, reduce: reduce, act: act, snapshotOf: snapshotOf, snapshotFrames: snapshotFrames, frameOf: frameOf, randomToken: randomToken };",
    "})(window);",
  ].join("\n");
  let html = tpl;
  html = sub(html, "/*@@ROOM_SCHEMA@@*/", schemaSrc.replace(/\n$/, ""), "guest: schema slot");
  html = sub(html, "/*@@ROOM_CORE@@*/", core, "guest: core slot");
  html = sub(html, 'window.GUIDON_APP_VERSION = "@@APP_VERSION@@";', `window.GUIDON_APP_VERSION = "${o.version}";`, "guest: app version");
  html = sub(html, 'window.GUIDON_BUILD_DATE = "@@BUILD_DATE@@";', `window.GUIDON_BUILD_DATE = "${o.buildDate}";`, "guest: build date");
  html = sub(html, 'window.GUIDON_BUILD_SHA = "@@BUILD_SHA@@";', `window.GUIDON_BUILD_SHA = "${o.buildSha}";`, "guest: build sha");
  html = sub(html, "window.GUIDON_BUILD_DIRTY = @@BUILD_DIRTY@@;", `window.GUIDON_BUILD_DIRTY = ${o.buildDirty};`, "guest: build dirty");
  if (/@@[A-Z_]+@@/.test(html)) throw new Error("build: an unfilled @@SLOT@@ remains in dist/guest.html");
  const marks = html.split('window.GUIDON_FORK = "guest";').length - 1;
  if (marks !== 1) throw new Error(`build: GUIDON_FORK = "guest" occurs ${marks} times in dist/guest.html (expected exactly 1)`);
  for (const re of GUEST_FORBIDDEN) if (re.test(html)) throw new Error(`build: dist/guest.html names ${re} - a guest page must not`);
  if (html.includes("\r")) throw new Error("build: dist/guest.html would contain CR bytes");
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes >= GUEST_MAX_BYTES) throw new Error(`build: dist/guest.html is ${bytes} bytes (limit ${GUEST_MAX_BYTES})`);
  return { html, bytes, coreBytes: Buffer.byteLength(core, "utf8") };
}

// Safety net for exactly the failure class a Diagnostics-scoping pass once
// suspected (correctly, in caution; incorrectly, in the specific instance -
// see selftest.js's "Module integrity"/"Route health" checks, which catch
// this same thing at runtime): a route in ROUTES calling into G.<name> whose
// module never actually got assigned onto G anywhere in the assembled
// output - e.g. a module deleted from src/app-modules/ without its route
// being removed too, or a future module extraction that lands the file
// somewhere readdir(appModuleDir) doesn't reach. Scans the FINAL assembled
// HTML (after app modules are already spliced in), not src/index.html
// alone, since app-modules/*.js content legitimately lives outside it until
// this build step injects it. Fails the build loudly and immediately rather
// than shipping a route that throws the instant a Soldier taps it.
function assertRouteModulesPresent(html, label) {
  const needed = new Set();
  for (const m of html.matchAll(/render:\s*\(m\)\s*=>\s*G\.([a-zA-Z_][a-zA-Z0-9_]*)\./g)) needed.add(m[1]);
  const missing = [...needed].filter((name) => !new RegExp("G\\." + name + "\\s*=").test(html));
  if (missing.length) {
    throw new Error(`build: ${label} is missing a "G.<name> = ..." assignment for module(s) referenced by a registered route: ${missing.join(", ")}`);
  }
}

/* The guidon mark as a compact inline SVG, so the favicon matches the app icon
   in every build including the standalone one. */
const FAVICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>" +
  "<rect width='512' height='512' rx='96' fill='%230a0e12'/>" +
  "<g transform='translate(256 256) scale(0.86) translate(-256 -256)'>" +
  "<path d='M150 96 L162 82 L174 96 L174 108 L162 116 L150 108 Z' fill='%23ffb020'/>" +
  "<rect x='155' y='112' width='14' height='316' rx='7' fill='%23c8801a'/>" +
  "<path d='M169 140 L430 140 L344 236 L430 332 L169 332 Z' fill='%23ffb020'/>" +
  "<path d='M212 200 L254 236 L212 272 L192 272 L234 236 L192 200 Z' fill='%230a0e12'/>" +
  "<path d='M276 200 L318 236 L276 272 L256 272 L298 236 L256 200 Z' fill='%230a0e12'/>" +
  "</g></svg>";
const FAVICON_HREF = "data:image/svg+xml," + FAVICON_SVG.replace(/#/g, "%23").replace(/"/g, "'");

/* Applied only when actually running as an installed app, so ordinary
   browser-tab behaviour is left exactly as it is today. */
const STANDALONE_CSS = `
/* ==== installed-app affordances (added by build; see src/pwa.js) ==== */
/* Roadmap-week audit (3rd pass): detectDisplayMode() (src/pwa.js) sets
   data-display-mode="native" - not "standalone" - whenever Capacitor or
   Tauri is detected (isNative overrides any matchMedia result). That value
   was missing from both selector groups below, so the shipped Android APK
   and Tauri desktop build - the one platform where "not looking like a
   wrapped web page" matters most - never actually got the tap-highlight
   removal or overscroll containment; only a PWA installed via a browser's
   "Add to Home Screen" did. Verified empirically: getComputedStyle on a
   mocked-native document matched a plain unmocked browser tab exactly. */
html[data-display-mode="standalone"],
html[data-display-mode="fullscreen"],
html[data-display-mode="minimal-ui"],
html[data-display-mode="native"] {
  /* An accidental downward swipe must not pull-to-refresh a 5 MB app. */
  overscroll-behavior-y: contain;
  /* Removes the tap flash that reads as "web page" rather than "app".
     :focus-visible and :active styling are untouched. */
  -webkit-tap-highlight-color: transparent;
}
html[data-display-mode="standalone"] body,
html[data-display-mode="standalone"] .main,
html[data-display-mode="native"] body,
html[data-display-mode="native"] .main {
  overscroll-behavior-y: contain;
}
`;

async function main() {
  let src = await readFile(SRC, "utf8");
  const pwa = await readFile(PWA, "utf8");
  await mkdir(WEB, { recursive: true });
  await mkdir(DIST, { recursive: true });

  /* ---------------- app version + build date (both builds) ----------------
     GUIDON_APP_VERSION/GUIDON_BUILD_DATE used to be hand-maintained literals
     that nothing rewrote at build time - the exact same bug class shipped
     once before (see GUIDON_STATE.json "CLOSED (44)": app version said
     1.1.0 while all installers said 1.2.0) and recurred (it was found
     showing 1.4.13 while the actual shipped version was 1.4.16, three
     releases stale). Inject both from package.json + the real build
     timestamp instead, so they cannot drift again. */
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const buildDate = new Date().toISOString().slice(0, 10);
  // Collective P2: the git sha (and whether the tree was dirty) travel with
  // the build so a capability probe (G.caps.run(), src/app-modules/caps.js)
  // can say WHICH source it measured - tools/caps-matrix.mjs refuses a probe
  // whose sha is not an ancestor of HEAD. An empty sha is an honest
  // "unknown" (no git on PATH, a tarball checkout): the probe is then
  // refused rather than guessed at, and the build still succeeds.
  const { sha: buildSha, dirty: buildDirty } = gitIdentity();
  const versionAnchor = /window\.GUIDON_APP_VERSION = "[^"]*";\nwindow\.GUIDON_BUILD_DATE = "[^"]*";\nwindow\.GUIDON_BUILD_SHA = "[^"]*";\nwindow\.GUIDON_BUILD_DIRTY = (?:true|false);/;
  const versionMatch = src.match(versionAnchor);
  if (!versionMatch) throw new Error("build: GUIDON_APP_VERSION/GUIDON_BUILD_DATE/GUIDON_BUILD_SHA/GUIDON_BUILD_DIRTY anchor not found");
  src = sub(
    src,
    versionMatch[0],
    `window.GUIDON_APP_VERSION = "${pkg.version}";\nwindow.GUIDON_BUILD_DATE = "${buildDate}";\nwindow.GUIDON_BUILD_SHA = "${buildSha}";\nwindow.GUIDON_BUILD_DIRTY = ${buildDirty};`,
    "app version/build date/sha"
  );

  /* ---------------- pre-paint theme-id sync (both builds) ----------------
     See deriveThemeIds()'s header comment for the full history. Derives the
     real, current theme-id lists from js/theme.js's own THEMES registry and
     overwrites the pre-paint bootstrap script's hand-copied `var T=[...]`
     (every id) and `var LIGHT=[...]` (the light-kind subset) with them, so
     the two can never again silently drift apart. */
  const { ids: themeIds, lightIds: themeLightIds } = deriveThemeIds(src);
  const tAnchor = src.match(/var T=\[[^\]]*\]/);
  if (!tAnchor) throw new Error("build: pre-paint script's \"var T=[...]\" anchor not found");
  src = sub(src, tAnchor[0], `var T=${JSON.stringify(themeIds)}`, "pre-paint theme-id list (var T)");
  const lightAnchor = src.match(/var LIGHT=\[[^\]]*\]/);
  if (!lightAnchor) throw new Error("build: pre-paint script's \"var LIGHT=[...]\" anchor not found");
  src = sub(src, lightAnchor[0], `var LIGHT=${JSON.stringify(themeLightIds)}`, "pre-paint theme-id list (var LIGHT)");

  /* ---------------- engine floor (both builds) ----------------
     tools/engine-floor.json is the ONE declaration of the oldest engines
     every fork runs on (collective Q11); tools/lint-engine-floor.mjs reads
     it to police the source, this stamps it into window.GUIDON_ENGINE_FLOOR
     (app.start()'s below-floor notice names it) and derives the per-theme
     --ink-* static fallbacks - see injectInkFallbacks() above. */
  const floor = JSON.parse(await readFile("tools/engine-floor.json", "utf8"));
  for (const k of ["chromium", "webview", "webkit", "gecko", "decidedBy"]) {
    if (!(k in floor)) throw new Error(`build: tools/engine-floor.json lacks "${k}"`);
  }
  const floorAnchor = src.match(/window\.GUIDON_ENGINE_FLOOR = \{[^\n]*\};/);
  if (!floorAnchor) throw new Error("build: window.GUIDON_ENGINE_FLOOR placeholder anchor not found");
  const floorStamp = { chromium: floor.chromium, webview: floor.webview, webkit: String(floor.webkit), gecko: floor.gecko };
  src = sub(src, floorAnchor[0], `window.GUIDON_ENGINE_FLOOR = ${JSON.stringify(floorStamp)};`, "engine floor stamp");
  const ink = injectInkFallbacks(src, themeLightIds, floor);
  src = ink.html;
  {
    // The stylesheet's theme blocks and the THEMES registry must name the
    // same set: a theme registered without a block (or a block nobody can
    // select) is drift, and either would make "N themes got fallbacks" a
    // hollow number.
    const missing = themeIds.filter((id) => !ink.ids.includes(id));
    const extra = ink.ids.filter((id) => !themeIds.includes(id));
    if (missing.length || extra.length) {
      throw new Error(`build: THEMES registry and html[data-theme] blocks disagree - registry-only: [${missing.join(", ")}] stylesheet-only: [${extra.join(", ")}]`);
    }
  }

  /* ---------------- locate the anchors we rely on ---------------- */
  const manifestLink = src.match(/<link rel="manifest" href="data:application\/manifest\+json,[^"]*"\s*\/?>/);
  if (!manifestLink) throw new Error("build: could not find the inline data: manifest link");
  const faviconLink = src.match(/<link rel="icon" href="data:image\/svg\+xml,[^"]*"\s*\/?>/);
  if (!faviconLink) throw new Error("build: could not find the inline favicon link");
  // NOT a bare "</body>": masterfile §40 documents that markup-shaped strings
  // live inside the JS in this single-file app, and the print-summary code emits
  // a literal "</body></html>". Anchor on the document terminator, which is
  // unambiguously real markup and occurs exactly once.
  const bodyClose = "</script>\n</body>\n</html>";
  if (src.split(bodyClose).length !== 2) throw new Error("build: document terminator not unique");

  /* ---------------- app modules (BOTH builds) ----------------
     These are application content, not packaging, so unlike pwa.js/native.js
     they belong in the standalone build too. They are injected after the app
     shell so every G.* dependency already exists; ROUTES may reference them
     because its render callbacks are lazy arrow functions, and the shell defers
     app.start() to DOMContentLoaded, which fires after these run. */
  const appModuleDir = "src/app-modules";
  const appModuleFiles = (await readdir(appModuleDir).catch(() => [])).filter((f) => f.endsWith(".js")).sort();
  let appModules = "";
  for (const f of appModuleFiles) {
    appModules += `<script>\n${await readFile(join(appModuleDir, f), "utf8")}\n</script>\n`;
  }

  /* =========================================================== standalone */
  // Identical to source apart from a favicon that matches the real app icon,
  // and the seed served through JSON.parse (see seedAsJsonParse). Both builds
  // get the seed transform: the standalone file is parsed on exactly the same
  // hardware and benefits identically.
  let standalone = sub(src, faviconLink[0], `<link rel="icon" href="${FAVICON_HREF}" />`, "favicon(standalone)");
  const seed = seedAsJsonParse(standalone);
  standalone = seed.html;
  standalone = sub(standalone, bodyClose, `</script>\n${appModules}</body>\n</html>`, "terminator(standalone)");
  /* ---------------- fork marker (collective P2) ----------------
     src/index.html is shared by every fork and carries NO fork marker; each
     output gets its own here, at the one anchor where GUIDON_SINGLEFILE is
     set (see the comment at that literal in src/index.html). The standalone
     file keeps GUIDON_SINGLEFILE = true; web/ (which Tauri, Capacitor
     Android and Capacitor iOS all load) gets false plus GUIDON_FORK = "web"
     below - the runtime narrows "web" to tauri/android/ios/pwa in
     G.caps.fork() (src/app-modules/caps.js) from the shell globals. */
  const SINGLEFILE_ANCHOR = "window.GUIDON_SINGLEFILE = true;";
  const STANDALONE_MARK = `${SINGLEFILE_ANCHOR}\nwindow.GUIDON_FORK = "standalone";`;
  // GUIDON_CAPS_PROBE=1 in the build environment stamps the capability
  // probe's boot flag into web/ ONLY (never dist/): the app then prints its
  // GUIDON_CAPS console sentinel once on load, which is how the iOS
  // Simulator collector (tools/ios-simulator-run.sh, `simctl launch
  // --console-pty`) gets a probe out of a shell where no hash can be typed.
  // Off by default; ci.yml's ordinary builds never set it.
  const capsProbeFlag = process.env.GUIDON_CAPS_PROBE === "1" ? `\nwindow.GUIDON_CAPS_PROBE = true;` : "";
  const WEB_MARK = `window.GUIDON_SINGLEFILE = false;\nwindow.GUIDON_FORK = "web";${capsProbeFlag}`;
  standalone = sub(standalone, SINGLEFILE_ANCHOR, STANDALONE_MARK, "fork marker (standalone)");
  assertRouteModulesPresent(standalone, "dist/guidon-standalone.html");
  const CAPS_MARKER = "/* ==== js/caps.js ==== */";
  if (standalone.split(CAPS_MARKER).length !== 2) throw new Error("build: caps.js marker found " + (standalone.split(CAPS_MARKER).length - 1) + " times in dist/guidon-standalone.html (expected exactly 1)");
  await writeFile(join(DIST, "guidon-standalone.html"), standalone);

  /* =========================================================== guest page */
  const guest = await buildGuestPage({ version: pkg.version, buildDate, buildSha, buildDirty });
  await writeFile(join(DIST, "guest.html"), guest.html);

  /* ================================================================= web */
  let web = standalone; // inherits the better favicon
  web = sub(web, STANDALONE_MARK, WEB_MARK, "fork marker (web)");

  // 1. Real manifest + platform icon links. A data: manifest is not installable
  //    in Chromium; a real same-origin file is.
  web = sub(
    web,
    manifestLink[0],
    [
      '<link rel="manifest" href="manifest.webmanifest" />',
      '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />',
      '<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png" />',
      '<link rel="icon" type="image/png" sizes="48x48" href="icons/icon-48.png" />',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
      '<meta name="application-name" content="GUIDON" />',
    ].join("\n    "),
    "manifest link"
  );

  // 2. Installed-app CSS, appended to the main stylesheet.
  const styleClose = "</style>";
  const lastStyle = web.lastIndexOf(styleClose);
  // Guard against the trap from masterfile §40: a literal </style> also appears
  // inside a JS string (the print-summary code emits one). Anchor on the FIRST
  // style block's close instead, which is unambiguously real markup.
  const firstStyleOpen = web.indexOf("<style");
  const firstStyleClose = web.indexOf(styleClose, firstStyleOpen);
  if (firstStyleOpen < 0 || firstStyleClose < 0) throw new Error("build: no <style> block found");
  web = web.slice(0, firstStyleClose) + STANDALONE_CSS + web.slice(firstStyleClose);

  // 3. Extract the PDF stack(s) to sibling files, loaded only when actually
  //    used. pdf-lib.js/da4856.js (fills a form): measured saving at 6x CPU
  //    throttle, ~113 ms DomContentLoaded and ~900 KB of parsed memory, for
  //    a feature most users never touch. pdfjs.js/pdfjs-worker.js (renders
  //    an already-filled DA 4856 to <canvas> for the on-demand "Preview"
  //    button, Roadmap Tier 6c): a further ~1.5 MB kept off the boot path,
  //    used by that one button alone. All four files are precached by the
  //    service worker, so exporting/previewing still works offline.
  await mkdir(join(WEB, "assets"), { recursive: true });
  const extracted = [];
  // pdfjs.js/pdfjs-worker.js (added for the DA 4856 on-demand PDF "Preview"
  // button - Roadmap Tier 6c, scoped): the vendored pdfjs-dist 3.11.174
  // "legacy" classic-script build, extracted by the identical mechanism as
  // the pdf-lib pair above and loaded on demand by js/pdfjs-defer.js
  // (mirrors js/pdf-defer.js exactly, as its own sibling file/global - see
  // that file's header comment for why it's kept separate from pdf-lib's).
  // Needles are each library's own webpack UMD `define(...)` line, unique
  // to that one bundle (verified: neither needle appears in the other's
  // source, nor in pdf-lib's).
  for (const [needle, file] of [
    ["PDFLib={})", "pdf-lib.js"],
    ["window.GUIDON_DA4856_B64 =", "da4856.js"],
    ['define("pdfjs-dist/build/pdf",[]', "pdfjs.js"],
    ['define("pdfjs-dist/build/pdf.worker",[]', "pdfjs-worker.js"],
  ]) {
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
    let m, done = false;
    while ((m = re.exec(web))) {
      if (m[1].includes(needle)) {
        await writeFile(join(WEB, "assets", file), m[1]);
        const loader = file.indexOf("pdfjs") === 0 ? "js/pdfjs-defer.js" : "js/pdf-defer.js";
        web = web.slice(0, m.index) + `<!-- ${file} extracted; loaded on demand by ${loader} -->` + web.slice(m.index + m[0].length);
        extracted.push([file, Buffer.byteLength(m[1], "utf8")]);
        done = true;
        break;
      }
    }
    if (!done) throw new Error(`build: could not extract ${file} (anchor "${needle}")`);
  }

  // 3b. Reference Library source PDFs (web/Android only — see src/app-modules/
  //     library.js's header comment for the full rationale). Unlike
  //     pdf-lib.js/da4856.js above, these are NOT added to sw.js's PRECACHE
  //     list: at ~80MB combined, eagerly downloading all of them on first
  //     install would be a poor deal for a cellular-data PWA install. The
  //     service worker's existing runtime fetch handler (cache-on-first-use
  //     for any same-origin GET, see src/sw.js) already covers this with no
  //     changes needed — each PDF is fetched (and then cached for offline)
  //     only the first time a Soldier actually opens it. Android gets every
  //     PDF for free regardless: Capacitor bundles the whole web/ directory
  //     into the installed APK's local assets, no network or cache involved.
  const docsSourceDir = "docs-source";
  const pdfFiles = (await readdir(docsSourceDir).catch(() => [])).filter((f) => f.endsWith(".pdf"));
  if (pdfFiles.length) {
    await mkdir(join(WEB, "docs"), { recursive: true });
    let pdfBytes = 0;
    for (const f of pdfFiles) {
      await copyFile(join(docsSourceDir, f), join(WEB, "docs", f));
      pdfBytes += (await stat(join(docsSourceDir, f))).size;
    }
    console.log(`  web/docs/                     ${pdfFiles.length} source PDFs, ${(pdfBytes / 1048576).toFixed(1)} MB (not in dist/, not precached)`);
  }

  // 4. The deferral shims and the PWA module, last, so every other module has
  //    already defined itself on G (pdf-defer patches G.pdf456; pdfjs-defer
  //    is independent - see its own header comment; pwa decorates G.share).
  //    Order matters: neither deferral shim needs to precede pwa, but both
  //    must come after the app's own modules.
  const pdfDefer = await readFile("src/pdf-defer.js", "utf8");
  const pdfjsDefer = await readFile("src/pdfjs-defer.js", "utf8");
  const native = await readFile("src/native.js", "utf8");
  // xwin.js (the cross-context state bus) wraps the LIVE G.db write methods
  // as they are when it runs, so it must come after the app shell (where
  // wrapKvCache() installs its versions) - guaranteed here the same way
  // native.js/notify.js are. web/ only: two standalone files opened from
  // file:// are two origins, so the bus would have nothing to talk to.
  const xwin = await readFile("src/xwin.js", "utf8");
  // room-tauri.js (the Tauri transport adapter at G.studyGroup's seam) is
  // web/ only for the same reason as xwin.js: it is packaging for one shell
  // (it returns at once without __TAURI_INTERNALS__), and the standalone
  // file is never that shell. It follows xwin.js so G.studyGroup, G.caps
  // and G.store already exist when it decides whether to attach.
  const roomTauri = await readFile("src/room-tauri.js", "utf8");
  // room-web.js (the plain-WebSocket JOIN transport at the same seam) is
  // web/-only for the same reason room-tauri.js is: dist/guidon-standalone
  // .html is a single offline file with no server nearby, and joining a
  // LAN room is a networked feature with nothing to dial from inside it.
  // Unlike room-tauri.js it carries no fork guard (every fork the web/
  // bundle reaches can open a plain outbound WebSocket) and never
  // self-attaches, so its position only needs G.studyGroup/G.roomSchema to
  // already exist - immediately after room-tauri.js keeps both transports
  // for the one seam next to each other in the script chain.
  const roomWeb = await readFile("src/room-web.js", "utf8");
  const notify = await readFile("src/notify.js", "utf8");
  // biometric.js's own top-level "appStateChange" listener reaches back into
  // G.biometricGate (defined inside index.html's own inline script, in the
  // <script> block this sub() call replaces the tail of) — safe precisely
  // because every module spliced in here runs AFTER that script tag has
  // already executed in full, same guarantee native.js/notify.js already
  // rely on for G.profile/G.store/etc.
  const biometric = await readFile("src/biometric.js", "utf8");
  web = sub(
    web,
    bodyClose,
    `</script>\n<script>\n${pdfDefer}\n</script>\n<script>\n${pdfjsDefer}\n</script>\n<script>\n${native}\n</script>\n<script>\n${xwin}\n</script>\n<script>\n${roomTauri}\n</script>\n<script>\n${roomWeb}\n</script>\n<script>\n${notify}\n</script>\n<script>\n${biometric}\n</script>\n<script>\n${pwa}\n</script>\n</body>\n</html>`,
    "document terminator"
  );

  assertRouteModulesPresent(web, "web/index.html");
  // The bus is a web/-only module (see the xwin read above): its header
  // marker must be in the web bundle exactly once and never in the
  // standalone file. Asserted on the assembled outputs, not assumed.
  const XWIN_MARKER = "/* ==== js/xwin.js ==== */";
  if (web.split(XWIN_MARKER).length !== 2) throw new Error("build: xwin.js marker found " + (web.split(XWIN_MARKER).length - 1) + " times in web/index.html (expected exactly 1)");
  if (standalone.includes(XWIN_MARKER)) throw new Error("build: xwin.js marker leaked into dist/guidon-standalone.html");
  // room-tauri.js: the same web/-only rule, asserted the same way (P4).
  const ROOM_TAURI_MARKER = "/* ==== js/room-tauri.js ==== */";
  if (web.split(ROOM_TAURI_MARKER).length !== 2) throw new Error("build: room-tauri.js marker found " + (web.split(ROOM_TAURI_MARKER).length - 1) + " times in web/index.html (expected exactly 1)");
  if (standalone.includes(ROOM_TAURI_MARKER)) throw new Error("build: room-tauri.js marker leaked into dist/guidon-standalone.html");
  if (web.indexOf(ROOM_TAURI_MARKER) < web.indexOf(XWIN_MARKER)) throw new Error("build: room-tauri.js must follow xwin.js in web/index.html");
  // room-web.js: the same web/-only rule, asserted the same way (P4b) -
  // and, like room-tauri.js, spliced right after it in the script chain.
  const ROOM_WEB_MARKER = "/* ==== js/room-web.js ==== */";
  if (web.split(ROOM_WEB_MARKER).length !== 2) throw new Error("build: room-web.js marker found " + (web.split(ROOM_WEB_MARKER).length - 1) + " times in web/index.html (expected exactly 1)");
  if (standalone.includes(ROOM_WEB_MARKER)) throw new Error("build: room-web.js marker leaked into dist/guidon-standalone.html");
  if (web.indexOf(ROOM_WEB_MARKER) < web.indexOf(ROOM_TAURI_MARKER)) throw new Error("build: room-web.js must follow room-tauri.js in web/index.html");
  // caps.js (the capability registry, an app module in BOTH builds) must
  // run BEFORE native.js/notify.js/biometric.js/pwa.js in web/: those four
  // now take their isNative answers from G.caps.isCapacitor()/isShell()
  // (collective P2) at load time. Asserted on the assembled output.
  const NATIVE_MARKER = "/* ==== js/native.js ==== */";
  if (web.split(CAPS_MARKER).length !== 2) throw new Error("build: caps.js marker found " + (web.split(CAPS_MARKER).length - 1) + " times in web/index.html (expected exactly 1)");
  if (web.indexOf(NATIVE_MARKER) < 0 || web.indexOf(CAPS_MARKER) > web.indexOf(NATIVE_MARKER)) throw new Error("build: caps.js must precede native.js in web/index.html (G.caps.isCapacitor() is read at native.js load time)");
  // --ink-* static fallbacks: every registry theme got exactly one rule with
  // one static per token, plus the base html {} rule, in BOTH outputs -
  // counted on the assembled strings, not on what injectInkFallbacks()
  // said it did.
  const inkCounts = {};
  for (const [label, out] of [["dist/guidon-standalone.html", standalone], ["web/index.html", web]]) {
    const c = countInkFallbacks(out, label);
    const wantStatics = (themeIds.length + 1) * INK_TOKENS.length;
    if (c.themeRules !== themeIds.length || c.statics !== wantStatics) {
      throw new Error(`build: ${label} has ${c.themeRules} theme fallback rules / ${c.statics} static --ink-* declarations (expected ${themeIds.length} / ${wantStatics})`);
    }
    inkCounts[label] = c;
  }
  await writeFile(join(WEB, "index.html"), web);

  /* ------------- service worker: precache list + content hash -------------
     PRECACHE is generated here, not hand-typed in src/sw.js: icon filenames
     come from tools/icon-spec.mjs (the exact same list make-icons.mjs
     renders from, and this build already used above for the platform
     <link> tags/manifest.webmanifest icons), and the two PDF-stack files
     come from the `extracted` array this build itself just wrote to
     web/assets/ in step 3. Previously src/sw.js carried a 4th
     independently hand-typed copy of this same list, and it had already
     drifted: icon-48.png shipped and was linked from the <link rel="icon"
     sizes="48x48"> above, but was never added to that hand-typed array, so
     it loaded over the network on first boot instead of being available
     offline immediately (see verify.mjs "[2b] sw.js PRECACHE completeness",
     which now regression-guards this).

     The hash that becomes the SW's own cache-version name (and therefore
     the cache generation a real device swaps to on update) is taken over
     `web` PLUS this generated precache list, not `web` alone as before: a
     build that only changes the icon set or the PDF-extraction list -
     without touching index.html - must still mint a new cache generation,
     or the fix reaches the build output on disk but never a device that
     already has an old service worker installed and active. */
  const precache = [
    "./index.html",
    "./manifest.webmanifest",
    ...ICON_TARGETS.map((t) => `./icons/${t.file}`),
    ...extracted.map(([file]) => `./assets/${file}`),
  ];
  const hash = createHash("sha256").update(web).update(JSON.stringify(precache)).digest("hex").slice(0, 12);
  let swSrc = await readFile("src/sw.js", "utf8");
  if (!swSrc.includes("__GUIDON_BUILD__")) throw new Error("build: sw.js version placeholder missing");
  if (!swSrc.includes('"__GUIDON_PRECACHE_JSON__"')) throw new Error("build: sw.js precache placeholder missing");
  swSrc = swSrc.replace("__GUIDON_BUILD__", hash);
  // Same double-JSON.stringify technique as seedAsJsonParse above: the inner
  // stringify produces the JSON text, the outer one produces a correctly
  // escaped JS string literal to sit inside JSON.parse("...") in sw.js.
  swSrc = swSrc.replace('"__GUIDON_PRECACHE_JSON__"', JSON.stringify(JSON.stringify(precache)));
  await writeFile(join(WEB, "sw.js"), swSrc);

  await copyFile("src/manifest.webmanifest", join(WEB, "manifest.webmanifest"));

  /* ------------------------------ report ------------------------------ */
  const kb = (s) => (Buffer.byteLength(s, "utf8") / 1048576).toFixed(2) + " MB";
  console.log("build ok");
  console.log(seed.skipped
    ? "  seed                          left as an object literal (unexpected shape)"
    : `  seed                          JSON.parse, ${seed.keys} top-level keys (~94ms faster boot at 6x CPU)`);
  console.log(`  dist/guidon-standalone.html   ${kb(standalone)}   (single file, file:// ready)`);
  console.log(`  dist/guest.html               ${(guest.bytes / 1024).toFixed(1)} KB   (room guest page: schema + ${(guest.coreBytes / 1024).toFixed(1)} KB pure core + view; GUIDON_FORK="guest" x1; no subtle/getUserMedia/wakeLock/storage)`);
  console.log(`  web/index.html                ${kb(web)}   (installable bundle)`);
  console.log(`  web/sw.js                     cache version ${hash}, ${precache.length} precache entries`);
  console.log(`  fork markers                  dist: GUIDON_FORK="standalone" SINGLEFILE=true; web: GUIDON_FORK="web" SINGLEFILE=false${capsProbeFlag ? " CAPS_PROBE=true" : ""}; sha ${buildSha ? buildSha.slice(0, 7) + (buildDirty ? " (dirty tree)" : "") : "unknown (no git)"}`);
  const inkWeb = inkCounts["web/index.html"];
  console.log(`  engine floor                  Chromium ${floor.chromium} / WebView ${floor.webview} / WebKit ${floor.webkit} / Gecko ${floor.gecko} stamped as window.GUIDON_ENGINE_FLOOR (both builds)`);
  console.log(`  --ink-* static fallbacks      ${inkWeb.themeRules} theme rules x ${INK_TOKENS.length} tokens + 1 base rule = ${inkWeb.statics} declarations, inside @supports not (color-mix), in dist/ and web/${ink.reported.length ? `; ${ink.reported.length} non-literal value(s) skipped: ${ink.reported.join("; ")}` : "; every source token was a plain literal"}`);
}

// Only self-invoke when run directly (`node tools/build.mjs`), not when
// imported as a module - tools/test-theme-id-sync.mjs imports deriveThemeIds
// to unit-test the derivation itself, and a real build as an import side
// effect would be a surprising (and slow) thing for a test file to trigger.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}

export { deriveThemeIds, main };
