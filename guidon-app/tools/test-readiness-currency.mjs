/**
 * Readiness surfaces tell the truth about time, and "weakest topics" is a ranking, not the alphabet.
 *
 * WHY THIS SUITE EXISTS. Three defects sat behind one number a Soldier uses to
 * decide whether to keep studying, and every one of them read in the flattering
 * direction:
 *
 *   A. "Needs Work" (Board Drill > Readiness, the reps set, Rapid Fire's Needs
 *      Work chip) sorted by percent only, so every category that had never been
 *      opened tied with the one the Soldier had just failed, and the alphabet
 *      decided the tie: after failing 24 Creeds cards the "weakest" three were
 *      ACS, ADP and ADP 1 - all unopened - and Creeds was absent. A one-card
 *      category at 0/1 outranked a 24-card category at 50%.
 *   B. The Readiness headline printed "88%  Board Ready ✓" for 1,058 cards
 *      that were all last graded Know It and were all overdue - the "Due for
 *      review now" line was right under it. Mastered never expires (and must
 *      not: isMasteredSrs feeds ten other surfaces), so the headline now counts
 *      CURRENT cards - mastered and not yet due - and never says "Board Ready".
 *   C. Home said "Promotable Readiness: Not Started" beside a thousand
 *      mastered cards (the scenario metric, unlabelled), and Progress's Board
 *      Drill priority said "Run Board Drill - 0% ready" (the scenario metric
 *      again, printed as if it were the cards).
 *
 * Both directions are asserted: the fix does what it should AND the ordinary
 * path (a Soldier who is genuinely current; three ordinary categories at 40 /
 * 60 / 80 percent) reads exactly as it did.
 */
import { bootApp, ok, bad, check, finish, waitForRoute, clickWhenStable, until, liveCount, expectNoConsoleNoise } from "./testkit.mjs";

const DAY = 86400000;
// check() prints only its failure text when it fails, so put the claim in it.
const is = (cond, claim, detail) => check(cond, claim, () => "NOT: " + claim + (detail === undefined ? "" : "  | " + (typeof detail === "function" ? detail() : detail)));
const boot = await bootApp({ viewport: { width: 1280, height: 900 } });
const { page, noise } = boot;

await liveCount(page, { kind: "board" }); // wait for the bank

/* ---------------------------------------------------------------------
   A. the ranking itself, through the public function, on a synthetic bank
   so the answer cannot drift with content changes
   --------------------------------------------------------------------- */
const rank = (spec) => page.evaluate(async (spec) => {
  // spec: { cats: { name: { total, rows: [{ lastGrade, misses }] } }, n }
  const all = [], srs = {};
  Object.keys(spec.cats).forEach((cat) => {
    const c = spec.cats[cat];
    for (let i = 0; i < c.total; i++) {
      const id = cat + "#" + i;
      all.push({ id, category: cat });
      const r = (c.rows || [])[i];
      srs[id] = r ? { reps: 1, ease: 2.3, interval: 3, due: Date.now() + 3 * 86400000, misses: r.misses || 0, lastGrade: r.lastGrade } : { reps: 0, ease: 2.3, interval: 0, due: 0, misses: 0 };
    }
  });
  const order = spec.reverse ? all.slice().reverse() : all;
  return (await G.board.weakestCategoriesByMastery(spec.n || 3, order, srs)).map((c) => ({ cat: c.cat, pct: c.pct, seen: c.seen, mastered: c.mastered, total: c.total }));
}, spec);
const names = (list) => list.map((c) => c.cat);
const failed = (n, misses = 1) => Array.from({ length: n }, () => ({ lastGrade: 0, misses }));
const mastered = (n) => Array.from({ length: n }, () => ({ lastGrade: 3, misses: 0 }));

{
  // The reported case: 24 cards failed in "Creeds", five categories never opened
  // that sort BEFORE it alphabetically.
  const unopened = { "ACS (AR 608-1)": { total: 10 }, "ADP / Doctrine Publications": { total: 10 }, "ADP 1": { total: 10 }, "AFT": { total: 10 }, "Awards": { total: 10 } };
  const r1 = await rank({ cats: { ...unopened, "Creeds": { total: 24, rows: failed(24) } } });
  is(names(r1)[0] === "Creeds", "24 failed Creeds cards make Creeds the weakest topic (not an unopened one)", () => JSON.stringify(r1));
  is(r1.every((c) => c.seen > 0), "a category the Soldier has never opened is never listed as a weakest topic", () => JSON.stringify(r1));

  // Creeds half failed / half mastered (50%) against a ONE-card category at 0/1.
  const r2 = await rank({ cats: { "Army Profession": { total: 1, rows: failed(1) }, "Creeds": { total: 24, rows: [...failed(12, 2), ...mastered(12)] }, "ACS": { total: 10 } } });
  is(names(r2)[0] === "Creeds", "a 24-card category at 50% outranks a one-card category at 0/1", () => JSON.stringify(r2));
  is(!names(r2).includes("Army Profession"), "a one-card category is left out while a real category is struggling", () => JSON.stringify(r2));

  // Barely-touched: 1 of 24 mastered (4%) is thin evidence and must not outrank a category with real evidence.
  const r3 = await rank({ cats: { "Thin": { total: 24, rows: mastered(1) }, "Solid": { total: 10, rows: [...mastered(2), ...failed(4, 2)] } } });
  is(names(r3)[0] === "Solid", "a category with one graded card ranks below one with real evidence", () => JSON.stringify(r3));

  // Misses break a tie at equal percent.
  const r4 = await rank({ cats: { "Aaa": { total: 10, rows: failed(5, 1) }, "Bbb": { total: 10, rows: failed(5, 3) } } });
  is(names(r4).join() === "Bbb,Aaa", "at equal percent the category with more misses ranks weaker", () => JSON.stringify(r4));

  // Full tie: deterministic, and the same whichever way round the bank arrives.
  const tieA = await rank({ cats: { "Zulu": { total: 10, rows: failed(5) }, "Alpha": { total: 10, rows: failed(5) }, "Mike": { total: 10, rows: failed(5) } } });
  const tieB = await rank({ reverse: true, cats: { "Zulu": { total: 10, rows: failed(5) }, "Alpha": { total: 10, rows: failed(5) }, "Mike": { total: 10, rows: failed(5) } } });
  is(names(tieA).join() === "Alpha,Mike,Zulu" && names(tieB).join() === names(tieA).join(), "a full tie is broken by name, identically for either input order", () => JSON.stringify([tieA, tieB]));

  // Honest path unchanged: three ordinary categories at 40 / 60 / 80 percent.
  const ord = await rank({ n: 3, cats: {
    "C80": { total: 10, rows: [...mastered(8), ...failed(2)] },
    "C40": { total: 10, rows: [...mastered(4), ...failed(6)] },
    "C60": { total: 10, rows: [...mastered(6), ...failed(4)] } } });
  is(names(ord).join() === "C40,C60,C80" && ord.map((c) => c.pct).join() === "40,60,80", "ordinary use is unchanged: 40%, 60%, 80% categories list weakest first", () => JSON.stringify(ord));
  const lim = await rank({ n: 2, cats: { "C80": { total: 10, rows: [...mastered(8), ...failed(2)] }, "C40": { total: 10, rows: [...mastered(4), ...failed(6)] }, "C60": { total: 10, rows: [...mastered(6), ...failed(4)] } } });
  is(lim.length === 2, "the requested count still limits the list", () => JSON.stringify(lim));

  // Nothing studied -> [] (callers fall back to All categories); everything studied is mastered -> [] too.
  const none = await rank({ cats: { "A": { total: 5 }, "B": { total: 5 } } });
  is(none.length === 0, "with no study history at all there is nothing to call weak", () => JSON.stringify(none));
  const allDone = await rank({ cats: { "A": { total: 5, rows: mastered(5) }, "B": { total: 5 } } });
  is(allDone.length === 0, "a category that is fully mastered is not listed, and unopened ones are not called weak", () => JSON.stringify(allDone));
  const shape = await rank({ cats: { "A": { total: 5, rows: failed(3) } } });
  is(shape.length === 1 && shape[0].cat === "A" && shape[0].total === 5 && shape[0].seen === 3 && shape[0].mastered === 0 && shape[0].pct === 0, "each entry still carries cat / total / seen / mastered / pct", () => JSON.stringify(shape));
}


/* The same ranking, on the real Readiness screen with the real bank: fail every
   card of the biggest category and the panel must name it - not the first
   unopened category in the alphabet. */
const openReadiness = async () => {
  await waitForRoute(page, "#/board", { ready: ".segmented button" });
  await clickWhenStable(page, page.locator(".segmented button", { hasText: /^Readiness$/ }));
  await until(page, () => !!document.querySelector(".readiness-pillars, .heat, .panel .eyebrow"), null);
};
const panelByEyebrow = (label) => page.evaluate((label) => {
  const p = [...document.querySelectorAll("#route .panel")].find((x) => { const e = x.querySelector(".eyebrow"); return e && e.textContent.trim() === label; });
  return p ? p.innerText.replace(/\s+/g, " ").trim() : null;
}, label);
const seedRows = (rowsFn) => page.evaluate(async (fnSrc) => {
  const rowsOf = new Function("return (" + fnSrc + ")")();
  const qs = G.store.boardQuestions();
  const cats = {}; qs.forEach((q) => { (cats[q.category] = cats[q.category] || []).push(q); });
  const plan = rowsOf(cats, Date.now());
  for (const [id, row] of plan) await G.db.put("kv", { k: "srs:" + id, v: row });
  return { categories: Object.keys(cats).length, seeded: plan.length };
}, rowsFn.toString());
const clearSrs = () => page.evaluate(async () => {
  const rows = await G.db.all("kv");
  for (const r of rows) if (r && typeof r.k === "string" && r.k.indexOf("srs:") === 0) await G.db.del("kv", r.k);
});

{
  const meta = await seedRows((cats, now) => {
    const big = Object.keys(cats).sort((a, b) => cats[b].length - cats[a].length || (a < b ? -1 : 1))[0];
    return cats[big].map((q) => [q.id, { reps: 0, ease: 2, interval: 0, due: now - 1000, misses: 2, lastGrade: 0 }]);
  });
  const big = await page.evaluate(() => { const c = {}; G.store.boardQuestions().forEach((q) => { c[q.category] = (c[q.category] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))[0]; });
  await openReadiness();
  const needs = await panelByEyebrow("Needs Work");
  is(!!needs && needs.indexOf("Needs Work " + big) === 0, "the Needs Work panel names the category that was failed, first", () => JSON.stringify(needs && needs.slice(0, 160)));
  is(!!needs && new RegExp("Not opened yet: " + (meta.categories - 1) + " of " + meta.categories + " categories").test(needs), "and says how many categories are not opened yet, on its own line", () => JSON.stringify(needs));
  const alphaFirst = await page.evaluate(() => [...new Set(G.store.boardQuestions().map((q) => q.category))].sort()[0]);
  is(alphaFirst === big || !needs || needs.indexOf(alphaFirst + " ") === -1 || needs.indexOf(alphaFirst) > needs.indexOf(big), "the first category in the alphabet is not listed as weak just for being first", () => JSON.stringify(needs && needs.slice(0, 200)));
  await clearSrs();
}


/* ---------------------------------------------------------------------
   B. the Readiness headline counts CURRENT cards (mastered and not due)
   and never says "Board Ready"
   --------------------------------------------------------------------- */
const N = await liveCount(page, { kind: "board" });
const statOf = (label) => page.evaluate((label) => {
  for (const s of document.querySelectorAll("#route .stat")) {
    const k = s.querySelector(".k"), v = s.querySelector(".v");
    if (k && v && k.textContent.includes(label)) return v.textContent.replace(/\s+/g, " ").trim();
  }
  return null;
}, label);
const statIs = async (label, expected, claim) => { const v = await statOf(label); return is(v === expected, claim, () => JSON.stringify(v)); };
const headerPanel = () => page.evaluate(() => {
  const p = [...document.querySelectorAll("#route .panel")].find((x) => /Board Readiness Score/.test(x.textContent) && x.querySelector(".stat"));
  return p ? { text: p.innerText.replace(/\s+/g, " ").trim(), greenBar: !!p.querySelector(".bar.green"), buttons: [...p.querySelectorAll("button")].map((b) => b.textContent.trim()) } : null;
});
// every visible card gets the same row; `cur` says how many of them are still inside their interval
const seedAll = (mkRow) => page.evaluate(async (src) => {
  const mk = new Function("return (" + src + ")")();
  const qs = G.store.boardQuestions();
  const now = Date.now();
  for (let i = 0; i < qs.length; i++) await G.db.put("kv", { k: "srs:" + qs[i].id, v: mk(i, now, qs.length) });
  return qs.length;
}, mkRow.toString());
const reload = async () => { await page.evaluate(() => { location.hash = "#/home"; }); await openReadiness(); };

{
  // Fixture A: every card last graded Down Cold, every one overdue by 60 days.
  await clearSrs();
  await seedAll((i, now) => ({ reps: 1, ease: 2.5, interval: 3, due: now - 60 * 86400000, misses: 0, lastGrade: 3 }));
  await reload();
  const h = await headerPanel();
  is(!!h && new RegExp("0 of " + N + " cards current").test(h.text), "all-overdue deck: the headline reads 0 of " + N + " cards current", () => JSON.stringify(h && h.text.slice(0, 260)));
  is(!!h && !/Board Ready|✓|Solid Progress|Getting Started/.test(h.text), "and never says Board Ready (no check mark, no band words)", () => JSON.stringify(h && h.text.slice(0, 260)));
  is(!!h && !h.greenBar, "and the bar is not green", () => "green bar present");
  await statIs("Due for review now", N + " questions", "the due line agrees: every card is due");
  await statIs("Questions mastered", N + " / " + N, "mastered is untouched by the time term (still last-graded Know It or Down Cold)");
  const routeText = await page.evaluate(() => document.getElementById("route").innerText);
  is(!/Board Ready/.test(routeText), "the phrase Board Ready appears nowhere on the Readiness screen", () => "found");

  // Fixture B: the same grades, due tomorrow -> all current.
  await clearSrs();
  await seedAll((i, now) => ({ reps: 1, ease: 2.5, interval: 3, due: now + 86400000, misses: 0, lastGrade: 3 }));
  await reload();
  const hb = await headerPanel();
  is(!!hb && new RegExp(N + " of " + N + " cards current").test(hb.text), "same grades due tomorrow: the headline reads " + N + " of " + N + " cards current", () => JSON.stringify(hb && hb.text.slice(0, 260)));
  await statIs("Due for review now", "None — you're current", "and nothing is due");
  is(!!hb && !hb.buttons.some((b) => /Due Now/.test(b)), "and there is no Drill Due Now button", () => JSON.stringify(hb && hb.buttons));
  is(!!hb && !/Board Ready/.test(hb.text), "even fully current, the wording is a count, not a verdict", () => JSON.stringify(hb && hb.text.slice(0, 260)));

  // Fixture C: a mix - first 30% current, the rest overdue, and a few graded Somewhat (never mastered).
  await clearSrs();
  const K = Math.floor(N * 0.3);
  await seedAll((i, now, n) => i < Math.floor(n * 0.3)
    ? { reps: 2, ease: 2.5, interval: 5, due: now + 3 * 86400000, misses: 0, lastGrade: 2 }
    : { reps: 2, ease: 2.5, interval: 5, due: now - 86400000, misses: 0, lastGrade: 2 });
  await reload();
  const hc = await headerPanel();
  is(!!hc && new RegExp(K + " of " + N + " cards current").test(hc.text), "a mix: " + K + " of " + N + " current", () => JSON.stringify(hc && hc.text.slice(0, 260)));
  await statIs("Due for review now", (N - K) + " questions", "and the other " + (N - K) + " are exactly the ones due");
  await statIs("Questions mastered", N + " / " + N, "mastered (no time term) still counts all of them");

  // Honest path: a card graded Somewhat is due tomorrow but NOT current (it was never mastered).
  await clearSrs();
  await seedAll((i, now) => ({ reps: 1, ease: 2.2, interval: 1, due: now + 86400000, misses: 0.5, lastGrade: 1 }));
  await reload();
  const hd = await headerPanel();
  is(!!hd && new RegExp("0 of " + N + " cards current").test(hd.text), "cards graded Somewhat are not current even though they are not due", () => JSON.stringify(hd && hd.text.slice(0, 260)));
  await statIs("Cards tried", N + " / " + N, "and are counted as tried at least once");

  // Never-studied deck: 0 current, 0 tried, nothing due, no invented verdict.
  await clearSrs();
  await reload();
  const he = await headerPanel();
  is(!!he && new RegExp("0 of " + N + " cards current").test(he.text) && !/Board Ready/.test(he.text), "a brand-new deck reads 0 of " + N + " current, no verdict", () => JSON.stringify(he && he.text.slice(0, 260)));
  await clearSrs();
}

/* The Board Drill screen's own side pane (only at 1360px and wider) prints the
   same headline, from the same predicate, and ranks its weakest three with the
   shared ordering - it used to say "Overall 88%" over an alphabetical list. */
{
  await page.setViewportSize({ width: 1440, height: 900 });
  await clearSrs();
  const K10 = await seedAll((i, now) => (i < 10
    ? { reps: 1, ease: 2.5, interval: 3, due: now + 3 * 86400000, misses: 0, lastGrade: 3 }
    : { reps: 1, ease: 2.5, interval: 3, due: now - 60 * 86400000, misses: 0, lastGrade: 3 }));
  await page.evaluate(() => { location.hash = "#/home"; });
  await waitForRoute(page, "#/board", { ready: ".drill-readiness-pane [data-overall-current]" });
  const pane = await page.evaluate(() => {
    const v = document.querySelector(".drill-readiness-pane [data-overall-current]");
    const pn = document.querySelector(".drill-readiness-pane");
    return { text: v.textContent, current: v.getAttribute("data-overall-current"), cards: v.getAttribute("data-overall-cards"), mastered: v.getAttribute("data-overall-mastered"), paneText: pn.innerText.replace(/\s+/g, " ") };
  });
  is(pane.current === "10" && pane.text === "10 of " + K10 && pane.mastered === String(K10), "the drill side pane counts 10 current of " + K10 + " (mastered, without the time term, is still " + K10 + ")", () => JSON.stringify(pane));
  is(!/Overall|Board Ready/.test(pane.paneText), "and no longer says Overall or Board Ready", () => JSON.stringify(pane.paneText.slice(0, 200)));
  await openReadiness();
  const hp = await headerPanel();
  is(!!hp && new RegExp("10 of " + K10 + " cards current").test(hp.text), "and the full Readiness tab reads the same 10 of " + K10, () => JSON.stringify(hp && hp.text.slice(0, 200)));
  await clearSrs();
  await page.setViewportSize({ width: 1280, height: 900 });
}

expectNoConsoleNoise(noise);
await finish("READINESS CURRENCY");
