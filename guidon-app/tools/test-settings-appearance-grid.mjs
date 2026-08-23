/**
 * Roadmap Tier 5, #/settings route: width-utilization regression coverage.
 *
 * The audit this roadmap item started from claimed "3,584px scroll, 18
 * stacked panels, only one real grid currently exists on the page" and
 * suggested grouping Theme/Accessibility/Motion/Notifications/Data-Backup
 * into a 2-column layout at >=1024px. Re-measured live before touching
 * anything (Playwright, real .main.scrollHeight + real getComputedStyle,
 * not the stale audit numbers): that claim was already out of date. An
 * earlier "Fold5/tablet fidelity wave 2" pass had already wrapped Study
 * Preferences (prefGrid) and Data/Help/About (dataGrid) in the existing
 * .panel-grid-2 utility (600px trigger - see that class's own CSS comment
 * on the Z Fold 5's ~673px unfolded-portrait width), so "only one real
 * grid" was false - real panel count was 15, not 18, and TWO grids already
 * existed. The one genuine remaining gap: the Appearance panel (Theme /
 * Text size / Motion) was still a lone full-width row at every width up to
 * 1500px, and on any platform where G.notify.supported() is false (every
 * non-Android build, including this Playwright suite) the Accessibility &
 * Focus grid's own second column sat permanently empty since Notifications
 * never renders into it there. Fixed by folding the Appearance panel into
 * that same grid (now under one combined "Appearance & Accessibility"
 * zone header, same pattern the pre-existing "Data, Help & About" zone
 * already uses for multiple distinct panels sharing one grid) - reusing
 * .panel-grid-2's existing 600px breakpoint rather than a new one, so this
 * zone behaves consistently with its sibling zones on the same page
 * instead of alone waiting for a wider gate.
 *
 * This file proves that fix with real measurements: the Appearance and
 * Accessibility & Focus panels genuinely share a row at >=1024px (not just
 * "no error was thrown"), the same single-column flow survives untouched
 * at 375px, and representative controls in both merged panels (Text size,
 * Motion, High contrast, the "Turn options on/off" jump link) still work
 * exactly as before the DOM was restructured to join them into one grid.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function openSettings(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
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
  await page.evaluate(() => { location.hash = "#/settings"; });
  await page.waitForTimeout(600);
  return { ctx, page, noise };
}

// ============================================================
// 1) WIDE VIEWPORT (1280px, comfortably above the 1024px the roadmap
//    named and well above the 600px .panel-grid-2 actually triggers at):
//    Appearance and Accessibility & Focus genuinely share a grid row -
//    same top edge, side by side, not stacked - and the zone reads as one
//    combined header rather than two separate single-panel zones.
// ============================================================
{
  const { ctx, page, noise } = await openSettings({ width: 1280, height: 1400 });

  const zoneHeaders = await page.evaluate(() => [...document.querySelectorAll(".settings-zone-h")].map((z) => z.textContent));
  zoneHeaders.includes("Appearance & Accessibility")
    ? ok("Settings has one combined 'Appearance & Accessibility' zone header (Appearance and Accessibility & Interface merged)")
    : bad("zone headers were " + JSON.stringify(zoneHeaders) + ", expected 'Appearance & Accessibility' among them");
  zoneHeaders.includes("Appearance") || zoneHeaders.includes("Accessibility & Interface")
    ? bad("stale separate 'Appearance' or 'Accessibility & Interface' zone header still present: " + JSON.stringify(zoneHeaders))
    : ok("the old separate 'Appearance' / 'Accessibility & Interface' zone headers are gone (merged, not duplicated)");

  const layout = await page.evaluate(() => {
    const header = [...document.querySelectorAll(".settings-zone-h")].find((z) => z.textContent === "Appearance & Accessibility");
    const grid = header ? header.nextElementSibling : null;
    if (!grid || !grid.classList.contains("panel-grid-2")) return null;
    const cs = getComputedStyle(grid);
    const kids = [...grid.children].map((c) => {
      const r = c.getBoundingClientRect();
      const label = c.querySelector("label");
      return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), label: label ? label.textContent : null };
    });
    return { display: cs.display, columns: cs.gridTemplateColumns.split(" ").length, kids };
  });

  layout && layout.display === "grid"
    ? ok(`Appearance & Accessibility grid is real CSS grid at 1280px (display: ${layout && layout.display})`)
    : bad("Appearance & Accessibility zone's first child was not a real CSS grid: " + JSON.stringify(layout));
  layout && layout.columns === 2
    ? ok(`grid genuinely has 2 columns (grid-template-columns resolved to ${layout.columns} tracks)`)
    : bad("grid-template-columns did not resolve to 2 tracks: " + JSON.stringify(layout));
  layout && layout.kids.length >= 2
    ? ok(`grid has ${layout.kids.length} real panel children (Theme/Text size/Motion panel + Accessibility & Focus summary)`)
    : bad("expected at least 2 children in the merged grid, got: " + JSON.stringify(layout));

  if (layout && layout.kids.length >= 2) {
    const [a, b] = layout.kids;
    a.top === b.top
      ? ok(`the Appearance panel ("${a.label}") and Accessibility & Focus panel ("${b.label}") share the exact same row (top=${a.top}px for both) - not stacked`)
      : bad(`panels did NOT share a row: "${a.label}" top=${a.top}px vs "${b.label}" top=${b.top}px`);
    a.left !== b.left
      ? ok(`the two panels sit at different left offsets (${a.left}px vs ${b.left}px) - genuinely side by side, not overlapping`)
      : bad(`both panels had the same left offset (${a.left}px) - not actually side by side`);
    (a.width < 700 && b.width < 700)
      ? ok(`neither panel stretches the old full-container width any more (widths ${a.width}px / ${b.width}px, each roughly half the row)`)
      : bad(`a panel is still full-row width at 1280px: ${a.width}px / ${b.width}px`);
  }

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("wide viewport: no console errors/warnings") : bad(relevantNoise.length + " console msg(s); first: " + relevantNoise[0]);

  await ctx.close();
}

// ============================================================
// 2) NARROW VIEWPORT (375px): the same merge must not break the existing
//    single-column mobile flow - both panels present, stacked (not
//    side by side), full container width each.
// ============================================================
{
  const { ctx, page, noise } = await openSettings({ width: 375, height: 1600 });

  const layout = await page.evaluate(() => {
    const header = [...document.querySelectorAll(".settings-zone-h")].find((z) => z.textContent === "Appearance & Accessibility");
    const grid = header ? header.nextElementSibling : null;
    if (!grid) return null;
    const cs = getComputedStyle(grid);
    const kids = [...grid.children].map((c) => {
      const r = c.getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left) };
    });
    return { display: cs.display, kids };
  });

  layout && layout.display === "block"
    ? ok(`at 375px the merged grid collapses to a single column (display: ${layout && layout.display}, below the 600px .panel-grid-2 trigger)`)
    : bad("grid display at 375px was not 'block': " + JSON.stringify(layout));
  layout && layout.kids.length >= 2 && layout.kids[0].top < layout.kids[1].top && layout.kids[0].left === layout.kids[1].left
    ? ok(`the two panels stack vertically at 375px (top ${layout.kids[0].top}px then ${layout.kids[1].top}px, same left edge ${layout.kids[0].left}px) - no regression from the merge`)
    : bad("panels did not stack correctly at 375px: " + JSON.stringify(layout));

  const relevantNoise = noise.filter((n) => !/favicon/.test(n));
  relevantNoise.length === 0 ? ok("narrow viewport: no console errors/warnings") : bad(relevantNoise.length + " console msg(s); first: " + relevantNoise[0]);

  await ctx.close();
}

// ============================================================
// 3) FUNCTIONAL CHECK: representative controls in both merged panels
//    still work exactly as before, after being moved into the shared
//    grid (proves the DOM restructuring didn't break any listener).
// ============================================================
{
  const { ctx, page } = await openSettings({ width: 1280, height: 1400 });

  // 3a) Text size (lives in the Appearance panel, now accGrid's first child)
  const rootFontBefore = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.getByRole("button", { name: "Large text size", exact: true }).click();
  await page.waitForTimeout(200);
  const rootFontAfter = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  rootFontAfter > rootFontBefore
    ? ok(`Text size 'Large' (Appearance panel, now inside accGrid): <html> font-size grew (${rootFontBefore}px -> ${rootFontAfter}px)`)
    : bad(`Text size 'Large' had no effect after the merge: ${rootFontBefore}px -> ${rootFontAfter}px`);
  await page.getByRole("button", { name: "Standard text size", exact: true }).click();
  await page.waitForTimeout(200);

  // 3b) Motion (also in the Appearance panel). Its optGrid() call carries no
  // groupName, so unlike Text size these buttons get no disambiguating
  // aria-label - the accessible name is "Minimal" + its blurb text
  // concatenated. Scoped by the "Motion" <label> itself (find its following
  // .appearance-grid, click within it) rather than a page-wide name match,
  // which also sidesteps "Standard" existing as both a Text size and a
  // Motion option.
  const motionGrid = page.locator("label", { hasText: "Motion" }).locator("xpath=following-sibling::div[contains(@class,'appearance-grid')][1]");
  const motionBefore = await page.evaluate(() => document.documentElement.getAttribute("data-motion"));
  await motionGrid.locator("button", { hasText: "Minimal" }).click();
  await page.waitForTimeout(200);
  const motionAfter = await page.evaluate(() => document.documentElement.getAttribute("data-motion"));
  motionAfter === "minimal" && motionAfter !== motionBefore
    ? ok(`Motion 'Minimal' (Appearance panel): <html data-motion> changed from "${motionBefore}" to "${motionAfter}"`)
    : bad(`Motion 'Minimal' had no effect after the merge: "${motionBefore}" -> "${motionAfter}"`);
  await motionGrid.locator("button", { hasText: "Standard" }).click();
  await page.waitForTimeout(200);

  // 3c) "Turn options on/off" jump link (Accessibility & Focus summary panel,
  // now accGrid's second child) still opens the Advanced section and moves
  // focus to the real toggle panel.
  const advBtnBefore = await page.getByRole("button", { name: /advanced settings/i }).getAttribute("aria-expanded");
  await page.getByRole("button", { name: "Turn options on/off ▾", exact: true }).click();
  await page.waitForTimeout(300);
  const advBtnAfter = await page.getByRole("button", { name: /advanced settings/i }).getAttribute("aria-expanded");
  (advBtnBefore === "false" && advBtnAfter === "true")
    ? ok("Accessibility & Focus panel's 'Turn options on/off' jump link still opens the Advanced section (aria-expanded false -> true)")
    : bad(`'Turn options on/off' did not open Advanced as expected: aria-expanded ${advBtnBefore} -> ${advBtnAfter}`);
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  focused === "settings-acc-panel"
    ? ok("focus actually landed on #settings-acc-panel (the real toggle panel), not just the button state changing")
    : bad("focus after the jump was on \"" + focused + "\", expected #settings-acc-panel");

  // 3d) High contrast checkbox (inside the now-open advanced panel) still
  // toggles the shared border-width rule (identical assertion to
  // test-settings-toggles.mjs's own coverage - proves the panel this
  // control lives in still functions after accSummary/apPanel moved).
  const borderBefore = await page.evaluate(() => {
    const p = document.querySelector(".panel");
    return p ? getComputedStyle(p).borderWidth : null;
  });
  const hc = page.getByRole("checkbox", { name: "High contrast", exact: true });
  await hc.evaluate((el) => el.click());
  await page.waitForTimeout(200);
  const borderAfter = await page.evaluate(() => {
    const p = document.querySelector(".panel");
    return p ? getComputedStyle(p).borderWidth : null;
  });
  (borderBefore === "1px" && borderAfter === "2px")
    ? ok(`High contrast checkbox (advanced panel) still works after the merge: .panel border-width ${borderBefore} -> ${borderAfter}`)
    : bad(`High contrast checkbox did not behave as expected: ${borderBefore} -> ${borderAfter}`);
  await hc.evaluate((el) => el.click()); // revert
  await page.waitForTimeout(150);

  await ctx.close();
}

await browser.close();
await server.close();

console.log("\n" + (fails ? `SETTINGS APPEARANCE/ACCESSIBILITY GRID: ${fails} FAILURE(S)` : "SETTINGS APPEARANCE/ACCESSIBILITY GRID: all passed"));
process.exit(fails ? 1 : 0);
