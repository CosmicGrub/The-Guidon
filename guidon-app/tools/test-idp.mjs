/**
 * IDP goal builder ("My IDP" tab): sits behind a client-side tab click
 * (#/develop defaults to "Roadmap"), so the generic route sweep never
 * constructs it - add/delete/persist and the Export/Print buttons had zero
 * coverage of any kind before this. Covers the fix shipped this same week:
 * Export/Print used to only render after at least one goal existed.
 */
import { bootApp, ok, bad, finish, waitForRoute, clickWhenStable, until, untilAsync, expectNoConsoleNoise } from "./testkit.mjs";

const { page, noise } = await bootApp();

// What is saved for the goal list right now (the app's own on-device store).
const savedGoals = () => page.evaluate(async () => { const r = await window.G.db.get("kv", "idp:goals"); return (r && r.v) || []; });

await page.evaluate(() => window.G.db.setSetting("idp:goals", []));
await waitForRoute(page, "#/develop", { ready: page.locator("button", { hasText: /^My IDP$/ }) });
await clickWhenStable(page, page.locator("button", { hasText: /^My IDP$/ }));
// The tab is drawn once its new-goal form is on screen.
await until(page, () => !!document.querySelector(".idp-form input[type=text]"));

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
await clickWhenStable(page, page.locator("button", { hasText: /\+ Add goal/i }));
// Saved AND redrawn: the status control only exists on a drawn goal card.
await untilAsync(page, async () => { const r = await window.G.db.get("kv", "idp:goals"); return !!(r && r.v && r.v.length) && !!document.querySelector(".idp-goal-ctl select"); });

const afterAdd = await savedGoals();
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
  await untilAsync(page, async () => { const r = await window.G.db.get("kv", "idp:goals"); return !!(r && r.v && r.v[0] && r.v[0].status === "Done"); });
  const afterStatus = await savedGoals();
  afterStatus[0] && afterStatus[0].status === "Done"
    ? ok("changing status to Done persists")
    : bad("status after change: " + JSON.stringify(afterStatus[0] && afterStatus[0].status));
} else {
  bad("could not find the goal's status <select>");
}

// --- Remove deletes it ---
await clickWhenStable(page, page.locator("button", { hasText: /^Remove$/ }).first());
await untilAsync(page, async () => { const r = await window.G.db.get("kv", "idp:goals"); return !!(r && r.v && r.v.length === 0); });
const afterRemove = await savedGoals();
afterRemove.length === 0 ? ok("Remove deletes the goal") : bad("idp:goals length after remove: " + afterRemove.length);

expectNoConsoleNoise(noise, { pass: "no console errors/warnings" });
await finish("IDP");
