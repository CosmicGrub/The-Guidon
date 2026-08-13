/**
 * Records Readiness (#/records, G.records): the pre-board paperwork
 * checklist (23 items across 5 groups). The generic route sweep only loads
 * it once and never checks a box, so its actual persistence, live progress
 * math, and the VALID_IDS staleness guard (which ignores any kv key that
 * doesn't name a checklist item the CURRENT GROUPS shape can produce - the
 * defense against a future reorder/resize silently misapplying or
 * over-counting an orphaned key) had no interactive coverage at all.
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
await page.waitForTimeout(300);

// Clean slate: this key can carry state across test runs on a shared profile.
await page.evaluate(() => window.G.db.put("kv", { k: "guidon:records:checks:v1", v: {} }));
await page.evaluate(() => { location.hash = "#/records"; });
await page.waitForTimeout(500);

const heading = await page.evaluate(() => /Records Readiness/.test(document.body.textContent || ""));
heading ? ok("Records Readiness view renders") : bad("heading not found");

const checkboxCount = await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]').length);
checkboxCount === 23 ? ok("Renders all 23 checklist items across 5 groups") : bad("checkbox count: " + checkboxCount);

const progressInitial = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
progressInitial === "0 of 23 confirmed" ? ok("Progress starts at '0 of 23 confirmed'") : bad("initial progress text: " + progressInitial);

const fillWidthInitial = await page.evaluate(() => document.querySelector(".panel div[style*='width']")?.style.width || "");
fillWidthInitial === "0%" ? ok("Progress bar fill starts at 0%") : bad("initial fill width: " + fillWidthInitial);

// ---- checking one box updates progress and persists ----
const firstBox = page.locator('input[type="checkbox"]').first();
await firstBox.check();
await page.waitForTimeout(200);
const progressAfterOne = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
progressAfterOne === "1 of 23 confirmed" ? ok("Checking one item updates progress to '1 of 23 confirmed'") : bad("progress after one check: " + progressAfterOne);

const persistedAfterOne = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "guidon:records:checks:v1");
  return r && r.v && r.v["rec-0-0"] === true;
});
persistedAfterOne ? ok("Checking a box persists it to IndexedDB (rec-0-0: true)") : bad("checkbox state not persisted");

// ---- survives a fresh re-render (not just in-memory) ----
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/records"; });
await page.waitForTimeout(500);
const firstBoxCheckedAfterRerender = await page.locator('input[type="checkbox"]').first().isChecked();
firstBoxCheckedAfterRerender ? ok("Checked state survives a full re-render of the view") : bad("checkbox did not survive re-render");
const progressAfterRerender = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
progressAfterRerender === "1 of 23 confirmed" ? ok("Progress count is correct on re-render") : bad("progress after re-render: " + progressAfterRerender);

// ---- unchecking decrements ----
await page.locator('input[type="checkbox"]').first().uncheck();
await page.waitForTimeout(200);
const progressAfterUncheck = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
progressAfterUncheck === "0 of 23 confirmed" ? ok("Unchecking the item returns progress to '0 of 23 confirmed'") : bad("progress after uncheck: " + progressAfterUncheck);

// ---- VALID_IDS staleness guard: an orphaned/malformed key must not be
// counted or crash the view, even though it's a real truthy entry in the kv row ----
await page.evaluate(() => window.G.db.put("kv", {
  k: "guidon:records:checks:v1",
  v: { "rec-0-0": true, "rec-99-99": true, "rec-0-1": "not-a-boolean" },
}));
await page.evaluate(() => { location.hash = "#/home"; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = "#/records"; });
await page.waitForTimeout(500);
const progressWithStaleKey = await page.evaluate(() => (document.querySelector(".ob-plan-cat") || {}).textContent || "");
// rec-0-0 is a real, currently-valid id (counts) - rec-99-99 doesn't name any
// real item under the current 5x{5,5,5,4,4} GROUPS shape (ignored) -
// rec-0-1's truthy-but-non-boolean value still counts (the guard only
// checks VALID_IDS[k], not typeof saved[k] - matches the module's own
// documented "if (VALID_IDS[k] && saved[k])" check).
progressWithStaleKey === "2 of 23 confirmed" ? ok("Orphaned key (rec-99-99) is silently ignored, not counted or crashing (VALID_IDS guard)") : bad("progress with stale key present: " + progressWithStaleKey);

// cleanup
await page.evaluate(() => window.G.db.put("kv", { k: "guidon:records:checks:v1", v: {} }));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nRECORDS: all passed");
process.exit(fails ? 1 : 0);
