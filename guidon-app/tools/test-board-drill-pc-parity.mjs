/**
 * PC/desktop parity pass (2026-08-22), following the completed device
 * (Tab S9 FE + Z Fold5) work. Covers Board Drill's readiness-pane overflow
 * fix and the new "F" fullscreen-toggle keyboard shortcut.
 *
 * The readiness-pane bug: .drill-layout's 3rd column (.drill-readiness-pane)
 * was gated at >=1200px on the assumption a wide-desktop viewport has room
 * for it. It didn't - board-drill-active's own 96px icon-rail plus .main's
 * legacy max-width:960px left only ~1024px of real space against the
 * pane's own 1160px minimum, so it silently overflowed .main's own
 * overflow-x:hidden and rendered completely invisible on every real desktop
 * browser at 1200px and up. Confirmed live via getBoundingClientRect() at
 * 1440px, not assumed. Fixed by lifting .main/.view's cap for
 * board-drill-active and moving the gate itself to a new, measured 1360px
 * canonical tier (96 + 80 + 1160 = 1336px, rounded up) - see the canonical
 * breakpoint scale comment in src/index.html for the full derivation.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function bootToActiveCard(viewport) {
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
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { const row = document.querySelector(".list-detail-row"); if (row) row.click(); });
  await page.waitForTimeout(900);
  return { page, noise };
}

/* ---- The actual bug: readiness pane must stay within .view's bounds,
   not overflow it, at a real desktop width past the new gate ---- */
{
  const { page, noise } = await bootToActiveCard({ width: 1440, height: 900 });
  const r = await page.evaluate(() => {
    const view = document.querySelector(".view");
    const pane = document.querySelector(".drill-readiness-pane");
    const vr = view.getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    return {
      display: getComputedStyle(pane).display,
      paneRight: pr.right, viewRight: vr.right,
      cols: getComputedStyle(document.querySelector(".drill-layout")).gridTemplateColumns,
    };
  });
  r.display === "block"
    ? ok(`at 1440px, the readiness pane is displayed (was "none" below the old 1200px gate too, but this confirms it's actually ON at a normal desktop width)`)
    : bad(`at 1440px, the readiness pane's display is "${r.display}", expected "block"`);
  r.paneRight <= r.viewRight + 1
    ? ok(`at 1440px, the readiness pane (right edge ${Math.round(r.paneRight)}px) stays within .view's own bounds (${Math.round(r.viewRight)}px) - not overflowing/clipped`)
    : bad(`at 1440px, the readiness pane's right edge is ${Math.round(r.paneRight)}px but .view only extends to ${Math.round(r.viewRight)}px - overflowing by ${Math.round(r.paneRight - r.viewRight)}px, reproducing the live bug`);
  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("no console errors/warnings at 1440px") : bad("console noise at 1440px: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- Just below the new gate (1359px): pane must stay hidden and the
   2-column layout must not overflow either - no intermediate broken
   state between the old 1200px gate and the new 1360px one ---- */
{
  const { page, noise } = await bootToActiveCard({ width: 1359, height: 900 });
  const r = await page.evaluate(() => {
    const view = document.querySelector(".view");
    const drillLayout = document.querySelector(".drill-layout");
    const pane = document.querySelector(".drill-readiness-pane");
    return {
      paneDisplay: getComputedStyle(pane).display,
      cols: getComputedStyle(drillLayout).gridTemplateColumns,
      layoutFits: drillLayout.getBoundingClientRect().right <= view.getBoundingClientRect().right + 1,
    };
  });
  r.paneDisplay === "none"
    ? ok("at 1359px (just below the gate), the readiness pane stays hidden")
    : bad(`at 1359px, the readiness pane's display is "${r.paneDisplay}", expected "none" - it's turning on before there's room for it`);
  r.cols.split(" ").length === 2
    ? ok(`at 1359px, .drill-layout stays 2-column (got "${r.cols}")`)
    : bad(`at 1359px, .drill-layout has ${r.cols.split(" ").length} columns ("${r.cols}"), expected 2`);
  r.layoutFits
    ? ok("at 1359px, the 2-column layout fits within .view - no overflow")
    : bad("at 1359px, the 2-column layout overflows .view");
  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("no console errors/warnings at 1359px") : bad("console noise at 1359px: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- Exactly at the gate (1360px): the transition must be clean, not
   off-by-one in either direction ---- */
{
  const { page } = await bootToActiveCard({ width: 1360, height: 900 });
  const r = await page.evaluate(() => {
    const view = document.querySelector(".view");
    const pane = document.querySelector(".drill-readiness-pane");
    return {
      display: getComputedStyle(pane).display,
      fits: pane.getBoundingClientRect().right <= view.getBoundingClientRect().right + 1,
    };
  });
  r.display === "block" && r.fits
    ? ok("at exactly 1360px, the readiness pane is on and fits cleanly - the transition lands exactly where the canonical breakpoint says it should")
    : bad(`at exactly 1360px: display="${r.display}", fits=${r.fits} - the boundary isn't clean`);
  await page.close();
}

/* ---- Other routes must be untouched: .main/.view's max-width:none
   override is scoped to html.board-drill-active specifically - a normal
   route (e.g. Home) must keep its regular 960px content cap, not
   silently grow full-width on desktop as a side effect of this fix ---- */
{
  const { page, noise } = await bootToActiveCard({ width: 1440, height: 900 });
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => ({
    boardDrillActive: document.documentElement.classList.contains("board-drill-active"),
    viewMaxWidth: getComputedStyle(document.querySelector(".view")).maxWidth,
  }));
  !r.boardDrillActive
    ? ok("navigating away from Board Drill clears html.board-drill-active")
    : bad("html.board-drill-active is still set after navigating to #/home");
  r.viewMaxWidth === "960px"
    ? ok(`#/home's .view keeps its normal 960px cap at 1440px (got "${r.viewMaxWidth}") - the fix didn't leak to other routes`)
    : bad(`#/home's .view max-width is "${r.viewMaxWidth}" at 1440px, expected "960px" - the board-drill-active override is leaking to other routes`);
  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("no console errors/warnings after navigating to #/home") : bad("console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- "F" keyboard shortcut toggles theater/fullscreen mode: the only
   existing binding was Escape to EXIT (confirmed by audit before this fix -
   entering was mouse/touch-only via qz-fs-btn, or the automatic
   folded-landscape trigger). A keyboard-only desktop user had no way to
   reach fullscreen study at all. ---- */
{
  const { page, noise } = await bootToActiveCard({ width: 1440, height: 900 });
  await page.evaluate(() => { document.querySelector(".qz-wrap").focus(); });
  const before = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
  await page.keyboard.press("f");
  await page.waitForTimeout(300);
  const afterF = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
  !before && afterF
    ? ok('"F" enters theater/fullscreen mode from the keyboard (was not possible before this fix)')
    : bad(`"F" did not enter theater mode (before=${before}, after=${afterF})`);

  await page.keyboard.press("f");
  await page.waitForTimeout(300);
  const afterSecondF = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
  afterF && !afterSecondF
    ? ok('"F" also EXITS theater mode (a toggle, not just an enter-only shortcut)')
    : bad(`"F" did not exit theater mode on a second press (was ${afterF}, still ${afterSecondF})`);

  // Escape must still work too - this fix must not have disturbed the
  // existing exit path.
  await page.keyboard.press("f");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterEscape = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
  !afterEscape
    ? ok("Escape still exits theater mode after this change (existing exit path undisturbed)")
    : bad("Escape no longer exits theater mode - this change disturbed the existing exit path");

  const noiseFiltered = noise.filter((n) => !/favicon/.test(n));
  noiseFiltered.length === 0 ? ok("no console errors/warnings during F-key toggling") : bad("console noise: " + noiseFiltered.slice(0, 5).join(" | "));
  await page.close();
}

/* ---- The fullscreen button's own tooltip mentions the new key, so a
   mouse user hovering it (not just a keyboard user) can discover the
   shortcut too. ---- */
{
  const { page } = await bootToActiveCard({ width: 1440, height: 900 });
  const title = await page.evaluate(() => document.querySelector(".qz-fs-btn").title);
  /\(F\)/.test(title)
    ? ok(`the fullscreen button's tooltip mentions the F key (title: "${title}")`)
    : bad(`the fullscreen button's tooltip doesn't mention F (title: "${title}")`);
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `BOARD DRILL PC PARITY: ${fails} FAILURE(S)` : "BOARD DRILL PC PARITY: all passed"));
process.exit(fails ? 1 : 0);
