/**
 * Tier 4 roadmap item: "Replace the AAR's flat score-grid with a 6-axis
 * competency radar - sess.score already has the 6 ADP 6-22 values needed."
 * (Source engine: Scenario/Training, js/engine.js renderOutcome().)
 *
 * Verified before fixing (see this file's own assertions below, which would
 * have failed against the pre-fix DOM): the claim was genuinely open. The
 * AAR's outcome panel rendered ONLY a flat `.score-grid` of six
 * `.score-cell` number+label pairs - no chart at all - even though
 * js/charts.js's shared G.chart.radar() primitive already existed (built for
 * this same roadmap tier, already consumed once by Progress's LRM radar) and
 * sess.score genuinely carries exactly the 6 ADP 6-22 LRM dimensions
 * (DIMS = Leads/Develops/Achieves/Character/Presence/Intellect, see
 * js/engine.js) as signed per-choice point totals, not percentages.
 *
 * Because sess.score values are SIGNED (each choice.score[k] delta is
 * typically -3..+3, summed across the playthrough) and G.chart.radar clamps
 * every axis to [0, max], a negative dimension score would read identically
 * to an untouched (0) one on the radar alone - real information the old flat
 * grid conveyed via color (red/green/muted) and sign that a radar-only
 * replacement would silently drop. So the fix keeps the flat `.score-grid`
 * exactly as before, unchanged, right under a new `.chart-radar-svg` radar -
 * this test proves BOTH: the new radar renders with real (non-placeholder)
 * axis data, and the pre-existing grid's exact signed values are still
 * present and correct, nothing lost.
 *
 * Setup follows test-train.mjs's own real-playthrough pattern exactly (same
 * guest-session bootstrap, same #/train route, same real scenario/choices)
 * so the expected end state (Leads +5, Develops +6, others 0, total 11,
 * grade A, ending end_g_best) is already independently verified there - this
 * file adds the radar-specific assertions on top of a real playthrough
 * rather than inventing new fixture data.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

await page.evaluate(() => { location.hash = "#/train"; });
await page.waitForTimeout(600);

// ---- launch the real scenario used by test-train.mjs (deterministic end state) ----
await page.fill('input[aria-label="Search scenarios"]', "High Performer");
await page.waitForTimeout(300);
await page.locator(".grid .card.click").first().click();
await page.waitForTimeout(300);

await page.locator('.mode-course button.choice[title="Name the potential you see and make it concrete."]').click();
await page.waitForTimeout(200);
await page.locator(".slide button.btn.primary", { hasText: /Continue/ }).click();
await page.waitForTimeout(200);

await page.locator('.mode-course button.choice[title="Co-build a concrete developmental plan across the three domains."]').click();
await page.waitForTimeout(200);
await page.locator(".slide button.btn.primary", { hasText: /Continue/ }).click();
await page.waitForTimeout(300);

// ---- real After-Action Review outcome screen ----
const outcome = await page.evaluate(() => {
  const root = document.querySelector(".panel.outcome");
  const svg = root?.querySelector(".chart-radar-svg");
  const children = root ? Array.from(root.children) : [];
  return {
    h2: root?.querySelector("h2")?.textContent || "",
    ring: root?.querySelector(".ring")?.textContent || "",
    radarFound: !!svg,
    radarRole: svg?.getAttribute("role") || null,
    radarAriaLabel: svg?.getAttribute("aria-label") || null,
    dotCount: svg ? svg.querySelectorAll("circle").length : 0,
    axisLabels: svg ? [...svg.querySelectorAll("text")].map((t) => t.textContent) : [],
    gridCells: Array.from(root?.querySelectorAll(".score-cell") || []).map((c) => ({
      n: c.querySelector(".n")?.textContent,
      l: c.querySelector(".l")?.textContent,
    })),
    hintText: [...(root?.querySelectorAll(".hint") || [])].map((h) => h.textContent),
    radarIndex: children.findIndex((c) => c.querySelector && c.querySelector(".chart-radar-svg")),
    gridIndex: children.findIndex((c) => c.classList && c.classList.contains("score-grid")),
  };
});

outcome.h2 === "After-Action Review" ? ok("real playthrough reaches the After-Action Review outcome screen")
  : bad("outcome h2: " + JSON.stringify(outcome.h2));
outcome.ring === "A" ? ok("real playthrough grades out at A (total 11)") : bad("grade ring: " + outcome.ring);

// ---- the new radar: real, not a placeholder ----
outcome.radarFound ? ok("AAR outcome panel renders a .chart-radar-svg (shared G.chart.radar() primitive)")
  : bad("no .chart-radar-svg found in the AAR outcome panel - radar did not render");

if (outcome.radarFound) {
  outcome.radarRole === "img" ? ok("AAR radar carries role=\"img\"") : bad("AAR radar role: " + outcome.radarRole);
  outcome.radarAriaLabel && /ADP 6-22/.test(outcome.radarAriaLabel)
    ? ok("AAR radar aria-label names ADP 6-22: \"" + outcome.radarAriaLabel + "\"")
    : bad("AAR radar aria-label: " + JSON.stringify(outcome.radarAriaLabel));
  outcome.dotCount === 6 ? ok("AAR radar renders exactly 6 vertex dots (the 6 ADP 6-22 / LRM dimensions)")
    : bad("AAR radar vertex dot count: expected 6, got " + outcome.dotCount);

  const EXPECTED_DIMS = ["Leads", "Develops", "Achieves", "Character", "Presence", "Intellect"];
  const gotDims = outcome.axisLabels.map((t) => t.replace(/\s*\(\d+%\)\s*$/, ""));
  JSON.stringify(gotDims) === JSON.stringify(EXPECTED_DIMS)
    ? ok("AAR radar's 6 axis labels are the real ADP 6-22 dimension names, in the real DIMS order")
    : bad("AAR radar axis labels: " + JSON.stringify(gotDims) + " (expected " + JSON.stringify(EXPECTED_DIMS) + ")");

  // sess.score for this real playthrough: Leads +5, Develops +6, everything
  // else 0 (independently verified by test-train.mjs's IndexedDB assertion).
  // Radar's AAR_RADAR_AXIS_MAX is 10, so real non-placeholder percentages are
  // Leads 50%, Develops 60% - genuinely different from each other and from
  // the untouched dims' 0%, proving the actual per-session score values
  // reached the chart rather than zeroed/placeholder data.
  const leadsLabel = outcome.axisLabels.find((t) => t.startsWith("Leads"));
  const developsLabel = outcome.axisLabels.find((t) => t.startsWith("Develops"));
  const achievesLabel = outcome.axisLabels.find((t) => t.startsWith("Achieves"));
  leadsLabel === "Leads (50%)" ? ok("AAR radar's Leads axis shows the real score (+5 / max 10 = 50%), not placeholder/zero data")
    : bad("Leads axis label: " + JSON.stringify(leadsLabel));
  developsLabel === "Develops (60%)" ? ok("AAR radar's Develops axis shows the real score (+6 / max 10 = 60%), not placeholder/zero data")
    : bad("Develops axis label: " + JSON.stringify(developsLabel));
  achievesLabel === "Achieves (0%)" ? ok("AAR radar's untouched Achieves axis genuinely reads 0%, not a stale/carried-over value")
    : bad("Achieves axis label: " + JSON.stringify(achievesLabel));
}

// ---- regression: the pre-existing flat score-grid must still be present, unchanged ----
const cellMap = Object.fromEntries(outcome.gridCells.map((c) => [c.l, c.n]));
outcome.gridCells.length === 6 &&
  cellMap.Leads === "+5" && cellMap.Develops === "+6" && cellMap.Achieves === "0" &&
  cellMap.Character === "0" && cellMap.Presence === "0" && cellMap.Intellect === "0"
  ? ok("the pre-existing flat .score-grid is still rendered with its exact real signed values (Leads +5, Develops +6) - nothing lost by adding the radar")
  : bad("score-grid cells after adding the radar: " + JSON.stringify(outcome.gridCells));

outcome.hintText.some((t) => /Exact point values/.test(t))
  ? ok("a caption marks the flat grid as the exact-point-value view, alongside the new radar overview")
  : bad("no 'Exact point values' caption found near the flat grid: " + JSON.stringify(outcome.hintText));

// ---- layout: radar is the new primary visual, ahead of the flat grid ----
outcome.radarFound && outcome.gridIndex >= 0 && outcome.radarIndex >= 0 && outcome.radarIndex < outcome.gridIndex
  ? ok("the radar renders ahead of the flat score-grid (new primary visual, old grid still available below it)")
  : bad("radar/grid DOM order: radarIndex=" + outcome.radarIndex + " gridIndex=" + outcome.gridIndex);

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad(relevantNoise.length + " console msgs; first: " + relevantNoise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `AAR RADAR: ${fails} FAILURE(S)` : "AAR RADAR: all passed"));
process.exit(fails ? 1 : 0);
