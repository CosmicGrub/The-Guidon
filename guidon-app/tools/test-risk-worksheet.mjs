/**
 * Roadmap-week audit finding (2nd pass): the Risk Assessment Worksheet
 * (#/risk, js/risk.js) has only one existing test — test-baseline-coverage.mjs's
 * single block, which exercises input -> computed-Risk-Level -> Save. The
 * Delete button on a saved worksheet card, the _serialize write-queue guard
 * that Save and Delete both rely on (added in a prior audit pass to fix a
 * documented lost-update race against the single kv row "risk:all"), the
 * Saved Worksheets list refresh, the quick-start template loader, and the
 * CRM 5-Step Process tab are all untested.
 *
 * Demonstrated empirically before writing this test (see the finding's own
 * verificationDone): reverting _serialize(fn) to `return fn();` (bypassing
 * the write queue, reproducing the pre-fix race verbatim) still passed
 * test-baseline-coverage.mjs's only #/risk block 100% clean, because that
 * block never calls Delete and never fires two mutations concurrently. This
 * file closes that gap.
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
await page.waitForTimeout(400);

async function goto(hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(500);
}

// Start clean regardless of anything a prior test left behind.
await page.evaluate(() => window.G.db.put("kv", { k: "risk:all", v: [] }));

// ==================== 1) CRM 5-Step Process tab ====================
await goto("#/risk");
(await page.locator("h2", { hasText: "Risk Management" }).count()) ? ok("#/risk view renders") : bad("#/risk heading missing");
(await page.locator("h3", { hasText: "Composite Risk Management" }).count()) === 0
  ? ok("CRM 5-Step content is not shown by default (Worksheet tab is default)")
  : bad("CRM content shown before switching tabs");
await page.locator(".tabbar button", { hasText: "CRM 5 Steps" }).click();
await page.waitForTimeout(300);
const crmHeading = await page.locator("h3", { hasText: "Composite Risk Management" }).count();
crmHeading ? ok("clicking the 'CRM 5 Steps' tab renders the 5-Step Process content") : bad("CRM tab click did not render its content");
const crmSteps = await page.locator("b", { hasText: /^(Identify Hazards|Assess Hazards|Develop Controls|Implement Controls|Supervise and Evaluate)$/ }).count();
crmSteps === 5 ? ok("all 5 real CRM steps render") : bad("expected 5 CRM step titles, found " + crmSteps);
await page.locator(".tabbar button", { hasText: "DA 7278 Worksheet" }).click();
await page.waitForTimeout(300);
(await page.locator("h3", { hasText: "Composite Risk Management" }).count()) === 0
  ? ok("switching back to 'DA 7278 Worksheet' hides the CRM content again")
  : bad("CRM content still present after switching back to the Worksheet tab");

// ==================== 2) Quick-start template loader ====================
const tmplSel = page.locator('select[aria-label="Load a scenario template"]');
(await tmplSel.count()) ? ok("quick-start template picker renders") : bad("template <select> not found");
await tmplSel.selectOption({ label: "Qualification Range (small arms)" });
await page.waitForTimeout(300);
const resourceVal = await page.locator('input[aria-label="Inspected Resource"]').inputValue();
resourceVal === "Small arms range (active fire)"
  ? ok("selecting a quick-start template pre-fills the Inspected Resource field")
  : bad("Inspected Resource after template select: " + JSON.stringify(resourceVal));
const valueRating = await page.locator('select[aria-label="Resource Value Rating"]').inputValue();
valueRating === "3" ? ok("the template's own valueIdx (3, 'High') is pre-filled too") : bad("Resource Value Rating after template select: " + valueRating);

// Reset back to a blank worksheet before the write-race tests below, so
// stray template data doesn't leak into the saved rows they assert on.
await page.locator("button", { hasText: /^Reset$/ }).click();
await page.waitForTimeout(300);

// ==================== 3) Delete removes the correct saved worksheet ====================
await page.evaluate(() => window.G.db.put("kv", { k: "risk:all", v: [
  { id: "rw-alpha", resource: "Worksheet Alpha", unit: "1-1 IN", category: "Test", valueIdx: 1, likelihood: {}, risk: "Low" },
  { id: "rw-bravo", resource: "Worksheet Bravo", unit: "2-2 IN", category: "Test", valueIdx: 1, likelihood: {}, risk: "Low" },
] }));
// Already on #/risk from the CRM-tab steps above - setting the hash to its
// own current value is a no-op (no hashchange fires), so the view would
// never pick up the just-seeded kv data. Bounce through "#/" first.
await goto("#/");
await goto("#/risk");
(await page.locator(".card", { hasText: "Worksheet Alpha" }).count()) === 1 ? ok("both pre-seeded worksheets render as saved cards (Alpha)") : bad("Worksheet Alpha card missing");
(await page.locator(".card", { hasText: "Worksheet Bravo" }).count()) === 1 ? ok("both pre-seeded worksheets render as saved cards (Bravo)") : bad("Worksheet Bravo card missing");

await page.locator(".card", { hasText: "Worksheet Alpha" }).locator("button", { hasText: "Delete" }).click();
await page.waitForTimeout(400);
const afterSingleDelete = await page.evaluate(async () => (await window.G.db.get("kv", "risk:all")).v.map((w) => w.id));
(!afterSingleDelete.includes("rw-alpha") && afterSingleDelete.includes("rw-bravo"))
  ? ok("Delete removes exactly the clicked worksheet from kv 'risk:all' and leaves the other intact")
  : bad("kv risk:all after single delete: " + JSON.stringify(afterSingleDelete));
(await page.locator(".card", { hasText: "Worksheet Alpha" }).count()) === 0
  ? ok("the deleted worksheet's card is also removed from the DOM")
  : bad("deleted worksheet's card is still rendered");

// ==================== 4) Concurrent Save + Delete regression test ====================
// This is the actual regression coverage for the _serialize() write-queue
// guard: fire a Save (of a brand-new worksheet) and a Delete (of the
// existing Bravo card) close enough together that neither click's async
// handler has resolved before the other starts - the exact shape of the
// original lost-update bug ("two rapid clicks... whichever save() resolves
// last silently overwrites the other's change"). If _serialize ever
// regresses back to a bare load->mutate->save(), one of Charlie/Bravo's
// fates below comes out wrong.
await page.fill('input[aria-label="Inspected Resource"]', "Worksheet Charlie");
// Two separate page.click() calls (even inside Promise.all) don't reliably
// overlap - Playwright's own actionability checks before each dispatch
// leave enough of a gap that the two onclick handlers' first awaits don't
// actually land back-to-back. Dispatching both native .click() calls from
// inside ONE page.evaluate() guarantees both onclick handlers start (and
// both reach their first `await loadAll()`) before either has a chance to
// finish - the exact interleaving the original bug needed to lose an
// update, and the shape a real "two rapid clicks" Soldier interaction can
// produce.
await page.evaluate(() => {
  const saveBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Save worksheet");
  const bravoCard = Array.from(document.querySelectorAll(".card")).find((c) => c.textContent.includes("Worksheet Bravo"));
  const deleteBtn = bravoCard && Array.from(bravoCard.querySelectorAll("button")).find((b) => b.textContent === "Delete");
  saveBtn.click();
  deleteBtn.click();
});
await page.waitForTimeout(600);
const afterRace = await page.evaluate(async () => (await window.G.db.get("kv", "risk:all")).v.map((w) => w.resource));
const charlieSaved = afterRace.includes("Worksheet Charlie");
const bravoDeleted = !afterRace.includes("Worksheet Bravo");
(charlieSaved && bravoDeleted)
  ? ok("concurrent Save + Delete both survive (Charlie saved AND Bravo deleted) - the _serialize write-queue guard is working")
  : bad("concurrent Save+Delete result: " + JSON.stringify(afterRace) + " (charlieSaved=" + charlieSaved + " bravoDeleted=" + bravoDeleted + ")");

// cleanup
await page.evaluate(() => window.G.db.put("kv", { k: "risk:all", v: [] }));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nRISK WORKSHEET: all passed");
process.exit(fails ? 1 : 0);
