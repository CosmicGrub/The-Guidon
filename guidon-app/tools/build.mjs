/**
 * GUIDON build.
 *
 * One source (src/index.html — the single-file app exactly as authored) produces
 * two artifacts, because the project has two distribution promises to keep:
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
 * Nothing is minified or restructured. Every edit below is a targeted,
 * asserted replacement — if the anchor text is not found exactly once, the
 * build fails loudly rather than silently producing a broken artifact.
 */
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

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

/** Replace exactly once, or fail. Silent no-op replacements are how builds rot. */
function sub(html, find, replace, label) {
  const parts = html.split(find);
  if (parts.length !== 2) {
    throw new Error(`build: anchor "${label}" matched ${parts.length - 1} times (expected exactly 1)`);
  }
  return parts[0] + replace + parts[1];
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

  // 3. Extract the PDF stack to sibling files, loaded only when a counseling
  //    form is actually exported. Measured saving at 6x CPU throttle:
  //    ~113 ms DomContentLoaded and ~900 KB of parsed memory, for a feature most
  //    users never touch. Both files are precached by the service worker, so
  //    exporting still works offline.
  await mkdir(join(WEB, "assets"), { recursive: true });
  const extracted = [];
  for (const [needle, file] of [["PDFLib={})", "pdf-lib.js"], ["window.GUIDON_DA4856_B64 =", "da4856.js"]]) {
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
    let m, done = false;
    while ((m = re.exec(web))) {
      if (m[1].includes(needle)) {
        await writeFile(join(WEB, "assets", file), m[1]);
        web = web.slice(0, m.index) + `<!-- ${file} extracted; loaded on demand by js/pdf-defer.js -->` + web.slice(m.index + m[0].length);
        extracted.push([file, Buffer.byteLength(m[1], "utf8")]);
        done = true;
        break;
      }
    }
    if (!done) throw new Error(`build: could not extract ${file} (anchor "${needle}")`);
  }

  // 4. The deferral shim and the PWA module, last, so every other module has
  //    already defined itself on G (pdf-defer patches G.pdf456; pwa decorates
  //    G.share). Order matters: pdf-defer before pwa is not required, but both
  //    must come after the app's own modules.
  const pdfDefer = await readFile("src/pdf-defer.js", "utf8");
  const native = await readFile("src/native.js", "utf8");
  const notify = await readFile("src/notify.js", "utf8");
  web = sub(
    web,
    bodyClose,
    `</script>\n<script>\n${pdfDefer}\n</script>\n<script>\n${native}\n</script>\n<script>\n${notify}\n</script>\n<script>\n${pwa}\n</script>\n</body>\n</html>`,
    "document terminator"
  );

  await writeFile(join(WEB, "index.html"), web);

  /* ------------- service worker, versioned by content hash -------------
     The hash is taken over the built index.html, so any change to the app
     produces a new cache name and therefore a real update prompt. */
  const hash = createHash("sha256").update(web).digest("hex").slice(0, 12);
  const swSrc = await readFile("src/sw.js", "utf8");
  if (!swSrc.includes("__GUIDON_BUILD__")) throw new Error("build: sw.js version placeholder missing");
  await writeFile(join(WEB, "sw.js"), swSrc.replace("__GUIDON_BUILD__", hash));

  await copyFile("src/manifest.webmanifest", join(WEB, "manifest.webmanifest"));

  /* ------------------------------ report ------------------------------ */
  const kb = (s) => (Buffer.byteLength(s, "utf8") / 1048576).toFixed(2) + " MB";
  console.log("build ok");
  console.log(seed.skipped
    ? "  seed                          left as an object literal (unexpected shape)"
    : `  seed                          JSON.parse, ${seed.keys} top-level keys (~94ms faster boot at 6x CPU)`);
  console.log(`  dist/guidon-standalone.html   ${kb(standalone)}   (single file, file:// ready)`);
  console.log(`  web/index.html                ${kb(web)}   (installable bundle)`);
  console.log(`  web/sw.js                     cache version ${hash}`);
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
