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

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

fs.unlinkSync(tmpPath);
await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nBACKUP ROUNDTRIP: all passed");
process.exit(fails ? 1 : 0);
