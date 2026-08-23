/**
 * Diagnostics AUTO check "Theme registry / pre-paint sync" (js/selftest.js,
 * id:"themeSync"): a companion to tools/test-theme-id-sync.mjs's BUILD-time
 * guarantee, but for the RUNNING app.
 *
 * BACKGROUND: tools/build.mjs's deriveThemeIds() regenerates the pre-paint
 * bootstrap <script>'s hand-copied "var T=[...]" theme-id list from the real
 * THEMES registry at build time, so a checked-out repo built the normal way
 * can never ship the drift that once caused a real flash-of-wrong-theme for
 * the ten "Focus set" themes (see test-theme-id-sync.mjs's header for that
 * incident). That guarantee lives entirely in the build step, though - it
 * proves nothing about a build where the step was skipped, reverted, or
 * hand-edited after the fact. The "themeSync" AUTO check exists so that
 * failure mode is caught by the app itself, in Diagnostics, rather than
 * staying silent until a Soldier notices a flash on-screen.
 *
 * This file proves two things a passing build-time test alone cannot:
 *   PART A - on the REAL build.mjs output, the check reports PASS, reading
 *            the live pre-paint <script>'s actual text and G.theme's live
 *            THEME_IDS - not a fixture, the genuine artifact under test.
 *   PART B - when the two are desynced, the check reports FAIL with a
 *            message naming exactly which id(s) are missing/extra. The
 *            desync is simulated by rewriting the ALREADY-LOADED page's own
 *            pre-paint <script> node's textContent in the live DOM after
 *            the real build has loaded and run normally - never by editing
 *            dist/, web/, or any file on disk. This is exactly the failure
 *            shape a bypassed or broken build step would actually produce:
 *            the shipped pre-paint list disagreeing with the shipped THEMES
 *            registry. Both a missing-id and an extra-id case are checked,
 *            since a naive implementation could pass one without the other
 *            (e.g. a length-only comparison, or a one-directional diff).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function newPageAtSelftest() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(700);
  const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guestCard.count()) {
    await guestCard.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = "#/selftest"; });
  await page.waitForTimeout(500);
  return { context, page };
}

// Reads the "themeSync" check's own rendered card after a run - by the
// check's real "name" text, exactly like a Soldier reading Diagnostics
// would, not by reaching into G.selftest internals.
async function readThemeSyncCard(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".panel .card"));
    const c = cards.find((x) => /Theme registry \/ pre-paint sync/.test(x.textContent || ""));
    if (!c) return null;
    return {
      pass: /^✓/.test(c.querySelector(".ob-plan-cat")?.textContent || ""),
      detail: c.querySelector(".hint")?.textContent || "",
    };
  });
}

// ============================================================
// PART A - real, unmodified build.mjs output: the check passes
// ============================================================
{
  const { context, page } = await newPageAtSelftest();

  const realThemeCount = await page.evaluate(() => (window.G && G.theme && G.theme.ids && G.theme.ids.themes || []).length);
  realThemeCount > 0 ? ok(`G.theme.ids.themes is exposed on the real build (${realThemeCount} theme ids)`) : bad("G.theme.ids.themes missing or empty on the real build - cannot proceed");

  await page.locator("button", { hasText: /Run automated checks/ }).click();
  await page.waitForTimeout(1200);

  const result = await readThemeSyncCard(page);
  result
    ? (result.pass
        ? ok(`"Theme registry / pre-paint sync" PASSES on the real, unmodified build - ${result.detail}`)
        : bad(`"Theme registry / pre-paint sync" unexpectedly FAILED on a clean build.mjs output: ${result.detail}`))
    : bad('"Theme registry / pre-paint sync" card not found at all - check id/name may have changed');

  await context.close();
}

// ============================================================
// PART B - simulated drift: rewrite the LIVE pre-paint <script> node's
// textContent (DOM only, nothing on disk) to remove one real theme id and
// add one that was never registered, then confirm the check catches BOTH
// directions and names them.
// ============================================================
{
  const { context, page } = await newPageAtSelftest();

  const patch = await page.evaluate(() => {
    const scripts = Array.from(document.scripts || []);
    const prePaint = scripts.find((s) => /GUIDON pre-paint appearance/.test(s.textContent || ""));
    if (!prePaint) return { ok: false, reason: "pre-paint <script> not found" };
    const m = /var T=(\[[^\]]*\])/.exec(prePaint.textContent);
    if (!m) return { ok: false, reason: '"var T=[...]" not found in pre-paint script text' };
    const ids = JSON.parse(m[1]);
    if (!ids.length) return { ok: false, reason: "pre-paint id list is empty" };
    const removed = ids[0];
    const injected = "zz-canary-desync-theme-" + Date.now();
    const desynced = ids.slice(1).concat([injected]);
    prePaint.textContent = prePaint.textContent.replace(m[0], "var T=" + JSON.stringify(desynced));
    return { ok: true, removed, injected };
  });

  patch.ok
    ? ok(`Live pre-paint <script> textContent rewritten in-page (DOM only) - removed "${patch.removed}", injected "${patch.injected}"`)
    : bad("Could not simulate a desync: " + patch.reason);

  if (patch.ok) {
    await page.locator("button", { hasText: /Run automated checks/ }).click();
    await page.waitForTimeout(1200);

    const result = await readThemeSyncCard(page);
    if (!result) {
      bad('"Theme registry / pre-paint sync" card not found after simulating drift');
    } else {
      !result.pass
        ? ok(`"Theme registry / pre-paint sync" correctly reports FAIL once the pre-paint list is desynced: ${result.detail}`)
        : bad(`"Theme registry / pre-paint sync" reported PASS despite a simulated desync - detail: ${result.detail}`);

      result.detail.includes(patch.removed)
        ? ok(`FAIL detail names the missing id ("${patch.removed}")`)
        : bad(`FAIL detail does not name the missing id "${patch.removed}": ${result.detail}`);

      result.detail.includes(patch.injected)
        ? ok(`FAIL detail names the extra id ("${patch.injected}")`)
        : bad(`FAIL detail does not name the extra id "${patch.injected}": ${result.detail}`);
    }
  }

  await context.close();
}

await browser.close();
await server.close();

console.log("\n" + (fails ? `THEME SELFTEST CHECK: ${fails} FAILURE(S)` : "THEME SELFTEST CHECK: all passed"));
process.exit(fails ? 1 : 0);
