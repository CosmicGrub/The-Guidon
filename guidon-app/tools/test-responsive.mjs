/**
 * Topbar brand integrity at real narrow-phone widths.
 *
 * Found via a hands-on hardware audit (session 50): on a Galaxy Z Fold 5's
 * cover screen (344px CSS width), the "Online" status chip alone was enough
 * fixed-width chrome to force the GUIDON wordmark itself down to "GUI…" - not
 * a subtitle trimming (expected, harmless), the BRAND NAME reading as broken.
 * #topbar-username already had a max-width:480px hide rule for exactly this
 * kind of phone-chrome budget problem; the status chip did not.
 *
 * This asserts the wordmark is never clipped at 344/360/412px (a Fold cover,
 * a common Android baseline, and a typical modern phone), that the chip hides
 * exactly at the 480px breakpoint boundary and no further, and that desktop
 * keeps the chip.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function topbarState(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const noise = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(700);
  const s = await page.evaluate(() => {
    const h1 = document.querySelector(".topbar .brand h1");
    const chip = document.querySelector(".status-chip");
    return {
      h1Text: h1 ? h1.textContent : null,
      truncated: h1 ? h1.scrollWidth > h1.clientWidth + 1 : null,
      chipVisible: chip ? getComputedStyle(chip).display !== "none" : null,
    };
  });
  await ctx.close();
  return { s, noise };
}

for (const w of [344, 360, 412]) {
  const { s, noise } = await topbarState(w);
  s.h1Text === "GUIDON"
    ? ok(`${w}px: brand text is "GUIDON" (not truncated in the DOM)`)
    : bad(`${w}px: brand text is ${JSON.stringify(s.h1Text)}`);
  !s.truncated
    ? ok(`${w}px: wordmark renders in full (scrollWidth <= clientWidth)`)
    : bad(`${w}px: wordmark visually clipped - regression of the Fold cover-screen bug`);
  s.chipVisible === false
    ? ok(`${w}px: status chip hidden, freeing room for the brand`)
    : bad(`${w}px: status chip still visible, expected hidden below 480px`);
  noise.length === 0 ? ok(`${w}px: no console errors/warnings`) : bad(`${w}px console: ` + noise[0]);
}

// Breakpoint boundary: 481px must keep the chip (it's a phone-only concession,
// not a permanent removal of connectivity status).
{
  const { s } = await topbarState(481);
  s.chipVisible === true
    ? ok("481px: status chip visible again just above the breakpoint")
    : bad("481px: status chip unexpectedly hidden - breakpoint too wide");
  !s.truncated
    ? ok("481px: wordmark still renders in full")
    : bad("481px: wordmark clipped");
}

// Desktop: chip present, plenty of room.
{
  const { s } = await topbarState(1440);
  s.chipVisible === true
    ? ok("1440px: status chip visible on desktop")
    : bad("1440px: status chip unexpectedly hidden");
}

await browser.close();
server.close();
console.log("\n" + (fails ? `RESPONSIVE: ${fails} FAILURE(S)` : "RESPONSIVE: all passed"));
process.exit(fails ? 1 : 0);
