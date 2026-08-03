/**
 * Squad Roster: overdue detection, persistence, and - most importantly - that
 * destructive actions actually confirm before deleting someone else's data.
 *
 * This is the only part of GUIDON that stores information about other people,
 * so "does Remove ask first" is a correctness test, not a UX nicety.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

const go = async () => { await page.evaluate(() => { location.hash = "#/leader"; }); await page.waitForTimeout(900); };

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
await go();

const boot = await page.evaluate(() => ({
  heading: (document.querySelector("#view h2, main h2") || {}).textContent,
  privacy: /Read this before you put anyone in here/.test(document.body.textContent || ""),
  initialsGuidance: /initials or a roster number/i.test(document.body.textContent || ""),
}));
boot.heading === "Squad Roster" ? ok("Squad Roster renders") : bad("heading was " + boot.heading);
boot.privacy ? ok("privacy statement shown first") : bad("privacy panel missing");
boot.initialsGuidance ? ok("guidance to use initials rather than names present") : bad("initials guidance missing");

const clickText = (re) => page.evaluate((src) => {
  const rx = new RegExp(src, "i");
  const b = [...document.querySelectorAll("button")].find((x) => rx.test((x.textContent || "").trim()));
  if (b) { b.click(); return true; } return false;
}, re.source);

// --- add one ---
await clickText(/add soldier/);
await page.waitForTimeout(600);
let n = await page.evaluate(() => document.querySelectorAll('input[aria-label^="Rank for roster entry"]').length);
n === 1 ? ok("Add Soldier creates a roster entry") : bad("expected 1 entry, got " + n);

// --- fill it, with a counselling date 45 days old (30-day cadence) ---
await page.evaluate((d) => {
  const set = (sel, val) => { const e = document.querySelector(sel); e.value = val; e.dispatchEvent(new Event("change", { bubbles: true })); };
  set('input[aria-label^="Rank for roster entry"]', "SPC");
  set('input[aria-label^="Initials or roster number"]', "J.R.");
  set('input[aria-label^="Last counselling for roster entry"]', d);
}, daysAgo(45));
await page.waitForTimeout(700);

const flagged = await page.evaluate(() => {
  const t = document.body.textContent || "";
  return { overdue: /15 days overdue/.test(t), named: /SPC J\.R\./.test(t) };
});
flagged.overdue ? ok("counselling 45 days old flags 15 days past the 30-day cadence") : bad("overdue not computed correctly");
flagged.named ? ok("entry appears in the Needs attention summary") : bad("summary did not list the entry");

// --- persistence ---
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);
await go();
const survived = await page.evaluate(() =>
  (document.querySelector('input[aria-label^="Initials or roster number"]') || {}).value);
survived === "J.R." ? ok("roster survives a reload") : bad("after reload initials were " + JSON.stringify(survived));

// --- Remove must confirm, and dismissing must abort ---
await clickText(/^remove$/);
await page.waitForTimeout(500);
const modalUp = await page.evaluate(() => !!document.querySelector(".gm-back"));
modalUp ? ok("Remove opens a confirm dialog") : bad("Remove deleted without confirming");

await page.evaluate(() => {
  const b = [...document.querySelectorAll(".gm-back button")].find((x) => /cancel/i.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(600);
const stillThere = await page.evaluate(() =>
  document.querySelectorAll('input[aria-label^="Rank for roster entry"]').length);
stillThere === 1 ? ok("cancelling the confirm keeps the entry") : bad("entry count after cancel: " + stillThere);

// --- confirming actually removes ---
await clickText(/^remove$/);
await page.waitForTimeout(500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".gm-back button")].find((x) => /remove/i.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForTimeout(700);
const gone = await page.evaluate(() =>
  document.querySelectorAll('input[aria-label^="Rank for roster entry"]').length);
gone === 0 ? ok("confirming actually removes the entry") : bad("entry count after confirm: " + gone);

noise.length === 0 ? ok("no console errors/warnings") : bad(noise.length + " console msgs; first: " + noise[0]);

await browser.close();
server.close();
console.log("\n" + (fails ? `LEADER: ${fails} FAILURE(S)` : "LEADER: all passed"));
process.exit(fails ? 1 : 0);
