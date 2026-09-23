/**
 * Fullscreen study (theater mode) on the Board Drill card.
 *
 * The contract under test:
 *   - a fullscreen button rides in the card's nav row
 *   - toggling it makes the card wrap cover the whole viewport, painted with
 *     the app's own background (everything else is covered, not hidden)
 *   - the study loop still works inside it: flip, grade, next
 *   - theater survives moving between cards, because that is the whole point
 *   - Escape exits; navigating away exits (a fixed overlay must never outlive
 *     the view that owns it); grade toasts stay visible above the overlay
 */
import { bootApp, ok, bad, finish, waitForRoute, until, expectNoConsoleNoise } from "./testkit.mjs";

const { page, noise } = await bootApp({ viewport: { width: 412, height: 915 }, contextOptions: { hasTouch: true } });
await waitForRoute(page, "#/board", { ready: ".qz-wrap .qz-card" });

const inTheater = () => document.documentElement.classList.contains("qz-theater");

// --- button exists, in the nav row ---
const btn = await page.evaluate(() => {
  const b = document.querySelector(".qz-nav-row .qz-fs-btn");
  return b ? { label: b.getAttribute("aria-label"), text: b.textContent } : null;
});
btn ? ok(`fullscreen button in the nav row ("${btn.label}", ${btn.text})`) : bad("no .qz-fs-btn in .qz-nav-row");

// --- enter theater ---
const fsBtnPresent = await until(page, () => !!document.querySelector(".qz-fs-btn"));
fsBtnPresent
  ? await page.evaluate(() => document.querySelector(".qz-fs-btn").click())
  : bad(".qz-fs-btn never appeared to enter theater");
// In theater AND laid out: the wrap has finished growing to the viewport.
await until(page, () => { const w = document.querySelector(".qz-wrap"); const r = w && w.getBoundingClientRect(); return document.documentElement.classList.contains("qz-theater") && !!r && r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }, null, { timeout: 5000 });
const on = await page.evaluate(() => {
  const wrap = document.querySelector(".qz-wrap");
  const r = wrap.getBoundingClientRect();
  const cs = getComputedStyle(wrap);
  return {
    cls: document.documentElement.classList.contains("qz-theater"),
    covers: r.width >= innerWidth - 1 && r.height >= innerHeight - 1 && r.top <= 1 && r.left <= 1,
    fixed: cs.position === "fixed",
    opaqueBg: cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent",
    btnLabel: document.querySelector(".qz-fs-btn").getAttribute("aria-label"),
    topbarCovered: (() => {
      const tb = document.querySelector(".topbar");
      if (!tb) return true;
      const tr = tb.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.floor(tr.left + tr.width / 2), Math.floor(tr.top + tr.height / 2));
      return !!(hit && (hit.closest(".qz-wrap") || !hit.closest(".topbar")));
    })(),
  };
});
on.cls ? ok("html.qz-theater set") : bad("theater class missing");
on.fixed && on.covers ? ok("card wrap is a fixed overlay covering the full viewport") : bad("wrap does not cover viewport: " + JSON.stringify(on));
on.opaqueBg ? ok("overlay painted with an opaque theme background") : bad("overlay background transparent");
on.topbarCovered ? ok("topbar is underneath the overlay (hit-test)") : bad("topbar still hit-testable above overlay");
/^exit/i.test(on.btnLabel) ? ok("button relabelled to exit") : bad("button label: " + on.btnLabel);

// --- study loop inside theater: flip, grade, next card keeps theater ---
const wrapPresentForFocus = await until(page, () => !!document.querySelector(".qz-wrap"));
wrapPresentForFocus
  ? await page.evaluate(() => document.querySelector(".qz-wrap").focus())
  : bad(".qz-wrap never appeared to focus for the study-loop keyboard test");
await page.keyboard.press("Space");
await until(page, () => !!document.querySelector(".qz-card.flipped"), null, { timeout: 5000 });
const flipped = await page.evaluate(() => !!document.querySelector(".qz-card.flipped"));
flipped ? ok("card flips inside theater") : bad("card did not flip in theater");
await page.keyboard.press("3");
await until(page, () => !document.querySelector(".qz-card.flipped"), null, { timeout: 5000 });
const afterGrade = await page.evaluate(() => ({
  theater: document.documentElement.classList.contains("qz-theater"),
  flippedReset: !document.querySelector(".qz-card.flipped"),
  toastZ: (() => { const t = document.getElementById("toast"); return t ? getComputedStyle(t).zIndex : null; })(),
}));
afterGrade.theater ? ok("grading advances to the next card WITHOUT leaving theater") : bad("grade kicked user out of theater");
afterGrade.flippedReset ? ok("next card arrives unflipped") : bad("flip state leaked to next card");
Number(afterGrade.toastZ) > 800 ? ok(`toast lifted above the overlay (z-index ${afterGrade.toastZ})`) : bad("toast z-index " + afterGrade.toastZ + " is under the overlay");

// --- Escape exits ---
await page.keyboard.press("Escape");
await until(page, () => !document.documentElement.classList.contains("qz-theater"), null, { timeout: 5000 });
const afterEsc = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
!afterEsc ? ok("Escape exits theater") : bad("Escape did not exit");

// --- navigation away cleans up a re-entered theater ---
const fsBtnPresentAgain = await until(page, () => !!document.querySelector(".qz-fs-btn"));
fsBtnPresentAgain
  ? await page.evaluate(() => document.querySelector(".qz-fs-btn").click())
  : bad(".qz-fs-btn never appeared to re-enter theater before navigating away");
await until(page, inTheater, null, { timeout: 5000 });
await waitForRoute(page, "#/home");
const afterNav = await page.evaluate(() => ({
  cls: document.documentElement.classList.contains("qz-theater"),
  overlay: !!document.querySelector(".qz-wrap"),
}));
!afterNav.cls ? ok("navigating away removes the theater class") : bad("theater class survived navigation");
!afterNav.overlay ? ok("no orphaned overlay after navigation") : bad("qz-wrap still in DOM on another view");

expectNoConsoleNoise(noise, { ignore: [/Removing XFA form data/], pass: "no console errors/warnings" });
await finish("THEATER");
