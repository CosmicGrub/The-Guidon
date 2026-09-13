/**
 * #/search's list-detail split (Fold5/tablet fidelity, added alongside the
 * Board/Doctrine/Squad Roster split): the jump-index pane, the >=1024px
 * breakpoint, and Escape's must-clear-both-panes behavior.
 *
 * Written after a mutation-testing pass found three real, silent gaps:
 *   - no test asserted the 1024px .list-detail breakpoint at all (neither
 *     test-responsive.mjs nor test-contrast-full.mjs reference .list-detail
 *     or 1024px anywhere) - a mutation that silently widened it to 1224px
 *     built clean and passed every existing suite.
 *   - test-search-views.mjs predates the list-detail split entirely (zero
 *     references to entryList/data-search-idx/list-detail-jumped) - a
 *     mutation that stopped hitIdx from incrementing (every jump row and
 *     card sharing data-search-idx="0", so ANY jump row always lands on the
 *     FIRST card) built clean and passed every existing suite. A naive
 *     "row count == card count" check would NOT have caught this - the
 *     counts still match, only the mapping between them breaks. This test
 *     clicks a non-first row and asserts the correct, non-first card is the
 *     one that gets focused.
 *   - the same file never asserted Escape clears the jump-index pane
 *     alongside the results pane - a mutation that dropped that one
 *     util.clear(entryList) call (reintroducing the exact staleness bug
 *     this feature's own code review caught before it shipped) also built
 *     clean and passed every existing suite.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();

async function boot(viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const noise = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
  await page.goto(url, { waitUntil: "load" });
  await dismissOnboarding(page);
  await page.evaluate(() => { location.hash = "#/search"; });
  await page.waitForTimeout(500);
  return { page, noise };
}

/* ---- breakpoint: the exact 1023px/1024px boundary, not just "some wide viewport" ---- */
for (const [width, expect] of [[1023, "block"], [1024, "grid"]]) {
  const { page } = await boot({ width, height: 900 });
  const display = await page.evaluate(() => {
    const ld = document.querySelector(".list-detail");
    return ld ? getComputedStyle(ld).display : null;
  });
  display === expect
    ? ok(`${width}px: .list-detail display is "${expect}" as documented`)
    : bad(`${width}px: expected display "${expect}", got "${display}"`);
  await page.close();
}

/* ---- jump-index correctness + Escape, at a real split-layout width ---- */
const { page, noise } = await boot({ width: 1280, height: 900 });

await page.evaluate(() => {
  const inp = document.querySelector('input[type="search"]');
  inp.focus();
  inp.value = "leader";
  inp.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(600);

const rendered = await page.evaluate(() => ({
  entryRows: document.querySelectorAll(".list-detail-list .list-detail-row").length,
  cards: document.querySelectorAll(".search-hit").length,
}));
rendered.cards > 3
  ? ok(`query "leader" rendered ${rendered.cards} result cards (need >3 for a meaningful non-first-row check)`)
  : bad(`only ${rendered.cards} result cards rendered - not enough to test jump-index mapping`);
rendered.entryRows === rendered.cards
  ? ok(`jump-index rows (${rendered.entryRows}) match result cards 1:1 in count`)
  : bad(`jump-index rows (${rendered.entryRows}) != result cards (${rendered.cards})`);

// The mutation-catching check: click the THIRD row (deliberately not the
// first, since an unincremented hitIdx bug always lands on card 0 - a
// first-row click can't distinguish "correct" from "broken and lucky").
if (rendered.cards > 3) {
  const jump = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".list-detail-list .list-detail-row")];
    const row = rows[2];
    const rowLabel = row.querySelector(".ldr-name")?.textContent || "";
    row.click();
    return { rowLabel };
  });
  await page.waitForTimeout(200);
  const landed = await page.evaluate(() => {
    const pulsed = document.querySelector(".list-detail-jumped");
    return pulsed ? pulsed.querySelector(".search-hit-title")?.textContent || "" : null;
  });
  // The row's own label is truncated to 60 chars in the DOM; compare on a
  // shared prefix so a long real title still matches its truncated row.
  const matches = landed !== null && (landed.startsWith(jump.rowLabel.replace(/…$/, "")) || jump.rowLabel.startsWith(landed));
  matches
    ? ok(`clicking the 3rd jump row (not the 1st) correctly landed on its own matching card ("${landed}")`)
    : bad(`clicking the 3rd jump row ("${jump.rowLabel}") landed on a mismatched card ("${landed}") - jump-index mapping is broken`);
}

/* ---- aria-state-attributes-gaps (Round 11): entryList rows carry aria-selected ----
 * These role="option" rows (inside role="listbox", aria-label="Jump to
 * result") never set aria-selected, an ARIA-required state for that role -
 * unlike Board Drill's catList, which does. Like Doctrine/Resources' own
 * entryLists, this is a jump index (click scrolls to and pulses the
 * matching .search-hit card; there is no persistent "selected" result), so
 * the correct value is a static "false" on every row, both before and
 * after a click - checked here with real, currently-rendered "leader" rows
 * rather than an empty list.
 */
{
  const before = await page.evaluate(() => {
    const list = document.querySelector('.list-detail-list[aria-label="Jump to result"]');
    const rows = list ? [...list.querySelectorAll('[role="option"]')] : [];
    return { listboxRole: list ? list.getAttribute("role") : null, count: rows.length, allFalse: rows.every((r) => r.getAttribute("aria-selected") === "false") };
  });
  before.listboxRole === "listbox"
    ? ok('jump-index container carries role="listbox" as documented')
    : bad('jump-index container missing role="listbox": ' + before.listboxRole);
  before.count > 0 && before.allFalse
    ? ok(`all ${before.count} jump-index role="option" rows carry aria-selected="false"`)
    : bad(`jump-index role="option" rows missing aria-selected: ${JSON.stringify(before)}`);

  await page.evaluate(() => { document.querySelector('.list-detail-list[aria-label="Jump to result"] [role="option"]')?.click(); });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.list-detail-list[aria-label="Jump to result"] [role="option"]')];
    return rows.every((r) => r.getAttribute("aria-selected") === "false");
  });
  after
    ? ok("aria-selected stays a valid \"false\" on every row after clicking one (this is a jump index, not a true selection list)")
    : bad("a row's aria-selected changed to something other than \"false\" after a click");
}

/* ---- Escape clears BOTH panes, not just the results pane ---- */
await page.evaluate(() => {
  const inp = document.querySelector('input[type="search"]');
  inp.focus();
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});
await page.waitForTimeout(200);
const afterEscape = await page.evaluate(() => ({
  entryRows: document.querySelectorAll(".list-detail-list .list-detail-row").length,
  cards: document.querySelectorAll(".search-hit").length,
  inputValue: document.querySelector('input[type="search"]').value,
}));
(afterEscape.entryRows === 0 && afterEscape.cards === 0 && afterEscape.inputValue === "")
  ? ok("Escape clears both the jump-index pane and the results pane (and the input)")
  : bad(`Escape left entryRows=${afterEscape.entryRows} cards=${afterEscape.cards} inputValue="${afterEscape.inputValue}"`);

noise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + noise.join(" | "));
await page.close();

console.log(fails === 0 ? "\nSEARCH LIST-DETAIL: all passed" : `\nSEARCH LIST-DETAIL: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
