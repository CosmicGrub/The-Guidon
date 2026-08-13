/**
 * Onboarding wizard (renderOnboarding, reached fresh on first run and via
 * Profile's "Redo my setup"): the generic route sweep never opens it past
 * whatever state a fresh guest session happens to start in, so none of its
 * step-to-step behavior had dedicated coverage - specifically the three
 * things fixed for it in past weeks: the Back button actually preserving
 * already-entered data across a re-render (not just visually stepping back),
 * Escape mirroring Back (and being a no-op on step 0, which has nothing
 * before it), and abandoning the wizard mid-flow (navigating to another view
 * before finishing) not leaking a permanent document-level keydown listener
 * per attempt (#82). This exercises all three against the real "Redo my
 * setup" re-entrant path, which — unlike the first-run full-screen overlay —
 * keeps the app's own nav reachable around the wizard and is the only path
 * a user can actually abandon mid-flow from.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);

// Walk the FIRST-RUN overlay once for real, all the way to a saved personal
// profile - rather than seeding guidon:profile:v1 directly. renderOnboarding
// keeps its own module-private _cache (profile.current() prefers it over a
// fresh IndexedDB read), and only the real "Save profile & start" button
// populates that cache correctly; a raw db.put here would leave _cache
// stale/empty and #/profile would still show the overlay underneath.
await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).waitFor({ state: "visible", timeout: 8000 });
await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).click();
await page.waitForTimeout(300);
await page.locator(".ob-rank-btn", { hasText: /^SSG$/ }).click();
await page.locator("button.ob-next", { hasText: /Next/ }).click(); // identity -> role
await page.waitForTimeout(300);
await page.locator("button.ob-next", { hasText: /Next/ }).click(); // role -> concerns
await page.waitForTimeout(300);
await page.locator("button.ob-next", { hasText: /Next/ }).click(); // concerns -> weakpoints
await page.waitForTimeout(300);
await page.locator("button", { hasText: /Build my plan/ }).click(); // weakpoints -> boarddate
await page.waitForTimeout(300);
await page.locator("button", { hasText: /^Skip$/ }).click(); // boarddate -> summary
await page.waitForTimeout(300);
await page.locator("button", { hasText: /Save profile & start/ }).click();
await page.waitForTimeout(500);

await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(500);

const redoVisible = await page.locator("button", { hasText: /Redo my setup/ }).count();
redoVisible ? ok("'Redo my setup' is reachable with a seeded complete profile") : bad("Redo my setup button not found");

await page.locator("button", { hasText: /Redo my setup/ }).click();
await page.waitForTimeout(300);
const onModeStep = await page.evaluate(() => /How are you using GUIDON/.test(document.body.textContent || ""));
onModeStep ? ok("Redo my setup re-opens the wizard at the mode-select step") : bad("wizard did not re-open at mode-select");

await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).click();
await page.waitForTimeout(300);
const onIdentityStep = await page.evaluate(() => /Who are you/.test(document.body.textContent || ""));
onIdentityStep ? ok("Choosing Personal Account advances to the identity step") : bad("did not reach identity step");

const seededRankActive = await page.locator(".ob-rank-btn.active").textContent();
seededRankActive?.trim() === "SSG" ? ok("Identity step pre-fills the seeded rank (SSG) via existingProfile") : bad("seeded rank not pre-filled: " + seededRankActive);

// Change the rank to something else, so we have a real before/after value
// to check survives a Back navigation.
await page.locator(".ob-rank-btn", { hasText: /^SFC$/ }).click();
await page.waitForTimeout(100);
await page.locator("button.ob-next", { hasText: /Next/ }).click();
await page.waitForTimeout(300);

// ---- Back button: goes back one step AND keeps the changed rank ----
const onRoleStep = await page.evaluate(() => /Your role/.test(document.body.textContent || ""));
onRoleStep ? ok("Advanced to the role step (2 of 5)") : bad("did not reach role step");

await page.locator("button.ob-back", { hasText: /Back/ }).click();
await page.waitForTimeout(300);
const backOnIdentity = await page.evaluate(() => /Who are you/.test(document.body.textContent || ""));
backOnIdentity ? ok("Back button returns to the identity step") : bad("Back did not return to identity step");
const rankAfterBack = await page.locator(".ob-rank-btn.active").textContent();
rankAfterBack?.trim() === "SFC" ? ok("The rank change (SFC) survived the Back navigation, not reset to the seeded value") : bad("rank after Back: " + rankAfterBack);

// ---- Escape mirrors Back ----
await page.locator("button.ob-next", { hasText: /Next/ }).click();
await page.waitForTimeout(300);
const backOnRole = await page.evaluate(() => /Your role/.test(document.body.textContent || ""));
backOnRole ? ok("Next re-advances to the role step") : bad("did not re-advance to role step");

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const escBackOnIdentity = await page.evaluate(() => /Who are you/.test(document.body.textContent || ""));
escBackOnIdentity ? ok("Escape steps back exactly like the Back button") : bad("Escape did not step back");

// Escape again should reach mode-select (step 0) and then be a no-op there.
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const escBackOnMode = await page.evaluate(() => /How are you using GUIDON/.test(document.body.textContent || ""));
escBackOnMode ? ok("A second Escape reaches the mode-select step (step 0)") : bad("second Escape did not reach mode-select");

await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const stillOnMode = await page.evaluate(() => /How are you using GUIDON/.test(document.body.textContent || ""));
stillOnMode ? ok("Escape on step 0 is a no-op (nothing before mode-select to go back to)") : bad("Escape on step 0 unexpectedly changed the view");

// ---- abandonment: no leaked document keydown listener ----
// Leave the current (still-open, abandoned-on-step-0) wizard instance first -
// setting location.hash to the value it already holds is a no-op, so without
// this the next "navigate to #/profile" below wouldn't actually re-render.
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
// Flush that instance's own now-stale listener via one keypress BEFORE
// instrumenting, so the counter below starts from a real zero baseline
// instead of inheriting an already-registered-but-uncounted listener.
await page.keyboard.press("a");
await page.waitForTimeout(150);

// Instrument BEFORE opening a fresh wizard instance so we only count
// listeners this test adds, not any pre-existing app-level keydown handlers.
await page.evaluate(() => {
  window.__kd = 0;
  const origAdd = document.addEventListener.bind(document);
  const origRemove = document.removeEventListener.bind(document);
  document.addEventListener = function (type, fn, opts) { if (type === "keydown" && opts === true) window.__kd++; return origAdd(type, fn, opts); };
  document.removeEventListener = function (type, fn, opts) { if (type === "keydown" && opts === true) window.__kd--; return origRemove(type, fn, opts); };
});

await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(300);
await page.locator("button", { hasText: /Redo my setup/ }).click();
await page.waitForTimeout(300);
await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).click();
await page.waitForTimeout(300);

let kdAfterOpen = await page.evaluate(() => window.__kd);
kdAfterOpen === 1 ? ok("Opening the wizard registers exactly one capture-phase keydown listener") : bad("keydown listener count after open: " + kdAfterOpen);

// Abandon mid-flow: navigate away without finishing or pressing Escape.
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
let kdAfterAbandon = await page.evaluate(() => window.__kd);
kdAfterAbandon === 1 ? ok("Abandoning mid-flow does not immediately remove the listener (expected - self-cleans on next keydown, not on navigation)") : bad("unexpected listener count right after abandoning: " + kdAfterAbandon);

// The very next keydown anywhere in the app should self-clean it.
await page.keyboard.press("a");
await page.waitForTimeout(150);
let kdAfterKeypress = await page.evaluate(() => window.__kd);
kdAfterKeypress === 0 ? ok("The next keydown anywhere in the app self-unregisters the abandoned wizard's listener") : bad("listener count after the cleanup keydown: " + kdAfterKeypress);

// Repeat the abandon cycle a few times and confirm it never accumulates -
// this is the actual regression #82 fixed (one leaked listener per attempt).
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { location.hash = "#/profile"; });
  await page.waitForTimeout(200);
  await page.locator("button", { hasText: /Redo my setup/ }).click();
  await page.waitForTimeout(200);
  await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).click();
  await page.waitForTimeout(200);
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(150);
  await page.keyboard.press("a");
  await page.waitForTimeout(150);
}
const kdFinal = await page.evaluate(() => window.__kd);
kdFinal === 0 ? ok("3 more abandon+cleanup cycles leave the listener count at 0 - no unbounded accumulation") : bad("listener count after repeated abandon cycles: " + kdFinal);

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nONBOARDING: all passed");
process.exit(fails ? 1 : 0);
