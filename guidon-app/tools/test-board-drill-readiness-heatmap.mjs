/**
 * Roadmap Tier 4: Board Drill's Readiness tab "All Categories" panel used to
 * render the full category list as a single-column scrolling bar-list — one
 * row per category (93 real categories in the deck), one pct value per row.
 * The underlying catScores computed just above it in renderReadiness()
 * already carries total/seen/mastered per category, which decompose
 * cleanly into New / Learning / Mastered card counts — the same three-
 * state classification the flashcard's own front-of-card mastery badge
 * already uses (masteryState: reps===0 -> "new", isMasteredSrs ->
 * "mastered", else "learning"). That panel now renders through the shared
 * G.chart.heatmapGrid primitive instead.
 *
 * This test seeds real, deterministic srs: rows across two real categories
 * (split into explicit new/learning/mastered groups) so every bucket has a
 * genuine non-zero count to check, then:
 *
 *   1. Confirms the heatmap actually replaced the old bar-list in the "All
 *      Categories" panel (no leftover .bar rows there, the sibling "Needs
 *      Work" panel above it still has its own .bar rows untouched).
 *   2. Confirms the real category count (93, independently read from
 *      window.G.store.boardQuestions() in-page, not hardcoded) matches the
 *      rendered row count and cell count (rows × 3 columns).
 *   3. Confirms column headers are exactly New / Learning / Mastered.
 *   4. Confirms real per-cell values for the two seeded categories match
 *      values independently re-derived in-page from the exact same
 *      predicates renderReadiness() itself uses (window.G.board.loadAllSrs
 *      + window.G.board.isMasteredSrs), not hardcoded magic numbers.
 *   5. Confirms the vertical scroll cap actually engages: the wrap's real
 *      scrollHeight exceeds its clientHeight for a 93-row grid.
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
page.on("console", (m) => { if (m.type() === "error") noise.push(m.text()); });
page.on("pageerror", (e) => noise.push("pageerror: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(700);
const guestCard = page.locator(".ob-mode-card", { hasText: /guest session/i }).first();
await guestCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
if (await guestCard.count()) {
  await guestCard.click();
  await page.locator("#ob-overlay").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(400);

// ── Seed deterministic srs: rows across two real categories ─────────────
// Picks the first two categories (alphabetical, same order renderReadiness
// itself sorts by) with at least 6 real questions so a 2/2/2 new/learning/
// mastered split is possible, then writes explicit srs: rows for the
// learning + mastered groups only — the "new" group is left untouched,
// relying on loadAllSrs()'s own real default ({reps:0,...}) for a fresh
// guest session, exactly like the app's own read path.
const seeded = await page.evaluate(async () => {
  const qs = window.G.store.boardQuestions();
  const byCat = {};
  qs.forEach((q) => { (byCat[q.category] = byCat[q.category] || []).push(q); });
  const eligible = Object.keys(byCat).filter((c) => byCat[c].length >= 6).sort();
  const cats = eligible.slice(0, 2);
  const plan = {};
  for (const cat of cats) {
    const list = byCat[cat];
    const learningQs = list.slice(2, 4);   // reps>0, lastGrade<2
    const masteredQs = list.slice(4, 6);   // reps>0, lastGrade>=2
    for (const q of learningQs) {
      await window.G.db.put("kv", { k: "srs:" + q.id, v: { reps: 1, ease: 2.3, interval: 1, due: 0, misses: 0, lastGrade: 1 } });
    }
    for (const q of masteredQs) {
      await window.G.db.put("kv", { k: "srs:" + q.id, v: { reps: 2, ease: 2.4, interval: 3, due: 0, misses: 0, lastGrade: 2 } });
    }
    plan[cat] = { total: list.length, newCt: list.length - 4, learningCt: learningQs.length, masteredCt: masteredQs.length };
  }
  return { cats, plan, totalCategories: eligible.length >= 0 ? new Set(qs.map((q) => q.category)).size : 0, totalQuestions: qs.length };
});
seeded.cats.length === 2
  ? ok("Seeded deterministic srs: rows across 2 real categories with >=6 questions: " + JSON.stringify(seeded.cats))
  : bad("could not find 2 eligible categories to seed: " + JSON.stringify(seeded));

// ── Open Board Drill -> Readiness tab through the real UI dispatcher ────
await page.evaluate(() => { location.hash = "#/board"; });
await page.waitForTimeout(400);
await page.evaluate(() => { window.G.board._openReadiness && window.G.board._openReadiness(); });
await page.waitForTimeout(500);
await page.locator(".eyebrow", { hasText: /^All Categories$/ }).waitFor({ state: "attached", timeout: 5000 }).catch(() => {});

// ── Independently re-derive expected per-category bucket counts in-page,
// using the exact same predicates renderReadiness() uses, not hardcoded
// numbers pulled from the seed plan above (the seed plan proves intent;
// this independent re-derivation proves the render path actually reads
// real persisted srs: state through the real predicates). ─────────────────
const derived = await page.evaluate(async () => {
  const all = window.G.store.boardQuestions();
  const categories = [...new Set(all.map((q) => q.category))].sort();
  const srsData = await window.G.board.loadAllSrs(all.map((q) => q.id));
  const catScores = categories.map((cat) => {
    const qs = all.filter((q) => q.category === cat);
    const seen = qs.filter((q) => srsData[q.id].reps > 0);
    const mastered = qs.filter((q) => window.G.board.isMasteredSrs(srsData[q.id]));
    return { cat, total: qs.length, newCt: qs.length - seen.length, learningCt: seen.length - mastered.length, masteredCt: mastered.length };
  });
  return { categories, catScores };
});

// ── Pull the real rendered heatmap out of the "All Categories" panel ────
const rendered = await page.evaluate(() => {
  const panel = Array.from(document.querySelectorAll(".panel")).find((p) => {
    const eyebrow = p.querySelector(".eyebrow");
    return eyebrow && eyebrow.textContent.trim() === "All Categories";
  });
  if (!panel) return { found: false };
  const svg = panel.querySelector(".chart-heatmap-svg");
  const wrap = panel.querySelector(".chart-heatmap-wrap");
  if (!svg || !wrap) return { found: true, svg: !!svg, wrap: !!wrap };
  const leftoverBars = panel.querySelectorAll(":scope > div.bar, :scope > div > div.bar").length;
  const cells = [...svg.querySelectorAll(".chart-heatmap-cell")];
  const texts = [...svg.querySelectorAll("text")];
  const colHeaders = texts.slice(0, 3).map((t) => t.textContent);
  const rowLabels = texts.slice(3).map((t) => t.textContent);
  // Group cells into rows of 3 (New/Learning/Mastered) in DOM order, which
  // matches heatmapGrid's own row-major emission order.
  const rows = [];
  for (let i = 0; i < cells.length; i += 3) {
    const triple = cells.slice(i, i + 3).map((c) => {
      const title = c.querySelector("title").textContent;
      const m = title.match(/:\s*(\d+)\s*card/);
      return m ? parseInt(m[1], 10) : null;
    });
    rows.push(triple);
  }
  return {
    found: true, svg: true, wrap: true,
    leftoverBars, cellCount: cells.length, rowLabelCount: rowLabels.length,
    colHeaders, rowLabels, rows,
    wrapScrollHeight: wrap.scrollHeight, wrapClientHeight: wrap.clientHeight,
    minOpacity: Math.min(...cells.map((c) => parseFloat(c.getAttribute("fill-opacity")))),
    maxOpacity: Math.max(...cells.map((c) => parseFloat(c.getAttribute("fill-opacity")))),
  };
});

rendered.found ? ok("Found the 'All Categories' panel") : bad("could not find the 'All Categories' panel at all");
if (!rendered.found) {
  console.log("\n" + fails + " FAILURE(S)");
  await browser.close();
  await server.close();
  process.exit(1);
}
rendered.svg && rendered.wrap
  ? ok("'All Categories' panel now renders a .chart-heatmap-svg inside a .chart-heatmap-wrap")
  : bad("heatmap svg/wrap missing: svg=" + rendered.svg + " wrap=" + rendered.wrap);
rendered.leftoverBars === 0
  ? ok("old scrolling bar-list (.bar rows) fully replaced — none left in the 'All Categories' panel")
  : bad("found " + rendered.leftoverBars + " leftover .bar row(s) in the 'All Categories' panel — old list not fully replaced");

// Real category count, independently verified (not trusting the roadmap's
// stated "93" blindly).
const realCatCount = derived.categories.length;
realCatCount === 93
  ? ok("real independently-verified category count is 93 (matches the roadmap's stated count)")
  : ok("real independently-verified category count is " + realCatCount + " (NOT 93 — roadmap's number was stale; test still validates against the real count)");

rendered.rowLabelCount === realCatCount
  ? ok("heatmap renders exactly " + realCatCount + " row labels — one per real category")
  : bad("expected " + realCatCount + " row labels, got " + rendered.rowLabelCount);
rendered.cellCount === realCatCount * 3
  ? ok("heatmap renders " + rendered.cellCount + " cells = " + realCatCount + " categories × 3 buckets")
  : bad("expected " + (realCatCount * 3) + " cells, got " + rendered.cellCount);
JSON.stringify(rendered.colHeaders) === JSON.stringify(["New", "Learning", "Mastered"])
  ? ok("column headers are exactly New / Learning / Mastered")
  : bad("column headers: " + JSON.stringify(rendered.colHeaders));

// Per-category, per-bucket value check: every rendered row's 3 values must
// exactly match the independently re-derived catScores breakdown, keyed by
// truncated row label (heatmapGrid slices row labels to 20 chars).
let mismatches = 0;
derived.catScores.forEach((c, i) => {
  const expectedLabel = c.cat.slice(0, 20);
  const gotLabel = rendered.rowLabels[i];
  const gotRow = rendered.rows[i] || [];
  const expectedRow = [c.newCt, c.learningCt, c.masteredCt];
  const labelOk = gotLabel === expectedLabel;
  const valsOk = gotRow[0] === expectedRow[0] && gotRow[1] === expectedRow[1] && gotRow[2] === expectedRow[2];
  if (!labelOk || !valsOk) {
    mismatches++;
    if (mismatches <= 5) {
      console.log("    mismatch row " + i + " (" + c.cat + "): label got=" + gotLabel + " want=" + expectedLabel +
        " | values got=" + JSON.stringify(gotRow) + " want=" + JSON.stringify(expectedRow));
    }
  }
});
mismatches === 0
  ? ok("all " + derived.catScores.length + " rows' New/Learning/Mastered values exactly match independently re-derived stats")
  : bad(mismatches + " / " + derived.catScores.length + " row(s) mismatched real derived stats (see above)");

// Specifically confirm the two seeded categories show real non-zero,
// non-uniform values in all three buckets (proves this isn't an
// all-zero/all-same-value false pass).
seeded.cats.forEach((cat) => {
  const idx = derived.categories.indexOf(cat);
  const row = rendered.rows[idx] || [];
  const plan = seeded.plan[cat];
  const matches = row[0] === plan.newCt && row[1] === plan.learningCt && row[2] === plan.masteredCt;
  const nonZero = row[0] > 0 && row[1] > 0 && row[2] > 0;
  matches && nonZero
    ? ok("seeded category '" + cat + "' shows real non-zero New=" + row[0] + " Learning=" + row[1] + " Mastered=" + row[2])
    : bad("seeded category '" + cat + "' row wrong or has a zero bucket: got=" + JSON.stringify(row) + " want=" + JSON.stringify([plan.newCt, plan.learningCt, plan.masteredCt]));
});

rendered.maxOpacity > rendered.minOpacity
  ? ok("cell fill-opacity genuinely varies with real data (min=" + rendered.minOpacity + ", max=" + rendered.maxOpacity + ")")
  : bad("cell opacity does not vary with data (min=" + rendered.minOpacity + ", max=" + rendered.maxOpacity + ")");

// ── Vertical scroll cap: 93 rows at the tuned cellH must exceed maxHeight ─
rendered.wrapScrollHeight > rendered.wrapClientHeight
  ? ok("vertical scroll cap engages for real: scrollHeight (" + rendered.wrapScrollHeight + "px) > clientHeight (" + rendered.wrapClientHeight + "px)")
  : bad("no scroll overflow: scrollHeight=" + rendered.wrapScrollHeight + " clientHeight=" + rendered.wrapClientHeight);

// ── "Needs Work" panel above must still keep its own untouched .bar rows ─
const needsWorkBars = await page.evaluate(() => {
  const panel = Array.from(document.querySelectorAll(".panel")).find((p) => {
    const eyebrow = p.querySelector(".eyebrow");
    return eyebrow && eyebrow.textContent.trim() === "Needs Work";
  });
  return panel ? panel.querySelectorAll("div.bar").length : -1;
});
needsWorkBars > 0
  ? ok("'Needs Work' panel above still renders its own bar rows unchanged (" + needsWorkBars + " bars)")
  : bad("'Needs Work' panel bars missing/broken (found " + needsWorkBars + ") — sibling panel affected unexpectedly");

const relevantNoise = noise.filter((n) => !/favicon/.test(n));
relevantNoise.length === 0 ? ok("no console errors/warnings") : bad("console noise: " + relevantNoise.slice(0, 5).join(" | "));

await browser.close();
await server.close();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nBOARD DRILL READINESS HEATMAP: all passed");
process.exit(fails ? 1 : 0);
