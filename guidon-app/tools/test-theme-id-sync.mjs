/**
 * Theme engine: the pre-paint bootstrap <script>'s hand-copied theme-id
 * lists must never drift from js/theme.js's own THEMES registry.
 *
 * BACKGROUND: the pre-paint script (top of <head>, runs before CSS and long
 * before the ~25,000-line app itself parses) applies the persisted
 * data-theme/data-motion/data-type attributes before first paint, so a
 * Soldier never sees a flash of the wrong theme. It CANNOT read js/theme.js's
 * THEME_IDS at that point - that script hasn't loaded yet - so it has always
 * carried its OWN copies: `var T=[...]` (every theme id) and `var LIGHT=
 * [...]` (the light-kind subset, for the legacy `.light` class toggle).
 * Those copies used to be hand-maintained and drifted: the ten "Focus set"
 * themes added in session 35 (graphite-calm, umber-lamp, pine-dusk,
 * slate-quiet, clay-warm, harbor-mid, parchment-read, bone-neutral,
 * overcast-glare, sandstone-sun) were missing from both, so anyone on one of
 * those themes got a REAL flash of the wrong theme on every load - T.indexOf
 * (a.theme) came back -1, so the pre-paint script silently fell back to
 * field-manual/parade-rest until js/theme.js finished parsing a beat later
 * and corrected the attribute out from under the first paint.
 *
 * FIX: tools/build.mjs's deriveThemeIds() now parses the real, live THEMES
 * array (same one js/theme.js's own THEME_IDS is built from) and injects the
 * result into `var T=`/`var LIGHT=` at build time, for BOTH dist/guidon-
 * standalone.html and web/index.html - see build.mjs's "pre-paint theme-id
 * sync" step. Drift is now structurally impossible: a new theme cannot exist
 * in THEMES without the pre-paint script knowing about it.
 *
 * This file proves three separate things, because a passing test that only
 * checks one would leave real gaps:
 *   PART A - the BUILT OUTPUT's pre-paint list is genuinely IDENTICAL (same
 *            ids, same order, same count - not "close" or "at least N") to
 *            THEME_IDS as freshly re-derived from the built file's own
 *            THEMES registry, for both dist/ and web/ artifacts.
 *   PART B - deriveThemeIds() actually PARSES its input rather than
 *            returning some memorized/hardcoded list: fed a synthetic THEMES
 *            literal containing an id that has never existed anywhere in
 *            this codebase, it must come back out - something a coincidental
 *            hardcoded match could never do - and brace-matching must
 *            survive a "]" character sitting inside a quoted string field.
 *   PART C - the actual on-screen behavior is fixed: loading the real built
 *            app with localStorage seeded to a previously-broken Focus-set
 *            theme (one dark, one light) produces the CORRECT data-theme/
 *            .light state right at Playwright's "domcontentloaded" wait -
 *            i.e. as applied by the synchronous pre-paint script, before
 *            app.js's own (async - it awaits store.init() first) boot
 *            correction has had a chance to run. A previously-working theme
 *            (squadron-blue, already in the old hardcoded list) is checked
 *            too, as a regression guard that the codegen didn't change
 *            existing behavior for ids that were never broken.
 *            (A MutationObserver attached in addInitScript was tried first
 *            and rejected: document.documentElement at addInitScript-time is
 *            not the same object the HTML parser ultimately populates, so it
 *            silently observes zero mutations - confirmed empirically. Reading
 *            immediately after "domcontentloaded" is simpler and, empirically,
 *            reliable: the pre-paint value is still in place at that instant,
 *            and only drifts to the app's own default several hundred ms later.)
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { deriveThemeIds } from "./build.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

// ============================================================
// PART A - built output's pre-paint list == the real THEME_IDS, exactly
// ============================================================
async function checkBuiltArtifact(path, label) {
  const html = await readFile(path, "utf8");
  const real = deriveThemeIds(html); // same THEMES registry, freshly re-parsed

  const tMatch = html.match(/var T=(\[[^\]]*\])/);
  const lightMatch = html.match(/var LIGHT=(\[[^\]]*\])/);
  if (!tMatch) { bad(`${label}: pre-paint script's "var T=[...]" not found at all`); return; }
  if (!lightMatch) { bad(`${label}: pre-paint script's "var LIGHT=[...]" not found at all`); return; }

  const prePaintT = JSON.parse(tMatch[1]);
  const prePaintLight = JSON.parse(lightMatch[1]);

  real.ids.length === 24
    ? ok(`${label}: real THEMES registry has 24 themes (sanity check on the fixture itself)`)
    : bad(`${label}: real THEMES registry has ${real.ids.length} themes, expected 24 - update this test's expectation if a theme was legitimately added/removed`);

  JSON.stringify(prePaintT) === JSON.stringify(real.ids)
    ? ok(`${label}: pre-paint "var T" is IDENTICAL to THEME_IDS - ${prePaintT.length} ids, same order`)
    : bad(`${label}: pre-paint "var T" (${prePaintT.length} ids) != real THEME_IDS (${real.ids.length} ids)\n` +
          `        pre-paint: ${JSON.stringify(prePaintT)}\n` +
          `        real:      ${JSON.stringify(real.ids)}`);

  JSON.stringify(prePaintLight) === JSON.stringify(real.lightIds)
    ? ok(`${label}: pre-paint "var LIGHT" is IDENTICAL to the real light-kind subset - ${prePaintLight.length} ids`)
    : bad(`${label}: pre-paint "var LIGHT" (${JSON.stringify(prePaintLight)}) != real light-kind ids (${JSON.stringify(real.lightIds)})`);

  // Specifically guard the ten ids that were the actual reported bug -
  // a test that only checked array length could pass with 24 wrong ids.
  const focusSet = ["graphite-calm", "umber-lamp", "pine-dusk", "slate-quiet", "clay-warm",
    "harbor-mid", "parchment-read", "bone-neutral", "overcast-glare", "sandstone-sun"];
  const missing = focusSet.filter((id) => !prePaintT.includes(id));
  missing.length === 0
    ? ok(`${label}: all 10 "Focus set" (session 35) theme ids are present in the pre-paint list`)
    : bad(`${label}: pre-paint list is still missing Focus-set ids: ${missing.join(", ")}`);
}

await checkBuiltArtifact("web/index.html", "web/index.html");
await checkBuiltArtifact("dist/guidon-standalone.html", "dist/guidon-standalone.html");

// ============================================================
// PART B - deriveThemeIds() genuinely parses, it doesn't return a
// memorized/hardcoded list that happens to match by coincidence
// ============================================================
{
  const CANARY = "zz-canary-unit-test-theme-" + Date.now();
  const synthetic = `
    /* unrelated preamble, same as real src/index.html */
    window.G = window.G || {};
    (function () {
      const THEMES = [
        { id: "ordinary-one", name: "Ordinary One", kind: "dark", group: "Test",
          swatches: ["#000000", "#000000", "#000000", "#000000"],
          blurb: "A blurb containing a bracket ] right in the middle of it, to prove brace-matching survives it." },
        { id: "${CANARY}", name: "Canary", kind: "light", group: "Test",
          swatches: ["#ffffff"], blurb: "Never existed in this codebase before this test ran." },
      ];
      const THEME_IDS = THEMES.map((t) => t.id);
    })();
  `;
  const derived = deriveThemeIds(synthetic);

  derived.ids.includes(CANARY)
    ? ok(`deriveThemeIds() extracted a never-before-seen synthetic id (${CANARY}) - genuine parse, not a hardcoded lookup`)
    : bad(`deriveThemeIds() did NOT extract the synthetic canary id - got ${JSON.stringify(derived.ids)}`);

  derived.ids[0] === "ordinary-one" && derived.ids[1] === CANARY
    ? ok(`deriveThemeIds() preserves registration order (ordinary-one, then the canary)`)
    : bad(`deriveThemeIds() order wrong: ${JSON.stringify(derived.ids)}`);

  derived.lightIds.includes(CANARY) && !derived.lightIds.includes("ordinary-one")
    ? ok(`deriveThemeIds() correctly separates kind:"light" (canary) from kind:"dark" (ordinary-one)`)
    : bad(`deriveThemeIds() light-kind filter wrong: lightIds=${JSON.stringify(derived.lightIds)}`);

  // The embedded "]" inside the first theme's blurb is the actual regression
  // case: a naive `html.indexOf("]")` (rather than brace-matching through
  // string literals) would have truncated the array after that blurb's "]",
  // silently losing the canary entirely.
  derived.ids.length === 2
    ? ok(`deriveThemeIds() brace-matched through the embedded "]" in a blurb without truncating early`)
    : bad(`deriveThemeIds() returned ${derived.ids.length} ids, expected exactly 2 - the embedded "]" likely truncated parsing`);
}

// ============================================================
// PART C - real on-screen behavior: previously-broken themes no longer
// flash the wrong theme on load; a previously-working theme is unaffected
// ============================================================
const { server, url } = await serve("web");
const browser = await chromium.launch();

// Seeds localStorage's pre-paint mirror before ANY page script runs
// (addInitScript is guaranteed to execute before the page's own <head>
// <script>), and overrides Element.prototype.setAttribute so the FIRST call
// that sets <html>'s data-theme attribute records a snapshot into a page-side
// variable a microtask later (letting the rest of that same synchronous
// pre-paint script - which toggles the .light class a few lines after
// setting data-theme - finish first). This is captured entirely inside the
// page, with no dependency on when Node-side code happens to get around to
// reading it, which two earlier approaches both needed and both turned out
// to be unsafe:
//   - reading document.documentElement live right after Playwright's
//     "domcontentloaded" wait resolved worked in manual spot-checks but was
//     genuinely racy under load - the app's own (async - it awaits
//     store.init()'s IndexedDB open) boot correction could occasionally win
//     the round-trip before our page.evaluate() call landed, intermittently
//     "catching" the post-boot default instead of the pre-paint value.
//   - a MutationObserver attached to document.documentElement in
//     addInitScript never fired at all: that reference is not the same
//     object the HTML parser goes on to populate, so it silently observes
//     zero mutations.
// Overriding Element.prototype.setAttribute avoids both problems: it's a
// prototype-level intercept (not tied to any one element's identity, so the
// object-identity issue above cannot apply), and the calling page itself
// records the value with no observation-latency window for anything else
// to win a race against.
async function firstThemeSnapshot(themeId) {
  const context = await browser.newContext();
  await context.addInitScript((theme) => {
    try { localStorage.setItem("guidon:appearance:v1", JSON.stringify({ theme })); } catch (e) {}
    window.__firstThemeSnapshot = null;
    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      origSetAttribute.call(this, name, value);
      if (window.__firstThemeSnapshot === null && name === "data-theme" && this === document.documentElement) {
        Promise.resolve().then(() => {
          if (window.__firstThemeSnapshot === null) {
            window.__firstThemeSnapshot = {
              theme: document.documentElement.getAttribute("data-theme"),
              light: document.documentElement.classList.contains("light"),
            };
          }
        });
      }
    };
  }, themeId);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  const snap = await page.evaluate(() => window.__firstThemeSnapshot);
  await context.close();
  return snap;
}

const cases = [
  // [themeId, expectLight, label]
  ["graphite-calm", false, "Focus-set DARK theme (session 35, previously missing from var T)"],
  ["sandstone-sun", true, "Focus-set LIGHT theme (session 35, previously missing from var T/LIGHT)"],
  ["squadron-blue", false, "pre-existing theme (v0.43, was already in the old hardcoded list)"],
];

for (const [themeId, expectLight, label] of cases) {
  const snap = await firstThemeSnapshot(themeId);
  if (!snap) { bad(`${label}: data-theme was never set via setAttribute() at all - pre-paint script may have thrown`); continue; }
  snap.theme === themeId
    ? ok(`${label}: first-paint data-theme is "${themeId}" (no flash of the wrong theme)`)
    : bad(`${label}: first-paint data-theme was "${snap.theme}", expected "${themeId}" - pre-paint script fell back, meaning the flash-of-wrong-theme bug is still present`);
  snap.light === expectLight
    ? ok(`${label}: first-paint .light class is ${expectLight} (matches its "kind")`)
    : bad(`${label}: first-paint .light class was ${snap.light}, expected ${expectLight}`);
}

await browser.close();
await server.close();

console.log("\n" + (fails ? `THEME ID SYNC: ${fails} FAILURE(S)` : "THEME ID SYNC: all passed"));
process.exit(fails ? 1 : 0);
