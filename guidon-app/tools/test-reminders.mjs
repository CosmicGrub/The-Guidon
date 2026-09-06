/**
 * Reminders (G.reminders, mounted in the Profile view): the generic route
 * sweep reaches the empty-state editor structurally but never types a
 * label/date, clicks Add, removes an entry, or hits the storage cap - so a
 * regression in add()'s return-value contract (the exact bug fixed for the
 * salary-negotiation and USAJOBS quick-adds) or in the cap itself would ship
 * with a fully green npm test run. This exercises add/remove and the cap.
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

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

await page.evaluate(() => { window.G.db.setSetting("reminders:v1", []); });
await page.evaluate(() => { location.hash = "#/profile"; });
await page.waitForTimeout(700);

const editorVisible = await page.evaluate(() => /Reminders/.test(document.body.textContent || "") && !!document.querySelector('input[aria-label="Reminder date"]'));
editorVisible ? ok("Reminders editor renders on the Profile view") : bad("Reminders editor / date input not found");

// --- instrument G.db.get to count reads of the "reminders:v1" row ---
// Perf fix verification: add()/remove() already return the freshly-mutated
// list they just saved, but their button handlers used to hand that value
// to redraw() ANYWAY and let redraw() re-fetch the identical row from
// IndexedDB via its own load() call - one wasted "kv"/"reminders:v1" read
// per add/remove click. G.db.get is wrapped here (not spied via network,
// since IndexedDB access never crosses the network layer) to count real
// calls for that exact store+key across a single click, so a regression
// back to "redraw() always reloads" fails this test instead of merely
// looking plausible.
await page.evaluate(() => {
  window.__kvGetCount = 0;
  const origGet = window.G.db.get.bind(window.G.db);
  window.G.db.get = function (store, key) {
    if (store === "kv" && key === "reminders:v1") window.__kvGetCount++;
    return origGet(store, key);
  };
});

// --- add one ---
const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
await page.fill('input[aria-label="Reminder label"]', "Test reminder");
await page.fill('input[aria-label="Reminder date"]', future);
await page.evaluate(() => { window.__kvGetCount = 0; });
await page.locator("button", { hasText: /^Add reminder$/ }).click();
await page.waitForTimeout(500);
const addReadCount = await page.evaluate(() => window.__kvGetCount);

const afterAdd = await page.evaluate(async () => (await window.G.db.get("kv", "reminders:v1")).v || []);
afterAdd.length === 1 ? ok("Add reminder persists a new entry") : bad("reminders:v1 length after add: " + afterAdd.length);
afterAdd[0] && afterAdd[0].label === "Test reminder" ? ok("the persisted entry's label matches what was typed") : bad("persisted label: " + JSON.stringify(afterAdd[0] && afterAdd[0].label));

const rowVisible = await page.evaluate(() => /Test reminder/.test(document.body.textContent || ""));
rowVisible ? ok("the new reminder appears in the on-screen list") : bad("new reminder not shown in list");

addReadCount === 1 ? ok("Add reminder reads \"reminders:v1\" from IndexedDB exactly once (add()'s own load(), not a second one in redraw())")
  : bad("Add reminder read \"reminders:v1\" " + addReadCount + " time(s) - expected exactly 1 (redraw() should reuse add()'s already-fetched list, not re-fetch it)");

// --- remove it ---
await page.evaluate(() => { window.__kvGetCount = 0; });
await page.locator("button", { hasText: /^Remove$/ }).first().click();
await page.waitForTimeout(500);
const removeReadCount = await page.evaluate(() => window.__kvGetCount);
const afterRemove = await page.evaluate(async () => (await window.G.db.get("kv", "reminders:v1")).v || []);
afterRemove.length === 0 ? ok("Remove deletes the reminder") : bad("reminders:v1 length after remove: " + afterRemove.length);

removeReadCount === 1 ? ok("Remove reads \"reminders:v1\" from IndexedDB exactly once (remove()'s own load(), not a second one in redraw())")
  : bad("Remove read \"reminders:v1\" " + removeReadCount + " time(s) - expected exactly 1 (redraw() should reuse remove()'s already-fetched list, not re-fetch it)");

// --- storage cap: seed MAX_REMINDERS entries directly, confirm add() rejects one more ---
const capResult = await page.evaluate(async () => {
  const max = window.G.reminders.MAX;
  const full = Array.from({ length: max }, (_, i) => ({ id: "r" + i, kind: "custom", label: "R" + i, date: "2030-01-01" }));
  await window.G.db.setSetting("reminders:v1", full);
  const updated = await window.G.reminders.add({ kind: "custom", label: "one too many", date: "2030-01-01" });
  const after = (await window.G.db.get("kv", "reminders:v1")).v || [];
  return { max, updatedIsNull: updated === null, afterLength: after.length };
});
capResult.updatedIsNull ? ok("add() returns null when the " + capResult.max + "-reminder cap is hit") : bad("add() at cap returned: " + JSON.stringify(capResult.updatedIsNull));
capResult.afterLength === capResult.max ? ok("a rejected add does not grow the stored list past the cap") : bad("stored length at cap+1 attempt: " + capResult.afterLength);

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `REMINDERS: ${fails} FAILURE(S)` : "REMINDERS: all passed"));
process.exit(fails ? 1 : 0);
