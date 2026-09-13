/**
 * Nav overhaul Milestone 2: pinned favorites + the phone dock's slots
 * derived from them (docs/design/nav-adaptive-rail.md, as actually
 * implemented - see src/index.html's own comment beside `let navPinned`
 * for the deliberate one-mechanism-not-two scope simplification from the
 * design doc's original two-mechanism sketch).
 *
 * Covers, end to end, with no prior coverage anywhere else:
 *   1. >=600px sidebar: pin/unpin via the star toggle, the "Pinned"
 *      section appearing/disappearing, aria-pressed/aria-label flipping,
 *      real persistence to guidon-nav-pinned-routes, and Home never
 *      getting a pin toggle at all (it can't be pinned/unpinned).
 *   2. <600px-portrait Sections drawer: pinning from INSIDE the drawer
 *      refreshes its own "Pinned" section in place (refreshNavDrawerIfOpen)
 *      without closing the modal or dropping the focus trap.
 *   3. dockSlots() derivation: a fresh install's dock is byte-identical to
 *      the old hardcoded NAV_PRIMARY_MOBILE; pinning backfills slots 2-4
 *      oldest-pin-first; a 4th+ pin never displaces an already-filled slot;
 *      unpinning falls back to the original defaults again, deduped
 *      against whatever's still pinned.
 *   4. Cross-tier consistency: a pin made at sidebar width is reflected in
 *      the dock the moment a resize crosses into the <600px-portrait tier -
 *      one shared navPinned array, not two drifting copies.
 *   5. A real page reload (not just a localStorage.setItem) survives with
 *      both the sidebar's "Pinned" section and the dock's slots intact.
 *   6. (Part 8/9, found live while checking the pin star's own layout)
 *      Two real, pre-existing sidebar-row-consistency bugs unrelated to
 *      pinning itself but discovered in the same pass: the pin star
 *      inheriting width/flex-direction from generic ".nav :is(button, a)"
 *      breakpoint rules with no [data-hash] guard, and a stale v1.2.0
 *      "before there were real group headers" divider rule that made 4
 *      specific routes render 5px taller than every other row for no
 *      reason tied to today's grouping. See each part's own comment.
 *   7. (Part 10, found live on a REAL Z Fold5 after Part 8's own fix
 *      shipped) The Fold-specific ">=800px" compact-rail mirror
 *      (html.device-fold-narrow, ~line 4813) has an extra class prefix
 *      that out-specifies ".nav-item-row > a[data-hash]"'s own
 *      flex:1/min-width:0 protection - the one tier that rule was losing
 *      in. There the link stayed full-width instead of shrinking, so once
 *      the star stopped being crushable (Part 8's fix) the two together
 *      overflowed the row and .nav's own overflow-x:hidden clipped the
 *      star clean off screen: invisible, not overlapping, on the one real
 *      device this whole feature was partly designed around. See
 *      test-fold-narrow-split.mjs for the SM-F946U model-spoof technique
 *      reused here.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];

const readPins = (page) => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("guidon-nav-pinned-routes") || "[]"); } catch (e) { return null; }
});

// ============================================================
// PART 1 — >=600px sidebar: pin/unpin, "Pinned" section, persistence
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[sidebar] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[sidebar] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(700);

  // ---- Home never gets a pin toggle - it's rendered directly by
  // renderGroupsInto's g.label===null branch, no .nav-item-row wrapper. ----
  const homeShape = await page.evaluate(() => {
    const home = document.querySelector('.nav a[data-hash="#/home"]');
    return {
      wrappedInRow: home ? !!home.closest(".nav-item-row") : null,
      hasSiblingPinBtn: home ? !!(home.nextElementSibling && home.nextElementSibling.classList.contains("nav-pin-btn")) : null,
    };
  });
  homeShape.wrappedInRow === false && homeShape.hasSiblingPinBtn === false
    ? ok("Home renders with no .nav-item-row wrapper and no pin toggle - it can't be pinned/unpinned")
    : bad("Home nav-item-row/pin-btn shape: " + JSON.stringify(homeShape));

  // ---- no "Pinned" section on a fresh install ----
  const freshPins = await readPins(page);
  const freshSection = await page.evaluate(() => !!document.querySelector(".nav .nav-pinned-section"));
  JSON.stringify(freshPins) === "[]" && !freshSection
    ? ok('fresh install: guidon-nav-pinned-routes is [] and no "Pinned" section renders')
    : bad(`fresh install pins/section: ${JSON.stringify(freshPins)} / section=${freshSection}`);

  // ---- pin #/progress (Account) via its real star toggle ----
  // Account, not Board Prep: Board Prep gets auto-opened by default on a
  // genuine first-ever visit at >=1200px width (Tier 1(f), src/index.html's
  // own comment beside `const navOpenGroups`), which this exact viewport
  // qualifies for - a click here would CLOSE it, not open it. Account has
  // no such default, so it reliably starts collapsed - same reason
  // test-nav-tier1.mjs's own Part 1 reaches for Account/#/progress rather
  // than Board Prep too.
  await page.locator(".nav .nav-group-header", { hasText: "Account" }).click();
  // 450ms, not 250: the group body's own open transition is .25s (250ms) -
  // a click landing mid-transition can hit the collapsing/expanding body's
  // still-squished bounding box and get intercepted by a sibling header
  // instead (found live while writing this suite; same root cause as the
  // 200ms-vs-.25s false-positive documented on the M1 contrast-verification
  // scripts).
  await page.waitForTimeout(450);
  const progressRow = page.locator('.nav-group-body.open a[data-hash="#/progress"]').locator("xpath=ancestor::div[contains(@class,'nav-item-row')]");
  const pinBtn = progressRow.locator(".nav-pin-btn");
  const beforePin = await pinBtn.getAttribute("aria-pressed");
  await pinBtn.click();
  await page.waitForTimeout(200);

  const afterPin = await page.evaluate(() => {
    const section = document.querySelector(".nav .nav-pinned-section");
    const label = section ? section.querySelector(".nav-pinned-label") : null;
    const pinnedLink = section ? section.querySelector('a[data-hash="#/progress"]') : null;
    const pinnedBtn = section ? section.querySelector(".nav-pin-btn") : null;
    // the ORIGINAL row's own star (inside Account's group body, not the
    // Pinned section) should also now read pinned/aria-pressed=true.
    const originalRowBtn = Array.from(document.querySelectorAll(".nav-group-body .nav-item-row")).find((row) => row.querySelector('a[data-hash="#/progress"]'));
    const originalBtn = originalRowBtn ? originalRowBtn.querySelector(".nav-pin-btn") : null;
    return {
      sectionExists: !!section,
      labelText: label ? label.textContent : null,
      pinnedLinkExists: !!pinnedLink,
      pinnedBtnPressed: pinnedBtn ? pinnedBtn.getAttribute("aria-pressed") : null,
      pinnedBtnPinnedClass: pinnedBtn ? pinnedBtn.classList.contains("pinned") : null,
      pinnedBtnIconTag: pinnedBtn ? (pinnedBtn.querySelector("svg.gi") ? "svg.gi" : (pinnedBtn.firstElementChild ? pinnedBtn.firstElementChild.outerHTML : null)) : null,
      pinnedBtnAriaLabel: pinnedBtn ? pinnedBtn.getAttribute("aria-label") : null,
      originalBtnPressed: originalBtn ? originalBtn.getAttribute("aria-pressed") : null,
      originalBtnPinnedClass: originalBtn ? originalBtn.classList.contains("pinned") : null,
    };
  });
  beforePin === "false" ? ok("Progress's pin toggle starts aria-pressed=false") : bad("Progress's pin toggle initial aria-pressed: " + beforePin);
  afterPin.sectionExists ? ok('clicking the star opens a "Pinned" section in the sidebar') : bad('no "Pinned" section appeared after pinning Progress');
  afterPin.labelText === "Pinned" ? ok('the section carries the "Pinned" label') : bad("Pinned section label text: " + afterPin.labelText);
  afterPin.pinnedLinkExists ? ok("the Pinned section contains a real Progress link (navButton(), not a copy)") : bad("Pinned section has no #/progress link");
  afterPin.pinnedBtnPressed === "true" && afterPin.pinnedBtnPinnedClass
    ? ok("the Pinned section's own star reads aria-pressed=true and carries .pinned")
    : bad("Pinned section star state: " + JSON.stringify(afterPin));
  afterPin.pinnedBtnIconTag === "svg.gi"
    ? ok("the pin toggle renders a real <svg class=\"gi\"> star icon, not a fallback glyph")
    : bad("pin toggle icon child: " + afterPin.pinnedBtnIconTag);
  afterPin.pinnedBtnAriaLabel === "Unpin Progress"
    ? ok('a pinned route\'s star reads aria-label="Unpin <label>"')
    : bad("Pinned section star aria-label: " + afterPin.pinnedBtnAriaLabel);
  afterPin.originalBtnPressed === "true" && afterPin.originalBtnPinnedClass
    ? ok("Progress's ORIGINAL row inside Account also reflects the new pinned state (one shared navPinned array, not a stale copy)")
    : bad("Progress's original-row star state after pinning: " + JSON.stringify(afterPin));

  const pinsAfterPin = await readPins(page);
  JSON.stringify(pinsAfterPin) === JSON.stringify(["#/progress"])
    ? ok("guidon-nav-pinned-routes persists [\"#/progress\"] after the click")
    : bad("guidon-nav-pinned-routes after pinning: " + JSON.stringify(pinsAfterPin));

  // ---- unpin from the Pinned section's own star, confirm it disappears ----
  await page.locator(".nav .nav-pinned-section .nav-pin-btn").click();
  await page.waitForTimeout(200);
  const afterUnpin = await page.evaluate(() => ({
    sectionGone: !document.querySelector(".nav .nav-pinned-section"),
    originalBtnPressed: (() => {
      const row = Array.from(document.querySelectorAll(".nav-group-body .nav-item-row")).find((r) => r.querySelector('a[data-hash="#/progress"]'));
      const btn = row ? row.querySelector(".nav-pin-btn") : null;
      return btn ? btn.getAttribute("aria-pressed") : null;
    })(),
  }));
  afterUnpin.sectionGone ? ok('unpinning the only pin removes the "Pinned" section entirely (no empty husk)') : bad('"Pinned" section still present after unpinning the only pin');
  afterUnpin.originalBtnPressed === "false" ? ok("Progress's original-row star reverts to aria-pressed=false") : bad("Progress's original-row star after unpin: " + afterUnpin.originalBtnPressed);
  const pinsAfterUnpin = await readPins(page);
  JSON.stringify(pinsAfterUnpin) === "[]" ? ok("guidon-nav-pinned-routes persists [] after unpinning") : bad("guidon-nav-pinned-routes after unpinning: " + JSON.stringify(pinsAfterUnpin));

  await page.close();
}

// ============================================================
// PART 2 — <600px-portrait Sections drawer: pin from inside it, in-place
// refresh (refreshNavDrawerIfOpen) without closing the modal.
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[drawer] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[drawer] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(700);

  await page.locator(".nav-more-btn").click();
  await page.waitForTimeout(400);
  await page.locator(".nav-drawer .nav-group-header", { hasText: "Account" }).click();
  // 450ms, not 300: same open-transition-timing margin as Part 1 above.
  await page.waitForTimeout(450);

  const progressRow = page.locator('.nav-drawer .nav-group-body.open a[data-hash="#/progress"]').locator("xpath=ancestor::div[contains(@class,'nav-item-row')]");
  await progressRow.locator(".nav-pin-btn").click();
  await page.waitForTimeout(250);

  const afterDrawerPin = await page.evaluate(() => ({
    drawerStillOpen: !!document.querySelector(".nav-drawer-back"),
    focusedInPanel: (() => { const p = document.querySelector(".nav-drawer"); return p ? p.contains(document.activeElement) : false; })(),
    pinnedSectionInDrawer: !!document.querySelector(".nav-drawer .nav-pinned-section"),
    pinnedLinkInDrawer: !!document.querySelector('.nav-drawer .nav-pinned-section a[data-hash="#/progress"]'),
  }));
  afterDrawerPin.drawerStillOpen ? ok("pinning from inside the drawer does not close it") : bad("drawer closed after tapping a pin toggle inside it");
  afterDrawerPin.focusedInPanel ? ok("the focus trap stays intact after an in-place drawer refresh") : bad("focus escaped the drawer panel after refreshNavDrawerIfOpen");
  afterDrawerPin.pinnedSectionInDrawer ? ok('the drawer grows its own "Pinned" section in place, no close/reopen needed') : bad('drawer\'s own "Pinned" section did not appear after pinning from inside it');
  afterDrawerPin.pinnedLinkInDrawer ? ok("the drawer's Pinned section contains the just-pinned #/progress link") : bad("drawer's Pinned section is missing #/progress");

  // ---- unpin from inside the drawer too, same in-place refresh ----
  await page.locator(".nav-drawer .nav-pinned-section .nav-pin-btn").click();
  await page.waitForTimeout(250);
  const afterDrawerUnpin = await page.evaluate(() => ({
    drawerStillOpen: !!document.querySelector(".nav-drawer-back"),
    pinnedSectionGone: !document.querySelector(".nav-drawer .nav-pinned-section"),
  }));
  afterDrawerUnpin.drawerStillOpen ? ok("unpinning from inside the drawer also does not close it") : bad("drawer closed after unpinning from inside it");
  afterDrawerUnpin.pinnedSectionGone ? ok('the drawer\'s "Pinned" section disappears in place after unpinning the only pin') : bad('drawer\'s "Pinned" section survived unpinning the only pin');

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.close();
}

// ============================================================
// PART 3 — dockSlots(): fresh-install parity with the old hardcoded
// NAV_PRIMARY_MOBILE, oldest-pin-first backfill, and the 4th+ pin never
// displacing an already-filled slot (docs/design/nav-adaptive-rail.md's
// own "up to 3 customizable slots" plan, as actually implemented).
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[dock] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[dock] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(700);

  const dockHashes = () => page.evaluate(() => Array.from(document.querySelectorAll(".nav > a[data-hash]")).map((a) => a.getAttribute("data-hash")));

  const fresh = await dockHashes();
  JSON.stringify(fresh) === JSON.stringify(["#/home", "#/train", "#/board", "#/settings"])
    ? ok("fresh install: dock matches the old hardcoded NAV_PRIMARY_MOBILE exactly - zero behavior change until a Soldier pins something")
    : bad("fresh-install dock slots: " + JSON.stringify(fresh));

  // ---- pin one route (#/doctrine): fills slot 2, defaults backfill 3/4 ----
  await page.evaluate(() => localStorage.setItem("guidon-nav-pinned-routes", JSON.stringify(["#/doctrine"])));
  await page.reload();
  await dismissOnboarding(page);
  await page.waitForTimeout(400);
  const onePin = await dockHashes();
  JSON.stringify(onePin) === JSON.stringify(["#/home", "#/doctrine", "#/train", "#/board"])
    ? ok("one pin (#/doctrine): dock is Home + the pin + the first 2 defaults not already used")
    : bad("dock after one pin: " + JSON.stringify(onePin));

  // ---- pin a route that IS one of the defaults (#/train): dedupe, not a
  // repeated slot - #/train should appear once, in the pinned position. ----
  await page.evaluate(() => localStorage.setItem("guidon-nav-pinned-routes", JSON.stringify(["#/train"])));
  await page.reload();
  await dismissOnboarding(page);
  await page.waitForTimeout(400);
  const pinADefault = await dockHashes();
  JSON.stringify(pinADefault) === JSON.stringify(["#/home", "#/train", "#/board", "#/settings"])
    ? ok("pinning a route that's already a default (#/train) dedupes cleanly instead of appearing twice or shifting order")
    : bad("dock after pinning an already-default route: " + JSON.stringify(pinADefault));

  // ---- 4 pins: only the first 3 (oldest-pin-first) ever reach the dock -
  // the 4th (#/career) is fully reachable via Sections but never displaces
  // an already-filled slot. ----
  await page.evaluate(() => localStorage.setItem("guidon-nav-pinned-routes", JSON.stringify(["#/doctrine", "#/progress", "#/blc", "#/career"])));
  await page.reload();
  await dismissOnboarding(page);
  await page.waitForTimeout(400);
  const fourPins = await dockHashes();
  JSON.stringify(fourPins) === JSON.stringify(["#/home", "#/doctrine", "#/progress", "#/blc"])
    ? ok("4 pins: dock takes the first 3 (oldest-pin-first: Doctrine/Progress/BLC), #/career left out (still reachable via Sections)")
    : bad("dock with 4 pins: " + JSON.stringify(fourPins));
  const pinnedSectionWithFour = await page.evaluate(() => {
    const section = document.querySelector(".nav-drawer .nav-pinned-section, .nav .nav-pinned-section");
    return section ? Array.from(section.querySelectorAll("a[data-hash]")).map((a) => a.getAttribute("data-hash")) : null;
  });
  // The dock only ever shows 3 of them, but the sidebar/drawer's own
  // "Pinned" section (not gated to the dock's 4-slot limit) should still
  // list ALL 4 - #/career didn't just vanish, it's still one tap away.
  pinnedSectionWithFour === null
    ? ok('at <600px-portrait, "Pinned" only renders inside the Sections drawer (not yet opened) - checked via the drawer below instead')
    : JSON.stringify(pinnedSectionWithFour) === JSON.stringify(["#/doctrine", "#/progress", "#/blc", "#/career"])
      ? ok("all 4 pins remain listed somewhere (Pinned section), even though only 3 fit the dock")
      : bad("Pinned-section list with 4 pins: " + JSON.stringify(pinnedSectionWithFour));

  // Actually check the drawer's own Pinned section directly for all 4, since
  // at this viewport there's no >=600px sidebar to look at.
  await page.locator(".nav-more-btn").click();
  await page.waitForTimeout(400);
  const drawerPinnedList = await page.evaluate(() => {
    const section = document.querySelector(".nav-drawer .nav-pinned-section");
    return section ? Array.from(section.querySelectorAll("a[data-hash]")).map((a) => a.getAttribute("data-hash")) : null;
  });
  JSON.stringify(drawerPinnedList) === JSON.stringify(["#/doctrine", "#/progress", "#/blc", "#/career"])
    ? ok("the Sections drawer's own Pinned section lists all 4 pins, unaffected by the dock's own 3-slot cap")
    : bad("drawer Pinned section with 4 pins: " + JSON.stringify(drawerPinnedList));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ---- unpin everything: dock falls back to the exact fresh-install shape ----
  await page.evaluate(() => localStorage.setItem("guidon-nav-pinned-routes", JSON.stringify([])));
  await page.reload();
  await dismissOnboarding(page);
  await page.waitForTimeout(400);
  const backToDefaults = await dockHashes();
  JSON.stringify(backToDefaults) === JSON.stringify(["#/home", "#/train", "#/board", "#/settings"])
    ? ok("unpinning everything restores the exact original NAV_PRIMARY_MOBILE dock")
    : bad("dock after unpinning everything: " + JSON.stringify(backToDefaults));

  await page.close();
}

// ============================================================
// PART 4 — cross-tier consistency: a pin made at sidebar width shows up in
// the dock the moment a resize crosses into the <600px-portrait tier - one
// shared navPinned array read by both renderNav() branches, not two
// drifting copies.
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[cross-tier] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[cross-tier] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(700);

  // Account, not Board Prep - see Part 1's own comment on why Board Prep
  // is unsafe to click at this viewport width (auto-opens on a genuine
  // first visit at >=1200px, Tier 1(f)).
  await page.locator(".nav .nav-group-header", { hasText: "Account" }).click();
  await page.waitForTimeout(450);
  const progressRow = page.locator('.nav-group-body.open a[data-hash="#/progress"]').locator("xpath=ancestor::div[contains(@class,'nav-item-row')]");
  await progressRow.locator(".nav-pin-btn").click();
  await page.waitForTimeout(200);

  await page.setViewportSize({ width: 390, height: 844 });
  // SIDEBAR_MQ/DOCK_MQ's own "change" listener re-renders navEl - poll for
  // the real end state rather than a fixed sleep, same idiom
  // test-nav-tier1.mjs Part 1 uses for its own breakpoint-crossing resize.
  await page.waitForFunction(() => !!document.querySelector(".nav-more-btn"), null, { timeout: 5000 }).catch(() => {});
  const dockAfterResize = await page.evaluate(() => Array.from(document.querySelectorAll(".nav > a[data-hash]")).map((a) => a.getAttribute("data-hash")));
  JSON.stringify(dockAfterResize) === JSON.stringify(["#/home", "#/progress", "#/train", "#/board"])
    ? ok("a pin made at sidebar width is reflected in the dock immediately after resizing into the <600px-portrait tier")
    : bad("dock slots after resizing down with a pre-existing pin: " + JSON.stringify(dockAfterResize));

  await page.close();
}

// ============================================================
// PART 5 — a real reload (not a localStorage.setItem shortcut) survives
// with both the sidebar's Pinned section and the dock's slots intact.
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[reload] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[reload] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(700);

  // Account, not Board Prep - see Part 1's own comment on why Board Prep
  // is unsafe to click at this viewport width (auto-opens on a genuine
  // first visit at >=1200px, Tier 1(f)).
  await page.locator(".nav .nav-group-header", { hasText: "Account" }).click();
  await page.waitForTimeout(450);
  const progressRow = page.locator('.nav-group-body.open a[data-hash="#/progress"]').locator("xpath=ancestor::div[contains(@class,'nav-item-row')]");
  await progressRow.locator(".nav-pin-btn").click();
  await page.waitForTimeout(200);

  await page.reload();
  await dismissOnboarding(page);
  await page.waitForTimeout(700);
  const afterReload = await page.evaluate(() => ({
    sectionExists: !!document.querySelector(".nav .nav-pinned-section"),
    pinnedLinkExists: !!document.querySelector('.nav .nav-pinned-section a[data-hash="#/progress"]'),
  }));
  afterReload.sectionExists && afterReload.pinnedLinkExists
    ? ok('a real page reload keeps the "Pinned" section and its #/progress link (localStorage, not in-memory state)')
    : bad("sidebar Pinned section after a real reload: " + JSON.stringify(afterReload));

  await page.close();
}

// ============================================================
// PART 6 — Round 11 roadmap-audit (nav-pin-focus-restore): toggling a pin
// from the >=600px sidebar must not drop keyboard focus to <body>.
// renderNav()'s util.clear(navEl) destroys the just-clicked .nav-pin-btn
// on every pin toggle (the same DOM-destruction Part 2 above already
// exercises for the drawer's own refreshNavDrawerIfOpen fix) - without an
// explicit capture/restore on THIS path too, the browser silently falls
// back focus to document.body, breaking Tab/Shift+Tab and screen-reader
// navigation right after the exact click a keyboard/AT user just made.
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[sidebar-focus] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[sidebar-focus] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(700);

  // Account, not Board Prep - see Part 1's own comment on why Board Prep
  // is unsafe to click at this viewport width (auto-opens on a genuine
  // first visit at >=1200px, Tier 1(f)).
  await page.locator(".nav .nav-group-header", { hasText: "Account" }).click();
  await page.waitForTimeout(450);
  const progressRow = page.locator('.nav-group-body.open a[data-hash="#/progress"]').locator("xpath=ancestor::div[contains(@class,'nav-item-row')]");
  const pinBtn = progressRow.locator(".nav-pin-btn");
  await pinBtn.focus();
  await pinBtn.click();
  await page.waitForTimeout(200);

  const afterPinFocus = await page.evaluate(() => {
    const a = document.activeElement;
    const row = a ? a.closest(".nav-item-row") : null;
    const link = row ? row.querySelector("a[data-hash]") : null;
    return {
      isPinBtn: a ? a.classList.contains("nav-pin-btn") : false,
      isBody: a === document.body,
      pressed: a ? a.getAttribute("aria-pressed") : null,
      matchesProgress: link ? link.getAttribute("data-hash") === "#/progress" : false,
      inPinnedSection: !!(a && a.closest(".nav-pinned-section")),
    };
  });
  !afterPinFocus.isBody && afterPinFocus.isPinBtn && afterPinFocus.matchesProgress && afterPinFocus.pressed === "true" && afterPinFocus.inPinnedSection
    ? ok("sidebar: pinning Progress keeps focus on ITS OWN star, now relocated into the Pinned section, instead of dropping to <body>")
    : bad("sidebar focus after pinning: " + JSON.stringify(afterPinFocus));

  // ---- unpin too - focus must follow back to Progress's row, now moved
  // back into Account's group body. ----
  const pinnedStar = page.locator(".nav .nav-pinned-section .nav-pin-btn");
  await pinnedStar.focus();
  await pinnedStar.click();
  await page.waitForTimeout(200);
  const afterUnpinFocus = await page.evaluate(() => {
    const a = document.activeElement;
    const row = a ? a.closest(".nav-item-row") : null;
    const link = row ? row.querySelector("a[data-hash]") : null;
    return {
      isPinBtn: a ? a.classList.contains("nav-pin-btn") : false,
      isBody: a === document.body,
      pressed: a ? a.getAttribute("aria-pressed") : null,
      matchesProgress: link ? link.getAttribute("data-hash") === "#/progress" : false,
    };
  });
  !afterUnpinFocus.isBody && afterUnpinFocus.isPinBtn && afterUnpinFocus.matchesProgress && afterUnpinFocus.pressed === "false"
    ? ok("sidebar: unpinning Progress also keeps focus on its star, now back in Account's group body, not <body>")
    : bad("sidebar focus after unpinning: " + JSON.stringify(afterUnpinFocus));

  await page.close();
}

// ============================================================
// PART 7 — same fix, the <600px-landscape accordion. DOCK_MQ requires
// BOTH max-width:599px AND orientation:portrait, so a landscape viewport
// under 600px wide still falls through to renderGroupsInto's same
// clear-and-rebuild path as the sidebar (Part 6), not the phone dock's
// separate branch - confirmed live (not assumed) via the isDock guard
// below before asserting anything about focus.
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 568, height: 320 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[landscape-focus] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[landscape-focus] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(700);

  const isDock = await page.evaluate(() => !!document.querySelector(".nav-more-btn"));
  if (isDock) {
    bad("568x320-landscape rendered the phone dock (.nav-more-btn present), not the accordion - DOCK_MQ/viewport assumption is wrong, fix the test");
  } else {
    await page.locator(".nav .nav-group-header", { hasText: "Account" }).click();
    await page.waitForTimeout(450);
    const progressRow = page.locator('.nav-group-body.open a[data-hash="#/progress"]').locator("xpath=ancestor::div[contains(@class,'nav-item-row')]");
    const pinBtn = progressRow.locator(".nav-pin-btn");
    await pinBtn.focus();
    await pinBtn.click();
    await page.waitForTimeout(200);
    const afterPinFocus = await page.evaluate(() => {
      const a = document.activeElement;
      return {
        isPinBtn: a ? a.classList.contains("nav-pin-btn") : false,
        isBody: a === document.body,
        pressed: a ? a.getAttribute("aria-pressed") : null,
      };
    });
    !afterPinFocus.isBody && afterPinFocus.isPinBtn && afterPinFocus.pressed === "true"
      ? ok("<600px-landscape accordion: pinning Progress keeps focus on its own star, not <body> (same shared renderNav() path as the sidebar)")
      : bad("landscape accordion focus after pinning: " + JSON.stringify(afterPinFocus));
  }

  await page.close();
}

// ============================================================
// PART 8 — regression coverage for a real layout bug found live: every
// ".nav :is(button, a)" rule across every breakpoint (the base rule, all
// three mirrored compact-rail tiers, the >=800px desktop tier, the
// nav-density/nav-labels toggles, Board Drill's icon-only collapse) has
// no [data-hash] guard, so .nav-pin-btn (a plain <button>, no data-hash)
// inherited each one's width/flex-direction/padding right along with the
// real nav links they were written for. Depending on breakpoint this
// stretched the star to the FULL row width (100%), crushing its sibling
// link down to a sliver and truncating visible labels mid-word (seen live:
// "Progress"/"Freshness"/"Settings" rendered as "GRESS"/"SHNESS"/"TINGS"
// at the 600-799px compact rail). Fixed in .nav-pin-btn's own rule with
// !important on exactly the properties those ~15 call sites fight over
// (flex-direction/width/min-width/padding), following .nav-group-header's
// own established precedent for the identical problem - deliberately NOT
// locking min-height/padding-top/padding-bottom, since the pointer:coarse
// and html.large-targets touch-target rules also match this button with
// no guard and SHOULD still be able to grow it. Checks both the tier that
// broke worst (compact rail, column-direction) and the >=800px desktop
// rail (row-direction, width:100% claimed the whole ~211px row there too).
// ============================================================
for (const { width, height, tier } of [{ width: 700, height: 900, tier: "600-799px compact rail" }, { width: 1280, height: 900, tier: ">=800px desktop rail" }]) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[pin-btn-overlap@" + width + "] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[pin-btn-overlap@" + width + "] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(300);

  await page.locator(".nav .nav-group-header", { hasText: "Account" }).click();
  await page.waitForTimeout(450);

  const rows = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".nav-group-body.open .nav-item-row")].filter((r) =>
      /Progress|Freshness|Settings/.test(r.textContent),
    );
    return items.map((r) => {
      const link = r.querySelector("a[data-hash]");
      const star = r.querySelector(".nav-pin-btn");
      const lr = link.getBoundingClientRect(), sr = star.getBoundingClientRect();
      const overlap = !(lr.right <= sr.left || lr.left >= sr.right || lr.bottom <= sr.top || lr.top >= sr.bottom);
      return {
        label: link.getAttribute("aria-label"),
        visibleText: link.innerText.trim().replace(/\s+/g, " ").toUpperCase(),
        starWidth: Math.round(sr.width),
        overlap,
      };
    });
  });

  rows.length >= 2
    ? ok(`${tier}: found ${rows.length} pinnable Account rows to check`)
    : bad(`${tier}: expected >=2 Account rows (Progress/Freshness/Settings), found ${rows.length}`);
  for (const r of rows) {
    r.starWidth === 32
      ? ok(`${tier}: "${r.label}"'s pin star is 32px wide, not stretched to the row's own width`)
      : bad(`${tier}: "${r.label}"'s pin star is ${r.starWidth}px wide, expected 32px`);
    !r.overlap
      ? ok(`${tier}: "${r.label}"'s pin star does not overlap its own link`)
      : bad(`${tier}: "${r.label}"'s pin star overlaps its own link`);
    r.visibleText === r.label.toUpperCase()
      ? ok(`${tier}: "${r.label}" renders its full label, not truncated ("${r.visibleText}")`)
      : bad(`${tier}: "${r.label}" rendered as "${r.visibleText}" - truncated`);
  }

  await page.close();
}

// ============================================================
// PART 9 — regression coverage for a second, unrelated row-consistency
// bug found live in the same investigation: a v1.2.0-era rule gave
// #/board, #/doctrine, #/forms and #/author a border-top + extra padding
// as hand-picked "new section starts" for a flat list that predates real
// .nav-group-header sections - every one of those 4 routes has sat under
// its own labeled header for a long time now, so the rule was pure
// redundant clutter left rendering those 4 rows 43px tall against every
// other row's 38px, an uneven rhythm with no relationship to today's
// actual grouping. Deleted outright rather than special-cased. Checks
// the >=800px desktop rail, where the discrepancy was found and is
// easiest to assert against a stable, fully-expanded row set.
// ============================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[row-heights] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[row-heights] pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(300);

  for (const header of await page.locator(".nav-group-header").all()) {
    if ((await header.getAttribute("aria-expanded")) === "false") await header.click();
  }
  await page.waitForTimeout(450);

  const heights = await page.evaluate(() =>
    [...document.querySelectorAll(".nav-item-row")].map((r) => Math.round(r.getBoundingClientRect().height)),
  );
  const distinct = [...new Set(heights)];
  distinct.length === 1
    ? ok(`>=800px desktop rail: all ${heights.length} expanded sidebar rows share one uniform height (${distinct[0]}px) - no stale per-route divider inflating a handful of them`)
    : bad(`>=800px desktop rail: expanded sidebar rows have ${distinct.length} different heights (${JSON.stringify(distinct)}), expected exactly 1`);

  await page.close();
}

// ============================================================
// PART 10 — regression coverage for the real Z Fold5 clipping bug: the
// device-fold-narrow-scoped compact rail (see this file's own header
// comment, point 7) out-specifies the link's own shrink-to-fit rule, so
// the star gets pushed entirely outside .nav's own bounds and clipped by
// overflow-x:hidden - invisible, not overlapping. Spoofs a real SM-F946U
// the same way test-fold-narrow-split.mjs already does.
// ============================================================
{
  const ctx = await browser.newContext({ viewport: { width: 823, height: 1300 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push("[fold5-pin-clip] " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("[fold5-pin-clip] pageerror: " + e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: { getHighEntropyValues: async () => ({ model: "SM-F946U" }) },
    });
  });
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.waitForTimeout(300);

  const hasFoldClass = await page.evaluate(() => document.documentElement.classList.contains("device-fold-narrow"));
  hasFoldClass ? ok("real Z Fold5 (SM-F946U): device-fold-narrow class applied, as test-fold-narrow-split.mjs already covers") : bad("device-fold-narrow class did not apply - fix the test, this suite assumes it");

  await page.locator(".nav .nav-group-header", { hasText: "Leadership" }).click();
  await page.waitForTimeout(450);

  const rows = await page.evaluate(() => {
    const nav = document.querySelector(".nav");
    const navRect = nav.getBoundingClientRect();
    const items = [...document.querySelectorAll(".nav-group-body.open .nav-item-row")].filter((r) => /BLC Prep|ALC Prep/.test(r.textContent));
    return items.map((r) => {
      const link = r.querySelector("a[data-hash]");
      const star = r.querySelector(".nav-pin-btn");
      const lr = link.getBoundingClientRect(), sr = star.getBoundingClientRect();
      const overlap = !(lr.right <= sr.left || lr.left >= sr.right || lr.bottom <= sr.top || lr.top >= sr.bottom);
      return {
        label: link.getAttribute("aria-label"),
        starWidth: Math.round(sr.width),
        starWithinNavBounds: sr.right <= navRect.right + 0.5,
        overlap,
      };
    });
  });

  rows.length >= 2
    ? ok(`real Z Fold5: found ${rows.length} pinnable Leadership rows to check`)
    : bad(`real Z Fold5: expected >=2 Leadership rows (BLC Prep/ALC Prep), found ${rows.length}`);
  for (const r of rows) {
    r.starWithinNavBounds
      ? ok(`real Z Fold5: "${r.label}"'s pin star stays inside the visible nav rail, not clipped by overflow-x:hidden`)
      : bad(`real Z Fold5: "${r.label}"'s pin star is clipped outside the nav rail (invisible to a real Soldier on this device)`);
    !r.overlap
      ? ok(`real Z Fold5: "${r.label}"'s pin star does not overlap its own link`)
      : bad(`real Z Fold5: "${r.label}"'s pin star overlaps its own link`);
  }

  await page.close();
  await ctx.close();
}

noise.length === 0 ? ok("no console errors/warnings across all viewport passes") : bad(noise.length + " console msg(s); first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `NAV PINNED FAVORITES: ${fails} FAILURE(S)` : "NAV PINNED FAVORITES: all passed"));
process.exit(fails ? 1 : 0);
