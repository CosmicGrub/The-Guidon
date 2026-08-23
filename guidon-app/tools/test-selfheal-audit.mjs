/**
 * House-rule audit: "failures get caught, then reported as healthy" across
 * every G.selfheal.log( call site (js/selfheal.js). The audit found the four
 * originally-named call sites (Board Drill's SRS-write catch, Data Layer's
 * backup-export catch, Native/PWA's service-worker-registration catch,
 * Diagnostics' own module/route-health check) already closed by an earlier
 * pass - see test-srs-write-failure.mjs, test-backup-roundtrip.mjs and
 * test-selftest.mjs for those. Searching further (as the audit instructions
 * required) turned up two more instances of the exact same shape that had
 * NOT yet been fixed. Both are covered here.
 *
 * ---------------------------------------------------------------------
 * Part 1: profile.js's saveProfile() - the ONE function every profile write
 * in the app funnels through (onboarding's "Save profile & start", the
 * Profile view's "Regenerate plan", the promotion-points quick-estimate's
 * debounced autosave). Its IndexedDB write sat behind a bare
 * `catch(e) {}` - a failed write vanished with zero trace, and
 * `util.emit("profile:change", p)` right below it still fired
 * unconditionally, updating every listening view's in-memory copy as if the
 * save had genuinely reached disk. A reload then silently reverted to the
 * old profile (rank, tier, board date, weak points...) with nothing
 * anywhere to explain why. Fixed with the exact same self-heal-log + toast
 * contract board.js's grade()/noteExternalResult() already established
 * (kind "profile-write-fail").
 *
 * This forces a REAL G.db.put() rejection scoped to the profile row's own
 * key, drives the real "Regenerate plan" button, and proves the failure is
 * no longer silent: (1) a matching G.selfheal entry appears, (2) a
 * user-facing toast appears, and (3) a control run with no injected failure
 * produces neither, so the fix doesn't spam false positives on ordinary use.
 *
 * ---------------------------------------------------------------------
 * Part 2: selftest.js's "Service worker freshness" Fix button. The check
 * itself already correctly reports FAIL for a genuine SW registration
 * failure (pwa.js's registerSW().catch() -> state.swRegFailed - fixed in an
 * earlier pass, see test-selftest.mjs). But the Fix button offered for that
 * FAIL state was the SAME "Fix: update to latest build" button written for
 * a real waiting update (state.swWaiting) - which calls G.pwa.applyUpdate(),
 * a silent no-op when there is no swWaiting (exactly the registration-
 * failure case), so the button just sat disabled at "Updating…" forever
 * AND had already written a self-heal entry CLAIMING "applying a waiting
 * service-worker update" when no update was ever waiting - a false entry in
 * the exact audit trail this convention exists to keep honest. This proves
 * a genuine registration failure (no waiting worker) now offers a
 * DIFFERENT, honest "Fix: retry service worker registration" button
 * instead, and that clicking it logs a truthful self-heal entry (awaited,
 * so it survives the reload the button triggers) rather than the old false
 * claim.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

// ======================================================================
// Part 1: saveProfile() write-failure handling
// ======================================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const noise = [];
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(700);

  // Seed a real, already-onboarded PERSONAL profile directly into storage
  // (a raw db.put, not saveProfile()) with a non-empty actionPlan so the
  // view's own auto-regenerate-on-open path (a separate, already try/catch-
  // wrapped call site) doesn't fire its own saveProfile() before this test
  // gets a chance to control one deliberately via the manual button.
  await page.evaluate(() => window.G.db.put("kv", { k: "guidon:profile:v1", v: {
    displayName: "QA Soldier", lastName: "QA", rank: "SGT", tier: "E5", mos: "11B",
    mode: "personal", guestSession: false, onboardingComplete: true,
    actionPlan: [{ id: "seed", priority: "medium", category: "Test", action: "Seed action", route: "#/home", icon: "▶" }],
    studyWeakPoints: [], readinessConcerns: [], promoPoints: {},
  } }));
  // Reload so profile.js's module-private _cache picks up the seeded row
  // fresh via loadProfile() instead of whatever guest-onboarding state a
  // plain hash change would leave in place (same reasoning test-backup-
  // roundtrip.mjs's own header comment documents for this exact _cache).
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(700);

  const overlayGone = await page.evaluate(() => !document.getElementById("ob-overlay"));
  overlayGone ? ok("A seeded, already-onboarded personal profile skips the onboarding overlay on reload") : bad("onboarding overlay still present after seeding a complete personal profile");

  await page.evaluate(() => { location.hash = "#/profile"; });
  await page.waitForTimeout(500);

  const regenBtn = page.locator("button", { hasText: /Regenerate plan/ });
  (await regenBtn.count()) > 0 ? ok("'Regenerate plan' is reachable from the seeded personal profile") : bad("'Regenerate plan' button not found");

  // Targeted G.db.put() failure switch: rejects only the profile row's own
  // key while every other kv write - including G.selfheal's OWN log entry -
  // still goes through untouched. Mirrors a real IndexedDB failure (quota
  // exceeded, blocked connection) without breaking the rest of the page.
  await page.evaluate(() => {
    window.__realPut = G.db.put.bind(G.db);
    window.__failProfilePut = false;
    G.db.put = (store, value) => {
      if (window.__failProfilePut && store === "kv" && value && value.k === "guidon:profile:v1") {
        return Promise.reject(new Error("simulated profile write failure"));
      }
      return window.__realPut(store, value);
    };
  });

  const failed = await page.evaluate(async () => {
    window.__failProfilePut = true;
    const t = document.getElementById("toast");
    if (t) t.classList.remove("show");
    const before = await window.G.db.get("kv", "guidon:profile:v1");
    document.querySelector("button")?.blur();
    const btn = [...document.querySelectorAll("button")].find((b) => /Regenerate plan/.test(b.textContent || ""));
    btn.click();
    // saveProfile() awaits its own db.put internally before returning, and
    // the button's own click handler awaits saveProfile() - give the round
    // trip (plus G.selfheal.log()'s own fire-and-forget db.get/db.put) a
    // beat to fully settle before reading anything back.
    await new Promise((r) => setTimeout(r, 400));
    window.__failProfilePut = false;
    const after = await window.G.db.get("kv", "guidon:profile:v1");
    const entries = await window.G.selfheal.recent(5);
    const toastEl = document.getElementById("toast");
    const toastShown = !!(toastEl && toastEl.classList.contains("show"));
    const toastText = toastEl ? toastEl.textContent : "";
    return { before, after, entries, toastShown, toastText };
  });

  (failed.before && failed.after && failed.before.v.lastName === failed.after.v.lastName)
    ? ok("the profile row in storage is genuinely untouched by the forced write failure (lastName unchanged)")
    : bad("profile row changed despite the write being forced to fail: " + JSON.stringify({ before: failed.before, after: failed.after }));
  const loggedEntry = failed.entries.find((e) => e.kind === "profile-write-fail");
  loggedEntry
    ? ok("saveProfile()'s swallowed write failure is logged to G.selfheal (kind 'profile-write-fail') - discoverable in Diagnostics")
    : bad("no matching G.selfheal entry for the failed profile write - it is still silently swallowed. Recent entries: " + JSON.stringify(failed.entries));
  (failed.toastShown && /couldn.?t save your profile/i.test(failed.toastText || ""))
    ? ok("a real 'Regenerate plan' click surfaces a failure toast when the profile write underneath it fails")
    : bad("no failure toast appeared after a forced profile write failure: shown=" + failed.toastShown + " text=" + JSON.stringify(failed.toastText));

  // ---- control run: no injected failure means no false-positive noise ----
  const happy = await page.evaluate(async () => {
    const countBefore = await window.G.selfheal.count();
    const t = document.getElementById("toast");
    if (t) t.classList.remove("show");
    const btn = [...document.querySelectorAll("button")].find((b) => /Regenerate plan/.test(b.textContent || ""));
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    const countAfter = await window.G.selfheal.count();
    const toastEl = document.getElementById("toast");
    const toastShown = !!(toastEl && toastEl.classList.contains("show"));
    return { countBefore, countAfter, toastShown };
  });
  (happy.countAfter === happy.countBefore)
    ? ok("a successful profile write does not add a self-heal entry (no false positives)")
    : bad("self-heal count changed on a successful profile write: before=" + happy.countBefore + " after=" + happy.countAfter);
  !happy.toastShown
    ? ok("a successful profile write does not toast a failure warning")
    : bad("failure toast incorrectly shown after a successful profile write");

  noise.length === 0 ? ok("Part 1: no page errors") : bad("Part 1: " + noise.length + " page errors; first: " + noise[0]);
  await page.close();
}

// ======================================================================
// Part 2: "Service worker freshness" Fix button - registration-failure case
// ======================================================================
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const noise = [];
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

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

  // Same simulation test-selftest.mjs's own item-7 coverage uses: no real
  // second deploy exists in this test server, so a genuine registration
  // failure is simulated by stubbing the one field the check actually
  // reads - deliberately with NO state.swWaiting set, which is exactly the
  // "outright registration failure" case (as opposed to "update waiting").
  await page.evaluate(() => { window.G.pwa.state.swRegFailed = "simulated registration failure (QA)"; });
  await page.locator("button.btn.primary.sm").click();
  await page.waitForTimeout(400);

  const swFailCatText = await page.evaluate(() => {
    const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
    const cat = cats.find((n) => /service worker freshness/i.test(n.textContent || ""));
    return cat ? cat.closest(".card").textContent : null;
  });
  (swFailCatText && swFailCatText.indexOf("✕") !== -1 && /simulated registration failure/.test(swFailCatText))
    ? ok("'Service worker freshness' still reports FAIL and names the real error for an outright registration failure")
    : bad("Service worker freshness card text with swRegFailed set: " + swFailCatText);

  const staleUpdateBtnCount = await page.locator("button", { hasText: /Fix: update to latest build/ }).count();
  staleUpdateBtnCount === 0
    ? ok("an outright registration failure (no waiting worker) does NOT offer 'Fix: update to latest build' - there is nothing waiting to apply")
    : bad("'Fix: update to latest build' incorrectly offered for a registration failure with no waiting worker - clicking it would silently no-op");
  const retryBtnCount = await page.locator("button", { hasText: /Fix: retry service worker registration/ }).count();
  retryBtnCount > 0
    ? ok("an outright registration failure instead offers 'Fix: retry service worker registration'")
    : bad("no retry Fix button offered for an outright SW registration failure");

  // Clicking the retry button triggers a real location.reload() - wait for
  // the navigation the same way test-profile-guest-guard.mjs's own Kiosk
  // "Switch account or mode" click does.
  await Promise.all([
    page.waitForEvent("load", { timeout: 10000 }),
    page.locator("button", { hasText: /Fix: retry service worker registration/ }).click(),
  ]);
  await page.waitForTimeout(500);

  // G.selfheal reads from IndexedDB, which survives the reload regardless
  // of what page/session state the fresh load lands on - so the entry the
  // click wrote (now awaited before location.reload() fires, specifically
  // to avoid losing it to the navigation) must still be there.
  const entries = await page.evaluate(() => window.G.selfheal.recent(10));
  const retryEntry = entries.find((e) => e.kind === "repair" && e.key === "sw-retry" && /simulated registration failure/.test(e.detail || ""));
  retryEntry
    ? ok("clicking the retry Fix button logs an honest 'sw-retry' self-heal entry naming the real failure, and it survives the reload it triggers")
    : bad("no matching 'sw-retry' self-heal entry found after the reload. Recent entries: " + JSON.stringify(entries));
  const falseUpdateEntry = entries.find((e) => e.kind === "repair" && e.key === "sw-update" && /simulated registration failure/.test(e.detail || ""));
  !falseUpdateEntry
    ? ok("no false 'sw-update: applying a waiting service-worker update' entry was written for this registration-failure case")
    : bad("a false 'sw-update' entry was written even though no update was ever waiting: " + JSON.stringify(falseUpdateEntry));

  noise.length === 0 ? ok("Part 2: no page errors") : bad("Part 2: " + noise.length + " page errors; first: " + noise[0]);
  await page.close();
}

await browser.close();
server.close();
console.log("\n" + (fails ? `SELFHEAL AUDIT: ${fails} FAILURE(S)` : "SELFHEAL AUDIT: all passed"));
process.exit(fails ? 1 : 0);
