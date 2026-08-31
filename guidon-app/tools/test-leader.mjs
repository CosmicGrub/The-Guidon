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

// Audit finding (rank/MOS scoping pass): rank was free text with no link
// to the app's own canonical RANKS list, and there was no MOS field on a
// roster entry at all - both fixed with real <datalist> options, checked
// here rather than just assuming the wiring is correct.
const datalists = await page.evaluate(() => ({
  rankOptionCount: document.querySelectorAll("#roster-ranks-list option").length,
  rankHasSGT: !!document.querySelector('#roster-ranks-list option[value="SGT"]'),
  mosOptionCount: document.querySelectorAll("#roster-mos-list option").length,
  mosHas11B: !!document.querySelector('#roster-mos-list option[value="11B"]'),
  rankInputLinked: document.querySelector('input[aria-label^="Rank for roster entry"]')?.getAttribute("list"),
  mosInputLinked: document.querySelector('input[aria-label^="MOS for roster entry"]')?.getAttribute("list"),
}));
(datalists.rankOptionCount === 13 && datalists.rankHasSGT)
  ? ok("Rank field is backed by a <datalist> of the app's canonical 13 ranks (SGT present)")
  : bad("rank datalist: " + JSON.stringify(datalists));
(datalists.mosOptionCount === 164 && datalists.mosHas11B)
  ? ok("MOS field is backed by a <datalist> of all 164 real MOS entries (11B present)")
  : bad("MOS datalist: " + JSON.stringify(datalists));
(datalists.rankInputLinked === "roster-ranks-list" && datalists.mosInputLinked === "roster-mos-list")
  ? ok("Both inputs are actually wired to their datalists via list=")
  : bad("input list= attributes: " + JSON.stringify(datalists));

// --- fill it, with a counselling date 45 days old (30-day cadence) ---
await page.evaluate((d) => {
  const set = (sel, val) => { const e = document.querySelector(sel); e.value = val; e.dispatchEvent(new Event("change", { bubbles: true })); };
  set('input[aria-label^="Rank for roster entry"]', "SPC");
  set('input[aria-label^="MOS for roster entry"]', "68W");
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

// --- Upgrade-roadmap first wave, item 8: counseling "Remind me" button.
// "counseling" is a real, pre-existing Reminders kind that had zero
// integration anywhere before this.
// Enhancement backlog round 4, "Isolated feature-parity gaps" bucket:
// Remind me used to be gated to the counseling field alone (f.key ===
// "counseled") - now all 4 FIELDS entries (counseled/aft/wpn/ncoer) get
// one, so this one Soldier (with only the counseling date actually
// seeded - AFT/weapons/NCOER are all "never done", which is maximally
// overdue too) now renders 4 buttons, not 1. clickText below still
// clicks the FIRST match, which is still the counseling one - FIELDS
// lists "counseled" first and the row renders in FIELDS order - so
// every downstream assertion in this test (checking for a real
// "counseling" reminder specifically) is unaffected. ---
const remindBtnCount = await page.evaluate(() =>
  [...document.querySelectorAll("button")].filter((b) => /^Remind me$/.test((b.textContent || "").trim())).length);
remindBtnCount === 4 ? ok("Squad Roster's 4 time-boxed fields (counseling/AFT/weapons/NCOER) each have a 'Remind me' button") : bad("expected 4 'Remind me' buttons (one per FIELDS entry), found " + remindBtnCount);
await clickText(/^remind me$/);
await page.waitForTimeout(500);
const afterClick = await page.evaluate(async () => {
  const list = (await window.G.reminders.load()) || [];
  const btn = [...document.querySelectorAll("button")].find((b) => /Reminder set/.test((b.textContent || "").trim()));
  return {
    btnDisabled: btn ? btn.disabled : null,
    entry: list.find((r) => r.kind === "counseling"),
  };
});
afterClick.btnDisabled === true ? ok("button confirms success in place (disabled, reads 'Reminder set')") : bad("button state after click: " + JSON.stringify(afterClick.btnDisabled));
(afterClick.entry && /SPC J\.R\./.test(afterClick.entry.label))
  ? ok("a real 'counseling' reminder was created, naming the Soldier (" + afterClick.entry.label + ", due " + afterClick.entry.date + ")")
  : bad("no counseling reminder found, or it didn't name the Soldier: " + JSON.stringify(afterClick.entry));

const countAfterFirst = await page.evaluate(async () => ((await window.G.reminders.load()) || []).length);

// --- Upgrade-roadmap first wave, item 9: revisiting the page and clicking
// "Remind me" again for the SAME Soldier/date must not create a duplicate
// row - this is the exact "revisiting and re-clicking" scenario scoped. ---
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);
await go();
await clickText(/^remind me$/);
await page.waitForTimeout(500);
const countAfterRevisit = await page.evaluate(async () => ((await window.G.reminders.load()) || []).length);
countAfterRevisit === countAfterFirst
  ? ok("revisiting the page and clicking 'Remind me' again does not create a duplicate reminder (" + countAfterFirst + " -> " + countAfterRevisit + ")")
  : bad("reminder count grew from a revisit+re-click: " + countAfterFirst + " -> " + countAfterRevisit);

// --- persistence ---
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1400);
await go();
const survived = await page.evaluate(() => ({
  initials: (document.querySelector('input[aria-label^="Initials or roster number"]') || {}).value,
  mos: (document.querySelector('input[aria-label^="MOS for roster entry"]') || {}).value,
}));
survived.initials === "J.R." ? ok("roster survives a reload") : bad("after reload initials were " + JSON.stringify(survived.initials));
survived.mos === "68W" ? ok("MOS survives a reload too (68W)") : bad("after reload MOS was " + JSON.stringify(survived.mos));

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
