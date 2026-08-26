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

/** Replace exactly once, or fail. Silent no-op replacements are how builds rot. */
function sub(html, find, replace, label) {
  const parts = html.split(find);
  if (parts.length !== 2) {
    throw new Error(`build: anchor "${label}" matched ${parts.length - 1} times (expected exactly 1)`);
  }
  return parts[0] + replace + parts[1];
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
html[data-display-mode="standalone"],
html[data-display-mode="fullscreen"],
html[data-display-mode="minimal-ui"] {
  /* An accidental downward swipe must not pull-to-refresh a 5 MB app. */
  overscroll-behavior-y: contain;
  /* Removes the tap flash that reads as "web page" rather than "app".
     :focus-visible and :active styling are untouched. */
  -webkit-tap-highlight-color: transparent;
}
html[data-display-mode="standalone"] body,
html[data-display-mode="standalone"] .main {
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
  const versionAnchor = /window\.GUIDON_APP_VERSION = "[^"]*";\nwindow\.GUIDON_BUILD_DATE = "[^"]*";/;
  const versionMatch = src.match(versionAnchor);
  if (!versionMatch) throw new Error("build: GUIDON_APP_VERSION/GUIDON_BUILD_DATE anchor not found");
  src = sub(
    src,
    versionMatch[0],
    `window.GUIDON_APP_VERSION = "${pkg.version}";\nwindow.GUIDON_BUILD_DATE = "${buildDate}";`,
    "app version/build date"
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
  assertRouteModulesPresent(standalone, "dist/guidon-standalone.html");
  await writeFile(join(DIST, "guidon-standalone.html"), standalone);

  /* ================================================================= web */
  let web = standalone; // inherits the better favicon

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
    `</script>\n<script>\n${pdfDefer}\n</script>\n<script>\n${pdfjsDefer}\n</script>\n<script>\n${native}\n</script>\n<script>\n${notify}\n</script>\n<script>\n${biometric}\n</script>\n<script>\n${pwa}\n</script>\n</body>\n</html>`,
    "document terminator"
  );

  assertRouteModulesPresent(web, "web/index.html");
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
  console.log(`  web/index.html                ${kb(web)}   (installable bundle)`);
  console.log(`  web/sw.js                     cache version ${hash}, ${precache.length} precache entries`);
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
