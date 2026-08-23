/**
 * Renders GUIDON app icons to PNG using the Chromium already installed for
 * verification (no image-library dependency, nothing fetched at build time).
 *
 * Three distinct icon treatments, because they are masked differently:
 *   any       - rounded-rect art, drawn edge-aware, used as-is by desktop/Chrome
 *   maskable  - full-bleed background, art constrained to the inner 80% safe
 *               circle, because Android crops maskable icons to a platform shape
 *   apple     - full-bleed square, no transparency and no rounding; iOS applies
 *               its own corner mask and will render black fringes otherwise
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ICON_TARGETS } from "./icon-spec.mjs";

const BG = "#0a0e12";
const AMBER = "#ffb020";
const AMBER_DIM = "#c8801a";
const OUT = process.argv[2] || "web/icons";

/** The guidon itself: a swallow-tailed pennant on a spear-topped staff. */
function art(scale = 1, cx = 256, cy = 256) {
  return `
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(-256 -256)">
    <!-- staff -->
    <path d="M150 96 L162 82 L174 96 L174 108 L162 116 L150 108 Z" fill="${AMBER}"/>
    <rect x="155" y="112" width="14" height="316" rx="7" fill="${AMBER_DIM}"/>
    <!-- pennant: swallowtail cut on the fly edge -->
    <path d="M169 140 L430 140 L344 236 L430 332 L169 332 Z" fill="${AMBER}"/>
    <!-- two rank chevrons struck through the field; kept clear of the
         swallowtail notch (tip at x=344) so they stay legible at 48px -->
    <path d="M212 200 L254 236 L212 272 L192 272 L234 236 L192 200 Z" fill="${BG}" opacity="0.92"/>
    <path d="M276 200 L318 236 L276 272 L256 272 L298 236 L256 200 Z" fill="${BG}" opacity="0.92"/>
  </g>`;
}

const svg = {
  // 12% corner radius reads correctly on desktop shelves and Windows tiles
  any: (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="96" fill="${BG}"/>${art(0.86)}</svg>`,
  // full bleed + art inside the inner-80% safe circle
  maskable: (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${BG}"/>${art(0.66)}</svg>`,
  // iOS masks it itself: square, opaque, no rounding of our own
  apple: (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${BG}"/>${art(0.80)}</svg>`,
};

// The list itself lives in icon-spec.mjs - see that file's header comment
// for why (it's shared with build.mjs, which needs these same filenames
// for <link> tags/manifest icons and for sw.js's precache list).
const TARGETS = ICON_TARGETS;

const browser = await chromium.launch();
const page = await browser.newPage();
await mkdir(OUT, { recursive: true });

for (const t of TARGETS) {
  const markup = svg[t.kind](t.size);
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}</style>${markup}`,
    { waitUntil: "load" }
  );
  const buf = await page.screenshot({ omitBackground: t.kind === "any" ? false : false, type: "png" });
  await writeFile(join(OUT, t.file), buf);
  console.log(`  ${t.file.padEnd(26)} ${t.size}x${t.size}  ${t.kind.padEnd(9)} ${buf.length.toLocaleString()} bytes`);
}

// A scalable source of truth kept alongside the rasters, for future re-rendering.
await writeFile(join(OUT, "icon.svg"), svg.any(512));
console.log("  icon.svg (vector source)");

await browser.close();
