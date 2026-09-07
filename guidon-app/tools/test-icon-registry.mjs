/**
 * G.icons (src/app-modules/icons.js) - the inline-SVG icon registry every
 * route, nav button and grade badge draws from via G.util.icon(name, size,
 * fallback) / G.icons.el(name). Roadmap audit round 4 found ONE instance of
 * the bug class this module invites: util.icon("more-horizontal", ...) named
 * an icon that was never a key in icons.js' D object, so the mobile nav's
 * always-visible "More" button silently rendered the text-glyph fallback
 * <span> instead of a real <svg> - invisible unless someone diffed the
 * rendered node's tag name. test-nav-tier1.mjs now asserts that ONE call
 * site renders a real svg.gi. But nothing ever generalized the check: the
 * 35-row ROUTES table (every sidebar/drawer icon), the qz-grade badge table,
 * and every other util.icon()/G.icons.el()/`gi:` call site across the app
 * had (and still has, elsewhere) zero coverage of "does the name I typed
 * actually exist in the registry" - the exact class of typo that produced
 * the original bug, just waiting to recur at a different call site.
 *
 * This test closes that gap for real: it statically extracts every icon
 * name literal referenced anywhere in src/index.html + src/app-modules/*.js
 * (ico:/gi: data-table fields, util.icon()/G.icons.el() calls including
 * ternary name expressions like `on ? "minimize-2" : "maximize-2"`), then
 * asserts each one resolves in the live app's G.icons registry - plus a
 * live cross-check against window.G.routes (the actual ROUTES table the
 * sidebar renders from) so the static extraction is verified against the
 * real data, not just itself. It also covers the two documented-but-
 * never-asserted fallback contracts from icons.js' own header comment:
 * G.util.icon() must never throw or render nothing for an unknown name
 * (falls back to a text-glyph span), and G.icons.el() must never throw for
 * one either (falls back to an empty, structurally valid <svg class="gi">).
 */
import { readFile, readdir } from "node:fs/promises";
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

// ---- static extraction: every icon-name literal referenced from source ----
const moduleFiles = (await readdir("src/app-modules")).filter((f) => f.endsWith(".js"));
const sources = await Promise.all(
  ["src/index.html", ...moduleFiles.map((f) => "src/app-modules/" + f)].map((f) => readFile(f, "utf8"))
);
const text = sources.join("\n");

const referenced = new Set();
for (const re of [/ico:\s*["']([^"']+)["']/g, /gi:\s*["']([^"']+)["']/g]) {
  let m;
  while ((m = re.exec(text))) referenced.add(m[1]);
}
// util.icon(<nameExpr>, ...) / G.icons.el(<nameExpr>, ...): nameExpr is
// everything up to the first top-level comma, which also catches ternary
// name expressions (two literal branches, e.g. fullscreen toggle icons)
// without a full JS parser.
{
  const callRe = /(?:util\.icon|G\.icons\.el)\(([^,]+),/g;
  let cm;
  while ((cm = callRe.exec(text))) {
    const litRe = /["']([^"']+)["']/g;
    let lm;
    while ((lm = litRe.exec(cm[1]))) referenced.add(lm[1]);
  }
}
// Guards the test itself: if a future refactor changes these call shapes
// enough that the regexes above stop matching anything, this would
// otherwise silently pass with zero real assertions below.
referenced.size >= 40
  ? ok(`static extraction found ${referenced.size} distinct icon-name literals referenced in source (>= 40 expected)`)
  : bad(`static extraction found only ${referenced.size} icon-name literals - expected >= 40; the extraction regexes may no longer match this codebase's call shapes`);

// ---- load the built app and check each referenced name against the live registry ----
const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);

const registryPresent = await page.evaluate(() =>
  !!(window.G && window.G.icons && window.G.icons.has && window.G.icons.el && window.G.icons.names));
registryPresent
  ? ok("window.G.icons is present with has()/el()/names()")
  : bad("window.G.icons (or one of has/el/names) is missing");

const names = [...referenced].sort();
const resolution = await page.evaluate((ns) => ns.map((n) => ({ name: n, has: window.G.icons.has(n) })), names);
const unresolved = resolution.filter((r) => !r.has);
unresolved.length === 0
  ? ok(`all ${names.length} statically-referenced icon names resolve in G.icons (G.icons.has() true for each)`)
  : bad(`${unresolved.length} icon name(s) referenced in source do NOT exist in the G.icons registry: ${unresolved.map((r) => r.name).join(", ")}`);

// ---- cross-check against the live ROUTES table (window.G.routes) - the
// exact data-driven shape (a table of {..., ico: "name"} rows feeding the
// sidebar/drawer) that the original more-horizontal bug's fix pattern never
// actually covered ----
const routeIcoCheck = await page.evaluate(() => {
  const routes = window.G.routes || [];
  const bad = routes.filter((r) => !r.ico || !window.G.icons.has(r.ico)).map((r) => r.hash + ":" + r.ico);
  return { count: routes.length, bad };
});
routeIcoCheck.count >= 30
  ? ok(`window.G.routes exposes ${routeIcoCheck.count} routes (>= 30 expected)`)
  : bad(`window.G.routes only exposed ${routeIcoCheck.count} routes - expected >= 30; G.routes may not be the live ROUTES table any more`);
routeIcoCheck.bad.length === 0
  ? ok(`every route's ico field resolves in G.icons (checked all ${routeIcoCheck.count} ROUTES rows directly, not just the static-extraction pass)`)
  : bad(`route(s) with an ico field that does NOT resolve in G.icons: ${routeIcoCheck.bad.join(", ")}`);

// ---- G.util.icon() fallback contract for an unknown name: icons.js' own
// header comment promises "unknown name -> the caller's text-glyph fallback:
// never a throw, never an empty box in the UI" - never asserted anywhere ----
const fallbackCheck = await page.evaluate(() => {
  const UNKNOWN = "definitely-not-a-real-icon-xyz";
  const node = window.G.util.icon(UNKNOWN, 16, "Q");
  return {
    tag: node.tagName.toLowerCase(),
    text: node.textContent,
    ariaHidden: node.getAttribute("aria-hidden"),
  };
});
fallbackCheck.tag === "span" && fallbackCheck.text === "Q" && fallbackCheck.ariaHidden === "true"
  ? ok('G.util.icon() with an unknown name falls back to <span aria-hidden="true">fallback text</span>, not a throw or an empty box')
  : bad("G.util.icon() unknown-name fallback: " + JSON.stringify(fallbackCheck) + " (expected span/'Q'/'true')");

const fallbackDefaultCheck = await page.evaluate(() => window.G.util.icon("also-not-real").textContent);
fallbackDefaultCheck === "•"
  ? ok("G.util.icon() with an unknown name and no fallback arg defaults to the bullet glyph (•)")
  : bad("G.util.icon() default fallback text: " + JSON.stringify(fallbackDefaultCheck) + " (expected •)");

// ---- G.icons.el() fallback contract for an unknown name: "unknown name:
// empty box, visible in review" per its own inline comment - also never
// asserted anywhere ----
const elFallbackCheck = await page.evaluate(() => {
  const svg = window.G.icons.el("definitely-not-a-real-icon-xyz", 20);
  return {
    tag: svg.tagName.toLowerCase(),
    childCount: svg.childNodes.length,
    viewBox: svg.getAttribute("viewBox"),
    hasGiClass: svg.classList.contains("gi"),
  };
});
elFallbackCheck.tag === "svg" && elFallbackCheck.childCount === 0 && elFallbackCheck.viewBox === "0 0 24 24" && elFallbackCheck.hasGiClass
  ? ok("G.icons.el() with an unknown name returns a structurally valid, empty <svg class=\"gi\"> (no throw)")
  : bad("G.icons.el() unknown-name fallback: " + JSON.stringify(elFallbackCheck) + " (expected an empty svg.gi with viewBox 0 0 24 24)");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nICON REGISTRY: all passed");
process.exit(fails ? 1 : 0);
