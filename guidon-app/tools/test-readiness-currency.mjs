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
 *   D. The scenario score's top band said "Board Ready" after a handful of
 *      scenarios (and in the printed report a counselor reads). Nothing defines
 *      "board ready", so the top band is now "Very Strong" everywhere it prints.
 *      Mock Board's own scorecard had the same top band ("Board Ready" at 85%+,
 *      reachable with five questions and the Soldier's own slider ratings, and
 *      saved into the board history). It now reads "Very Strong" too.
 *
 *   E. Three more places printed a percentage of cards that were last rated
 *      Know It or better with no time term and no word about it: the counselor
 *      -facing Board Readiness Summary print, and the MOS deck and unit deck
 *      rows beside the (honest) pillar rows. Each now says that the figure is
 *      as last rated and, on the print, how many of those are due again now.
 *      The Progress card's sentence no longer promises a "composite Board
 *      Readiness Score" the Readiness tab stopped showing.
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

  // The comparator on its own (Rapid Fire's cross-link sorts the categories a round touched with it, without going through the
  // list builder above): a tried one-card category at 0/1 must not outrank a real category at 50%, and an unopened one is last.
  const cmp = await page.evaluate(() => {
    const rows = [
      { cat: "Unopened", total: 10, seen: 0, mastered: 0, pct: 0, misses: 0 },
      { cat: "OneCard", total: 1, seen: 1, mastered: 0, pct: 0, misses: 1 },
      { cat: "Real", total: 24, seen: 24, mastered: 12, pct: 50, misses: 12 },
    ];
    return { fwd: rows.slice().sort(G.board.compareWeakness).map((r) => r.cat), rev: rows.slice().reverse().sort(G.board.compareWeakness).map((r) => r.cat) };
  });
  is(cmp.fwd.join() === "Real,OneCard,Unopened" && cmp.rev.join() === cmp.fwd.join(), "the shared comparator ranks a real category before a tried one-card category before an unopened one, whichever order they arrive in", () => JSON.stringify(cmp));

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

/* ---------------------------------------------------------------------
   C. Home and Progress read the same card figure and keep the scenario score
   labelled as the scenario score
   --------------------------------------------------------------------- */
const openScreen = (hash, ready) => waitForRoute(page, hash, { fresh: true, ready });
const routeText = () => page.evaluate(() => document.getElementById("route").innerText.replace(/\s+/g, " "));
const resetScenarios = () => page.evaluate(async () => { await G.store.resetProgress(); });
const recordOneScenario = () => page.evaluate(async () => {
  await G.store.recordAttempt({ scenarioId: "qa-readiness-currency", title: "QA readiness currency", mode: "text", score: { Leads: 5, Develops: 0, Achieves: 0, Character: 0, Presence: 0, Intellect: 0 }, total: 5 });
  return (await G.store.getProgress()).totalScenarios;
});

{
  await clearSrs();
  await resetScenarios();
  // Fixture A again: every card last graded Down Cold, every one overdue by 60 days, no scenario ever played.
  await seedAll((i, now) => ({ reps: 1, ease: 2.5, interval: 3, due: now - 60 * 86400000, misses: 0, lastGrade: 3 }));
  await openScreen("#/home", "#route .stat");
  await statIs("Board cards current", "0 of " + N, "Home, card-only Soldier with every card overdue: reads 0 of " + N + " cards current");
  let t = await routeText();
  is(!/Not Started/.test(t) && !/Promotable Readiness/.test(t), "and never says Not Started beside a thousand graded cards (the scenario score is not shown when no scenario was played)", () => t.slice(0, 300));
  is(!/% ready/.test(t), "and prints no 'N% ready' on Home", () => "found");

  await openScreen("#/progress", "#route .panel");
  t = await routeText();
  const mastery = await panelByEyebrow("Board Drill Mastery");
  is(!!mastery && new RegExp("0 of " + N + " cards current", "i").test(mastery) && !/100% mastered/i.test(mastery), "Progress's Board Drill Mastery panel reads the same 0 of " + N + " (not '100% mastered')", () => JSON.stringify(mastery));
  const prio = await page.evaluate(() => { const r = [...document.querySelectorAll(".prog-pri-row")].find((x) => /Board Prep/.test(x.textContent)); return r ? r.innerText.replace(/\s+/g, " ").trim() : null; });
  is(!!prio && /Run Board Drill/.test(prio) && !/% ready/.test(prio) && new RegExp("0 of " + N + " cards current, " + N + " due for review").test(prio), "the Board Prep priority names the cards (0 of " + N + " current, " + N + " due), never 'N% ready'", () => JSON.stringify(prio));
  const bq = await panelByEyebrow("Board Q Readiness");
  is(!!bq && new RegExp(N + " mastered", "i").test(bq) && new RegExp(N + " due for review", "i").test(bq), "Board Q Readiness still reports mastered and due counts for the same cards (cross-screen contract kept)", () => JSON.stringify(bq));
  const tile = await page.evaluate(() => { const t = [...document.querySelectorAll('.readiness-dash[aria-label="Progress at a glance"] .readiness-tile')].map((x) => (x.querySelector(".readiness-label") || {}).textContent); return t; });
  is(tile.includes("Scenario readiness") && !tile.includes("Overall readiness"), "the scenario tile is called Scenario readiness, not Overall readiness", () => JSON.stringify(tile));

  // The printed report (what gets handed to a counselor): no scenario score printed as cards, and the card line is current/due.
  await page.evaluate(() => { window.__printed = null; G.util.printHTML = (title, html) => { window.__printed = html; }; });
  await clickWhenStable(page, page.locator("button", { hasText: /Print Report/ }));
  const printedOk = await until(page, () => !!window.__printed, null);
  const printed = printedOk ? await page.evaluate(() => window.__printed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")) : "";
  is(printedOk && /Promotable Readiness \(LRM\)/.test(printed) && !/Overall:/.test(printed) && !/% ready/.test(printed), "the printed report names the scenario score as Promotable Readiness (LRM) and never prints 'N% ready'", () => printed.slice(0, 300));
  is(printedOk && new RegExp("Board cards: 0 of " + N + " current").test(printed) && /Board Prep . run Board Drill \(0 of /.test(printed), "and says how many board cards are current (0 of " + N + ") with the priority line in card terms", () => printed.slice(0, 600));

  // Fixture B: due tomorrow -> every card current.
  await clearSrs();
  await seedAll((i, now) => ({ reps: 1, ease: 2.5, interval: 3, due: now + 86400000, misses: 0, lastGrade: 3 }));
  await openScreen("#/home", "#route .stat");
  await statIs("Board cards current", N + " of " + N, "Home, same grades due tomorrow: " + N + " of " + N + " current");
  await openScreen("#/progress", "#route .panel");
  const mastery2 = await panelByEyebrow("Board Drill Mastery");
  is(!!mastery2 && new RegExp(N + " of " + N + " cards current", "i").test(mastery2), "Progress agrees: " + N + " of " + N + " current", () => JSON.stringify(mastery2));
  const prio2 = await page.evaluate(() => { const r = [...document.querySelectorAll(".prog-pri-row")].find((x) => /Board Prep/.test(x.textContent)); return r ? r.innerText.replace(/\s+/g, " ").trim() : null; });
  is(!!prio2 && new RegExp(N + " of " + N + " cards current").test(prio2) && !/due for review/.test(prio2), "and the priority row says nothing is due when nothing is", () => JSON.stringify(prio2));

  // Honest path unchanged: a brand-new profile (no cards, no scenarios) still shows the scenario line as Not Started.
  await clearSrs();
  await openScreen("#/home", "#route .stat");
  await statIs("Promotable Readiness (LRM)", "Not Started", "a brand-new profile still reads Promotable Readiness (LRM): Not Started on Home");
  is((await statOf("Board cards current")) === null, "and shows no card line when no card was ever graded", () => "present");

  // Scenario played, no cards: the scenario score is named and says what it is built from.
  const totalScenarios = await recordOneScenario();
  await openScreen("#/home", "#route .stat");
  t = await routeText();
  is((await statOf("Promotable Readiness (LRM)")) !== "Not Started" && new RegExp("Scored from the 1 of " + totalScenarios + " scenarios you have played").test(t), "after one scenario Home names the scenario score (LRM) and says it is scored from 1 of " + totalScenarios + " scenarios", () => t.slice(0, 300));
  is((await statOf("Board cards current")) === null, "and with no card graded there is still no card line", () => "present");

  // Both: the scenario score AND the card figure, never blended.
  await seedAll((i, now) => ({ reps: 1, ease: 2.5, interval: 3, due: now + 86400000, misses: 0, lastGrade: 3 }));
  await openScreen("#/home", "#route .stat");
  is((await statOf("Promotable Readiness (LRM)")) !== null && (await statOf("Board cards current")) === N + " of " + N, "a Soldier with both sees the scenario score and the card figure as two separate lines", () => "missing");
  await clearSrs();
  await resetScenarios();
}

/* ---------------------------------------------------------------------
   D. the scenario score does not claim a Soldier is "Board Ready"
   --------------------------------------------------------------------- */
{
  // one scenario scored well on all six dimensions is 100% of its own scale: the top band, which used to read "Board Ready"
  await clearSrs();
  await resetScenarios();
  const top = await page.evaluate(async () => {
    await G.store.recordAttempt({ scenarioId: "qa-readiness-top-band", title: "QA top band", mode: "text", score: { Leads: 5, Develops: 5, Achieves: 5, Character: 5, Presence: 5, Intellect: 5 }, total: 30 });
    const p = await G.store.getProgress();
    return { label: p.readinessLabel, pct: p.competencyReadiness };
  });
  is(top.pct >= 85 && top.label === "Very Strong", "a scenario score of " + top.pct + "% is labelled Very Strong (the top band no longer says Board Ready)", JSON.stringify(top));
  await openScreen("#/home", "#route .stat");
  let t = await routeText();
  is(/Very Strong/.test(t) && !/Board Ready/.test(t), "Home names the top band Very Strong and never says Board Ready", () => t.slice(0, 300));
  await openScreen("#/progress", "#route .panel");
  t = await routeText();
  is(/Very Strong 85\+/.test(t) && !/Board Ready/.test(t), "Progress's legend reads Very Strong 85+ and nowhere says Board Ready", () => t.slice(0, 400));
  const toneTile = await page.evaluate(() => { const tiles = [...document.querySelectorAll('.readiness-dash[aria-label="Progress at a glance"] .readiness-tile')]; const x = tiles.find((n) => /Scenario readiness/.test(n.textContent)); return x ? { tone: x.getAttribute("data-tone"), sub: (x.querySelector(".readiness-sub") || {}).textContent } : null; });
  is(!!toneTile && toneTile.tone === "green" && toneTile.sub === "Very Strong", "and the glance tile keeps its green tone for the top band (sub-label Very Strong)", () => JSON.stringify(toneTile));
  await page.evaluate(() => { window.__printed = null; G.util.printHTML = (title, html) => { window.__printed = html; }; });
  await clickWhenStable(page, page.locator("button", { hasText: /Print Report/ }));
  const printedTop = (await until(page, () => !!window.__printed, null)) ? await page.evaluate(() => window.__printed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")) : "";
  is(/Promotable Readiness \(LRM\): Very Strong/.test(printedTop) && !/Board Ready/.test(printedTop), "the printed report says Very Strong and never Board Ready", () => printedTop.slice(0, 300));
  // honest path: the middle bands are untouched (test:progress-glance-strip pins 83% = Strong); a fresh profile is still Not Started
  await resetScenarios();
  const fresh = await page.evaluate(async () => (await G.store.getProgress()).readinessLabel);
  is(fresh === "Not Started", "after a reset the scenario line is Not Started again", fresh);
}

/* ---------------------------------------------------------------------
   E1. Mock Board's scorecard: the top band is Very Strong, in the card and in the saved history
   --------------------------------------------------------------------- */
{
  await clearSrs();
  // A board saved before this change carries the old word in its stored label: it must still load and show nothing odd.
  await page.evaluate(() => G.db.put("kv", { k: "board:mockHistory:v1", v: [{ ts: Date.now() - 86400000, pct: 90, total: 9, max: 10, count: 5, label: "Board Ready" }] }));
  await waitForRoute(page, "#/board", { fresh: true, ready: page.locator("button", { hasText: /^Mock Board$/ }) });
  await clickWhenStable(page, page.locator("button", { hasText: /^Mock Board$/ }));
  await until(page, () => !!document.querySelector("button.mb-start"));
  await page.locator("select").first().selectOption("5");
  await clickWhenStable(page, page.locator("button.mb-start", { hasText: /begin board/i }));
  await clickWhenStable(page, page.locator("button", { hasText: /I've reported/i }));
  for (let i = 0; i < 5; i++) {
    await clickWhenStable(page, page.locator("button.mb-reveal", { hasText: /reveal answer/i }));
    await clickWhenStable(page, page.locator("button.mb-score-btn").first());
  }
  await until(page, () => /After-Action Review/i.test(document.body.textContent || "") && document.querySelectorAll("input[type=range]").length >= 3);
  const sliders = page.locator("input[type=range]");
  for (let i = 0; i < await sliders.count(); i++) await sliders.nth(i).evaluate((el) => { el.value = "5"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await until(page, () => (document.querySelector(".mb-bigpct") || {}).textContent === "100%");
  const card = await page.evaluate(() => ({ pct: (document.querySelector(".mb-bigpct") || {}).textContent, label: (document.querySelector(".mb-biglabel") || {}).textContent, text: document.getElementById("route").innerText }));
  is(card.pct === "100%" && card.label === "Very Strong", "a five-question board at 100% reads Very Strong (it used to read Board Ready)", () => JSON.stringify({ pct: card.pct, label: card.label }));
  is(!/Board Ready/i.test(card.text), "and the phrase Board Ready appears nowhere on the Mock Board scorecard or its history", () => "found");
  const saved = await page.evaluate(async () => (((await G.db.get("kv", "board:mockHistory:v1")) || {}).v || []).map((h) => h.label));
  is(saved.length === 2 && saved[0] === "Board Ready" && saved[1] === "Very Strong", "the saved history keeps the older board as it was and stores the new one as Very Strong", () => JSON.stringify(saved));
  is(await until(page, () => !!document.querySelector(".mb-history .mb-spark-bar")), "...and the history view (older label included) still renders", () => "no history view");
  await page.evaluate(() => G.db.put("kv", { k: "board:mockHistory:v1", v: [] }));
}

/* ---------------------------------------------------------------------
   E2. Non-expiring percentages say so: the counselor-facing print, the MOS deck rows, the Progress sentence
   --------------------------------------------------------------------- */
{
  const printSummary = async () => {
    await waitForRoute(page, "#/profile", { fresh: true, ready: page.locator("button", { hasText: /Print readiness summary/ }) });
    await page.evaluate(() => { window.__printed = null; G.util.printHTML = (title, html) => { window.__printed = html; }; });
    await clickWhenStable(page, page.locator("button", { hasText: /Print readiness summary/ }));
    const got = await until(page, () => !!window.__printed, null);
    return got ? page.evaluate(() => window.__printed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")) : "";
  };
  // every card last rated Down Cold and 60 days overdue: "Know It or better" is all of them, and all of them are due again
  await clearSrs();
  await seedAll((i, now) => ({ reps: 1, ease: 2.5, interval: 3, due: now - 60 * 86400000, misses: 0, lastGrade: 3 }));
  let pr = await printSummary();
  is(new RegExp("Know It or better " + N + " \\(100%\\) \\(last rated; " + N + " due now\\)").test(pr), "the printed summary says the " + N + " Know It or better cards are as last rated, and that all " + N + " are due now", () => pr.slice(0, 500));
  // the same grades due tomorrow: none are due
  await clearSrs();
  await seedAll((i, now) => ({ reps: 1, ease: 2.5, interval: 3, due: now + 86400000, misses: 0, lastGrade: 3 }));
  pr = await printSummary();
  is(new RegExp("Know It or better " + N + " \\(100%\\) \\(last rated; 0 due now\\)").test(pr), "with the same grades due tomorrow it says 0 due now (the honest path reads as before, plus the note)", () => pr.slice(0, 500));
  // no card rated: no figure, no note
  await clearSrs();
  pr = await printSummary();
  is(/Know It or better 0 /.test(pr) && !/last rated;/.test(pr), "with no card rated there is no percentage and no note", () => pr.slice(0, 500));
  await clearSrs();

  // MOS deck rows: opt a deck in and open the Readiness tab
  await page.evaluate(() => { G.mosDecks.setOptedIn("92A", true); });
  await openReadiness();
  await until(page, () => !!document.querySelector(".readiness-mos-decks"));
  const mosPanelText = await page.evaluate(() => { const p = document.querySelector(".readiness-mos-decks"); return p ? p.innerText.replace(/\s+/g, " ") : ""; });
  is(/The percentage counts cards you last rated Know It or Down Cold, even if one is due again now/.test(mosPanelText), "the MOS Deck Readiness panel says its percentages are as last rated", () => JSON.stringify(mosPanelText.slice(0, 400)));
  await page.evaluate(() => { G.mosDecks.setOptedIn("92A", false); });

  // Progress: the sentence about the Readiness tab names what is there now
  await openScreen("#/progress", "#route .panel");
  const progText = await routeText();
  is(/how many of your cards are current live in the Board module under the Readiness tab/.test(progText) && !/composite Board Readiness Score/.test(progText), "Progress's Board Readiness card points at the count of current cards, not a composite score", () => progText.slice(0, 300));
}

expectNoConsoleNoise(noise);
await finish("READINESS CURRENCY");
