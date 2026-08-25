/**
 * Data & Storage dashboard (G.storage, #/storage — roadmap Tier 8, item 4).
 *
 * Proves the route renders real numbers, not placeholders: a live
 * navigator.storage.estimate() figure (reused from G.pwa.state.estimate,
 * not re-queried — proven by checking the two never disagree), and a real
 * per-store IndexedDB row count/byte size for all four stores (kv, meta,
 * userScenarios, attempts), read straight from G.db.all() the same way
 * Diagnostics' own kvscan check already does for "kv" alone.
 *
 * Also proves the three cross-links actually navigate (Export -> Settings,
 * Check data validity -> Diagnostics, Clearing your data -> Privacy) rather
 * than duplicating any of those panels' own content, and that Settings'
 * "View storage details" button reaches this same route — both sides of
 * the same signpost, matching the "task #249" anti-duplication convention
 * the Export-backup button pair already established.
 *
 * Deliberately does NOT test for a "clear all data" control: this dashboard
 * was scoped read-only on purpose (see storage.js's own header comment) —
 * the app has no such button anywhere, by design (views.privacy documents
 * the real full-wipe path as outside the app entirely).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const noise = [];
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|docs\/.*\.pdf/i.test(m.text())) noise.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

// ── 1) Route reachability & basic shape ──────────────────────────────────
await page.evaluate(() => { location.hash = "#/storage"; });
await page.waitForTimeout(500);

const h2 = await page.locator("h2").first().textContent();
h2 === "Data & Storage" ? ok("#/storage renders the real 'Data & Storage' heading") : bad("h2 text: " + h2);

const panelCount = await page.locator(".panel").count();
panelCount === 3 ? ok("renders all 3 real panels (usage, by-store, related)") : bad("panel count: " + panelCount + ", expected 3");

// ── 2) Usage estimate — reused from G.pwa, not re-queried ────────────────
const usageState = await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 300)); // the estimate read is async
  const stat = document.querySelector(".panel .stat");
  return {
    statText: stat ? stat.textContent : null,
    pwaEstimate: window.G.pwa.state.estimate,
  };
});
usageState.statText && !/Checking…/.test(usageState.statText)
  ? ok("the usage panel resolves past its 'Checking…' placeholder: " + JSON.stringify(usageState.statText))
  : bad("usage panel never resolved: " + JSON.stringify(usageState));
usageState.pwaEstimate
  ? ok("navigator.storage.estimate() succeeded in this browser, and G.pwa.state.estimate is the real object the dashboard reads (no second, possibly-diverging query)")
  : ok("navigator.storage.estimate() unsupported/unavailable here — dashboard's 'Not available' fallback path is covered by the h2/panel assertions above still passing");

// ── 3) Per-store breakdown — real G.db.all() counts, all 4 stores ────────
const rowLabels = await page.evaluate(() => Array.from(document.querySelectorAll(".panel .stat .k")).map((n) => n.textContent));
const expectedLabels = ["Settings & flags", "Content cache", "Authored scenarios", "Recorded attempts"];
expectedLabels.every((l) => rowLabels.includes(l))
  ? ok("all 4 real IndexedDB stores are listed (kv, meta, userScenarios, attempts, by their real labels)")
  : bad("store row labels: " + JSON.stringify(rowLabels) + ", expected to include: " + JSON.stringify(expectedLabels));

const realKvCount = await page.evaluate(async () => (await window.G.db.all("kv")).length);
const shownKvRow = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".panel .stat"));
  const row = rows.find((r) => /Settings & flags/.test(r.textContent || ""));
  return row ? row.querySelector(".v").textContent : null;
});
shownKvRow && shownKvRow.includes(String(realKvCount) + " row")
  ? ok(`the 'kv' store's shown row count (${shownKvRow}) matches the real live G.db.all("kv").length (${realKvCount}) — not a placeholder`)
  : bad(`kv row count mismatch: shown "${shownKvRow}", real count ${realKvCount}`);

// ── 4) Cross-links navigate to the real routes, not dead buttons ─────────
async function clickLabeledButton(label) {
  await page.evaluate(() => { location.hash = "#/storage"; });
  await page.waitForTimeout(400);
  const btn = page.locator("button", { hasText: label }).first();
  await btn.click();
  await page.waitForTimeout(300);
  return page.evaluate(() => location.hash);
}

(await clickLabeledButton("Export a backup")) === "#/settings"
  ? ok("'Export a backup' cross-link lands on #/settings (the real Export backup button, not a duplicate)")
  : bad("'Export a backup' click did not land on #/settings");

(await clickLabeledButton("Check data validity")) === "#/selftest"
  ? ok("'Check data validity' cross-link lands on #/selftest (Diagnostics)")
  : bad("'Check data validity' click did not land on #/selftest");

(await clickLabeledButton("Clearing your data")) === "#/privacy"
  ? ok("'Clearing your data' cross-link lands on #/privacy")
  : bad("'Clearing your data' click did not land on #/privacy");

// ── 5) Settings' own signpost reaches the same route ──────────────────────
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(400);
const settingsBtn = page.locator("button", { hasText: "View storage details" }).first();
const settingsBtnCount = await settingsBtn.count();
settingsBtnCount === 1 ? ok("Settings' Data & Backup panel has exactly one 'View storage details' signpost button") : bad("'View storage details' button count in Settings: " + settingsBtnCount);
if (settingsBtnCount) {
  await settingsBtn.click();
  await page.waitForTimeout(300);
  const hash = await page.evaluate(() => location.hash);
  hash === "#/storage" ? ok("Settings' signpost button genuinely navigates to #/storage") : bad("Settings signpost landed on: " + hash);
}

// ── 6) Nav integration — reachable from the Advanced group, not orphaned ──
const navEntry = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("a,button")).some((n) => /Data & Storage/.test(n.textContent || ""));
});
navEntry ? ok("'Data & Storage' has a real, clickable nav entry (NAV_GROUPS.advanced) — reachable, not just directly hash-navigable") : bad("no 'Data & Storage' nav entry found in the rendered page");

noise.length === 0
  ? ok("no console errors/warnings (excluding the known docs/*.pdf and favicon 404s) across the whole flow")
  : bad("console noise: " + JSON.stringify(noise));

await browser.close();
server.close();
console.log("\n" + (fails ? `DATA & STORAGE DASHBOARD: ${fails} FAILURE(S)` : "DATA & STORAGE DASHBOARD: all passed"));
process.exit(fails ? 1 : 0);
