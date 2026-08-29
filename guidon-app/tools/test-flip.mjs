/**
 * Card flip animation: honors the Motion setting, and the drag path never
 * fights the transition.
 *
 * The user-facing contract:
 *   - Settings → Motion is the flip's speed dial: standard is crisp, rich
 *     (the default) settles with a slight overshoot, cinematic is slow and
 *     deliberate, minimal/reduce-motion swap faces instantly with no 3D at all
 *   - the flip still actually flips under every level
 *   - a touch drag moves the card with NO transition active (the lag bug:
 *     every touchmove eased toward the finger over the full flip duration)
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
await page.waitForTimeout(1100);
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button,.ob-mode-card,[role=button],.click")]
    .find((e) => /guest session/i.test(e.textContent || ""));
  if (t) t.click();
});
await page.waitForTimeout(1100);
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(1100);

/* ---- per-motion-level transition values ---- */
const levels = [
  ["standard", "0.45s"],
  ["rich", "0.65s"],
  ["cinematic", "0.95s"],
];
for (const [level, dur] of levels) {
  const got = await page.evaluate((lv) => {
    document.documentElement.setAttribute("data-motion", lv);
    const c = document.querySelector(".qz-card");
    const cs = getComputedStyle(c);
    return { dur: cs.transitionDuration, ease: cs.transitionTimingFunction, will: cs.willChange };
  }, level);
  got.dur === dur
    ? ok(`${level}: flip duration ${got.dur}`)
    : bad(`${level}: expected ${dur}, got ${got.dur}`);
  /cubic-bezier/.test(got.ease) ? ok(`${level}: custom easing applied`) : bad(`${level}: easing ${got.ease}`);
  if (level === "rich") {
    got.will === "transform" ? ok("card promoted to its own layer (will-change)") : bad("will-change: " + got.will);
  }
}

/* ---- flip still works under cinematic (the slowest path) ---- */
await page.evaluate(() => document.querySelector(".qz-wrap").focus());
await page.keyboard.press("Space");
await page.waitForTimeout(1300);
const flippedCin = await page.evaluate(() => !!document.querySelector(".qz-card.flipped"));
flippedCin ? ok("card flips under cinematic") : bad("no flip under cinematic");
await page.keyboard.press("Space");
await page.waitForTimeout(1300);

/* ---- minimal: instant face swap, no 3D ---- */
const min = await page.evaluate(() => {
  document.documentElement.setAttribute("data-motion", "minimal");
  const c = document.querySelector(".qz-card");
  const cs = getComputedStyle(c);
  return { transition: cs.transitionProperty, transform: cs.transform };
});
(min.transition === "none" || min.transform === "none")
  ? ok("minimal: no transition/3D on the card")
  : bad("minimal still animates: " + JSON.stringify(min));
await page.keyboard.press("Space");
await page.waitForTimeout(400);
const minFlip = await page.evaluate(() => {
  const back = document.querySelector(".qz-card.flipped .qz-back");
  return back ? getComputedStyle(back).display !== "none" : false;
});
minFlip ? ok("minimal: face swap still reveals the answer") : bad("minimal flip broken");

/* ---- drag path: transition must be dead while the finger moves ---- */
await page.evaluate(() => { document.documentElement.setAttribute("data-motion", "rich"); });
await page.waitForTimeout(300);
// Card is currently flipped (minimal swap above left .flipped on) — drag it.
const drag = await page.evaluate(async () => {
  const card = document.querySelector(".qz-card");
  const r = card.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const touch = (type, x) => {
    const t = new Touch({ identifier: 1, target: card, clientX: x, clientY: cy });
    card.dispatchEvent(new TouchEvent(type, {
      touches: type === "touchend" ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
  };
  touch("touchstart", cx);
  const before = card.style.transition;
  touch("touchmove", cx + 30);
  const during = card.style.transition;
  touch("touchmove", cx + 40);
  touch("touchend", cx + 40);           // below the 70px threshold -> snap back
  await new Promise((res) => setTimeout(res, 350));
  const after = card.style.transition;  // restored to stylesheet control
  return { before, during, after };
});
drag.during === "none"
  ? ok("transition disabled the moment a drag starts moving")
  : bad(`transition during drag: "${drag.during}"`);
drag.after === ""
  ? ok("stylesheet transition restored after the drag settles")
  : bad(`inline transition left behind: "${drag.after}"`);

/* ---- Item 6 regression (2026-08-28): pressing F mid-flip must not toggle
   theater mode while the .65s ("rich") rotateY transition is still playing -
   doing so used to change aspect-ratio/height/flex synchronously underneath
   an actively-rotating card. cardFlipping (armed in doFlip(), cleared on the
   card's transitionend or a 1s fallback) is the guard under test: F should
   silently no-op while it's true, then work normally once it clears. ---- */
await page.evaluate(() => { document.documentElement.setAttribute("data-motion", "rich"); });
await page.evaluate(() => document.querySelector(".qz-wrap").focus());
// Card is currently flipped (left that way by the minimal-motion section
// above) — flip it back to a known unflipped state first and let that
// settle, so the timed press below starts from a clean baseline.
await page.keyboard.press("Space");
await page.waitForTimeout(800);

await page.keyboard.press("Space"); // starts a fresh .65s flip
await page.waitForTimeout(120);     // well inside the transition window
const midFlipBefore = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
await page.keyboard.press("f");
await page.waitForTimeout(80);
const midFlipAfter = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
(midFlipBefore === false && midFlipAfter === false)
  ? ok("pressing F mid-flip (inside the .65s rotateY transition) does not toggle theater mode")
  : bad(`theater state around a mid-flip F press: before=${midFlipBefore}, after=${midFlipAfter}`);

// Let the transition fully settle (well past .65s), then confirm F works
// normally again - the guard must release, not get stuck permanently.
await page.waitForTimeout(900);
await page.keyboard.press("f");
await page.waitForTimeout(300);
const afterSettled = await page.evaluate(() => document.documentElement.classList.contains("qz-theater"));
afterSettled
  ? ok("once the flip transition has settled, F enters theater mode normally")
  : bad("F did not enter theater mode after the flip transition settled - guard may be stuck");
await page.keyboard.press("Escape"); // clean up before the suite's final checks
await page.waitForTimeout(300);

const KNOWN = [/Removing XFA form data/];
const unexpected = noise.filter((n) => !KNOWN.some((k) => k.test(n)));
unexpected.length === 0 ? ok("no console errors/warnings") : bad(unexpected.length + " console msgs; first: " + unexpected[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `FLIP: ${fails} FAILURE(S)` : "FLIP: all passed"));
process.exit(fails ? 1 : 0);
