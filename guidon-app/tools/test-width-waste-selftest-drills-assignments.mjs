/**
 * Roadmap Tier 5 (route-by-route width-waste audit), #/selftest + #/drills +
 * #/assignments: a prior audit flagged all three as stacking single-column
 * lists/panels at tablet/Fold5-unfolded/desktop widths even though there was
 * ample room for 2-3 across.
 *
 * Re-verifying each independently against the real, current page (the audit's
 * own numbers are from some time ago and this project's roadmap docs have
 * repeatedly had stale claims):
 *
 *   #/drills   - ALREADY FIXED, before this session touched anything. The 6
 *                overview cards in G.drills' own menu() are already wrapped
 *                in .card-results-grid ("Fold5/tablet fidelity wave 2" - a
 *                prior tier). This file only asserts that still holds, so a
 *                future regression here gets caught - no source change was
 *                made for this route.
 *   #/selftest - was genuinely open: Diagnostics' "Manual protocol" panel
 *                (G.selftest, js/selftest.js's MANUAL array, exactly 9
 *                items) appended each of its 9 cards straight into the
 *                panel, one full-width row at a time. Fixed by wrapping them
 *                in the SAME .card-results-grid utility drills.js already
 *                uses for its own 6-card list - reuse, not a new pattern.
 *   #/assignments - was genuinely open: G.assignments (src/app-modules/
 *                assignments.js, itself never even a grep hit inside
 *                src/index.html - see build.mjs's own header comment on
 *                why) appended its 5 "stage" reference panels (eligibility,
 *                the two governing dates, what the Army weighs, how to
 *                preference, pre-window prep) straight into `mount`, one
 *                full-width .panel at a time. Fixed by wrapping them in
 *                .panel-grid-2 - the SAME utility career.js's own
 *                reclass-policy/FY26-snapshot pair already uses, simply
 *                never wired to this route's markup (triggers at >=600px,
 *                deliberately below 768 - see .panel-grid-2's own CSS
 *                comment on the Fold 5's ~673px unfolded width).
 *
 * For each of the two genuinely-fixed routes this asserts: (1) at a real
 * 768px viewport, two of the target cards/panels now share the same row
 * (their real bounding-rect top edges match, not just "some grid class
 * exists" or a mocked width), (2) real interactivity survives the DOM
 * restructuring (selftest: a manual-protocol checkbox still ticks and
 * persists via G.db; assignments: the panel content and its "Related"
 * nav buttons still work), and (3) at a real 375px phone viewport the SAME
 * route is still a clean single column (no two cards/panels share a row).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function newPage(width) {
  // height:1400 (this file's original value) made the @768px checks a
  // 768x1400 viewport - aspect-ratio ~0.549, which is exactly the "generic
  // narrow-tall small-tablet-portrait" shape Roadmap Tier 6's aspect-ratio
  // gate on .panel-grid-2/-3 (index.html, "600-799px band" rule) is
  // DELIBERATELY meant to exclude from the 2-up grid - see that rule's own
  // comment. 1400 was never a real device height, just an arbitrary "tall
  // enough to dodge scroll-related flakiness" pick; it happened to land in
  // the excluded bucket by coincidence, not because #/selftest, #/drills or
  // #/assignments actually need to keep a 2-up grid at genuinely
  // narrow-portrait shapes. height:1000 replaces it - the SAME value this
  // test's own sibling files already use for their real @768px checks
  // (tools/test-forms-counsel-grid.mjs, tools/test-fitness-currency-grid.mjs),
  // giving 768x1000 - aspect-ratio 0.768, comfortably inside the gate's
  // >0.7 band and a realistic tablet-portrait proportion (close to a
  // classic 768x1024 iPad-portrait shape), not an arbitrary rectangle.
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await ctx.newPage();
  const noise = [];
  page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
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
  return { ctx, page, noise };
}

async function goTo(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(600);
}

async function rects(page, selector) {
  return page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) };
  }), selector);
}

function sameRow(a, b) { return a.top === b.top && a.left !== b.left; }
function allStacked(items) {
  // Single column: every item starts at the same left edge and no two share a top.
  const lefts = new Set(items.map((i) => i.left));
  const tops = items.map((i) => i.top);
  return lefts.size === 1 && new Set(tops).size === items.length;
}

// ── #/selftest: Manual protocol, 9 cards ───────────────────────────────────
{
  const sel = "#route .card-results-grid > .card";

  const wide = await newPage(768);
  await goTo(wide.page, "#/selftest");
  const wideCards = await rects(wide.page, sel);
  wideCards.length === 9
    ? ok("#/selftest: exactly 9 manual-protocol cards render inside .card-results-grid (matches MANUAL.length)")
    : bad("#/selftest: expected 9 cards in .card-results-grid, found " + wideCards.length);
  if (wideCards.length >= 2 && sameRow(wideCards[0], wideCards[1])) {
    ok(`#/selftest @768px: card 1 and card 2 share a row (top=${wideCards[0].top} for both, left ${wideCards[0].left} vs ${wideCards[1].left}) - real 2-up grid, not a mocked width`);
  } else {
    bad("#/selftest @768px: first two manual-protocol cards do NOT share a row - " + JSON.stringify(wideCards.slice(0, 2)));
  }

  // Real interactivity: tick the first manual checkbox inside the grid, confirm
  // the "Confirmed" stat updates AND the tick survives a full re-render (i.e.
  // it round-tripped through G.db, not just an in-memory flag) - same proof
  // shape test-selftest.mjs already uses, run again here because this DOM was
  // restructured (cards now live one level deeper, inside the new grid wrapper).
  const firstCb = wide.page.locator(".card-results-grid input[type='checkbox']").first();
  await firstCb.check();
  await wide.page.waitForTimeout(250);
  const mstatAfterCheck = await wide.page.evaluate(() => (document.querySelectorAll(".stat .v")[1] || {}).textContent || "");
  /^1 \//.test(mstatAfterCheck)
    ? ok("#/selftest: ticking a manual-protocol card inside the new grid still updates the Confirmed count (" + mstatAfterCheck + ")")
    : bad("#/selftest: Confirmed count after ticking: " + mstatAfterCheck);
  await goTo(wide.page, "#/home");
  await goTo(wide.page, "#/selftest");
  const firstCbAfterRerender = await wide.page.locator(".card-results-grid input[type='checkbox']").first().isChecked();
  firstCbAfterRerender
    ? ok("#/selftest: the tick survives a full re-render (persisted via G.db, not just in-memory) with the grid wrapper in place")
    : bad("#/selftest: manual tick did not persist across a re-render with the grid wrapper in place");
  await wide.ctx.close();

  const narrow = await newPage(375);
  await goTo(narrow.page, "#/selftest");
  const narrowCards = await rects(narrow.page, sel);
  narrowCards.length === 9 && allStacked(narrowCards)
    ? ok("#/selftest @375px: all 9 manual-protocol cards remain a clean single column (same left edge, no shared rows)")
    : bad("#/selftest @375px: cards not cleanly single-column - " + JSON.stringify(narrowCards));
  const narrowNoise = narrow.noise.filter((n) => !/favicon/.test(n));
  narrowNoise.length === 0 ? ok("#/selftest @375px: no console errors") : bad("#/selftest @375px console noise: " + narrowNoise.slice(0, 3).join(" | "));
  await narrow.ctx.close();
}

// ── #/assignments: 5 stage panels ──────────────────────────────────────────
{
  const sel = "#route .panel-grid-2 > .panel";

  const wide = await newPage(768);
  await goTo(wide.page, "#/assignments");
  const heading = await wide.page.evaluate(() => /Assignments & Marketplace/.test(document.body.textContent || ""));
  heading ? ok("#/assignments: route renders (G.assignments.render ran without throwing)") : bad("#/assignments: 'Assignments & Marketplace' heading not found - route may have thrown");

  const wideStages = await rects(wide.page, sel);
  wideStages.length === 5
    ? ok("#/assignments: exactly 5 stage panels render inside .panel-grid-2")
    : bad("#/assignments: expected 5 stage panels in .panel-grid-2, found " + wideStages.length);
  if (wideStages.length >= 2 && sameRow(wideStages[0], wideStages[1])) {
    ok(`#/assignments @768px: stage panel 1 and 2 share a row (top=${wideStages[0].top} for both, left ${wideStages[0].left} vs ${wideStages[1].left}) - real 2-up grid`);
  } else {
    bad("#/assignments @768px: first two stage panels do NOT share a row - " + JSON.stringify(wideStages.slice(0, 2)));
  }
  // "Related" nav-button panel is deliberately OUTSIDE the grid, full width, below it.
  const relatedInGrid = await wide.page.evaluate(() => {
    const grid = document.querySelector("#route .panel-grid-2");
    return grid ? Array.from(grid.querySelectorAll(".panel")).some((p) => /Related/.test((p.querySelector(".eyebrow")||{}).textContent||"")) : null;
  });
  relatedInGrid === false
    ? ok("#/assignments: the 'Related' nav-button panel stays OUTSIDE the stage grid (full width below it), as intended")
    : bad("#/assignments: 'Related' panel unexpectedly ended up inside the stage grid: " + relatedInGrid);

  // Real interactivity: the "Related" panel's nav buttons still navigate.
  const relatedBtn = wide.page.locator("button", { hasText: /Records Readiness/ });
  (await relatedBtn.count()) > 0 ? ok("#/assignments: 'Related' nav button ('Records Readiness') still renders") : bad("#/assignments: 'Records Readiness' related button missing");
  await relatedBtn.click();
  await wide.page.waitForTimeout(400);
  const navigatedHash = await wide.page.evaluate(() => location.hash);
  navigatedHash === "#/records"
    ? ok("#/assignments: clicking a 'Related' button still navigates (now at " + navigatedHash + ")")
    : bad("#/assignments: 'Related' button click did not navigate, hash is " + navigatedHash);
  await wide.ctx.close();

  const narrow = await newPage(375);
  await goTo(narrow.page, "#/assignments");
  const narrowStages = await rects(narrow.page, sel);
  narrowStages.length === 5 && allStacked(narrowStages)
    ? ok("#/assignments @375px: all 5 stage panels remain a clean single column")
    : bad("#/assignments @375px: stage panels not cleanly single-column - " + JSON.stringify(narrowStages));
  const narrowNoise = narrow.noise.filter((n) => !/favicon/.test(n));
  narrowNoise.length === 0 ? ok("#/assignments @375px: no console errors") : bad("#/assignments @375px console noise: " + narrowNoise.slice(0, 3).join(" | "));
  await narrow.ctx.close();
}

// ── #/drills: 6 overview cards - confirm this was ALREADY fixed (prior
// tier's .card-results-grid wiring in menu()), so no source change was made
// here - this just guards against a future regression silently reverting it.
{
  const sel = "#route .card-results-grid > .panel";

  const wide = await newPage(768);
  await goTo(wide.page, "#/drills");
  const wideCards = await rects(wide.page, sel);
  wideCards.length === 6
    ? ok("#/drills: exactly 6 drill-picker cards render inside .card-results-grid (already wired by a prior tier)")
    : bad("#/drills: expected 6 drill-picker cards in .card-results-grid, found " + wideCards.length);
  if (wideCards.length >= 2 && sameRow(wideCards[0], wideCards[1])) {
    ok(`#/drills @768px: drill-picker cards 1 and 2 already share a row (top=${wideCards[0].top}) - confirms this route needed NO change this tier`);
  } else {
    bad("#/drills @768px: drill-picker cards do not share a row - the prior-tier grid may have regressed: " + JSON.stringify(wideCards.slice(0, 2)));
  }
  // Real interactivity: clicking a drill-picker card still opens that drill.
  const squadCard = wide.page.locator(".card-results-grid button", { hasText: /Squad Drill sequence/ });
  await squadCard.click();
  await wide.page.waitForTimeout(400);
  const opened = await wide.page.evaluate(() => /Squad Drill.*20 graded steps/.test(document.body.textContent || ""));
  opened ? ok("#/drills: clicking a gridded drill-picker card still opens the real drill") : bad("#/drills: clicking a drill-picker card did not open the drill");
  await wide.ctx.close();

  const narrow = await newPage(375);
  await goTo(narrow.page, "#/drills");
  const narrowCards = await rects(narrow.page, sel);
  narrowCards.length === 6 && allStacked(narrowCards)
    ? ok("#/drills @375px: all 6 drill-picker cards remain a clean single column")
    : bad("#/drills @375px: drill-picker cards not cleanly single-column - " + JSON.stringify(narrowCards));
  await narrow.ctx.close();
}

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nWIDTH-WASTE (selftest/drills/assignments): all passed");
process.exit(fails ? 1 : 0);
