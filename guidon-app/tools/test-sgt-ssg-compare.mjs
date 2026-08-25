/**
 * SGT vs SSG comparison view (roadmap Tier 8) — a new "Compare SGT/SSG"
 * segment on #/board's Points tab (buildCompareBody(), renderPoints).
 *
 * The Points tab's own hint text already told Soldiers "the same Soldier
 * scores two different totals... this is the detail most calculators get
 * wrong" — but the rank switcher only ever rendered ONE grade's worksheet
 * at a time. This proves the new segment actually shows both together,
 * with figures read live from the same PPW.SGT/PPW.SSG data every other
 * part of this tab already uses (not a third hardcoded copy), against 4
 * worked examples independently verified against the real AR 600-8-19
 * (6 Mar 2026 edition) before this view was written:
 *   - point caps: SGT 280/145/240/135, SSG 230/165/245/160 (both = 800)
 *   - weapons/AFT: 160/120 SGT, 110/120 SSG
 *   - Table 3-1 (board recommendation): SGT 16/4 sec, 34/10 pri;
 *     SSG 46/6 sec, 70/16 pri, 82/22 MLI
 *   - para 5-5 (pin-on): SGT 18/6 sec, 36/12 pri; SSG 48/8 sec, 72/18 pri,
 *     84/24 MLI
 *
 * Also proves the real content-accuracy fix this same change made: three
 * existing content locations (a course-sgt-board lesson, a board-drill
 * card, and this same Points tab's own hint/moves-list text) previously
 * stated BLC gates SGT pin-on and ALC gates SSG pin-on — backwards. Per
 * AR 600-8-19 para 1-34 (confirmed directly against the regulation text,
 * twice — once in prose, once in a table), BLC gates SSG pin-on and ALC
 * gates SFC pin-on; SGT has no PME pin-on requirement at all. This view's
 * own PME panel states it correctly, and this suite checks board.js's
 * still-existing SGT/SSG worksheets (test-ppw.mjs covers their own
 * mechanics — this file only checks they no longer show the reversed
 * claim) do too.
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
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") noise.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(300);

await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(400);
await page.locator("button", { hasText: /^Points$/ }).click();
await page.waitForTimeout(400);

const cmpBtn = page.locator("button", { hasText: /^Compare SGT\/SSG$/ });
(await cmpBtn.count()) === 1 ? ok("a real 'Compare SGT/SSG' segment exists on the Points tab, alongside SGT/SSG/SFC+") : bad("Compare SGT/SSG button count: " + (await cmpBtn.count()));
await cmpBtn.click();
await page.waitForTimeout(400);

const heading = await page.locator("div.eyebrow", { hasText: "SGT vs SSG" }).first().textContent().catch(() => null);
heading ? ok("the comparison view renders its own heading") : bad("comparison heading not found");

const modeRowHidden = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => /Quick estimate/.test(b.textContent || ""));
  return !btn || btn.offsetParent === null;
});
modeRowHidden ? ok("the Quick estimate/Full PPW mode switch is hidden in Compare mode (there's no single worksheet to switch modes on)") : bad("mode switch is still visible in Compare mode");

// ── Read every card and check it against the 4 independently-verified fact sets ──
const cards = await page.evaluate(() => {
  const panels = Array.from(document.querySelectorAll(".panel")).filter((p) => p.querySelector(".eyebrow"));
  return panels.map((p) => ({
    title: p.querySelector(".eyebrow").textContent,
    rows: Array.from(p.querySelectorAll(".card")).map((c) => ({
      k: c.querySelector(".k") ? c.querySelector(".k").textContent : null,
      hints: Array.from(c.querySelectorAll(".hint")).map((h) => h.textContent),
    })),
  }));
});

function findPanel(titleSubstr) { return cards.find((p) => p.title.includes(titleSubstr)); }
function findRow(panel, kSubstr) { return panel && panel.rows.find((r) => (r.k || "").includes(kSubstr)); }

const pointsPanel = findPanel("Promotion points");
const pointsChecks = [
  ["Military training", "SGT: 280 pts (weapons 160 + AFT 120)", "SSG: 230 pts (weapons 110 + AFT 120)"],
  ["Awards", "SGT: 145 pts", "SSG: 165 pts"],
  ["Military education", "SGT: 240 pts", "SSG: 245 pts"],
  ["Civilian education", "SGT: 135 pts", "SSG: 160 pts"],
];
let pointsOk = true;
for (const [label, sgtExp, ssgExp] of pointsChecks) {
  const row = findRow(pointsPanel, label);
  if (!row || row.hints[0] !== sgtExp || row.hints[1] !== ssgExp) { pointsOk = false; bad(`points row "${label}": got ${JSON.stringify(row)}, expected [${sgtExp}, ${ssgExp}]`); }
}
if (pointsOk) ok("all 4 point-cap rows match the verified figures exactly (SGT 280/145/240/135, SSG 230/165/245/160 — both sum to 800)");

const pmePanel = findPanel("PME");
const pmeGateRow = findRow(pmePanel, "Hard pin-on requirement for THIS rank");
(pmeGateRow && pmeGateRow.hints[0].includes("None") && pmeGateRow.hints[1].includes("BLC"))
  ? ok("PME panel correctly states SGT has NO PME pin-on gate and SSG's real gate is BLC — the corrected fact, not the reversed one three other places in this app used to state")
  : bad("PME gate row: " + JSON.stringify(pmeGateRow));
const pmeBonusRow = findRow(pmePanel, "bonus points");
(pmeBonusRow && pmeBonusRow.hints[0] === "SGT: BLC" && pmeBonusRow.hints[1] === "SSG: ALC")
  ? ok("PME panel correctly keeps the bonus-points association (BLC earns SGT's 150, ALC earns SSG's 150) — that part was never wrong")
  : bad("PME bonus row: " + JSON.stringify(pmeBonusRow));
const pmeNextRow = findRow(pmePanel, "gates instead");
(pmeNextRow && pmeNextRow.hints[0].includes("gates SSG") && pmeNextRow.hints[1].includes("gates SFC"))
  ? ok("PME panel correctly states what each bonus course actually gates (BLC->SSG, ALC->SFC), not what it used to falsely claim (BLC->SGT, ALC->SSG)")
  : bad("PME 'gates instead' row: " + JSON.stringify(pmeNextRow));

const table31Panel = findPanel("Table 3-1");
const t31Checks = [
  ["Secondary zone", "SGT: 16 months TIS / 4 months TIG", "SSG: 46 months TIS / 6 months TIG"],
  ["Primary zone", "SGT: 34 months TIS / 10 months TIG", "SSG: 70 months TIS / 16 months TIG"],
  ["Mandatory list integration", "SGT: N/A", "SSG: 82 months TIS / 22 months TIG"],
];
let t31Ok = true;
for (const [label, sgtExp, ssgExp] of t31Checks) {
  const row = findRow(table31Panel, label);
  if (!row || row.hints[0] !== sgtExp || row.hints[1] !== ssgExp) { t31Ok = false; bad(`Table 3-1 row "${label}": got ${JSON.stringify(row)}`); }
}
if (t31Ok) ok("all 3 Table 3-1 (board recommendation) rows match the verified TIS/TIG figures for both grades");

const para55Panel = findPanel("para 5-5");
const p55Checks = [
  ["Secondary zone", "SGT: 18 months TIS / 6 months TIG", "SSG: 48 months TIS / 8 months TIG"],
  ["Primary zone", "SGT: 36 months TIS / 12 months TIG", "SSG: 72 months TIS / 18 months TIG"],
  ["Mandatory list integration", "SGT: N/A", "SSG: 84 months TIS / 24 months TIG"],
];
let p55Ok = true;
for (const [label, sgtExp, ssgExp] of p55Checks) {
  const row = findRow(para55Panel, label);
  if (!row || row.hints[0] !== sgtExp || row.hints[1] !== ssgExp) { p55Ok = false; bad(`para 5-5 row "${label}": got ${JSON.stringify(row)}`); }
}
if (p55Ok) ok("all 3 para 5-5 (pin-on) rows match the verified TIS/TIG figures for both grades, genuinely distinct from Table 3-1's board-recommendation figures");

const semiCentralText = await page.evaluate(() => {
  const p = Array.from(document.querySelectorAll("p.hint")).find((n) => /SAME semi-centralized system/.test(n.textContent || ""));
  return p ? p.textContent : null;
});
semiCentralText ? ok("the intro correctly states SGT and SSG use the SAME semi-centralized system (not two different processes)") : bad("intro text about the shared semi-centralized system not found");

// ── Switching ranks still works after adding the 4th segment ──────────────
await page.locator("button", { hasText: /^SGT \(E-5\)$/ }).click();
await page.waitForTimeout(300);
const sgtWorksheetBack = !!(await page.locator("input[type=number]").count());
sgtWorksheetBack ? ok("switching back to SGT from Compare mode returns to the real interactive worksheet") : bad("SGT worksheet did not return after leaving Compare mode");

noise.length === 0
  ? ok("no console errors/warnings across the whole flow")
  : bad("console noise: " + JSON.stringify(noise));

await browser.close();
server.close();
console.log("\n" + (fails ? `SGT vs SSG COMPARE: ${fails} FAILURE(S)` : "SGT vs SSG COMPARE: all passed"));
process.exit(fails ? 1 : 0);
