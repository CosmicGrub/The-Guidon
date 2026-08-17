/**
 * Backup export -> import (G.backup, Profile view's "Backup & restore"
 * panel): existing coverage (test-privacy.mjs) only calls G.backup.exportAll
 * directly and checks its payload shape - nothing ever clicked the real
 * "Export backup" button, downloaded the actual file, fed it back through
 * the real "Import backup" file input, confirmed the real G.modal.confirm
 * dialog, or watched the app actually reload and restore from it. This
 * exercises the whole real UI round trip end to end: seed a distinguishing
 * IDP goal -> click Export -> capture the real download -> wipe the goal ->
 * click Import -> pick the downloaded file -> confirm the dialog -> the app
 * reloads -> the goal is back.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);

// Walk a real personal-account onboarding to a saved profile - same reasoning
// as test-onboarding.mjs: profile.current()'s module-private _cache means a
// raw db.put alone would leave the Profile view still showing the overlay.
await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).waitFor({ state: "visible", timeout: 8000 });
await page.locator(".ob-mode-card", { hasText: /Personal Account/i }).click();
await page.waitForTimeout(300);
await page.locator(".ob-rank-btn", { hasText: /^SSG$/ }).click();
await page.locator("button.ob-next", { hasText: /Next/ }).click();
await page.waitForTimeout(300);
await page.locator("button.ob-next", { hasText: /Next/ }).click();
await page.waitForTimeout(300);
await page.locator("button.ob-next", { hasText: /Next/ }).click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: /Build my plan/ }).click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: /^Skip$/ }).click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: /Save profile & start/ }).click();
await page.waitForTimeout(500);

const MARKER = "QA-BACKUP-ROUNDTRIP-GOAL-" + Date.now();
await page.evaluate((marker) => window.G.db.setSetting("idp:goals", [
  { id: "g1", goal: marker, status: "open", domain: "leads", createdAt: Date.now() },
]), MARKER);

await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(500);

const panelVisible = await page.locator(".backup-panel").count();
panelVisible ? ok("Backup & restore panel renders on the Profile view") : bad("backup panel not found");

// Upgrade-roadmap first wave, item 5: before any export has ever happened
// on this fresh device, the hint should say so plainly, not show a blank
// line or a stale-but-blank state.
const neverBackedUp = await page.evaluate(() => (document.querySelector(".last-backup-status") || {}).textContent || "");
/haven't exported/.test(neverBackedUp) ? ok("A device that has never been backed up says so plainly") : bad("never-backed-up hint: " + neverBackedUp);

// ---- real Export: click the button, capture the real download ----
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.locator("button", { hasText: /Export backup/ }).click(),
]);
const suggested = download.suggestedFilename();
/guidon-backup-.*\.json/.test(suggested) ? ok("Export produces a real download named guidon-backup-*.json (got " + suggested + ")") : bad("unexpected download filename: " + suggested);

const tmpPath = path.join(os.tmpdir(), "guidon-test-backup-" + Date.now() + ".json");
await download.saveAs(tmpPath);
const raw = fs.readFileSync(tmpPath, "utf8");
let parsed;
try { parsed = JSON.parse(raw); } catch (e) { bad("downloaded file is not valid JSON: " + e.message); }
if (parsed) {
  const hasMarker = (parsed.stores?.kv || []).some((row) => row.k === "idp:goals" && JSON.stringify(row.v || row).includes(MARKER));
  hasMarker ? ok("The downloaded backup file's real content includes the seeded marker goal") : bad("marker goal not found in the downloaded backup content");
}

// ---- wipe the marker so import's restoration is provably real ----
await page.evaluate(() => window.G.db.setSetting("idp:goals", []));
await page.evaluate(() => { location.hash = "#/develop"; });
await page.waitForTimeout(400);
// "Roadmap" (the default tab) never lists individual goal text - only "My
// IDP" does, so switch there for a check that would actually fail if the
// wipe hadn't worked.
await page.locator("button", { hasText: /^My IDP$/ }).click().catch(() => {});
await page.waitForTimeout(300);
const goneBeforeImport = await page.evaluate((marker) => !(document.body.textContent || "").includes(marker), MARKER);
goneBeforeImport ? ok("Marker goal is gone before import (wiped for a real before/after)") : bad("marker goal unexpectedly still visible before import");

// ---- real Import: click the button, pick the real downloaded file, confirm the real dialog ----
await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(400);
await page.locator("button", { hasText: /Import backup/ }).click();
const fileInput = page.locator('input[type="file"]');
await fileInput.setInputFiles(tmpPath);
await page.waitForTimeout(300);

const confirmVisible = await page.locator(".gm-box", { hasText: /Import backup/ }).count();
confirmVisible ? ok("The real G.modal.confirm dialog appears, summarizing the file's contents") : bad("import confirm dialog did not appear");
const confirmText = await page.locator(".gm-box").textContent();
/saved items/.test(confirmText || "") ? ok("Confirm dialog shows a real item-count summary from the actual file") : bad("confirm dialog text missing item summary: " + (confirmText || "").slice(0, 200));

// Start waiting for the reload's 'load' event BEFORE clicking OK - the app
// calls location.reload() ~1.2s after a successful import via a plain
// setTimeout, not as a direct result of this click, so waitForLoadState()
// called only afterward would just see the CURRENT (already-loaded) page
// and resolve immediately instead of actually waiting for that reload.
const [, statusText] = await Promise.all([
  page.waitForEvent("load", { timeout: 10000 }),
  (async () => {
    await page.locator(".gm-box button", { hasText: /^OK$/ }).click();
    await page.waitForTimeout(300);
    return page.evaluate(() => (document.querySelector(".backup-status") || {}).textContent || "");
  })(),
]);
/Restored/.test(statusText) ? ok("Backup status reports a real 'Restored N items...' result (" + statusText + ")") : bad("status text after import: " + statusText);
await page.waitForTimeout(500);

// #/develop defaults to its "Roadmap" tab, which doesn't list individual goal
// text at all - the goal list itself only renders under "My IDP".
await page.evaluate(() => { location.hash = "#/develop"; });
await page.waitForTimeout(500);
await page.locator("button", { hasText: /^My IDP$/ }).click().catch(() => {});
await page.waitForTimeout(300);
const markerRestored = await page.evaluate((marker) => (document.body.textContent || "").includes(marker), MARKER);
markerRestored ? ok("The marker goal is restored after the real import + reload round trip") : bad("marker goal was NOT restored after import");

// ---- Diagnostics self-repair item 9: casualties named BEFORE the confirm ----
// Previously importAll() validated AFTER the confirm was accepted, so a
// Soldier committed to "yes, restore" before knowing the file was corrupted.
// Build a second backup file with one row deliberately corrupted and
// confirm the dialog names it up front, using the exact same validators
// the real import will use.
const corruptPath = path.join(os.tmpdir(), "guidon-test-backup-corrupt-" + Date.now() + ".json");
const corrupted = JSON.parse(JSON.stringify(parsed));
corrupted.stores.kv.push({ k: "streak:v1", v: "not-an-object" });
corrupted.summary.kv = (corrupted.summary.kv || 0) + 1;
fs.writeFileSync(corruptPath, JSON.stringify(corrupted));

await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(400);
await page.locator("button", { hasText: /Import backup/ }).click();
await page.locator('input[type="file"]').setInputFiles(corruptPath);
await page.waitForTimeout(300);
const preConfirmText = await page.locator(".gm-box").textContent();
/streak:v1/.test(preConfirmText || "") ? ok("The import confirm dialog names the corrupted key (streak:v1) BEFORE any commit, not after") : bad("confirm dialog did not name the corrupted row up front: " + (preConfirmText || "").slice(0, 300));
/corrupted and will be skipped/.test(preConfirmText || "") ? ok("The dialog states plainly that the named item(s) will be skipped") : bad("confirm dialog did not explain the consequence: " + (preConfirmText || "").slice(0, 300));
// Cancel rather than confirm - this stage only verifies the preview text,
// the real restore path is already proven above.
await page.locator(".gm-box button", { hasText: /Cancel/ }).click().catch(async () => {
  await page.keyboard.press("Escape");
});
await page.waitForTimeout(200);
fs.unlinkSync(corruptPath);

// ---- Upgrade-roadmap first wave, items 4+5: failure visibility + last-
// backup staleness nudge. The real export above (line ~67) already wrote a
// backup:lastExportAt marker, so both panels' hint should now read "today."
const settingsHint = await page.evaluate(() => {
  location.hash = "#/settings";
  return new Promise((resolve) => setTimeout(() => resolve((document.querySelector(".last-backup-status") || {}).textContent || ""), 500));
});
/Last backed up today/.test(settingsHint) ? ok("Settings' Data & Backup panel shows the same last-backup hint the Profile export just set") : bad("Settings last-backup hint: " + settingsHint);

const partialFailure = await page.evaluate(async () => {
  const realAll = window.G.db.all;
  window.G.db.all = function (store) {
    if (store === "attempts") return Promise.reject(new Error("simulated read failure"));
    return realAll.call(window.G.db, store);
  };
  try {
    const payload = await window.G.backup.exportAll();
    return { failedStores: payload.failedStores, msg: window.G.backup.exportDoneMessage(payload) };
  } finally {
    window.G.db.all = realAll;
  }
});
(partialFailure.failedStores.length === 1 && partialFailure.failedStores[0] === "attempts")
  ? ok("exportAll() names the real store that failed to read in payload.failedStores")
  : bad("failedStores after a simulated attempts-store failure: " + JSON.stringify(partialFailure.failedStores));
(/MISSING/.test(partialFailure.msg) && /attempts/.test(partialFailure.msg))
  ? ok("A partial export failure produces a specific, visible warning instead of a silent 'Backup downloaded'")
  : bad("exportDoneMessage for a partial failure: " + JSON.stringify(partialFailure.msg));

const cleanExport = await page.evaluate(async () => {
  const payload = await window.G.backup.exportAll();
  return { failedStores: payload.failedStores, msg: window.G.backup.exportDoneMessage(payload) };
});
(cleanExport.failedStores.length === 0 && cleanExport.msg === "Backup downloaded")
  ? ok("A clean export still reports plainly as 'Backup downloaded' with zero failedStores")
  : bad("clean export result: " + JSON.stringify(cleanExport));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

fs.unlinkSync(tmpPath);
await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nBACKUP ROUNDTRIP: all passed");
process.exit(fails ? 1 : 0);
