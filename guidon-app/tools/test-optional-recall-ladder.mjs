/**
 * Recall ladder - an OPTIONAL study mode inside Recitation Drill.
 *
 * The defect this guards (audit findings C26 / U30, recommendation R30): the
 * v1.11.0 What's New told Soldiers an "Adaptive Recall Ladder" was available,
 * but the release shipped only helper functions - no screen anywhere showed
 * or used them, so the claim had nothing behind it. The old version of this
 * suite could not notice: it called the helpers through page.evaluate and
 * never looked at the screen (its "placement" check compared a constant to
 * itself).
 *
 * The ladder is now a fifth study mode in #/recite for every recitable text.
 * Everything below is driven through the real screen at phone width:
 *
 *  - every feature the 1.11.0 What's New names for Recitation Drill is
 *    really on the #/recite screen, by the same name, in plain words;
 *  - it is optional: a text still opens on "Full text", and nothing is saved
 *    for the ladder until the Soldier actually uses it;
 *  - five step chips with aria-pressed; "Got it" twice moves up a step, one
 *    "Missed it" moves down one, and any step can be picked by hand;
 *  - each change of step is spoken through the live region, and keyboard
 *    focus stays on the control just used (never dropped to the page);
 *  - "From memory" shows none of the text until the Soldier asks to check;
 *  - NO SECOND SCHEDULER: the ladder never writes a review grade itself. At
 *    the top it offers the same "How well do you know it?" grade row Chunk &
 *    memorize uses, and only a tap on that row writes the srs: record;
 *  - the saved step survives leaving the mode and reloading the app;
 *  - a damaged saved row falls back to the first step instead of freezing
 *    the ladder (the old loader turned a bad count into NaN, and NaN never
 *    reaches "two clean tries");
 *  - nothing scrolls sideways at 390px on any step.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { openAsOwner } from "./device-storage.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const CREED = "creed-4"; // NCO Creed - a bundled recitable that is also a real board card
const { server, url } = await serve("web");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
// A real profile, not a Guest session: this suite checks that what it does is
// still there after a reload, and a Guest session saves nothing (the storage
// contract - see tools/device-storage.mjs and test-guest-saves-nothing.mjs).
await openAsOwner(page, url);

const openCreed = async () => {
  await page.evaluate(() => { location.hash = "#/home"; });
  await page.waitForTimeout(150);
  await page.evaluate(() => { location.hash = "#/recite"; });
  await page.waitForSelector('.list-detail-list .list-detail-row[data-recite-id="' + CREED + '"]');
  await page.locator('.list-detail-list .list-detail-row[data-recite-id="' + CREED + '"]').click();
  await page.waitForSelector('[aria-label="Study mode"] .search-chip');
};
const modeChips = () => page.evaluate(() => Array.from(document.querySelectorAll('[aria-label="Study mode"] .search-chip')).map((b) => ({ text: b.textContent, pressed: b.getAttribute("aria-pressed") })));
const ladderRows = () => page.evaluate(async () => (await window.G.db.all("kv")).filter((r) => String(r.k).indexOf("recall-ladder:") === 0).map((r) => ({ k: r.k, v: r.v })));
const srsRow = () => page.evaluate(async (id) => { const r = await window.G.db.get("kv", "srs:" + id); return r ? r.v : null; }, CREED);
const live = () => page.evaluate(() => (document.getElementById("a11y-live") || {}).textContent || "");
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const snap = () => page.evaluate(() => {
  const steps = Array.from(document.querySelectorAll("[data-ladder-step]"));
  const a = document.activeElement;
  return {
    steps: steps.map((b) => b.textContent),
    pressed: steps.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.ladderStep),
    allHavePressed: steps.every((b) => /^(true|false)$/.test(b.getAttribute("aria-pressed") || "")),
    prompt: (document.querySelector("[data-ladder-prompt]") || {}).textContent || "",
    help: (document.querySelector("[data-ladder-help]") || {}).textContent || "",
    status: (document.querySelector("[data-ladder-status]") || {}).textContent || "",
    focus: a ? (a.dataset.ladderReport || a.dataset.ladderStep || (a.dataset.ladderReveal ? "reveal" : "") || a.tagName) : "",
    gradeRow: !!document.querySelector("[data-ladder-mastered] .qz-grade-row"),
  };
});
const report = async (which) => {
  const before = await live();
  await page.locator('[data-ladder-report="' + which + '"]').click();
  // The redraw waits for the save; the announcement follows the redraw.
  await page.waitForFunction((b) => { const t = (document.getElementById("a11y-live") || {}).textContent || ""; return t && t !== b; }, before, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(80);
};

// ---- What's New promises only what is on the screen -----------------------
await openCreed();
const claim = await page.evaluate(() => {
  const note = (window.G.whatsNew.RELEASE_NOTES || []).find((n) => n.version === "1.11.0");
  return note ? [note.title].concat(note.highlights).join(" ") : "";
});
const screenText = await page.evaluate(() => document.getElementById("route").innerText);
const named = ["Recall ladder", "My unit"].filter((name) => claim.includes(name));
named.length === 2 && named.every((name) => screenText.toLowerCase().includes(name.toLowerCase()))
  ? ok("everything the 1.11.0 What's New names for Recitation Drill (\"Recall ladder\", \"My unit\") is really on the #/recite screen")
  : bad("What's New and the screen disagree - named in the note: " + JSON.stringify(named) + "; on screen: " + ["Recall ladder", "My unit"].filter((n) => screenText.includes(n)).join(", "));
!/adaptive|starts off disabled|\bSRS\b|\bmodule\b|spirit of the cav/i.test(claim)
  ? ok("the note no longer promises an \"Adaptive\" ladder that \"starts off disabled\", or a bundled unit song, and uses no jargon for these features")
  : bad("the 1.11.0 note still carries the old claim or jargon: " + claim);

// ---- optional: nothing changes until the Soldier picks it -----------------
let chips = await modeChips();
JSON.stringify(chips.map((c) => c.text)) === JSON.stringify(["Full text", "First letters", "Chunk & memorize", "Timed recitation", "Recall ladder"])
  ? ok("\"Recall ladder\" is offered as the fifth study mode, after the four that were always there")
  : bad("study modes: " + JSON.stringify(chips));
chips.filter((c) => c.pressed === "true").map((c) => c.text).join() === "Full text"
  ? ok("a text still opens on Full text - the ladder is never the default")
  : bad("default mode: " + JSON.stringify(chips));

await page.locator('[aria-label="Study mode"] .search-chip', { hasText: "Recall ladder" }).click();
await page.waitForSelector("[data-ladder-step]");
chips = await modeChips();
chips.filter((c) => c.pressed === "true").map((c) => c.text).join() === "Recall ladder"
  ? ok("tapping the mode chip switches to it (aria-pressed follows)")
  : bad("mode chip state: " + JSON.stringify(chips));
(await ladderRows()).length === 0 && (await srsRow()) === null
  ? ok("just opening the mode saves nothing - no ladder row, no review record")
  : bad("opening the mode wrote data: " + JSON.stringify(await ladderRows()));

let s = await snap();
s.steps.length === 5 && s.allHavePressed && s.pressed.join() === "full"
  ? ok("five step chips, each with aria-pressed, starting on step 1: " + s.steps.join(" | "))
  : bad("step chips: " + JSON.stringify(s));
const creedText = await page.evaluate((id) => window.G.store.recitable().find((q) => q.id === id).lines.join("\n"), CREED);
s.prompt === creedText && s.help ? ok("step 1 shows the whole text and says what to do") : bad("step 1 prompt/help wrong: " + JSON.stringify({ help: s.help, promptLength: s.prompt.length }));
(await overflow()) <= 0 ? ok("no sideways scrolling on step 1 (390px)") : bad("step 1 is " + (await overflow()) + "px too wide");

// ---- two clean tries up, one miss down ------------------------------------
await report("got");
s = await snap();
s.pressed.join() === "full" && /One clean try/.test(s.status) && s.focus === "got"
  ? ok("one \"Got it\" stays on the step, says one more moves you up, and keeps focus on \"Got it\"")
  : bad("after one Got it: " + JSON.stringify(s));
/Clean try/.test(await live()) ? ok("...and it is announced: \"" + (await live()).trim() + "\"") : bad("first clean try not announced: " + JSON.stringify(await live()));

await report("got");
s = await snap();
s.pressed.join() === "easy" && s.focus === "got"
  ? ok("a second \"Got it\" moves up to step 2, focus still on \"Got it\"")
  : bad("after two Got it: " + JSON.stringify({ pressed: s.pressed, focus: s.focus }));
/Moved up to step 2, A few words hidden/.test(await live()) ? ok("the move is announced: \"" + (await live()).trim() + "\"") : bad("move up not announced: " + JSON.stringify(await live()));
const total = (creedText.match(/\b[A-Za-z][A-Za-z']*\b/g) || []).length;
const blanks = (t) => (t.match(/______/g) || []).length;
const easyRatio = blanks(s.prompt) / total;
easyRatio > 0.15 && easyRatio < 0.25 ? ok("step 2 blanks about one word in five (" + Math.round(easyRatio * 100) + "%)") : bad("step 2 hides " + Math.round(easyRatio * 100) + "% of the words");
let rows = await ladderRows();
rows.length === 1 && rows[0].k === "recall-ladder:" + CREED && rows[0].v.level === "easy" && rows[0].v.streak === 0
  ? ok("the place on the ladder is saved as one small row: " + JSON.stringify(rows[0].v))
  : bad("saved ladder row: " + JSON.stringify(rows));

await report("miss");
s = await snap();
s.pressed.join() === "full" && s.focus === "miss"
  ? ok("one \"Missed it\" moves down a step, focus on \"Missed it\"")
  : bad("after Missed it: " + JSON.stringify({ pressed: s.pressed, focus: s.focus }));
/Moved down to step 1/.test(await live()) ? ok("the move down is announced") : bad("move down not announced: " + JSON.stringify(await live()));

// ---- pick any step by hand -------------------------------------------------
await page.locator('[data-ladder-step="medium"]').click();
await page.waitForFunction(() => (document.querySelector('[data-ladder-step="medium"]') || { getAttribute() {} }).getAttribute("aria-pressed") === "true");
await page.waitForTimeout(80);
s = await snap();
const mediumRatio = blanks(s.prompt) / total;
s.focus === "medium" && mediumRatio > 0.45 && mediumRatio < 0.55 && /Step 3, Half hidden/.test(await live())
  ? ok("picking step 3 by hand works: about half the words blanked (" + Math.round(mediumRatio * 100) + "%), focus on the chip, announced")
  : bad("manual step 3: " + JSON.stringify({ focus: s.focus, ratio: mediumRatio, live: await live() }));
(await overflow()) <= 0 ? ok("no sideways scrolling with half the words blanked") : bad("step 3 is " + (await overflow()) + "px too wide");

await page.locator('[data-ladder-step="initials"]').click();
await page.waitForFunction(() => (document.querySelector('[data-ladder-step="initials"]') || { getAttribute() {} }).getAttribute("aria-pressed") === "true");
s = await snap();
s.prompt && s.prompt.length < creedText.length / 2 && (await overflow()) <= 0
  ? ok("step 4 leaves only first letters, and still fits the screen")
  : bad("step 4: " + JSON.stringify({ promptLength: s.prompt.length, overflow: await overflow() }));

// ---- from memory: nothing on screen until asked ----------------------------
await page.locator('[data-ladder-step="unaided"]').click();
await page.waitForFunction(() => (document.querySelector('[data-ladder-step="unaided"]') || { getAttribute() {} }).getAttribute("aria-pressed") === "true");
const hiddenCheck = await page.evaluate((firstLine) => {
  const body = document.querySelector("[data-ladder-step]").closest("div").parentElement;
  return { promptShown: !!document.querySelector("[data-ladder-prompt]"), textVisible: body.innerText.includes(firstLine),
    reveal: (document.querySelector("[data-ladder-reveal]") || { getAttribute() {} }).getAttribute("aria-expanded") };
}, creedText.split("\n")[0]);
!hiddenCheck.promptShown && !hiddenCheck.textVisible && hiddenCheck.reveal === "false"
  ? ok("\"From memory\" shows none of the text, with a closed \"Show the text to check yourself\" control")
  : bad("From memory leaks the text: " + JSON.stringify(hiddenCheck));
await page.locator("[data-ladder-reveal]").click();
await page.waitForSelector("[data-ladder-answer]");
s = await snap();
const revealState = await page.evaluate(() => ({ expanded: document.querySelector("[data-ladder-reveal]").getAttribute("aria-expanded"), answer: document.querySelector("[data-ladder-answer]").textContent }));
revealState.expanded === "true" && revealState.answer === creedText && s.focus === "reveal"
  ? ok("asking to check shows the text, flips aria-expanded, and keeps focus on that control")
  : bad("reveal: " + JSON.stringify({ expanded: revealState.expanded, focus: s.focus }));

// ---- the top of the ladder hands over to the ordinary grade row ------------
await report("got");
(await snap()).gradeRow ? bad("the grade row appeared after only one clean try from memory") : ok("one clean try from memory is not enough for the grade row");
await report("got");
s = await snap();
s.gradeRow && /twice in a row/.test(s.status) && s.focus === "got"
  ? ok("two clean tries from memory bring up the same \"How well do you know it?\" grade row Chunk & memorize uses")
  : bad("top of the ladder: " + JSON.stringify(s));
(await srsRow()) === null
  ? ok("the ladder itself wrote NO review record - there is no second scheduler")
  : bad("the ladder wrote a review record on its own: " + JSON.stringify(await srsRow()));
await page.locator("[data-ladder-mastered] .qz-grade-btn", { hasText: "Down Cold" }).click();
await page.waitForFunction(async (id) => !!(await window.G.db.get("kv", "srs:" + id)), CREED, { timeout: 5000 }).catch(() => {});
const graded = await srsRow();
graded && graded.lastGrade === 3
  ? ok("tapping a grade there writes the card's ordinary review record (lastGrade 3), through the same path as every other grade")
  : bad("grade row did not write the review record: " + JSON.stringify(graded));

// ---- the place is remembered ------------------------------------------------
await page.locator('[aria-label="Study mode"] .search-chip', { hasText: "Full text" }).click();
await page.waitForTimeout(200);
(await page.evaluate(() => document.querySelectorAll("[data-ladder-step]").length)) === 0
  ? ok("switching to another mode takes the ladder off the screen")
  : bad("ladder controls are still on screen in Full text mode");
// Leave and come straight back while a save is still landing: only the
// newest visit may draw, and it must show the saved step.
await page.locator('[aria-label="Study mode"] .search-chip', { hasText: "Recall ladder" }).click();
await page.waitForSelector("[data-ladder-step]");
await page.locator('[data-ladder-step="easy"]').click();
await page.locator('[aria-label="Study mode"] .search-chip', { hasText: "Full text" }).click();
await page.locator('[aria-label="Study mode"] .search-chip', { hasText: "Recall ladder" }).click();
await page.waitForTimeout(500);
s = await snap();
s.steps.length === 5 && s.pressed.join() === "easy"
  ? ok("leaving and coming straight back mid-save shows one ladder, on the step that was saved")
  : bad("quick leave-and-return: " + JSON.stringify({ steps: s.steps.length, pressed: s.pressed }));

await page.reload({ waitUntil: "load" });
await dismissOnboarding(page);
await openCreed();
await page.locator('[aria-label="Study mode"] .search-chip', { hasText: "Recall ladder" }).click();
await page.waitForSelector("[data-ladder-step]");
(await snap()).pressed.join() === "easy" ? ok("the saved step is still there after the app is closed and reopened") : bad("step after reload: " + JSON.stringify((await snap()).pressed));

// ---- a damaged saved row must not freeze the ladder -------------------------
await page.evaluate(async (id) => { await window.G.db.put("kv", { k: "recall-ladder:" + id, v: { level: "not-a-step", streak: "abc" } }); }, CREED);
await openCreed();
await page.locator('[aria-label="Study mode"] .search-chip', { hasText: "Recall ladder" }).click();
await page.waitForSelector("[data-ladder-step]");
s = await snap();
s.pressed.join() === "full" ? ok("a damaged saved row opens on step 1 instead of breaking the screen") : bad("damaged row opened on: " + JSON.stringify(s.pressed));
await report("got");
await report("got");
(await snap()).pressed.join() === "easy"
  ? ok("...and two clean tries still move up from it (a bad saved count used to become NaN and never reach two)")
  : bad("the ladder is frozen after a damaged row: " + JSON.stringify((await snap()).pressed));

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors or warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();
console.log(fails ? `\n${fails} FAILURE(S)` : "\nOPTIONAL RECALL LADDER: all passed");
process.exit(fails ? 1 : 0);
