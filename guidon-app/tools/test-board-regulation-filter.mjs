/**
 * Board Drill "Quick-filter by regulation" - ROADMAP.md §3f Phase 1-2's
 * "structured `regulation` field decomposed from board questions' free-
 * text `source`", shipped as RUNTIME derivation (G.board.regulationsOf)
 * rather than a persisted 997-card seed field - see that function's own
 * comment for the reasoning (re-run cost on every new card, staleness on
 * any hand edit, zero seed churn).
 *
 * Three layers, each asserted against the REAL bank, not fixtures:
 *  1. The grammar itself: every spelling-drift case the 2026-09-15 dry
 *     run over all 997 sources surfaced (DODI vs DoDI, "37 USC § 403" vs
 *     "37 U.S.C. 403", "DA Pam", "Title 10", dates and paragraph refs as
 *     residue, compound "A / B" citations) normalizes to the intended ids,
 *     in order of first appearance, deduplicated - and the things that
 *     must NOT become a "regulation" (creeds, "EO" meaning Equal
 *     Opportunity, institutions, websites) yield nothing.
 *  2. Coverage: the share of the live bank that yields at least one
 *     regulation stays at or above the calibrated floor, and the bank's
 *     most-cited publication is what the chip bar leads with.
 *  3. The chip bar is a REAL filter composed with the category filter (the
 *     "All"/active-chip sync, a chip's count equals the live derived count,
 *     every card in the filtered deck actually cites that regulation on
 *     its own back face, an impossible category+regulation combination
 *     produces the explanatory empty state naming both, and "All
 *     regulations" restores the deck).
 */
import { chromium } from "playwright";
import { serve } from "./server.mjs";
import { dismissOnboarding } from "./dismiss-onboarding.mjs";

let fails = 0;
const ok = (m) => console.log("  PASS  " + m);
const bad = (m) => { fails++; console.log("  FAIL  " + m); };

const { server, url } = await serve("web");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const noise = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));
await page.goto(url, { waitUntil: "load" });
await dismissOnboarding(page);

/* ---- 1. the grammar, case by case ---- */
const CASES = [
  ["AR 600-20", ["AR 600-20"]],
  ["AR 600-8-19 / DA PAM 600-8-19", ["AR 600-8-19", "DA PAM 600-8-19"]],
  ["AR 710-4 / AR 735-5", ["AR 710-4", "AR 735-5"]],
  ["ADP 1-01, para 2-18-2-22 (31 Jul 2019)", ["ADP 1-01"]],
  ["FM 7-22 (2020), Table B-1; AFT Standards", ["FM 7-22"]],
  ["AR 623-3 (14 Feb 2025); AR 350-1", ["AR 623-3", "AR 350-1"]],
  ["AR 600-52, Ch 1 / DODI 6495.02", ["AR 600-52", "DoDI 6495.02"]],
  ["DODI 6495.02; AR 600-52", ["DoDI 6495.02", "AR 600-52"]],
  ["37 USC § 403, DoDI 1340.23", ["37 USC 403", "DoDI 1340.23"]],
  ["50 U.S.C. § 3937 (SCRA)", ["50 USC 3937", "SCRA"]],
  ["38 USC Ch. 33; VA.gov", ["38 USC Ch. 33"]],
  ["AR 600-20; Title 10", ["AR 600-20", "10 USC"]],
  ["32 CFR Part 2002; AR 380-5", ["32 CFR 2002", "AR 380-5"]],
  ["AR 600-20 (EO, Ch 6) / AR 600-52 (SHARP)", ["AR 600-20", "AR 600-52"]],
  ["EO 10631; Geneva Convention III", ["EO 10631", "Geneva Conventions"]],
  ["UCMJ Article 15 / MCM Part V", ["UCMJ Art. 15", "MCM"]],
  ["UCMJ; Manual for Courts-Martial; AR 27-10", ["UCMJ", "MCM", "AR 27-10"]],
  ["UCMJ Art. 31; Military Rules of Evidence 305", ["UCMJ Art. 31"]],
  ["ATP 5-19 / DD 2977", ["ATP 5-19", "DD Form 2977"]],
  ["USAREC Pam 600-15 / DA Pam 600-60", ["USAREC PAM 600-15", "DA PAM 600-60"]],
  ["TB MED 507", ["TB MED 507"]],
  ["TCCC / STP 21-1-SMCT", ["STP 21-1-SMCT"]],
  ["Posse Comitatus Act (18 U.S.C. 1385); ADP 3-28", ["Posse Comitatus Act", "18 USC 1385", "ADP 3-28"]],
  ["USCENTCOM GO-1 / UCMJ Art. 92", ["USCENTCOM GO-1", "UCMJ Art. 92"]],
  ["DoDFMR Vol 7A", ["DoD FMR Vol 7A"]],
  // A bare "DoD NNNN.NN" is deliberately NOT guessed into DoDI/DoDD - it
  // yields nothing (the one such citation in the bank is a content fix).
  ["AR 600-20, Chapter 7 / DoD 6495.02", ["AR 600-20"]],
  ["ADP 6-22; ADP 6-22", ["ADP 6-22"]],
  ["Creeds", []],
  ["Army Center of Military History", []],
  ["DFAS / myPay", []],
  ["NCOLCoE", []],
  ["", []],
];
const results = await page.evaluate((cases) => cases.map(([src]) => G.board.regulationsOf(src)), CASES);
let caseFails = 0;
CASES.forEach(([src, want], i) => {
  const got = results[i];
  if (JSON.stringify(got) !== JSON.stringify(want)) { caseFails++; bad(`regulationsOf(${JSON.stringify(src)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`); }
});
caseFails === 0 ? ok(`regulationsOf(): all ${CASES.length} grammar cases normalize as intended (spelling drift, USC/CFR forms, dates/paras as residue, compounds, dedupe, non-publications -> [])`) : bad(`${caseFails} of ${CASES.length} grammar cases failed`);

/* ---- 2. coverage over the live bank ---- */
const cov = await page.evaluate(() => {
  const all = G.store.boardQuestions();
  const counts = {};
  let withReg = 0;
  const none = [];
  all.forEach((q) => {
    const regs = G.board.regulationsOf(q.source);
    if (regs.length) withReg++; else none.push(q.source);
    regs.forEach((r) => { counts[r] = (counts[r] || 0) + 1; });
  });
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { total: all.length, withReg, distinct: ranked.length, top: ranked.slice(0, 3), noneDistinct: [...new Set(none)].length };
});
const covPct = Math.round((cov.withReg / cov.total) * 100);
(cov.total > 900 && covPct >= 93)
  ? ok(`coverage: ${cov.withReg} of ${cov.total} live board cards (${covPct}%) yield at least one regulation; ${cov.distinct} distinct publications; ${cov.noneDistinct} distinct non-publication sources yield none by design`)
  : bad(`coverage regressed: ${cov.withReg}/${cov.total} (${covPct}%, floor 93%)`);
(cov.top[0] && cov.top[0][0] === "ADP 6-22" && cov.top[0][1] >= 90)
  ? ok(`the bank's most-cited publication is ADP 6-22 (${cov.top[0][1]} cards) - top 3: ${cov.top.map(([r, n]) => r + " " + n).join(", ")}`)
  : bad("top regulation ranking unexpected: " + JSON.stringify(cov.top));

/* ---- 3. the chip bar is a real, composed filter ---- */
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(900);
const readBar = () => page.evaluate(() => {
  const bar = document.querySelector('.search-filters[aria-label="Quick-filter by regulation"]');
  const catBar = document.querySelector('.search-filters[aria-label="Quick-filter by category"]');
  const chips = bar ? [...bar.querySelectorAll(".search-chip")] : [];
  return {
    present: !!bar,
    underCatBar: !!(bar && catBar && catBar.nextElementSibling === bar),
    visible: !!(bar && bar.getBoundingClientRect().height > 0),
    chips: chips.map((c) => ({ text: c.textContent, active: c.classList.contains("active"), pressed: c.getAttribute("aria-pressed") })),
  };
});
let bar = await readBar();
(bar.present && bar.underCatBar && bar.visible)
  ? ok("the regulation chip bar renders, visible, directly under the category chip bar (next sibling)")
  : bad("regulation chip bar: " + JSON.stringify({ present: bar.present, underCatBar: bar.underCatBar, visible: bar.visible }));
(bar.chips[0] && bar.chips[0].text === "All regulations" && bar.chips[0].active && bar.chips[0].pressed === "true")
  ? ok('"All regulations" is the first chip and starts active')
  : bad("first chip: " + JSON.stringify(bar.chips[0]));
(bar.chips.length >= 8 && bar.chips.length <= 13) ? ok(`chip bar is capped (${bar.chips.length} chips: "All" + at most 12)`) : bad(`chip count ${bar.chips.length}`);
const leadChip = bar.chips[1] ? bar.chips[1].text : "";
const leadReg = leadChip.replace(/\s*\(\d+\)$/, "");
const leadCount = Number((leadChip.match(/\((\d+)\)$/) || [])[1]);
const liveLeadCount = await page.evaluate((r) => G.store.boardQuestions().filter((q) => G.board.regulationsOf(q.source).includes(r)).length, leadReg);
(leadReg === cov.top[0][0] && leadCount === liveLeadCount)
  ? ok(`the first real chip is the most-cited publication, "${leadChip}", and its count equals the live derived count (${liveLeadCount})`)
  : bad(`lead chip "${leadChip}" vs live top ${JSON.stringify(cov.top[0])} / live count ${liveLeadCount}`);

// Click the lead chip: exactly it goes active, and the deck really filters -
// walk 6 cards with the arrow key and read each back face's "Source:" line.
await page.evaluate(() => { document.querySelector('.search-filters[aria-label="Quick-filter by regulation"]').querySelectorAll(".search-chip")[1].click(); });
await page.waitForTimeout(400);
bar = await readBar();
const activeTexts = bar.chips.filter((c) => c.active).map((c) => c.text);
JSON.stringify(activeTexts) === JSON.stringify([leadChip]) ? ok("exactly the clicked regulation chip is active") : bad("active chips after click: " + JSON.stringify(activeTexts));
const sources = [];
for (let i = 0; i < 6; i++) {
  const src = await page.evaluate(() => { const s = document.querySelector(".qz-back .src"); return s ? s.textContent.replace(/^Source:\s*/, "") : null; });
  sources.push(src);
  await page.evaluate(() => { const w = document.querySelector(".qz-wrap"); w.focus(); w.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  await page.waitForTimeout(120);
}
const allCite = await page.evaluate(([srcs, r]) => srcs.every((s) => s && G.board.regulationsOf(s).includes(r)), [sources, leadReg]);
allCite ? ok(`6 consecutive cards in the filtered deck all cite ${leadReg} on their own back face (e.g. ${JSON.stringify(sources[0])})`) : bad(`filtered deck contains a card not citing ${leadReg}: ${JSON.stringify(sources)}`);

// Compose with the category filter: a category that cannot cite the lead
// regulation must produce the explanatory empty state naming BOTH filters.
const noCat = await page.evaluate((r) => {
  const all = G.store.boardQuestions();
  const byCat = {};
  all.forEach((q) => { (byCat[q.category] = byCat[q.category] || []).push(q); });
  const cat = Object.keys(byCat).find((c) => byCat[c].length >= 5 && byCat[c].every((q) => !G.board.regulationsOf(q.source).includes(r)));
  return cat || null;
}, leadReg);
if (noCat) {
  await page.evaluate((c) => { const sel = document.querySelector('select[aria-label="Filter by category"]'); sel.value = c; sel.dispatchEvent(new Event("change")); }, noCat);
  await page.waitForTimeout(400);
  const empty = await page.evaluate(() => { const e = document.querySelector(".qz-wrap .empty"); return e ? e.textContent : null; });
  (empty && empty.includes("category “" + noCat + "”") && empty.includes("regulation “" + leadReg + "”"))
    ? ok(`category "${noCat}" + regulation "${leadReg}" -> explanatory empty state naming both filters`)
    : bad("empty state for an impossible category+regulation combination: " + JSON.stringify(empty));
  // Category chip bar and regulation chip bar are independent axes: the
  // category chips reflect the category, the regulation chips the regulation.
  const axes = await page.evaluate(() => ({
    cat: [...document.querySelector('.search-filters[aria-label="Quick-filter by category"]').querySelectorAll(".search-chip.active")].map((c) => c.textContent),
    reg: [...document.querySelector('.search-filters[aria-label="Quick-filter by regulation"]').querySelectorAll(".search-chip.active")].map((c) => c.textContent),
  }));
  (axes.reg.length === 1 && axes.reg[0] === leadChip) ? ok("the regulation chip stays active while the category filter changes (independent axes)") : bad("axes: " + JSON.stringify(axes));
  await page.evaluate(() => { const sel = document.querySelector('select[aria-label="Filter by category"]'); sel.value = "All"; sel.dispatchEvent(new Event("change")); });
  await page.waitForTimeout(400);
} else {
  bad("could not find a category (>=5 cards) with no card citing " + leadReg);
}

// Keyboard activation keeps focus on the chip (chips are built once and
// toggled in place - a bar that rebuilt itself on every build() destroyed
// the very button the user pressed Enter on and dropped focus to <body>)
// and announces the new deck via the app's live region.
for (const [label, idx] of [["regulation", 2], ["category", 1]]) {
  await page.evaluate(([label, idx]) => { document.querySelector(`.search-filters[aria-label="Quick-filter by ${label}"]`).querySelectorAll(".search-chip")[idx].focus(); }, [label, idx]);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const focus = await page.evaluate((label) => {
    const a = document.activeElement;
    const bar = document.querySelector(`.search-filters[aria-label="Quick-filter by ${label}"]`);
    return { tag: a && a.tagName, inBar: !!(a && bar && bar.contains(a)), pressed: a && a.getAttribute("aria-pressed"), text: a && a.textContent, live: (document.getElementById("a11y-live") || {}).textContent || "" };
  }, label);
  (focus.tag === "BUTTON" && focus.inBar && focus.pressed === "true")
    ? ok(`Enter on a ${label} chip keeps focus on that chip ("${focus.text}", aria-pressed=true) - no focus drop to <body>`)
    : bad(`focus after Enter on a ${label} chip: ` + JSON.stringify(focus));
  /Showing /.test(focus.live) ? ok(`...and the live region announced the change: "${focus.live.trim()}"`) : bad(`live region after ${label} chip: ` + JSON.stringify(focus.live));
}
await page.evaluate(() => { const sel = document.querySelector('select[aria-label="Filter by category"]'); sel.value = "All"; sel.dispatchEvent(new Event("change")); });
await page.waitForTimeout(400);

// "All regulations" restores the full deck.
await page.evaluate(() => { document.querySelector('.search-filters[aria-label="Quick-filter by regulation"]').querySelectorAll(".search-chip")[0].click(); });
await page.waitForTimeout(400);
bar = await readBar();
const restored = await page.evaluate(() => ({ card: !!document.querySelector(".qz-card"), empty: !!document.querySelector(".qz-wrap .empty") }));
(bar.chips[0].active && bar.chips.filter((c) => c.active).length === 1 && restored.card && !restored.empty)
  ? ok('"All regulations" restores the unfiltered deck and is the only active chip again')
  : bad("after All regulations: " + JSON.stringify({ chips: bar.chips.filter((c) => c.active).map((c) => c.text), restored }));

noise.length === 0 ? ok("no console errors/warnings or page errors") : bad(`console noise: ${noise.join(" | ")}`);
console.log(fails === 0 ? "\nBOARD REGULATION FILTER: all passed" : `\nBOARD REGULATION FILTER: ${fails} failed`);
await browser.close();
server.close();
process.exit(fails === 0 ? 0 : 1);
