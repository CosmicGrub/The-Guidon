/**
 * Engine-floor lint for GUIDON (collective roadmap Q11, locked 2026-09-04).
 *
 * tools/engine-floor.json declares the oldest engines every fork promises to
 * run on: Chromium 111 / Android WebView 111 / WebKit 16.2 / Gecko 113 - the
 * releases that first shipped color-mix(), which the five --ink-* text
 * tokens depend on. This lint keeps the app source honest about that floor:
 * it scans src/index.html (the app region: every line of 20,000 chars or
 * less - the vendored pdf-lib/pdf.js bundles, the DA 4856 base64 and the
 * GUIDON_SEED literal are each one longer line and are skipped), every
 * src/*.js and every src/app-modules/*.js against FEATURES below - a table
 * of JS syntax/builtins and CSS features with the Chromium/WebKit release
 * that first shipped each - and:
 *
 *   PASS  one line per detected feature: use count, its minimums, and
 *         whether it sits below / at / above the floor (above only when
 *         every use is guarded);
 *   FAIL  a feature above the declared floor used WITHOUT a guard, naming
 *         file:line and the offending excerpt.
 *
 * A feature is "above the floor" when its Chromium minimum exceeds
 * min(chromium, webview) OR its WebKit minimum exceeds webkit ("none" =
 * never shipped = always above). AT the floor is fine: color-mix() itself
 * needs exactly 111 / 16.2 and passes. Gecko has no per-feature column here
 * (the table carries the two engines the forks ship on; Firefox is a
 * browser-tab audience only) - the floor is declared for the runtime
 * notice and reported, not scanned.
 *
 * What counts as a GUARD (the same or an adjacent line, i-1..i+1, so the
 * detect-then-check idiom `const x = navigator.foo; if (!x || typeof
 * x.bar !== "function") return;` and a marker comment above a CSS
 * declaration both count):
 *   JS   typeof ..., CSS.supports(...), fn(...) (caps.js's typeof helper),
 *        "name" in obj, or a comment carrying `floor-ok: <reason>`;
 *   CSS  the use sits inside an @supports (...) { } block, a -webkit-
 *        prefixed twin of the same property is on the same/previous line,
 *        or a comment carrying `floor-ok: <reason>` (the documented
 *        fallback marker - say what happens on an engine without it).
 * Comments are stripped before scanning (a feature NAMED in a comment is
 * not a use) - only the floor-ok: marker survives stripping, as a token.
 *
 * Known limits, stated rather than pretended away: a regex-literal `//`
 * can swallow the rest of its line (fewer detections, never more); an
 * @supports block guards everything inside it whatever it tests; the
 * table is a maintained list (caniuse/MDN as of 2026-09-04), so a feature
 * missing from it is simply not checked - add a row, never a second table.
 *
 * `--src <index.html>` points the HTML scan at another copy so the verifier
 * can be verified (a copy with one unguarded `document.startViewTransition(`
 * fails, naming it); the src/*.js files still come from the tree.
 * No dependencies; run from anywhere (paths resolve from this file).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const FLOOR_FILE = path.join(HERE, "engine-floor.json");
const INDEX = argOf("--src") || path.join(APP, "src", "index.html");
const SRC_DIR = path.join(APP, "src");
const MOD_DIR = path.join(APP, "src", "app-modules");
const MAX_LINE = 20000;
const MARK = "FLOOR_OK_MARK";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const rel = (p) => path.relative(APP, p).split(path.sep).join("/");

/* --------------------------------------------------------------- table
   [id, kind, regex, chromiumMin, webkitMin]. webkit is a Safari release
   string ("16.2") or "none" (never shipped). Regexes are line-scoped and
   deliberately distinctive: the HTML's CSS and JS are scanned together
   (styles are also built in JS strings), so a CSS row must not match
   ordinary JS (no bare `round(`, no `.union(`). Rows are checked in
   order of Chromium minimum, descending, in the report. */
const FEATURES = [
  // ---- JS syntax / builtins ----
  ["RegExp.escape", "js", /RegExp\.escape\(/g, 136, "18.2"],
  ["Intl.DurationFormat", "js", /Intl\.DurationFormat/g, 129, "16.4"],
  ["Promise.try", "js", /Promise\.try\(/g, 128, "18.2"],
  ["Array.fromAsync", "js", /Array\.fromAsync/g, 121, "16.4"],
  ["URL.canParse", "js", /URL\.canParse\(/g, 120, "17"],
  ["Promise.withResolvers", "js", /Promise\.withResolvers/g, 119, "17.4"],
  ["Object.groupBy / Map.groupBy", "js", /\b(Object|Map)\.groupBy\(/g, 117, "17.4"],
  ["AbortSignal.any", "js", /AbortSignal\.any\(/g, 116, "17.4"],
  ["popover attribute / showPopover", "js", /\bpopover(=|\s*:\s*")|\.(show|hide|toggle)Popover\(/g, 114, "17"],
  ["startViewTransition", "js", /startViewTransition\b/g, 111, "18"],
  ["String isWellFormed/toWellFormed", "js", /\.(isWellFormed|toWellFormed)\(/g, 111, "17"],
  ["toSorted/toReversed/toSpliced/with", "js", /\.(toSorted|toReversed|toSpliced)\(|\.with\(\s*-?\d/g, 110, "16"],
  ["Element.checkVisibility", "js", /\.checkVisibility\(/g, 105, "17.4"],
  ["AbortSignal.timeout", "js", /AbortSignal\.timeout\(/g, 103, "16"],
  ["inert attribute", "js", /\binert\b/g, 102, "15.5"],
  ["structuredClone", "js", /\bstructuredClone\(/g, 98, "15.4"],
  ["findLast / findLastIndex", "js", /\.findLast(Index)?\(/g, 97, "15.4"],
  ["scheduler.postTask", "js", /\bscheduler\.postTask\b/g, 94, "none"],
  ["Object.hasOwn", "js", /\bObject\.hasOwn\(/g, 93, "15.4"],
  ["Array/String .at()", "js", /\.at\(\s*-?\d/g, 92, "15.4"],
  ["crypto.randomUUID", "js", /crypto\.randomUUID\b/g, 92, "15.4"],
  ["navigator.userAgentData", "js", /\buserAgentData\b/g, 90, "none"],
  ["Intl.Segmenter", "js", /Intl\.Segmenter/g, 87, "14.1"],
  ["Element.replaceChildren", "js", /\.replaceChildren\(/g, 86, "14"],
  ["logical assignment ??= ||= &&=", "js", /(\?\?=|\|\|=|&&=)/g, 85, "14"],
  ["Promise.any", "js", /Promise\.any\(/g, 85, "14"],
  ["String.replaceAll", "js", /\.replaceAll\(/g, 85, "13.1"],
  ["navigator.wakeLock", "js", /navigator\.wakeLock\b/g, 84, "16.4"],
  ["WeakRef / FinalizationRegistry", "js", /\b(WeakRef|FinalizationRegistry)\b/g, 84, "14.1"],
  ["optional chaining ?.", "js", /\?\.(?=[a-zA-Z_$[(])/g, 80, "13.1"],
  ["nullish coalescing ??", "js", /[^?]\?\?(?![?=])/g, 80, "13.1"],
  ["CompressionStream", "js", /\b(De)?CompressionStream\b/g, 80, "16.4"],
  ["CSS.registerProperty", "js", /CSS\.registerProperty\(/g, 78, "16.4"],
  ["Promise.allSettled", "js", /Promise\.allSettled\(/g, 76, "13"],
  ["class private #field", "js", /\bthis\.#[a-zA-Z_]/g, 74, "14.1"],
  ["String.matchAll", "js", /\.matchAll\(/g, 73, "13"],
  ["Intl.ListFormat", "js", /Intl\.ListFormat/g, 72, "14.1"],
  ["static class field", "js", /^\s*static\s+[a-zA-Z_$][\w$]*\s*=/g, 72, "14.1"],
  ["Intl.RelativeTimeFormat", "js", /Intl\.RelativeTimeFormat/g, 71, "14"],
  ["globalThis", "js", /\bglobalThis\b/g, 71, "12.1"],
  ["Array.flat / flatMap", "js", /\.flat(Map)?\(/g, 69, "12"],
  ["Web Locks", "js", /navigator\.locks\b/g, 69, "15.4"],
  ["OffscreenCanvas", "js", /\bOffscreenCanvas\b/g, 69, "16.4"],
  ["BigInt literal", "js", /\b\d+n\b/g, 67, "14"],
  ["AbortController", "js", /\bAbortController\b/g, 66, "12.1"],
  ["ResizeObserver", "js", /\bResizeObserver\b/g, 64, "13.1"],
  ["regex lookbehind (?<= (?<!", "js", /\(\?<[=!]/g, 62, "16.4"],
  ["scrollIntoView options object", "js", /scrollIntoView\(\s*\{/g, 61, "14"],
  ["BroadcastChannel", "js", /\bBroadcastChannel\b/g, 54, "15.4"],
  ["IntersectionObserver", "js", /\bIntersectionObserver\b/g, 51, "12.1"],
  ["requestIdleCallback", "js", /\brequestIdleCallback\b/g, 47, "none"],
  ["dialog.showModal", "js", /\.showModal\(/g, 37, "15.4"],
  // ---- CSS ----
  ["text-box-trim (CSS)", "css", /text-box-trim\s*:/g, 133, "18.2"],
  ["anchor positioning (CSS)", "css", /\b(anchor-name|position-anchor|position-area)\s*:/g, 125, "26"],
  ["light-dark() (CSS)", "css", /light-dark\(/g, 123, "17.5"],
  ["field-sizing (CSS)", "css", /field-sizing\s*:/g, 123, "none"],
  ["mask-image / mask unprefixed (CSS)", "css", /(?<![-\w])mask(-image|-size|-position|-repeat|-composite)?\s*:/g, 120, "15.4"],
  ["@scope (CSS)", "css", /@scope\b/g, 118, "17.4"],
  ["@starting-style (CSS)", "css", /@starting-style\b/g, 117, "17.5"],
  ["transition-behavior (CSS)", "css", /transition-behavior\s*:/g, 117, "17.4"],
  ["text-wrap: pretty (CSS)", "css", /text-wrap\s*:\s*pretty\b/g, 117, "26"],
  ["subgrid (CSS)", "css", /\bsubgrid\b/g, 117, "16"],
  ["animation-timeline (CSS)", "css", /animation-timeline\s*:/g, 115, "none"],
  ["text-wrap: balance (CSS)", "css", /text-wrap\s*:\s*balance\b/g, 114, "17.5"],
  ["color-mix() (CSS)", "css", /color-mix\(/g, 111, "16.2"],
  ["oklch/oklab/lab/lch/color() (CSS)", "css", /\b(oklch|oklab|lab|lch)\(|\bcolor\(\s*(srgb|display-p3)/g, 111, "15.4"],
  ["view-transition-name (CSS)", "css", /view-transition-name\s*:/g, 111, "18"],
  ["lh / rlh unit (CSS)", "css", /\b\d+(\.\d+)?r?lh\b/g, 109, "16.4"],
  ["dvh/svh/lvh units (CSS)", "css", /\b\d+(\.\d+)?[dsl]v[hwib]\b/g, 108, "15.4"],
  [":has() (CSS)", "css", /:has\(/g, 105, "15.4"],
  ["@container / container-type (CSS)", "css", /@container\b|container-type\s*:/g, 105, "16"],
  ["@layer (CSS)", "css", /@layer\b/g, 99, "15.4"],
  ["accent-color (CSS)", "css", /accent-color\s*:/g, 93, "15.4"],
  ["overflow: clip (CSS)", "css", /overflow(-[xy])?\s*:\s*clip\b/g, 90, "16"],
  ["aspect-ratio (CSS)", "css", /aspect-ratio\s*:/g, 88, "15"],
  ["inset shorthand (CSS)", "css", /(?<![-\w])inset\s*:/g, 87, "14.1"],
  [":focus-visible (CSS)", "css", /:focus-visible\b/g, 86, "15.4"],
  ["content-visibility (CSS)", "css", /content-visibility\s*:/g, 85, "18"],
  ["@property (CSS)", "css", /@property\b/g, 85, "16.4"],
  ["gap (flex/grid) (CSS)", "css", /(?<![-\w])gap\s*:/g, 84, "14.1"],
  ["clamp() (CSS)", "css", /\bclamp\(\s*[\d.]+(px|rem|em|vw|vh|%)/g, 79, "13.1"],
  ["backdrop-filter unprefixed (CSS)", "css", /(?<![-\w])backdrop-filter\s*:/g, 76, "18"],
  ["prefers-color-scheme (CSS)", "css", /prefers-color-scheme/g, 76, "12.1"],
  ["prefers-reduced-motion (CSS)", "css", /prefers-reduced-motion/g, 74, "10.1"],
  ["env(safe-area-inset-*) (CSS)", "css", /env\(safe-area-inset/g, 69, "11"],
  ["scroll-snap-type (CSS)", "css", /scroll-snap-type\s*:/g, 69, "11"],
  ["overscroll-behavior (CSS)", "css", /overscroll-behavior/g, 63, "16"],
  ["contain: (CSS)", "css", /(?<![-\w])contain\s*:/g, 52, "15.4"],
  ["display-mode media query (CSS)", "css", /display-mode\s*:/g, 42, "13"],
  ["hover/pointer media query (CSS)", "css", /\(\s*(any-)?(hover|pointer)\s*:/g, 38, "9"],
];

/* ---------------------------------------------------------- helpers */
function parseVersion(v) {
  if (v === "none" || v == null) return [Infinity];
  return String(v).split(".").map((n) => Number(n));
}
function cmp(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || 0, y = B[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
function fmt(v) { return v === "none" ? "never" : String(v); }

/* Strip comments but keep every newline (line numbers survive) and turn a
   comment that carries `floor-ok:` into the MARK token. */
function stripComments(text) {
  const keep = (m) => (m.indexOf("floor-ok:") !== -1 ? " " + MARK + " " : " ") + m.replace(/[^\n]/g, "");
  return text
    .replace(/<!--[\s\S]*?-->/g, keep)
    .replace(/\/\*[\s\S]*?\*\//g, keep)
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, pre) => pre + keep(m.slice(pre.length)));
}

/* Line ranges (1-based, inclusive) of every @supports (...) { ... } block. */
function supportsRanges(text) {
  const ranges = [];
  const re = /@supports\b/g;
  let m;
  while ((m = re.exec(text))) {
    const open = text.indexOf("{", m.index);
    if (open < 0) break;
    let depth = 0, close = -1;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) break;
    const from = text.slice(0, m.index).split("\n").length;
    const to = text.slice(0, close).split("\n").length;
    ranges.push([from, to]);
  }
  return ranges;
}

const JS_GUARD = new RegExp("\\btypeof\\b|CSS\\.supports\\(|\\bfn\\(|\"[A-Za-z]+\"\\s+in\\s+\\w|" + MARK);
const CSS_GUARD = new RegExp(MARK);

async function loadFile(file, skipLong) {
  const raw = await readFile(file, "utf-8");
  let skipped = 0;
  const kept = raw.split("\n").map((l) => { if (skipLong && l.length > MAX_LINE) { skipped++; return ""; } return l; }).join("\n");
  const text = stripComments(kept);
  return { file, lines: text.split("\n"), supports: supportsRanges(text), skipped };
}

/* ------------------------------------------------------------- floor */
console.log("lint-engine-floor: nothing above the declared engine floor without a guard\n");

let floor = null;
try { floor = JSON.parse(await readFile(FLOOR_FILE, "utf-8")); }
catch (e) { bad(`${rel(FLOOR_FILE)} unreadable: ${e.message}`); }
if (floor) {
  const want = ["chromium", "webview", "webkit", "gecko", "rationale", "decidedBy"];
  const missing = want.filter((k) => !(k in floor));
  if (missing.length) bad(`${rel(FLOOR_FILE)} lacks: ${missing.join(", ")}`);
  else ok(`floor declared in ${rel(FLOOR_FILE)}: Chromium ${floor.chromium} / WebView ${floor.webview} / WebKit ${floor.webkit} / Gecko ${floor.gecko} (${floor.decidedBy})`);
}
if (!floor || fails) finish();

const chromiumFloor = Math.min(Number(floor.chromium), Number(floor.webview));
const webkitFloor = String(floor.webkit);

/* ----------------------------------------------------------- sources */
const files = [];
try { files.push(await loadFile(INDEX, true)); }
catch (e) { bad(`${rel(INDEX)} unreadable: ${e.message}`); finish(); }
const jsFiles = (await readdir(SRC_DIR)).filter((f) => f.endsWith(".js")).sort().map((f) => path.join(SRC_DIR, f));
const modFiles = (await readdir(MOD_DIR).catch(() => [])).filter((f) => f.endsWith(".js")).sort().map((f) => path.join(MOD_DIR, f));
for (const f of [...jsFiles, ...modFiles]) files.push(await loadFile(f, true));
const totalLines = files.reduce((n, f) => n + f.lines.length, 0);
const totalSkipped = files.reduce((n, f) => n + f.skipped, 0);
ok(`scanned ${files.length} files, ${totalLines} lines (${totalSkipped} line(s) over ${MAX_LINE} chars skipped as vendored/seed blobs; comments stripped)`);

/* -------------------------------------------------------------- scan */
function guarded(kind, f, i, line) {
  const window = [f.lines[i - 1] || "", line, f.lines[i + 1] || ""].join("\n");
  if (kind === "js") return JS_GUARD.test(window);
  const ln = i + 1;
  if (f.supports.some(([a, b]) => ln >= a && ln <= b)) return true;
  if (CSS_GUARD.test(window)) return true;
  // a -webkit- prefixed twin of the same property on this or the previous line
  const prop = (line.match(/(?<![-\w])(mask(?:-[a-z]+)?|backdrop-filter)\s*:/) || [])[1];
  if (prop && new RegExp("-webkit-" + prop + "\\s*:").test((f.lines[i - 1] || "") + "\n" + line)) return true;
  return false;
}

let detected = 0;
for (const [id, kind, re, cMin, wMin] of FEATURES) {
  const uses = [];
  for (const f of files) {
    f.lines.forEach((line, i) => {
      re.lastIndex = 0;
      const n = (line.match(re) || []).length;
      if (n) uses.push({ f, i, line, n, guarded: guarded(kind, f, i, line) });
    });
  }
  const count = uses.reduce((s, u) => s + u.n, 0);
  if (!count) continue;
  detected++;
  const aboveC = cMin > chromiumFloor;
  const aboveW = cmp(wMin, webkitFloor) > 0;
  const mins = `needs Chromium ${cMin} / WebKit ${fmt(wMin)}`;
  if (!aboveC && !aboveW) {
    const at = cMin === chromiumFloor || cmp(wMin, webkitFloor) === 0;
    ok(`${id}: ${count} use(s); ${mins} - ${at ? "AT the floor" : "below the floor"}`);
    continue;
  }
  const over = [aboveC ? `Chromium ${cMin} > floor ${chromiumFloor}` : null, aboveW ? `WebKit ${fmt(wMin)} > floor ${webkitFloor}` : null].filter(Boolean).join(", ");
  const unguarded = uses.filter((u) => !u.guarded);
  if (!unguarded.length) {
    ok(`${id}: ${count} use(s); ${mins} - ABOVE the floor (${over}), every use guarded`);
  } else {
    bad(`${id}: ${mins} - ABOVE the floor (${over}) and unguarded at ${unguarded.length} site(s):`);
    for (const u of unguarded.slice(0, 8)) {
      console.log(`         ${rel(u.f.file)}:${u.i + 1}: ${u.line.trim().slice(0, 110)}`);
    }
    console.log(`         guard it (typeof / CSS.supports / @supports / -webkit- twin) or mark it: ${kind === "js" ? "// floor-ok: <what happens without it>" : "/* floor-ok: <what happens without it> */"}`);
  }
}
ok(`${detected} of ${FEATURES.length} table features detected in the app source; Gecko floor ${floor.gecko} declared for the runtime notice, not scanned (no per-feature Gecko column)`);

finish();

function finish() {
  console.log("\n" + (fails ? `LINT-ENGINE-FLOOR: ${fails} FAILURE(S)` : "LINT-ENGINE-FLOOR: all passed"));
  process.exit(fails ? 1 : 0);
}
