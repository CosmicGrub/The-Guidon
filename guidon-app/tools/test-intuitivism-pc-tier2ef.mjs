/**
 * PC/desktop intuitivism pass, Tier 2(e)+(f) - 2026-08-22. Both items live
 * inside the same onboarding wizard rendering code and both explicitly
 * depend on Tier 1(d) (already shipped: .ob-wrap's width tier raised to
 * 720px at >=1024px, up from a 560px cap that applied at every width):
 *
 *   (e) a live-updating onboarding summary panel (.ob-live-summary) shown
 *       alongside step content at >=1024px, filling in as rank, concerns,
 *       and weak points are chosen - instead of the wizard's existing
 *       one-time reveal on the final Summary step (renderSummaryStep,
 *       untouched by this change and not exercised here). Below 1024px
 *       the panel must not exist in the DOM at all, not just be hidden.
 *   (f) WeakPoints' "+12 more" collapse (12 of 19 chips, hidden behind a
 *       toggle to manage a narrow mobile grid's vertical height) now
 *       defaults OPEN at the same >=1024px tier, since a 720px-wide column
 *       has real horizontal room the original 478px-wide mobile grid never
 *       had - still fully collapsible by the user either way, and
 *       unchanged (collapsed by default) below 1024px.
 *
 * Uses the real first-run overlay (like test-onboarding.mjs) rather than
 * seeding a profile directly, since renderOnboarding's live-summary state
 * lives in step-local closures (rank buttons, concern checkboxes, weak-
 * point chips) that only exist once actually walked through.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootOnboarding(viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const noise = [];
  page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).waitFor({ state: "visible", timeout: 8000 });
  return { page, noise };
}

const liveSummaryText = (page) => page.evaluate(() => {
  const el = document.querySelector(".ob-live-summary-body");
  return el ? el.textContent || "" : null;
});

/* ================================================================
   >=1024px: the panel exists from step 0 onward and updates live
   ================================================================ */
{
  const { page, noise } = await bootOnboarding({ width: 1440, height: 900 });

  // Present immediately, even on mode-select (step 0) before any answer exists.
  const presentOnModeStep = await page.locator(".ob-live-summary").count();
  presentOnModeStep === 1
    ? ok("at 1440px, .ob-live-summary is already present on the mode-select step, not deferred until Summary")
    : bad(".ob-live-summary count on mode-select step: " + presentOnModeStep);

  await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).click();
  await page.waitForTimeout(300);

  // Default rank (SPC/E4) shown before any explicit rank click - matches
  // the rank picker's own pre-selected default, not a blank/placeholder.
  let summary = await liveSummaryText(page);
  /SPC/.test(summary || "") && /E4/.test(summary || "")
    ? ok("identity step: panel shows the default rank/tier (SPC / E4) before any rank is explicitly clicked")
    : bad("panel text before rank click: " + JSON.stringify(summary));

  // Rank click does NOT advance the step - panel must update in place.
  await page.locator(".ob-rank-btn", { hasText: /^SSG$/ }).click();
  await page.waitForTimeout(150);
  const stillOnIdentity = await page.evaluate(() => /Who are you/.test(document.body.textContent || ""));
  stillOnIdentity ? ok("clicking a rank chip stays on the identity step (doesn't auto-advance)") : bad("rank click unexpectedly advanced the step");
  summary = await liveSummaryText(page);
  /SSG/.test(summary || "") && /E6/.test(summary || "")
    ? ok("panel updates to the new rank (SSG / E6) immediately after the click, with no step change and no Next/Save")
    : bad("panel text after SSG click: " + JSON.stringify(summary));

  await page.locator("button.ob-next", { hasText: /Next/ }).click(); // identity -> role
  await page.waitForTimeout(200);
  await page.locator("button.ob-next", { hasText: /Next/ }).click(); // role -> concerns
  await page.waitForTimeout(200);

  // Concerns: toggling a checkbox (no navigation) updates the panel live.
  let beforeConcerns = await liveSummaryText(page);
  /None selected yet/.test(beforeConcerns || "")
    ? ok("concerns step: panel shows 'None selected yet' before any concern is checked")
    : bad("panel concerns text before any check: " + JSON.stringify(beforeConcerns));

  await page.locator("label.ob-check-label", { hasText: /Preparing for a promotion board/ }).click();
  await page.waitForTimeout(150);
  let afterOneConcern = await liveSummaryText(page);
  /Preparing for a promotion board/.test(afterOneConcern || "")
    ? ok("checking one concern box (still on the concerns step) updates the panel immediately")
    : bad("panel text after checking one concern: " + JSON.stringify(afterOneConcern));

  await page.locator("label.ob-check-label", { hasText: /AFT \/ physical fitness/ }).click();
  await page.waitForTimeout(150);
  let afterTwoConcerns = await liveSummaryText(page);
  /Preparing for a promotion board/.test(afterTwoConcerns || "") && /AFT \/ physical fitness/.test(afterTwoConcerns || "")
    ? ok("checking a second concern box adds it to the panel too - both selections listed, not just the last one")
    : bad("panel text after checking two concerns: " + JSON.stringify(afterTwoConcerns));

  await page.locator("button", { hasText: /^Next →$/ }).click(); // concerns -> weakpoints
  await page.waitForTimeout(300);

  // ---- Tier 2(f): collapsed groups default OPEN at >=1024px ----
  const weakToggleText = await page.locator("button", { hasText: /more ▾|Show fewer ▴/ }).textContent();
  /Show fewer/.test(weakToggleText || "")
    ? ok(`at 1440px, WeakPoints' "+12 more" toggle starts already-expanded ("${weakToggleText.trim()}"), not collapsed`)
    : bad(`WeakPoints toggle text at 1440px: "${weakToggleText}", expected "Show fewer ▴"`);
  const regsGroupVisible = await page.locator("p.ob-subgroup-label", { hasText: /Regulations & Safety/ }).isVisible();
  const fieldGroupVisible = await page.locator("p.ob-subgroup-label", { hasText: /Field & Technical Skills/ }).isVisible();
  regsGroupVisible && fieldGroupVisible
    ? ok("at 1440px, both normally-collapsed sub-groups (Regulations & Safety, Field & Technical Skills) are visible by default")
    : bad(`sub-group visibility at 1440px: Regulations & Safety=${regsGroupVisible}, Field & Technical Skills=${fieldGroupVisible}`);

  // Capability unchanged: the user can still manually collapse it.
  await page.locator("button", { hasText: /Show fewer ▴/ }).click();
  await page.waitForTimeout(150);
  const collapsedAfterManualClick = await page.locator("p.ob-subgroup-label", { hasText: /Regulations & Safety/ }).isVisible();
  collapsedAfterManualClick === false
    ? ok("a user can still manually collapse the un-collapsed groups at 1440px - the capability wasn't removed, only the default flipped")
    : bad("clicking 'Show fewer' at 1440px did not actually collapse the groups");
  // ...and re-expand again.
  await page.locator("button", { hasText: /more ▾/ }).click();
  await page.waitForTimeout(150);
  const reExpanded = await page.locator("p.ob-subgroup-label", { hasText: /Regulations & Safety/ }).isVisible();
  reExpanded
    ? ok("re-clicking the toggle re-expands the groups again - full round-trip capability intact")
    : bad("re-clicking the toggle did not re-expand the groups");

  // Weak-point chip toggle (no navigation) updates the panel live, from
  // BOTH the always-visible Foundations grid and a chip inside a group
  // that Tier 2(f) itself just un-collapsed.
  await page.locator("button.ob-weak-btn", { hasText: /^Army Values/ }).click(); // Foundations (always visible)
  await page.waitForTimeout(100);
  await page.locator("button.ob-weak-btn", { hasText: "Supply / Property Accountability" }).click(); // Regulations & Safety
  await page.waitForTimeout(150);
  const afterWeakPoints = await liveSummaryText(page);
  /Army Values/.test(afterWeakPoints || "") && /Supply \/ Property Accountability/.test(afterWeakPoints || "")
    ? ok("toggling weak-point chips (still on the weakpoints step) updates the panel immediately, including a chip from an un-collapsed group")
    : bad("panel text after weak-point chip clicks: " + JSON.stringify(afterWeakPoints));

  // Un-check one and confirm the panel drops it (genuinely reflects live
  // state, not just accumulating everything ever clicked).
  await page.locator("button.ob-weak-btn", { hasText: /^Army Values/ }).click(); // toggle back off
  await page.waitForTimeout(150);
  const afterUncheck = await liveSummaryText(page);
  !/Army Values/.test(afterUncheck || "") && /Supply \/ Property Accountability/.test(afterUncheck || "")
    ? ok("un-checking a weak-point chip removes it from the panel immediately, while the still-checked one remains")
    : bad("panel text after un-checking Army Values: " + JSON.stringify(afterUncheck));

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (>=1024px live-panel + un-collapse checks)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await page.close();
}

/* ================================================================
   <1024px: panel must not exist at all; WeakPoints stays collapsed
   ================================================================ */
{
  const { page, noise } = await bootOnboarding({ width: 1023, height: 900 });

  const presentOnModeStep = await page.locator(".ob-live-summary").count();
  presentOnModeStep === 0
    ? ok("at 1023px, .ob-live-summary does not exist on the mode-select step")
    : bad(".ob-live-summary count on mode-select step at 1023px: " + presentOnModeStep);
  const layoutPresent = await page.locator(".ob-live-layout").count();
  layoutPresent === 0
    ? ok("at 1023px, .ob-live-layout is never created either - no dead wrapper node left behind")
    : bad(".ob-live-layout count at 1023px: " + layoutPresent);

  await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).click();
  await page.waitForTimeout(200);
  await page.locator(".ob-rank-btn", { hasText: /^SSG$/ }).click();
  await page.waitForTimeout(150);
  const stillAbsentAfterInteraction = await page.locator(".ob-live-summary").count();
  stillAbsentAfterInteraction === 0
    ? ok("at 1023px, choosing a rank still does not conjure a live-summary panel into existence")
    : bad(".ob-live-summary count after a rank click at 1023px: " + stillAbsentAfterInteraction);

  await page.locator("button.ob-next", { hasText: /Next/ }).click(); // identity -> role
  await page.waitForTimeout(200);
  await page.locator("button.ob-next", { hasText: /Next/ }).click(); // role -> concerns
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: /^Next →$/ }).click(); // concerns -> weakpoints
  await page.waitForTimeout(300);

  const weakToggleTextNarrow = await page.locator("button", { hasText: /more ▾|Show fewer ▴/ }).textContent();
  /\+12 more ▾/.test(weakToggleTextNarrow || "")
    ? ok(`at 1023px, WeakPoints' collapse toggle is unchanged from before this pass ("${weakToggleTextNarrow.trim()}")`)
    : bad(`WeakPoints toggle text at 1023px: "${weakToggleTextNarrow}", expected "+12 more ▾"`);
  const regsGroupVisibleNarrow = await page.locator("p.ob-subgroup-label", { hasText: /Regulations & Safety/ }).isVisible();
  regsGroupVisibleNarrow === false
    ? ok("at 1023px, the Regulations & Safety sub-group stays collapsed by default (unchanged mobile/tablet behavior)")
    : bad("Regulations & Safety group is visible by default at 1023px, expected collapsed");

  // Capability still there below the tier too - just off by default.
  await page.locator("button", { hasText: /\+12 more ▾/ }).click();
  await page.waitForTimeout(150);
  const expandedManuallyNarrow = await page.locator("p.ob-subgroup-label", { hasText: /Regulations & Safety/ }).isVisible();
  expandedManuallyNarrow
    ? ok("at 1023px, the user can still manually expand the collapsed groups - the toggle itself is untouched by Tier 2(f)")
    : bad("manually clicking '+12 more' at 1023px did not expand the groups");

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("no console errors/warnings (<1024px absence checks)") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `INTUITIVISM PC TIER 2(e)+(f): ${fails} FAILURE(S)` : "INTUITIVISM PC TIER 2(e)+(f): all passed"));
process.exit(fails ? 1 : 0);
