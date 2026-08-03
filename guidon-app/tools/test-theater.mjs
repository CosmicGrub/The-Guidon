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
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true })).newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1200);
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(1200);

// --- button exists, in the nav row ---
const btn = await page.evaluate(() => {
  const b = document.querySelector(".qz-nav-row .qz-fs-btn");
  return b ? { label: b.getAttribute("aria-label"), text: b.textContent } : null;
});
btn ? ok(`fullscreen button in the nav row ("${btn.label}", ${btn.text})`) : bad("no .qz-fs-btn in .qz-nav-row");

// --- enter theater ---
await page.evaluate(() => document.querySelector(".qz-fs-btn").click());
await page.waitForTimeout(600);
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
await page.evaluate(() => document.querySelector(".qz-wrap").focus());
await page.keyboard.press("Space");
await page.waitForTimeout(700);
const flipped = await page.evaluate(() => !!document.querySelector(".qz-card.flipped"));
flipped ? ok("card flips inside theater") : bad("card did not flip in theater");
await page.keyboard.press("3");
await page.waitForTimeout(900);
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
await page.waitForTimeout(500);
const afterEsc = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
!afterEsc ? ok("Escape exits theater") : bad("Escape did not exit");

// --- navigation away cleans up a re-entered theater ---
await page.evaluate(() => document.querySelector(".qz-fs-btn").click());
await page.waitForTimeout(400);
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(900);
const afterNav = await page.evaluate(() => ({
  cls: document.documentElement.classList.contains("qz-theater"),
  overlay: !!document.querySelector(".qz-wrap"),
}));
!afterNav.cls ? ok("navigating away removes the theater class") : bad("theater class survived navigation");
!afterNav.overlay ? ok("no orphaned overlay after navigation") : bad("qz-wrap still in DOM on another view");

const KNOWN = [/Removing XFA form data/];
const unexpected = noise.filter((n) => !KNOWN.some((k) => k.test(n)));
unexpected.length === 0 ? ok("no console errors/warnings") : bad(unexpected.length + " console msgs; first: " + unexpected[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `THEATER: ${fails} FAILURE(S)` : "THEATER: all passed"));
process.exit(fails ? 1 : 0);
