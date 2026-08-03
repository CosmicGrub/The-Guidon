/**
 * Screenshot matrix for UX review: key sections x real viewports x app states.
 * Output goes to dist/ux-shots/ as <section>-<viewport>.png, plus a few
 * stateful captures (flipped card, onboarding, guest home).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { mkdir, rm } from "node:fs/promises";

const OUT = "dist/ux-shots";
const VIEWPORTS = [
  { name: "phone", width: 412, height: 915 },
  { name: "tablet", width: 720, height: 1152 },
  { name: "desktop", width: 1440, height: 900 },
];
const SECTIONS = ["#/home", "#/board", "#/train", "#/records", "#/calendar",
  "#/fitness", "#/counsel", "#/progress", "#/settings", "#/channels",
  "#/leader", "#/currency", "#/share", "#/dictionary"];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const { server, url } = await serve("web");
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.width < 900 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  // Onboarding as-is, first.
  await page.screenshot({ path: `${OUT}/onboarding-${vp.name}.png` });

  // Continue as Guest so views carry normal (empty-profile) state.
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
      .find((e) => /guest session/i.test(e.textContent || ""));
    if (t) t.click();
  });
  await page.waitForTimeout(1500);

  for (const hash of SECTIONS) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(700);
    const name = hash.replace("#/", "");
    await page.screenshot({ path: `${OUT}/${name}-${vp.name}.png` });
  }

  // Stateful: flipped flashcard.
  await page.evaluate(() => { location.hash = "#/board"; });
  await page.waitForTimeout(900);
  await page.evaluate(() => { const c = document.querySelector("#route .qz-wrap"); if (c) c.focus(); });
  await page.keyboard.press("Space");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/board-flipped-${vp.name}.png` });

  await ctx.close();
}

await browser.close();
server.close();
console.log("done -> " + OUT);
