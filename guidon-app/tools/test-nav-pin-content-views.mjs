/**
 * ROADMAP 3g follow-up: pin-from-content-view.
 *
 * pinToggleButton() (src/index.html's nav module, app.js) was previously
 * only reachable from the nav rail itself (renderPinnedInto/
 * renderGroupsInto) - a Soldier could pin a route, but only by going BACK
 * to the sidebar or the <600px Sections drawer first, never from wherever
 * they were actually reading. This wires the exact same star control
 * (exposed as G.navPin.button(), a separate closure - app.js - from the
 * content views themselves) into the per-item row markup of the four
 * highest-traffic content views named in that item: Doctrine's entryList,
 * Board Drill's catList ("Jump to category"), Creeds' listPane and
 * Recite's listPane/ownPane.
 *
 * Every row in one of these lists pins the SAME single containing route
 * (there is no separate route per doctrine entry/category/creed to pin
 * individually) - so this also proves G.navPin.syncButtons(): toggling
 * from any ONE row's star must be reflected on every OTHER row's own star
 * in that same list, since nothing else re-renders these lists the way
 * renderNav() already does for the sidebar.
 *
 * Covers, for each of the four views:
 *   - the row renders wrapped in .list-detail-row-wrap with both the
 *     original .list-detail-row button AND a sibling .nav-pin-btn (not
 *     nested inside it - a <button> can't host a nested <button>);
 *   - clicking a row's own star pins the view's route: the sidebar's
 *     "Pinned" section gains a real link, guidon-nav-pinned-routes
 *     persists it, and every OTHER row's star in the same list also
 *     flips to aria-pressed="true"/.pinned;
 *   - clicking the row's own LINK/button (not the star) still activates
 *     the row exactly as before - the star is a sibling, not a click
 *     interceptor;
 *   - unpinning from a row's star removes the sidebar section and
 *     reverts every row's star, and persists an empty array.
 *
 * Real personal-account profile (PERSONAL_PROFILE), not Guest - a Guest/
 * Kiosk session's G.db.local writes are session-only (db.js's own storage
 * contract), so real window.localStorage reads below need a real profile
 * the same way test-nav-pinned-favorites.mjs's own suite does.
 */
import { bootApp, waitForRoute, until, check, finish, expectNoConsoleNoise, PERSONAL_PROFILE } from "./testkit.mjs";

const { page, noise } = await bootApp({ viewport: { width: 1280, height: 900 }, profile: { ...PERSONAL_PROFILE } });

const readPins = () => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("guidon-nav-pinned-routes") || "[]"); } catch (e) { return null; }
});

/**
 * Drives one view's first row: asserts the wrapper shape, pins via the
 * row's own star, checks the sidebar + every other row's star + real
 * persistence, then unpins the same way and checks the reverse. `hash`
 * is the containing route every row in this list pins; `label` is that
 * route's own nav label (for the aria-label/"Unpin X" check).
 */
async function checkView(hash, label, listSelector, viewLabel) {
  await waitForRoute(page, hash, { ready: listSelector + " .list-detail-row-wrap" });

  const rowCount = await page.locator(listSelector + " .list-detail-row-wrap").count();
  check(rowCount > 1, `${viewLabel}: ${rowCount} row(s) rendered, each wrapped in .list-detail-row-wrap`,
    `${viewLabel}: expected >1 wrapped row, got ${rowCount}`);
  if (rowCount < 2) return;

  const firstWrap = page.locator(listSelector + " .list-detail-row-wrap").first();
  const shape = await firstWrap.evaluate((w) => ({
    hasRow: !!w.querySelector(".list-detail-row"),
    hasPin: !!w.querySelector(".nav-pin-btn"),
    // A <button> can't nest a <button> - the star must be a SIBLING of
    // the row, not a descendant of it (mirrors the nav rail's own
    // .nav-item-row shape).
    pinIsRowChild: !!(w.querySelector(".list-detail-row") && w.querySelector(".list-detail-row").querySelector(".nav-pin-btn")),
  }));
  check(shape.hasRow && shape.hasPin && !shape.pinIsRowChild,
    `${viewLabel}: first row's wrapper holds the row button and its own star as SIBLINGS, not nested`,
    () => `${viewLabel}: row/star wrapper shape: ${JSON.stringify(shape)}`);

  const startPressed = await firstWrap.locator(".nav-pin-btn").getAttribute("aria-pressed");
  check(startPressed === "false", `${viewLabel}: row's star starts aria-pressed="false"`, `${viewLabel}: star's initial aria-pressed: ${startPressed}`);

  // ---- pin via row 0's own star ----
  await firstWrap.locator(".nav-pin-btn").click();
  const pinLanded = await until(page, (h) => !!document.querySelector('.nav .nav-pinned-section a[data-hash="' + h + '"]'), hash);
  check(pinLanded, `${viewLabel}: pinning from row 0's star opened the sidebar's "Pinned" section with a real ${hash} link`,
    () => `${viewLabel}: sidebar "Pinned" section with a ${hash} link never appeared after clicking the row's star`);

  const pins = await readPins();
  check(JSON.stringify(pins) === JSON.stringify([hash]),
    `${viewLabel}: guidon-nav-pinned-routes persists [${JSON.stringify(hash)}] after pinning from the content view`,
    `${viewLabel}: guidon-nav-pinned-routes after pinning: ${JSON.stringify(pins)}`);

  const row0Pressed = await firstWrap.locator(".nav-pin-btn").getAttribute("aria-pressed");
  const row0Label = await firstWrap.locator(".nav-pin-btn").getAttribute("aria-label");
  check(row0Pressed === "true", `${viewLabel}: the clicked row's own star flips to aria-pressed="true"`, `${viewLabel}: clicked row's star aria-pressed after pin: ${row0Pressed}`);
  check(row0Label === ("Unpin " + label), `${viewLabel}: the clicked row's star reads aria-label="Unpin ${label}"`, `${viewLabel}: clicked row's star aria-label after pin: ${row0Label}`);

  // ---- every OTHER row's star (never clicked) must ALSO now read
  // pinned - proof of G.navPin.syncButtons(), since all rows in this
  // list pin the identical single route. ----
  const otherStates = await page.evaluate((sel) => {
    const wraps = Array.from(document.querySelectorAll(sel + " .list-detail-row-wrap")).slice(1, 4);
    return wraps.map((w) => {
      const b = w.querySelector(".nav-pin-btn");
      return { pressed: b ? b.getAttribute("aria-pressed") : null, pinnedClass: b ? b.classList.contains("pinned") : null };
    });
  }, listSelector);
  check(otherStates.length > 0 && otherStates.every((s) => s.pressed === "true" && s.pinnedClass),
    `${viewLabel}: ${otherStates.length} OTHER row(s) never clicked also flipped to pinned (syncButtons kept every row's star in sync)`,
    () => `${viewLabel}: other rows' star state after pinning from row 0: ${JSON.stringify(otherStates)}`);

  // ---- clicking the ROW itself (not the star) still activates it, not
  // a pin toggle - the star is a sibling, never intercepts the row's own
  // click. Both the click and the read below are synchronous DOM state
  // (no network/async gap), so no wait is needed between them. ----
  const secondRowBtn = page.locator(listSelector + " .list-detail-row-wrap").nth(1).locator(".list-detail-row");
  const pinsBeforeRowClick = await readPins();
  await secondRowBtn.click();
  const pinsAfterRowClick = await readPins();
  check(JSON.stringify(pinsAfterRowClick) === JSON.stringify(pinsBeforeRowClick),
    `${viewLabel}: clicking a row's own button (not its star) does not change the pinned routes`,
    `${viewLabel}: pins changed from a plain row click: before=${JSON.stringify(pinsBeforeRowClick)} after=${JSON.stringify(pinsAfterRowClick)}`);

  // ---- unpin via the SAME row 0 star, reverse of the pin check above ----
  await firstWrap.locator(".nav-pin-btn").click();
  const unpinLanded = await until(page, () => !document.querySelector(".nav .nav-pinned-section"));
  check(unpinLanded, `${viewLabel}: unpinning from the row's star removes the sidebar's "Pinned" section`, `${viewLabel}: "Pinned" section still present after unpinning`);

  const pinsAfterUnpin = await readPins();
  check(JSON.stringify(pinsAfterUnpin) === "[]",
    `${viewLabel}: guidon-nav-pinned-routes persists [] after unpinning from the content view`,
    `${viewLabel}: guidon-nav-pinned-routes after unpinning: ${JSON.stringify(pinsAfterUnpin)}`);

  const otherStatesAfterUnpin = await page.evaluate((sel) => {
    const wraps = Array.from(document.querySelectorAll(sel + " .list-detail-row-wrap")).slice(1, 4);
    return wraps.map((w) => {
      const b = w.querySelector(".nav-pin-btn");
      return b ? b.getAttribute("aria-pressed") : null;
    });
  }, listSelector);
  check(otherStatesAfterUnpin.every((s) => s === "false"),
    `${viewLabel}: every other row's star also reverted to aria-pressed="false" after unpinning`,
    `${viewLabel}: other rows' star state after unpinning: ${JSON.stringify(otherStatesAfterUnpin)}`);
}

await checkView("#/doctrine", "Doctrine", ".list-detail-list", "Doctrine entryList");
await checkView("#/board", "Board", ".drill-layout .list-detail-list", "Board Drill catList");
await checkView("#/creeds", "Creeds & Branch Identities", ".list-detail-list", "Creeds listPane");
await checkView("#/recite", "Recitation Drill", ".list-detail-list", "Recite listPane");

expectNoConsoleNoise(noise, { ignore: [/favicon/], pass: "no console errors/warnings across all four views" });

await finish("NAV PIN FROM CONTENT VIEWS");
