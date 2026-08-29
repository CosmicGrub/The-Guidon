/**
 * Board Drill "Skip to flashcard" bypass link (WCAG 2.4.1 Bypass Blocks).
 *
 * Below .drill-layout's 1024px split breakpoint, catList's ~79-99 category
 * rows sit BEFORE the flashcard (cardWrap) in DOM order - a keyboard-only or
 * linear-navigation screen-reader user previously had to Tab through every
 * row before ever reaching the card. PR #79's flex `order` visual reorder
 * fixed the VISUAL stacking (card first, list second) but deliberately left
 * DOM/tab order untouched, so the gap remained for keyboard/AT users. This
 * adds a standard skip link - the first focusable thing in .drill-layout,
 * invisible until it receives focus - that jumps straight to cardWrap.
 *
 * Deliberately additive-only: does not change catList's own tab order or
 * arrow-key nav (see the regression-guard section below, which reuses the
 * same shape tools/test-list-nav-tier2d.mjs already exercises for catList),
 * and does not touch any of the other 7 .list-detail-row routes.
 *
 * Focus technique for "becomes visible when it receives real keyboard
 * focus": a genuine `page.keyboard.press("Shift+Tab")` FROM catList's own
 * row 0 (rather than counting Tab presses from page load, which is brittle
 * to unrelated Tab-order changes elsewhere in the app - see
 * test-focus-rings-list-detail.mjs's own comment on why it avoids that same
 * trap) - this only asserts the LOCAL relationship "the skip link is the
 * immediately-preceding focusable sibling of catList's first row", which is
 * exactly the claim this feature makes, and is real keyboard-modality focus
 * (not a programmatic .focus() call), so Chromium's own :focus-visible
 * heuristic reflects genuine keyboard use.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootTo(hash, viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(1000);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(1000);
  return { page, noise };
}

function reportNoise(noise, label) {
  const relevant = noise.filter((n) => !/favicon/.test(n));
  relevant.length === 0
    ? ok(`${label}: no console errors/warnings`)
    : bad(`${label}: console noise: ` + relevant.slice(0, 5).join(" | "));
}

/* ============== stacked (<1024px) layout: the case this feature targets ============== */
// 800x1200 matches test-board-drill-dynamic.mjs's own stacked-layout viewport
// - narrower than .drill-layout's 1024px split breakpoint, so catList stacks
// above drillDetail in the flex `order` sense (visually) while remaining
// BEFORE it in DOM/tab order (unchanged) - the exact scenario this link
// exists for.
{
  const VIEWPORT = { width: 800, height: 1200 };
  const { page, noise } = await bootTo("#/board", VIEWPORT);

  await page.waitForFunction(
    () => document.querySelectorAll(".drill-layout .list-detail-list .list-detail-row").length > 1,
    { timeout: 5000 }
  ).catch(() => {});

  // Spy on scrollIntoView before any interaction, matching
  // test-board-drill-dynamic.mjs's own technique, so the skip link's own
  // handler firing it can be confirmed later rather than assumed.
  await page.evaluate(() => {
    window.__scrollCalls = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (opts) {
      window.__scrollCalls.push({ tag: this.tagName, cls: this.className, opts });
      return orig.call(this, opts);
    };
  });

  /* ---- exists, placed as a SIBLING before catList, not nested inside it ---- */
  const placement = await page.evaluate(() => {
    const layout = document.querySelector(".drill-layout");
    const link = layout ? layout.querySelector(":scope > .skip-link") : null;
    const catList = layout ? layout.querySelector(":scope > .list-detail-list") : null;
    return {
      linkFound: !!link,
      linkTag: link ? link.tagName : null,
      linkText: link ? link.textContent.trim() : null,
      nestedInListbox: !!(link && link.closest('[role="listbox"]')),
      linkBeforeCatList: !!(link && catList &&
        (link.compareDocumentPosition(catList) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
    };
  });

  placement.linkFound ? ok("skip link exists in .drill-layout") : bad("skip link not found in .drill-layout");
  placement.linkTag === "BUTTON"
    ? ok("skip link is a real <button> (not an <a href> - see file header on why: this SPA's router treats the whole location.hash as the route)")
    : bad(`skip link tag: expected BUTTON, got "${placement.linkTag}"`);
  placement.linkText === "Skip to flashcard"
    ? ok(`skip link's accessible text reads "${placement.linkText}"`)
    : bad(`skip link text: expected "Skip to flashcard", got "${placement.linkText}"`);
  !placement.nestedInListbox
    ? ok("skip link is NOT nested inside catList's role=\"listbox\" container (a sibling, not a fake option)")
    : bad("skip link is nested inside the role=\"listbox\" container - should be a sibling before it");
  placement.linkBeforeCatList
    ? ok("skip link sits BEFORE catList in DOM order (first focusable thing in .drill-layout)")
    : bad("skip link does not precede catList in DOM order");

  /* ---- not visible/positioned on-screen by default ---- */
  const offscreen = await page.evaluate(() => {
    const link = document.querySelector(".drill-layout > .skip-link");
    const r = link.getBoundingClientRect();
    return { left: r.left, right: r.right };
  });
  offscreen.right < 0
    ? ok(`skip link sits off-screen by default (rect.right = ${offscreen.right})`)
    : bad(`skip link is on-screen without focus (rect: left=${offscreen.left}, right=${offscreen.right})`);

  /* ---- becomes visible on REAL keyboard focus (Shift+Tab from catList row 0) ---- */
  await page.evaluate(() => {
    document.querySelector(".drill-layout .list-detail-list .list-detail-row").focus();
  });
  await page.keyboard.press("Shift+Tab");
  const focused = await page.evaluate(() => {
    const link = document.querySelector(".drill-layout > .skip-link");
    const r = link.getBoundingClientRect();
    return {
      isActive: document.activeElement === link,
      focusVisible: link.matches(":focus-visible"),
      left: r.left,
      right: r.right,
    };
  });
  focused.isActive
    ? ok("Shift+Tab from catList's row 0 moves focus to the skip link (immediately-preceding focusable sibling)")
    : bad("Shift+Tab from catList's row 0 did not land on the skip link");
  focused.focusVisible
    ? ok("a real keyboard Tab into the skip link sets genuine :focus-visible state")
    : bad("skip link did not report :focus-visible after a real Tab-key focus");
  focused.left >= 0 && focused.right > 0
    ? ok(`focused skip link is positioned on-screen (rect: left=${focused.left}, right=${focused.right})`)
    : bad(`focused skip link is still off-screen (rect: left=${focused.left}, right=${focused.right})`);

  /* ---- Tab forward again returns to catList row 0 - the skip link doesn't swallow subsequent Tab stops or reorder catList ---- */
  await page.keyboard.press("Tab");
  const backOnRow0 = await page.evaluate(() => {
    const row0 = document.querySelector(".drill-layout .list-detail-list .list-detail-row");
    return document.activeElement === row0;
  });
  backOnRow0
    ? ok("Tab forward from the skip link returns to catList's own row 0 - existing tab order after it is undisturbed")
    : bad("Tab forward from the skip link did not land back on catList row 0");

  /* ---- activating it (Enter) moves focus to cardWrap and reuses the same scrollIntoView call catList's own row clicks use ---- */
  await page.evaluate(() => document.querySelector(".drill-layout > .skip-link").focus());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const activated = await page.evaluate(() => {
    const cardWrap = document.querySelector(".qz-wrap");
    const calls = window.__scrollCalls || [];
    return {
      activeIsCardWrap: !!cardWrap && (document.activeElement === cardWrap || cardWrap.contains(document.activeElement)),
      scrolledCardWrap: calls.some((c) => (c.cls || "").split(" ").includes("qz-wrap")),
    };
  });
  activated.activeIsCardWrap
    ? ok("activating the skip link (Enter) moves focus to cardWrap")
    : bad("activating the skip link did not move focus to cardWrap");
  activated.scrolledCardWrap
    ? ok("activating the skip link calls cardWrap.scrollIntoView() - the same mechanism catList's own row clicks use")
    : bad("activating the skip link did not call scrollIntoView on cardWrap");

  /* ---- regression guard: catList's own tab order / arrow-key nav is untouched ---- */
  // Deliberately abbreviated - tools/test-list-nav-tier2d.mjs already fully
  // covers catList's arrow-key nav at a wide (1440x900) viewport. This is a
  // narrow, targeted check that the two features coexist at THIS (narrow)
  // viewport without one disturbing the other, not a duplicate of that suite.
  const labels = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".drill-layout .list-detail-list .list-detail-row")];
    rows[0].focus();
    return rows.slice(0, 2).map((r) => r.querySelector(".ldr-name")?.textContent || "");
  });
  await page.keyboard.press("ArrowDown");
  const afterArrowDown = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
  afterArrowDown === labels[1]
    ? ok(`catList's ArrowDown row-to-row nav still works unchanged (row 0 "${labels[0]}" -> row 1 "${afterArrowDown}")`)
    : bad(`catList's ArrowDown regressed: expected row 1 ("${labels[1]}"), got "${afterArrowDown}"`);
  await page.keyboard.press("ArrowUp");
  const afterArrowUp = await page.evaluate(() => document.activeElement?.querySelector(".ldr-name")?.textContent || "");
  afterArrowUp === labels[0]
    ? ok("catList's ArrowUp row-to-row nav still works unchanged")
    : bad(`catList's ArrowUp regressed: expected row 0 ("${labels[0]}"), got "${afterArrowUp}"`);
  const clickStillWorks = await page.evaluate(() => {
    const row = document.querySelectorAll(".drill-layout .list-detail-list .list-detail-row")[0];
    row.click();
    return document.querySelector('select[aria-label="Filter by category"]')?.value === (row.querySelector(".ldr-name")?.textContent || "");
  });
  clickStillWorks
    ? ok("catList's existing click-to-select still works unchanged")
    : bad("catList's click-to-select regressed after adding the skip link");

  /* ---- no unwanted horizontal scroll from the (now off-screen again, post-Enter) skip link ---- */
  const overflowsX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  !overflowsX
    ? ok("no horizontal overflow at 800px stacked width with the skip link present")
    : bad("body overflows horizontally at 800px - the skip link may be adding scroll width");

  reportNoise(noise, "Board Drill skip-to-flashcard (stacked, 800x1200)");
  await page.close();
}

/* ============== split (>=1024px) layout: harmless no-op, doesn't break the grid ============== */
// The link is deliberately always rendered (see src/index.html's own comment
// on skipToCardBtn) rather than gated to <1024px - simplest correct option
// since it's a no-op where the card already sits beside the list. Confirms
// that claim rather than assuming it: the link is `position:absolute` (the
// same .skip-link convention the app-level "Skip to content" link already
// uses), which takes it out of grid placement entirely, so it must not
// consume one of .drill-layout's grid-template-columns tracks.
{
  const VIEWPORT = { width: 1440, height: 900 };
  const { page, noise } = await bootTo("#/board", VIEWPORT);
  await page.waitForFunction(
    () => document.querySelectorAll(".drill-layout .list-detail-list .list-detail-row").length > 1,
    { timeout: 5000 }
  ).catch(() => {});

  const wide = await page.evaluate(() => {
    const layout = document.querySelector(".drill-layout");
    const link = layout.querySelector(":scope > .skip-link");
    const catList = layout.querySelector(":scope > .list-detail-list");
    const cardWrap = document.querySelector(".qz-wrap");
    return {
      display: getComputedStyle(layout).display,
      linkPresent: !!link,
      catListLeftOfCard: catList.getBoundingClientRect().left < cardWrap.getBoundingClientRect().left,
    };
  });
  wide.display === "grid"
    ? ok("'.drill-layout' is still a CSS grid at 1440px with the skip link present")
    : bad(`.drill-layout display: expected "grid", got "${wide.display}"`);
  wide.linkPresent
    ? ok("skip link is still present in the DOM at >=1024px (always-rendered, harmless-when-not-needed choice)")
    : bad("skip link missing at >=1024px");
  wide.catListLeftOfCard
    ? ok("catList still occupies the grid's left column ahead of the card - the absolutely-positioned skip link did not consume a grid track")
    : bad("catList is no longer left of the card - the skip link may have taken a grid column");

  // Activating it here is a harmless no-op destination-wise (the card is
  // already on-screen next to the list), but the handler itself should
  // still run without error and still land focus on cardWrap.
  await page.evaluate(() => document.querySelector(".drill-layout > .skip-link").click());
  await page.waitForTimeout(200);
  const stillFocusesCard = await page.evaluate(() => {
    const cardWrap = document.querySelector(".qz-wrap");
    return document.activeElement === cardWrap || (cardWrap && cardWrap.contains(document.activeElement));
  });
  stillFocusesCard
    ? ok("clicking the skip link at >=1024px still focuses cardWrap (harmless, consistent behavior)")
    : bad("clicking the skip link at >=1024px did not focus cardWrap");

  reportNoise(noise, "Board Drill skip-to-flashcard (split, 1440x900)");
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `BOARD DRILL SKIP-TO-CARD: ${fails} FAILURE(S)` : "BOARD DRILL SKIP-TO-CARD: all passed"));
process.exit(fails ? 1 : 0);
