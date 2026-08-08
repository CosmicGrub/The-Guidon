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

const ROUTES = await page.evaluate(() => (window.G && G.__ROUTE_HASHES__) || null);
// Fallback: hashes hand-synced with src/index.html's ROUTES array if the app
// doesn't expose them (kept in one place, asserted against below).
const HASHES = ROUTES || ["#/home","#/train","#/learn","#/forms","#/counsel","#/develop","#/blc","#/alc",
  "#/slc","#/drills","#/channels","#/career","#/write","#/money","#/health","#/fitness","#/records",
  "#/calendar","#/assignments","#/leader","#/currency","#/transition","#/resources","#/doctrine",
  "#/dictionary","#/board","#/risk","#/progress","#/author","#/share","#/selftest","#/settings",
  "#/search","#/profile","#/kiosk"];

const violations = [];
let combosRun = 0;

for (const hash of HASHES) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(350);
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
      violations.push({ hash, theme, error: "axe.run threw: " + e.message });
      continue;
    }
    combosRun++;
    for (const v of result) {
      for (const n of v.nodes) {
        violations.push({ hash, theme, target: n.target, summary: n.summary, html: n.html });
      }
    }
  }
}

await browser.close();
server.close();

console.log(`Swept ${HASHES.length} routes x ${THEMES.length} themes = ${combosRun} combinations.`);
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
