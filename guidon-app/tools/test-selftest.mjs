/**
 * Diagnostics (#/selftest, G.selftest): the generic route sweep only loads
 * the view once and never clicks "Run automated checks", ticks a manual
 * item, copies the report, or clears ticks - so none of its actual
 * interactive behavior had coverage. This exercises the automated-check
 * run (results render, summary updates, known-good checks actually pass),
 * manual-tick persistence, the real clipboard copy-report round trip, and
 * Clear manual ticks' confirm-gated reset.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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

const heading = await page.evaluate(() => /Diagnostics/.test(document.body.textContent || ""));
heading ? ok("Diagnostics view renders") : bad("Diagnostics heading not found");

const initialSummary = await page.evaluate(() => (document.querySelector(".stat .k") || {}).textContent || "");
initialSummary === "Not yet run" ? ok("Automated summary starts 'Not yet run'") : bad("unexpected initial summary: " + initialSummary);

// ---- run the real automated checks ----
await page.locator("button", { hasText: /Run automated checks/ }).click();
await page.waitForTimeout(1200);

const resultCards = await page.evaluate(() => document.querySelectorAll(".panel .card").length);
resultCards >= 10 ? ok("Automated run renders a result card per check (" + resultCards + " cards)") : bad("too few result cards: " + resultCards);

const summaryAfter = await page.evaluate(() => ({
  k: (document.querySelector(".stat .k") || {}).textContent,
  v: (document.querySelector(".stat .v") || {}).textContent,
}));
/passing|failing/.test(summaryAfter.k || "") ? ok("Summary updates after the run (" + summaryAfter.k + ", " + summaryAfter.v + ")") : bad("summary did not update: " + JSON.stringify(summaryAfter));

const moduleCheckOk = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".panel .card"));
  const c = cards.find((x) => /Module integrity/.test(x.textContent));
  return c ? /^✓/.test(c.querySelector(".ob-plan-cat")?.textContent || "") : null;
});
moduleCheckOk === true ? ok("'Module integrity' check reports pass (✓) in this real browser run") : bad("Module integrity check result: " + moduleCheckOk);

const storageCheckOk = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".panel .card"));
  const c = cards.find((x) => /Storage round-trip/.test(x.textContent));
  return c ? /^✓/.test(c.querySelector(".ob-plan-cat")?.textContent || "") : null;
});
storageCheckOk === true ? ok("'Storage round-trip' check reports pass (✓) - a real IndexedDB write/read actually happened") : bad("Storage round-trip check result: " + storageCheckOk);

// Diagnostics self-repair item 3: "Data validity scan" reuses backup.js's
// own KV_VALIDATORS against live IndexedDB (via G.backup.validateKvRow).
const kvscanCheckOk = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".panel .card"));
  const c = cards.find((x) => /Data validity scan/.test(x.textContent));
  return c ? /^✓/.test(c.querySelector(".ob-plan-cat")?.textContent || "") : null;
});
kvscanCheckOk === true ? ok("'Data validity scan' check reports pass (✓) on a clean profile") : bad("Data validity scan check result: " + kvscanCheckOk);

const runBtnRelabeled = await page.evaluate(() => (document.querySelector("button.btn.primary.sm") || {}).textContent || "");
/Run again/.test(runBtnRelabeled) ? ok("Run button relabels to 'Run again' after completion") : bad("run button text after run: " + runBtnRelabeled);

// ---- Copy report: real clipboard round trip - BEFORE any re-render, since
// lastRun is deliberately in-memory-only per render() call (automated
// results are documented as "not stored"), so this has to happen while the
// same render() pass that ran the checks is still live.
await page.locator("button", { hasText: /Copy report/ }).click();
await page.waitForTimeout(300);
const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
/GUIDON SELF-TEST REPORT/.test(clipboardText) ? ok("Copy report writes a real report to the clipboard") : bad("clipboard content missing report header: " + (clipboardText || "").slice(0, 100));
/AUTOMATED/.test(clipboardText) && /MANUAL/.test(clipboardText) ? ok("Clipboard report includes both AUTOMATED and MANUAL sections") : bad("clipboard report missing expected sections");
new RegExp("Run at .* on view #/selftest").test(clipboardText) ? ok("Clipboard report reflects the automated run that actually happened this session") : bad("clipboard report does not reference the completed run: " + clipboardText.slice(0, 300));

// ---- manual tick persists across a re-render ----
const firstManualCb = page.locator('.panel input[type="checkbox"]').first();
await firstManualCb.check();
await page.waitForTimeout(300);
const mstatAfterCheck = await page.evaluate(() => (document.querySelectorAll(".stat .v")[1] || {}).textContent || "");
/^1 \//.test(mstatAfterCheck) ? ok("Manual-confirmed count updates to 1 after ticking one item") : bad("manual stat after tick: " + mstatAfterCheck);

// Force a fresh render() (not a full page reload) to confirm the tick
// actually persisted to kv, not just to in-memory `saved` for this render pass.
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/selftest"; });
await page.waitForTimeout(500);
const firstCbCheckedAfterRerender = await page.locator('.panel input[type="checkbox"]').first().isChecked();
firstCbCheckedAfterRerender ? ok("Manual tick survives a full re-render of the view (persisted via G.db, not just in-memory)") : bad("manual tick did not persist across a re-render");

// ---- Clear manual ticks: confirm-gated, actually resets ----
await page.locator("button", { hasText: /Clear manual ticks/ }).click();
await page.waitForTimeout(300);
const confirmVisible = await page.locator(".gm-box", { hasText: /Clear manual ticks/ }).count();
confirmVisible ? ok("Clear manual ticks is gated behind a real confirm dialog") : bad("confirm dialog for Clear manual ticks did not appear");
await page.locator(".gm-box button", { hasText: /^Clear$/ }).click();
await page.waitForTimeout(400);
const mstatAfterClear = await page.evaluate(() => (document.querySelectorAll(".stat .v")[1] || {}).textContent || "");
/^0 \//.test(mstatAfterClear) ? ok("Manual-confirmed count resets to 0 after confirming Clear manual ticks") : bad("manual stat after clear: " + mstatAfterClear);
const cbAfterClear = await page.locator('.panel input[type="checkbox"]').first().isChecked();
!cbAfterClear ? ok("The previously-ticked checkbox is unchecked after clearing") : bad("checkbox still checked after Clear manual ticks");

// ---- Diagnostics self-repair item 1: Self-healing panel renders ----
const healPanelText = await page.evaluate(() => document.body.textContent || "");
/Self-healing/.test(healPanelText) && /(No repairs recorded|repair\(s\) since install)/.test(healPanelText)
  ? ok("Self-healing panel renders with a repair-count summary")
  : bad("Self-healing panel missing or malformed");

// ---- Diagnostics self-repair item 5: Status bar resync Fix button ----
// Mirrors task #238's own parseColor() monkey-patch technique (see
// test-native-unit.mjs) to force a real, provable failure off-device, then
// confirms the Fix button re-verifies with the SAME predicate rather than
// assuming success (item 2's mandate) - in both the "still broken" and
// "now healthy" directions.
async function statusbarCatText() {
  return page.evaluate(() => {
    const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
    const cat = cats.find((n) => /status bar theming/i.test(n.textContent || ""));
    return cat ? cat.textContent : null;
  });
}
await page.evaluate(() => {
  const dbg = window.G.native._debug;
  window.__origParseColor = dbg.parseColor;
  dbg.parseColor = () => ["not", "a", "number"];
});
// The primary run button's label toggles between "Run automated checks"
// and "Run again" depending on whether a run already happened THIS
// render() pass - Clear manual ticks (above) re-rendered the view, which
// reset it back to its unrun label. Locate it by its stable class instead.
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(400);
const fixBtn = page.locator("button", { hasText: /Fix: re-sync status bar/ });
(await fixBtn.count()) > 0
  ? ok("Fix button appears once 'Status bar theming' genuinely fails")
  : bad("Fix button did not appear after forcing a real failure");

// Click Fix while STILL broken: the repair is attempted, but the
// underlying decision logic is still broken, so it must honestly report
// still-failing rather than a false success.
await fixBtn.click();
await page.waitForTimeout(300);
const stillBrokenText = await statusbarCatText();
stillBrokenText && stillBrokenText.indexOf("✕") !== -1
  ? ok("Fix button re-verifies rather than assuming success - still reports ✕ while the underlying check is still broken")
  : bad("Fix button falsely reported success while parseColor was still broken: " + stillBrokenText);
// Audit finding (accessibility): a failed repair used to unconditionally
// remove its own retry control - now it stays, re-enabled, so a keyboard
// user never loses their only way to try again.
const fixBtnAfterFailure = page.locator("button", { hasText: /Fix: re-sync status bar/ });
(await fixBtnAfterFailure.count()) === 1
  ? ok("Fix button stays available (re-enabled) for retry after a failed repair, instead of removing its own only retry control")
  : bad("Fix button was removed after a failed repair, with no way to retry");
(await fixBtnAfterFailure.isDisabled())
  ? bad("Fix button is still disabled after a failed repair - a keyboard user has no way to retry")
  : ok("Fix button re-enables itself after a failed repair");

// Re-break, regenerate a fresh failing card + Fix button, then restore
// parseColor BEFORE clicking Fix this time - the underlying condition is
// now healthy, so the repair's own re-verification should genuinely pass.
await page.evaluate(() => { window.G.native._debug.parseColor = () => ["not", "a", "number"]; });
// The primary run button's label toggles between "Run automated checks"
// and "Run again" depending on whether a run already happened THIS
// render() pass - Clear manual ticks (above) re-rendered the view, which
// reset it back to its unrun label. Locate it by its stable class instead.
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(400);
await page.evaluate(() => { window.G.native._debug.parseColor = window.__origParseColor; delete window.__origParseColor; });
await page.locator("button", { hasText: /Fix: re-sync status bar/ }).click();
await page.waitForTimeout(300);
const nowFixedText = await statusbarCatText();
nowFixedText && nowFixedText.indexOf("✓") !== -1
  ? ok("Fix button flips the card to a real, re-verified ✓ once the underlying check actually passes")
  : bad("Fix button did not flip to pass even though the underlying check was healthy: " + nowFixedText);

// The repair must have gone through logRepair()'s real before/after
// capture, not a hardcoded success - confirm it surfaces in Copy report.
await page.locator("button", { hasText: /Copy report/ }).click();
await page.waitForTimeout(300);
const repairClipboard = await page.evaluate(() => navigator.clipboard.readText());
/REPAIRS \(\d+\)/.test(repairClipboard) && /statusbar-resync/.test(repairClipboard)
  ? ok("Copy report's REPAIRS section reflects the logged statusbar-resync repair")
  : bad("REPAIRS section missing or incomplete in clipboard report: " + repairClipboard.slice(0, 500));

// ---- Diagnostics self-repair item 6: Service worker freshness Fix button ----
// No real second deploy exists in this test server, so a waiting worker is
// simulated the same way task #238's own tests simulate a native-only
// condition off-device: stub the one field the check actually reads.
await page.evaluate(() => {
  window.G.pwa.state.swWaiting = { postMessage: (msg) => { window.__swMsg = msg; } };
});
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(400);
const swCatText = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /service worker freshness/i.test(n.textContent || ""));
  return cat ? cat.textContent : null;
});
swCatText && swCatText.indexOf("✕") !== -1
  ? ok("'Service worker freshness' check reports fail (✕) once a waiting worker is detected")
  : bad("Service worker freshness check did not fail with a waiting worker present: " + swCatText);
const swFixCount = await page.locator("button", { hasText: /Fix: update to latest build/ }).count();
swFixCount > 0 ? ok("Fix button appears once a newer build is waiting") : bad("Fix button did not appear for a waiting service-worker update");
await page.locator("button", { hasText: /Fix: update to latest build/ }).click();
await page.waitForTimeout(300);
const swMsg = await page.evaluate(() => window.__swMsg);
swMsg && swMsg.type === "SKIP_WAITING"
  ? ok("Fix button calls G.pwa.applyUpdate(), which posts SKIP_WAITING to the waiting worker")
  : bad("Fix button did not post SKIP_WAITING to the waiting worker: " + JSON.stringify(swMsg));
await page.evaluate(() => { window.G.pwa.state.swWaiting = null; });

// ---- Upgrade-roadmap first wave, item 7: a real SW registration failure
// must report FAIL, not the same "No service worker registered yet." a
// healthy first boot also shows (both used to be indistinguishable). ----
await page.evaluate(() => { window.G.pwa.state.swRegFailed = "simulated registration failure (QA)"; });
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(400);
const swFailCatText = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /service worker freshness/i.test(n.textContent || ""));
  return cat ? cat.closest(".card").textContent : null;
});
(swFailCatText && swFailCatText.indexOf("✕") !== -1 && /simulated registration failure/.test(swFailCatText))
  ? ok("A real SW registration failure reports FAIL and names the actual error, not 'No service worker registered yet.'")
  : bad("Service worker freshness card text with swRegFailed set: " + swFailCatText);
await page.evaluate(() => { window.G.pwa.state.swRegFailed = false; });

// ---- Upgrade-roadmap first wave, item 6: Storage durability check + its
// "Fix: ask again" button. ----
await page.evaluate(() => {
  window.G.pwa.state.persisted = false;
  window.G.pwa.requestPersistence = async () => window.G.pwa.state.persisted;
});
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(400);
const persistCatText = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /storage durability/i.test(n.textContent || ""));
  return cat ? cat.closest(".card").textContent : null;
});
(persistCatText && persistCatText.indexOf("✕") !== -1 && /NOT granted/.test(persistCatText))
  ? ok("'Storage durability' check reports fail (✕) when persistence was not granted")
  : bad("Storage durability card text when not granted: " + persistCatText);
const persistFixCount = await page.locator("button", { hasText: /Fix: ask again/ }).count();
persistFixCount > 0 ? ok("Fix: ask again button appears when storage durability was not granted") : bad("Fix: ask again button did not appear");
await page.locator("button", { hasText: /Fix: ask again/ }).click();
await page.waitForTimeout(300);
const persistFixStillThere = await page.locator("button", { hasText: /Fix: ask again/ }).count();
persistFixStillThere > 0 ? ok("Fix button re-verifies rather than assuming success - still offers a retry while persistence is still denied") : bad("Fix button vanished even though persistence is still denied");
// Now let the (stubbed) browser actually grant it and retry.
await page.evaluate(() => { window.G.pwa.state.persisted = true; });
await page.locator("button", { hasText: /Fix: ask again/ }).click();
await page.waitForTimeout(300);
const persistFixGoneText = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /storage durability/i.test(n.textContent || ""));
  return cat ? cat.closest(".card").textContent : null;
});
(persistFixGoneText && /granted/i.test(persistFixGoneText) && !/NOT granted/.test(persistFixGoneText))
  ? ok("Fix: ask again flips the card to 'granted' once persistence is actually obtained")
  : bad("Storage durability card text after a successful re-ask: " + persistFixGoneText);
const persistFixRemoved = await page.locator("button", { hasText: /Fix: ask again/ }).count();
persistFixRemoved === 0 ? ok("Fix: ask again button removes itself once persistence is actually granted") : bad("Fix: ask again button is still present after a successful grant");

// ---- Upgrade-roadmap first wave, item 10: "Module integrity" and "Route
// health" used to be near-tautological - the first checked a fixed dozen
// hand-typed names that never included 6 real, later-added routes'
// modules, the second only confirmed G.routes was a non-empty array
// without ever calling a single render(). Both are now derived from/drive
// the real G.routes registry, so a genuinely broken module or route
// reports FAIL - verified here by forcing exactly that, the same way the
// statusbar/swfresh checks above are forced to fail on purpose. ----
const moduleBaseline = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /module integrity/i.test(n.textContent || ""));
  return cat ? cat.closest(".card").textContent : null;
});
(moduleBaseline && moduleBaseline.indexOf("✓") !== -1 && /\d\d modules present/.test(moduleBaseline))
  ? ok("'Module integrity' now derives its list from G.routes (30+ modules, not the old fixed dozen) and passes clean")
  : bad("Module integrity baseline text: " + moduleBaseline);

await page.evaluate(() => { window.__savedLeader = window.G.leader; delete window.G.leader; });
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(400);
const moduleFailText = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /module integrity/i.test(n.textContent || ""));
  return cat ? cat.closest(".card").textContent : null;
});
(moduleFailText && moduleFailText.indexOf("✕") !== -1 && /leader/.test(moduleFailText))
  ? ok("'Module integrity' reports FAIL and names 'leader' once a module a real route depends on is actually missing")
  : bad("Module integrity text with G.leader deleted: " + moduleFailText);
await page.evaluate(() => { window.G.leader = window.__savedLeader; delete window.__savedLeader; });

await page.evaluate(() => {
  const r = window.G.routes.find((x) => x.hash === "#/leader");
  window.__origLeaderRender = r.render;
  r.render = () => { throw new Error("simulated route failure (QA)"); };
});
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(1500);
const routesFailText = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /route health/i.test(n.textContent || ""));
  return cat ? cat.closest(".card").textContent : null;
});
(routesFailText && routesFailText.indexOf("✕") !== -1 && /#\/leader/.test(routesFailText) && /simulated route failure/.test(routesFailText))
  ? ok("'Route health' actually renders every route and reports FAIL naming the specific one that threw")
  : bad("Route health text with #/leader forced to throw: " + routesFailText);
await page.evaluate(() => {
  const r = window.G.routes.find((x) => x.hash === "#/leader");
  r.render = window.__origLeaderRender;
  delete window.__origLeaderRender;
});
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(1500);
const routesRestoredText = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /route health/i.test(n.textContent || ""));
  return cat ? cat.closest(".card").textContent : null;
});
(routesRestoredText && routesRestoredText.indexOf("✓") !== -1 && /routes rendered clean/.test(routesRestoredText))
  ? ok("'Route health' returns to a real clean pass once the route is restored (" + routesRestoredText.match(/\d+ routes rendered clean/)[0] + ")")
  : bad("Route health text after restoring #/leader: " + routesRestoredText);

// ---- Diagnostics self-repair items 7 & 8: kvscan "Review & repair" ----
// Corrupt one config-shaped row (has a safe default -> item 7's one-click,
// no-confirm reset) and one Soldier-authored row (no safe default -> item
// 8's named, confirm-gated quarantine), then drive both repair paths for real.
await page.evaluate(async () => {
  await window.G.db.put("kv", { k: "streak:v1", v: "not-an-object" });
  await window.G.db.put("kv", { k: "idp:goals", v: [{ notAGoal: true }] });
});
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(400);
const kvscanCatText = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /data validity scan/i.test(n.textContent || ""));
  return cat ? cat.textContent : null;
});
kvscanCatText && kvscanCatText.indexOf("✕") !== -1
  ? ok("'Data validity scan' check reports fail (✕) once real corrupted rows exist")
  : bad("Data validity scan did not fail with corrupted rows present: " + kvscanCatText);

const reviewBtn = page.locator("button", { hasText: /Review & repair/ });
(await reviewBtn.count()) > 0 ? ok("'Review & repair' button appears on the failing kvscan card") : bad("Review & repair button did not appear");
await reviewBtn.click();
await page.waitForTimeout(300);
const hasResetBtn = (await page.locator("button", { hasText: /Reset to default/ }).count()) > 0;
const hasQuarantineBtn = (await page.locator("button", { hasText: /Quarantine this entry/ }).count()) > 0;
hasResetBtn ? ok("streak:v1 (config-shaped, has a default) offers 'Reset to default' with no confirm") : bad("Reset to default button missing for streak:v1");
hasQuarantineBtn ? ok("idp:goals (Soldier-authored, no default) offers 'Quarantine this entry' instead") : bad("Quarantine this entry button missing for idp:goals");

// Item 7 path: reset streak:v1, no confirm dialog should appear.
await page.locator("button", { hasText: /Reset to default/ }).click();
await page.waitForTimeout(300);
const confirmAppearedForReset = await page.locator(".gm-box").count();
confirmAppearedForReset === 0 ? ok("Resetting a config-shaped row never opens a confirm dialog (item 7 is safe-by-construction)") : bad("A confirm dialog appeared for a supposedly no-confirm config reset");
const streakFixed = await page.evaluate(async () => { const r = await window.G.db.get("kv", "streak:v1"); return r && r.v && typeof r.v === "object" && typeof r.v.count === "number"; });
streakFixed ? ok("streak:v1 was actually rewritten to a valid default in IndexedDB") : bad("streak:v1 was not rewritten to a valid shape");

// Item 8 path: quarantine idp:goals, MUST go through a real named confirm.
await page.locator("button", { hasText: /Quarantine this entry/ }).click();
await page.waitForTimeout(300);
const quarantineConfirm = page.locator(".gm-box", { hasText: /Quarantine malformed entry/ });
(await quarantineConfirm.count()) > 0 ? ok("Quarantining a Soldier-authored row is gated behind a real, named confirm dialog") : bad("Quarantine confirm dialog did not appear");
const confirmText = await quarantineConfirm.textContent();
/idp:goals/.test(confirmText || "") ? ok("The confirm dialog names the exact key being deleted (idp:goals)") : bad("Confirm dialog did not name the key: " + (confirmText || "").slice(0, 200));
await page.locator(".gm-box button", { hasText: /Delete this entry/ }).click();
await page.waitForTimeout(300);
const goalsGone = await page.evaluate(async () => { const r = await window.G.db.get("kv", "idp:goals"); return !r; });
goalsGone ? ok("Confirming quarantine actually deletes the malformed row") : bad("idp:goals row still present after confirming quarantine");

const kvscanFixedText = await page.evaluate(() => {
  const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
  const cat = cats.find((n) => /data validity scan/i.test(n.textContent || ""));
  return cat ? cat.textContent : null;
});
kvscanFixedText && kvscanFixedText.indexOf("✓") !== -1
  ? ok("The outer 'Data validity scan' card re-verifies and flips to a real pass once both rows are repaired")
  : bad("Data validity scan card did not flip back to passing: " + kvscanFixedText);

// ---- Roadmap Tier 3: report-only AUTO checks now carry a concrete "next"
// step, not just a "why" rationale. Only the 4 checks with their own Fix
// button (statusbar/kvscan/swfresh/storagePersist) can safely self-repair;
// the other 11 are report-only and previously left the Soldier with a
// rationale but no instruction. Re-run for a clean full render (the kvscan
// section above left rows repaired, which is fine - "Next:" renders
// unconditionally alongside "why", independent of pass/fail).
await page.locator("button.btn.primary.sm").click();
await page.waitForTimeout(1200);

const REPORT_ONLY_CHECKS = [
  "Module integrity", "Route health", "Storage round-trip", "Content integrity",
  "No external requests", "Screen-reader landmarks", "Skip link reachable",
  "Heading hierarchy", "Contrast sample (current theme)", "No horizontal overflow",
  "Input mode detected",
];
const REPAIR_UI_CHECKS = ["Status bar theming", "Data validity scan", "Service worker freshness", "Storage durability"];

function cardTextFor(name) {
  return page.evaluate((n) => {
    const cats = Array.from(document.querySelectorAll(".ob-plan-cat"));
    const cat = cats.find((el) => el.textContent.replace(/^[✓✕]\s*/, "") === n);
    return cat ? cat.closest(".card").textContent : null;
  }, name);
}

const nextTexts = [];
for (const name of REPORT_ONLY_CHECKS) {
  const text = await cardTextFor(name);
  const m = text && text.match(/Next:\s*(.+)$/s);
  const nextStep = m ? m[1].trim() : null;
  if (nextStep && nextStep.length >= 40) {
    ok(`'${name}' shows a substantive Next step (${nextStep.length} chars)`);
    nextTexts.push(nextStep);
  } else {
    bad(`'${name}' is missing a substantive Next step: ${JSON.stringify(nextStep)}`);
  }
  // Not a generic placeholder - must actually reference something specific
  // to THIS check (its own name, or a concrete noun from its own detail/why),
  // not an interchangeable "see above"/"contact support" stand-in.
  if (nextStep && /^(see above|contact support|n\/a|todo)\.?$/i.test(nextStep)) {
    bad(`'${name}'s Next step reads as a generic placeholder: "${nextStep}"`);
  }
}
new Set(nextTexts).size === nextTexts.length
  ? ok("Every report-only check's Next step is check-specific text (no two checks share identical wording)")
  : bad("Two or more report-only checks share an identical Next step - looks like a copy-pasted generic placeholder");

for (const name of REPAIR_UI_CHECKS) {
  const text = await cardTextFor(name);
  !/Next:/.test(text || "")
    ? ok(`'${name}' has its own Fix button, so it correctly has no separate "Next:" text line`)
    : bad(`'${name}' unexpectedly rendered a "Next:" line even though it already has a Fix button`);
}

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nSELFTEST: all passed");
process.exit(fails ? 1 : 0);
