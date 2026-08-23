/**
 * "Download this entry" (Diagnostics' kvscan "Review & repair" panel, js/
 * selftest.js) - roadmap Tier 3 batch 2 quick win. When "Data validity
 * scan" finds a malformed Soldier-authored kv row (no safe default),
 * repairing it only ever offered "Quarantine this entry", gated behind a
 * confirm dialog whose own copy says: "This cannot be undone unless you
 * have a backup. Consider exporting a backup from Settings -> Backup &
 * restore first." - sending the Soldier to a different screen to export
 * EVERYTHING just to keep the one row they actually care about. The fix
 * adds a same-screen, one-click "Download this entry" button next to
 * "Quarantine this entry" (only on the no-safe-default path - the
 * hasDefault/"Reset to default" path never shows a confirm at all, so
 * there's nothing to offer a download "before") that pipes { k, v } for
 * just that one row through the same util.download() primitive as the
 * self-heal log's "Download full log" button (see
 * test-selfheal-download.mjs) and G.backup.downloadAll's full backup.
 *
 * Proven with a REAL download event (page.waitForEvent("download"), same
 * mechanism test-selfheal-download.mjs and test-backup-roundtrip.mjs use):
 *
 *  1. Scoping: "Download this entry" is offered on the Soldier-authored row
 *     (idp:goals, no safe default) but NOT on the config-shaped row
 *     (streak:v1, has a safe default and resets with no confirm at all).
 *  2. The downloaded file is the real single row - exact key and exact raw
 *     value, not a summary or the full backup.
 *  3. Downloading does NOT delete or otherwise touch the row - it's still
 *     readable (still malformed) in IndexedDB afterward.
 *  4. The pre-existing confirm-gated quarantine mechanism is completely
 *     unchanged: clicking "Quarantine this entry" still opens a real named
 *     confirm dialog, and confirming it still deletes the row for real.
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
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
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
await page.waitForTimeout(300);

await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(500);

// ---- seed one config-shaped bad row (has a safe default) and one
// Soldier-authored bad row (no safe default) - same pair test-selftest.mjs
// uses for items 7/8, reused here so this file stays a focused, standalone
// proof of the new download button rather than re-deriving its own fixture.
await page.evaluate(async () => {
  await window.G.db.put("kv", { k: "streak:v1", v: "not-an-object" });
  await window.G.db.put("kv", { k: "idp:goals", v: [{ notAGoal: true }] });
});
await page.locator("button", { hasText: /Run automated checks/ }).click();
await page.waitForTimeout(400);

const kvscanFailed = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const c = cats.find((n) => /data validity scan/i.test(n.textContent || ""));
  return c ? c.textContent.indexOf("✕") !== -1 : null;
});
kvscanFailed === true ? ok("'Data validity scan' fails with the two seeded corrupted rows present") : bad("kvscan did not fail as expected: " + kvscanFailed);

await page.locator("button", { hasText: /Review & repair/ }).click();
await page.waitForTimeout(300);

// ---- 1) scoping: download offered for idp:goals, not for streak:v1 ----
function itemTextFor(needle) {
  return page.evaluate((k) => {
    const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
    const cat = cats.find((n) => n.textContent === k);
    return cat ? cat.closest(".card").textContent : null;
  }, needle);
}
const goalsItemText = await itemTextFor("idp:goals");
const streakItemText = await itemTextFor("streak:v1");
(goalsItemText && /Download this entry/.test(goalsItemText))
  ? ok("'Download this entry' is offered on idp:goals (Soldier-authored, no safe default)")
  : bad("Download this entry missing for idp:goals: " + JSON.stringify(goalsItemText));
(streakItemText && !/Download this entry/.test(streakItemText))
  ? ok("'Download this entry' is NOT offered on streak:v1 (has a safe default, resets with no confirm - nothing to download 'before')")
  : bad("Download this entry unexpectedly present for streak:v1: " + JSON.stringify(streakItemText));

const dlBtnCount = await page.locator("button", { hasText: /^Download this entry$/ }).count();
dlBtnCount === 1 ? ok("exactly one 'Download this entry' button rendered (scoped to the one no-default row)") : bad("expected exactly 1 Download this entry button, found " + dlBtnCount);

// ---- 2) the download is the real single row: exact key + exact raw value ----
const [dl] = await Promise.all([
  page.waitForEvent("download"),
  page.locator("button", { hasText: /^Download this entry$/ }).click(),
]);
const suggested = dl.suggestedFilename();
/^guidon-kv-idp-goals-\d{4}-\d{2}-\d{2}\.json$/.test(suggested)
  ? ok("download uses filename shape guidon-kv-idp-goals-YYYY-MM-DD.json (got " + suggested + ")")
  : bad("unexpected filename: " + suggested);

const tmp = path.join(os.tmpdir(), "guidon-kv-entry-dl-" + Date.now() + ".json");
await dl.saveAs(tmp);
const parsed = JSON.parse(fs.readFileSync(tmp, "utf8"));
(parsed && parsed.k === "idp:goals")
  ? ok("downloaded file's k is the real key ('idp:goals')")
  : bad("downloaded k: " + JSON.stringify(parsed && parsed.k));
(parsed && Array.isArray(parsed.v) && parsed.v.length === 1 && parsed.v[0].notAGoal === true)
  ? ok("downloaded file's v is the exact raw malformed value ([{ notAGoal: true }]), not a summary")
  : bad("downloaded v: " + JSON.stringify(parsed && parsed.v));
Object.keys(parsed || {}).sort().join(",") === "k,v"
  ? ok("downloaded file contains only { k, v } for this one row - no other rows, no full backup shape")
  : bad("downloaded file had unexpected keys: " + JSON.stringify(Object.keys(parsed || {})));

const toastShown = await page.evaluate(() => {
  const t = document.getElementById("toast");
  return !!(t && t.classList.contains("show") && /Downloaded idp:goals\./.test(t.textContent || ""));
});
toastShown ? ok("a success toast confirms the download ('Downloaded idp:goals.')") : bad("no matching success toast after downloading idp:goals");

// ---- 3) downloading is non-destructive - the row is untouched ----
const goalsStillPresent = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "idp:goals");
  return !!r && Array.isArray(r.v) && r.v.length === 1 && r.v[0].notAGoal === true;
});
goalsStillPresent
  ? ok("idp:goals is still present and unmodified in IndexedDB after downloading - the download did not delete or rewrite it")
  : bad("idp:goals row was altered or removed merely by downloading it");

// ---- 4) the pre-existing confirm-gated quarantine mechanism itself is
// completely unchanged: real named confirm, real delete on confirm ----
await page.locator("button", { hasText: /^Quarantine this entry$/ }).click();
await page.waitForTimeout(300);
const quarantineConfirm = page.locator(".gm-box", { hasText: /Quarantine malformed entry/ });
(await quarantineConfirm.count()) > 0 ? ok("Quarantine this entry still opens the same real, named confirm dialog") : bad("Quarantine confirm dialog did not appear");
const confirmText = await quarantineConfirm.textContent();
(/idp:goals/.test(confirmText || "") && /Consider exporting a backup from Settings/.test(confirmText || ""))
  ? ok("the confirm dialog's copy is unchanged - still names the key and still points to Settings → Backup & restore for a full export")
  : bad("confirm dialog copy changed unexpectedly: " + (confirmText || "").slice(0, 240));
await page.locator(".gm-box button", { hasText: /Delete this entry/ }).click();
await page.waitForTimeout(300);
const goalsGone = await page.evaluate(async () => { const r = await window.G.db.get("kv", "idp:goals"); return !r; });
goalsGone ? ok("confirming quarantine still actually deletes the row, exactly as before") : bad("idp:goals row still present after confirming quarantine");

const kvscanStillFailing = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const c = cats.find((n) => /data validity scan/i.test(n.textContent || ""));
  return c ? c.textContent.indexOf("✕") !== -1 : null;
});
// streak:v1 is still corrupted at this point (never reset in this focused
// test) - kvscan should still report fail, proving the outer check re-runs
// off the real remaining state rather than assuming "one repair = all clear".
kvscanStillFailing === true
  ? ok("'Data validity scan' still reports fail (streak:v1 remains corrupted) - the re-verify reflects real remaining state")
  : bad("kvscan pass/fail state after quarantining idp:goals: " + kvscanStillFailing);

noise.length === 0 ? ok("no page errors") : bad(noise.length + " page errors; first: " + noise[0]);

await page.close();
await browser.close();
server.close();
console.log("\n" + (fails ? `KVSCAN ENTRY DOWNLOAD: ${fails} FAILURE(S)` : "KVSCAN ENTRY DOWNLOAD: all passed"));
process.exit(fails ? 1 : 0);
