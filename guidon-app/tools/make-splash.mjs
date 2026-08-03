/**
 * Renders branded Android splash images at every density Capacitor generates.
 *
 * Capacitor ships a placeholder splash; leaving it is one of the clearest
 * "this is a wrapped web page" tells. On Android 12+ the system SplashScreen
 * API handles this (see styles.xml), but minSdk is 24, so Android 7-11 devices
 * still use these full-bleed drawables.
 */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const BG = "#0a0e12";
const AMBER = "#ffb020";
const AMBER_DIM = "#c8801a";
const RES = "android/app/src/main/res";

const TARGETS = [
  ["drawable", 480, 320],
  ["drawable-land-mdpi", 480, 320],
  ["drawable-land-hdpi", 800, 480],
  ["drawable-land-xhdpi", 1280, 720],
  ["drawable-land-xxhdpi", 1600, 960],
  ["drawable-land-xxxhdpi", 1920, 1280],
  ["drawable-port-mdpi", 320, 480],
  ["drawable-port-hdpi", 480, 800],
  ["drawable-port-xhdpi", 720, 1280],
  ["drawable-port-xxhdpi", 960, 1600],
  ["drawable-port-xxxhdpi", 1280, 1920],
];

/** The guidon mark, sized as a fraction of the shorter edge so it reads the
    same on a 320px phone and a 1920px tablet. */
function markup(w, h) {
  const mark = Math.round(Math.min(w, h) * 0.28);
  return `<div style="width:${w}px;height:${h}px;background:${BG};display:flex;
    align-items:center;justify-content:center;margin:0">
    <svg width="${mark}" height="${mark}" viewBox="0 0 512 512">
      <g transform="translate(256 256) scale(0.92) translate(-256 -256)">
        <path d="M150 96 L162 82 L174 96 L174 108 L162 116 L150 108 Z" fill="${AMBER}"/>
        <rect x="155" y="112" width="14" height="316" rx="7" fill="${AMBER_DIM}"/>
        <path d="M169 140 L430 140 L344 236 L430 332 L169 332 Z" fill="${AMBER}"/>
        <path d="M212 200 L254 236 L212 272 L192 272 L234 236 L192 200 Z" fill="${BG}"/>
        <path d="M276 200 L318 236 L276 272 L256 272 L298 236 L256 200 Z" fill="${BG}"/>
      </g>
    </svg>
  </div>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();

for (const [dir, w, h] of TARGETS) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>html,body{margin:0;padding:0;overflow:hidden}</style>${markup(w, h)}`, {
    waitUntil: "load",
  });
  const buf = await page.screenshot({ type: "png" });
  await writeFile(join(RES, dir, "splash.png"), buf);
  console.log(`  ${dir.padEnd(26)} ${w}x${h}  ${buf.length.toLocaleString()} bytes`);
}

await browser.close();
