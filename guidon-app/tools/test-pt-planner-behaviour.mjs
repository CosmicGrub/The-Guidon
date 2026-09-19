/**
 * PT Planner (#/pt-plan, src/app-modules/pt-planner.js) - behaviour suite.
 *
 * The roadmap suite that shipped with the planner (test-roadmap-leader-
 * readiness.mjs) counted things: seven day cards, three views, 28 month
 * cells. Every one of those counts stayed green while the Month view's only
 * action saved the wrong session, so this suite round-trips instead. Each
 * block drives the real UI on a pinned clock (Fri 18 Sep 2026, so weekday
 * maths is deterministic), reads back what actually reached storage, and
 * checks where keyboard focus and the screen-reader announcement ended up.
 *
 * What each block guards (every one of these FAILED on the code it was
 * written against):
 *  0. Static guard: no app module declares a function-scoped `var` inside a
 *     `for (let ...)` body and then reads it from a closure made in that loop
 *     (the exact shape of the Month-view defect), with a self-test so the
 *     scanner cannot silently match nothing.
 *  1. Month view: picking a session for a date saves THAT session for THAT
 *     date (a function-scoped `var` inside the 28-cell loop used to make
 *     every cell save the last cell's value), on two non-last cells, plus
 *     the way back ("Use weekly plan").
 *  2. Focus: an edit never drops keyboard focus to <body>; it lands back on
 *     the control that was used (or its neighbour when that control goes
 *     away). Edits are announced. The hard:recovery panel is one persistent
 *     node, not a new one per redraw, and a flag flip is announced.
 *  3. Day / Week / Month is a real tablist: roving tabindex, arrow keys.
 *  4. A date changed in Month view is what Day view shows, what "Mark today
 *     complete" logs, and what both reminder buttons schedule (a date set to
 *     rest gets no reminder; a rest weekday changed to a session gets one).
 *  5. The hard:recovery check: one hard session plus six rest days is not a
 *     flag, the plan check and the completed-history check count the same
 *     week the same way, and a custom-effort edit neither loses the history
 *     panel nor leaves a stale effort line on the card.
 *  6. Template dropdown only previews. "Apply template" asks first when
 *     there is something to lose, keeps date changes, and offers Undo.
 *  7. No control is decoration: the Intensity dial and "shareable" checkbox
 *     are gone, and the plan file that "Save plan file to share" writes can
 *     be opened by "Open a shared plan file" on another device - with hostile
 *     or malformed files refused or cleaned.
 *  8. PT reminders expire: eight days later Home's "Coming up" strip shows
 *     the board date, not five overdue PT rows, scheduling again replaces
 *     the old rows instead of piling up, and logging today clears today's.
 *  9. Storage contract: the three kv rows are covered by the backup
 *     validator (import + Diagnostics scan), survive a backup round trip,
 *     stale date changes are pruned, and a completion logged from a stale
 *     screen does not overwrite history written elsewhere.
 * 10. 390px: no horizontal overflow in any of the three views.
 *
 * One browser, three contexts (main / "second device" / phone).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { openAsOwner } from "./device-storage.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));
// A thrown locator timeout in one block must not hide the blocks after it.
async function section(title, fn) {
  console.log("\n" + title);
  try { await fn(); } catch (e) { bad("block stopped early: " + String(e && e.message || e).split("\n")[0]); }
}

const { server, url } = await serve("web");
const browser = await chromium.launch();
const noise = [];
const watch = (page, tag) => {
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(tag + " " + m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push(tag + " pageerror: " + e.message));
};

const FRIDAY = new Date(2026, 8, 18, 10, 0, 0); // local time; a Friday
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const plusDays = (n) => { const d = new Date(FRIDAY); d.setDate(d.getDate() + n); return d; };
const TODAY = iso(FRIDAY), SUN = iso(plusDays(2)), TUE = iso(plusDays(4)), WED = iso(plusDays(5)), LAST = iso(plusDays(27));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guidon-pt-"));

const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(5000);
watch(page, "[main]");
await page.clock.install({ time: FRIDAY });
await page.goto(url, { waitUntil: "load" });
// A real profile, not a Guest session: this suite checks that what it does is
// still there after a reload, and a Guest session saves nothing (the storage
// contract - see tools/device-storage.mjs and test-guest-saves-nothing.mjs).
await openAsOwner(page, url);

const sleep = (ms) => page.waitForTimeout(ms);
async function openPlanner(p, view) {
  await p.evaluate(() => { location.hash = "#/home"; });
  await p.waitForTimeout(150);
  await p.evaluate(() => { location.hash = "#/pt-plan"; });
  await p.waitForSelector("[data-pt-stage] .pt-day-card", { timeout: 8000 });
  if (view && view !== "week") {
    await p.locator('[data-pt-view="' + view + '"]').click();
    await p.waitForSelector(view === "month" ? "[data-pt-month]" : "[data-pt-complete]", { timeout: 8000 });
  }
}
async function reboot(p) {
  await p.reload({ waitUntil: "load" });
  await dismissOnboarding(p);
}
const storedPlan = (p = page) => p.evaluate(() => window.G.db.getSetting("prt:plan:v1", null));
const storedHistory = (p = page) => p.evaluate(() => window.G.db.getSetting("pt:history:v1", []));
const ptReminders = (p = page) => p.evaluate(async () => ((await window.G.reminders.load()) || []).filter((r) => r.kind === "pt"));
const live = (p = page) => p.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");
const focusDesc = (p = page) => p.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return "BODY";
  const attrs = Array.from(a.attributes).filter((x) => /^data-pt/.test(x.name)).map((x) => x.name + "=" + x.value);
  return a.tagName.toLowerCase() + (attrs.length ? "[" + attrs.join(",") + "]" : "") + ":" + (a.textContent || "").trim().slice(0, 30);
});
const dayIds = (pl) => JSON.stringify(Object.fromEntries(Object.entries((pl && pl.days) || {}).map(([k, v]) => [k, v.id])));
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t0 > ms) return v;
    await sleep(60);
  }
}

// ---- Static guard for the pattern behind the Month-view defect ----------
// `var x` written directly inside a `for (let ...)` body is function-scoped:
// every closure created in the loop shares the ONE binding and sees the last
// iteration's value. Flags a `var` in such a body only when a function nested
// in that same body reads the name (the capture is what makes it a bug).
function loopVarCaptures(src) {
  // Blank out comments and string/template contents so braces inside them
  // cannot unbalance the matcher (offsets are preserved).
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && n === "*") { while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; } out += "  "; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      out += c; i++;
      while (i < src.length && src[i] !== c) { if (src[i] === "\\") { out += "  "; i += 2; continue; } out += src[i] === "\n" ? "\n" : " "; i++; }
      out += c; i++; continue;
    }
    out += c; i++;
  }
  const closeOf = (open) => { let d = 0; for (let k = open; k < out.length; k++) { if (out[k] === "{") d++; else if (out[k] === "}" && --d === 0) return k; } return -1; };
  const found = [];
  const loopRe = /\bfor\s*\(\s*let\b/g;
  let m;
  while ((m = loopRe.exec(out))) {
    let p = out.indexOf("(", m.index), d = 0;
    for (; p < out.length; p++) { if (out[p] === "(") d++; else if (out[p] === ")" && --d === 0) break; }
    const open = out.indexOf("{", p);
    if (open < 0 || /\S/.test(out.slice(p + 1, open))) continue; // single-statement body
    const close = closeOf(open);
    if (close < 0) continue;
    let body = out.slice(open + 1, close), nested = "";
    const fnRe = /(\bfunction\b[^{]*|=>\s*)\{/g;
    let f;
    while ((f = fnRe.exec(body))) {
      const fo = f.index + f[0].length - 1;
      let dd = 0, fc = -1;
      for (let k = fo; k < body.length; k++) { if (body[k] === "{") dd++; else if (body[k] === "}" && --dd === 0) { fc = k; break; } }
      if (fc < 0) break;
      nested += " " + body.slice(fo, fc + 1);
      body = body.slice(0, fo) + " ".repeat(fc + 1 - fo) + body.slice(fc + 1);
      fnRe.lastIndex = fc + 1;
    }
    for (const v of body.matchAll(/\bvar\s+([A-Za-z_$][\w$]*)/g)) {
      if (new RegExp("(^|[^\\w$.])" + v[1].replace(/\$/g, "\\$") + "\\b").test(nested)) found.push(v[1] + " (line " + out.slice(0, open + 1 + v.index).split("\n").length + ")");
    }
  }
  return found;
}

await section("0. No function-scoped `var` captured by a closure inside a `for (let ...)` loop", async () => {
  const bad = 'for (let i=0;i<28;i++) {\n  let iso = d(i);\n  var sel = el("select");\n  sel.addEventListener("change", async function () { plan.overrides[iso] = clonePreset(sel.value); });\n}';
  const good = bad.replace("var sel", "let sel");
  check(loopVarCaptures(bad).length === 1 && /^sel /.test(loopVarCaptures(bad)[0]) && loopVarCaptures(good).length === 0,
    "the scanner catches the Month-view pattern (and passes the fixed form)", "scanner self-test: bad=" + JSON.stringify(loopVarCaptures(bad)) + " good=" + JSON.stringify(loopVarCaptures(good)));
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app-modules");
  const hits = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    for (const h of loopVarCaptures(fs.readFileSync(path.join(dir, name), "utf-8"))) hits.push(name + ": " + h);
  }
  check(hits.length === 0, "no app module has the pattern", "captured loop `var`: " + hits.join(" | "));
});

await section("1. Month view: the session you pick for a date is the session that is saved", async () => {
  await openPlanner(page, "month");
  const monthBoot = await page.evaluate(() => Array.from(document.querySelectorAll("select[data-pt-date-session]")).map((s) => ({ iso: s.getAttribute("data-pt-date-session"), v: s.value })));
  check(monthBoot.length === 28 && monthBoot[0].iso === TODAY && monthBoot[27].iso === LAST,
    "month view lists 28 dates starting today (" + TODAY + " .. " + LAST + ")", "month cells: " + JSON.stringify(monthBoot.slice(0, 3)));
  const lastValue = monthBoot.length ? monthBoot[monthBoot.length - 1].v : null;
  for (const [cellIso, pick] of [[SUN, "recovery"], [WED, "circuit"]]) {
    const before = (monthBoot.find((c) => c.iso === cellIso) || {}).v;
    if (before === pick || lastValue === pick) { bad("fixture problem: " + cellIso + " pick '" + pick + "' must differ from the cell (" + before + ") and the last cell (" + lastValue + ")"); continue; }
    await page.locator('select[data-pt-date-session="' + cellIso + '"]').focus();
    await page.locator('select[data-pt-date-session="' + cellIso + '"]').selectOption(pick);
    const saved = await until(async () => { const pl = await storedPlan(); return pl && pl.overrides && pl.overrides[cellIso] ? pl.overrides[cellIso] : null; });
    check(saved && saved.id === pick, cellIso + ": picking '" + pick + "' stores '" + pick + "' for that date", cellIso + ": picked '" + pick + "' but storage holds " + JSON.stringify(saved) + " (the last cell shows '" + lastValue + "')");
    await sleep(150);
    const shown = await page.locator('select[data-pt-date-session="' + cellIso + '"]').inputValue();
    check(shown === pick, cellIso + ": the redrawn cell shows '" + pick + "'", cellIso + ": redrawn cell shows '" + shown + "'");
    const cellText = await page.locator('.pt-month-day[data-pt-date="' + cellIso + '"]').innerText();
    check(/changed for this date/i.test(cellText) && !/override/i.test(cellText), cellIso + ": the cell says in plain words that this date was changed", cellIso + ": cell text is " + JSON.stringify(cellText));
    const f = await focusDesc();
    check(f.indexOf("data-pt-date-session=" + cellIso) !== -1, cellIso + ": keyboard focus is still on that date's picker after the redraw", cellIso + ": focus after the edit is " + f);
  }
  const others = await page.evaluate(([a, b]) => Array.from(document.querySelectorAll("select[data-pt-date-session]")).filter((s) => s.getAttribute("data-pt-date-session") !== a && s.getAttribute("data-pt-date-session") !== b).map((s) => s.getAttribute("data-pt-date-session") + "=" + s.value), [SUN, WED]);
  const expectedOthers = monthBoot.filter((c) => c.iso !== SUN && c.iso !== WED).map((c) => c.iso + "=" + c.v);
  check(JSON.stringify(others) === JSON.stringify(expectedOthers), "the other 26 dates are untouched", "other dates changed: " + JSON.stringify(others.filter((x, i) => x !== expectedOthers[i])));
  const spoken = await live();
  check(/circuit/i.test(spoken), "the date change is announced (\"" + spoken + "\")", "no announcement after a date change: " + JSON.stringify(spoken));
  // ...and the way back.
  await page.locator('[data-pt-date-reset="' + SUN + '"]').click();
  const gone = await until(async () => { const pl = await storedPlan(); return pl && pl.overrides && !pl.overrides[SUN]; });
  check(gone, "\"Use weekly plan\" removes that date's change", "the change for " + SUN + " is still stored after the reset");
  await sleep(150);
  const back = await page.locator('select[data-pt-date-session="' + SUN + '"]').inputValue();
  check(back === "rest", "...and the cell goes back to the weekly session (rest)", "cell after reset: " + back);
  const fReset = await focusDesc();
  check(fReset.indexOf("data-pt-date-session=" + SUN) !== -1, "...and focus moves to that date's picker (the reset button no longer exists)", "focus after reset: " + fReset);
  await page.locator('[data-pt-date-reset="' + WED + '"]').click();
  await until(async () => { const pl = await storedPlan(); return pl && !pl.overrides[WED]; });
});

await section("2. Week view: focus, announcements and the hard:recovery panel", async () => {
  await page.evaluate(async () => { await window.G.db.setSetting("prt:plan:v1", window.G.ptPlanner._planFromTemplate("balanced")); });
  await openPlanner(page, "week");
  await page.evaluate(() => { document.querySelector("[data-pt-ratio]").__sameNode = true; });
  await page.locator('select[data-pt-session="mon"]').focus();
  await page.locator('select[data-pt-session="mon"]').selectOption("prep");
  await until(async () => ((await storedPlan()) || {}).days.mon.id === "prep");
  await sleep(200);
  let f = await focusDesc();
  check(f.indexOf("data-pt-session=mon") !== -1, "changing Monday keeps focus on Monday's picker", "focus after changing Monday: " + f);
  const liveMon = await live();
  check(/monday/i.test(liveMon) && /preparation drill/i.test(liveMon), "...and is announced (\"" + liveMon + "\")", "announcement after changing Monday: " + JSON.stringify(liveMon));
  await page.locator('[data-pt-swap="mon"]').focus();
  await page.locator('[data-pt-swap="mon"]').click();
  await until(async () => { const pl = await storedPlan(); return pl.days.tue.id === "prep" && pl.days.mon.id === "recovery"; });
  await sleep(200);
  f = await focusDesc();
  check(f.indexOf("data-pt-swap=mon") !== -1, "Swap keeps focus on the Swap button", "focus after Swap: " + f);
  await page.locator("[data-pt-rotate]").focus();
  await page.locator("[data-pt-rotate]").click();
  await until(async () => ((await storedPlan()) || {}).days.sat.id === "rest");
  await sleep(200);
  f = await focusDesc();
  check(f.indexOf("data-pt-rotate") !== -1, "Rotate keeps focus on the Rotate button", "focus after Rotate: " + f);
  const rotated = await storedPlan();
  check(rotated.days.sat.id === "rest" && rotated.days.sun.id === "recovery" && rotated.days.mon.id === "prep", "Rotate moved every day one slot earlier", "after rotate: " + dayIds(rotated));
  await page.locator("[data-pt-undo]").click();
  await until(async () => ((await storedPlan()) || {}).days.sun.id === "rest");
  check((await storedPlan()).days.sun.id === "rest" && (await storedPlan()).days.tue.id === "prep", "Undo puts the rotated week back", "after Undo: " + dayIds(await storedPlan()));
  await sleep(200);
  f = await focusDesc();
  check(f !== "BODY", "...and focus is not dropped when the Undo button goes away (" + f + ")", "focus after Undo fell to <body>");
  // Drive the week over the guardrail: make every day hard.
  // The flag turns on part-way through (at 6 hard : 1 recovery), so the
  // announcement is read after EACH edit, not once at the end.
  const spokenPerEdit = [];
  for (const k of ["sun", "mon", "tue", "thu", "sat"]) {
    await page.locator('select[data-pt-session="' + k + '"]').selectOption("strength");
    await until(async () => ((await storedPlan()) || {}).days[k].id === "strength");
    await sleep(150);
    spokenPerEdit.push(await live());
  }
  await sleep(150);
  const flagged = await page.evaluate(() => ({
    same: document.querySelector("[data-pt-ratio]").__sameNode === true,
    count: document.querySelectorAll("[data-pt-ratio]").length,
    text: document.querySelector("[data-pt-ratio]").textContent,
  }));
  check(flagged.same && flagged.count === 1, "the hard:recovery panel is one persistent node that is updated in place", "status panel was rebuilt: " + JSON.stringify({ same: flagged.same, count: flagged.count }));
  check(/Flag:/.test(flagged.text) && /7 hard/.test(flagged.text), "seven hard days with no recovery or rest raises the flag", "ratio panel: " + flagged.text);
  const flips = spokenPerEdit.filter((t) => /heads up/i.test(t));
  check(flips.length === 1 && /thursday/i.test(flips[0]), "the flag turning on is announced once, with the edit that caused it (\"" + flips[0] + "\")", "flag flip announcements: " + JSON.stringify(spokenPerEdit));
  await page.locator('select[data-pt-session="sun"]').selectOption("rest");
  await until(async () => ((await storedPlan()) || {}).days.sun.id === "rest");
  await sleep(150);
  check(/Flag:/.test(await page.locator("[data-pt-ratio]").innerText()), "six hard days to one rest day is still flagged", "6 hard : 1 rest was not flagged");
  await page.locator('select[data-pt-session="tue"]').selectOption("rest");
  await until(async () => ((await storedPlan()) || {}).days.tue.id === "rest");
  await sleep(200);
  const clearedText = await page.locator("[data-pt-ratio]").innerText();
  check(!/Flag:/.test(clearedText) && /2 recovery or rest/.test(clearedText), "five hard days to two rest days clears it, and rest days are counted", "ratio panel: " + JSON.stringify(clearedText));
  const liveClear = await live();
  check(/clear/i.test(liveClear), "the flag clearing is announced (\"" + liveClear + "\")", "flag clearing not announced: " + JSON.stringify(liveClear));
});

await section("3. Day / Week / Month switcher is a keyboard tablist", async () => {
  await openPlanner(page, "week");
  const tabState = () => page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tablist"] [data-pt-view]'));
    const stage = document.querySelector("[data-pt-stage]");
    const sel = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    return {
      tabindex: tabs.map((t) => t.tabIndex), selected: sel && sel.getAttribute("data-pt-view"),
      stageRole: stage.getAttribute("role"), labelled: stage.getAttribute("aria-labelledby"), selId: sel && sel.id,
      focus: document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute("data-pt-view"),
    };
  });
  let ts = await tabState();
  check(ts.tabindex.filter((x) => x === 0).length === 1 && ts.tabindex.filter((x) => x === -1).length === 2, "exactly one tab is in the tab order (roving tabindex)", "tab tabindex values: " + JSON.stringify(ts.tabindex));
  check(ts.stageRole === "tabpanel" && !!ts.labelled && ts.labelled === ts.selId, "the view below is a tabpanel labelled by the selected tab", "stage: " + JSON.stringify(ts));
  await page.locator('[data-pt-view="week"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForSelector("[data-pt-month]", { timeout: 2500 }).catch(() => {});
  ts = await tabState();
  check(ts.selected === "month" && ts.focus === "month", "ArrowRight from Week selects Month and keeps focus on the tab", "after ArrowRight: " + JSON.stringify(ts));
  await page.keyboard.press("Home");
  await page.waitForSelector("[data-pt-complete]", { timeout: 2500 }).catch(() => {});
  ts = await tabState();
  check(ts.selected === "day" && ts.focus === "day" && ts.tabindex[0] === 0, "Home jumps to Day", "after Home: " + JSON.stringify(ts));
});

await section("4. A date changed in Month view is what Day view, the log and reminders use", async () => {
  await page.evaluate(async () => { await window.G.db.setSetting("prt:plan:v1", window.G.ptPlanner._planFromTemplate("balanced")); await window.G.db.setSetting("reminders:v1", []); await window.G.db.setSetting("pt:history:v1", []); });
  await openPlanner(page, "month");
  await page.locator('select[data-pt-date-session="' + TODAY + '"]').selectOption("prep"); // Friday is "Leader-built circuit" (hard) in the weekly plan
  await until(async () => { const pl = await storedPlan(); return pl.overrides && pl.overrides[TODAY] && pl.overrides[TODAY].id === "prep"; });
  await page.locator('[data-pt-view="day"]').click();
  await page.waitForSelector("[data-pt-complete]");
  const dayCard = await page.evaluate(() => { const c = document.querySelector("[data-pt-stage] .pt-day-card"); return { sel: c.querySelector("select").value, text: c.innerText }; });
  check(dayCard.sel === "prep" && /Recovery/i.test(dayCard.text) && /changed for this date/i.test(dayCard.text),
    "Day view shows today's changed session (Preparation Drill, recovery) and says it was changed", "Day view shows " + JSON.stringify(dayCard));
  await page.locator("[data-pt-complete]").click();
  const logged = await until(async () => { const h = await storedHistory(); return h.length ? h : null; });
  check(logged && logged[0].date === TODAY && logged[0].title === "Preparation Drill" && logged[0].effort === "recovery",
    "\"Mark today complete\" logs the changed session, not the weekly one", "logged: " + JSON.stringify(logged));
  check(logged && logged[0].type === "drill", "...and the log row records what kind of day it was", "logged row has no type: " + JSON.stringify(logged && logged[0]));
  await sleep(300);
  const histPanel = (await page.locator("[data-pt-history-guard]").innerText()).replace(/\s+/g, " ");
  check(/0 hard/.test(histPanel) && /1 recovery/.test(histPanel), "the 7-day history check counts it as recovery (\"" + histPanel.slice(0, 90) + "\")", "history panel: " + histPanel);
  const f = await focusDesc();
  check(f !== "BODY", "focus is kept after logging (" + f + ")", "focus fell to <body> after logging today");
  // Reminders. Seeded through storage (not the Month picker) so this block fails on its own defect only.
  await page.evaluate(async ([tue, sun]) => {
    const P = window.G.ptPlanner, pl = await window.G.db.getSetting("prt:plan:v1");
    pl.overrides[tue] = Object.assign({}, P.PRESETS.rest);      // weekly Tuesday = Recovery / mobility
    pl.overrides[sun] = Object.assign({}, P.PRESETS.strength);  // weekly Sunday = rest
    await window.G.db.setSetting("prt:plan:v1", pl);
  }, [TUE, SUN]);
  await openPlanner(page, "week");
  await page.locator('[data-pt-remind="tue"]').click();
  await sleep(600);
  let rems = await ptReminders();
  check(!rems.some((r) => r.date === TUE), "\"Remind me\" on Tuesday adds nothing when that Tuesday was changed to a rest day", "reminder created for a rest date: " + JSON.stringify(rems));
  const tueBtn = await page.locator('[data-pt-remind="tue"]').innerText();
  check(/rest/i.test(tueBtn), "...and the button says why (\"" + tueBtn + "\")", "Tuesday remind button reads " + JSON.stringify(tueBtn));
  const usedLook = await page.evaluate(() => { const b = document.querySelector('[data-pt-remind="tue"]'); return { aria: b.getAttribute("aria-disabled"), native: b.disabled, opacity: Number(getComputedStyle(b).opacity), focusable: (b.focus(), document.activeElement === b) }; });
  check(usedLook.aria === "true" && usedLook.native === false && usedLook.opacity < 1 && usedLook.focusable, "a used button looks and reads as unavailable but stays focusable (no focus drop)", "used button: " + JSON.stringify(usedLook));
  await page.locator("[data-pt-remind-week]").click();
  await until(async () => (await ptReminders()).length >= 5);
  await sleep(500);
  rems = await ptReminders();
  const byDate = Object.fromEntries(rems.map((r) => [r.date, r.label]));
  check(!byDate[TUE], "\"Schedule week reminders\" skips the date that was changed to rest", "week scheduler reminded a rest date: " + JSON.stringify(byDate));
  check(byDate[SUN] === "PT: Strength & mobility session", "...and reminds the rest weekday that was changed to a session, with that session's name", "Sunday reminder: " + JSON.stringify(byDate[SUN]) + " of " + JSON.stringify(byDate));
  check(rems.length === 6 && rems.every((r) => r.date > TODAY), "six reminders, one per training date in the next 7 days", "pt reminders: " + JSON.stringify(byDate));
});

await section("5. The hard:recovery check", async () => {
  const guard = await page.evaluate(() => {
    const P = window.G.ptPlanner, keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const week = (ids) => { const p = P._planFromTemplate("balanced"); keys.forEach((k, i) => { p.days[k] = Object.assign({}, P.PRESETS[ids[i]]); }); return p; };
    const rowsFor = (p) => keys.map((k, i) => { const d = new Date(); d.setDate(d.getDate() - i); const e = p.days[k];
      return { date: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"), title: e.title, effort: e.effort, type: e.type }; });
    const one = week(["rest", "strength", "rest", "rest", "rest", "rest", "rest"]);
    const mwf = week(["rest", "strength", "rest", "endurance", "rest", "circuit", "rest"]);
    const heavy = P._planFromTemplate("balanced");
    keys.forEach((k, i) => { heavy.days[k] = { id: "custom", title: "X", type: "custom", effort: i < 4 ? "hard" : i === 4 ? "recovery" : "moderate", route: "" }; });
    const pick = (r) => ({ hard: r.hard, recovery: r.recovery, moderate: r.moderate, warn: r.warn });
    return { one: pick(P._ratio(one)), mwf: pick(P._ratio(mwf)), mwfHist: pick(P._historyRatio(rowsFor(mwf))), heavy: pick(P._ratio(heavy)), heavyHist: pick(P._historyRatio(rowsFor(heavy))) };
  });
  check(guard.one.warn === false, "one hard session and six rest days is not flagged", "one-session week: " + JSON.stringify(guard.one));
  check(guard.mwf.warn === false && guard.mwf.hard === 3, "hard Mon/Wed/Fri with rest between is not flagged", "M/W/F week: " + JSON.stringify(guard.mwf));
  check(JSON.stringify(guard.mwf) === JSON.stringify(guard.mwfHist), "the plan check and the completed-history check count the same week the same way", "plan " + JSON.stringify(guard.mwf) + " vs history " + JSON.stringify(guard.mwfHist));
  check(guard.heavy.warn === true && guard.heavyHist.warn === true, "four hard sessions to one recovery is still flagged by both", "heavy week: " + JSON.stringify(guard.heavy) + " / " + JSON.stringify(guard.heavyHist));
  await openPlanner(page, "week");
  await page.locator('select[data-pt-session="mon"]').selectOption("custom");
  await page.waitForSelector('select[data-pt-effort="mon"]');
  await page.waitForSelector("[data-pt-history-guard]");
  await page.locator('select[data-pt-effort="mon"]').focus();
  await page.locator('select[data-pt-effort="mon"]').selectOption("hard");
  await until(async () => ((await storedPlan()) || {}).days.mon.effort === "hard");
  await sleep(300);
  const afterEffort = await page.evaluate(() => ({
    history: !!document.querySelector("[data-pt-history-guard]"),
    hint: document.querySelector('.pt-day-card[data-pt-day="mon"]').innerText,
    focus: document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute("data-pt-effort"),
  }));
  check(afterEffort.history, "the completed-history panel is still there after a custom-effort edit", "history panel vanished after the effort edit");
  check(/Hard effort/i.test(afterEffort.hint), "...and the card's effort line is updated", "Monday card after effort edit: " + JSON.stringify(afterEffort.hint));
  check(afterEffort.focus === "mon", "...and focus stays on the effort picker", "focus after effort edit: " + (await focusDesc()));
});

await section("6. Template dropdown previews; Apply asks first and can be undone", async () => {
  await openPlanner(page, "week");
  if ((await page.locator('select[data-pt-session="mon"]').inputValue()) !== "custom") {
    await page.locator('select[data-pt-session="mon"]').selectOption("custom");
    await page.waitForSelector('input[data-pt-custom="mon"]');
  }
  await page.locator('input[data-pt-custom="mon"]').fill("Ruck technique");
  await page.locator('input[data-pt-custom="mon"]').press("Tab");
  await until(async () => ((await storedPlan()) || {}).days.mon.title === "Ruck technique");
  const snap = (pl) => JSON.stringify({ t: pl.templateId, mon: pl.days.mon.title, tue: pl.days.tue.id, o: Object.keys(pl.overrides || {}).sort() });
  const beforeTemplate = snap(await storedPlan());
  await page.locator("[data-pt-template]").focus();
  await page.keyboard.press("ArrowDown");
  await sleep(400);
  check(snap(await storedPlan()) === beforeTemplate, "arrow-keying the Template dropdown changes nothing that is saved", "plan changed by browsing templates: " + beforeTemplate + " -> " + snap(await storedPlan()));
  await page.locator("[data-pt-template]").selectOption("field");
  await sleep(400);
  const afterPick = await storedPlan();
  check(afterPick.days.mon.title === "Ruck technique" && Object.keys(afterPick.overrides || {}).length === 3, "picking a template in the dropdown changes nothing that is saved", "plan changed by picking a template: " + snap(afterPick));
  const previewHint = await page.locator("[data-pt-template-hint]").innerText();
  check(/front-loads/i.test(previewHint) && /apply template/i.test(previewHint), "the hint describes the previewed template and says it is not in use yet", "template hint: " + JSON.stringify(previewHint));
  await page.locator("[data-pt-apply-template]").click();
  const dlg = page.locator(".gm-box");
  const asked = await dlg.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false);
  check(asked, "\"Apply template\" asks before replacing an edited week", "no confirmation dialog appeared");
  if (!asked) return;
  const msg = await dlg.innerText();
  check(/Field-ready week/.test(msg) && !/override|JSON/i.test(msg), "the question names the template in plain words", "dialog text: " + JSON.stringify(msg));
  await dlg.locator("button", { hasText: /^Cancel$/ }).click();
  await dlg.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  await sleep(250);
  check(snap(await storedPlan()) === beforeTemplate, "Cancel keeps the week exactly as it was", "plan after Cancel: " + snap(await storedPlan()));
  const ddAfterCancel = await page.locator("[data-pt-template]").inputValue();
  check(ddAfterCancel === "balanced", "...and the dropdown goes back to the template in use", "dropdown after Cancel: " + ddAfterCancel);
  await page.locator("[data-pt-template]").selectOption("field");
  await page.locator("[data-pt-apply-template]").click();
  await dlg.waitFor({ state: "visible", timeout: 3000 });
  await dlg.locator("button").last().click();
  await until(async () => ((await storedPlan()) || {}).templateId === "field");
  const applied = await storedPlan();
  check(applied.templateId === "field" && applied.days.mon.id === "endurance", "confirming applies the template's seven days", "after apply: " + snap(applied));
  check(!!(applied.overrides[TUE] && applied.overrides[SUN] && applied.overrides[TODAY]), "changes made to individual dates are kept", "date changes after apply: " + JSON.stringify(Object.keys(applied.overrides)));
  await sleep(300);
  check((await page.locator("[data-pt-undo]").count()) === 1, "an Undo button is offered", "no Undo button after applying a template");
  check((await focusDesc()) !== "BODY", "focus is not dropped after applying (" + (await focusDesc()) + ")", "focus fell to <body> after applying a template");
  check(/applied/i.test(await live()), "applying is announced (\"" + (await live()) + "\")", "no announcement: " + JSON.stringify(await live()));
  await page.locator("[data-pt-undo]").click();
  await until(async () => snap(await storedPlan()) === beforeTemplate);
  check(snap(await storedPlan()) === beforeTemplate, "Undo restores the custom Monday and the week that was replaced", "after Undo: " + snap(await storedPlan()) + " expected " + beforeTemplate);
  await sleep(250);
  check((await page.locator("[data-pt-undo]").count()) === 0 && (await focusDesc()) !== "BODY", "Undo is one-shot and leaves focus on a real control (" + (await focusDesc()) + ")", "after Undo: undo buttons=" + (await page.locator("[data-pt-undo]").count()) + " focus=" + (await focusDesc()));
});

await section("7. Every control does something: plan file out, plan file in", async () => {
  await openPlanner(page, "week");
  const inert = await page.evaluate(() => ({
    intensity: document.querySelectorAll("[data-intensity]").length,
    shareable: document.querySelectorAll("[data-pt-shareable]").length,
    jargon: Array.from(document.querySelectorAll("#route button, #route label, #route p, #route .eyebrow")).map((n) => n.textContent).filter((t) => /\bJSON\b|override|shareable|intensity dial/i.test(t)),
  }));
  check(inert.intensity === 0 && inert.shareable === 0, "the Intensity dial and the \"shareable\" checkbox (neither changed anything) are gone", "inert controls still present: " + JSON.stringify({ intensity: inert.intensity, shareable: inert.shareable }));
  check(inert.jargon.length === 0, "no \"JSON\" / \"override\" wording on the planner", "jargon on screen: " + JSON.stringify(inert.jargon));
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.locator("[data-pt-export]").click()]);
  const planFile = path.join(tmpDir, download.suggestedFilename());
  await download.saveAs(planFile);
  const exported = JSON.parse(fs.readFileSync(planFile, "utf-8"));
  check(exported.schema === "guidon.pt-plan/v1" && exported.plan && exported.plan.days.mon.title === "Ruck technique" && !("shareable" in exported) && !("shareable" in exported.plan),
    "\"Save plan file to share\" writes the plan (custom Monday included, no leftover flags)", "exported: " + JSON.stringify(exported).slice(0, 300));

  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page2 = await ctx2.newPage();
  page2.setDefaultTimeout(5000);
  watch(page2, "[device2]");
  await page2.clock.install({ time: FRIDAY });
  await page2.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page2);
  await openPlanner(page2, "week");
  const hasImport = (await page2.locator("[data-pt-import-file]").count()) === 1;
  check(hasImport, "a second device has an \"Open a shared plan file\" control", "no plan-file import control on the planner");
  if (hasImport) {
    await page2.locator("[data-pt-import-file]").setInputFiles(planFile);
    const dlg2 = page2.locator(".gm-box");
    const asked2 = await dlg2.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false);
    check(asked2, "opening a shared plan asks before replacing this device's plan", "no confirmation before import");
    if (asked2) {
      await dlg2.locator("button").last().click();
      const got = await until(async () => { const pl = await storedPlan(page2); return pl && pl.days.mon.title === "Ruck technique" ? pl : null; });
      check(!!got, "the shared plan is now this device's plan", "device 2 plan after import: " + JSON.stringify(await storedPlan(page2)).slice(0, 200));
      await page2.waitForTimeout(300);
      const monField = await page2.locator('input[data-pt-custom="mon"]').inputValue().catch(() => "(none)");
      check(monField === "Ruck technique", "...and is on screen", "device 2 Monday field: " + monField);
      check((await page2.locator("[data-pt-undo]").count()) === 1 && (await focusDesc(page2)) !== "BODY", "...with Undo offered and focus kept", "undo=" + (await page2.locator("[data-pt-undo]").count()) + " focus=" + (await focusDesc(page2)));
    }
    // Malformed and hostile files.
    const before2 = JSON.stringify(await storedPlan(page2));
    const junk = path.join(tmpDir, "not-a-plan.json");
    fs.writeFileSync(junk, "{\"hello\":\"world\"}");
    await page2.locator("[data-pt-import-file]").setInputFiles(junk);
    await page2.waitForTimeout(600);
    const junkMsg = await page2.locator("[data-pt-import-status]").innerText().catch(() => "");
    check(JSON.stringify(await storedPlan(page2)) === before2 && /isn.t a GUIDON PT plan/i.test(junkMsg) && (await page2.locator(".gm-box").count()) === 0,
      "a file that is not a PT plan is refused in plain words and changes nothing", "junk import: msg=" + JSON.stringify(junkMsg) + " changed=" + (JSON.stringify(await storedPlan(page2)) !== before2));
    const hostile = path.join(tmpDir, "hostile.json");
    fs.writeFileSync(hostile, JSON.stringify({ schema: "guidon.pt-plan/v1", plan: { templateId: "nope", days: {
      mon: { id: "custom", title: "A".repeat(400), type: "<img>", effort: "extreme", route: "javascript:alert(1)", sessionId: "../x" },
      tue: "garbage" }, overrides: { "not-a-date": { id: "rest" }, "2020-01-01": { id: "rest" }, [TUE]: { id: "strength", route: "https://example.invalid/" } } } }));
    await page2.locator("[data-pt-import-file]").setInputFiles(hostile);
    await page2.locator(".gm-box").waitFor({ state: "visible", timeout: 4000 });
    await page2.locator(".gm-box button").last().click();
    const cleaned = await until(async () => { const pl = await storedPlan(page2); return pl && pl.days.mon.title.charAt(0) === "A" ? pl : null; });
    check(cleaned && cleaned.templateId === "balanced" && cleaned.days.mon.title.length <= 80 && cleaned.days.mon.type === "custom" && cleaned.days.mon.effort === "moderate" && cleaned.days.mon.route === "" && cleaned.days.mon.sessionId === "" && cleaned.days.tue.id === "recovery",
      "a hostile plan file is cleaned: long names cut, unknown values replaced, links dropped, missing days filled", "cleaned plan: " + JSON.stringify(cleaned && cleaned.days.mon) + " tue=" + JSON.stringify(cleaned && cleaned.days.tue));
    check(cleaned && JSON.stringify(Object.keys(cleaned.overrides)) === JSON.stringify([TUE]) && cleaned.overrides[TUE].route === "#/drills",
      "...and only real, recent date changes survive, rebuilt from the built-in session", "date changes: " + JSON.stringify(cleaned && cleaned.overrides));
  }
  await ctx2.close();
});

await section("8. PT reminders expire instead of piling up as overdue", async () => {
  const boardDate = iso(plusDays(10));
  await page.evaluate(async (d) => { await window.G.reminders.add({ kind: "board", label: "Promotion board", date: d }); }, boardDate);
  const stripRows = async () => {
    await page.evaluate(() => { location.hash = "#/profile"; });
    await sleep(250);
    await page.evaluate(() => { location.hash = "#/home"; });
    await page.waitForSelector(".reminders-strip", { timeout: 8000 }).catch(() => {});
    await sleep(350);
    return page.evaluate(() => Array.from(document.querySelectorAll(".reminders-strip .reminder-row")).map((r) => r.getAttribute("aria-label")));
  };
  const day0 = await stripRows();
  check(day0.some((t) => /^PT: /.test(t)), "today, upcoming PT reminders appear on Home (" + day0.length + " rows)", "day-0 strip: " + JSON.stringify(day0));
  await page.clock.setSystemTime(plusDays(8)); // Sat 26 Sep: every PT reminder above is now in the past
  await reboot(page);
  const day8 = await stripRows();
  check(!day8.some((t) => /^PT: /.test(t)), "eight days later no stale PT row is on Home", "day-8 strip still shows PT rows: " + JSON.stringify(day8));
  check(day8.some((t) => /Promotion board/.test(t) && /in 2 days/.test(t)), "...and the board date (2 days out) is visible", "day-8 strip: " + JSON.stringify(day8));
  const overdueSpoken = await live();
  check(!/overdue/i.test(overdueSpoken), "...and nothing is announced as overdue", "announced: " + JSON.stringify(overdueSpoken));
  const bucketed = await page.evaluate(async () => { const b = window.G.reminders.bucket(await window.G.reminders.load()); return { overdue: b.overdue.length, soon: b.soon.map((r) => r.label) }; });
  check(bucketed.overdue === 0, "the reminders editor has no overdue PT rows either", "bucketed: " + JSON.stringify(bucketed));
  await openPlanner(page, "week");
  const today8 = iso(plusDays(8));
  await page.locator("[data-pt-remind-week]").click();
  await until(async () => (await ptReminders()).some((r) => r.date > today8));
  await sleep(600);
  const afterSecond = await ptReminders();
  check(afterSecond.length > 0 && afterSecond.every((r) => r.date > today8), "scheduling another week replaces the expired rows (" + afterSecond.length + " PT rows stored, none in the past)", "stored PT rows after second scheduling: " + JSON.stringify(afterSecond.map((r) => r.date)));
  const weekBtn = await page.locator("[data-pt-remind-week]").innerText();
  check(/\d+ reminders? set/i.test(weekBtn), "the button reports how many were set (\"" + weekBtn + "\")", "week button text: " + JSON.stringify(weekBtn));
  await page.clock.setSystemTime(plusDays(10)); // Mon 28 Sep - a reminder for today exists
  await reboot(page);
  await openPlanner(page, "day");
  const today10 = iso(plusDays(10));
  const hadToday = (await ptReminders()).some((r) => r.date === today10);
  await page.locator("[data-pt-complete]").click();
  await until(async () => (await storedHistory()).some((h) => h.date === today10));
  await sleep(500);
  const leftToday = (await ptReminders()).filter((r) => r.date === today10);
  check(hadToday && leftToday.length === 0, "logging today's session clears today's PT reminder", "today's reminder: before=" + hadToday + " after=" + JSON.stringify(leftToday));
});

await section("9. Storage: validated, backed up, pruned, and not overwritten from a stale screen", async () => {
  const contract = await page.evaluate(async () => {
    const B = window.G.backup, P = window.G.ptPlanner;
    const v = (k, val) => B.validateKvRow({ k: k, v: val });
    const out = {
      badPlan: v("prt:plan:v1", "garbage"), badPlan2: v("prt:plan:v1", { days: [] }), goodPlan: v("prt:plan:v1", P._planFromTemplate("field")),
      badHist: v("pt:history:v1", { a: 1 }), badHist2: v("pt:history:v1", [null, "x"]), goodHist: v("pt:history:v1", [{ date: "2026-09-18", title: "T", effort: "hard" }]),
      badTeam: v("team:training:v1", [1, 2]), goodTeam: v("team:training:v1", { "aar-huddle": { count: 1, last: 1 } }),
    };
    const plan = await window.G.db.getSetting("prt:plan:v1"), hist = await window.G.db.getSetting("pt:history:v1");
    await window.G.db.setSetting("team:training:v1", { "aar-huddle": { count: 2, last: 5 } });
    const payload = await B.exportAll();
    const keys = payload.stores.kv.map((r) => r.k);
    out.exported = ["prt:plan:v1", "pt:history:v1", "team:training:v1"].every((k) => keys.indexOf(k) !== -1);
    await window.G.db.del("kv", "prt:plan:v1"); await window.G.db.del("kv", "pt:history:v1"); await window.G.db.del("kv", "team:training:v1");
    await B.importAll(payload);
    out.restored = JSON.stringify(await window.G.db.getSetting("prt:plan:v1")) === JSON.stringify(plan) && JSON.stringify(await window.G.db.getSetting("pt:history:v1")) === JSON.stringify(hist) &&
      (((await window.G.db.getSetting("team:training:v1")) || {})["aar-huddle"] || {}).count === 2;
    const corrupt = JSON.parse(JSON.stringify(payload));
    corrupt.stores.kv = [{ k: "prt:plan:v1", v: "garbage" }, { k: "pt:history:v1", v: { nope: true } }, { k: "team:training:v1", v: [] }];
    const res = await B.importAll(corrupt);
    out.skipped = res.skipped.kv;
    out.keptAfterCorrupt = JSON.stringify(await window.G.db.getSetting("prt:plan:v1")) === JSON.stringify(plan);
    // Pruning of date changes.
    if (typeof P._normalizePlan === "function") {
      const d = new Date(), isoOf = (x) => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
      const old = new Date(d); old.setDate(old.getDate() - 60); const recent = new Date(d); recent.setDate(recent.getDate() - 3);
      const p = P._planFromTemplate("balanced");
      p.overrides = { bogus: { id: "rest" }, [isoOf(old)]: { id: "rest" }, [isoOf(recent)]: { id: "prep" }, [isoOf(d)]: "nope" };
      out.pruned = Object.keys(P._normalizePlan(p).overrides); out.expectPruned = [isoOf(recent)];
    }
    return out;
  });
  check(contract.badPlan === false && contract.badPlan2 === false && contract.badHist === false && contract.badHist2 === false && contract.badTeam === false,
    "malformed PT plan / PT history / team-count rows fail the shared backup validator", "validator accepted garbage: " + JSON.stringify(contract));
  check(contract.goodPlan === true && contract.goodHist === true && contract.goodTeam === true, "...and well-formed rows pass it", "validator rejected good rows: " + JSON.stringify(contract));
  check(contract.exported && contract.restored, "all three rows ride a backup export and come back on import", "backup round trip: " + JSON.stringify({ exported: contract.exported, restored: contract.restored }));
  check(contract.skipped === 3 && contract.keptAfterCorrupt, "a backup carrying corrupted copies is skipped row by row and the good plan is kept", "corrupt import: " + JSON.stringify({ skipped: contract.skipped, kept: contract.keptAfterCorrupt }));
  check(!!contract.pruned && JSON.stringify(contract.pruned) === JSON.stringify(contract.expectPruned), "date changes with a bad key, a bad value or more than 35 days old are dropped when the plan is saved", "pruned date changes: " + JSON.stringify(contract.pruned) + " expected " + JSON.stringify(contract.expectPruned));
  // Stale-screen overwrite: Day view is open (history was read when it rendered); another writer adds a row; then this screen logs.
  await page.clock.setSystemTime(plusDays(11));
  await reboot(page);
  await openPlanner(page, "day");
  const elsewhere = iso(plusDays(9)), today11 = iso(plusDays(11));
  await page.evaluate(async (d) => { const h = await window.G.db.getSetting("pt:history:v1", []); h.unshift({ date: d, title: "Logged elsewhere", effort: "moderate", type: "custom", ts: 1 }); await window.G.db.setSetting("pt:history:v1", h); }, elsewhere);
  await page.locator("[data-pt-complete]").click();
  await until(async () => (await storedHistory()).some((h) => h.date === today11));
  const finalHist = await storedHistory();
  check(finalHist.some((h) => h.date === elsewhere) && finalHist.some((h) => h.date === today11), "logging from a screen that was already open keeps history written in the meantime", "history after stale-screen log: " + JSON.stringify(finalHist.map((h) => h.date)));
  check(finalHist.filter((h) => h.date === today11).length === 1, "...with one row per date", "rows per date: " + JSON.stringify(finalHist.map((h) => h.date)));
});

await section("10. Phone width (390px)", async () => {
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page3 = await ctx3.newPage();
  page3.setDefaultTimeout(5000);
  watch(page3, "[phone]");
  await page3.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page3);
  for (const view of ["week", "month", "day"]) {
    await openPlanner(page3, view);
    await page3.waitForTimeout(300);
    const o = await page3.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check(o.sw <= o.cw, view + " view fits 390px (" + o.sw + " <= " + o.cw + ")", view + " view overflows at 390px: scrollWidth " + o.sw + " > " + o.cw);
  }
  await ctx3.close();
});

check(noise.length === 0, "no console errors/warnings or page errors in any context", "console noise: " + noise.slice(0, 5).join(" | "));

console.log(fails === 0 ? "\nPT PLANNER BEHAVIOUR: all passed" : "\nPT PLANNER BEHAVIOUR: " + fails + " failed");
await browser.close();
server.close();
// Only the files this run wrote, then the (now empty) folder - never a recursive delete.
try { for (const n of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, n)); fs.rmdirSync(tmpDir); } catch (e) {}
process.exit(fails === 0 ? 0 : 1);
