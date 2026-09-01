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
 *
 * Roadmap audit round 5, "Test Coverage Gaps" bucket: two more real gaps
 * added below, both confirmed missing by grepping every test file before
 * writing anything here. (1) renderWorksheet()'s "Load" button (sets
 * G.risk._pendingModel and re-renders so header fields/computed risk band
 * are pre-filled from a saved record) had zero coverage — only "Delete" was
 * ever clicked. (2) the "Print / Save" button's hand-assembled DA 7278
 * report (util.printHTML) had zero coverage, unlike its three sibling
 * hand-built print paths in test-print-paths.mjs (Progress/Action
 * Plan/Memo), which that file's own header notes "all three have shipped
 * real bugs before" — the same class of bug (unescaped field -> stored XSS)
 * is just as reachable here since every risk-worksheet field is free text.
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
// window.print() is stubbed up front (same technique test-print-paths.mjs
// uses) for the "Print / Save" case below — real print() can hang/behave
// oddly headless, and that case only needs the #print-holder DOM
// util.printHTML() builds before ever calling window.print().
await page.addInitScript(() => { window.print = () => {}; });
await page.evaluate(() => { window.print = () => {}; });
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
// Roadmap audit round 5, "Content Accuracy" bucket: the tab's own h3 heading
// was renamed from "Composite Risk Management" to "Risk Management (RM)" -
// board question rm-5's own citations say ATP 5-19's current (Nov 2021)
// edition doesn't use "composite" at all. Assertions below updated to match.
await goto("#/risk");
(await page.locator("h2", { hasText: "Risk Management" }).count()) ? ok("#/risk view renders") : bad("#/risk heading missing");
(await page.locator("h3", { hasText: "Risk Management (RM)" }).count()) === 0
  ? ok("CRM 5-Step content is not shown by default (Worksheet tab is default)")
  : bad("CRM content shown before switching tabs");
await page.locator(".tabbar button", { hasText: "CRM 5 Steps" }).click();
await page.waitForTimeout(300);
const crmHeading = await page.locator("h3", { hasText: "Risk Management (RM)" }).count();
crmHeading ? ok("clicking the 'CRM 5 Steps' tab renders the 5-Step Process content") : bad("CRM tab click did not render its content");
const crmSteps = await page.locator("b", { hasText: /^(Identify Hazards|Assess Hazards|Develop Controls|Implement Controls|Supervise and Evaluate)$/ }).count();
crmSteps === 5 ? ok("all 5 real CRM steps render") : bad("expected 5 CRM step titles, found " + crmSteps);
await page.locator(".tabbar button", { hasText: "DA 7278 Worksheet" }).click();
await page.waitForTimeout(300);
(await page.locator("h3", { hasText: "Risk Management (RM)" }).count()) === 0
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

// ==================== 4) Load pre-fills the header fields + computed Risk Level from a saved worksheet ====================
// Roadmap audit round 5, "Test Coverage Gaps" bucket: renderWorksheet()'s
// "Load" button (el("button.btn.sm.ghost", {text:"Load", onclick: ...})
// right next to "Delete" on every saved-worksheet card) had never been
// clicked by any test - only Delete was covered. Seed one saved worksheet
// with distinctive values in every header field plus a valueIdx/likelihood
// combination that recomputes to a real, known band (4 + 4 = score 8 ->
// riskBand()'s High bucket, the same combination test-baseline-coverage.mjs
// already uses for its own single #/risk assertion), click that card's own
// "Load" button, and confirm every field actually came from the loaded
// record - not leftover from whatever the worksheet held before Load was
// clicked - and that the computed output recomputed fresh from the loaded
// valueIdx/likelihood rather than just echoing the record's stored `risk`
// string.
await page.evaluate(() => window.G.db.put("kv", { k: "risk:all", v: [
  { id: "rw-loadtest", unit: "3-3 IN", resource: "Load Test Resource", location: "Test FOB", category: "Physical security", analyst: "SGT Test", date: "2026-05-01", valueIdx: 4, valueDesc: "Load-button coverage fixture", likelihood: { "Insider Threat": 4 }, risk: "High", highest: "Insider Threat", likeIdx: 4 },
] }));
await goto("#/");
await goto("#/risk");
(await page.locator(".card", { hasText: "Load Test Resource" }).count()) === 1 ? ok("the seeded worksheet renders as a saved card before Load is clicked") : bad("seeded 'Load Test Resource' card missing");

await page.locator(".card", { hasText: "Load Test Resource" }).locator("button", { hasText: "Load" }).click();
await page.waitForTimeout(400);

const loadedFields = {
  unit: await page.locator('input[aria-label="Unit or Organization"]').inputValue(),
  resource: await page.locator('input[aria-label="Inspected Resource"]').inputValue(),
  location: await page.locator('input[aria-label="Resource Location"]').inputValue(),
  category: await page.locator('input[aria-label="Resource Category"]').inputValue(),
  analyst: await page.locator('input[aria-label="Analyst"]').inputValue(),
  date: await page.locator('input[aria-label="Date"]').inputValue(),
  valueIdx: await page.locator('select[aria-label="Resource Value Rating"]').inputValue(),
  likelihood: await page.locator('select[aria-label="Aggressor likelihood — Insider Threat"]').inputValue(),
};
const expectedFields = { unit: "3-3 IN", resource: "Load Test Resource", location: "Test FOB", category: "Physical security", analyst: "SGT Test", date: "2026-05-01", valueIdx: "4", likelihood: "4" };
const fieldsMatch = Object.keys(expectedFields).every((k) => loadedFields[k] === expectedFields[k]);
fieldsMatch
  ? ok("clicking Load pre-fills every header field from the saved record (unit/resource/location/category/analyst/date/valueIdx/likelihood)")
  : bad("fields after Load: " + JSON.stringify(loadedFields) + " expected: " + JSON.stringify(expectedFields));

const loadedComputed = await page.locator('[aria-label="Computed risk level"]').textContent();
/RISK LEVEL: HIGH/.test(loadedComputed)
  ? ok("the computed RISK LEVEL after Load matches the loaded record's valueIdx+likelihood (score 8 -> High)")
  : bad("computed risk level after Load: " + JSON.stringify(loadedComputed));

// cleanup before the next section reuses "risk:all"
await page.evaluate(() => window.G.db.put("kv", { k: "risk:all", v: [] }));

// ==================== 5) "Print / Save" builds a real DA 7278 report with escaped, computed content ====================
// Roadmap audit round 5, "Test Coverage Gaps" bucket: the "Print / Save"
// button hand-assembles an HTML string (unit/resource/location/category/
// analyst/date, aggressor-likelihood table, highest-aggressor summary,
// computed RISK LEVEL) and hands it straight to util.printHTML() - the same
// #print-holder pipeline test-print-paths.mjs already proved has shipped
// real stored-XSS bugs for OTHER hand-built reports in this app (its own
// header comment: "all three have shipped real bugs before"). Every field
// here is free text a Soldier types, so the same class of bug is just as
// reachable. Fills distinctive HTML-special-character text into two fields,
// drives a known score (4+4=8 -> High, same combination as section 4 above)
// so the computed band is deterministic, and asserts the printed output
// both contains the exact ESCAPED field values and does NOT contain the
// raw unescaped markup (which would mean the payload could execute once
// actually printed/opened).
await goto("#/");
await goto("#/risk");
await page.fill('input[aria-label="Unit or Organization"]', "<b>1-1 IN</b>");
await page.fill('input[aria-label="Inspected Resource"]', "<script>window.__riskPrintXss=1</script>Arms Room");
await page.locator('select[aria-label="Resource Value Rating"]').selectOption("4");
await page.locator('select[aria-label="Aggressor likelihood — Insider Threat"]').selectOption("4");
await page.waitForTimeout(300);

await page.locator("button", { hasText: /Print \/ Save/ }).click();
await page.waitForTimeout(500);
const riskPrint = await page.evaluate(() => {
  const h = document.querySelector("#print-holder");
  const html = h ? h.innerHTML : "";
  if (h) h.remove();
  return html;
});
/&lt;b&gt;1-1 IN&lt;\/b&gt;/.test(riskPrint) ? ok("Print / Save escapes the Unit field's HTML-special-character text") : bad("escaped Unit text not found in risk print: " + riskPrint.slice(0, 200));
/&lt;script&gt;window\.__riskPrintXss=1&lt;\/script&gt;Arms Room/.test(riskPrint) ? ok("Print / Save escapes the Inspected Resource field's injected script tag") : bad("escaped Resource text not found in risk print: " + riskPrint.slice(0, 200));
const riskPrintHasRawTag = /<script>window\.__riskPrintXss=1<\/script>/.test(riskPrint) || /<b>1-1 IN<\/b>/.test(riskPrint);
!riskPrintHasRawTag ? ok("the raw, unescaped markup is not present anywhere in the printed report") : bad("raw unescaped markup leaked into risk print: " + riskPrint.slice(0, 300));
const riskPrintXssFired = await page.evaluate(() => !!window.__riskPrintXss);
!riskPrintXssFired ? ok("the injected script payload did not actually execute") : bad("XSS payload executed - window.__riskPrintXss was set");
/RISK LEVEL: HIGH/.test(riskPrint) ? ok("the printed report includes the correct computed RISK LEVEL band (High)") : bad("printed risk band missing/wrong: " + riskPrint.slice(0, 300));

// cleanup before the concurrent-write section below reuses "risk:all"
await page.evaluate(() => window.G.db.put("kv", { k: "risk:all", v: [
  { id: "rw-bravo", resource: "Worksheet Bravo", unit: "2-2 IN", category: "Test", valueIdx: 1, likelihood: {}, risk: "Low" },
] }));
await goto("#/");
await goto("#/risk");
await page.locator("button", { hasText: /^Reset$/ }).click();
await page.waitForTimeout(300);

// ==================== 6) Concurrent Save + Delete regression test ====================
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
