/**
 * Salary Negotiation tab (Money -> "Salary Negotiation"): not the default
 * finance tab, so the generic route sweep never clicks into it - none of
 * its four persisted worksheets (salary range research, skills comparison,
 * job offer checklist, negotiation planner) or its reminder quick-add had
 * any coverage before this. All four worksheets debounce-persist to a
 * single "finance:salaryNeg:v1" kv row (see doPersistSalNeg()), so this
 * also exercises that every widget's onChange reaches the same save.
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

await page.evaluate(() => { window.G.db.setSetting("finance:salaryNeg:v1", {}); window.G.db.setSetting("reminders:v1", []); });
await page.evaluate(() => { location.hash = "#/money"; });
await page.waitForTimeout(600);
// Roadmap Tier 6c added a .list-detail-list navList row with this SAME
// label text next to .tabbar (see test-money-list-detail.mjs) - scoped to
// .tabbar specifically so this locator stays unique now that two buttons
// share the visible text "Salary Negotiation".
await page.locator(".tabbar button", { hasText: /^Salary Negotiation$/ }).click();
await page.waitForTimeout(400);

const rendered = await page.evaluate(() => /Salary Range Research worksheet/.test(document.body.textContent || ""));
rendered ? ok("Salary Negotiation tab renders the worksheets") : bad("Salary Range Research worksheet not found");

async function readSalNeg() {
  return page.evaluate(async () => (await window.G.db.get("kv", "finance:salaryNeg:v1")).v || {});
}

// --- Salary Range Research worksheet ---
await page.fill('input[placeholder="Desired job"]', "Logistics Manager");
await page.fill('input[placeholder="City / State"]', "San Antonio, TX");
await page.fill('input[placeholder="Range for this occupation here"]', "$55k-$70k");
await page.fill('input[placeholder="Specific salary (your exp/education)"]', "$62k");
await page.locator('input[placeholder="Desired job"]').blur();
await page.waitForTimeout(400);
let v = await readSalNeg();
(v.salaryRange && v.salaryRange[0] && v.salaryRange[0].job === "Logistics Manager" && v.salaryRange[0].range === "$55k-$70k")
  ? ok("Salary range research row persists all four fields")
  : bad("salaryRange[0] after fill: " + JSON.stringify(v.salaryRange && v.salaryRange[0]));

await page.locator("button", { hasText: /^\+ Add row$/ }).first().click();
await page.waitForTimeout(200);
const rangeRowCount = await page.locator(".fin-range-row").count();
rangeRowCount === 2 ? ok("'+ Add row' adds a second salary range row") : bad("row count after add: " + rangeRowCount);

// --- Skills Comparison Chart ---
await page.fill('input[placeholder="Job posting requirement"]', "5+ years supply chain experience");
await page.fill('input[placeholder="Your skills / qualifications"]', "6 years as a 92Y managing unit supply");
await page.locator('input[placeholder="Your skills / qualifications"]').blur();
await page.waitForTimeout(400);
v = await readSalNeg();
(v.skillsComparison && v.skillsComparison[0] && v.skillsComparison[0].candidate === "6 years as a 92Y managing unit supply")
  ? ok("Skills comparison chart row persists both fields")
  : bad("skillsComparison[0] after fill: " + JSON.stringify(v.skillsComparison && v.skillsComparison[0]));

// --- Job Offer Evaluation Checklist ---
const firstCheckSelect = page.locator(".fin-check-row select").first();
if (await firstCheckSelect.count()) {
  await firstCheckSelect.selectOption("accept");
  await page.waitForTimeout(400);
  v = await readSalNeg();
  const checklistVals = Object.values(v.jobOfferChecklist || {});
  checklistVals.includes("accept")
    ? ok("Job offer checklist selection persists (marked Acceptable)")
    : bad("jobOfferChecklist after select: " + JSON.stringify(v.jobOfferChecklist));
} else {
  bad("could not find a job offer checklist <select>");
}

// --- Negotiation planner ---
const plannerRow = page.locator(".fin-plan-row", { hasText: "Salary" }).first();
if (await plannerRow.count()) {
  await plannerRow.locator("select").selectOption("High");
  await plannerRow.locator('input[type=text]').fill("Willing to trade PTO for base pay");
  await plannerRow.locator('input[type=text]').blur();
  await page.waitForTimeout(400);
  v = await readSalNeg();
  const p = v.negotiationPlanner || {};
  (p["Salary"] === "High" && p["Salary::note"] === "Willing to trade PTO for base pay")
    ? ok("Negotiation planner priority + note persist for 'Salary'")
    : bad("negotiationPlanner after fill: " + JSON.stringify(p));
} else {
  bad("could not find the 'Salary' row in the negotiation planner");
}

// --- Quick-add reminder ("Waiting to hear back on an offer?") ---
const future = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
await page.fill('input[aria-label="Follow-up date"]', future);
await page.fill('input[placeholder="Which offer? (optional)"]', "Acme Logistics offer");
await page.locator("button", { hasText: /^Remind me$/ }).click();
await page.waitForTimeout(500);
const reminders = await page.evaluate(async () => (await window.G.db.get("kv", "reminders:v1")).v || []);
(reminders.length === 1 && reminders[0].kind === "negotiation" && reminders[0].label === "Acme Logistics offer")
  ? ok("Quick-add reminder persists a 'negotiation' kind reminder with the typed label")
  : bad("reminders:v1 after quick-add: " + JSON.stringify(reminders));

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `SALNEG: ${fails} FAILURE(S)` : "SALNEG: all passed"));
process.exit(fails ? 1 : 0);
