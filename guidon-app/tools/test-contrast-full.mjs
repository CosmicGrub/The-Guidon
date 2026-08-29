/**
 * Comprehensive color-contrast sweep: every route x every theme, via a real
 * axe-core color-contrast pass rather than a curated set of known trouble
 * spots (that's what tools/test-contrast.mjs does — this is the exhaustive
 * counterpart).
 *
 * Why this exists: every session from 10 through 51 ran an ad hoc version of
 * this same sweep by hand (Playwright + axe-core injected live), reported a
 * violation count, fixed what it found, and then the tooling was thrown
 * away — so the NEXT session had no way to confirm the number was still
 * accurate and re-built the same harness from scratch. GUIDON_STATE.json's
 * openItems still cited session 15's "104 remaining near-misses" figure as
 * current, when session 19 (four sessions later) had already driven that
 * specific set to zero. This script is the harness, checked in for good, so
 * violation counts are always re-derived live rather than quoted from
 * memory. See the STANDING note: "derive counts from the artifact, never
 * hard-code them."
 *
 * Guest session only (no personal-profile data needed for a rendering
 * sweep). Reports every axe color-contrast violation with theme, route,
 * selector, and measured ratio.
 *
 * Item F ("Reading the Cards" Roadmap Tier 6c) - two real coverage gaps
 * fixed here, both because the main sweep below only ever NAVIGATES (via
 * location.hash) with zero interaction:
 *   1. Board Drill's .qz-back (the answer face) carries `inert` until a
 *      card is actually flipped - axe skips an inert subtree entirely, so
 *      the answer face's contrast (and anything theme-specific rendered
 *      only once flipped) was never checked in any theme.
 *   2. Rapid Fire isn't a separate route - it's a mode tab INSIDE #/board
 *      (confirmed this session) - so navigating to #/board only ever
 *      exercises Board Drill's own flashcard view, never a live round.
 *      .rf-judge-correct/.rf-judge-pass and the streak/timer colors were
 *      never checked in any theme.
 * Both are added as two EXTRA interaction passes after the main sweep,
 * reusing the exact same per-theme axe-run loop (extracted below into
 * sweepThemes()) rather than duplicating it three times or restructuring
 * the main sweep's own route x theme loop.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import fs from "node:fs";

const THEMES = ["blackout","bone-neutral","clay-warm","desert-cadence","field-manual","graphite-calm",
      "harbor-mid","ink-paper","nautical-dusk","night-vision","overcast-glare","parade-rest",
      "parchment-read","pine-dusk","range-red","sandstone-sun","sepia-study","signal-amber",
      "slate-focus","slate-quiet","squadron-blue","subdued","topographic","umber-lamp"];

const axeSrc = fs.readFileSync(new URL(import.meta.resolve("axe-core/axe.min.js")), "utf8");

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1100);
await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1100);
await page.addScriptTag({ content: axeSrc });

// Derived live from the app's own ROUTES array (window.G.routes, same
// source test-a11y-tree.mjs and test-csp.mjs already use) rather than a
// hand-synced hardcoded list - a prior version of this file tried to read
// a window.G.__ROUTE_HASHES__ global that was never actually assigned
// anywhere in the app, so it always silently fell back to a stale 35-hash
// snapshot missing #/privacy (added after that snapshot was written) -
// meaning that route was never actually contrast-checked. Same bug class
// as #/profile and #/kiosk once being silently excluded from the a11y
// sweep, just recurring here undetected in a different suite.
const HASHES = await page.evaluate(() => window.G.routes.map((r) => r.hash));

const violations = [];
let combosRun = 0;

// Runs the color-contrast check across every theme against whatever DOM
// state the page is CURRENTLY in (no navigation - the caller is responsible
// for getting the page into the right state first), recording violations
// under `reportLabel` rather than a raw location.hash - lets the two extra
// interaction passes below (Board Drill flipped, Rapid Fire live round)
// share this exact loop with the main route sweep instead of duplicating
// it three times.
async function sweepThemes(reportLabel) {
  for (const theme of THEMES) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(40);
    let result;
    try {
      result = await page.evaluate(async () => {
        const r = await axe.run(document, { runOnly: ["color-contrast"] });
        return r.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target.join(" "),
            summary: n.failureSummary,
            html: (n.html || "").slice(0, 160),
          })),
        }));
      });
    } catch (e) {
      violations.push({ hash: reportLabel, theme, error: "axe.run threw: " + e.message });
      continue;
    }
    combosRun++;
    for (const v of result) {
      for (const n of v.nodes) {
        violations.push({ hash: reportLabel, theme, target: n.target, summary: n.summary, html: n.html });
      }
    }
  }
}

for (const hash of HASHES) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(350);
  await sweepThemes(hash);
}

/* ---- Item F extra pass 1: Board Drill's .qz-back, pre-flip carries
   `inert` (axe skips an inert subtree entirely - confirmed live via the
   element's attributes, not just read from source) so its contrast was
   never checked. Flips a real card via the dedicated .qz-nav-flip button
   (bypasses the drag-suppression guard the card's own click listener
   carries) and re-sweeps every theme against the now-flipped DOM state.
   #/board always shows a real default card with zero clicks needed first
   (catSel defaults to "All categories" - build()'s own `cat = catSel.value
   || "All"` - so there is always a .qz-card here already). Global
   transitions are already killed for the whole page (see the addStyleTag
   call above), so the flip is instant - no settle wait beyond a short
   margin. ---- */
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(350);
const flipped = await page.evaluate(() => {
  const btn = document.querySelector(".qz-nav-flip");
  if (!btn) return false;
  btn.click();
  return document.querySelector(".qz-card")?.classList.contains("flipped") || false;
});
if (flipped) {
  await page.waitForTimeout(150);
  await sweepThemes("#/board (card flipped, .qz-back visible)");
} else {
  violations.push({ hash: "#/board (card flipped, .qz-back visible)", theme: "n/a", error: "could not flip a Board Drill card - .qz-nav-flip missing or flip did not register" });
}

/* ---- Item F extra pass 2: Rapid Fire is a mode TAB inside #/board, not a
   separate route, so it's never reached by the hash-only sweep above.
   Enters a live Solo round (Solo skips Party/Team's one-time explainer
   screen entirely, per renderRapidFire's own startBtn handler - simplest
   reliable way to reach a real round with no extra dialog to dismiss) and
   re-sweeps every theme against .rf-judge-correct/.rf-judge-pass and the
   streak/timer HUD colors, none of which exist on Board Drill's own
   flashcard view. ---- */
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(350);
await page.evaluate(() => {
  const rapidBtn = [...document.querySelectorAll(".segmented button")].find((b) => b.textContent.trim() === "Rapid Fire");
  if (rapidBtn) rapidBtn.click();
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const soloBtn = [...document.querySelectorAll(".segmented button")].find((b) => b.textContent.trim() === "Solo");
  if (soloBtn) soloBtn.click();
});
await page.waitForTimeout(200);
const rapidFireRoundStarted = await page.evaluate(() => {
  const startBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Start Round");
  if (!startBtn) return false;
  startBtn.click();
  return true;
});
if (rapidFireRoundStarted) {
  await page.waitForTimeout(400);
  const judgeButtonsPresent = await page.evaluate(() => !!document.querySelector(".rf-judge-correct") && !!document.querySelector(".rf-judge-pass"));
  if (judgeButtonsPresent) {
    await sweepThemes("#/board (Rapid Fire live round)");
  } else {
    violations.push({ hash: "#/board (Rapid Fire live round)", theme: "n/a", error: "Start Round was clicked but .rf-judge-correct/.rf-judge-pass never appeared" });
  }
} else {
  violations.push({ hash: "#/board (Rapid Fire live round)", theme: "n/a", error: "could not reach the Rapid Fire round screen - Rapid Fire tab, Solo mode, or Start Round button missing" });
}

await browser.close();
server.close();

console.log(`Swept ${HASHES.length} routes + 2 interaction passes (Board Drill flipped, Rapid Fire live round) x ${THEMES.length} themes = ${combosRun} combinations.`);
console.log(`Page errors during sweep: ${pageErrors.length}`);
if (pageErrors.length) console.log("  " + pageErrors.slice(0, 5).join("\n  "));
console.log(`Color-contrast violations: ${violations.length}`);

if (violations.length) {
  // Group by (theme, target) so repeated hits across routes collapse to one line.
  const grouped = new Map();
  for (const v of violations) {
    if (v.error) { console.log("  ERROR " + v.hash + " " + v.theme + ": " + v.error); continue; }
    const key = v.theme + " | " + v.target;
    if (!grouped.has(key)) grouped.set(key, { theme: v.theme, target: v.target, routes: new Set(), summary: v.summary, html: v.html });
    grouped.get(key).routes.add(v.hash);
  }
  const rows = [...grouped.values()].sort((a, b) => a.theme.localeCompare(b.theme) || a.target.localeCompare(b.target));
  console.log(`\nGrouped into ${rows.length} distinct (theme, selector) failures:\n`);
  for (const r of rows) {
    console.log(`[${r.theme}] ${r.target}`);
    console.log(`  routes: ${[...r.routes].join(", ")}`);
    console.log(`  ${r.summary.split("\n")[0]}`);
    console.log(`  html: ${r.html}`);
    console.log("");
  }
  fs.writeFileSync(new URL("../../GUIDON files/contrast-full-sweep-raw.json", import.meta.url), JSON.stringify(rows, null, 2));
  console.log("Full grouped detail written to GUIDON files/contrast-full-sweep-raw.json");
}

process.exit(0);
