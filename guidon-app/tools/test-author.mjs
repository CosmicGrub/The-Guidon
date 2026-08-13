/**
 * Authoring Studio (#/author, G.author): the largest, most complex editor in
 * the app (three tabs over one schema/validator, a node graph, destructive
 * node/choice deletion with dangling-reference cleanup, JSON<->Guided
 * round-tripping, single vs. array export/import shapes) and it had zero
 * interactive coverage before this - only whatever the generic route sweep
 * reaches by loading the empty list. This exercises the full authoring loop:
 * create -> break validation -> get blocked on Save -> fix it -> save ->
 * edit -> switch tabs without losing data -> delete a node (dangling-ref
 * cleanup) -> re-save -> export -> delete -> re-import.
 *
 * The Export All / Import JSON leg specifically re-runs the scenario for
 * #108 (Export All produced an ARRAY that Import JSON, at the time, only
 * ever accepted as a single object) using the app's own real downloaded
 * file, not a hand-authored stand-in for it.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
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

// Clean slate: delete any authored scenarios left by a previous run.
await page.evaluate(async () => {
  const all = (await window.G.db.allUserScenarios()) || [];
  for (const sc of all) await window.G.db.delUserScenario(sc.id);
});
await page.evaluate(() => { location.hash = "#/author"; });
await page.waitForTimeout(500);

async function acceptModal() {
  const okBtn = page.locator(".gm-box button", { hasText: /^OK$/ });
  await okBtn.waitFor({ state: "visible", timeout: 3000 });
  await okBtn.click();
  // confirm()'s promise only resolves once .gm-back is removed from the DOM
  // (see modal.js's finishClose()) - the up-to-400ms close transition means
  // a fixed short wait can race the onclick handler's post-confirm code.
  await page.locator(".gm-back").waitFor({ state: "detached", timeout: 3000 });
  await page.waitForTimeout(150);
}

const emptyList = await page.evaluate(() => /No authored scenarios yet/.test(document.body.textContent || ""));
emptyList ? ok("Authoring Studio starts with the empty-list state") : bad("empty-list message not shown");

// ---- create ----
await page.locator("button", { hasText: /New Scenario/ }).click();
await page.waitForTimeout(300);
const editorOpen = await page.evaluate(() => /New Scenario/.test(document.body.textContent || "") && !!document.querySelector(".node-editor"));
editorOpen ? ok("'+ New Scenario' opens the Guided editor pre-filled from TEMPLATE") : bad("editor did not open");

const titleField = page.locator(".panel input[type=text]").first();
await titleField.fill("QA Test Scenario");

// Template is valid out of the box.
await page.locator("button", { hasText: /^Validate$/ }).click();
await page.waitForTimeout(200);
let validText = await page.evaluate(() => document.body.textContent || "");
/Valid/.test(validText) ? ok("a freshly-created scenario validates clean") : bad("template did not validate as clean");

// ---- break it: remove both of n1's choices -> "no choices" error ----
for (let i = 0; i < 2; i++) {
  const removeBtn = page.locator('.node-editor[data-node="n1"] .choice-editor button', { hasText: /^remove$/ }).first();
  await removeBtn.click();
  await acceptModal();
}
const noChoiceLeft = await page.evaluate(() => document.querySelectorAll('.node-editor[data-node="n1"] .choice-editor').length === 0);
noChoiceLeft ? ok("both of node n1's choices were removed") : bad("choices still present after removing both");

await page.locator("button", { hasText: /^Validate$/ }).click();
await page.waitForTimeout(200);
let invalidText = await page.evaluate(() => document.body.textContent || "");
/n1.*no choices/.test(invalidText) ? ok("Validate reports node n1 has no choices") : bad("expected no-choices error not shown: " + invalidText.slice(0, 200));

// Save must refuse while invalid.
await page.locator("button", { hasText: /^Save$/ }).click();
await page.waitForTimeout(250);
let saveBlockedText = await page.evaluate(() => document.body.textContent || "");
const stillEditing = await page.evaluate(() => !!document.querySelector(".node-editor"));
(/Cannot save/.test(saveBlockedText) && stillEditing)
  ? ok("Save refuses an invalid scenario and stays on the editor")
  : bad("invalid Save did not block / left the editor");

// ---- fix it: add a choice pointing at the 'good' end node ----
await page.locator('.node-editor[data-node="n1"] button', { hasText: /choice/ }).click();
await page.waitForTimeout(200);
const newChoiceText = page.locator('.node-editor[data-node="n1"] .choice-editor input[type=text]').first();
await newChoiceText.fill("Report the discrepancy immediately.");
const gotoSel = page.locator('.node-editor[data-node="n1"] .choice-editor select').first();
await gotoSel.selectOption("good");

await page.locator("button", { hasText: /^Validate$/ }).click();
await page.waitForTimeout(200);
validText = await page.evaluate(() => document.body.textContent || "");
/Valid/.test(validText) ? ok("re-adding a valid choice makes the scenario valid again") : bad("still invalid after fixing: " + validText.slice(0, 200));

await page.locator("button", { hasText: /^Save$/ }).click();
await page.waitForTimeout(500);
let listText = await page.evaluate(() => document.body.textContent || "");
(/Your Scenarios \(1\)/.test(listText) && /QA Test Scenario/.test(listText))
  ? ok("Save persists the scenario and returns to the list")
  : bad("list after save: " + listText.slice(0, 300));

// ---- edit again: JSON <-> Guided round-trip must not lose data ----
await page.locator(".card button", { hasText: /^Edit$/ }).click();
await page.waitForTimeout(300);
await page.locator(".author-tabs button", { hasText: /^JSON$/ }).click();
await page.waitForTimeout(200);
const jsonText = await page.locator("textarea[spellcheck='false']").inputValue();
(jsonText.includes('"QA Test Scenario"') && jsonText.includes('"good"'))
  ? ok("JSON tab shows the saved scenario's real data")
  : bad("JSON tab content missing expected fields");

await page.locator(".author-tabs button", { hasText: /^Guided$/ }).click();
await page.waitForTimeout(200);
const titleAfterRoundTrip = await page.locator(".panel input[type=text]").first().inputValue();
titleAfterRoundTrip === "QA Test Scenario"
  ? ok("switching JSON -> Guided round-trips without losing the title")
  : bad("title after JSON round-trip: " + JSON.stringify(titleAfterRoundTrip));

// ---- delete the now-orphaned 'bad' end node (no incoming references) ----
await page.locator('.node-editor[data-node="bad"] button', { hasText: /node/ }).click();
await acceptModal();
const nodeCountAfterDelete = await page.evaluate(() => document.querySelectorAll(".node-editor").length);
nodeCountAfterDelete === 2 ? ok("deleting the orphaned 'bad' node leaves the other 2 nodes intact") : bad("node count after delete: " + nodeCountAfterDelete);

await page.locator("button", { hasText: /^Validate$/ }).click();
await page.waitForTimeout(200);
validText = await page.evaluate(() => document.body.textContent || "");
/Valid/.test(validText) ? ok("scenario is still valid after deleting the orphaned node") : bad("invalid after node delete: " + validText.slice(0, 200));

await page.locator("button", { hasText: /^Save$/ }).click();
await page.waitForTimeout(500);
listText = await page.evaluate(() => document.body.textContent || "");
/2 nodes/.test(listText) ? ok("list card reflects the reduced 2-node count after re-save") : bad("list meta after re-save: " + listText.slice(0, 300));

// ---- Export All / Import JSON round trip (regression for #108) ----
const [exportAllDl] = await Promise.all([
  page.waitForEvent("download"),
  page.locator("button", { hasText: /Export All/ }).click(),
]);
const exportAllPath = await exportAllDl.path();
const exportAllRaw = fs.readFileSync(exportAllPath, "utf8");
const exportAllParsed = JSON.parse(exportAllRaw);
(Array.isArray(exportAllParsed) && exportAllParsed.length === 1 && exportAllParsed[0].title === "QA Test Scenario")
  ? ok("Export All downloads a JSON ARRAY containing the authored scenario")
  : bad("Export All content: " + exportAllRaw.slice(0, 200));

await page.locator(".card button", { hasText: /^Delete$/ }).click();
await acceptModal();
listText = await page.evaluate(() => document.body.textContent || "");
/No authored scenarios yet/.test(listText) ? ok("Delete removes the scenario, list returns to empty") : bad("list not empty after delete: " + listText.slice(0, 200));

// Re-import the exact file Export All just produced - this is the array
// shape that used to be silently rejected by Import JSON before #108.
const fileInput = page.locator('input[type=file]');
await fileInput.setInputFiles(exportAllPath);
await page.waitForTimeout(500);
listText = await page.evaluate(() => document.body.textContent || "");
(/Your Scenarios \(1\)/.test(listText) && /QA Test Scenario/.test(listText))
  ? ok("Import JSON accepts Export All's array-shaped file and restores the scenario")
  : bad("list after re-import: " + listText.slice(0, 300));

// ---- single-scenario Export shape ----
const [singleDl] = await Promise.all([
  page.waitForEvent("download"),
  page.locator(".card button", { hasText: /^Export$/ }).click(),
]);
const singleRaw = fs.readFileSync(await singleDl.path(), "utf8");
const singleParsed = JSON.parse(singleRaw);
(!Array.isArray(singleParsed) && singleParsed.title === "QA Test Scenario")
  ? ok("a single scenario's own Export button downloads a plain object (not an array)")
  : bad("single Export content: " + singleRaw.slice(0, 200));

// ---- Import JSON also accepts a hand-authored, well-formed single object ----
const importTmpPath = path.join(os.tmpdir(), "guidon-test-import-" + Date.now() + ".json");
const handAuthored = {
  id: "sc-qa-import-" + Date.now(),
  title: "Hand-Imported QA Scenario",
  tier: ["E4"], competency: ["Leads"], estMinutes: 2, difficulty: "Basic",
  doctrine: [{ ref: "ADP 6-22", para: "1-1", asOf: "2019-07" }],
  defaultMode: "course", renderModes: ["text", "course", "cyoa"], scene: "TEST — 0900",
  start: "n1",
  nodes: {
    n1: { prompt: "Test prompt", choices: [{ text: "Go", goto: "end1", score: { Leads: 1 }, feedback: "ok" }] },
    end1: { prompt: "", end: true, outcome: "Test outcome" },
  },
};
fs.writeFileSync(importTmpPath, JSON.stringify(handAuthored, null, 2));
await fileInput.setInputFiles(importTmpPath);
await page.waitForTimeout(500);
listText = await page.evaluate(() => document.body.textContent || "");
(/Your Scenarios \(2\)/.test(listText) && /Hand-Imported QA Scenario/.test(listText))
  ? ok("Import JSON also accepts a hand-authored single-object file")
  : bad("list after hand-authored import: " + listText.slice(0, 300));
fs.unlinkSync(importTmpPath);

// ---- Map tab: node boxes render, are keyboard-operable, and route back to
// the exact node clicked (regression coverage for #186's fix - map-node
// boxes used to be plain unfocusable divs with an onclick and nothing else) ----
const qaCard = page.locator(".card", { hasText: "QA Test Scenario" });
await qaCard.locator("button", { hasText: /^Edit$/ }).click();
await page.waitForTimeout(300);
await page.locator(".author-tabs button", { hasText: /^Map$/ }).click();
await page.waitForTimeout(300);

const mapNodeCount = await page.evaluate(() => document.querySelectorAll(".map-node").length);
mapNodeCount === 2 ? ok("Map tab renders one box per node (2 for QA Test Scenario)") : bad("map-node count: " + mapNodeCount);

const connectorCount = await page.evaluate(() => document.querySelectorAll(".node-map svg path").length);
connectorCount >= 1 ? ok("Map tab draws a connector line for the real choice->goto link") : bad("no connector path drawn between linked nodes");

const mapNodeAttrs = await page.evaluate(() => {
  const n = document.querySelector(".map-node");
  return n ? { role: n.getAttribute("role"), tabindex: n.getAttribute("tabindex"), ariaLabel: n.getAttribute("aria-label") } : null;
});
mapNodeAttrs?.role === "button" && mapNodeAttrs?.tabindex === "0" && !!mapNodeAttrs?.ariaLabel
  ? ok("map-node boxes carry role=button, tabindex=0, and a descriptive aria-label")
  : bad("map-node accessibility attrs: " + JSON.stringify(mapNodeAttrs));

// Tab to a map-node and activate it with Enter - must land on the Guided
// tab, scrolled to that specific node (not just "some" node).
const targetNodeId = await page.evaluate(() => document.querySelector(".map-node .mn-id")?.textContent?.split(" ")[0] || "");
await page.evaluate(() => document.body.focus());
let tabbedToMapNode = false;
for (let i = 0; i < 15; i++) {
  await page.keyboard.press("Tab");
  tabbedToMapNode = await page.evaluate(() => !!document.activeElement?.classList.contains("map-node"));
  if (tabbedToMapNode) break;
}
tabbedToMapNode ? ok("A map-node is reachable via sequential Tab navigation") : bad("could not Tab to a map-node");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const backOnGuidedForNode = targetNodeId ? await page.evaluate((id) => !!document.querySelector('[data-node="' + id + '"]'), targetNodeId) : false;
backOnGuidedForNode ? ok("Enter on a focused map-node switches to Guided and lands on that exact node (" + targetNodeId + ")") : bad("did not land on the expected node " + targetNodeId + " after Enter");

// back to the scenario list before the next section
await page.locator("button", { hasText: /^Cancel$/ }).click();
await page.waitForTimeout(300);

// ---- copy-a-built-in-as-template path ----
const seedSel = page.locator('select[aria-label="Copy a built-in scenario as a template"]');
const seedOptions = await seedSel.locator("option").count();
if (seedOptions > 1) {
  await seedSel.selectOption({ index: 1 });
  await page.waitForTimeout(300);
  const copyTitle = await page.locator(".panel input[type=text]").first().inputValue();
  copyTitle.endsWith(" (Copy)") ? ok("'Copy a built-in as template' opens an editor titled '<original> (Copy)'") : bad("copy title: " + JSON.stringify(copyTitle));
  await page.locator("button", { hasText: /^Cancel$/ }).click();
  await page.waitForTimeout(300);
} else {
  bad("no built-in scenarios available to copy as a template");
}

// ---- cleanup: leave no authored scenarios behind ----
await page.evaluate(async () => {
  const all = (await window.G.db.allUserScenarios()) || [];
  for (const sc of all) await window.G.db.delUserScenario(sc.id);
});

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `AUTHOR: ${fails} FAILURE(S)` : "AUTHOR: all passed"));
process.exit(fails ? 1 : 0);
