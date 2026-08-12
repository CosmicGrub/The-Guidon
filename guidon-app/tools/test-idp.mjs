/**
 * IDP goal builder ("My IDP" tab): sits behind a client-side tab click
 * (#/develop defaults to "Roadmap"), so the generic route sweep never
 * constructs it - add/delete/persist and the Export/Print buttons had zero
 * coverage of any kind before this. Covers the fix shipped this same week:
 * Export/Print used to only render after at least one goal existed.
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

await page.evaluate(() => { window.G.db.setSetting("idp:goals", []); });
await page.evaluate(() => { location.hash = "#/develop"; });
await page.waitForTimeout(600);
await page.locator("button", { hasText: /^My IDP$/ }).click();
await page.waitForTimeout(400);

// --- zero-goal state: empty message + Export/Print still render (the fix) ---
const emptyState = await page.evaluate(() => /No goals yet/i.test(document.body.textContent || ""));
emptyState ? ok("zero-goal state shows the empty message") : bad("empty message not shown");
const buttonsAtZero = await page.evaluate(() => ({
  exportBtn: [...document.querySelectorAll("button")].some((b) => /Export IDP/i.test(b.textContent || "")),
  printBtn: [...document.querySelectorAll("button")].some((b) => /Print IDP/i.test(b.textContent || "")),
}));
buttonsAtZero.exportBtn ? ok("Export IDP button renders with zero goals (was missing)") : bad("Export IDP button missing at zero goals");
buttonsAtZero.printBtn ? ok("Print IDP button renders with zero goals (was missing)") : bad("Print IDP button missing at zero goals");

// --- add a goal ---
await page.locator(".idp-form input[type=text]").first().fill("Complete BLC and get promoted to SGT");
await page.locator("button", { hasText: /\+ Add goal/i }).click();
await page.waitForTimeout(500);

const afterAdd = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "idp:goals");
  return (r && r.v) || [];
});
afterAdd.length === 1 ? ok("Add goal persists a new goal to idp:goals") : bad("idp:goals length after add: " + afterAdd.length);
afterAdd[0] && afterAdd[0].goal === "Complete BLC and get promoted to SGT"
  ? ok("the persisted goal's text matches what was typed")
  : bad("persisted goal text: " + JSON.stringify(afterAdd[0] && afterAdd[0].goal));

const cardVisible = await page.evaluate(() => /Complete BLC and get promoted to SGT/.test(document.body.textContent || ""));
cardVisible ? ok("the new goal appears in the on-screen list") : bad("new goal not shown in list");

// --- change status via the select, confirm it persists ---
const statusSel = page.locator(".idp-goal-ctl select").first();
if (await statusSel.count()) {
  await statusSel.selectOption("Done");
  await page.waitForTimeout(500);
  const afterStatus = await page.evaluate(async () => {
    const r = await window.G.db.get("kv", "idp:goals");
    return (r && r.v) || [];
  });
  afterStatus[0] && afterStatus[0].status === "Done"
    ? ok("changing status to Done persists")
    : bad("status after change: " + JSON.stringify(afterStatus[0] && afterStatus[0].status));
} else {
  bad("could not find the goal's status <select>");
}

// --- Remove deletes it ---
await page.locator("button", { hasText: /^Remove$/ }).first().click();
await page.waitForTimeout(500);
const afterRemove = await page.evaluate(async () => {
  const r = await window.G.db.get("kv", "idp:goals");
  return (r && r.v) || [];
});
afterRemove.length === 0 ? ok("Remove deletes the goal") : bad("idp:goals length after remove: " + afterRemove.length);

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `IDP: ${fails} FAILURE(S)` : "IDP: all passed"));
process.exit(fails ? 1 : 0);
