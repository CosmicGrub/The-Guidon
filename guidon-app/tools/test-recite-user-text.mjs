/**
 * Recitation Drill, "My unit": a Soldier's OWN unit song, creed or motto.
 *
 * Why it exists (audit recommendation R29, shipped with the fix for C25):
 * GUIDON used to bundle one division's song. It may not - a unit song is
 * somebody's work - so instead the Soldier pastes their own copy and drills
 * it with the same study modes as the built-in creeds. This suite drives the
 * whole feature through the real #/recite screen at phone width and proves
 * the promises the on-screen copy makes:
 *
 *  - a clearly separate "My unit" heading under the built-in list, with
 *    plain words saying the text stays on this device;
 *  - add: a labelled form, refusals read out in place (no text lost, focus
 *    on the field to fix), and after Save the new row is selected AND holds
 *    keyboard focus, with the result announced;
 *  - the text lives in ONE row of the app's own on-device store and nowhere
 *    else: not in the question bank, not in Recitation Drill's built-in
 *    list, not in localStorage, and no request ever leaves the page for it;
 *  - every study mode works on it (Full text, First letters, Chunk &
 *    memorize, Timed recitation, Recall ladder), and finishing it writes NO
 *    review grade - it is not a board card;
 *  - it survives a reload, travels in a backup the Soldier exports, and
 *    comes back on restore; a damaged row in a backup file is refused;
 *  - delete asks first, removes the text AND the progress saved for it, and
 *    leaves keyboard focus on a real control;
 *  - a pasted classification marking is refused, the everyday word "secret"
 *    is not;
 *  - nothing scrolls sideways at 390px, even with one long unbroken word.
 *
 * The practice text below was written for this test. It is nobody's song.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { openAsOwner } from "./device-storage.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const KEY = "guidon:recite:own:v1";
const TITLE = "Alpha Troop motto";
const LINES = ["Ready at the first light", "Steady through the long night", "We carry the load together", "And we finish what we start"];
const MARKER = "carry the load together";

const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const noise = [];
const outside = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
page.on("request", (r) => { if (!r.url().startsWith(url) && !/^(data|blob|about):/.test(r.url())) outside.push(r.url()); });

await page.goto(url, { waitUntil: "load" });
// A real profile, not a Guest session: this suite checks that what it does is
// still there after a reload, and a Guest session saves nothing (the storage
// contract - see tools/device-storage.mjs and test-guest-saves-nothing.mjs).
await openAsOwner(page, url);

const openRecite = async () => {
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(150);
  await page.evaluate(() => { location.hash = "#/recite"; });
  await page.waitForSelector("[data-recite-add]");
};
const live = () => page.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");
const focusInfo = () => page.evaluate(() => {
  const a = document.activeElement;
  return { tag: a ? a.tagName : "", id: a ? a.id : "", text: a ? (a.textContent || "").trim().slice(0, 40) : "", reciteId: a && a.dataset ? a.dataset.reciteId || "" : "", isAdd: !!(a && a.dataset && a.dataset.reciteAdd) };
});
const ownRows = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-recite-own] .list-detail-row")).map((r) => ({ text: r.textContent, selected: r.getAttribute("aria-selected"), id: r.dataset.reciteId })));
const stored = () => page.evaluate(async (k) => { const r = await window.G.db.get("kv", k); return r ? r.v : null; }, KEY);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const pickMode = async (label) => {
  await page.locator('[aria-label="Study mode"] .search-chip', { hasText: label }).click();
  await page.waitForTimeout(250);
};

// ---- the section itself ------------------------------------------------
await openRecite();
const section = await page.evaluate(() => {
  const pane = document.querySelector("[data-recite-own]");
  const heading = pane && pane.querySelector("h3");
  const builtIn = document.querySelector('.list-detail-list [role="listbox"][aria-label="Recitable creeds"]');
  return {
    heading: heading ? heading.textContent : "",
    pageHeading: (document.querySelector("#route h2") || {}).textContent || "",
    note: pane ? (pane.querySelector(".hint") || {}).textContent || "" : "",
    // The heading must sit OUTSIDE the built-in listbox, not be one of its options.
    separate: !!(pane && builtIn && !builtIn.contains(pane) && !pane.contains(builtIn)),
    builtInRows: builtIn ? builtIn.querySelectorAll(".list-detail-row").length : 0,
    firstMode: (document.querySelector('[aria-label="Study mode"] .search-chip[aria-pressed="true"]') || {}).textContent || "",
  };
});
section.heading === "My unit" && section.pageHeading === "Recitation Drill" && section.separate && section.builtInRows >= 3
  ? ok("\"My unit\" is its own heading (an h3 under the page's h2) below the built-in creeds, not an entry in their list")
  : bad("My unit section malformed: " + JSON.stringify(section));
/only on this device/i.test(section.note) && /never shared or sent/i.test(section.note)
  ? ok("the section says in plain words that the text stays on this device")
  : bad("the stays-on-this-device copy is missing: " + JSON.stringify(section.note));
section.firstMode === "Full text"
  ? ok("Recitation Drill still opens a built-in creed on Full text - nothing about the default changed")
  : bad("default study mode changed: " + section.firstMode);

// ---- add: refusals first -------------------------------------------------
await page.locator("[data-recite-add]").click();
await page.waitForSelector("#recite-own-title");
let f = await focusInfo();
f.id === "recite-own-title" ? ok("opening the form puts keyboard focus in the Name field") : bad("focus after opening the form: " + JSON.stringify(f));
const labels = await page.evaluate(() => ["recite-own-title", "recite-own-text"].map((id) => (document.querySelector('label[for="' + id + '"]') || {}).textContent || ""));
labels.every((t) => t.length > 0) ? ok("both fields have a visible label tied to them") : bad("a field is unlabelled: " + JSON.stringify(labels));

const save = page.locator("button", { hasText: /^Save on this device$/ });
await save.click();
await page.waitForFunction(() => (document.querySelector("[data-recite-own-error]") || {}).textContent);
let err = await page.evaluate(() => { const e = document.querySelector("[data-recite-own-error]"); return { text: e.textContent, role: e.getAttribute("role") }; });
f = await focusInfo();
/name/i.test(err.text) && err.role === "alert" && f.id === "recite-own-title"
  ? ok("saving with no name is refused in place, read out, with focus on the Name field")
  : bad("empty-name refusal wrong: " + JSON.stringify({ err, f }));

await page.fill("#recite-own-title", TITLE);
await page.fill("#recite-own-text", "Exercise notes\nSECRET//NOFORN\nnot a real marking, a test of the check");
await save.click();
await page.waitForFunction(() => /marking/i.test((document.querySelector("[data-recite-own-error]") || {}).textContent || ""));
(await stored()) === null
  ? ok("text carrying a classification marking is refused and nothing is saved")
  : bad("marked text was saved: " + JSON.stringify(await stored()));
const keptDraft = await page.inputValue("#recite-own-text");
/SECRET\/\/NOFORN/.test(keptDraft) ? ok("a refusal leaves what the Soldier typed in the form") : bad("the draft was wiped by the refusal");

// ---- add: the real thing -------------------------------------------------
await page.fill("#recite-own-text", LINES.join("\n") + "\n\nWe keep no secret from our own");
await save.click();
await page.waitForSelector("[data-recite-own] .list-detail-row");
await page.waitForTimeout(150);
let rows = await ownRows();
f = await focusInfo();
rows.length === 1 && rows[0].text === TITLE && rows[0].selected === "true"
  ? ok("the saved text appears under My unit, selected (and the everyday word \"secret\" did not get it refused)")
  : bad("row after save: " + JSON.stringify(rows));
f.reciteId && f.reciteId === rows[0].id
  ? ok("after Save, keyboard focus is on the new row - not dropped to the page")
  : bad("focus after save: " + JSON.stringify(f));
/Saved on this device/.test(await live()) ? ok("the save is announced: \"" + (await live()).trim() + "\"") : bad("save not announced: " + JSON.stringify(await live()));
const ownId = rows[0].id;

const detail = await page.evaluate(() => {
  const card = document.querySelector(".list-detail > div:last-child .card");
  return {
    title: (card.querySelector("h3") || {}).textContent,
    note: (card.querySelector(".hint") || {}).textContent,
    modes: Array.from(card.querySelectorAll('[aria-label="Study mode"] .search-chip')).map((b) => b.textContent),
    full: (card.querySelector("[data-recite-own-full]") || {}).textContent || "",
  };
});
detail.title === TITLE && /only on this device/i.test(detail.note) && !/^Source:/.test(detail.note)
  ? ok("its detail says whose text it is and where it is kept, instead of inventing a \"Source:\"")
  : bad("own-text detail header wrong: " + JSON.stringify(detail));
JSON.stringify(detail.modes) === JSON.stringify(["Full text", "First letters", "Chunk & memorize", "Timed recitation", "Recall ladder"])
  ? ok("all five study modes are offered for the Soldier's own text")
  : bad("study modes: " + JSON.stringify(detail.modes));
detail.full.split("\n").length === 5 && detail.full.includes(MARKER)
  ? ok("Full text keeps the line breaks the Soldier typed")
  : bad("Full text lost its lines: " + JSON.stringify(detail.full));

// ---- where the text lives -----------------------------------------------
const where = await page.evaluate(async ({ key, marker }) => {
  const row = await window.G.db.get("kv", key);
  const all = await window.G.db.all("kv");
  const holding = all.filter((r) => JSON.stringify(r).includes(marker)).map((r) => r.k);
  let ls = "";
  try { for (let i = 0; i < localStorage.length; i++) ls += localStorage.getItem(localStorage.key(i)); } catch (e) {}
  return {
    shape: row && Array.isArray(row.v) && row.v.length === 1 ? { id: row.v[0].id, title: row.v[0].title, lines: row.v[0].lines.length } : null,
    holding,
    inBank: window.G.store.boardQuestions().some((q) => JSON.stringify(q).includes(marker)),
    inSeed: JSON.stringify(window.GUIDON_SEED.board.questions).includes(marker) || JSON.stringify(window.GUIDON_SEED.creeds).includes(marker),
    inBuiltInList: window.G.store.recitable().some((q) => JSON.stringify(q).includes(marker)),
    inLocalStorage: ls.includes(marker),
  };
}, { key: KEY, marker: MARKER });
where.shape && where.shape.lines === 5 && JSON.stringify(where.holding) === JSON.stringify([KEY])
  ? ok("the text is held in exactly one row of the app's on-device store (" + KEY + ")")
  : bad("storage shape wrong: " + JSON.stringify(where));
!where.inBank && !where.inSeed && !where.inBuiltInList && !where.inLocalStorage
  ? ok("it never enters the question bank, the app's bundled content, the built-in recitation list or localStorage")
  : bad("the text leaked: " + JSON.stringify(where));

// ---- every study mode ----------------------------------------------------
await pickMode("First letters");
const initials = await page.evaluate(() => (document.querySelector(".list-detail > div:last-child .card p.mono") || {}).textContent || "");
initials && !initials.includes("carry") && /^R/.test(initials.trim()) ? ok("First letters shows only initials of the Soldier's own text") : bad("First letters output: " + JSON.stringify(initials));

await pickMode("Chunk & memorize");
for (let i = 0; i < 5; i++) {
  await page.locator(".list-detail > div:last-child button", { hasText: /^Mark learned$/ }).first().click();
  await page.waitForTimeout(140);
}
const finished = await page.evaluate(async (id) => ({
  done: !!document.querySelector("[data-recite-own-done]"),
  gradeRow: !!document.querySelector(".list-detail > div:last-child .qz-grade-row"),
  srs: !!(await window.G.db.get("kv", "srs:" + id)),
  progress: ((await window.G.db.get("kv", "recite:" + id)) || {}).v || null,
  focusText: (document.activeElement.textContent || "").trim(),
}), ownId);
finished.done && !finished.gradeRow && !finished.srs
  ? ok("locking in every line earns a plain well-done line - no grade buttons, and no review record is written for a text that is not a board card")
  : bad("finishing an own text: " + JSON.stringify(finished));
finished.progress && finished.progress.chunksLearned.length === 5 && /Learned/.test(finished.focusText)
  ? ok("line-by-line progress is saved, and focus stays on the button just used")
  : bad("chunk progress/focus: " + JSON.stringify(finished));

await pickMode("Timed recitation");
await page.locator("button", { hasText: /Start timing/ }).click();
await page.waitForTimeout(1200);
await page.locator("button", { hasText: /^Stop$/ }).click();
const clock = await page.evaluate(() => (document.querySelector(".rf-timer") || {}).textContent || "");
/^0:0[1-9]/.test(clock) ? ok("Timed recitation runs on the Soldier's own text (" + clock + ")") : bad("timer read " + JSON.stringify(clock));

await pickMode("Recall ladder");
await page.waitForSelector("[data-ladder-step]");
await page.locator('[data-ladder-step="medium"]').click();
await page.waitForFunction(() => (document.querySelector('[data-ladder-step="medium"]') || { getAttribute() {} }).getAttribute("aria-pressed") === "true");
const ladderPrompt = await page.evaluate(() => (document.querySelector("[data-ladder-prompt]") || {}).textContent || "");
/______/.test(ladderPrompt) && ladderPrompt.split("\n").length === 5
  ? ok("the Recall ladder works on the Soldier's own text, line breaks kept")
  : bad("ladder prompt for own text: " + JSON.stringify(ladderPrompt));
(await overflow()) <= 0 ? ok("no sideways scrolling at 390px with the text open") : bad("page is " + (await overflow()) + "px too wide with the text open");

// ---- Cancel puts everything back ------------------------------------------
await pickMode("Full text");
await page.locator("[data-recite-add]").click();
await page.waitForSelector("#recite-own-title");
const whileAdding = await page.evaluate(() => Array.from(document.querySelectorAll(".list-detail-list .list-detail-row")).filter((r) => r.getAttribute("aria-selected") === "true").length);
await page.locator(".list-detail > div:last-child button", { hasText: /^Cancel$/ }).click();
await page.waitForSelector("#recite-own-title", { state: "detached" });
const afterCancel = await page.evaluate(() => ({
  selected: Array.from(document.querySelectorAll('.list-detail-list .list-detail-row[aria-selected="true"]')).map((r) => r.dataset.reciteId),
  title: (document.querySelector(".list-detail > div:last-child .card h3") || {}).textContent,
  focusIsAdd: !!(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.reciteAdd),
}));
whileAdding === 0 && afterCancel.selected.join() === ownId && afterCancel.title === TITLE && afterCancel.focusIsAdd
  ? ok("while the form is open no row claims to be selected; Cancel re-selects the text that was open and returns focus to \"Add your own text\"")
  : bad("form open/Cancel: " + JSON.stringify({ whileAdding, afterCancel }));

// ---- a long unbroken word must wrap, not widen the page -------------------
await page.locator("[data-recite-add]").click();
await page.waitForSelector("#recite-own-title");
await page.fill("#recite-own-title", "Longword" + "x".repeat(70));
await page.fill("#recite-own-text", "A" + "b".repeat(180) + "\nsecond line");
await save.click();
await page.waitForFunction(() => document.querySelectorAll("[data-recite-own] .list-detail-row").length === 2);
await page.waitForTimeout(150);
let wide = await overflow();
await pickMode("Chunk & memorize");
wide = Math.max(wide, await overflow());
await pickMode("Recall ladder");
await page.waitForSelector("[data-ladder-step]");
wide = Math.max(wide, await overflow());
wide <= 0 ? ok("a long unbroken name or word wraps in the list and in every mode instead of widening the page") : bad("a long unbroken word pushes the page " + wide + "px too wide");
const longId = (await ownRows())[1].id;

// ---- reload, backup, delete, restore -------------------------------------
// Under the real profile this suite runs as, the app reopens straight into
// itself and what was saved is still there. (dismissOnboarding() is a no-op
// then - it returns at once when no welcome screen shows up.)
await page.reload({ waitUntil: "load" });
await dismissOnboarding(page);
await openRecite();
await page.waitForFunction(() => document.querySelectorAll("[data-recite-own] .list-detail-row").length === 2);
ok("both texts are still under My unit after the app is closed and reopened");

const backup = await page.evaluate(async (key) => {
  const payload = await window.G.backup.exportAll();
  window.__ownBackup = payload;
  const rows = (payload.kv || (payload.stores && payload.stores.kv) || []);
  const hit = rows.find((r) => r && r.k === key);
  return { found: !!hit, count: hit && Array.isArray(hit.v) ? hit.v.length : 0 };
}, KEY);
backup.found && backup.count === 2 ? ok("a backup the Soldier exports carries their texts") : bad("backup does not carry the texts: " + JSON.stringify(backup));

const guard = await page.evaluate((key) => ({
  garbage: window.G.backup.validateKvRow({ k: key, v: "not a list" }),
  badLines: window.G.backup.validateKvRow({ k: key, v: [{ id: "own-abcd", title: "x", lines: "one string" }] }),
  good: window.G.backup.validateKvRow({ k: key, v: [{ id: "own-abcd", title: "x", lines: ["a"], addedAt: "" }] }),
  ladderGarbage: window.G.backup.validateKvRow({ k: "recall-ladder:own-abcd", v: "nope" }),
  ladderGood: window.G.backup.validateKvRow({ k: "recall-ladder:own-abcd", v: { level: "easy", streak: 1 } }),
}), KEY);
guard.garbage === false && guard.badLines === false && guard.good === true && guard.ladderGarbage === false && guard.ladderGood === true
  ? ok("restore refuses a damaged My unit or ladder row and accepts a well-formed one")
  : bad("restore validation: " + JSON.stringify(guard));

// Delete the first text through the real button and the real confirm dialog.
await page.locator('[data-recite-own] .list-detail-row[data-recite-id="' + ownId + '"]').click();
await page.waitForSelector("[data-recite-own-delete]");
await page.locator("[data-recite-own-delete]").click();
await page.waitForSelector(".gm-box");
const ask = await page.evaluate(() => document.querySelector(".gm-box").textContent);
/from this device/i.test(ask) && /can't be undone/i.test(ask) ? ok("Delete asks first, in plain words") : bad("confirm copy: " + JSON.stringify(ask));
await page.locator(".gm-box button", { hasText: /^Cancel$/ }).click();
await page.waitForSelector(".gm-box", { state: "detached" });
(await ownRows()).length === 2 ? ok("Cancel keeps the text") : bad("Cancel deleted the text");

await page.locator("[data-recite-own-delete]").click();
await page.waitForSelector(".gm-box");
await page.locator(".gm-box button", { hasText: /^Delete$/ }).click();
await page.waitForFunction(() => document.querySelectorAll("[data-recite-own] .list-detail-row").length === 1);
await page.waitForTimeout(400);
const afterDelete = await page.evaluate(async ({ key, id }) => ({
  left: ((await window.G.db.get("kv", key)) || { v: [] }).v.map((r) => r.id),
  progress: !!(await window.G.db.get("kv", "recite:" + id)),
  ladder: !!(await window.G.db.get("kv", "recall-ladder:" + id)),
  focusOnBody: document.activeElement === document.body || !document.activeElement,
  focusIsAdd: !!(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.reciteAdd),
  selected: (document.querySelector('.list-detail-list .list-detail-row[aria-selected="true"]') || {}).textContent || "",
  live: (document.getElementById("a11y-live") || {}).textContent || "",
}), { key: KEY, id: ownId });
JSON.stringify(afterDelete.left) === JSON.stringify([longId]) && !afterDelete.progress && !afterDelete.ladder
  ? ok("Delete removes the text and the study progress saved for it; the other text is untouched")
  : bad("after delete: " + JSON.stringify(afterDelete));
!afterDelete.focusOnBody && afterDelete.focusIsAdd && afterDelete.selected
  ? ok("after Delete, focus is on \"Add your own text\" and a text is selected again - nothing is dropped to the page")
  : bad("focus/selection after delete: " + JSON.stringify(afterDelete));
/Deleted from this device/.test(afterDelete.live) ? ok("the delete is announced") : bad("delete not announced: " + JSON.stringify(afterDelete.live));

const restored = await page.evaluate(async () => {
  const res = await window.G.backup.importAll(window.__ownBackup);
  return { skipped: res && res.skipped, failed: res && res.failedStores };
});
await openRecite();
await page.waitForFunction(() => document.querySelectorAll("[data-recite-own] .list-detail-row").length === 2).catch(() => {});
rows = await ownRows();
rows.length === 2 && rows.some((r) => r.text === TITLE)
  ? ok("restoring that backup brings the deleted text back under My unit")
  : bad("restore did not bring the text back: " + JSON.stringify({ rows, restored }));

outside.length === 0 ? ok("no request left the page at any point - the text never goes anywhere") : bad("requests left the page: " + outside.slice(0, 3).join(", "));
const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors or warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nRECITE MY UNIT: all passed");
process.exit(fails ? 1 : 0);
