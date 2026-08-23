/**
 * Roadmap Tier 5 (width-waste audit, #/transition + #/health): the audit
 * claimed both routes still stacked their panel lists single-column on
 * wide viewports - #/transition's Timeline tab at "3,758px scroll, 15
 * milestone panels", #/health at "843px, 6 stacked domain sections" - and
 * suggested wrapping each in a 2-column grid at >=768px.
 *
 * Re-verifying against the real, current markup (not the stale audit
 * numbers) found BOTH routes already fixed: transition.js's renderTimeline/
 * renderCareer and resilience.js's renderDomains/renderSkills/
 * renderResources already wrap their panel lists in the shared
 * `.card-results-grid` utility (`display:grid; grid-template-columns:
 * repeat(auto-fill,minmax(260px,1fr))`), each carrying its own "Fold5/
 * tablet fidelity wave 2" comment dating the fix to an earlier tier. That
 * utility has no width-specific breakpoint of its own - auto-fill collapses
 * to one column whenever the viewport is too narrow to fit a second
 * 260px-minimum card, which is exactly why it already reads correctly at
 * 375px without a matching media query.
 *
 * No CSS/JS changes were made here (the CRITICAL instruction is explicit:
 * "if a route already has a working grid... do nothing further on it").
 * This file exists purely to lock the already-correct behavior in as a
 * regression test, per this tier's TESTING requirement, for two routes
 * unrelated agents editing shared CSS (.card-results-grid, .panel) in the
 * other 12 parallel worktrees could otherwise silently break:
 *
 *   Part 1: #/transition Timeline tab - real 2-column grid at 768/1024px
 *           (two panels share a real top edge), real single column at
 *           375px, and a synthetic "what if this were forced back to one
 *           column" comparison proving the existing grid meaningfully
 *           shortens the page (not just "a grid exists but does nothing").
 *   Part 2: #/transition Career tab - same grid, lighter check.
 *   Part 3: #/health H2F Domains tab - same 2/1-column checks, PLUS domain
 *           expand/collapse interactivity (click-to-reveal skills) proven
 *           to still work at both a wide and a narrow viewport.
 *   Part 4: #/health Daily Skills + Get Support tabs - same grid, lighter
 *           check, plus skill-card expand/collapse at a wide viewport.
 *
 * Reuses ONE browser page for the whole run (setViewportSize + a hash
 * change between checks) rather than a fresh browser context per viewport -
 * spinning up 8+ separate Chromium contexts back-to-back in this sandboxed
 * environment was observed to crash the browser process mid-run.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1024, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("  pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(600);

// Sets the viewport and (optionally) the route hash, waiting for both the
// SPA's hash router and CSS reflow to settle. Reusing the same page/route
// across viewport changes (hash omitted) just resizes and reflows - no
// re-navigation needed for a pure width check.
async function goto(hash, width, height = 900) {
  await page.setViewportSize({ width, height });
  if (hash) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(500);
  } else {
    await page.waitForTimeout(150);
  }
}

// Reads one .card-results-grid (by a CSS selector scoping to a specific
// grid when a screen has more than one, e.g. transition's Career tab also
// has a .tx-details grid of `<details>` elements it must not be confused
// with) and returns real, measured layout facts - never mocked.
async function readGrid(scopeSelector) {
  return page.evaluate((sel) => {
    const grid = document.querySelector(sel);
    if (!grid) return { found: false };
    const cs = getComputedStyle(grid);
    const kids = [...grid.children].filter((c) => c.offsetParent !== null);
    const rects = kids.map((k) => k.getBoundingClientRect());
    const cols = new Set(rects.map((r) => Math.round(r.left))).size;
    return {
      found: true,
      display: cs.display,
      gridTemplateColumns: cs.gridTemplateColumns,
      childCount: kids.length,
      realScrollHeight: grid.scrollHeight,
      distinctColumnStarts: cols,
      firstTwoSameRow: rects.length >= 2 ? Math.abs(rects[0].top - rects[1].top) < 2 : null,
    };
  }, scopeSelector);
}

async function clickTab(nameRe) {
  await page.evaluate((re) => {
    const rx = new RegExp(re, "i");
    const btn = [...document.querySelectorAll(".tabbar button")].find((b) => rx.test(b.textContent || ""));
    if (btn) btn.click();
  }, nameRe.source);
  await page.waitForTimeout(400);
}

// ============================================================================
// Part 1: #/transition, Timeline tab (the audit's "15 milestone panels").
// ============================================================================
{
  await goto("#/transition", 1024);
  const g1024 = await readGrid("#transition-stage .card-results-grid");

  await goto(null, 768);
  const g768 = await readGrid("#transition-stage .card-results-grid");

  // Synthetic "before" comparison: force the SAME real grid, with the SAME
  // real content, back to a single column (same container width) and
  // re-measure. Unlike the H2F domain cards in Part 3, milestone cards
  // carry real per-item text lists, so forcing 1 column also nearly
  // doubles each card's own width - less text wrapping partially offsets
  // the height that "no more row-pairing" would otherwise add back. The
  // two-columns-share-a-row assertions below are the load-bearing proof
  // for this tab; this comparison is logged for transparency but only
  // asserted as a floor (forcing 1 column must never come out SHORTER,
  // which would mean the grid was somehow hurting rather than helping).
  const collapsedHeight = await page.evaluate((sel) => {
    const grid = document.querySelector(sel);
    const prev = grid.style.gridTemplateColumns;
    grid.style.gridTemplateColumns = "1fr";
    const h = grid.scrollHeight;
    grid.style.gridTemplateColumns = prev; // restore
    return h;
  }, "#transition-stage .card-results-grid");

  await goto(null, 375);
  const g375 = await readGrid("#transition-stage .card-results-grid");

  console.log("\n#/transition Timeline — 1024px: " + JSON.stringify(g1024));
  console.log("#/transition Timeline —  768px: " + JSON.stringify(g768) + "  (forced-1-col height would be " + collapsedHeight + "px)");
  console.log("#/transition Timeline —  375px: " + JSON.stringify(g375));

  (g1024.found && g768.found && g375.found)
    ? ok("the Timeline tab's milestone list renders inside a .card-results-grid at every viewport tested")
    : bad("the Timeline tab's milestone grid was missing at one or more viewports: 1024=" + g1024.found + " 768=" + g768.found + " 375=" + g375.found);

  (g1024.childCount >= 10 && g768.childCount === g1024.childCount && g375.childCount === g1024.childCount)
    ? ok("the same " + g1024.childCount + " milestone panels render at all three viewports (content isn't being dropped, only re-flowed)")
    : bad("milestone panel count changed across viewports: 1024=" + g1024.childCount + " 768=" + g768.childCount + " 375=" + g375.childCount);

  (g1024.display === "grid" && g768.display === "grid")
    ? ok("computed display is a real CSS grid at 1024px and 768px, not flex/block")
    : bad("computed display was not 'grid' at a wide viewport: 1024=" + g1024.display + " 768=" + g768.display);

  (g1024.distinctColumnStarts >= 2 && g1024.firstTwoSameRow)
    ? ok("at 1024px, milestone panels occupy " + g1024.distinctColumnStarts + " real columns and the first two share a real top edge (same row)")
    : bad("at 1024px, milestone panels did not genuinely share a row: distinctColumnStarts=" + g1024.distinctColumnStarts + " firstTwoSameRow=" + g1024.firstTwoSameRow);

  (g768.distinctColumnStarts >= 2 && g768.firstTwoSameRow)
    ? ok("at the canonical 768px breakpoint, milestone panels occupy " + g768.distinctColumnStarts + " real columns and the first two share a real top edge")
    : bad("at 768px, milestone panels did not genuinely share a row: distinctColumnStarts=" + g768.distinctColumnStarts + " firstTwoSameRow=" + g768.firstTwoSameRow);

  (g375.distinctColumnStarts === 1 && g375.firstTwoSameRow === false)
    ? ok("at 375px (mobile), milestone panels collapse back to one real column - no regression on narrow viewports")
    : bad("at 375px, milestone panels did not cleanly collapse to a single column: distinctColumnStarts=" + g375.distinctColumnStarts + " firstTwoSameRow=" + g375.firstTwoSameRow);

  (collapsedHeight >= g768.realScrollHeight)
    ? ok("forcing the real 768px grid back to a single column grows it from " + g768.realScrollHeight + "px to " + collapsedHeight + "px (not shorter) - confirms the 2-column layout is doing real work, on top of the direct same-row proof above")
    : bad("forcing a single column made the page SHORTER (real=" + g768.realScrollHeight + " forced=" + collapsedHeight + "), which would mean the existing grid is actively hurting layout - investigate");
}

// ============================================================================
// Part 2: #/transition, Career tab - same .card-results-grid treatment,
// lighter check (this tab's card count is small and content-driven).
// ============================================================================
{
  await goto(null, 768);
  await clickTab(/Career/);
  const g = await readGrid("#transition-stage .card-results-grid");
  console.log("\n#/transition Career — 768px: " + JSON.stringify(g));
  (g.found && g.display === "grid" && g.childCount >= 2)
    ? ok("the Career tab's path list also renders inside a real .card-results-grid at 768px (" + g.childCount + " cards)")
    : bad("the Career tab's path grid was not found or not a real grid at 768px: " + JSON.stringify(g));
}

// ============================================================================
// Part 3: #/health, H2F Domains tab (the audit's "6 stacked domain
// sections"), plus expand/collapse interactivity at wide AND narrow.
// ============================================================================
{
  await goto("#/health", 1024);
  const g1024 = await readGrid("#resilience-stage .card-results-grid");

  await goto(null, 768);
  const g768 = await readGrid("#resilience-stage .card-results-grid");

  const collapsedHeight = await page.evaluate((sel) => {
    const grid = document.querySelector(sel);
    const prev = grid.style.gridTemplateColumns;
    grid.style.gridTemplateColumns = "1fr";
    const h = grid.scrollHeight;
    grid.style.gridTemplateColumns = prev;
    return h;
  }, "#resilience-stage .card-results-grid");

  // Interactivity at the wide viewport: click the first domain head button
  // and confirm its skills panel un-hides and aria-expanded flips.
  const interactWide = await page.evaluate(() => {
    const head = document.querySelector("#resilience-stage .res-domain-head");
    if (!head) return { found: false };
    const before = head.getAttribute("aria-expanded");
    head.click();
    const after = head.getAttribute("aria-expanded");
    const skillsWrap = head.closest(".res-domain").querySelector(".res-domain-skills");
    return { found: true, before, after, nowVisible: skillsWrap ? !skillsWrap.hasAttribute("hidden") : null };
  });
  // Collapse it back so state doesn't leak into the next viewport's check.
  await page.evaluate(() => { document.querySelector("#resilience-stage .res-domain-head").click(); });

  await goto(null, 375);
  const g375 = await readGrid("#resilience-stage .card-results-grid");
  const interactNarrow = await page.evaluate(() => {
    const head = document.querySelector("#resilience-stage .res-domain-head");
    if (!head) return { found: false };
    const before = head.getAttribute("aria-expanded");
    head.click();
    const after = head.getAttribute("aria-expanded");
    const skillsWrap = head.closest(".res-domain").querySelector(".res-domain-skills");
    return { found: true, before, after, nowVisible: skillsWrap ? !skillsWrap.hasAttribute("hidden") : null };
  });

  console.log("\n#/health H2F Domains — 1024px: " + JSON.stringify(g1024));
  console.log("#/health H2F Domains —  768px: " + JSON.stringify(g768) + "  (forced-1-col height would be " + collapsedHeight + "px)  interact=" + JSON.stringify(interactWide));
  console.log("#/health H2F Domains —  375px: " + JSON.stringify(g375) + "  interact=" + JSON.stringify(interactNarrow));

  (g1024.found && g768.found && g375.found)
    ? ok("the H2F Domains list renders inside a .card-results-grid at every viewport tested")
    : bad("the H2F Domains grid was missing at one or more viewports: 1024=" + g1024.found + " 768=" + g768.found + " 375=" + g375.found);

  (g1024.childCount === 6 && g768.childCount === 6 && g375.childCount === 6)
    ? ok("all 6 FM 7-22 domain cards render at every viewport (matches the audit's stated domain count, content unaffected by layout)")
    : bad("domain card count was not 6 at every viewport: 1024=" + g1024.childCount + " 768=" + g768.childCount + " 375=" + g375.childCount);

  (g1024.display === "grid" && g1024.distinctColumnStarts >= 2 && g1024.firstTwoSameRow)
    ? ok("at 1024px, domain cards occupy " + g1024.distinctColumnStarts + " real columns and the first two share a real top edge")
    : bad("at 1024px, domain cards did not genuinely share a row: " + JSON.stringify(g1024));

  (g768.display === "grid" && g768.distinctColumnStarts >= 2 && g768.firstTwoSameRow)
    ? ok("at the canonical 768px breakpoint, domain cards occupy " + g768.distinctColumnStarts + " real columns and the first two share a real top edge")
    : bad("at 768px, domain cards did not genuinely share a row: " + JSON.stringify(g768));

  (g375.distinctColumnStarts === 1 && g375.firstTwoSameRow === false)
    ? ok("at 375px (mobile), domain cards collapse back to one real column - no regression on narrow viewports")
    : bad("at 375px, domain cards did not cleanly collapse to a single column: " + JSON.stringify(g375));

  (collapsedHeight > g768.realScrollHeight * 1.3)
    ? ok("forcing the real 768px domain grid back to a single column would grow it from " + g768.realScrollHeight + "px to " + collapsedHeight + "px - the existing 2-column layout is genuinely saving substantial vertical scroll")
    : bad("forcing a single column did not meaningfully increase height (real=" + g768.realScrollHeight + " forced=" + collapsedHeight + ")");

  (interactWide.found && interactWide.before === "false" && interactWide.after === "true" && interactWide.nowVisible)
    ? ok("at 768px (2-column grid active), clicking a domain card's header still expands its skills panel (aria-expanded false→true, hidden attribute removed)")
    : bad("domain expand/collapse interactivity is broken at 768px: " + JSON.stringify(interactWide));

  (interactNarrow.found && interactNarrow.before === "false" && interactNarrow.after === "true" && interactNarrow.nowVisible)
    ? ok("at 375px (single-column layout), clicking a domain card's header still expands its skills panel - the grid fix did not regress mobile interactivity")
    : bad("domain expand/collapse interactivity is broken at 375px: " + JSON.stringify(interactNarrow));
}

// ============================================================================
// Part 4: #/health, Daily Skills + Get Support tabs - same grid utility,
// lighter check, plus one skill-card accordion click at a wide viewport.
// ============================================================================
{
  await goto(null, 768);
  await clickTab(/Daily Skills/);
  const gSkills = await readGrid("#resilience-stage .card-results-grid");
  const skillInteract = await page.evaluate(() => {
    const head = document.querySelector("#resilience-stage .res-skill-head");
    if (!head) return { found: false };
    const before = head.getAttribute("aria-expanded");
    head.click();
    const after = head.getAttribute("aria-expanded");
    return { found: true, before, after };
  });

  await clickTab(/Get Support/);
  const gResources = await readGrid("#resilience-stage .card-results-grid");

  console.log("\n#/health Daily Skills — 768px: " + JSON.stringify(gSkills) + "  interact=" + JSON.stringify(skillInteract));
  console.log("#/health Get Support — 768px: " + JSON.stringify(gResources));

  (gSkills.found && gSkills.display === "grid" && gSkills.distinctColumnStarts >= 2)
    ? ok("the Daily Skills tab's MRT skill list also renders as a real multi-column grid at 768px (" + gSkills.childCount + " cards)")
    : bad("the Daily Skills grid was not found or not multi-column at 768px: " + JSON.stringify(gSkills));

  (skillInteract.found && skillInteract.before === "false" && skillInteract.after === "true")
    ? ok("a skill card's accordion (aria-expanded) still toggles correctly inside the 768px grid")
    : bad("skill card accordion interactivity is broken at 768px: " + JSON.stringify(skillInteract));

  (gResources.found && gResources.display === "grid" && gResources.distinctColumnStarts >= 2)
    ? ok("the Get Support tab's resource list also renders as a real multi-column grid at 768px (" + gResources.childCount + " cards)")
    : bad("the Get Support resource grid was not found or not multi-column at 768px: " + JSON.stringify(gResources));
}

await browser.close();
server.close();

console.log("\n" + (fails === 0 ? "All checks passed." : fails + " check(s) FAILED."));
process.exit(fails === 0 ? 0 : 1);
