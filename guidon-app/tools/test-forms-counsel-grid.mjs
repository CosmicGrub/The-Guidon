/**
 * Roadmap Tier 5 width-waste audit: #/forms (picker only) + #/counsel
 * (Examples tab only).
 *
 * Verified against the real, current page before touching anything (per the
 * roadmap's own warning that "current cost" figures in these audits go
 * stale):
 *
 *  - #/forms's top-level picker list was ALREADY a real CSS grid (the shared
 *    `.grid` utility, `repeat(auto-fill, minmax(240px,1fr))`, unconditional -
 *    no media query gate needed since auto-fill collapses to one column on
 *    its own at narrow widths). Measured 1/2/3/3 columns at 375/768/1024/
 *    1200px. Nothing was changed here; this file only proves that stays true
 *    and that the (correct, out-of-scope) fill-in view is untouched.
 *
 *  - #/counsel's Examples tab was genuinely broken: `.counsel-examples` had
 *    no grid at all (`display:block`), so its 30 rendered accordion cards
 *    stacked one full-width card per row at EVERY width - a real measured
 *    container scrollHeight of 1655px, IDENTICAL at 768/1024/1200px, proving
 *    zero of the extra width was used. Fixed by wiring the existing shared
 *    `.card-results-grid` utility (same one Resources/Dictionary/Train's
 *    course grid already use) onto `.counsel-examples`, and swapping the
 *    category-divider markup from an inline-styled `p.hint` to the
 *    `.curr-group-label` class that utility already knows how to span full-
 *    width (matches the course grid's own group-separator convention, see
 *    js/train.js's courseGrid). After the fix: 375px stays 1 column, but
 *    768px/1024px/1200px now use 2/2/3 columns with real scrollHeight
 *    1273/1255/919px - a genuine, measured improvement, not just "doesn't
 *    throw".
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function openGuestSession(page) {
  const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guestCard.count()) {
    await guestCard.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

async function newPageAt(width, hash) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await ctx.newPage();
  const noise = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(600);
  await openGuestSession(page);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(600);
  return { ctx, page, noise };
}

// Real "cards share a row" measurement: group bounding-rect tops, the widest
// group is the real column count actually rendered at this viewport - not a
// computed-style guess.
async function gridShape(page, cardSelector) {
  return page.evaluate((sel) => {
    const cards = Array.from(document.querySelectorAll(sel));
    const rowsByTop = {};
    cards.forEach((c) => { const t = Math.round(c.getBoundingClientRect().top); rowsByTop[t] = (rowsByTop[t] || 0) + 1; });
    return { cardCount: cards.length, maxPerRow: Math.max(0, ...Object.values(rowsByTop)) };
  }, cardSelector);
}

/* ============================== #/forms ============================== */
{
  // ---- 375px: stays a clean single column (no regression at mobile) ----
  {
    const { ctx, page, noise } = await newPageAt(375, "#/forms");
    const shape = await gridShape(page, ".form-card");
    shape.cardCount > 1 && shape.maxPerRow === 1
      ? ok(`#/forms @375px: ${shape.cardCount} cards, all single-column (maxPerRow=1) - correct for a phone width`)
      : bad(`#/forms @375px: unexpected shape ${JSON.stringify(shape)}`);
    noise.length === 0 ? ok("#/forms @375px: no console errors/warnings") : bad("#/forms @375px console: " + noise[0]);
    await ctx.close();
  }

  // ---- 768px (canonical breakpoint): real multi-column grid, already-working ----
  {
    const { ctx, page, noise } = await newPageAt(768, "#/forms");
    const shape = await gridShape(page, ".form-card");
    shape.maxPerRow >= 2
      ? ok(`#/forms @768px: ${shape.maxPerRow} cards genuinely share a row (same real top edge) - picker already grids, confirmed unchanged`)
      : bad(`#/forms @768px: still single-column, maxPerRow=${shape.maxPerRow} - picker grid regressed`);

    const gridInfo = await page.evaluate(() => {
      const g = document.querySelector(".forms-view .grid");
      const cs = g ? getComputedStyle(g) : null;
      return { display: cs && cs.display, cols: cs && cs.gridTemplateColumns.split(" ").length };
    });
    gridInfo.display === "grid" && gridInfo.cols >= 2
      ? ok(`#/forms @768px: .forms-view .grid computed style is a real ${gridInfo.cols}-column grid`)
      : bad("#/forms @768px: computed grid style " + JSON.stringify(gridInfo));

    // ---- real interactivity: search still narrows the picker ----
    await page.fill('input[aria-label="Search forms"]', "authority for leave");
    await page.waitForTimeout(300);
    const afterSearch = await page.evaluate(() => ({
      cards: document.querySelectorAll(".form-card").length,
      title: document.querySelector(".form-title")?.textContent,
    }));
    afterSearch.cards === 1 && afterSearch.title === "Request and Authority for Leave"
      ? ok("#/forms @768px: search still narrows to the real single DA Form 31 match")
      : bad("#/forms @768px: search result " + JSON.stringify(afterSearch));

    // ---- real interactivity: the (untouched, out-of-scope) fill-in view still opens and works ----
    await page.locator(".form-card").first().click();
    await page.waitForTimeout(300);
    const detail = await page.evaluate(() => ({
      sectionTitle: document.querySelector(".forms-view .section-title")?.textContent,
      tabs: Array.from(document.querySelectorAll(".segmented button")).map((b) => b.textContent),
    }));
    detail.sectionTitle === "DA Form 31  —  Request and Authority for Leave"
      ? ok("#/forms @768px: clicking a picker card still opens the real fill-in detail view, untouched")
      : bad("#/forms @768px: detail section title " + JSON.stringify(detail.sectionTitle));
    JSON.stringify(detail.tabs) === JSON.stringify(["Guided", "Form", "Fill", "Check"])
      ? ok("#/forms @768px: fill-in view's tab bar (Guided/Form/Fill/Check) is exactly as before")
      : bad("#/forms @768px: fill-in view tabs " + JSON.stringify(detail.tabs));

    await page.locator(".segmented button", { hasText: /^Fill$/ }).click();
    await page.waitForTimeout(200);
    const MARK = "GRID-REGRESSION-CHECK " + Date.now();
    await page.fill('.field[data-fid="name"] input.in', MARK);
    const liveVal = await page.evaluate(() => document.querySelector('.field[data-fid="name"] input.in')?.value);
    liveVal === MARK
      ? ok("#/forms @768px: fill-in view's Fill tab still accepts real typed input (unaffected by the picker's grid class)")
      : bad("#/forms @768px: fill-in Fill-tab input value " + JSON.stringify(liveVal));

    noise.length === 0 ? ok("#/forms @768px: no console errors/warnings") : bad("#/forms @768px console: " + noise[0]);
    await ctx.close();
  }
}

/* ============================= #/counsel ============================== */
async function openExamplesTab(page) {
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll(".tabbar button")).find((x) => /Examples/i.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(400);
}

{
  // ---- 375px: stays a clean single column (no regression at mobile) ----
  {
    const { ctx, page, noise } = await newPageAt(375, "#/counsel");
    await openExamplesTab(page);
    const shape = await gridShape(page, ".counsel-examples .skill-card");
    shape.cardCount > 1 && shape.maxPerRow === 1
      ? ok(`#/counsel Examples @375px: ${shape.cardCount} cards, all single-column (maxPerRow=1)`)
      : bad(`#/counsel Examples @375px: unexpected shape ${JSON.stringify(shape)}`);
    noise.length === 0 ? ok("#/counsel Examples @375px: no console errors/warnings") : bad("#/counsel Examples @375px console: " + noise[0]);
    await ctx.close();
  }

  // ---- 768px (canonical breakpoint): the real fix - genuinely grids now ----
  {
    const { ctx, page, noise } = await newPageAt(768, "#/counsel");
    await openExamplesTab(page);

    const before = await page.evaluate(() => document.querySelector(".counsel-examples")?.scrollHeight);
    const shape = await gridShape(page, ".counsel-examples .skill-card");
    shape.maxPerRow >= 2
      ? ok(`#/counsel Examples @768px: ${shape.maxPerRow} cards genuinely share a row (same real top edge) - was maxPerRow=1 (bare stacked list) before this fix`)
      : bad(`#/counsel Examples @768px: still single-column, maxPerRow=${shape.maxPerRow} - fix did not take`);

    const gridInfo = await page.evaluate(() => {
      const g = document.querySelector(".counsel-examples");
      const cs = g ? getComputedStyle(g) : null;
      return { display: cs && cs.display, cols: cs && cs.gridTemplateColumns.split(" ").length, scrollHeight: g && g.scrollHeight };
    });
    gridInfo.display === "grid" && gridInfo.cols >= 2
      ? ok(`#/counsel Examples @768px: .counsel-examples computed style is a real ${gridInfo.cols}-column grid (was display:block before)`)
      : bad("#/counsel Examples @768px: computed grid style " + JSON.stringify(gridInfo));
    // Real measured height drop vs the pre-fix baseline (1655px, identical at
    // every width >=768px per this file's header comment) - not a mock.
    gridInfo.scrollHeight < 1655
      ? ok(`#/counsel Examples @768px: real container scrollHeight ${gridInfo.scrollHeight}px, down from the pre-fix 1655px baseline`)
      : bad(`#/counsel Examples @768px: scrollHeight ${gridInfo.scrollHeight}px did not improve on the 1655px baseline`);

    // ---- category dividers span the full row, not squeezed into one column ----
    const groupLabelSpan = await page.evaluate(() => {
      const g = document.querySelector(".counsel-examples");
      const lbl = g ? g.querySelector(".curr-group-label") : null;
      if (!g || !lbl) return null;
      const gw = g.getBoundingClientRect().width, lw = lbl.getBoundingClientRect().width;
      return lw / gw;
    });
    groupLabelSpan !== null && groupLabelSpan > 0.9
      ? ok(`#/counsel Examples @768px: category divider (.curr-group-label) spans the full grid width (${(groupLabelSpan*100).toFixed(0)}%), not one narrow column`)
      : bad("#/counsel Examples @768px: category divider span ratio " + groupLabelSpan);

    // ---- real interactivity: search still narrows Examples, e.g. "DUI" ----
    await page.fill('input[aria-label="Search counseling examples"]', "DUI");
    await page.waitForTimeout(300);
    const afterSearch = await page.evaluate(() => document.querySelectorAll(".counsel-examples .skill-card").length);
    afterSearch === 2
      ? ok("#/counsel Examples @768px: searching 'DUI' narrows to the real 2 matching examples")
      : bad("#/counsel Examples @768px: 'DUI' search matched " + afterSearch + " cards (expected 2)");

    // ---- real interactivity: accordion expand/collapse still works ----
    const head = page.locator(".counsel-examples .skill-head").first();
    await head.click();
    await page.waitForTimeout(150);
    const expanded = await page.evaluate(() => {
      const b = document.querySelector(".counsel-examples .skill-body");
      return b ? !b.hasAttribute("hidden") : null;
    });
    expanded === true
      ? ok("#/counsel Examples @768px: clicking an example's header still expands its accordion body")
      : bad("#/counsel Examples @768px: accordion expand state " + expanded);

    // ---- real zero-result empty state spans the full row too ----
    await page.fill('input[aria-label="Search counseling examples"]', "zzzznonexistentxyz");
    await page.waitForTimeout(300);
    const emptySpan = await page.evaluate(() => {
      const g = document.querySelector(".counsel-examples");
      const e = g ? g.querySelector(".empty-state") : null;
      if (!g || !e) return null;
      return e.getBoundingClientRect().width / g.getBoundingClientRect().width;
    });
    emptySpan !== null && emptySpan > 0.9
      ? ok(`#/counsel Examples @768px: zero-result empty state spans the full grid width (${(emptySpan*100).toFixed(0)}%), not squeezed into one column`)
      : bad("#/counsel Examples @768px: empty-state span ratio " + emptySpan);

    noise.length === 0 ? ok("#/counsel Examples @768px: no console errors/warnings") : bad("#/counsel Examples @768px console: " + noise[0]);
    await ctx.close();
  }

  // ---- 1024px: further widens to 3 columns, real measured improvement ----
  {
    const { ctx, page, noise } = await newPageAt(1200, "#/counsel");
    await openExamplesTab(page);
    const shape = await gridShape(page, ".counsel-examples .skill-card");
    shape.maxPerRow >= 3
      ? ok(`#/counsel Examples @1200px: widens further to ${shape.maxPerRow} columns sharing a row`)
      : bad(`#/counsel Examples @1200px: only ${shape.maxPerRow} columns, expected wider use of the extra width`);
    noise.length === 0 ? ok("#/counsel Examples @1200px: no console errors/warnings") : bad("#/counsel Examples @1200px console: " + noise[0]);
    await ctx.close();
  }
}

await browser.close();
server.close();
console.log("\n" + (fails ? `FORMS+COUNSEL GRID: ${fails} FAILURE(S)` : "FORMS+COUNSEL GRID: all passed"));
process.exit(fails ? 1 : 0);
