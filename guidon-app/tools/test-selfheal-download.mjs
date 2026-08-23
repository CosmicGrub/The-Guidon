/**
 * "Download full log" (Diagnostics' Self-healing panel, js/selftest.js) -
 * roadmap Tier 3 quick win. selfheal.js's log() (js/selfheal.js) hard-caps
 * stored history at CAP=200 and FIFO-drops whatever's oldest once that
 * fills, silently - and until this fix, Diagnostics' only window into that
 * history was "Show recent entries", which calls G.selfheal.recent(20) and
 * never shows more than the newest 20. Anything between entry #21 and
 * whatever's currently retained (up to 200) was invisible in the UI, and
 * anything already pushed out past 200 was unrecoverable - no archive
 * existed anywhere. The fix adds a "Download full log" button next to
 * "Show recent entries" that calls G.selfheal.recent() with NO argument
 * (already-supported unbounded read - recent()'s own n||list.length
 * fallback) and pipes it through util.download() as a real JSON file, so a
 * Soldier can archive everything currently retained before the FIFO takes
 * any more of it.
 *
 * Three things get proven with a REAL download event (page.waitForEvent
 * ("download"), same mechanism test-backup-roundtrip.mjs and
 * test-author.mjs use - not just a stubbed anchor click):
 *
 *  1. The button is correctly gated: absent with zero self-heal history
 *     (matches the existing `if (healCount)` guard "Show recent entries"
 *     already uses), present once there's at least one entry.
 *  2. The downloaded file contains MORE than the 20-entry display cap -
 *     seeding 23 distinct entries and downloading proves this is a genuine
 *     unbounded export, not "Show recent entries" wearing a download icon.
 *  3. Pushed past the CAP=200 boundary (205 seeded), the download reflects
 *     exactly what's currently retained (200, the newest ones) - the
 *     earliest 5 (already FIFO-dropped before the download ever happened)
 *     are provably gone, and the button makes no false promise of
 *     recovering them. This is the honest boundary the roadmap item itself
 *     names: archive what's here NOW, before more of it is dropped.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

// The Diagnostics view has more than one ".stat" block (the automated-check
// summary at the top is another) - this scopes to the Self-healing panel's
// own stat by finding the ".panel" whose eyebrow reads "Self-healing".
const healStat = (page) => page.evaluate(() => {
  const panel = [...document.querySelectorAll(".panel")].find((p) => (p.querySelector(".eyebrow") || {}).textContent === "Self-healing");
  return ((panel && panel.querySelector(".stat .k")) || {}).textContent || "";
});

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } })).newPage();
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

// ---- 1) zero history: no download button offered ----
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(500);

const zeroCount = await healStat(page);
const zeroDlBtnCount = await page.locator("button", { hasText: /Download full log/ }).count();
/No repairs recorded/.test(zeroCount) && zeroDlBtnCount === 0
  ? ok("with zero self-heal history, 'Download full log' is not offered (matches the existing healCount gate)")
  : bad("zero-history state: count=" + JSON.stringify(zeroCount) + " dlBtnCount=" + zeroDlBtnCount);

// ---- 2) seed 23 entries (> the 20-entry 'Show recent entries' cap) ----
await page.evaluate(async () => {
  for (let i = 0; i < 23; i++) {
    await window.G.selfheal.log("qa-marker", "m" + i, "seed entry #" + i);
  }
});
// Re-assigning the SAME hash fires no hashchange, so selftest.js's render()
// (and its fresh G.selfheal.count() read) never re-runs on its own - route
// away and back to force a real re-render, same as a Soldier switching tabs
// and returning would. (A full page.reload() also works for picking up the
// new count, but reliably breaks Playwright's own download-event capture
// for the rest of this test - confirmed while writing this suite: identical
// click, identical util.download() call, but page.waitForEvent("download")
// never resolves post-reload. Hash-navigating avoids that entirely and is
// the more realistic user path besides.)
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(500);

const midCount = await healStat(page);
/^23 repair\(s\) since install$/.test(midCount) ? ok("Diagnostics reports 23 repair(s) after seeding") : bad("repair count after seeding 23: " + JSON.stringify(midCount));

const dlBtn = page.locator("button", { hasText: /Download full log/ });
(await dlBtn.count()) > 0 ? ok("'Download full log' is offered once history is non-empty") : bad("'Download full log' button not found with 23 seeded entries");

const [midDl] = await Promise.all([
  page.waitForEvent("download"),
  dlBtn.click(),
]);
const midSuggested = midDl.suggestedFilename();
/^guidon-selfheal-log-\d{4}-\d{2}-\d{2}\.json$/.test(midSuggested)
  ? ok("download uses filename shape guidon-selfheal-log-YYYY-MM-DD.json (got " + midSuggested + ")")
  : bad("unexpected filename: " + midSuggested);

const midTmp = path.join(os.tmpdir(), "guidon-selfheal-dl-mid-" + Date.now() + ".json");
await midDl.saveAs(midTmp);
const midParsed = JSON.parse(fs.readFileSync(midTmp, "utf8"));
Array.isArray(midParsed) && midParsed.length === 23
  ? ok("downloaded file contains all 23 entries - more than 'Show recent entries'' 20-entry display cap")
  : bad("downloaded entry count: " + (Array.isArray(midParsed) ? midParsed.length : typeof midParsed));
const midKeys = new Set((midParsed || []).map((e) => e.key));
const midHasAll = Array.from({ length: 23 }, (_, i) => "m" + i).every((k) => midKeys.has(k));
midHasAll
  ? ok("every seeded marker (m0..m22, including the ones past the 20-entry display cap) is present in the download")
  : bad("some seeded markers missing from download: " + JSON.stringify([...midKeys]));
const midShape = (midParsed || [])[0] || {};
("at" in midShape && "kind" in midShape && "key" in midShape && "detail" in midShape)
  ? ok("each downloaded entry keeps the raw stored shape { at, kind, key, detail }")
  : bad("unexpected entry shape: " + JSON.stringify(midShape));

const midToastShown = await page.evaluate(() => {
  const t = document.getElementById("toast");
  return !!(t && t.classList.contains("show") && /Downloaded 23 entr(y|ies)\./.test(t.textContent || ""));
});
midToastShown ? ok("a success toast confirms the download ('Downloaded 23 entries.')") : bad("no matching success toast after downloading 23 entries");

// ---- 3) push past CAP=200: the download reflects what's retained NOW,
// not a resurrection of entries the FIFO already dropped ----
await page.evaluate(async () => {
  for (let i = 23; i < 205; i++) {
    await window.G.selfheal.log("qa-marker", "m" + i, "seed entry #" + i);
  }
});
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(500);

const cappedCount = await healStat(page);
/^200 repair\(s\) since install$/.test(cappedCount)
  ? ok("205 seeded entries FIFO-cap to 200 stored, per selfheal.js's CAP=200 (confirms the claim the fix works around)")
  : bad("repair count after seeding past the cap: " + JSON.stringify(cappedCount));

const [cappedDl] = await Promise.all([
  page.waitForEvent("download"),
  page.locator("button", { hasText: /Download full log/ }).click(),
]);
const cappedTmp = path.join(os.tmpdir(), "guidon-selfheal-dl-capped-" + Date.now() + ".json");
await cappedDl.saveAs(cappedTmp);
const cappedParsed = JSON.parse(fs.readFileSync(cappedTmp, "utf8"));
Array.isArray(cappedParsed) && cappedParsed.length === 200
  ? ok("downloaded file contains exactly the 200 entries currently retained, not more")
  : bad("downloaded entry count past the cap: " + (Array.isArray(cappedParsed) ? cappedParsed.length : typeof cappedParsed));
const cappedKeys = new Set((cappedParsed || []).map((e) => e.key));
const earliestGone = ["m0", "m1", "m2", "m3", "m4"].every((k) => !cappedKeys.has(k));
const latestPresent = ["m200", "m201", "m202", "m203", "m204"].every((k) => cappedKeys.has(k));
(earliestGone && latestPresent)
  ? ok("the earliest 5 entries (already FIFO-dropped before the download) are honestly absent; the newest 5 are present - the download archives what's retained, it doesn't fabricate what's already gone")
  : bad("boundary check failed: earliestGone=" + earliestGone + " latestPresent=" + latestPresent);

noise.length === 0 ? ok("no page errors") : bad(noise.length + " page errors; first: " + noise[0]);

await page.close();
await browser.close();
server.close();
console.log("\n" + (fails ? `SELFHEAL DOWNLOAD: ${fails} FAILURE(S)` : "SELFHEAL DOWNLOAD: all passed"));
process.exit(fails ? 1 : 0);
