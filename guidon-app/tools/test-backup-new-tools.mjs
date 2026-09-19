/**
 * The new tools' data survives a backup and a restore.
 *
 * ROADMAP 3g item B. Board Simulator, Team Training, PT Planner, the Recall
 * ladder and "My unit" arrived as add-on tools, and their saved data only
 * half belonged to the backup contract: it rode along in the file (a backup
 * copies every saved item), but the Board Simulator row and Recitation
 * Drill's line-by-line progress were never checked on the way back in, the
 * Team Training and Recall ladder checks accepted any object at all, and a
 * restore that left something out named it by its internal storage name -
 * or blamed the profile, whatever the item was.
 *
 * What this suite proves, through the real screens:
 *
 *  1. Fill every tool by hand, export with the real Export button, open the
 *     app on a DIFFERENT, empty device (a fresh browser profile), import the
 *     file with the real Import button - and see the data back IN THE TOOLS,
 *     not just in storage.
 *  2. Import a file carrying one deliberately damaged row for EVERY one of
 *     those keys next to good rows: the good rows land, every damaged row is
 *     left out, what was already on the device is not overwritten, and both
 *     the confirmation and the result name what was left out in plain words
 *     - never a storage key.
 *
 * On the old code part 2 fails: the damaged Board Simulator, Team Training,
 * Recall ladder and recitation-progress rows are accepted and overwrite the
 * good ones, and the dialog prints raw keys.
 *
 * The practice text below was written for this test. It is nobody's song.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "./server.mjs";
import { deviceDump, openAsOwner } from "./device-storage.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));

const NOTE = "BACKUP-TEST keep the reporting statement short";
const TITLE = "Bravo Battery motto";
const LINES = ["Steady on the guns at dawn", "Ready when the call comes down", "We bring every round on time"];
const GOAL = "BACKUP-TEST good goal that must land";

// The keys this suite is about, read from the modules that own them so a
// renamed key fails here instead of silently testing nothing.
const KEYS = {};

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];
const watch = (page, tag) => {
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(tag + " " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push(tag + " pageerror: " + e.message));
};
const go = async (page, hash, selector) => {
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(120);
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector(selector, { timeout: 10000 });
};
const pickMode = async (page, label) => {
  await page.locator('[aria-label="Study mode"] .search-chip', { hasText: label }).click();
  await page.waitForTimeout(250);
};
const tmpFiles = [];
const tmp = (name) => { const p = path.join(os.tmpdir(), "guidon-" + name + "-" + Date.now() + ".json"); tmpFiles.push(p); return p; };

/** What each tool shows on screen right now. */
async function whatTheToolsShow(page) {
  const shown = {};
  await go(page, "#/board-sim", "#board-sim-strong");
  shown.simNote = await page.inputValue("#board-sim-strong");

  await go(page, "#/team", '[data-team-start="aar-huddle"]');
  shown.teamCount = await page.evaluate(() => { const n = document.querySelector('[data-team-count="aar-huddle"]'); return n ? Number((n.textContent.match(/\d+/) || [0])[0]) : 0; });

  await go(page, "#/pt-plan", 'select[data-pt-session="mon"]');
  shown.ptMonday = await page.locator('select[data-pt-session="mon"]').inputValue();
  await page.locator('[data-pt-view="day"]').click();
  await page.waitForSelector("[data-pt-complete]");
  shown.ptToday = (await page.locator("[data-pt-complete]").innerText()).trim();

  await go(page, "#/recite", "[data-recite-add]");
  shown.myUnit = await page.evaluate(() => Array.from(document.querySelectorAll("[data-recite-own] .list-detail-row")).map((r) => r.textContent));
  if (shown.myUnit.indexOf(TITLE) !== -1) {
    await page.locator("[data-recite-own] .list-detail-row", { hasText: TITLE }).click();
    await page.waitForTimeout(200);
    await pickMode(page, "Chunk & memorize");
    shown.linesLearned = await page.evaluate(() => { const m = (document.querySelector(".list-detail > div:last-child .card") || document.body).textContent.match(/(\d+) \/ \d+ line\(s\) locked in/); return m ? Number(m[1]) : -1; });
    await pickMode(page, "Recall ladder");
    await page.waitForSelector("[data-ladder-step]");
    shown.ladderStep = await page.evaluate(() => (document.querySelector('[data-ladder-step][aria-pressed="true"]') || { getAttribute() { return ""; } }).getAttribute("data-ladder-step"));
  }
  return shown;
}

/* ======================================================================
 * 1) Device A: fill every tool by hand, then export.
 * ==================================================================== */
console.log("\n-- device A: fill the tools, export --");
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const pageA = await ctxA.newPage();
watch(pageA, "A");
await openAsOwner(pageA, url);
Object.assign(KEYS, await pageA.evaluate(() => ({
  sim: "board:sim:v1",
  team: window.G.teamTraining.KEY,
  plan: window.G.ptPlanner.KEY,
  history: window.G.ptPlanner.HISTORY_KEY,
  own: window.G.reciteUser.KEY,
})));

await go(pageA, "#/board-sim", "#board-sim-strong");
await pageA.fill("#board-sim-strong", NOTE);
await pageA.waitForTimeout(400);

await go(pageA, "#/team", '[data-team-start="aar-huddle"]');
await pageA.locator('[data-team-start="aar-huddle"]').click();
await pageA.waitForSelector("[data-team-record]");
await pageA.locator("[data-team-record]").click();
await pageA.waitForSelector('[data-team-count="aar-huddle"]');

await go(pageA, "#/pt-plan", 'select[data-pt-session="mon"]');
const monWas = await pageA.locator('select[data-pt-session="mon"]').inputValue();
const MON = monWas === "rest" ? "prep" : "rest";
await pageA.locator('select[data-pt-session="mon"]').selectOption(MON);
await pageA.waitForTimeout(400);
await pageA.locator('[data-pt-view="day"]').click();
await pageA.waitForSelector("[data-pt-complete]");
await pageA.locator("[data-pt-complete]").click();
await pageA.waitForFunction(() => /today logged/i.test((document.querySelector("[data-pt-complete]") || {}).textContent || ""), null, { timeout: 6000 });

await go(pageA, "#/recite", "[data-recite-add]");
await pageA.locator("[data-recite-add]").click();
await pageA.waitForSelector("#recite-own-title");
await pageA.fill("#recite-own-title", TITLE);
await pageA.fill("#recite-own-text", LINES.join("\n"));
await pageA.locator("button", { hasText: /^Save on this device$/ }).click();
await pageA.waitForSelector("[data-recite-own] .list-detail-row");
await pageA.waitForTimeout(200);
const ownId = await pageA.evaluate(() => document.querySelector("[data-recite-own] .list-detail-row").dataset.reciteId);
await pickMode(pageA, "Chunk & memorize");
await pageA.locator(".list-detail > div:last-child button", { hasText: /^Mark learned$/ }).first().click();
await pageA.waitForTimeout(250);
await pickMode(pageA, "Recall ladder");
await pageA.waitForSelector("[data-ladder-step]");
await pageA.locator('[data-ladder-step="medium"]').click();
await pageA.waitForFunction(() => (document.querySelector('[data-ladder-step="medium"]') || { getAttribute() {} }).getAttribute("aria-pressed") === "true");
await pageA.waitForTimeout(250);
KEYS.ladder = "recall-ladder:" + ownId;
KEYS.recite = "recite:" + ownId;

const filled = await whatTheToolsShow(pageA);
check(filled.simNote === NOTE && filled.teamCount === 1 && filled.ptMonday === MON && /today logged/i.test(filled.ptToday) && filled.myUnit.indexOf(TITLE) !== -1 && filled.linesLearned === 1 && filled.ladderStep === "medium",
  "every tool holds what was just entered by hand (notes, 1 exercise, Monday=" + MON + ", today logged, a My unit text with 1 line learned, ladder on its middle step)",
  "filling the tools did not take: " + JSON.stringify(filled));

// A good item from an older part of the app, to prove "the rest still lands" later.
await pageA.evaluate((goal) => window.G.db.setSetting("idp:goals", [{ id: "g1", goal, status: "open", domain: "leads", createdAt: 1 }]), GOAL);

await go(pageA, "#/profile", ".backup-panel");
const [download] = await Promise.all([
  pageA.waitForEvent("download"),
  pageA.locator(".backup-panel button", { hasText: /Export backup/ }).click(),
]);
const backupPath = tmp("backup-new-tools");
await download.saveAs(backupPath);
const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
const inFile = (k) => (backup.stores.kv.find((r) => r.k === k) || {}).v;
const missing = Object.keys(KEYS).filter((name) => inFile(KEYS[name]) === undefined);
check(missing.length === 0, "the exported file carries all seven of the new tools' saved items", "missing from the export: " + JSON.stringify(missing.map((n) => KEYS[n])));
await ctxA.close();

/* ======================================================================
 * 2) Device B: empty. Import with the real button; look in the tools.
 * ==================================================================== */
console.log("\n-- device B (empty): import, then look in the tools --");
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pageB = await ctxB.newPage();
watch(pageB, "B");
await openAsOwner(pageB, url, { displayName: "SGT SECOND", lastName: "SECOND" });
const empty = await whatTheToolsShow(pageB);
check(empty.simNote === "" && empty.teamCount === 0 && !/today logged/i.test(empty.ptToday) && empty.myUnit.length === 0,
  "the second device starts with none of it", "device B was not empty: " + JSON.stringify(empty));

async function importThroughTheScreen(page, file) {
  await go(page, "#/profile", ".backup-panel");
  await page.locator(".backup-panel button", { hasText: /Import backup/ }).click();
  await page.locator('.backup-panel input[type="file"]').setInputFiles(file);
  await page.waitForSelector(".gm-box");
  const confirmText = await page.locator(".gm-box").innerText();
  const [, status] = await Promise.all([
    page.waitForEvent("load", { timeout: 15000 }),
    (async () => {
      await page.locator(".gm-box button", { hasText: /^OK$/ }).click();
      await page.waitForFunction(() => /Restored|failed/i.test((document.querySelector(".backup-status") || {}).textContent || ""), null, { timeout: 8000 });
      return page.evaluate(() => document.querySelector(".backup-status").textContent);
    })(),
  ]);
  await page.waitForFunction(() => !!(window.G && window.G.profile && window.G.profile.cached && window.G.profile.cached()) && !/Loading GUIDON/.test((document.getElementById("route") || {}).textContent || ""), null, { timeout: 15000 });
  return { confirmText, status };
}

const first = await importThroughTheScreen(pageB, backupPath);
check(/Restored \d+ items/.test(first.status) && !/left out/.test(first.status), "the restore reports success and leaves nothing out (\"" + first.status.trim() + "\")", "restore status: " + first.status);
const restored = await whatTheToolsShow(pageB);
check(restored.simNote === NOTE, "Board Simulator: the after-action notes are back on the screen", "Board Simulator notes after restore: " + JSON.stringify(restored.simNote));
check(restored.teamCount === 1, "Team Training: the exercise shows its completion again", "Team Training count after restore: " + restored.teamCount);
check(restored.ptMonday === MON, "PT Planner: Monday is back to what was planned (" + MON + ")", "PT Monday after restore: " + restored.ptMonday);
check(/today logged/i.test(restored.ptToday), "PT Planner: today's completed session is back", "PT history after restore: " + restored.ptToday);
check(restored.myUnit.indexOf(TITLE) !== -1, "My unit: the text is listed again", "My unit after restore: " + JSON.stringify(restored.myUnit));
check(restored.linesLearned === 1, "Recitation Drill: the line already learned is still marked learned", "lines learned after restore: " + restored.linesLearned);
check(restored.ladderStep === "medium", "Recall ladder: it reopens on the step it was left on", "ladder step after restore: " + restored.ladderStep);

/* ======================================================================
 * 3) A file with one damaged row for EVERY one of those keys.
 * ==================================================================== */
console.log("\n-- a backup with one damaged row per key --");
const DAMAGED = [
  { k: KEYS.sim, v: { reportingDone: "false", aarDraft: { strong: ["DAMAGED"] } } },   // a flag that is text, notes that are a list
  { k: KEYS.team, v: { "aar-huddle": { count: "DAMAGED", last: 1 } } },                  // a count that is not a number
  { k: KEYS.plan, v: { templateId: "balanced", days: "DAMAGED" } },                      // no week in it
  { k: KEYS.history, v: [{ title: "DAMAGED, no date" }] },
  { k: KEYS.own, v: [{ id: "own-damaged1", title: "DAMAGED", lines: "one string, not lines" }] },
  { k: KEYS.ladder, v: { level: 7, streak: "DAMAGED" } },                                // right outline, wrong contents
  { k: KEYS.recite, v: { chunksLearned: "DAMAGED" } },
];
const GOOD = [
  { k: "idp:goals", v: [{ id: "g2", goal: GOAL + " (second file)", status: "open", domain: "leads", createdAt: 2 }] },
  { k: "recall-ladder:own-othergood1", v: { level: "easy", streak: 1 } },
  { k: "recite:own-othergood1", v: { chunksLearned: [0, 2], direction: "forward" } },
];
const damagedFile = { schema: backup.schema, exportedAt: new Date().toISOString(), stores: { kv: DAMAGED.concat(GOOD), userScenarios: [], attempts: [] }, summary: { kv: DAMAGED.length + GOOD.length, userScenarios: 0, attempts: 0 } };
const damagedPath = tmp("backup-damaged");
fs.writeFileSync(damagedPath, JSON.stringify(damagedFile));

// The rule table itself, row by row: each damaged row is refused, and the
// good version of the same key (from the real export) is accepted.
const verdicts = await pageB.evaluate(({ damaged, goodRows }) => ({
  damagedRefused: damaged.filter((r) => window.G.backup.validateKvRow(r) !== false).map((r) => r.k),
  goodAccepted: goodRows.filter((r) => window.G.backup.validateKvRow(r) !== true).map((r) => r.k),
}), { damaged: DAMAGED, goodRows: Object.keys(KEYS).map((n) => ({ k: KEYS[n], v: inFile(KEYS[n]) })).concat(GOOD) });
check(verdicts.damagedRefused.length === 0, "each of the seven damaged rows is refused by the restore check", "damaged rows that would be ACCEPTED: " + JSON.stringify(verdicts.damagedRefused));
check(verdicts.goodAccepted.length === 0, "every real row the tools wrote, and the good rows beside them, are accepted", "good rows that would be REFUSED: " + JSON.stringify(verdicts.goodAccepted));

const second = await importThroughTheScreen(pageB, damagedPath);
const rawKeyShown = (text) => Object.keys(KEYS).map((n) => KEYS[n]).concat(["recall-ladder:", "recite:"]).filter((k) => text.indexOf(k) !== -1);
const LABELS = [/Board Simulator progress and notes/, /Team Training completion counts/, /your PT plan/, /your completed PT sessions/, /your My unit texts/, /Recall ladder progress/, /Recitation Drill progress/];
check(/7 items in this file are damaged and will be left out/.test(second.confirmText) && LABELS.every((re) => re.test(second.confirmText)) && /Everything else will be restored/.test(second.confirmText),
  "BEFORE anything is written, the confirmation names all seven damaged items in plain words", "confirmation text: " + JSON.stringify(second.confirmText.slice(0, 600)));
check(rawKeyShown(second.confirmText).length === 0, "the confirmation never shows a storage name", "storage names on screen: " + JSON.stringify(rawKeyShown(second.confirmText)));
check(/Restored 3 items/.test(second.status) && /7 damaged items were left out/.test(second.status) && LABELS.every((re) => re.test(second.status)) && /Everything else was restored/.test(second.status) && !/profile/i.test(second.status),
  "afterwards the result says 3 items were restored and names the 7 left out - and no longer blames the profile", "result text: " + JSON.stringify(second.status));
check(rawKeyShown(second.status).length === 0, "the result never shows a storage name either", "storage names in the result: " + JSON.stringify(rawKeyShown(second.status)));

const afterDamaged = await deviceDump(pageB);
const onDevice = (k) => (afterDamaged.stores.kv.find((r) => r.k === k) || {}).v;
check(JSON.stringify(onDevice("idp:goals") || "").indexOf("(second file)") !== -1 && !!onDevice("recall-ladder:own-othergood1") && !!onDevice("recite:own-othergood1"),
  "the good rows in the same file still landed on the device", "good rows missing: " + JSON.stringify({ goals: onDevice("idp:goals"), ladder: onDevice("recall-ladder:own-othergood1") }));
const overwritten = Object.keys(KEYS).filter((n) => JSON.stringify(onDevice(KEYS[n])) !== JSON.stringify(inFile(KEYS[n])));
check(overwritten.length === 0, "none of the damaged rows overwrote what was already on the device", "overwritten by a damaged row: " + JSON.stringify(overwritten.map((n) => KEYS[n])));
const still = await whatTheToolsShow(pageB);
check(still.simNote === NOTE && still.teamCount === 1 && still.ptMonday === MON && /today logged/i.test(still.ptToday) && still.myUnit.indexOf(TITLE) !== -1 && still.linesLearned === 1 && still.ladderStep === "medium",
  "and every tool still opens and still shows the good data", "tools after the damaged import: " + JSON.stringify(still));
await ctxB.close();

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
check(relevantNoise.length === 0, "no console errors or warnings", "console noise: " + relevantNoise.slice(0, 5).join(" | "));

tmpFiles.forEach((p) => { try { fs.unlinkSync(p); } catch (e) {} });
await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nBACKUP NEW TOOLS: all passed");
process.exit(fails ? 1 : 0);
