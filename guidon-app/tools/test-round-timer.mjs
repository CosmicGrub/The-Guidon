/**
 * Roadmap audit round 9, "Shared round-timer & PRT drill-runner fixes"
 * bucket: util.makeRoundTimer (src/index.html, ~line 6475), PRT's "Run the
 * drill" (prtRunDrill/startExercise/finishDrill, ~line 31907), and
 * Recitation's Timed Recitation mode (~line 31826) had NO test coverage at
 * all before this - the Content & Educational Materials expansion that
 * shipped them (see ROADMAP.md §1) was verified live in a browser, not
 * headlessly. Covers the five fixes made in this bucket directly:
 *   1. pause()/resume() (manualPaused) survives a visibilitychange toggle
 *      (hiddenPaused) instead of being silently undone by it.
 *   2. Neither the PRT nor the Timed Recitation .rf-timer clock carries
 *      aria-live (both tick every second; announcing every tick would spam
 *      a screen reader - matches the pre-existing Rapid Fire timer).
 *   3. Focus moves to the drill wrap on entry/each new exercise/finish, and
 *      to the Hub heading on both "back to Hub" paths (End, and "Back to
 *      Physical Readiness"), since that whole round trip never leaves
 *      #/prt and so never runs through the router's own auto-focus.
 *   4. A screen wake lock is requested on round start/resume and released
 *      on pause()/stop() (navigator.wakeLock is stubbed so this is checked
 *      deterministically, regardless of whether this headless browser's
 *      own implementation would really grant one).
 *   5. Timed Recitation's "Before you start" checklist uses the sibling
 *      `<input id> + <label for>` shape, not a checkbox nested inside its
 *      label - the coarse-pointer 48px touch-target rule
 *      (`input[type="checkbox"] + label`) only matches the former.
 *
 * Roadmap audit round 10, "Shared util-layer fixes: focus restoration +
 * wake-lock lifecycle" bucket adds three more, covering util.busyButton
 * (~line 6904) alongside two more makeRoundTimer fixes:
 *   a. busyButton's completion handler restores keyboard focus to the
 *      button if focus has since fallen all the way to <body> - disabling
 *      the currently-focused button mid-click triggers the browser's own
 *      focus-fixup to <body>, and nothing used to reclaim it once the
 *      button was re-enabled.
 *   b. makeRoundTimer's tick() disconnect branch now sets finished = true
 *      before calling cleanup(), mirroring stop() - so a wake-lock request
 *      that resolves AFTER the anchor element is torn down by ordinary
 *      navigation (never called stop()/pause()) is correctly discarded
 *      instead of leaking an un-released WakeLockSentinel.
 *   c. acquireWakeLock() now guards a second concurrent
 *      navigator.wakeLock.request() call with a wakeLockPending flag, so a
 *      zero-delay pause()-then-resume() pair (both synchronous, while the
 *      first request is still in flight) can no longer fire a second real
 *      request and leak the first grant when both eventually resolve.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { pastOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

// Stub navigator.wakeLock before any app script runs, so item 4 (and round
// 10's items b/c) can be checked deterministically - a real headless grant
// depends on window focus/visibility state this harness doesn't control,
// but every round timer only needs to CALL request()/release() at the
// right moments. `delayMs` lets a test control exactly when request()
// resolves relative to other timer events (e.g. a 1000ms tick) - default 0
// keeps the near-instant resolution the items-1/4 tests below rely on;
// `locks` records every sentinel ever issued so a test can assert none was
// left un-released, not just that the running totals balance.
await page.addInitScript(() => {
  window.__wl = { calls: 0, releases: 0, delayMs: 0, locks: [] };
  const makeLock = () => {
    const lock = {
      released: false,
      release() { if (!this.released) { this.released = true; window.__wl.releases++; } return Promise.resolve(); },
      addEventListener() {},
    };
    window.__wl.locks.push(lock);
    return lock;
  };
  Object.defineProperty(window.navigator, "wakeLock", {
    configurable: true,
    value: {
      request() {
        window.__wl.calls++;
        return new Promise((resolve) => setTimeout(() => resolve(makeLock()), window.__wl.delayMs));
      },
    },
  });
});

await pastOnboarding(page, url);
await page.waitForTimeout(300);

/* ------------------------------------------------------------------ *
 * Items 1 and 4, exercised directly against util.makeRoundTimer - no  *
 * UI needed, and this is the one place both flags/the wake lock live. *
 * ------------------------------------------------------------------ */

const pauseSurvivesVisibility = await page.evaluate(async () => {
  const anchor = document.createElement("div");
  document.body.appendChild(anchor);
  let ticks = 0;
  const timer = window.G.util.makeRoundTimer({ anchorEl: anchor, totalSec: null, onTick: () => { ticks++; } });
  timer.pause();
  // Simulate the tab going hidden, then visible again, while manually
  // paused - onVisible() must only ever touch its own hiddenPaused flag.
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  const before = ticks;
  await new Promise((r) => setTimeout(r, 1300));
  const after = ticks;
  timer.stop();
  anchor.remove();
  return { before, after };
});
(pauseSurvivesVisibility.before === 0 && pauseSurvivesVisibility.after === 0)
  ? ok("makeRoundTimer: manual pause() survives a hidden->visible visibilitychange round trip")
  : bad("manual pause did not survive a visibility toggle: " + JSON.stringify(pauseSurvivesVisibility));

const resumeAfterManualPause = await page.evaluate(async () => {
  const anchor = document.createElement("div");
  document.body.appendChild(anchor);
  let ticks = 0;
  const timer = window.G.util.makeRoundTimer({ anchorEl: anchor, totalSec: null, onTick: () => { ticks++; } });
  timer.pause();
  await new Promise((r) => setTimeout(r, 1300));
  const whilePaused = ticks;
  timer.resume();
  await new Promise((r) => setTimeout(r, 1300));
  const afterResume = ticks;
  timer.stop();
  anchor.remove();
  return { whilePaused, afterResume };
});
(resumeAfterManualPause.whilePaused === 0 && resumeAfterManualPause.afterResume > 0)
  ? ok("makeRoundTimer: resume() un-pauses a manually paused timer")
  : bad("resume() did not restart ticking: " + JSON.stringify(resumeAfterManualPause));

const wakeLockLifecycle = await page.evaluate(async () => {
  window.__wl.calls = 0; window.__wl.releases = 0;
  const anchor = document.createElement("div");
  document.body.appendChild(anchor);
  const timer = window.G.util.makeRoundTimer({ anchorEl: anchor, totalSec: null, onTick: () => {} });
  await new Promise((r) => setTimeout(r, 60)); // let the acquire promise's .then() settle
  const acquiredOnStart = window.__wl.calls;
  timer.pause();
  await new Promise((r) => setTimeout(r, 60));
  const releasedOnPause = window.__wl.releases;
  timer.resume();
  await new Promise((r) => setTimeout(r, 60));
  const reacquiredOnResume = window.__wl.calls;
  timer.stop();
  await new Promise((r) => setTimeout(r, 60));
  const releasedOnStop = window.__wl.releases;
  anchor.remove();
  return { acquiredOnStart, releasedOnPause, reacquiredOnResume, releasedOnStop };
});
(wakeLockLifecycle.acquiredOnStart >= 1) ? ok("makeRoundTimer requests a screen wake lock on round start") : bad("no wake lock requested on start: " + JSON.stringify(wakeLockLifecycle));
(wakeLockLifecycle.releasedOnPause >= 1) ? ok("makeRoundTimer releases the wake lock on pause()") : bad("wake lock not released on pause(): " + JSON.stringify(wakeLockLifecycle));
(wakeLockLifecycle.reacquiredOnResume >= 2) ? ok("makeRoundTimer re-requests the wake lock on resume()") : bad("wake lock not re-requested on resume(): " + JSON.stringify(wakeLockLifecycle));
(wakeLockLifecycle.releasedOnStop >= 2) ? ok("makeRoundTimer releases the wake lock on stop()") : bad("wake lock not released on stop(): " + JSON.stringify(wakeLockLifecycle));

/* ------------------------------------------------------------------ *
 * Round 10 item b: an anchor-element disconnect (ordinary navigation, *
 * no explicit stop()) must discard a wake-lock grant that resolves    *
 * AFTER the disconnect is detected, not just one that resolves before.*
 * ------------------------------------------------------------------ */

const disconnectWithoutStop = await page.evaluate(async () => {
  window.__wl.calls = 0; window.__wl.releases = 0; window.__wl.locks = [];
  // Resolve well after the first 1000ms tick, so tick()'s disconnect check
  // runs (and must set finished = true) before the in-flight request lands.
  window.__wl.delayMs = 1300;
  const anchor = document.createElement("div");
  document.body.appendChild(anchor);
  window.G.util.makeRoundTimer({ anchorEl: anchor, totalSec: null, onTick: () => {} });
  // Tear the anchor down the way ordinary navigation does - no stop()/
  // pause() call, just the element leaving the DOM.
  anchor.remove();
  await new Promise((r) => setTimeout(r, 1800)); // past both the 1000ms tick and delayMs
  window.__wl.delayMs = 0;
  return { calls: window.__wl.calls, releases: window.__wl.releases, unreleased: window.__wl.locks.filter((l) => !l.released).length };
});
(disconnectWithoutStop.calls === 1 && disconnectWithoutStop.unreleased === 0)
  ? ok("makeRoundTimer: anchor disconnect without stop() discards a wake-lock grant that resolves late")
  : bad("a late wake-lock grant leaked after anchor disconnect: " + JSON.stringify(disconnectWithoutStop));

/* ------------------------------------------------------------------ *
 * Round 10 item c: a zero-delay pause()/resume() pair, fired while    *
 * the very first acquireWakeLock() call is still in flight, must not  *
 * fire a second concurrent request() and leak the first grant.        *
 * ------------------------------------------------------------------ */

const zeroDelayPauseResume = await page.evaluate(async () => {
  window.__wl.calls = 0; window.__wl.releases = 0; window.__wl.locks = [];
  const anchor = document.createElement("div");
  document.body.appendChild(anchor);
  const timer = window.G.util.makeRoundTimer({ anchorEl: anchor, totalSec: null, onTick: () => {} });
  // Synchronous, zero-delay pause() then resume() - the constructor's own
  // acquireWakeLock() call above is still awaiting navigator.wakeLock.
  // request()'s resolution at this point.
  timer.pause();
  timer.resume();
  await new Promise((r) => setTimeout(r, 100));
  const callsAfterPauseResume = window.__wl.calls;
  timer.stop();
  await new Promise((r) => setTimeout(r, 60));
  const unreleased = window.__wl.locks.filter((l) => !l.released).length;
  anchor.remove();
  return { callsAfterPauseResume, unreleased };
});
(zeroDelayPauseResume.callsAfterPauseResume === 1 && zeroDelayPauseResume.unreleased === 0)
  ? ok("makeRoundTimer: a zero-delay pause()/resume() pair does not double-acquire the wake lock")
  : bad("zero-delay pause()/resume() double-acquired or leaked a wake lock: " + JSON.stringify(zeroDelayPauseResume));

/* ------------------------------------------------------------------ *
 * Round 10 item a: util.busyButton restores focus to its own button   *
 * if disabling it mid-click knocked focus back to <body>.             *
 * ------------------------------------------------------------------ */

const busyButtonFocusRestoration = await page.evaluate(async () => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Do the thing";
  document.body.appendChild(btn);
  btn.focus();
  const focusedBeforeClick = document.activeElement === btn;
  window.G.util.busyButton(btn, () => new Promise((r) => setTimeout(r, 60)), {});
  btn.click();
  // btn.disabled = true is set synchronously inside busyButton's own click
  // handler, above - in a real browser that triggers the UA's own focus-
  // fixup to <body> (a disabled element can't stay the active element),
  // but exactly when that fixup lands relative to this task is a headless-
  // engine implementation detail, not something this test should depend
  // on. Force the same end state directly (blur() with nothing else
  // focusable falls back to <body>, the same default focus target the
  // fixup would land on) so the assertion below exercises busyButton's own
  // `document.activeElement === document.body` check deterministically.
  btn.blur();
  const focusFellToBody = document.activeElement === document.body;
  await new Promise((r) => setTimeout(r, 100)); // past the handler's own 60ms
  const focusedAfterDone = document.activeElement === btn;
  btn.remove();
  return { focusedBeforeClick, focusFellToBody, focusedAfterDone };
});
(busyButtonFocusRestoration.focusedBeforeClick && busyButtonFocusRestoration.focusFellToBody && busyButtonFocusRestoration.focusedAfterDone)
  ? ok("busyButton restores focus to its own button after disabling it knocked focus to <body>")
  : bad("busyButton did not restore focus: " + JSON.stringify(busyButtonFocusRestoration));

/* ------------------------------------------------------------------ *
 * Items 2 and 3 on the real #/prt "Run the drill" screen.             *
 * ------------------------------------------------------------------ */

await page.evaluate(() => { location.hash = "#/prt"; });
await page.waitForTimeout(400);
await page.locator("button", { hasText: /run the drill/i }).click();
await page.waitForTimeout(200);

const clockNoAriaLivePrt = await page.evaluate(() => {
  const clock = document.querySelector(".rf-timer");
  return !!clock && !clock.hasAttribute("aria-live");
});
clockNoAriaLivePrt ? ok("PRT 'Run the drill' clock carries no aria-live") : bad("PRT clock unexpectedly has aria-live");

const focusOnEnter = await page.evaluate(() => {
  const a = document.activeElement;
  return { tabindex: a && a.getAttribute("tabindex"), text: a ? a.textContent.slice(0, 60) : null };
});
(focusOnEnter.tabindex === "-1" && /1 \/ 10/.test(focusOnEnter.text || ""))
  ? ok("entering 'Run the drill' moves focus to the drill wrap (exercise 1/10)")
  : bad("focus not on the drill wrap after entry: " + JSON.stringify(focusOnEnter));

await page.locator("button", { hasText: /^Skip →$/ }).click();
await page.waitForTimeout(150);
const focusAfterSkip = await page.evaluate(() => {
  const a = document.activeElement;
  return { tabindex: a && a.getAttribute("tabindex"), text: a ? a.textContent.slice(0, 60) : null };
});
(focusAfterSkip.tabindex === "-1" && /2 \/ 10/.test(focusAfterSkip.text || ""))
  ? ok("Skip -> next exercise refocuses the drill wrap (exercise 2/10)")
  : bad("focus not refocused after Skip: " + JSON.stringify(focusAfterSkip));

await page.locator("button", { hasText: /^End$/ }).click();
await page.waitForTimeout(150);
const focusAfterEnd = await page.evaluate(() => {
  const a = document.activeElement;
  return { tag: a && a.tagName, tabindex: a && a.getAttribute("tabindex"), text: a ? a.textContent.trim() : null };
});
(focusAfterEnd.tag === "H2" && focusAfterEnd.tabindex === "-1" && /Physical Readiness/i.test(focusAfterEnd.text || ""))
  ? ok("'End' returns to the Hub and moves focus to its heading")
  : bad("focus not on the Hub heading after End: " + JSON.stringify(focusAfterEnd));

// Run it again and skip through every exercise to reach finishDrill().
await page.locator("button", { hasText: /run the drill/i }).click();
await page.waitForTimeout(200);
for (let i = 0; i < 10; i++) {
  await page.locator("button", { hasText: /^Skip →$/ }).click();
  await page.waitForTimeout(80);
}
const focusOnFinish = await page.evaluate(() => {
  const a = document.activeElement;
  return { tabindex: a && a.getAttribute("tabindex"), text: a ? a.textContent.trim() : null };
});
(focusOnFinish.tabindex === "-1" && /Drill complete/i.test(focusOnFinish.text || ""))
  ? ok("finishing the drill refocuses the wrap on its 'Drill complete' summary")
  : bad("focus not on the wrap after finishDrill(): " + JSON.stringify(focusOnFinish));

await page.locator("button", { hasText: /back to physical readiness/i }).click();
await page.waitForTimeout(150);
const focusAfterBack = await page.evaluate(() => {
  const a = document.activeElement;
  return { tag: a && a.tagName, tabindex: a && a.getAttribute("tabindex"), text: a ? a.textContent.trim() : null };
});
(focusAfterBack.tag === "H2" && focusAfterBack.tabindex === "-1" && /Physical Readiness/i.test(focusAfterBack.text || ""))
  ? ok("'Back to Physical Readiness' returns to the Hub and moves focus to its heading")
  : bad("focus not on the Hub heading after 'Back to Physical Readiness': " + JSON.stringify(focusAfterBack));

/* ------------------------------------------------------------------ *
 * Items 2 and 5 on #/recite's Timed Recitation mode.                  *
 * ------------------------------------------------------------------ */

await page.evaluate(() => { location.hash = "#/recite"; });
await page.waitForTimeout(400);
await page.locator("button", { hasText: /^Timed recitation$/ }).click();
await page.waitForTimeout(150);

const clockNoAriaLiveRecite = await page.evaluate(() => {
  const clock = document.querySelector(".rf-timer");
  return !!clock && !clock.hasAttribute("aria-live");
});
clockNoAriaLiveRecite ? ok("Timed Recitation clock carries no aria-live") : bad("Timed Recitation clock unexpectedly has aria-live");

const checklistShape = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
  return {
    count: boxes.length,
    allSiblingShaped: boxes.length > 0 && boxes.every((b) => {
      const lbl = b.nextElementSibling;
      return b.parentElement && b.parentElement.tagName !== "LABEL" &&
        lbl && lbl.tagName === "LABEL" && lbl.getAttribute("for") === b.id && !!b.id;
    }),
  };
});
(checklistShape.count === 4 && checklistShape.allSiblingShaped)
  ? ok("Timed Recitation checklist: every checkbox is a sibling of (not nested inside) its <label for>")
  : bad("checklist checkbox/label shape wrong: " + JSON.stringify(checklistShape));

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `ROUND-TIMER: ${fails} FAILURE(S)` : "ROUND-TIMER: all passed"));
process.exit(fails ? 1 : 0);
