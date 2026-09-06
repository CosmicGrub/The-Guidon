/**
 * Shared onboarding dismissal helper (re-check 2026-09-05 follow-up).
 *
 * tools/test-nav-tier1.mjs landed the first fix for a real flake: in a COLD
 * first browser context the onboarding overlay (#ob-overlay, z-index 9000)
 * mounts after the app's first IndexedDB read - measured 2026-09-05, booted
 * but no #ob-overlay at 700 ms, present at 1400 ms; warm contexts have it at
 * 700 ms. A suite that dismissed onboarding with a fixed
 * `waitForTimeout(700)` before clicking the guest-session card would miss it
 * in the cold case, leave the overlay up, and time out on the next real
 * click behind it (measured 2 of 5 runs on tools/test-nav-tier1.mjs before
 * the fix). ~37 other tools/test-*.mjs suites and harnesses still carry that
 * old timed idiom (see tools/lint-patterns.mjs check (d)/(e), which fails
 * naming every one).
 *
 * The re-check critic's flagged soft spot in the landed fix: every one of
 * those copies swallows a missing guest card with `.catch(() => {})` on the
 * waitFor, then falls straight through to click a locator that may not
 * exist - a silent miss just becomes a different, more confusing failure
 * two lines later, with no clue what actually went wrong. This module never
 * does that: every miss is a thrown Error naming the step that failed and
 * what was actually on screen (the overlay's own attached/detached state,
 * plus the first 200 chars of document.body.innerText) so a real regression
 * fails loudly, at the point of failure, with a diagnosable message -
 * instead of silently sailing through and surfacing three assertions later
 * as an unrelated-looking timeout.
 */

const GUEST_CARD_SELECTOR = ".ob-mode-card";
const OVERLAY_SELECTOR = "#ob-overlay";
/* Single source of truth for the onboarding mode-select step's card text
   (src/index.html's renderModeStep(): "Personal Account" / "Guest Session" /
   "Kiosk / Demo Mode" - see modeBtn() calls there). Exported so
   tools/lint-patterns.mjs's check (e) can match against these same regexes
   instead of hand-copying them - one place these strings live, per the
   round-3 onboarding-migration rules ("do not hand-copy them into the lint
   file; require the lint to import or otherwise read the same source of
   truth"). Add a new real mode here (and nowhere else) if one ever ships. */
export const MODE_TEXT = {
  guest: /guest session/i,
  kiosk: /kiosk/i,
  personal: /personal account/i,
};
/* NOT a reliable "onboarding was decided" signal, on its own: buildShell()
   appends the main nav (.nav, used by both the >=600px sidebar and the
   <600px flat bar) and the topbar (.topbar) as the FIRST thing app.start()
   does, synchronously, before the async `await store.init()` that gates the
   onboarding decision even begins. Measured 2026-09-05: shell ready ~450ms
   after navigation start, #ob-overlay attached ~1100-1600ms after - a real
   ~700ms-1s+ gap from IndexedDB open latency, not a rendering-frame delay,
   and NOT shrunk by CPU throttling (it isn't CPU-bound). Kept only for the
   diagnostic message below; do not use it to decide anything. */
const SHELL_READY_JS = () => !!(document.querySelector(".nav") || document.querySelector(".topbar"));
const OVERLAY_PRESENT_JS = () => !!document.querySelector("#ob-overlay");
/* The REAL "onboarding decision has been made" signal: app.start() appends a
   `<div class="empty">Loading GUIDON…</div>` placeholder into #route
   (routeEl) BEFORE the async store.init()/needsOnboarding() read, and
   route() - called only once that read resolves, in EITHER the
   onboarding-needed branch or the no-onboarding branch, always as the very
   first synchronous act - clears it via util.clear(routeEl). So "the
   placeholder is gone" happens-after the decision, regardless of how long
   the IndexedDB read actually took; unlike SHELL_READY_JS it can't fire
   before the decision exists. See dismissOnboarding()'s own comment for how
   this is used. */
const BOOT_DECIDED_JS = () => {
  const r = document.getElementById("route");
  return !r || !/Loading GUIDON/.test(r.textContent || "");
};
const BODY_SNIPPET_JS = () => (document.body ? (document.body.innerText || "").slice(0, 200) : "");

async function screenDiagnostics(page) {
  try {
    return await page.evaluate(() => ({
      overlayPresent: (() => !!document.querySelector("#ob-overlay"))(),
      bodySnippet: (() => (document.body ? (document.body.innerText || "").slice(0, 200) : ""))(),
    }));
  } catch (e) {
    return { overlayPresent: null, bodySnippet: "(could not read page: " + e.message + ")" };
  }
}

/**
 * dismissOnboarding(page, { timeoutMs = 8000, mode = "guest" } = {})
 *
 * `mode` selects which mode-select card to dismiss onboarding with, keyed
 * into the MODE_TEXT map above (default "guest", so every pre-existing
 * caller that never passed `mode` keeps picking the guest-session card
 * exactly as before). Pass "kiosk" or "personal" for the other two real
 * onboarding modes.
 *
 * Returns { dismissed: false, alreadyClear: true } when #ob-overlay is not
 * attached within 300 ms AND, after genuinely waiting (up to timeoutMs) for
 * app.start()'s async onboarding decision to resolve (BOOT_DECIDED_JS - see
 * its own comment; NOT a fixed sleep and NOT merely ".nav/.topbar exists",
 * which is true long before the decision is made) plus one settled
 * animation frame, the overlay still hasn't shown up - the common
 * warm-context case where onboarding was already dismissed by an earlier
 * page in the same context.
 *
 * Otherwise waits (up to timeoutMs) for the selected mode's card to become
 * visible - primarily `.ob-mode-card` matching MODE_TEXT[mode], falling
 * back to any `[role=button]`/`button` matching the same text - clicks it
 * via Playwright, then waits (up to 6 s) for #ob-overlay to detach.
 *
 * On ANY miss (no card found by either selector AND the shell is not
 * already clear, or the overlay never detaches after the click) this
 * THROWS an Error naming the step that failed and what was on screen. It
 * never swallows a miss with an empty catch.
 */
export async function dismissOnboarding(page, { timeoutMs = 8000, mode = "guest" } = {}) {
  const t0 = Date.now();
  const textRe = MODE_TEXT[mode];
  if (!textRe) {
    throw new Error(`dismissOnboarding: unknown mode "${mode}" - expected one of: ${Object.keys(MODE_TEXT).join(", ")}`);
  }

  let overlayAttachedEarly = true;
  try {
    await page.locator(OVERLAY_SELECTOR).waitFor({ state: "attached", timeout: 300 });
  } catch (e) {
    overlayAttachedEarly = false;
  }

  if (!overlayAttachedEarly) {
    // Root cause of a reproduced flake (2026-09-05, test-resize-storm.mjs
    // under 3-way concurrency, node tools/run-parallel.mjs test:doctrine-
    // card-grid test:resize-storm test:board-card-overflow at
    // GUIDON_TEST_CONCURRENCY=3): this used to check SHELL_READY_JS
    // (.nav/.topbar) here and treat it as proof onboarding was already
    // dismissed. It is not - buildShell() appends .nav/.topbar
    // SYNCHRONOUSLY, before the async `await store.init()` that gates the
    // onboarding decision even starts, so shell-ready was already true well
    // before the decision existed, let alone before any overlay could have
    // been scheduled. Measured directly with CDP CPU throttling (both 1x and
    // 20x): shell ready ~450ms after navigation start, #ob-overlay attached
    // ~1.1-1.6s after - a real IndexedDB-open gap of 700ms-1s+, not shrunk
    // by throttling (it's I/O, not CPU-bound) and nowhere close to bridged
    // by the original 300ms window or by an added animation-frame wait (both
    // tried and both still let a false "alreadyClear" through in testing).
    // The fix: wait for BOOT_DECIDED_JS - a signal that only becomes true
    // AFTER the decision is made, in either branch, by construction (see its
    // own comment) - instead of guessing how long that decision takes.
    try {
      await page.waitForFunction(BOOT_DECIDED_JS, null, { timeout: timeoutMs });
    } catch (e) {
      // Never got past the boot placeholder within the whole budget - fall
      // through to the guest-card wait below, which will time out on its
      // own with a diagnosable message naming what was on screen.
    }
    // The onboarding-needed branch registers the #ob-overlay append in a
    // requestAnimationFrame callback immediately after route() runs, in the
    // same synchronous tick that clears the boot placeholder BOOT_DECIDED_JS
    // just confirmed happened - so wait for the browser to actually service
    // a frame (a real happens-before check, not a fixed sleep: our callback,
    // registered only after that tick, is guaranteed to run after any rAF
    // already queued in it) before concluding no overlay is coming. Double
    // rAF matches this file's own "wait a full paint cycle" idiom elsewhere.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const overlayShowedUp = await page.locator(OVERLAY_SELECTOR).count();
    if (!overlayShowedUp) return { dismissed: false, alreadyClear: true };
    // else: the overlay mounted right behind the decision - fall through and
    // handle it exactly like any other mount below.
  }

  const primaryCard = page.locator(GUEST_CARD_SELECTOR, { hasText: textRe }).first();
  let target = primaryCard;
  let found = false;
  try {
    await primaryCard.waitFor({ state: "visible", timeout: timeoutMs });
    found = true;
  } catch (e) {
    found = false;
  }

  if (!found) {
    const fallbackCard = page.locator("[role=button], button").filter({ hasText: textRe }).first();
    try {
      await fallbackCard.waitFor({ state: "visible", timeout: 1500 });
      target = fallbackCard;
      found = true;
    } catch (e) {
      found = false;
    }
  }

  if (!found) {
    // Last chance: maybe onboarding was dismissed by the time we got here
    // (a race with another page in the same context) - only accept that as
    // success if BOTH the shell is up and the overlay is genuinely gone,
    // never just "we didn't find the card".
    const shellReady = await page.evaluate(SHELL_READY_JS).catch(() => false);
    const overlayGone = (await page.locator(OVERLAY_SELECTOR).count().catch(() => 1)) === 0;
    if (shellReady && overlayGone) return { dismissed: false, alreadyClear: true };

    const diag = await screenDiagnostics(page);
    throw new Error(
      `dismissOnboarding: could not find the "${mode}" mode card ` +
      `(neither ${GUEST_CARD_SELECTOR} nor a [role=button]/button matching ${textRe} became visible ` +
      `within ${timeoutMs}ms) and the app is not already past onboarding. ` +
      `overlay present: ${diag.overlayPresent}; body text starts: ${JSON.stringify(diag.bodySnippet)}`
    );
  }

  await target.click();

  try {
    await page.locator(OVERLAY_SELECTOR).waitFor({ state: "detached", timeout: 6000 });
  } catch (e) {
    const diag = await screenDiagnostics(page);
    throw new Error(
      `dismissOnboarding: clicked the "${mode}" mode card but ${OVERLAY_SELECTOR} did not detach within 6000ms. ` +
      `overlay present: ${diag.overlayPresent}; body text starts: ${JSON.stringify(diag.bodySnippet)}`
    );
  }

  return { dismissed: true, ms: Date.now() - t0 };
}

/**
 * pastOnboarding(page, url, opts)
 *
 * Convenience for the common `goto(url, { waitUntil: "load" })` then
 * dismissOnboarding(page, opts) pattern most suites open with. Returns
 * whatever dismissOnboarding() returns; throws the same way it does.
 */
export async function pastOnboarding(page, url, opts) {
  await page.goto(url, { waitUntil: "load" });
  return dismissOnboarding(page, opts);
}
