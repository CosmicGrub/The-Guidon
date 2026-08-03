/**
 * Tab-strip scroll affordance.
 *
 * §41 made .segmented scroll instead of wrap, which fixed reachability but left
 * no signal that scrolling was possible. On a 412px phone the Board Prep strip
 * reads "... POINTS | RE..." and stops. This asserts the hint appears exactly
 * when it is needed and not otherwise - a permanent fade on a strip that fits
 * would be worse than no fade at all.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function stripState(width, height, hash) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900 });
  const page = await ctx.newPage();
  const noise = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(500);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(900);
  const s = await page.evaluate(() => {
    const el = document.querySelector(".segmented");
    if (!el) return { none: true };
    return {
      attr: el.getAttribute("data-scroll"),
      overflows: el.scrollWidth - el.clientWidth > 2,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      mask: getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage,
    };
  });
  return { s, page, ctx, noise };
}

// --- narrow phone: the strip overflows, so the hint must appear ---
{
  const { s, page, ctx, noise } = await stripState(412, 842, "#/board");
  s.overflows
    ? ok(`412px: strip overflows (${s.scrollWidth} > ${s.clientWidth}) as expected`)
    : bad("412px: strip did not overflow - test premise wrong");
  s.attr === "more"
    ? ok('412px: data-scroll="more" set at the start of the strip')
    : bad(`412px: expected data-scroll="more", got ${JSON.stringify(s.attr)}`);
  (s.mask && s.mask !== "none")
    ? ok("412px: fade mask applied")
    : bad("412px: no mask applied, got " + s.mask);

  // Scrolling to the end must flip the hint to the other side, not leave a
  // fade suggesting there is still more to the right.
  await page.evaluate(() => {
    const el = document.querySelector(".segmented");
    el.scrollLeft = el.scrollWidth;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(300);
  const end = await page.evaluate(() => document.querySelector(".segmented").getAttribute("data-scroll"));
  end === "back"
    ? ok('scrolled to the end: data-scroll flips to "back"')
    : bad(`at end expected "back", got ${JSON.stringify(end)}`);

  noise.length === 0 ? ok("412px: no console errors/warnings") : bad("console: " + noise[0]);
  await ctx.close();
}

// --- desktop: the strip fits, so there must be NO fade ---
{
  const { s, ctx, noise } = await stripState(1440, 900, "#/board");
  !s.overflows
    ? ok("1440px: strip fits without scrolling")
    : bad("1440px: strip unexpectedly overflows");
  (s.attr === null || s.attr === undefined)
    ? ok("1440px: no data-scroll attribute when nothing is hidden")
    : bad(`1440px: expected no attribute, got ${JSON.stringify(s.attr)}`);
  (!s.mask || s.mask === "none")
    ? ok("1440px: no mask applied when the strip fits")
    : bad("1440px: mask applied unnecessarily: " + s.mask);
  noise.length === 0 ? ok("1440px: no console errors/warnings") : bad("console: " + noise[0]);
  await ctx.close();
}

// --- high contrast must win over the affordance ---
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 842 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.documentElement.classList.add("high-contrast");
    location.hash = "#/board";
  });
  await page.waitForTimeout(900);
  const mask = await page.evaluate(() => {
    const el = document.querySelector(".segmented");
    return { attr: el.getAttribute("data-scroll"), mask: getComputedStyle(el).maskImage };
  });
  (!mask.mask || mask.mask === "none")
    ? ok("high-contrast mode disables the fade (attribute still set: " + mask.attr + ")")
    : bad("high-contrast still masked: " + mask.mask);
  await ctx.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `SCROLLHINT: ${fails} FAILURE(S)` : "SCROLLHINT: all passed"));
process.exit(fails ? 1 : 0);
