/**
 * Upgrade-roadmap first wave, item 11: engine.js's in-session mode switcher
 * (renderHeader()'s "Text / Course / Adventure / Training" segmented
 * control) used to call restart(sess, m) unconditionally on click. For the
 * 8 real mandatory-training scenarios - 7 of which list a non-training
 * mode alongside "training" in their own renderModes, so the switcher
 * itself offers the trap - renderTrainingOutcome() (the only path that
 * ever writes to trainingCompletions/bestPct, which the 80%-pass tracking
 * on Home/Learn/Progress all read) is reached ONLY when sess.mode ===
 * "training". Tapping "Course" mid-module silently threw that away with no
 * warning. This drives G.engine.run() directly (the same public API the
 * real Train view calls) so the test doesn't depend on Train's own card
 * layout, and exercises the real in-session header buttons.
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
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(400);

// Verified against the real seed: "sc-train-opsec" is a real mandatory-
// training scenario whose own renderModes lists "course" alongside
// "training" - exactly the trap this item scoped.
const seedCheck = await page.evaluate(() => {
  const sc = window.G.store.scenario("sc-train-opsec");
  return sc ? { defaultMode: sc.defaultMode, renderModes: sc.renderModes } : null;
});
(seedCheck && seedCheck.defaultMode === "training" && (seedCheck.renderModes || []).includes("course"))
  ? ok("sc-train-opsec is a real training scenario that also lists 'course' in its own renderModes")
  : bad("seed scenario shape: " + JSON.stringify(seedCheck));

// Mount a real session via G.engine.run() (the same public API #/train
// itself calls) into a real, attached container so the header's mode
// switcher can actually be clicked.
await page.evaluate(() => {
  const host = document.createElement("div");
  host.id = "qa-engine-host";
  document.body.appendChild(host);
  window.G.engine.run("sc-train-opsec", "training", host, null);
});
await page.waitForTimeout(400);

const activeMode = await page.evaluate(() => {
  const seg = document.querySelector("#qa-engine-host .segmented");
  const active = seg ? seg.querySelector("button.active") : null;
  return active ? active.textContent.trim() : null;
});
activeMode === "Training" ? ok("session starts in real Training mode with the switcher showing it active") : bad("active mode button: " + activeMode);

// --- Clicking "Course" mid-training must warn first, and Cancel must abort ---
await page.evaluate(() => {
  const seg = document.querySelector("#qa-engine-host .segmented");
  const btn = [...seg.querySelectorAll("button")].find((b) => b.textContent.trim() === "Course");
  btn.click();
});
await page.waitForTimeout(400);
const warnedText = await page.evaluate(() => (document.querySelector(".gm-box") || {}).textContent || "");
(/mandatory-training completion/.test(warnedText) && /Training mode/.test(warnedText))
  ? ok("switching away from Training mode shows a real confirm naming the mandatory-training consequence")
  : bad("confirm dialog text: " + warnedText);

await page.evaluate(() => {
  const b = [...document.querySelectorAll(".gm-box button")].find((x) => /cancel/i.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(400);
const stillTraining = await page.evaluate(() => {
  const seg = document.querySelector("#qa-engine-host .segmented");
  const active = seg ? seg.querySelector("button.active") : null;
  return active ? active.textContent.trim() : null;
});
stillTraining === "Training" ? ok("cancelling the warning keeps the session in Training mode (no silent restart)") : bad("mode after cancelling: " + stillTraining);

// --- Confirming actually switches, as a deliberate, informed choice ---
await page.evaluate(() => {
  const seg = document.querySelector("#qa-engine-host .segmented");
  const btn = [...seg.querySelectorAll("button")].find((b) => b.textContent.trim() === "Course");
  btn.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".gm-box button")].find((x) => /switch anyway/i.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(400);
const nowCourse = await page.evaluate(() => {
  const seg = document.querySelector("#qa-engine-host .segmented");
  const active = seg ? seg.querySelector("button.active") : null;
  return active ? active.textContent.trim() : null;
});
nowCourse === "Course" ? ok("confirming 'Switch anyway' actually restarts the session in Course mode") : bad("mode after confirming: " + nowCourse);

// --- Switching between two NON-training modes must never show the warning
// at all - it is specifically about leaving Training mode, not every switch. ---
await page.evaluate(() => {
  const seg = document.querySelector("#qa-engine-host .segmented");
  const btn = [...seg.querySelectorAll("button")].find((b) => b.textContent.trim() === "Adventure");
  btn.click();
});
await page.waitForTimeout(400);
const dialogAfterNonTrainingSwitch = await page.evaluate(() => document.querySelectorAll(".gm-box").length);
dialogAfterNonTrainingSwitch === 0 ? ok("switching between two non-training modes (Course -> Adventure) never shows the warning") : bad("unexpected confirm dialog(s) on a non-training-to-non-training switch: " + dialogAfterNonTrainingSwitch);
const nowAdventure = await page.evaluate(() => {
  const seg = document.querySelector("#qa-engine-host .segmented");
  const active = seg ? seg.querySelector("button.active") : null;
  return active ? active.textContent.trim() : null;
});
nowAdventure === "Adventure" ? ok("the non-training-to-non-training switch still actually happens, unblocked") : bad("mode after switching Course -> Adventure: " + nowAdventure);

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nTRAIN MODE GUARD: all passed");
process.exit(fails ? 1 : 0);
