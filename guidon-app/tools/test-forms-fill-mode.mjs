/**
 * Forms fill mode (#/settings -> Advanced -> "Forms fill mode", forms.js's
 * formsMode()/buildPdfOverlay()): roadmap audit (Tier 3 batch 2) found a
 * third picker option, "pdf-overlay" ("Overlay on my PDF"), that promised
 * positioning typed answers on top of an official PDF the Soldier supplied.
 * It was never real for any of the 34 forms in G.store.forms().forms:
 *   - zero forms carry any field-coordinate/position data to place text at
 *     (verified directly against window.GUIDON_SEED below - the same check
 *     that drove the fix, not a re-statement of the roadmap's stale "33 of
 *     34" claim, which undercounted how broken this was - the real number
 *     is 0 of 34, not 1 of 34);
 *   - buildPdfOverlay()'s file <input> stored the chosen File on `api.pdf`
 *     and nothing else in the app ever read that property back;
 *   - the real Print button (drawReplica's printBtn) always called
 *     replicaPrintMarkup() regardless of mode, so no answer ever actually
 *     printed "over" a loaded PDF.
 * The option and its promise copy were retired; this proves the picker now
 * only offers what's genuinely real, no surviving UI text overpromises the
 * capability, and a profile that still has the old "pdf-overlay" value
 * persisted (a synced backup, old localStorage) degrades gracefully to the
 * honest "hook for later" mode rather than resurrecting the dead upload UI.
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
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

async function openGuestSession() {
  const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
  await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await guestCard.count()) {
    await guestCard.click();
    await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

async function openAdvanced() {
  const btn = page.getByRole("button", { name: /advanced settings/i });
  const expanded = await btn.getAttribute("aria-expanded").catch(() => null);
  if (expanded !== "true") await btn.click();
  await page.waitForTimeout(150);
}

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await openGuestSession();

// ============================================================
// 0) FIXTURE SANITY - re-verify the roadmap's own headline claim against
//    the real seed data, so this test fails loudly (not silently drifts
//    stale) if a future form ever DOES gain real overlay coordinate data.
// ============================================================
{
  const coordCount = await page.evaluate(() => {
    const forms = (window.G.store.forms().forms || []);
    const hit = forms.filter((f) => Object.keys(f).some((k) => /coord|overlay|xy|position/i.test(k)));
    return { total: forms.length, withCoords: hit.length };
  });
  coordCount.total === 34
    ? ok("fixture sanity: the forms catalog has the expected 34 real forms")
    : bad("forms catalog count: " + coordCount.total + ", expected 34");
  coordCount.withCoords === 0
    ? ok("fixture sanity: zero of " + coordCount.total + " forms carry any field-coordinate/overlay/position data - the retirement is justified, not just plausible")
    : bad(coordCount.withCoords + " form(s) unexpectedly carry coordinate-ish data - re-check whether the retirement is still fully warranted");
}

// ============================================================
// 1) SETTINGS PICKER - only the two real modes are offered; the third,
//    non-functional one is gone, not just relabeled or disabled.
// ============================================================
await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(500);
await openAdvanced();

const fmPanel = page.locator(".panel", { has: page.locator("label", { hasText: "Forms fill mode" }) }).first();
await fmPanel.waitFor({ state: "visible", timeout: 5000 });

const fmButtons = await fmPanel.locator(".segmented button").allTextContents();
JSON.stringify(fmButtons) === JSON.stringify(["Replica", "Replica + PDF hook"])
  ? ok("Forms fill mode picker offers exactly the two real modes (Replica, Replica + PDF hook)")
  : bad("Forms fill mode buttons: " + JSON.stringify(fmButtons) + ", expected [\"Replica\",\"Replica + PDF hook\"]");

// #app holds the actual rendered UI; document.body.textContent would also
// pick up the app's own <script> source (comments deliberately still
// mention the old "Overlay on my PDF" copy verbatim, as the paper trail
// for this retirement) - scoping to #app is what a real Soldier sees.
const bodyText = await page.evaluate(() => document.getElementById("app")?.textContent || "");
!/Overlay on my PDF/.test(bodyText)
  ? ok("'Overlay on my PDF' no longer appears anywhere in the rendered Settings UI")
  : bad("'Overlay on my PDF' text still present in the rendered UI");
!/position your typed answers on top of an official PDF you supply/.test(bodyText)
  ? ok("the specific broken promise copy (\"position your typed answers on top of an official PDF you supply\") is gone")
  : bad("the broken overlay-positioning promise copy is still present");

// The two surviving modes' own copy should still be present and unchanged -
// proves this was a targeted removal, not a panel-wide gutting.
/faithful, live-fillable HTML re-creation/.test(bodyText)
  ? ok("the real 'Replica' mode's own description is untouched")
  : bad("'Replica' mode description missing after the edit");
/slot to drop in an official armypubs PDF later/.test(bodyText)
  ? ok("the honest 'Replica + PDF hook' description (explicitly framed as future, not working today) is untouched")
  : bad("'Replica + PDF hook' mode description missing after the edit");

// ============================================================
// 2) PICKER INTERACTION - selecting "Replica + PDF hook" still works and
//    persists (the removal didn't collateral-damage the mode that IS real).
// ============================================================
await fmPanel.locator("button", { hasText: "Replica + PDF hook" }).click();
// store.setSetting()'s write is debounced 300ms (db.js/store.js's
// debouncedSettingsSave) before it lands in IndexedDB - same idiom
// test-settings-toggles.mjs uses before reading storage directly.
await page.waitForTimeout(400);
const storedAfterClick = await page.evaluate(async () => {
  const s = await window.G.db.get("kv", "settings");
  return s && s.v && s.v.formsMode;
});
storedAfterClick === "overlay-ready"
  ? ok("selecting 'Replica + PDF hook' persists formsMode:\"overlay-ready\" to storage")
  : bad("stored formsMode after selecting 'Replica + PDF hook': " + JSON.stringify(storedAfterClick));
const activeLabel = await fmPanel.locator(".segmented button.active").textContent();
activeLabel === "Replica + PDF hook"
  ? ok("the clicked button shows as active")
  : bad("active button after click: " + JSON.stringify(activeLabel));

// ============================================================
// 3) RUNTIME - opening a real form in "Replica + PDF hook" mode shows only
//    the honest placeholder, never a file-upload control (that control
//    belonged exclusively to the retired mode 3).
// ============================================================
await page.evaluate(() => { location.hash = "#/forms"; });
await page.waitForTimeout(600);
await page.fill('input[aria-label="Search forms"]', "authority for leave");
await page.waitForTimeout(300);
await page.locator(".form-card").first().click();
await page.waitForTimeout(300);

const hookState = await page.evaluate(() => ({
  hookText: document.querySelector(".pdf-hook .hint")?.textContent || null,
  hasFileInput: !!document.querySelector(".pdf-hook input[type=file]"),
  overlayModeClass: !!document.querySelector(".replica-sheet.overlay-mode"),
}));
(hookState.hookText && /PDF hook ready/.test(hookState.hookText) && !/load the official/.test(hookState.hookText))
  ? ok("the 'Replica + PDF hook' placeholder shows only the honest 'ready later' message")
  : bad("pdf-hook hint text: " + JSON.stringify(hookState.hookText));
hookState.hasFileInput === false
  ? ok("no PDF file-upload input renders anywhere - the retired mode's only interactive control is gone")
  : bad("a PDF upload <input type=file> is still present in overlay-ready mode");
hookState.overlayModeClass === false
  ? ok("the retired .overlay-mode CSS hook is never applied")
  : bad(".replica-sheet.overlay-mode class unexpectedly present");

// ============================================================
// 4) LEGACY VALUE - a profile that still has the old "pdf-overlay" value
//    persisted (pre-dating this fix) must degrade to the honest mode 2
//    behavior, not resurrect the dead upload UI or crash.
// ============================================================
await page.evaluate(async () => {
  const s = await window.G.db.get("kv", "settings");
  const sv = Object.assign({}, s && s.v, { formsMode: "pdf-overlay" });
  await window.G.db.put("kv", { k: "settings", v: sv });
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1000);
await openGuestSession();
await page.evaluate(() => { location.hash = "#/forms"; });
await page.waitForTimeout(600);
await page.fill('input[aria-label="Search forms"]', "authority for leave");
await page.waitForTimeout(300);
await page.locator(".form-card").first().click();
await page.waitForTimeout(300);

const legacyState = await page.evaluate(() => ({
  hasFileInput: !!document.querySelector(".pdf-hook input[type=file]"),
  hasHook: !!document.querySelector(".pdf-hook .hint"),
}));
legacyState.hasFileInput === false
  ? ok("a legacy formsMode:\"pdf-overlay\" value never re-renders the retired upload input")
  : bad("legacy 'pdf-overlay' value resurrected the file-upload input");
legacyState.hasHook === true
  ? ok("a legacy formsMode:\"pdf-overlay\" value falls back to the real 'PDF hook' placeholder, not a blank/broken state")
  : bad("legacy 'pdf-overlay' value produced no pdf-hook placeholder at all");

await page.evaluate(() => { location.hash = "#/settings"; });
await page.waitForTimeout(500);
await openAdvanced();
const fmPanelLegacy = page.locator(".panel", { has: page.locator("label", { hasText: "Forms fill mode" }) }).first();
const legacyActive = await fmPanelLegacy.locator(".segmented button.active").textContent().catch(() => null);
legacyActive === "Replica + PDF hook"
  ? ok("with a legacy 'pdf-overlay' value, the Settings picker itself still shows a real active button (not blank)")
  : bad("active button with legacy 'pdf-overlay' value: " + JSON.stringify(legacyActive));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad(relevantNoise.length + " console msg(s); first: " + relevantNoise[0]);

await browser.close();
await server.close();

console.log("\n" + (fails ? `FORMS FILL MODE: ${fails} FAILURE(S)` : "FORMS FILL MODE: all passed"));
process.exit(fails ? 1 : 0);
