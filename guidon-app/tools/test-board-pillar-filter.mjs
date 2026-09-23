/**
 * The `pillar` taxonomy (ROADMAP.md §3f) made usable - Phase 1's
 * "Board Readiness Score rollup ... category mastery + scenario attempts":
 *
 *  1. Board Drill gets a THIRD quick-filter row, the coarsest axis: one of
 *     the six SGT-board pillars, in canonical order (G.board.PILLARS, which
 *     lint-board-taxonomy rule (h) keeps identical to tools/pillar-map.mjs),
 *     PLUS a trailing "Other topics" chip for the cards the taxonomy pass
 *     deliberately left untagged (weapons, land nav, TCCC, CBRN...) - placed
 *     above the category row. A real filter composed with category and
 *     regulation; built once and toggled in place so keyboard focus
 *     survives activation; the empty state names it. Board section
 *     reorganization (2026-09-23): picking a pillar also narrows the
 *     category row's own chip SET to that pillar's categories (or, un-set,
 *     the original capped top-12), and category narrows regulation's -
 *     see quickFilterRow/categoryItemsForScope/regItemsForScope in
 *     src/index.html for the mechanism.
 *  2. The Readiness tab gets a "Readiness by pillar" rollup: per pillar,
 *     card mastery (the same isMasteredSrs predicate the Board Readiness
 *     Score uses) beside scenarios completed (store.getProgress()'s
 *     best-attempt ids) - a separate panel, deliberately NOT blended into
 *     the existing score - with "Study <pillar>" buttons that land on Board
 *     Drill with that pillar chip active (one-shot G.board._filterPillar).
 *     The label used to be "Drill " + pillar, which read "Drill Drill & Board
 *     Etiquette" for the sixth pillar; no label may stutter, and each
 *     button's accessible name says which pillar's cards it opens. The
 *     "Needs Work" buttons one panel up had the same fault ("Drill Drill and
 *     Ceremony (TC 3-21.5)") and are held to the same rule (section 6).
 *  3. At phone width all three quick-filter rows become single, horizontally
 *     scrollable rows (.qf-row) instead of a 12-row wall above the card -
 *     GENUINELY scrollable (a real wheel gesture reaches the last chip; a
 *     row that merely clipped its chips used to pass), with the keyboard
 *     focus ring never cut off by the scroller (it used to lose its whole
 *     top edge, and its left edge on the first chip), and with the chip a
 *     Readiness button made active actually on screen. The scroll/ring
 *     checks live in ./chip-row-assertions.mjs so the next chip row can
 *     reuse them.
 *
 * Every expected number here is computed live from the seed and the SRS
 * store in the page, never hard-coded.
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";
import { checkRowScrollsToEnd, checkFocusRingNeverClipped, checkRingPaints, chipInsideRow } from "./chip-row-assertions.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };
const report = (results) => results.forEach((r) => (r.ok ? ok : bad)(r.msg));

const CANON = ["Doctrinal Thinking", "Programs & Support", "Leadership & Counseling", "Maintenance & Supply", "Training Management", "Drill & Board Etiquette"];

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(900);

const BAR = (label) => `.search-filters[aria-label="Quick-filter by ${label}"]`;
const readBar = (label) => page.evaluate((sel) => {
  const bar = document.querySelector(sel);
  const chips = bar ? [...bar.querySelectorAll(".search-chip")] : [];
  return { present: !!bar, chips: chips.map((c) => ({ text: c.textContent, active: c.classList.contains("active"), pressed: c.getAttribute("aria-pressed") })) };
}, BAR(label));
const clickChip = (label, i) => page.evaluate(([sel, i]) => { document.querySelector(sel).querySelectorAll(".search-chip")[i].click(); }, [BAR(label), i]);
// catSel (a real <select>) was removed in the board-filter consolidation -
// catList's own full, unscoped "Jump to category" rail (kept specifically
// so every category stays reachable regardless of which pillar chip is
// active) is the equivalent full-catalog control now. .click() on the row
// fires it directly, same as a real pointer click would.
const setCategoryViaList = (cat) => page.evaluate((c) => {
  const rows = [...document.querySelectorAll('.list-detail-list[aria-label="Jump to category"] .list-detail-row')];
  const row = rows.find((r) => (r.querySelector(".ldr-name") || {}).textContent === c);
  if (row) row.click();
}, cat);
const tallyText = () => page.evaluate(() => { const s = Array.from(document.querySelectorAll(".stat")).find((x) => /This session/.test(x.textContent)); return s ? (s.querySelector(".v") || {}).textContent : null; });
const emptyText = () => page.evaluate(() => { const e = document.querySelector(".qz-wrap .empty"); return e ? e.textContent : null; });
const promptText = () => page.evaluate(() => { const p = document.querySelector(".qz-front .qz-prompt"); return p ? p.textContent.trim() : null; });
const deckSize = async () => { const t = await tallyText(); const m = t && t.match(/Card \d+\/(\d+)/); return m ? Number(m[1]) : null; };

/* ---- 1. the constant ---- */
const appPillars = await page.evaluate(() => G.board.PILLARS);
JSON.stringify(appPillars) === JSON.stringify(CANON) ? ok("G.board.PILLARS is the six canonical pillars in canonical order") : bad("G.board.PILLARS = " + JSON.stringify(appPillars));

/* ---- 2. the pillar chip row ---- */
const OTHER_LABEL = "Other topics";
const live = await page.evaluate(() => {
  const all = G.store.boardQuestions();
  const counts = {};
  let otherCount = 0;
  all.forEach((q) => { if (q.pillar) counts[q.pillar] = (counts[q.pillar] || 0) + 1; else otherCount++; });
  const pillarBar = document.querySelector('.search-filters[aria-label="Quick-filter by pillar"]');
  const catBar = document.querySelector('.search-filters[aria-label="Quick-filter by category"]');
  const regBar = document.querySelector('.search-filters[aria-label="Quick-filter by regulation"]');
  const regWrap = catBar && catBar.nextElementSibling;
  return {
    counts, otherCount, total: all.length,
    order: !!(pillarBar && catBar && regBar && pillarBar.nextElementSibling === catBar
      && regWrap && regWrap.tagName === "DETAILS" && regWrap.classList.contains("qf-disclosure") && regWrap.contains(regBar)),
    qf: [pillarBar, catBar, regBar].every((b) => b && b.classList.contains("qf-row")),
  };
});
let bar = await readBar("pillar");
bar.present ? ok("the pillar chip row renders") : bad("pillar chip row not found");
live.order ? ok("row order is pillar → category → regulation (regulation collapsed inside a .qf-disclosure, next sibling of category)") : bad("chip rows are not in pillar/category/regulation order");
live.qf ? ok("all three quick-filter rows carry the .qf-row phone-width class") : bad("a quick-filter row lacks .qf-row");
(bar.chips[0] && bar.chips[0].text === "All pillars" && bar.chips[0].active) ? ok('"All pillars" is the first chip and starts active') : bad("first pillar chip: " + JSON.stringify(bar.chips[0]));
// The trailing "Other topics" chip (untagged-by-design content) is not part
// of the six-pillar canon - split it off before checking canonical order.
const rest = bar.chips.slice(1);
const otherChip = live.otherCount ? rest[rest.length - 1] : null;
const canonChips = live.otherCount ? rest.slice(0, -1) : rest;
const chipNames = canonChips.map((c) => c.text.replace(/\s*\(\d+\)$/, ""));
JSON.stringify(chipNames) === JSON.stringify(CANON.filter((p) => live.counts[p])) ? ok(`pillar chips are in canonical order: ${chipNames.join(" · ")}`) : bad("pillar chip order: " + JSON.stringify(chipNames));
const countsOk = canonChips.every((c) => { const name = c.text.replace(/\s*\(\d+\)$/, ""); const n = Number((c.text.match(/\((\d+)\)$/) || [])[1]); return n === live.counts[name]; });
countsOk ? ok("every pillar chip's count equals the live number of cards tagged with that pillar (" + Object.values(live.counts).reduce((a, b) => a + b, 0) + " of " + live.total + " tagged)") : bad("pillar chip counts disagree with the seed: " + JSON.stringify(canonChips));
(live.otherCount ? (otherChip && otherChip.text === `${OTHER_LABEL} (${live.otherCount})`) : otherChip === null)
  ? ok(live.otherCount ? `trailing "${otherChip.text}" chip covers the ${live.otherCount} untagged-by-design cards` : "every card is pillar-tagged - no \"Other topics\" chip, correctly")
  : bad("Other topics chip: " + JSON.stringify(otherChip) + " vs live untagged count " + live.otherCount);

/* ---- 3. a real filter ---- */
const target = "Programs & Support";
const targetIdx = 1 + chipNames.indexOf(target);
await clickChip("pillar", targetIdx);
await page.waitForTimeout(450);
bar = await readBar("pillar");
const activeNow = bar.chips.filter((c) => c.active).map((c) => c.text.replace(/\s*\(\d+\)$/, ""));
JSON.stringify(activeNow) === JSON.stringify([target]) ? ok(`clicking "${target}" makes exactly that chip active`) : bad("active pillar chips: " + JSON.stringify(activeNow));
const size = await deckSize();
size === live.counts[target] ? ok(`the deck is exactly the ${size} "${target}" cards (tally "Card 1/${size}")`) : bad(`deck size ${size} vs live count ${live.counts[target]} (tally ${JSON.stringify(await tallyText())})`);
const walked = [];
for (let i = 0; i < 6; i++) {
  walked.push(await promptText());
  await page.evaluate(() => { const w = document.querySelector(".qz-wrap"); w.focus(); w.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  await page.waitForTimeout(120);
}
const allInPillar = await page.evaluate(([prompts, p]) => prompts.every((t) => G.store.boardQuestions().some((q) => q.q === t && q.pillar === p)), [walked, target]);
allInPillar ? ok(`6 consecutive cards in the filtered deck are all "${target}" cards`) : bad("filtered deck contained a card outside the pillar: " + JSON.stringify(walked));

// Composed with category: a category mapped to a DIFFERENT pillar empties the deck, and the message names both.
const otherCat = await page.evaluate((p) => {
  const byCat = {};
  G.store.boardQuestions().forEach((q) => { (byCat[q.category] = byCat[q.category] || []).push(q); });
  return Object.keys(byCat).find((c) => byCat[c].length >= 5 && byCat[c].every((q) => q.pillar && q.pillar !== p)) || null;
}, target);
if (otherCat) {
  // otherCat, by construction above, belongs entirely to a DIFFERENT pillar
  // than `target` - so it no longer appears as a chip in the now pillar-
  // scoped category row at all (the point of the scoping). catList's own
  // full, unscoped "Jump to category" rail is the surviving way to reach
  // it directly, same as catSel used to be.
  await setCategoryViaList(otherCat);
  await page.waitForTimeout(450);
  const empty = await emptyText();
  (empty && empty.includes("pillar “" + target + "”") && empty.includes("category “" + otherCat + "”"))
    ? ok(`pillar "${target}" + category "${otherCat}" → explanatory empty state naming both`)
    : bad("empty state for pillar+category: " + JSON.stringify(empty));
  await setCategoryViaList("All");
  await page.waitForTimeout(450);
} else bad("no category (>=5 cards) fully outside " + target);

// Composed with regulation: pillar ∩ regulation equals the live intersection
// - on a pillar/regulation pair that actually overlaps (Leadership &
// Counseling ∩ the bank's most-cited publication, ADP 6-22), so this proves
// a non-empty intersection, not just the empty state.
const lcIdx = 1 + chipNames.indexOf("Leadership & Counseling");
await clickChip("pillar", lcIdx);
await page.waitForTimeout(450);
const regBar = await readBar("regulation");
const regName = regBar.chips[1].text.replace(/\s*\(\d+\)$/, "");
await clickChip("regulation", 1);
await page.waitForTimeout(450);
const inter = await page.evaluate(([p, r]) => G.store.boardQuestions().filter((q) => q.pillar === p && G.board.regulationsOf(q.source).includes(r)).length, ["Leadership & Counseling", regName]);
const interSize = await deckSize();
(inter > 0 && interSize === inter)
  ? ok(`pillar "Leadership & Counseling" ∩ regulation "${regName}" = ${inter} cards, and the deck is exactly that`)
  : bad(`pillar∩regulation: expected ${inter} (>0), deck ${interSize}, empty=${JSON.stringify(await emptyText())}`);
await clickChip("regulation", 0);
await page.waitForTimeout(450);

// Keyboard activation keeps focus on the chip and announces - on a chip
// that is NOT the active one (Enter on the active chip is a no-op by design).
await page.evaluate((sel) => { const chips = document.querySelector(sel).querySelectorAll(".search-chip"); const idle = [...chips].find((c, i) => i > 0 && !c.classList.contains("active")); idle.focus(); }, BAR("pillar"));
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
const focus = await page.evaluate((sel) => { const a = document.activeElement; const b = document.querySelector(sel); return { tag: a && a.tagName, inBar: !!(a && b && b.contains(a)), pressed: a && a.getAttribute("aria-pressed"), live: (document.getElementById("a11y-live") || {}).textContent || "" }; }, BAR("pillar"));
(focus.tag === "BUTTON" && focus.inBar && focus.pressed === "true") ? ok("Enter on a pillar chip keeps focus on that chip (aria-pressed=true)") : bad("focus after Enter on a pillar chip: " + JSON.stringify(focus));
/Showing .* cards\./.test(focus.live) ? ok(`...and the live region announced it: "${focus.live.trim()}"`) : bad("live region: " + JSON.stringify(focus.live));

// "All pillars" restores the full deck.
await clickChip("pillar", 0);
await page.waitForTimeout(450);
const restored = await deckSize();
restored === live.total ? ok(`"All pillars" restores the full ${restored}-card deck`) : bad(`after All pillars: deck ${restored} vs ${live.total}`);

/* ---- 4. Readiness by pillar ---- */
// Grade four cards INSIDE one pillar, so the rollup has a number this test
// can predict. The first version graded four cards from the full deck and
// asserted "some row is above 0%": with 1,274 cards that was luck - four
// masteries in a 231-card pillar round to 0%, and an untagged card counts
// toward no pillar at all. Filtering to the smallest pillar first makes the
// expected outcome exact: that row's mastered count is 4.
const gradePillar = "Maintenance & Supply";
await clickChip("pillar", 1 + chipNames.indexOf(gradePillar));
await page.waitForTimeout(450);
for (let i = 0; i < 4; i++) { await page.evaluate(() => { document.querySelectorAll(".qz-grade-row .qz-grade-btn")[2].click(); }); await page.waitForTimeout(150); }
await page.evaluate(() => { G.board._openReadiness && G.board._openReadiness(); });
await page.waitForTimeout(900);
const rollup = await page.evaluate(async () => {
  const panel = document.querySelector(".readiness-pillars");
  if (!panel) return null;
  const rows = [...panel.querySelectorAll(".readiness-pillar-row")].map((r) => ({ p: r.getAttribute("data-pillar"), k: r.querySelector(".stat .k").textContent, v: r.querySelector(".stat .v").textContent, hasDrill: !!r.querySelector("button"), btnText: (r.querySelector("button") || {}).textContent || "", btnName: r.querySelector("button") ? (r.querySelector("button").getAttribute("aria-label") || r.querySelector("button").textContent) : "" }));
  const all = G.store.boardQuestions();
  const srs = await G.board.loadAllSrs(all.map((q) => q.id));
  const prog = await G.store.getProgress();
  const done = new Set(prog.completedIds || []);
  const scs = G.store.scenarios();
  const expected = G.board.PILLARS.map((p) => {
    const cards = all.filter((q) => q.pillar === p);
    const mastered = cards.filter((q) => G.board.isMasteredSrs(srs[q.id])).length;
    const pct = cards.length ? Math.round((mastered / cards.length) * 100) : 0;
    const sc = scs.filter((s) => s.pillar === p);
    return { p, v: (cards.length ? pct + "%  (" + mastered + "/" + cards.length + " cards)" : "no cards") + (sc.length ? "  ·  " + sc.filter((s) => done.has(s.id)).length + "/" + sc.length + " scenarios" : "") };
  }).filter((r) => !/^no cards$/.test(r.v));
  return { rows, expected, anyMastered: rows.some((r) => !/^0%/.test(r.v)) };
});
rollup ? ok(`"Readiness by pillar" panel renders with ${rollup.rows.length} rows`) : bad("no .readiness-pillars panel on the Readiness tab");
if (rollup) {
  const same = rollup.rows.length === rollup.expected.length && rollup.rows.every((r, i) => r.p === rollup.expected[i].p && r.v === rollup.expected[i].v);
  same ? ok("every row's numbers equal the live computation (isMasteredSrs over the SRS store + getProgress().completedIds over scenarios)") : bad("rollup rows vs expected: " + JSON.stringify(rollup.rows) + " vs " + JSON.stringify(rollup.expected));
  const msRow = rollup.rows.find((r) => r.p === gradePillar);
  const msMastered = msRow ? Number((msRow.v.match(/\((\d+)\/\d+ cards\)/) || [])[1]) : NaN;
  msMastered === 4 ? ok(`the four "${gradePillar}" cards just graded Know It show up as exactly 4 mastered in that pillar's row ("${msRow.v}")`) : bad(`"${gradePillar}" row after grading four of its cards: ` + JSON.stringify(msRow));
  rollup.rows.every((r) => r.hasDrill) ? ok("every pillar row has a button that opens its cards") : bad("a pillar row lacks its button");
  // The label was "Drill " + pillar: fine for five pillars, "Drill Drill &
  // Board Etiquette" for the sixth. Wording-agnostic on purpose - whatever
  // the verb is, no label may say a word twice in a row, the visible text
  // must name the pillar, and the accessible name must contain the visible
  // text (WCAG 2.5.3 Label in Name), say it opens cards, and be unique.
  const STUTTER = /\b(\w+)\s+\1\b/i;
  const stutters = rollup.rows.filter((r) => STUTTER.test(r.btnText) || STUTTER.test(r.btnName));
  stutters.length === 0 ? ok(`no rollup button repeats a word back to back (${rollup.rows.map((r) => '"' + r.btnText + '"').join(", ")})`) : bad("rollup button label stutters: " + JSON.stringify(stutters.map((r) => [r.btnText, r.btnName])));
  const named = rollup.rows.every((r) => r.btnText.includes(r.p) && r.btnName.includes(r.btnText) && /cards/i.test(r.btnName));
  const uniqueNames = new Set(rollup.rows.map((r) => r.btnName)).size === rollup.rows.length;
  (named && uniqueNames) ? ok(`each button names its pillar, and its accessible name contains the visible label and says it opens cards (e.g. "${rollup.rows[rollup.rows.length - 1].btnName}")`) : bad("rollup button names: " + JSON.stringify(rollup.rows.map((r) => [r.p, r.btnText, r.btnName])));
  const bands = await page.evaluate(() => [...document.querySelectorAll(".readiness-pillar-row")].map((row) => {
    const pct = Number(((row.querySelector(".stat .v") || {}).textContent || "").match(/^(\d+)%/)?.[1]);
    const bar = row.querySelector(".bar");
    return { p: row.getAttribute("data-pillar"), pct, green: !!bar && bar.classList.contains("green"), cyan: !!bar && bar.classList.contains("cyan") };
  }));
  const bandOk = bands.every((b) => Number.isNaN(b.pct) || (b.green === (b.pct >= 85) && b.cyan === (b.pct >= 60 && b.pct < 85)));
  bandOk ? ok("each rollup bar's colour band matches its own percentage (green >= 85, cyan 60-84, base below) - no text-vs-bar contradiction") : bad("rollup bar bands: " + JSON.stringify(bands));
  const drillTarget = rollup.rows[1].p;
  await page.evaluate((p) => { const row = document.querySelector(`.readiness-pillar-row[data-pillar="${p}"]`); row.querySelector("button").click(); }, drillTarget);
  await page.waitForTimeout(900);
  bar = await readBar("pillar");
  const act = bar.chips.filter((c) => c.active).map((c) => c.text.replace(/\s*\(\d+\)$/, ""));
  const sz = await deckSize();
  (JSON.stringify(act) === JSON.stringify([drillTarget]) && sz === live.counts[drillTarget])
    ? ok(`the "${drillTarget}" button lands on Board Drill with that pillar chip active and a ${sz}-card deck`)
    : bad(`after the ${drillTarget} button: active ${JSON.stringify(act)}, deck ${sz}`);
  const flagCleared = await page.evaluate(() => G.board._filterPillar == null);
  flagCleared ? ok("the one-shot _filterPillar flag was consumed") : bad("_filterPillar still set");
}
// Desktop keeps the wrapping layout (no scroller), so nothing clips the ring
// there - kept as a guard that the phone-width fix never leaks upward.
report(await checkFocusRingNeverClipped(page, BAR("pillar"), "at 1200px the pillar"));

/* ---- 5. phone width: single scrollable rows ---- */
const page2 = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
page2.on("pageerror", (e) => noise.push("pageerror(p2): " + e.message));
await page2.goto(url, { waitUntil: "load" });
await dismissOnboarding(page2);
await page2.evaluate(() => { location.hash = "#/board"; });
await page2.waitForTimeout(900);
// The regulation row is collapsed behind a disclosure by default (see the
// board-filter consolidation) - a fresh page has nothing to open it yet, and
// a closed <details>'s non-summary content has no rendered box at all, which
// would fail every geometry check below for a reason that has nothing to do
// with what they're actually testing. Open it directly, same as a Soldier
// tapping "Filter by regulation" would. No wait needed after: the `open`
// property change is a synchronous DOM/style mutation (no CSS transition on
// the row itself - only the summary's own chevron animates, and reduced-
// motion neutralizes even that), and getBoundingClientRect() below forces
// a synchronous layout flush that always reflects the change immediately.
await page2.evaluate(() => { const d = document.querySelector(".qf-disclosure"); if (d) d.open = true; });
const phone = await page2.evaluate(() => {
  const bars = ["pillar", "category", "regulation"].map((l) => document.querySelector(`.search-filters[aria-label="Quick-filter by ${l}"]`));
  return {
    rows: bars.map((b) => { const chip = b.querySelector(".search-chip"); return { h: b.getBoundingClientRect().height, chipH: chip.getBoundingClientRect().height, scrolls: b.scrollWidth > b.clientWidth + 2, nowrap: getComputedStyle(b).flexWrap === "nowrap" }; }),
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});
const singleRow = phone.rows.every((r) => r.nowrap && r.h < r.chipH * 1.8);
(singleRow && !phone.pageOverflow) ? ok(`at 390px all three quick-filter rows are single rows (heights ${phone.rows.map((r) => Math.round(r.h)).join("/")}px, ${phone.rows.filter((r) => r.scrolls).length} overflow sideways) with no page overflow`) : bad("phone-width rows: " + JSON.stringify(phone));

// "Single row, nowrap, no page overflow" is equally true of a row that just
// CLIPS its chips. Prove each row is a real scroller, to its last chip, with
// a real wheel gesture - then that keyboard focus is fully visible on every
// chip (standard ring and the wider Bold Focus ring), and actually painted.
for (const l of ["pillar", "category", "regulation"]) report(await checkRowScrollsToEnd(page2, BAR(l), "at 390px the " + l));
for (const l of ["pillar", "category", "regulation"]) report(await checkFocusRingNeverClipped(page2, BAR(l), "at 390px the " + l));
for (const l of ["pillar", "category", "regulation"]) report(await checkFocusRingNeverClipped(page2, BAR(l), "at 390px the " + l, { boldFocus: true }));
report(await checkRingPaints(page2, BAR("pillar"), "at 390px the pillar"));
const phoneAfter = await page2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
!phoneAfter ? ok("...and the page still has no horizontal overflow after scrolling and tabbing through the rows") : bad("page overflows horizontally at 390px after using the rows");

// A chip made active from Readiness must be VISIBLE in the phone-width
// scroller, not parked off-screen at scrollLeft 0 (the row used to look like
// nothing was selected). Through the REAL button, on the phone-width page -
// the first version of this check set the one-shot flag from script and so
// never exercised the Readiness button at 390px at all. The LAST pillar is
// the one furthest right (and the one whose label used to stutter).
const lastPillar = CANON[CANON.length - 1];
await page2.evaluate(() => { G.board._openReadiness && G.board._openReadiness(); });
await page2.waitForTimeout(900);
const lastBtn = page2.locator(`.readiness-pillar-row[data-pillar="${lastPillar}"] button`);
const lastBtnBox = await lastBtn.evaluate((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent, right: r.right, vw: document.documentElement.clientWidth, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; }).catch(() => null);
(lastBtnBox && lastBtnBox.right <= lastBtnBox.vw && !lastBtnBox.pageOverflow) ? ok(`at 390px the "${lastBtnBox.text}" button fits the screen (no horizontal overflow on Readiness)`) : bad("Readiness rollup button at 390px: " + JSON.stringify(lastBtnBox));
await lastBtn.click();
await page2.waitForTimeout(1000);
const reveal = await chipInsideRow(page2, BAR("pillar"), ".search-chip.active");
(reveal && reveal.text.startsWith(lastPillar) && reveal.inside && reveal.scrollLeft > 0)
  ? ok(`at 390px the Readiness button for "${lastPillar}" lands on Board Drill with that chip scrolled fully into view (row scrollLeft ${reveal.scrollLeft}px), not left off-screen`)
  : bad("chip visibility at phone width after the Readiness button: " + JSON.stringify(reveal));

/* ---- 6. the "Needs Work" buttons on the same tab ---- */
// Same stutter, one panel up: those buttons were "Drill " + category, and a
// real category is named "Drill and Ceremony (TC 3-21.5)" - so a Soldier
// weak in it was offered "Drill Drill and Ceremony (TC 3-21.5)". The panel
// only lists the three weakest categories, so make that category the weakest
// for certain: a fresh profile where every OTHER card is mastered and one of
// its own was missed (real stored study records, written the way the heatmap
// suite seeds them - the label code under test is untouched).
const page3 = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page3.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + "(p3): " + m.text()); });
page3.on("pageerror", (e) => noise.push("pageerror(p3): " + e.message));
await page3.goto(url, { waitUntil: "load" });
await dismissOnboarding(page3);
const weakCat = await page3.evaluate(async () => {
  const all = G.store.boardQuestions();
  const cat = [...new Set(all.map((q) => q.category))].find((c) => /^drill\b/i.test(c));
  if (!cat) return null;
  const others = all.filter((q) => q.category !== cat), own = all.filter((q) => q.category === cat);
  for (let i = 0; i < others.length; i += 100) {
    await Promise.all(others.slice(i, i + 100).map((q) => G.db.put("kv", { k: "srs:" + q.id, v: { reps: 2, ease: 2.4, interval: 3, due: Date.now() + 864e5, misses: 0, lastGrade: 2 } })));
  }
  await G.db.put("kv", { k: "srs:" + own[0].id, v: { reps: 0, ease: 2.3, interval: 0, due: 0, misses: 1, lastGrade: 0 } });
  return { cat, total: own.length };
});
if (!weakCat) {
  ok("no card category starts with the word \"Drill\" any more - nothing for a \"Drill ...\" label to collide with");
} else {
  await page3.evaluate(() => { location.hash = "#/board"; });
  await page3.waitForTimeout(900);
  await page3.evaluate(() => { G.board._openReadiness && G.board._openReadiness(); });
  await page3.waitForTimeout(900);
  const needs = await page3.evaluate(() => {
    const panel = [...document.querySelectorAll(".panel")].find((p) => { const e = p.querySelector(".eyebrow"); return e && e.textContent.trim() === "Needs Work"; });
    if (!panel) return null;
    return [...panel.querySelectorAll("button")].map((b) => ({ cat: ((b.parentElement.querySelector(".stat .k") || {}).textContent || ""), text: b.textContent.trim(), name: (b.getAttribute("aria-label") || b.textContent).trim() }));
  });
  const STUTTER2 = /\b(\w+)\s+\1\b/i;
  const mine = needs && needs.find((n) => n.cat === weakCat.cat);
  mine ? ok(`"${weakCat.cat}" is listed under Needs Work (button "${mine.text}")`) : bad("Needs Work does not list the seeded weakest category: " + JSON.stringify(needs));
  if (needs && mine) {
    const bad2 = needs.filter((n) => STUTTER2.test(n.text) || STUTTER2.test(n.name));
    bad2.length === 0 ? ok(`no Needs Work button repeats a word back to back (${needs.map((n) => '"' + n.text + '"').join(", ")})`) : bad("Needs Work button label stutters: " + JSON.stringify(bad2));
    needs.every((n) => n.text.includes(n.cat) && n.name.includes(n.text))
      ? ok(`each Needs Work button names its category, and its accessible name contains the visible label (e.g. "${mine.name}")`)
      : bad("Needs Work button names: " + JSON.stringify(needs));
    await page3.evaluate((cat) => {
      const panel = [...document.querySelectorAll(".panel")].find((p) => { const e = p.querySelector(".eyebrow"); return e && e.textContent.trim() === "Needs Work"; });
      [...panel.querySelectorAll("button")].find((b) => (b.parentElement.querySelector(".stat .k") || {}).textContent === cat).click();
    }, weakCat.cat);
    await page3.waitForTimeout(1000);
    const landed = await page3.evaluate(() => { const s = Array.from(document.querySelectorAll(".stat")).find((x) => /This session/.test(x.textContent)); const m = s && ((s.querySelector(".v") || {}).textContent || "").match(/Card \d+\/(\d+)/); return m ? Number(m[1]) : null; });
    landed === weakCat.total ? ok(`...and the relabelled button still opens Board Drill on exactly that category's ${landed} cards`) : bad(`after the Needs Work button: deck ${landed} vs ${weakCat.total} "${weakCat.cat}" cards`);
  }
}

noise.length === 0 ? ok("no console errors/warnings or page errors") : bad(`console noise: ${noise.join(" | ")}`);
console.log(fails === 0 ? "\nBOARD PILLAR FILTER: all passed" : `\nBOARD PILLAR FILTER: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
